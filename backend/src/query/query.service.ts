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
import { CacheService } from '../shared/cache.service';
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

// ── Budget & retrieval constants ──────────────────────────────────────────
const SINGLE_REPO_BUDGET = 25;
const MULTI_REPO_BUDGET = 35;
const MAX_HISTORY_TURNS = 6;

type Chunk = {
  id: string;
  document: string;
  metadata: ChunkMetadata;
  distance: number;
};

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
    private cache: CacheService,
  ) {}

  // ── Shared retrieval pipeline ───────────────────────────────────────────
  private async retrieveContext(
    question: string,
    targetRepos: string[],
  ): Promise<{
    topChunks: Chunk[];
    repoNameMap: Map<string, string>;
    isMultiRepo: boolean;
  }> {
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
    const TOTAL_BUDGET = isMultiRepo ? MULTI_REPO_BUDGET : SINGLE_REPO_BUDGET;

    // Expand retrieval with sub-queries for both single and multi-repo
    const subQueries = await this.generateSubQueries(question, isMultiRepo);

    const subVectors = [
      queryVector,
      ...(await Promise.all(subQueries.map((t) => this.embeddings.embed(t)))),
    ];

    // Pull candidates per query
    const candidatesPerRepo = Math.max(20, Math.ceil(40 / targetRepos.length));

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

    return { topChunks, repoNameMap, isMultiRepo };
  }

  // ── Build the prompt messages ───────────────────────────────────────────
  private async buildPromptMessages(
    question: string,
    topChunks: Chunk[],
    repoNameMap: Map<string, string>,
    isMultiRepo: boolean,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<{
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    citations: Citation[];
    repoIdsResult: string[];
  }> {
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

    // Build system prompt — enterprise-grade detailed instructions
    const repoNames = [...repoNameMap.values()];
    const repoCount = repoNameMap.size;
    const repoContext = isMultiRepo
      ? [
          '',
          `You are analyzing ${repoCount} repositories: ${repoNames.join(' and ')}.`,
          'Each context block is labelled with its source repo.',
          'When asked about relationships between repos, look for:',
          '(1) shared or mirrored data structures / DTOs;',
          '(2) HTTP client calls or service-to-service API references;',
          '(3) common environment variable names or URLs pointing to the other service;',
          '(4) matching field names, enums, or entity IDs used across both repos;',
          '(5) identical module/service patterns that suggest they form a system together.',
          'Be specific — quote file paths and field names as evidence.',
        ].join('\n')
      : '';

    const systemPrompt = [
      'You are an expert senior software engineer and architect helping developers deeply understand a codebase.',
      repoContext,
      '',
      'RESPONSE GUIDELINES:',
      '- Provide thorough, well-structured answers with clear sections and headings where appropriate.',
      '- Explain HOW things work, not just WHAT they are. Trace data flow, explain design decisions, and describe component interactions.',
      '- Include relevant code snippets from the context to support your explanations.',
      '- When describing architecture or patterns, explain WHY they were chosen and what trade-offs they involve.',
      '- For implementation questions, provide step-by-step breakdowns with file paths and function names.',
      '- Cite sources using [N] markers matching the context block numbers.',
      '',
      'ACCURACY RULES:',
      '- ONLY describe what you can directly verify from the provided code context.',
      '- If the context does not contain enough evidence for a claim, say so explicitly rather than guessing.',
      '- DO NOT invent file paths, function names, or architectural patterns not visible in the context.',
      '- When uncertain, state your confidence level and what additional context would help.',
    ].join('\n');

    const userMessage = `Context:\n${contextText}\n\nQuestion: ${question}`;

    // Build messages array with conversation history
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

    const messages: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: userMessage },
    ];

    // Build citations
    const citations: Citation[] = topChunks.map((c) => ({
      filePath: c.metadata.filePath,
      startLine: c.metadata.startLine,
      endLine: c.metadata.endLine,
      repoId: c.metadata.repoId,
      snippet: c.document.slice(0, 200),
    }));

    const repoIdsResult = [...new Set(topChunks.map((c) => c.metadata.repoId))];

    return { messages, citations, repoIdsResult };
  }

  // ── Public query (non-streaming) ────────────────────────────────────────
  async query(
    question: string,
    repoIds?: string[],
    _conversationId?: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<QueryResponse> {
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

    // Check query cache (only for queries without conversation history)
    if (!history?.length) {
      const cached = await this.cache.getCachedQuery(question, targetRepos);
      if (cached) {
        this.logger.debug('Query cache hit');
        return JSON.parse(cached) as QueryResponse;
      }
    }

    const { topChunks, repoNameMap, isMultiRepo } = await this.retrieveContext(
      question,
      targetRepos,
    );

    const { messages, citations, repoIdsResult } =
      await this.buildPromptMessages(
        question,
        topChunks,
        repoNameMap,
        isMultiRepo,
        history,
      );

    let answer = '';
    try {
      answer = await this.llm.chat(messages, {
        temperature: 0.2,
        maxTokens: 5000,
      });
    } catch (err: any) {
      this.logger.error('LLM call failed', err);
      answer = err.message;
    }

    const result: QueryResponse = { answer, citations, repoIds: repoIdsResult };

    // Cache the result for future identical queries (fire-and-forget)
    if (!history?.length) {
      this.cache
        .setCachedQuery(question, targetRepos, JSON.stringify(result))
        .catch(() => {});
    }

    return result;
  }

  // ── Public query (streaming) ────────────────────────────────────────────
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

    const { topChunks, repoNameMap, isMultiRepo } = await this.retrieveContext(
      question,
      targetRepos,
    );

    const { messages, citations, repoIdsResult } =
      await this.buildPromptMessages(
        question,
        topChunks,
        repoNameMap,
        isMultiRepo,
        history,
      );

    // Stream the LLM response
    try {
      let isFirst = true;
      for await (const token of this.llm.chatStream(messages, {
        temperature: 0.2,
        maxTokens: 5000,
      })) {
        if (isFirst) {
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

  // ── Helpers ─────────────────────────────────────────────────────────────
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
   * Generates sub-queries to expand vector retrieval coverage.
   * For single-repo: focuses on different code dimensions (structure, logic, config).
   * For multi-repo: focuses on cross-service relationship signals.
   */
  private async generateSubQueries(
    question: string,
    isMultiRepo: boolean,
  ): Promise<string[]> {
    const dimensions = isMultiRepo
      ? [
          '(1) HTTP or API service-to-service calls,',
          '(2) shared DTOs, interfaces, or library imports,',
          '(3) environment variables or configuration for external service URLs,',
          '(4) event emission, messaging, or pub/sub patterns,',
          '(5) entity relationships, foreign keys, or cross-service identifiers.',
        ]
      : [
          '(1) function signatures, class definitions, and type declarations related to the topic,',
          '(2) configuration files, environment variables, and setup related to the topic,',
          '(3) middleware, guards, interceptors, or lifecycle hooks connected to the topic,',
        ];

    const count = dimensions.length;

    const systemPrompt = [
      'You are a code search query generator.',
      `Given the user question, produce exactly ${count} short search queries that together`,
      'would retrieve all relevant code from a codebase.',
      `Each query must focus on a different technical dimension:`,
      ...dimensions,
      'Derive all specific terms directly from the question — no generic placeholders.',
      `Reply with ONLY a valid JSON array of ${count} strings. No explanation, no markdown.`,
    ].join(' ');

    try {
      const raw = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Question: ${question}` },
        ],
        { temperature: 0.0, maxTokens: 500 },
      );

      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array in LLM response');
      const parsed: unknown = JSON.parse(match[0]);
      if (!Array.isArray(parsed))
        throw new Error('Parsed value is not an array');
      return (parsed as unknown[])
        .filter(
          (x): x is string => typeof x === 'string' && x.trim().length > 0,
        )
        .slice(0, count + 1);
    } catch (err: any) {
      this.logger.warn(
        'Sub-query generation failed — using generic fallback',
        err.message,
      );
      return isMultiRepo
        ? [
            'HTTP client API call external service URL',
            'shared interface type import library',
            'environment variable configuration service URL',
            'event emit dispatch notification',
            'entity relationship foreign key identifier',
          ]
        : [
            'function class interface type definition declaration',
            'config environment variable setup initialization',
            'middleware guard interceptor hook lifecycle',
          ];
    }
  }
}
