import type { GameState } from '../game/types.ts';

export interface LobbySeatInfo {
  seatIndex: number;
  name: string;
  isHuman: boolean;
  connected: boolean;
  score: number;
}

export interface RoomStatePayload {
  type: 'room_state';
  mySeat: number;
  isHost: boolean;
  roundActive: boolean;
  turnDurationSec?: number;
  turnDeadlineAt?: number | null;
  urls: string[];
  lobby: LobbySeatInfo[];
  lastEvent: { type: string; actorIndex: number } | null;
  state: GameState;
}

export class LanClient {
  private ws: WebSocket | null = null;
  public status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  public errorMessage: string | null = null;
  public mySeat = 0;
  public isHost = false;
  public roundActive = false;
  public urls: string[] = [];
  public lobby: LobbySeatInfo[] = [];

  private onRoomUpdate: (payload: RoomStatePayload) => void;
  private onStatusChange: () => void;

  constructor(onRoomUpdate: (payload: RoomStatePayload) => void, onStatusChange: () => void) {
    this.onRoomUpdate = onRoomUpdate;
    this.onStatusChange = onStatusChange;
  }

  private cleanupSocket(): void {
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.close();
    }
  }

  connect(serverHost: string, playerName: string): void {
    this.cleanupSocket();
    this.status = 'connecting';
    this.errorMessage = null;
    this.onStatusChange();

    const cleanHost = serverHost
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/^wss?:\/\//, '')
      .replace(/\/.*$/, '');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${cleanHost}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        this.status = 'connected';
        this.errorMessage = null;
        this.send({ type: 'set_name', name: playerName });
        this.onStatusChange();
      });

      ws.addEventListener('message', (ev) => {
        if (this.ws !== ws) return;
        try {
          const data = JSON.parse(String(ev.data));
          if (data?.type === 'room_state') {
            this.mySeat = data.mySeat;
            this.isHost = data.isHost;
            this.roundActive = data.roundActive;
            this.urls = data.urls ?? [];
            this.lobby = data.lobby ?? [];
            this.onRoomUpdate(data as RoomStatePayload);
          }
        } catch {
          // Ignore malformed packet
        }
      });

      ws.addEventListener('error', () => {
        if (this.ws !== ws) return;
        this.status = 'error';
        this.errorMessage = 'Gagal terhubung ke server LAN. Pastikan `npm run lan` berjalan di Wi-Fi yang sama.';
        this.onStatusChange();
      });

      ws.addEventListener('close', () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.status !== 'error') {
          this.status = 'disconnected';
        }
        this.roundActive = false;
        this.onStatusChange();
      });
    } catch {
      this.status = 'error';
      this.errorMessage = 'Alamat server LAN tidak valid.';
      this.onStatusChange();
    }
  }

  disconnect(): void {
    this.cleanupSocket();
    this.status = 'disconnected';
    this.errorMessage = null;
    this.roundActive = false;
    this.lobby = [];
    this.onStatusChange();
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
