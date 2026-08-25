/**
 * Theme and glass toggles.
 *
 * Both are stamped on the root element and both are read back before paint by
 * the inline script in the layout, so a reader who chose light does not get a
 * frame of dark first.
 *
 * Storage is wrapped: it can be unavailable in private mode or with storage
 * disabled, and the toggles must still work for the session rather than
 * throwing on the way in.
 */

import { barStore } from '../bar/inventory.ts';
import { unitSystem } from '../stores/display.ts';
import type { UnitSystem } from '../math/types.ts';

const THEME_KEY = 'exir.theme.v1';
const GLASS_KEY = 'exir.glass.v1';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Working-but-not-remembering is the correct degradation. Never a crash.
  }
};

const root = (): HTMLElement => document.documentElement;

function currentTheme(): 'light' | 'dark' {
  const stamped = root().dataset['theme'];
  if (stamped === 'light' || stamped === 'dark') return stamped;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function paintTheme(theme: 'light' | 'dark'): void {
  root().dataset['theme'] = theme;
  for (const button of document.querySelectorAll<HTMLElement>('[data-theme-toggle]')) {
    // The label names where the button GOES, not where it is.
    button.textContent = theme === 'light' ? 'Dark' : 'Light';
    button.setAttribute('aria-pressed', String(theme === 'light'));
    button.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }
}

function paintGlass(on: boolean): void {
  root().dataset['glass'] = on ? 'on' : 'off';
  for (const button of document.querySelectorAll<HTMLElement>('[data-glass-toggle]')) {
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute(
      'aria-label',
      on ? 'Turn the glass material off' : 'Turn the glass material on',
    );
  }
}

export function initChrome(): void {
  paintTheme(currentTheme());

  // The OS asking for less transparency is honoured as the default, and the
  // reader's own choice still overrides it in either direction.
  const prefersOpaque = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  const stored = read(GLASS_KEY);
  paintGlass(stored === null ? !prefersOpaque : stored === 'on');

  for (const button of document.querySelectorAll<HTMLElement>('[data-theme-toggle]')) {
    button.addEventListener('click', () => {
      const next = currentTheme() === 'light' ? 'dark' : 'light';
      paintTheme(next);
      write(THEME_KEY, next);
    });
  }

  for (const button of document.querySelectorAll<HTMLElement>('[data-glass-toggle]')) {
    button.addEventListener('click', () => {
      const next = root().dataset['glass'] !== 'on';
      paintGlass(next);
      write(GLASS_KEY, next ? 'on' : 'off');
    });
  }

  paintBarCount();
  wirePrint();
  wireImageCredits();
  wireShare();
  wireUnits();
}

/**
 * The ml / oz control, on EVERY page that carries one.
 *
 * It lived in the drink page's own script, which was correct while the drink
 * page was the only page with a live quantity on it. A family's parametric
 * formula is a live quantity too, and the same markup there would have been a
 * control nothing was listening to — the third time this project has shipped a
 * feature that worked on one template and nowhere else. The store is already
 * shared and already persisted; only the wiring was in the wrong file.
 */
function wireUnits(): void {
  const group = document.querySelector<HTMLElement>('[data-units]');
  if (!group) return;

  group.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    unitSystem.set((button.dataset['value'] ?? 'metric') as UnitSystem);
  });

  unitSystem.subscribe((system) => {
    for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset['value'] === system));
    }
    const note = document.querySelector<HTMLElement>('[data-units-note]');
    // The one place the site rounds a figure it could state exactly, disclosed
    // where the choice is made rather than in a footnote nobody reaches.
    if (note) note.hidden = system !== 'us';
  });
}

/**
 * The share block, on every page that carries one.
 *
 * Plain DOM rather than an island: the destinations are ordinary links that
 * work with no script at all, and the only things needing one are the collapse,
 * the clipboard and the device's own share sheet. Shipping a framework runtime
 * to every content page to open a row of links would be the most expensive
 * thing on those pages.
 */
function wireShare(): void {
  const block = document.querySelector<HTMLElement>('[data-share]');
  if (!block) return;

  const toggle = block.querySelector<HTMLButtonElement>('[data-share-toggle]');
  const body = block.querySelector<HTMLElement>('[data-share-body]');
  const status = block.querySelector<HTMLElement>('[data-share-status]');
  const url = block.dataset['shareUrl'] ?? location.href;
  const title = block.dataset['shareTitle'] ?? document.title;
  const text = block.dataset['shareText'] ?? title;

  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    if (body) body.hidden = open;
  });

  const say = (message: string): void => {
    if (!status) return;
    status.textContent = message;
    setTimeout(() => (status.textContent = ''), 3200);
  };

  const native = block.querySelector<HTMLButtonElement>('[data-share-native]');
  // Revealed rather than rendered: there is no media query for "this device has
  // a share sheet", so the button ships hidden and the script shows it.
  if (native && typeof navigator.share === 'function') {
    native.hidden = false;
    native.addEventListener('click', () => {
      // A cancelled share is the ordinary case and is not an error.
      void navigator.share({ title, text, url }).catch(() => {});
    });
  }

  block.querySelector('[data-share-copy]')?.addEventListener('click', () => {
    navigator.clipboard
      ?.writeText(url)
      .then(() => say('Link copied.'))
      .catch(() => say('This browser would not let the page copy for you.'));
  });
}

/**
 * The "i" on a photograph, on EVERY page that has one.
 *
 * This lived in the drink page's own script, which is why the credit on an
 * ingredient or a glassware page did nothing at all when the first non-drink
 * images were adopted — the markup was there and nothing was listening. A
 * credit that cannot be opened is not an attribution, and the licences here
 * oblige one, so it belongs with the chrome rather than with one template.
 *
 * Click rather than hover: a touch screen has no hover, and a credit only a
 * mouse can reach is not an attribution either.
 */
function wireImageCredits(): void {
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-attribution-toggle]')];
  if (!toggles.length) return;

  const closeAll = (): void => {
    for (const toggle of toggles) toggle.setAttribute('aria-expanded', 'false');
  };

  for (const toggle of toggles) {
    toggle.addEventListener('click', (event) => {
      // Without this the document listener below sees the same click and shuts
      // the popover in the same tick it was opened.
      event.stopPropagation();
      const open = toggle.getAttribute('aria-expanded') === 'true';
      closeAll();
      toggle.setAttribute('aria-expanded', String(!open));
    });
  }

  document.addEventListener('click', (event) => {
    for (const toggle of toggles) {
      if (toggle.parentElement?.contains(event.target as Node)) return;
    }
    closeAll();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  });
}

/**
 * Open every collapsed section before printing, and put it back afterwards.
 *
 * A `<details>` on paper is a section the reader cannot open, so the Keeping
 * notes would print as a heading with nothing under it. CSS cannot fix this:
 * the browser hides the content with `content-visibility` on its own
 * pseudo-element rather than with a rule an author stylesheet can outrank.
 *
 * Only ones that were closed are reopened and then re-closed, so a reader who
 * had already expanded something finds it still expanded when the dialog
 * closes.
 */
function wirePrint(): void {
  let reopened: HTMLDetailsElement[] = [];

  globalThis.addEventListener('beforeprint', () => {
    reopened = [...document.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
    for (const details of reopened) details.open = true;
  });

  globalThis.addEventListener('afterprint', () => {
    for (const details of reopened) details.open = false;
    reopened = [];
  });
}

/**
 * The My Bar count in the navigation.
 *
 * Its space is reserved in CSS for two digits before this ever runs, because a
 * nav item that grows on hydration is a layout shift on every page of the site
 * — and this is the one piece of reader state that appears in the chrome.
 *
 * It subscribes rather than reading once, so adding a bottle in one tab updates
 * the count in the others, and adding one on the My Bar page updates the header
 * above it without a reload.
 */
function paintBarCount(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-bar-count]');
  if (!targets.length) return;

  const paint = (count: number): void => {
    for (const target of targets) {
      target.textContent = count > 0 ? String(count) : '';
      // Announced on the link itself: a bare numeral read out after a nav label
      // is not a sentence.
      const link = target.closest('a');
      if (link) {
        if (count > 0) link.setAttribute('aria-label', `My Bar, ${count} on the shelf`);
        else link.removeAttribute('aria-label');
      }
    }
  };

  paint(barStore.load().value.have.length);
  barStore.subscribe((value) => paint(value.have.length));
}
