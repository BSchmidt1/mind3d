import type { GraphStore } from '../core/store';
import type { Selection } from '../core/selection';
import type { View3D } from './view3d';
import type { MapSession } from '../mapSession';
import type { CommandRegistry } from '../core/commandRegistry';
import { createTour, createViewpoint, stepTour, type Tour, type TourStop, type Viewpoint } from '../core/viewpoint';
import { notify } from './notify';
import { closeOtherModals, registerModal } from './modal';

// Camera viewpoints + tours (F9). Registers Ctrl+K palette commands (the
// anti-top-bar-bloat mechanism) rather than adding buttons:
//   viewpoint-save   — capture the current camera pose under a name
//   viewpoint-goto   — pick a saved viewpoint → animate the camera to it
//   tour-create      — assemble an ordered tour from viewpoints + the selection
//   tour-play        — pick a tour → begin walking it (index 0)
//   tour-next / tour-prev — step the active tour (also bound to ] / [)
//   tour-stop        — leave the active tour
// Viewpoints/tours live on the MapSession (serialized with the file); the
// camera get/apply lives in View3D (getCamera/applyCamera), never DOM in #view3d.

export interface TourDeps {
  store: GraphStore;
  selection: Selection;
  view3d: View3D;
  registry: CommandRegistry;
  session: MapSession;
}

export function installTours(deps: TourDeps): void {
  const { store, selection, view3d, registry, session } = deps;
  const namePrompt = new NamePrompt();
  const vpPicker = new ViewpointPicker();
  const tourPicker = new TourPicker();
  const builder = new TourBuilder();

  // Active-tour state. A tour is "active" from tour-play until tour-stop (or a
  // New/Open, which the store subscriber below detects via a shrinking node
  // set is not reliable — so we leave the active tour in place; its stops just
  // resolve against the new map or get skipped). ] / [ step it while active.
  let activeTour: Tour | null = null;
  let activeIndex = 0;

  // Resolve + apply one tour stop. A viewpoint pose animates the camera; a node
  // stop selects + flies to the node. A dangling ref (viewpoint or node deleted
  // after the tour was built) is skipped with a notice rather than throwing —
  // playback is fail-soft (the file shape was already validated fail-fast).
  function applyStop(tour: Tour, index: number): void {
    const stop: TourStop | undefined = tour.stops[index];
    if (!stop) throw new Error(`tour "${tour.name}": no stop at index ${index}`);
    if (stop.kind === 'viewpoint') {
      const vp = session.listViewpoints().find((v) => v.id === stop.ref);
      if (!vp) {
        notify.info(`tour: viewpoint no longer exists — skipping stop ${index + 1}`);
        return;
      }
      view3d.applyCamera(vp);
    } else {
      if (!store.state.nodes.has(stop.ref)) {
        notify.info(`tour: node no longer exists — skipping stop ${index + 1}`);
        return;
      }
      try {
        selection.set(stop.ref);
        view3d.flyTo(stop.ref);
      } catch (err) {
        notify.info(`tour: cannot reach node — ${(err as Error).message}`);
      }
    }
  }

  function stepActive(dir: 1 | -1): void {
    if (!activeTour) {
      notify.info('no active tour — play one first');
      return;
    }
    const next = stepTour(activeTour, activeIndex, dir);
    if (next === activeIndex) {
      notify.info(dir === 1 ? 'tour: already at the last stop' : 'tour: already at the first stop');
      return;
    }
    activeIndex = next;
    applyStop(activeTour, activeIndex);
    notify.info(`tour "${activeTour.name}" — stop ${activeIndex + 1}/${activeTour.stops.length}`);
  }

  registry.register({
    id: 'viewpoint-save',
    title: 'Viewpoint: save current camera…',
    hint: 'named camera pose',
    run: () =>
      namePrompt.open('Name this viewpoint', 'e.g. overview', (name) => {
        try {
          const cam = view3d.getCamera();
          const vp = createViewpoint(name, cam.position, cam.target);
          session.addViewpoint(vp);
          notify.success(`viewpoint "${vp.name}" saved`);
        } catch (err) {
          notify.error(`viewpoint: ${(err as Error).message}`);
        }
      })
  });

  registry.register({
    id: 'viewpoint-goto',
    title: 'Viewpoint: go to…',
    hint: 'animate camera',
    run: () => {
      const vps = session.listViewpoints();
      if (vps.length === 0) {
        notify.info('no viewpoints yet — save one first');
        return;
      }
      vpPicker.open('Go to viewpoint', vps, (vp) => {
        view3d.applyCamera(vp);
        notify.info(`→ "${vp.name}"`);
      });
    },
    when: () => session.listViewpoints().length > 0
  });

  registry.register({
    id: 'tour-create',
    title: 'Tour: create…',
    hint: 'ordered viewpoints + nodes',
    run: () => {
      const vps = session.listViewpoints();
      const sel = selection.get();
      const selNode = sel !== null ? { id: sel, label: store.state.nodes.get(sel)?.label ?? sel } : null;
      if (vps.length === 0 && selNode === null) {
        notify.info('save a viewpoint or select a node to build a tour');
        return;
      }
      builder.open(vps, selNode, (name, stops) => {
        try {
          const tour = createTour(name, stops);
          session.addTour(tour);
          notify.success(`tour "${tour.name}" created (${tour.stops.length} stops)`);
        } catch (err) {
          notify.error(`tour: ${(err as Error).message}`);
        }
      });
    },
    when: () => session.listViewpoints().length > 0 || selection.get() !== null
  });

  registry.register({
    id: 'tour-play',
    title: 'Tour: play…',
    hint: '] / [ to step',
    run: () => {
      const tours = session.listTours();
      if (tours.length === 0) {
        notify.info('no tours yet — create one first');
        return;
      }
      tourPicker.open('Play tour', tours, (tour) => {
        activeTour = tour;
        activeIndex = 0;
        applyStop(tour, 0);
        notify.info(`tour "${tour.name}" — stop 1/${tour.stops.length} · ] next · [ prev`);
      });
    },
    when: () => session.listTours().length > 0
  });

  registry.register({
    id: 'tour-next',
    title: 'Tour: next stop',
    hint: ']',
    run: () => stepActive(1),
    when: () => activeTour !== null
  });
  registry.register({
    id: 'tour-prev',
    title: 'Tour: previous stop',
    hint: '[',
    run: () => stepActive(-1),
    when: () => activeTour !== null
  });
  registry.register({
    id: 'tour-stop',
    title: 'Tour: stop',
    run: () => {
      activeTour = null;
      activeIndex = 0;
      notify.info('tour stopped');
    },
    when: () => activeTour !== null
  });

  // ] / [ step the active tour. Self-contained (like CommandPalette's Ctrl+K),
  // ignored while typing in an input/textarea or when no tour is active.
  window.addEventListener('keydown', (ev) => {
    if (activeTour === null) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const el = document.activeElement;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    ) {
      return;
    }
    if (ev.key === ']') {
      ev.preventDefault();
      stepActive(1);
    } else if (ev.key === '[') {
      ev.preventDefault();
      stepActive(-1);
    }
  });
}

// A single-line name entry overlay (mounted on document.body). Mirrors the F8
// snapshot NamePrompt; kept local so F9 stays self-contained. Enter/Save submits
// a trimmed non-empty name, Escape / backdrop cancels.
class NamePrompt {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly label: HTMLDivElement;
  private onSubmit: ((name: string) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'viewpoint-name-prompt';
    registerModal('viewpoint-name-prompt', () => this.close());
    this.root.className = 'overlay-prompt';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="name-card">
        <div class="name-label"></div>
        <input class="name-input" type="text" />
        <div class="name-actions">
          <button class="name-cancel">Cancel</button>
          <button class="name-go">Save</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.input = this.root.querySelector('.name-input')!;
    this.label = this.root.querySelector('.name-label')!;

    this.root.querySelector('.name-cancel')!.addEventListener('click', () => this.close());
    this.root.querySelector('.name-go')!.addEventListener('click', () => this.submit());
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
  }

  open(label: string, placeholder: string, onSubmit: (name: string) => void): void {
    closeOtherModals('viewpoint-name-prompt');
    this.label.textContent = label;
    this.input.placeholder = placeholder;
    this.onSubmit = onSubmit;
    this.input.value = '';
    this.root.hidden = false;
    this.input.focus();
  }

  private close(): void {
    this.root.hidden = true;
    this.onSubmit = null;
  }

  private submit(): void {
    const name = this.input.value.trim();
    if (name === '') {
      notify.info('enter a name');
      return;
    }
    const cb = this.onSubmit;
    this.close();
    cb?.(name);
  }
}

// A pick-one overlay for viewpoints (mounted on document.body). Titled list,
// each row clickable. Escape / backdrop cancels.
class ViewpointPicker {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'viewpoint-picker';
    registerModal('viewpoint-picker', () => this.close());
    this.root.className = 'overlay-picker';
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="picker-card">
        <div class="picker-title"></div>
        <div class="picker-list"></div>
        <div class="picker-actions"><button class="picker-cancel">Cancel</button></div>
      </div>`;
    document.body.appendChild(this.root);
    this.titleEl = this.root.querySelector('.picker-title')!;
    this.listEl = this.root.querySelector('.picker-list')!;
    this.root.querySelector('.picker-cancel')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });
  }

  open(title: string, vps: Viewpoint[], onPick: (vp: Viewpoint) => void): void {
    closeOtherModals('viewpoint-picker');
    this.titleEl.textContent = title;
    this.listEl.innerHTML = '';
    // Newest first, matching the snapshot picker.
    for (const vp of [...vps].reverse()) {
      const row = document.createElement('div');
      row.className = 'picker-row';
      const name = document.createElement('span');
      name.className = 'picker-name';
      name.textContent = vp.name;
      row.appendChild(name);
      row.addEventListener('click', () => {
        this.close();
        onPick(vp);
      });
      this.listEl.appendChild(row);
    }
    this.root.hidden = false;
    this.root.focus();
  }

  private close(): void {
    this.root.hidden = true;
  }
}

// A pick-one overlay for tours. Shows the stop count per tour.
class TourPicker {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'tour-picker';
    registerModal('tour-picker', () => this.close());
    this.root.className = 'overlay-picker';
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="picker-card">
        <div class="picker-title"></div>
        <div class="picker-list"></div>
        <div class="picker-actions"><button class="picker-cancel">Cancel</button></div>
      </div>`;
    document.body.appendChild(this.root);
    this.titleEl = this.root.querySelector('.picker-title')!;
    this.listEl = this.root.querySelector('.picker-list')!;
    this.root.querySelector('.picker-cancel')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });
  }

  open(title: string, tours: Tour[], onPick: (tour: Tour) => void): void {
    closeOtherModals('tour-picker');
    this.titleEl.textContent = title;
    this.listEl.innerHTML = '';
    for (const tour of [...tours].reverse()) {
      const row = document.createElement('div');
      row.className = 'picker-row';
      const name = document.createElement('span');
      name.className = 'picker-name';
      name.textContent = tour.name;
      const meta = document.createElement('span');
      meta.className = 'picker-when';
      meta.textContent = `${tour.stops.length} stops`;
      row.appendChild(name);
      row.appendChild(meta);
      row.addEventListener('click', () => {
        this.close();
        onPick(tour);
      });
      this.listEl.appendChild(row);
    }
    this.root.hidden = false;
    this.root.focus();
  }

  private close(): void {
    this.root.hidden = true;
  }
}

// A tour builder overlay: name the tour, then click available viewpoints (and,
// if a node is selected, that node) to append stops in order; remove any stop;
// Create submits. Node stops are limited to the node selected when the builder
// opened (the builder is modal) — a documented, acceptable first-version scope.
class TourBuilder {
  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly availEl: HTMLDivElement;
  private readonly chosenEl: HTMLDivElement;
  private stops: { stop: TourStop; label: string }[] = [];
  private onCreate: ((name: string, stops: TourStop[]) => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'tour-builder';
    registerModal('tour-builder', () => this.close());
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="tour-card">
        <div class="tour-title">Create a tour</div>
        <input class="tour-name" type="text" placeholder="tour name" />
        <div class="tour-cols">
          <div class="tour-col">
            <div class="tour-col-label">Add stops</div>
            <div class="tour-avail"></div>
          </div>
          <div class="tour-col">
            <div class="tour-col-label">Tour order</div>
            <div class="tour-chosen"></div>
          </div>
        </div>
        <div class="tour-actions">
          <button class="tour-cancel">Cancel</button>
          <button class="tour-create">Create</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.nameInput = this.root.querySelector('.tour-name')!;
    this.availEl = this.root.querySelector('.tour-avail')!;
    this.chosenEl = this.root.querySelector('.tour-chosen')!;

    this.root.querySelector('.tour-cancel')!.addEventListener('click', () => this.close());
    this.root.querySelector('.tour-create')!.addEventListener('click', () => this.submit());
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });
  }

  open(
    viewpoints: Viewpoint[],
    selNode: { id: string; label: string } | null,
    onCreate: (name: string, stops: TourStop[]) => void
  ): void {
    closeOtherModals('tour-builder');
    this.onCreate = onCreate;
    this.stops = [];
    this.nameInput.value = '';

    // Available: every viewpoint, then the selected node (if any).
    this.availEl.innerHTML = '';
    for (const vp of viewpoints) {
      this.addAvailChip(`◉ ${vp.name}`, { kind: 'viewpoint', ref: vp.id }, vp.name);
    }
    if (selNode !== null) {
      this.addAvailChip(`＋ node: ${selNode.label}`, { kind: 'node', ref: selNode.id }, selNode.label);
    }
    this.renderChosen();
    this.root.hidden = false;
    this.nameInput.focus();
  }

  private addAvailChip(text: string, stop: TourStop, label: string): void {
    const chip = document.createElement('button');
    chip.className = 'tour-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      this.stops.push({ stop: { kind: stop.kind, ref: stop.ref }, label });
      this.renderChosen();
    });
    this.availEl.appendChild(chip);
  }

  private renderChosen(): void {
    this.chosenEl.innerHTML = '';
    if (this.stops.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tour-empty';
      empty.textContent = '(no stops yet — click on the left)';
      this.chosenEl.appendChild(empty);
      return;
    }
    this.stops.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'tour-stop-row';
      const label = document.createElement('span');
      const kindMark = s.stop.kind === 'viewpoint' ? '◉' : '＋';
      label.textContent = `${i + 1}. ${kindMark} ${s.label}`;
      const del = document.createElement('button');
      del.className = 'tour-stop-del';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        this.stops.splice(i, 1);
        this.renderChosen();
      });
      row.appendChild(label);
      row.appendChild(del);
      this.chosenEl.appendChild(row);
    });
  }

  private close(): void {
    this.root.hidden = true;
    this.onCreate = null;
  }

  private submit(): void {
    const name = this.nameInput.value.trim();
    if (name === '') {
      notify.info('tour: enter a name');
      return;
    }
    if (this.stops.length === 0) {
      notify.info('tour: add at least one stop');
      return;
    }
    const cb = this.onCreate;
    const stops = this.stops.map((s) => s.stop);
    this.close();
    cb?.(name, stops);
  }
}
