"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { api, ApiEndpoint, ArchDocHistoryEntry, ArchDocVersion } from "@/lib/api";

export default function OnboardingPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    content: string;
    apiEndpoints: ApiEndpoint[];
    loading: boolean;
    error: string;
    history: ArchDocHistoryEntry[];
    selectedVersion: number | null;
  }>({
    content: "",
    apiEndpoints: [],
    loading: false,
    error: "",
    history: [],
    selectedVersion: null,
  });

  const loadHistory = async () => {
    try {
      const h = await api.getOnboardingHistory(id);
      setState((s) => ({ ...s, history: h }));
      return h;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    loadHistory().then(async (h) => {
      if (h.length > 0) {
        try {
          const latest = h[0];
          const v = await api.getOnboardingVersion(id, latest.version);
          setState((s) =>
            s.content
              ? s
              : {
                  ...s,
                  content: v.content,
                  apiEndpoints: parseEndpointsFromMarkdown(v.content),
                  selectedVersion: s.selectedVersion ?? latest.version,
                }
          );
        } catch {
          /* ignore */
        }
      }
    });
  }, [id]);

  const generate = async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const result = await api.generateOnboarding(id);
      setState((s) => ({
        ...s,
        content: result.markdown,
        apiEndpoints: result.apiEndpoints ?? [],
      }));
      loadHistory();
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  };

  /** Parse API endpoints from stored markdown table */
  const parseEndpointsFromMarkdown = (md: string): ApiEndpoint[] => {
    const endpoints: ApiEndpoint[] = [];
    const tableMatch = md.match(/## API Endpoints\n([\s\S]*?)(?=\n## |$)/);
    if (tableMatch) {
      const rows = tableMatch[1].trim().split("\n").filter((r) => r.startsWith("|") && !r.includes("---"));
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 3) {
          endpoints.push({
            method: cells[0].replace(/`/g, ""),
            path: cells[1].replace(/`/g, ""),
            file: cells[2].replace(/`/g, ""),
          });
        }
      }
    }
    return endpoints;
  };

  const viewVersion = async (version: number) => {
    try {
      const v = await api.getOnboardingVersion(id, version);
      setState((s) => ({
        ...s,
        content: v.content,
        apiEndpoints: parseEndpointsFromMarkdown(v.content),
        selectedVersion: version,
      }));
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <>
      <Header
        title="Onboarding Guide"
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link href={`/repos/${id}`} className="btn btn-secondary btn-sm">
              ← Repo
            </Link>
            <button
              className="btn btn-primary btn-sm"
              onClick={generate}
              disabled={state.loading}
            >
              {state.loading ? (
                <>
                  <span className="spinner" /> Generating…
                </>
              ) : (
                "📖 Generate Guide"
              )}
            </button>
          </div>
        }
      />
      <div className="page">
        {state.error && (
          <div
            style={{
              color: "var(--error)",
              background: "rgba(239,68,68,0.08)",
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius-sm)",
              marginBottom: "1rem",
            }}
          >
            {state.error}
          </div>
        )}

        {state.history.length > 0 && (
          <section style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Version History
            </h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {state.history.map((h) => (
                <button
                  key={h.version}
                  className={`btn btn-sm ${state.selectedVersion === h.version ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => viewVersion(h.version)}
                >
                  v{h.version} — {new Date(h.generatedAt).toLocaleDateString()}
                </button>
              ))}
            </div>
          </section>
        )}

        {state.loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem" }}>
            <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
            <p style={{ color: "var(--text-secondary)" }}>
              Analysing repository and generating onboarding guide…
            </p>
          </div>
        )}

        {!state.content && !state.loading && (
          <div className="empty-state">
            <div className="empty-state-icon">📖</div>
            <div className="empty-state-title">No onboarding guide yet</div>
            <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
              Click &quot;Generate Guide&quot; to create a developer onboarding guide.
            </p>
            <button className="btn btn-primary" onClick={generate}>
              Generate Onboarding Guide
            </button>
          </div>
        )}

        {state.content && !state.loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            <div className="card" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>onboarding-guide.md</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigator.clipboard.writeText(state.content)}
                >
                  📋 Copy
                </button>
              </div>
              <MarkdownRenderer content={state.content} />
            </div>

            {state.apiEndpoints.length > 0 && (
              <section>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>
                  🛣 API Endpoints
                </h2>
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Path</th>
                        <th>File</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.apiEndpoints.map((ep, i) => (
                        <tr key={i}>
                          <td>
                            <span
                              className={`badge ${ep.method === "GET" ? "badge-success" : ep.method === "POST" ? "badge-info" : ep.method === "DELETE" ? "badge-error" : "badge-warning"}`}
                            >
                              {ep.method}
                            </span>
                          </td>
                          <td>
                            <code style={{ fontSize: "0.83rem" }}>{ep.path}</code>
                          </td>
                          <td style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                            {ep.file}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
