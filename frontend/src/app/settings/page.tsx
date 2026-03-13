'use client';
import { useState } from 'react';
import { Header } from '@/components/Header';

function getInitialSettings() {
  if (typeof window === 'undefined') return { apiKey: '', saved: false, ghToken: '', ghSaved: false };
  return {
    apiKey: localStorage.getItem('openai_api_key') ?? '',
    saved: false,
    ghToken: localStorage.getItem('github_pat') ?? '',
    ghSaved: false,
  };
}

export default function SettingsPage() {
  const [state, setState] = useState(getInitialSettings);

  const save = () => {
    localStorage.setItem('openai_api_key', state.apiKey);
    setState(s => ({ ...s, saved: true }));
    setTimeout(() => setState(s => ({ ...s, saved: false })), 2000);
  };

  const saveGhToken = () => {
    if (state.ghToken.trim()) {
      localStorage.setItem('github_pat', state.ghToken.trim());
    } else {
      localStorage.removeItem('github_pat');
    }
    setState(s => ({ ...s, ghSaved: true }));
    setTimeout(() => setState(s => ({ ...s, ghSaved: false })), 2000);
  };

  return (
    <>
      <Header title="Settings" />
      <div className="page">
        <h1 className="page-title" style={{ marginBottom: '1.5rem' }}>Settings</h1>
        <div className="card" style={{ maxWidth: 480 }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>OpenAI API Key</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Your API key is stored locally in your browser and sent with each query. It is never stored on the server.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              className="input"
              type="password"
              placeholder="sk-…"
              value={state.apiKey}
              onChange={(e) => setState(s => ({ ...s, apiKey: e.target.value }))}
            />
            <button className="btn btn-primary" onClick={save} disabled={!state.apiKey.trim()}>
              {state.saved ? '✓ Saved!' : 'Save Key'}
            </button>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 480, marginTop: '1rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>GitHub Personal Access Token</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Required for ingesting private repositories. Stored locally in your browser and never sent to the server directly — used only at clone time, then discarded.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              className="input"
              type="password"
              placeholder="ghp_…"
              value={state.ghToken}
              onChange={(e) => setState(s => ({ ...s, ghToken: e.target.value }))}
            />
            <button className="btn btn-primary" onClick={saveGhToken}>
              {state.ghSaved ? '✓ Saved!' : 'Save Token'}
            </button>
            {state.ghToken && (
              <button
                className="btn"
                style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
                onClick={() => { setState(s => ({ ...s, ghToken: '' })); localStorage.removeItem('github_pat'); }}
              >
                Clear Token
              </button>
            )}
          </div>
        </div>

        <div className="card" style={{ maxWidth: 480, marginTop: '1rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>Backend URL</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Backend API: <code style={{ color: 'var(--accent)' }}>{process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001'}</code>
          </p>
        </div>
      </div>
    </>
  );
}
