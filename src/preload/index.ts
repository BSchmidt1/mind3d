import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeChunk, ClaudeExit, Mind3dApi, VoiceError, VoiceTranscript } from '../shared/ipc';

const api: Mind3dApi = {
  openMap: () => ipcRenderer.invoke('map-open'),
  saveMap: (path, json) => ipcRenderer.invoke('map-save', path, json),
  saveRecovery: (json) => ipcRenderer.invoke('map-recovery-save', json),
  pickAttachFile: () => ipcRenderer.invoke('file-pick'),
  readTextFile: (path) => ipcRenderer.invoke('file-read', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  dirname: (path) => ipcRenderer.invoke('path-dirname', path),
  runClaude: (runId, prompt, cwd) => ipcRenderer.send('claude-run', runId, prompt, cwd),
  killClaude: (runId) => ipcRenderer.send('claude-kill', runId),
  onClaudeChunk: (cb) => {
    // Single-subscriber semantics: last subscription wins.
    ipcRenderer.removeAllListeners('claude-chunk');
    ipcRenderer.on('claude-chunk', (_e, c: ClaudeChunk) => cb(c));
  },
  onClaudeExit: (cb) => {
    // Single-subscriber semantics: last subscription wins.
    ipcRenderer.removeAllListeners('claude-exit');
    ipcRenderer.on('claude-exit', (_e, ex: ClaudeExit) => cb(ex));
  },
  onSaveRequested: (cb) => {
    // Single-subscriber semantics: last subscription wins.
    ipcRenderer.removeAllListeners('save-requested');
    ipcRenderer.on('save-requested', () => cb());
  },
  saveDone: () => ipcRenderer.send('save-done'),
  voiceBegin: () => ipcRenderer.send('voice-begin'),
  voiceEnd: () => ipcRenderer.send('voice-end'),
  onVoiceTranscript: (cb) => {
    // Single-subscriber semantics: last subscription wins.
    ipcRenderer.removeAllListeners('voice-transcript');
    ipcRenderer.on('voice-transcript', (_e, t: VoiceTranscript) => cb(t));
  },
  onVoiceError: (cb) => {
    // Single-subscriber semantics: last subscription wins.
    ipcRenderer.removeAllListeners('voice-error');
    ipcRenderer.on('voice-error', (_e, err: VoiceError) => cb(err));
  }
};

contextBridge.exposeInMainWorld('mind3d', api);
