/** Shared sanitization utilities for document parsers. */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'dfn',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const GLOBAL_ATTRS = new Set(['title', 'aria-label']);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'name']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
};
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const SAFE_URL = /^(?:https?:|mailto:|#|\/)/i;

const DANGEROUS_TAGS = /(<\/?)(script|iframe|object|embed|form|base|meta|link|svg|math)(\s[^>]*)?\/?>/gi;
const EVENT_HANDLERS = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const UNSAFE_URLS = /(href|src|action)\s*=\s*("|')?\s*(?:javascript|vbscript|data:text\/html)[^"'\s>]*/gi;

function isSafeUrl(value: string, allowDataImage = false): boolean {
  const trimmed = value.trim().replace(/\s+/g, '');
  return SAFE_URL.test(trimmed) || (allowDataImage && SAFE_DATA_IMAGE.test(trimmed));
}

function sanitizeNode(node: Node, document: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const source = node as Element;
  const tag = source.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = document.createDocumentFragment();
    source.childNodes.forEach((child) => {
      const cleanChild = sanitizeNode(child, document);
      if (cleanChild) fragment.appendChild(cleanChild);
    });
    return fragment;
  }

  const clean = document.createElement(tag);
  const allowedAttrs = TAG_ATTRS[tag] ?? new Set<string>();
  for (const attr of Array.from(source.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) continue;
    if (!GLOBAL_ATTRS.has(name) && !allowedAttrs.has(name)) continue;
    if (name === 'href' && !isSafeUrl(attr.value)) continue;
    if (name === 'src' && !isSafeUrl(attr.value, tag === 'img')) continue;
    clean.setAttribute(name, attr.value);
  }

  source.childNodes.forEach((child) => {
    const cleanChild = sanitizeNode(child, document);
    if (cleanChild) clean.appendChild(cleanChild);
  });
  return clean;
}

/**
 * Allowlist-sanitize parsed document HTML before it is rendered with
 * dangerouslySetInnerHTML. The DOMParser path is intentionally strict: unknown
 * tags are unwrapped, unsafe attributes are dropped, and only safe links/images
 * survive. A regex fallback is kept for non-browser test environments.
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return html
      .replace(DANGEROUS_TAGS, '')
      .replace(EVENT_HANDLERS, '')
      .replace(UNSAFE_URLS, '$1=""')
      .replace(/\s+(?:style|class)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<template>${html}</template>`, 'text/html');
  const container = parsed.querySelector('template')?.content ?? parsed.body;
  const output = document.createElement('div');
  container.childNodes.forEach((child) => {
    const cleanChild = sanitizeNode(child, document);
    if (cleanChild) output.appendChild(cleanChild);
  });
  return output.innerHTML;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
