import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';

export interface CodeChunk {
  content: string;
  filePath: string;
  language: string;
  chunkType: 'function' | 'class' | 'heading' | 'window';
  symbolName?: string;
  startLine: number;
  endLine: number;
  repoId?: string;
}

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
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
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sh': 'bash',
  '.bash': 'bash',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'cs',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.json': 'json',
  '.scala': 'scala',
  '.r': 'r',
  '.sql': 'sql',
};

// Tree-sitter grammars for supported languages
const GRAMMARS: Record<string, unknown> = {
  typescript: TypeScript.typescript,
  tsx: TypeScript.tsx,
  javascript: JavaScript,
  python: Python,
};

// AST node types that represent top-level semantic units per language
const TOP_LEVEL_NODES: Record<string, Set<string>> = {
  typescript: new Set([
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'export_statement',
    'lexical_declaration',
  ]),
  tsx: new Set([
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'export_statement',
    'lexical_declaration',
  ]),
  javascript: new Set([
    'function_declaration',
    'class_declaration',
    'export_statement',
    'lexical_declaration',
    'variable_declaration',
  ]),
  python: new Set([
    'function_definition',
    'class_definition',
    'decorated_definition',
  ]),
};

const WINDOW_LINES = 80; // Very small for conservative chunking
const WINDOW_OVERLAP = 15;
const MIN_CHUNK_LINES = 3;
const MAX_CHUNK_LINES = 60; // Very conservative for token limits

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);
  private parsers = new Map<string, Parser>();

  private getParser(language: string): Parser | null {
    if (this.parsers.has(language)) return this.parsers.get(language)!;
    const grammar = GRAMMARS[language];
    if (!grammar) return null;
    const parser = new Parser();
    parser.setLanguage(grammar as Parser.Language);
    this.parsers.set(language, parser);
    return parser;
  }

  async chunkFile(filePath: string, content: string): Promise<CodeChunk[]> {
    const ext = path.extname(filePath).toLowerCase();
    const language = LANG_MAP[ext] || 'text';

    if (content.trim().length === 0) return [];

    if (language === 'markdown') {
      return this.chunkMarkdown(filePath, content);
    }

    // Try tree-sitter AST-based chunking
    const parser = this.getParser(language);
    if (parser) {
      const chunks = this.chunkByAST(parser, filePath, content, language);
      if (chunks.length > 0) {
        const header = this.extractFileHeader(filePath, content, language);
        return header ? [header, ...chunks] : chunks;
      }
    }

    // Regex-based block splitting for languages with recognisable top-level constructs
    const blockLangs = [
      'typescript',
      'tsx',
      'javascript',
      'python',
      'java',
      'kotlin',
      'go',
      'rust',
      'c',
      'cpp',
      'cs',
      'php',
      'ruby',
      'swift',
    ];
    if (blockLangs.includes(language)) {
      const blocks = this.chunkByTopLevelBlocks(filePath, content, language);
      const header = this.extractFileHeader(filePath, content, language);
      return header ? [header, ...blocks] : blocks;
    }

    return this.slidingWindowChunk(filePath, content, language);
  }

  // ── Tree-sitter AST chunking ────────────────────────────────────────────
  private chunkByAST(
    parser: Parser,
    filePath: string,
    content: string,
    language: string,
  ): CodeChunk[] {
    const tree = parser.parse(content);
    const topLevelTypes = TOP_LEVEL_NODES[language];
    if (!topLevelTypes) return [];

    const chunks: CodeChunk[] = [];
    const rootNode = tree.rootNode;

    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i);
      if (!node) continue;

      if (topLevelTypes.has(node.type)) {
        const text = node.text;
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const lineCount = endLine - startLine + 1;

        if (lineCount < MIN_CHUNK_LINES) continue;

        // If chunk is too large, split it using sliding window
        if (lineCount > MAX_CHUNK_LINES) {
          const lines = text.split('\n');
          let i = 0;
          while (i < lines.length) {
            const end = Math.min(i + WINDOW_LINES, lines.length);
            const chunkText = lines.slice(i, end).join('\n').trim();
            if (chunkText) {
              chunks.push({
                content: chunkText,
                filePath,
                language,
                chunkType: 'window',
                startLine: startLine + i,
                endLine: startLine + end - 1,
              });
            }
            i += WINDOW_LINES - WINDOW_OVERLAP;
          }
        } else {
          const symbolName = this.extractSymbolName(node);
          const chunkType = this.classifyNode(node);

          chunks.push({
            content: text,
            filePath,
            language,
            chunkType,
            symbolName,
            startLine,
            endLine,
          });
        }
      }
    }

    if (chunks.length <= 1 && content.split('\n').length > WINDOW_LINES) {
      return this.slidingWindowChunk(filePath, content, language);
    }

    return chunks;
  }

  private extractSymbolName(node: Parser.SyntaxNode): string | undefined {
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      if (declaration) return this.extractSymbolName(declaration);
      const value = node.childForFieldName('value');
      if (value?.type === 'identifier') return value.text;
      return undefined;
    }

    const nameNode =
      node.childForFieldName('name') ?? node.childForFieldName('id');
    if (nameNode) return nameNode.text;

    if (
      node.type === 'lexical_declaration' ||
      node.type === 'variable_declaration'
    ) {
      const declarator = node.child(1);
      if (declarator) {
        const name = declarator.childForFieldName('name');
        if (name) return name.text;
      }
    }

    return undefined;
  }

  private classifyNode(node: Parser.SyntaxNode): 'function' | 'class' {
    const type = node.type;
    if (
      type === 'class_declaration' ||
      type === 'class_definition' ||
      type === 'interface_declaration' ||
      type === 'enum_declaration'
    ) {
      return 'class';
    }
    if (type === 'export_statement') {
      const decl = node.childForFieldName('declaration');
      if (decl) return this.classifyNode(decl);
    }
    return 'function';
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

      switch (language) {
        case 'python':
          if (/^(import |from |class |def |async def )/.test(trimmed))
            headerLines.push(line);
          break;
        case 'java':
        case 'kotlin':
          if (/^(import |package )/.test(trimmed)) headerLines.push(line);
          else if (/^(public |private |protected |abstract |@\w)/.test(trimmed))
            headerLines.push(line);
          break;
        case 'go':
          if (/^(package |import |func |type |var )/.test(trimmed))
            headerLines.push(line);
          break;
        case 'rust':
          if (/^(use |mod |pub |fn |struct |enum |trait |impl )/.test(trimmed))
            headerLines.push(line);
          break;
        case 'cs':
          if (/^(using |namespace )/.test(trimmed)) headerLines.push(line);
          else if (
            /^(public |private |protected |internal |\[\w)/.test(trimmed)
          )
            headerLines.push(line);
          break;
        case 'php':
          if (/^(use |namespace |require|include)/.test(trimmed))
            headerLines.push(line);
          else if (/^(class |function |interface |trait )/.test(trimmed))
            headerLines.push(line);
          break;
        case 'ruby':
          if (/^(require |require_relative |class |module |def )/.test(trimmed))
            headerLines.push(line);
          break;
        case 'c':
        case 'cpp':
          if (/^#include\s/.test(trimmed)) headerLines.push(line);
          else if (/^(class |struct |enum |namespace |typedef )/.test(trimmed))
            headerLines.push(line);
          break;
        default:
          // JS/TS
          if (
            /^import\s/.test(trimmed) ||
            /^(const|let|var)\s+\S+\s*=\s*require\s*\(/.test(trimmed)
          )
            headerLines.push(line);
          else if (
            /^(export\s+|@\w)/.test(trimmed) ||
            /^(class|function|const|type|interface|enum)\s/.test(trimmed)
          )
            headerLines.push(line);
          break;
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

  // ── Top-level block split (multi-language) ────────────────────────────────
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
      const trimmed = line.trimStart();
      switch (language) {
        case 'python':
          return /^(def |class |async def )\S/.test(trimmed);
        case 'java':
        case 'kotlin':
          return /^(public |private |protected |static |abstract |final |open |data |sealed )*(class |interface |enum |fun |object |@\w)/.test(
            trimmed,
          );
        case 'go':
          return /^(func |type |var |const )/.test(trimmed);
        case 'rust':
          return /^(pub\s+)?(fn |struct |enum |impl |trait |mod |type |const |static )/.test(
            trimmed,
          );
        case 'c':
        case 'cpp':
          return (
            /^(\w+\s+)+\w+\s*\(/.test(trimmed) &&
            !/^(if|for|while|switch|return)\b/.test(trimmed)
          );
        case 'cs':
          return /^(public |private |protected |internal |static |abstract |sealed |partial )*(class |interface |enum |struct |void |async |\w+\s+\w+\s*\()/.test(
            trimmed,
          );
        case 'php':
          return /^(public |private |protected |static |abstract |final )*(function |class |interface |trait )/.test(
            trimmed,
          );
        case 'ruby':
          return /^(def |class |module )/.test(trimmed);
        case 'swift':
          return /^(public |private |internal |open |fileprivate )*(func |class |struct |enum |protocol |extension )/.test(
            trimmed,
          );
        default:
          // JS/TS fallback
          return /^(export\s+)?(default\s+)?(async\s+)?(function|class|const\s+\w+\s*=\s*(async\s+)?\(|const\s+\w+\s*=\s*(async\s+)?function)\b/.test(
            trimmed,
          );
      }
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
    if (chunks.length <= 1 && content.split('\n').length > WINDOW_LINES) {
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
      const end = Math.min(i + WINDOW_LINES, lines.length);
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
      i += WINDOW_LINES - WINDOW_OVERLAP;
    }

    return chunks;
  }
}
