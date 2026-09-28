import Phaser from 'phaser';
import { AVATARS, type Avatar } from '../../shared/characters';
import type { ChatMessage, Identity, PlayerState, RoomSnapshot } from '../../shared/protocol';
import { SOLID_AREAS, WORLD } from '../../shared/world';

export type InteractionTarget =
  | { type: 'player'; player: PlayerState }
  | { type: 'conversation'; conversationId: string; names: string[] }
  | { type: 'bench'; x: number; y: number };

type Callbacks = {
  onPosition: (x: number, y: number, direction: PlayerState['direction'], moving: boolean) => void;
  onInteraction: (target: InteractionTarget | null) => void;
  onPlace: (place: string) => void;
};

type AvatarActor = {
  sprite: Phaser.Physics.Arcade.Sprite;
  label: Phaser.GameObjects.Text;
  state: PlayerState;
  targetX: number;
  targetY: number;
};

type Speech = { plate: Phaser.GameObjects.Graphics; text: Phaser.GameObjects.Text; until: number; ownerId: string; stackIndex: number };

function paintPixelAvatar(avatar: Avatar, direction: PlayerState['direction'], frame: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  const pixel = (color: string, x: number, y: number, width: number, height: number) => {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
  };
  const facingUp = direction === 'up';
  const facingLeft = direction === 'left';
  const bob = frame === 1 ? -1 : frame === 2 ? 1 : 0;

  // A one-pixel plum outline gives each person the same crisp, readable edge as the town art.
  pixel('#47343b', 6, 1 + bob, 12, 15);
  pixel('#47343b', 4, 4 + bob, 16, 10);
  pixel('#47343b', 5, 15 + bob, 14, 12);
  pixel('#47343b', 3, 18 + bob, 18, 8);
  pixel('#47343b', 6, 25 + bob, 7, 7);
  pixel('#47343b', 12, 25 + bob, 7, 7);

  // Hair silhouette and shoulders are generated on a low-resolution canvas for crisp nearest-neighbor rendering.
  const hood = avatar.hairStyle === 'hood';
  pixel(hood ? avatar.coat : avatar.hair, 7, 2 + bob, 10, 3);
  pixel(hood ? avatar.coat : avatar.hair, 5, 5 + bob, 3, 7);
  pixel(hood ? avatar.coat : avatar.hair, 16, 5 + bob, 3, 8);
  pixel(avatar.skin, 7, 6 + bob, 10, 9);
  if (avatar.hairStyle === 'long' || avatar.hairStyle === 'bob' || avatar.hairStyle === 'fringe') {
    pixel(avatar.hair, 5, 8 + bob, 3, 8);
    pixel(avatar.hair, 16, 8 + bob, 3, 10);
  }
  if (avatar.hairStyle === 'bun') pixel(avatar.hair, 15, 1 + bob, 5, 5);
  if (avatar.hairStyle === 'curls') {
    pixel(avatar.hair, 4, 3 + bob, 4, 4);
    pixel(avatar.hair, 10, 1 + bob, 5, 4);
    pixel(avatar.hair, 16, 3 + bob, 4, 5);
  }
  if (avatar.hairStyle === 'fringe') pixel(avatar.hair, 7, 5 + bob, 9, 3);
  if (avatar.hairStyle === 'cap') {
    pixel(avatar.hair, 6, 1 + bob, 12, 3);
    pixel(avatar.trim, 8, 0 + bob, 8, 2);
    pixel(avatar.hair, facingLeft ? 3 : 14, 4 + bob, 6, 2);
  }
  if (!facingUp) {
    pixel('#41342f', facingLeft ? 8 : 13, 9 + bob, 2, 2);
    pixel('#f8ead0', facingLeft ? 10 : 12, 12 + bob, 3, 1);
  }
  pixel(avatar.trim, 10, 15 + bob, 4, 2);
  pixel(avatar.coat, 5, 17 + bob, 14, 8);
  pixel(avatar.trim, 5, 18 + bob, 3, 4);
  pixel(avatar.trim, 16, 18 + bob, 3, 4);
  pixel(avatar.trim, 8, 18 + bob, 2, 2);
  pixel(avatar.trim, 14, 20 + bob, 2, 2);
  pixel('#e6ba7d', 9, 19 + bob, 6, 2);
  pixel('#f0c99b', 8, 24 + bob, 8, 2);
  const footShift = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  pixel('#735244', 7 + footShift, 27 + bob, 5, 4);
  pixel('#735244', 13 - footShift, 27 + bob, 5, 4);
  pixel('#f7e8cf', 7 + footShift, 29 + bob, 5, 1);
  pixel('#f7e8cf', 13 - footShift, 29 + bob, 5, 1);
  if (facingLeft) {
    pixel(avatar.coat, 3, 19 + bob, 3, 5);
    pixel('#f0c99b', 2, 22 + bob, 2, 2);
  } else {
    pixel(avatar.coat, 18, 19 + bob, 3, 5);
    pixel('#f0c99b', 20, 22 + bob, 2, 2);
  }
  return canvas;
}

export class CityScene extends Phaser.Scene {
  private callbacks: Callbacks | null = null;
  private localIdentity: Identity = { guestId: 'preview', nickname: 'Bạn', avatarId: 'moss' };
  private localId = 'preview';
  private joined = false;
  private local!: Phaser.Physics.Arcade.Sprite;
  private localName!: Phaser.GameObjects.Text;
  private actors = new Map<string, AvatarActor>();
  private conversationMembers = new Map<string, string[]>();
  private speeches = new Map<string, Speech>();
  private moveTimer = 0;
  private touchVector = { x: 0, y: 0 };
  private direction: PlayerState['direction'] = 'down';
  private moving = false;
  private currentPlace = '';
  private blockedIds = new Set<string>();
  private movementKeys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  private interactionKey: Phaser.Input.Keyboard.Key | null = null;
  private spaceKey: Phaser.Input.Keyboard.Key | null = null;
  private lastInteractionKey = '';

  constructor() { super('CityScene'); }

  setCallbacks(callbacks: Callbacks): void { this.callbacks = callbacks; }

  setIdentity(identity: Identity): void {
    this.localIdentity = identity;
    if (!this.local) return;
    this.drawAvatarTextures();
    this.local.setTexture(this.textureKey(identity.avatarId, this.direction, 0));
    this.localName?.setText(identity.nickname);
  }

  setTouchVector(x: number, y: number): void {
    this.touchVector = this.joined ? { x, y } : { x: 0, y: 0 };
  }

  setJoined(joined: boolean): void {
    this.joined = joined;
    if (!joined) {
      this.touchVector = { x: 0, y: 0 };
      this.local?.setVelocity(0, 0);
    }
  }

  preload(): void {
    this.load.image('kindred-town-art', '/art/kindred-town.png');
  }

  applySnapshot(snapshot: RoomSnapshot): void {
    this.localId = snapshot.selfId;
    const self = snapshot.players.find((player) => player.id === snapshot.selfId);
    if (self && this.local?.body) {
      // The server chooses the spawn point. Align once on welcome/reconnect, before movement is enabled.
      this.local.setPosition(self.x, self.y);
      this.direction = self.direction;
      this.moving = false;
    }
    const present = new Set(snapshot.players.map((player) => player.id));
    for (const id of this.actors.keys()) if (!present.has(id)) this.playerLeft(id);
    this.conversationMembers.clear();
    for (const player of snapshot.players) this.upsertPlayer(player);
    for (const conversation of snapshot.conversations) this.conversationMembers.set(conversation.id, conversation.memberIds);
    this.syncLocalConversationState();
  }

  playerJoined(player: PlayerState): void { this.upsertPlayer(player); }

  playerLeft(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.sprite.destroy();
    actor.label.destroy();
    this.actors.delete(id);
    const speech = this.speeches.get(id);
    speech?.plate.destroy();
    speech?.text.destroy();
    this.speeches.delete(id);
  }

  playersMoved(players: Array<Pick<PlayerState, 'id' | 'x' | 'y' | 'direction' | 'moving'>>): void {
    for (const state of players) {
      const actor = this.actors.get(state.id);
      if (!actor) continue;
      actor.targetX = state.x;
      actor.targetY = state.y;
      actor.state = { ...actor.state, ...state };
    }
  }

  acknowledgePosition(state: { x: number; y: number; direction: PlayerState['direction']; moving: boolean }): void {
    if (!this.local?.body) return;
    this.direction = state.direction;
    this.moving = state.moving;
  }

  conversationStarted(id: string, memberIds: string[]): void { this.conversationMembers.set(id, memberIds); this.syncLocalConversationState(); }
  conversationUpdated(id: string, memberIds: string[]): void { this.conversationMembers.set(id, memberIds); this.syncLocalConversationState(); }
  conversationEnded(id: string): void { this.conversationMembers.delete(id); this.syncLocalConversationState(); }

  setBlockedIds(ids: string[]): void {
    this.blockedIds = new Set(ids);
    for (const [, actor] of this.actors) {
      const visible = !this.blockedIds.has(actor.state.guestId);
      actor.sprite.setVisible(visible);
      actor.label.setVisible(visible);
      if (actor.sprite.body) (actor.sprite.body as Phaser.Physics.Arcade.Body).checkCollision.none = !visible;
    }
  }

  showSpeech(message: ChatMessage): void {
    const id = message.fromId;
    let target: Phaser.GameObjects.Sprite | Phaser.Physics.Arcade.Sprite | undefined;
    if (id === this.localId) target = this.local;
    else target = this.actors.get(id)?.sprite;
    if (!target) return;
    const existing = this.speeches.get(id);
    existing?.plate.destroy();
    existing?.text.destroy();
    const compactScreen = this.scale.width <= 700;
    const nearbyLevels = [...this.speeches.values()].filter((speech) => {
      if (speech.ownerId === id) return false;
      const speaker = speech.ownerId === this.localId ? this.local : this.actors.get(speech.ownerId)?.sprite;
      return !!speaker && Phaser.Math.Distance.Between(target!.x, target!.y, speaker.x, speaker.y) < 112;
    }).map((speech) => speech.stackIndex);
    let stackIndex = 0;
    while (nearbyLevels.includes(stackIndex)) stackIndex += 1;
    const words = Array.from(message.text);
    const maxCharacters = compactScreen ? 38 : 52;
    const clipped = words.length > maxCharacters ? `${words.slice(0, maxCharacters - 3).join('')}…` : message.text;
    const text = this.add.text(target.x, target.y - 57 - stackIndex * 64, clipped, {
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: compactScreen ? '10px' : '12px', color: '#3a342d',
      wordWrap: { width: compactScreen ? 132 : 182 }, align: 'center', padding: { x: 7, y: 5 },
    }).setOrigin(0.5).setDepth(5000);
    const bounds = text.getBounds();
    const plate = this.add.graphics().setDepth(4999);
    plate.fillStyle(0x584a3b, 0.2);
    plate.fillRoundedRect(3, 4, bounds.width + 8, bounds.height + 4, 5);
    plate.fillStyle(0xfff5dc, 1);
    plate.lineStyle(2, 0x95794f, 1);
    plate.fillRoundedRect(0, 0, bounds.width + 8, bounds.height + 4, 5);
    plate.strokeRoundedRect(0, 0, bounds.width + 8, bounds.height + 4, 5);
    plate.fillTriangle(bounds.width / 2 - 4, bounds.height + 4, bounds.width / 2 + 4, bounds.height + 4, bounds.width / 2, bounds.height + 10);
    plate.lineBetween(bounds.width / 2 - 4, bounds.height + 4, bounds.width / 2, bounds.height + 9);
    plate.lineBetween(bounds.width / 2, bounds.height + 9, bounds.width / 2 + 4, bounds.height + 4);
    plate.setPosition(text.x - (bounds.width + 8) / 2, text.y - (bounds.height + 4) / 2);
    text.setPosition(text.x, text.y - 2);
    const seconds = Math.min(7, Math.max(3, 2.2 + message.text.length * 0.035));
    this.speeches.set(id, { plate, text, until: this.time.now + seconds * 1000, ownerId: id, stackIndex });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#9ac99c');
    this.physics.world.setBounds(16, 16, WORLD.width - 32, WORLD.height - 32);
    this.drawAvatarTextures();
    this.drawTown();
    this.buildAmbience();
    const collisionTexture = this.make.graphics({ x: 0, y: 0 });
    collisionTexture.fillStyle(0xffffff);
    collisionTexture.fillRect(0, 0, 2, 2);
    collisionTexture.generateTexture('collision-pixel', 2, 2);
    collisionTexture.destroy();
    const solids = this.physics.add.staticGroup();
    for (const area of SOLID_AREAS) {
      const block = solids.create(area.x + area.width / 2, area.y + area.height / 2, 'collision-pixel') as Phaser.Physics.Arcade.Sprite;
      block.setDisplaySize(area.width, area.height).setAlpha(0.001);
      block.refreshBody();
    }
    const startX = 864;
    const startY = 670;
    this.local = this.physics.add.sprite(startX, startY, this.textureKey(this.localIdentity.avatarId, 'down', 0));
    this.local.setDepth(startY).setCollideWorldBounds(true).setScale(1.45);
    // Center a 26px hitbox on the sprite; the server checks the same 13px radius.
    this.local.setBodySize(18, 18).setOffset(3, 7);
    this.physics.add.collider(this.local, solids);
    this.localName = this.add.text(startX, startY - 37, 'Nhân vật của bạn', {
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#fff8df',
      backgroundColor: '#365848', padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setDepth(startY + 80);
    this.cameras.main.startFollow(this.local, true, 0.1, 0.1);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setZoom(this.scale.width <= 700 ? 0.78 : 0.9);
    if (this.input.keyboard) {
      this.movementKeys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
      this.interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
    this.drawHud();
  }

  private textureKey(avatarId: string, direction: PlayerState['direction'], frame: number): string { return `person-${avatarId}-${direction}-${frame}`; }

  private drawAvatarTextures(): void {
    for (const avatar of AVATARS) for (const direction of ['up', 'down', 'left', 'right'] as const) for (let frame = 0; frame < 3; frame += 1) {
      const key = this.textureKey(avatar.id, direction, frame);
      if (this.textures.exists(key)) continue;
      this.textures.addCanvas(key, paintPixelAvatar(avatar, direction, frame));
    }
  }

  private drawTown(): void {
    this.add.image(0, 0, 'kindred-town-art')
      .setOrigin(0, 0)
      .setDisplaySize(WORLD.width, WORLD.height)
      .setDepth(-1000);
  }

  private buildAmbience(): void {
    const birdCanvas = document.createElement('canvas');
    birdCanvas.width = 12;
    birdCanvas.height = 8;
    const birdContext = birdCanvas.getContext('2d')!;
    birdContext.imageSmoothingEnabled = false;
    birdContext.fillStyle = '#4f5142';
    birdContext.fillRect(1, 2, 3, 2);
    birdContext.fillRect(3, 1, 2, 2);
    birdContext.fillRect(5, 2, 2, 2);
    birdContext.fillRect(7, 1, 2, 2);
    birdContext.fillRect(8, 2, 3, 2);
    birdContext.fillStyle = '#d7c99b';
    birdContext.fillRect(5, 4, 2, 1);
    if (!this.textures.exists('town-bird')) this.textures.addCanvas('town-bird', birdCanvas);

    for (const [x, y, distance, duration] of [[270, 178, 150, 6200], [840, 315, 190, 7400], [1320, 520, 135, 5600]] as const) {
      const bird = this.add.image(x, y, 'town-bird').setScale(1.35).setDepth(1900).setAlpha(0.9);
      this.tweens.add({ targets: bird, x: x + distance, duration, ease: 'Sine.easeInOut', repeat: -1 });
      this.tweens.add({ targets: bird, y: y - 31, duration: duration / 3, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    const breeze = [
      { x: 335, y: 355, color: 0xf0d889, distance: 142 },
      { x: 598, y: 720, color: 0xf4e4b5, distance: 106 },
      { x: 1050, y: 652, color: 0xb1c775, distance: 158 },
      { x: 1280, y: 920, color: 0xe6be72, distance: 128 },
    ];
    breeze.forEach(({ x, y, color, distance }, index) => {
      const leaf = this.add.rectangle(x, y, 4, 2, color).setDepth(y + 2).setAlpha(0.78);
      this.tweens.add({ targets: leaf, x: x + distance, y: y - 18, alpha: 0.35, duration: 4800 + index * 700, ease: 'Sine.easeInOut', repeat: -1, onRepeat: () => leaf.setPosition(x, y) });
    });

    // The fountain is beside the spawn plaza, so the water is visible before players
    // walk to the river. Bright, short pixel glints make its flow readable at phone size.
    const fountainWater = [
      [797, 516, 10], [808, 523, 13], [823, 518, 9], [834, 528, 12],
      [802, 535, 8], [818, 539, 11], [839, 538, 9], [812, 511, 7],
    ] as const;
    fountainWater.forEach(([x, y, width], index) => {
      const glint = this.add.rectangle(x, y, width, index % 3 === 0 ? 3 : 2, index % 2 ? 0xb9f3e2 : 0xf4fff0)
        .setDepth(560 + index).setAlpha(0.82);
      this.tweens.add({
        targets: glint, x: x + (index % 2 ? -9 : 9), y: y + (index % 3 === 0 ? 2 : -1),
        alpha: 0.32, duration: 680 + index * 115, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
      });
    });

    // A few falling pixel streaks run over both visible cascades in the east river.
    const waterfallLanes = [
      { x: 1515, y: 94, length: 60 }, { x: 1530, y: 101, length: 54 },
      { x: 1547, y: 91, length: 64 }, { x: 1561, y: 105, length: 48 },
      { x: 1647, y: 354, length: 54 }, { x: 1664, y: 361, length: 62 },
      { x: 1680, y: 350, length: 52 },
    ];
    waterfallLanes.forEach(({ x, y, length }, index) => {
      const stream = this.add.rectangle(x, y, index % 2 ? 3 : 4, 15 + index % 3 * 3, index % 2 ? 0xd6fff3 : 0x8ce9eb)
        .setDepth(y + 4).setAlpha(0.8);
      this.tweens.add({
        targets: stream, y: y + length, x: x + (index % 2 ? -2 : 2), alpha: 0.28,
        duration: 650 + index * 80, ease: 'Linear', repeat: -1,
      });
    });

    // Longer, brighter ripples flow downstream along the river and around the bridge.
    const river = [
      [1635, 190], [1678, 252], [1598, 320], [1663, 405], [1580, 470],
      [1624, 615], [1682, 670], [1590, 744], [1665, 858], [1592, 990],
      [1660, 1090], [1612, 1142],
    ] as const;
    river.forEach(([x, y], index) => {
      const glint = this.add.rectangle(x, y, index % 3 === 0 ? 17 : 12, 3, index % 2 ? 0xb9f3e2 : 0xe4fff5)
        .setDepth(y + 3).setAlpha(0.68);
      this.tweens.add({
        targets: glint, x: x + (index % 2 ? -14 : 14), y: y + (index % 3 === 0 ? 12 : 19),
        alpha: 0.96, duration: 1500 + index * 100, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
      });
    });
  }

  private drawHud(): void {
  }

  private upsertPlayer(state: PlayerState): void {
    if (state.id === this.localId) return;
    const actor = this.actors.get(state.id);
    if (actor) {
      actor.state = state;
      actor.targetX = state.x;
      actor.targetY = state.y;
      actor.sprite.setTexture(this.textureKey(state.avatarId, state.direction, 0));
      actor.label.setText(state.nickname);
      actor.sprite.setVisible(!this.blockedIds.has(state.guestId));
      actor.label.setVisible(!this.blockedIds.has(state.guestId));
      if (actor.sprite.body) (actor.sprite.body as Phaser.Physics.Arcade.Body).checkCollision.none = this.blockedIds.has(state.guestId);
      return;
    }
    const sprite = this.physics.add.sprite(state.x, state.y, this.textureKey(state.avatarId, state.direction, 0));
    sprite.setDepth(state.y).setScale(1.45).setBodySize(18, 18).setOffset(3, 7).setImmovable(true);
    const label = this.add.text(state.x, state.y - 37, state.nickname, {
      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#fff8df',
      backgroundColor: '#365848', padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setDepth(state.y + 80);
    // Players overlap in the server simulation, so they must not push each other locally.
    sprite.setVisible(!this.blockedIds.has(state.guestId));
    label.setVisible(!this.blockedIds.has(state.guestId));
    if (sprite.body) (sprite.body as Phaser.Physics.Arcade.Body).checkCollision.none = this.blockedIds.has(state.guestId);
    this.actors.set(state.id, { sprite, label, state, targetX: state.x, targetY: state.y });
  }

  private syncLocalConversationState(): void {
    for (const actor of this.actors.values()) {
      const talking = [...this.conversationMembers.values()].some((members) => members.includes(actor.state.id));
      actor.label.setBackgroundColor(talking ? '#9b6551' : '#365848');
    }
  }

  private interactionAt(x: number, y: number): InteractionTarget | null {
    const nearest = [...this.actors.values()].filter(({ state }) => !this.blockedIds.has(state.guestId)).map((actor) => ({ actor, distance: Phaser.Math.Distance.Between(x, y, actor.sprite.x, actor.sprite.y) })).sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance < 128) return { type: 'player', player: nearest.actor.state };
    const group = [...this.conversationMembers.entries()].map(([conversationId, members]) => ({
      conversationId,
      members,
      nearest: Math.min(...members.map((id) => {
        const actor = this.actors.get(id);
        return actor ? Phaser.Math.Distance.Between(x, y, actor.sprite.x, actor.sprite.y) : Number.POSITIVE_INFINITY;
      })),
    })).filter((entry) => entry.nearest < 142 && !entry.members.includes(this.localId)).sort((a, b) => a.nearest - b.nearest)[0];
    if (group) return { type: 'conversation', conversationId: group.conversationId, names: group.members.map((id) => id === this.localId ? this.localIdentity.nickname : this.actors.get(id)?.state.nickname ?? 'Ai đó') };
    const bench = [[913, 514], [902, 692], [550, 605], [1194, 592], [700, 1030]].find(([bx, by]) => Phaser.Math.Distance.Between(x, y, bx, by) < 42);
    if (bench) return { type: 'bench', x: bench[0], y: bench[1] };
    return null;
  }

  private placeAt(x: number, y: number): string {
    if (x > 1130 && y < 448) return 'Ấm Trà Nhỏ';
    if (x > 1130 && y > 448) return 'Bờ Sông';
    if (y > 865 && x < 850) return 'Công Viên Dương Xỉ';
    if (x < 520 && y < 460) return 'Góc Yên Tĩnh';
    return 'Quảng Trường';
  }

  private animateActor(sprite: Phaser.GameObjects.Sprite, avatarId: string, moving: boolean, direction: PlayerState['direction']): void {
    const frame = moving ? (Math.floor(this.time.now / 145) % 2) + 1 : 0;
    sprite.setTexture(this.textureKey(avatarId, direction, frame));
  }

  update(_time: number, delta: number): void {
    if (!this.local?.active) return;
    const targetZoom = this.scale.width <= 700 ? 0.78 : 0.9;
    if (Math.abs(this.cameras.main.zoom - targetZoom) > 0.01) this.cameras.main.setZoom(targetZoom);
    const dt = Math.min(delta, 45) / 1000;
    const keys = this.movementKeys;
    let dx = this.touchVector.x;
    let dy = this.touchVector.y;
    const focusedElement = document.activeElement;
    const typingInField = focusedElement instanceof HTMLElement
      && (focusedElement.matches('input, textarea, select') || focusedElement.isContentEditable);
    if (keys && !typingInField) {
      dx += (keys.D.isDown || keys.RIGHT.isDown ? 1 : 0) - (keys.A.isDown || keys.LEFT.isDown ? 1 : 0);
      dy += (keys.S.isDown || keys.DOWN.isDown ? 1 : 0) - (keys.W.isDown || keys.UP.isDown ? 1 : 0);
    }
    const length = Math.hypot(dx, dy);
    if (!this.joined) dx = dy = 0;
    if (length >= 0.14 && this.joined) {
      if (Math.abs(dx) > Math.abs(dy)) this.direction = dx < 0 ? 'left' : 'right';
      else this.direction = dy < 0 ? 'up' : 'down';
    }
    if (length < 0.14) dx = dy = 0;
    else if (length > 1) { dx /= length; dy /= length; }
    this.moving = length >= 0.14 && this.joined;
    this.local.setVelocity(dx * 178, dy * 178);
    if (!this.moving) this.local.setVelocity(0, 0);
    this.animateActor(this.local, this.localIdentity.avatarId, this.moving, this.direction);
    this.localName.setPosition(this.local.x, this.local.y - 39).setDepth(this.local.y + 80);
    this.local.setDepth(this.local.y);
    if (this.callbacks) {
      const place = this.placeAt(this.local.x, this.local.y);
      if (place !== this.currentPlace) { this.currentPlace = place; this.callbacks.onPlace(place); }
      const prompt = this.interactionAt(this.local.x, this.local.y);
      const targetKey = prompt ? prompt.type === 'player' ? `player:${prompt.player.id}` : prompt.type === 'conversation' ? `conversation:${prompt.conversationId}` : `bench:${prompt.x}:${prompt.y}` : '';
      if (targetKey !== this.lastInteractionKey) { this.lastInteractionKey = targetKey; this.callbacks.onInteraction(prompt); }
    }

    for (const actor of this.actors.values()) {
      const blend = Math.min(1, dt * 12);
      actor.sprite.x = Phaser.Math.Linear(actor.sprite.x, actor.targetX, blend);
      actor.sprite.y = Phaser.Math.Linear(actor.sprite.y, actor.targetY, blend);
      actor.sprite.setDepth(actor.sprite.y);
      actor.label.setPosition(actor.sprite.x, actor.sprite.y - 39).setDepth(actor.sprite.y + 80);
      const talking = [...this.conversationMembers.values()].some((members) => members.includes(actor.state.id));
      actor.label.setBackgroundColor(talking ? '#9b6551' : '#365848');
      this.animateActor(actor.sprite, actor.state.avatarId, actor.state.moving, actor.state.direction);
    }
    for (const speech of this.speeches.values()) {
      const target = speech.ownerId === this.localId ? this.local : this.actors.get(speech.ownerId)?.sprite;
      if (!target || this.time.now >= speech.until) {
        speech.plate.destroy(); speech.text.destroy(); this.speeches.delete(speech.ownerId); continue;
      }
      const cam = this.cameras.main;
      const sidePadding = this.scale.width <= 700 ? 74 : 102;
      const x = Phaser.Math.Clamp(target.x, cam.worldView.x + sidePadding, cam.worldView.right - sidePadding);
      const y = Phaser.Math.Clamp(target.y - 57 - speech.stackIndex * 64, cam.worldView.y + 30, cam.worldView.bottom - 30);
      speech.text.setPosition(x, y);
      const bounds = speech.text.getBounds();
      speech.plate.setPosition(bounds.centerX - bounds.width / 2 - 4, bounds.centerY - bounds.height / 2 - 2);
    }
    this.moveTimer += delta;
    if (this.joined && this.moveTimer >= 58) {
      this.moveTimer = 0;
      this.callbacks?.onPosition(this.local.x, this.local.y, this.direction, this.moving);
    }
    if (this.joined && !typingInField && ((this.interactionKey && Phaser.Input.Keyboard.JustDown(this.interactionKey)) || (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey)))) {
      this.callbacks?.onInteraction(this.interactionAt(this.local.x, this.local.y));
      this.game.events.emit('interact');
    }
  }
}
