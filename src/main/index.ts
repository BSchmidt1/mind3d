import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { registerPersistenceIpc } from './persistence';

let win: BrowserWindow | null = null;
export function getWindow(): BrowserWindow | null {
  return win;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'mind3d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
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

let quitReady = false;
app.on('before-quit', (e) => {
  if (quitReady) return;
  const w = getWindow();
  if (!w) return;
  e.preventDefault();
  w.webContents.send('save-requested');
  const finish = (): void => {
    if (quitReady) return;
    quitReady = true;
    app.quit();
  };
  ipcMain.once('save-done', finish);
  setTimeout(finish, 1500);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
