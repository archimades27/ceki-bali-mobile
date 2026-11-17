import { CARD_DEFS_LIST, sortHand } from './deck.ts';
import type { CardInstance, CardKey, Meld, MeldType, PlayStyle } from './types.ts';

function isValidWinForStyle(melds: Meld[], playStyle: PlayStyle): boolean {
  if (melds.length !== 4) return false;
  const socaCount = melds.filter((m) => m.type === 'soca').length;
  if (socaCount < 2) return false; // Wajib minimal 2 Soca untuk Ceki / Ngenen
  if (playStyle === 'soca') {
    return socaCount >= 2;
  }
  if (playStyle === 'serigat') {
    return melds.filter((m) => m.type === 'serigat').length >= 2;
  }
  return true; // 'nyari': minimal 2 Soca + sisanya Soca / Serigat / Lawang
}

/**
 * Exact backtracking solver for a 12-card winning Ceki hand (4 melds of 3 cards),
 * respecting the active PlayStyle ('soca' | 'serigat' | 'nyari').
 */
export function findWinningMelds(
  cards: CardInstance[],
  playStyle: PlayStyle = 'nyari'
): Meld[] | null {
  if (cards.length !== 12) return null;
  const sorted = sortHand(cards);
  const allSolutions: Meld[][] = [];
  collectExactSolutions(sorted, [], allSolutions, 12);
  for (const sol of allSolutions) {
    if (isValidWinForStyle(sol, playStyle)) {
      return sol;
    }
  }
  return null;
}

function collectExactSolutions(
  remaining: CardInstance[],
  acc: Meld[],
  out: Meld[][],
  maxSolutions: number
): void {
  if (out.length >= maxSolutions) return;
  if (remaining.length === 0) {
    out.push(acc);
    return;
  }

  const first = remaining[0];
  const rest = remaining.slice(1);

  // 1. Soca (3 identical cards)
  const sameIndices: number[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].key === first.key) {
      sameIndices.push(i);
      if (sameIndices.length === 2) break;
    }
  }
  if (sameIndices.length === 2) {
    const nextRemaining = rest.filter((_, idx) => idx !== sameIndices[0] && idx !== sameIndices[1]);
    collectExactSolutions(
      nextRemaining,
      [...acc, { type: 'soca', cards: [first, rest[sameIndices[0]], rest[sameIndices[1]]] }],
      out,
      maxSolutions
    );
  }

  // 2. Serigat (3 distinct cards from the same Tabel 1 familyId)
  const familyPeers = rest.filter((c) => c.familyId === first.familyId && c.key !== first.key);
  const distinctKeys = Array.from(new Set(familyPeers.map((c) => c.key)));
  if (distinctKeys.length >= 2) {
    const idxA = rest.findIndex((c) => c.key === distinctKeys[0]);
    const idxB = rest.findIndex((c) => c.key === distinctKeys[1]);
    if (idxA !== -1 && idxB !== -1) {
      const nextRemaining = rest.filter((_, idx) => idx !== idxA && idx !== idxB);
      collectExactSolutions(
        nextRemaining,
        [...acc, { type: 'serigat', cards: [first, rest[idxA], rest[idxB]] }],
        out,
        maxSolutions
      );
    }
  }

  // 3a. Lawang where `first` is part of the 2 identical cards + 1 same-family card
  if (sameIndices.length >= 1 && distinctKeys.length >= 1) {
    const pairIdx = sameIndices[0];
    for (const otherKey of distinctKeys) {
      const otherIdx = rest.findIndex((c) => c.key === otherKey);
      if (otherIdx !== -1) {
        const nextRemaining = rest.filter((_, idx) => idx !== pairIdx && idx !== otherIdx);
        collectExactSolutions(
          nextRemaining,
          [...acc, { type: 'lawang', cards: [first, rest[pairIdx], rest[otherIdx]] }],
          out,
          maxSolutions
        );
      }
    }
  }

  // 3b. Lawang where `first` is the 1 same-family card + 2 identical cards of another key
  for (const otherKey of distinctKeys) {
    const pairIndices: number[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].key === otherKey) {
        pairIndices.push(i);
        if (pairIndices.length === 2) break;
      }
    }
    if (pairIndices.length === 2) {
      const nextRemaining = rest.filter((_, idx) => idx !== pairIndices[0] && idx !== pairIndices[1]);
      collectExactSolutions(
        nextRemaining,
        [...acc, { type: 'lawang', cards: [first, rest[pairIndices[0]], rest[pairIndices[1]]] }],
        out,
        maxSolutions
      );
    }
  }
}

/**
 * Finds the maximum number of disjoint 3-card melds in any hand (e.g. 11 cards).
 */
const MELD_PRIORITY: Record<MeldType, number> = {
  soca: 0,
  lawang: 1,
  serigat: 2,
};

export function findBestPartialMelds(
  cards: CardInstance[],
  playStyle: PlayStyle = 'nyari'
): {
  melds: Meld[];
  leftover: CardInstance[];
} {
  const sorted = sortHand(cards);
  const res = solvePartial(sorted, playStyle);
  const orderedMelds = [...res.melds].sort((a, b) => {
    const pDiff = MELD_PRIORITY[a.type] - MELD_PRIORITY[b.type];
    if (pDiff !== 0) return pDiff;
    return (a.cards[0]?.familyId ?? 0) - (b.cards[0]?.familyId ?? 0);
  });
  return {
    melds: orderedMelds,
    leftover: sortHand(res.leftover),
  };
}

function scoreMeldsForStyle(melds: Meld[], playStyle: PlayStyle): number {
  let score = 0;
  for (const m of melds) {
    // Priority order: Soca > Lawang > Serigat
    score += m.type === 'soca' ? 120 : m.type === 'lawang' ? 110 : 100;
    if (playStyle === 'soca' && m.type === 'soca') score += 35;
    if (playStyle === 'serigat' && m.type === 'serigat') score += 35;
  }
  return score;
}

function solvePartial(
  remaining: CardInstance[],
  playStyle: PlayStyle
): { melds: Meld[]; leftover: CardInstance[] } {
  if (remaining.length < 3) {
    return { melds: [], leftover: remaining };
  }

  const first = remaining[0];
  const rest = remaining.slice(1);

  // Option A: skip `first`
  const skipped = solvePartial(rest, playStyle);
  let best = { melds: skipped.melds, leftover: [first, ...skipped.leftover] };

  // Option B: Soca
  const sameIndices: number[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].key === first.key) {
      sameIndices.push(i);
      if (sameIndices.length === 2) break;
    }
  }
  if (sameIndices.length === 2) {
    const nextRem = rest.filter((_, idx) => idx !== sameIndices[0] && idx !== sameIndices[1]);
    const sub = solvePartial(nextRem, playStyle);
    const candMelds: Meld[] = [
      { type: 'soca', cards: [first, rest[sameIndices[0]], rest[sameIndices[1]]] },
      ...sub.melds,
    ];
    if (scoreMeldsForStyle(candMelds, playStyle) > scoreMeldsForStyle(best.melds, playStyle)) {
      best = { melds: candMelds, leftover: sub.leftover };
    }
  }

  // Option C: Serigat (Tabel 1 family)
  const familyPeers = rest.filter((c) => c.familyId === first.familyId && c.key !== first.key);
  const distinctKeys = Array.from(new Set(familyPeers.map((c) => c.key)));
  if (distinctKeys.length >= 2) {
    const idxA = rest.findIndex((c) => c.key === distinctKeys[0]);
    const idxB = rest.findIndex((c) => c.key === distinctKeys[1]);
    if (idxA !== -1 && idxB !== -1) {
      const nextRem = rest.filter((_, idx) => idx !== idxA && idx !== idxB);
      const sub = solvePartial(nextRem, playStyle);
      const candMelds: Meld[] = [
        { type: 'serigat', cards: [first, rest[idxA], rest[idxB]] },
        ...sub.melds,
      ];
      if (scoreMeldsForStyle(candMelds, playStyle) > scoreMeldsForStyle(best.melds, playStyle)) {
        best = { melds: candMelds, leftover: sub.leftover };
      }
    }
  }

  // Option D: Lawang (2 identical + 1 different card from same familyId)
  if (sameIndices.length >= 1 && distinctKeys.length >= 1) {
    const pairIdx = sameIndices[0];
    for (const otherKey of distinctKeys) {
      const otherIdx = rest.findIndex((c) => c.key === otherKey);
      if (otherIdx !== -1) {
        const nextRem = rest.filter((_, idx) => idx !== pairIdx && idx !== otherIdx);
        const sub = solvePartial(nextRem, playStyle);
        const candMelds: Meld[] = [
          { type: 'lawang', cards: [first, rest[pairIdx], rest[otherIdx]] },
          ...sub.melds,
        ];
        if (scoreMeldsForStyle(candMelds, playStyle) > scoreMeldsForStyle(best.melds, playStyle)) {
          best = { melds: candMelds, leftover: sub.leftover };
        }
      }
    }
  }
  for (const otherKey of distinctKeys) {
    const pairIndices: number[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].key === otherKey) {
        pairIndices.push(i);
        if (pairIndices.length === 2) break;
      }
    }
    if (pairIndices.length === 2) {
      const nextRem = rest.filter((_, idx) => idx !== pairIndices[0] && idx !== pairIndices[1]);
      const sub = solvePartial(nextRem, playStyle);
      const candMelds: Meld[] = [
        { type: 'lawang', cards: [first, rest[pairIndices[0]], rest[pairIndices[1]]] },
        ...sub.melds,
      ];
      if (scoreMeldsForStyle(candMelds, playStyle) > scoreMeldsForStyle(best.melds, playStyle)) {
        best = { melds: candMelds, leftover: sub.leftover };
      }
    }
  }

  return best;
}

export type ReadyMode = 'mecari' | 'mejaga' | null;

/**
 * Evaluates whether an 11-card hand is in:
 * - "mecari" (1 Soca in hand, exact card required to win)
 * - "mejaga" (>= 2 Soca in hand, any card in the same familyId can win)
 */
export function getReadyStatus(
  hand11: CardInstance[],
  playStyle: PlayStyle = 'nyari'
): { mode: ReadyMode; waits: CardKey[] } {
  if (hand11.length !== 11) return { mode: null, waits: [] };

  const socaCountIn11 = findBestPartialMelds(hand11, 'soca')
    .melds.filter((m) => m.type === 'soca').length;
  if (socaCountIn11 < 1) {
    return { mode: null, waits: [] };
  }

  const exactWaits: CardKey[] = [];
  const waitFamilies = new Set<number>();
  for (const def of CARD_DEFS_LIST) {
    const testCard: CardInstance = {
      id: `test_${def.key}`,
      key: def.key,
      suit: def.suit,
      rank: def.rank,
      familyId: def.familyId,
    };
    if (findWinningMelds([...hand11, testCard], playStyle) !== null) {
      exactWaits.push(def.key);
      waitFamilies.add(def.familyId);
    }
  }

  if (exactWaits.length === 0) {
    return { mode: null, waits: [] };
  }

  if (socaCountIn11 >= 2) {
    const familyWaits = CARD_DEFS_LIST
      .filter((d) => waitFamilies.has(d.familyId))
      .map((d) => d.key);
    return { mode: 'mejaga', waits: familyWaits };
  }

  return { mode: 'mecari', waits: exactWaits };
}

/**
 * Checks whether `candidateCard` completes a win for an 11-card hand under
 * Mecari (1 Soca, exact card only) or Mejaga (>= 2 Soca, same-family card allowed).
 */
export function checkWinWithCard(
  hand11: CardInstance[],
  candidateCard: CardInstance,
  playStyle: PlayStyle = 'nyari'
): { mode: 'mecari' | 'mejaga'; melds: Meld[] } | null {
  const status = getReadyStatus(hand11, playStyle);
  if (!status.mode || !status.waits.includes(candidateCard.key)) {
    return null;
  }

  const direct = findWinningMelds([...hand11, candidateCard], playStyle);
  if (direct) {
    return { mode: status.mode, melds: direct };
  }

  // In Mejaga (>= 2 Soca), any card of the same familyId as an exact wait can close the hand
  if (status.mode === 'mejaga') {
    for (const def of CARD_DEFS_LIST) {
      if (def.familyId !== candidateCard.familyId) continue;
      const testCard: CardInstance = {
        id: `test_${def.key}`,
        key: def.key,
        suit: def.suit,
        rank: def.rank,
        familyId: def.familyId,
      };
      const sol = findWinningMelds([...hand11, testCard], playStyle);
      if (sol) {
        const replaced = sol.map((m) => ({
          ...m,
          cards: m.cards.map((c) => (c.id === testCard.id ? candidateCard : c)),
        }));
        return { mode: 'mejaga', melds: replaced };
      }
    }
  }

  return null;
}

/**
 * Returns all CardKeys that would complete a winning 12-card hand if added to this 11-card hand.
 * Non-empty result means the player is in "Mecari" (1 Soca) or "Mejaga" (>= 2 Soca).
 */
export function getNyagaWaits(
  hand11: CardInstance[],
  playStyle: PlayStyle = 'nyari'
): CardKey[] {
  return getReadyStatus(hand11, playStyle).waits;
}

/**
 * Heuristic score for an 11-card hand (higher is closer to winning).
 */
export function evaluateHandScore(
  cards: CardInstance[],
  playStyle: PlayStyle = 'nyari'
): number {
  const { melds, leftover } = findBestPartialMelds(cards, playStyle);
  let score = scoreMeldsForStyle(melds, playStyle);

  const used = new Set<number>();
  for (let i = 0; i < leftover.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < leftover.length; j++) {
      if (used.has(j)) continue;
      const a = leftover[i];
      const b = leftover[j];
      if (a.key === b.key) {
        score += playStyle === 'soca' ? 32 : 22;
        used.add(i);
        used.add(j);
        break;
      }
      if (a.familyId === b.familyId && a.key !== b.key) {
        score += playStyle === 'serigat' ? 30 : 22;
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  for (const c of leftover) {
    if (c.suit !== 'honor' && c.rank >= 3 && c.rank <= 7) {
      score += 2;
    }
  }

  return score;
}

export interface CardHintInfo {
  tag: string;
  detail: string;
}

/**
 * Analyzes ungrouped (leftover) cards in the player's hand to surface
 * Calon Soca (pairs) and Calon Serigat (2 cards of the same Tabel 1 family).
 */
export function analyzeLeftoverHints(leftover: CardInstance[]): Map<string, CardHintInfo> {
  const hints = new Map<string, CardHintInfo>();

  // 1. Check Calon Soca (2 identical cards)
  const byKey = new Map<CardKey, CardInstance[]>();
  for (const c of leftover) {
    const arr = byKey.get(c.key) ?? [];
    arr.push(c);
    byKey.set(c.key, arr);
  }
  for (const [key, cards] of byKey) {
    if (cards.length === 2) {
      const def = CARD_DEFS_LIST.find((d) => d.key === key);
      const name = def?.balineseName ?? key;
      for (const c of cards) {
        hints.set(c.id, {
          tag: 'PASANG',
          detail: `Calon Soca / Lawang • Butuh 1 ${name} atau se-ekornya`,
        });
      }
    }
  }

  // 2. Check Calon Serigat (2 distinct cards from the same Tabel 1 family)
  const byFamily = new Map<number, CardInstance[]>();
  for (const c of leftover) {
    const arr = byFamily.get(c.familyId) ?? [];
    arr.push(c);
    byFamily.set(c.familyId, arr);
  }
  for (const [familyId, cards] of byFamily) {
    const distinctKeys = new Set(cards.map((c) => c.key));
    if (distinctKeys.size === 2) {
      const familyDefs = CARD_DEFS_LIST.filter((d) => d.familyId === familyId);
      const missing = familyDefs.find((d) => !distinctKeys.has(d.key));
      const missingName = missing?.balineseName ?? 'pasangannya';
      for (const c of cards) {
        if (!hints.has(c.id)) {
          hints.set(c.id, {
            tag: 'SERIGAT?',
            detail: `Calon Serigat • Butuh ${missingName}`,
          });
        }
      }
    }
  }

  return hints;
}

/**
 * Checks if 3 cards form a valid Soca, Serigat, or Lawang.
 */
export function classifyThreeCards(a: CardInstance, b: CardInstance, c: CardInstance): MeldType | null {
  if (a.key === b.key && b.key === c.key) {
    return 'soca';
  }
  if (a.familyId === b.familyId && b.familyId === c.familyId) {
    const distinct = new Set([a.key, b.key, c.key]).size;
    if (distinct === 3) return 'serigat';
    if (distinct === 2) return 'lawang';
  }
  return null;
}

/**
 * Detects contiguous 3-card melds in a manually ordered hand (left-to-right).
 */
export function detectContiguousMelds(cards: CardInstance[]): Map<string, { groupIndex: number; type: MeldType }> {
  const result = new Map<string, { groupIndex: number; type: MeldType }>();
  let groupIndex = 0;
  let i = 0;
  while (i <= cards.length - 3) {
    const type = classifyThreeCards(cards[i], cards[i + 1], cards[i + 2]);
    if (type) {
      result.set(cards[i].id, { groupIndex, type });
      result.set(cards[i + 1].id, { groupIndex, type });
      result.set(cards[i + 2].id, { groupIndex, type });
      groupIndex++;
      i += 3;
    } else {
      i++;
    }
  }
  return result;
}
