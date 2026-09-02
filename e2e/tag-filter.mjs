// Bounded E2E smoke for Task F11 "Tag filter and color-by-tag". Drives the
// production build via Playwright's Electron API and verifies, with zero
// renderer errors:
//   setup  the app boots; #tag-bar scaffolding is present and hidden; the
//          `tag-filter` palette command is GATED OFF while no tags exist.
//   A      two nodes created (double-click) and tagged via the detail panel
//          (#dp-tags → setTags command) make the `Filter by tag…` command
//          appear (collectTags now non-empty), and opening it shows one chip
//          per tag with the tag text set via textContent.
//   B      clicking a chip marks it .active (drives setDimFilter), switching
//          the mode to "hide" and ticking "color by tag" (drives setColorByTag)
//          all repaint the WebGL graph — refresh() re-runs makeSprite for every
//          node — with NO console/page error, proving the dim + color-by-tag
//          paint paths are sound. Screenshots capture the visual.
//   C      a tag containing `<img src=x onerror=…>` renders in its chip as
//          literal text (textContent, never innerHTML) — no <img> element is
//          created and no script fires. Tags are user-entered (mirrors the F10
//          edge-label XSS fix).
//
// Selection is driven through the outline rows (DOM-deterministic) rather than
// WebGL canvas clicks, whose screen positions aren't stable in this headless
// renderer. Isolated user-data-dir; does NOT touch the mic or any pre-existing
// process. Usage: node e2e/tag-filter.mjs

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mind3d-f11-smoke-'));

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

// Create a standalone node by double-clicking empty canvas, then dismiss the
// label editor with Escape (keeps the auto-created 'new node').
async function addNode(page, x, y) {
  await withTimeout(page.mouse.dblclick(x, y), 3000, `dblclick node at ${x},${y}`);
  await page.keyboard.press('Escape');
  await blurActive(page);
}

// Select the outline row at `idx` (DOM-reliable) and set its node's tags via the
// detail panel #dp-tags input, committing through the blur → setTags command.
async function tagOutlineRow(page, idx, tagsCsv) {
  await page.evaluate((i) => {
    const rows = document.querySelectorAll('#outline-list .outline-row');
    if (!rows[i]) throw new Error(`no outline row ${i}`);
    rows[i].click();
  }, idx);
  await withTimeout(page.waitForSelector('#dp-tags', { timeout: 4000 }), 4500, '#dp-tags visible');
  await withTimeout(page.fill('#dp-tags', tagsCsv), 3000, `fill #dp-tags="${tagsCsv}"`);
  await page.evaluate(() => document.getElementById('dp-tags').blur());
  await blurActive(page);
}

async function openTagBar(page) {
  await page.keyboard.press('Control+k');
  await withTimeout(
    page.waitForFunction(() => document.getElementById('cmd-palette')?.hidden === false),
    4000,
    'palette open'
  );
  await withTimeout(page.fill('#cmd-input', 'filter by tag'), 3000, 'fill cmd-input filter by tag');
  await withTimeout(page.keyboard.press('Enter'), 3000, 'run tag-filter');
  await withTimeout(
    page.waitForFunction(() => document.getElementById('tag-bar')?.hidden === false),
    4000,
    '#tag-bar open'
  );
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
        const bar = document.getElementById('tag-bar');
        return (
          typeof window.mind3d !== 'undefined' &&
          bar !== null &&
          bar.hidden === true &&
          bar.querySelector('.tag-chips') !== null &&
          bar.querySelector('.tag-mode-select') !== null &&
          bar.querySelector('.tag-color-check') !== null
        );
      }),
      5000,
      'tag-bar DOM eval'
    );
    if (!ok) throw new Error('#tag-bar scaffolding not present / not hidden at boot');
    // The tag-filter command must be gated OFF with no tags in the map.
    await page.keyboard.press('Control+k');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('cmd-palette')?.hidden === false),
      4000,
      'palette open (setup)'
    );
    await page.fill('#cmd-input', 'filter by tag');
    const gatedOff = await page.evaluate(
      () => !document.querySelector('#cmd-palette .cmd-row')?.textContent?.includes('Filter by tag')
    );
    await page.keyboard.press('Escape');
    if (!gatedOff) throw new Error('tag-filter command was enabled with no tags in the map');
    record('setup', 'PASS', '#tag-bar hidden scaffolding ready; tag-filter command gated off while no tags');
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'f11-setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  const box = await page.locator('#view3d').boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  // --- A: create + tag two nodes; the command lights up; chips render ---
  try {
    await addNode(page, cx - 160, cy);
    await addNode(page, cx + 160, cy);
    await page.waitForFunction(
      () => document.querySelectorAll('#outline-list .outline-row').length >= 2,
      { timeout: 4000 }
    );
    await tagOutlineRow(page, 0, 'research');
    await tagOutlineRow(page, 1, 'todo');
    await openTagBar(page);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('#tag-bar .tag-chip .tag-name')].map((e) => e.textContent)
    );
    const sorted = [...chips].sort();
    if (sorted.length !== 2 || sorted[0] !== 'research' || sorted[1] !== 'todo') {
      throw new Error(`expected chips [research, todo], got ${JSON.stringify(chips)}`);
    }
    await screenshot(page, 'f11-a-chips.png');
    record('A (tag nodes → chips)', 'PASS', `two tags committed via #dp-tags; tag bar shows chips ${JSON.stringify(sorted)}`);
  } catch (err) {
    record('A (tag nodes → chips)', 'FAIL', err.message);
    await screenshot(page, 'f11-a-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  // --- B: activate a tag (dim), switch to hide, enable color-by-tag ---
  // Each of these calls view3d.setDimFilter / setColorByTag, which refresh() the
  // graph → makeSprite runs for every node. A throw in that paint path would
  // surface as a console/page error; we assert none occurred.
  try {
    const errorsBefore = consoleErrors.length + pageErrors.length;
    // Click the 'research' chip → it becomes active (drives the dim filter).
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('#tag-bar .tag-chip')].find(
        (c) => c.querySelector('.tag-name')?.textContent === 'research'
      );
      if (!chip) throw new Error('research chip not found');
      chip.click();
    });
    const active = await page.evaluate(
      () =>
        [...document.querySelectorAll('#tag-bar .tag-chip')].find(
          (c) => c.querySelector('.tag-name')?.textContent === 'research'
        )?.classList.contains('active') === true
    );
    if (!active) throw new Error('clicking the research chip did not mark it active');
    await screenshot(page, 'f11-b-dim.png');
    // Switch non-matching to "hide" (stronger dim / opacity 0).
    await page.selectOption('#tag-bar .tag-mode-select', 'hide');
    await screenshot(page, 'f11-b-hide.png');
    // Enable color-by-tag (checkbox → setColorByTag closure repaints all sprites).
    await page.evaluate(() => {
      const cb = document.querySelector('#tag-bar .tag-color-check');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    await screenshot(page, 'f11-b-color.png');
    const errorsAfter = consoleErrors.length + pageErrors.length;
    if (errorsAfter > errorsBefore) {
      throw new Error(`renderer errors during filter/color toggles (${errorsAfter - errorsBefore} new)`);
    }
    record('B (dim / hide / color-by-tag)', 'PASS', 'chip active + hide mode + color-by-tag repainted the graph with zero renderer errors');
  } catch (err) {
    record('B (dim / hide / color-by-tag)', 'FAIL', err.message);
    await screenshot(page, 'f11-b-failure.png');
  }

  // --- C: a tag containing HTML is shown as text, never executed (XSS) ---
  const XSS_TAG = 'TAGXSS<img src=x onerror="window.__TAG_XSS_FIRED=1">';
  try {
    // Retag node 0 (outline row 0) to the malicious value, then reopen the bar.
    await tagOutlineRow(page, 0, XSS_TAG);
    // The tag bar rebuilds its chips on the store change; ensure it's still open
    // (retagging didn't close it) and the malicious chip is present.
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#tag-bar .tag-chip .tag-name')].some((e) =>
          (e.textContent ?? '').includes('TAGXSS')
        ),
      { timeout: 4000 }
    );
    const safety = await page.evaluate(() => {
      const names = [...document.querySelectorAll('#tag-bar .tag-chip .tag-name')];
      const malicious = names.find((e) => (e.textContent ?? '').includes('TAGXSS'));
      return {
        text: malicious ? malicious.textContent : null,
        chipImg: document.querySelector('#tag-bar .tag-chip img') !== null,
        xssFired: window.__TAG_XSS_FIRED
      };
    });
    if (safety.xssFired !== undefined) throw new Error('XSS executed: window.__TAG_XSS_FIRED was set');
    if (safety.chipImg) throw new Error('tag chip parsed HTML (an <img> element was created)');
    if (!safety.text || !safety.text.includes('<img')) {
      throw new Error(`chip text unexpectedly stripped markup: "${safety.text}"`);
    }
    await screenshot(page, 'f11-c-xss.png');
    record('C (tag chip is XSS-safe)', 'PASS', 'malicious tag rendered as literal text; no <img> element, no script executed');
  } catch (err) {
    record('C (tag chip is XSS-safe)', 'FAIL', err.message);
    await screenshot(page, 'f11-c-failure.png');
  }

  await screenshot(page, 'f11-final.png');
  const exit = results.some((r) => r.status === 'FAIL') || pageErrors.length > 0 ? 1 : 0;
  await finish(electronApp, electronPid, exit);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== F11 SMOKE SUMMARY ===');
  for (const r of results) log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  log(`\nconsole errors: ${consoleErrors.length}; page errors: ${pageErrors.length}`);
  for (const c of consoleErrors) log(c);
  for (const p of pageErrors) log(p);

  const findingsPath = path.join(artifactsDir, 'f11-findings.md');
  const lines = ['# Tag filter + color-by-tag (F11) E2E smoke', '', '## Results'];
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
