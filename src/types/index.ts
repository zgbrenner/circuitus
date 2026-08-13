export interface User {
  email: string;
  loggedIn: boolean;
  loginTime: string;
}

export interface DocumentChapter {
  id: string;
  title: string;
  content: string;
}

export interface ReadingPosition {
  chapterIndex: number;
  scrollPercent: number;
}

export interface StoredDocument {
  id: string;
  title: string;
  author: string;
  fileName: string;
  fileType: 'epub' | 'pdf' | 'txt';
  chapters: DocumentChapter[];
  dateAdded: string;
  lastOpened: string;
  readingPosition: ReadingPosition;
}

export interface Bookmark {
  id: string;
  documentId: string;
  chapterIndex: number;
  scrollPercent: number;
  selectedText?: string;
  note?: string;
  dateCreated: string;
  label: string;
}

export interface Highlight {
  id: string;
  documentId: string;
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  color: 'yellow' | 'blue' | 'green';
  dateCreated: string;
}

export interface ParsedDocument {
  title: string;
  author: string;
  chapters: DocumentChapter[];
}

export interface Draft {
  id: string;
  title: string;
  /** Tiptap HTML document body, stored as a string. */
  body: string;
  /** Excalidraw scene serialized as JSON string. Empty string means no diagram. */
  diagram?: string;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpreadsheetWorkbook {
  id: string;
  title: string;
  /** JSON-stringified FortuneSheet sheets array. */
  sheets: string;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodeFile {
  id: string;
  /** Filename with extension, e.g. "scratch.ts". */
  name: string;
  /** Monaco language id, derived from the filename extension. */
  language: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AudioTrack {
  id: string;
  title: string;
  presenter: string;
  /** Either a Blob (for imported files) or a URL string (for streamed sources). */
  source: { kind: 'blob'; blob: Blob } | { kind: 'url'; url: string };
  durationSec: number;
  addedAt: string;
}

export interface DepositionVideo {
  id: string;
  title: string;
  kind: 'youtube' | 'url' | 'file';
  /** youtube video id, http(s) media URL, or empty for kind 'file' */
  ref: string;
  /** present only for kind 'file' */
  blob?: Blob;
  mimeType?: string;
  addedAt: string; // ISO
}

export interface MatterNote {
  /** Document/matter id this note belongs to. Use 'global' for the catch-all pad. */
  documentId: string;
  body: string;
  updatedAt: string;
}

export type MatterStage = 'pending' | 'preparation' | 'filed';

export interface MatterCard {
  id: string;
  title: string;
  notes: string;
  stage: MatterStage;
  /** fake docket-style number assigned at creation, e.g. "M-2026-0147" */
  matterNumber: string;
  /** total tracked seconds from the Timekeeper */
  billedSeconds: number;
  /** manual ordering within a stage column (ascending) */
  order: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface StandinDocument {
  id: string;
  type: 'guide' | 'article' | 'case';
  title: string;
  shortTitle: string;
  description: string;
  refNumber: string;
  lastUpdated: string;
  content: string;
  flagStatus: null | 'positive' | 'caution' | 'negative';
}
