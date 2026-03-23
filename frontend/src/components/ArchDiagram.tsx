"use client";
import { useEffect, useRef } from "react";

interface ArchDiagramProps {
  chart?: string;
  title?: string;
}

export function ArchDiagram({ chart, title }: ArchDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!containerRef.current) return;
      const normalized = (chart ?? "").trim();
      if (!normalized) {
        containerRef.current.innerHTML =
          '<span style="color: var(--text-muted); font-size:0.85rem">No architecture diagram was generated for this version.</span>';
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          theme: "dark",
          startOnLoad: false,
          securityLevel: "loose",
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, normalized);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        console.error("Mermaid render error", err);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = `<pre style="color: var(--error); font-size:0.8rem">${normalized}</pre>`;
        }
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div>
      {title && (
        <h3
          style={{
            marginBottom: "0.75rem",
            fontSize: "0.9rem",
            color: "var(--text-secondary)",
          }}
        >
          {title}
        </h3>
      )}
      <div className="mermaid-container" ref={containerRef}>
        <span
          className="shimmer"
          style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}
        >
          Rendering diagram…
        </span>
      </div>
    </div>
  );
}
