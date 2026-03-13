"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ArchDiagram } from "@/components/ArchDiagram";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { api, ArchResult, ApiEndpoint, ArchDocHistoryEntry } from "@/lib/api";

export default function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    result: ArchResult | null;
    loading: boolean;
    error: string;
  }>({ result: null, loading: false, error: "" });
  const [history, setHistory] = useState<ArchDocHistoryEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const loadHistory = async () => {
    try {
      const h = await api.getArchDocHistory(id);
      setHistory(h);
      return h;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    // Load history and auto-display the latest version
    loadHistory().then(async (h) => {
      if (h.length > 0) {
        try {
          const latest = h[0];
          const v = await api.getArchDocVersion(id, latest.version);
          const parsed = parseMarkdown(v.content);
          setState((s) => (s.result ? s : { ...s, result: { ...parsed, repoId: id } }));
          setSelectedVersion((prev) => prev ?? latest.version);
        } catch { /* ignore */ }
      }
    });
  }, [id]);

  const generate = async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await api.generateArchDocs(id);
      setState((s) => ({ ...s, result: data, loading: false }));
      loadHistory();
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }));
    }
  };

  /** Parse stored markdown back into structured ArchResult fields */
  const parseMarkdown = (md: string): Omit<ArchResult, "repoId"> => {
    // Extract summary (between ## Overview and next ##)
    const summaryMatch = md.match(/## Overview\n([\s\S]*?)(?=\n## )/);
    const summary = summaryMatch ? summaryMatch[1].trim() : "";

    // Extract mermaid diagram
    const mermaidMatch = md.match(/```mermaid\n([\s\S]*?)```/);
    const dependencyGraph = mermaidMatch ? mermaidMatch[1].trim() : "";

    // Extract API endpoints from markdown table
    const apiEndpoints: ApiEndpoint[] = [];
    const tableMatch = md.match(/## API Endpoints\n([\s\S]*?)(?=\n## |$)/);
    if (tableMatch) {
      const rows = tableMatch[1].trim().split("\n").filter((r) => r.startsWith("|") && !r.includes("---"));
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 3) {
          apiEndpoints.push({
            method: cells[0].replace(/`/g, ""),
            path: cells[1].replace(/`/g, ""),
            file: cells[2].replace(/`/g, ""),
          });
        }
      }
    }

    // Extract repo name from title
    const nameMatch = md.match(/# Architecture: (.+)/);
    const repoName = nameMatch ? nameMatch[1] : "";

    return { markdown: md, summary, dependencyGraph, apiEndpoints, repoName };
  };

  const viewVersion = async (version: number) => {
    try {
      const v = await api.getArchDocVersion(id, version);
      const parsed = parseMarkdown(v.content);
      setState((s) => ({
        ...s,
        result: { ...parsed, repoId: id },
      }));
      setSelectedVersion(version);
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
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
        {history.length > 0 && (
          <section style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Version History
            </h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {history.map((h) => (
                <button
                  key={h.version}
                  className={`btn btn-sm ${selectedVersion === h.version ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => viewVersion(h.version)}
                >
                  v{h.version} — {new Date(h.generatedAt).toLocaleDateString()}
                </button>
              ))}
            </div>
          </section>
        )}

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
              <div className="card" style={{ padding: "1rem" }}>
                <MarkdownRenderer content={state.result.summary} />
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
