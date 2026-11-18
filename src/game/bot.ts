import {
  checkWinWithCard,
  evaluateHandScore,
  findBestPartialMelds,
  getNyagaWaits,
} from './melds.ts';
import type { CardInstance, GameState, Player, PlayStyle } from './types.ts';

/**
 * Decides whether a bot should take the previous player's top discard (Ngejuk)
 * instead of drawing from Tumpukan.
 */
export function decideBotDraw(
  player: Player,
  topDiscard: CardInstance | undefined,
  playStyle: PlayStyle = 'nyari',
  nyagaMustNgupak = true
): 'ngejuk' | 'stock' {
  if (!topDiscard) return 'stock';

  const withDiscard = [...player.hand, topDiscard];

  // Mencari (mecari) BOLEH menyambar buangan untuk menang; Nyaga (mejaga) sesuai opsi nyagaMustNgupak
  if (
    (player.readyMode === 'mecari' || (!nyagaMustNgupak && player.readyMode === 'mejaga')) &&
    checkWinWithCard(player.hand, topDiscard, playStyle)
  ) {
    return 'ngejuk';
  }
  if (player.readyMode === 'mejaga' && nyagaMustNgupak) {
    return 'stock';
  }

  const difficulty = player.difficulty ?? 'balanced';
  const currentMelds = findBestPartialMelds(player.hand, playStyle).melds.length;
  const afterBest = findBestPartialMelds(withDiscard, playStyle);

  if (difficulty === 'casual') {
    const countSame = player.hand.filter((c) => c.key === topDiscard.key).length;
    return countSame >= 2 ? 'ngejuk' : 'stock';
  }

  if (afterBest.melds.length > currentMelds) {
    return 'ngejuk';
  }

  if (difficulty === 'strategic') {
    for (let i = 0; i < withDiscard.length; i++) {
      if (withDiscard[i].id === topDiscard.id) continue;
      const candidate11 = withDiscard.filter((_, idx) => idx !== i);
      if (getNyagaWaits(candidate11, playStyle).length > 0) {
        return 'ngejuk';
      }
    }
  }

  return 'stock';
}

/**
 * Chooses the best card for a bot to discard from its 12-card hand.
 */
export function decideBotDiscard(player: Player, state: GameState): CardInstance {
  const hand = player.hand;
  const difficulty = player.difficulty ?? 'balanced';
  const playStyle = state.playStyle;

  // Count how many copies of each key are already visible across all 5 players' discards
  const seenCounts = new Map<string, number>();
  for (const p of state.players) {
    for (const c of p.discards) {
      seenCounts.set(c.key, (seenCounts.get(c.key) ?? 0) + 1);
    }
  }

  let bestCard = hand[0];
  let bestScore = -Infinity;
  const openIds = new Set((player.openNgejukCards ?? []).map((c) => c.id));

  for (let i = 0; i < hand.length; i++) {
    const candidateDiscard = hand[i];
    const remaining11 = hand.filter((_, idx) => idx !== i);
    const waits = getNyagaWaits(remaining11, playStyle);

    // Open Ngejuk card cannot be discarded unless it puts the player into Nyari
    if (openIds.has(candidateDiscard.id) && waits.length === 0) {
      continue;
    }

    let score = evaluateHandScore(remaining11, playStyle);

    // Huge bonus if remaining 11 cards are in Nyari / Nyaga (ready to win)
    if (waits.length > 0) {
      let availableCopies = 0;
      for (const w of waits) {
        const usedInHand = remaining11.filter((c) => c.key === w).length;
        const usedInDiscard = seenCounts.get(w) ?? 0;
        availableCopies += Math.max(0, 4 - usedInHand - usedInDiscard);
      }
      score += 500 + availableCopies * 25;
    }

    if (difficulty === 'strategic') {
      const seen = seenCounts.get(candidateDiscard.key) ?? 0;
      score += seen * 4;
    }

    if (difficulty === 'casual') {
      score += Math.random() * 18;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCard = candidateDiscard;
    }
  }

  return bestCard;
}
