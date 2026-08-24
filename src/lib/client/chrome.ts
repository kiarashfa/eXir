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
