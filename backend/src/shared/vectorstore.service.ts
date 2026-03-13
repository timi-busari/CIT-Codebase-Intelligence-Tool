import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection, EmbeddingFunction } from 'chromadb';

// No-op embedding function — we always supply embeddings directly in add() and
// query() calls, so we never need ChromaDB's built-in DefaultEmbeddingFunction.
// Passing this suppresses the "@chroma-core/default-embed not installed" errors.
class NullEmbeddingFunction implements EmbeddingFunction {
  name = 'null';
  async generate(_texts: string[]): Promise<number[][]> {
    return [];
  }
  getConfig(): Record<string, any> {
    return {};
  }
}

export interface ChunkMetadata {
  repoId: string;
  filePath: string;
  language: string;
  chunkType: string;
  startLine: number;
  endLine: number;
  [key: string]: string | number | boolean;
}

export interface QueryResult {
  ids: string[];
  documents: string[];
  metadatas: ChunkMetadata[];
  distances: number[];
}

@Injectable()
export class VectorstoreService {
  private readonly logger = new Logger(VectorstoreService.name);
  private client: ChromaClient;

  constructor(private config: ConfigService) {
    const chromaHost = this.config.get<string>(
      'CHROMA_HOST',
      'http://localhost:8000',
    );
    const url = new URL(chromaHost);
    this.client = new ChromaClient({
      ssl: url.protocol === 'https:',
      host: url.hostname,
      port: parseInt(
        url.port || (url.protocol === 'https:' ? '443' : '80'),
        10,
      ),
    });
  }

  private collectionName(repoId: string): string {
    return `repo_${repoId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  async getOrCreateCollection(repoId: string): Promise<Collection> {
    const name = this.collectionName(repoId);
    try {
      return await this.client.getOrCreateCollection({
        name,
        embeddingFunction: new NullEmbeddingFunction(),
      });
    } catch (err) {
      this.logger.error(`Failed to get/create collection for ${repoId}`, err);
      throw err;
    }
  }

  async addChunks(
    repoId: string,
    ids: string[],
    embeddings: number[][],
    documents: string[],
    metadatas: ChunkMetadata[],
  ): Promise<void> {
    const collection = await this.getOrCreateCollection(repoId);
    // ChromaDB has a batch limit; chunk into groups of 500
    const batchSize = 500;
    for (let i = 0; i < ids.length; i += batchSize) {
      await collection.add({
        ids: ids.slice(i, i + batchSize),
        embeddings: embeddings.slice(i, i + batchSize),
        documents: documents.slice(i, i + batchSize),
        metadatas: metadatas.slice(i, i + batchSize) as any,
      });
    }
  }

  async query(
    repoIds: string[],
    queryEmbedding: number[],
    nResults = 10,
  ): Promise<QueryResult[]> {
    const results: QueryResult[] = [];
    for (const repoId of repoIds) {
      try {
        const collection = await this.getOrCreateCollection(repoId);
        const count = await collection.count();
        if (count === 0) continue;
        const res = await collection.query({
          queryEmbeddings: [queryEmbedding],
          nResults: Math.min(nResults, count),
        });
        results.push({
          ids: res.ids[0],
          documents: res.documents[0] as string[],
          metadatas: res.metadatas[0] as unknown as ChunkMetadata[],
          distances: res.distances ? (res.distances[0] as number[]) : [],
        });
      } catch (err) {
        this.logger.warn(`Query failed for repo ${repoId}: ${err.message}`);
      }
    }
    return results;
  }

  async deleteCollection(repoId: string): Promise<void> {
    const name = this.collectionName(repoId);
    try {
      await this.client.deleteCollection({ name });
    } catch (err) {
      this.logger.warn(`Could not delete collection ${name}: ${err.message}`);
    }
  }

  async listCollections(): Promise<string[]> {
    const collections = await this.client.listCollections();
    return collections.map((c: any) => (typeof c === 'string' ? c : c.name));
  }

  async collectionCount(repoId: string): Promise<number> {
    try {
      const collection = await this.getOrCreateCollection(repoId);
      return await collection.count();
    } catch {
      return 0;
    }
  }

  /** Retrieve all chunks for a repo without needing an embedding vector. */
  async getAll(
    repoId: string,
  ): Promise<{ ids: string[]; documents: string[]; metadatas: ChunkMetadata[] } | null> {
    try {
      const collection = await this.getOrCreateCollection(repoId);
      const count = await collection.count();
      if (count === 0) return null;
      const res = await collection.get();
      return {
        ids: res.ids,
        documents: res.documents as string[],
        metadatas: res.metadatas as unknown as ChunkMetadata[],
      };
    } catch (err) {
      this.logger.warn(`getAll failed for repo ${repoId}: ${err.message}`);
      return null;
    }
  }

  /** Delete chunks matching specific file paths from a repo collection */
  async deleteByFilePaths(
    repoId: string,
    filePaths: string[],
  ): Promise<void> {
    if (filePaths.length === 0) return;
    try {
      const collection = await this.getOrCreateCollection(repoId);
      // ChromaDB supports $in filter on metadata
      await collection.delete({
        where: { filePath: { $in: filePaths } } as any,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to delete chunks by file paths for repo ${repoId}: ${err.message}`,
      );
    }
  }
}
