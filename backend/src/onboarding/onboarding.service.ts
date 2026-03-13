import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../shared/database.service';
import { VectorstoreService } from '../shared/vectorstore.service';
import { LlmService } from '../shared/llm.service';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private db: DatabaseService,
    private vectorstore: VectorstoreService,
    private llm: LlmService,
  ) {}

  async generate(repoId: string): Promise<{ repoId: string; markdown: string; version: number }> {
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

    // Build file → content map
    const fileMap = new Map<string, string>();
    for (const c of chunks) {
      if (!fileMap.has(c.meta.filePath)) {
        fileMap.set(c.meta.filePath, c.content);
      }
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
        keyFiles.length < 8
      ) {
        keyFiles.push(`### ${fp}\n${content.slice(0, 1200)}`);
      }
    }

    // Also grab entry-point-like files (multi-language)
    const entryPatterns = [
      // JS/TS
      'main.ts', 'main.js', 'index.ts', 'index.js', 'app.ts', 'app.js', 'server.ts', 'server.js',
      // Python
      'main.py', 'app.py', 'manage.py', 'wsgi.py', 'asgi.py', '__main__.py',
      // Java/Kotlin
      'application.java', 'main.java', 'app.java', 'application.kt', 'main.kt',
      // Go
      'main.go', 'cmd/',
      // Rust
      'main.rs', 'lib.rs',
      // C#
      'program.cs', 'startup.cs',
      // Ruby
      'application.rb', 'config.ru',
      // PHP
      'index.php', 'artisan',
    ];
    for (const [fp, content] of fileMap) {
      if (
        entryPatterns.some((p) => fp.toLowerCase().endsWith(p)) &&
        keyFiles.length < 12
      ) {
        keyFiles.push(`### ${fp}\n${content.slice(0, 800)}`);
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
            content: `You are a senior developer writing an onboarding guide for new contributors to the "${repo.name}" repository. Write a practical Markdown guide covering:
1. **Prerequisites** — tools and versions needed
2. **Setup Steps** — how to clone, install dependencies, and run the project locally
3. **Project Structure** — key directories and what they contain
4. **Key Entry Points** — where execution starts, important files to understand first
5. **How to Add Features** — where to add new code, patterns to follow
6. **Testing** — how to run tests, where test files live
7. **Common Gotchas** — things that often trip up newcomers

Keep it concise and practical. Use code blocks for commands.`,
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 1200 },
      );
    } catch (err: any) {
      this.logger.warn('LLM onboarding generation failed', err?.message);
      markdown = `# Onboarding Guide: ${repo.name}\n\nRepository contains ${fileMap.size} files. LLM generation failed — please retry.`;
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

    return { repoId, markdown, version: nextVersion };
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
