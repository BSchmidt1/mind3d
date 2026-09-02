// Bounded E2E smoke for Task F13 "Node / edge / background context menu".
// Drives the production build via Playwright's Electron API and verifies, with
// zero renderer errors:
//   setup  the app boots; no .ctx-menu present at rest;
//   A      right-click on empty background opens OUR menu (.ctx-menu) with the
//          background items ("New node here", "Import…") AND the native browser
//          context menu is suppressed (the contextmenu event's defaultPrevented
//          is true) — a document-level probe reads it after our handler ran;
//   B      creating a node (double-click) then right-clicking it opens the NODE
//          menu ("Add child" … "Delete node"); a grid scan absorbs the headless
//          renderer's node-pick slack;
//   C      clicking "Add child" in the node menu creates a child node + edge
//          (counts go to 2 nodes / 1 edge) and closes the menu — proving the
//          item drove the SAME addChild command path as the Tab shortcut;
//   D      Escape closes an open menu; a left click-away closes it too.
//
// Isolated user-data-dir; does NOT touch the mic or any pre-existing process.
// Usage: node e2e/context-menu.mjs

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind3d-f13-smoke-'));

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
const menuLabels = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.ctx-menu');
    if (!m) return null;
    return [...m.querySelectorAll('.ctx-item')].map((b) => b.textContent);
  });

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
    const clean = await page.evaluate(
      () => typeof window.mind3d !== 'undefined' && document.querySelector('.ctx-menu') === null
    );
    if (!clean) throw new Error('window.mind3d missing or a .ctx-menu already present at rest');
    // Install a document-level contextmenu probe: it runs in the bubble phase
    // AFTER the container handler (which is deeper in the tree), so it observes
    // whether preventDefault() was called — i.e. whether the native menu is
    // suppressed on the view.
    await page.evaluate(() => {
      window.__ctxDefaultPrevented = null;
      document.addEventListener('contextmenu', (ev) => {
        window.__ctxDefaultPrevented = ev.defaultPrevented;
      });
    });
    record('setup', 'PASS', 'topbar present; no context menu at rest; native-menu probe installed');
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'f13-setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  const box = await page.locator('#view3d').boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  // --- A: right-click empty background → background menu + native suppressed ---
  try {
    // A corner of the empty view, far from where B's node will sit.
    const bx = Math.round(box.x + box.width * 0.2);
    const by = Math.round(box.y + box.height * 0.75);
    await page.mouse.move(bx, by);
    await page.mouse.click(bx, by, { button: 'right' });
    await withTimeout(
      page.waitForFunction(() => document.querySelector('.ctx-menu') !== null),
      4000,
      'background menu open (A)'
    );
    const labels = await menuLabels(page);
    const prevented = await page.evaluate(() => window.__ctxDefaultPrevented);
    if (!labels || !labels.includes('New node here') || !labels.includes('Import text / file / URL…')) {
      throw new Error(`background menu labels unexpected: ${JSON.stringify(labels)}`);
    }
    if (prevented !== true) {
      throw new Error(`native context menu NOT suppressed: defaultPrevented=${prevented}`);
    }
    await screenshot(page, 'f13-a-background-menu.png');
    // Close it (Escape) before the next scenario.
    await page.keyboard.press('Escape');
    await withTimeout(
      page.waitForFunction(() => document.querySelector('.ctx-menu') === null),
      3000,
      'background menu closed (A)'
    );
    record('A (background menu + native suppressed)', 'PASS', `menu=${JSON.stringify(labels)}; defaultPrevented=true`);
  } catch (err) {
    record('A (background menu + native suppressed)', 'FAIL', err.message);
    await screenshot(page, 'f13-a-failure.png');
  }

  // --- B: right-click a node → node menu ---
  let nodeMenuOpen = false;
  try {
    await page.mouse.dblclick(cx, cy);
    await page.keyboard.press('Escape'); // dismiss the label editor
    await blurActive(page);
    await page.waitForFunction(
      () => [...document.querySelectorAll('#status-counts')].some((e) => (e.textContent ?? '').includes('1 nodes')),
      { timeout: 4000 }
    );
    // Scan a small grid around the node's screen point: move (to set hover) then
    // right-click, until OUR menu shows the node items. A miss lands on the
    // background menu ("New node here") — close it and try the next point.
    let labels = null;
    const offsets = [0, 6, -6, 12, -12, 18, -18];
    outer: for (const dy of offsets) {
      for (const dx of offsets) {
        await page.mouse.move(cx + dx, cy + dy);
        await page.waitForTimeout(24); // let the hover raycast tick
        await page.mouse.click(cx + dx, cy + dy, { button: 'right' });
        labels = await menuLabels(page);
        if (labels && labels.includes('Add child') && labels.includes('Delete node')) {
          nodeMenuOpen = true;
          break outer;
        }
        // Not the node menu (background or none) — close and continue.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(16);
      }
    }
    if (!nodeMenuOpen) throw new Error(`node menu never opened after grid scan; last=${JSON.stringify(labels)}`);
    // A double-clicked node is PINNED (dblclick sets fx/fy/fz at the world
    // point), so the pin slot reads "Unpin" here — the menu correctly reflects
    // the pinned state.
    const expected = ['Add child', 'Link from here', 'Ask about this…', 'Attach file…', 'Unpin', 'Delete node'];
    if (JSON.stringify(labels) !== JSON.stringify(expected)) {
      throw new Error(`node menu labels ${JSON.stringify(labels)} != ${JSON.stringify(expected)}`);
    }
    await screenshot(page, 'f13-b-node-menu.png');
    record('B (node menu)', 'PASS', `node menu shows ${JSON.stringify(labels)}`);
  } catch (err) {
    record('B (node menu)', 'FAIL', err.message);
    await screenshot(page, 'f13-b-failure.png');
  }

  // --- C: click "Add child" → child node + edge created; menu closes ---
  try {
    if (!nodeMenuOpen) throw new Error('skipped: node menu was not open from B');
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.ctx-menu .ctx-item')];
      const addChild = items.find((b) => b.textContent === 'Add child');
      if (!addChild) throw new Error('Add child item not found');
      addChild.click();
    });
    await withTimeout(
      page.waitForFunction(
        () =>
          [...document.querySelectorAll('#status-counts')].some((e) => {
            const t = e.textContent ?? '';
            return t.includes('2 nodes') && t.includes('1 edges');
          }) && document.querySelector('.ctx-menu') === null
      ),
      4500,
      'child created + menu closed (C)'
    );
    if (consoleErrors.length > 0 || pageErrors.length > 0) throw new Error('renderer errors during add-child');
    await page.keyboard.press('Escape'); // dismiss the new child's label editor
    await blurActive(page);
    await screenshot(page, 'f13-c-added.png');
    record('C (Add child runs the command)', 'PASS', 'clicking Add child created a child node + edge; menu closed; no errors');
  } catch (err) {
    record('C (Add child runs the command)', 'FAIL', err.message);
    await screenshot(page, 'f13-c-failure.png');
  }

  // --- D: Escape and click-away both close the menu ---
  try {
    // Re-open the background menu, close via Escape.
    const bx = Math.round(box.x + box.width * 0.2);
    const by = Math.round(box.y + box.height * 0.75);
    await page.mouse.click(bx, by, { button: 'right' });
    await withTimeout(
      page.waitForFunction(() => document.querySelector('.ctx-menu') !== null),
      3000,
      'menu open for Escape (D)'
    );
    await page.keyboard.press('Escape');
    await withTimeout(
      page.waitForFunction(() => document.querySelector('.ctx-menu') === null),
      3000,
      'Escape closed menu (D)'
    );
    // Re-open, close via a left click-away on the topbar.
    await page.mouse.click(bx, by, { button: 'right' });
    await withTimeout(
      page.waitForFunction(() => document.querySelector('.ctx-menu') !== null),
      3000,
      'menu open for click-away (D)'
    );
    await page.mouse.click(Math.round(box.x + 30), Math.round(box.y - 12)); // topbar, outside the menu
    await withTimeout(
      page.waitForFunction(() => document.querySelector('.ctx-menu') === null),
      3000,
      'click-away closed menu (D)'
    );
    record('D (Escape + click-away close)', 'PASS', 'menu closes on Escape and on an outside click');
  } catch (err) {
    record('D (Escape + click-away close)', 'FAIL', err.message);
    await screenshot(page, 'f13-d-failure.png');
  }

  await screenshot(page, 'f13-final.png');
  const exit = results.some((r) => r.status === 'FAIL') || pageErrors.length > 0 ? 1 : 0;
  await finish(electronApp, electronPid, exit);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== F13 SMOKE SUMMARY ===');
  for (const r of results) log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  log(`\nconsole errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  for (const c of consoleErrors) log(c);
  for (const p of pageErrors) log(p);

  const findingsPath = path.join(artifactsDir, 'f13-findings.md');
  const lines = ['# Context menu (F13) E2E smoke', '', '## Results'];
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
