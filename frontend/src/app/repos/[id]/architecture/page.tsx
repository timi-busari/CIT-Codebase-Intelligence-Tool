"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { ArchDiagram } from "@/components/ArchDiagram";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { api, ArchResult, ArchDocHistoryEntry } from "@/lib/api";

export default function ArchitecturePage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    result: ArchResult | null; loading: boolean; error: string;
    history: ArchDocHistoryEntry[]; selectedVersion: number | null;
    copied: boolean;
  }>({ result: null, loading: false, error: "", history: [], selectedVersion: null, copied: false });

  const loadHistory = async () => {
    try {
      const h = await api.getArchDocHistory(id);
      setState((s) => ({ ...s, history: h }));
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
          setState((s) => (s.result ? s : { ...s, result: { ...parsed, repoId: id }, selectedVersion: s.selectedVersion ?? latest.version }));
        } catch { /* ignore */ }
      }
    });
  }, [id]);

  const generate = async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await api.generateArchDocs(id);
      setState((s) => ({ ...s, result: data, loading: false, selectedVersion: null }));
      loadHistory();
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }));
    }
  };

  /** Parse stored markdown back into structured ArchResult fields */
  const parseMarkdown = (md: string): Omit<ArchResult, "repoId"> => {
    // Extract summary (between ## Overview and next ## or end)
    const summaryMatch = md.match(/## Overview\n([\s\S]*?)(?=\n## |$)/);
    const summary = summaryMatch ? summaryMatch[1].trim() : "";

    // Extract architecture diagram — handle various mermaid fence formats
    let architectureDiagram = "";
    const archSection = md.match(/## Architecture Diagram[\s\S]*?```(?:mermaid)?\s*\n([\s\S]*?)```/);
    if (archSection) {
      architectureDiagram = archSection[1].trim();
    } else {
      // Fallback: any mermaid block in the document
      const anyMermaid = md.match(/```mermaid\s*\n([\s\S]*?)```/);
      if (anyMermaid) architectureDiagram = anyMermaid[1].trim();
    }

    // Extract repo name from title
    const nameMatch = md.match(/# Architecture: (.+)/);
    const repoName = nameMatch ? nameMatch[1] : "";

    return { markdown: md, summary, architectureDiagram, repoName };
  };

  const viewVersion = async (version: number) => {
    try {
      const v = await api.getArchDocVersion(id, version);
      const parsed = parseMarkdown(v.content);
      setState((s) => ({
        ...s,
        result: { ...parsed, repoId: id },
        selectedVersion: version,
      }));
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const copyMarkdown = () => {
    if (!state.result) return;
    navigator.clipboard.writeText(state.result.markdown);
    setState((s) => ({ ...s, copied: true }));
    setTimeout(() => setState((s) => ({ ...s, copied: false })), 2000);
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
            {state.result && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={copyMarkdown}
                title="Copy as Markdown"
              >
                {state.copied ? "✓ Copied!" : "📋 Copy as Markdown"}
              </button>
            )}
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

            {/* Architecture Diagram */}
            <section>
              <h2
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  marginBottom: "0.75rem",
                }}
              >
                🏛 Architecture Diagram
              </h2>
              <ArchDiagram chart={state.result.architectureDiagram} />
            </section>
          </div>
        )}
      </div>
    </>
  );
}
