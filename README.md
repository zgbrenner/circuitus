<p align="center">
  <img src="images/Circuitus-readme.png" alt="Circuitus — The Tech-Forward Suite for Counsel" width="540" />
</p>

<p align="center">
  <strong>Legal research that looks like legal research.</strong>
</p>

<p align="center">
  <a href="https://circuitus.pages.dev"><img src="https://img.shields.io/badge/try_it-live-1a365d?style=flat-square&logo=cloudflare-pages&logoColor=white" alt="Live App" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="GPL-3.0" /></a>
  <a href="https://github.com/foolish-bandit/Circuitus/stargazers"><img src="https://img.shields.io/github/stars/foolish-bandit/Circuitus?style=flat-square&color=c9a227" alt="Stars" /></a>
</p>

<p align="center">
  A web-based document reader, annotation system, and curated practice library with legal-grade typography and a professional research interface. Everything runs in the browser. Nothing is uploaded. Nothing phones home.
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>
</p>

---

## Features

<table>
<tr>
<td width="50%">

**Document Reader**

- Import PDFs, EPUBs, and plain text
- Legal typography — justified serif, section numbering (&#167;), exhibit captioning
- Three font-size presets, toggleable paragraph numbering
- Scroll position saved per document
- Tabbed multi-document workspace

</td>
<td width="50%">

**Annotations**

- Highlight text in three colors (yellow, blue, green)
- Bookmark any passage
- All annotations saved locally via IndexedDB
- Organized by document and chapter
- No account required, no cloud sync

</td>
</tr>
<tr>
<td width="50%">

**Built-In Library**

12 practice guides covering:
- California contract law & SOW structuring
- AI governance frameworks
- CCPA/CPRA compliance (2026 update)
- NDA drafting with technology carve-outs
- Vendor agreements & DPAs
- Incident response planning
- IP provisions in tech agreements

Real statutory citations throughout.

</td>
<td width="50%">

**Research Interface**

- Left sidebar: navigable table of contents (auto-generated from headings)
- Right sidebar: related authorities with type badges (guide, article, case)
- Keyboard navigation between chapters
- Full-text search across the library
- Responsive layout — sidebars collapse gracefully

</td>
</tr>
</table>

---

## Citations Desk

The **Citations** tab is a research terminal for external authorities: query the open web and retrieve any article as a typeset, memo-style document — masthead, justified serif, table-of-authorities numbering. Retrieval goes through a configurable text-extraction endpoint (default: Jina Reader) so pages arrive as clean text, never as third-party markup. Pin authorities to keep them on file; your research trail is kept per session.

Running the desktop app? The Citations desk gains a **Live Session** mode — a real embedded browser inside the Circuitus chrome.

## Exhibit Compiler

The **Exhibits** tab is a full multi-file code workspace (Monaco — the editor engine behind VS Code) dressed as an exhibit annexing system. Files persist locally in IndexedDB, languages are auto-detected, and imports/exports work with plain files on disk. The **Instrument View** toggle instantly swaps the editor for a practice-guide document; the global quick-reference chord covers this tab like every other.

## Deposition Review

The **Depositions** tab is a video room dressed as certified-recording review: lodge YouTube links or direct media URLs, or import video files (stored locally in IndexedDB). Each recording gets a transcript-style case caption, and **Compact Review** docks the player into a small corner panel while the main pane shows an errata sheet — playback never restarts.

## Desktop App

An optional Electron shell (`npm run desktop`) wraps the suite in a native window:

- **Real embedded browsing** in the Citations desk (no proxy, no iframe limits)
- **System-wide vanish hotkey** — <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> hides the entire window from anywhere, even when Circuitus isn't focused; press again to restore
- Same local-only storage; nothing changes about where your data lives

See [`electron/README.md`](electron/README.md) for details.

---

## Quick Reference Mode

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> instantly switches the entire UI to display a practice guide on SOW structuring. Your previous state is saved and restored when you press the shortcut again. An optional **hot corner** (configurable in the <kbd>?</kbd> shortcuts sheet) engages the cover when your cursor dwells in a top screen corner — no keys required.

The status bar indicates when quick-reference mode is active.

---

## Try It

**Live at [circuitus.pages.dev](https://circuitus.pages.dev)**

Or run locally:

```bash
git clone https://github.com/foolish-bandit/Circuitus.git
cd Circuitus
npm install
npm run dev
```

No API keys. No backend. No accounts. Opens in your browser.

---

## Architecture

```
All data lives client-side.
No server. No uploads. No tracking. No analytics.
```

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Tailwind CSS |
| Build | Vite |
| Storage | IndexedDB (documents, highlights, bookmarks) |
| PDF parsing | pdf.js (spatial text extraction, heading detection) |
| EPUB parsing | JSZip (OPF spine extraction) |
| Icons | Lucide React |

**Design:** Navy and gold color scheme. Libre Baskerville for document text, sans-serif for interface chrome. Styled to feel like a professional legal research platform.

---

## Contributing

```bash
npm install
npm run dev       # dev server
npm run build     # production build
```

PRs welcome — especially new practice guides, document format support, and annotation features.

---

## License

GPL-3.0

<p align="center">
  <sub>Built by <a href="https://github.com/foolish-bandit">Zack Brenner</a></sub>
</p>
