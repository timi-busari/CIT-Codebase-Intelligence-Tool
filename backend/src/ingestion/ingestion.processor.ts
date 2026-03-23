import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import * as simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { EmbeddingsService } from '../shared/embeddings.service';
import { VectorstoreService } from '../shared/vectorstore.service';
import { DatabaseService } from '../shared/database.service';
import { ChunkingService, CodeChunk } from './chunking.service';
import {
  INGESTION_QUEUE_NAME,
  IngestionJobData,
  IngestionJobProgress,
} from './ingestion.queue';
import { IngestionGateway } from './ingestion.gateway';

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

const INGEST_ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.md',
  '.yaml',
  '.yml',
  '.json',
  '.sh',
  '.env.example',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.swift',
  '.kt',
  '.scala',
  '.r',
  '.sql',
]);

@Processor(INGESTION_QUEUE_NAME)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private embeddings: EmbeddingsService,
    private vectorstore: VectorstoreService,
    private db: DatabaseService,
    private chunking: ChunkingService,
    private gateway: IngestionGateway,
  ) {
    super();
  }

  private broadcast(
    job: Job<IngestionJobData>,
    progress: IngestionJobProgress,
  ) {
    this.gateway.emitProgress({
      jobId: job.id as string,
      repoId: job.data.repoId,
      progress,
    });
  }

  async process(job: Job<IngestionJobData>): Promise<void> {
    const { repoId, url, token } = job.data;
    const tempDir = path.join(process.cwd(), 'temp', repoId);

    try {
      // Phase 1: Cloning
      const cloningProgress: IngestionJobProgress = {
        phase: 'cloning',
        filesProcessed: 0,
        totalFiles: 0,
      };
      await job.updateProgress(cloningProgress);
      this.broadcast(job, cloningProgress);

      this.logger.log(`Starting ingestion of ${url} (repoId: ${repoId})`);

      // Clean up any existing temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });

      // Clone repository
      const git = simpleGit.simpleGit();
      await git.clone(this.addTokenToUrl(url, token), tempDir, [
        '--depth',
        '1',
      ]);
      this.logger.log(`Cloned repository to ${tempDir}`);

      // Phase 2: Filtering and discovery
      const filteringProgress: IngestionJobProgress = {
        phase: 'filtering',
        filesProcessed: 0,
        totalFiles: 0,
      };
      await job.updateProgress(filteringProgress);
      this.broadcast(job, filteringProgress);

      const eligibleFiles = this.getEligibleFiles(tempDir);
      const totalFiles = eligibleFiles.length;

      this.logger.log(`Found ${totalFiles} eligible files for ingestion`);

      // Phase 3: Chunking
      const chunkingStart: IngestionJobProgress = {
        phase: 'chunking',
        filesProcessed: 0,
        totalFiles,
      };
      await job.updateProgress(chunkingStart);
      this.broadcast(job, chunkingStart);

      const allChunks: CodeChunk[] = [];
      let processedFiles = 0;

      for (const filePath of eligibleFiles) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const relativePath = path.relative(tempDir, filePath);
          const chunks = await this.chunking.chunkFile(relativePath, content);

          // Set repoId on each chunk
          for (const chunk of chunks) {
            chunk.repoId = repoId;
          }

          allChunks.push(...chunks);

          processedFiles++;
          const chunkProgress: IngestionJobProgress = {
            phase: 'chunking',
            filesProcessed: processedFiles,
            totalFiles,
            currentFile: path.relative(tempDir, filePath),
          };
          await job.updateProgress(chunkProgress);
          this.broadcast(job, chunkProgress);
        } catch (error) {
          this.logger.warn(
            `Failed to chunk file ${filePath}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `Generated ${allChunks.length} chunks from ${processedFiles} files`,
      );

      // Phase 4: Embedding
      const embeddingStart: IngestionJobProgress = {
        phase: 'embedding',
        filesProcessed: 0,
        totalFiles: allChunks.length,
      };
      await job.updateProgress(embeddingStart);
      this.broadcast(job, embeddingStart);

      // Batch embeddings for efficiency (process in groups of 50)
      const BATCH_SIZE = 50;
      let embeddedChunks = 0;

      for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE);
        const contents = batch.map((c) => c.content);

        try {
          const embeddings = await this.embeddings.embedBatch(contents);
          const documents = batch.map((c) => c.content);
          const metadatas = batch.map((c) => ({
            repoId: repoId, // Always use the job's repoId
            filePath: c.filePath,
            language: c.language,
            chunkType: c.chunkType,
            startLine: c.startLine,
            endLine: c.endLine,
          }));
          const ids = batch.map(() => randomUUID());

          await this.vectorstore.addChunks(
            repoId,
            ids,
            embeddings,
            documents,
            metadatas,
          );

          embeddedChunks += batch.length;
          const embedProgress: IngestionJobProgress = {
            phase: 'embedding',
            filesProcessed: embeddedChunks,
            totalFiles: allChunks.length,
          };
          await job.updateProgress(embedProgress);
          this.broadcast(job, embedProgress);
        } catch (error) {
          this.logger.warn(
            `Failed to embed batch starting at index ${i} (${batch.length} chunks): ${error.message}`,
          );
          this.logger.warn(
            `Batch content lengths: ${contents.map((c) => c.length).join(', ')}`,
          );
        }
      }

      // Update database status
      this.db
        .getDb()
        .prepare(
          `
          UPDATE repos 
          SET status = 'done', chunk_count = ?, file_count = ?, updated_at = ? 
          WHERE id = ?
        `,
        )
        .run(allChunks.length, eligibleFiles.length, Date.now(), repoId);

      // Final progress update
      const completeProgress: IngestionJobProgress = {
        phase: 'complete',
        filesProcessed: embeddedChunks,
        totalFiles: allChunks.length,
      };
      await job.updateProgress(completeProgress);
      this.broadcast(job, completeProgress);
      this.gateway.emitComplete(job.id as string, repoId);

      this.logger.log(
        `Ingestion completed for ${url} (${allChunks.length} chunks)`,
      );

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.error(`Ingestion failed for ${url}:`, error);

      // Broadcast error to WebSocket clients
      this.gateway.emitError(
        job.id as string,
        repoId,
        error instanceof Error ? error.message : String(error),
      );

      // Update database status to error
      this.db
        .getDb()
        .prepare(
          `UPDATE repos SET status = 'error', updated_at = ? WHERE id = ?`,
        )
        .run(Date.now(), repoId);

      // Clean up temp directory on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      throw error;
    }
  }

  private addTokenToUrl(url: string, token?: string): string {
    if (!token) return url;

    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes('github.com')) {
        // For GitHub, insert token in the URL
        urlObj.username = token;
        urlObj.password = 'x-oauth-basic';
      }
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  private getEligibleFiles(rootDir: string): string[] {
    const files: string[] = [];

    const traverse = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            traverse(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (
            INGEST_ALLOWED_EXTENSIONS.has(ext) &&
            !DENIED_FILES.has(entry.name)
          ) {
            files.push(fullPath);
          }
        }
      }
    };

    traverse(rootDir);
    return files;
  }
}
