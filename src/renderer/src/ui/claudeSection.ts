import type { GraphStore } from '../core/store';
import { setClaudePrompt, setClaudeResult } from '../core/commands';
import type { ClaudeChunk, ClaudeExit } from '../../../shared/ipc';

const running = new Set<string>();
const buffers = new Map<string, string>();
let listenersInstalled = false;
let currentStore: GraphStore | null = null;
const rerenderHooks = new Map<string, () => void>();

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.mind3d.onClaudeChunk((c: ClaudeChunk) => {
    buffers.set(c.runId, (buffers.get(c.runId) ?? '') + c.text);
    for (const fn of rerenderHooks.values()) fn();
  });
  window.mind3d.onClaudeExit((e: ClaudeExit) => {
    running.delete(e.runId);
    const store = currentStore;
    if (!store) throw new Error('claude-exit before store init');
    if (store.state.nodes.has(e.runId)) {
      const text = (buffers.get(e.runId) ?? '') +
        (e.killed ? '\n[killed]' : e.code !== 0 ? `\n[exit code ${String(e.code)}]` : '');
      store.apply(setClaudeResult(e.runId, { text, timestamp: new Date().toISOString() }));
    }
    buffers.delete(e.runId);
    for (const fn of rerenderHooks.values()) fn();
  });
}

export function mountClaudeSection(
  host: HTMLElement,
  nodeId: string,
  store: GraphStore,
  getFallbackCwd: () => Promise<string>
): void {
  currentStore = store;
  installListeners();
  const node = store.state.nodes.get(nodeId);
  if (!node) throw new Error(`claude section: no such node "${nodeId}"`);
  const isRunning = running.has(nodeId);
  host.innerHTML = `
    <h4>claude</h4>
    <textarea id="cs-prompt" rows="3" placeholder="prompt for claude -p"></textarea>
    <div class="dp-row">
      <button id="cs-run" ${isRunning ? 'disabled' : ''}>Run</button>
      <button id="cs-kill" ${isRunning ? '' : 'disabled'}>Kill</button>
      <span id="cs-state">${isRunning ? 'running…' : ''}</span>
    </div>
    <pre id="cs-output"></pre>
  `;
  const promptEl = host.querySelector<HTMLTextAreaElement>('#cs-prompt')!;
  promptEl.value = node.claudePrompt ?? '';
  promptEl.addEventListener('blur', () => {
    const v = promptEl.value === '' ? null : promptEl.value;
    if (v !== node.claudePrompt) store.apply(setClaudePrompt(nodeId, v));
  });
  const outEl = host.querySelector<HTMLElement>('#cs-output')!;
  const runBtn = host.querySelector<HTMLButtonElement>('#cs-run')!;
  const killBtn = host.querySelector<HTMLButtonElement>('#cs-kill')!;
  const stateEl = host.querySelector<HTMLElement>('#cs-state')!;
  if (isRunning) {
    outEl.textContent = buffers.get(nodeId) ?? '';
  } else if (node.claudeResult !== null) {
    outEl.textContent = `[${node.claudeResult.timestamp}]\n${node.claudeResult.text}`;
  }
  runBtn.addEventListener('click', () => {
    void (async (): Promise<void> => {
      if (running.has(nodeId)) return;
      const prompt = promptEl.value.trim();
      if (prompt === '') {
        outEl.textContent = 'empty prompt — nothing to run';
        return;
      }
      if (prompt !== node.claudePrompt) store.apply(setClaudePrompt(nodeId, prompt));
      const cwd = node.attachedFile !== null
        ? await window.mind3d.dirname(node.attachedFile)
        : await getFallbackCwd();
      running.add(nodeId);
      buffers.set(nodeId, '');
      window.mind3d.runClaude(nodeId, prompt, cwd);
      for (const fn of rerenderHooks.values()) fn();
    })();
  });
  killBtn.addEventListener('click', () => {
    window.mind3d.killClaude(nodeId);
  });
  const hook = (): void => {
    const isRunningNow = running.has(nodeId);
    runBtn.disabled = isRunningNow;
    killBtn.disabled = !isRunningNow;
    stateEl.textContent = isRunningNow ? 'running…' : '';
    if (isRunningNow) {
      outEl.textContent = buffers.get(nodeId) ?? '';
    }
  };
  rerenderHooks.set(nodeId, hook);
}
