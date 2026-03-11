import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { EmbeddingsService } from '../shared/embeddings.service';
import {
  VectorstoreService,
  ChunkMetadata,
} from '../shared/vectorstore.service';
import { DatabaseService } from '../shared/database.service';
import { ChunkingService, CodeChunk } from './chunking.service';

export interface IngestionJob {
  jobId: string;
  repoId: string;
  status: 'queued' | 'cloning' | 'parsing' | 'embedding' | 'done' | 'error';
  progress: number;
  totalFiles: number;
  processedFiles: number;
  error?: string;
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.next',
  'dist',
  'build',
  'out',
  '.cache',
  '.turbo',
  'vendor',
  'coverage',
  '.nyc_output',
  '.venv',
  'venv',
  'target',
]);

const DENIED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
]);

const DENIED_EXTENSIONS = new Set([
  '.min.js',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3',
  '.zip',
  '.tar',
  '.gz',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.md',
  '.json',
  '.html',
  '.css',
  '.scss',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.php',
  '.vue',
  '.svelte',
  '.yaml',
  '.yml',
  '.toml',
  '.sh',
  '.bash',
  '.c',
  '.cpp',
  '.h',
  '.kt',
  '.swift',
  '.env.example',
]);

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private jobs = new Map<string, IngestionJob>();

  constructor(
    private config: ConfigService,
    private embeddings: EmbeddingsService,
    private vectorstore: VectorstoreService,
    private db: DatabaseService,
    private chunking: ChunkingService,
  ) {}

  async startIngestion(
    url: string,
    name?: string,
    token?: string,
  ): Promise<{ jobId: string; repoId: string }> {
    const repoId = randomUUID();
    const jobId = randomUUID();
    const repoName = name || this.extractRepoName(url);
    const now = Date.now();

    // Persist repo record — always store the clean URL (no embedded token)
    this.db
      .getDb()
      .prepare(
        `
      INSERT INTO repos (id, url, name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `,
      )
      .run(repoId, url, repoName, now, now);

    const job: IngestionJob = {
      jobId,
      repoId,
      status: 'queued',
      progress: 0,
      totalFiles: 0,
      processedFiles: 0,
    };
    this.jobs.set(jobId, job);
    this.persistJob(job);

    // Run async without blocking
    this.runIngestion(job, url, repoId, token).catch((err) => {
      job.status = 'error';
      job.error = err.message;
      this.persistJob(job);
      this.updateRepoStatus(repoId, 'error');
    });

    return { jobId, repoId };
  }

  private async runIngestion(
    job: IngestionJob,
    url: string,
    repoId: string,
    token?: string,
  ): Promise<void> {
    const cloneDir = this.config.get<string>(
      'REPO_CLONE_DIR',
      '/tmp/cit-repos',
    );
    const repoPath = path.join(cloneDir, repoId);

    try {
      // Clone — use authenticated URL when a token is provided
      job.status = 'cloning';
      this.persistJob(job);
      this.logger.log(`Cloning → ${repoPath}`);
      if (!fs.existsSync(cloneDir)) fs.mkdirSync(cloneDir, { recursive: true });
      const cloneUrl = this.buildCloneUrl(url, token);
      const git = simpleGit.default();
      await git.clone(cloneUrl, repoPath, ['--depth', '1']);

      // Walk files
      job.status = 'parsing';
      const walkStats = { skippedDirs: 0, deniedFiles: 0, unsupportedExt: 0 };
      const files = this.walkDir(repoPath, walkStats);
      job.totalFiles = files.length;
      this.persistJob(job);
      this.logger.log(
        `Found ${files.length} files to process (skipped: ${walkStats.skippedDirs} dirs, ${walkStats.deniedFiles} denied, ${walkStats.unsupportedExt} unsupported ext)`,
      );

      const allChunks: CodeChunk[] = [];
      for (const filePath of files) {
        try {
          const relPath = path.relative(repoPath, filePath);
          const content = fs.readFileSync(filePath, 'utf-8');
          const chunks = await this.chunking.chunkFile(relPath, content);
          allChunks.push(...chunks);
        } catch {
          // skip unreadable files
        }
        job.processedFiles++;
        job.progress = Math.floor((job.processedFiles / job.totalFiles) * 50);
      }

      // Embed & store
      job.status = 'embedding';
      this.persistJob(job);
      this.logger.log(
        `Embedding ${allChunks.length} chunks for repo ${repoId}`,
      );
      const batchSize = 32;
      for (let i = 0; i < allChunks.length; i += batchSize) {
        const batch = allChunks.slice(i, i + batchSize);
        const texts = batch.map((c) => c.content);
        const embeddings = await this.embeddings.embedBatch(texts);
        const ids = batch.map((_, idx) => `${repoId}_${i + idx}`);
        const metadatas: ChunkMetadata[] = batch.map((c) => ({
          repoId,
          filePath: c.filePath,
          language: c.language,
          chunkType: c.chunkType,
          startLine: c.startLine,
          endLine: c.endLine,
        }));
        await this.vectorstore.addChunks(
          repoId,
          ids,
          embeddings,
          texts,
          metadatas,
        );
        job.progress =
          50 + Math.floor(((i + batchSize) / allChunks.length) * 50);
      }

      // Cleanup clone
      fs.rmSync(repoPath, { recursive: true, force: true });

      // Update DB
      this.db
        .getDb()
        .prepare(
          `
        UPDATE repos SET status='done', chunk_count=?, file_count=?, updated_at=? WHERE id=?
      `,
        )
        .run(allChunks.length, job.totalFiles, Date.now(), repoId);

      job.status = 'done';
      job.progress = 100;
      this.persistJob(job);
      this.logger.log(`Ingestion complete for repo ${repoId}`);
    } catch (err) {
      this.logger.error(`Ingestion failed for ${repoId}`, err);
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  getJobStatus(jobId: string): IngestionJob {
    const job = this.jobs.get(jobId);
    if (job) return job;

    // Fall back to DB for jobs from a previous server instance (BUG-004)
    const row = this.db
      .getDb()
      .prepare(
        `SELECT id, repo_id, status, progress, total_files, processed_files, error FROM jobs WHERE id=?`,
      )
      .get(jobId) as any;
    if (!row) throw new NotFoundException(`Job ${jobId} not found`);
    return {
      jobId: row.id,
      repoId: row.repo_id,
      status: row.status,
      progress: row.progress,
      totalFiles: row.total_files,
      processedFiles: row.processed_files,
      error: row.error ?? undefined,
    };
  }

  private persistJob(job: IngestionJob): void {
    const now = Date.now();
    try {
      this.db
        .getDb()
        .prepare(
          `
        INSERT INTO jobs (id, repo_id, status, progress, total_files, processed_files, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status,
          progress=excluded.progress,
          total_files=excluded.total_files,
          processed_files=excluded.processed_files,
          error=excluded.error,
          updated_at=excluded.updated_at
      `,
        )
        .run(
          job.jobId,
          job.repoId,
          job.status,
          job.progress,
          job.totalFiles,
          job.processedFiles,
          job.error ?? null,
          now,
          now,
        );
    } catch (err: any) {
      this.logger.warn(`Failed to persist job ${job.jobId}: ${err.message}`);
    }
  }

  private walkDir(
    dir: string,
    stats: {
      skippedDirs: number;
      deniedFiles: number;
      unsupportedExt: number;
    } = {
      skippedDirs: 0,
      deniedFiles: 0,
      unsupportedExt: 0,
    },
  ): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) {
        stats.skippedDirs++;
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkDir(full, stats));
      } else if (entry.isFile()) {
        if (DENIED_FILES.has(entry.name)) {
          stats.deniedFiles++;
          continue;
        }
        if ([...DENIED_EXTENSIONS].some((ext) => entry.name.endsWith(ext))) {
          stats.deniedFiles++;
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        const isEnvFile =
          entry.name === '.env' || entry.name.startsWith('.env.');
        if (ALLOWED_EXTENSIONS.has(ext) || isEnvFile) {
          results.push(full);
        } else {
          stats.unsupportedExt++;
        }
      }
    }
    return results;
  }

  private extractRepoName(url: string): string {
    const parts = url.replace(/\.git$/, '').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  /**
   * Embed a GitHub PAT into the HTTPS clone URL so git can authenticate
   * without interactive prompts.
   *   https://github.com/owner/repo
   *   → https://x-access-token:<token>@github.com/owner/repo
   * The token is never stored or logged — only used transiently for cloning.
   */
  private buildCloneUrl(url: string, token?: string): string {
    if (!token) return url;
    try {
      const parsed = new URL(url);
      parsed.username = 'x-access-token';
      parsed.password = token;
      return parsed.toString();
    } catch {
      // Fallback: URL is malformed — return as-is; git will report the real error
      return url;
    }
  }

  private updateRepoStatus(repoId: string, status: string) {
    this.db
      .getDb()
      .prepare(`UPDATE repos SET status=?, updated_at=? WHERE id=?`)
      .run(status, Date.now(), repoId);
  }
}
