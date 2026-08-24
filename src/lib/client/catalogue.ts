/**
 * The catalogue view switch.
 *
 * Both views are in the HTML and only one is shown, so a crawler reads every
 * drink link whichever is active and switching costs no request. The choice
 * persists, because someone who prefers the table prefers it on every visit.
 */

const KEY = 'exir.catalogue.v1';

export function initCatalogue(): void {
  const group = document.querySelector<HTMLElement>('[data-catalogue-view]');
  if (!group) return;

  const show = (value: string): void => {
    for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset['value'] === value));
    }
    for (const panel of document.querySelectorAll<HTMLElement>('[data-catalogue-panel]')) {
      panel.hidden = panel.dataset['cataloguePanel'] !== value;
    }
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Storage can be unavailable. The switch still works for this visit.
    }
  };

  group.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset['value']) show(button.dataset['value']);
  });

  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'table') show(stored);
  } catch {
    // As above.
  }
}
