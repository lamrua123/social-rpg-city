import type { ClientMessage, Identity, ServerMessage } from '../../shared/protocol';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
type Listener = (message: ServerMessage) => void;
type StatusListener = (status: Status, detail?: string) => void;

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private intentionalClose = false;
  private retryTimer: number | undefined;
  private retries = 0;
  private identity!: Identity;
  private blockedIds: string[] = [];
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();

  onMessage(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onStatus(listener: StatusListener): () => void { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }

  connect(identity: Identity, blockedIds: string[]): void {
    this.identity = identity;
    this.blockedIds = blockedIds;
    this.intentionalClose = false;
    this.open(false);
  }

  private endpoint(): string {
    const configured = import.meta.env.VITE_WS_URL as string | undefined;
    const base = configured || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
    const url = new URL('/ws', base);
    url.searchParams.set('guestId', this.identity.guestId);
    url.searchParams.set('nickname', this.identity.nickname);
    url.searchParams.set('avatarId', this.identity.avatarId);
    url.searchParams.set('blocked', this.blockedIds.join(','));
    return url.toString();
  }

  private setStatus(status: Status, detail?: string): void { for (const listener of this.statusListeners) listener(status, detail); }

  private open(isRetry: boolean): void {
    if (this.intentionalClose) return;
    this.setStatus(isRetry ? 'reconnecting' : 'connecting');
    try { this.socket = new WebSocket(this.endpoint()); }
    catch { this.setStatus('error', 'Trình duyệt không thể mở kết nối an toàn.'); return; }
    const socket = this.socket;
    socket.addEventListener('open', () => { this.retries = 0; this.setStatus('connected'); });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        for (const listener of this.listeners) listener(message);
      } catch { /* Ignore malformed payloads from an unavailable server. */ }
    });
    socket.addEventListener('error', () => this.setStatus('error', 'Máy chủ thị trấn chưa phản hồi.'));
    socket.addEventListener('close', () => {
      if (this.intentionalClose) { this.setStatus('disconnected'); return; }
      if (this.retries >= 6) { this.setStatus('disconnected', 'Không thể kết nối lại. Hãy kiểm tra mạng rồi thử lại.'); return; }
      const delay = [900, 1300, 2100, 3500, 5500, 8500][this.retries++];
      this.setStatus('reconnecting');
      this.retryTimer = window.setTimeout(() => this.open(true), delay);
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  updateBlocks(blockedIds: string[]): void { this.blockedIds = blockedIds; this.send({ type: 'update_blocks', blockedIds }); }

  retry(): void { this.close(); this.intentionalClose = false; this.retries = 0; this.open(true); }

  close(): void {
    this.intentionalClose = true;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.socket?.close(1000, 'Rời thị trấn');
  }
}
