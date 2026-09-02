// Bounded E2E smoke for Task F12 "2D mode toggle (persisted per map)". Drives
// the production build via Playwright's Electron API and verifies, with zero
// renderer errors:
//   setup  the app boots with the #btn-2d toggle present and NOT active (3D
//          default);
//   A      clicking #btn-2d engages 2D — the button gets .active AND the real
//          View3D.setDims(2) code path runs (graph.numDimensions(2),
//          controls().noRotate, camera top-down via cameraPosition) with no
//          renderer error; a thrown call (e.g. a wrong graph API) would surface
//          here;
//   B      creating a node by double-click WHILE in 2D succeeds (counts show a
//          node) — exercises the z=0 clamp branch in the dblclick create path
//          without error;
//   C      the `toggle-2d` command palette entry flips back to 3D (button loses
//          .active), proving the palette registration + the 3D-restore path
//          (enableRotate) run cleanly;
//   D      several button toggles are stable (active ⇄ inactive) with no errors.
//
// Per-map PERSISTENCE ('mode' saved to the file and reloaded as-is, and an
// older file WITHOUT a mode field loading as 3D) is covered authoritatively by
// tests/serialize.test.ts — the native Save/Open dialogs are not driveable in
// this harness (same limitation edge-relation.mjs notes). Camera pose / orbit /
// node-z are View3D-internal (module scope, not reachable from page.evaluate);
// this smoke proves the wiring runs error-free end to end in the real renderer.
//
// Isolated user-data-dir; does NOT touch the mic or any pre-existing process.
// Usage: node e2e/two-d-mode.mjs

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind3d-f12-smoke-'));

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
async function blurActive(page) {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el && el instanceof HTMLElement) el.blur();
  });
}
const btn2dActive = (page) =>
  page.evaluate(() => document.getElementById('btn-2d')?.classList.contains('active') === true);
const noErrors = () => consoleErrors.length === 0 && pageErrors.length === 0;

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
    const ok = await withTimeout(
      page.evaluate(() => {
        const btn = document.getElementById('btn-2d');
        return btn !== null && btn.classList.contains('active') === false;
      }),
      5000,
      '#btn-2d boot state'
    );
    if (!ok) throw new Error('#btn-2d missing or already active at boot (expected present + 3D/inactive)');
    record('setup', 'PASS', '#btn-2d present and inactive (3D default) at boot');
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'f12-setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  // --- A: click #btn-2d engages 2D (real setDims(2) path runs, no errors) ---
  try {
    await withTimeout(page.click('#btn-2d'), 3000, 'click #btn-2d (A)');
    await withTimeout(
      page.waitForFunction(
        () => document.getElementById('btn-2d')?.classList.contains('active') === true,
        { timeout: 4000 }
      ),
      4500,
      'btn-2d active (A)'
    );
    if (!noErrors()) throw new Error('renderer errors during 2D toggle (setDims path threw)');
    await screenshot(page, 'f12-a-2d.png');
    record('A (engage 2D)', 'PASS', 'clicking #btn-2d set .active and ran numDimensions(2)/controls/cameraPosition with no renderer error');
  } catch (err) {
    record('A (engage 2D)', 'FAIL', err.message);
    await screenshot(page, 'f12-a-failure.png');
  }

  // --- B: create a node while in 2D (exercises the z=0 clamp branch) ---
  try {
    await blurActive(page);
    const box = await page.locator('#view3d').boundingBox();
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    await withTimeout(page.mouse.dblclick(cx, cy), 3000, 'dblclick create in 2D (B)');
    await page.keyboard.press('Escape'); // dismiss the label editor
    await blurActive(page);
    await withTimeout(
      page.waitForFunction(
        () =>
          [...document.querySelectorAll('#status-counts')].some((e) =>
            /\b1 nodes\b/.test(e.textContent ?? '')
          ),
        { timeout: 4000 }
      ),
      4500,
      'wait 1 nodes in counts (B)'
    );
    if (!noErrors()) throw new Error('renderer errors while creating a node in 2D');
    record('B (create node in 2D)', 'PASS', 'double-click created a node in 2D mode (z=0 clamp path ran); counts show 1 node');
  } catch (err) {
    record('B (create node in 2D)', 'FAIL', err.message);
    await screenshot(page, 'f12-b-failure.png');
  }

  // --- E: 2D depth-nudge (Shift+Up/Down) stays in-plane ---
  // Still in 2D with the node from B selected. keyMove clamps d.z=0 in 2D so a
  // Shift+Up/Down depth nudge is a no-op (in-plane ±X/±Y still move). The node's
  // z is View3D-internal (not DOM-observable), so this asserts the clamped path
  // runs error-free in the real renderer; z=0 itself is by construction (the
  // d.z=0 clamp) + the setPosition/serialize round-trip persisting whatever is
  // committed. Runs BEFORE C toggles back to 3D.
  try {
    await blurActive(page);
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(60);
    if (!noErrors()) throw new Error('renderer errors during 2D depth/in-plane nudge');
    record('E (2D depth nudge clamped)', 'PASS', 'Shift+Up/Down (depth) + Left (in-plane) ran in 2D with no renderer error; depth is a no-op via the d.z=0 clamp');
  } catch (err) {
    record('E (2D depth nudge clamped)', 'FAIL', err.message);
    await screenshot(page, 'f12-e-failure.png');
  }

  // --- C: `toggle-2d` palette command flips back to 3D ---
  try {
    await blurActive(page);
    await page.keyboard.press('Control+k');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('cmd-palette')?.hidden === false),
      4000,
      'palette open (C)'
    );
    await withTimeout(page.fill('#cmd-input', 'toggle 2d'), 3000, 'fill cmd-input (C)');
    await withTimeout(page.keyboard.press('Enter'), 3000, 'run toggle-2d (C)');
    await withTimeout(
      page.waitForFunction(
        () => document.getElementById('btn-2d')?.classList.contains('active') === false,
        { timeout: 4000 }
      ),
      4500,
      'btn-2d inactive after palette toggle (C)'
    );
    if (!noErrors()) throw new Error('renderer errors during palette toggle back to 3D');
    record('C (palette toggle → 3D)', 'PASS', 'the toggle-2d palette command restored 3D (button inactive); enableRotate/3D path ran with no error');
  } catch (err) {
    record('C (palette toggle → 3D)', 'FAIL', err.message);
    await screenshot(page, 'f12-c-failure.png');
  }

  // --- D: repeated toggles are stable ---
  try {
    await blurActive(page);
    await page.click('#btn-2d'); // → 2D
    await page.waitForFunction(() => document.getElementById('btn-2d')?.classList.contains('active') === true, { timeout: 4000 });
    const on = await btn2dActive(page);
    await page.click('#btn-2d'); // → 3D
    await page.waitForFunction(() => document.getElementById('btn-2d')?.classList.contains('active') === false, { timeout: 4000 });
    const off = await btn2dActive(page);
    if (!on || off) throw new Error(`toggle sequence unstable: after-2D active=${on}, after-3D active=${off}`);
    if (!noErrors()) throw new Error('renderer errors during repeated toggles');
    record('D (repeated toggles stable)', 'PASS', '2D⇄3D button toggles are stable with no renderer errors');
  } catch (err) {
    record('D (repeated toggles stable)', 'FAIL', err.message);
    await screenshot(page, 'f12-d-failure.png');
  }

  await screenshot(page, 'f12-final.png');
  const exit = results.some((r) => r.status === 'FAIL') || pageErrors.length > 0 ? 1 : 0;
  await finish(electronApp, electronPid, exit);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== F12 SMOKE SUMMARY ===');
  for (const r of results) log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  log(`\nconsole errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  for (const c of consoleErrors) log(c);
  for (const p of pageErrors) log(p);

  const findingsPath = path.join(artifactsDir, 'f12-findings.md');
  const lines = ['# 2D mode (F12) E2E smoke', '', '## Results'];
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
