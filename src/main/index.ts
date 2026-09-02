import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { registerPersistenceIpc } from './persistence';
import { registerClaudeIpc } from './claudeRunner';
import { registerVoiceIpc } from './voiceRunner';

let win: BrowserWindow | null = null;
export function getWindow(): BrowserWindow | null {
  return win;
}

// Shared between the window's `close` handler and app's `before-quit`
// handler so whichever runs the save handshake first "wins" — the other
// sees `saved` already true and lets its own close/quit proceed without
// re-sending save-requested (avoids a deadlock where each waits on the
// other to get out of the way).
let saved = false;

function requestSaveThenClose(w: BrowserWindow, proceed: () => void): void {
  let settled = false;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    saved = true;
    proceed();
  };
  w.webContents.send('save-requested');
  ipcMain.once('save-done', finish);
  setTimeout(finish, 5000);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'mind3d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // DOMPurify keeps <a href>, so a link click in a notes/file preview could
  // otherwise navigate this window (preload bridge attached) to remote
  // content. renderMarkdown's own click handler routes http/https links
  // through the allowlisted openExternal IPC instead; block navigation and
  // new-window creation outright as defense in depth.
  win.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (e) => {
    if (saved) return;
    e.preventDefault();
    requestSaveThenClose(win!, () => win?.destroy());
  });
  win.on('closed', () => {
    win = null;
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

registerPersistenceIpc(getWindow);
registerClaudeIpc();
registerVoiceIpc();

app.on('before-quit', (e) => {
  if (saved) return;
  const w = getWindow();
  if (!w) return;
  e.preventDefault();
  requestSaveThenClose(w, () => app.quit());
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
