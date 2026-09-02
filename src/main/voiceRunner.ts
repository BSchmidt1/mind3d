import { app, ipcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

interface VoiceSession {
  child: ChildProcessWithoutNullStreams;
  cookie: string;
  buffer: string;
  // Set once the session has failed (begin spawn error, or a failed
  // voice-end handshake that forces the begin child to be killed) so the
  // begin child's 'close' handler knows to suppress the stale/empty
  // transcript it would otherwise unconditionally send.
  errored: boolean;
}

let current: VoiceSession | null = null;

// nerd-dictation lives outside the app's own PATH; prepend the user's
// ~/.local/bin so `spawn('nerd-dictation', ...)` resolves without depending
// on the parent process's shell environment.
function voiceEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${homedir()}/.local/bin:${process.env['PATH'] ?? ''}` };
}

export function registerVoiceIpc(): void {
  ipcMain.on('voice-begin', (event) => {
    if (current !== null) {
      event.sender.send('voice-error', { message: 'a voice session is already in progress' });
      return;
    }
    const cookie = path.join(app.getPath('temp'), `mind3d-voice-${process.pid}.cookie`);
    const child = spawn('nerd-dictation', ['begin', '--output=STDOUT', '--cookie', cookie], {
      env: voiceEnv()
    });
    const session: VoiceSession = { child, cookie, buffer: '', errored: false };
    current = session;

    child.stdout.on('data', (d: Buffer) => {
      session.buffer += d.toString();
    });
    child.on('error', (err) => {
      session.errored = true;
      if (current === session) current = null;
      event.sender.send('voice-error', { message: `failed to start nerd-dictation: ${err.message}` });
    });
    child.on('close', () => {
      if (current === session) current = null;
      // A failed spawn fires both 'error' and 'close'; skip the
      // stale/empty transcript here so it doesn't reach the renderer
      // after (or during) an already-reported voice-error.
      if (!session.errored) {
        event.sender.send('voice-transcript', { text: session.buffer.trim() });
      }
    });
  });

  ipcMain.on('voice-end', (event) => {
    const session = current;
    if (session === null) {
      event.sender.send('voice-error', { message: 'no voice session in progress' });
      return;
    }
    const ender = spawn('nerd-dictation', ['end', '--cookie', session.cookie], { env: voiceEnv() });
    // If the end handshake itself fails (spawn error, or a non-zero exit),
    // the begin child would otherwise be orphaned forever: it never
    // receives 'end' and `current` never clears, so every future
    // voice-begin rejects with "already in progress" until app restart.
    // Mark the session errored (suppresses the close handler's transcript
    // send) and kill the begin child directly so its own 'close' handler
    // clears `current`.
    const failEnd = (message: string): void => {
      // Idempotent: a failed ender spawn can itself fire both 'error' and
      // 'close' (the same quirk fixed above for the begin child), so guard
      // against sending voice-error / killing the child twice.
      if (session.errored) return;
      session.errored = true;
      event.sender.send('voice-error', { message });
      session.child.kill();
    };
    ender.on('error', (err) => {
      failEnd(`failed to stop nerd-dictation: ${err.message}`);
    });
    ender.on('close', (code) => {
      if (code !== 0) failEnd(`nerd-dictation end exited with code ${code}`);
    });
    // On a clean end (code 0), the begin child's own 'close' handler
    // (registered in voice-begin) sends voice-transcript and clears
    // `current` once nerd-dictation flushes the transcript and exits.
  });

  ipcMain.handle('voice-claude', async (_e, prompt: string, cwd: string): Promise<string> => {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('voice-claude: prompt must be a non-empty string');
    }
    if (typeof cwd !== 'string' || cwd.trim() === '') {
      throw new Error('voice-claude: cwd must be a non-empty string');
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
