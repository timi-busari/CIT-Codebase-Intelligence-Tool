import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingsService } from '../shared/embeddings.service';
import {
  VectorstoreService,
  ChunkMetadata,
} from '../shared/vectorstore.service';
import { DatabaseService } from '../shared/database.service';
import { LlmService } from '../shared/llm.service';
import { RerankService } from '../shared/rerank.service';
import { toonEncode } from '../shared/toon.helper';

export interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  repoId: string;
  snippet: string;
}

export interface QueryResponse {
  answer: string;
  citations: Citation[];
  repoIds: string[];
}

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    private config: ConfigService,
    private embeddings: EmbeddingsService,
    private vectorstore: VectorstoreService,
    private db: DatabaseService,
    private llm: LlmService,
    private rerank: RerankService,
  ) {}

  async query(
    question: string,
    repoIds?: string[],
    _conversationId?: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<QueryResponse> {
    // Resolve repo IDs — filter out any IDs not present in the DB to
    // prevent creating phantom ChromaDB collections (BUG-003)
    const targetRepos = repoIds?.length
      ? repoIds.filter((id) => this.repoExists(id))
      : this.getAllRepoIds();

    if (targetRepos.length === 0) {
      return {
        answer:
          'No repositories have been ingested yet. Please ingest a repository first.',
        citations: [],
        repoIds: [],
      };
    }

    // Embed the question
    const queryVector = await this.embeddings.embed(question);

    // Build a map of repoId → display name for context labelling
    const repoNameMap = new Map<string, string>();
    for (const id of targetRepos) {
      const row = this.db
        .getDb()
        .prepare(`SELECT name FROM repos WHERE id=?`)
        .get(id) as { name: string } | undefined;
      repoNameMap.set(id, row?.name ?? id.slice(0, 8));
    }

    const isMultiRepo = targetRepos.length > 1;
    const TOTAL_BUDGET = isMultiRepo ? 14 : 10;

    // For multi-repo queries, expand retrieval with sub-queries generated
    // dynamically from the question so they adapt to any codebase.
    const subQueries = isMultiRepo
      ? await this.generateSubQueries(question)
      : [];

    const subVectors = [
      queryVector,
      ...(await Promise.all(subQueries.map((t) => this.embeddings.embed(t)))),
    ];

    // Pull candidates per query, more per repo for multi-repo analysis
    const candidatesPerRepo = Math.max(16, Math.ceil(24 / targetRepos.length));

    type Chunk = {
      id: string;
      document: string;
      metadata: ChunkMetadata;
      distance: number;
    };

    // Run all sub-query searches and merge, deduplicating by chunk id
    const seenIds = new Set<string>();
    const byRepo = new Map<string, Chunk[]>();

    for (const vec of subVectors) {
      const rawResults = await this.vectorstore.query(
        targetRepos,
        vec,
        candidatesPerRepo,
      );
      for (const r of rawResults) {
        for (let i = 0; i < r.ids.length; i++) {
          const id = r.ids[i];
          if (seenIds.has(id)) continue;
          // Filter near-empty stubs — they score well but carry no information
          if (r.documents[i].trim().length < 80) continue;
          seenIds.add(id);
          const repoId = r.metadatas[i].repoId;
          if (!byRepo.has(repoId)) byRepo.set(repoId, []);
          byRepo.get(repoId)!.push({
            id,
            document: r.documents[i],
            metadata: r.metadatas[i],
            distance: r.distances[i] ?? 1,
          });
        }
      }
    }

    // Sort each repo's candidates by distance (ascending = most relevant first)
    for (const chunks of byRepo.values())
      chunks.sort((a, b) => a.distance - b.distance);

    // Balanced selection: guaranteed floor per repo, remainder filled globally
    const repoCount = byRepo.size || 1;
    const floorPerRepo = Math.max(Math.floor(TOTAL_BUDGET / repoCount), 3);

    const guaranteed: Chunk[] = [];
    const remainder: Chunk[] = [];
    for (const chunks of byRepo.values()) {
      guaranteed.push(...chunks.slice(0, floorPerRepo));
      remainder.push(...chunks.slice(floorPerRepo));
    }
    remainder.sort((a, b) => a.distance - b.distance);
    const candidateChunks = [...guaranteed, ...remainder]
      .slice(0, TOTAL_BUDGET * 2) // keep more for re-ranking
      .sort((a, b) => a.distance - b.distance);

    // Re-rank using Cohere if available, otherwise take top by distance
    let topChunks: Chunk[];
    if (this.rerank.isEnabled() && candidateChunks.length > TOTAL_BUDGET) {
      const rerankedIndices = await this.rerank.rerank(
        question,
        candidateChunks.map((c) => c.document),
        TOTAL_BUDGET,
      );
      topChunks = rerankedIndices.map((i) => candidateChunks[i]);
    } else {
      topChunks = candidateChunks.slice(0, TOTAL_BUDGET);
    }

    // Encode chunk metadata as TOON to save tokens on the header lines
    const chunkHeaders = await toonEncode(
      topChunks.map((c, i) => ({
        n: i + 1,
        repo: repoNameMap.get(c.metadata.repoId) ?? c.metadata.repoId,
        file: c.metadata.filePath,
        lines: `${c.metadata.startLine}-${c.metadata.endLine}`,
      })),
    );

    // Build context — header table in TOON, then individual code blocks
    const contextBlocks = topChunks.map(
      (c, i) =>
        `[${i + 1}] Repo: ${repoNameMap.get(c.metadata.repoId) ?? c.metadata.repoId} | File: ${c.metadata.filePath} (lines ${c.metadata.startLine}-${c.metadata.endLine})\n\`\`\`\n${c.document}\n\`\`\``,
    );
    const contextText = [
      '```toon',
      chunkHeaders,
      '```',
      '',
      ...contextBlocks,
    ].join('\n');

    // Build system prompt — richer instructions for multi-repo relationship analysis
    const repoNames = [...repoNameMap.values()];
    const repoContext = isMultiRepo
      ? [
          `You are analyzing ${repoCount} repositories: ${repoNames.join(' and ')}.`,
          `Each context block is labelled with its source repo.`,
          `When asked about relationships between repos, look for:`,
          `(1) shared or mirrored data structures / DTOs;`,
          `(2) HTTP client calls or service-to-service API references;`,
          `(3) common environment variable names or URLs pointing to the other service;`,
          `(4) matching field names, enums, or entity IDs used across both repos;`,
          `(5) identical module/service patterns that suggest they form a system together.`,
          `Be specific — quote file paths and field names as evidence.`,
        ].join(' ')
      : '';
    const systemPrompt = [
      'You are an expert software engineer helping developers understand a codebase.',
      repoContext,
      'Answer questions using the provided code context. Be concise and precise.',
      'When referencing code, cite the source using [N] markers matching the context block numbers.',
      'If the context does not contain enough evidence for a claim, say so explicitly rather than guessing.',
    ]
      .filter(Boolean)
      .join(' ');

    const userMessage = `Context:\n${contextText}\n\nQuestion: ${question}`;

    // Build messages array with conversation history (last 6 turns max)
    const MAX_HISTORY_TURNS = 6;
    const historyMessages: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[] = [];
    if (history?.length) {
      const trimmed = history.slice(-MAX_HISTORY_TURNS * 2);
      for (const msg of trimmed) {
        historyMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Call LLM (OpenAI or Ollama)
    let answer = '';
    try {
      answer = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: userMessage },
        ],
        { temperature: 0.2, maxTokens: 1500 },
      );
    } catch (err: any) {
      this.logger.error('LLM call failed', err);
      answer = err.message;
    }

    // Build citations
    const citations: Citation[] = topChunks.map((c) => ({
      filePath: c.metadata.filePath,
      startLine: c.metadata.startLine,
      endLine: c.metadata.endLine,
      repoId: c.metadata.repoId,
      snippet: c.document.slice(0, 200),
    }));

    return {
      answer,
      citations,
      repoIds: [...new Set(topChunks.map((c) => c.metadata.repoId))],
    };
  }

  async *queryStream(
    question: string,
    repoIds?: string[],
    _conversationId?: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ): AsyncGenerator<
    {
      token?: string;
      citations?: Citation[];
      repoIds?: string[];
      done?: boolean;
    },
    void,
    unknown
  > {
    // Resolve repo IDs — filter out any IDs not present in the DB
    const targetRepos = repoIds?.length
      ? repoIds.filter((id) => this.repoExists(id))
      : this.getAllRepoIds();

    if (targetRepos.length === 0) {
      yield {
        token:
          'No repositories have been ingested yet. Please ingest a repository first.',
        citations: [],
        repoIds: [],
        done: true,
      };
      return;
    }

    // Embed the question
    const queryVector = await this.embeddings.embed(question);

    // Build a map of repoId → display name for context labelling
    const repoNameMap = new Map<string, string>();
    for (const id of targetRepos) {
      const row = this.db
        .getDb()
        .prepare(`SELECT name FROM repos WHERE id=?`)
        .get(id) as { name: string } | undefined;
      repoNameMap.set(id, row?.name ?? id.slice(0, 8));
    }

    const isMultiRepo = targetRepos.length > 1;
    const TOTAL_BUDGET = isMultiRepo ? 14 : 10;

    // For multi-repo queries, expand retrieval with sub-queries
    const subQueries = isMultiRepo
      ? await this.generateSubQueries(question)
      : [];

    const subVectors = [
      queryVector,
      ...(await Promise.all(subQueries.map((t) => this.embeddings.embed(t)))),
    ];

    // Pull candidates per query, more per repo for multi-repo analysis
    const candidatesPerRepo = Math.max(16, Math.ceil(24 / targetRepos.length));

    type Chunk = {
      id: string;
      document: string;
      metadata: ChunkMetadata;
      distance: number;
    };

    // Run all sub-query searches and merge, deduplicating by chunk id
    const seenIds = new Set<string>();
    const byRepo = new Map<string, Chunk[]>();

    for (const vec of subVectors) {
      const rawResults = await this.vectorstore.query(
        targetRepos,
        vec,
        candidatesPerRepo,
      );
      for (const r of rawResults) {
        for (let i = 0; i < r.ids.length; i++) {
          const id = r.ids[i];
          if (seenIds.has(id)) continue;
          // Filter near-empty stubs
          if (r.documents[i].trim().length < 80) continue;
          seenIds.add(id);
          const repoId = r.metadatas[i].repoId;
          if (!byRepo.has(repoId)) byRepo.set(repoId, []);
          byRepo.get(repoId)!.push({
            id,
            document: r.documents[i],
            metadata: r.metadatas[i],
            distance: r.distances[i] ?? 1,
          });
        }
      }
    }

    // Sort each repo's candidates by distance
    for (const chunks of byRepo.values())
      chunks.sort((a, b) => a.distance - b.distance);

    // Balanced selection: guaranteed floor per repo, remainder filled globally
    const repoCount = byRepo.size || 1;
    const floorPerRepo = Math.max(Math.floor(TOTAL_BUDGET / repoCount), 3);

    const guaranteed: Chunk[] = [];
    const remainder: Chunk[] = [];
    for (const chunks of byRepo.values()) {
      guaranteed.push(...chunks.slice(0, floorPerRepo));
      remainder.push(...chunks.slice(floorPerRepo));
    }
    remainder.sort((a, b) => a.distance - b.distance);
    const candidateChunks = [...guaranteed, ...remainder]
      .slice(0, TOTAL_BUDGET * 2)
      .sort((a, b) => a.distance - b.distance);

    // Re-rank using Cohere if available, otherwise take top by distance
    let topChunks: Chunk[];
    if (this.rerank.isEnabled() && candidateChunks.length > TOTAL_BUDGET) {
      const rerankedIndices = await this.rerank.rerank(
        question,
        candidateChunks.map((c) => c.document),
        TOTAL_BUDGET,
      );
      topChunks = rerankedIndices.map((i) => candidateChunks[i]);
    } else {
      topChunks = candidateChunks.slice(0, TOTAL_BUDGET);
    }

    // Encode chunk metadata as TOON to save tokens
    const chunkHeaders = await toonEncode(
      topChunks.map((c, i) => ({
        n: i + 1,
        repo: repoNameMap.get(c.metadata.repoId) ?? c.metadata.repoId,
        file: c.metadata.filePath,
        lines: `${c.metadata.startLine}-${c.metadata.endLine}`,
      })),
    );

    // Build context
    const contextBlocks = topChunks.map(
      (c, i) =>
        `[${i + 1}] Repo: ${repoNameMap.get(c.metadata.repoId) ?? c.metadata.repoId} | File: ${c.metadata.filePath} (lines ${c.metadata.startLine}-${c.metadata.endLine})\n\`\`\`\n${c.document}\n\`\`\``,
    );
    const contextText = [
      '```toon',
      chunkHeaders,
      '```',
      '',
      ...contextBlocks,
    ].join('\n');

    // Build system prompt
    const repoNames = [...repoNameMap.values()];
    const repoContext = isMultiRepo
      ? [
          `You are analyzing ${repoCount} repositories: ${repoNames.join(' and ')}.`,
          `Each context block is labelled with its source repo.`,
          `When asked about relationships between repos, look for:`,
          `(1) shared or mirrored data structures / DTOs;`,
          `(2) HTTP client calls or service-to-service API references;`,
          `(3) common environment variable names or URLs pointing to the other service;`,
          `(4) matching field names, enums, or entity IDs used across both repos;`,
          `(5) identical module/service patterns that suggest they form a system together.`,
          `Be specific — quote file paths and field names as evidence.`,
        ].join(' ')
      : '';
    const systemPrompt = [
      'You are an expert software engineer helping developers understand a codebase.',
      repoContext,
      'Answer questions using the provided code context. Be concise and precise.',
      'When referencing code, cite the source using [N] markers matching the context block numbers.',
      'If the context does not contain enough evidence for a claim, say so explicitly rather than guessing.',
    ]
      .filter(Boolean)
      .join(' ');

    const userMessage = `Context:\n${contextText}\n\nQuestion: ${question}`;

    // Build messages array with conversation history
    const MAX_HISTORY_TURNS = 6;
    const historyMessages: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[] = [];
    if (history?.length) {
      const trimmed = history.slice(-MAX_HISTORY_TURNS * 2);
      for (const msg of trimmed) {
        historyMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Build citations once
    const citations: Citation[] = topChunks.map((c) => ({
      filePath: c.metadata.filePath,
      startLine: c.metadata.startLine,
      endLine: c.metadata.endLine,
      repoId: c.metadata.repoId,
      snippet: c.document.slice(0, 200),
    }));

    const repoIdsResult = [...new Set(topChunks.map((c) => c.metadata.repoId))];

    // Stream the LLM response
    try {
      let isFirst = true;
      for await (const token of this.llm.chatStream(
        [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: userMessage },
        ],
        { temperature: 0.2, maxTokens: 1500 },
      )) {
        if (isFirst) {
          // Send citations with the first token
          yield { token, citations, repoIds: repoIdsResult };
          isFirst = false;
        } else {
          yield { token };
        }
      }
      yield { done: true };
    } catch (err: any) {
      this.logger.error('LLM stream call failed', err);
      yield { token: err.message, done: true };
    }
  }

  private getAllRepoIds(): string[] {
    const rows = this.db
      .getDb()
      .prepare(`SELECT id FROM repos WHERE status='done'`)
      .all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  private repoExists(id: string): boolean {
    const row = this.db
      .getDb()
      .prepare(`SELECT 1 FROM repos WHERE id=?`)
      .get(id);
    return !!row;
  }

  /**
   * Asks the LLM to expand the question into targeted sub-queries for vector
   * retrieval. Each sub-query focuses on a different code relationship signal
   * (HTTP calls, shared types, env vars, events, entity ids) and is derived
   * entirely from the user's question — no repo-specific constants.
   */
  private async generateSubQueries(question: string): Promise<string[]> {
    const systemPrompt = [
      'You are a code search query generator.',
      'Given the user question, produce exactly 5 short search queries that together',
      'would retrieve all relevant code from a multi-repository codebase.',
      'Each query must focus on a different technical dimension:',
      '(1) HTTP or API service-to-service calls,',
      '(2) shared DTOs, interfaces, or library imports,',
      '(3) environment variables or configuration for external service URLs,',
      '(4) event emission, messaging, or pub/sub patterns,',
      '(5) entity relationships, foreign keys, or cross-service identifiers.',
      'Derive all specific terms directly from the question — no generic placeholders.',
      'Reply with ONLY a valid JSON array of 5 strings. No explanation, no markdown.',
    ].join(' ');

    try {
      const raw = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Question: ${question}` },
        ],
        { temperature: 0.0, maxTokens: 300 },
      );

      // Strip any markdown fences before parsing
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array in LLM response');
      const parsed: unknown = JSON.parse(match[0]);
      if (!Array.isArray(parsed))
        throw new Error('Parsed value is not an array');
      return (parsed as unknown[])
        .filter(
          (x): x is string => typeof x === 'string' && x.trim().length > 0,
        )
        .slice(0, 6);
    } catch (err: any) {
      this.logger.warn(
        'Sub-query generation failed — using generic fallback',
        err.message,
      );
      // Fallback: broad cross-cutting signals that work for any codebase
      return [
        'HTTP client API call external service URL',
        'shared interface type import library',
        'environment variable configuration service URL',
        'event emit dispatch notification',
        'entity relationship foreign key identifier',
      ];
    }
  }
}
