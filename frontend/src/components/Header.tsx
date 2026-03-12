'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface HeaderProps {
  title?: React.ReactNode;
  actions?: React.ReactNode;
}

export function Header({ title, actions }: HeaderProps) {
  const pathname = usePathname();

  const breadcrumb = () => {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return 'Home';
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' / ');
  };

  return (
    <header className="header">
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
        {title ?? breadcrumb()}
      </span>
      {actions && <div className="header-nav">{actions}</div>}
    </header>
  );
}
