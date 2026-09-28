import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import Phaser from 'phaser';
import {
  ArrowRight, Bell, Check, CircleHelp, Clock3, DoorOpen, Expand,
  Flag, Footprints, Heart, LockKeyhole, Map as MapIcon, MapPin, MessageCircle, MoreHorizontal, Send,
  Settings, ShieldCheck, Sparkles, UsersRound, Volume2, VolumeX, X,
} from 'lucide-react';
import { AVATARS, avatarFor } from '../shared/characters';
import { nicknameError, sanitizeNickname } from '../shared/identity';
import type { ChatMessage, ConversationState, PlayerState, ServerMessage } from '../shared/protocol';
import { WORLD } from '../shared/world';
import { CityScene, type InteractionTarget } from './game/CityScene';
import {
  clearHistory, loadBlocks, loadHistory, loadPreferences, saveBlocks, saveConversationMeta,
  saveMessage, savePreferences, type Preferences, type SavedConversation,
} from './social/history';
import { RealtimeClient } from './social/realtime';

type Guest = { guestId: string; nickname: string; avatarId: string; nameChangedAt: number };
type ActiveConversation = ConversationState & { title: string; place: string };
type Request = { id: string; kind: 'talk' | 'join'; fromId: string; fromName: string; conversationId?: string; expiresAt: number };
type Status = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

const GUEST_KEY = 'kindred.guest.v1';
const MUTE_KEY = 'kindred.mutes.v1';

function readGuest(): Guest | null {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY) ?? 'null') as Guest | null; } catch { return null; }
}

function readMuted(): string[] {
  try { return JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]') as string[]; } catch { return []; }
}

function timeLabel(time: number): string {
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(time);
}

function relativeTime(time: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} giờ trước` : `${Math.floor(hours / 24)} ngày trước`;
}

function AvatarPortrait({ avatarId, selected = false }: { avatarId: string; selected?: boolean }) {
  const avatar = avatarFor(avatarId);
  const hair = avatar.hairStyle;
  return (
    <svg className={`avatar-portrait ${selected ? 'selected' : ''}`} viewBox="0 0 24 32" role="img" aria-label={`Nhân vật ${avatar.name}`} shapeRendering="crispEdges">
      {hair === 'curls' && <><rect x="4" y="3" width="5" height="5" fill={avatar.hair} /><rect x="10" y="1" width="6" height="5" fill={avatar.hair} /><rect x="16" y="3" width="4" height="5" fill={avatar.hair} /></>}
      {hair !== 'curls' && <><rect x="7" y="2" width="10" height="5" fill={hair === 'hood' ? avatar.coat : avatar.hair} /><rect x="5" y="5" width="3" height="7" fill={hair === 'hood' ? avatar.coat : avatar.hair} /></>}
      {hair === 'bun' && <rect x="15" y="1" width="5" height="5" fill={avatar.hair} />}
      {hair === 'cap' && <><rect x="6" y="1" width="12" height="4" fill={avatar.hair} /><rect x="8" y="0" width="8" height="2" fill={avatar.trim} /><rect x="14" y="4" width="6" height="2" fill={avatar.hair} /></>}
      <rect x="7" y="6" width="10" height="9" fill={avatar.skin} />
      {(hair === 'long' || hair === 'bob') && <rect x="16" y="8" width="3" height="11" fill={avatar.hair} />}
      {hair === 'fringe' && <rect x="7" y="5" width="9" height="3" fill={avatar.hair} />}
      <rect x="8" y="9" width="2" height="2" fill="#41342f" /><rect x="14" y="9" width="2" height="2" fill="#41342f" />
      <rect x="10" y="15" width="4" height="2" fill={avatar.trim} />
      <rect x="5" y="17" width="14" height="9" fill={avatar.coat} />
      <rect x="5" y="18" width="3" height="5" fill={avatar.trim} /><rect x="16" y="18" width="3" height="5" fill={avatar.trim} />
      <rect x="8" y="25" width="5" height="6" fill="#735244" /><rect x="14" y="25" width="5" height="6" fill="#735244" />
      <rect x="8" y="29" width="5" height="2" fill="#f7e8cf" /><rect x="14" y="29" width="5" height="2" fill="#f7e8cf" />
    </svg>
  );
}

function App() {
  const gameParent = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const networkRef = useRef<RealtimeClient | null>(null);
  const ownIdRef = useRef('');
  const playersRef = useRef(new Map<string, PlayerState>());
  const currentConversationRef = useRef<ActiveConversation | null>(null);
  const historyRef = useRef<SavedConversation[]>(loadHistory());
  const blockedIdsRef = useRef<string[]>(loadBlocks());
  const mutedIdsRef = useRef<string[]>(readMuted());
  const placeRef = useRef('Quảng Trường');
  const insideRef = useRef(false);
  const guestRef = useRef<Guest | null>(readGuest());
  const callbacksRef = useRef<{ onNearby: (target: InteractionTarget | null) => void; onPlace: (place: string) => void } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const savedGuest = readGuest();
  const [nickname, setNickname] = useState(savedGuest?.nickname ?? '');
  const [avatarId, setAvatarId] = useState(savedGuest?.avatarId ?? 'moss');
  const [nameError, setNameError] = useState('');
  const [inside, setInside] = useState(false);
  const [status, setStatus] = useState<Status>('disconnected');
  const [statusDetail, setStatusDetail] = useState('');
  const [roomId, setRoomId] = useState('');
  const [players, setPlayers] = useState<Map<string, PlayerState>>(new Map());
  const [currentConversation, setCurrentConversation] = useState<ActiveConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<SavedConversation[]>(loadHistory);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [blockedIds, setBlockedIds] = useState<string[]>(loadBlocks);
  const [mutedIds, setMutedIds] = useState<string[]>(readMuted);
  const [requests, setRequests] = useState<Request[]>([]);
  const [messageText, setMessageText] = useState('');
  const [nearby, setNearby] = useState<InteractionTarget | null>(null);
  const [place, setPlace] = useState('Quảng Trường');
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'current' | 'recent'>('current');
  const [selectedHistory, setSelectedHistory] = useState<SavedConversation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapPosition, setMapPosition] = useState({ x: 864, y: 670 });
  const [toast, setToast] = useState('');
  const [reportTarget, setReportTarget] = useState<PlayerState | null>(null);
  const [joystickOrigin, setJoystickOrigin] = useState<{ x: number; y: number } | null>(null);
  const joystickPointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const joystickStickRef = useRef<HTMLSpanElement>(null);
  const [roomStatus, setRoomStatus] = useState('');
  const [now, setNow] = useState(Date.now());
  const lastMapUpdateRef = useRef(0);

  const guestIdentity = guestRef.current;
  const ownId = ownIdRef.current;
  const otherPlayers = [...players.values()].filter((player) => player.id !== ownId && !blockedIds.includes(player.guestId));
  const activeMessages = selectedHistory?.messages ?? messages;

  currentConversationRef.current = currentConversation;
  historyRef.current = history;
  blockedIdsRef.current = blockedIds;
  mutedIdsRef.current = mutedIds;
  placeRef.current = place;
  insideRef.current = inside;
  guestRef.current = guestIdentity;
  callbacksRef.current = { onNearby: setNearby, onPlace: setPlace };

  const notify = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => current === text ? '' : current), 3300);
  }, []);

  const playSound = useCallback((kind: 'enter' | 'request' | 'message' | 'accept') => {
    if (!loadPreferences().sound || typeof window === 'undefined' || !window.AudioContext) return;
    const audio = audioRef.current ?? new window.AudioContext();
    audioRef.current = audio;
    if (audio.state === 'suspended') void audio.resume();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime;
    const tone = kind === 'request' ? 740 : kind === 'accept' ? 830 : kind === 'message' ? 610 : 540;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(tone, start);
    oscillator.frequency.exponentialRampToValueAtTime(tone * 1.28, start + 0.08);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.035, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(start); oscillator.stop(start + 0.2);
  }, []);

  useEffect(() => {
    if (!gameParent.current || gameRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: gameParent.current,
      backgroundColor: '#9ac99c',
      width: gameParent.current.clientWidth,
      height: gameParent.current.clientHeight,
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      antialiasGL: false,
      powerPreference: 'high-performance',
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { pixelArt: true, roundPixels: true, antialias: false },
      physics: { default: 'arcade', arcade: { debug: false } },
      scene: [CityScene],
    });
    gameRef.current = game;
    game.events.once('ready', () => {
      const scene = game.scene.getScene('CityScene') as CityScene;
      sceneRef.current = scene;
      scene.setCallbacks({
        onPosition: (x, y, direction, moving) => {
          networkRef.current?.send({ type: 'move', x, y, direction, moving });
          const timestamp = performance.now();
          if (timestamp - lastMapUpdateRef.current >= 150) {
            lastMapUpdateRef.current = timestamp;
            setMapPosition({ x, y });
          }
        },
        onInteraction: (target) => callbacksRef.current?.onNearby(target),
        onPlace: (value) => callbacksRef.current?.onPlace(value),
      });
      scene.setBlockedIds(blockedIds);
        const savedIdentity = readGuest();
        if (savedIdentity) {
          scene.setIdentity(savedIdentity);
          scene.setJoined(false);
        }
      game.events.on('interact', handleWorldInteractionRef.current);
    });
    const onVisibility = () => {
      if (!gameRef.current) return;
      if (document.hidden) gameRef.current.loop.sleep();
      else gameRef.current.loop.wake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      networkRef.current?.close();
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
    // Scene and socket callbacks stay current through refs; the Phaser game is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { sceneRef.current?.setBlockedIds(blockedIds); }, [blockedIds]);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: preferences.reducedMotion ? 'instant' : 'smooth', block: 'end' }); }, [activeMessages.length, preferences.reducedMotion]);
  useEffect(() => { if (drawerOpen) inputRef.current?.focus({ preventScroll: true }); }, [drawerOpen]);

  const handleWorldInteractionRef = useRef<() => void>(() => undefined);

  const executeInteraction = useCallback((target: InteractionTarget | null) => {
    if (!target) return;
    if (target.type === 'player') {
      if (target.player.conversationId) networkRef.current?.send({ type: 'request_join', conversationId: target.player.conversationId });
      else networkRef.current?.send({ type: 'request_talk', targetId: target.player.id });
      setDrawerOpen(true);
      return;
    }
    if (target.type === 'conversation') {
      networkRef.current?.send({ type: 'request_join', conversationId: target.conversationId });
      setDrawerOpen(true);
      return;
    }
    if (target.type === 'bench') { notify('Một chỗ nghỉ yên tĩnh dưới tán cây.'); }
  }, [notify]);

  useEffect(() => { handleWorldInteractionRef.current = () => executeInteraction(nearby); }, [executeInteraction, nearby]);

  const connectGuest = useCallback((guest: Guest) => {
    networkRef.current?.close();
    const connection = new RealtimeClient();
    networkRef.current = connection;
    connection.onStatus((next, detail) => {
      if (networkRef.current !== connection) return;
      setStatus(next);
      setStatusDetail(detail ?? '');
      if (next !== 'connected') sceneRef.current?.setJoined(false);
      if (next === 'disconnected' && detail) notify(detail);
    });
    connection.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        ownIdRef.current = message.snapshot.selfId;
        setRoomId(message.snapshot.roomId);
        const next = new Map(message.snapshot.players.map((player) => [player.id, player]));
        playersRef.current = next;
        setPlayers(next);
        sceneRef.current?.applySnapshot(message.snapshot);
        sceneRef.current?.setJoined(true);
        const existingConversation = message.snapshot.conversations.find((conversation) => conversation.memberIds.includes(message.snapshot.selfId));
        if (existingConversation) {
          const title = existingConversation.memberIds.map((id) => id === message.snapshot.selfId ? guest.nickname : next.get(id)?.nickname ?? 'Hàng xóm').join(' & ');
          setCurrentConversation({ ...existingConversation, title, place });
          setMessages(historyRef.current.find((entry) => entry.id === existingConversation.id)?.messages ?? []);
        }
        setRoomStatus('');
      } else if (message.type === 'player_joined') {
        const next = new Map(playersRef.current).set(message.player.id, message.player);
        playersRef.current = next; setPlayers(next); sceneRef.current?.playerJoined(message.player);
      } else if (message.type === 'player_left') {
        const next = new Map(playersRef.current); next.delete(message.playerId); playersRef.current = next;
        setPlayers(next); sceneRef.current?.playerLeft(message.playerId);
      } else if (message.type === 'players_moved') {
        const next = new Map(playersRef.current);
        for (const move of message.players) {
          const previous = next.get(move.id);
          if (previous) next.set(move.id, { ...previous, ...move });
        }
        playersRef.current = next; setPlayers(next); sceneRef.current?.playersMoved(message.players);
      } else if (message.type === 'move_ack') {
        sceneRef.current?.acknowledgePosition(message);
      } else if (message.type === 'request_received') {
        playSound('request');
        setRequests((current) => current.some((request) => request.id === message.request.id) ? current : [...current, message.request]);
        setDrawerOpen(true);
      } else if (message.type === 'request_closed') {
        setRequests((current) => current.filter((request) => request.id !== message.requestId));
        if (message.reason === 'expired') notify('Lời mời trò chuyện đã hết hạn.');
      } else if (message.type === 'conversation_started') {
        playSound('accept');
        sceneRef.current?.conversationStarted(message.conversation.id, message.conversation.memberIds);
        const title = message.conversation.memberIds.map((id) => id === ownIdRef.current ? guest.nickname : playersRef.current.get(id)?.nickname ?? 'Hàng xóm').join(' & ');
        const active = { ...message.conversation, title, place: placeRef.current };
        setCurrentConversation(active); setSelectedHistory(null); setMessages([]); setActiveTab('current');
        setHistory(saveConversationMeta(active.id, title, [guest.nickname, ...message.conversation.memberIds.filter((id) => id !== ownIdRef.current).map((id) => playersRef.current.get(id)?.nickname ?? 'Hàng xóm')], placeRef.current, active.startedAt));
        notify('Bạn đã tìm được người trò chuyện. Hãy chào nhau nhé!');
      } else if (message.type === 'conversation_updated') {
        sceneRef.current?.conversationUpdated(message.conversation.id, message.conversation.memberIds);
        const title = message.conversation.memberIds.map((id) => id === ownIdRef.current ? guest.nickname : playersRef.current.get(id)?.nickname ?? 'Hàng xóm').join(' & ');
        const isMember = message.conversation.memberIds.includes(ownIdRef.current);
        const alreadyOpen = currentConversationRef.current?.id === message.conversation.id;
        setCurrentConversation((current) => current?.id === message.conversation.id || isMember
          ? { ...message.conversation, title, place: current?.id === message.conversation.id ? current.place : placeRef.current }
          : current);
        if (isMember && !alreadyOpen) {
          playSound('accept'); setSelectedHistory(null); setActiveTab('current');
          setMessages(historyRef.current.find((entry) => entry.id === message.conversation.id)?.messages ?? []);
          setDrawerOpen(true);
        }
        setHistory(saveConversationMeta(message.conversation.id, title, [guest.nickname, ...message.conversation.memberIds.filter((id) => id !== ownIdRef.current).map((id) => playersRef.current.get(id)?.nickname ?? 'Hàng xóm')], placeRef.current, message.conversation.startedAt));
      } else if (message.type === 'conversation_ended') {
        sceneRef.current?.conversationEnded(message.conversationId);
        setCurrentConversation((current) => current?.id === message.conversationId ? null : current);
        setMessages([]);
      } else if (message.type === 'chat_message') {
        const sender = playersRef.current.get(message.message.fromId);
        const senderKey = sender?.guestId ?? message.message.fromId;
        if (blockedIdsRef.current.includes(senderKey) || mutedIdsRef.current.includes(senderKey)) return;
        sceneRef.current?.showSpeech(message.message);
        playSound('message');
        const conversation = playersRef.current.get(message.message.fromId);
        const activeConversation = currentConversationRef.current;
        const participants = activeConversation?.memberIds.map((id) => id === ownIdRef.current ? guest.nickname : playersRef.current.get(id)?.nickname ?? 'Hàng xóm') ?? [guest.nickname, message.message.nickname];
        setHistory(saveMessage(message.conversationId, participants.join(' & '), participants, activeConversation?.place ?? placeRef.current, message.message));
        if (activeConversation?.id === message.conversationId) setMessages((current) => [...current, message.message].slice(-80));
        else if (conversation) notify(`${message.message.nickname} vừa gửi tin nhắn.`);
      } else if (message.type === 'system_notice') {
        notify(message.text);
      } else if (message.type === 'error') {
        if (message.code === 'full') setRoomStatus('Cuộc trò chuyện đã đủ 6 người.');
        notify(message.message);
      }
    });
    connection.connect({ guestId: guest.guestId, nickname: guest.nickname, avatarId: guest.avatarId }, blockedIds);
  }, [notify, playSound]);

  const enterCity = useCallback((event: FormEvent) => {
    event.preventDefault();
    const cleanName = sanitizeNickname(nickname);
    const invalid = nicknameError(cleanName);
    if (invalid) { setNameError(invalid); return; }
    const previous = readGuest();
    const nowTime = Date.now();
    if (previous && previous.nickname !== cleanName && nowTime - previous.nameChangedAt < 30_000) {
      setNameError('Bạn có thể đổi tên sau ít giây nữa.'); return;
    }
    const guest: Guest = {
      guestId: previous?.guestId ?? crypto.randomUUID().replaceAll('-', ''),
      nickname: cleanName,
      avatarId,
      nameChangedAt: previous?.nickname === cleanName ? previous.nameChangedAt : nowTime,
    };
    localStorage.setItem(GUEST_KEY, JSON.stringify(guest));
    playSound('enter');
    guestRef.current = guest;
    setNickname(cleanName); setNameError(''); setInside(true); setStatus('connecting'); setSelectedHistory(null);
    sceneRef.current?.setIdentity(guest); sceneRef.current?.setJoined(false);
    connectGuest(guest);
  }, [avatarId, connectGuest, nickname, playSound]);

  const sendMessage = useCallback((event: FormEvent) => {
    event.preventDefault();
    const text = messageText.normalize('NFKC').replace(/[<>]/g, '').trim().slice(0, 180);
    if (!text || !currentConversation || selectedHistory || status !== 'connected') return;
    networkRef.current?.send({ type: 'send_message', conversationId: currentConversation.id, text });
    setMessageText('');
    inputRef.current?.focus();
  }, [currentConversation, messageText, selectedHistory, status]);

  const respondToRequest = useCallback((request: Request, accept: boolean) => {
    networkRef.current?.send({ type: 'respond_request', requestId: request.id, accept });
    setRequests((current) => current.filter((entry) => entry.id !== request.id));
  }, []);

  const changeBlocks = useCallback((id: string, blocked: boolean) => {
    const blockKey = playersRef.current.get(id)?.guestId ?? players.get(id)?.guestId ?? id;
    const next = blocked ? [...blockedIds, blockKey] : blockedIds.filter((item) => item !== blockKey);
    setBlockedIds(next); saveBlocks(next); networkRef.current?.updateBlocks(next); sceneRef.current?.setBlockedIds(next);
    notify(blocked ? 'Đã chặn người chơi này.' : 'Đã bỏ chặn người chơi.');
  }, [blockedIds, notify, players]);

  const toggleMute = useCallback((id: string) => {
    const muteKey = playersRef.current.get(id)?.guestId ?? players.get(id)?.guestId ?? id;
    const next = mutedIds.includes(muteKey) ? mutedIds.filter((item) => item !== muteKey) : [...mutedIds, muteKey];
    setMutedIds(next); localStorage.setItem(MUTE_KEY, JSON.stringify(next));
    notify(next.includes(muteKey) ? 'Đã tắt tiếng tin nhắn trên thiết bị này.' : 'Đã bật lại tiếng tin nhắn.');
  }, [mutedIds, notify, players]);

  const submitReport = useCallback((reason: 'spam' | 'harassment' | 'offensive' | 'other') => {
    if (!reportTarget) return;
    networkRef.current?.send({ type: 'report', targetId: reportTarget.id, reason });
    setReportTarget(null);
  }, [reportTarget]);

  const leaveConversation = useCallback(() => {
    if (!currentConversation) return;
    networkRef.current?.send({ type: 'leave_conversation', conversationId: currentConversation.id });
    setCurrentConversation(null); setMessages([]);
  }, [currentConversation]);

  const togglePreference = useCallback((key: keyof Preferences) => {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next); savePreferences(next);
    if (key === 'keepHistory' && !next.keepHistory) { clearHistory(); setHistory([]); }
  }, [preferences]);

  const reconnect = useCallback(() => {
    const guest = readGuest();
    if (!guest) { setInside(false); return; }
    setStatus('reconnecting'); setStatusDetail(''); connectGuest(guest);
  }, [connectGuest]);

  const openRecent = (conversation: SavedConversation) => {
    setSelectedHistory(conversation); setActiveTab('current'); setDrawerOpen(true);
  };

  const beginTouch = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || joystickPointer.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    joystickPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setJoystickOrigin({ x: event.clientX, y: event.clientY });
    sceneRef.current?.setTouchVector(0, 0);
    joystickStickRef.current?.style.setProperty('--knob-x', '0px');
    joystickStickRef.current?.style.setProperty('--knob-y', '0px');
  };
  const moveTouch = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = joystickPointer.current;
    if (!origin || origin.id !== event.pointerId) return;
    event.preventDefault();
    const radius = 48;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > radius ? radius / distance : 1;
    const knobX = dx * scale;
    const knobY = dy * scale;
    joystickStickRef.current?.style.setProperty('--knob-x', `${knobX}px`);
    joystickStickRef.current?.style.setProperty('--knob-y', `${knobY}px`);
    sceneRef.current?.setTouchVector(knobX / radius, knobY / radius);
  };
  const endTouch = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointer.current?.id !== event.pointerId) return;
    event.preventDefault();
    joystickPointer.current = null;
    setJoystickOrigin(null);
    sceneRef.current?.setTouchVector(0, 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const interactionLabel = useMemo(() => {
    if (!nearby) return '';
    if (nearby.type === 'player') return nearby.player.conversationId ? `Xin tham gia trò chuyện cùng ${nearby.player.nickname}` : `Mời ${nearby.player.nickname} trò chuyện`;
    if (nearby.type === 'conversation') return `Xin tham gia nhóm của ${nearby.names.slice(0, 2).join(' & ')}`;
    return 'Ngồi nghỉ một lát';
  }, [nearby]);

  const chatComposer = currentConversation && !selectedHistory ? (
    <form className={`quick-chat-composer ${drawerOpen ? 'panel-composer' : ''}`} onSubmit={sendMessage}>
      <label className="sr-only" htmlFor="chat-message">Nhập tin nhắn</label>
      <input ref={inputRef} id="chat-message" value={messageText} maxLength={180} onChange={(event) => setMessageText(event.target.value)} placeholder={`Nhắn cho ${currentConversation.title.split(' & ')[0]}…`} autoComplete="off" aria-keyshortcuts="Enter" />
      <span className="char-count">{messageText.length}/180</span>
      <button className="send-button" disabled={!messageText.trim() || status !== 'connected'} aria-label="Gửi tin nhắn"><Send size={16} /></button>
    </form>
  ) : null;

  return (
      <main className={`app-shell ${inside ? 'in-city' : 'landing'} ${drawerOpen ? 'drawer-open' : ''} ${currentConversation && !selectedHistory ? 'active-chat' : ''}`}>
      <div ref={gameParent} className="game-canvas" aria-hidden="true" />
      {inside ? (
        <>
          <header className="game-topbar">
            <div className="brand-lockup compact-brand"><span className="brand-mark"><span /><span /><span /><span /></span><span>kindred</span></div>
            <div className="top-location"><MapPin size={13} /><span>{place}</span><span className="location-dot" /></div>
            <div className="room-meta"><span className="online-dot" /><span>{status === 'connected' ? `${players.size} người trong phố` : status === 'connecting' ? 'Đang tìm thị trấn…' : status === 'reconnecting' ? 'Đang kết nối lại…' : 'Ngoại tuyến'}</span><span className="room-separator">·</span><span>{roomId.replace('town-', 'phố ') || 'thị trấn'}</span></div>
            <button className={`icon-button map-toggle ${mapExpanded ? 'active' : ''}`} onClick={() => setMapExpanded((open) => !open)} aria-label={mapExpanded ? 'Đóng bản đồ' : 'Mở bản đồ'} title="Bản đồ"><MapIcon size={18} /></button>
            <button className={`icon-button history-toggle ${drawerOpen ? 'active' : ''}`} onClick={() => setDrawerOpen((open) => !open)} aria-label={drawerOpen ? 'Đóng lịch sử trò chuyện' : 'Mở lịch sử trò chuyện'} title="Lịch sử trò chuyện">{drawerOpen ? <X size={18} /> : <MessageCircle size={18} />}</button>
            <button className="icon-button settings-button" onClick={() => setShowSettings(true)} aria-label="Mở cài đặt"><Settings size={18} /></button>
          </header>

          <TownMap position={mapPosition} expanded={mapExpanded} onToggle={() => setMapExpanded((open) => !open)} />

          <aside className={`chat-panel ${drawerOpen ? 'open' : ''}`} aria-label="Lịch sử trò chuyện" aria-hidden={!drawerOpen} inert={!drawerOpen}>
            <div className="panel-topline"><span className="eyebrow">GÓC NHỎ CỦA BẠN</span><button className="icon-button panel-close" onClick={() => setDrawerOpen(false)} aria-label="Đóng trò chuyện"><X size={17} /></button></div>
            <div className="panel-tabs" role="tablist" aria-label="Mục trò chuyện">
              <button role="tab" aria-selected={activeTab === 'current'} className={activeTab === 'current' ? 'selected' : ''} onClick={() => { setActiveTab('current'); setSelectedHistory(null); }}>HIỆN TẠI {currentConversation && <span className="tab-count">{currentConversation.memberIds.length}</span>}</button>
              <button role="tab" aria-selected={activeTab === 'recent'} className={activeTab === 'recent' ? 'selected' : ''} onClick={() => setActiveTab('recent')}>GẦN ĐÂY <span className="tab-count subtle-count">{history.length}</span></button>
            </div>

            {activeTab === 'recent' ? (
              <section className="recent-view" aria-label="Các cuộc trò chuyện gần đây">
                <div className="section-heading"><div><span className="eyebrow">LỊCH SỬ CỦA BẠN</span><h2>Những khoảnh khắc nhỏ,<br />luôn ở bên.</h2></div><Clock3 size={19} /></div>
                {!preferences.keepHistory && <div className="quiet-note">Lưu trò chuyện gần đây đang tắt trong phần cài đặt.</div>}
                {history.length ? <div className="recent-list">{history.map((item) => (
                  <button className="recent-card" key={item.id} onClick={() => openRecent(item)}>
                    <span className="recent-avatar"><MessageCircle size={17} /></span><span className="recent-copy"><strong>{item.title}</strong><small><MapPin size={11} /> {item.place}</small></span>
                    <span className="recent-time">{relativeTime(item.updatedAt)}<span className="open-label">MỞ ↗</span></span>
                  </button>
                ))}</div> : <div className="empty-history"><span className="empty-orbit"><Heart size={20} /></span><strong>Chưa có cuộc trò chuyện</strong><p>Hãy chào ai đó ở quảng trường, những khoảnh khắc nhỏ sẽ được lưu ở đây.</p><button className="text-button" onClick={() => { setActiveTab('current'); setDrawerOpen(false); }}>Về phố <ArrowRight size={14} /></button></div>}
                {!!history.length && <button className="clear-history" onClick={() => { clearHistory(); setHistory([]); setSelectedHistory(null); notify('Đã xóa lịch sử trò chuyện đã lưu.'); }}>Xóa lịch sử</button>}
              </section>
            ) : selectedHistory ? (
              <section className="history-conversation">
                <button className="back-link" onClick={() => setSelectedHistory(null)}>← Về cuộc trò chuyện hiện tại</button>
                <div className="conversation-intro"><div className="conversation-symbol past"><Clock3 size={17} /></div><span className="eyebrow">TRÒ CHUYỆN TRƯỚC · {selectedHistory.place}</span><h2>{selectedHistory.title}</h2><small>{relativeTime(selectedHistory.updatedAt)}</small></div>
                    <ChatMessages endRef={chatEndRef} messages={selectedHistory.messages} ownId={ownId} players={players} blockedIds={blockedIds} mutedIds={mutedIds} onBlock={changeBlocks} onMute={toggleMute} onReport={(id) => { const target = players.get(id); if (target) setReportTarget(target); }} />
                <div className="history-readonly"><LockKeyhole size={13} /> Đã lưu trên thiết bị này · chỉ xem</div>
              </section>
            ) : (
              <section className="current-view">
                {currentConversation ? (
                  <>
                    <div className="conversation-intro current-intro"><div className="conversation-symbol"><UsersRound size={18} /></div><div className="conversation-title-wrap"><span className="eyebrow">{currentConversation.place.toUpperCase()} · ĐANG TRÒ CHUYỆN</span><h2>{currentConversation.title}</h2><div className="participant-line">{currentConversation.memberIds.length} người <span className="location-dot tiny" /> {currentConversation.place}</div></div><button className="icon-button leave-button" onClick={leaveConversation} aria-label="Rời cuộc trò chuyện"><DoorOpen size={17} /></button></div>
                    {requests.length > 0 && <InviteInline request={requests[0]} now={now} onRespond={respondToRequest} />}
                    <ChatMessages endRef={chatEndRef} messages={messages} ownId={ownId} players={players} blockedIds={blockedIds} mutedIds={mutedIds} onBlock={changeBlocks} onMute={toggleMute} onReport={(id) => { const target = players.get(id); if (target) setReportTarget(target); }} />
                    {drawerOpen && chatComposer}
                  </>
                ) : (
                  <div className="waiting-view">
                    {requests.length > 0 ? <div className="request-card"><span className="request-spark"><Bell size={16} /></span><span className="eyebrow">LỜI MỜI TRÒ CHUYỆN</span><h3>{requests[0].fromName}<br /><span>{requests[0].kind === 'join' ? 'muốn tham gia cuộc trò chuyện.' : 'muốn trò chuyện cùng bạn.'}</span></h3><p>{requests[0].kind === 'join' ? 'Một người bạn mới muốn tham gia cùng mọi người.' : 'Hãy dành chỗ cho một cuộc trò chuyện mới nhé.'}</p><div className="request-actions"><button className="accept-button" onClick={() => respondToRequest(requests[0], true)}><Check size={15} /> Đồng ý</button><button className="decline-button" onClick={() => respondToRequest(requests[0], false)}>Từ chối</button></div><small>Lời mời hết hạn sau {Math.max(0, Math.ceil((requests[0].expiresAt - now) / 1000))} giây</small></div> : <div className="waiting-card"><div className="empty-orbit"><MessageCircle size={20} /></div><span className="eyebrow">NƠI BẮT ĐẦU NHỮNG CÂU CHUYỆN</span><h2>Tìm người bạn muốn gặp.</h2><p>Đi đến gần một người và hỏi xem họ có muốn trò chuyện không. Không có phòng chat chung, chỉ có những lời chào thân tình trong phố.</p><div className="hint-row"><kbd>E</kbd><span>Chào người chơi ở gần</span></div></div>}
                    {status === 'disconnected' || status === 'error' ? <button className="reconnect-button" onClick={reconnect}><WifiIcon /> Kết nối lại</button> : null}
                    {!!roomStatus && <div className="quiet-note">{roomStatus}</div>}
                    <div className="online-list"><div className="online-list-heading"><span className="eyebrow">MỌI NGƯỜI QUANH ĐÂY</span><span>{otherPlayers.length} người</span></div>{otherPlayers.slice(0, 4).map((person) => <div className="neighbor-row" key={person.id}><AvatarPortrait avatarId={person.avatarId} /><span><strong>{person.nickname}</strong><small>{person.conversationId ? 'Đang trò chuyện' : 'Đang dạo quanh'}</small></span>{person.conversationId ? <MessageCircle size={14} /> : <span className="online-dot" />}</div>)}{otherPlayers.length === 0 && <p className="neighbors-empty">Quảng trường đang yên ắng. Bạn bè có thể tham gia bằng đường dẫn này.</p>}</div>
                  </div>
                )}
              </section>
            )}
            <footer className="panel-footer"><div className="footer-self"><AvatarPortrait avatarId={avatarId} /><span><strong>{nickname || 'Hàng xóm'}</strong><small>Đang ở đây</small></span></div><button className="icon-button" aria-label="Mở cài đặt" onClick={() => setShowSettings(true)}><Settings size={17} /></button></footer>
          </aside>

          {!drawerOpen && chatComposer}

          {interactionLabel && nearby && <button className="world-prompt" onClick={() => executeInteraction(nearby)}><kbd>E</kbd><span>{interactionLabel}</span><ArrowRight size={15} /></button>}
          <div className="game-bottom-note"><Footprints size={14} /><span>WASD / phím mũi tên để đi</span><span className="note-divider">·</span><span>Đến gần ai đó để chào</span></div>
          <TouchMoveLayer origin={joystickOrigin} stickRef={joystickStickRef} onPointerDown={beginTouch} onPointerMove={moveTouch} onPointerUp={endTouch} />
          {(status === 'connecting' || status === 'reconnecting') && <div className="connection-pill"><span className="online-dot waiting" />{statusDetail || (status === 'connecting' ? 'Đang tìm thị trấn…' : 'Đang tìm đường kết nối lại…')}</div>}
        </>
      ) : (
        <>
          <div className="landing-topbar"><div className="brand-lockup"><span className="brand-mark"><span /><span /><span /><span /></span><span>kindred</span><span className="brand-divider" /><span className="brand-sub">MỘT THỊ TRẤN NHỎ ĐỂ GẶP GỠ</span></div><div className="landing-online"><span className="online-dot" /> Hôm nay thật đẹp để chào nhau</div></div>
          <section className="welcome-card" aria-labelledby="welcome-title">
            <div className="welcome-kicker"><Sparkles size={13} /> Một góc nhỏ trên mạng</div>
            <h1 id="welcome-title">Cứ là chính bạn.<br /><em>Ở lại chơi nhé.</em></h1>
            <p className="welcome-description">Thị trấn pixel nhỏ nơi câu chuyện bắt đầu bằng một bước chân, và lời chào luôn ở thật gần.</p>
            <form onSubmit={enterCity} className="join-form" noValidate>
              <label htmlFor="nickname">Mọi người nên gọi bạn là gì?</label>
              <div className={`nickname-wrap ${nameError ? 'invalid' : ''}`}><input id="nickname" autoComplete="nickname" maxLength={16} minLength={2} value={nickname} onChange={(event) => { setNickname(sanitizeNickname(event.target.value)); setNameError(''); }} placeholder="Tên gọi của bạn" aria-invalid={!!nameError} aria-describedby="nickname-help" /><span className="name-length">{nickname.length}/16</span></div>
              <div className="field-help" id="nickname-help">Chỉ cần tên gọi, không cần tài khoản hay mật khẩu.</div>
              {nameError && <div className="field-error" role="alert">{nameError}</div>}
              <label className="avatar-label">Chọn nhân vật của bạn</label>
              <div className="avatar-grid" role="radiogroup" aria-label="Chọn nhân vật">{AVATARS.map((avatar) => <button type="button" key={avatar.id} role="radio" aria-checked={avatarId === avatar.id} aria-label={`Chọn ${avatar.name}`} className={`avatar-option ${avatarId === avatar.id ? 'chosen' : ''}`} onClick={() => setAvatarId(avatar.id)}><AvatarPortrait avatarId={avatar.id} selected={avatarId === avatar.id} /><span>{avatar.name}</span>{avatarId === avatar.id && <span className="avatar-check"><Check size={11} /></span>}</button>)}</div>
              <button className="enter-button" type="submit">Vào thị trấn <ArrowRight size={17} /></button>
              <div className="landing-footnote"><ShieldCheck size={13} /><span>Thân thiện ngay từ đầu · Trò chuyện chỉ lưu trên thiết bị này</span></div>
            </form>
          </section>
          <div className="landing-scene-caption"><span className="scene-caption-line" /><span>THỊ TRẤN ĐANG CHỜ BẠN</span><span className="caption-coordinates">MỘT NƠI NHỎ VỪA ĐỦ</span></div>
          <div className="landing-location-stamp"><MapPin size={14} /><span>Một nơi thật ấm áp</span><span className="stamp-sparkle">✳</span></div>
        </>
      )}

      {toast && <div className="toast-message" role="status"><span className="toast-dot" />{toast}<button aria-label="Đóng thông báo" onClick={() => setToast('')}><X size={14} /></button></div>}
      {showSettings && <SettingsModal preferences={preferences} onToggle={togglePreference} blockedIds={blockedIds} mutedIds={mutedIds} players={players} onUnblock={(id) => changeBlocks(id, false)} onUnmute={toggleMute} onClearHistory={() => { clearHistory(); setHistory([]); notify('Đã xóa lịch sử trò chuyện đã lưu.'); }} onClose={() => setShowSettings(false)} />}
      {reportTarget && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportTarget(null); }}><section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title"><button className="modal-close icon-button" onClick={() => setReportTarget(null)} aria-label="Đóng báo cáo"><X size={18} /></button><span className="modal-ornament"><Flag size={18} /></span><span className="eyebrow">CÙNG GIỮ THỊ TRẤN AN TOÀN</span><h2 id="report-title">Báo cáo {reportTarget.nickname}</h2><p>Chọn lý do phù hợp nhất. Báo cáo không bao gồm nội dung trò chuyện của bạn.</p><div className="reason-list">{([['spam', 'Tin nhắn rác'], ['harassment', 'Quấy rối'], ['offensive', 'Nội dung xúc phạm'], ['other', 'Lý do khác']] as const).map(([value, label]) => <button key={value} onClick={() => submitReport(value)}>{label}<ArrowRight size={14} /></button>)}</div><button className="text-button centered" onClick={() => setReportTarget(null)}>Hủy</button></section></div>}
    </main>
  );
}

function TownMap({ position, expanded, onToggle }: { position: { x: number; y: number }; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <section className="town-minimap" aria-label="Bản đồ thị trấn thu nhỏ">
        <div className="map-card-heading"><span><MapIcon size={12} /> BẢN ĐỒ</span><button className="map-expand" onClick={onToggle} aria-label="Mở bản đồ toàn thị trấn"><Expand size={14} /></button></div>
        <TownMapArtwork position={position} />
      </section>
      {expanded && <div className="map-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onToggle(); }}>
        <section className="town-map-dialog" role="dialog" aria-modal="true" aria-labelledby="town-map-title">
          <header><div><span className="eyebrow">MỘT NƠI ĐỂ DẠO QUANH</span><h2 id="town-map-title">Thị trấn Kindred</h2></div><button className="icon-button map-close" onClick={onToggle} aria-label="Đóng bản đồ"><X size={19} /></button></header>
          <TownMapArtwork position={position} />
          <div className="map-legend"><span><i className="map-you-dot" /> Bạn đang ở đây</span><span><i className="map-path-key" /> Đường đi</span><span><i className="map-water-key" /> Bờ sông</span></div>
          <div className="map-places"><span><strong>Góc Yên Tĩnh</strong><small>Nghỉ chân dưới những tán cây già</small></span><span><strong>Quảng Trường</strong><small>Đài phun nước và những lời chào</small></span><span><strong>Ấm Trà Nhỏ</strong><small>Cà phê cùng chút gì ấm áp</small></span><span><strong>Công Viên Dương Xỉ · Bờ Sông</strong><small>Lối vườn xanh bên mép nước</small></span></div>
        </section>
      </div>}
    </>
  );
}

function TownMapArtwork({ position }: { position: { x: number; y: number } }) {
  const x = Math.max(18, Math.min(WORLD.width - 18, position.x));
  const y = Math.max(18, Math.min(WORLD.height - 18, position.y));
  return (
    <svg className="town-map-art" viewBox={`0 0 ${WORLD.width} ${WORLD.height}`} role="img" aria-label="Bản đồ minh họa quảng trường, quán cà phê, công viên, góc yên tĩnh, bờ sông và vị trí của bạn" shapeRendering="crispEdges">
      <image href="/art/kindred-town.png" x="0" y="0" width={WORLD.width} height={WORLD.height} preserveAspectRatio="none" />
      <g className="player-map-pin" transform={`translate(${x} ${y})`}><circle r="34" fill="#f5e8c9" opacity=".52"/><circle r="21" fill="#fffaf0" stroke="#49654d" strokeWidth="8"/><circle r="11" fill="#d66f5d" stroke="#fffaf0" strokeWidth="4"/><path d="M0 44-10 22h20z" fill="#d66f5d" stroke="#fffaf0" strokeWidth="4"/></g>
    </svg>
  );
}

function ChatMessages({
  endRef, messages, ownId, players, blockedIds, mutedIds, onBlock, onMute, onReport,
}: {
  endRef: RefObject<HTMLDivElement | null>; messages: ChatMessage[]; ownId: string; players: Map<string, PlayerState>; blockedIds: string[]; mutedIds: string[];
  onBlock: (id: string, blocked: boolean) => void; onMute: (id: string) => void; onReport: (id: string) => void;
}) {
  return (
    <div className="message-list" aria-live="polite" aria-relevant="additions text" aria-label="Tin nhắn trò chuyện">
      {messages.length === 0 ? <div className="conversation-start"><span className="conversation-start-mark"><Heart size={13} /></span><p>Những con đường mới bắt đầu bằng một lời chào.</p><small>Tin nhắn sẽ hiện phía trên nhân vật của bạn.</small></div> : messages.map((message, index) => {
        const mine = message.fromId === ownId;
        const previous = messages[index - 1];
        const startsGroup = !previous || previous.fromId !== message.fromId || message.sentAt - previous.sentAt > 3 * 60_000;
        const person = players.get(message.fromId);
        const canModerate = !mine && person;
        const safetyKey = person?.guestId ?? message.fromId;
        return (
          <article key={message.id} className={`message-row ${mine ? 'mine' : ''} ${startsGroup ? 'group-start' : ''}`}>
            {startsGroup && <div className="message-meta"><strong>{mine ? 'Bạn' : message.nickname}</strong><time>{timeLabel(message.sentAt)}</time></div>}
            <div className="message-bubble"><p>{message.text}</p>{canModerate && <details className="message-actions"><summary aria-label={`Thao tác với ${message.nickname}`}><MoreHorizontal size={14} /></summary><div className="action-menu"><button onClick={() => onMute(person.id)}><VolumeX size={13} /> {mutedIds.includes(safetyKey) ? 'Bật tiếng' : 'Tắt tiếng'}</button><button onClick={() => onBlock(person.id, !blockedIds.includes(safetyKey))}><LockKeyhole size={13} /> {blockedIds.includes(safetyKey) ? 'Bỏ chặn' : 'Chặn'}</button><button onClick={() => onReport(person.id)}><Flag size={13} /> Báo cáo</button></div></details>}</div>
          </article>
        );
      })}
      <div ref={endRef} className="message-end-spacer" />
    </div>
  );
}

function InviteInline({ request, now, onRespond }: { request: Request; now: number; onRespond: (request: Request, accept: boolean) => void }) {
  return <div className="inline-invite"><span className="inline-invite-icon"><Bell size={15} /></span><span className="inline-invite-copy"><strong>{request.fromName} muốn tham gia</strong><small>Lời mời hết hạn sau {Math.max(0, Math.ceil((request.expiresAt - now) / 1000))} giây</small></span><button className="inline-accept" aria-label={`Đồng ý với lời mời của ${request.fromName}`} onClick={() => onRespond(request, true)}><Check size={14} /></button><button className="inline-decline" aria-label={`Từ chối lời mời của ${request.fromName}`} onClick={() => onRespond(request, false)}><X size={14} /></button></div>;
}

function SettingsModal({
  preferences, onToggle, blockedIds, mutedIds, players, onUnblock, onUnmute, onClearHistory, onClose,
}: {
  preferences: Preferences; onToggle: (key: keyof Preferences) => void; blockedIds: string[]; mutedIds: string[]; players: Map<string, PlayerState>;
  onUnblock: (id: string) => void; onUnmute: (id: string) => void; onClearHistory: () => void; onClose: () => void;
}) {
  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="modal-close icon-button" onClick={onClose} aria-label="Đóng cài đặt"><X size={18} /></button>
        <span className="modal-ornament"><Settings size={18} /></span><span className="eyebrow">CỨ TỰ NHIÊN NHƯ Ở NHÀ</span><h2 id="settings-title">Một vài cài đặt nhỏ</h2><p>Mọi thứ ở đây chỉ thuộc về trình duyệt này.</p>
        <div className="settings-options">
          <SettingToggle icon={<MessageCircle size={16} />} title="Lưu trò chuyện gần đây" detail="Chỉ lưu trên thiết bị này" checked={preferences.keepHistory} onClick={() => onToggle('keepHistory')} />
          <SettingToggle icon={preferences.sound ? <Volume2 size={16} /> : <VolumeX size={16} />} title="Âm thanh nhẹ nhàng" detail="Âm báo nhỏ khi tương tác" checked={preferences.sound} onClick={() => onToggle('sound')} />
          <SettingToggle icon={<Heart size={16} />} title="Giảm chuyển động" detail="Giảm hiệu ứng chuyển cảnh" checked={preferences.reducedMotion} onClick={() => onToggle('reducedMotion')} />
        </div>
        {(blockedIds.length > 0 || mutedIds.length > 0) && <div className="safety-lists"><span className="eyebrow">DANH SÁCH RIÊNG TƯ</span>{blockedIds.map((id) => <div className="safety-person" key={`b-${id}`}><LockKeyhole size={14} /><span>{[...players.values()].find((person) => person.guestId === id)?.nickname ?? 'Người chơi đã chặn'}</span><button onClick={() => onUnblock(id)}>Bỏ chặn</button></div>)}{mutedIds.map((id) => <div className="safety-person" key={`m-${id}`}><VolumeX size={14} /><span>{[...players.values()].find((person) => person.guestId === id)?.nickname ?? 'Người chơi đã tắt tiếng'}</span><button onClick={() => onUnmute(id)}>Bật tiếng</button></div>)}</div>}
        <button className="clear-history modal-clear" onClick={() => { onClearHistory(); onClose(); }}>Xóa lịch sử trò chuyện đã lưu</button>
        <div className="settings-privacy"><ShieldCheck size={14} /><span>Tin nhắn không được lưu trên máy chủ thị trấn.</span></div>
      </section>
    </div>
  );
}

function SettingToggle({ icon, title, detail, checked, onClick }: { icon: ReactNode; title: string; detail: string; checked: boolean; onClick: () => void }) {
  return <button className="setting-toggle" role="switch" aria-checked={checked} onClick={onClick}><span className="setting-icon">{icon}</span><span className="setting-copy"><strong>{title}</strong><small>{detail}</small></span><span className={`toggle-track ${checked ? 'on' : ''}`}><span /></span></button>;
}

function TouchMoveLayer({ origin, stickRef, onPointerDown, onPointerMove, onPointerUp }: {
  origin: { x: number; y: number } | null;
  stickRef: RefObject<HTMLSpanElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="touch-move-layer" aria-label="Chạm và kéo để di chuyển" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {!origin && <span className="touch-move-hint">Chạm và kéo để đi</span>}
      {origin && <span className="touch-joystick-base" style={{ left: origin.x, top: origin.y }} aria-hidden="true"><span ref={stickRef} className="touch-joystick-stick" /></span>}
    </div>
  );
}

function WifiIcon() { return <CircleHelp size={15} />; }

export default App;
