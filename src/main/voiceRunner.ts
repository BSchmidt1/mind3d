import { app, ipcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

interface VoiceSession {
  child: ChildProcessWithoutNullStreams;
  cookie: string;
  buffer: string;
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
    const session: VoiceSession = { child, cookie, buffer: '' };
    current = session;

    child.stdout.on('data', (d: Buffer) => {
      session.buffer += d.toString();
    });
    child.on('error', (err) => {
      if (current === session) current = null;
      event.sender.send('voice-error', { message: `failed to start nerd-dictation: ${err.message}` });
    });
    child.on('close', () => {
      if (current === session) current = null;
      event.sender.send('voice-transcript', { text: session.buffer.trim() });
    });
  });

  ipcMain.on('voice-end', (event) => {
    if (current === null) {
      event.sender.send('voice-error', { message: 'no voice session in progress' });
      return;
    }
    const { cookie } = current;
    const ender = spawn('nerd-dictation', ['end', '--cookie', cookie], { env: voiceEnv() });
    ender.on('error', (err) => {
      event.sender.send('voice-error', { message: `failed to stop nerd-dictation: ${err.message}` });
    });
    // The begin child's own 'close' handler (registered in voice-begin)
    // sends voice-transcript and clears `current` once nerd-dictation
    // flushes the transcript and exits.
  });
}
