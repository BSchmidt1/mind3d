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

## Claude integration

The Run button spawns `claude -p "<prompt>" --output-format text` with
cwd = attached file's directory (else the map's directory). It inherits
your existing Claude Code login — no keys are stored in this app.

Press `?` in the app for all shortcuts.
