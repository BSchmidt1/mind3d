import { ipcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const runs = new Map<string, ChildProcessWithoutNullStreams>();

export function registerClaudeIpc(): void {
  ipcMain.on('claude-run', (event, runId: string, prompt: string, cwd: string) => {
    if (typeof runId !== 'string' || runId === '') {
      const safeRunId = String(runId);
      event.sender.send('claude-chunk', { runId: safeRunId, stream: 'stderr', text: 'invalid runId\n' });
      event.sender.send('claude-exit', { runId: safeRunId, code: null, killed: false });
      return;
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      event.sender.send('claude-chunk', { runId, stream: 'stderr', text: 'empty prompt\n' });
      event.sender.send('claude-exit', { runId, code: null, killed: false });
      return;
    }
    if (runs.has(runId)) {
      event.sender.send('claude-chunk', {
        runId, stream: 'stderr', text: 'a run is already in progress for this node\n'
      });
      return;
    }
    const child = spawn('claude', ['-p', prompt, '--output-format', 'text'], {
      cwd,
      env: process.env
    });
    child.stdin.end();
    runs.set(runId, child);
    child.stdout.on('data', (d: Buffer) =>
      event.sender.send('claude-chunk', { runId, stream: 'stdout', text: d.toString() })
    );
    child.stderr.on('data', (d: Buffer) =>
      event.sender.send('claude-chunk', { runId, stream: 'stderr', text: d.toString() })
    );
    child.on('error', (err) => {
      runs.delete(runId);
      event.sender.send('claude-chunk', {
        runId, stream: 'stderr', text: `failed to start claude: ${err.message}\n`
      });
    });
    child.on('close', (code) => {
      const killed = child.killed;
      runs.delete(runId);
      event.sender.send('claude-exit', { runId, code, killed });
    });
  });

  ipcMain.on('claude-kill', (_e, runId: string) => {
    runs.get(runId)?.kill('SIGTERM');
  });
}
