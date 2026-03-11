'use client';
import { useEffect, useRef, useState } from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
  fileName?: string;
}

export function CodeBlock({ code, language = 'text', fileName }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function highlight() {
      if (!codeRef.current || !code) return;
      try {
        const hljs = (await import('highlight.js')).default;
        if (language && language !== 'text' && hljs.getLanguage(language)) {
          codeRef.current.innerHTML = hljs.highlight(code, { language }).value;
        } else {
          codeRef.current.textContent = code;
        }
      } catch {
        if (codeRef.current) codeRef.current.textContent = code;
      }
    }
    highlight();
  }, [code, language]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{fileName ?? language}</span>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={copy} title="Copy">
          {copied ? '✓ Copied' : '📋'}
        </button>
      </div>
      <pre>
        <code ref={codeRef} className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}
