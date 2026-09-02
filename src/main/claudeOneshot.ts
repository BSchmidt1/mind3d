import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';

// Generalized one-shot `claude -p` spawn (renamed from voice's `voice-claude`
// so the shared proposal engine's Ask/Import/Voice callers all reuse one
// channel). Same spawn shape as the per-node runner: argv-only prompt, no
// stdin (ended immediately to skip the ~3s piped-input wait), env pass-through.
export function registerClaudeOneshotIpc(): void {
  ipcMain.handle('claude-oneshot', async (_e, prompt: string, cwd: string): Promise<string> => {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('claude-oneshot: prompt must be a non-empty string');
    }
    if (typeof cwd !== 'string' || cwd.trim() === '') {
      throw new Error('claude-oneshot: cwd must be a non-empty string');
    }
    return new Promise<string>((resolve, reject) => {
      const child = spawn('claude', ['-p', prompt, '--output-format', 'text'], {
        cwd,
        env: process.env
      });
      // Nothing to send on stdin; ending it immediately avoids the ~3s
      // stdin-wait the per-node runner incurs before claude gives up on
      // piped input.
      child.stdin.end();
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err) => {
        reject(new Error(`failed to start claude: ${err.message}`));
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`claude exited with code ${String(code)}: ${stderr.trim()}`));
        }
      });
    });
  });
}
