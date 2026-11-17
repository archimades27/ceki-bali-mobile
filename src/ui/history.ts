import type { HistoryEntry } from '../game/types.ts';
import { createObsidianDialog } from './modals.ts';

export class HistoryModal {
  private dialog: HTMLDialogElement;
  private bodyEl: HTMLElement;

  constructor() {
    const { dialog, body } = createObsidianDialog('history-modal', 'Riwayat Permainan', 'any');
    this.dialog = dialog;
    this.bodyEl = body;
  }

  open(entries: HistoryEntry[]): void {
    this.bodyEl.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'modal-empty-text';
      empty.textContent = 'Belum ada catatan giliran pada babak ini.';
      this.bodyEl.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'history-list';
      const reversed = [...entries].reverse().slice(0, 60);
      for (const entry of reversed) {
        const li = document.createElement('li');
        li.className = 'history-item';

        const meta = document.createElement('span');
        meta.className = 'history-meta';
        meta.textContent = `B${entry.round} • ${entry.actor}`;

        const action = document.createElement('span');
        action.className = 'history-action';
        action.textContent = entry.cardName
          ? `${entry.action}: ${entry.cardName}`
          : entry.action;

        li.append(meta, action);
        list.appendChild(li);
      }
      this.bodyEl.appendChild(list);
    }

    if (!this.dialog.open) {
      this.dialog.showModal();
    }
  }
}
