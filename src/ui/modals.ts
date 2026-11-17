/**
 * Native <dialog> helper following modern-web-guidance:
 * - Uses showModal() for top-layer, focus management, Esc & back-gesture dismissal.
 * - Does NOT add role="dialog" or aria-modal (native modal provides them).
 * - Progressive enhancement for closedby="any" with pointerdown/pointerup fallback on Safari.
 */

let closedByFallbackInstalled = false;

export function installDialogClosedByFallback(): void {
  if (closedByFallbackInstalled) return;
  closedByFallbackInstalled = true;
  if ('closedBy' in HTMLDialogElement.prototype) return;

  const outside = (e: PointerEvent, dialog: HTMLDialogElement): boolean => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    const dialog = target?.closest?.('dialog[closedby="any"]') as HTMLDialogElement | null;
    if (dialog && dialog.open) {
      (dialog as HTMLDialogElement & { _pressedOutside?: boolean })._pressedOutside = outside(e, dialog);
    }
  });

  document.addEventListener('pointerup', (e) => {
    const openDialogs = document.querySelectorAll('dialog[open][closedby="any"]');
    openDialogs.forEach((node) => {
      const dialog = node as HTMLDialogElement & { _pressedOutside?: boolean };
      if (dialog._pressedOutside && outside(e, dialog)) {
        dialog.close();
      }
      dialog._pressedOutside = false;
    });
  });
}

export function createObsidianDialog(
  id: string,
  titleText: string,
  closedBy: 'any' | 'closerequest' | 'none' = 'any'
): {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  closeBtn: HTMLButtonElement;
} {
  installDialogClosedByFallback();
  const existing = document.getElementById(id) as HTMLDialogElement | null;
  if (existing) existing.remove();

  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = 'obsidian-dialog';
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('closedby', closedBy);

  const header = document.createElement('div');
  header.className = 'obsidian-dialog__header';

  const title = document.createElement('h2');
  title.id = `${id}-title`;
  title.className = 'obsidian-dialog__title';
  title.textContent = titleText;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'obsidian-dialog__close';
  closeBtn.setAttribute('aria-label', 'Tutup');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => dialog.close());

  header.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'obsidian-dialog__body';

  dialog.append(header, body);
  document.body.appendChild(dialog);

  return { dialog, body, closeBtn };
}
