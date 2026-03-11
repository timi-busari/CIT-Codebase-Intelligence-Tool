'use client';
import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { ConversationList } from '@/components/ConversationList';
import { api, Conversation, Bookmark } from '@/lib/api';

export default function HistoryPage() {
  const [state, setState] = useState<{
    conversations: Conversation[];
    bookmarks: Bookmark[];
    search: string;
    tab: 'conversations' | 'bookmarks';
    loading: boolean;
  }>({ conversations: [], bookmarks: [], search: '', tab: 'conversations', loading: true });

  const load = async (q?: string) => {
    setState(s => ({ ...s, loading: true }));
    try {
      const [convs, bms] = await Promise.all([
        api.listConversations(q),
        api.listBookmarks(),
      ]);
      setState(s => ({ ...s, conversations: convs, bookmarks: bms }));
    } catch { /* ignore */ }
    finally { setState(s => ({ ...s, loading: false })); }
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (e: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    load(state.search);
  };

  const deleteConv = async (id: string) => {
    await api.deleteConversation(id);
    setState(s => ({ ...s, conversations: s.conversations.filter((c) => c.id !== id) }));
  };

  const deleteBookmark = async (id: string) => {
    await api.deleteBookmark(id);
    setState(s => ({ ...s, bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
  };

  return (
    <>
      <Header title="History & Bookmarks" />
      <div className="page">
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <button className={`btn ${state.tab === 'conversations' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setState(s => ({ ...s, tab: 'conversations' }))}>
            🕘 Conversations ({state.conversations.length})
          </button>
          <button className={`btn ${state.tab === 'bookmarks' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setState(s => ({ ...s, tab: 'bookmarks' }))}>
            ★ Bookmarks ({state.bookmarks.length})
          </button>
        </div>

        {state.tab === 'conversations' && (
          <>
            <form onSubmit={handleSearch} className="input-group" style={{ marginBottom: '1.25rem', maxWidth: 480 }}>
              <input
                className="input"
                placeholder="Search conversations…"
                value={state.search}
                onChange={(e) => setState(s => ({ ...s, search: e.target.value }))}
              />
              <button className="btn btn-primary" type="submit">Search</button>
              {state.search && <button className="btn btn-secondary" type="button" onClick={() => { setState(s => ({ ...s, search: '' })); load(); }}>Clear</button>}
            </form>
            {state.loading ? <div className="shimmer" style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div> : (
              <ConversationList conversations={state.conversations} onDelete={deleteConv} />
            )}
          </>
        )}

        {state.tab === 'bookmarks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {state.loading && <div className="shimmer" style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div>}
            {!state.loading && state.bookmarks.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">★</div>
                <div className="empty-state-title">No bookmarks yet</div>
                <p style={{ fontSize: '0.85rem' }}>Star answers in the chat to bookmark them.</p>
              </div>
            )}
            {state.bookmarks.map((bm) => (
              <div key={bm.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{bm.question}</strong>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => deleteBookmark(bm.id)}>🗑️</button>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{bm.answer.slice(0, 300)}{bm.answer.length > 300 ? '…' : ''}</p>
                {bm.tags?.length > 0 && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {bm.tags.map((t: string, i: number) => (
                      <span key={i} className="badge badge-info">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
