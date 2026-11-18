export type Suit = 'tong' | 'sok' | 'ban' | 'honor';

export type CardKey =
  | 'tong1' | 'tong2' | 'tong3' | 'tong4' | 'tong5' | 'tong6' | 'tong7' | 'tong8' | 'tong9'
  | 'sok1' | 'sok2' | 'sok3' | 'sok4' | 'sok5' | 'sok6' | 'sok7' | 'sok8' | 'sok9'
  | 'ban1' | 'ban2' | 'ban3' | 'ban4' | 'ban5' | 'ban6' | 'ban7' | 'ban8' | 'ban9'
  | 'old_thousand' | 'white_flower' | 'red_flower';

export interface CardDef {
  key: CardKey;
  suit: Suit;
  rank: number;
  familyId: number; // 1..10 from Tabel 1 (Serigat family)
  label: string;
  balineseName: string;
  shortCode: string;
  image: string;
}

export interface CardInstance {
  id: string;
  key: CardKey;
  suit: Suit;
  rank: number;
  familyId: number;
}

export type MeldType = 'soca' | 'serigat' | 'lawang';

export type PlayStyle = 'soca' | 'serigat' | 'nyari';

export interface Meld {
  type: MeldType;
  cards: CardInstance[];
}

export type BotDifficulty = 'casual' | 'balanced' | 'strategic';

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  difficulty?: BotDifficulty;
  hand: CardInstance[];
  discards: CardInstance[];
  openNgejukCards: CardInstance[];
  openMelds?: Meld[];
  readyCards?: CardInstance[];
  score: number;
  avatarText: string;
  statusText: string;
  readyMode?: 'mecari' | 'mejaga' | null;
}

export type TurnPhase = 'awaiting_draw' | 'awaiting_discard' | 'bot_thinking' | 'round_over';

export type BotStep = 'draw' | 'discard' | null;

export interface HistoryEntry {
  round: number;
  actor: string;
  action: string;
  cardName?: string;
}

export interface GameState {
  round: number;
  playStyle: PlayStyle;
  players: Player[];
  currentPlayerIndex: number;
  phase: TurnPhase;
  botStep: BotStep;
  stock: CardInstance[];
  lastDiscardPlayerIndex: number | null;
  lastNgejukFromIndex?: number | null;
  lastDrawnCardId: string | null;
  lastDrawSource?: 'stock' | 'ngejuk' | null;
  pendingDrawnCard: CardInstance | null;
  winnerId: number | null;
  winKind?: 'ceki' | 'kupak' | 'ngandang' | null;
  winningMelds: Meld[] | null;
  winReason: string | null;
  lastActionLog: string;
  history: HistoryEntry[];
}
