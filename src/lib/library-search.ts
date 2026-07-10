import type { StandinDocument } from '@/types';
import { extractCitations, stripHtml } from '@/lib/citations';

export interface LibrarySearchResult {
  label: string;
  docId?: string;
  snippet?: string;
  score?: number;
  citations?: string[];
}

function terms(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9§.]+/).filter((t) => t.length > 1);
}

function makeSnippet(text: string, queryTerms: string[]): string {
  const lower = text.toLowerCase();
  const first = queryTerms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 70);
  const end = Math.min(text.length, first + 190);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function searchPracticeLibrary(
  documents: StandinDocument[],
  query: string,
  limit = 6,
): LibrarySearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const queryTerms = terms(q);
  const queryNorm = q.toLowerCase();

  return documents
    .map((doc) => {
      const plain = stripHtml(doc.content);
      const haystacks = [doc.title, doc.shortTitle, doc.description, plain];
      let score = 0;
      for (const term of queryTerms) {
        if (doc.shortTitle.toLowerCase().includes(term)) score += 12;
        if (doc.title.toLowerCase().includes(term)) score += 10;
        if (doc.description.toLowerCase().includes(term)) score += 5;
        const bodyMatches = (plain.toLowerCase().match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
        score += Math.min(bodyMatches, 8);
      }
      if (haystacks.some((h) => h.toLowerCase().includes(queryNorm))) score += 8;
      return {
        label: doc.shortTitle,
        docId: doc.id,
        snippet: makeSnippet(plain || doc.description, queryTerms),
        score,
        citations: extractCitations(doc.content, 3).map((c) => c.text),
      };
    })
    .filter((r) => (r.score ?? 0) > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.label.localeCompare(b.label))
    .slice(0, limit);
}
