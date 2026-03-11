'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { CodeBlock } from '@/components/CodeBlock';
import { api, FileNode, Repo } from '@/lib/api';

function FileTree({
  node,
  depth = 0,
  onSelect,
  selected,
}: {
  node: FileNode;
  depth?: number;
  onSelect: (n: FileNode) => void;
  selected?: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (node.type === 'file') {
    return (
      <div
        className={`file-tree-item${selected === node.path ? ' selected' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => onSelect(node)}
      >
        📄 {node.name}
      </div>
    );
  }
  return (
    <div>
      <div
        className="file-tree-item"
        style={{ paddingLeft: `${depth * 14 + 4}px`, fontWeight: 500 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '📂' : '📁'} {node.name}
      </div>
      {open && node.children?.map((child) => (
        <FileTree key={child.path} node={child} depth={depth + 1} onSelect={onSelect} selected={selected} />
      ))}
    </div>
  );
}

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<{
    repo: Repo | null;
    tree: FileNode | null;
    selectedFile: FileNode | null;
    fileContent: { content: string; language: string } | null;
    loading: boolean;
    fileLoading: boolean;
  }>({ repo: null, tree: null, selectedFile: null, fileContent: null, loading: true, fileLoading: false });

  useEffect(() => {
    async function load() {
      try {
        const [r, t] = await Promise.all([api.getRepo(id), api.getFileTree(id)]);
        setState(s => ({ ...s, repo: r, tree: t }));
      } catch { /* handle error */ }
      finally { setState(s => ({ ...s, loading: false })); }
    }
    load();
  }, [id]);

  const handleSelectFile = async (node: FileNode) => {
    if (node.type !== 'file') return;
    setState(s => ({ ...s, selectedFile: node, fileLoading: true }));
    try {
      const content = await api.getFileContent(id, node.path);
      setState(s => ({ ...s, fileContent: content, fileLoading: false }));
    } catch { setState(s => ({ ...s, fileContent: { content: 'Failed to load file.', language: 'text' }, fileLoading: false })); }
  };

  if (state.loading) return <><Header /><div className="page"><span className="spinner" /></div></>;
  if (!state.repo) return <><Header /><div className="page"><p style={{ color: 'var(--error)' }}>Repository not found.</p></div></>;

  return (
    <>
      <Header
        title={state.repo.name}
        actions={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link href="/chat" className="btn btn-secondary btn-sm">💬 Chat</Link>
            <Link href={`/repos/${id}/architecture`} className="btn btn-primary btn-sm">🏗 Architecture</Link>
          </div>
        }
      />
      <div style={{ display: 'flex', height: 'calc(100vh - var(--header-h))', overflow: 'hidden' }}>
        {/* File tree */}
        <div style={{ width: 260, borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', background: 'var(--bg-surface)', padding: '0.5rem 0' }}>
          <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Files
          </div>
          <div className="file-tree">
            {state.tree && state.tree.children?.map((node) => (
              <FileTree key={node.path} node={node} onSelect={handleSelectFile} selected={state.selectedFile?.path} />
            ))}
          </div>
        </div>

        {/* File content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {!state.selectedFile && (
            <div className="empty-state">
              <div className="empty-state-icon">📄</div>
              <div className="empty-state-title">Select a file to view its content</div>
              <p style={{ fontSize: '0.85rem' }}>
                Repo: <strong>{state.repo.name}</strong> · {state.repo.file_count} files · {state.repo.chunk_count} chunks
              </p>
            </div>
          )}
          {state.fileLoading && <span className="spinner" />}
          {!state.fileLoading && state.fileContent && state.selectedFile && (
            <CodeBlock
              code={state.fileContent.content}
              language={state.fileContent.language}
              fileName={state.selectedFile.path}
            />
          )}
        </div>
      </div>
    </>
  );
}
