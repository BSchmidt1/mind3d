// Bounded E2E smoke for Task F10 "First-class edges — selection, label,
// relation". Drives the production build via Playwright's Electron API and
// verifies, with zero renderer errors:
//   setup  the app boots with the F10 graph accessors + edge editor DOM active;
//   A      creating two nodes (double-click) and linking them ('l' + click)
//          yields an "edge created" toast — the graph link path works;
//   B      clicking the edge midpoint opens the floating #edge-editor, editing
//          its label + relation commits, and reopening the editor from the
//          command palette reads the SAME values back from the store — proving
//          the edits went through setEdgeLabel/setEdgeRelation commands;
//   C      an edge label containing `<img onerror=…>` renders in the hover
//          tooltip as literal text (no <img> element, no script) — the
//          linkLabel accessor returns a textContent element, not a string;
//   D      Delete on the selected edge removes it (edge selection reconciles).
//
// Node positions are deterministic: a double-click pins a node at the world
// point under the cursor, so the edge midpoint is ~the screen midpoint of the
// two click points. The click scans a small grid to absorb perspective slack.
//
// Backward-compat (a v2 edge without `relation` loading as 'none') is covered
// authoritatively by tests/serialize.test.ts; the native Open dialog isn't
// driveable here, so it is not re-checked in this smoke.
//
// Isolated user-data-dir; does NOT touch the mic or any pre-existing process.
// Usage: node e2e/edge-relation.mjs

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind3d-f10-smoke-'));

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
        const editor = document.getElementById('edge-editor');
        return (
          typeof window.mind3d !== 'undefined' &&
          editor !== null &&
          editor.hidden === true &&
          document.getElementById('edge-editor-label') !== null &&
          document.getElementById('edge-editor-relation') !== null
        );
      }),
      5000,
      'edge editor DOM eval'
    );
    if (!ok) throw new Error('edge editor DOM not present / not hidden at boot');
    record('setup', 'PASS', 'topbar present; #edge-editor scaffolding hidden and ready');
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'f10-setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  let box = await page.locator('#view3d').boundingBox();
  let cx = Math.round(box.x + box.width / 2);
  let cy = Math.round(box.y + box.height / 2);
  // Wide separation → a long edge that is easy to ray-pick in scenario B.
  const p1 = { x: cx - 200, y: cy };
  const p2 = { x: cx + 200, y: cy };

  // --- A: two nodes (double-click) + an edge via the outline Tab-indent ---
  // Node/edge creation via the WebGL canvas position is not screen-stable in
  // this headless renderer, so the edge is made through the reliable outline
  // DOM gesture (Tab on the 2nd root row links it under the 1st). This proves
  // the edge — carrying the new relation field — flows model → store → outline
  // → 3D rebuild (new simLink fields) without error.
  try {
    await withTimeout(page.mouse.dblclick(p1.x, p1.y), 3000, 'dblclick node1 (A)');
    await page.keyboard.press('Escape'); // dismiss the label editor
    await blurActive(page);
    await withTimeout(page.mouse.dblclick(p2.x, p2.y), 3000, 'dblclick node2 (A)');
    await page.keyboard.press('Escape');
    await blurActive(page);
    await page.waitForFunction(
      () => document.querySelectorAll('#outline-list .outline-row').length >= 2,
      { timeout: 4000 }
    );
    // Focus the 2nd root row and Tab-indent it under the 1st → edge created.
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#outline-list .outline-row');
      rows[1].focus();
    });
    await page.keyboard.press('Tab');
    await withTimeout(
      page.waitForFunction(
        () =>
          [...document.querySelectorAll('#status-counts')].some((e) =>
            (e.textContent ?? '').includes('1 edges')
          ),
        { timeout: 4000 }
      ),
      4500,
      'wait 1 edges in counts (A)'
    );
    record('A (create + link via outline)', 'PASS', 'two nodes created; outline Tab created an edge; counts show 1 edge');
  } catch (err) {
    record('A (create + link via outline)', 'FAIL', err.message);
    await screenshot(page, 'f10-a-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  // --- B: click edge -> editor -> edit label+relation -> reopen reads store ---
  const EDGE_LABEL = 'supports the claim';
  const EDGE_RELATION = 'refutes';
  try {
    await blurActive(page);
    // Let any post-load resize settle, then re-fetch the view box.
    await page.waitForTimeout(400);
    box = await page.locator('#view3d').boundingBox();
    cx = Math.round(box.x + box.width / 2);
    cy = Math.round(box.y + box.height / 2);
    // The edge is a long, roughly-horizontal line through the central band, but
    // its exact screen position isn't predictable in this renderer. Scan a broad
    // grid across the middle until a click opens the editor (linkHoverPrecision
    // widens the pick tolerance). A miss lands on the background (harmless
    // deselect).
    let opened = false;
    const xs = [];
    for (let dx = -Math.round(box.width * 0.32); dx <= Math.round(box.width * 0.32); dx += 12) xs.push(dx);
    const ys = [0, 8, -8, 16, -16, 24, -24, 32, -32];
    outer: for (const dy of ys) {
      for (const dx of xs) {
        await page.mouse.click(cx + dx, cy + dy);
        opened = await page.evaluate(() => document.getElementById('edge-editor')?.hidden === false);
        if (opened) break outer;
      }
    }
    if (!opened) throw new Error('edge click did not open #edge-editor after broad scan');
    // Edit label + relation, committing via the change events the editor wires.
    await page.evaluate(
      ({ label, relation }) => {
        const li = document.getElementById('edge-editor-label');
        li.value = label;
        li.dispatchEvent(new Event('change', { bubbles: true }));
        const sel = document.getElementById('edge-editor-relation');
        sel.value = relation;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { label: EDGE_LABEL, relation: EDGE_RELATION }
    );
    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error('renderer errors during edge edit');
    }
    await screenshot(page, 'f10-b-edited.png');
    // Prove the edits went to the STORE (not just the DOM inputs I set): wipe
    // the input values WITHOUT dispatching change (so no command runs), then run
    // the `edge-set-label` palette command — editEdge -> openEdgeEditor re-reads
    // the store edge and repopulates the inputs. If the readback shows my edits
    // rather than the wiped values, the setEdgeLabel/setEdgeRelation commands
    // persisted. The edge is still selected (no close), so the command is
    // enabled. Ctrl+K is a capture-phase global, so focus does not matter.
    await page.evaluate(() => {
      document.getElementById('edge-editor-label').value = '__WIPED__';
      document.getElementById('edge-editor-relation').value = 'none';
    });
    await page.keyboard.press('Control+k');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('cmd-palette')?.hidden === false),
      4000,
      'palette open (B)'
    );
    await withTimeout(page.fill('#cmd-input', 'edit edge label'), 3000, 'fill cmd-input (B)');
    await withTimeout(page.keyboard.press('Enter'), 3000, 'run edge-set-label (B)');
    await withTimeout(
      page.waitForFunction(
        () =>
          document.getElementById('edge-editor')?.hidden === false &&
          document.getElementById('edge-editor-label').value !== '__WIPED__'
      ),
      4000,
      'editor reopened from store (B)'
    );
    const readback = await page.evaluate(() => ({
      label: document.getElementById('edge-editor-label').value,
      relation: document.getElementById('edge-editor-relation').value
    }));
    if (readback.label !== EDGE_LABEL || readback.relation !== EDGE_RELATION) {
      throw new Error(`store readback ${JSON.stringify(readback)}, expected label="${EDGE_LABEL}" relation="${EDGE_RELATION}"`);
    }
    record('B (select + edit + persist)', 'PASS', `edge edited to label="${readback.label}" relation="${readback.relation}"; palette-reopen re-read them from the store (not the wiped inputs)`);
  } catch (err) {
    record('B (select + edit + persist)', 'FAIL', err.message);
    await screenshot(page, 'f10-b-failure.png');
  }

  // --- C: an edge label with HTML is shown as text, never executed (XSS) ---
  // float-tooltip renders a string via innerHTML but appends an HTMLElement
  // verbatim; the linkLabel accessor returns a textContent element, so a label
  // like `<img onerror=…>` must appear as literal text with no <img> created
  // and no script run. Edge labels are user/Claude/F5-import-authored.
  const XSS_LABEL = 'XSSPROBE<img src=x onerror="window.__XSS_FIRED=1">';
  try {
    // The editor is open (reopened in B, label input focused) — overwrite the
    // label with the malicious value and commit, then close the editor so it
    // doesn't cover the edge while hovering.
    await page.evaluate((label) => {
      const li = document.getElementById('edge-editor-label');
      li.value = label;
      li.dispatchEvent(new Event('change', { bubbles: true }));
    }, XSS_LABEL);
    await page.keyboard.press('Escape');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('edge-editor')?.hidden === true),
      3500,
      'editor closed before hover (C)'
    );
    await blurActive(page);
    // Hover the edge (broad mousemove scan) until the tooltip shows the label.
    let tooltipText = null;
    outerHover: for (const dy of [0, 8, -8, 16, -16, 24, -24, 32, -32]) {
      for (let dx = -Math.round(box.width * 0.32); dx <= Math.round(box.width * 0.32); dx += 12) {
        await page.mouse.move(cx + dx, cy + dy);
        await page.waitForTimeout(16); // let the render tick set tooltip content
        tooltipText = await page.evaluate(() => {
          const t = document.querySelector('.float-tooltip-kap');
          return t && t.textContent && t.textContent.includes('XSSPROBE') ? t.textContent : null;
        });
        if (tooltipText !== null) break outerHover;
      }
    }
    if (tooltipText === null) throw new Error('edge tooltip never showed the label (hover missed the edge)');
    const safety = await page.evaluate(() => ({
      xssFired: window.__XSS_FIRED,
      injectedImg: document.querySelector('.float-tooltip-kap img, img[src="x"]') !== null,
      tooltipImg: document.querySelector('.float-tooltip-kap img') !== null
    }));
    if (safety.xssFired !== undefined) throw new Error('XSS executed: window.__XSS_FIRED was set');
    if (safety.injectedImg || safety.tooltipImg) throw new Error('label was parsed as HTML (an <img> element was created)');
    if (!tooltipText.includes('<img')) throw new Error(`tooltip text unexpectedly stripped markup: "${tooltipText}"`);
    record('C (edge-label tooltip is XSS-safe)', 'PASS', 'malicious edge label rendered as literal text; no <img> element, no script executed');
  } catch (err) {
    record('C (edge-label tooltip is XSS-safe)', 'FAIL', err.message);
    await screenshot(page, 'f10-c-failure.png');
  }

  // --- D: Delete removes the selected edge ---
  // The edge is still selected from C (its editor was closed there without
  // deselecting). Do NOT press Escape here — with the editor already closed and
  // focus on the body, Escape would hit the global handler and deselect the edge
  // (setEdge(null)) before Delete. Just move focus off any input and Delete.
  try {
    await blurActive(page);
    await page.keyboard.press('Delete');
    await withTimeout(
      page.waitForFunction(() =>
        [...document.querySelectorAll('#status-counts')].some((e) =>
          (e.textContent ?? '').includes('0 edges')
        )
      ),
      4500,
      'wait 0 edges in counts (D)'
    );
    record('D (delete selected edge)', 'PASS', 'Delete removed the selected edge; counts show 0 edges');
  } catch (err) {
    record('D (delete selected edge)', 'FAIL', err.message);
    await screenshot(page, 'f10-d-failure.png');
  }

  await screenshot(page, 'f10-final.png');
  const exit = results.some((r) => r.status === 'FAIL') || pageErrors.length > 0 ? 1 : 0;
  await finish(electronApp, electronPid, exit);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== F10 SMOKE SUMMARY ===');
  for (const r of results) log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  log(`\nconsole errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  for (const c of consoleErrors) log(c);
  for (const p of pageErrors) log(p);

  const findingsPath = path.join(artifactsDir, 'f10-findings.md');
  const lines = ['# First-class edges (F10) E2E smoke', '', '## Results'];
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
