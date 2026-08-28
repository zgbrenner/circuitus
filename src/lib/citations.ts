export interface ExtractedCitation {
  id: string;
  text: string;
  type: 'statute' | 'regulation' | 'case' | 'contract' | 'other';
  normalized: string;
  count: number;
}

const CITATION_PATTERNS: Array<{ type: ExtractedCitation['type']; pattern: RegExp }> = [
  { type: 'statute', pattern: /\b\d+\s+U\.S\.C\.\s*§+\s*[\w\d().-]+/gi },
  { type: 'regulation', pattern: /\b\d+\s+C\.F\.R\.\s*§+\s*[\w\d().-]+/gi },
  { type: 'statute', pattern: /\bCal\.\s+(?:Civ\.|Bus\.\s*&\s*Prof\.|Com\.|Lab\.|Gov\.)\s+Code\s*§+\s*[\w\d().-]+/gi },
  { type: 'case', pattern: /\b[A-Z][A-Za-z.&'’\- ]+\s+v\.\s+[A-Z][A-Za-z.&'’\- ]+,\s+\d+\s+[A-Z][A-Za-z.\d ]+\s+\d+(?:,\s*\d+)?\s*\(\d{4}\)/g },
  { type: 'contract', pattern: /\b(?:Section|Article|Exhibit|Schedule)\s+\d+(?:\.\d+)*(?:\([a-z]\))?/gi },
  { type: 'other', pattern: /§+\s*\d+(?:\.\d+)*(?:\([a-z0-9]+\))*/gi },
];

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&sect;/g, '§')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCitation(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/§+/g, '§').trim().toLowerCase();
}

export function extractCitations(input: string, limit = 12): ExtractedCitation[] {
  const text = stripHtml(input);
  const byKey = new Map<string, ExtractedCitation>();

  for (const { type, pattern } of CITATION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = match[0].replace(/[;,.]+$/g, '').trim();
      if (raw.length < 3) continue;
      const normalized = normalizeCitation(raw);
      const prior = byKey.get(normalized);
      if (prior) {
        prior.count += 1;
      } else {
        byKey.set(normalized, {
          id: `cite-${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
          text: raw,
          normalized,
          type,
          count: 1,
        });
      }
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, limit);
}
