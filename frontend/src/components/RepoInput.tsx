'use client';
import { useState, useEffect } from 'react';
import { api, JobStatus } from '@/lib/api';

interface RepoInputProps {
  onIngested?: (repoId: string) => void;
}

export function RepoInput({ onIngested }: RepoInputProps) {
  const [state, setState] = useState<{
    url: string; name: string; isPrivate: boolean; token: string;
    loading: boolean; jobId: string | null; status: JobStatus | null; error: string;
  }>({ url: '', name: '', isPrivate: false, token: '', loading: false, jobId: null, status: null, error: '' });

  useEffect(() => {
    const saved = localStorage.getItem('github_pat') ?? '';
    if (saved) {
      setState(s => ({ ...s, token: saved, isPrivate: true }));
    }
  }, []);

  useEffect(() => {
    if (!state.jobId) return;
    const id = setInterval(async () => {
      try {
        const s = await api.getJob(state.jobId!);
        setState(prev => ({ ...prev, status: s }));
        if (s.status === 'completed') {
          clearInterval(id);
          setState(prev => ({ ...prev, loading: false, jobId: null, url: '', name: '' }));
          onIngested?.(s.repoId);
        } else if (s.status === 'failed') {
          clearInterval(id);
          setState(prev => ({ ...prev, loading: false, error: s.error ?? 'Ingestion failed' }));
        }
      } catch { /* poll silently */ }
    }, 1500);
    return () => clearInterval(id);
  }, [state.jobId, onIngested]);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    if (!state.url.trim()) return;
    setState(s => ({ ...s, error: '', loading: true, status: null }));
    try {
      const res = await api.ingest(state.url.trim(), state.name.trim() || undefined, state.isPrivate ? (state.token.trim() || undefined) : undefined);
      setState(s => ({ ...s, jobId: res.jobId }));
    } catch (err: unknown) {
      setState(s => ({ ...s, error: err instanceof Error ? err.message : String(err), loading: false }));
    }
  };

  const progress = state.status?.progress ?? 0;
  const phase = state.status?.phase ?? state.status?.status ?? '';
  const statusLabel: Record<string, string> = {
    queued: 'Queued…',
    cloning: 'Cloning repository…',
    filtering: 'Scanning files…',
    chunking: `Parsing files (${state.status?.processedFiles ?? 0}/${state.status?.totalFiles ?? '?'})…`,
    embedding: `Generating embeddings (${state.status?.processedFiles ?? 0}/${state.status?.totalFiles ?? '?'})…`,
    complete: 'Done!',
  };

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Ingest a GitHub Repository</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Paste a GitHub URL to clone, parse, and embed the codebase. Enable the toggle below for private repos.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <input
          className="input"
          type="url"
          placeholder="https://github.com/owner/repo"
          value={state.url}
          onChange={(e) => setState(s => ({ ...s, url: e.target.value }))}
          disabled={state.loading}
          required
        />
        <input
          className="input"
          type="text"
          placeholder="Display name (optional)"
          value={state.name}
          onChange={(e) => setState(s => ({ ...s, name: e.target.value }))}
          disabled={state.loading}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={state.isPrivate}
            onChange={(e) => setState(s => ({ ...s, isPrivate: e.target.checked }))}
            disabled={state.loading}
          />
          Private repository (requires PAT)
        </label>
        {state.isPrivate && (
          <input
            className="input"
            type="password"
            placeholder="GitHub Personal Access Token (ghp_…)"
            value={state.token}
            onChange={(e) => setState(s => ({ ...s, token: e.target.value }))}
            disabled={state.loading}
          />
        )}
        <button className="btn btn-primary" type="submit" disabled={state.loading || !state.url.trim()}>
          {state.loading ? <><span className="spinner" />Processing…</> : '🚀 Ingest Repository'}
        </button>
      </form>

      {state.loading && state.status && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>{statusLabel[phase] ?? phase}</span>
            <span>{progress}%</span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {state.error && (
        <div style={{ marginTop: '0.75rem', color: 'var(--error)', fontSize: '0.85rem', padding: '0.5rem', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)' }}>
          {state.error}
        </div>
      )}
    </div>
  );
}
