import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../shared/database.service';
import { VectorstoreService } from '../shared/vectorstore.service';
import { LlmService } from '../shared/llm.service';

export interface ArchDocResult {
  repoId: string;
  repoName: string;
  summary: string;
  architectureDiagram: string; // Mermaid TD diagram (LLM-generated)
  markdown: string;
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
    const allData = await this.vectorstore.getAll(repoId);
    const chunks = allData
      ? allData.ids.map((id, i) => ({
          id,
          content: allData.documents[i],
          meta: allData.metadatas[i],
        }))
      : [];

    // Full file reconstruction: sort chunks by startLine and concatenate
    const fileChunks = new Map<
      string,
      { content: string; startLine: number }[]
    >();
    for (const c of chunks) {
      if (!fileChunks.has(c.meta.filePath)) fileChunks.set(c.meta.filePath, []);
      fileChunks.get(c.meta.filePath)!.push({
        content: c.content,
        startLine: c.meta.startLine ?? 0,
      });
    }
    const fileMap = new Map<string, string>();
    for (const [filePath, parts] of fileChunks) {
      const ordered = parts.sort((a, b) => a.startLine - b.startLine);
      fileMap.set(filePath, ordered.map((p) => p.content).join('\n'));
    }

    // 1. LLM summary — enterprise-grade multi-section
    const summary = await this.generateSummary(repo.name, fileMap);

    // 2. LLM architecture diagram (detailed)
    const architectureDiagram = await this.generateArchitectureDiagram(
      repo.name,
      fileMap,
    );

    // 3. Assemble Markdown
    const markdown = this.assembleMarkdown(
      repo.name,
      summary,
      architectureDiagram,
    );

    const result: ArchDocResult = {
      repoId,
      repoName: repo.name,
      summary,
      architectureDiagram,
      markdown,
    };

    // Persist versioned arch doc
    const lastVersion = this.db
      .getDb()
      .prepare(
        `SELECT COALESCE(MAX(version), 0) AS v FROM arch_docs WHERE repo_id = ?`,
      )
      .get(repoId) as any;
    const nextVersion = (lastVersion?.v ?? 0) + 1;
    this.db
      .getDb()
      .prepare(
        `INSERT INTO arch_docs (id, repo_id, content, version, generated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), repoId, markdown, nextVersion, Date.now());

    return result;
  }

  getHistory(repoId: string): { version: number; generatedAt: number }[] {
    return this.db
      .getDb()
      .prepare(
        `SELECT version, generated_at as generatedAt FROM arch_docs WHERE repo_id = ? ORDER BY version DESC`,
      )
      .all(repoId) as any[];
  }

  getVersion(
    repoId: string,
    version: number,
  ): { version: number; content: string; generatedAt: number } {
    const row = this.db
      .getDb()
      .prepare(
        `SELECT version, content, generated_at as generatedAt FROM arch_docs WHERE repo_id = ? AND version = ?`,
      )
      .get(repoId, version) as any;
    if (!row)
      throw new NotFoundException(
        `Arch doc version ${version} not found for repo ${repoId}`,
      );
    return row;
  }

  // ── LLM: architecture summary ────────────────────────────────────────────

  private async generateSummary(
    repoName: string,
    fileMap: Map<string, string>,
  ): Promise<string> {
    // ── 1. Directory tree ──
    const dirTree = this.buildDirectoryTree(fileMap);

    // ── 2. Parsed dependencies from manifest files ──
    const deps = this.extractDependencies(fileMap);
    const depSummary =
      deps.length > 0 ? deps.slice(0, 60).join(', ') : 'none detected';

    // ── 3. Entry point detection ──
    const entryPoints = this.detectEntryPoints(fileMap);

    // ── 4. Gather representative file contents ──
    // High-priority: config/manifest/readme files (architecture-defining)
    const highPatterns = [
      'readme',
      'package.json',
      'requirements.txt',
      'pyproject.toml',
      'setup.py',
      'pipfile',
      'pom.xml',
      'build.gradle',
      'go.mod',
      'cargo.toml',
      '.csproj',
      '.sln',
      'gemfile',
      'composer.json',
      'docker-compose',
      'dockerfile',
      'makefile',
      '.env.example',
      'tsconfig',
      'nest-cli',
      'angular.json',
      'next.config',
      'vite.config',
      'webpack.config',
    ];
    // Medium-priority: core source files that reveal architecture
    const medPatterns = [
      'main.',
      'index.',
      'app.',
      'server.',
      'config',
      'route',
      'controller',
      'service',
      'model',
      'schema',
      'entity',
      'middleware',
      'module',
      'views',
      'urls',
      'serializer',
      'manage.py',
      'wsgi',
      'asgi',
      'settings',
      'application',
      'repository',
      'dto',
      'mapper',
      'handler',
      'provider',
      'guard',
      'interceptor',
      'filter',
      'pipe',
      'gateway',
      'resolver',
      'cmd/',
      'internal/',
      'gemspec',
      'rakefile',
    ];

    const highFiles: string[] = [];
    const medFiles: string[] = [];
    for (const [fp, content] of fileMap) {
      const lower = fp.toLowerCase();
      if (
        highPatterns.some((p) => lower.includes(p)) &&
        highFiles.length < 10
      ) {
        highFiles.push(`### ${fp}\n${content.slice(0, 4000)}`);
      } else if (
        medPatterns.some((p) => lower.includes(p)) &&
        medFiles.length < 18
      ) {
        medFiles.push(`### ${fp}\n${content.slice(0, 2500)}`);
      }
    }

    // ── 5. Build the prompt ──
    const prompt = [
      `TASK: Write an architecture documentation document for the "${repoName}" repository.`,
      'Use ONLY the reference material below. Do NOT suggest fixes, improvements, or code reviews.',
      'Output a factual description of what this system IS and how it works.',
      '',
      '---',
      'REFERENCE MATERIAL:',
      '---',
      '',
      `Repository name: ${repoName}`,
      `Total files: ${fileMap.size}`,
      '',
      '### Directory Structure',
      dirTree,
      '',
      `### Dependencies (${deps.length} detected)`,
      depSummary,
      '',
      `### Entry Points`,
      entryPoints.length > 0 ? entryPoints.join('\n') : 'none detected',
      '',
      '### High-priority files (manifests, configs, READMEs)',
      highFiles.join('\n\n'),
      '',
      '### Core source files',
      medFiles.join('\n\n'),
      '',
      '---',
      'END OF REFERENCE MATERIAL.',
      '---',
      '',
      'Now write the architecture document following the sections specified in your instructions.',
      'Do NOT review, critique, or suggest improvements to the code. Only DESCRIBE the architecture.',
    ].join('\n');

    const systemPrompt = [
      'You are a principal software architect writing internal architecture documentation.',
      'Your ONLY job is to DESCRIBE the architecture of the repository — what it is, how it works, and how its parts connect.',
      '',
      'CRITICAL: You are NOT reviewing code. You are NOT suggesting improvements. You are NOT fixing bugs.',
      'You are writing a factual reference document that describes the system as it exists.',
      '',
      'Write a comprehensive architecture document covering ALL of the following sections.',
      'Each section must be substantive — use prose paragraphs with specific file paths, class names, and function names.',
      '',
      '## Required sections',
      '',
      '### 1. Purpose & Domain',
      'What problem does this system solve? What is the business or technical domain?',
      'What are the primary capabilities?',
      '',
      '### 2. Tech Stack',
      'List every framework, runtime, language, database, queue, and third-party service visible in the dependencies and imports.',
      'For each, explain its role in the system — not just its name.',
      'Base this STRICTLY on the dependency list and file contents provided.',
      '',
      '### 3. Module & Directory Structure',
      'Walk through the directory tree provided above.',
      'Describe what each top-level directory and significant subdirectory is responsible for.',
      'Explain ownership boundaries between modules.',
      '',
      '### 4. Data Flow',
      'Trace how a typical request or operation flows through the system end-to-end.',
      'Name the specific files, classes, and functions at each step.',
      'If multiple flows exist (HTTP request, background job, event-driven), describe each.',
      '',
      '### 5. Key Abstractions & Patterns',
      'Identify design patterns (DI, repository, middleware pipeline, event-driven, etc.) with file path references.',
      '',
      '### 6. Entry Points',
      'List every entry point: bootstrap files, HTTP handlers, CLI commands, cron jobs, message consumers.',
      'Include file paths from the entry points section above.',
      '',
      '### 7. External Dependencies & Integrations',
      'List external services, databases, queues, or APIs this system integrates with.',
      'Explain how each integration works: which module initiates it, what protocol, what data flows.',
      '',
      '### 8. Configuration & Environment',
      'List significant environment variables and configuration files and what they control.',
      '',
      '## Rules',
      '- ONLY describe what you can directly verify from the provided files, dependencies, and directory structure.',
      '- DO NOT invent features, libraries, or patterns that are not visible in the context.',
      '- Reference specific file paths using `backticks`.',
      '- If a section has insufficient context, write "Insufficient context from available files" for that section.',
    ].join('\n');

    try {
      const response = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.1, maxTokens: 4000 },
      );
      return response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    } catch (err: any) {
      this.logger.warn('LLM summary failed', err?.message);
      return `Repository "${repoName}" with ${fileMap.size} files. LLM generation failed — please retry.`;
    }
  }

  // ── Extract dependencies from manifest files ─────────────────────────────

  private extractDependencies(fileMap: Map<string, string>): string[] {
    const deps: string[] = [];

    for (const [fp, content] of fileMap) {
      const lower = fp.toLowerCase();

      if (lower.endsWith('package.json')) {
        try {
          const pkg = JSON.parse(content);
          if (pkg.dependencies) deps.push(...Object.keys(pkg.dependencies));
          if (pkg.devDependencies)
            deps.push(...Object.keys(pkg.devDependencies));
        } catch {
          /* malformed */
        }
      }

      if (lower.endsWith('requirements.txt')) {
        for (const line of content.split('\n')) {
          const name = line
            .trim()
            .split(/[=<>!~[]/)[0]
            .trim();
          if (name && !name.startsWith('#') && !name.startsWith('-'))
            deps.push(name);
        }
      }

      if (lower.endsWith('pyproject.toml')) {
        const depBlock = content.match(
          /\[(?:project\.)?dependencies\]([\s\S]*?)(?=\n\[|$)/,
        );
        if (depBlock) {
          for (const line of depBlock[1].split('\n')) {
            const name = line
              .trim()
              .split(/[=<>!~,\s[]/)[0]
              .trim();
            if (name && !name.startsWith('#')) deps.push(name);
          }
        }
      }

      if (lower.endsWith('go.mod')) {
        const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
        if (requireMatch) {
          for (const line of requireMatch[1].split('\n')) {
            const pkg = line.trim().split(/\s/)[0];
            if (pkg) deps.push(pkg.split('/').pop() || pkg);
          }
        }
      }

      if (lower === 'gemfile' || lower.endsWith('/gemfile')) {
        const gemRegex = /gem\s+['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = gemRegex.exec(content))) deps.push(m[1]);
      }

      if (lower.endsWith('composer.json')) {
        try {
          const comp = JSON.parse(content);
          if (comp.require) deps.push(...Object.keys(comp.require));
        } catch {
          /* malformed */
        }
      }

      if (lower.endsWith('pom.xml')) {
        const artRegex = /<artifactId>([^<]+)<\/artifactId>/g;
        let m: RegExpExecArray | null;
        while ((m = artRegex.exec(content))) deps.push(m[1]);
      }

      if (lower.endsWith('cargo.toml')) {
        const depSection = content.match(
          /\[dependencies\]([\s\S]*?)(?=\n\[|$)/,
        );
        if (depSection) {
          for (const line of depSection[1].split('\n')) {
            const name = line.trim().split(/\s*=/)[0].trim();
            if (name) deps.push(name);
          }
        }
      }

      if (
        lower.endsWith('build.gradle') ||
        lower.endsWith('build.gradle.kts')
      ) {
        const implRegex =
          /(?:implementation|api|compile)\s*\(?['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = implRegex.exec(content))) {
          const parts = m[1].split(':');
          deps.push(parts.length >= 2 ? parts[1] : m[1]);
        }
      }
    }

    return [...new Set(deps)];
  }

  // ── Detect entry points ───────────────────────────────────────────────────

  private detectEntryPoints(fileMap: Map<string, string>): string[] {
    const entryPatterns = [
      'main.ts',
      'main.js',
      'index.ts',
      'index.js',
      'app.ts',
      'app.js',
      'server.ts',
      'server.js',
      'main.py',
      'app.py',
      'manage.py',
      'wsgi.py',
      'asgi.py',
      '__main__.py',
      'main.go',
      'main.rs',
      'lib.rs',
      'program.cs',
      'startup.cs',
      'application.java',
      'main.java',
      'application.kt',
      'main.kt',
      'config.ru',
      'index.php',
    ];
    return [...fileMap.keys()]
      .filter((fp) => {
        const name = (fp.split('/').pop() ?? '').toLowerCase();
        return entryPatterns.some((p) => name === p || name.startsWith(p));
      })
      .slice(0, 15);
  }

  // ── LLM: architecture diagram (detailed) ──────────────────────────────────

  private async generateArchitectureDiagram(
    repoName: string,
    fileMap: Map<string, string>,
  ): Promise<string> {
    const dirTree = this.buildDirectoryTree(fileMap);
    const deps = this.extractDependencies(fileMap);
    const entryPoints = this.detectEntryPoints(fileMap);

    // Gather key source files for the LLM to understand relationships
    const keyPatterns = [
      'module',
      'controller',
      'service',
      'middleware',
      'guard',
      'gateway',
      'resolver',
      'provider',
      'route',
      'handler',
      'config',
      'main.',
      'app.',
      'server.',
      'index.',
      'model',
      'entity',
      'schema',
      'repository',
      'views',
      'urls',
    ];
    const keySnippets: string[] = [];
    for (const [fp, content] of fileMap) {
      const lower = fp.toLowerCase();
      if (
        keyPatterns.some((p) => lower.includes(p)) &&
        keySnippets.length < 20
      ) {
        keySnippets.push(`### ${fp}\n${content.slice(0, 1500)}`);
      }
    }

    const prompt = [
      `TASK: Generate a DETAILED Mermaid architecture diagram for "${repoName}".`,
      'The diagram should give a complete picture of the system architecture at a glance.',
      '',
      '---',
      'REFERENCE DATA:',
      '---',
      '',
      '## Directory Structure',
      dirTree,
      '',
      `## Dependencies (${deps.length})`,
      deps.slice(0, 50).join(', ') || 'none detected',
      '',
      '## Entry Points',
      entryPoints.length > 0 ? entryPoints.join('\n') : 'none detected',
      '',
      '## Key Source Files',
      keySnippets.join('\n\n'),
      '',
      '---',
      'END OF REFERENCE DATA.',
      '---',
    ].join('\n');

    const systemPrompt = [
      'You are a senior software architect. Generate a DETAILED Mermaid architecture diagram.',
      '',
      'The diagram must be comprehensive enough that someone can understand the entire system architecture just by reading it.',
      '',
      'DIAGRAM REQUIREMENTS:',
      '- Use `graph TD` (top-down) layout.',
      '- Create `subgraph` blocks for EACH architectural layer or domain with descriptive titles.',
      '  Examples: "API Layer", "Service Layer", "Data Layer", "External Services", "Auth", "Background Jobs".',
      '- Show EVERY significant module/controller/service as a separate node inside its subgraph.',
      '- Label nodes with their actual names from the code (e.g., "ScheduleService", "AuthGuard", "UserController").',
      '- Show data flow with labeled arrows where possible (e.g., `-->|"HTTP"| `, `-->|"SQL"| `).',
      '- Include external systems: databases, caches (Redis), message queues, third-party APIs.',
      '- Show middleware, guards, interceptors, and pipes in the request pipeline if they exist.',
      '- Aim for 20-35 nodes for a meaningful, detailed diagram.',
      '- Use descriptive node labels: `NodeId["Actual Name"]` format.',
      '- Style subgraphs with clear boundaries.',
      '',
      'FORMAT — output ONLY the mermaid code block:',
      '```mermaid',
      'graph TD',
      '  ...',
      '```',
      '',
      'RULES:',
      '- Each node ID must be a unique simple alphanumeric string (no special chars or spaces in IDs).',
      '- Do NOT create self-referencing edges (A --> A).',
      '- ONLY include components visible in the provided data. Do NOT invent.',
      '- Do NOT output any text before or after the mermaid code block.',
    ].join('\n');

    try {
      const response = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.1, maxTokens: 2500 },
      );
      const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      const extracted = this.extractMermaidFromResponse(cleaned);
      if (extracted) {
        return extracted;
      }

      this.logger.warn(
        'Could not extract mermaid from LLM response (first 300 chars):',
        cleaned.slice(0, 300),
      );
      return this.buildDeterministicArchitectureDiagram(
        repoName,
        fileMap,
        deps,
        entryPoints,
      );
    } catch (err: any) {
      this.logger.warn('LLM diagram generation failed', err?.message);
      return this.buildDeterministicArchitectureDiagram(
        repoName,
        fileMap,
        deps,
        entryPoints,
      );
    }
  }

  private extractMermaidFromResponse(response: string): string | null {
    if (!response) return null;

    // Handle fenced blocks with variable language labels: ```mermaid, ``` Mermaid,
    // ```mmd, or even unlabeled fences that still contain a Mermaid graph.
    const fenceRegex =
      /(?:```|~~~)\s*([a-zA-Z0-9_-]*)\s*\r?\n([\s\S]*?)(?:```|~~~)/g;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(response)) !== null) {
      const lang = (match[1] ?? '').toLowerCase();
      const body = match[2]?.trim() ?? '';
      if (
        lang.includes('mermaid') ||
        lang === 'mmd' ||
        this.looksLikeMermaidStart(body)
      ) {
        return body;
      }
    }

    // Handle inline-style fences (sometimes models omit the first newline).
    const inlineFence = response.match(
      /(?:```|~~~)\s*(?:mermaid|mmd)\s*([\s\S]*?)(?:```|~~~)/i,
    );
    if (inlineFence?.[1] && this.looksLikeMermaidStart(inlineFence[1])) {
      return inlineFence[1].trim();
    }

    // Raw diagram with no fences.
    const start = response.search(
      /^\s*(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?|journey|gantt|pie|mindmap|timeline)\b/im,
    );
    if (start >= 0) {
      return response.slice(start).trim();
    }

    return null;
  }

  private looksLikeMermaidStart(text: string): boolean {
    return /^\s*(?:%%[^\n]*\n\s*)*(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?|journey|gantt|pie|mindmap|timeline)\b/im.test(
      text.trim(),
    );
  }

  private buildDeterministicArchitectureDiagram(
    repoName: string,
    fileMap: Map<string, string>,
    deps: string[],
    entryPoints: string[],
  ): string {
    const filePaths = [...fileMap.keys()];

    const toBasename = (p: string) => p.split('/').pop() ?? p;
    const uniqueNames = (paths: string[]) => [
      ...new Set(paths.map((p) => toBasename(p)).filter(Boolean)),
    ];
    const pickByPattern = (patterns: string[], limit: number) =>
      uniqueNames(
        filePaths.filter((p) => {
          const lower = p.toLowerCase();
          return patterns.some((pat) => lower.includes(pat));
        }),
      ).slice(0, limit);

    const entry = uniqueNames(entryPoints).slice(0, 5);
    const api = pickByPattern(
      ['controller', 'route', 'router', 'handler', 'resolver', 'gateway'],
      6,
    );
    const services = pickByPattern(
      ['service', 'usecase', 'manager', 'provider'],
      8,
    );
    const data = pickByPattern(
      ['repository', 'repo', 'entity', 'model', 'schema', 'dao', 'prisma'],
      6,
    );
    const crossCutting = pickByPattern(
      ['middleware', 'guard', 'interceptor', 'pipe', 'filter'],
      5,
    );

    const depSet = new Set(deps.map((d) => d.toLowerCase()));
    const external: string[] = [];
    const hasDep = (...tokens: string[]) =>
      [...depSet].some((d) => tokens.some((t) => d.includes(t)));

    if (
      hasDep(
        'postgres',
        'mysql',
        'sqlite',
        'mariadb',
        'mongoose',
        'mongodb',
        'typeorm',
        'sequelize',
        'prisma',
        'knex',
        'jpa',
      )
    ) {
      external.push('Primary Database');
    }
    if (hasDep('redis', 'memcached')) external.push('Cache');
    if (hasDep('kafka', 'rabbit', 'bull', 'bullmq', 'amqp', 'sqs'))
      external.push('Queue / Jobs');
    if (hasDep('openai', 'cohere', 'anthropic', 'stripe', 'twilio', 'github'))
      external.push('External APIs');

    if (external.length === 0) {
      external.push('External Services');
    }

    let seq = 1;
    const nextId = () => `N${seq++}`;
    const lines: string[] = ['graph TD'];
    const repoNode = nextId();
    lines.push(`  ${repoNode}["${repoName}"]`);

    const addSubgraph = (title: string, labels: string[]) => {
      if (labels.length === 0) return [] as string[];
      const subId = title.replace(/[^a-zA-Z0-9]/g, '');
      lines.push(`  subgraph ${subId}["${title}"]`);
      const ids: string[] = [];
      for (const label of labels) {
        const id = nextId();
        ids.push(id);
        lines.push(`    ${id}["${label.replace(/"/g, "'")}"]`);
      }
      lines.push('  end');
      return ids;
    };

    const entryIds = addSubgraph('Entry Points', entry);
    const crossIds = addSubgraph('Cross-Cutting', crossCutting);
    const apiIds = addSubgraph('API Layer', api);
    const serviceIds = addSubgraph('Service Layer', services);
    const dataIds = addSubgraph('Data Layer', data);
    const extIds = addSubgraph('External Services', external);

    const firstNonEmpty = (...groups: string[][]) =>
      groups.find((g) => g.length > 0) ?? [];

    const firstFlow = firstNonEmpty(
      entryIds,
      apiIds,
      serviceIds,
      dataIds,
      extIds,
    );
    if (firstFlow.length > 0) {
      lines.push(`  ${repoNode} --> ${firstFlow[0]}`);
    }

    for (const id of entryIds) {
      if (crossIds.length > 0) lines.push(`  ${id} --> ${crossIds[0]}`);
      else if (apiIds.length > 0) lines.push(`  ${id} --> ${apiIds[0]}`);
      else if (serviceIds.length > 0)
        lines.push(`  ${id} --> ${serviceIds[0]}`);
    }

    for (const id of crossIds) {
      if (apiIds.length > 0) lines.push(`  ${id} --> ${apiIds[0]}`);
      else if (serviceIds.length > 0)
        lines.push(`  ${id} --> ${serviceIds[0]}`);
    }

    for (let i = 0; i < apiIds.length; i++) {
      if (serviceIds.length > 0) {
        lines.push(
          `  ${apiIds[i]} --> ${serviceIds[Math.min(i, serviceIds.length - 1)]}`,
        );
      }
    }

    for (let i = 0; i < serviceIds.length; i++) {
      if (dataIds.length > 0) {
        lines.push(
          `  ${serviceIds[i]} --> ${dataIds[Math.min(i, dataIds.length - 1)]}`,
        );
      }
      if (extIds.length > 0) {
        lines.push(
          `  ${serviceIds[i]} --> ${extIds[Math.min(i, extIds.length - 1)]}`,
        );
      }
    }

    if (serviceIds.length === 0 && dataIds.length > 0 && extIds.length > 0) {
      lines.push(`  ${dataIds[0]} --> ${extIds[0]}`);
    }

    return lines.join('\n');
  }

  // ── Directory tree (compact) ──────────────────────────────────────────────

  private buildDirectoryTree(fileMap: Map<string, string>): string {
    const dirs = new Map<string, string[]>();
    for (const filePath of fileMap.keys()) {
      const parts = filePath.split('/');
      const dir =
        parts.length > 1
          ? parts.slice(0, Math.min(parts.length - 1, 3)).join('/')
          : '.';
      if (!dirs.has(dir)) dirs.set(dir, []);
      dirs.get(dir)!.push(parts[parts.length - 1]);
    }
    return [...dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, files]) => `  ${dir}/ (${files.length}: ${files.join(', ')})`)
      .join('\n');
  }

  // ── Markdown assembly ─────────────────────────────────────────────────────

  private assembleMarkdown(
    repoName: string,
    summary: string,
    architectureDiagram: string,
  ): string {
    return [
      `# Architecture: ${repoName}`,
      '',
      `> Generated: ${new Date().toISOString()}`,
      '',
      '## Overview',
      summary,
      '',
      '## Architecture Diagram',
      '```mermaid',
      architectureDiagram,
      '```',
    ].join('\n');
  }
}
