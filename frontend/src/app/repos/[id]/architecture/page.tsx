"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ArchDiagram } from "@/components/ArchDiagram";
import { api, ArchResult, ApiEndpoint } from "@/lib/api";

export default function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    result: ArchResult | null;
    loading: boolean;
    error: string;
  }>({ result: null, loading: false, error: "" });

  const generate = async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await api.generateArchDocs(id);
      setState((s) => ({ ...s, result: data, loading: false }));
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }));
    }
  };

  return (
    <>
      <Header
        title="Architecture Docs"
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
                "🏗 Generate Docs"
              )}
            </button>
          </div>
        }
      />
      <div className="page">
        {!state.result && !state.loading && (
          <div className="empty-state">
            <div className="empty-state-icon">🏗</div>
            <div className="empty-state-title">No architecture docs yet</div>
            <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
              Click &quot;Generate Docs&quot; to analyse this repository.
            </p>
            <button className="btn btn-primary" onClick={generate}>
              Generate Architecture Docs
            </button>
          </div>
        )}

        {state.loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1rem",
              padding: "3rem",
            }}
          >
            <span
              className="spinner"
              style={{ width: 36, height: 36, borderWidth: 3 }}
            />
            <p style={{ color: "var(--text-secondary)" }}>
              Analysing repository and generating documentation…
            </p>
          </div>
        )}

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

        {state.result && (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "2rem" }}
          >
            {/* Summary */}
            <section>
              <h2
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  marginBottom: "0.75rem",
                }}
              >
                📋 Overview
              </h2>
              <div className="card">
                <p
                  style={{
                    fontSize: "0.9rem",
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {state.result.summary}
                </p>
              </div>
            </section>

            {/* Dependency graph */}
            <section>
              <h2
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  marginBottom: "0.75rem",
                }}
              >
                🔗 Module Dependency Graph
              </h2>
              <ArchDiagram chart={state.result.dependencyGraph} />
            </section>

            {/* API Endpoints */}
            {state.result.apiEndpoints?.length > 0 && (
              <section>
                <h2
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    marginBottom: "0.75rem",
                  }}
                >
                  🛣 API Endpoints
                </h2>
                <div
                  className="card"
                  style={{ padding: 0, overflow: "hidden" }}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>Path</th>
                        <th>File</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.result.apiEndpoints.map((ep: ApiEndpoint, i: number) => (
                        <tr key={i}>
                          <td>
                            <span
                              className={`badge ${ep.method === "GET" ? "badge-success" : ep.method === "POST" ? "badge-info" : ep.method === "DELETE" ? "badge-error" : "badge-warning"}`}
                            >
                              {ep.method}
                            </span>
                          </td>
                          <td>
                            <code style={{ fontSize: "0.83rem" }}>
                              {ep.path}
                            </code>
                          </td>
                          <td
                            style={{
                              color: "var(--text-muted)",
                              fontSize: "0.8rem",
                            }}
                          >
                            {ep.file}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Folder descriptions */}
            {state.result.folderDescriptions &&
              Object.keys(state.result.folderDescriptions).length > 0 && (
                <section>
                  <h2
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 700,
                      marginBottom: "0.75rem",
                    }}
                  >
                    📁 Folder Structure
                  </h2>
                  <div className="card">
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      {Object.entries(state.result.folderDescriptions).map(
                        ([folder, desc]: [string, string]) => (
                          <div
                            key={folder}
                            style={{
                              display: "flex",
                              gap: "0.75rem",
                              padding: "0.4rem 0",
                              borderBottom: "1px solid var(--border-subtle)",
                            }}
                          >
                            <code
                              style={{
                                fontSize: "0.82rem",
                                color: "var(--accent)",
                                minWidth: 160,
                                flexShrink: 0,
                              }}
                            >
                              {folder}/
                            </code>
                            <span
                              style={{
                                fontSize: "0.85rem",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {desc}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </section>
              )}

            {/* Raw Markdown */}
            <section>
              <h2
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  marginBottom: "0.75rem",
                }}
              >
                📄 Raw Markdown
              </h2>
              <div className="code-block">
                <div className="code-block-header">
                  <span>architecture.md</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      state.result && navigator.clipboard.writeText(state.result.markdown)
                    }
                  >
                    📋 Copy
                  </button>
                </div>
                <pre
                  style={{
                    padding: "1rem",
                    fontSize: "0.8rem",
                    overflowX: "auto",
                  }}
                >
                  <code>{state.result.markdown}</code>
                </pre>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
