import type { GraphStore } from '../core/store';
import type { View3D } from './view3d';
import { collectTags, nodesWithAnyTag, tagColor } from '../core/tags';

// Tag filter + color-by-tag (F11). A compact, non-modal floating panel (mounted
// on document.body, docked bottom-left so the graph stays visible while you
// toggle) that makes the previously write-only node tags useful:
//   - toggle tag chips to build an ACTIVE set; nodes carrying any active tag
//     stay lit, the rest are dimmed ("dim" mode) or all-but-hidden ("hide"
//     mode, a stronger dim at opacity 0 — one dim code path, per the plan);
//   - "color by tag" recolors each node's label by its FIRST tag's stable color.
//
// The filter state (active tags, mode, color on/off) is VIEW state: it lives
// here, not in the GraphStore and not in the map file, and never goes through a
// command (it is not a graph mutation, so undo/redo ignore it). It composes
// with focus mode — View3D dims a node if focus mode OR this filter excludes it.

// "hide" mode reuses the dim path at zero opacity rather than a second
// code path (per the plan: "keep one code path — dim is the primary; document
// hide as stronger dim").
const HIDE_OPACITY = 0;

export class TagBar {
  private readonly root: HTMLDivElement;
  private readonly chipsEl: HTMLDivElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly colorCheck: HTMLInputElement;
  private readonly active = new Set<string>();
  private mode: 'dim' | 'hide' = 'dim';
  private colorEnabled = false;

  constructor(
    private store: GraphStore,
    private view3d: View3D
  ) {
    this.root = document.createElement('div');
    this.root.id = 'tag-bar';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="tag-card">
        <div class="tag-head">
          <span class="tag-title">Filter by tag</span>
          <button class="tag-close" title="close (Esc)">×</button>
        </div>
        <div class="tag-chips"></div>
        <div class="tag-controls">
          <label class="tag-mode">non-matching
            <select class="tag-mode-select">
              <option value="dim">dim</option>
              <option value="hide">hide</option>
            </select>
          </label>
          <label class="tag-color"><input type="checkbox" class="tag-color-check" /> color by tag</label>
          <button class="tag-clear">Clear filter</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.chipsEl = this.root.querySelector('.tag-chips')!;
    this.modeSelect = this.root.querySelector('.tag-mode-select')!;
    this.colorCheck = this.root.querySelector('.tag-color-check')!;

    this.root.querySelector('.tag-close')!.addEventListener('click', () => this.close());
    this.root.querySelector('.tag-clear')!.addEventListener('click', () => this.clearFilter());
    this.modeSelect.addEventListener('change', () => {
      this.mode = this.modeSelect.value === 'hide' ? 'hide' : 'dim';
      this.applyFilter();
    });
    this.colorCheck.addEventListener('change', () => this.setColorEnabled(this.colorCheck.checked));
    // Keep global/top-bar keydown handlers from reacting to typing/keys here.
    this.root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.close();
      ev.stopPropagation();
    });

    // Any graph change can add/remove tags (structure: node add/delete; props:
    // setTags edits) or change which nodes match an active tag. Rebuild the
    // chips (pruning active tags no longer in use) and recompute the dim set.
    // The color override reads the store live on each repaint, so View3D's own
    // rebuild/refresh keeps colors current — only the cached dim Set is stale.
    store.subscribe(() => {
      this.renderChips();
      this.applyFilter();
    });
    this.renderChips();
  }

  toggle(): void {
    if (this.root.hidden) this.open();
    else this.close();
  }

  open(): void {
    this.renderChips();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  // Flip color-by-tag from anywhere (e.g. the `tag-color-toggle` palette
  // command). Keeps the panel checkbox in sync.
  toggleColor(): void {
    this.setColorEnabled(!this.colorEnabled);
  }

  get isColorOn(): boolean {
    return this.colorEnabled;
  }

  private setColorEnabled(on: boolean): void {
    this.colorEnabled = on;
    this.colorCheck.checked = on;
    this.applyColor();
  }

  private clearFilter(): void {
    this.active.clear();
    this.renderChips();
    this.applyFilter();
  }

  private toggleTag(tag: string): void {
    if (this.active.has(tag)) this.active.delete(tag);
    else this.active.add(tag);
    this.renderChips();
    this.applyFilter();
  }

  private renderChips(): void {
    const tags = collectTags(this.store.state);
    const inUse = new Set(tags);
    // Drop active tags whose nodes are all gone/retagged so the filter can't
    // pin on a tag that no longer exists.
    for (const t of [...this.active]) {
      if (!inUse.has(t)) this.active.delete(t);
    }
    this.chipsEl.textContent = '';
    if (tags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tag-empty';
      empty.textContent = 'No tags yet — add tags to a node in the detail panel.';
      this.chipsEl.appendChild(empty);
      return;
    }
    for (const t of tags) {
      const chip = document.createElement('button');
      chip.className = 'tag-chip';
      if (this.active.has(t)) chip.classList.add('active');
      const dot = document.createElement('span');
      dot.className = 'tag-dot';
      dot.style.background = tagColor(t);
      const name = document.createElement('span');
      name.className = 'tag-name';
      // SECURITY: tags are user-entered — set the visible text via textContent,
      // never innerHTML, so a tag like `<img src=x onerror=…>` shows as literal
      // text (mirrors the F10 edge-tooltip fix).
      name.textContent = t;
      chip.append(dot, name);
      chip.addEventListener('click', () => this.toggleTag(t));
      this.chipsEl.appendChild(chip);
    }
  }

  private applyFilter(): void {
    if (this.active.size === 0) {
      this.view3d.setDimFilter(null);
      return;
    }
    const visible = nodesWithAnyTag(this.store.state, this.active);
    if (this.mode === 'hide') this.view3d.setDimFilter(visible, HIDE_OPACITY);
    else this.view3d.setDimFilter(visible);
  }

  private applyColor(): void {
    this.view3d.setColorByTag(
      this.colorEnabled
        ? (id): string | null => {
            const t = this.store.state.nodes.get(id)?.tags[0];
            return t !== undefined ? tagColor(t) : null;
          }
        : null
    );
  }
}
