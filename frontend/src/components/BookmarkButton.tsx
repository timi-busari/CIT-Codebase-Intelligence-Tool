'use client';
import { useState } from 'react';
import { api, Citation } from '@/lib/api';

interface BookmarkButtonProps {
  question: string;
  answer: string;
  sources?: Citation[];
  repoIds?: string[];
  conversationId?: string;
}

export function BookmarkButton({ question, answer, sources, repoIds, conversationId }: BookmarkButtonProps) {
  const [state, setState] = useState({ saved: false, loading: false });

  const save = async () => {
    if (state.saved || state.loading) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      await api.createBookmark({ question, answer, sources, repoIds, conversationId });
      setState({ saved: true, loading: false });
    } catch { setState((s) => ({ ...s, loading: false })); }
  };

  return (
    <button
      className="btn btn-ghost btn-sm btn-icon"
      onClick={save}
      disabled={state.loading || state.saved}
      title={state.saved ? 'Bookmarked!' : 'Bookmark this answer'}
      style={{ color: state.saved ? 'var(--warning)' : undefined }}
    >
      {state.loading ? <span className="spinner" /> : state.saved ? '★' : '☆'}
    </button>
  );
}
