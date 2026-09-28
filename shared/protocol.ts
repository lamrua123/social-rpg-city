export type Identity = { guestId: string; nickname: string; avatarId: string };
export type PlayerState = Identity & {
  id: string;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  moving: boolean;
  conversationId?: string;
  blockedIds?: string[];
};

export type ChatMessage = { id: string; fromId: string; nickname: string; text: string; sentAt: number };
export type ConversationState = { id: string; memberIds: string[]; startedAt: number };
export type RoomSnapshot = { selfId: string; roomId: string; players: PlayerState[]; conversations: ConversationState[] };

export type ClientMessage =
  | { type: 'move'; x: number; y: number; direction: PlayerState['direction']; moving: boolean }
  | { type: 'request_talk'; targetId: string }
  | { type: 'request_join'; conversationId: string }
  | { type: 'respond_request'; requestId: string; accept: boolean }
  | { type: 'send_message'; conversationId: string; text: string }
  | { type: 'leave_conversation'; conversationId: string }
  | { type: 'update_blocks'; blockedIds: string[] }
  | { type: 'report'; targetId: string; reason: 'spam' | 'harassment' | 'offensive' | 'other' };

export type ServerMessage =
  | { type: 'welcome'; snapshot: RoomSnapshot }
  | { type: 'player_joined'; player: PlayerState }
  | { type: 'player_left'; playerId: string }
  | { type: 'players_moved'; players: Pick<PlayerState, 'id' | 'x' | 'y' | 'direction' | 'moving'>[]; serverTime: number }
  | { type: 'move_ack'; x: number; y: number; direction: PlayerState['direction']; moving: boolean }
  | { type: 'request_received'; request: { id: string; kind: 'talk' | 'join'; fromId: string; fromName: string; conversationId?: string; expiresAt: number } }
  | { type: 'request_closed'; requestId: string; reason: 'declined' | 'expired' | 'accepted' | 'unavailable' }
  | { type: 'conversation_started'; conversation: ConversationState }
  | { type: 'conversation_updated'; conversation: ConversationState }
  | { type: 'conversation_ended'; conversationId: string }
  | { type: 'chat_message'; conversationId: string; message: ChatMessage }
  | { type: 'system_notice'; text: string }
  | { type: 'error'; code: 'invalid' | 'rate_limited' | 'too_far' | 'full' | 'unavailable'; message: string };
