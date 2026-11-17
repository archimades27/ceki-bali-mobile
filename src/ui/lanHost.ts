import { decideBotDiscard, decideBotDraw } from '../game/bot.ts';
import {
  acceptPendingDrawnCard,
  cancelNgejuk,
  createInitialPlayers,
  declareCeki,
  discardCard,
  discardPendingDrawnCard,
  drawFromStock,
  getNgejukTarget,
  getRecommendedDiscardId,
  ngejukDiscard,
  reorderHumanHand,
  sortHumanHand,
  startNewRound,
} from '../game/engine.ts';
import { findWinningMelds } from '../game/melds.ts';
import type { CardInstance, GameState, Player } from '../game/types.ts';
import type { LobbySeatInfo, RoomStatePayload } from './lanClient.ts';

interface GuestInfo {
  clientId: string;
  seatIndex: number;
  name: string;
}

/**
 * Browser/WebView-side Authoritative Host Controller.
 * Connects to the local native LAN relay (macOS/Windows) as Host, runs the Ceki engine
 * and AI bots for empty seats, and broadcasts per-seat sanitized state to all guests.
 */
export class LanHostController {
  private ws: WebSocket | null = null;
  private guests = new Map<string, GuestInfo>(); // clientId -> GuestInfo
  private hostName = 'Host';
  private urls: string[] = [];
  private roundActive = false;
  private botTimer: number | null = null;
  private turnTimer: number | null = null;
  private turnDurationSec = 15;
  private turnDeadlineAt: number | null = null;
  private state: GameState;
  private onLocalRoomUpdate: (payload: RoomStatePayload) => void;
  private onStatusChange: (status: 'stopped' | 'starting' | 'running' | 'error', err?: string) => void;
  private customSender: ((clientId: string, payload: RoomStatePayload) => void) | null = null;

  public status: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
  public errorMessage: string | null = null;

  constructor(
    onLocalRoomUpdate: (payload: RoomStatePayload) => void,
    onStatusChange: (status: 'stopped' | 'starting' | 'running' | 'error', err?: string) => void
  ) {
    this.onLocalRoomUpdate = onLocalRoomUpdate;
    this.onStatusChange = onStatusChange;
    const initPlayers = this.buildPlayers(false);
    this.state = startNewRound(undefined, 'nyari', initPlayers);
  }

  get shareUrls(): string[] {
    return this.urls;
  }

  start(relayPort: number, hostName: string, urls: string[]): void {
    this.cleanupConnection();
    this.hostName = hostName.trim().slice(0, 16) || 'Host';
    this.urls = urls;
    this.status = 'starting';
    this.errorMessage = null;
    this.onStatusChange('starting');

    const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/ws?role=host`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.status = 'running';
      this.roundActive = false;
      this.guests.clear();
      this.state = startNewRound(undefined, 'nyari', this.buildPlayers(false));
      this.onStatusChange('running');
      this.broadcastRoom();
    });

    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(String(ev.data));
        this.handleRelayMessage(msg);
      } catch {
        // Ignore malformed relay frame
      }
    });

    ws.addEventListener('error', () => {
      if (this.ws !== ws) return;
      this.status = 'error';
      this.errorMessage = 'Gagal terhubung ke relay LAN lokal.';
      this.onStatusChange('error', this.errorMessage);
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.botTimer !== null) {
        window.clearTimeout(this.botTimer);
        this.botTimer = null;
      }
      this.status = 'stopped';
      this.roundActive = false;
      this.onStatusChange('stopped');
    });
  }

  startOnline(
    hostName: string,
    shareUrl: string,
    sender: (clientId: string, payload: RoomStatePayload) => void
  ): void {
    this.cleanupConnection();
    this.customSender = sender;
    this.hostName = hostName.trim().slice(0, 16) || 'Host';
    this.urls = [shareUrl];
    this.status = 'running';
    this.errorMessage = null;
    this.roundActive = false;
    this.guests.clear();
    this.state = startNewRound(undefined, 'nyari', this.buildPlayers(false));
    this.onStatusChange('running');
    this.broadcastRoom();
  }

  handleExternalRelayMessage(msg: {
    type?: string;
    clientId?: string;
    payload?: { type?: string; name?: string; cardId?: string; fromIndex?: number; toIndex?: number };
  }): void {
    this.handleRelayMessage(msg);
  }

  private cleanupConnection(): void {
    this.customSender = null;
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.turnTimer !== null) {
      window.clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnDeadlineAt = null;
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.close();
    }
    this.guests.clear();
    this.roundActive = false;
  }

  stop(): void {
    this.cleanupConnection();
    this.status = 'stopped';
    this.onStatusChange('stopped');
  }

  private makeUniqueName(desired: string, excludeSeat: number): string {
    const base = desired.trim().slice(0, 16) || `Pemain ${excludeSeat + 1}`;
    const taken = new Set<string>();
    this.state.players.forEach((p, idx) => {
      if (idx !== excludeSeat) {
        taken.add(p.name.trim().toLowerCase());
      }
    });
    if (!taken.has(base.toLowerCase())) return base;
    let suffix = 2;
    while (suffix < 99) {
      const candidate = `${base.slice(0, 13)} ${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
      suffix++;
    }
    return `${base.slice(0, 12)} #${excludeSeat + 1}`;
  }

  setHostName(name: string): void {
    this.hostName = this.makeUniqueName(name, 0);
    this.state = {
      ...this.state,
      players: this.state.players.map((p, idx) =>
        idx === 0 ? { ...p, name: this.hostName, avatarText: this.hostName.slice(0, 2).toUpperCase() } : p
      ),
    };
    this.broadcastRoom();
  }

  startRound(turnSeconds?: number): void {
    if (this.status !== 'running') return;
    if (typeof turnSeconds === 'number' && turnSeconds >= 0) {
      this.turnDurationSec = turnSeconds;
    }
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.turnTimer !== null) {
      window.clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    const players = this.buildPlayers(this.roundActive);
    this.state = startNewRound(this.roundActive ? this.state : undefined, 'nyari', players);
    this.roundActive = true;
    this.resetHumanTurnTimer(false);
    this.broadcastRoom({ type: 'start_round', actorIndex: this.state.currentPlayerIndex });
    this.scheduleBotIfNeeded();
  }

  handleLocalHostAction(action: { type: string; cardId?: string; fromIndex?: number; toIndex?: number }): void {
    if (this.status !== 'running') return;
    this.processPlayerAction(0, action);
  }

  private buildPlayers(keepScores: boolean): Player[] {
    const base = createInitialPlayers();
    const botNames = ['Putu (Bot)', 'Made (Bot)', 'Nyoman (Bot)', 'Ketut (Bot)', 'Wayan (Bot)'];
    return base.map((p, idx) => {
      const existingScore = keepScores ? (this.state.players[idx]?.score ?? 0) : 0;
      if (idx === 0) {
        return {
          ...p,
          name: this.hostName,
          avatarText: this.hostName.slice(0, 2).toUpperCase(),
          isHuman: true,
          score: existingScore,
        };
      }
      const guest = Array.from(this.guests.values()).find((g) => g.seatIndex === idx);
      if (guest) {
        return {
          ...p,
          name: guest.name,
          avatarText: guest.name.slice(0, 2).toUpperCase(),
          isHuman: true,
          score: existingScore,
        };
      }
      return {
        ...p,
        name: botNames[idx],
        avatarText: botNames[idx][0],
        isHuman: false,
        difficulty: idx === 3 ? 'strategic' : 'balanced',
        score: existingScore,
      };
    });
  }

  private buildLobbySeats(): LobbySeatInfo[] {
    return this.state.players.map((p, idx) => {
      if (idx === 0) {
        return { seatIndex: 0, name: this.hostName, isHuman: true, connected: true, score: p.score };
      }
      const guest = Array.from(this.guests.values()).find((g) => g.seatIndex === idx);
      return {
        seatIndex: idx,
        name: guest ? guest.name : p.name,
        isHuman: Boolean(guest),
        connected: Boolean(guest),
        score: p.score,
      };
    });
  }

  private sanitizeStateForSeat(viewerSeat: number): GameState {
    const hiddenCard = (idx: number, pIdx: number): CardInstance => ({
      id: `hidden_${pIdx}_${idx}`,
      key: 'tong1',
      suit: 'tong',
      rank: 1,
      familyId: 7,
    });

    return {
      ...this.state,
      history: this.state.history.slice(-30),
      stock: this.state.stock.map((_, i) => hiddenCard(i, 99)),
      pendingDrawnCard:
        this.state.currentPlayerIndex === viewerSeat ? this.state.pendingDrawnCard : null,
      players: this.state.players.map((p, idx) => {
        if (idx === viewerSeat || this.state.phase === 'round_over') {
          return p;
        }
        return {
          ...p,
          hand: p.hand.map((_, cIdx) => hiddenCard(cIdx, idx)),
        };
      }),
    };
  }

  private broadcastRoom(lastEvent?: { type: string; actorIndex: number }): void {
    const lobby = this.buildLobbySeats();
    const hostPayload: RoomStatePayload = {
      type: 'room_state',
      mySeat: 0,
      isHost: true,
      roundActive: this.roundActive,
      turnDurationSec: this.turnDurationSec,
      turnDeadlineAt: this.turnDeadlineAt,
      urls: this.urls,
      lobby,
      lastEvent: lastEvent ?? null,
      state: this.sanitizeStateForSeat(0),
    };
    this.onLocalRoomUpdate(hostPayload);

    if (this.customSender) {
      for (const guest of this.guests.values()) {
        const payload: RoomStatePayload = {
          type: 'room_state',
          mySeat: guest.seatIndex,
          isHost: false,
          roundActive: this.roundActive,
          turnDurationSec: this.turnDurationSec,
          turnDeadlineAt: this.turnDeadlineAt,
          urls: this.urls,
          lobby,
          lastEvent: lastEvent ?? null,
          state: this.sanitizeStateForSeat(guest.seatIndex),
        };
        this.customSender(guest.clientId, payload);
      }
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const guest of this.guests.values()) {
      const payload: RoomStatePayload = {
        type: 'room_state',
        mySeat: guest.seatIndex,
        isHost: false,
        roundActive: this.roundActive,
        turnDurationSec: this.turnDurationSec,
        turnDeadlineAt: this.turnDeadlineAt,
        urls: this.urls,
        lobby,
        lastEvent: lastEvent ?? null,
        state: this.sanitizeStateForSeat(guest.seatIndex),
      };
      this.ws.send(
        JSON.stringify({
          type: 'relay_to',
          targetClientId: guest.clientId,
          payload,
        })
      );
    }
  }

  private handleRelayMessage(msg: {
    type?: string;
    clientId?: string;
    payload?: { type?: string; name?: string; cardId?: string; fromIndex?: number; toIndex?: number };
  }): void {
    if (msg.type === 'guest_joined' && msg.clientId) {
      const taken = new Set(Array.from(this.guests.values()).map((g) => g.seatIndex));
      let seat = -1;
      for (let i = 1; i < 5; i++) {
        if (!taken.has(i)) {
          seat = i;
          break;
        }
      }
      if (seat === -1) return;
      const name = this.makeUniqueName(`Pemain ${seat + 1}`, seat);
      this.guests.set(msg.clientId, { clientId: msg.clientId, seatIndex: seat, name });
      this.state = {
        ...this.state,
        players: this.state.players.map((p, idx) =>
          idx === seat ? { ...p, isHuman: true, name, avatarText: `P${seat + 1}` } : p
        ),
      };
      this.broadcastRoom();
      return;
    }

    if (msg.type === 'guest_left' && msg.clientId) {
      const guest = this.guests.get(msg.clientId);
      if (!guest) return;
      this.guests.delete(msg.clientId);
      const botNames = ['Putu (Bot)', 'Made (Bot)', 'Nyoman (Bot)', 'Ketut (Bot)', 'Wayan (Bot)'];
      this.state = {
        ...this.state,
        players: this.state.players.map((p, idx) =>
          idx === guest.seatIndex
            ? {
                ...p,
                isHuman: false,
                name: botNames[idx],
                avatarText: botNames[idx][0],
                difficulty: 'balanced',
              }
            : p
        ),
      };
      if (
        this.roundActive &&
        this.state.currentPlayerIndex === guest.seatIndex &&
        this.state.phase !== 'round_over'
      ) {
        this.state = {
          ...this.state,
          phase: 'bot_thinking',
          botStep:
            this.state.pendingDrawnCard || this.state.players[guest.seatIndex].hand.length === 12
              ? 'discard'
              : 'draw',
        };
        if (this.state.pendingDrawnCard) {
          this.state = acceptPendingDrawnCard(this.state, false);
        }
        this.scheduleBotIfNeeded();
      }
      this.broadcastRoom();
      return;
    }

    if (msg.type === 'from_guest' && msg.clientId && msg.payload) {
      const guest = this.guests.get(msg.clientId);
      if (!guest) return;
      const p = msg.payload as {
        type?: string;
        name?: string;
        cardId?: string;
        fromIndex?: number;
        toIndex?: number;
        turnSeconds?: number;
      };
      if (p.type === 'start_round') {
        this.startRound(typeof p.turnSeconds === 'number' ? p.turnSeconds : undefined);
        return;
      }
      if (p.type === 'set_name' && typeof p.name === 'string') {
        const clean = this.makeUniqueName(p.name, guest.seatIndex);
        guest.name = clean;
        this.state = {
          ...this.state,
          players: this.state.players.map((pl, idx) =>
            idx === guest.seatIndex
              ? { ...pl, name: clean, avatarText: clean.slice(0, 2).toUpperCase() }
              : pl
          ),
        };
        this.broadcastRoom();
        return;
      }
      this.processPlayerAction(guest.seatIndex, p);
    }
  }

  private processPlayerAction(
    seatIdx: number,
    action: { type?: string; cardId?: string; fromIndex?: number; toIndex?: number }
  ): void {
    if (!this.roundActive) return;

    if (
      action.type === 'reorder_hand' &&
      typeof action.fromIndex === 'number' &&
      typeof action.toIndex === 'number'
    ) {
      this.state = reorderHumanHand(this.state, action.fromIndex, action.toIndex, seatIdx);
      this.broadcastRoom();
      return;
    }

    if (action.type === 'sort_hand') {
      this.state = sortHumanHand(this.state, seatIdx);
      this.broadcastRoom();
      return;
    }

    if (this.state.currentPlayerIndex !== seatIdx) return;

    const prev = this.state;
    let eventType = '';
    switch (action.type) {
      case 'draw_stock':
        this.state = drawFromStock(prev);
        eventType = 'draw_stock';
        break;
      case 'ngejuk':
        this.state = ngejukDiscard(prev);
        eventType = 'ngejuk';
        break;
      case 'cancel_ngejuk':
        this.state = cancelNgejuk(prev);
        eventType = 'cancel_ngejuk';
        break;
      case 'accept_pending':
        this.state = acceptPendingDrawnCard(prev, false);
        eventType = 'accept_pending';
        break;
      case 'discard_pending':
        this.state = discardPendingDrawnCard(prev);
        eventType = 'discard_pending';
        break;
      case 'discard_hand':
        if (typeof action.cardId === 'string') {
          this.state = discardCard(prev, action.cardId, true);
          eventType = 'discard_hand';
        }
        break;
      case 'declare_ceki':
        this.state = declareCeki(prev, seatIdx);
        eventType = 'declare_ceki';
        break;
    }

    if (this.state !== prev) {
      this.resetHumanTurnTimer(false);
      this.broadcastRoom({ type: eventType, actorIndex: seatIdx });
      this.scheduleBotIfNeeded();
    }
  }

  private resetHumanTurnTimer(broadcastOnTimeout = true): void {
    if (this.turnTimer !== null) {
      window.clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnDeadlineAt = null;
    if (!this.roundActive || this.state.phase === 'round_over' || this.turnDurationSec <= 0) {
      return;
    }
    const current = this.state.players[this.state.currentPlayerIndex];
    if (!current || !current.isHuman) {
      return;
    }
    this.turnDeadlineAt = Date.now() + this.turnDurationSec * 1000;
    const expectedPlayer = this.state.currentPlayerIndex;
    const expectedPhase = this.state.phase;
    const expectedPending = this.state.pendingDrawnCard?.id ?? null;

    this.turnTimer = window.setTimeout(() => {
      if (!this.roundActive || this.state.phase === 'round_over') return;
      if (this.state.currentPlayerIndex !== expectedPlayer || this.state.phase !== expectedPhase) return;
      if ((this.state.pendingDrawnCard?.id ?? null) !== expectedPending) return;

      let eventType = 'discard_hand';
      if (this.state.phase === 'awaiting_draw') {
        this.state = drawFromStock(this.state);
        eventType = 'draw_stock';
        if (this.state.phase === 'awaiting_discard' && this.state.pendingDrawnCard) {
          this.state = discardPendingDrawnCard(this.state);
          eventType = 'discard_pending';
        }
      } else if (this.state.phase === 'awaiting_discard') {
        if (this.state.pendingDrawnCard) {
          this.state = discardPendingDrawnCard(this.state);
          eventType = 'discard_pending';
        } else {
          const p = this.state.players[expectedPlayer];
          const recId = getRecommendedDiscardId(p.hand, this.state.playStyle) ?? p.hand[0]?.id;
          if (recId) {
            this.state = discardCard(this.state, recId, true);
            eventType = 'discard_hand';
          }
        }
      }

      this.resetHumanTurnTimer(false);
      if (broadcastOnTimeout || true) {
        this.broadcastRoom({ type: eventType, actorIndex: expectedPlayer });
        this.scheduleBotIfNeeded();
      }
    }, this.turnDurationSec * 1000);
  }

  private scheduleBotIfNeeded(): void {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (!this.roundActive || this.state.phase === 'round_over') return;
    const current = this.state.players[this.state.currentPlayerIndex];
    if (!current || current.isHuman || this.state.phase !== 'bot_thinking') return;

    if (this.state.botStep === 'draw') {
      const drawDelay = 1000 + Math.floor(Math.random() * 550);
      this.botTimer = window.setTimeout(() => {
        const bot = this.state.players[this.state.currentPlayerIndex];
        if (!bot || bot.isHuman || this.state.botStep !== 'draw') return;
        const target = getNgejukTarget(this.state);
        const choice = decideBotDraw(bot, target?.card, this.state.playStyle);
        const actionType = choice === 'ngejuk' && target ? 'ngejuk' : 'draw_stock';
        this.state =
          actionType === 'ngejuk' ? ngejukDiscard(this.state) : drawFromStock(this.state);
        this.broadcastRoom({ type: actionType, actorIndex: bot.id });
        this.scheduleBotIfNeeded();
      }, drawDelay);
    } else if (this.state.botStep === 'discard') {
      const discardDelay = 1150 + Math.floor(Math.random() * 650);
      this.botTimer = window.setTimeout(() => {
        const bot = this.state.players[this.state.currentPlayerIndex];
        if (!bot || bot.isHuman || this.state.botStep !== 'discard') return;
        if (this.state.lastDrawSource !== 'ngejuk' && findWinningMelds(bot.hand, this.state.playStyle) !== null) {
          this.state = declareCeki(this.state, this.state.currentPlayerIndex);
          this.resetHumanTurnTimer(false);
          this.broadcastRoom({ type: 'declare_ceki', actorIndex: bot.id });
          return;
        }
        const card = decideBotDiscard(bot, this.state);
        this.state = discardCard(this.state, card.id);
        this.resetHumanTurnTimer(false);
        this.broadcastRoom({ type: 'discard_hand', actorIndex: bot.id });
        this.scheduleBotIfNeeded();
      }, discardDelay);
    }
  }
}
