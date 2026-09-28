import { DurableObject } from 'cloudflare:workers';
import { filterMessage, nicknameError, sanitizeNickname, isValidAvatar } from '../shared/identity';
import { clampToWalkable, WORLD } from '../shared/world';
import type { ChatMessage, ClientMessage, ConversationState, Identity, PlayerState, ServerMessage } from '../shared/protocol';

interface Env {
  CITY_HUB: DurableObjectNamespace<CityHub>;
  ASSETS: Fetcher;
}

type LivePlayer = PlayerState & {
  roomId: string;
  joinedAt: number;
  lastMoveAt: number;
  lastChatAt: number;
  lastChatText: string;
  lastChatTextAt: number;
  requestTimes: number[];
  reportTimes: number[];
};

type PendingRequest = {
  id: string;
  kind: 'talk' | 'join';
  fromId: string;
  fromName: string;
  roomId: string;
  targetIds: string[];
  conversationId?: string;
  expiresAt: number;
};

type DurableState = {
  conversations: ConversationState[];
  requests: PendingRequest[];
  roomSequence: number;
  nameChanges: Record<string, { nickname: string; changedAt: number }>;
};

const TALK_RANGE = 128;
const REQUEST_TTL = 25_000;
const ROOM_CAPACITY = 36;
const MAX_CHAT_PER_10S = 7;

function randomId(): string { return crypto.randomUUID(); }
function distance(a: Pick<PlayerState, 'x' | 'y'>, b: Pick<PlayerState, 'x' | 'y'>): number { return Math.hypot(a.x - b.x, a.y - b.y); }

function parseIdentity(url: URL): Identity | null {
  const rawNickname = url.searchParams.get('nickname') ?? '';
  const identity = {
    guestId: (url.searchParams.get('guestId') ?? '').slice(0, 48),
    nickname: sanitizeNickname(rawNickname),
    avatarId: (url.searchParams.get('avatarId') ?? '').slice(0, 24),
  };
  if (!/^[a-zA-Z0-9-]{12,48}$/.test(identity.guestId) || nicknameError(rawNickname) || !isValidAvatar(identity.avatarId)) return null;
  return identity;
}

function asServerMessage(value: unknown): ClientMessage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = (field: unknown) => typeof field === 'string' && field.length <= 80 ? field : '';
  switch (raw.type) {
    case 'move':
      if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
      if (!['up', 'down', 'left', 'right'].includes(String(raw.direction)) || typeof raw.moving !== 'boolean') return null;
      return { type: 'move', x: raw.x, y: raw.y, direction: raw.direction as PlayerState['direction'], moving: raw.moving };
    case 'request_talk': return id(raw.targetId) ? { type: 'request_talk', targetId: id(raw.targetId) } : null;
    case 'request_join': return id(raw.conversationId) ? { type: 'request_join', conversationId: id(raw.conversationId) } : null;
    case 'respond_request': return id(raw.requestId) && typeof raw.accept === 'boolean' ? { type: 'respond_request', requestId: id(raw.requestId), accept: raw.accept } : null;
    case 'send_message': return id(raw.conversationId) && typeof raw.text === 'string' ? { type: 'send_message', conversationId: id(raw.conversationId), text: raw.text.slice(0, 1000) } : null;
    case 'update_blocks': return Array.isArray(raw.blockedIds) ? { type: 'update_blocks', blockedIds: raw.blockedIds.filter((entry): entry is string => typeof entry === 'string').slice(0, 80) } : null;
    case 'report':
      return id(raw.targetId) && ['spam', 'harassment', 'offensive', 'other'].includes(String(raw.reason))
        ? { type: 'report', targetId: id(raw.targetId), reason: raw.reason as Extract<ClientMessage, { type: 'report' }>['reason'] }
        : null;
    default: return null;
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  try { socket.send(JSON.stringify(message)); } catch { /* The close handler performs the cleanup. */ }
}

function expose(player: LivePlayer): PlayerState {
  return {
    id: player.id,
    guestId: player.guestId,
    nickname: player.nickname,
    avatarId: player.avatarId,
    x: player.x,
    y: player.y,
    direction: player.direction,
    moving: player.moving,
    ...(player.conversationId ? { conversationId: player.conversationId } : {}),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, service: 'kindred-town' });
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Yêu cầu nâng cấp kết nối WebSocket', { status: 426 });
      return env.CITY_HUB.getByName('kindred-city').fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class CityHub extends DurableObject<Env> {
  private conversations = new Map<string, ConversationState>();
  private requests = new Map<string, PendingRequest>();
  private roomSequence = 1;
  private nameChanges: Record<string, { nickname: string; changedAt: number }> = {};
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<DurableState>('city-state');
      if (saved) {
        this.conversations = new Map(saved.conversations.map((conversation) => [conversation.id, conversation]));
        this.requests = new Map(saved.requests.map((request) => [request.id, request]));
        this.roomSequence = saved.roomSequence;
        this.nameChanges = saved.nameChanges ?? {};
      }
      for (const socket of this.ctx.getWebSockets()) {
        const attached = socket.deserializeAttachment() as LivePlayer | null;
        if (!attached) continue;
        const player = { ...attached };
        this.attach(socket, player);
      }
    });
  }

  private attach(socket: WebSocket, player: LivePlayer): void {
    socket.serializeAttachment(player);
  }

  private players(roomId: string): Array<{ socket: WebSocket; player: LivePlayer }> {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const player = socket.deserializeAttachment() as LivePlayer | null;
      return player?.roomId === roomId ? [{ socket, player }] : [];
    });
  }

  private findPlayer(id: string, roomId: string): { socket: WebSocket; player: LivePlayer } | undefined {
    return this.players(roomId).find(({ player }) => player.id === id);
  }

  private broadcast(roomId: string, message: ServerMessage, exceptId?: string): void {
    for (const { socket, player } of this.players(roomId)) if (player.id !== exceptId) send(socket, message);
  }

  private snapshot(socket: WebSocket, player: LivePlayer): void {
    const players = this.players(player.roomId).map(({ player: other }) => other);
    send(socket, {
      type: 'welcome',
      snapshot: {
        selfId: player.id,
        roomId: player.roomId,
        players: players.map(expose),
        conversations: [...this.conversations.values()].filter((conversation) => conversation.memberIds.some((id) => players.some((entry) => entry.id === id))),
      },
    });
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put<DurableState>('city-state', {
      conversations: [...this.conversations.values()],
      requests: [...this.requests.values()],
      roomSequence: this.roomSequence,
      nameChanges: this.nameChanges,
    });
    const nextExpiry = [...this.requests.values()].reduce((next, item) => Math.min(next, item.expiresAt), Number.POSITIVE_INFINITY);
    if (Number.isFinite(nextExpiry)) await this.ctx.storage.setAlarm(nextExpiry);
    else await this.ctx.storage.deleteAlarm();
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    const identity = parseIdentity(url);
    if (!identity) return new Response('Tên gọi hoặc nhân vật không hợp lệ', { status: 400 });
    const now = Date.now();
    const previousName = this.nameChanges[identity.guestId];
    if (previousName && previousName.nickname !== identity.nickname && now - previousName.changedAt < 30_000) {
      return new Response('Chỉ có thể đổi tên một lần trong mỗi 30 giây', { status: 429 });
    }
    if (!previousName || previousName.nickname !== identity.nickname) this.nameChanges[identity.guestId] = { nickname: identity.nickname, changedAt: now };
    for (const [guestId, name] of Object.entries(this.nameChanges)) if (now - name.changedAt > 30 * 60_000) delete this.nameChanges[guestId];
    const nameEntries = Object.entries(this.nameChanges);
    if (nameEntries.length > 5000) for (const [guestId] of nameEntries.slice(0, nameEntries.length - 5000)) delete this.nameChanges[guestId];

    const openRooms = Array.from({ length: this.roomSequence }, (_, index) => `town-${index + 1}`);
    let roomId = openRooms.find((room) => this.players(room).length < ROOM_CAPACITY);
    if (!roomId) { this.roomSequence += 1; roomId = `town-${this.roomSequence}`; }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const position = { x: 852 + Math.random() * 24, y: 660 + Math.random() * 18 };
    const player: LivePlayer = {
      ...identity,
      id: randomId(),
      ...position,
      direction: 'down',
      moving: false,
      roomId,
      joinedAt: now,
      lastMoveAt: now,
      lastChatAt: 0,
      lastChatText: '',
      lastChatTextAt: 0,
      requestTimes: [],
      reportTimes: [],
      blockedIds: (url.searchParams.get('blocked') ?? '').split(',').filter(Boolean).slice(0, 80),
    };
    this.attach(server, player);
    this.snapshot(server, player);
    this.broadcast(roomId, { type: 'player_joined', player: expose(player) }, player.id);
    await this.save();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const player = socket.deserializeAttachment() as LivePlayer | null;
    if (!player || typeof rawMessage !== 'string' || rawMessage.length > 4096) return;
    let decoded: unknown;
    try { decoded = JSON.parse(rawMessage); } catch { return; }
    const message = asServerMessage(decoded);
    if (!message) { send(socket, { type: 'error', code: 'invalid', message: 'Không thể đọc thao tác này.' }); return; }
    const now = Date.now();

    if (message.type === 'move') {
      const elapsedMs = now - player.lastMoveAt;
      if (elapsedMs < 45) return;
      const elapsed = Math.min(500, elapsedMs);
      const maxDistance = 178 * elapsed / 1000 + 3;
      const stepX = message.x - player.x;
      const stepY = message.y - player.y;
      const actualDistance = Math.hypot(stepX, stepY);
      let position = { x: player.x, y: player.y };
      if (actualDistance <= maxDistance && Math.abs(stepX) <= maxDistance && Math.abs(stepY) <= maxDistance) {
        position = clampToWalkable(player, Math.max(12, Math.min(WORLD.width - 12, message.x)), Math.max(12, Math.min(WORLD.height - 12, message.y)));
      }
      const movedDistance = distance(player, position);
      const updated: LivePlayer = { ...player, ...position, direction: message.direction, moving: message.moving && movedDistance > 1, lastMoveAt: now };
      this.attach(socket, updated);
      send(socket, { type: 'move_ack', x: updated.x, y: updated.y, direction: updated.direction, moving: updated.moving });
      this.broadcast(player.roomId, { type: 'players_moved', players: [{ id: player.id, x: updated.x, y: updated.y, direction: updated.direction, moving: updated.moving }], serverTime: now }, player.id);
      return;
    }

    if (message.type === 'update_blocks') {
      this.attach(socket, { ...player, blockedIds: [...new Set(message.blockedIds.filter((id) => id !== player.id))].slice(0, 80) });
      return;
    }

    if (message.type === 'request_talk' || message.type === 'request_join') {
      const pruned = player.requestTimes.filter((time) => now - time < 60_000);
      if (pruned.length >= 8) { send(socket, { type: 'error', code: 'rate_limited', message: 'Hãy nghỉ một chút trước khi gửi lời mời tiếp theo nhé.' }); return; }
      let targets: string[] = [];
      let conversationId: string | undefined;
      if (message.type === 'request_talk') {
        const target = this.findPlayer(message.targetId, player.roomId);
        if (!target || distance(player, target.player) > TALK_RANGE || target.player.blockedIds?.includes(player.guestId)) {
          send(socket, { type: 'error', code: 'too_far', message: 'Hãy đến gần hơn một chút nhé.' }); return;
        }
        if (player.conversationId || target.player.conversationId) {
          send(socket, { type: 'error', code: 'unavailable', message: 'Người này đang trò chuyện với ai đó.' }); return;
        }
        targets = [target.player.id];
      } else {
        const conversation = this.conversations.get(message.conversationId);
        if (!conversation || conversation.memberIds.length >= 6) { send(socket, { type: 'error', code: 'full', message: 'Cuộc trò chuyện đã đủ người.' }); return; }
        const nearbyMember = conversation.memberIds.some((id) => {
          const member = this.findPlayer(id, player.roomId)?.player;
          return member && distance(player, member) <= TALK_RANGE;
        });
        if (!nearbyMember || conversation.memberIds.includes(player.id)) { send(socket, { type: 'error', code: 'too_far', message: 'Hãy đến gần nhóm trước nhé.' }); return; }
        targets = conversation.memberIds.filter((id) => !this.findPlayer(id, player.roomId)?.player.blockedIds?.includes(player.guestId));
        conversationId = conversation.id;
      }
      if (!targets.length) { send(socket, { type: 'error', code: 'unavailable', message: 'Hiện giờ họ chưa thể trò chuyện.' }); return; }
      const request: PendingRequest = {
        id: randomId(),
        kind: message.type === 'request_talk' ? 'talk' : 'join',
        fromId: player.id,
        fromName: player.nickname,
        roomId: player.roomId,
        targetIds: targets,
        conversationId,
        expiresAt: now + REQUEST_TTL,
      };
      this.requests.set(request.id, request);
      this.attach(socket, { ...player, requestTimes: [...pruned, now] });
      for (const targetId of targets) {
        const recipient = this.findPlayer(targetId, player.roomId);
        if (recipient) send(recipient.socket, { type: 'request_received', request: { id: request.id, kind: request.kind, fromId: player.id, fromName: player.nickname, conversationId, expiresAt: request.expiresAt } });
      }
      await this.save();
      return;
    }

    if (message.type === 'respond_request') {
      const request = this.requests.get(message.requestId);
      if (!request || request.roomId !== player.roomId || !request.targetIds.includes(player.id)) return;
      if (request.expiresAt <= now) {
        this.requests.delete(request.id);
        this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'expired' });
        await this.save();
        return;
      }
      if (!message.accept) {
        this.requests.delete(request.id);
        this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'declined' });
        await this.save();
        return;
      }
      const sender = this.findPlayer(request.fromId, request.roomId);
      if (!sender) {
        this.requests.delete(request.id);
        this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'unavailable' });
        await this.save();
        return;
      }
      if (request.kind === 'talk') {
        if (sender.player.conversationId || player.conversationId) {
          this.requests.delete(request.id);
          this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'unavailable' });
          await this.save();
          return;
        }
        const conversation: ConversationState = { id: randomId(), memberIds: [request.fromId, player.id], startedAt: now };
        this.conversations.set(conversation.id, conversation);
        sender.socket && this.attach(sender.socket, { ...sender.player, conversationId: conversation.id });
        this.attach(socket, { ...player, conversationId: conversation.id });
        this.broadcast(request.roomId, { type: 'conversation_started', conversation });
      } else {
        const conversation = request.conversationId ? this.conversations.get(request.conversationId) : undefined;
        if (!conversation || conversation.memberIds.length >= 6) {
          this.requests.delete(request.id);
          this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'unavailable' });
          await this.save();
          return;
        }
        conversation.memberIds = [...new Set([...conversation.memberIds, request.fromId])];
        this.attach(sender.socket, { ...sender.player, conversationId: conversation.id });
        this.broadcast(request.roomId, { type: 'conversation_updated', conversation });
      }
      this.requests.delete(request.id);
      this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'accepted' });
      await this.save();
      return;
    }

    if (message.type === 'send_message') {
      const conversation = this.conversations.get(message.conversationId);
      const text = filterMessage(message.text);
      if (!conversation || !conversation.memberIds.includes(player.id) || !text) return;
      const recentMessages = now - player.lastChatAt < 10_000 ? Math.floor((now - player.lastChatAt) / 1400) : MAX_CHAT_PER_10S;
      if (recentMessages < 1 || (player.lastChatText === text.toLowerCase() && now - player.lastChatTextAt < 30_000)) {
        send(socket, { type: 'error', code: 'rate_limited', message: 'Hãy đợi một chút rồi gửi tin nhắn tiếp nhé.' }); return;
      }
      const updated = { ...player, lastChatAt: now, lastChatText: text.toLowerCase(), lastChatTextAt: now };
      this.attach(socket, updated);
      const chatMessage: ChatMessage = { id: randomId(), fromId: player.id, nickname: player.nickname, text, sentAt: now };
      for (const memberId of conversation.memberIds) {
        const recipient = this.findPlayer(memberId, player.roomId);
        if (recipient && !recipient.player.blockedIds?.includes(player.guestId)) send(recipient.socket, { type: 'chat_message', conversationId: conversation.id, message: chatMessage });
      }
      return;
    }

    if (message.type === 'leave_conversation') {
      const conversation = this.conversations.get(message.conversationId);
      if (!conversation || !conversation.memberIds.includes(player.id)) return;
      conversation.memberIds = conversation.memberIds.filter((id) => id !== player.id);
      this.attach(socket, { ...player, conversationId: undefined });
      if (conversation.memberIds.length < 2) {
        this.conversations.delete(conversation.id);
        for (const memberId of conversation.memberIds) {
          const member = this.findPlayer(memberId, player.roomId);
          if (member) {
            this.attach(member.socket, { ...member.player, conversationId: undefined });
            send(member.socket, { type: 'conversation_ended', conversationId: conversation.id });
          }
        }
      } else {
        this.broadcast(player.roomId, { type: 'conversation_updated', conversation });
      }
      await this.save();
      return;
    }

    if (message.type === 'report') {
      const target = this.findPlayer(message.targetId, player.roomId);
      const reportTimes = player.reportTimes.filter((time) => now - time < 10 * 60_000);
      if (!target || target.player.id === player.id) { send(socket, { type: 'error', code: 'invalid', message: 'Không thể báo cáo người chơi này.' }); return; }
      if (reportTimes.length >= 3) { send(socket, { type: 'error', code: 'rate_limited', message: 'Hãy đợi một chút trước khi gửi báo cáo khác.' }); return; }
      this.attach(socket, { ...player, reportTimes: [...reportTimes, now] });
      const reports = await this.ctx.storage.get<Array<{ id: string; reporterId: string; targetId: string; reason: string; roomId: string; createdAt: number }>>('reports') ?? [];
      reports.push({ id: randomId(), reporterId: player.guestId, targetId: target.player.guestId, reason: message.reason, roomId: player.roomId, createdAt: now });
      await this.ctx.storage.put('reports', reports.slice(-100));
      send(socket, { type: 'system_notice', text: 'Cảm ơn bạn. Báo cáo đã được ghi nhận.' });
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.ready;
    const player = socket.deserializeAttachment() as LivePlayer | null;
    if (!player) return;
    const active = this.players(player.roomId).filter(({ player: other }) => other.id !== player.id);
    for (const conversation of [...this.conversations.values()]) {
      if (!conversation.memberIds.includes(player.id)) continue;
      conversation.memberIds = conversation.memberIds.filter((id) => id !== player.id);
      if (conversation.memberIds.length < 2) {
        this.conversations.delete(conversation.id);
        for (const member of active) if (conversation.memberIds.includes(member.player.id)) {
          this.attach(member.socket, { ...member.player, conversationId: undefined });
          send(member.socket, { type: 'conversation_ended', conversationId: conversation.id });
        }
      } else {
        for (const member of active) if (conversation.memberIds.includes(member.player.id)) {
          this.attach(member.socket, { ...member.player, conversationId: conversation.id });
          send(member.socket, { type: 'conversation_updated', conversation });
        }
      }
    }
    for (const request of [...this.requests.values()]) {
      if (request.fromId === player.id || request.targetIds.includes(player.id)) {
        this.requests.delete(request.id);
        this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'unavailable' });
      }
    }
    this.broadcast(player.roomId, { type: 'player_left', playerId: player.id });
    await this.save();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    await this.ready;
    const now = Date.now();
    for (const request of [...this.requests.values()]) if (request.expiresAt <= now) {
      this.requests.delete(request.id);
      this.broadcast(request.roomId, { type: 'request_closed', requestId: request.id, reason: 'expired' });
    }
    await this.save();
  }
}
