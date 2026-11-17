import { CARD_DEFS, CARD_DEFS_LIST } from '../game/deck.ts';
import type { CardKey } from '../game/types.ts';

let preloaded = false;
export function preloadCardAssets(): void {
  if (preloaded) return;
  preloaded = true;
  for (const def of CARD_DEFS_LIST) {
    const img = new Image();
    img.decoding = 'async';
    img.src = def.image;
  }
}

export interface CardRenderOptions {
  selected?: boolean;
  inMeld?: boolean;
  meldColorIndex?: number;
  isNew?: boolean;
  isHint?: boolean;
  hintTone?: 'discard' | 'pair' | 'serigat' | 'ngejuk' | 'count';
  hoverExtra?: string;
  clickable?: boolean;
  small?: boolean;
}

/**
 * Renders a classic Ceki card with zero overlapping numbers or annotation badges
 * on top of the artwork. Hints are shown only via outer border glow & hover tooltip.
 */
export function renderClassicCard(key: CardKey, opts: CardRenderOptions = {}): HTMLElement {
  const def = CARD_DEFS[key];
  const card = document.createElement('div');
  card.className = 'ceki-card';
  if (opts.small) card.classList.add('ceki-card--small');
  if (opts.selected) card.classList.add('is-selected');
  if (opts.inMeld) {
    card.classList.add('is-in-meld', `meld-group-${(opts.meldColorIndex ?? 0) % 4}`);
  }
  if (opts.isNew) card.classList.add('is-new');
  if (opts.isHint) card.classList.add('is-hint');
  if (opts.hintTone && opts.hintTone !== 'count') {
    card.classList.add(`hint-outline-${opts.hintTone}`);
  }
  if (opts.clickable) card.classList.add('is-clickable');

  card.title = opts.hoverExtra
    ? `${def.balineseName} — ${opts.hoverExtra}`
    : def.balineseName;

  const imgWrap = document.createElement('div');
  imgWrap.className = 'card-img-wrap';
  const img = document.createElement('img');
  img.src = def.image;
  img.alt = def.balineseName;
  img.draggable = false;
  imgWrap.appendChild(img);
  card.appendChild(imgWrap);

  const hoverName = document.createElement('span');
  hoverName.className = 'card-hover-name';
  hoverName.innerHTML = opts.hoverExtra
    ? `<strong>${def.balineseName}</strong><small>${opts.hoverExtra}</small>`
    : `<strong>${def.balineseName}</strong>`;
  card.appendChild(hoverName);

  return card;
}

export function renderCardBack(orientation: 'vertical' | 'horizontal' = 'vertical', mini = false): HTMLElement {
  const back = document.createElement('div');
  back.className = `ceki-card-back ${orientation === 'horizontal' ? 'is-horizontal' : ''} ${mini ? 'is-mini' : ''}`;
  return back;
}
