import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';

export interface CodeChunk {
  content: string;
  filePath: string;
  language: string;
  chunkType: 'function' | 'class' | 'heading' | 'window';
  startLine: number;
  endLine: number;
}

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

const WINDOW_TOKENS = 512;
const WINDOW_OVERLAP = 64;

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  async chunkFile(filePath: string, content: string): Promise<CodeChunk[]> {
    const ext = path.extname(filePath).toLowerCase();
    const language = LANG_MAP[ext] || 'text';

    if (content.trim().length === 0) return [];

    if (language === 'markdown') {
      return this.chunkMarkdown(filePath, content);
    }

    if (['typescript', 'javascript', 'python'].includes(language)) {
      const blocks = this.chunkByTopLevelBlocks(filePath, content, language);
      // Prepend a file-header summary chunk listing all imports + exported
      // symbol names. This makes inter-service wiring (e.g. HTTPHelper imports,
      // service URL references) always retrievable independent of which block
      // they appear in.
      const header = this.extractFileHeader(filePath, content, language);
      return header ? [header, ...blocks] : blocks;
    }

    return this.slidingWindowChunk(filePath, content, language);
  }

  // ── File header: imports + exported symbol signatures ───────────────────
  private extractFileHeader(
    filePath: string,
    content: string,
    language: string,
  ): CodeChunk | null {
    const lines = content.split('\n');
    const headerLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (language === 'python') {
        if (/^(import |from |class |def |async def )/.test(trimmed))
          headerLines.push(line);
      } else {
        // import / require statements
        if (
          /^import\s/.test(trimmed) ||
          /^(const|let|var)\s+\S+\s*=\s*require\s*\(/.test(trimmed)
        )
          headerLines.push(line);
        // top-level export / class / function signatures (first line only)
        else if (
          /^(export\s+|@\w)/.test(trimmed) ||
          /^(class|function|const|type|interface|enum)\s/.test(trimmed)
        )
          headerLines.push(line);
      }
    }

    if (headerLines.length < 3) return null;

    return {
      content: `// ${filePath} — imports & exports\n${headerLines.join('\n')}`,
      filePath,
      language,
      chunkType: 'function',
      startLine: 1,
      endLine: lines.length,
    };
  }

  // ── Markdown: split on headings ──────────────────────────────────────────
  private chunkMarkdown(filePath: string, content: string): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    let buffer: string[] = [];
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isHeading = /^#{1,3}\s/.test(line);

      if (isHeading && buffer.length > 0) {
        const text = buffer.join('\n').trim();
        if (text) {
          chunks.push({
            content: text,
            filePath,
            language: 'markdown',
            chunkType: 'heading',
            startLine,
            endLine: i,
          });
        }
        buffer = [];
        startLine = i + 1;
      }
      buffer.push(line);
    }

    if (buffer.length > 0) {
      const text = buffer.join('\n').trim();
      if (text) {
        chunks.push({
          content: text,
          filePath,
          language: 'markdown',
          chunkType: 'heading',
          startLine,
          endLine: lines.length,
        });
      }
    }

    return chunks.length > 0
      ? chunks
      : this.slidingWindowChunk(filePath, content, 'markdown');
  }

  // ── JS/TS/Python: naive top-level block split ─────────────────────────────
  private chunkByTopLevelBlocks(
    filePath: string,
    content: string,
    language: string,
  ): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    let buffer: string[] = [];
    let startLine = 1;

    const isBlockStart = (line: string): boolean => {
      if (language === 'python') {
        return /^(def |class |async def )\S/.test(line);
      }
      return /^(export\s+)?(default\s+)?(async\s+)?(function|class|const\s+\w+\s*=\s*(async\s+)?\(|const\s+\w+\s*=\s*(async\s+)?function)\b/.test(
        line.trimStart(),
      );
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i > 0 && isBlockStart(line) && buffer.length > 10) {
        const text = buffer.join('\n').trim();
        if (text) {
          chunks.push({
            content: text,
            filePath,
            language,
            chunkType: 'function',
            startLine,
            endLine: i,
          });
        }
        buffer = [];
        startLine = i + 1;
      }
      buffer.push(line);
    }

    if (buffer.length > 0) {
      const text = buffer.join('\n').trim();
      if (text) {
        chunks.push({
          content: text,
          filePath,
          language,
          chunkType: 'function',
          startLine,
          endLine: lines.length,
        });
      }
    }

    // If no real blocks found, fall back to sliding window
    if (chunks.length <= 1 && content.split('\n').length > WINDOW_TOKENS) {
      return this.slidingWindowChunk(filePath, content, language);
    }

    return chunks;
  }

  // ── Sliding window fallback ───────────────────────────────────────────────
  private slidingWindowChunk(
    filePath: string,
    content: string,
    language: string,
  ): CodeChunk[] {
    const lines = content.split('\n');
    const chunks: CodeChunk[] = [];
    let i = 0;

    while (i < lines.length) {
      const end = Math.min(i + WINDOW_TOKENS, lines.length);
      const text = lines.slice(i, end).join('\n').trim();
      if (text) {
        chunks.push({
          content: text,
          filePath,
          language,
          chunkType: 'window',
          startLine: i + 1,
          endLine: end,
        });
      }
      i += WINDOW_TOKENS - WINDOW_OVERLAP;
    }

    return chunks;
  }
}
