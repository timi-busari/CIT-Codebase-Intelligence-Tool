"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { api, ArchDocHistoryEntry, ArchDocVersion } from "@/lib/api";

export default function OnboardingPage() {
  const { id } = useParams<{ id: string }>();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ArchDocHistoryEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const loadHistory = async () => {
    try {
      const h = await api.getOnboardingHistory(id);
      setHistory(h);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadHistory();
  }, [id]);

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.generateOnboarding(id);
      setContent(result.markdown);
      loadHistory();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const viewVersion = async (version: number) => {
    try {
      const v = await api.getOnboardingVersion(id, version);
      setContent(v.content);
      setSelectedVersion(version);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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
              disabled={loading}
            >
              {loading ? (
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
        {error && (
          <div
            style={{
              color: "var(--error)",
              background: "rgba(239,68,68,0.08)",
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius-sm)",
              marginBottom: "1rem",
            }}
          >
            {error}
          </div>
        )}

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

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem" }}>
            <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
            <p style={{ color: "var(--text-secondary)" }}>
              Analysing repository and generating onboarding guide…
            </p>
          </div>
        )}

        {!content && !loading && (
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

        {content && !loading && (
          <div className="card" style={{ padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>onboarding-guide.md</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigator.clipboard.writeText(content)}
              >
                📋 Copy
              </button>
            </div>
            <MarkdownRenderer content={content} />
          </div>
        )}
      </div>
    </>
  );
}
