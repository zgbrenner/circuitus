/**
 * Safe markdown → React renderer.
 *
 * Builds React elements from parsed markdown text — never uses
 * dangerouslySetInnerHTML. Raw HTML in the source is stripped, remote images
 * are replaced with an inline "[figure omitted — see source]" placeholder,
 * and only http:/https: link targets are rendered as anchors (which never
 * navigate the browser — clicks are routed to `onLinkClick`).
 *
 * Supported: ATX + setext headings, paragraphs, bold/italic, inline code,
 * fenced code blocks, ordered/unordered lists, blockquotes, links, hr,
 * simple pipe tables.
 */

import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';

export interface MarkdownProps {
  markdown: string;
  /** Invoked with a safe http(s) URL when a link is clicked. */
  onLinkClick?: (url: string) => void;
}

// ── Text-level helpers ───────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1] === 'x' || code[1] === 'X';
      const n = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? all;
  });
}

function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    return null;
  } catch {
    return null;
  }
}

/** Convert autolinks to markdown links, then strip any remaining raw HTML. */
function prepInline(text: string): string {
  let s = text.replace(/<(https?:\/\/[^>\s]+)>/g, '[$1]($1)');
  // Strip tags/comments repeatedly until stable: a single pass can leave a
  // dangerous substring behind when removal reassembles one (e.g.
  // `<<x>script>` → one pass leaves `<script>`). Output is only ever placed
  // in React text nodes, so this is defense in depth, not the last line.
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  } while (s !== prev);
  return s;
}

// ── Inline parsing ───────────────────────────────────────────────────────

// Alternation order matters: image, link, code span, bold, italic.
// Group map: 1=image, 2=alt, 3=img url | 4=link, 5=text, 6=url |
// 7=backticks, 8=code | 9=bold delim, 10=bold body | 11=italic delim, 12=body
// URL groups tolerate one level of parentheses (e.g. wikipedia.org/wiki/X_(law)).
const URL_PART = '(?:[^()\\s]|\\([^()\\s]*\\))*';
const INLINE_PATTERN =
  `(!\\[([^\\]]*)\\]\\((${URL_PART})(?:\\s+"[^"]*")?\\))` +
  `|(\\[([^\\]]+)\\]\\((${URL_PART})(?:\\s+"[^"]*")?\\))` +
  '|(`+)([\\s\\S]+?)\\7' +
  '|(\\*\\*|__)([\\s\\S]+?)\\9' +
  '|([*_])([^*_\\s][\\s\\S]*?)\\11';

interface InlineCtx {
  onLinkClick?: (url: string) => void;
}

function parseInline(text: string, ctx: InlineCtx, depth = 0): ReactNode[] {
  if (depth > 4) return [decodeEntities(text)];
  const re = new RegExp(INLINE_PATTERN, 'g');
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(decodeEntities(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      // Remote image — never fetched; placeholder only.
      nodes.push(
        <span key={k++} className="font-mono text-[11px] text-text-muted/70 not-italic">
          [figure omitted — see source]
        </span>,
      );
    } else if (m[4] !== undefined) {
      const url = safeHttpUrl(m[6] ?? '');
      const inner = parseInline(m[5], ctx, depth + 1);
      if (url) {
        nodes.push(
          <a
            key={k++}
            href={url}
            onClick={(e) => {
              e.preventDefault();
              ctx.onLinkClick?.(url);
            }}
            title={url}
          >
            {inner}
          </a>,
        );
      } else {
        // Unsafe or relative target — keep the text, drop the link.
        nodes.push(<Fragment key={k++}>{inner}</Fragment>);
      }
    } else if (m[7] !== undefined) {
      nodes.push(<code key={k++}>{decodeEntities(m[8])}</code>);
    } else if (m[9] !== undefined) {
      nodes.push(<strong key={k++}>{parseInline(m[10], ctx, depth + 1)}</strong>);
    } else {
      nodes.push(<em key={k++}>{parseInline(m[12], ctx, depth + 1)}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(decodeEntities(text.slice(last)));
  return nodes;
}

// ── Block parsing ────────────────────────────────────────────────────────

const FENCE_RE = /^\s*(```+|~~~+)/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const QUOTE_RE = /^\s*>/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const SETEXT_RE = /^\s*(=+|-{2,})\s*$/;

const CELL_BORDER = '1px solid #D9D2C0';

function isBlockStart(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line) ||
    TABLE_ROW_RE.test(line)
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function headingTag(level: number): 'h1' | 'h2' | 'h3' | 'h4' {
  if (level <= 1) return 'h1';
  if (level === 2) return 'h2';
  if (level === 3) return 'h3';
  return 'h4';
}

function parseBlocks(lines: string[], ctx: InlineCtx, depth = 0): ReactNode[] {
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  if (depth > 4) return [<p key="deep">{parseInline(prepInline(lines.join(' ')), ctx)}</p>];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block — content rendered verbatim, no inline parsing.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const closeRe = fence[1][0] === '~' ? /^\s*~~~/ : /^\s*```/;
      i++;
      const code: string[] = [];
      while (i < lines.length && !closeRe.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      blocks.push(
        <pre key={k++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const Tag = headingTag(heading[1].length);
      blocks.push(<Tag key={k++}>{parseInline(prepInline(heading[2]), ctx)}</Tag>);
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push(<hr key={k++} />);
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (QUOTE_RE.test(lines[i]) || (lines[i].trim() !== '' && inner.length > 0 && !isBlockStart(lines[i])))) {
        inner.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(<blockquote key={k++}>{parseBlocks(inner, ctx, depth + 1)}</blockquote>);
      continue;
    }

    const listStart = LIST_RE.exec(line);
    if (listStart) {
      const ordered = /^\d/.test(listStart[2]);
      const items: string[] [] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const im = LIST_RE.exec(lines[i]);
        if (im) {
          items.push([im[3]]);
        } else if (items.length > 0 && /^\s+\S/.test(lines[i]) && !isBlockStart(lines[i])) {
          items[items.length - 1].push(lines[i].trim());
        } else {
          break;
        }
        i++;
      }
      const lis = items.map((parts, idx) => (
        <li key={idx}>{parseInline(prepInline(parts.join(' ')), ctx)}</li>
      ));
      blocks.push(ordered ? <ol key={k++}>{lis}</ol> : <ul key={k++}>{lis}</ul>);
      continue;
    }

    // Simple pipe table (header row + separator row required).
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={k++} className="overflow-x-auto my-4" style={{ border: CELL_BORDER }}>
          <table className="w-full font-serif text-[13.5px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="text-left font-semibold text-navy px-3 py-1.5 bg-cream"
                    style={{ borderBottom: CELL_BORDER, textAlign: 'left' }}
                  >
                    {parseInline(prepInline(h), ctx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-1.5 align-top" style={{ borderBottom: CELL_BORDER, textAlign: 'left' }}>
                      {parseInline(prepInline(c), ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Paragraph (with setext-heading lookahead).
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      if (para.length > 0 && SETEXT_RE.test(lines[i])) break;
      if (para.length > 0 && isBlockStart(lines[i])) break;
      para.push(lines[i]);
      i++;
    }
    const setext = i < lines.length ? SETEXT_RE.exec(lines[i]) : null;
    const text = prepInline(para.join(' ').replace(/\s+/g, ' ').trim());
    if (setext && para.length > 0) {
      i++;
      const Tag = setext[1].startsWith('=') ? 'h1' : 'h2';
      if (text) blocks.push(<Tag key={k++}>{parseInline(text, ctx)}</Tag>);
      continue;
    }
    if (text) blocks.push(<p key={k++}>{parseInline(text, ctx)}</p>);
  }

  return blocks;
}

function renderMarkdown(markdown: string, onLinkClick?: (url: string) => void): ReactNode[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines, { onLinkClick });
}

export function Markdown({ markdown, onLinkClick }: MarkdownProps) {
  const blocks = useMemo(() => renderMarkdown(markdown, onLinkClick), [markdown, onLinkClick]);
  return <>{blocks}</>;
}

export default Markdown;
