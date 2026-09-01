export interface ClaudeChunk {
  runId: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface ClaudeExit {
  runId: string;
  code: number | null;
  killed: boolean;
}

export interface Mind3dApi {
  openMap(): Promise<{ path: string; json: string } | null>;
  saveMap(path: string | null, json: string): Promise<string | null>;
  pickAttachFile(): Promise<string | null>;
  readTextFile(path: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  dirname(path: string): Promise<string>;
  runClaude(runId: string, prompt: string, cwd: string): void;
  killClaude(runId: string): void;
  onClaudeChunk(cb: (c: ClaudeChunk) => void): void;
  onClaudeExit(cb: (e: ClaudeExit) => void): void;
  onSaveRequested(cb: () => void): void;
  saveDone(): void;
}

declare global {
  interface Window {
    mind3d: Mind3dApi;
  }
}
export {};
