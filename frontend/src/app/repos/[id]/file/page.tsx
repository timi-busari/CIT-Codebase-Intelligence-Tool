"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Header } from "@/components/Header";
import { CodeBlock } from "@/components/CodeBlock";
import { api, FileNode, Repo } from "@/lib/api";

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
  if (node.type === "file") {
    return (
      <div
        className={`file-tree-item${selected === node.path ? " selected" : ""}`}
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
        {open ? "📂" : "📁"} {node.name}
      </div>
      {open &&
        node.children?.map((child) => (
          <FileTree
            key={child.path}
            node={child}
            depth={depth + 1}
            onSelect={onSelect}
            selected={selected}
          />
        ))}
    </div>
  );
}

export default function RepoFilePage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const filePath = searchParams.get("path");
  const lineNumber = searchParams.get("line");

  const [state, setState] = useState<{
    repo: Repo | null;
    tree: FileNode | null;
    selectedFile: FileNode | null;
    fileContent: { content: string; language: string } | null;
    loading: boolean;
    fileLoading: boolean;
  }>({
    repo: null,
    tree: null,
    selectedFile: null,
    fileContent: null,
    loading: true,
    fileLoading: false,
  });

  const handleSelectFile = useCallback(
    async (node: FileNode) => {
      if (node.type !== "file") return;
      setState((s) => ({ ...s, selectedFile: node, fileLoading: true }));
      try {
        const content = await api.getFileContent(id, node.path);
        setState((s) => ({ ...s, fileContent: content, fileLoading: false }));
      } catch {
        setState((s) => ({
          ...s,
          fileContent: { content: "Failed to load file.", language: "text" },
          fileLoading: false,
        }));
      }
    },
    [id],
  );

  useEffect(() => {
    // Find a file node in the tree by path
    const findFileInTree = (tree: FileNode, path: string): FileNode | null => {
      if (tree.path === path && tree.type === "file") {
        return tree;
      }

      if (tree.children) {
        for (const child of tree.children) {
          const found = findFileInTree(child, path);
          if (found) return found;
        }
      }

      return null;
    };

    async function load() {
      try {
        const [r, t] = await Promise.all([
          api.getRepo(id),
          api.getFileTree(id),
        ]);
        setState((s) => ({ ...s, repo: r, tree: t }));

        // If there's a file path in the URL, automatically load that file
        if (filePath && t) {
          const fileNode = findFileInTree(t, filePath);
          if (fileNode) {
            handleSelectFile(fileNode);
          }
        }
      } catch {
        // Handle error
      } finally {
        setState((s) => ({ ...s, loading: false }));
      }
    }
    load();
  }, [id, filePath, handleSelectFile]);

  if (state.loading)
    return (
      <>
        <Header />
        <div className="page">
          <span className="spinner" />
        </div>
      </>
    );
  if (!state.repo)
    return (
      <>
        <Header />
        <div className="page">
          <p style={{ color: "var(--error)" }}>Repository not found.</p>
        </div>
      </>
    );

  return (
    <>
      <Header
        title={
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Link href={`/repos/${id}`} className="breadcrumb-link">
              {state.repo.name}
            </Link>
            {state.selectedFile && (
              <>
                <span style={{ color: "var(--text-muted)" }}>/</span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {state.selectedFile.path}
                </span>
              </>
            )}
          </div>
        }
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link href="/chat" className="btn btn-secondary btn-sm">
              💬 Chat
            </Link>
            <Link
              href={`/repos/${id}/architecture`}
              className="btn btn-primary btn-sm"
            >
              🏗 Architecture
            </Link>
          </div>
        }
      />
      <div
        style={{
          display: "flex",
          height: "calc(100vh - var(--header-h))",
          overflow: "hidden",
        }}
      >
        {/* File tree */}
        <div
          style={{
            width: 260,
            borderRight: "1px solid var(--border-subtle)",
            overflowY: "auto",
            background: "var(--bg-surface)",
            padding: "0.5rem 0",
          }}
        >
          <div
            style={{
              padding: "0.5rem 0.75rem",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            Files
          </div>
          <div className="file-tree">
            {state.tree &&
              state.tree.children?.map((node) => (
                <FileTree
                  key={node.path}
                  node={node}
                  onSelect={handleSelectFile}
                  selected={state.selectedFile?.path}
                />
              ))}
          </div>
        </div>

        {/* File content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem" }}>
          {!state.selectedFile && !filePath && (
            <div className="empty-state">
              <div className="empty-state-icon">📄</div>
              <div className="empty-state-title">
                Select a file to view its content
              </div>
              <p style={{ fontSize: "0.85rem" }}>
                Repo: <strong>{state.repo.name}</strong> ·{" "}
                {state.repo.file_count} files · {state.repo.chunk_count} chunks
              </p>
            </div>
          )}

          {filePath && !state.selectedFile && !state.fileLoading && (
            <div className="empty-state">
              <div
                className="empty-state-icon"
                style={{ color: "var(--error)" }}
              >
                ❌
              </div>
              <div className="empty-state-title">File not found</div>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                The file <code>{filePath}</code> could not be found in this
                repository.
              </p>
              <Link
                href={`/repos/${id}`}
                className="btn btn-secondary btn-sm"
                style={{ marginTop: "1rem" }}
              >
                ← Back to repository
              </Link>
            </div>
          )}

          {state.fileLoading && <span className="spinner" />}

          {!state.fileLoading && state.fileContent && state.selectedFile && (
            <div>
              {lineNumber && (
                <div className="line-highlight-notice">
                  <span className="highlight-icon">🎯</span>
                  <span>Showing line {lineNumber}</span>
                </div>
              )}
              <CodeBlock
                code={state.fileContent.content}
                language={state.fileContent.language}
                fileName={state.selectedFile.path}
                highlightLine={lineNumber ? parseInt(lineNumber) : undefined}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
