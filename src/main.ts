import './style.css';
import { decideBotDiscard, decideBotDraw } from './game/bot.ts';
import { CARD_DEFS } from './game/deck.ts';
import {
  acceptPendingDrawnCard,
  canDiscardCard,
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
} from './game/engine.ts';
import {
  analyzeLeftoverHints,
  detectContiguousMelds,
  findBestPartialMelds,
  findWinningMelds,
  getReadyStatus,
} from './game/melds.ts';
import type { BotDifficulty, CardInstance, GameState, MeldType, PlayStyle } from './game/types.ts';
import { sfx } from './ui/audio.ts';
import { preloadCardAssets, renderClassicCard } from './ui/cardRenderer.ts';
import { HistoryModal } from './ui/history.ts';
import { LanClient, type RoomStatePayload } from './ui/lanClient.ts';
import { LanHostController } from './ui/lanHost.ts';
import { createObsidianDialog } from './ui/modals.ts';
import { extractRoomCode, OnlineGuestClient, OnlineHostPeer } from './ui/onlinePeer.ts';
import { TutorialModal } from './ui/tutorial.ts';

type AppMode = 'startup' | 'offline' | 'online_host' | 'online_guest' | 'lan_host' | 'lan_guest';

type GameAction =
  | { type: 'draw_stock' }
  | { type: 'ngejuk' }
  | { type: 'cancel_ngejuk' }
  | { type: 'accept_pending' }
  | { type: 'discard_pending' }
  | { type: 'discard'; cardId: string }
  | { type: 'reorder'; fromIndex: number; toIndex: number }
  | { type: 'sort_hand' }
  | { type: 'declare_ceki' }
  | { type: 'new_round' };

class CekiPortraitApp {
  private root: HTMLElement;
  private mode: AppMode = 'startup';
  private playerName = localStorage.getItem('ceki_player_name') || 'Pemain';
  private botDifficulty: BotDifficulty = 'balanced';
  private playStyle: PlayStyle = 'nyari';
  private showReadyCards = localStorage.getItem('ceki_show_ready_cards') !== 'false';
  private nyagaMustNgupak = localStorage.getItem('ceki_nyaga_must_ngupak') !== 'false';

  private state: GameState | null = null;
  private mySeat = 0;
  private selectedCardId: string | null = null;
  private botTimer: number | null = null;
  private roundOverShownForRound = 0;

  // Multiplayer controllers
  private lanHost: LanHostController | null = null;
  private lanClient: LanClient | null = null;
  private onlineHost: OnlineHostPeer | null = null;
  private onlineGuest: OnlineGuestClient | null = null;
  private roomPayload: RoomStatePayload | null = null;
  private pingMs: number | null = null;
  private packetLossPct = 0;

  // Modals
  private historyModal = new HistoryModal();
  private tutorialModal = new TutorialModal();

  // Drag state
  private dragFromIndex: number | null = null;
  private dragHoverIndex: number | null = null;

  // Meld formation animation tracking
  private prevMeldSignatures = new Set<string>();
  private lastAnimatedHandKey = '';
  private lastFlippedPendingId: string | null = null;

  // Nyari notification tracking
  private prevReadyModes = new Map<number, 'mecari' | 'mejaga' | null>();
  private activeNyariToast: { text: string; tone: 'self' | 'opponent' } | null = null;
  private nyariToastTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    preloadCardAssets();
    this.render();

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const demoParam = params.get('demo');
    if (demoParam === 'nyari' || demoParam === 'all-jaga') {
      this.startDemoNyariPreview(demoParam === 'all-jaga');
    } else if (roomParam) {
      this.openOnlineModal(extractRoomCode(roomParam));
    }
  }

  private getModeLabel(): string {
    switch (this.mode) {
      case 'offline':
        return 'Offline';
      case 'online_host':
      case 'online_guest':
        return 'Online';
      case 'lan_host':
      case 'lan_guest':
        return 'LAN';
      default:
        return 'Ceki';
    }
  }

  private isMultiplayer(): boolean {
    return this.mode !== 'offline' && this.mode !== 'startup';
  }

  private clearBotTimer(): void {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  private startDemoNyariPreview(allJaga = false): void {
    this.cleanupNetwork();
    this.mode = 'offline';
    this.mySeat = 0;
    const mk = (key: keyof typeof CARD_DEFS, n: number): CardInstance => ({
      id: `demo_${key}_${n}_${Math.random().toString(36).slice(2, 6)}`,
      key,
      suit: CARD_DEFS[key].suit,
      rank: CARD_DEFS[key].rank,
      familyId: CARD_DEFS[key].familyId,
    });
    const players = createInitialPlayers();
    players[0].name = 'Anda';
    players[0].hand = [
      mk('tong1', 1), mk('tong1', 2), mk('tong1', 3),
      mk('tong2', 1), mk('sok2', 1), mk('ban2', 1),
      mk('tong3', 1), mk('sok3', 1), mk('ban3', 1),
      mk('old_thousand', 1), mk('old_thousand', 2),
    ];
    players[0].discards = [mk('tong5', 1), mk('sok6', 1)];
    players[0].readyMode = allJaga ? 'mejaga' : 'mecari';
    players[0].readyCards = [mk('old_thousand', 1), mk('old_thousand', 2)];

    players[1].discards = [mk('ban4', 1), mk('tong7', 2)];
    if (allJaga) {
      players[1].readyMode = 'mejaga';
      players[1].readyCards = [mk('tong4', 1), mk('tong4', 2)];
      players[1].openMelds = [{ type: 'lawang', cards: [mk('sok5', 1), mk('sok5', 2), mk('ban5', 1)] }];
    }

    players[2].discards = [mk('sok8', 1)];
    players[2].readyMode = 'mejaga';
    players[2].readyCards = [mk('white_flower', 1), mk('white_flower', 2)];
    players[2].openMelds = [{ type: 'soca', cards: [mk('ban1', 1), mk('ban1', 2), mk('ban1', 3)] }];

    players[3].discards = [mk('tong9', 1), mk('sok4', 2)];
    players[3].readyMode = allJaga ? 'mejaga' : 'mecari';
    players[3].readyCards = [mk('red_flower', 1), mk('red_flower', 2)];
    if (allJaga) {
      players[3].openMelds = [{ type: 'serigat', cards: [mk('tong6', 1), mk('sok6', 2), mk('ban6', 1)] }];
    }

    players[4].discards = [mk('old_thousand', 3)];
    if (allJaga) {
      players[4].readyMode = 'mejaga';
      players[4].readyCards = [mk('ban7', 1), mk('ban7', 2)];
      players[4].openMelds = [{ type: 'soca', cards: [mk('tong8', 1), mk('tong8', 2), mk('tong8', 3)] }];
    }

    this.state = {
      round: 1,
      playStyle: 'nyari',
      showReadyCards: true,
      players,
      currentPlayerIndex: 0,
      phase: 'awaiting_draw',
      botStep: null,
      stock: [mk('tong4', 1), mk('sok5', 1), mk('ban6', 1)],
      lastDiscardPlayerIndex: 4,
      lastDrawnCardId: null,
      pendingDrawnCard: null,
      winnerId: null,
      winningMelds: null,
      winReason: null,
      lastActionLog: allJaga ? 'Simulasi Semua Jaga' : 'Simulasi Mecari & Nyaga',
      history: [],
    };
    this.render();
  }

  private startOfflineGame(): void {
    this.cleanupNetwork();
    this.mode = 'offline';
    this.mySeat = 0;
    this.selectedCardId = null;
    this.roundOverShownForRound = 0;
    const players = createInitialPlayers().map((p) =>
      p.isHuman ? p : { ...p, difficulty: this.botDifficulty }
    );
    players[0].name = this.playerName.trim() || 'Anda';
    players[0].avatarText = players[0].name.slice(0, 2).toUpperCase();
    this.state = {
      ...startNewRound(undefined, this.playStyle, players),
      showReadyCards: this.showReadyCards,
      nyagaMustNgupak: this.nyagaMustNgupak,
    };
    sfx.playMeldFormed();
    this.render();
    this.scheduleOfflineBotIfNeeded();
  }

  private cleanupNetwork(): void {
    this.clearBotTimer();
    this.onlineHost?.stop();
    this.onlineHost = null;
    this.onlineGuest?.disconnect();
    this.onlineGuest = null;
    this.lanHost?.stop();
    this.lanHost = null;
    this.lanClient?.disconnect();
    this.lanClient = null;
    this.roomPayload = null;
    this.pingMs = null;
    this.packetLossPct = 0;
  }

  private dispatchAction(action: GameAction): void {
    if (!this.state) return;

    if (this.mode === 'online_host' || this.mode === 'lan_host') {
      if (!this.lanHost) return;
      if (action.type === 'new_round') {
        this.lanHost.startRound();
        return;
      }
      this.lanHost.handleLocalHostAction(this.mapActionForHost(action));
      return;
    }

    if (this.mode === 'online_guest') {
      if (!this.onlineGuest) return;
      if (action.type === 'new_round') {
        this.onlineGuest.send({ type: 'start_round' });
        return;
      }
      this.onlineGuest.send(this.mapActionForHost(action));
      return;
    }

    if (this.mode === 'lan_guest') {
      if (!this.lanClient) return;
      if (action.type === 'new_round') {
        this.lanClient.send({ type: 'start_round' });
        return;
      }
      this.lanClient.send(this.mapActionForHost(action));
      return;
    }

    // Offline single-player reducer
    this.state = this.applyOfflineAction(this.state, action);
    this.render();
    this.scheduleOfflineBotIfNeeded();
  }

  private mapActionForHost(action: GameAction): {
    type: string;
    cardId?: string;
    fromIndex?: number;
    toIndex?: number;
  } {
    switch (action.type) {
      case 'draw_stock':
        return { type: 'draw_stock' };
      case 'ngejuk':
        return { type: 'ngejuk' };
      case 'cancel_ngejuk':
        return { type: 'cancel_ngejuk' };
      case 'accept_pending':
        return { type: 'accept_pending' };
      case 'discard_pending':
        return { type: 'discard_pending' };
      case 'discard':
        return { type: 'discard', cardId: action.cardId };
      case 'reorder':
        return { type: 'reorder', fromIndex: action.fromIndex, toIndex: action.toIndex };
      case 'sort_hand':
        return { type: 'sort_hand' };
      case 'declare_ceki':
        return { type: 'declare_ceki' };
      case 'new_round':
        return { type: 'start_round' };
    }
  }

  private applyOfflineAction(prev: GameState, action: GameAction): GameState {
    switch (action.type) {
      case 'draw_stock':
        sfx.playDraw();
        return drawFromStock(prev);
      case 'ngejuk':
        sfx.playNgejuk();
        return ngejukDiscard(prev);
      case 'cancel_ngejuk':
        return cancelNgejuk(prev);
      case 'accept_pending':
        return acceptPendingDrawnCard(prev, false);
      case 'discard_pending':
        sfx.playDiscard();
        return discardPendingDrawnCard(prev);
      case 'discard':
        this.selectedCardId = null;
        sfx.playDiscard();
        return discardCard(prev, action.cardId, true);
      case 'reorder':
        return reorderHumanHand(prev, action.fromIndex, action.toIndex, 0);
      case 'sort_hand':
        return sortHumanHand(prev, 0);
      case 'declare_ceki': {
        const next = declareCeki(prev, this.mySeat);
        if (next.phase === 'round_over') sfx.playCekiWin();
        return next;
      }
      case 'new_round':
        this.selectedCardId = null;
        this.roundOverShownForRound = 0;
        sfx.playMeldFormed();
        return startNewRound(prev, this.playStyle);
    }
  }

  private scheduleOfflineBotIfNeeded(): void {
    this.clearBotTimer();
    if (this.mode !== 'offline' || !this.state) return;
    if (this.state.phase === 'round_over') return;

    const current = this.state.players[this.state.currentPlayerIndex];
    if (!current || current.isHuman) return;

    const isDrawStep = this.state.phase === 'bot_thinking' && this.state.botStep === 'draw';
    const delayMs = isDrawStep
      ? 1050 + Math.floor(Math.random() * 650)
      : 1200 + Math.floor(Math.random() * 800);

    this.botTimer = window.setTimeout(() => {
      if (!this.state || this.state.phase === 'round_over') return;
      const bot = this.state.players[this.state.currentPlayerIndex];
      if (!bot || bot.isHuman) return;

      if (this.state.phase === 'bot_thinking' && this.state.botStep === 'draw') {
        const ngejukTarget = getNgejukTarget(this.state);
        const choice = decideBotDraw(
          bot,
          ngejukTarget?.card,
          this.state.playStyle,
          this.state.nyagaMustNgupak !== false
        );
        this.state = choice === 'ngejuk' && ngejukTarget ? ngejukDiscard(this.state) : drawFromStock(this.state);
        this.render();
        this.scheduleOfflineBotIfNeeded();
        return;
      }

      if (this.state.phase === 'bot_thinking' && this.state.botStep === 'discard') {
        const afterCeki = declareCeki(this.state, this.state.currentPlayerIndex);
        if (afterCeki.phase === 'round_over') {
          this.state = afterCeki;
          sfx.playCekiWin();
          this.render();
          return;
        }
        const card = decideBotDiscard(bot, this.state);
        this.state = discardCard(this.state, card.id, false);
        this.render();
        this.scheduleOfflineBotIfNeeded();
      }
    }, delayMs);
  }

  /* ========================
     MULTIPLAYER MODALS
     ======================== */
  private openOnlineModal(prefillCode = ''): void {
    const { dialog, body } = createObsidianDialog('online-modal', 'Main Online (Supabase)', 'any');

    const renderBody = () => {
      body.innerHTML = '';
      if (this.mode === 'online_host' && this.onlineHost && this.roomPayload) {
        const codeBox = document.createElement('div');
        codeBox.className = 'room-code-box';
        codeBox.textContent = this.onlineHost.roomCode;

        const info = document.createElement('p');
        info.textContent = `Bagikan kode room ini ke teman (Singapore Relay). Siapa saja di room bisa memulai babak.`;

        const seatList = document.createElement('div');
        seatList.className = 'room-seat-list';
        for (const seat of this.roomPayload.lobby) {
          const row = document.createElement('div');
          row.className = 'room-seat-item';
          row.innerHTML = `<span>Kursi ${seat.seatIndex + 1}: <strong>${seat.name}</strong></span><span>${!seat.isHuman ? '🤖 Bot' : '🟢 Online'}</span>`;
          seatList.appendChild(row);
        }

        const btnRow = document.createElement('div');
        btnRow.className = 'modal-btn-row';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'modal-btn';
        copyBtn.textContent = 'Salin Link Invite';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard?.writeText(this.onlineHost!.inviteUrl);
          copyBtn.textContent = '✓ Tersalin!';
        });

        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'modal-btn modal-btn--primary';
        startBtn.textContent = 'Mulai Babak';
        startBtn.addEventListener('click', () => {
          this.lanHost?.startRound();
          dialog.close();
        });

        btnRow.append(copyBtn, startBtn);
        body.append(codeBox, info, seatList, btnRow);
        return;
      }

      if (this.mode === 'online_guest' && this.roomPayload) {
        const info = document.createElement('p');
        info.textContent = `Terhubung ke Room ${this.onlineGuest?.roomCode ?? ''}. Anda di Kursi ${this.mySeat + 1}.`;

        const seatList = document.createElement('div');
        seatList.className = 'room-seat-list';
        for (const seat of this.roomPayload.lobby) {
          const row = document.createElement('div');
          row.className = 'room-seat-item';
          row.innerHTML = `<span>Kursi ${seat.seatIndex + 1}: <strong>${seat.name}</strong></span><span>${!seat.isHuman ? '🤖 Bot' : '🟢 Online'}</span>`;
          seatList.appendChild(row);
        }

        const startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'modal-btn modal-btn--primary';
        startBtn.textContent = 'Mulai Babak Sekarang';
        startBtn.addEventListener('click', () => {
          this.onlineGuest?.send({ type: 'start_round' });
          dialog.close();
        });

        body.append(info, seatList, startBtn);
        return;
      }

      // Create or Join form
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.className = 'modal-btn modal-btn--primary';
      createBtn.textContent = 'Buat Room Online Baru';
      createBtn.addEventListener('click', () => {
        this.cleanupNetwork();
        this.mode = 'online_host';
        this.mySeat = 0;
        this.lanHost = new LanHostController(
          (payload) => this.handleRoomPayload(payload),
          () => {}
        );
        this.onlineHost = new OnlineHostPeer(() => {
          if (dialog.open) renderBody();
        });
        this.onlineHost.start(this.playerName, this.lanHost);
        renderBody();
      });

      const divider = document.createElement('p');
      divider.style.textAlign = 'center';
      divider.style.margin = '4px 0';
      divider.textContent = '— atau gabung ke room teman —';

      const codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.placeholder = 'Masukkan Kode Room (misal: ABCDE)';
      codeInput.value = prefillCode;
      codeInput.style.cssText = 'padding:10px;background:#0d0604;border:1px solid #7a5819;color:#faf1dc;border-radius:6px;text-transform:uppercase;';

      const joinBtn = document.createElement('button');
      joinBtn.type = 'button';
      joinBtn.className = 'modal-btn';
      joinBtn.textContent = 'Gabung Room';
      joinBtn.addEventListener('click', () => {
        const code = extractRoomCode(codeInput.value);
        if (!code) return;
        this.cleanupNetwork();
        this.mode = 'online_guest';
        this.onlineGuest = new OnlineGuestClient(
          (payload) => {
            this.handleRoomPayload(payload);
            if (dialog.open && payload.roundActive) dialog.close();
            else if (dialog.open) renderBody();
          },
          () => {},
          () => {
            this.pingMs = this.onlineGuest?.pingMs ?? null;
            this.packetLossPct = this.onlineGuest?.packetLossPct ?? 0;
            this.render();
          }
        );
        this.onlineGuest.connect(code, this.playerName);
        joinBtn.disabled = true;
        joinBtn.textContent = 'Menghubungkan...';
      });

      body.append(createBtn, divider, codeInput, joinBtn);
    };

    renderBody();
    dialog.showModal();
  }

  private openLanModal(): void {
    const { dialog, body } = createObsidianDialog('lan-modal', 'Main LAN (Wi-Fi Lokal)', 'any');

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'ws://192.168.1.10:8765';
    urlInput.value = `ws://${window.location.hostname || 'localhost'}:8765`;
    urlInput.style.cssText = 'padding:10px;background:#0d0604;border:1px solid #7a5819;color:#faf1dc;border-radius:6px;';

    const info = document.createElement('p');
    info.textContent = 'Masukkan alamat WebSocket Host LAN di jaringan Wi-Fi yang sama.';

    const btnRow = document.createElement('div');
    btnRow.className = 'modal-btn-row';

    const hostBtn = document.createElement('button');
    hostBtn.type = 'button';
    hostBtn.className = 'modal-btn';
    hostBtn.textContent = 'Jadi Host LAN';
    hostBtn.addEventListener('click', () => {
      this.cleanupNetwork();
      this.mode = 'lan_host';
      this.mySeat = 0;
      this.lanHost = new LanHostController(
        (payload) => this.handleRoomPayload(payload),
        () => {}
      );
      this.lanHost.start(8765, this.playerName, [urlInput.value.trim()]);
      this.lanHost.startRound();
      dialog.close();
    });

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'modal-btn modal-btn--primary';
    joinBtn.textContent = 'Gabung LAN';
    joinBtn.addEventListener('click', () => {
      this.cleanupNetwork();
      this.mode = 'lan_guest';
      this.lanClient = new LanClient(
        (payload) => {
          this.handleRoomPayload(payload);
          if (dialog.open && payload.roundActive) dialog.close();
        },
        () => {}
      );
      this.lanClient.connect(urlInput.value.trim(), this.playerName);
    });

    btnRow.append(hostBtn, joinBtn);
    body.append(info, urlInput, btnRow);
    dialog.showModal();
  }

  private handleRoomPayload(payload: RoomStatePayload): void {
    this.roomPayload = payload;
    this.mySeat = payload.mySeat;
    this.state = payload.state;
    this.render();
  }

  private openMenuModal(): void {
    const { dialog, body } = createObsidianDialog('menu-modal', 'Menu Permainan', 'any');

    const row1 = document.createElement('div');
    row1.className = 'modal-btn-row';

    const newRoundBtn = document.createElement('button');
    newRoundBtn.type = 'button';
    newRoundBtn.className = 'modal-btn modal-btn--primary';
    newRoundBtn.textContent = 'Mulai Babak Baru';
    newRoundBtn.addEventListener('click', () => {
      dialog.close();
      this.dispatchAction({ type: 'new_round' });
    });

    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = 'modal-btn';
    exitBtn.textContent = 'Kembali ke Layar Awal';
    exitBtn.addEventListener('click', () => {
      dialog.close();
      this.cleanupNetwork();
      this.mode = 'startup';
      this.state = null;
      this.render();
    });

    row1.append(newRoundBtn, exitBtn);
    body.append(row1);
    dialog.showModal();
  }

  private openDiscardInspectModal(playerName: string, discards: CardInstance[]): void {
    const { dialog, body } = createObsidianDialog(
      'discard-inspect-modal',
      `Buangan ${playerName} (${discards.length})`,
      'any'
    );

    if (discards.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Belum ada kartu buangan.';
      body.appendChild(p);
    } else {
      const grid = document.createElement('div');
      grid.className = 'discard-inspect-grid';
      for (const card of [...discards].reverse()) {
        const item = document.createElement('div');
        item.className = 'discard-inspect-item';
        const el = renderClassicCard(card.key, { small: true });
        el.classList.add('ceki-card--medium');
        const label = document.createElement('span');
        label.textContent = CARD_DEFS[card.key].balineseName;
        item.append(el, label);
        grid.appendChild(item);
      }
      body.appendChild(grid);
    }

    dialog.showModal();
  }

  private openRoundOverModal(state: GameState): void {
    if (this.roundOverShownForRound === state.round) return;
    this.roundOverShownForRound = state.round;

    const winner = state.players.find((p) => p.id === state.winnerId);
    const kindLabel =
      state.winKind === 'ngandang'
        ? 'NGANDANG!'
        : state.winKind === 'kupak'
          ? 'KUPAK NYARI!'
          : 'CEKI!';

    const title = winner ? `${winner.name} Menang — ${kindLabel}` : 'Babak Selesai (Tumpukan Habis)';
    const { dialog, body } = createObsidianDialog('round-over-modal', title, 'any');

    const reason = document.createElement('p');
    reason.textContent = state.winReason ?? state.lastActionLog;
    body.appendChild(reason);

    if (state.winningMelds && state.winningMelds.length > 0) {
      const meldsGrid = document.createElement('div');
      meldsGrid.className = 'win-melds-grid';
      for (const meld of state.winningMelds) {
        const row = document.createElement('div');
        row.className = 'win-meld-row';
        const typeEl = document.createElement('strong');
        typeEl.textContent = meld.type.toUpperCase();
        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'win-meld-cards';
        for (const c of meld.cards) {
          const cardEl = renderClassicCard(c.key, { small: true });
          cardEl.classList.add('ceki-card--medium');
          cardsWrap.appendChild(cardEl);
        }
        row.append(typeEl, cardsWrap);
        meldsGrid.appendChild(row);
      }
      body.appendChild(meldsGrid);
    }

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal-btn modal-btn--primary';
    nextBtn.textContent = 'Mulai Babak Berikutnya';
    nextBtn.addEventListener('click', () => {
      dialog.close();
      this.dispatchAction({ type: 'new_round' });
    });

    body.appendChild(nextBtn);
    dialog.showModal();
  }

  /* ========================
     RENDERING
     ======================== */
  private render(): void {
    this.root.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'portrait-shell';

    if (this.mode === 'startup' || !this.state) {
      shell.appendChild(this.renderStartupScreen());
      this.root.appendChild(shell);
      return;
    }

    const state = this.state;
    this.detectNyariTransitions(state);

    shell.appendChild(this.renderTopHud(state));
    if (this.activeNyariToast) {
      const toastEl = document.createElement('div');
      toastEl.className = `nyari-alert-toast is-${this.activeNyariToast.tone}`;
      toastEl.textContent = this.activeNyariToast.text;
      shell.appendChild(toastEl);
    }
    shell.appendChild(this.renderTableZone(state));
    shell.appendChild(this.renderHandZone(state));
    shell.appendChild(this.renderThumbBar(state));

    this.root.appendChild(shell);

    if (state.phase === 'round_over') {
      this.openRoundOverModal(state);
    }
  }

  private detectNyariTransitions(state: GameState): void {
    if (state.phase === 'round_over') {
      this.prevReadyModes.clear();
      return;
    }
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const mode = p.readyMode ?? null;
      const prev = this.prevReadyModes.get(i) ?? null;
      if (mode && mode !== prev) {
        const isSelf = i === this.mySeat;
        const modeLabel = mode === 'mejaga' ? 'MEJAGA 🔥' : 'MECARI 🔍';
        const text = isSelf
          ? `ANDA SIAP ${modeLabel} — Tinggal 1 kartu menang!`
          : `⚠️ ${p.name} MULAI ${modeLabel}!`;
        this.activeNyariToast = { text, tone: isSelf ? 'self' : 'opponent' };
        if (this.nyariToastTimer !== null) {
          window.clearTimeout(this.nyariToastTimer);
        }
        this.nyariToastTimer = window.setTimeout(() => {
          this.activeNyariToast = null;
          const el = document.querySelector('.nyari-alert-toast');
          el?.remove();
        }, 2800);
      }
      this.prevReadyModes.set(i, mode);
    }
  }

  private renderStartupScreen(): HTMLElement {
    const screen = document.createElement('main');
    screen.className = 'startup-screen';

    const card = document.createElement('section');
    card.className = 'startup-card';
    card.innerHTML = `
      <div class="startup-emblem">✦ Edisi Portrait 9:16 ✦</div>
      <h1 class="startup-title">CEKI BALI</h1>
      <p class="startup-subtitle">Permainan kartu tradisional Bali 5 pemain, nyaman satu tangan.</p>
    `;

    const nameField = document.createElement('div');
    nameField.className = 'startup-field';
    nameField.innerHTML = `<label for="player-name-input">Nama Pemain</label>`;
    const nameInput = document.createElement('input');
    nameInput.id = 'player-name-input';
    nameInput.type = 'text';
    nameInput.maxLength = 14;
    nameInput.value = this.playerName;
    nameInput.addEventListener('input', () => {
      this.playerName = nameInput.value;
      localStorage.setItem('ceki_player_name', this.playerName);
    });
    nameField.appendChild(nameInput);

    const diffField = document.createElement('div');
    diffField.className = 'startup-field';
    diffField.innerHTML = `<label for="bot-diff-select">Level Bot</label>`;
    const diffSelect = document.createElement('select');
    diffSelect.id = 'bot-diff-select';
    diffSelect.innerHTML = `
      <option value="casual">Santai</option>
      <option value="balanced">Seimbang</option>
      <option value="strategic">Strategis</option>
    `;
    diffSelect.value = this.botDifficulty;
    diffSelect.addEventListener('change', () => {
      this.botDifficulty = diffSelect.value as BotDifficulty;
    });
    diffField.appendChild(diffSelect);

    const topFieldsRow = document.createElement('div');
    topFieldsRow.className = 'startup-row-2';
    topFieldsRow.append(nameField, diffField);

    const optGrid = document.createElement('div');
    optGrid.className = 'startup-opt-grid';

    const readyOptBtn = document.createElement('button');
    readyOptBtn.type = 'button';
    readyOptBtn.className = `startup-opt-card ${this.showReadyCards ? 'is-active' : ''}`;
    readyOptBtn.innerHTML = `<span class="startup-opt-label">KARTU TUNGGU (CARI/NYAGA)</span><strong class="startup-opt-val">${this.showReadyCards ? 'Terbuka (Dilihat Semua)' : 'Tertutup (Rahasia)'}</strong>`;
    readyOptBtn.addEventListener('click', () => {
      this.showReadyCards = !this.showReadyCards;
      localStorage.setItem('ceki_show_ready_cards', String(this.showReadyCards));
      readyOptBtn.classList.toggle('is-active', this.showReadyCards);
      readyOptBtn.querySelector('.startup-opt-val')!.textContent = this.showReadyCards
        ? 'Terbuka (Dilihat Semua)'
        : 'Tertutup (Rahasia)';
    });

    const nyagaOptBtn = document.createElement('button');
    nyagaOptBtn.type = 'button';
    nyagaOptBtn.className = `startup-opt-card ${this.nyagaMustNgupak ? 'is-active' : ''}`;
    nyagaOptBtn.innerHTML = `<span class="startup-opt-label">MENANG NYAGA</span><strong class="startup-opt-val">${this.nyagaMustNgupak ? 'Wajib Ngupak Sendiri' : 'Boleh Sambar Buangan'}</strong>`;
    nyagaOptBtn.addEventListener('click', () => {
      this.nyagaMustNgupak = !this.nyagaMustNgupak;
      localStorage.setItem('ceki_nyaga_must_ngupak', String(this.nyagaMustNgupak));
      nyagaOptBtn.classList.toggle('is-active', this.nyagaMustNgupak);
      nyagaOptBtn.querySelector('.startup-opt-val')!.textContent = this.nyagaMustNgupak
        ? 'Wajib Ngupak Sendiri'
        : 'Boleh Sambar Buangan';
    });

    optGrid.append(readyOptBtn, nyagaOptBtn);

    const actions = document.createElement('div');
    actions.className = 'startup-actions';

    const btnOffline = document.createElement('button');
    btnOffline.type = 'button';
    btnOffline.className = 'btn-startup btn-startup--primary';
    btnOffline.textContent = 'PLAY OFFLINE';
    btnOffline.addEventListener('click', () => this.startOfflineGame());

    const btnOnline = document.createElement('button');
    btnOnline.type = 'button';
    btnOnline.className = 'btn-startup';
    btnOnline.textContent = 'PLAY ONLINE';
    btnOnline.addEventListener('click', () => this.openOnlineModal());

    const btnLan = document.createElement('button');
    btnLan.type = 'button';
    btnLan.className = 'btn-startup';
    btnLan.textContent = 'PLAY LAN';
    btnLan.addEventListener('click', () => this.openLanModal());

    const btnGuide = document.createElement('button');
    btnGuide.type = 'button';
    btnGuide.className = 'btn-startup btn-startup--ghost';
    btnGuide.textContent = 'Panduan Bermain';
    btnGuide.addEventListener('click', () => this.tutorialModal.open());

    actions.append(btnOffline, btnOnline, btnLan, btnGuide);
    card.append(topFieldsRow, optGrid, actions);
    screen.appendChild(card);
    return screen;
  }

  private renderTopHud(state: GameState): HTMLElement {
    const hud = document.createElement('header');
    hud.className = 'top-hud';

    const row = document.createElement('div');
    row.className = 'hud-row';

    const roundPill = document.createElement('span');
    roundPill.className = 'hud-pill hud-round-pill';
    roundPill.textContent = `Babak ${state.round} • ${this.getModeLabel()}`;

    const actions = document.createElement('div');
    actions.className = 'hud-actions';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'hud-btn';
    menuBtn.textContent = 'Menu';
    menuBtn.addEventListener('click', () => this.openMenuModal());

    const histBtn = document.createElement('button');
    histBtn.type = 'button';
    histBtn.className = 'hud-btn';
    histBtn.textContent = 'Riwayat';
    histBtn.addEventListener('click', () => this.historyModal.open(state.history));

    const guideBtn = document.createElement('button');
    guideBtn.type = 'button';
    guideBtn.className = 'hud-btn';
    guideBtn.textContent = 'Panduan';
    guideBtn.addEventListener('click', () => this.tutorialModal.open());

    actions.append(menuBtn, histBtn, guideBtn);
    row.append(roundPill, actions);
    hud.appendChild(row);

    if (this.isMultiplayer()) {
      const isWarn = (this.pingMs ?? 0) > 150 || this.packetLossPct > 5;
      const netSub = document.createElement('div');
      netSub.className = `hud-net-subrow ${isWarn ? 'is-warn' : ''}`;
      netSub.textContent =
        this.pingMs !== null ? `📶 ${this.pingMs}ms • ${this.packetLossPct}%` : '📶 Host';
      hud.appendChild(netSub);
    }

    return hud;
  }

  private renderTableZone(state: GameState): HTMLElement {
    const zone = document.createElement('section');
    zone.className = 'table-zone';

    const nyariPlayers = state.players
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => p.readyMode === 'mecari' || p.readyMode === 'mejaga');

    if (nyariPlayers.length > 0) {
      const meNyari = nyariPlayers.find(({ idx }) => idx === this.mySeat);
      const oppNyari = nyariPlayers.filter(({ idx }) => idx !== this.mySeat);
      const parts: string[] = [];
      if (meNyari) {
        parts.push(meNyari.p.readyMode === 'mejaga' ? '🔥 ANDA MEJAGA' : '🔍 ANDA MECARI');
      }
      if (oppNyari.length > 0) {
        const names =
          oppNyari.length <= 2
            ? oppNyari
                .map(({ p }) => `${p.name} (${p.readyMode === 'mejaga' ? 'Jaga' : 'Cari'})`)
                .join(', ')
            : `${oppNyari.length} Lawan Nyari`;
        parts.push(`⚠️ ${names}`);
      }
      const banner = document.createElement('div');
      banner.className = `nyari-banner ${meNyari && oppNyari.length === 0 ? 'is-self-nyari' : ''}`;
      banner.textContent = parts.join(' • ');
      zone.appendChild(banner);
    }

    const tableWrap = document.createElement('div');
    tableWrap.className = 'oval-table-wrap';

    const oval = document.createElement('div');
    oval.className = 'oval-table';

    // Stock pile in center
    const isMyTurn = state.currentPlayerIndex === this.mySeat;
    const canDraw = isMyTurn && state.phase === 'awaiting_draw' && state.stock.length > 0;

    const stockCenter = document.createElement('div');
    stockCenter.className = 'stock-center';

    const stockLabel = document.createElement('span');
    stockLabel.className = 'stock-label';
    stockLabel.textContent = '↺ TUMPUKAN';

    const stockBtn = document.createElement('button');
    stockBtn.type = 'button';
    stockBtn.className = `stock-btn ${canDraw ? 'is-active-draw' : ''}`;
    stockBtn.setAttribute('aria-label', `Tumpukan sisa ${state.stock.length} kartu`);
    stockBtn.disabled = !canDraw;
    stockBtn.addEventListener('click', () => this.dispatchAction({ type: 'draw_stock' }));

    const stockCount = document.createElement('span');
    stockCount.className = 'stock-count-badge';
    stockCount.textContent = String(state.stock.length);
    stockBtn.appendChild(stockCount);

    stockCenter.append(stockLabel, stockBtn);
    oval.appendChild(stockCenter);

    // Pending drawn card centered in lower-middle of wooden table with flip animation
    if (isMyTurn && state.pendingDrawnCard) {
      const me = state.players[this.mySeat];
      const pendingCard = state.pendingDrawnCard;
      const shouldFlip = this.lastFlippedPendingId !== pendingCard.id;
      this.lastFlippedPendingId = pendingCard.id;

      const overlay = document.createElement('div');
      overlay.className = 'pending-draw-overlay';

      const cardEl = renderClassicCard(pendingCard.key, { small: true, isNew: true });
      cardEl.classList.add('pending-flip-card');
      if (shouldFlip) {
        cardEl.classList.add('is-flipping');
      }
      overlay.appendChild(cardEl);

      const hasMatch = me.hand.some(
        (c) => c.key === pendingCard.key || c.familyId === pendingCard.familyId
      );
      if (hasMatch) {
        const hint = document.createElement('span');
        hint.className = 'pending-hint-arrow';
        hint.textContent = me.hand.some((c) => c.key === pendingCard.key)
          ? '✦ Cocok Sama!'
          : '✦ 1 Keluarga';
        overlay.appendChild(hint);
      }

      const actions = document.createElement('div');
      actions.className = 'pending-actions';

      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'btn-pending btn-pending--take';
      acceptBtn.textContent = '✓ Ambil';
      acceptBtn.addEventListener('click', () => this.dispatchAction({ type: 'accept_pending' }));
      actions.appendChild(acceptBtn);

      if (state.lastDrawSource !== 'ngejuk') {
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.className = 'btn-pending btn-pending--discard';
        discardBtn.textContent = '✕ Buang';
        discardBtn.addEventListener('click', () =>
          this.dispatchAction({ type: 'discard_pending' })
        );
        actions.appendChild(discardBtn);
      } else {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-pending btn-pending--cancel';
        cancelBtn.textContent = '↩ Batal';
        cancelBtn.addEventListener('click', () =>
          this.dispatchAction({ type: 'cancel_ngejuk' })
        );
        actions.appendChild(cancelBtn);
      }

      overlay.appendChild(actions);
      oval.appendChild(overlay);
    } else {
      this.lastFlippedPendingId = null;

      // Bottom status row inside wooden table
      const statusRow = document.createElement('div');
      statusRow.className = 'table-bottom-controls';

      const currentPlayer = state.players[state.currentPlayerIndex];
      const meReady = state.players[this.mySeat]?.readyMode;
      const selfNyariClass =
        meReady === 'mejaga'
          ? 'is-self-mejaga'
          : meReady === 'mecari'
            ? 'is-self-mecari'
            : '';
      const turnPill = document.createElement('div');
      turnPill.className = `turn-banner-pill ${isMyTurn ? 'is-your-turn' : ''} ${selfNyariClass}`;
      if (state.phase === 'round_over') {
        turnPill.textContent = 'BABAK SELESAI';
      } else if (isMyTurn) {
        turnPill.textContent =
          state.phase === 'awaiting_draw'
            ? 'GILIRAN ANDA'
            : 'GILIRAN ANDA • BUANG 1';
      } else {
        turnPill.textContent = `⏳ ${currentPlayer?.name ?? '...'} berpikir...`;
      }

      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'btn-sort-hand';
      sortBtn.textContent = 'Susun';
      sortBtn.addEventListener('click', () => this.dispatchAction({ type: 'sort_hand' }));

      statusRow.append(turnPill, sortBtn);
      oval.appendChild(statusRow);
    }
    tableWrap.appendChild(oval);

    // 4 Opponent seats arranged counter-clockwise (melawan jarum jam):
    // Bottom = Anda (0) -> Mid-Right (+1) -> Top-Right (+2) -> Top-Left (+3) -> Mid-Left (+4)
    const seatPositions: Array<{ offset: number; cls: string }> = [
      { offset: 1, cls: 'seat-mid-right' },
      { offset: 2, cls: 'seat-top-right' },
      { offset: 3, cls: 'seat-top-left' },
      { offset: 4, cls: 'seat-mid-left' },
    ];

    const ngejukTarget = getNgejukTarget(state);

    for (const pos of seatPositions) {
      const seatIdx = (this.mySeat + pos.offset) % 5;
      tableWrap.appendChild(
        this.renderOpponentSeat(state, seatIdx, pos.cls, canDraw && ngejukTarget?.playerIndex === seatIdx)
      );
    }

    // Player's own discard pile on bottom-left of table
    const me = state.players[this.mySeat];
    const myDiscardWrap = document.createElement('div');
    myDiscardWrap.className = 'my-table-discard';

    const myDiscardBtn = document.createElement('button');
    myDiscardBtn.type = 'button';
    myDiscardBtn.className = 'seat-discard-btn';
    myDiscardBtn.setAttribute('aria-label', `Lihat buangan ${me.name}`);
    myDiscardBtn.addEventListener('click', () =>
      this.openDiscardInspectModal(me.name, me.discards)
    );

    const lastMeDiscard = me.discards[me.discards.length - 1];
    if (lastMeDiscard) {
      myDiscardBtn.appendChild(renderClassicCard(lastMeDiscard.key, { small: true }));
      const count = document.createElement('span');
      count.className = 'seat-discard-count';
      count.textContent = `×${me.discards.length}`;
      myDiscardBtn.appendChild(count);
    } else {
      const empty = document.createElement('span');
      empty.className = 'seat-discard-empty';
      empty.textContent = '0';
      myDiscardBtn.appendChild(empty);
    }

    const myDiscardLabel = document.createElement('span');
    myDiscardLabel.className = 'my-table-discard-label';
    myDiscardLabel.textContent = 'Buangan';

    myDiscardWrap.append(myDiscardBtn, myDiscardLabel);
    tableWrap.appendChild(myDiscardWrap);

    zone.appendChild(tableWrap);
    return zone;
  }

  private renderOpponentSeat(
    state: GameState,
    seatIdx: number,
    posClass: string,
    isNgejukSource: boolean
  ): HTMLElement {
    const player = state.players[seatIdx];
    const isActive = state.currentPlayerIndex === seatIdx && state.phase !== 'round_over';

    const seat = document.createElement('div');
    const nyariClass =
      player.readyMode === 'mejaga'
        ? 'is-nyari-mejaga'
        : player.readyMode === 'mecari'
          ? 'is-nyari-mecari'
          : '';
    seat.className = `opponent-seat ${posClass} ${isActive ? 'is-active' : ''} ${nyariClass}`;

    if (isActive) {
      const crown = document.createElement('div');
      crown.className = 'seat-crown-badge';
      crown.innerHTML = `<span class="seat-crown-icon">👑</span><span>GILIRAN</span>`;
      seat.appendChild(crown);
    } else if (player.readyMode === 'mecari' || player.readyMode === 'mejaga') {
      const badge = document.createElement('span');
      badge.className = `seat-ready-badge is-${player.readyMode}`;
      badge.textContent = player.readyMode === 'mecari' ? 'MECARI' : 'MEJAGA';
      seat.appendChild(badge);
    }

    const namePill = document.createElement('div');
    namePill.className = 'seat-name-pill';
    namePill.innerHTML = `<span class="seat-name">${player.name}</span><span class="seat-score">${player.score}</span>`;

    const cardsRow = document.createElement('div');
    cardsRow.className = 'seat-cards-row';

    const discardSlot = document.createElement('div');
    discardSlot.className = 'seat-card-slot';

    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = `seat-discard-btn ${isNgejukSource ? 'is-ngejuk-ready' : ''}`;
    discardBtn.setAttribute('aria-label', `Lihat buangan ${player.name}`);
    discardBtn.addEventListener('click', () =>
      this.openDiscardInspectModal(player.name, player.discards)
    );

    const topDiscard = player.discards[player.discards.length - 1];
    if (topDiscard) {
      discardBtn.appendChild(renderClassicCard(topDiscard.key, { small: true }));
      const count = document.createElement('span');
      count.className = 'seat-discard-count';
      count.textContent = `×${player.discards.length}`;
      discardBtn.appendChild(count);
    } else {
      const empty = document.createElement('span');
      empty.className = 'seat-discard-empty';
      empty.textContent = '0';
      discardBtn.appendChild(empty);
    }

    if (isNgejukSource && topDiscard) {
      const quickNgejuk = document.createElement('button');
      quickNgejuk.type = 'button';
      quickNgejuk.className = 'seat-ngejuk-pill';
      quickNgejuk.textContent = 'Ngejuk!';
      quickNgejuk.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dispatchAction({ type: 'ngejuk' });
      });
      discardSlot.append(discardBtn, quickNgejuk);
    } else {
      const discardCaption = document.createElement('span');
      discardCaption.className = 'seat-slot-caption';
      discardCaption.textContent = 'Buangan';
      discardSlot.append(discardBtn, discardCaption);
    }
    cardsRow.appendChild(discardSlot);

    const openMeldCards = (player.openMelds ?? []).flatMap((m) => m.cards);
    const openCardsToDisplay =
      openMeldCards.length > 0 ? openMeldCards : (player.openNgejukCards ?? []);

    const hasJuk = openCardsToDisplay.length > 0;
    const readyCards = player.readyCards ?? [];
    const hasReady =
      state.showReadyCards !== false &&
      (player.readyMode === 'mecari' || player.readyMode === 'mejaga') &&
      readyCards.length > 0;

    if (hasJuk || hasReady) {
      const openCol = document.createElement('div');
      openCol.className = 'seat-open-stack';

      if (hasReady) {
        const readySlot = document.createElement('div');
        readySlot.className = 'seat-card-slot';

        const readyBtn = document.createElement('button');
        readyBtn.type = 'button';
        readyBtn.className = `seat-ready-cards is-${player.readyMode}`;
        const label = player.readyMode === 'mecari' ? 'Carian' : 'Jaga';
        readyBtn.title = `Ketuk untuk lihat kartu ${label} ${player.name}`;
        readyBtn.setAttribute('aria-label', `Lihat kartu ${label} ${player.name}`);
        readyBtn.addEventListener('click', () =>
          this.openDiscardInspectModal(`${label} ${player.name}`, readyCards)
        );
        for (const rc of readyCards) {
          const mini = renderClassicCard(rc.key, { small: true });
          mini.classList.add('open-stack-card');
          readyBtn.appendChild(mini);
        }

        const readyCaption = document.createElement('span');
        readyCaption.className = `seat-slot-caption seat-slot-caption--${player.readyMode}`;
        readyCaption.textContent = label;
        readySlot.append(readyBtn, readyCaption);
        openCol.appendChild(readySlot);
      }

      if (hasJuk) {
        const jukSlot = document.createElement('div');
        jukSlot.className = 'seat-card-slot';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'seat-open-ngejuk';
        openBtn.title = 'Ketuk untuk lihat detail kartu Jukjukan terbuka';
        openBtn.setAttribute('aria-label', `Lihat kartu Jukjukan ${player.name}`);
        openBtn.addEventListener('click', () =>
          this.openDiscardInspectModal(`Jukjukan ${player.name}`, openCardsToDisplay)
        );
        for (const openCard of openCardsToDisplay.slice(0, 3)) {
          const mini = renderClassicCard(openCard.key, { small: true });
          mini.classList.add('open-stack-card');
          openBtn.appendChild(mini);
        }

        const jukCaption = document.createElement('span');
        jukCaption.className = 'seat-slot-caption seat-slot-caption--juk';
        jukCaption.textContent =
          openMeldCards.length > 0 ? `Juk (${openCardsToDisplay.length})` : 'Juk';
        jukSlot.append(openBtn, jukCaption);
        openCol.appendChild(jukSlot);
      }

      cardsRow.appendChild(openCol);
    }

    seat.append(namePill, cardsRow);

    return seat;
  }

  private renderHandZone(state: GameState): HTMLElement {
    const zone = document.createElement('section');
    zone.className = 'hand-zone';

    const me = state.players[this.mySeat];
    const isMyTurn = state.currentPlayerIndex === this.mySeat;
    const canDiscard = isMyTurn && state.phase === 'awaiting_discard' && !state.pendingDrawnCard;

    // 11-card hand row (gentle fan arc + distinct Soca/Lawang/Serigat animations)
    const handRow = document.createElement('div');
    handRow.className = 'hand-cards-row';

    const meldMap = detectContiguousMelds(me.hand);
    const partial = findBestPartialMelds(me.hand, state.playStyle);
    const hints = analyzeLeftoverHints(partial.leftover);
    const recDiscardId = canDiscard ? getRecommendedDiscardId(me.hand, state.playStyle) : null;

    // Detect newly formed melds when hand changes
    const handKey = `${state.round}:${me.hand.map((c) => c.id).join(',')}`;
    const currentSignatures = new Set<string>();
    const groupCards = new Map<number, { type: MeldType; ids: string[] }>();
    for (const c of me.hand) {
      const m = meldMap.get(c.id);
      if (m) {
        const entry = groupCards.get(m.groupIndex) ?? { type: m.type, ids: [] };
        entry.ids.push(c.id);
        groupCards.set(m.groupIndex, entry);
      }
    }

    const newlyFormedGroups = new Map<number, MeldType>();
    let toastType: MeldType | null = null;
    for (const [gIdx, info] of groupCards) {
      const sig = `${info.type}:${[...info.ids].sort().join('|')}`;
      currentSignatures.add(sig);
      if (handKey !== this.lastAnimatedHandKey && !this.prevMeldSignatures.has(sig)) {
        newlyFormedGroups.set(gIdx, info.type);
        toastType = info.type;
      }
    }
    if (handKey !== this.lastAnimatedHandKey) {
      this.prevMeldSignatures = currentSignatures;
      this.lastAnimatedHandKey = handKey;
      if (toastType) sfx.playMeldFormed();
    }

    if (toastType) {
      const toast = document.createElement('div');
      toast.className = `meld-toast meld-toast--${toastType}`;
      toast.textContent =
        toastType === 'soca'
          ? '⚡ SOCA!'
          : toastType === 'lawang'
            ? '🔥 LAWANG!'
            : '✦ SERIGAT!';
      zone.appendChild(toast);
    }

    const total = me.hand.length;
    const mid = (total - 1) / 2;
    let prevGroupIndex: number | undefined;

    me.hand.forEach((card, idx) => {
      const meldInfo = meldMap.get(card.id);
      const hint = hints.get(card.id);
      const isSelected = this.selectedCardId === card.id;

      let hintTone: 'discard' | 'pair' | 'serigat' | undefined;
      if (canDiscard && recDiscardId === card.id) {
        hintTone = 'discard';
      } else if (hint?.tag.toLowerCase().includes('soca')) {
        hintTone = 'pair';
      } else if (hint) {
        hintTone = 'serigat';
      }

      const cardEl = renderClassicCard(card.key, {
        selected: isSelected,
        inMeld: Boolean(meldInfo),
        meldColorIndex: meldInfo?.groupIndex,
        isNew: state.lastDrawnCardId === card.id,
        hintTone,
        clickable: true,
      });
      cardEl.dataset.index = String(idx);

      // Fan arc transform
      const offset = idx - mid;
      const rot = offset * 1.45;
      const arcY = Math.pow(Math.abs(offset), 1.65) * 0.75;
      cardEl.style.setProperty('--fan-rot', `${rot.toFixed(2)}deg`);
      cardEl.style.setProperty('--fan-y', `${arcY.toFixed(1)}px`);

      if (meldInfo) {
        cardEl.classList.add(`meld-type-${meldInfo.type}`);
        if (meldInfo.groupIndex === prevGroupIndex) {
          cardEl.classList.add('meld-same-group');
        } else if (idx > 0) {
          cardEl.classList.add('meld-gap-start');
        }
        const posInGroup = groupCards.get(meldInfo.groupIndex)?.ids.indexOf(card.id) ?? 0;
        if (posInGroup === 1) {
          const badge = document.createElement('span');
          badge.className = `meld-label-badge meld-label-badge--${meldInfo.type}`;
          badge.textContent =
            meldInfo.type === 'soca'
              ? 'SOCA'
              : meldInfo.type === 'lawang'
                ? 'LAWANG'
                : 'SERIGAT';
          cardEl.appendChild(badge);
        }
      }

      const isOpenNgejuk = (me.openNgejukCards ?? []).some((c) => c.id === card.id);
      if (isOpenNgejuk) {
        cardEl.classList.add('is-open-ngejuk');
        const canDropThis = canDiscardCard(state, this.mySeat, card.id);
        const jukBadge = document.createElement('span');
        jukBadge.className = `open-ngejuk-badge ${canDropThis ? 'is-unlocked' : ''}`;
        jukBadge.textContent = canDropThis ? 'JUK' : '🔒JUK';
        cardEl.appendChild(jukBadge);
      }
      if (meldInfo && newlyFormedGroups.has(meldInfo.groupIndex)) {
        const animType = newlyFormedGroups.get(meldInfo.groupIndex)!;
        cardEl.classList.add(`meld-anim-${animType}`);
        const posInGroup = groupCards.get(meldInfo.groupIndex)?.ids.indexOf(card.id) ?? 0;
        cardEl.style.setProperty('--meld-delay', `${posInGroup * 65}ms`);
      }
      prevGroupIndex = meldInfo?.groupIndex;

      this.attachCardTouchDragAndTap(cardEl, card, idx, canDiscard);
      handRow.appendChild(cardEl);
    });

    zone.appendChild(handRow);
    return zone;
  }

  private attachCardTouchDragAndTap(
    cardEl: HTMLElement,
    card: CardInstance,
    index: number,
    canDiscard: boolean
  ): void {
    let startX = 0;
    let startY = 0;
    let dragging = false;

    cardEl.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      this.dragFromIndex = index;
      this.dragHoverIndex = index;
      cardEl.classList.add('is-pressed');
      cardEl.setPointerCapture(e.pointerId);
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (this.dragFromIndex !== index) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (!dragging && (dx > 10 || dy > 10)) {
        dragging = true;
        cardEl.classList.add('is-dragging');
      }
      if (!dragging) return;

      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ceki-card') as
        | HTMLElement
        | null;
      document
        .querySelectorAll('.ceki-card.is-drop-target')
        .forEach((el) => el.classList.remove('is-drop-target'));
      if (target && target.dataset.index !== undefined) {
        this.dragHoverIndex = Number(target.dataset.index);
        if (this.dragHoverIndex !== index) {
          target.classList.add('is-drop-target');
        }
      }
    });

    const finishPointer = (e: PointerEvent) => {
      if (this.dragFromIndex !== index) return;
      if (cardEl.hasPointerCapture(e.pointerId)) {
        cardEl.releasePointerCapture(e.pointerId);
      }
      cardEl.classList.remove('is-pressed', 'is-dragging');
      document
        .querySelectorAll('.ceki-card.is-drop-target')
        .forEach((el) => el.classList.remove('is-drop-target'));

      const from = this.dragFromIndex;
      const to = this.dragHoverIndex;
      this.dragFromIndex = null;
      this.dragHoverIndex = null;

      if (dragging) {
        if (to !== null && to !== from) {
          this.dispatchAction({ type: 'reorder', fromIndex: from, toIndex: to });
        }
        return;
      }

      // Quick tap behavior
      if (canDiscard) {
        if (this.selectedCardId === card.id) {
          if (this.state && !canDiscardCard(this.state, this.mySeat, card.id)) {
            this.activeNyariToast = {
              text: '🔒 Kartu Ngejuk terbuka tidak boleh dibuang kecuali untuk Nyari!',
              tone: 'opponent',
            };
            if (this.nyariToastTimer !== null) window.clearTimeout(this.nyariToastTimer);
            this.nyariToastTimer = window.setTimeout(() => {
              this.activeNyariToast = null;
              document.querySelector('.nyari-alert-toast')?.remove();
            }, 2400);
            this.render();
            return;
          }
          this.dispatchAction({ type: 'discard', cardId: card.id });
        } else {
          this.selectedCardId = card.id;
          this.render();
        }
      } else {
        this.selectedCardId = this.selectedCardId === card.id ? null : card.id;
        this.render();
      }
    };

    cardEl.addEventListener('pointerup', finishPointer);
    cardEl.addEventListener('pointercancel', finishPointer);
  }

  private renderThumbBar(state: GameState): HTMLElement {
    const bar = document.createElement('footer');
    bar.className = 'thumb-bar';

    const me = state.players[this.mySeat];
    const isMyTurn = state.currentPlayerIndex === this.mySeat;
    const canDraw = isMyTurn && state.phase === 'awaiting_draw' && state.stock.length > 0;
    const ngejukTarget = getNgejukTarget(state);
    const canNgejuk = isMyTurn && state.phase === 'awaiting_draw' && ngejukTarget !== null;

    const handWithPending = state.pendingDrawnCard
      ? [...me.hand, state.pendingDrawnCard]
      : me.hand;
    const readyBefore = getReadyStatus(me.hand, state.playStyle);
    const allowFromSource =
      state.lastDrawSource !== 'ngejuk' ||
      readyBefore.mode === 'mecari' ||
      (state.nyagaMustNgupak === false && readyBefore.mode === 'mejaga');
    const canCeki =
      isMyTurn &&
      state.phase === 'awaiting_discard' &&
      allowFromSource &&
      handWithPending.length === 12 &&
      readyBefore.mode !== null &&
      findWinningMelds(handWithPending, state.playStyle) !== null;

    // 3 Large Thumb Buttons (Ambil, Ngejuk, Ceki!)
    const actions = document.createElement('div');
    actions.className = 'thumb-actions';

    const ambilBtn = document.createElement('button');
    ambilBtn.type = 'button';
    ambilBtn.className = 'btn-thumb btn-thumb--ambil';
    ambilBtn.disabled = !canDraw;
    ambilBtn.innerHTML = `Ambil<small>Tumpukan</small>`;
    ambilBtn.addEventListener('click', () => this.dispatchAction({ type: 'draw_stock' }));

    const ngejukBtn = document.createElement('button');
    ngejukBtn.type = 'button';
    ngejukBtn.className = 'btn-thumb btn-thumb--ngejuk';
    ngejukBtn.disabled = !canNgejuk;
    const ngejukName = ngejukTarget ? CARD_DEFS[ngejukTarget.card.key].balineseName : 'Kosong';
    ngejukBtn.innerHTML = `Ngejuk<small>${ngejukName}</small>`;
    ngejukBtn.addEventListener('click', () => this.dispatchAction({ type: 'ngejuk' }));

    const cekiBtn = document.createElement('button');
    cekiBtn.type = 'button';
    cekiBtn.className = 'btn-thumb btn-thumb--ceki';
    cekiBtn.disabled = !canCeki;
    const nyagaBlocked =
      isMyTurn &&
      state.lastDrawSource === 'ngejuk' &&
      readyBefore.mode === 'mejaga' &&
      state.nyagaMustNgupak !== false;
    cekiBtn.innerHTML = `Ceki!<small>${canCeki ? 'MENANG!' : nyagaBlocked ? 'Wajib Ngupak' : 'Belum'}</small>`;
    cekiBtn.addEventListener('click', () => this.dispatchAction({ type: 'declare_ceki' }));

    actions.append(ambilBtn, ngejukBtn, cekiBtn);
    bar.append(actions);
    return bar;
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new CekiPortraitApp(appRoot);
}
