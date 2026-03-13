const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // BUG-009: forward saved API key on every request
  const apiKey =
    typeof window !== "undefined"
      ? (localStorage.getItem("openai_api_key") ?? "")
      : "";
  const authHeaders: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...init?.headers,
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    // BUG-011: extract a clean message instead of showing raw JSON
    let errorMessage = `${res.status} ${res.statusText}`;
    try {
      const json = JSON.parse(text) as { message?: string | string[] };
      const msg = json.message;
      errorMessage = Array.isArray(msg)
        ? msg.join(", ")
        : (msg ?? errorMessage);
    } catch {
      errorMessage = text || errorMessage;
    }
    throw new Error(errorMessage);
  }
  return res.json() as Promise<T>;
}

// BUG-012: shared delete helper that throws on server errors
async function del(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

// ── Repos ──────────────────────────────────────────────────────────────────
export interface Repo {
  id: string;
  url: string;
  name: string;
  status: "pending" | "cloning" | "parsing" | "embedding" | "done" | "error";
  chunk_count: number;
  file_count: number;
  created_at: number;
  updated_at: number;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

export interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  repoId: string;
  snippet: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

export interface Conversation {
  id: string;
  title: string;
  repo_ids: string[];
  messages: Message[];
  created_at: number;
  updated_at: number;
}

export interface Bookmark {
  id: string;
  conversation_id?: string;
  question: string;
  answer: string;
  sources: Citation[];
  repo_ids: string[];
  tags: string[];
  created_at: number;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
}

export interface ArchResult {
  repoId: string;
  repoName: string;
  summary: string;
  dependencyGraph: string;
  apiEndpoints: ApiEndpoint[];
  markdown: string;
}

export interface ArchDocVersion {
  version: number;
  content: string;
  generatedAt: number;
}

export interface ArchDocHistoryEntry {
  version: number;
  generatedAt: number;
}

export interface OnboardingResult {
  repoId: string;
  markdown: string;
  version: number;
}

export interface PrAnalysis {
  id: string;
  repoId: string;
  prNumber: number;
  prUrl: string;
  summary: string;
  filesChanged: string[];
  risks: string[];
  createdAt: number;
}

export interface FileMetric {
  filePath: string;
  loc: number;
  functionCount: number;
  avgFunctionLength: number;
  cyclomaticComplexity: number;
  todoCount: number;
}

export interface HealthReport {
  repoId: string;
  totalFiles: number;
  totalLoc: number;
  avgComplexity: number;
  healthScore: number;
  topComplexFiles: FileMetric[];
  largestFiles: FileMetric[];
  todoHotspots: FileMetric[];
  locDistribution: { bracket: string; count: number }[];
}

export interface JobStatus {
  jobId: string;
  repoId: string;
  status: string;
  progress: number;
  totalFiles: number;
  processedFiles: number;
  phase?: string;
  error?: string;
}

export const api = {
  // Ingestion
  ingest: (url: string, name?: string, token?: string) =>
    request<{ jobId: string; repoId: string; status: string }>("/api/ingest", {
      method: "POST",
      body: JSON.stringify({ url, name, ...(token ? { token } : {}) }),
    }),

  getJob: (jobId: string) =>
    request<{
      jobId: string;
      repoId: string;
      status: string;
      progress: number;
      totalFiles: number;
      processedFiles: number;
      phase?: string;
      error?: string;
    }>(`/api/ingest/status/${jobId}`),

  // Repos
  listRepos: () => request<Repo[]>("/api/repos"),
  getRepo: (id: string) => request<Repo>(`/api/repos/${id}`),
  getFileTree: (id: string) => request<FileNode>(`/api/repos/${id}/files`),
  getFileContent: (id: string, path: string) =>
    request<{ content: string; language: string }>(
      `/api/repos/${id}/file?path=${encodeURIComponent(path)}`,
    ),
  deleteRepo: (id: string) => del(`/api/repos/${id}`),

  // Query
  query: (
    question: string,
    repoIds?: string[],
    conversationId?: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ) =>
    request<{
      answer: string;
      citations: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
        repoId: string;
        snippet: string;
      }>;
      repoIds: string[];
    }>("/api/query", {
      method: "POST",
      body: JSON.stringify({ query: question, repoIds, conversationId, history }),
    }),

  // Streaming Query
  queryStream: async function* (
    question: string,
    repoIds?: string[],
    conversationId?: string,
    history?: { role: 'user' | 'assistant'; content: string }[],
  ) {
    const apiKey =
      typeof window !== "undefined"
        ? (localStorage.getItem("openai_api_key") ?? "")
        : "";
    const authHeaders: Record<string, string> = apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : {};

    const response = await fetch(`${API_BASE}/api/query/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ query: question, repoIds, conversationId, history }),
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = `${response.status} ${response.statusText}`;
      try {
        const json = JSON.parse(text) as { message?: string | string[] };
        const msg = json.message;
        errorMessage = Array.isArray(msg)
          ? msg.join(", ")
          : (msg ?? errorMessage);
      } catch {
        errorMessage = text || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trimStart().startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              const chunk = JSON.parse(data);
              yield chunk;
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  // Conversations
  listConversations: (search?: string) =>
    request<Conversation[]>(
      `/api/conversations${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    ),
  createConversation: (data: {
    title?: string;
    repoIds?: string[];
    messages?: Message[];
  }) =>
    request<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getConversation: (id: string) => request<Conversation>(`/api/conversations/${id}`),
  updateConversation: (
    id: string,
    data: { title?: string; messages?: Message[] },
  ) =>
    request<Conversation>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteConversation: (id: string) => del(`/api/conversations/${id}`),

  // Bookmarks
  listBookmarks: (tag?: string) =>
    request<Bookmark[]>(
      `/api/bookmarks${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`,
    ),
  createBookmark: (data: {
    question: string;
    answer: string;
    sources?: Citation[];
    repoIds?: string[];
    tags?: string[];
    conversationId?: string;
  }) =>
    request<Bookmark>("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteBookmark: (id: string) => del(`/api/bookmarks/${id}`),

  // Bookmarks search
  searchBookmarks: (query: string) =>
    request<Bookmark[]>(`/api/bookmarks?search=${encodeURIComponent(query)}`),

  // Conversations by repo
  listConversationsByRepo: (repoId: string) =>
    request<Conversation[]>(`/api/conversations?repoId=${encodeURIComponent(repoId)}`),

  // Architecture
  generateArchDocs: (repoId: string) =>
    request<ArchResult>(`/api/repos/${repoId}/architecture`, { method: "POST" }),
  getArchDocHistory: (repoId: string) =>
    request<ArchDocHistoryEntry[]>(`/api/repos/${repoId}/architecture/history`),
  getArchDocVersion: (repoId: string, version: number) =>
    request<ArchDocVersion>(`/api/repos/${repoId}/architecture/versions/${version}`),

  // Onboarding
  generateOnboarding: (repoId: string) =>
    request<OnboardingResult>(`/api/repos/${repoId}/onboarding`, { method: "POST" }),
  getOnboardingHistory: (repoId: string) =>
    request<ArchDocHistoryEntry[]>(`/api/repos/${repoId}/onboarding/history`),
  getOnboardingVersion: (repoId: string, version: number) =>
    request<ArchDocVersion>(`/api/repos/${repoId}/onboarding/versions/${version}`),

  // PR Analysis
  analyzePr: (data: { repoId: string; repoUrl: string; prNumber: number; githubToken?: string }) =>
    request<PrAnalysis>("/api/pr-analysis", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listPrAnalyses: (repoId: string) =>
    request<PrAnalysis[]>(`/api/repos/${repoId}/pr-analyses`),
  getPrAnalysis: (id: string) =>
    request<PrAnalysis>(`/api/pr-analysis/${id}`),

  // Code Health
  computeHealth: (repoId: string) =>
    request<{ message: string }>(`/api/repos/${repoId}/health/compute`, { method: "POST" }),
  getHealth: (repoId: string) =>
    request<HealthReport>(`/api/repos/${repoId}/health`),

  // Webhooks
  setupWebhook: (repoId: string) =>
    request<{ secret: string; webhookUrl: string }>(`/api/repos/${repoId}/webhook/setup`, { method: "POST" }),
};
