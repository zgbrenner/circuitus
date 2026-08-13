import { openDB, type IDBPDatabase } from 'idb';
import type {
  StoredDocument,
  Bookmark,
  Highlight,
  ReadingPosition,
  MatterNote,
  Draft,
  AudioTrack,
  SpreadsheetWorkbook,
  CodeFile,
  DepositionVideo,
  MatterCard,
} from '@/types';

interface CircuitusDB {
  documents: {
    key: string;
    value: StoredDocument;
    indexes: {
      'by-dateAdded': string;
      'by-lastOpened': string;
    };
  };
  bookmarks: {
    key: string;
    value: Bookmark;
    indexes: {
      'by-documentId': string;
    };
  };
  highlights: {
    key: string;
    value: Highlight;
    indexes: {
      'by-documentId': string;
    };
  };
  notes: {
    key: string;
    value: MatterNote;
  };
  drafts: {
    key: string;
    value: Draft;
    indexes: {
      'by-updatedAt': string;
    };
  };
  tracks: {
    key: string;
    value: AudioTrack;
    indexes: {
      'by-addedAt': string;
    };
  };
  workbooks: {
    key: string;
    value: SpreadsheetWorkbook;
    indexes: {
      'by-updatedAt': string;
    };
  };
  codefiles: {
    key: string;
    value: CodeFile;
    indexes: {
      'by-updatedAt': string;
    };
  };
  videos: {
    key: string;
    value: DepositionVideo;
    indexes: {
      'by-addedAt': string;
    };
  };
  matters: {
    key: string;
    value: MatterCard;
    indexes: {
      'by-updatedAt': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<CircuitusDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<CircuitusDB>('circuitus-db', 8, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const docStore = db.createObjectStore('documents', { keyPath: 'id' });
          docStore.createIndex('by-dateAdded', 'dateAdded');
          docStore.createIndex('by-lastOpened', 'lastOpened');

          const bmStore = db.createObjectStore('bookmarks', { keyPath: 'id' });
          bmStore.createIndex('by-documentId', 'documentId');

          const hlStore = db.createObjectStore('highlights', { keyPath: 'id' });
          hlStore.createIndex('by-documentId', 'documentId');
        }
        if (oldVersion < 2) {
          db.createObjectStore('notes', { keyPath: 'documentId' });
        }
        if (oldVersion < 3) {
          const draftStore = db.createObjectStore('drafts', { keyPath: 'id' });
          draftStore.createIndex('by-updatedAt', 'updatedAt');
        }
        if (oldVersion < 4) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('by-addedAt', 'addedAt');
        }
        if (oldVersion < 5) {
          const wbStore = db.createObjectStore('workbooks', { keyPath: 'id' });
          wbStore.createIndex('by-updatedAt', 'updatedAt');
        }
        if (oldVersion < 6) {
          const cfStore = db.createObjectStore('codefiles', { keyPath: 'id' });
          cfStore.createIndex('by-updatedAt', 'updatedAt');
        }
        if (oldVersion < 7) {
          const videoStore = db.createObjectStore('videos', { keyPath: 'id' });
          videoStore.createIndex('by-addedAt', 'addedAt');
        }
        if (oldVersion < 8) {
          const matterStore = db.createObjectStore('matters', { keyPath: 'id' });
          matterStore.createIndex('by-updatedAt', 'updatedAt');
        }
      },
    });
  }
  return dbPromise;
}

// Documents
export async function saveDocument(doc: Omit<StoredDocument, 'id'>): Promise<string> {
  const db = await getDB();
  const id = crypto.randomUUID();
  const full: StoredDocument = { ...doc, id };
  await db.put('documents', full);
  return id;
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  const db = await getDB();
  return db.get('documents', id);
}

export async function getAllDocuments(): Promise<StoredDocument[]> {
  const db = await getDB();
  const all = await db.getAll('documents');
  return all.sort((a, b) => (b.lastOpened || b.dateAdded).localeCompare(a.lastOpened || a.dateAdded));
}

export async function updateDocumentTitle(id: string, title: string): Promise<void> {
  const db = await getDB();
  const doc = await db.get('documents', id);
  if (!doc) return;
  doc.title = title;
  await db.put('documents', doc);
}

export async function updateReadingPosition(id: string, position: ReadingPosition): Promise<void> {
  const db = await getDB();
  const doc = await db.get('documents', id);
  if (doc) {
    doc.readingPosition = position;
    doc.lastOpened = new Date().toISOString();
    await db.put('documents', doc);
  }
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('documents', id);
  // Also delete associated bookmarks and highlights
  const bms = await getBookmarks(id);
  for (const bm of bms) await db.delete('bookmarks', bm.id);
  const hls = await getHighlights(id);
  for (const hl of hls) await db.delete('highlights', hl.id);
}

// Bookmarks
export async function saveBookmark(bookmark: Omit<Bookmark, 'id'>): Promise<string> {
  const db = await getDB();
  const id = crypto.randomUUID();
  const full: Bookmark = { ...bookmark, id };
  await db.put('bookmarks', full);
  return id;
}

export async function getBookmarks(documentId: string): Promise<Bookmark[]> {
  const db = await getDB();
  return db.getAllFromIndex('bookmarks', 'by-documentId', documentId);
}

export async function deleteBookmark(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('bookmarks', id);
}

// Highlights
export async function saveHighlight(highlight: Omit<Highlight, 'id'>): Promise<string> {
  const db = await getDB();
  const id = crypto.randomUUID();
  const full: Highlight = { ...highlight, id };
  await db.put('highlights', full);
  return id;
}

export async function getHighlights(documentId: string): Promise<Highlight[]> {
  const db = await getDB();
  return db.getAllFromIndex('highlights', 'by-documentId', documentId);
}

export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('highlights', id);
}

// Notes
export async function saveNote(note: MatterNote): Promise<void> {
  const db = await getDB();
  await db.put('notes', note);
}

export async function getNote(documentId: string): Promise<MatterNote | undefined> {
  const db = await getDB();
  return db.get('notes', documentId);
}

// Drafts (rich-text working documents in the Templates tab)
export async function saveDraft(draft: Draft): Promise<void> {
  const db = await getDB();
  await db.put('drafts', draft);
}

export async function getDraft(id: string): Promise<Draft | undefined> {
  const db = await getDB();
  return db.get('drafts', id);
}

export async function getAllDrafts(): Promise<Draft[]> {
  const db = await getDB();
  const all = await db.getAll('drafts');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('drafts', id);
}

// Audio tracks
export async function saveTrack(track: AudioTrack): Promise<void> {
  const db = await getDB();
  await db.put('tracks', track);
}

export async function getAllTracks(): Promise<AudioTrack[]> {
  const db = await getDB();
  const all = await db.getAll('tracks');
  return all.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('tracks', id);
}

// Code files (Exhibits tab — Exhibit Compiler workspace)
export async function saveCodeFile(file: CodeFile): Promise<void> {
  const db = await getDB();
  await db.put('codefiles', file);
}

export async function getCodeFile(id: string): Promise<CodeFile | undefined> {
  const db = await getDB();
  return db.get('codefiles', id);
}

export async function getAllCodeFiles(): Promise<CodeFile[]> {
  const db = await getDB();
  const all = await db.getAll('codefiles');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteCodeFile(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('codefiles', id);
}

// Deposition videos (Depositions tab — recording review)
export async function saveVideo(video: DepositionVideo): Promise<void> {
  const db = await getDB();
  await db.put('videos', video);
}

export async function getAllVideos(): Promise<DepositionVideo[]> {
  const db = await getDB();
  const all = await db.getAll('videos');
  return all.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export async function deleteVideo(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('videos', id);
}

// Matters (Matters tab — workflow board + Timekeeper)
const MATTER_STAGE_RANK: Record<MatterCard['stage'], number> = {
  pending: 0,
  preparation: 1,
  filed: 2,
};

export async function saveMatter(matter: MatterCard): Promise<void> {
  const db = await getDB();
  await db.put('matters', matter);
}

export async function getAllMatters(): Promise<MatterCard[]> {
  const db = await getDB();
  const all = await db.getAll('matters');
  return all.sort(
    (a: MatterCard, b: MatterCard) =>
      MATTER_STAGE_RANK[a.stage] - MATTER_STAGE_RANK[b.stage] || a.order - b.order,
  );
}

export async function deleteMatter(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('matters', id);
}

// Spreadsheet workbooks
export async function saveWorkbook(wb: SpreadsheetWorkbook): Promise<void> {
  const db = await getDB();
  await db.put('workbooks', wb);
}

export async function getWorkbook(id: string): Promise<SpreadsheetWorkbook | undefined> {
  const db = await getDB();
  return db.get('workbooks', id);
}

export async function getAllWorkbooks(): Promise<SpreadsheetWorkbook[]> {
  const db = await getDB();
  const all = await db.getAll('workbooks');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteWorkbook(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('workbooks', id);
}
