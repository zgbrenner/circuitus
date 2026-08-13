// Circuitus Desktop — preload (CommonJS, sandboxed).
// Exposes the `circuitusDesktop` bridge the renderer codes against.
// Contract: see src/types/desktop.d.ts — implement it verbatim.
const { contextBridge, ipcRenderer } = require('electron');

// One sync round-trip at preload time to fetch the app version. Sync IPC is
// acceptable here (preload runs once before the page); it avoids both a
// stale process.env fallback and bundling package.json into the sandbox.
let version = 'unknown';
try {
  version = ipcRenderer.sendSync('circuitus:version') || version;
} catch {
  // Main not ready / channel missing — keep the fallback.
}

/**
 * Subscribe `cb` to an IPC channel, dropping the IpcRendererEvent argument
 * so renderer callbacks only ever see plain payloads. Returns unsubscribe.
 */
function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('circuitusDesktop', {
  version,
  browser: {
    open: (url) => ipcRenderer.send('circuitus:browser:open', url),
    setBounds: (b) =>
      // Re-pluck the fields so only plain serializable data crosses IPC.
      ipcRenderer.send('circuitus:browser:setBounds', {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      }),
    show: () => ipcRenderer.send('circuitus:browser:show'),
    hide: () => ipcRenderer.send('circuitus:browser:hide'),
    close: () => ipcRenderer.send('circuitus:browser:close'),
    back: () => ipcRenderer.send('circuitus:browser:back'),
    forward: () => ipcRenderer.send('circuitus:browser:forward'),
    reload: () => ipcRenderer.send('circuitus:browser:reload'),
    onState: (cb) => subscribe('circuitus:browser:state', cb),
  },
  onBossKey: (cb) => subscribe('circuitus:bosskey', cb),
});
