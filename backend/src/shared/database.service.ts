import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);
  private db: Database.Database;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const dbPath = this.config.get<string>(
      'DB_PATH',
      path.join(process.cwd(), 'data', 'cit.db'),
    );
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.runMigrations();
    this.logger.log(`SQLite database initialised at ${dbPath}`);
  }

  private runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        chunk_count INTEGER DEFAULT 0,
        file_count INTEGER DEFAULT 0,
        webhook_secret TEXT,
        last_synced_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        repo_ids TEXT NOT NULL DEFAULT '[]',
        messages TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        sources TEXT NOT NULL DEFAULT '[]',
        repo_ids TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
        id UNINDEXED,
        title,
        messages,
        content=conversations,
        content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
        INSERT INTO conversations_fts(rowid, id, title, messages)
        VALUES (new.rowid, new.id, new.title, new.messages);
      END;

      CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
        INSERT INTO conversations_fts(conversations_fts, rowid, id, title, messages)
        VALUES ('delete', old.rowid, old.id, old.title, old.messages);
        INSERT INTO conversations_fts(rowid, id, title, messages)
        VALUES (new.rowid, new.id, new.title, new.messages);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
        id UNINDEXED,
        question,
        answer,
        tags,
        content=bookmarks,
        content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS bookmarks_ai AFTER INSERT ON bookmarks BEGIN
        INSERT INTO bookmarks_fts(rowid, id, question, answer, tags)
        VALUES (new.rowid, new.id, new.question, new.answer, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS bookmarks_au AFTER UPDATE ON bookmarks BEGIN
        INSERT INTO bookmarks_fts(bookmarks_fts, rowid, id, question, answer, tags)
        VALUES ('delete', old.rowid, old.id, old.question, old.answer, old.tags);
        INSERT INTO bookmarks_fts(rowid, id, question, answer, tags)
        VALUES (new.rowid, new.id, new.question, new.answer, new.tags);
      END;

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        total_files INTEGER NOT NULL DEFAULT 0,
        processed_files INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS arch_docs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        generated_at INTEGER NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS onboarding_docs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        generated_at INTEGER NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pr_analyses (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        pr_url TEXT,
        summary TEXT NOT NULL,
        files_changed TEXT NOT NULL DEFAULT '[]',
        risks TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS file_metrics (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        loc INTEGER NOT NULL DEFAULT 0,
        function_count INTEGER NOT NULL DEFAULT 0,
        avg_function_length REAL NOT NULL DEFAULT 0,
        cyclomatic_complexity REAL NOT NULL DEFAULT 0,
        todo_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_file_metrics_repo_path ON file_metrics(repo_id, file_path);
    `);

    // Safe migrations for existing databases
    this.safeAddColumn('repos', 'webhook_secret', 'TEXT');
    this.safeAddColumn('repos', 'last_synced_at', 'INTEGER');
  }

  private safeAddColumn(table: string, column: string, type: string) {
    try {
      const cols = this.db.pragma(`table_info(${table})`) as any[];
      if (!cols.some((c: any) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    } catch {
      // ignore if table doesn't exist yet
    }
  }

  getDb(): Database.Database {
    return this.db;
  }
}
