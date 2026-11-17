import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { LobbySeatInfo, RoomStatePayload } from './lanClient.ts';
import type { LanHostController } from './lanHost.ts';

const SUPABASE_URL = 'https://cxfchncojvdvcziervst.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WZqeBnyW9ggesEAgH0UiQQ_kgEBqK4e';

let sharedClient: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!sharedClient) {
    sharedClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      realtime: {
        params: {
          eventsPerSecond: 30,
        },
      },
    });
  }
  return sharedClient;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(len = 5): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

export function extractRoomCode(input: string): string {
  const raw = input.trim();
  const match = raw.match(/[?&]room=([A-Za-z0-9_-]+)/i);
  const code = (match ? match[1] : raw).replace(/^ceki-bali-/i, '').toUpperCase();
  return code.replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export class OnlineHostPeer {
  private channel: RealtimeChannel | null = null;
  private activeGuests = new Set<string>();
  public roomCode = '';
  public inviteUrl = '';
  public status: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
  public errorMessage: string | null = null;

  private onStatusChange: (status: 'stopped' | 'starting' | 'running' | 'error', err?: string) => void;

  constructor(
    onStatusChange: (status: 'stopped' | 'starting' | 'running' | 'error', err?: string) => void
  ) {
    this.onStatusChange = onStatusChange;
  }

  get connectedCount(): number {
    return this.activeGuests.size;
  }

  start(hostName: string, hostController: LanHostController): void {
    this.stop(false);
    this.status = 'starting';
    this.errorMessage = null;
    this.roomCode = generateRoomCode(5);
    this.onStatusChange('starting');

    const sb = getSupabase();
    const channel = sb.channel(`ceki-room-${this.roomCode}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: 'host' },
      },
    });
    this.channel = channel;

    channel
      .on('broadcast', { event: 'guest_join' }, ({ payload }) => {
        if (this.channel !== channel) return;
        const msg = payload as { clientId?: string; name?: string };
        if (!msg?.clientId) return;
        if (!this.activeGuests.has(msg.clientId)) {
          this.activeGuests.add(msg.clientId);
          hostController.handleExternalRelayMessage({
            type: 'guest_joined',
            clientId: msg.clientId,
          });
        }
        if (msg.name) {
          hostController.handleExternalRelayMessage({
            type: 'from_guest',
            clientId: msg.clientId,
            payload: { type: 'set_name', name: msg.name },
          });
        }
        this.onStatusChange('running');
      })
      .on('broadcast', { event: 'guest_action' }, ({ payload }) => {
        if (this.channel !== channel) return;
        const msg = payload as {
          clientId?: string;
          payload?: {
            type?: string;
            name?: string;
            cardId?: string;
            fromIndex?: number;
            toIndex?: number;
          };
        };
        if (!msg?.clientId || !msg.payload) return;
        if (!this.activeGuests.has(msg.clientId)) {
          this.activeGuests.add(msg.clientId);
          hostController.handleExternalRelayMessage({
            type: 'guest_joined',
            clientId: msg.clientId,
          });
        }
        hostController.handleExternalRelayMessage({
          type: 'from_guest',
          clientId: msg.clientId,
          payload: msg.payload,
        });
      })
      .on('broadcast', { event: 'guest_leave' }, ({ payload }) => {
        if (this.channel !== channel) return;
        const msg = payload as { clientId?: string };
        if (!msg?.clientId) return;
        if (this.activeGuests.delete(msg.clientId)) {
          hostController.handleExternalRelayMessage({
            type: 'guest_left',
            clientId: msg.clientId,
          });
          this.onStatusChange('running');
        }
      })
      .on('broadcast', { event: 'ping' }, ({ payload }) => {
        if (this.channel !== channel) return;
        const pkt = payload as { clientId?: string; seq?: number; ts?: number };
        if (!pkt?.clientId) return;
        channel.send({
          type: 'broadcast',
          event: 'pong',
          payload: { targetClientId: pkt.clientId, seq: pkt.seq, ts: pkt.ts },
        });
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (this.channel !== channel) return;
        if (key && key !== 'host' && this.activeGuests.delete(key)) {
          hostController.handleExternalRelayMessage({
            type: 'guest_left',
            clientId: key,
          });
          this.onStatusChange('running');
        }
      })
      .subscribe(async (status) => {
        if (this.channel !== channel) return;
        if (status === 'SUBSCRIBED') {
          await channel.track({ role: 'host', name: hostName });
          this.inviteUrl = `${window.location.origin}${window.location.pathname}?room=${this.roomCode}`;
          this.status = 'running';
          hostController.startOnline(hostName, this.inviteUrl, (clientId, roomPayload) => {
            if (this.channel === channel) {
              channel.send({
                type: 'broadcast',
                event: 'room_state',
                payload: { targetClientId: clientId, data: roomPayload },
              });
            }
          });
          this.onStatusChange('running');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.status = 'error';
          this.errorMessage = `Gagal terhubung ke server Supabase Realtime (${status}).`;
          this.onStatusChange('error', this.errorMessage);
        }
      });
  }

  stop(notify = true): void {
    this.activeGuests.clear();
    if (this.channel) {
      const old = this.channel;
      this.channel = null;
      getSupabase().removeChannel(old).catch(() => {});
    }
    this.status = 'stopped';
    this.roomCode = '';
    this.inviteUrl = '';
    if (notify) {
      this.onStatusChange('stopped');
    }
  }
}

export class OnlineGuestClient {
  private channel: RealtimeChannel | null = null;
  private clientId = `guest_${Math.random().toString(36).slice(2, 10)}`;
  private onRoomState: (payload: RoomStatePayload) => void;
  private onStatusChange: () => void;
  private onPingUpdate?: () => void;

  public status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  public errorMessage: string | null = null;
  public roomCode = '';
  public lobby: LobbySeatInfo[] = [];
  public mySeat = 0;
  public isHost = false;
  public roundActive = false;
  public turnDurationSec = 15;
  public turnDeadlineAt: number | null = null;
  public pingMs: number | null = null;
  public packetLossPct = 0;

  private pingTimer: number | null = null;
  private pingSeq = 0;
  private pingHistory: Array<{ seq: number; sentAt: number; acked: boolean }> = [];

  constructor(
    onRoomState: (payload: RoomStatePayload) => void,
    onStatusChange: () => void,
    onPingUpdate?: () => void
  ) {
    this.onRoomState = onRoomState;
    this.onStatusChange = onStatusChange;
    this.onPingUpdate = onPingUpdate;
  }

  private startPingLoop(channel: RealtimeChannel): void {
    this.stopPingLoop();
    this.pingHistory = [];
    this.pingMs = null;
    this.packetLossPct = 0;

    const sendPing = () => {
      if (this.channel !== channel) return;
      const now = Date.now();
      const finished = this.pingHistory.filter((p) => now - p.sentAt >= 1500);
      if (finished.length > 0) {
        const lost = finished.filter((p) => !p.acked).length;
        this.packetLossPct = Math.round((lost / finished.length) * 100);
        this.onPingUpdate?.();
      }
      const seq = ++this.pingSeq;
      this.pingHistory.push({ seq, sentAt: now, acked: false });
      if (this.pingHistory.length > 10) {
        this.pingHistory.shift();
      }
      channel.send({
        type: 'broadcast',
        event: 'ping',
        payload: { clientId: this.clientId, seq, ts: now },
      });
    };

    sendPing();
    this.pingTimer = window.setInterval(sendPing, 2000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pingHistory = [];
    this.pingMs = null;
    this.packetLossPct = 0;
  }

  connect(roomInput: string, playerName: string): void {
    const code = extractRoomCode(roomInput);
    if (!code) {
      this.status = 'error';
      this.errorMessage = 'Masukkan Kode Room atau Link Undangan yang valid.';
      this.onStatusChange();
      return;
    }

    this.disconnect(false);
    this.roomCode = code;
    this.status = 'connecting';
    this.errorMessage = null;
    this.onStatusChange();

    const sb = getSupabase();
    const cleanName = playerName.trim().slice(0, 16) || 'Pemain';
    const channel = sb.channel(`ceki-room-${code}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: this.clientId },
      },
    });
    this.channel = channel;
    let receivedState = false;

    const timeout = window.setTimeout(() => {
      if (!receivedState && this.channel === channel) {
        this.errorMessage = `Room "${code}" tidak merespons (pastikan Host sudah membuka Room).`;
        this.disconnect(false);
        this.status = 'error';
        this.onStatusChange();
      }
    }, 8000);

    channel
      .on('broadcast', { event: 'room_state' }, ({ payload }) => {
        if (this.channel !== channel) return;
        const envelope = payload as { targetClientId?: string; data?: RoomStatePayload };
        if (envelope?.targetClientId !== this.clientId || !envelope.data) return;

        if (!receivedState) {
          receivedState = true;
          window.clearTimeout(timeout);
          this.status = 'connected';
          this.errorMessage = null;
          this.startPingLoop(channel);
        }

        const msg = envelope.data;
        this.lobby = msg.lobby;
        this.mySeat = msg.mySeat;
        this.isHost = msg.isHost;
        this.roundActive = msg.roundActive;
        this.turnDurationSec = msg.turnDurationSec ?? 15;
        this.turnDeadlineAt = msg.turnDeadlineAt ?? null;
        this.onRoomState(msg);
      })
      .on('broadcast', { event: 'pong' }, ({ payload }) => {
        if (this.channel !== channel) return;
        const pkt = payload as { targetClientId?: string; seq?: number; ts?: number };
        if (pkt?.targetClientId !== this.clientId) return;

        const entry = this.pingHistory.find((p) => p.seq === pkt.seq);
        if (entry) entry.acked = true;
        if (typeof pkt.ts === 'number') {
          this.pingMs = Math.max(1, Date.now() - pkt.ts);
        }
        const now = Date.now();
        const finished = this.pingHistory.filter((p) => p.acked || now - p.sentAt >= 1500);
        if (finished.length > 0) {
          const lost = finished.filter((p) => !p.acked).length;
          this.packetLossPct = Math.round((lost / finished.length) * 100);
        }
        this.onPingUpdate?.();
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (this.channel !== channel) return;
        if (key === 'host' && receivedState) {
          this.errorMessage = 'Host menutup Room Online.';
          this.disconnect(false);
          this.status = 'disconnected';
          this.onStatusChange();
        }
      })
      .subscribe(async (status) => {
        if (this.channel !== channel) return;
        if (status === 'SUBSCRIBED') {
          await channel.track({ role: 'guest', name: cleanName });
          await channel.send({
            type: 'broadcast',
            event: 'guest_join',
            payload: { clientId: this.clientId, name: cleanName },
          });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          window.clearTimeout(timeout);
          this.status = 'error';
          this.errorMessage = `Gagal terhubung ke Room "${code}" (${status}).`;
          this.onStatusChange();
        }
      });
  }

  send(msg: Record<string, unknown>): void {
    if (this.channel && this.status === 'connected') {
      this.channel.send({
        type: 'broadcast',
        event: 'guest_action',
        payload: { clientId: this.clientId, payload: msg },
      });
    }
  }

  disconnect(notify = true): void {
    this.stopPingLoop();
    if (this.channel) {
      const old = this.channel;
      this.channel = null;
      old
        .send({
          type: 'broadcast',
          event: 'guest_leave',
          payload: { clientId: this.clientId },
        })
        .catch(() => {})
        .finally(() => {
          getSupabase().removeChannel(old).catch(() => {});
        });
    }
    this.status = 'disconnected';
    this.lobby = [];
    this.roundActive = false;
    this.turnDeadlineAt = null;
    if (notify) {
      this.onStatusChange();
    }
  }
}
