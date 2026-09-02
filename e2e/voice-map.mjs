// Bounded E2E smoke for Task F6 "Voice upgrades — editable transcript confirm +
// shared proposal engine". Drives the production build (out/main, out/preload,
// out/renderer) via Playwright's Electron API and verifies:
//  A) a synthetic transcript (injected via the main-process `voice-transcript`
//     IPC — the SAME channel nerd-dictation uses, so NO mic is touched) pops the
//     editable `#voice-confirm` box pre-filled with the heard text, and Cancel
//     aborts cleanly with no store mutation and no `claude` call;
//  B) re-injecting, editing the text, and clicking Run direct-applies a real
//     (bounded) `claude -p` result — nodes appear (voice does NOT use the F3b
//     preview; the editable confirm is its review gate), a single progress toast
//     ends in an "added — Ctrl+Z to undo" hint, and one Ctrl+Z removes the batch.
// Records console errors / page errors — acceptance is 0 renderer errors.
//
// Isolated user-data-dir so it never collides with a running dev instance.
// Does NOT press the mic or start nerd-dictation, and leaves any pre-existing
// process alone. Usage: node e2e/voice-map.mjs

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind3d-f6-smoke-'));

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
const nodeCount = (page) =>
  page.evaluate(() => {
    const t = document.getElementById('status-counts')?.textContent ?? '';
    const m = t.match(/(\d+)\s+nodes/);
    return m ? Number(m[1]) : -1;
  });
function injectTranscript(electronApp, text) {
  return electronApp.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no BrowserWindow to inject into');
    win.webContents.send('voice-transcript', payload);
  }, { text });
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
      page.evaluate(
        () =>
          typeof window.mind3d !== 'undefined' &&
          typeof window.mind3d.askClaude === 'function' &&
          typeof window.mind3d.onVoiceTranscript === 'function'
      ),
      5000,
      'window.mind3d voice api eval'
    );
    if (!hasApi) throw new Error('window.mind3d.askClaude / onVoiceTranscript not exposed');
    record('setup', 'PASS', 'topbar present; voice IPC api exposed');
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'f6-setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  // --- A: synthetic transcript -> editable confirm box; Cancel aborts (no claude, no mutation) ---
  try {
    const heard = 'add three chldren grants donors events'; // deliberate typo -> user would fix it
    const before = await nodeCount(page);
    await withTimeout(injectTranscript(electronApp, heard), 4000, 'inject transcript (A)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('voice-confirm')?.hidden === false, { timeout: 4000 }),
      4500,
      'wait confirm box (A)'
    );
    const filled = await page.inputValue('#voice-confirm .vc-textarea');
    if (filled !== heard) throw new Error(`confirm textarea = ${JSON.stringify(filled)}, expected the heard text`);
    await screenshot(page, 'f6-a-confirm.png');
    await withTimeout(page.click('#voice-confirm .vc-cancel', { timeout: 3000 }), 3500, 'cancel (A)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('voice-confirm')?.hidden === true, { timeout: 3000 }),
      3500,
      'confirm hidden after cancel (A)'
    );
    const after = await nodeCount(page);
    if (after !== before) throw new Error(`Cancel mutated the map: nodes ${before} -> ${after}`);
    const cancelledToast = await page.evaluate(() =>
      [...document.querySelectorAll('#toast-host .toast')].some((t) => (t.textContent ?? '').includes('cancelled'))
    );
    if (!cancelledToast) throw new Error('no "cancelled" toast after Cancel');
    record('A (confirm appears + cancel aborts)', 'PASS', `box pre-filled with heard text; Cancel left nodes=${after} unchanged`);
  } catch (err) {
    record('A (confirm appears + cancel aborts)', 'FAIL', err.message);
    await screenshot(page, 'f6-a-failure.png');
  }

  // --- B: re-inject -> edit -> Run -> real claude direct-apply -> success toast -> Ctrl+Z undoes ---
  try {
    await withTimeout(injectTranscript(electronApp, 'garbled speech to be corrected'), 4000, 'inject transcript (B)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('voice-confirm')?.hidden === false, { timeout: 4000 }),
      4500,
      'wait confirm box (B)'
    );
    // Edit the heard text to a crisp, unambiguous instruction before Run.
    const instruction = 'Add exactly one new node with the label Zebra. Do not add any edges.';
    await withTimeout(
      page.evaluate((text) => {
        const ta = document.querySelector('#voice-confirm .vc-textarea');
        ta.value = text;
      }, instruction),
      3000,
      'edit confirm text (B)'
    );
    const before = await nodeCount(page);
    await withTimeout(page.click('#voice-confirm .vc-run', { timeout: 3000 }), 3500, 'run (B)');
    // Confirm box closes immediately on Run (can't be double-run).
    await withTimeout(
      page.waitForFunction(() => document.getElementById('voice-confirm')?.hidden === true, { timeout: 3000 }),
      3500,
      'confirm hidden after run (B)'
    );
    // Real (bounded) claude round-trip, then direct-apply -> success toast with undo hint.
    await withTimeout(
      page.waitForFunction(
        () =>
          [...document.querySelectorAll('#toast-host .toast')].some((t) =>
            /added — Ctrl\+Z to undo/.test(t.textContent ?? '')
          ),
        { timeout: 90000 }
      ),
      91000,
      'wait success toast (B)'
    );
    const afterRun = await nodeCount(page);
    if (afterRun <= before) throw new Error(`Run did not add nodes: ${before} -> ${afterRun}`);
    await screenshot(page, 'f6-b-applied.png');
    // Single Ctrl+Z removes the whole voice batch (blur first so the undo
    // handler doesn't bail on an input having focus).
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await withTimeout(page.keyboard.press('Control+z'), 3000, 'undo (B)');
    await withTimeout(
      page.waitForFunction((n) => {
        const t = document.getElementById('status-counts')?.textContent ?? '';
        const m = t.match(/(\d+)\s+nodes/);
        return m && Number(m[1]) === n;
      }, before, { timeout: 4000 }),
      4500,
      'wait undo to baseline (B)'
    );
    record('B (run -> direct-apply -> undo)', 'PASS', `nodes ${before} -> ${afterRun} on Run; one Ctrl+Z restored ${before}`);
  } catch (err) {
    record('B (run -> direct-apply -> undo)', 'FAIL', err.message);
    await screenshot(page, 'f6-b-failure.png');
  }

  await screenshot(page, 'f6-final.png');
  const exit = results.some((r) => r.status === 'FAIL') || pageErrors.length > 0 ? 1 : 0;
  await finish(electronApp, electronPid, exit);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== F6 SMOKE SUMMARY ===');
  for (const r of results) log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  log(`\nconsole errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  for (const c of consoleErrors) log(c);
  for (const p of pageErrors) log(p);

  const findingsPath = path.join(artifactsDir, 'f6-findings.md');
  const lines = ['# Voice-upgrades (F6) E2E smoke', '', '## Results'];
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
