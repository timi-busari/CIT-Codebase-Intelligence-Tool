import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../shared/database.service';
import { VectorstoreService } from '../shared/vectorstore.service';
import { LlmService } from '../shared/llm.service';
import { extractApiEndpoints, ApiEndpoint } from '../shared/api-endpoints';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private db: DatabaseService,
    private vectorstore: VectorstoreService,
    private llm: LlmService,
  ) {}

  async generate(repoId: string): Promise<{
    repoId: string;
    markdown: string;
    version: number;
    apiEndpoints: ApiEndpoint[];
  }> {
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
      const fp = c.meta.filePath;
      fileMap.set(fp, (fileMap.get(fp) || '') + '\n' + c.content);
    }

    // Identify key onboarding files
    const keyPatterns = [
      'readme',
      'contributing',
      // JS/TS
      'package.json',
      'tsconfig',
      'jest.config',
      // Python
      'pyproject.toml',
      'setup.py',
      'requirements.txt',
      'pipfile',
      'tox.ini',
      'setup.cfg',
      // Java/Kotlin
      'pom.xml',
      'build.gradle',
      'settings.gradle',
      // Go
      'go.mod',
      // Rust
      'cargo.toml',
      // Ruby
      'gemfile',
      'rakefile',
      // PHP
      'composer.json',
      // C#
      '.csproj',
      '.sln',
      // General
      'makefile',
      'dockerfile',
      'docker-compose',
      '.github/workflows',
      '.env.example',
    ];

    const keyFiles: string[] = [];
    for (const [fp, content] of fileMap) {
      if (
        keyPatterns.some((p) => fp.toLowerCase().includes(p)) &&
        keyFiles.length < 15
      ) {
        keyFiles.push(`### ${fp}\n${content.slice(0, 2500)}`);
      }
    }

    // Also grab entry-point-like files (multi-language)
    const entryPatterns = [
      // JS/TS
      'main.ts',
      'main.js',
      'index.ts',
      'index.js',
      'app.ts',
      'app.js',
      'server.ts',
      'server.js',
      // Python
      'main.py',
      'app.py',
      'manage.py',
      'wsgi.py',
      'asgi.py',
      '__main__.py',
      // Java/Kotlin
      'application.java',
      'main.java',
      'app.java',
      'application.kt',
      'main.kt',
      // Go
      'main.go',
      'cmd/',
      // Rust
      'main.rs',
      'lib.rs',
      // C#
      'program.cs',
      'startup.cs',
      // Ruby
      'application.rb',
      'config.ru',
      // PHP
      'index.php',
      'artisan',
    ];
    for (const [fp, content] of fileMap) {
      if (
        entryPatterns.some((p) => fp.toLowerCase().endsWith(p)) &&
        keyFiles.length < 20
      ) {
        keyFiles.push(`### ${fp}\n${content.slice(0, 1500)}`);
      }
    }

    const prompt = [
      `Repository: ${repo.name}`,
      `Total files: ${fileMap.size}`,
      '',
      'Key file contents:',
      keyFiles.join('\n\n'),
    ].join('\n');

    let markdown: string;
    try {
      markdown = await this.llm.chat(
        [
          {
            role: 'system',
            content: [
              `You are a senior developer writing a comprehensive onboarding guide for new contributors to the "${repo.name}" repository.`,
              'Write a detailed, practical Markdown guide with the following sections:',
              '',
              '## Prerequisites',
              'List every tool, runtime, and version needed. Include system-level dependencies (databases, message queues, etc.).',
              'Provide install commands for macOS, Linux, and Windows where applicable.',
              '',
              '## Setup Steps',
              'Step-by-step instructions from `git clone` to a running local environment.',
              'Include database migrations, seed data, environment variable setup, and any Docker services.',
              'Show exact commands in code blocks.',
              '',
              '## Project Structure',
              'Walk through every major directory and explain what it owns, what patterns it follows, and how it connects to other parts.',
              '',
              '## Key Entry Points',
              'Identify the main bootstrap file, route registration, middleware chains, and startup hooks.',
              'Explain the request lifecycle from incoming request to response.',
              '',
              '## How to Add Features',
              'Provide a step-by-step checklist for adding a new feature (e.g., a new API endpoint or UI page).',
              'Name the directories, files to create, and any boilerplate/scaffolding commands.',
              '',
              '## Testing',
              'How to run unit, integration, and e2e tests. Where test files live. Coverage requirements.',
              'Include exact `npm test` / `pytest` / etc. commands.',
              '',
              '## Common Gotchas',
              'List specific issues that trip up newcomers — tricky env vars, port conflicts, build order dependencies, etc.',
              '',
              'IMPORTANT: Only describe what you can verify from the provided code. Do not invent features or tools not visible in the context.',
            ].join('\n'),
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 5000 },
      );
    } catch (err: any) {
      this.logger.warn('LLM onboarding generation failed', err?.message);
      markdown = `# Onboarding Guide: ${repo.name}\n\nRepository contains ${fileMap.size} files. LLM generation failed — please retry.`;
    }

    // Extract API endpoints
    const apiEndpoints = extractApiEndpoints(fileMap);

    // Append endpoint table to markdown if endpoints found
    if (apiEndpoints.length > 0) {
      markdown += '\n\n## API Endpoints\n\n';
      markdown += '| Method | Path | File |\n|--------|------|------|\n';
      for (const ep of apiEndpoints) {
        markdown += `| \`${ep.method}\` | \`${ep.path}\` | \`${ep.file}\` |\n`;
      }
    }

    // Persist versioned doc
    const lastVersion = this.db
      .getDb()
      .prepare(
        `SELECT COALESCE(MAX(version), 0) AS v FROM onboarding_docs WHERE repo_id = ?`,
      )
      .get(repoId) as any;
    const nextVersion = (lastVersion?.v ?? 0) + 1;
    this.db
      .getDb()
      .prepare(
        `INSERT INTO onboarding_docs (id, repo_id, content, version, generated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), repoId, markdown, nextVersion, Date.now());

    return { repoId, markdown, version: nextVersion, apiEndpoints };
  }

  getHistory(repoId: string): { version: number; generatedAt: number }[] {
    return this.db
      .getDb()
      .prepare(
        `SELECT version, generated_at as generatedAt FROM onboarding_docs WHERE repo_id = ? ORDER BY version DESC`,
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
        `SELECT version, content, generated_at as generatedAt FROM onboarding_docs WHERE repo_id = ? AND version = ?`,
      )
      .get(repoId, version) as any;
    if (!row)
      throw new NotFoundException(
        `Onboarding doc version ${version} not found for repo ${repoId}`,
      );
    return row;
  }
}

// import { Injectable, Logger, NotFoundException } from '@nestjs/common';
// import { randomUUID } from 'crypto';
// import { DatabaseService } from '../shared/database.service';
// import { VectorstoreService } from '../shared/vectorstore.service';
// import { LlmService } from '../shared/llm.service';

// @Injectable()
// export class OnboardingService {
//   private readonly logger = new Logger(OnboardingService.name);

//   constructor(
//     private db: DatabaseService,
//     private vectorstore: VectorstoreService,
//     private llm: LlmService,
//   ) {}

//   async generate(
//     repoId: string,
//   ): Promise<{ repoId: string; markdown: string; version: number }> {
//     const repo = this.db
//       .getDb()
//       .prepare(`SELECT * FROM repos WHERE id=?`)
//       .get(repoId) as any;
//     if (!repo) throw new NotFoundException(`Repo ${repoId} not found`);

//     const allData = await this.vectorstore.getAll(repoId);
//     const chunks = allData
//       ? allData.ids.map((id, i) => ({
//           id,
//           content: allData.documents[i],
//           meta: allData.metadatas[i],
//         }))
//       : [];

//     // ── FIX 1: full file reconstruction from all chunks ────────────────────
//     // Old: `if (!fileMap.has(c.meta.filePath))` — kept the FIRST chunk only.
//     // For a typical service file split into 3-4 chunks, this meant 60-75% of
//     // the file content was silently dropped before the LLM ever saw it.
//     // Setup steps, environment variables, and key configuration that appear
//     // mid-file were completely invisible to the onboarding generator.
//     const fileChunks = new Map<
//       string,
//       { content: string; startLine: number }[]
//     >();
//     for (const c of chunks) {
//       if (!fileChunks.has(c.meta.filePath)) fileChunks.set(c.meta.filePath, []);
//       fileChunks.get(c.meta.filePath)!.push({
//         content: c.content,
//         startLine: c.meta.startLine ?? 0,
//       });
//     }

//     const fileMap = new Map<string, string>();
//     for (const [filePath, parts] of fileChunks) {
//       const ordered = parts.sort((a, b) => a.startLine - b.startLine);
//       fileMap.set(filePath, ordered.map((p) => p.content).join('\n'));
//     }

//     // ── Key config files ───────────────────────────────────────────────────
//     const keyPatterns = [
//       'readme',
//       'contributing',
//       'changelog',
//       'package.json',
//       'tsconfig',
//       'jest.config',
//       '.eslintrc',
//       '.prettierrc',
//       'pyproject.toml',
//       'setup.py',
//       'requirements.txt',
//       'pipfile',
//       'tox.ini',
//       'setup.cfg',
//       'pom.xml',
//       'build.gradle',
//       'settings.gradle',
//       'go.mod',
//       'go.sum',
//       'cargo.toml',
//       'gemfile',
//       'rakefile',
//       'composer.json',
//       '.csproj',
//       '.sln',
//       'makefile',
//       'dockerfile',
//       'docker-compose',
//       '.github/workflows',
//       '.gitlab-ci',
//       '.env.example',
//       '.env.sample',
//     ];

//     const entryPatterns = [
//       'main.ts',
//       'main.js',
//       'index.ts',
//       'index.js',
//       'app.ts',
//       'app.js',
//       'server.ts',
//       'server.js',
//       'main.py',
//       'app.py',
//       'manage.py',
//       'wsgi.py',
//       'asgi.py',
//       '__main__.py',
//       'application.java',
//       'main.java',
//       'app.java',
//       'application.kt',
//       'main.kt',
//       'main.go',
//       'main.rs',
//       'lib.rs',
//       'program.cs',
//       'startup.cs',
//       'application.rb',
//       'config.ru',
//       'index.php',
//       'artisan',
//     ];

//     // ── FIX 2: content window size ────────────────────────────────────────
//     // Old: slice(0, 1200) — often cut off the most important parts of config
//     // files (e.g., scripts section of package.json, env var list in .env.example).
//     // 2500 chars gives enough room to see the full content of most config files.
//     const keyFiles: {
//       path: string;
//       content: string;
//       priority: 'high' | 'medium';
//     }[] = [];

//     for (const [fp, content] of fileMap) {
//       const lower = fp.toLowerCase();
//       if (keyPatterns.some((p) => lower.includes(p)) && keyFiles.length < 10) {
//         keyFiles.push({
//           path: fp,
//           content: content.slice(0, 2500),
//           priority: 'high',
//         });
//       }
//     }
//     for (const [fp, content] of fileMap) {
//       const lower = fp.toLowerCase();
//       if (
//         entryPatterns.some((p) => lower.endsWith(p)) &&
//         !keyFiles.find((k) => k.path === fp) &&
//         keyFiles.length < 16
//       ) {
//         keyFiles.push({
//           path: fp,
//           content: content.slice(0, 1800),
//           priority: 'medium',
//         });
//       }
//     }

//     // ── FIX 3: include test file examples so the LLM can describe test patterns
//     const testFiles: { path: string; content: string }[] = [];
//     const testPatterns = [
//       '.spec.ts',
//       '.test.ts',
//       '.spec.js',
//       '.test.js',
//       '_test.go',
//       '_test.py',
//       'test_',
//     ];
//     for (const [fp, content] of fileMap) {
//       if (
//         testPatterns.some((p) => fp.toLowerCase().includes(p)) &&
//         testFiles.length < 3
//       ) {
//         testFiles.push({ path: fp, content: content.slice(0, 1000) });
//       }
//     }

//     // File tree
//     const fileTree = [...fileMap.keys()]
//       .sort()
//       .map((f) => `  ${f}`)
//       .join('\n');

//     const keyFilesText = keyFiles
//       .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
//       .join('\n\n');

//     const testFilesText =
//       testFiles.length > 0
//         ? testFiles
//             .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
//             .join('\n\n')
//         : '_No test files found_';

//     const prompt = [
//       `Repository: ${repo.name}`,
//       `Total files ingested: ${fileMap.size}`,
//       '',
//       '## File tree',
//       fileTree,
//       '',
//       '## Key configuration and entry-point files',
//       keyFilesText,
//       '',
//       '## Test file examples',
//       testFilesText,
//     ].join('\n');

//     // ── FIX 4: enterprise-grade onboarding system prompt ──────────────────
//     // Old prompt: listed 7 sections but gave no depth guidance, no quality bar,
//     // and no instruction on specificity. LLM produced generic boilerplate.
//     // E.g. "Install dependencies with npm install" with no mention of which
//     // specific scripts exist, what env vars are needed, or what port to use.
//     //
//     // New prompt: mandates specificity, forbids generic statements, and
//     // requires concrete commands extracted from the actual files.
//     const systemPrompt = [
//       `You are a senior engineer who has been working on the "${repo.name}" repository for two years.`,
//       `You are writing a practical onboarding guide for a new engineer joining the team today.`,
//       `The guide must be specific to THIS codebase — no generic advice. Every instruction must reference`,
//       `actual file names, actual script names from package.json/Makefile, actual env var names,`,
//       `and actual test commands visible in the provided files.`,
//       '',
//       'Write a comprehensive Markdown onboarding guide covering ALL of the following sections:',
//       '',
//       '## 1. Prerequisites',
//       'List the EXACT tools and versions required. Extract versions from package.json engines field,',
//       '.nvmrc, .tool-versions, or runtime config files. Include: Node.js/Python/Go/Java version,',
//       'package manager, Docker if needed, database tools, and any CLIs.',
//       '',
//       '## 2. First-Time Setup',
//       'Step-by-step commands to get the project running from a fresh clone.',
//       'Use the ACTUAL script names from package.json/Makefile/README — do not write generic "npm install".',
//       'Include: clone, dependency install, env file setup (list every required env var from .env.example),',
//       'database setup/migration commands, and the exact command to start the dev server.',
//       'Wrap ALL commands in ```bash code blocks.',
//       '',
//       '## 3. Project Structure',
//       'Describe every top-level directory and what it contains.',
//       'Be specific: "src/auth/ — contains the JWT authentication service (auth.service.ts),',
//       'the login/register controllers (auth.controller.ts), and the user entity (user.entity.ts)".',
//       'Not: "src/ — contains the source code".',
//       '',
//       '## 4. Key Entry Points & Important Files',
//       'List the 5-10 most important files a new developer must understand first.',
//       'For each file: its path, what it does, and why it matters.',
//       '',
//       '## 5. Development Workflow',
//       'How to make a change: where to add new features, what patterns to follow,',
//       'how to create a new module/endpoint/component using the conventions already in the codebase.',
//       'Reference actual existing examples by file path.',
//       '',
//       '## 6. Testing',
//       'Exact commands to run the full test suite, unit tests, and integration tests separately.',
//       'Where test files live. What testing library is used. How to write a new test',
//       '(show the pattern from an existing test file).',
//       '',
//       '## 7. Common Gotchas & Debugging',
//       'Things that are non-obvious or frequently trip up new developers in THIS codebase specifically.',
//       'E.g. required env vars that are easy to miss, port conflicts, DB migration steps,',
//       'build steps that must run before dev server, known flaky tests.',
//       '',
//       '## 8. Deployment & CI',
//       'How the project is built for production. CI pipeline summary if visible from workflow files.',
//       'Key environment differences between dev and prod if visible.',
//       '',
//       'RULES:',
//       '- Never write a step like "configure your environment" without listing the specific variables.',
//       '- Never say "run the tests" without the exact command.',
//       '- If a section cannot be populated from the available context, write: "Not determinable from available files — check with the team."',
//       '- Use `backticks` for all file paths, command names, and env var names.',
//       '- Use ```bash code blocks for all terminal commands.',
//     ].join('\n');

//     let markdown: string;
//     try {
//       markdown = await this.llm.chat(
//         [
//           { role: 'system', content: systemPrompt },
//           { role: 'user', content: prompt },
//         ],
//         // ── FIX 5: token budget ────────────────────────────────────────────
//         // Old: 1200 tokens — a real 8-section onboarding doc with commands,
//         // file paths, and explanations needs at minimum 2500 tokens.
//         // 1200 reliably cut off at section 4 or 5.
//         { temperature: 0.2, maxTokens: 3000 },
//       );
//     } catch (err: any) {
//       this.logger.warn('LLM onboarding generation failed', err?.message);
//       markdown = `# Onboarding Guide: ${repo.name}\n\nRepository contains ${fileMap.size} files. LLM generation failed — please retry.`;
//     }

//     // Persist versioned doc
//     const lastVersion = this.db
//       .getDb()
//       .prepare(
//         `SELECT COALESCE(MAX(version), 0) AS v FROM onboarding_docs WHERE repo_id = ?`,
//       )
//       .get(repoId) as any;
//     const nextVersion = (lastVersion?.v ?? 0) + 1;
//     this.db
//       .getDb()
//       .prepare(
//         `INSERT INTO onboarding_docs (id, repo_id, content, version, generated_at) VALUES (?, ?, ?, ?, ?)`,
//       )
//       .run(randomUUID(), repoId, markdown, nextVersion, Date.now());

//     return { repoId, markdown, version: nextVersion };
//   }

//   getHistory(repoId: string): { version: number; generatedAt: number }[] {
//     return this.db
//       .getDb()
//       .prepare(
//         `SELECT version, generated_at as generatedAt FROM onboarding_docs WHERE repo_id = ? ORDER BY version DESC`,
//       )
//       .all(repoId) as any[];
//   }

//   getVersion(
//     repoId: string,
//     version: number,
//   ): { version: number; content: string; generatedAt: number } {
//     const row = this.db
//       .getDb()
//       .prepare(
//         `SELECT version, content, generated_at as generatedAt FROM onboarding_docs WHERE repo_id = ? AND version = ?`,
//       )
//       .get(repoId, version) as any;
//     if (!row)
//       throw new NotFoundException(
//         `Onboarding doc version ${version} not found for repo ${repoId}`,
//       );
//     return row;
//   }
// }
