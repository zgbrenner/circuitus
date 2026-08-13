/**
 * Shared Monaco setup for the whole app.
 *
 * Two jobs:
 *  1. Bundle Monaco locally. Without `loader.config({ monaco })`,
 *     `@monaco-editor/react` lazily downloads the editor from the jsdelivr CDN
 *     at runtime — unacceptable for an offline-capable app. We import the npm
 *     `monaco-editor` package and hand it to the loader instead.
 *  2. Wire up the editor's web workers through Vite's `?worker` imports and
 *     define the house `circuitus-light` (brass/ivory) theme once, app-wide.
 *
 * Consumers call `ensureMonacoSetup()` (idempotent) before rendering any
 * editor from `@monaco-editor/react`.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

/**
 * The Circuitus brass/ivory editor theme, shared by every Monaco surface
 * (DraftCompare's diff view, the Exhibits workspace, …). Safe to call more
 * than once — `defineTheme` simply overwrites the previous definition.
 */
export function defineCircuitusTheme(m: typeof monaco): void {
  m.editor.defineTheme('circuitus-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '0E1116', background: 'F5F1E8' },
      { token: 'comment', foreground: '5A6373', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#F5F1E8',
      'editor.foreground': '#0E1116',
      'editorLineNumber.foreground': '#B5AB95',
      'editorLineNumber.activeForeground': '#9C7A1F',
      'editor.lineHighlightBackground': '#EFEAD9',
      'editor.lineHighlightBorder': '#00000000',
      'editorGutter.background': '#FAF6EC',
      'editorGutter.modifiedBackground': '#9C7A1F',
      'editorGutter.addedBackground': '#5F915F',
      'editorGutter.deletedBackground': '#7A1E2E',
      'diffEditor.insertedTextBackground': 'rgba(95, 145, 95, 0.18)',
      'diffEditor.removedTextBackground': 'rgba(122, 30, 46, 0.18)',
      'diffEditor.insertedLineBackground': 'rgba(95, 145, 95, 0.10)',
      'diffEditor.removedLineBackground': 'rgba(122, 30, 46, 0.10)',
      'editorIndentGuide.background': '#E9E3D2',
      'editor.selectionBackground': 'rgba(156, 122, 31, 0.22)',
      'editorWidget.background': '#FAF6EC',
      'editorWidget.border': '#D9D2C0',
      'scrollbarSlider.background': 'rgba(14, 17, 22, 0.10)',
      'scrollbarSlider.hoverBackground': 'rgba(14, 17, 22, 0.18)',
      'diffEditor.border': '#D9D2C0',
    },
  });
}

let setupDone = false;

/** Idempotent app-wide Monaco initialization. Call before rendering an editor. */
export function ensureMonacoSetup(): void {
  if (setupDone) return;
  setupDone = true;

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };

  // Point @monaco-editor/react at the locally-bundled instance so it never
  // reaches for the CDN.
  loader.config({ monaco });

  defineCircuitusTheme(monaco);
}
