import type { CardDef, CardInstance, CardKey, Suit } from './types.ts';

const SUIT_ORDER: Record<Suit, number> = {
  tong: 0,
  sok: 1,
  ban: 2,
  honor: 3,
};

const BALINESE_CARD_NAMES: Record<
  CardKey,
  { balineseName: string; shortCode: string; familyId: number }
> = {
  // Tabel 1 Family 1: Gade, Teje, Jering
  tong9: { balineseName: 'Gade', shortCode: 'T9', familyId: 1 },
  sok9: { balineseName: 'Teje', shortCode: 'S9', familyId: 1 },
  ban9: { balineseName: 'Jering', shortCode: 'B9', familyId: 1 },

  // Tabel 1 Family 2: Cawang, Besar, Celek
  tong2: { balineseName: 'Cawang', shortCode: 'T2', familyId: 2 },
  sok2: { balineseName: 'Besar', shortCode: 'S2', familyId: 2 },
  ban2: { balineseName: 'Celek', shortCode: 'B2', familyId: 2 },

  // Tabel 1 Family 3: Kolo, Dengkek, Jebung 2
  tong3: { balineseName: 'Kolo', shortCode: 'T3', familyId: 3 },
  sok3: { balineseName: 'Dengkek', shortCode: 'S3', familyId: 3 },
  ban3: { balineseName: 'Jebung 2', shortCode: 'B3', familyId: 3 },

  // Family 4: Cepe (white_flower), Lojor (sok1), Likas (tong1)
  white_flower: { balineseName: 'Cepe', shortCode: 'CP', familyId: 4 },
  sok1: { balineseName: 'Lojor', shortCode: 'LJ', familyId: 4 },
  tong1: { balineseName: 'Likas', shortCode: 'LK', familyId: 4 },

  // Tabel 1 Family 5: Perahu, Gogos, Polak
  tong5: { balineseName: 'Perahu', shortCode: 'T5', familyId: 5 },
  sok5: { balineseName: 'Gogos', shortCode: 'S5', familyId: 5 },
  ban5: { balineseName: 'Polak', shortCode: 'B5', familyId: 5 },

  // Tabel 1 Family 6: Bendera, Curing, Ringgit
  tong7: { balineseName: 'Bendera', shortCode: 'T7', familyId: 6 },
  sok7: { balineseName: 'Curing', shortCode: 'S7', familyId: 6 },
  ban7: { balineseName: 'Ringgit', shortCode: 'B7', familyId: 6 },

  // Family 7: Gunung (tong4), Jarum (sok4), Jebung 3 (ban4)
  tong4: { balineseName: 'Gunung', shortCode: 'T4', familyId: 7 },
  sok4: { balineseName: 'Jarum', shortCode: 'S4', familyId: 7 },
  ban4: { balineseName: 'Jebung 3', shortCode: 'B4', familyId: 7 },

  // Tabel 1 Family 8: Manis (tong8), Kelepok (sok8), Pesulu (ban8)
  tong8: { balineseName: 'Manis', shortCode: 'T8', familyId: 8 },
  sok8: { balineseName: 'Kelepok', shortCode: 'S8', familyId: 8 },
  ban8: { balineseName: 'Pesulu', shortCode: 'B8', familyId: 8 },

  // Family 9: Cine (ban1), Kinci (red_flower), Kobar (old_thousand)
  ban1: { balineseName: 'Cine', shortCode: '★C', familyId: 9 },
  red_flower: { balineseName: 'Kinci', shortCode: '★K', familyId: 9 },
  old_thousand: { balineseName: 'Kobar', shortCode: '★O', familyId: 9 },

  // Tabel 1 Family 10: Pegat (tong6), Pis 6 (sok6), Mer (ban6)
  tong6: { balineseName: 'Pegat', shortCode: 'T6', familyId: 10 },
  sok6: { balineseName: 'Pis 6', shortCode: 'S6', familyId: 10 },
  ban6: { balineseName: 'Mer', shortCode: 'B6', familyId: 10 },
};

function makeNumberedDefs(suit: 'tong' | 'sok' | 'ban'): CardDef[] {
  const defs: CardDef[] = [];
  for (let rank = 1; rank <= 9; rank++) {
    const key = `${suit}${rank}` as CardKey;
    const meta = BALINESE_CARD_NAMES[key];
    defs.push({
      key,
      suit,
      rank,
      familyId: meta.familyId,
      label: meta.balineseName,
      balineseName: meta.balineseName,
      shortCode: meta.shortCode,
      image: `./cards/${key}.jpg`,
    });
  }
  return defs;
}

export const CARD_DEFS_LIST: CardDef[] = [
  ...makeNumberedDefs('tong'),
  ...makeNumberedDefs('sok'),
  ...makeNumberedDefs('ban'),
  {
    key: 'old_thousand',
    suit: 'honor',
    rank: 1,
    familyId: BALINESE_CARD_NAMES.old_thousand.familyId,
    label: BALINESE_CARD_NAMES.old_thousand.balineseName,
    balineseName: BALINESE_CARD_NAMES.old_thousand.balineseName,
    shortCode: BALINESE_CARD_NAMES.old_thousand.shortCode,
    image: './cards/old_thousand.jpg',
  },
  {
    key: 'white_flower',
    suit: 'honor',
    rank: 2,
    familyId: BALINESE_CARD_NAMES.white_flower.familyId,
    label: BALINESE_CARD_NAMES.white_flower.balineseName,
    balineseName: BALINESE_CARD_NAMES.white_flower.balineseName,
    shortCode: BALINESE_CARD_NAMES.white_flower.shortCode,
    image: './cards/white_flower.jpg',
  },
  {
    key: 'red_flower',
    suit: 'honor',
    rank: 3,
    familyId: BALINESE_CARD_NAMES.red_flower.familyId,
    label: BALINESE_CARD_NAMES.red_flower.balineseName,
    balineseName: BALINESE_CARD_NAMES.red_flower.balineseName,
    shortCode: BALINESE_CARD_NAMES.red_flower.shortCode,
    image: './cards/red_flower.jpg',
  },
];

export const CARD_DEFS: Record<CardKey, CardDef> = Object.fromEntries(
  CARD_DEFS_LIST.map((def) => [def.key, def])
) as Record<CardKey, CardDef>;

export function createDeck(): CardInstance[] {
  const deck: CardInstance[] = [];
  for (const def of CARD_DEFS_LIST) {
    for (let copy = 1; copy <= 4; copy++) {
      deck.push({
        id: `${def.key}_${copy}`,
        key: def.key,
        suit: def.suit,
        rank: def.rank,
        familyId: def.familyId,
      });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function sortHand(cards: CardInstance[]): CardInstance[] {
  return [...cards].sort((a, b) => {
    const famDiff = a.familyId - b.familyId;
    if (famDiff !== 0) return famDiff;
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return a.rank - b.rank;
  });
}
