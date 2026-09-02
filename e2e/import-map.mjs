// Bounded E2E smoke for Task F5 "Import text / file / URL -> map". Drives the
// production build (out/main, out/preload, out/renderer) via Playwright's
// Electron API and verifies: the Ctrl+K palette lists the `import-map` command;
// pasting a small literal outline and clicking Import runs a real (bounded)
// `claude -p` extraction that renders an ops proposal in the F3b preview
// (Accept/Reject), and Reject leaves the store unchanged; and a `file://` URL
// fetch is rejected by the scheme allowlist (error toast, no crash). Records
// console errors / page errors — acceptance is 0 renderer errors.
//
// Isolated user-data-dir so it never collides with a running dev instance.
// Does NOT touch the mic or any pre-existing process. Usage: node e2e/import-map.mjs

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind3d-f5-smoke-'));

const consoleMessages = [];
const consoleErrors = [];
const pageErrors = [];
const results = [];

const log = (l) => console.log(l);
function record(scenario, status, detail) {
  results.push({ scenario, status, detail });
  log(`[${status}] ${scenario}: ${detail}`);
}
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function screenshot(page, name) {
  try {
    const p = path.join(artifactsDir, name);
    await withTimeout(page.screenshot({ path: p }), 5000, `screenshot ${name}`);
    log(`  screenshot: ${p}`);
  } catch (err) {
    log(`  screenshot FAILED (${name}): ${err.message}`);
  }
}

async function main() {
  log(`repoRoot=${repoRoot}`);
  log(`DISPLAY=${process.env.DISPLAY ?? '(unset -> :1)'} userDataDir=${userDataDir}`);

  const electronApp = await electron.launch({
    args: [repoRoot, '--disable-gpu', '--enable-unsafe-swiftshader', `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':1' }
  });
  const electronPid = electronApp.process().pid;
  log(`electron main pid=${electronPid}`);

  const page = await electronApp.firstWindow();
  page.on('console', (msg) => {
    const entry = `[console:${msg.type()}] ${msg.text()}`;
    consoleMessages.push(entry);
    if (msg.type() === 'error') consoleErrors.push(entry);
    log(entry);
  });
  page.on('pageerror', (err) => {
    const entry = `[pageerror] ${err.stack ?? err.message}`;
    pageErrors.push(entry);
    log(entry);
  });

  // --- setup ---
  try {
    await withTimeout(page.waitForSelector('#topbar', { timeout: 15000 }), 16000, '#topbar');
    const hasApi = await withTimeout(
      page.evaluate(() => typeof window.mind3d !== 'undefined' && typeof window.mind3d.fetchUrl === 'function'),
      5000,
      'window.mind3d.fetchUrl eval'
    );
    if (!hasApi) throw new Error('window.mind3d.fetchUrl not exposed');
    record('setup', 'PASS', 'topbar present; window.mind3d.fetchUrl exposed');
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'f5-setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  // --- A: Ctrl+K palette lists the import-map command; Enter opens the modal ---
  try {
    await withTimeout(page.keyboard.press('Control+k'), 3000, 'open palette (A)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('cmd-palette')?.hidden === false, { timeout: 3000 }),
      3500,
      'wait palette open (A)'
    );
    await withTimeout(page.fill('#cmd-input', 'import'), 3000, 'type import (A)');
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('#cmd-palette .cmd-title')].map((e) => e.textContent)
    );
    const hasImport = titles.some((t) => t.includes('Import text / file / URL'));
    if (!hasImport) throw new Error(`no import command; titles=${JSON.stringify(titles)}`);
    // Enter runs the highlighted (top) command -> opens the modal.
    await withTimeout(page.keyboard.press('Enter'), 3000, 'run import command (A)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('import-modal')?.hidden === false, { timeout: 3000 }),
      3500,
      'wait import modal (A)'
    );
    record('A (palette + modal open)', 'PASS', `import command listed; modal opened`);
  } catch (err) {
    record('A (palette + modal open)', 'FAIL', err.message);
    await screenshot(page, 'f5-a-failure.png');
  }

  // --- B: bad-scheme URL fetch (file://) -> error toast, no crash ---
  try {
    // Modal should still be open from A; reopen defensively if not.
    const open = await page.evaluate(() => document.getElementById('import-modal')?.hidden === false);
    if (!open) {
      await page.keyboard.press('Control+k');
      await page.waitForFunction(() => document.getElementById('cmd-palette')?.hidden === false, { timeout: 3000 });
      await page.fill('#cmd-input', 'import');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('import-modal')?.hidden === false, { timeout: 3000 });
    }
    await withTimeout(page.fill('#import-modal .import-url', 'file:///etc/passwd'), 3000, 'type bad url (B)');
    await withTimeout(page.click('#import-modal .import-fetch', { timeout: 3000 }), 3500, 'fetch (B)');
    await withTimeout(
      page.waitForFunction(
        () =>
          [...document.querySelectorAll('#toast-host .toast-error')].some((t) =>
            (t.textContent ?? '').includes('scheme')
          ),
        { timeout: 8000 }
      ),
      8500,
      'wait error toast (B)'
    );
    // Textarea must not have been filled with file contents.
    const ta = await page.inputValue('#import-modal .import-textarea');
    if (ta !== '') throw new Error('textarea was filled despite blocked scheme');
    record('B (bad scheme blocked)', 'PASS', 'file:// fetch surfaced an error toast; textarea empty');
  } catch (err) {
    record('B (bad scheme blocked)', 'FAIL', err.message);
    await screenshot(page, 'f5-b-failure.png');
  }

  // --- C: paste outline -> Import -> ops proposal preview -> Reject (no mutation) ---
  try {
    await withTimeout(page.click('#import-modal .import-textarea', { timeout: 3000 }), 3500, 'focus textarea (C)');
    const doc = [
      'Project Plan',
      '- Research: gather sources, interview users',
      '- Design: wireframes and visual style',
      '- Build: frontend, backend, automated tests'
    ].join('\n');
    // Set the value directly (typing multi-line into a textarea is slow/fragile).
    await withTimeout(
      page.evaluate((text) => {
        const ta = document.querySelector('#import-modal .import-textarea');
        ta.value = text;
      }, doc),
      3000,
      'set textarea (C)'
    );
    await withTimeout(page.click('#import-modal .import-go', { timeout: 3000 }), 3500, 'submit import (C)');
    await withTimeout(
      page.waitForFunction(
        () =>
          document.getElementById('proposal-panel')?.hidden === false &&
          document.querySelector('#proposal-panel .proposal-accept') !== null,
        { timeout: 90000 }
      ),
      91000,
      'wait proposal preview (C)'
    );
    const ops = await page.evaluate(() =>
      [...document.querySelectorAll('#proposal-panel .proposal-ops li')].map((e) => e.textContent)
    );
    const nodesBefore = await page.evaluate(() => document.getElementById('outline-list')?.textContent ?? '');
    await withTimeout(page.click('#proposal-panel .proposal-reject', { timeout: 3000 }), 3500, 'reject (C)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('proposal-panel')?.hidden === true, { timeout: 3000 }),
      3500,
      'panel hidden after reject (C)'
    );
    const nodesAfter = await page.evaluate(() => document.getElementById('outline-list')?.textContent ?? '');
    if (nodesAfter !== nodesBefore) throw new Error('Reject mutated the store');
    if (ops.length === 0) throw new Error('proposal preview had no ops');
    record('C (import -> preview -> reject)', 'PASS', `preview ops=${JSON.stringify(ops)}; reject left store unchanged`);
  } catch (err) {
    record('C (import -> preview -> reject)', 'FAIL', err.message);
    await screenshot(page, 'f5-c-failure.png');
  }

  await screenshot(page, 'f5-final.png');
  const exit = results.some((r) => r.status === 'FAIL') || pageErrors.length > 0 ? 1 : 0;
  await finish(electronApp, electronPid, exit);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== F5 SMOKE SUMMARY ===');
  for (const r of results) log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  log(`\nconsole errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  for (const c of consoleErrors) log(c);
  for (const p of pageErrors) log(p);

  const findingsPath = path.join(artifactsDir, 'f5-findings.md');
  const lines = ['# Import-to-map (F5) E2E smoke', '', '## Results'];
  for (const r of results) lines.push(`- **${r.status}** ${r.scenario}: ${r.detail}`);
  lines.push('', `## Console errors (${consoleErrors.length})`, '```', ...consoleErrors, '```');
  lines.push('', `## Page errors (${pageErrors.length})`, '```', ...pageErrors, '```');
  fs.writeFileSync(findingsPath, lines.join('\n') + '\n');
  log(`\nFindings written to ${findingsPath}`);

  try {
    await withTimeout(electronApp.close(), 5000, 'electronApp.close()');
  } catch (err) {
    log(`close failed (${err.message}); killing ${electronPid}`);
    try {
      process.kill(electronPid, 'SIGKILL');
    } catch (e) {
      log(`kill failed: ${e.message}`);
    }
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error('HARNESS CRASHED:', err);
  process.exitCode = 1;
});
