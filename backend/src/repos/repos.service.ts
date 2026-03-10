import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';
import { VectorstoreService } from '../shared/vectorstore.service';

export interface RepoRecord {
  id: string;
  url: string;
  name: string;
  status: string;
  chunk_count: number;
  file_count: number;
  created_at: number;
  updated_at: number;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);

  constructor(
    private db: DatabaseService,
    private vectorstore: VectorstoreService,
  ) {}

  listRepos(): RepoRecord[] {
    return this.db
      .getDb()
      .prepare(`SELECT * FROM repos ORDER BY created_at DESC`)
      .all() as RepoRecord[];
  }

  getRepo(id: string): RepoRecord {
    const repo = this.db
      .getDb()
      .prepare(`SELECT * FROM repos WHERE id=?`)
      .get(id) as RepoRecord | undefined;
    if (!repo) throw new NotFoundException(`Repo ${id} not found`);
    return repo;
  }

  async getFileTree(repoId: string): Promise<FileNode> {
    this.getRepo(repoId); // validates existence
    // Derive file tree from ChromaDB chunk metadata
    const results = await this.vectorstore.query(
      [repoId],
      new Array(384).fill(0),
      10000,
    );
    const filePaths = new Set<string>();
    for (const r of results) {
      r.metadatas.forEach((m) => filePaths.add(m.filePath));
    }
    return this.buildTree(repoId, Array.from(filePaths));
  }

  async getFileContent(
    repoId: string,
    filePath: string,
  ): Promise<{ content: string; language: string }> {
    this.getRepo(repoId);
    const results = await this.vectorstore.query(
      [repoId],
      new Array(384).fill(0),
      10000,
    );
    const chunks: Array<{ startLine: number; content: string }> = [];
    let language = 'text';
    for (const r of results) {
      r.metadatas.forEach((m, i) => {
        if (m.filePath === filePath) {
          chunks.push({
            startLine: (m.startLine as number) ?? 0,
            content: r.documents[i],
          });
          language = m.language as string;
        }
      });
    }
    if (chunks.length === 0)
      throw new NotFoundException(
        `File ${filePath} not found in repo ${repoId}`,
      );
    chunks.sort((a, b) => a.startLine - b.startLine);
    return { content: chunks.map((c) => c.content).join('\n\n'), language };
  }

  async deleteRepo(repoId: string): Promise<void> {
    this.getRepo(repoId);
    await this.vectorstore.deleteCollection(repoId);
    this.db.getDb().prepare(`DELETE FROM repos WHERE id=?`).run(repoId);
  }

  deleteMultipleRepos(repoIds: string[]): void {
    const deleteRepo = this.db.getDb().prepare(`DELETE FROM repos WHERE id=?`);
    for (const repoId of repoIds) {
      this.getRepo(repoId);
      this.vectorstore.deleteCollection(repoId).catch((err) => {
        this.logger.warn(
          `Failed to delete vectorstore collection for ${repoId}: ${err.message}`,
        );
      });
      deleteRepo.run(repoId);
    }
  }

  deleteAllRepos(): void {
    const repos = this.listRepos();
    const deleteRepo = this.db.getDb().prepare(`DELETE FROM repos WHERE id=?`);
    for (const repo of repos) {
      this.vectorstore.deleteCollection(repo.id).catch((err) => {
        this.logger.warn(
          `Failed to delete vectorstore collection for ${repo.id}: ${err.message}`,
        );
      });
      deleteRepo.run(repo.id);
    }
  }

  private buildTree(repoId: string, filePaths: string[]): FileNode {
    const root: FileNode = {
      name: repoId,
      path: '',
      type: 'dir',
      children: [],
    };
    for (const fp of filePaths.sort()) {
      const parts = fp.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        let child = node.children?.find((c) => c.name === part);
        if (!child) {
          child = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            type: isLast ? 'file' : 'dir',
            children: isLast ? undefined : [],
          };
          node.children ??= [];
          node.children.push(child);
        }
        if (!isLast) node = child;
      }
    }
    return root;
  }
}
