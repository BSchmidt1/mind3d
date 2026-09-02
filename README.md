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

## Voice mode

Hold the 🎤 button and speak an instruction; on release, an editable confirm
box shows what was heard so you can fix a mis-hear before anything runs. Hit
Run and Claude turns it into new nodes/edges and applies them as one undoable
change (`Ctrl+Z` undoes the whole result); Cancel aborts without calling
Claude. New nodes attach near the selected node when one is selected, and its
attached file (if any) is read and given to Claude as source material — e.g.
select a node with a markdown file attached and say "map the main sections of
the attached file". (Voice direct-applies on Run; Ask/Import instead show an
accept/reject preview.)

Transcription is fully offline via [nerd-dictation](https://github.com/ideasman42/nerd-dictation)
(Vosk); it must be installed and on `PATH` (or `~/.local/bin`). Turning
the transcript into nodes runs a one-shot `claude -p` and inherits your
existing Claude Code login, same as the per-node runner above — no keys
are stored in this app.

Press `?` in the app for all shortcuts.
