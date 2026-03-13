import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';
import { VectorstoreService } from '../shared/vectorstore.service';

export interface FileMetric {
  filePath: string;
  loc: number;
  functionCount: number;
  avgFunctionLength: number;
  cyclomaticComplexity: number;
  todoCount: number;
}

export interface HealthReport {
  repoId: string;
  totalFiles: number;
  totalLoc: number;
  avgComplexity: number;
  healthScore: number;
  topComplexFiles: FileMetric[];
  largestFiles: FileMetric[];
  todoHotspots: FileMetric[];
  locDistribution: { bracket: string; count: number }[];
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private db: DatabaseService,
    private vectorstore: VectorstoreService,
  ) {}

  /** Compute and store file metrics for a repo from its ingested chunks */
  async computeMetrics(repoId: string): Promise<{ filesAnalyzed: number }> {
    const repo = this.db
      .getDb()
      .prepare(`SELECT * FROM repos WHERE id=?`)
      .get(repoId) as any;
    if (!repo) throw new NotFoundException(`Repo ${repoId} not found`);

    const allData = await this.vectorstore.getAll(repoId);
    const chunks = allData
      ? allData.ids.map((id, i) => ({
          id,
          content: allData.documents[i],
          meta: allData.metadatas[i],
        }))
      : [];

    // Group chunks by file
    const fileContents = new Map<string, string>();
    for (const c of chunks) {
      const existing = fileContents.get(c.meta.filePath) ?? '';
      fileContents.set(c.meta.filePath, existing + '\n' + c.content);
    }

    const upsert = this.db.getDb().prepare(
      `INSERT INTO file_metrics (id, repo_id, file_path, loc, function_count, avg_function_length, cyclomatic_complexity, todo_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_id, file_path) DO UPDATE SET
         loc=excluded.loc, function_count=excluded.function_count,
         avg_function_length=excluded.avg_function_length,
         cyclomatic_complexity=excluded.cyclomatic_complexity,
         todo_count=excluded.todo_count, updated_at=excluded.updated_at`,
    );

    const { randomUUID } = await import('crypto');
    const now = Date.now();
    let filesAnalyzed = 0;

    const insertMany = this.db
      .getDb()
      .transaction((entries: [string, string][]) => {
        for (const [filePath, content] of entries) {
          const metrics = this.analyzeFile(content);
          upsert.run(
            randomUUID(),
            repoId,
            filePath,
            metrics.loc,
            metrics.functionCount,
            metrics.avgFunctionLength,
            metrics.cyclomaticComplexity,
            metrics.todoCount,
            now,
          );
          filesAnalyzed++;
        }
      });

    insertMany([...fileContents.entries()]);

    return { filesAnalyzed };
  }

  /** Get the health report for a repo */
  getHealth(repoId: string): HealthReport {
    const rows = this.db
      .getDb()
      .prepare(
        `SELECT file_path as filePath, loc, function_count as functionCount,
                avg_function_length as avgFunctionLength,
                cyclomatic_complexity as cyclomaticComplexity,
                todo_count as todoCount
         FROM file_metrics WHERE repo_id = ?`,
      )
      .all(repoId) as FileMetric[];

    if (rows.length === 0) {
      return {
        repoId,
        totalFiles: 0,
        totalLoc: 0,
        avgComplexity: 0,
        healthScore: 100,
        topComplexFiles: [],
        largestFiles: [],
        todoHotspots: [],
        locDistribution: [],
      };
    }

    const totalLoc = rows.reduce((s, r) => s + r.loc, 0);
    const avgComplexity =
      rows.reduce((s, r) => s + r.cyclomaticComplexity, 0) / rows.length;

    // Health score: start at 100, deduct for high complexity and large files
    const highComplexFiles = rows.filter(
      (r) => r.cyclomaticComplexity > 15,
    ).length;
    const veryLargeFiles = rows.filter((r) => r.loc > 500).length;
    const totalTodos = rows.reduce((s, r) => s + r.todoCount, 0);
    const healthScore = Math.max(
      0,
      Math.round(
        100 -
          highComplexFiles * 3 -
          veryLargeFiles * 2 -
          Math.min(totalTodos, 10),
      ),
    );

    const topComplexFiles = [...rows]
      .sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity)
      .slice(0, 10);

    const largestFiles = [...rows].sort((a, b) => b.loc - a.loc).slice(0, 10);

    const todoHotspots = [...rows]
      .filter((r) => r.todoCount > 0)
      .sort((a, b) => b.todoCount - a.todoCount)
      .slice(0, 10);

    // LOC distribution
    const brackets = [
      { bracket: '0-50', min: 0, max: 50 },
      { bracket: '51-100', min: 51, max: 100 },
      { bracket: '101-200', min: 101, max: 200 },
      { bracket: '201-500', min: 201, max: 500 },
      { bracket: '500+', min: 501, max: Infinity },
    ];
    const locDistribution = brackets.map((b) => ({
      bracket: b.bracket,
      count: rows.filter((r) => r.loc >= b.min && r.loc <= b.max).length,
    }));

    return {
      repoId,
      totalFiles: rows.length,
      totalLoc,
      avgComplexity: Math.round(avgComplexity * 100) / 100,
      healthScore,
      topComplexFiles,
      largestFiles,
      todoHotspots,
      locDistribution,
    };
  }

  /** Analyze a single file's content for metrics */
  private analyzeFile(content: string): {
    loc: number;
    functionCount: number;
    avgFunctionLength: number;
    cyclomaticComplexity: number;
    todoCount: number;
  } {
    const lines = content.split('\n');
    const loc = lines.filter((l) => l.trim().length > 0).length;

    // Count functions
    const funcRegex =
      /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\(|function)|(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{|=>\s*\{)/g;
    const funcMatches = content.match(funcRegex) ?? [];
    const functionCount = funcMatches.length;

    const avgFunctionLength =
      functionCount > 0 ? Math.round(loc / functionCount) : 0;

    // Cyclomatic complexity (simplified: count decision points)
    const decisionKeywords =
      /\b(if|else if|for|while|do|switch|case|catch|\?\?|&&|\|\||\?)\b/g;
    const decisionMatches = content.match(decisionKeywords) ?? [];
    const cyclomaticComplexity = 1 + decisionMatches.length;

    // TODO/FIXME/HACK count
    const todoRegex = /\b(TODO|FIXME|HACK|XXX)\b/gi;
    const todoMatches = content.match(todoRegex) ?? [];
    const todoCount = todoMatches.length;

    return {
      loc,
      functionCount,
      avgFunctionLength,
      cyclomaticComplexity,
      todoCount,
    };
  }
}
