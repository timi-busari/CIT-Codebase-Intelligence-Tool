"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { api, PrAnalysis, Repo } from "@/lib/api";

export default function PrAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    repo: Repo | null;
    analyses: PrAnalysis[];
    selected: PrAnalysis | null;
    prNumber: string;
    githubToken: string;
    loading: boolean;
    error: string;
  }>({
    repo: null,
    analyses: [],
    selected: null,
    prNumber: "",
    githubToken: "",
    loading: false,
    error: "",
  });

  useEffect(() => {
    api.getRepo(id).then((r) => setState((s) => ({ ...s, repo: r }))).catch(() => {});
    api.listPrAnalyses(id).then((a) => setState((s) => ({ ...s, analyses: a }))).catch(() => {});
  }, [id]);

  const analyze = async () => {
    if (!state.prNumber || !state.repo?.url) return;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const result = await api.analyzePr({
        repoId: id,
        repoUrl: state.repo.url,
        prNumber: parseInt(state.prNumber, 10),
        ...(state.githubToken ? { githubToken: state.githubToken } : {}),
      });
      setState((s) => ({
        ...s,
        selected: result,
        analyses: [result, ...s.analyses],
        prNumber: "",
      }));
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  };

  return (
    <>
      <Header
        title="PR Analysis"
        actions={
          <Link href={`/repos/${id}`} className="btn btn-secondary btn-sm">← Repo</Link>
        }
      />
      <div className="page">
        {state.error && (
          <div style={{ color: "var(--error)", background: "rgba(239,68,68,0.08)", padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", marginBottom: "1rem" }}>
            {state.error}
          </div>
        )}

        {/* Analyze form */}
        <section className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.75rem" }}>Analyze a Pull Request</h3>
          {!state.repo?.url ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              This repository has no remote URL. PR analysis requires a GitHub repository.
            </p>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>PR Number</label>
                <input
                  type="number"
                  value={state.prNumber}
                  onChange={(e) => setState((s) => ({ ...s, prNumber: e.target.value }))}
                  placeholder="e.g. 42"
                  className="input"
                  style={{ width: 120 }}
                  min={1}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>GitHub Token (optional)</label>
                <input
                  type="password"
                  value={state.githubToken}
                  onChange={(e) => setState((s) => ({ ...s, githubToken: e.target.value }))}
                  placeholder="ghp_..."
                  className="input"
                  style={{ width: 220 }}
                />
              </div>
              <button className="btn btn-primary btn-sm" onClick={analyze} disabled={state.loading || !state.prNumber}>
                {state.loading ? (<><span className="spinner" /> Analyzing…</>) : "🔍 Analyze PR"}
              </button>
            </div>
          )}
        </section>

        <div style={{ display: "flex", gap: "1.5rem" }}>
          {/* Past analyses list */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem" }}>Past Analyses</h3>
            {state.analyses.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No analyses yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {state.analyses.map((a) => (
                  <button
                    key={a.id}
                    className={`btn btn-sm ${state.selected?.id === a.id ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setState((s) => ({ ...s, selected: a }))}
                    style={{ textAlign: "left", justifyContent: "flex-start" }}
                  >
                    PR #{a.prNumber} — {new Date(a.createdAt).toLocaleDateString()}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Detail view */}
          <div style={{ flex: 1 }}>
            {!state.selected ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔍</div>
                <div className="empty-state-title">Select or analyze a PR</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div className="card" style={{ padding: "1rem" }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
                    PR #{state.selected.prNumber}
                  </h3>
                  {state.selected.prUrl && (
                    <a
                      href={state.selected.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "0.8rem", color: "var(--accent)" }}
                    >
                      View on GitHub →
                    </a>
                  )}
                </div>

                <section>
                  <h4 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>📋 Summary</h4>
                  <div className="card" style={{ padding: "1rem" }}>
                    <MarkdownRenderer content={state.selected.summary} />
                  </div>
                </section>

                {state.selected.filesChanged?.length > 0 && (
                  <section>
                    <h4 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>📁 Files Changed ({state.selected.filesChanged.length})</h4>
                    <div className="card" style={{ padding: "0.75rem 1rem" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                        {state.selected.filesChanged.map((f) => (
                          <code key={f} style={{ fontSize: "0.8rem" }}>{f}</code>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                {state.selected.risks?.length > 0 && (
                  <section>
                    <h4 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>⚠️ Risks</h4>
                    <div className="card" style={{ padding: "0.75rem 1rem" }}>
                      <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                        {state.selected.risks.map((r, i) => (
                          <li key={i} style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
