import type { CardKey } from '../game/types.ts';
import { renderCardBack, renderClassicCard } from './cardRenderer.ts';

export interface FlightSpec {
  sourceRect: DOMRect | null;
  destEl: HTMLElement | null;
  destRect?: DOMRect | null;
  faceKey?: CardKey;
  startWithBack: boolean;
  flipOnArrive: boolean;
  spinOnArrive?: boolean;
  smallCard: boolean;
  flightMs: number;
  flipMs?: number;
  fadeIntoDest?: boolean;
  hideDestDuringFlight?: boolean;
  highlightOnLand?: boolean;
}

export class MatchAnimator {
  private overlay: HTMLElement;
  private epoch = 0;
  private activeAnims: Animation[] = [];
  private activeTimers: number[] = [];
  private hiddenEls: HTMLElement[] = [];
  private pendingComplete: (() => void) | null = null;
  private _isAnimating = false;

  constructor() {
    let existing = document.getElementById('card-anim-overlay');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'card-anim-overlay';
      existing.className = 'card-anim-overlay';
      existing.setAttribute('aria-hidden', 'true');
      document.body.appendChild(existing);
    }
    this.overlay = existing;

    window.addEventListener('resize', () => {
      if (this._isAnimating) {
        this.finishImmediately();
      }
    });
  }

  get isAnimating(): boolean {
    return this._isAnimating;
  }

  get currentEpoch(): number {
    return this.epoch;
  }

  prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  hasWaapi(): boolean {
    return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.animate === 'function';
  }

  /**
   * Cancels all running animations and timers without invoking completion callbacks.
   * Used on restart / new round / mode switch.
   */
  cancel(): void {
    this.epoch++;
    this.pendingComplete = null;
    this.cleanupVisuals();
  }

  /**
   * Finishes any in-flight animation immediately to its final state (e.g. on window resize)
   * and invokes its completion callback once.
   */
  finishImmediately(): void {
    const done = this.pendingComplete;
    this.epoch++;
    this.pendingComplete = null;
    this.cleanupVisuals();
    if (done) done();
  }

  private cleanupVisuals(): void {
    for (const anim of this.activeAnims) {
      try {
        anim.cancel();
      } catch {
        // Ignore already finished animations
      }
    }
    this.activeAnims = [];

    for (const tid of this.activeTimers) {
      window.clearTimeout(tid);
    }
    this.activeTimers = [];

    for (const el of this.hiddenEls) {
      el.style.visibility = '';
    }
    this.hiddenEls = [];

    this.overlay.innerHTML = '';
    this._isAnimating = false;
  }

  private trackTimer(fn: () => void, ms: number, myEpoch: number): void {
    const tid = window.setTimeout(() => {
      if (myEpoch !== this.epoch) return;
      fn();
    }, ms);
    this.activeTimers.push(tid);
  }

  private pulseLanded(el: HTMLElement | null): void {
    if (!el || this.prefersReducedMotion()) return;
    el.classList.add('anim-card-landed');
    const myEpoch = this.epoch;
    this.trackTimer(() => {
      if (myEpoch === this.epoch) {
        el.classList.remove('anim-card-landed');
      }
    }, 340, myEpoch);
  }

  runFlight(spec: FlightSpec, onComplete: () => void): void {
    const myEpoch = this.epoch;
    const destRect = spec.destRect ?? spec.destEl?.getBoundingClientRect() ?? null;

    const completeOnce = () => {
      if (myEpoch !== this.epoch) return;
      this.pendingComplete = null;
      this.cleanupVisuals();
      if (spec.highlightOnLand) {
        this.pulseLanded(spec.destEl);
      }
      onComplete();
    };

    if (
      this.prefersReducedMotion() ||
      !this.hasWaapi() ||
      !spec.sourceRect ||
      !destRect ||
      spec.sourceRect.width === 0 ||
      destRect.width === 0
    ) {
      if (spec.destEl) {
        spec.destEl.style.visibility = '';
      }
      if (spec.highlightOnLand && spec.destEl) {
        spec.destEl.classList.add('anim-card-landed-instant');
        this.trackTimer(() => {
          spec.destEl?.classList.remove('anim-card-landed-instant');
        }, 260, myEpoch);
      }
      onComplete();
      return;
    }

    this._isAnimating = true;
    this.pendingComplete = completeOnce;

    if (spec.hideDestDuringFlight !== false && spec.destEl) {
      spec.destEl.style.visibility = 'hidden';
      this.hiddenEls.push(spec.destEl);
    }

    // Build proxy mover (position + scale + opacity) and inner flipper (rotateY)
    const mover = document.createElement('div');
    mover.className = 'anim-proxy-mover';
    const w = destRect.width;
    const h = destRect.height;
    mover.style.width = `${w}px`;
    mover.style.height = `${h}px`;

    const flipper = document.createElement('div');
    flipper.className = 'anim-proxy-flipper';

    const renderContent = (showBack: boolean): HTMLElement => {
      if (showBack || !spec.faceKey) {
        const back = renderCardBack('vertical', false);
        back.style.width = '100%';
        back.style.height = '100%';
        return back;
      }
      const card = renderClassicCard(spec.faceKey, { small: spec.smallCard });
      card.style.width = '100%';
      card.style.height = '100%';
      return card;
    };

    flipper.appendChild(renderContent(spec.startWithBack));
    mover.appendChild(flipper);
    this.overlay.appendChild(mover);

    const startCenterX = spec.sourceRect.left + spec.sourceRect.width / 2;
    const startCenterY = spec.sourceRect.top + spec.sourceRect.height / 2;
    const endCenterX = destRect.left + destRect.width / 2;
    const endCenterY = destRect.top + destRect.height / 2;

    const startX = startCenterX - w / 2;
    const startY = startCenterY - h / 2;
    const endX = endCenterX - w / 2;
    const endY = endCenterY - h / 2;

    const scaleX = Math.max(0.45, Math.min(1.4, spec.sourceRect.width / w));
    const scaleY = Math.max(0.45, Math.min(1.4, spec.sourceRect.height / h));

    const endScale = spec.fadeIntoDest ? 0.62 : 1;
    const endOpacity = spec.fadeIntoDest ? 0.15 : 1;

    const moveAnim = mover.animate(
      [
        {
          transform: `translate3d(${startX}px, ${startY}px, 0) scale(${scaleX}, ${scaleY})`,
          opacity: 0.96,
        },
        {
          transform: `translate3d(${endX}px, ${endY}px, 0) scale(${endScale}, ${endScale})`,
          opacity: endOpacity,
        },
      ],
      {
        duration: spec.flightMs,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      }
    );
    this.activeAnims.push(moveAnim);

    moveAnim.finished
      .then(() => {
        if (myEpoch !== this.epoch) return;
        if (!spec.flipOnArrive || !spec.faceKey) {
          if (spec.spinOnArrive && spec.faceKey) {
            const spinAnim = flipper.animate(
              [
                { transform: 'perspective(700px) rotateY(0deg) scale(1)' },
                { transform: 'perspective(700px) rotateY(180deg) scale(1.08)' },
                { transform: 'perspective(700px) rotateY(360deg) scale(1)' },
              ],
              { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
            );
            this.activeAnims.push(spinAnim);
            spinAnim.finished
              .then(() => {
                if (myEpoch === this.epoch) completeOnce();
              })
              .catch(() => {});
            return;
          }
          completeOnce();
          return;
        }

        const totalFlip = spec.flipMs ?? 120;
        const halfFlip = Math.max(40, Math.round(totalFlip / 2));

        const flipOut = flipper.animate(
          [
            { transform: 'perspective(700px) rotateY(0deg) scale(1)' },
            { transform: 'perspective(700px) rotateY(90deg) scale(1.06)' },
          ],
          { duration: halfFlip, easing: 'ease-in', fill: 'forwards' }
        );
        this.activeAnims.push(flipOut);

        flipOut.finished
          .then(() => {
            if (myEpoch !== this.epoch) return;
            flipper.innerHTML = '';
            flipper.appendChild(renderContent(false));
            const endDeg = spec.spinOnArrive ? '360deg' : '0deg';
            const flipIn = flipper.animate(
              [
                { transform: 'perspective(700px) rotateY(90deg) scale(1.06)' },
                { transform: `perspective(700px) rotateY(${endDeg}) scale(1)` },
              ],
              {
                duration: spec.spinOnArrive ? 240 : halfFlip,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'forwards',
              }
            );
            this.activeAnims.push(flipIn);
            return flipIn.finished;
          })
          .then(() => {
            if (myEpoch !== this.epoch) return;
            completeOnce();
          })
          .catch(() => {
            // Cancelled via epoch/resize
          });
      })
      .catch(() => {
        // Cancelled via epoch/resize
      });
  }

  /**
   * Brief non-blocking card dealing burst from stock to all 5 seats (total <= 680ms).
   */
  runRoundDeal(stockEl: HTMLElement | null, seatTargets: (HTMLElement | null)[]): void {
    if (this.prefersReducedMotion() || !this.hasWaapi() || !stockEl) return;
    const stockRect = stockEl.getBoundingClientRect();
    if (stockRect.width === 0) return;

    const myEpoch = this.epoch;
    const w = 44;
    const h = 102;
    const sx = stockRect.left + stockRect.width / 2 - w / 2;
    const sy = stockRect.top + stockRect.height / 2 - h / 2;

    seatTargets.forEach((target, idx) => {
      if (!target) return;
      const tRect = target.getBoundingClientRect();
      if (tRect.width === 0) return;
      const tx = tRect.left + tRect.width / 2 - w / 2;
      const ty = tRect.top + tRect.height / 2 - h / 2;
      const delay = idx * 75;

      for (let copy = 0; copy < 2; copy++) {
        const proxy = document.createElement('div');
        proxy.className = 'anim-proxy-mover';
        proxy.style.width = `${w}px`;
        proxy.style.height = `${h}px`;
        proxy.style.opacity = '0';
        const back = renderCardBack('vertical', false);
        back.style.width = '100%';
        back.style.height = '100%';
        proxy.appendChild(back);
        this.overlay.appendChild(proxy);

        const anim = proxy.animate(
          [
            {
              transform: `translate3d(${sx}px, ${sy}px, 0) scale(0.95)`,
              opacity: 0.95,
            },
            {
              transform: `translate3d(${tx + copy * 6}px, ${ty}px, 0) scale(0.7)`,
              opacity: 0.15,
            },
          ],
          {
            duration: 240,
            delay: delay + copy * 45,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          }
        );
        this.activeAnims.push(anim);
        anim.finished
          .then(() => {
            if (myEpoch === this.epoch) {
              proxy.remove();
            }
          })
          .catch(() => {
            proxy.remove();
          });
      }
    });
  }

  /**
   * Short delay (160ms) to highlight winning Ceki state before modal opens.
   */
  runCekiPause(onComplete: () => void): void {
    if (this.prefersReducedMotion()) {
      onComplete();
      return;
    }
    const myEpoch = this.epoch;
    this._isAnimating = true;
    this.pendingComplete = () => {
      if (myEpoch !== this.epoch) return;
      this.pendingComplete = null;
      this.cleanupVisuals();
      onComplete();
    };
    this.trackTimer(() => {
      this.pendingComplete?.();
    }, 160, myEpoch);
  }
}
