# F7 — local-embedding feasibility spike

**Date:** 2026-09-02 · **Verdict: FAIL / DEFER.** Semantic search deferred; the
unconditional lexical search over labels **and** notes shipped.

## Question

Can a small local embedding model (all-MiniLM-L6-v2, ~23 MB) run in the Electron
**renderer**, **offline**, with no API keys and no cloud, under this app's
sandbox — so search could rank nodes by meaning rather than by fuzzy string match?

## What the spike proved (positive)

Ran `@xenova/transformers@2.17.2` (transformers.js) with `Xenova/all-MiniLM-L6-v2`
in a throwaway, git-ignored `spike/embed-spike/` (now deleted):

- Model loads and embeds. 384-dim mean-pooled, normalized vectors.
- Cosine ranking is correct: `cos("AI safety/alignment", "AI alignment/x-risk") = 0.64`
  vs `cos("AI safety", "banana bread recipe") = -0.02` → similar pair ranks far higher.
- Footprint: model = **~23 MB** (22 MB `model_quantized.onnx` + 0.7 MB tokenizer).
- One first-run download of ~23 MB populates the cache; after that the model
  itself needs no network.

So the ML part is viable in principle.

## Why it fails for THIS app (blocker)

The positive result above used the **native `onnxruntime-node`** backend. The
renderer cannot use it — with `nodeIntegration: false` the renderer's backend is
`onnxruntime-web` (**WASM**, the ~9.5 MB `ort-wasm-simd-threaded.wasm`). The
blocker is how the renderer loads bundled assets **offline in a packaged build**:

1. Production loads the renderer via `win.loadFile(...)` → a **`file://`** origin
   (`src/main/index.ts:65`). Dev loads it over HTTP (`ELECTRON_RENDERER_URL`).
2. Both transformers.js (`node_modules/@xenova/transformers/src/utils/hub.js:199,204`
   — `return fetch(urlOrPath)`) and `onnxruntime-web` load their model/WASM via
   **`fetch()`**.
3. Chromium **does not support `fetch()` on the `file:` scheme** — it throws. So
   loading a bundled model + WASM from the packaged app fails through the default
   path. It would deceptively **work in dev** (HTTP dev server) and break only in
   the offline packaged app — a trap worth avoiding.

Note: this app has **no CSP** at all (no meta tag, no `webSecurity` override), so
the binding constraint here is the offline/`file://` sandbox rule, not a CSP.

## Workarounds considered and rejected (out of a bounded spike's scope)

- `webSecurity: false` to allow `file://` fetch → violates Global Constraint 5
  (renderer sandbox). Rejected.
- A custom `app://` protocol (`protocol.handle`) serving model + WASM, plus
  COOP/COEP headers to get WASM SIMD-threads (SharedArrayBuffer) — non-trivial
  main-process plumbing well beyond a bounded spike.
- IPC-streaming ~23 MB of model bytes from main + feeding ORT an ArrayBuffer —
  more plumbing; transformers.js resolves models via its fetch-based hub, not
  cleanly from in-memory bytes.

Cost (~32 MB bundle: 23 MB model + 9.5 MB WASM, a worker, custom-protocol
plumbing, single-threaded WASM under `file://`) is high; the value of semantic
ranking over graphs of tens–hundreds of nodes is marginal versus a good lexical
ranker that now also covers notes.

## Shipped instead

`core/search.ts` — `searchNodes(state, query)`: fuzzy-ranks nodes over **label
and notes** (a notes-only hit is found; a label hit wins ties via a small notes
penalty). Wired into the top-bar search box; a notes-only hit shows a `notes`
badge. `core/semantic.ts`, `embeddingWorker.ts`, and the embedding dependency
were **not** added. If revisited, the ML is proven — only the offline `file://`
asset-loading needs a custom-protocol solution first.
