import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../shared/database.service';
import { VectorstoreService } from '../shared/vectorstore.service';
import { LlmService } from '../shared/llm.service';
import { toonEncode } from '../shared/toon.helper';

export interface ArchDocResult {
  repoId: string;
  repoName: string;
  summary: string;
  dependencyGraph: string; // Mermaid LR diagram
  apiEndpoints: ApiEndpoint[];
  folderDescriptions: Record<string, string>;
  markdown: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
  handler?: string;
}

@Injectable()
export class ArchDocService {
  private readonly logger = new Logger(ArchDocService.name);

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
    private vectorstore: VectorstoreService,
    private llm: LlmService,
  ) {}

  async generate(repoId: string): Promise<ArchDocResult> {
    const repo = this.db
      .getDb()
      .prepare(`SELECT * FROM repos WHERE id=?`)
      .get(repoId) as any;
    if (!repo) throw new NotFoundException(`Repo ${repoId} not found`);

    // Fetch all chunks from vectorstore
    const results = await this.vectorstore.query(
      [repoId],
      new Array(384).fill(0),
      10000,
    );
    const chunks = results.flatMap((r) =>
      r.ids.map((id, i) => ({
        id,
        content: r.documents[i],
        meta: r.metadatas[i],
      })),
    );

    // Build file → content map (first chunk per file)
    const fileMap = new Map<string, string>();
    for (const c of chunks) {
      if (!fileMap.has(c.meta.filePath)) {
        fileMap.set(c.meta.filePath, c.content);
      }
    }

    // 1. Dependency graph
    const dependencyGraph = this.buildDependencyGraph(fileMap);

    // 2. API endpoints
    const apiEndpoints = this.extractApiEndpoints(fileMap);

    // 3. Folder descriptions
    const folderDescriptions = this.buildFolderDescriptions(fileMap);

    // 4. LLM summary
    const summary = await this.generateSummary(
      repo.name,
      fileMap,
      apiEndpoints,
      folderDescriptions,
    );

    // 5. Assemble Markdown
    const markdown = this.assembleMarkdown(
      repo.name,
      summary,
      dependencyGraph,
      apiEndpoints,
      folderDescriptions,
    );

    return {
      repoId,
      repoName: repo.name,
      summary,
      dependencyGraph,
      apiEndpoints,
      folderDescriptions,
      markdown,
    };
  }

  // ── Dependency graph ──────────────────────────────────────────────────────
  private buildDependencyGraph(fileMap: Map<string, string>): string {
    const edges: string[] = [];

    for (const [filePath, content] of fileMap) {
      const importRegex =
        /(?:import|require)\s*(?:.*?\s+from\s*)?['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const imported = match[1];
        // Only include relative imports
        if (!imported.startsWith('.')) continue;
        const sourceNode = this.nodeLabel(filePath);
        const targetNode = this.nodeLabel(imported);
        edges.push(`  ${sourceNode} --> ${targetNode}`);
      }
    }

    const uniqueEdges = [...new Set(edges)].slice(0, 60); // limit for readability
    if (uniqueEdges.length === 0) {
      return `graph LR\n  note["No internal imports found"]`;
    }
    return `graph LR\n${uniqueEdges.join('\n')}`;
  }

  private nodeLabel(p: string): string {
    const display = (p.split('/').pop() ?? p).replace(/"/g, "'");
    // Mermaid node IDs must be unquoted alphanumeric identifiers.
    // Use sanitised id + quoted display label: id["label"]
    const id = display.replace(/[^a-zA-Z0-9_]/g, '_') || '_node';
    return `${id}["${display}"]`;
  }

  // ── API endpoint extraction ───────────────────────────────────────────────
  private extractApiEndpoints(fileMap: Map<string, string>): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];
    // Match @Get(), @Get('path'), @Get("path"), @Get(`path`) — argument is optional
    const decoratorRegex =
      /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*(?:['`"]([^'`"]*?)['`"])?\s*\)/g;
    // Match @Controller(), @Controller('prefix'), etc. — argument is optional
    const controllerRegex = /@Controller\s*\(\s*(?:['`"]([^'`"]*?)['`"])?\s*\)/;

    for (const [filePath, content] of fileMap) {
      if (!filePath.endsWith('.ts') && !filePath.endsWith('.js')) continue;
      const controllerMatch = controllerRegex.exec(content);
      // controllerMatch[1] is undefined when @Controller() has no argument → base is ''
      const baseRoute = controllerMatch ? `/${controllerMatch[1] ?? ''}` : '';

      let match: RegExpExecArray | null;
      while ((match = decoratorRegex.exec(content)) !== null) {
        endpoints.push({
          method: match[1].toUpperCase(),
          // match[2] is undefined when @Get() has no argument → path is just the base
          path: `${baseRoute}/${match[2] ?? ''}`.replace(/\/+/g, '/') || '/',
          file: filePath,
        });
      }

      // Next.js App Router detection
      if (filePath.includes('/route.') || filePath.includes('\\route.')) {
        const routeRegex =
          /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
        while ((match = routeRegex.exec(content)) !== null) {
          const routePath = filePath
            .replace(/.*app|.*pages/, '')
            .replace(/\/route\.(ts|js)$/, '')
            .replace(/\\/g, '/');
          endpoints.push({
            method: match[1],
            path: routePath || '/',
            file: filePath,
          });
        }
      }
    }

    return endpoints;
  }

  // ── Folder descriptions ───────────────────────────────────────────────────
  private buildFolderDescriptions(
    fileMap: Map<string, string>,
  ): Record<string, string> {
    const folderFiles = new Map<string, string[]>();
    for (const fp of fileMap.keys()) {
      const parts = fp.split('/');
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      if (!folderFiles.has(folder)) folderFiles.set(folder, []);
      folderFiles.get(folder)!.push(parts[parts.length - 1]);
    }
    const descriptions: Record<string, string> = {};
    for (const [folder, files] of folderFiles) {
      descriptions[folder] =
        `Contains: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` (+${files.length - 8} more)` : ''}`;
    }
    return descriptions;
  }

  // ── LLM summary ──────────────────────────────────────────────────────────
  private async generateSummary(
    repoName: string,
    fileMap: Map<string, string>,
    endpoints: ApiEndpoint[],
    folders: Record<string, string>,
  ): Promise<string> {
    // Pick representative files (README, index, main, app)
    const keyPatterns = [
      'readme',
      'index',
      'main',
      'app',
      'server',
      'package.json',
    ];
    const keyFiles: string[] = [];
    for (const [fp, content] of fileMap) {
      if (
        keyPatterns.some((p) => fp.toLowerCase().includes(p)) &&
        keyFiles.length < 5
      ) {
        keyFiles.push(`### ${fp}\n${content.slice(0, 800)}`);
      }
    }

    // Encode structured data as TOON to reduce prompt tokens
    const endpointsToon = await toonEncode(endpoints.slice(0, 20));
    const foldersToon = await toonEncode(
      Object.entries(folders)
        .slice(0, 15)
        .map(([dir, desc]) => ({ dir, desc })),
    );

    const prompt = [
      `Repository: ${repoName}`,
      `Total files: ${fileMap.size}`,
      ``,
      `API endpoints (${endpoints.length}):`,
      '```toon',
      endpointsToon,
      '```',
      ``,
      `Folder structure:`,
      '```toon',
      foldersToon,
      '```',
      '',
      'Key file snippets:',
      keyFiles.join('\n\n'),
    ].join('\n');

    try {
      return await this.llm.chat(
        [
          {
            role: 'system',
            content:
              'You are a senior software architect. Write a concise (3-5 paragraph) high-level architecture summary of the given repository for a new developer. Cover: purpose, tech stack, key modules, data flow, and entry points.',
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 800 },
      );
    } catch (err: any) {
      this.logger.warn('LLM summary failed', err?.message);
      return `Repository "${repoName}" with ${fileMap.size} files and ${endpoints.length} API endpoints.`;
    }
  }

  // ── Markdown assembly ─────────────────────────────────────────────────────
  private assembleMarkdown(
    repoName: string,
    summary: string,
    dependencyGraph: string,
    endpoints: ApiEndpoint[],
    folders: Record<string, string>,
  ): string {
    const endpointTable =
      endpoints.length > 0
        ? [
            '| Method | Path | File |',
            '|--------|------|------|',
            ...endpoints.map(
              (e) => `| \`${e.method}\` | \`${e.path}\` | \`${e.file}\` |`,
            ),
          ].join('\n')
        : '_No endpoints detected_';

    const folderList = Object.entries(folders)
      .map(([dir, desc]) => `- **\`${dir}/\`** — ${desc}`)
      .join('\n');

    return [
      `# Architecture: ${repoName}`,
      '',
      '## Overview',
      summary,
      '',
      '## Module Dependency Graph',
      '```mermaid',
      dependencyGraph,
      '```',
      '',
      '## API Endpoints',
      endpointTable,
      '',
      '## Folder Structure',
      folderList,
    ].join('\n');
  }
}
