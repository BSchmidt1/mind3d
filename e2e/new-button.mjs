// E2E harness investigating the reported bug "clicking the New button does
// nothing". Drives the production-built app (out/main, out/preload,
// out/renderer) via Playwright's electron API over CDP. Does NOT modify
// app source — diagnostic tooling only.
//
// Usage: node e2e/new-button.mjs   (or npm run test:e2e)
// Needs a reachable X display (set DISPLAY, default ':5' if unset).

import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifactsDir, { recursive: true });

const consoleMessages = [];
const pageErrors = [];
const dialogEvents = [];
const results = [];

function log(line) {
  console.log(line);
}

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
    log(`  screenshot saved: ${p}`);
    return p;
  } catch (err) {
    log(`  screenshot FAILED (${name}): ${err.message}`);
    return null;
  }
}

async function main() {
  log(`repoRoot=${repoRoot}`);
  log(`DISPLAY=${process.env.DISPLAY ?? '(unset, defaulting to :5)'}`);

  const electronApp = await electron.launch({
    args: [repoRoot, '--disable-gpu', '--enable-unsafe-swiftshader'],
    cwd: repoRoot,
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':5' }
  });

  const electronPid = electronApp.process().pid;
  log(`electron main process pid=${electronPid}`);

  let dialogMode = 'dismiss'; // default safety: never let an unexpected dialog block the run

  const page = await electronApp.firstWindow();

  // --- diagnostics wired first ---
  page.on('console', (msg) => {
    const entry = `[console:${msg.type()}] ${msg.text()}`;
    consoleMessages.push(entry);
    log(entry);
  });
  page.on('pageerror', (err) => {
    const entry = `[pageerror] ${err.stack ?? err.message}`;
    pageErrors.push(entry);
    log(entry);
  });
  page.on('dialog', (dialog) => {
    const entry = `[dialog] type=${dialog.type()} message=${JSON.stringify(dialog.message())} -> ${dialogMode}`;
    dialogEvents.push(entry);
    log(entry);
    if (dialogMode === 'accept') dialog.accept().catch((e) => log(`  dialog.accept() error: ${e.message}`));
    else dialog.dismiss().catch((e) => log(`  dialog.dismiss() error: ${e.message}`));
  });

  // --- setup ---
  try {
    await withTimeout(page.waitForSelector('#topbar', { timeout: 15000 }), 16000, '#topbar');
    await withTimeout(page.waitForSelector('#btn-new', { timeout: 15000 }), 16000, '#btn-new');
    const readyState = await withTimeout(page.evaluate(() => document.readyState), 5000, 'readyState eval');
    const hasMind3d = await withTimeout(
      page.evaluate(() => typeof window.mind3d !== 'undefined'),
      5000,
      'window.mind3d eval'
    );
    record('setup', 'PASS', `document.readyState=${readyState}; window.mind3d defined=${hasMind3d}`);
  } catch (err) {
    record('setup', 'FAIL', err.message);
    await screenshot(page, 'setup-failure.png');
    await finish(electronApp, electronPid, 1);
    return;
  }

  // --- Scenario A: New on an empty map ---
  try {
    dialogMode = 'dismiss';
    const before = await withTimeout(page.textContent('#status'), 5000, 'read #status before A');
    await withTimeout(page.click('#btn-new', { timeout: 5000 }), 6000, 'click #btn-new (A)');
    await withTimeout(
      page.waitForFunction(() => document.getElementById('status')?.textContent === 'new map', { timeout: 3000 }),
      3500,
      'wait #status === "new map" (A)'
    );
    const after = await withTimeout(page.textContent('#status'), 5000, 'read #status after A');
    record('A (empty map)', 'PASS', `status before="${before}" -> after="${after}"`);
  } catch (err) {
    let statusNow = '<unreadable>';
    try {
      statusNow = await withTimeout(page.textContent('#status'), 3000, 'read #status on A failure');
    } catch (e2) {
      statusNow = `<unreadable: ${e2.message}>`;
    }
    record('A (empty map)', 'FAIL', `${err.message}; #status now = "${statusNow}"`);
    await screenshot(page, 'scenario-a-failure.png');
  }

  // --- Scenario B: create a node via canvas dblclick ---
  let scenarioBOk = false;
  try {
    const box = await withTimeout(page.locator('#view3d').boundingBox(), 5000, '#view3d boundingBox');
    if (!box) throw new Error('#view3d has no bounding box (not visible/laid out)');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await withTimeout(page.mouse.dblclick(cx, cy), 5000, 'mouse.dblclick on #view3d center');
    await withTimeout(
      page.waitForSelector('#label-editor', { state: 'visible', timeout: 3000 }),
      3500,
      'wait #label-editor visible'
    );
    await withTimeout(page.keyboard.type('TestNode'), 3000, 'type TestNode');
    await withTimeout(page.keyboard.press('Enter'), 3000, 'press Enter to commit label');
    await withTimeout(
      page.waitForFunction(
        () => document.getElementById('outline-list')?.textContent?.includes('TestNode') ?? false,
        { timeout: 3000 }
      ),
      3500,
      'wait #outline-list contains TestNode'
    );
    record('B (create node)', 'PASS', 'dblclick spawned a node, label "TestNode" committed, outline row present');
    scenarioBOk = true;
  } catch (err) {
    record('B (create node)', 'FAIL', err.message);
    await screenshot(page, 'scenario-b-failure.png');
    log('  Note: no UI-only fallback exists to create a node without the canvas (Tab-with-selection needs an existing node).');
  }

  // --- Scenario C: New with node(s) present -> dialog accepted ---
  let scenarioCOutcome = 'unknown';
  try {
    dialogMode = 'accept';
    const dialogsBefore = dialogEvents.length;
    let clickErr = null;
    try {
      await withTimeout(page.click('#btn-new', { timeout: 5000 }), 6000, 'click #btn-new (C)');
    } catch (err) {
      clickErr = err;
    }
    const dialogFired = dialogEvents.length > dialogsBefore;

    if (dialogFired && !clickErr) {
      // outcome (a): dialog surfaced via CDP, accepted, and click() returned normally
      try {
        await withTimeout(
          page.waitForFunction(
            () => (document.getElementById('outline-list')?.textContent ?? '').trim() === '' &&
              document.getElementById('status')?.textContent === 'new map',
            { timeout: 3000 }
          ),
          3500,
          'wait outline empty + status "new map" (C-a)'
        );
        scenarioCOutcome = 'a';
        record(
          'C (New with nodes, accept)',
          'PASS',
          'outcome (a): dialog fired (CDP-visible), accepted, outline emptied, status became "new map"'
        );
      } catch (err2) {
        scenarioCOutcome = 'c';
        record(
          'C (New with nodes, accept)',
          'FAIL',
          `outcome (c): dialog fired and was accepted, but post-condition did not hold: ${err2.message}`
        );
        await screenshot(page, 'scenario-c-postcondition-failure.png');
      }
    } else if (!dialogFired) {
      // outcome (b): CRITICAL — no CDP dialog event; check whether renderer is frozen
      scenarioCOutcome = 'b';
      log('  CRITICAL: no dialog event observed on the CDP connection after clicking #btn-new with node(s) present.');
      log(`  click() itself: ${clickErr ? `threw -> ${clickErr.message}` : 'returned without throwing'}`);
      let evalOk = false;
      let evalDetail = '';
      try {
        const val = await withTimeout(page.evaluate(() => 1 + 1), 4000, 'trivial evaluate after suspected freeze');
        evalOk = true;
        evalDetail = `page.evaluate(() => 1+1) returned ${val}`;
      } catch (err3) {
        evalDetail = `page.evaluate(() => 1+1) FAILED/HUNG: ${err3.message}`;
      }
      const shotPath = await screenshot(page, 'scenario-c-critical.png');
      record(
        'C (New with nodes, accept)',
        'FAIL',
        `outcome (b): Electron confirm() dialog is NOT CDP-visible. Renderer responsiveness check: ${evalDetail}. Screenshot: ${shotPath ?? '<failed>'}`
      );
    } else {
      // dialog fired but click() itself threw
      scenarioCOutcome = 'c';
      record(
        'C (New with nodes, accept)',
        'FAIL',
        `outcome (c): dialog fired but click() raised: ${clickErr.message}`
      );
      await screenshot(page, 'scenario-c-click-error.png');
    }
  } catch (err) {
    scenarioCOutcome = 'error';
    record('C (New with nodes, accept)', 'FAIL', `harness error: ${err.message}`);
    await screenshot(page, 'scenario-c-harness-error.png');
  }

  // --- Scenario D: New with node(s) present -> dialog dismissed (only if C resolved to (a)) ---
  if (scenarioCOutcome === 'a') {
    try {
      // Scenario C's accept always wipes the map (that's the postcondition we
      // just asserted), regardless of whether scenario B succeeded, so a
      // fresh node is needed here either way.
      const box = await withTimeout(page.locator('#view3d').boundingBox(), 5000, '#view3d boundingBox (D setup)');
      if (!box) throw new Error('#view3d has no bounding box (not visible/laid out)');
      await withTimeout(
        page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2),
        5000,
        'mouse.dblclick on #view3d center (D setup)'
      );
      await withTimeout(
        page.waitForSelector('#label-editor', { state: 'visible', timeout: 3000 }),
        3500,
        'wait #label-editor visible (D setup)'
      );
      await withTimeout(page.keyboard.type('TestNode2'), 3000, 'type TestNode2 (D setup)');
      await withTimeout(page.keyboard.press('Enter'), 3000, 'press Enter (D setup)');
      await withTimeout(
        page.waitForFunction(
          () => document.getElementById('outline-list')?.textContent?.includes('TestNode2') ?? false,
          { timeout: 3000 }
        ),
        3500,
        'wait #outline-list contains TestNode2 (D setup)'
      );

      dialogMode = 'dismiss';
      await withTimeout(page.click('#btn-new', { timeout: 5000 }), 6000, 'click #btn-new (D)');
      await withTimeout(
        page.waitForFunction(
          () => (document.getElementById('outline-list')?.textContent?.includes('TestNode2') ?? false) &&
            document.getElementById('status')?.textContent === 'kept current map',
          { timeout: 3000 }
        ),
        3500,
        'wait node retained + status "kept current map" (D)'
      );
      record('D (New with nodes, dismiss)', 'PASS', 'node retained, status became "kept current map"');
    } catch (err) {
      record('D (New with nodes, dismiss)', 'FAIL', err.message);
      await screenshot(page, 'scenario-d-failure.png');
    }
  } else {
    log(`[SKIP] Scenario D skipped: Scenario C did not resolve to outcome (a) (resolved to "${scenarioCOutcome}").`);
    results.push({ scenario: 'D (New with nodes, dismiss)', status: 'SKIP', detail: `Scenario C outcome was "${scenarioCOutcome}"` });
  }

  await finish(electronApp, electronPid, 0);
}

async function finish(electronApp, electronPid, exitCode) {
  log('\n=== SUMMARY ===');
  for (const r of results) {
    log(`[${r.status}] ${r.scenario}: ${r.detail}`);
  }
  log(`\n--- console messages (${consoleMessages.length}) ---`);
  for (const c of consoleMessages) log(c);
  log(`\n--- pageerrors (${pageErrors.length}) ---`);
  for (const p of pageErrors) log(p);
  log(`\n--- dialog events (${dialogEvents.length}) ---`);
  for (const d of dialogEvents) log(d);

  const findingsPath = path.join(artifactsDir, 'findings.md');
  const lines = [];
  lines.push('# New-button E2E findings');
  lines.push('');
  lines.push('## Per-scenario results');
  for (const r of results) lines.push(`- **${r.status}** ${r.scenario}: ${r.detail}`);
  lines.push('');
  lines.push(`## Console messages (${consoleMessages.length})`);
  lines.push('```');
  lines.push(...consoleMessages);
  lines.push('```');
  lines.push('');
  lines.push(`## Page errors (${pageErrors.length})`);
  lines.push('```');
  lines.push(...pageErrors);
  lines.push('```');
  lines.push('');
  lines.push(`## Dialog events (${dialogEvents.length})`);
  lines.push('```');
  lines.push(...dialogEvents);
  lines.push('```');
  fs.writeFileSync(findingsPath, lines.join('\n') + '\n');
  log(`\nFindings written to ${findingsPath}`);

  try {
    await withTimeout(electronApp.close(), 5000, 'electronApp.close()');
  } catch (err) {
    log(`electronApp.close() failed/hung: ${err.message}; killing pid ${electronPid} directly`);
    try {
      process.kill(electronPid, 'SIGKILL');
    } catch (killErr) {
      log(`kill(${electronPid}) failed: ${killErr.message}`);
    }
  }

  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error('HARNESS CRASHED:', err);
  process.exitCode = 1;
});
