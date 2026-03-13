import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../shared/database.service';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(private db: DatabaseService) {}

  // ── Conversations ─────────────────────────────────────────────────────────
  listConversations(search?: string, repoId?: string): any[] {
    if (search?.trim()) {
      const rows = this.db
        .getDb()
        .prepare(
          `
        SELECT c.* FROM conversations c
        JOIN conversations_fts fts ON fts.id = c.id
        WHERE conversations_fts MATCH ?
        ORDER BY c.updated_at DESC
      `,
        )
        .all(`"${search.replace(/"/g, '""')}"`);
      const parsed = rows.map(this.parseConversation);
      if (repoId) return parsed.filter((c: any) => c.repo_ids.includes(repoId));
      return parsed;
    }
    const rows = this.db
      .getDb()
      .prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`)
      .all();
    const parsed = rows.map(this.parseConversation);
    if (repoId) return parsed.filter((c: any) => c.repo_ids.includes(repoId));
    return parsed;
  }

  createConversation(dto: {
    title?: string;
    repoIds?: string[];
    messages?: any[];
  }): any {
    const id = randomUUID();
    const now = Date.now();
    const title = dto.title || 'New Conversation';
    const repoIds = JSON.stringify(dto.repoIds ?? []);
    const messages = JSON.stringify(dto.messages ?? []);
    this.db
      .getDb()
      .prepare(
        `
      INSERT INTO conversations (id, title, repo_ids, messages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(id, title, repoIds, messages, now, now);
    return this.getConversation(id);
  }

  getConversation(id: string): any {
    const row = this.db
      .getDb()
      .prepare(`SELECT * FROM conversations WHERE id=?`)
      .get(id);
    if (!row) throw new NotFoundException(`Conversation ${id} not found`);
    return this.parseConversation(row);
  }

  updateConversation(
    id: string,
    dto: { title?: string; messages?: any[] },
  ): any {
    this.getConversation(id); // validate
    const updates: string[] = [];
    const params: any[] = [];
    if (dto.title !== undefined) {
      updates.push('title=?');
      params.push(dto.title);
    }
    if (dto.messages !== undefined) {
      updates.push('messages=?');
      params.push(JSON.stringify(dto.messages));
    }
    updates.push('updated_at=?');
    params.push(Date.now());
    params.push(id);
    this.db
      .getDb()
      .prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id=?`)
      .run(...params);
    return this.getConversation(id);
  }

  deleteConversation(id: string): void {
    this.db.getDb().prepare(`DELETE FROM conversations WHERE id=?`).run(id);
  }

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  listBookmarks(tag?: string): any[] {
    if (tag) {
      const rows = this.db
        .getDb()
        .prepare(
          `SELECT * FROM bookmarks WHERE tags LIKE ? ORDER BY created_at DESC`,
        )
        .all(`%"${tag}"%`);
      return rows.map(this.parseBookmark);
    }
    const rows = this.db
      .getDb()
      .prepare(`SELECT * FROM bookmarks ORDER BY created_at DESC`)
      .all();
    return rows.map(this.parseBookmark);
  }

  createBookmark(dto: {
    conversationId?: string;
    question: string;
    answer: string;
    sources?: any[];
    repoIds?: string[];
    tags?: string[];
  }): any {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .getDb()
      .prepare(
        `
      INSERT INTO bookmarks (id, conversation_id, question, answer, sources, repo_ids, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        dto.conversationId ?? null,
        dto.question,
        dto.answer,
        JSON.stringify(dto.sources ?? []),
        JSON.stringify(dto.repoIds ?? []),
        JSON.stringify(dto.tags ?? []),
        now,
      );
    return this.getBookmark(id);
  }

  deleteBookmark(id: string): void {
    this.db.getDb().prepare(`DELETE FROM bookmarks WHERE id=?`).run(id);
  }

  searchBookmarks(query: string): any[] {
    const rows = this.db
      .getDb()
      .prepare(
        `SELECT b.* FROM bookmarks b
         JOIN bookmarks_fts fts ON fts.id = b.id
         WHERE bookmarks_fts MATCH ?
         ORDER BY b.created_at DESC`,
      )
      .all(`"${query.replace(/"/g, '""')}"`);
    return rows.map(this.parseBookmark);
  }

  private getBookmark(id: string): any {
    const row = this.db
      .getDb()
      .prepare(`SELECT * FROM bookmarks WHERE id=?`)
      .get(id);
    if (!row) throw new NotFoundException(`Bookmark ${id} not found`);
    return this.parseBookmark(row);
  }

  private parseConversation = (row: any) => ({
    ...row,
    repo_ids: JSON.parse(row.repo_ids ?? '[]'),
    messages: JSON.parse(row.messages ?? '[]'),
  });

  private parseBookmark = (row: any) => ({
    ...row,
    sources: JSON.parse(row.sources ?? '[]'),
    repo_ids: JSON.parse(row.repo_ids ?? '[]'),
    tags: JSON.parse(row.tags ?? '[]'),
  });
}
