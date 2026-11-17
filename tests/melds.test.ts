import assert from 'node:assert/strict';
import { CARD_DEFS, createDeck } from '../src/game/deck.ts';
import { checkWinWithCard, classifyThreeCards, findWinningMelds, getNyagaWaits, getReadyStatus } from '../src/game/melds.ts';
import { decideBotDiscard, decideBotDraw } from '../src/game/bot.ts';
import {
  acceptPendingDrawnCard,
  canDiscardCard,
  cancelNgejuk,
  declareCeki,
  discardCard,
  discardPendingDrawnCard,
  drawFromStock,
  getNgejukTarget,
  ngejukDiscard,
  startNewRound,
} from '../src/game/engine.ts';
import type { CardInstance, CardKey } from '../src/game/types.ts';

function makeCard(key: CardKey, idx = 1): CardInstance {
  const def = CARD_DEFS[key];
  return {
    id: `${key}_${idx}`,
    key,
    suit: def.suit,
    rank: def.rank,
    familyId: def.familyId,
  };
}

// 1. Deck test: 120 cards, 30 unique keys x 4
const deck = createDeck();
assert.equal(deck.length, 120, 'Deck should have 120 cards');
const counts = new Map<string, number>();
for (const c of deck) {
  counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
}
assert.equal(counts.size, 30, 'Deck should have 30 unique card types');

// 2. Soca, Serigat, and Nyari play styles (NO seri urut — only Soca & Serigat)
const oneSocaOnlyHand: CardInstance[] = [
  // Serigat Family 1: Gade (tong9), Teje (sok9), Jering (ban9)
  makeCard('tong9', 1), makeCard('sok9', 1), makeCard('ban9', 1),
  // Serigat Family 7: Gunung (tong4), Jarum (sok4), Jebung 3 (ban4)
  makeCard('tong4', 1), makeCard('sok4', 1), makeCard('ban4', 1),
  // Soca: 3x Cawang (tong2)
  makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
  // Serigat Family 9: Cine (ban1), Kinci (red_flower), Kobar (old_thousand)
  makeCard('ban1', 1), makeCard('red_flower', 1), makeCard('old_thousand', 1),
];

assert.equal(findWinningMelds(oneSocaOnlyHand, 'nyari'), null, '1 Soca only must NOT win Ceki (minimum 2 Soca)');
assert.equal(findWinningMelds(oneSocaOnlyHand, 'serigat'), null, 'Serigat style also requires minimum 2 Soca');
assert.equal(findWinningMelds(oneSocaOnlyHand, 'soca'), null, 'Soca should require ≥2 Soca melds');

const twoSocaHand: CardInstance[] = [
  makeCard('tong9', 1), makeCard('tong9', 2), makeCard('tong9', 3),
  makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
  makeCard('ban1', 1), makeCard('red_flower', 1), makeCard('old_thousand', 1),
  makeCard('tong4', 1), makeCard('sok4', 1), makeCard('ban4', 1),
];
assert.ok(findWinningMelds(twoSocaHand, 'nyari') !== null, 'Nyari should accept 2 Soca + 2 Serigat');
assert.ok(findWinningMelds(twoSocaHand, 'serigat') !== null, 'Serigat should accept 2 Soca + 2 Serigat');
assert.ok(findWinningMelds(twoSocaHand, 'soca') !== null, 'Soca should accept ≥2 Soca melds');

// Ensure consecutive numbers (seri urut) are NOT accepted
const invalidSeriUrutHand: CardInstance[] = [
  makeCard('tong1', 1), makeCard('tong2', 1), makeCard('tong3', 1),
  makeCard('tong9', 1), makeCard('tong9', 2), makeCard('tong9', 3),
  makeCard('sok4', 1), makeCard('sok4', 2), makeCard('sok4', 3),
  makeCard('ban5', 1), makeCard('ban5', 2), makeCard('ban5', 3),
];
assert.equal(findWinningMelds(invalidSeriUrutHand, 'nyari'), null, 'Consecutive number sequences (seri urut) must NOT be valid');

// 3. Nyari / Nyaga 1-away detection (2 Soca ready hand waiting on old_thousand)
const nyari11 = twoSocaHand.filter((c) => c.key !== 'old_thousand'); // missing old_thousand (Kobar)
const waits = getNyagaWaits(nyari11, 'nyari');
assert.ok(waits.includes('old_thousand'), 'Should detect old_thousand as Nyari wait');

function startRoundAtSeat0() {
  const s = startNewRound(undefined, 'nyari');
  const opening = s.players.flatMap((p) => p.discards)[0];
  return {
    ...s,
    players: s.players.map((p, idx) => ({
      ...p,
      discards: idx === 4 && opening ? [opening] : [],
    })),
    currentPlayerIndex: 0,
    phase: 'awaiting_draw' as const,
    botStep: null,
    lastDiscardPlayerIndex: 4,
  };
}

// 4. 5-player setup, pending drawn card above hand, and right-side per-player discard
let state = startRoundAtSeat0();
assert.equal(state.players.length, 5, 'Should have 5 players');
assert.equal(state.players[0].hand.length, 11);
assert.equal(state.stock.length, 120 - 55 - 1);

const topStockId = state.stock[state.stock.length - 1].id;
state = drawFromStock(state);
assert.equal(state.pendingDrawnCard?.id, topStockId, 'Newly drawn card must sit in pendingDrawnCard above hand');
assert.equal(state.players[0].hand.length, 11, 'Hand remains 11 until player chooses Ambil or Buang');

state = acceptPendingDrawnCard(state);
assert.equal(state.pendingDrawnCard, null);
assert.equal(state.players[0].hand.length, 12, 'Accepting pending card puts it in hand');

const discardedId = state.players[0].hand[0].id;
state = discardCard(state, discardedId);
assert.equal(state.players[0].discards.length, 1, 'Discarded card should be placed on human right-side discard pile');
assert.equal(getNgejukTarget(state)?.playerIndex, 0, 'Ngejuk target should point to player 0');

// Also test direct discard of pending drawn card
let state2 = startRoundAtSeat0();
state2 = drawFromStock(state2);
const pendingId = state2.pendingDrawnCard!.id;
state2 = discardPendingDrawnCard(state2);
assert.equal(state2.pendingDrawnCard, null);
assert.equal(state2.players[0].discards[0].id, pendingId, 'Buang langsung should discard pendingDrawnCard');

// 5. 5-player bot simulation
for (let step = 0; step < 30 && state.phase !== 'round_over'; step++) {
  const active = state.players[state.currentPlayerIndex];
  if (active.isHuman) {
    state = drawFromStock(state);
    state = acceptPendingDrawnCard(state);
    if (findWinningMelds(state.players[0].hand, state.playStyle)) {
      state = declareCeki(state, 0);
      break;
    }
    state = discardCard(state, state.players[0].hand[0].id);
  } else {
    const target = getNgejukTarget(state);
    const choice = decideBotDraw(active, target?.card, state.playStyle);
    state = choice === 'ngejuk' && target ? drawFromStock(state) : drawFromStock(state);
    if (state.phase === 'round_over') break;
    if (findWinningMelds(state.players[state.currentPlayerIndex].hand, state.playStyle)) {
      state = declareCeki(state);
      break;
    }
    const disc = decideBotDiscard(state.players[state.currentPlayerIndex], state);
    state = discardCard(state, disc.id);
  }
}

// 6. Regression tests: engine guards against illegal actions & turn-phase transitions
{
  let guardState = startRoundAtSeat0();
  const initialStock = guardState.stock.length;
  const initialHist = guardState.history.length;

  // Discard before draw (hand has 11 cards, phase awaiting_draw) -> must be no-op
  const illegalDiscardEarly = discardCard(guardState, guardState.players[0].hand[0].id);
  assert.equal(illegalDiscardEarly, guardState, 'Discard before draw must return unchanged state');
  assert.equal(guardState.players[0].hand.length, 11);

  // Accept/discard pending when pendingDrawnCard is null -> must be no-op
  assert.equal(acceptPendingDrawnCard(guardState), guardState, 'Accept without pending must be no-op');
  assert.equal(discardPendingDrawnCard(guardState), guardState, 'Discard pending without pending must be no-op');

  // Valid draw
  guardState = drawFromStock(guardState);
  assert.equal(guardState.stock.length, initialStock - 1);
  assert.equal(guardState.phase, 'awaiting_discard');

  // Double draw -> must be no-op (stock & history unchanged)
  const doubleDraw = drawFromStock(guardState);
  assert.equal(doubleDraw, guardState, 'Double drawFromStock must return unchanged state');
  assert.equal(doubleDraw.stock.length, initialStock - 1);
  assert.equal(doubleDraw.history.length, initialHist + 1);

  // Ngejuk after already drawing -> must be no-op
  assert.equal(ngejukDiscard(guardState), guardState, 'Ngejuk while awaiting_discard must be no-op');

  // Discard from hand while pendingDrawnCard is still unaccepted -> must be no-op
  const discardWithPending = discardCard(guardState, guardState.players[0].hand[0].id);
  assert.equal(discardWithPending, guardState, 'Discard from hand while pending card exists must be no-op');

  // Accept pending -> discard valid card -> transitions to bot 1 (botStep: draw)
  guardState = acceptPendingDrawnCard(guardState);
  assert.equal(guardState.players[0].hand.length, 12);
  guardState = discardCard(guardState, guardState.players[0].hand[0].id);
  assert.equal(guardState.currentPlayerIndex, 1);
  assert.equal(guardState.phase, 'bot_thinking');
  assert.equal(guardState.botStep, 'draw');

  // Bot cannot discard before drawing
  const botEarlyDiscard = discardCard(guardState, guardState.players[1].hand[0].id);
  assert.equal(botEarlyDiscard, guardState, 'Bot discard during draw step must be no-op');

  // Bot draws (or ngejuks) -> transitions to botStep: discard
  const stockBeforeBot = guardState.stock.length;
  guardState = drawFromStock(guardState);
  assert.equal(guardState.stock.length, stockBeforeBot - 1);
  assert.equal(guardState.botStep, 'discard');
  assert.equal(guardState.players[1].hand.length, 12);

  // Bot cannot draw twice
  assert.equal(drawFromStock(guardState), guardState, 'Bot double draw must be no-op');

  // Bot discards -> transitions to player 2 (botStep: draw)
  guardState = discardCard(guardState, guardState.players[1].hand[0].id);
  assert.equal(guardState.currentPlayerIndex, 2);
  assert.equal(guardState.phase, 'bot_thinking');
  assert.equal(guardState.botStep, 'draw');

  // Declare Ceki with invalid 11-card hand or wrong player -> must be no-op
  assert.equal(declareCeki(guardState, 2), guardState, 'Declare Ceki during draw step must be no-op');
  assert.equal(declareCeki(guardState, 0), guardState, 'Declare Ceki by non-current player must be no-op');
}

// 7. Lawang rule tests: 2 identical cards + 1 card from the same familyId (se-ekor)
{
  // Gade (tong9, family 1) x2 + Teje (sok9, family 1) -> Lawang
  assert.equal(
    classifyThreeCards(makeCard('tong9', 1), makeCard('tong9', 2), makeCard('sok9', 1)),
    'lawang',
    '2 identical cards + 1 same-family card must be Lawang'
  );
  // Order-independent (single card first)
  assert.equal(
    classifyThreeCards(makeCard('sok9', 1), makeCard('tong9', 1), makeCard('tong9', 2)),
    'lawang',
    'Lawang must be recognized regardless of card order'
  );
  // Different family -> NOT Lawang
  assert.equal(
    classifyThreeCards(makeCard('tong9', 1), makeCard('tong9', 2), makeCard('tong1', 1)),
    null,
    '2 identical cards + 1 different-family card must NOT be Lawang'
  );

  const lawangWinningHand: CardInstance[] = [
    // Lawang 1: 2x Gade (tong9) + 1x Teje (sok9)
    makeCard('tong9', 1), makeCard('tong9', 2), makeCard('sok9', 1),
    // Soca 1: 3x Cine (ban1)
    makeCard('ban1', 1), makeCard('ban1', 2), makeCard('ban1', 3),
    // Soca 2: 3x Cawang (tong2)
    makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
    // Serigat: Gunung (tong4), Jarum (sok4), Jebung 3 (ban4)
    makeCard('tong4', 1), makeCard('sok4', 1), makeCard('ban4', 1),
  ];
  const lawangWin = findWinningMelds(lawangWinningHand, 'nyari');
  assert.ok(lawangWin !== null && lawangWin.length === 4, 'Winning hand with Lawang melds + 2 Soca must succeed');
  assert.ok(lawangWin.some((m) => m.type === 'lawang'), 'Solution must include Lawang meld');

  // 11-card hand missing Teje (sok9) or Gade (tong9) should wait on both for Lawang/Soca (already has 2 Soca)
  const lawangWaits = getNyagaWaits(lawangWinningHand.filter((c) => c.key !== 'sok9'), 'nyari');
  assert.ok(lawangWaits.includes('sok9') && lawangWaits.includes('ban9'), 'Nyaga waits should include Lawang completions');

  // 1 Soca + 3 Lawang must NOT win Ceki (minimum 2 Soca required)
  const oneSocaThreeLawang: CardInstance[] = [
    makeCard('tong9', 1), makeCard('tong9', 2), makeCard('sok9', 1),
    makeCard('ban1', 1), makeCard('ban1', 2), makeCard('old_thousand', 1),
    makeCard('tong4', 1), makeCard('tong4', 2), makeCard('sok4', 1),
    makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
  ];
  assert.equal(findWinningMelds(oneSocaThreeLawang, 'nyari'), null, '1 Soca + 3 Lawang must NOT win Ceki (requires >= 2 Soca)');
}

// 8. Kinci, Kobar, Cine family + Kupak Nyari immediate win test
{
  assert.equal(
    classifyThreeCards(makeCard('ban1', 1), makeCard('red_flower', 1), makeCard('old_thousand', 1)),
    'serigat',
    'Cine (ban1) + Kinci (red_flower) + Kobar (old_thousand) must form Serigat'
  );
  assert.equal(
    classifyThreeCards(makeCard('red_flower', 1), makeCard('red_flower', 2), makeCard('old_thousand', 1)),
    'lawang',
    '2x Kinci + 1x Kobar must form Lawang'
  );

  // Kupak Nyari: Player 0 has 11 cards waiting on Kobar (old_thousand); Player 1 draws Kobar from stock -> Player 0 wins!
  let kupakState = startNewRound(undefined, 'nyari');
  const p0Nyari11: CardInstance[] = [
    makeCard('tong9', 1), makeCard('tong9', 2), makeCard('tong9', 3),
    makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
    makeCard('tong4', 1), makeCard('sok4', 1), makeCard('ban4', 1),
    makeCard('ban1', 1), makeCard('red_flower', 1),
  ];
  kupakState = {
    ...kupakState,
    currentPlayerIndex: 1,
    phase: 'bot_thinking',
    botStep: 'draw',
    stock: [makeCard('old_thousand', 4)],
    players: kupakState.players.map((p, idx) =>
      idx === 0 ? { ...p, hand: p0Nyari11 } : p
    ),
  };
  kupakState = drawFromStock(kupakState);
  assert.equal(kupakState.phase, 'round_over', 'Kupak Nyari must end round immediately when opened card matches Nyari player');
  assert.equal(kupakState.winnerId, 0, 'Nyari player (0) must win via Kupak');
  assert.equal(kupakState.players[0].score, 10, 'Kupak Nyari winner must receive +10 points');
  assert.equal(kupakState.winKind, 'kupak');
}

// 9. Cepe/Lojor/Likas (Family 4), Mecari (1 Soca, exact), Mejaga (2+ Soca, family), Ngandang
{
  assert.equal(
    classifyThreeCards(makeCard('white_flower', 1), makeCard('sok1', 1), makeCard('tong1', 1)),
    'serigat',
    'Cepe (white_flower) + Lojor (sok1) + Likas (tong1) must form Serigat in Family 4'
  );

  // Mecari (1 Soca in 11 cards) under 'nyari': 1 Soca (tong2 x3) + 2 Serigat + pair (ban1 x2)
  // Only exact 'ban1' completes 2nd Soca; same-family 'red_flower' only makes Lawang (1 Soca) so it must NOT win in Mecari
  const mecari11: CardInstance[] = [
    makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
    makeCard('white_flower', 1), makeCard('sok1', 1), makeCard('tong1', 1),
    makeCard('tong4', 1), makeCard('sok4', 1), makeCard('ban4', 1),
    makeCard('ban1', 1), makeCard('ban1', 2),
  ];
  const mecariStatus = getReadyStatus(mecari11, 'nyari');
  assert.equal(mecariStatus.mode, 'mecari', '1 Soca ready hand must be Mecari');
  assert.ok(checkWinWithCard(mecari11, makeCard('ban1', 3), 'nyari') !== null, 'Exact card wins in Mecari');
  assert.equal(checkWinWithCard(mecari11, makeCard('red_flower', 1), 'nyari'), null, 'Non-exact same-family card must NOT win in Mecari');

  // Hand with 0 Soca cannot enter Mecari or win
  const zeroSoca11: CardInstance[] = [
    makeCard('tong9', 1), makeCard('sok9', 1), makeCard('ban9', 1),
    makeCard('white_flower', 1), makeCard('sok1', 1), makeCard('tong1', 1),
    makeCard('tong4', 1), makeCard('sok4', 1), makeCard('ban4', 1),
    makeCard('ban1', 1), makeCard('red_flower', 1),
  ];
  assert.equal(getReadyStatus(zeroSoca11, 'nyari').mode, null, '0 Soca cannot be Mecari or Mejaga');
  assert.equal(findWinningMelds([...zeroSoca11, makeCard('old_thousand', 1)], 'nyari'), null, '0 Soca hand cannot win');

  // Mejaga: 2 Soca + 1 Serigat + incomplete Family 9 (ban1 + red_flower)
  const mejaga11: CardInstance[] = [
    makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
    makeCard('tong9', 1), makeCard('tong9', 2), makeCard('tong9', 3),
    makeCard('white_flower', 1), makeCard('sok1', 1), makeCard('tong1', 1),
    makeCard('ban1', 1), makeCard('red_flower', 1),
  ];
  const mejagaStatus = getReadyStatus(mejaga11, 'soca');
  assert.equal(mejagaStatus.mode, 'mejaga', '2+ Soca ready hand must be Mejaga');
  const mejagaFamilyWin = checkWinWithCard(mejaga11, makeCard('ban1', 2), 'soca');
  assert.ok(mejagaFamilyWin !== null && mejagaFamilyWin.mode === 'mejaga', 'Mejaga must allow winning with any card in same family');

  // Ngandang: Player 0 is in Mecari/Mejaga and draws own winning card
  let ngandangState = startNewRound(undefined, 'nyari');
  ngandangState = {
    ...ngandangState,
    currentPlayerIndex: 0,
    phase: 'awaiting_draw',
    stock: [makeCard('ban1', 4)],
    players: ngandangState.players.map((p, idx) =>
      idx === 0 ? { ...p, hand: mejaga11 } : p
    ),
  };
  ngandangState = drawFromStock(ngandangState);
  assert.equal(ngandangState.phase, 'awaiting_discard', 'Active player drawing own winning card waits to declare Ceki/Ngandang');
  ngandangState = declareCeki(ngandangState, 0);
  assert.equal(ngandangState.phase, 'round_over');
  assert.equal(ngandangState.winKind, 'ngandang', 'Self-drawn win while Mecari/Mejaga must be recorded as Ngandang');
}

// 10. Ngenen forbidden from Ngejuk / hand discard (must be from Tumpukan/Kupak) + random starter
{
  const randRound = startNewRound(undefined, 'nyari');
  assert.ok(randRound.currentPlayerIndex >= 0 && randRound.currentPlayerIndex < 5);
  const expectedPrev = (randRound.currentPlayerIndex + 4) % 5;
  assert.equal(randRound.lastDiscardPlayerIndex, expectedPrev);
  assert.equal(randRound.players[expectedPrev].discards.length, 1);

  const mejaga11: CardInstance[] = [
    makeCard('tong2', 1), makeCard('tong2', 2), makeCard('tong2', 3),
    makeCard('tong9', 1), makeCard('tong9', 2), makeCard('tong9', 3),
    makeCard('white_flower', 1), makeCard('sok1', 1), makeCard('tong1', 1),
    makeCard('ban1', 1), makeCard('red_flower', 1),
  ];

  // Player 0 tries to Ngejuk old_thousand (which completes 12-card hand) and declare Ceki -> MUST be blocked
  let ngejukWinAttempt = startRoundAtSeat0();
  ngejukWinAttempt = {
    ...ngejukWinAttempt,
    players: ngejukWinAttempt.players.map((p, idx) =>
      idx === 0
        ? { ...p, hand: mejaga11 }
        : idx === 4
          ? { ...p, discards: [makeCard('old_thousand', 4)] }
          : p
    ),
  };
  ngejukWinAttempt = ngejukDiscard(ngejukWinAttempt);
  assert.equal(ngejukWinAttempt.lastDrawSource, 'ngejuk');
  const blockedCeki = declareCeki(ngejukWinAttempt, 0);
  assert.equal(blockedCeki.phase, 'awaiting_discard', 'Ngenen via Ngejuk/buangan must NOT be allowed');

  // Cancel Ngejuk returns the card back to player 4's discards and restores awaiting_draw
  const cancelledNgejuk = cancelNgejuk(ngejukWinAttempt);
  assert.equal(cancelledNgejuk.phase, 'awaiting_draw');
  assert.equal(cancelledNgejuk.pendingDrawnCard, null);
  assert.equal(cancelledNgejuk.lastDiscardPlayerIndex, 4);
  assert.equal(cancelledNgejuk.players[4].discards[0].key, 'old_thousand');

  // Player 1 discards old_thousand from hand while Player 0 is waiting on it -> must NOT trigger Kupak/Ngenen
  let discardNoWin = startNewRound(undefined, 'nyari');
  const discardCardObj = makeCard('old_thousand', 3);
  discardNoWin = {
    ...discardNoWin,
    currentPlayerIndex: 1,
    phase: 'bot_thinking',
    botStep: 'discard',
    players: discardNoWin.players.map((p, idx) =>
      idx === 0
        ? { ...p, hand: mejaga11 }
        : idx === 1
          ? { ...p, hand: [...p.hand, discardCardObj] }
          : p
    ),
  };
  discardNoWin = discardCard(discardNoWin, discardCardObj.id);
  assert.notEqual(discardNoWin.phase, 'round_over', 'Discarding a card from hand must NEVER trigger Ngenen/Kupak');
}

// 11. Open Ngejuk (Jukjukan) & Anti-Ngutang-Ngejuk tournament rules
{
  // Anti-ngutang-ngejuk: player 0 already discarded tong5, so cannot ngejuk tong5 from player 4
  let ngutangState = startNewRound(undefined, 'nyari');
  ngutangState = {
    ...ngutangState,
    currentPlayerIndex: 0,
    phase: 'awaiting_draw',
    lastDiscardPlayerIndex: 4,
    players: ngutangState.players.map((p, idx) =>
      idx === 0
        ? { ...p, discards: [makeCard('tong5', 1)] }
        : idx === 4
          ? { ...p, discards: [makeCard('tong5', 2)] }
          : p
    ),
  };
  assert.equal(getNgejukTarget(ngutangState), null, 'Cannot ngejuk a card key already discarded by self');

  // Open Ngejuk card: accepted ngejuk card is added to openNgejukCards and blocked from discard unless Nyari
  const nonNyari11 = [
    makeCard('tong2', 1), makeCard('tong3', 1), makeCard('tong4', 1),
    makeCard('sok2', 1), makeCard('sok3', 1), makeCard('sok4', 1),
    makeCard('ban2', 1), makeCard('ban3', 1), makeCard('ban4', 1),
    makeCard('tong6', 1), makeCard('sok7', 1),
  ];
  const jukCard = makeCard('ban9', 9);
  let openState = startNewRound(undefined, 'nyari');
  openState = {
    ...openState,
    currentPlayerIndex: 0,
    phase: 'awaiting_draw',
    lastDiscardPlayerIndex: 4,
    players: openState.players.map((p, idx) =>
      idx === 0
        ? { ...p, hand: nonNyari11, discards: [] }
        : idx === 4
          ? { ...p, discards: [jukCard] }
          : p
    ),
  };
  openState = ngejukDiscard(openState);
  openState = acceptPendingDrawnCard(openState, true);
  assert.equal(openState.players[0].openNgejukCards.length, 1, 'Accepted ngejuk card must be recorded as open');
  assert.equal(canDiscardCard(openState, 0, jukCard.id), false, 'Open ngejuk card cannot be discarded when not Nyari');
  const blockedDiscard = discardCard(openState, jukCard.id, true);
  assert.equal(blockedDiscard, openState, 'discardCard must block discarding open ngejuk card when not Nyari');

  // When discarding the open ngejuk card puts player into Nyari (Mejaga), it MUST be allowed
  const nyariBase11 = [
    makeCard('tong1', 1), makeCard('tong1', 2), makeCard('tong1', 3),
    makeCard('sok1', 1), makeCard('sok1', 2), makeCard('sok1', 3),
    makeCard('ban2', 1), makeCard('ban2', 2), makeCard('sok2', 1),
    makeCard('tong5', 1), makeCard('tong5', 2),
  ];
  let nyariOpenState = startNewRound(undefined, 'nyari');
  nyariOpenState = {
    ...nyariOpenState,
    currentPlayerIndex: 0,
    phase: 'awaiting_discard',
    lastDrawSource: 'ngejuk',
    players: nyariOpenState.players.map((p, idx) =>
      idx === 0
        ? { ...p, hand: [...nyariBase11, jukCard], openNgejukCards: [jukCard] }
        : p
    ),
  };
  assert.equal(canDiscardCard(nyariOpenState, 0, jukCard.id), true, 'Open ngejuk card CAN be discarded when it triggers Nyari');
}

console.log('All 5-player Ceki Bali (Soca/Serigat/Nyari) tests passed!');
