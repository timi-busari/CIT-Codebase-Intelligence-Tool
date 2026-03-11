'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { RepoInput } from '@/components/RepoInput';
import { api, Repo } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<{ repos: Repo[]; loading: boolean }>({ repos: [], loading: true });

  const loadRepos = useCallback(async () => {
    try {
      const data = await api.listRepos();
      setState(s => ({ ...s, repos: data }));
    } catch { /* backend may not be up yet */ }
    finally { setState(s => ({ ...s, loading: false })); }
  }, []);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  const handleIngested = (repoId: string) => {
    loadRepos();
    router.push(`/repos/${repoId}`);
  };

  const handleDeleteRepo = async (e: React.MouseEvent, repoId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this repository? This cannot be undone.')) return;
    try {
      await api.deleteRepo(repoId);
      setState(s => ({ ...s, repos: s.repos.filter((r) => r.id !== repoId) }));
    } catch { /* silent — backend still removes it */ }
  };

  const statusColor: Record<string, string> = {
    done: 'var(--success)',
    error: 'var(--error)',
    pending: 'var(--text-muted)',
    cloning: 'var(--warning)',
    parsing: 'var(--warning)',
    embedding: 'var(--info)',
  };

  return (
    <>
      <Header title="Home" />
      <div className="page">
        {/* Hero */}
        <div style={{ marginBottom: '2.5rem' }}>
          <h1 className="page-title" style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>
            ⚡ Codebase Intelligence Tool
          </h1>
          <p className="page-subtitle" style={{ fontSize: '1rem', maxWidth: 560 }}>
            Ingest any GitHub repository, auto-generate architecture docs, and chat with your
            codebase using semantic search + GPT.
          </p>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          <Link href="/chat" className="btn btn-primary">💬 Open Chat</Link>
          <Link href="/chat/history" className="btn btn-secondary">🕘 View History</Link>
        </div>

        {/* Ingest form */}
        <div style={{ marginBottom: '2.5rem' }}>
          <RepoInput onIngested={handleIngested} />
        </div>

        {/* Repositories */}
        <section>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            Ingested Repositories ({state.repos.length})
          </h2>
          {state.loading && <div className="shimmer" style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div>}
          {!state.loading && state.repos.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📦</div>
              <div className="empty-state-title">No repositories ingested yet</div>
              <p style={{ fontSize: '0.85rem' }}>Paste a GitHub URL above to get started.</p>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {state.repos.map((repo) => (
              <Link key={repo.id} href={`/repos/${repo.id}`} style={{ textDecoration: 'none' }}>
                <div className="card" style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{repo.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ fontSize: '0.72rem', color: statusColor[repo.status] ?? 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                        {repo.status}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        title="Delete repository"
                        onClick={(e) => handleDeleteRepo(e, repo.id)}
                        style={{ fontSize: '0.8rem' }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {repo.url}
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    <span>📄 {repo.file_count} files</span>
                    <span>🔷 {repo.chunk_count} chunks</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

