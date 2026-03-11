'use client';
import Link from 'next/link';
import { Conversation } from '@/lib/api';

interface ConversationListProps {
  conversations: Conversation[];
  onDelete?: (id: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ConversationList({ conversations, onDelete }: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🕘</div>
        <div className="empty-state-title">No conversations yet</div>
        <p style={{ fontSize: '0.85rem' }}>Start chatting to see history here.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {conversations.map((conv) => (
        <div key={conv.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link href={`/chat?conv=${conv.id}`} style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '0.9rem' }}>
              {conv.title || 'Untitled Conversation'}
            </Link>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              {conv.messages.length} messages · {timeAgo(conv.updated_at)}
            </div>
          </div>
          {onDelete && (
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => onDelete(conv.id)} title="Delete">
              🗑️
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
