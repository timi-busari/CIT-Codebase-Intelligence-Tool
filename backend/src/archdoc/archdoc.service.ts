import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
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
    const allData = await this.vectorstore.getAll(repoId);
    const chunks = allData
      ? allData.ids.map((id, i) => ({
          id,
          content: allData.documents[i],
          meta: allData.metadatas[i],
        }))
      : [];

    // Build file → content map (concatenate all chunks per file)
    const fileMap = new Map<string, string>();
    for (const c of chunks) {
      const existing = fileMap.get(c.meta.filePath) ?? '';
      fileMap.set(c.meta.filePath, existing + c.content);
    }

    // 1. Dependency graph
    const dependencyGraph = this.buildDependencyGraph(fileMap);

    // 2. API endpoints
    const apiEndpoints = this.extractApiEndpoints(fileMap);

    // 3. LLM summary
    const summary = await this.generateSummary(
      repo.name,
      fileMap,
      apiEndpoints,
    );

    // 4. Assemble Markdown
    const markdown = this.assembleMarkdown(
      repo.name,
      summary,
      dependencyGraph,
      apiEndpoints,
    );

    const result: ArchDocResult = {
      repoId,
      repoName: repo.name,
      summary,
      dependencyGraph,
      apiEndpoints,
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

  /** Get version history (metadata only) for a repo's architecture docs */
  getHistory(repoId: string): { version: number; generatedAt: number }[] {
    return this.db
      .getDb()
      .prepare(
        `SELECT version, generated_at as generatedAt FROM arch_docs WHERE repo_id = ? ORDER BY version DESC`,
      )
      .all(repoId) as any[];
  }

  /** Get a specific version of an architecture doc */
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

  // ── Dependency graph ──────────────────────────────────────────────────────
  private buildDependencyGraph(fileMap: Map<string, string>): string {
    const edges: string[] = [];

    // Language-specific import patterns
    const importPatterns: {
      ext: string[];
      regex: RegExp;
      relativeOnly: boolean;
    }[] = [
      // JS / TS: import ... from '...', require('...')
      {
        ext: ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'],
        regex: /(?:import|require)\s*(?:.*?\s+from\s*)?['"]([^'"]+)['"]/g,
        relativeOnly: true,
      },
      // Python: import x, from x import y
      {
        ext: ['.py'],
        regex: /^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm,
        relativeOnly: false,
      },
      // Java / Kotlin: import com.example.package
      {
        ext: ['.java', '.kt', '.kts'],
        regex: /^\s*import\s+([\w.]+)/gm,
        relativeOnly: false,
      },
      // Go: import "path" or "path"
      { ext: ['.go'], regex: /"([^"]+)"/g, relativeOnly: false },
      // Rust: use crate::module, mod module
      {
        ext: ['.rs'],
        regex: /(?:use\s+(?:crate|super|self)::([\w:]+)|mod\s+(\w+))/g,
        relativeOnly: false,
      },
      // C#: using Namespace.Sub
      {
        ext: ['.cs'],
        regex: /^\s*using\s+([\w.]+)\s*;/gm,
        relativeOnly: false,
      },
      // PHP: use Namespace\Class
      {
        ext: ['.php'],
        regex:
          /(?:use\s+([\w\\]+)|require(?:_once)?\s+['"]([^'"]+)['"]|include(?:_once)?\s+['"]([^'"]+)['"])/g,
        relativeOnly: false,
      },
      // Ruby: require 'file', require_relative 'file'
      {
        ext: ['.rb'],
        regex: /(?:require(?:_relative)?\s+['"]([^'"]+)['"])/g,
        relativeOnly: false,
      },
    ];

    for (const [filePath, content] of fileMap) {
      const lower = filePath.toLowerCase();
      for (const pattern of importPatterns) {
        if (!pattern.ext.some((e) => lower.endsWith(e))) continue;
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const imported = match[1] || match[2] || match[3];
          if (!imported) continue;
          // For JS/TS, only include relative imports
          if (pattern.relativeOnly && !imported.startsWith('.')) continue;
          // For other langs, skip standard-library / very common imports
          if (
            !pattern.relativeOnly &&
            this.isStdLibImport(imported, pattern.ext[0])
          )
            continue;
          const sourceNode = this.nodeLabel(filePath);
          const targetNode = this.nodeLabel(imported);
          edges.push(`  ${sourceNode} --> ${targetNode}`);
        }
        break; // matched extension, skip remaining patterns
      }
    }

    const uniqueEdges = [...new Set(edges)].slice(0, 60); // limit for readability
    if (uniqueEdges.length === 0) {
      return `graph LR\n  note["No internal imports found"]`;
    }
    return `graph LR\n${uniqueEdges.join('\n')}`;
  }

  private isStdLibImport(imported: string, ext: string): boolean {
    switch (ext) {
      case '.py':
        return [
          'os',
          'sys',
          'json',
          'typing',
          're',
          'datetime',
          'logging',
          'collections',
          'abc',
          'functools',
          'pathlib',
          'io',
          'math',
          'unittest',
          'dataclasses',
          'enum',
          'copy',
          'uuid',
          'hashlib',
          'time',
          'traceback',
          'contextlib',
          'itertools',
          'operator',
          '__future__',
        ].includes(imported.split('.')[0]);
      case '.java':
        return (
          imported.startsWith('java.') ||
          imported.startsWith('javax.') ||
          imported.startsWith('sun.')
        );
      case '.go':
        return !imported.includes('.'); // Go stdlib has no dots (e.g. "fmt", "net/http")
      case '.cs':
        return imported.startsWith('System.');
      default:
        return false;
    }
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

    for (const [filePath, content] of fileMap) {
      const lower = filePath.toLowerCase();

      // ── JS / TS: NestJS decorators ──
      if (lower.endsWith('.ts') || lower.endsWith('.js')) {
        const decoratorRegex =
          /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*(?:['`"]([^'`"]*?)['`"])?\s*\)/g;
        const controllerRegex =
          /@Controller\s*\(\s*(?:['`"]([^'`"]*?)['`"])?\s*\)/;
        const controllerMatch = controllerRegex.exec(content);
        const baseRoute = controllerMatch ? `/${controllerMatch[1] ?? ''}` : '';
        let match: RegExpExecArray | null;
        while ((match = decoratorRegex.exec(content)) !== null) {
          endpoints.push({
            method: match[1].toUpperCase(),
            path: `${baseRoute}/${match[2] ?? ''}`.replace(/\/+/g, '/') || '/',
            file: filePath,
          });
        }

        // Express-style: app.get('/path', ...) or router.get('/path', ...)
        const expressRegex =
          /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
        while ((match = expressRegex.exec(content)) !== null) {
          endpoints.push({
            method: match[1].toUpperCase(),
            path: match[2],
            file: filePath,
          });
        }

        // Next.js App Router
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

      // ── Java / Kotlin: Spring Boot annotations ──
      if (lower.endsWith('.java') || lower.endsWith('.kt')) {
        const mappingRegex =
          /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?(?:['"]([^'"]*?)['"])?/g;
        const classMapping =
          /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*?)['"]/;
        const classMatch = classMapping.exec(content);
        const basePath = classMatch ? classMatch[1] : '';
        let match: RegExpExecArray | null;
        while ((match = mappingRegex.exec(content)) !== null) {
          const decorator = match[1];
          const method =
            decorator === 'RequestMapping'
              ? 'GET'
              : decorator.replace('Mapping', '').toUpperCase();
          const path =
            `${basePath}/${match[2] ?? ''}`.replace(/\/+/g, '/') || '/';
          endpoints.push({ method, path, file: filePath });
        }

        // JAX-RS: @GET @Path("/...") or @Path on class
        const jaxRsRegex = /@(GET|POST|PUT|PATCH|DELETE)\b/g;
        const pathRegex = /@Path\s*\(\s*['"]([^'"]*?)['"]/;
        const jaxClassPath = pathRegex.exec(content);
        const jaxBase = jaxClassPath ? jaxClassPath[1] : '';
        while ((match = jaxRsRegex.exec(content)) !== null) {
          endpoints.push({
            method: match[1],
            path: jaxBase || '/',
            file: filePath,
          });
        }
      }

      // ── Python: Flask / FastAPI / Django ──
      if (lower.endsWith('.py')) {
        // Flask: @app.route('/path', methods=['GET']) or @app.get('/path')
        // FastAPI: @app.get('/path') / @router.get('/path')
        const pyRouteRegex =
          /(?:@\w+\.(?:route\s*\(\s*['"]([^'"]+)['"]\s*,\s*methods\s*=\s*\[([^\]]+)\])|@\w+\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"])/g;
        let match: RegExpExecArray | null;
        while ((match = pyRouteRegex.exec(content)) !== null) {
          if (match[1]) {
            // @app.route('/path', methods=['GET', 'POST'])
            const methods = match[2]
              .replace(/['"]\s*/g, '')
              .split(',')
              .map((m) => m.trim().toUpperCase());
            for (const m of methods) {
              endpoints.push({ method: m, path: match[1], file: filePath });
            }
          } else if (match[3]) {
            // @app.get('/path')
            endpoints.push({
              method: match[3].toUpperCase(),
              path: match[4],
              file: filePath,
            });
          }
        }

        // Django urls.py: path('route/', view)
        const djangoRegex = /path\s*\(\s*['"]([^'"]+)['"]/g;
        if (lower.includes('urls')) {
          while ((match = djangoRegex.exec(content)) !== null) {
            endpoints.push({
              method: 'ANY',
              path: `/${match[1]}`,
              file: filePath,
            });
          }
        }
      }

      // ── Go: net/http, Gin, Echo, Chi ──
      if (lower.endsWith('.go')) {
        // http.HandleFunc / mux.HandleFunc
        const goHttpRegex = /(?:HandleFunc|Handle)\s*\(\s*"([^"]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = goHttpRegex.exec(content)) !== null) {
          endpoints.push({ method: 'ANY', path: match[1], file: filePath });
        }
        // Gin / Echo: r.GET("/path", ...) or e.GET("/path", ...)
        const ginRegex = /\.(GET|POST|PUT|PATCH|DELETE)\s*\(\s*"([^"]+)"/g;
        while ((match = ginRegex.exec(content)) !== null) {
          endpoints.push({ method: match[1], path: match[2], file: filePath });
        }
      }

      // ── C#: ASP.NET [HttpGet("/path")] or [Route("/path")] ──
      if (lower.endsWith('.cs')) {
        const aspRegex =
          /\[(Http(Get|Post|Put|Patch|Delete))\s*(?:\(\s*"([^"]*)")?/g;
        let match: RegExpExecArray | null;
        const routeAttr = /\[Route\s*\(\s*"([^"]*)"/;
        const routeMatch = routeAttr.exec(content);
        const aspBase = routeMatch ? routeMatch[1] : '';
        while ((match = aspRegex.exec(content)) !== null) {
          const path =
            `${aspBase}/${match[3] ?? ''}`.replace(/\/+/g, '/') || '/';
          endpoints.push({
            method: match[2].toUpperCase(),
            path,
            file: filePath,
          });
        }
      }

      // ── Ruby: Rails routes.rb ──
      if (
        lower.endsWith('.rb') &&
        (lower.includes('routes') || lower.includes('controller'))
      ) {
        const railsRegex = /(?:get|post|put|patch|delete)\s+['"]([^'"]+)['"]/g;
        let match: RegExpExecArray | null;
        while ((match = railsRegex.exec(content)) !== null) {
          const method = content
            .slice(match.index, match.index + 6)
            .trim()
            .toUpperCase();
          endpoints.push({ method, path: match[1], file: filePath });
        }
        // resources :name
        const resourceRegex = /resources?\s+:([\w]+)/g;
        while ((match = resourceRegex.exec(content)) !== null) {
          endpoints.push({
            method: 'CRUD',
            path: `/${match[1]}`,
            file: filePath,
          });
        }
      }

      // ── PHP: Laravel routes ──
      if (lower.endsWith('.php')) {
        const laravelRegex =
          /Route::(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;
        let match: RegExpExecArray | null;
        while ((match = laravelRegex.exec(content)) !== null) {
          endpoints.push({
            method: match[1].toUpperCase(),
            path: match[2],
            file: filePath,
          });
        }
      }
    }

    return endpoints;
  }

  // ── LLM summary ──────────────────────────────────────────────────────────
  private async generateSummary(
    repoName: string,
    fileMap: Map<string, string>,
    endpoints: ApiEndpoint[],
  ): Promise<string> {
    // Broader key-file patterns covering configs, models, routes, services for many languages
    const highPriority = [
      'readme',
      // JS/TS
      'package.json',
      // Python
      'requirements.txt',
      'pyproject.toml',
      'setup.py',
      'pipfile',
      // Java/Kotlin
      'pom.xml',
      'build.gradle',
      // Go
      'go.mod',
      // Rust
      'cargo.toml',
      // C#
      '.csproj',
      '.sln',
      // Ruby
      'gemfile',
      // PHP
      'composer.json',
      // General
      'docker',
      'makefile',
      '.env.example',
    ];
    const medPriority = [
      // Common patterns
      'index',
      'main',
      'app',
      'server',
      'config',
      'route',
      'controller',
      'service',
      'model',
      'schema',
      'entity',
      'middleware',
      'module',
      // Python
      'views',
      'urls',
      'serializer',
      'manage.py',
      'wsgi',
      'asgi',
      'settings',
      // Java
      'application',
      'repository',
      'dto',
      'mapper',
      // Go
      'handler',
      'cmd/',
      'internal/',
      // Ruby
      'gemspec',
      'rakefile',
    ];

    const highFiles: string[] = [];
    const medFiles: string[] = [];
    for (const [fp, content] of fileMap) {
      const lower = fp.toLowerCase();
      if (highPriority.some((p) => lower.includes(p)) && highFiles.length < 5) {
        highFiles.push(`### ${fp}\n${content.slice(0, 1500)}`);
      } else if (
        medPriority.some((p) => lower.includes(p)) &&
        medFiles.length < 10
      ) {
        medFiles.push(`### ${fp}\n${content.slice(0, 1200)}`);
      }
    }

    // Build a file tree listing for project-structure awareness
    const fileList = [...fileMap.keys()]
      .sort()
      .map((f) => `  ${f}`)
      .join('\n');

    // Encode structured data as TOON to reduce prompt tokens
    const endpointsToon = await toonEncode(endpoints.slice(0, 30));

    const prompt = [
      `Repository: ${repoName}`,
      `Total files: ${fileMap.size}`,
      '',
      'File listing:',
      fileList,
      '',
      `API endpoints (${endpoints.length}):`,
      '```toon',
      endpointsToon,
      '```',
      '',
      'High-priority file contents:',
      highFiles.join('\n\n'),
      '',
      'Additional source files:',
      medFiles.join('\n\n'),
    ].join('\n');

    try {
      return await this.llm.chat(
        [
          {
            role: 'system',
            content: [
              'You are a senior software architect. Write a concise, well-detailed high-level architecture summary of the given repository for a new developer.',
              'Cover: purpose, tech stack, key modules, data flow, and entry points.',
              '',
              'IMPORTANT RULES:',
              '- ONLY describe what you can directly verify from the provided code, file names, and endpoints.',
              '- DO NOT invent, assume, or guess features, libraries, or patterns that are not visible in the provided context.',
              '- If you are unsure about something, omit it rather than guessing.',
              '- Base your tech stack list strictly on imports, dependencies in package.json, and file extensions you can see.',
            ].join('\n'),
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.1, maxTokens: 1500 },
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
    ].join('\n');
  }
}
