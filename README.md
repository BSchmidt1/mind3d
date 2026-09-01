# mind3d

3D mindmapping desktop app. Force-directed graph (cycles welcome) with
persistent manual pinning, Workflowy-style outline, markdown notes,
Obsidian file attachments, and a per-node `claude -p` runner.

## Run

    npm install
    npm run dev        # development (hot reload)
    npm test           # unit tests (vitest)
    npm run typecheck

## Files

Maps are plain versioned JSON (`*.json`), atomic writes with
`.bak.1`–`.bak.5` rotation next to the file. Autosave 2s after a change
once the map has a path; Ctrl+S saves manually.

A map that has never been saved to a path (no Save-as yet) has no file
to autosave to. To avoid silent data loss, such a map is instead
continuously written to a recovery file at `<userData>/recovery.json`
(on Linux: `~/.config/mind3d/recovery.json`) on the same 2s change
timer and on quit. This file is not auto-restored on startup — open it
manually via Open if you need to recover unsaved work.

## Claude integration

The Run button spawns `claude -p "<prompt>" --output-format text` with
cwd = attached file's directory (else the map's directory). It inherits
your existing Claude Code login — no keys are stored in this app.

Press `?` in the app for all shortcuts.
