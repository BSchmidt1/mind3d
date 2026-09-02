import { CommandRegistry, type PaletteCommand } from '../core/commandRegistry';
import { notify } from './notify';

export class CommandPalette {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly listEl: HTMLDivElement;
  private commands: PaletteCommand[] = [];
  private activeIndex = 0;

  constructor(private readonly registry: CommandRegistry) {
    this.root = document.createElement('div');
    this.root.id = 'cmd-palette';
    this.root.hidden = true;
    this.root.innerHTML = `
      <input id="cmd-input" placeholder="type a command…" autocomplete="off" />
      <div class="cmd-list"></div>
    `;
    document.body.appendChild(this.root);
    this.input = this.root.querySelector('#cmd-input')!;
    this.listEl = this.root.querySelector('.cmd-list')!;

    this.input.addEventListener('input', () => {
      this.render(this.registry.filter(this.input.value));
    });
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        this.move(1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        this.move(-1);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        this.runActive();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
      ev.stopPropagation();
    });

    // Capture phase: several surfaces (e.g. the top-bar search input)
    // unconditionally call ev.stopPropagation() on every keydown, which
    // would swallow Ctrl+K in the bubble phase. Capturing lets Ctrl+K open
    // the palette from anywhere, including while typing in another input.
    window.addEventListener(
      'keydown',
      (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
          ev.preventDefault();
          this.toggle();
        }
      },
      true
    );
  }

  open(): void {
    this.input.value = '';
    this.commands = this.registry.filter('');
    this.activeIndex = 0;
    this.root.hidden = false;
    this.render(this.commands);
    this.input.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.listEl.innerHTML = '';
  }

  toggle(): void {
    if (this.root.hidden) this.open();
    else this.close();
  }

  private move(delta: number): void {
    if (this.commands.length === 0) return;
    this.activeIndex = (this.activeIndex + delta + this.commands.length) % this.commands.length;
    this.render(this.commands);
  }

  private runActive(): void {
    const cmd = this.commands[this.activeIndex];
    if (!cmd) return;
    void this.run(cmd);
  }

  private async run(cmd: PaletteCommand): Promise<void> {
    try {
      await cmd.run();
    } catch (err) {
      notify.error(`command "${cmd.id}" ERROR: ${(err as Error).message}`);
    }
    this.close();
  }

  private render(commands: PaletteCommand[]): void {
    this.commands = commands;
    if (this.activeIndex >= commands.length) this.activeIndex = Math.max(0, commands.length - 1);
    this.listEl.innerHTML = '';
    commands.forEach((cmd, i) => {
      const row = document.createElement('div');
      row.className = 'cmd-row' + (i === this.activeIndex ? ' active' : '');
      const title = document.createElement('span');
      title.className = 'cmd-title';
      title.textContent = cmd.title;
      row.appendChild(title);
      if (cmd.hint) {
        const hint = document.createElement('span');
        hint.className = 'cmd-hint';
        hint.textContent = cmd.hint;
        row.appendChild(hint);
      }
      row.addEventListener('click', () => {
        this.activeIndex = i;
        void this.run(cmd);
      });
      this.listEl.appendChild(row);
    });
  }
}
