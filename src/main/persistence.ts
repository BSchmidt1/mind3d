import { app, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';

const JSON_FILTER = [{ name: 'mind3d map', extensions: ['json'] }];

// F5 URL import: bounds for the scheme-allowlisted main-process fetch. The
// response is read through a byte-capped stream (a chunked reply without a
// Content-Length header cannot blow memory), and an AbortController caps wall
// time. No credentials are sent — plain http/https to the user-supplied URL.
const URL_FETCH_MAX_BYTES = 512 * 1024;
const URL_FETCH_TIMEOUT_MS = 15000;

// Strip an HTML page down to readable text so URL import gets the article body,
// not <head>/boilerplate (the downstream IMPORT_TRUNCATE cap of 12000 chars
// otherwise often cuts before any real content). Regex-based on purpose — a v1
// best-effort: drop <script>/<style> blocks entirely, remove all remaining
// tags, decode the handful of common entities, and collapse whitespace. This is
// applied ONLY when the response looks like HTML (see fetchUrlText), so
// plain-text / markdown sources pass through untouched.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUrlText(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`url-fetch: invalid URL "${url}"`);
  }
  const proto = parsed.protocol;
  if (proto !== 'http:' && proto !== 'https:') {
    throw new Error(`url-fetch: scheme "${proto}" not allowed (only http/https)`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'follow',
      // A static UA (no identifying info) so UA-less requests don't spuriously
      // 403; still no credentials/cookies/auth headers.
      headers: {
        accept: 'text/*, application/json, application/xhtml+xml, */*;q=0.1',
        'user-agent': 'mind3d/0.1'
      }
    });
    if (!res.ok) throw new Error(`url-fetch: ${res.status} ${res.statusText}`);
    const contentType = res.headers.get('content-type') ?? '';
    const declared = res.headers.get('content-length');
    if (declared !== null && Number(declared) > URL_FETCH_MAX_BYTES) {
      throw new Error(`url-fetch: response too large (${declared} bytes > ${URL_FETCH_MAX_BYTES})`);
    }
    const body = res.body;
    if (body === null) return '';
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > URL_FETCH_MAX_BYTES) {
        await reader.cancel();
        throw new Error(`url-fetch: response exceeded ${URL_FETCH_MAX_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    // Only strip when the response looks like HTML — by content-type, or by an
    // <html>/<body> tag near the top — so plain text / markdown is returned
    // verbatim (a tag-strip on prose would be a no-op anyway, but a stray "<"
    // in markdown must not be mangled).
    const looksHtml =
      /text\/html/i.test(contentType) ||
      /<html[\s>]/i.test(raw.slice(0, 2000)) ||
      /<body[\s>]/i.test(raw.slice(0, 4000));
    return looksHtml ? htmlToText(raw) : raw;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`url-fetch: timed out after ${URL_FETCH_TIMEOUT_MS} ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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

  ipcMain.handle('map-recovery-save', (_e, json: string) => {
    const p = path.join(app.getPath('userData'), 'recovery.json');
    atomicWrite(p, json);
    return p;
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
  ipcMain.handle('url-fetch', (_e, url: string) => fetchUrlText(url));
}
