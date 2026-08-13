# Circuitus Desktop

Optional Electron shell for Circuitus. It adds two things the web build cannot do:

- **A real embedded browser** — the Citations page drives an actual Chromium
  `WebContentsView` (sandboxed, no preload) instead of an iframe, so sites that
  refuse to be framed work.
- **A global vanish hotkey** — `Ctrl+Shift+H` (`Cmd+Shift+H` on macOS) hides the
  entire app instantly, even when it is not focused. Press it again to bring the
  window back (the embedded browser stays hidden until the app re-shows it).

## Run

```sh
# Production-style: build the web app, then launch the shell against dist/
npm run desktop

# Development: start Vite in one terminal, the shell in another
npm run dev
npm run desktop:dev        # loads http://localhost:5173 (or set VITE_DEV_SERVER_URL)
```

## Renderer bridge

`electron/preload.cjs` exposes `window.circuitusDesktop` (typed in
`src/types/desktop.d.ts`): `version`, `browser.{open,setBounds,show,hide,close,
back,forward,reload,onState}` and `onBossKey`. The web app feature-detects it —
in a plain browser the property is absent and everything falls back to web
behavior.

## Security notes

- Main window: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; all `window.open` denied.
- Embedded view: fully sandboxed, **no preload**, http/https URLs only
  (enforced on open and on every navigation); popup attempts navigate the
  same view instead of opening windows.
- All IPC handlers validate the sender is the main window's own frame.

## Packaging

No packager is wired up. To produce installers, add
[electron-builder](https://www.electron.build/) or Electron Forge; `main` in
`package.json` already points at `electron/main.mjs` and the renderer builds
with relative asset paths (`base: './'`), so `dist/` works from `file://` as-is.
