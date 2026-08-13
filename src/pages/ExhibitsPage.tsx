import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Download, FileCode2, FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { ensureMonacoSetup } from '@/lib/monaco';
import { deleteCodeFile, getAllCodeFiles, getCodeFile, saveCodeFile } from '@/lib/storage';
import { standinDocuments } from '@/data/standin-documents';
import type { CodeFile } from '@/types';

// Bundle Monaco locally (no CDN) and register the circuitus-light theme
// before any editor mounts.
ensureMonacoSetup();

const SAVE_DEBOUNCE_MS = 700;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // ~2 MB per annexed exhibit

// The "Instrument View" camouflage renders one of the standin legal documents.
// Note: the global boss-key chord (registered app-wide at capture phase) also
// covers this page — this toggle is just the deliberate, mouse-driven variant.
const INSTRUMENT_DOC = standinDocuments[0];

/** Monaco language id from a filename extension. Defaults to 'plaintext'. */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  sh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  // Monaco ships no TOML grammar; INI highlighting is the closest match.
  toml: 'ini',
  xml: 'xml',
  rb: 'ruby',
  php: 'php',
};

function languageFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}

/** 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB" … (bijective base-26). */
function exhibitLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function newCodeFile(name: string): CodeFile {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    language: languageFromName(name),
    content: '',
    createdAt: now,
    updatedAt: now,
  };
}

/** Footer stats for the file currently being edited, keyed by file id. */
interface EditorStats {
  id: string;
  savedAt: string | null;
  lineCount: number;
}

export default function ExhibitsPage() {
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<EditorStats | null>(null);
  const [instrumentView, setInstrumentView] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child crossed; the depth counter
  // guards against duplicate firing so the overlay doesn't flicker.
  const dragDepthRef = useRef(0);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeId) ?? null,
    [files, activeId],
  );
  const activeLanguage = activeFile ? languageFromName(activeFile.name) : 'plaintext';

  // Footer stats are derived (no sync-state effect): live edit stats when they
  // belong to the active file, otherwise the stored record's values.
  const statsAreLive = stats !== null && stats.id === activeId;
  const savedAt = statsAreLive ? stats.savedAt : (activeFile?.updatedAt ?? null);
  const lineCount = statsAreLive
    ? stats.lineCount
    : activeFile
      ? activeFile.content.split('\n').length
      : 1;

  // Initial load. First run: the store is empty — no seed file, just show
  // the empty state.
  useEffect(() => {
    void getAllCodeFiles().then((all) => {
      setFiles(all);
      if (all.length > 0) setActiveId(all[0].id);
      setLoaded(true);
    });
  }, []);

  // Clear any pending autosave timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  async function persist(next: CodeFile) {
    await saveCodeFile(next);
    setStats({
      id: next.id,
      savedAt: next.updatedAt,
      lineCount: next.content.split('\n').length,
    });
    setFiles((prev) =>
      prev.map((f) => (f.id === next.id ? next : f)).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  }

  // Debounced autosave on editor changes.
  function handleEditorChange(value: string | undefined) {
    const content = value ?? '';
    if (!activeId) return;
    const id = activeId;
    setStats((prev) => ({
      id,
      // Keep the last save timestamp while edits are pending for this file.
      savedAt: prev && prev.id === id ? prev.savedAt : null,
      lineCount: content.split('\n').length,
    }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const existing = await getCodeFile(id);
      if (!existing) return;
      await persist({ ...existing, content, updatedAt: new Date().toISOString() });
    }, SAVE_DEBOUNCE_MS);
  }

  function handleAnnex() {
    const name = window.prompt('Exhibit filename (e.g. scratch.ts):', 'scratch.ts')?.trim();
    if (!name) return;
    const file = newCodeFile(name);
    void saveCodeFile(file).then(() => {
      setFiles((prev) => [file, ...prev]);
      setActiveId(file.id);
    });
  }

  function handleRename(id: string) {
    const current = files.find((f) => f.id === id);
    if (!current) return;
    const name = window.prompt('Restyle exhibit as:', current.name)?.trim();
    if (!name || name === current.name) return;
    void getCodeFile(id).then((existing) => {
      if (!existing) return;
      void persist({
        ...existing,
        name,
        language: languageFromName(name),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  function handleDelete(id: string) {
    const target = files.find((f) => f.id === id);
    if (!window.confirm(`Strike "${target?.name ?? 'this exhibit'}" from the record?`)) return;
    void deleteCodeFile(id).then(() => {
      setFiles((prev) => {
        const next = prev.filter((f) => f.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      });
    });
  }

  async function handleImportFiles(list: FileList) {
    const rejected: string[] = [];
    let lastId: string | null = null;
    const added: CodeFile[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_IMPORT_BYTES) {
        rejected.push(f.name);
        continue;
      }
      const text = await f.text();
      const file = { ...newCodeFile(f.name), content: text };
      await saveCodeFile(file);
      added.push(file);
      lastId = file.id;
    }
    if (added.length > 0) {
      setFiles((prev) =>
        [...added, ...prev].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
      if (lastId) setActiveId(lastId);
    }
    if (rejected.length > 0) {
      window.alert(
        `The following materials exceed the 2 MB annexation limit and were not entered into the record: ${rejected.join(', ')}. Kindly tender a condensed copy.`,
      );
    }
  }

  function handleExport() {
    if (!activeFile) return;
    // Prefer the live model value — the debounced save may still be pending.
    const content = editorRef.current?.getValue() ?? activeFile.content;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // ── Drag-and-drop import (OS files onto the page) ──────────────────────
  // Drops funnel into handleImportFiles — the exact same path (and 2 MB
  // size check) as the hidden-input Import button.

  function isFileDrag(e: React.DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes('Files');
  }

  function handleDragEnter(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) setDragActive(true);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    // preventDefault is required for drop to fire; without it the browser
    // navigates away to the dropped file.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      void handleImportFiles(e.dataTransfer.files);
    }
  }

  return (
    <div
      className="flex-1 flex flex-col bg-cream overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay — covers the page (including Monaco, which would
          otherwise intercept the drop) while an OS file drag is over it. */}
      {dragActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-cream/90">
          <div
            className="px-12 py-10 bg-white text-center"
            style={{ border: '2px dashed #9C7A1F', borderRadius: 0 }}
          >
            <Upload className="w-5 h-5 text-gold mx-auto mb-3" aria-hidden />
            <p className="font-serif italic text-navy text-base">Lodge with the compiler…</p>
            <p className="text-[10px] font-mono text-text-muted mt-2">
              Release to annex the tendered materials to the record.
            </p>
          </div>
        </div>
      )}
      {/* Masthead */}
      <div className="border-b border-border bg-white px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60">
            CIRCUITUS EXHIBIT COMPILER
          </p>
          <h1 className="font-serif text-base font-bold text-navy">
            Annexed Materials &amp; Clause Bank
          </h1>
        </div>
        <p className="text-[10px] font-mono text-text-muted">
          {files.length} exhibit{files.length === 1 ? '' : 's'} of record
        </p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Exhibit Index (file list rail) */}
        <div className="w-64 bg-sidebar-bg border-r border-border flex flex-col flex-shrink-0">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-[10px] font-sans font-semibold uppercase tracking-[0.15em] text-text-muted">
              Exhibit Index
            </h3>
          </div>
          <div className="px-2 py-2 border-b border-border flex gap-1.5">
            <button
              onClick={handleAnnex}
              className="flex-1 flex items-center justify-center gap-1.5 bg-navy text-white text-[11px] font-sans font-medium px-3 py-1.5 rounded hover:bg-navy-light transition-colors"
            >
              <Plus className="w-3 h-3" />
              Annex Exhibit
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 text-[11px] font-sans font-medium px-2.5 py-1.5 rounded text-navy hover:bg-black/[0.04] transition-colors"
              title="Import files from disk into the record"
            >
              <Upload className="w-3 h-3" />
              Import
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleImportFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />
          <div className="flex-1 overflow-y-auto py-1">
            {files.length === 0 ? (
              <p className="px-4 py-6 text-xs text-text-muted font-sans text-center leading-relaxed">
                No exhibits annexed. Click <em>Annex Exhibit</em> to begin.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {files.map((f, i) => (
                  <li key={f.id} className="group flex items-center">
                    <button
                      onClick={() => setActiveId(f.id)}
                      className={`flex-1 min-w-0 text-left px-4 py-2 text-xs font-sans transition-colors border-l-2 ${
                        activeId === f.id
                          ? 'border-gold bg-gold/5 text-navy font-medium'
                          : 'border-transparent text-text-muted hover:text-text-main hover:bg-black/[0.02]'
                      }`}
                    >
                      <p className="truncate">
                        <span className="font-serif italic text-gold mr-1.5">
                          Ex. {exhibitLabel(i)}
                        </span>
                        <span className="font-mono text-[11px]">{f.name}</span>
                      </p>
                      <p className="text-[9px] font-mono text-text-muted/60 mt-0.5">
                        {new Date(f.updatedAt).toLocaleString()}
                      </p>
                    </button>
                    <button
                      onClick={() => handleRename(f.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-navy"
                      title="Restyle (rename) exhibit"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-text-muted hover:text-red-600"
                      title="Strike exhibit from the record"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Editor column */}
        <div className="flex-1 flex flex-col bg-white relative overflow-hidden">
          {activeFile ? (
            <>
              {/* Toolbar */}
              <div
                className="px-6 py-2 flex items-center justify-between flex-shrink-0 gap-3"
                style={{ borderBottom: '1px solid #D9D2C0' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode2 className="w-3.5 h-3.5 text-gold flex-shrink-0" />
                  <span className="font-serif italic text-navy text-sm flex-shrink-0">
                    Exhibit {exhibitLabel(files.findIndex((f) => f.id === activeFile.id))}
                  </span>
                  <span className="font-mono text-xs text-text-main truncate">
                    {activeFile.name}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-sans uppercase tracking-wider text-text-muted hover:text-navy"
                    title="Download a certified copy of this exhibit"
                  >
                    <Download className="w-3 h-3" /> Certified Copy
                  </button>
                  <button
                    onClick={() => setInstrumentView((p) => !p)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-sans uppercase tracking-wider rounded ${
                      instrumentView ? 'bg-navy text-white' : 'text-text-muted hover:text-navy'
                    }`}
                    title="Toggle Instrument View"
                  >
                    <FileText className="w-3 h-3" /> Instrument View
                  </button>
                </div>
              </div>

              {/* Monaco stays mounted (hidden via CSS) while Instrument View is
                  up so cursor position and undo history survive the toggle. */}
              <div className={instrumentView ? 'hidden' : 'flex-1 min-h-0'}>
                <Editor
                  height="100%"
                  path={activeFile.id}
                  defaultValue={activeFile.content}
                  language={activeLanguage}
                  theme="circuitus-light"
                  onChange={handleEditorChange}
                  onMount={handleEditorMount}
                  options={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: 13,
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    automaticLayout: true,
                    renderLineHighlight: 'none',
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>

              {instrumentView && (
                <div className="flex-1 overflow-y-auto px-12 py-10 bg-white">
                  <div className="max-w-reading-pane mx-auto">
                    <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60 mb-1 text-center">
                      {INSTRUMENT_DOC.refNumber}
                    </p>
                    <h2 className="font-serif text-lg font-bold text-navy text-center mb-6">
                      {INSTRUMENT_DOC.title}
                    </h2>
                    {/* Trusted first-party content from src/data/standin-documents.ts. */}
                    <div
                      className="prose-legal"
                      dangerouslySetInnerHTML={{ __html: INSTRUMENT_DOC.content }}
                    />
                  </div>
                </div>
              )}

              {!instrumentView && (
                <div className="border-t border-border px-4 py-1.5 flex items-center justify-between flex-shrink-0">
                  <span className="text-[10px] font-mono text-text-muted/70">
                    {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : 'Unsaved'}
                  </span>
                  <span className="text-[10px] font-mono text-text-muted/70">
                    {lineCount.toLocaleString()} lines · {activeLanguage}
                  </span>
                </div>
              )}
            </>
          ) : (
            loaded && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="max-w-sm text-center">
                  <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60 mb-2">
                    THE RECORD IS EMPTY
                  </p>
                  <p className="text-sm font-sans text-text-muted leading-relaxed mb-5">
                    No materials have been annexed to this matter. Annex a fresh
                    exhibit, or import existing materials from disk for
                    compilation.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={handleAnnex}
                      className="flex items-center gap-1.5 bg-navy text-white text-[11px] font-sans font-medium px-3 py-1.5 rounded hover:bg-navy-light transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Annex Exhibit
                    </button>
                    <button
                      onClick={() => importInputRef.current?.click()}
                      className="flex items-center gap-1.5 text-[11px] font-sans font-medium px-3 py-1.5 rounded text-navy hover:bg-black/[0.04] transition-colors"
                      style={{ border: '1px solid #D9D2C0' }}
                    >
                      <Upload className="w-3 h-3" />
                      Import
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
