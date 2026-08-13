import * as pdfjsLib from 'pdfjs-dist';
import type { ParsedDocument, DocumentChapter } from '@/types';
import { escapeHtml } from './sanitize';

// BASE_URL-relative (not absolute) so the worker also resolves when the app
// is served from file:// inside the Electron desktop shell (base: './').
pdfjsLib.GlobalWorkerOptions.workerSrc =
  import.meta.env.BASE_URL + 'pdf.worker.min.js';

/** Y-position threshold (in PDF units) for grouping text items into the same line. */
const LINE_Y_THRESHOLD = 2;

export async function parsePdf(file: File): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let title = file.name.replace(/\.pdf$/i, '');
  let author = 'Unknown Author';

  try {
    const metadata = await pdf.getMetadata();
    const info = metadata?.info as Record<string, string> | undefined;
    if (info?.Title) title = info.Title;
    if (info?.Author) author = info.Author;
  } catch {
    // Metadata extraction failed, use defaults
  }

  const chapters: DocumentChapter[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Group text items into lines, then paragraphs
    const items = textContent.items.filter(
      (item) => 'str' in item && 'transform' in item
    ) as Array<{ str: string; transform: number[] }>;

    if (items.length === 0) continue;

    // Sort by Y position (descending) then X (ascending)
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > LINE_Y_THRESHOLD) return yDiff;
      return a.transform[4] - b.transform[4];
    });

    // Group into lines by Y proximity
    const lines: string[] = [];
    let currentLine = items[0].str;
    let currentY = items[0].transform[5];

    for (let j = 1; j < items.length; j++) {
      const item = items[j];
      if (Math.abs(item.transform[5] - currentY) < LINE_Y_THRESHOLD) {
        currentLine += ' ' + item.str;
      } else {
        lines.push(currentLine.trim());
        currentLine = item.str;
        currentY = item.transform[5];
      }
    }
    lines.push(currentLine.trim());

    // Convert lines to paragraphs (split on empty lines)
    const paragraphs: string[] = [];
    let current = '';
    for (const line of lines) {
      if (!line) {
        if (current) {
          paragraphs.push(current);
          current = '';
        }
      } else {
        current = current ? current + ' ' + line : line;
      }
    }
    if (current) paragraphs.push(current);

    const html = paragraphs
      .filter((p) => p.trim())
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join('\n');

    if (html.trim()) {
      chapters.push({
        id: crypto.randomUUID(),
        title: `Section ${i}`,
        content: html,
      });
    }
  }

  if (chapters.length === 0) {
    throw new Error(
      'Document appears to contain scanned content. Text extraction is limited. Consider using an OCR-processed version.'
    );
  }

  return { title, author, chapters };
}
