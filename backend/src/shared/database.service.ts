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
    `);
  }

  getDb(): Database.Database {
    return this.db;
  }
}
