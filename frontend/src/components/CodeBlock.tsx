'use client';
import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';

interface CodeBlockProps {
  code: string;
  language?: string;
  fileName?: string;
  highlightLine?: number;
}

// Language mapping for shiki
const SHIKI_LANG_MAP: Record<string, string> = {
  'typescript': 'typescript',
  'javascript': 'javascript',
  'jsx': 'jsx',
  'tsx': 'tsx',
  'python': 'python',
  'go': 'go',
  'rust': 'rust',
  'java': 'java',
  'ruby': 'ruby',
  'php': 'php',
  'c': 'c',
  'cpp': 'cpp',
  'csharp': 'csharp',
  'css': 'css',
  'scss': 'scss',
  'html': 'html',
  'json': 'json',
  'yaml': 'yaml',
  'toml': 'toml',
  'sql': 'sql',
  'bash': 'bash',
  'shell': 'bash',
  'markdown': 'markdown',
  'vue': 'vue',
  'svelte': 'svelte',
};

export function CodeBlock({ code, language = 'text', fileName, highlightLine }: CodeBlockProps) {
  const [state, setState] = useState<{
    highlightedCode: string;
    copied: boolean;
    loading: boolean;
  }>({
    highlightedCode: '',
    copied: false,
    loading: true,
  });

  useEffect(() => {
    async function highlight() {
      if (!code) {
        setState((s) => ({ ...s, highlightedCode: '', loading: false }));
        return;
      }

      try {
        // Map language to shiki supported language
        const shikiLang = SHIKI_LANG_MAP[language.toLowerCase()] || 'text';
        
        const html = await codeToHtml(code, {
          lang: shikiLang === 'text' ? 'plaintext' : shikiLang,
          theme: 'one-dark-pro',
          transformers: [
            {
              pre(node) {
                // Add line numbers and line highlighting
                this.addClassToHast(node, 'shiki-code-block');
              },
              line(node, line) {
                // Highlight specific line if specified
                if (highlightLine && line === highlightLine) {
                  this.addClassToHast(node, 'highlight-line');
                }
              },
            },
          ],
        });
        
        setState((s) => ({ ...s, highlightedCode: html }));
      } catch (error) {
        // Fallback for unsupported languages
        console.warn(`Failed to highlight code with language ${language}:`, error);
        setState((s) => ({ ...s, highlightedCode: `<pre class="shiki-fallback"><code>${escapeHtml(code)}</code></pre>` }));
      } finally {
        setState((s) => ({ ...s, loading: false }));
      }
    }

    setState((s) => ({ ...s, loading: true }));
    highlight();
  }, [code, language, highlightLine]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setState((s) => ({ ...s, copied: true }));
    setTimeout(() => setState((s) => ({ ...s, copied: false })), 2000);
  };

  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-filename">
          {fileName && <span className="file-icon">📄</span>}
          {fileName || `${language} code`}
        </span>
        <div className="code-block-actions">
          {language && language !== 'text' && (
            <span className="language-badge">{language}</span>
          )}
          <button 
            className="btn btn-ghost btn-sm btn-icon" 
            onClick={copy} 
            title="Copy code"
          >
            {state.copied ? '✓' : '📋'}
          </button>
        </div>
      </div>
      <div className="code-content">
        {state.loading ? (
          <div className="code-loading">
            <span className="spinner" />
            <span>Loading syntax highlighting...</span>
          </div>
        ) : (
          <div 
            className="shiki-container"
            dangerouslySetInnerHTML={{ __html: state.highlightedCode }}
          />
        )}
      </div>
    </div>
  );
}
