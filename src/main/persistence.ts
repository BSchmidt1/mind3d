import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';

const JSON_FILTER = [{ name: 'mind3d map', extensions: ['json'] }];

function rotateBackups(file: string): void {
  if (!fs.existsSync(file)) return;
  for (let i = 4; i >= 1; i--) {
    const from = `${file}.bak.${i}`;
    if (fs.existsSync(from)) fs.renameSync(from, `${file}.bak.${i + 1}`);
  }
  fs.copyFileSync(file, `${file}.bak.1`);
}

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

export function registerPersistenceIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('map-open', async () => {
    const win = getWindow();
    if (!win) throw new Error('no window');
    const res = await dialog.showOpenDialog(win, { filters: JSON_FILTER, properties: ['openFile'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    const p = res.filePaths[0]!;
    return { path: p, json: fs.readFileSync(p, 'utf8') };
  });

  ipcMain.handle('map-save', async (_e, p: string | null, json: string) => {
    let target = p;
    if (target === null) {
      const win = getWindow();
      if (!win) throw new Error('no window');
      const res = await dialog.showSaveDialog(win, { filters: JSON_FILTER, defaultPath: 'map.json' });
      if (res.canceled || !res.filePath) return null;
      target = res.filePath;
    }
    rotateBackups(target);
    atomicWrite(target, json);
    return target;
  });

  ipcMain.handle('file-pick', async () => {
    const win = getWindow();
    if (!win) throw new Error('no window');
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
  });

  ipcMain.handle('file-read', (_e, p: string) => fs.readFileSync(p, 'utf8'));
  ipcMain.handle('open-external', (_e, url: string) => {
    const proto = new URL(url).protocol;
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'obsidian:') {
      throw new Error(`open-external: scheme "${proto}" not allowed`);
    }
    return shell.openExternal(url);
  });
  ipcMain.handle('open-path', async (_e, p: string) => {
    const err = await shell.openPath(p);
    if (err) throw new Error(`openPath failed: ${err}`);
  });
  ipcMain.handle('path-dirname', (_e, p: string) => path.dirname(p));
}
