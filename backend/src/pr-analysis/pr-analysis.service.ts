import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../shared/database.service';
import { LlmService } from '../shared/llm.service';

export interface PrAnalysisResult {
  id: string;
  repoId: string;
  prNumber: number;
  prUrl: string;
  summary: string;
  filesChanged: string[];
  risks: string[];
  createdAt: number;
}

@Injectable()
export class PrAnalysisService {
  private readonly logger = new Logger(PrAnalysisService.name);

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
    private llm: LlmService,
  ) {}

  async analyze(dto: {
    repoId: string;
    repoUrl: string;
    prNumber: number;
    githubToken?: string;
  }): Promise<PrAnalysisResult> {
    const { repoId, repoUrl, prNumber, githubToken } = dto;

    // Parse owner/repo from URL
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      throw new BadRequestException(
        'Invalid GitHub repo URL. Expected format: https://github.com/owner/repo',
      );
    }
    const [, owner, repo] = match;

    // Fetch PR data from GitHub API
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'CIT-CodeIntelligence',
    };
    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }

    const prRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}`,
      { headers },
    );
    if (!prRes.ok) {
      throw new BadRequestException(
        `Failed to fetch PR #${prNumber}: ${prRes.status} ${prRes.statusText}`,
      );
    }
    const prData = await prRes.json();

    // Fetch changed files
    const filesRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/files?per_page=100`,
      { headers },
    );
    if (!filesRes.ok) {
      throw new BadRequestException(
        `Failed to fetch PR files: ${filesRes.status} ${filesRes.statusText}`,
      );
    }
    const filesData: any[] = await filesRes.json();

    const filesChanged = filesData.map((f: any) => f.filename);

    // Build diff summary for LLM (truncated patches)
    const diffSummary = filesData
      .slice(0, 30)
      .map(
        (f: any) =>
          `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${(f.patch ?? '').slice(0, 600)}`,
      )
      .join('\n\n');

    const prompt = [
      `PR #${prNumber}: ${prData.title}`,
      `Author: ${prData.user?.login ?? 'unknown'}`,
      `Description: ${(prData.body ?? '').slice(0, 500)}`,
      `Files changed: ${filesChanged.length}`,
      '',
      'Diff content:',
      diffSummary,
    ].join('\n');

    let analysis: { summary: string; risks: string[] };
    try {
      const response = await this.llm.chat(
        [
          {
            role: 'system',
            content: `You are a senior code reviewer. Analyze this PR and provide:
1. A concise summary of what this PR does (2-3 paragraphs)
2. A list of potential risks or issues to watch for

Respond in this exact JSON format:
{"summary": "...", "risks": ["risk1", "risk2", ...]}`,
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 800 },
      );

      try {
        // Try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        analysis = jsonMatch
          ? JSON.parse(jsonMatch[0])
          : { summary: response, risks: [] };
      } catch {
        analysis = { summary: response, risks: [] };
      }
    } catch (err: any) {
      this.logger.warn('LLM PR analysis failed', err?.message);
      analysis = {
        summary: `PR #${prNumber} "${prData.title}" changes ${filesChanged.length} files.`,
        risks: [],
      };
    }

    // Persist
    const id = randomUUID();
    const now = Date.now();
    const prUrl = prData.html_url ?? `${repoUrl}/pull/${prNumber}`;

    this.db
      .getDb()
      .prepare(
        `INSERT INTO pr_analyses (id, repo_id, pr_number, pr_url, summary, files_changed, risks, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        repoId,
        prNumber,
        prUrl,
        analysis.summary,
        JSON.stringify(filesChanged),
        JSON.stringify(analysis.risks),
        now,
      );

    return {
      id,
      repoId,
      prNumber,
      prUrl,
      summary: analysis.summary,
      filesChanged,
      risks: analysis.risks,
      createdAt: now,
    };
  }

  listByRepo(repoId: string): PrAnalysisResult[] {
    const rows = this.db
      .getDb()
      .prepare(
        `SELECT * FROM pr_analyses WHERE repo_id = ? ORDER BY created_at DESC`,
      )
      .all(repoId) as any[];
    return rows.map((r) => ({
      ...r,
      filesChanged: JSON.parse(r.files_changed ?? '[]'),
      risks: JSON.parse(r.risks ?? '[]'),
    }));
  }

  getById(id: string): PrAnalysisResult | null {
    const row = this.db
      .getDb()
      .prepare(`SELECT * FROM pr_analyses WHERE id = ?`)
      .get(id) as any;
    if (!row) return null;
    return {
      ...row,
      filesChanged: JSON.parse(row.files_changed ?? '[]'),
      risks: JSON.parse(row.risks ?? '[]'),
    };
  }
}
