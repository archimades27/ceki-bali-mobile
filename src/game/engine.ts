import { CARD_DEFS, createDeck, sortHand } from './deck.ts';
import {
  checkWinWithCard,
  evaluateHandScore,
  findBestPartialMelds,
  findWinningMelds,
  getNyagaWaits,
  getReadyStatus,
} from './melds.ts';
import type { CardInstance, GameState, Meld, Player, PlayStyle } from './types.ts';

function extractOpenMeldForCard(
  hand12: CardInstance[],
  taken: CardInstance,
  playStyle: PlayStyle
): Meld | null {
  const partial = findBestPartialMelds(hand12, playStyle);
  return partial.melds.find((m) => m.cards.some((c) => c.id === taken.id)) ?? null;
}

function sortByMeldPriority(cards: CardInstance[], playStyle: PlayStyle): CardInstance[] {
  const grouped = findBestPartialMelds(cards, playStyle);
  return [...grouped.melds.flatMap((m) => m.cards), ...grouped.leftover];
}

function computeReadyCards(
  hand11: CardInstance[],
  mode: 'mecari' | 'mejaga' | null,
  playStyle: PlayStyle
): CardInstance[] {
  if (!mode || hand11.length !== 11) return [];
  const partial = findBestPartialMelds(hand11, playStyle);
  if (partial.leftover.length === 2) return partial.leftover;
  return partial.leftover.slice(0, 2);
}

export function createInitialPlayers(): Player[] {
  return [
    {
      id: 0,
      name: 'Anda',
      isHuman: true,
      hand: [],
      discards: [],
      openNgejukCards: [],
      openMelds: [],
      score: 0,
      avatarText: 'ANDA',
      statusText: 'Giliran Anda',
    },
    {
      id: 1,
      name: 'Made',
      isHuman: false,
      difficulty: 'casual',
      hand: [],
      discards: [],
      openNgejukCards: [],
      openMelds: [],
      score: 0,
      avatarText: 'M',
      statusText: 'Menunggu',
    },
    {
      id: 2,
      name: 'Nyoman',
      isHuman: false,
      difficulty: 'balanced',
      hand: [],
      discards: [],
      openNgejukCards: [],
      openMelds: [],
      score: 0,
      avatarText: 'N',
      statusText: 'Menunggu',
    },
    {
      id: 3,
      name: 'Ketut',
      isHuman: false,
      difficulty: 'strategic',
      hand: [],
      discards: [],
      openNgejukCards: [],
      openMelds: [],
      score: 0,
      avatarText: 'K',
      statusText: 'Menunggu',
    },
    {
      id: 4,
      name: 'Wayan',
      isHuman: false,
      difficulty: 'balanced',
      hand: [],
      discards: [],
      openNgejukCards: [],
      openMelds: [],
      score: 0,
      avatarText: 'W',
      statusText: 'Menunggu',
    },
  ];
}

export function getNgejukTarget(state: GameState): {
  playerIndex: number;
  card: CardInstance;
} | null {
  if (state.lastDiscardPlayerIndex === null) return null;
  const sourcePlayer = state.players[state.lastDiscardPlayerIndex];
  if (!sourcePlayer || sourcePlayer.discards.length === 0) return null;
  const topCard = sourcePlayer.discards[sourcePlayer.discards.length - 1];
  const currentPlayer = state.players[state.currentPlayerIndex];
  // Aturan Turnamen Ceki (Ngutang-Ngejuk): dilarang ngejuk kartu yang sama dengan buangan sendiri sebelumnya
  if (currentPlayer?.discards.some((d) => d.key === topCard.key)) {
    return null;
  }
  return {
    playerIndex: state.lastDiscardPlayerIndex,
    card: topCard,
  };
}

export function startNewRound(
  existingState?: GameState,
  playStyleOverride?: PlayStyle,
  customPlayers?: Player[]
): GameState {
  const deck = createDeck();
  const playStyle: PlayStyle = playStyleOverride ?? existingState?.playStyle ?? 'nyari';
  // Randomize starting player at round spawn
  const playerCount = customPlayers?.length ?? existingState?.players.length ?? 5;
  const startPlayerIndex = Math.floor(Math.random() * playerCount);
  const prevPlayerIndex = (startPlayerIndex + playerCount - 1) % playerCount;

  const basePlayers = customPlayers
    ? customPlayers.map((p, idx) => ({
        ...p,
        hand: [],
        discards: [],
        openNgejukCards: [],
        openMelds: [],
        statusText: idx === startPlayerIndex ? 'Giliran' : 'Menunggu',
      }))
    : existingState
      ? existingState.players.map((p, idx) => ({
          ...p,
          hand: [],
          discards: [],
          openNgejukCards: [],
          openMelds: [],
          statusText: idx === startPlayerIndex ? (p.isHuman ? 'Giliran Anda' : 'Giliran') : 'Menunggu',
        }))
      : createInitialPlayers().map((p, idx) => ({
          ...p,
          statusText: idx === startPlayerIndex ? (p.isHuman ? 'Giliran Anda' : 'Giliran') : 'Menunggu',
        }));
  const players: Player[] = basePlayers;

  // Deal 11 cards to each of the 5 players (55 cards)
  for (let i = 0; i < players.length; i++) {
    const dealt = deck.splice(0, 11);
    players[i].hand = players[i].isHuman ? sortByMeldPriority(dealt, playStyle) : dealt;
    const ready = getReadyStatus(players[i].hand, playStyle);
    players[i].readyMode = ready.mode;
    players[i].readyCards = computeReadyCards(players[i].hand, ready.mode, playStyle);
  }

  // Place 1 opening discard to the right of the player just before the random starter
  const openingDiscard = deck.pop()!;
  players[prevPlayerIndex].discards = [openingDiscard];

  const round = existingState ? existingState.round + 1 : 1;
  const styleLabel =
    playStyle === 'soca' ? 'Soca' : playStyle === 'serigat' ? 'Serigat' : 'Nyari';

  const firstPlayer = players[startPlayerIndex];
  const startEntry = {
    round,
    actor: 'Sistem',
    action: `Babak ${round} dimulai (${styleLabel}) • Mulai: ${firstPlayer.name}`,
    cardName: `Kartu awal: ${CARD_DEFS[openingDiscard.key].balineseName}`,
  };

  return {
    round,
    playStyle,
    players,
    currentPlayerIndex: startPlayerIndex,
    phase: firstPlayer.isHuman ? 'awaiting_draw' : 'bot_thinking',
    botStep: firstPlayer.isHuman ? null : 'draw',
    stock: deck,
    lastDiscardPlayerIndex: prevPlayerIndex,
    lastDrawnCardId: null,
    lastDrawSource: null,
    pendingDrawnCard: null,
    winnerId: null,
    winningMelds: null,
    winReason: null,
    lastActionLog: `Babak ${round} (${styleLabel}) • Giliran pertama: ${firstPlayer.name}.`,
    history: [...(existingState?.history ?? []).slice(-100), startEntry],
  };
}

function canCurrentPlayerDraw(state: GameState): boolean {
  if (state.phase === 'round_over') return false;
  if (state.pendingDrawnCard !== null) return false;
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.hand.length !== 11) return false;
  if (player.isHuman) {
    return state.phase === 'awaiting_draw';
  }
  return state.phase === 'bot_thinking' && state.botStep === 'draw';
}

function canCurrentPlayerDiscard(state: GameState, playerIndex = state.currentPlayerIndex): boolean {
  if (state.phase === 'round_over') return false;
  if (playerIndex !== state.currentPlayerIndex) return false;
  const player = state.players[playerIndex];
  if (!player) return false;
  if (player.isHuman) {
    return state.phase === 'awaiting_discard' && state.pendingDrawnCard === null && player.hand.length === 12;
  }
  return state.phase === 'bot_thinking' && state.botStep === 'discard' && player.hand.length === 12;
}

function checkKupakNyariWinner(
  state: GameState,
  openedCard: CardInstance,
  openerIdx: number,
  sourceLabel: string
): GameState | null {
  const count = state.players.length;
  for (let offset = 1; offset < count; offset++) {
    const idx = (openerIdx + offset) % count;
    const candidate = state.players[idx];
    if (!candidate || candidate.hand.length !== 11) continue;
    const winRes = checkWinWithCard(candidate.hand, openedCard, state.playStyle);
    if (!winRes) continue;

    const fullHand = [...candidate.hand, openedCard];
    const openerName = state.players[openerIdx]?.name ?? 'Pemain';
    const modeLabel = winRes.mode === 'mejaga' ? 'Mejaga' : 'Mecari';
    const updatedPlayers = state.players.map((p, pIdx) =>
      pIdx === idx
        ? { ...p, hand: fullHand, score: p.score + 10, statusText: `CEKI (${modeLabel})!` }
        : p
    );

    return {
      ...state,
      players: updatedPlayers,
      pendingDrawnCard: null,
      lastDrawnCardId: null,
      phase: 'round_over',
      botStep: null,
      winnerId: candidate.id,
      winKind: 'kupak',
      winningMelds: winRes.melds,
      winReason: `${candidate.name} menang CEKI! (Kupak ${modeLabel} — ${CARD_DEFS[openedCard.key].balineseName} dibuka oleh ${openerName})`,
      lastActionLog: `${candidate.name} langsung menang CEKI (Kupak ${modeLabel} ${CARD_DEFS[openedCard.key].balineseName} dari ${openerName})! (+10 poin)`,
      history: [
        ...state.history,
        {
          round: state.round,
          actor: candidate.name,
          action: `Menang Kupak ${modeLabel} (${sourceLabel} ${openerName})`,
          cardName: CARD_DEFS[openedCard.key].balineseName,
        },
      ],
    };
  }
  return null;
}

export function drawFromStock(state: GameState): GameState {
  if (!canCurrentPlayerDraw(state)) return state;

  if (state.stock.length === 0) {
    return {
      ...state,
      phase: 'round_over',
      botStep: null,
      winnerId: null,
      winReason: 'Tumpukan habis — Babak berakhir Seri!',
      lastActionLog: 'Tumpukan habis! Babak berakhir Seri.',
      history: [...state.history, { round: state.round, actor: 'Sistem', action: 'Tumpukan habis (Seri)' }],
    };
  }

  const nextStock = [...state.stock];
  const drawn = nextStock.pop()!;
  const player = state.players[state.currentPlayerIndex];

  const updatedPlayers = state.players.map((p, idx) => {
    if (idx !== state.currentPlayerIndex) return p;
    // Human gets pendingDrawnCard above the hand first; bots add directly
    const nextHand = p.isHuman ? p.hand : [...p.hand, drawn];
    return {
      ...p,
      hand: nextHand,
      readyMode: p.isHuman ? p.readyMode : null,
      statusText: 'Ambil kartu',
    };
  });

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    stock: nextStock,
    lastDrawnCardId: player.isHuman ? null : drawn.id,
    lastDrawSource: 'stock',
    pendingDrawnCard: player.isHuman ? drawn : null,
    phase: player.isHuman ? 'awaiting_discard' : 'bot_thinking',
    botStep: player.isHuman ? null : 'discard',
    lastActionLog: `${player.name} membuka/mengambil kartu dari Tumpukan.`,
    history: [
      ...state.history,
      {
        round: state.round,
        actor: player.name,
        action: 'Ambil dari Tumpukan',
        cardName: player.isHuman ? CARD_DEFS[drawn.key].balineseName : undefined,
      },
    ],
  };

  // Kupak Nyari: if another player is Nyari and waiting for this opened card, they win immediately
  const kupakWin = checkKupakNyariWinner(nextState, drawn, state.currentPlayerIndex, 'Kupak');
  return kupakWin ?? nextState;
}

export function ngejukDiscard(state: GameState): GameState {
  if (!canCurrentPlayerDraw(state)) return state;
  const target = getNgejukTarget(state);
  if (!target) return state;

  const taken = target.card;
  const player = state.players[state.currentPlayerIndex];

  const updatedPlayers = state.players.map((p, idx) => {
    let nextDiscards = p.discards;
    if (idx === target.playerIndex) {
      nextDiscards = p.discards.slice(0, -1);
    }
    if (idx !== state.currentPlayerIndex) {
      return idx === target.playerIndex ? { ...p, discards: nextDiscards } : p;
    }
    const nextHand = p.isHuman ? p.hand : [...p.hand, taken];
    const nextOpenNgejuk = p.isHuman
      ? (p.openNgejukCards ?? [])
      : [...(p.openNgejukCards ?? []), taken];
    const formedMeld = !p.isHuman ? extractOpenMeldForCard(nextHand, taken, state.playStyle) : null;
    const nextOpenMelds = formedMeld
      ? [...(p.openMelds ?? []), formedMeld]
      : (p.openMelds ?? []);
    return {
      ...p,
      hand: nextHand,
      discards: nextDiscards,
      openNgejukCards: nextOpenNgejuk,
      openMelds: nextOpenMelds,
      readyMode: p.isHuman ? p.readyMode : null,
      readyCards: p.isHuman ? (p.readyCards ?? []) : [],
      statusText: 'Ngejuk!',
    };
  });

  return {
    ...state,
    players: updatedPlayers,
    lastDiscardPlayerIndex: null,
    lastNgejukFromIndex: target.playerIndex,
    lastDrawnCardId: player.isHuman ? null : taken.id,
    lastDrawSource: 'ngejuk',
    pendingDrawnCard: player.isHuman ? taken : null,
    phase: player.isHuman ? 'awaiting_discard' : 'bot_thinking',
    botStep: player.isHuman ? null : 'discard',
    lastActionLog: `${player.name} melakukan Ngejuk pada ${CARD_DEFS[taken.key].balineseName}!`,
    history: [
      ...state.history,
      {
        round: state.round,
        actor: player.name,
        action: `Ngejuk dari ${state.players[target.playerIndex].name}`,
        cardName: CARD_DEFS[taken.key].balineseName,
      },
    ],
  };
}

export function cancelNgejuk(state: GameState): GameState {
  const activeIdx = state.currentPlayerIndex;
  const activePlayer = state.players[activeIdx];
  if (
    state.phase !== 'awaiting_discard' ||
    !activePlayer?.isHuman ||
    !state.pendingDrawnCard ||
    state.lastDrawSource !== 'ngejuk' ||
    state.lastNgejukFromIndex === null ||
    state.lastNgejukFromIndex === undefined
  ) {
    return state;
  }

  const returnedCard = state.pendingDrawnCard;
  const sourceIdx = state.lastNgejukFromIndex;
  const updatedPlayers = state.players.map((p, idx) => {
    if (idx === sourceIdx) {
      return { ...p, discards: [...p.discards, returnedCard] };
    }
    if (idx === activeIdx) {
      return { ...p, statusText: 'Giliran Anda' };
    }
    return p;
  });

  return {
    ...state,
    players: updatedPlayers,
    pendingDrawnCard: null,
    lastDrawSource: null,
    lastDiscardPlayerIndex: sourceIdx,
    lastNgejukFromIndex: null,
    phase: 'awaiting_draw',
    botStep: null,
    lastActionLog: `${activePlayer.name} batal Ngejuk dan mengembalikan ${CARD_DEFS[returnedCard.key].balineseName}.`,
  };
}

export function acceptPendingDrawnCard(
  state: GameState,
  preserveHumanOrder = false
): GameState {
  const activeIdx = state.currentPlayerIndex;
  const activePlayer = state.players[activeIdx];
  if (
    state.phase !== 'awaiting_discard' ||
    !activePlayer?.isHuman ||
    !state.pendingDrawnCard ||
    activePlayer.hand.length !== 11
  ) {
    return state;
  }
  const drawn = state.pendingDrawnCard;
  const updatedPlayers = state.players.map((p, idx) => {
    if (idx !== activeIdx) return p;
    const nextHand = preserveHumanOrder
      ? [...p.hand, drawn]
      : sortByMeldPriority([...p.hand, drawn], state.playStyle);
    const nextOpenNgejuk =
      state.lastDrawSource === 'ngejuk'
        ? [...(p.openNgejukCards ?? []), drawn]
        : (p.openNgejukCards ?? []);
    const formedMeld =
      state.lastDrawSource === 'ngejuk'
        ? extractOpenMeldForCard(nextHand, drawn, state.playStyle)
        : null;
    const nextOpenMelds = formedMeld
      ? [...(p.openMelds ?? []), formedMeld]
      : (p.openMelds ?? []);
    return {
      ...p,
      hand: nextHand,
      openNgejukCards: nextOpenNgejuk,
      openMelds: nextOpenMelds,
      readyMode: null,
      readyCards: [],
    };
  });
  return {
    ...state,
    players: updatedPlayers,
    pendingDrawnCard: null,
    lastDrawnCardId: drawn.id,
    lastActionLog: `${activePlayer.name} menyimpan ${CARD_DEFS[drawn.key].balineseName} ke tangan. Pilih 1 kartu untuk dibuang.`,
  };
}

export function discardPendingDrawnCard(state: GameState): GameState {
  const activeIdx = state.currentPlayerIndex;
  const activePlayer = state.players[activeIdx];
  if (
    state.phase !== 'awaiting_discard' ||
    !activePlayer?.isHuman ||
    !state.pendingDrawnCard
  ) {
    return state;
  }
  const cardToDiscard = state.pendingDrawnCard;
  const nextPlayerIdx = (activeIdx + 1) % state.players.length;
  const nextPlayer = state.players[nextPlayerIdx];
  const ready = getReadyStatus(activePlayer.hand, state.playStyle);
  const waits = ready.waits;

  const updatedPlayers = state.players.map((p, idx) => {
    if (idx === activeIdx) {
      return {
        ...p,
        discards: [...p.discards, cardToDiscard],
        readyMode: ready.mode,
        statusText:
          ready.mode === 'mejaga'
            ? 'Mejaga!'
            : ready.mode === 'mecari'
              ? 'Mecari!'
              : `Buang ${CARD_DEFS[cardToDiscard.key].balineseName}`,
      };
    }
    if (idx === nextPlayerIdx) {
      return { ...p, statusText: nextPlayer.isHuman ? 'Giliran' : 'Berpikir...' };
    }
    return p;
  });

  const nextHistory = [
    ...state.history,
    {
      round: state.round,
      actor: activePlayer.name,
      action: 'Buang langsung',
      cardName: CARD_DEFS[cardToDiscard.key].balineseName,
    },
  ];

  if (state.stock.length === 0) {
    return {
      ...state,
      players: updatedPlayers,
      pendingDrawnCard: null,
      lastDiscardPlayerIndex: activeIdx,
      lastDrawnCardId: null,
      phase: 'round_over',
      botStep: null,
      winnerId: null,
      winReason: 'Tumpukan habis — Babak berakhir Seri!',
      lastActionLog: `${activePlayer.name} membuang ${CARD_DEFS[cardToDiscard.key].balineseName}. Tumpukan habis!`,
      history: nextHistory,
    };
  }

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    pendingDrawnCard: null,
    lastDiscardPlayerIndex: activeIdx,
    currentPlayerIndex: nextPlayerIdx,
    lastDrawnCardId: null,
    lastDrawSource: null,
    phase: nextPlayer.isHuman ? 'awaiting_draw' : 'bot_thinking',
    botStep: nextPlayer.isHuman ? null : 'draw',
    lastActionLog: `${activePlayer.name} langsung membuang ${CARD_DEFS[cardToDiscard.key].balineseName}.${waits.length > 0 ? ' (Sudah Nyari!)' : ''}`,
    history: nextHistory,
  };

  // Ngenen tidak boleh dari hasil buangan kartu di tangan; hanya dari kupakan tumpukan
  return nextState;
}

export function reorderHumanHand(
  state: GameState,
  fromIndex: number,
  toIndex: number,
  playerIndex = 0
): GameState {
  const human = state.players[playerIndex];
  if (
    !human ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= human.hand.length ||
    toIndex >= human.hand.length
  ) {
    return state;
  }
  const nextHand = [...human.hand];
  const [moved] = nextHand.splice(fromIndex, 1);
  nextHand.splice(toIndex, 0, moved);

  const updatedPlayers = state.players.map((p, idx) =>
    idx === playerIndex ? { ...p, hand: nextHand } : p
  );
  return {
    ...state,
    players: updatedPlayers,
  };
}

export function sortHumanHand(state: GameState, playerIndex = 0): GameState {
  const updatedPlayers = state.players.map((p, idx) => {
    if (idx !== playerIndex) return p;
    return { ...p, hand: sortByMeldPriority(p.hand, state.playStyle) };
  });
  return {
    ...state,
    players: updatedPlayers,
  };
}

export function canDiscardCard(
  state: GameState,
  playerIdx: number,
  cardId: string
): boolean {
  const player = state.players[playerIdx];
  if (!player) return false;
  const isOpenNgejuk = (player.openNgejukCards ?? []).some((c) => c.id === cardId);
  if (!isOpenNgejuk) return true;
  // Open Ngejuk card can ONLY be discarded if it puts the player into Nyari (Mecari / Mejaga)
  const nextHand = player.hand.filter((c) => c.id !== cardId);
  return getReadyStatus(nextHand, state.playStyle).mode !== null;
}

export function discardCard(
  state: GameState,
  cardId: string,
  preserveHumanOrder = false
): GameState {
  const playerIdx = state.currentPlayerIndex;
  if (!canCurrentPlayerDiscard(state, playerIdx)) return state;
  const player = state.players[playerIdx];
  const cardToDiscard = player.hand.find((c) => c.id === cardId);
  if (!cardToDiscard) return state;
  if (!canDiscardCard(state, playerIdx, cardId)) return state;

  const nextHand = player.hand.filter((c) => c.id !== cardId);
  const nextOpenNgejuk = (player.openNgejukCards ?? []).filter((c) => c.id !== cardId);
  const ready = getReadyStatus(nextHand, state.playStyle);
  const waits = ready.waits;

  const nextPlayerIdx = (playerIdx + 1) % state.players.length;
  const nextPlayer = state.players[nextPlayerIdx];

  const updatedPlayers = state.players.map((p, idx) => {
    if (idx === playerIdx) {
      return {
        ...p,
        hand: p.isHuman && !preserveHumanOrder ? sortHand(nextHand) : nextHand,
        discards: [...p.discards, cardToDiscard],
        openNgejukCards: nextOpenNgejuk,
        readyMode: ready.mode,
        readyCards: computeReadyCards(nextHand, ready.mode, state.playStyle),
        statusText:
          ready.mode === 'mejaga'
            ? 'Mejaga!'
            : ready.mode === 'mecari'
              ? 'Mecari!'
              : `Buang ${CARD_DEFS[cardToDiscard.key].balineseName}`,
      };
    }
    if (idx === nextPlayerIdx) {
      return {
        ...p,
        statusText: p.isHuman ? 'Giliran Anda' : 'Berpikir...',
      };
    }
    return p;
  });

  const nextHistory = [
    ...state.history,
    {
      round: state.round,
      actor: player.name,
      action: 'Buang',
      cardName: CARD_DEFS[cardToDiscard.key].balineseName,
    },
  ];

  if (state.stock.length === 0) {
    return {
      ...state,
      players: updatedPlayers,
      lastDiscardPlayerIndex: playerIdx,
      lastDrawnCardId: null,
      phase: 'round_over',
      botStep: null,
      winnerId: null,
      winReason: 'Tumpukan habis — Babak berakhir Seri!',
      lastActionLog: `${player.name} membuang ${CARD_DEFS[cardToDiscard.key].balineseName}. Tumpukan habis!`,
      history: nextHistory,
    };
  }

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    lastDiscardPlayerIndex: playerIdx,
    currentPlayerIndex: nextPlayerIdx,
    lastDrawnCardId: null,
    lastDrawSource: null,
    phase: nextPlayer.isHuman ? 'awaiting_draw' : 'bot_thinking',
    botStep: nextPlayer.isHuman ? null : 'draw',
    lastActionLog: `${player.name} membuang ${CARD_DEFS[cardToDiscard.key].balineseName}.${waits.length > 0 ? ` (${player.name} sudah Nyari!)` : ''}`,
    history: nextHistory,
  };

  // Prioritas Pengambilan Buangan (Ilehan):
  // Pemain dalam posisi Mencari (bukan Nyaga) boleh menyambar buangan untuk menang.
  // Jika > 1 pemain Mencari menunggu kartu sama, yang paling dekat searah putaran (offset 1..4) menang.
  for (let offset = 1; offset < updatedPlayers.length; offset++) {
    const idx = (playerIdx + offset) % updatedPlayers.length;
    const candidate = updatedPlayers[idx];
    const allowCandidate =
      candidate.readyMode === 'mecari' ||
      (state.nyagaMustNgupak === false && candidate.readyMode === 'mejaga');
    if (!allowCandidate) continue;
    const winRes = checkWinWithCard(candidate.hand, cardToDiscard, state.playStyle);
    if (!winRes) continue;

    // Jika pemain manusia tepat di giliran berikutnya (offset 1), biarkan dia memilih Ngejuk -> Ceki
    if (candidate.isHuman && offset === 1) {
      break;
    }

    if (!candidate.isHuman) {
      const winnerPlayers = updatedPlayers.map((p, pIdx) => {
        if (pIdx !== idx) return p;
        return {
          ...p,
          hand: [...p.hand, cardToDiscard],
          score: p.score + 25,
          statusText: 'Mencari (Sambar)!',
        };
      });
      return {
        ...nextState,
        players: winnerPlayers,
        currentPlayerIndex: idx,
        phase: 'round_over',
        botStep: null,
        winnerId: candidate.id,
        winKind: 'ceki',
        winningMelds: winRes.melds,
        winReason: `${candidate.name} (Mencari) menyambar buangan ${CARD_DEFS[cardToDiscard.key].balineseName} dari ${player.name} (prioritas Ilehan)!`,
        lastActionLog: `${candidate.name} MENANG (Mencari — Sambar Buangan ${CARD_DEFS[cardToDiscard.key].balineseName})!`,
        history: [
          ...nextHistory,
          {
            round: state.round,
            actor: candidate.name,
            action: 'Menang Mencari (Sambar Buangan)',
            cardName: CARD_DEFS[cardToDiscard.key].balineseName,
          },
        ],
      };
    }
  }

  return nextState;
}

export function declareCeki(state: GameState, playerIndex = state.currentPlayerIndex): GameState {
  if (state.phase === 'round_over' || playerIndex !== state.currentPlayerIndex) {
    return state;
  }
  const player = state.players[playerIndex];
  if (!player) return state;
  if (player.isHuman && state.phase !== 'awaiting_discard') return state;
  if (!player.isHuman && (state.phase !== 'bot_thinking' || state.botStep !== 'discard')) return state;

  const fullHand =
    player.isHuman && state.pendingDrawnCard
      ? [...player.hand, state.pendingDrawnCard]
      : player.hand;
  if (fullHand.length !== 12) return state;

  // Check Ngandang / Mencari vs Nyaga:
  let isNgandang = false;
  let melds = findWinningMelds(fullHand, state.playStyle);
  const drawnCard =
    player.isHuman && state.pendingDrawnCard
      ? state.pendingDrawnCard
      : state.lastDrawnCardId
        ? player.hand.find((c) => c.id === state.lastDrawnCardId) ?? null
        : null;

  let readyBeforeMode: 'mecari' | 'mejaga' | null = null;
  if (drawnCard) {
    const base11 = fullHand.filter((c) => c.id !== drawnCard.id);
    if (base11.length === 11) {
      const ready = getReadyStatus(base11, state.playStyle);
      readyBeforeMode = ready.mode;
      const winRes = checkWinWithCard(base11, drawnCard, state.playStyle);
      if (ready.mode && winRes) {
        isNgandang = state.lastDrawSource !== 'ngejuk';
        melds = winRes.melds;
      }
    }
  }

  // Aturan Mencari vs Nyaga:
  // - Mencari (mecari): SAH menang dari hasil buangan (Ngejuk) maupun Ngupak.
  // - Nyaga (mejaga): Jika nyagaMustNgupak !== false, DILARANG menang dari buangan; wajib Ngupak.
  const canWinFromNgejuk =
    readyBeforeMode === 'mecari' ||
    (state.nyagaMustNgupak === false && readyBeforeMode === 'mejaga');
  if (state.lastDrawSource === 'ngejuk' && !canWinFromNgejuk) {
    return state;
  }
  if (!melds) return state;

  const updatedPlayers = state.players.map((p, idx) =>
    idx === playerIndex
      ? { ...p, hand: fullHand, score: p.score + 10, statusText: isNgandang ? 'NGANDANG!' : 'CEKI!' }
      : p
  );

  const styleLabel = isNgandang
    ? 'NGANDANG! (Ngupak Kartu Kemenangan Sendiri)'
    : state.playStyle === 'soca'
      ? 'Gaya Soca'
      : state.playStyle === 'serigat'
        ? 'Gaya Serigat'
        : '4 Susunan Lengkap';

  return {
    ...state,
    players: updatedPlayers,
    pendingDrawnCard: null,
    phase: 'round_over',
    botStep: null,
    winnerId: player.id,
    winKind: isNgandang ? 'ngandang' : 'ceki',
    winningMelds: melds,
    winReason: isNgandang
      ? `${player.name} NGANDANG! (Menang dari kartu yang diupak/ambil sendiri)`
      : `${player.name} menang Ngenen / Ceki! (${styleLabel})`,
    lastActionLog: isNgandang
      ? `🔥 ${player.name} NGANDANG pada Babak ${state.round}! (+10 poin)`
      : `${player.name} memenangkan Babak ${state.round} dengan CEKI! (+10 poin)`,
    history: [
      ...state.history,
      {
        round: state.round,
        actor: player.name,
        action: isNgandang ? 'Menang NGANDANG! 🔥' : `Menang CEKI! (${styleLabel})`,
      },
    ],
  };
}

/**
 * Returns the recommended card ID to discard for the Live Hint feature.
 */
export function getRecommendedDiscardId(
  hand12: CardInstance[],
  playStyle: PlayStyle = 'nyari'
): string | null {
  if (hand12.length !== 12) return null;
  let bestId = hand12[0].id;
  let bestScore = -Infinity;

  for (let i = 0; i < hand12.length; i++) {
    const remaining11 = hand12.filter((_, idx) => idx !== i);
    let score = evaluateHandScore(remaining11, playStyle);
    if (getNyagaWaits(remaining11, playStyle).length > 0) {
      score += 500;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = hand12[i].id;
    }
  }
  return bestId;
}
