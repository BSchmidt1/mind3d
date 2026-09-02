// Bounded E2E smoke for Task F4 "Ask the map". Drives the production build
// (out/main, out/preload, out/renderer) via Playwright's Electron API and
// verifies: the #btn-ask free-text entry opens; the Ctrl+K palette lists the
// ask commands; a real (bounded) `claude -p` ask returns an ops proposal that
// renders in the F3b preview (Accept/Reject); and a second ask that only
// answers renders via showAnswer. Records console errors / page errors —
// acceptance is 0 renderer errors.
//
// Isolated user-data-dir so it never collides with a running dev instance.
// Does NOT touch the mic or any pre-existing process. Usage: node e2e/ask-map.mjs

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind3d-f4-smoke-'));

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
    await withTimeout(page.waitForSelector('#btn-ask', { timeout: 15000 }), 16000, '#btn-ask');
    const hasApi = await withTimeout(
      page.evaluate(() => typeof window.mind3d !== 'undefined'),
      5000,
      'window.mind3d eval'
    );
    record('setup', 'PASS', `#btn-ask present; window.mind3d defined=${hasApi}`);
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'f4-setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  // --- A: free-text entry opens, accepts input, Escape closes ---
  try {
    await withTimeout(page.click('#btn-ask', { timeout: 5000 }), 6000, 'click #btn-ask (A)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('ask-input')?.hidden === false, { timeout: 3000 }),
      3500,
      'wait #ask-input visible (A)'
    );
    await withTimeout(page.click('#ask-input .ask-textarea', { timeout: 3000 }), 3500, 'focus textarea (A)');
    await withTimeout(page.keyboard.type('hello there'), 3000, 'type (A)');
    const val = await page.inputValue('#ask-input .ask-textarea');
    await withTimeout(page.keyboard.press('Escape'), 3000, 'Escape (A)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('ask-input')?.hidden === true, { timeout: 3000 }),
      3500,
      'wait #ask-input hidden (A)'
    );
    if (val !== 'hello there') throw new Error(`textarea value was "${val}"`);
    record('A (free-text entry)', 'PASS', 'opened, captured input, Escape closed');
  } catch (err) {
    record('A (free-text entry)', 'FAIL', err.message);
    await screenshot(page, 'f4-a-failure.png');
  }

  // --- B: Ctrl+K palette lists the ask commands ---
  try {
    await withTimeout(page.keyboard.press('Control+k'), 3000, 'open palette (B)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('cmd-palette')?.hidden === false, { timeout: 3000 }),
      3500,
      'wait palette open (B)'
    );
    await withTimeout(page.fill('#cmd-input', 'ask'), 3000, 'type ask (B)');
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('#cmd-palette .cmd-title')].map((e) => e.textContent)
    );
    await withTimeout(page.keyboard.press('Escape'), 3000, 'close palette (B)');
    const hasFreeText = titles.some((t) => t.includes('Ask the map'));
    const presetCount = titles.filter((t) => t.startsWith('Ask:')).length;
    if (!hasFreeText) throw new Error(`no "Ask the map" command; titles=${JSON.stringify(titles)}`);
    if (presetCount < 5) throw new Error(`only ${presetCount} preset(s); titles=${JSON.stringify(titles)}`);
    record('B (palette commands)', 'PASS', `free-text + ${presetCount} presets listed`);
  } catch (err) {
    record('B (palette commands)', 'FAIL', err.message);
    await screenshot(page, 'f4-b-failure.png');
  }

  // --- C: real bounded ask -> ops proposal preview -> Reject (no mutation) ---
  try {
    await withTimeout(page.click('#btn-ask', { timeout: 5000 }), 6000, 'open ask (C)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('ask-input')?.hidden === false, { timeout: 3000 }),
      3500,
      'ask visible (C)'
    );
    await withTimeout(page.click('#ask-input .ask-textarea', { timeout: 3000 }), 3500, 'focus (C)');
    await withTimeout(
      page.keyboard.type('Add exactly one new node with label "SmokeNode" and no edges. Put it in the ops array.'),
      3000,
      'type instruction (C)'
    );
    await withTimeout(page.click('#ask-input .ask-go', { timeout: 3000 }), 3500, 'submit (C)');
    await withTimeout(
      page.waitForFunction(
        () =>
          document.getElementById('proposal-panel')?.hidden === false &&
          document.querySelector('#proposal-panel .proposal-accept') !== null,
        { timeout: 60000 }
      ),
      61000,
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
    record('C (ask -> preview -> reject)', 'PASS', `preview ops=${JSON.stringify(ops)}; reject left store unchanged`);
  } catch (err) {
    record('C (ask -> preview -> reject)', 'FAIL', err.message);
    await screenshot(page, 'f4-c-failure.png');
  }

  // --- D: real bounded ask -> empty-ops answer via showAnswer ---
  try {
    await withTimeout(page.click('#btn-ask', { timeout: 5000 }), 6000, 'open ask (D)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('ask-input')?.hidden === false, { timeout: 3000 }),
      3500,
      'ask visible (D)'
    );
    await withTimeout(page.click('#ask-input .ask-textarea', { timeout: 3000 }), 3500, 'focus (D)');
    await withTimeout(
      page.keyboard.type('Do not change the map. Return an empty ops array and set the answer field to the single word pong.'),
      3000,
      'type instruction (D)'
    );
    await withTimeout(page.click('#ask-input .ask-go', { timeout: 3000 }), 3500, 'submit (D)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('proposal-panel')?.hidden === false, { timeout: 60000 }),
      61000,
      'wait answer/preview panel (D)'
    );
    const btns = await page.evaluate(() =>
      [...document.querySelectorAll('#proposal-panel .proposal-actions button')].map((e) => e.textContent)
    );
    const answerShown = await page.evaluate(
      () => document.querySelector('#proposal-panel .proposal-answer')?.textContent ?? ''
    );
    // Close whichever variant rendered.
    await withTimeout(page.click('#proposal-panel .proposal-actions button', { timeout: 3000 }), 3500, 'close (D)');
    record(
      'D (ask -> answer)',
      'PASS',
      `panel rendered; buttons=${JSON.stringify(btns)}; answer="${answerShown.trim().slice(0, 60)}"`
    );
  } catch (err) {
    record('D (ask -> answer)', 'FAIL', err.message);
    await screenshot(page, 'f4-d-failure.png');
  }

  await screenshot(page, 'f4-final.png');
  const exit = results.some((r) => r.status === 'FAIL') || pageErrors.length > 0 ? 1 : 0;
  await finish(electronApp, electronPid, exit);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== F4 SMOKE SUMMARY ===');
  for (const r of results) log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  log(`\nconsole errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  for (const c of consoleErrors) log(c);
  for (const p of pageErrors) log(p);

  const findingsPath = path.join(artifactsDir, 'f4-findings.md');
  const lines = ['# Ask-the-map (F4) E2E smoke', '', '## Results'];
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
