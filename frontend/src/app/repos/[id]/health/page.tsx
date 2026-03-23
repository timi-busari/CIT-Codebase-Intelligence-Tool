"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/Header";
import { api, HealthReport, FileMetric } from "@/lib/api";

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "1rem" }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--accent)" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", fontWeight: 600, marginTop: "0.25rem" }}>{label}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>{sub}</div>}
    </div>
  );
}

function FileMetricTable({ title, icon, files }: { title: string; icon: string; files: FileMetric[] }) {
  if (!files?.length) return null;
  return (
    <section>
      <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{icon} {title}</h3>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>LOC</th>
              <th>Functions</th>
              <th>Complexity</th>
              <th>TODOs</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.filePath}>
                <td><code style={{ fontSize: "0.8rem" }}>{f.filePath}</code></td>
                <td>{f.loc}</td>
                <td>{f.functionCount}</td>
                <td>{f.cyclomaticComplexity}</td>
                <td>{f.todoCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function HealthPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    report: HealthReport | null;
    loading: boolean;
    computing: boolean;
    error: string;
  }>({
    report: null,
    loading: false,
    computing: false,
    error: "",
  });

  const loadReport = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await api.getHealth(id);
      setState((s) => ({ ...s, report: r }));
    } catch {
      /* no report yet */
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  };

  useEffect(() => {
    loadReport();
  }, [id]);

  const compute = async () => {
    setState((s) => ({ ...s, computing: true, error: "" }));
    try {
      await api.computeHealth(id);
      await loadReport();
    } catch (err: unknown) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setState((s) => ({ ...s, computing: false }));
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#eab308";
    return "#ef4444";
  };

  return (
    <>
      <Header
        title="Code Health"
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link href={`/repos/${id}`} className="btn btn-secondary btn-sm">← Repo</Link>
            <button className="btn btn-primary btn-sm" onClick={compute} disabled={state.computing}>
              {state.computing ? (<><span className="spinner" /> Analyzing…</>) : "🩺 Compute Health"}
            </button>
          </div>
        }
      />
      <div className="page">
        {state.error && (
          <div style={{ color: "var(--error)", background: "rgba(239,68,68,0.08)", padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", marginBottom: "1rem" }}>
            {state.error}
          </div>
        )}

        {(state.loading || state.computing) && !state.report && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem" }}>
            <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
            <p style={{ color: "var(--text-secondary)" }}>
              {state.computing ? "Analyzing codebase…" : "Loading report…"}
            </p>
          </div>
        )}

        {!state.report && !state.loading && !state.computing && (
          <div className="empty-state">
            <div className="empty-state-icon">🩺</div>
            <div className="empty-state-title">No health report yet</div>
            <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
              Click &quot;Compute Health&quot; to analyze code quality metrics.
            </p>
            <button className="btn btn-primary" onClick={compute}>Compute Health</button>
          </div>
        )}

        {state.report && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem" }}>
              <MetricCard
                label="Health Score"
                value={state.report.healthScore}
                sub={state.report.healthScore >= 80 ? "Good" : state.report.healthScore >= 60 ? "Fair" : "Needs work"}
              />
              <MetricCard label="Total Files" value={state.report.totalFiles} />
              <MetricCard label="Total LOC" value={state.report.totalLoc.toLocaleString()} />
              <MetricCard label="Avg Complexity" value={state.report.avgComplexity.toFixed(1)} />
            </div>

            {/* Health score bar */}
            <div className="card" style={{ padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Overall Health</span>
                <span style={{ fontWeight: 700, color: scoreColor(state.report.healthScore) }}>{state.report.healthScore}/100</span>
              </div>
              <div style={{ background: "var(--bg-tertiary)", borderRadius: 8, height: 12, overflow: "hidden" }}>
                <div style={{ width: `${state.report.healthScore}%`, height: "100%", background: scoreColor(state.report.healthScore), borderRadius: 8, transition: "width 0.5s" }} />
              </div>
            </div>

            {/* LOC Distribution */}
            {state.report.locDistribution?.length > 0 && (
              <section>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>📊 LOC Distribution</h3>
                <div className="card">
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {state.report.locDistribution.map((d) => (
                      <div key={d.bracket} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <span style={{ fontSize: "0.8rem", minWidth: 100 }}>{d.bracket}</span>
                        <div style={{ flex: 1, background: "var(--bg-tertiary)", borderRadius: 4, height: 18, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min((d.count / (state.report?.totalFiles ?? 1)) * 100, 100)}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", minWidth: 30, textAlign: "right" }}>{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <FileMetricTable title="Most Complex Files" icon="🔴" files={state.report.topComplexFiles} />
            <FileMetricTable title="Largest Files" icon="📏" files={state.report.largestFiles} />
            <FileMetricTable title="TODO Hotspots" icon="📝" files={state.report.todoHotspots} />
          </div>
        )}
      </div>
    </>
  );
}
