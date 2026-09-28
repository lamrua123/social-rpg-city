import assert from 'node:assert/strict';

const base = process.env.KINDRED_WS_URL ?? 'ws://127.0.0.1:8787/ws';
const timeoutMs = 5_000;

function client(nickname, avatarId, guestId = crypto.randomUUID().replaceAll('-', '')) {
  const url = new URL(base);
  url.searchParams.set('guestId', guestId);
  url.searchParams.set('nickname', nickname);
  url.searchParams.set('avatarId', avatarId);
  const socket = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else inbox.push(message);
  });
  const peer = {
    socket,
    inbox,
    guestId,
    send(payload) { socket.send(JSON.stringify(payload)); },
    next(predicate, label = 'message') {
      const index = inbox.findIndex(predicate);
      if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: undefined };
        waiter.timer = setTimeout(() => {
          const position = waiters.indexOf(waiter);
          if (position >= 0) waiters.splice(position, 1);
          reject(new Error(`Timed out waiting for ${label}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    async welcome() { return (await this.next((message) => message.type === 'welcome', 'welcome')).snapshot; },
    close() {
      if (socket.readyState >= WebSocket.CLOSING) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, 700);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.close(1000, 'smoke test cleanup');
      });
    },
  };
  return peer;
}

const is = (type) => (message) => message.type === type;
const peers = [];
try {
  const ariGuestId = crypto.randomUUID().replaceAll('-', '');
  const mika = client('Mika', 'moss');
  peers.push(mika);
  const mikaState = await mika.welcome();
  const june = client('June', 'sunday');
  peers.push(june);
  const juneState = await june.welcome();
  const ari = client('Ari', 'cloud', ariGuestId);
  peers.push(ari);
  const ariState = await ari.welcome();
  assert.ok(juneState.players.some((player) => player.nickname === 'Mika'), 'second browser should see the first guest');
  assert.equal(juneState.players.find((player) => player.nickname === 'Mika')?.avatarId, 'moss', 'avatar should be shared');
  assert.equal(mikaState.roomId, juneState.roomId, 'guests should be assigned to the same city room');

  const movementSeen = mika.next((message) => message.type === 'players_moved' && message.players.some((player) => player.id === juneState.selfId), 'movement snapshot');
  const juneSelf = juneState.players.find((player) => player.id === juneState.selfId);
  assert.ok(juneSelf, 'the server snapshot should include the local avatar');
  await new Promise((resolve) => setTimeout(resolve, 60));
  june.send({ type: 'move', x: juneSelf.x + 10, y: juneSelf.y, direction: 'right', moving: true });
  const movement = await movementSeen;
  assert.ok(movement.players[0].x > juneSelf.x, 'server should broadcast validated movement');
  const rejectedWarp = mika.next((message) => message.type === 'players_moved' && message.players.some((player) => player.id === juneState.selfId), 'position clamp');
  await new Promise((resolve) => setTimeout(resolve, 60));
  june.send({ type: 'move', x: juneSelf.x + 900, y: juneSelf.y, direction: 'right', moving: true });
  assert.equal((await rejectedWarp).players[0].x, movement.players[0].x, 'server should reject an implausible movement jump');

  const receivedRequest = june.next((message) => message.type === 'request_received' && message.request.fromId === mikaState.selfId, 'talk request');
  mika.send({ type: 'request_talk', targetId: juneState.selfId });
  const invite = await receivedRequest;
  const startedAtMika = mika.next(is('conversation_started'), 'conversation start at guest one');
  const startedAtJune = june.next(is('conversation_started'), 'conversation start at guest two');
  june.send({ type: 'respond_request', requestId: invite.request.id, accept: true });
  const [firstConversation, secondConversation] = await Promise.all([startedAtMika, startedAtJune]);
  assert.equal(firstConversation.conversation.id, secondConversation.conversation.id);

  const firstChat = mika.next((message) => message.type === 'chat_message' && message.message.text === 'Hello from the square!', 'one-to-one chat');
  const secondChat = june.next((message) => message.type === 'chat_message' && message.message.text === 'Hello from the square!', 'one-to-one chat echo');
  mika.send({ type: 'send_message', conversationId: firstConversation.conversation.id, text: 'Hello from the square!' });
  await Promise.all([firstChat, secondChat]);
  const tooFast = mika.next((message) => message.type === 'error' && message.code === 'rate_limited', 'chat send rate limit');
  mika.send({ type: 'send_message', conversationId: firstConversation.conversation.id, text: 'Hello from the square!' });
  assert.equal((await tooFast).code, 'rate_limited', 'rapid duplicate messages should be rate limited');

  const groupRequestA = mika.next((message) => message.type === 'request_received' && message.request.fromId === ariState.selfId, 'join request at guest one');
  const groupRequestB = june.next((message) => message.type === 'request_received' && message.request.fromId === ariState.selfId, 'join request at guest two');
  ari.send({ type: 'request_join', conversationId: firstConversation.conversation.id });
  const [joinInviteA, joinInviteB] = await Promise.all([groupRequestA, groupRequestB]);
  const groupAtMika = mika.next((message) => message.type === 'conversation_updated' && message.conversation.memberIds.includes(ariState.selfId), 'group join at guest one');
  const groupAtJune = june.next((message) => message.type === 'conversation_updated' && message.conversation.memberIds.includes(ariState.selfId), 'group join at guest two');
  mika.send({ type: 'respond_request', requestId: joinInviteA.request.id, accept: true });
  const [groupMika, groupJune] = await Promise.all([groupAtMika, groupAtJune]);
  assert.equal(groupMika.conversation.memberIds.length, 3);
  assert.equal(groupJune.conversation.id, groupMika.conversation.id);
  assert.equal(joinInviteB.request.id, joinInviteA.request.id, 'each group member should receive the same join request');
  const reportRecorded = mika.next((message) => message.type === 'system_notice' && message.text.includes('report was recorded'), 'report acknowledgement');
  mika.send({ type: 'report', targetId: ariState.selfId, reason: 'spam' });
  await reportRecorded;

  const groupChatA = mika.next((message) => message.type === 'chat_message' && message.message.text === 'Room for one more?', 'group chat guest one');
  const groupChatB = june.next((message) => message.type === 'chat_message' && message.message.text === 'Room for one more?', 'group chat guest two');
  const groupChatC = ari.next((message) => message.type === 'chat_message' && message.message.text === 'Room for one more?', 'group chat guest three');
  ari.send({ type: 'send_message', conversationId: groupMika.conversation.id, text: 'Room for one more?' });
  await Promise.all([groupChatA, groupChatB, groupChatC]);

  const declined = client('Noah', 'fern');
  peers.push(declined);
  const declinedState = await declined.welcome();
  const declineInvite = mika.next((message) => message.type === 'request_received' && message.request.fromId === declinedState.selfId, 'decline request');
  declined.send({ type: 'request_join', conversationId: groupMika.conversation.id });
  const incoming = await declineInvite;
  const closed = declined.next((message) => message.type === 'request_closed' && message.requestId === incoming.request.id, 'decline result');
  mika.send({ type: 'respond_request', requestId: incoming.request.id, accept: false });
  assert.equal((await closed).reason, 'declined');

  mika.send({ type: 'update_blocks', blockedIds: [ariGuestId] });
  const visibleChat = june.next((message) => message.type === 'chat_message' && message.message.text === 'This stays with the other guest.', 'group message to unblocked guest');
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  ari.send({ type: 'send_message', conversationId: groupMika.conversation.id, text: 'This stays with the other guest.' });
  await visibleChat;
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(mika.inbox.some((message) => message.type === 'chat_message' && message.message.text === 'This stays with the other guest.'), false, 'blocked guests should not receive this browser’s messages');

  const disconnectUpdate = mika.next((message) => message.type === 'conversation_updated' && message.conversation.id === groupMika.conversation.id && !message.conversation.memberIds.includes(ariState.selfId), 'disconnect cleanup');
  ari.close();
  assert.equal((await disconnectUpdate).conversation.memberIds.length, 2);

  const reconnect = client('Ari', 'cloud', ariGuestId);
  peers.push(reconnect);
  const restoredIdentity = await reconnect.welcome();
  assert.equal(restoredIdentity.players.some((player) => player.nickname === 'Mika'), true, 'the saved guest nickname reconnects into town');
  assert.equal(restoredIdentity.players.some((player) => player.avatarId === 'moss'), true, 'the saved avatar remains visible after reconnect');

  console.log('MULTIPLAYER SMOKE PASS · 4 simultaneous sockets · presence · movement · request/accept/decline · one-to-one and group chat · local block delivery · disconnect/reconnect identity');
} finally {
  await Promise.all(peers.map((peer) => peer.close()));
}
