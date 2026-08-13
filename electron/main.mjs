// Circuitus Desktop — Electron main process.
// Plain ESM, no build step. Only depends on 'electron' and node builtins.
import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  globalShortcut,
  Menu,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Only ever allow web content over http(s) — anything else (file:, javascript:,
 *  chrome:, etc.) is rejected both on open and on navigation. */
function isHttpUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Dev server URL from `--dev-server=<url>` argv or VITE_DEV_SERVER_URL env. */
function getDevServerUrl() {
  const arg = process.argv.find((a) => a.startsWith('--dev-server='));
  if (arg) return arg.slice('--dev-server='.length);
  return process.env.VITE_DEV_SERVER_URL || null;
}

/** @type {BrowserWindow | null} */
let win = null;
/** The single embedded browser view (created lazily on browser:open). */
/** @type {WebContentsView | null} */
let browserView = null;
/** Last bounds received from the renderer, reapplied on show(). */
let browserBounds = { x: 0, y: 0, width: 0, height: 0 };
let browserVisible = false;

// ---------------------------------------------------------------------------
// Embedded browser view
// ---------------------------------------------------------------------------

function pushBrowserState() {
  if (!win || win.isDestroyed() || !browserView) return;
  const wc = browserView.webContents;
  /** Matches the renderer's BrowserState contract exactly. */
  const state = {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
  };
  win.webContents.send('circuitus:browser:state', state);
}

function ensureBrowserView() {
  if (browserView) return browserView;

  browserView = new WebContentsView({
    webPreferences: {
      // Untrusted web content: fully sandboxed, no preload, no node.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const wc = browserView.webContents;

  // Every navigation/loading/title event pushes a full state snapshot.
  for (const ev of [
    'did-navigate',
    'did-navigate-in-page',
    'page-title-updated',
    'did-start-loading',
    'did-stop-loading',
  ]) {
    wc.on(ev, pushBrowserState);
  }

  // Block non-http(s) navigation inside the view (e.g. file:// links).
  wc.on('will-navigate', (event, url) => {
    if (!isHttpUrl(url)) event.preventDefault();
  });

  // Links that want a new window/tab navigate this same view instead —
  // the disguise never spawns extra OS windows.
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) wc.loadURL(url);
    return { action: 'deny' };
  });

  return browserView;
}

function showBrowserView() {
  if (!win || !browserView) return;
  if (!browserVisible) {
    win.contentView.addChildView(browserView);
    browserVisible = true;
  }
  browserView.setBounds(browserBounds);
}

function hideBrowserView() {
  if (!win || !browserView || !browserVisible) return;
  win.contentView.removeChildView(browserView);
  browserVisible = false;
}

function closeBrowserView() {
  if (!browserView) return;
  hideBrowserView();
  browserView.webContents.close();
  browserView = null;
}

// ---------------------------------------------------------------------------
// IPC — every handler validates that the message really comes from our own
// window's frame; the sandboxed embedded view has no preload, so it cannot
// reach these channels, but sender validation is defense-in-depth.
// ---------------------------------------------------------------------------

function fromMainWindow(event) {
  return win !== null && !win.isDestroyed() && event.sender === win.webContents;
}

ipcMain.on('circuitus:version', (event) => {
  if (!fromMainWindow(event)) return;
  // Answered synchronously once at preload time.
  event.returnValue = app.getVersion();
});

ipcMain.on('circuitus:browser:open', (event, url) => {
  if (!fromMainWindow(event)) return;
  if (typeof url !== 'string' || !isHttpUrl(url)) return;
  ensureBrowserView();
  showBrowserView();
  browserView.webContents.loadURL(url);
});

ipcMain.on('circuitus:browser:setBounds', (event, b) => {
  if (!fromMainWindow(event)) return;
  if (
    !b ||
    typeof b.x !== 'number' ||
    typeof b.y !== 'number' ||
    typeof b.width !== 'number' ||
    typeof b.height !== 'number'
  ) {
    return;
  }
  // The renderer sends CSS px relative to its viewport. The BrowserWindow is
  // framed (native chrome), so the renderer viewport IS the window's content
  // area — and WebContentsView bounds are content-area-relative DIP, which
  // map 1:1 onto CSS px. No offset math needed; round to integers.
  browserBounds = {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
  if (browserVisible && browserView) browserView.setBounds(browserBounds);
});

ipcMain.on('circuitus:browser:show', (event) => {
  if (!fromMainWindow(event)) return;
  if (browserView) showBrowserView();
});

ipcMain.on('circuitus:browser:hide', (event) => {
  if (!fromMainWindow(event)) return;
  hideBrowserView();
});

ipcMain.on('circuitus:browser:close', (event) => {
  if (!fromMainWindow(event)) return;
  closeBrowserView();
});

ipcMain.on('circuitus:browser:back', (event) => {
  if (!fromMainWindow(event) || !browserView) return;
  browserView.webContents.navigationHistory.goBack();
});

ipcMain.on('circuitus:browser:forward', (event) => {
  if (!fromMainWindow(event) || !browserView) return;
  browserView.webContents.navigationHistory.goForward();
});

ipcMain.on('circuitus:browser:reload', (event) => {
  if (!fromMainWindow(event) || !browserView) return;
  browserView.webContents.reload();
});

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Circuitus — Legal Research Suite',
    backgroundColor: '#F5F1E8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The app UI itself never opens new windows; nothing is passed to the OS
  // browser either — no shell.openExternal without an explicit allowlist,
  // and we currently choose to open nothing externally at all.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    // The SPA only ever loads its own entry; block anything else.
    const devUrl = getDevServerUrl();
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file:');
    if (!allowed) event.preventDefault();
  });

  win.on('closed', () => {
    win = null;
    browserView = null;
    browserVisible = false;
  });

  const devUrl = getDevServerUrl();
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ---------------------------------------------------------------------------
// Global vanish hotkey ("boss key")
// ---------------------------------------------------------------------------

function registerBossKey() {
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) {
      // Tell the renderer first so it can pause audio/state, but hide the
      // embedded view here immediately — never wait on the renderer to vanish.
      win.webContents.send('circuitus:bosskey');
      hideBrowserView();
      win.hide();
    } else {
      // Reappear with the browser view still hidden; the renderer decides
      // whether/when to bring it back via browser.show().
      win.show();
    }
  });
  // Deliberately NO handling on window 'blur': hiding on every focus loss is
  // too aggressive (alt-tabbing to take notes would vanish the app). The
  // global hotkey works even when the window is not focused, which covers
  // the real use case.
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.setName('Circuitus');

app.whenReady().then(() => {
  // Roles-only menu so standard shortcuts (Cmd+C/V, zoom, fullscreen) work,
  // especially on macOS where no menu means no edit shortcuts.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
    ])
  );

  createWindow();
  registerBossKey();

  app.on('activate', () => {
    // macOS dock click with no windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
