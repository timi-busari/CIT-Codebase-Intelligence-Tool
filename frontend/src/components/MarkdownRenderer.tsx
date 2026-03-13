"use client";
import { useMemo, type ReactNode } from "react";
import { marked } from "marked";
import { CodeBlock } from "./CodeBlock";
import type { Citation } from "@/lib/api";

interface MarkdownRendererProps {
  content: string;
  citations?: Citation[];
  onCitationClick?: (index: number) => void;
}

export function MarkdownRenderer({
  content,
  citations,
  onCitationClick,
}: MarkdownRendererProps) {
  const tokens = useMemo(() => marked.lexer(content), [content]);

  function processText(text: string): ReactNode[] {
    if (!citations?.length || !onCitationClick) return [text];

    const parts: ReactNode[] = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const n = parseInt(match[1], 10);
      if (n < 1 || n > citations.length) {
        // Not a valid citation reference — keep as-is
        if (match.index > lastIndex)
          parts.push(text.slice(lastIndex, match.index));
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
        continue;
      }

      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      parts.push(
        <button
          key={`c${match.index}`}
          className="citation-marker-btn"
          onClick={() => onCitationClick(n - 1)}
          title={citations[n - 1].filePath}
        >
          [{n}]
        </button>,
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex === 0) return [text];
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderInline(tokens: any[]): ReactNode[] {
    return tokens.map((t, i) => {
      switch (t.type) {
        case "text":
          if (t.tokens) return <span key={i}>{renderInline(t.tokens)}</span>;
          return <span key={i}>{processText(t.text)}</span>;
        case "codespan":
          return (
            <code key={i} className="inline-code">
              {t.text}
            </code>
          );
        case "strong":
          return <strong key={i}>{renderInline(t.tokens ?? [])}</strong>;
        case "em":
          return <em key={i}>{renderInline(t.tokens ?? [])}</em>;
        case "del":
          return <del key={i}>{renderInline(t.tokens ?? [])}</del>;
        case "link":
          return (
            <a key={i} href={t.href} target="_blank" rel="noopener noreferrer">
              {t.tokens ? renderInline(t.tokens) : t.text}
            </a>
          );
        case "br":
          return <br key={i} />;
        default:
          return <span key={i}>{processText(t.raw ?? t.text ?? "")}</span>;
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderBlock(token: any, key: number): ReactNode {
    switch (token.type) {
      case "code":
        return (
          <CodeBlock
            key={key}
            code={token.text}
            language={token.lang || "text"}
          />
        );
      case "paragraph":
        return <p key={key}>{renderInline(token.tokens ?? [])}</p>;
      case "heading": {
        const Tag = `h${token.depth}` as
          | "h1"
          | "h2"
          | "h3"
          | "h4"
          | "h5"
          | "h6";
        return <Tag key={key}>{renderInline(token.tokens ?? [])}</Tag>;
      }
      case "list": {
        const ListTag = token.ordered ? "ol" : "ul";
        return (
          <ListTag key={key}>
            {token.items.map((item: any, i: number) => (
              <li key={i}>
                {item.tokens.map((t: any, j: number) => {
                  if (t.type === "text" && t.tokens) {
                    return <span key={j}>{renderInline(t.tokens)}</span>;
                  }
                  return renderBlock(t, j);
                })}
              </li>
            ))}
          </ListTag>
        );
      }
      case "blockquote":
        return (
          <blockquote key={key}>
            {(token.tokens ?? []).map((t: any, i: number) => renderBlock(t, i))}
          </blockquote>
        );
      case "hr":
        return <hr key={key} />;
      case "space":
        return null;
      default:
        if (token.tokens) return <p key={key}>{renderInline(token.tokens)}</p>;
        if (token.text) return <p key={key}>{processText(token.text)}</p>;
        return null;
    }
  }

  return (
    <div className="markdown-content">
      {tokens.map((token, i) => renderBlock(token, i))}
    </div>
  );
}
