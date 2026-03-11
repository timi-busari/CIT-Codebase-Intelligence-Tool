'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Repo } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/chat/history', label: 'History', icon: '🕘' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [repos, setRepos] = useState<Repo[]>([]);

  useEffect(() => {
    api.listRepos().then(setRepos).catch(() => {});
    const id = setInterval(() => {
      api.listRepos().then(setRepos).catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-brand">⚡ CIT</span>
      </div>

      {/* Navigation */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Navigation</div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={`sidebar-nav-item${pathname === item.href ? ' active' : ''}`}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* Repositories */}
      <div className="sidebar-section" style={{ flex: 1, overflowY: 'auto' }}>
        <div className="sidebar-section-title">Repositories ({repos.length})</div>
        <nav className="sidebar-nav">
          {repos.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}>
              No repos yet — ingest one on the home page.
            </div>
          )}
          {repos.map((repo) => (
            <Link
              key={repo.id}
              href={`/repos/${repo.id}`}
              className={`sidebar-nav-item${pathname === `/repos/${repo.id}` ? ' active' : ''}`}
            >
              <span>{repo.status === 'done' ? '📦' : repo.status === 'error' ? '❌' : '⏳'}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.name}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <Link href="/settings" className="sidebar-nav-item" style={{ width: '100%' }}>
          <span>⚙️</span>
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
