import type { ChatMessage } from '../../shared/protocol';

const HISTORY_KEY = 'kindred.history.v1';
const PREFS_KEY = 'kindred.prefs.v1';
const BLOCK_KEY = 'kindred.blocks.v1';
const LIMIT = 40;

export type SavedConversation = {
  id: string;
  title: string;
  participants: string[];
  place: string;
  updatedAt: number;
  messages: ChatMessage[];
};

export type Preferences = { keepHistory: boolean; sound: boolean; reducedMotion: boolean };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

const oldPlaceNames: Record<string, string> = {
  'The Little Kettle': 'Ấm Trà Nhỏ',
  Riverside: 'Bờ Sông',
  'Fern Park': 'Công Viên Dương Xỉ',
  'Quiet Corner': 'Góc Yên Tĩnh',
  'Town Square': 'Quảng Trường',
};

export function loadHistory(): SavedConversation[] {
  return read<SavedConversation[]>(HISTORY_KEY, []).map((entry) => ({
    ...entry,
    place: oldPlaceNames[entry.place] ?? entry.place,
  }));
}

export function saveConversationMeta(conversationId: string, title: string, participants: string[], place: string, startedAt = Date.now()): SavedConversation[] {
  const history = loadHistory();
  const existing = history.find((entry) => entry.id === conversationId);
  const record: SavedConversation = existing ?? { id: conversationId, title, participants, place, updatedAt: startedAt, messages: [] };
  record.title = title;
  record.participants = [...new Set(participants)];
  record.place = place;
  record.updatedAt = Math.max(record.updatedAt, startedAt);
  const next = [record, ...history.filter((entry) => entry.id !== conversationId)].slice(0, LIMIT);
  if (loadPreferences().keepHistory) localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function saveMessage(conversationId: string, title: string, participants: string[], place: string, message: ChatMessage): SavedConversation[] {
  const history = loadHistory();
  const existing = history.find((entry) => entry.id === conversationId);
  const record: SavedConversation = existing ?? { id: conversationId, title, participants, place, updatedAt: Date.now(), messages: [] };
  record.title = title;
  record.participants = [...new Set(participants)];
  record.place = place;
  record.updatedAt = message.sentAt;
  record.messages = [...record.messages, message].slice(-80);
  const next = [record, ...history.filter((entry) => entry.id !== conversationId)].slice(0, LIMIT);
  if (loadPreferences().keepHistory) localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function loadPreferences(): Preferences {
  return { keepHistory: true, sound: true, reducedMotion: false, ...read(PREFS_KEY, {} as Partial<Preferences>) };
}

export function savePreferences(next: Preferences): void { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); }
export function loadBlocks(): string[] { return read(BLOCK_KEY, []); }
export function saveBlocks(blocks: string[]): void { localStorage.setItem(BLOCK_KEY, JSON.stringify([...new Set(blocks)].slice(-100))); }
export function clearHistory(): void { localStorage.removeItem(HISTORY_KEY); }
