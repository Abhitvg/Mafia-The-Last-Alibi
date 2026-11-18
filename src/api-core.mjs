import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { createRoom, makeRoomCode, publicState, startGame, advanceIfExpired, resolveNight, resolveVote, DISCUSSION_MS, VOTE_MS, NIGHT_MS } from './game-engine.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const cleanName = s => String(s || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (message, status = 400) => json({ error: message }, status);

export function createApi({ store, now = () => Date.now(), random = () => randomInt(0, 1_000_000) / 1_000_000, id = randomUUID, token = () => randomBytes(32).toString('base64url') }) {
  async function read(code) {
    const entry = await store.getWithMetadata(code, { consistency: 'strong', type: 'json' });
    if (!entry) return null;
    return { room: entry.data, etag: entry.etag };
  }
  async function write(code, room, etag) {
    const result = await store.setJSON(code, room, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    return result.modified;
  }
  async function update(code, mutate) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await read(code);
      if (!current) throw Object.assign(new Error('Room not found.'), { status: 404 });
      const room = structuredClone(current.room);
      mutate(room);
      room.updatedAt = now();
      if (await write(code, room, current.etag)) return room;
    }
    throw Object.assign(new Error('Room is busy. Please retry.'), { status: 409 });
  }
  function identify(room, rawToken) {
    if (!rawToken) throw Object.assign(new Error('Your player session is missing. Rejoin using your saved session.'), { status: 401 });
    const player = room.players.find(p => p.tokenHash === hash(rawToken));
    if (!player) throw Object.assign(new Error('Invalid player session.'), { status: 403 });
    return player;
  }
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-player-token' } });
    try {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      if (req.method === 'GET' && action === 'health') return json({ ok: true, game: 'Mafia: The Last Alibi' });
      if (req.method !== 'POST') return fail('Use POST for game actions.', 405);
      const body = await req.json();
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const rawToken = req.headers.get('x-player-token') || body.token;
      const playerName = cleanName(body.name);

      if (action === 'create') {
        if (!playerName) return fail('Enter a nickname.');
        let roomCode, room;
        for (let i = 0; i < 8; i++) {
          roomCode = makeRoomCode(random);
          const raw = token();
          room = createRoom({ code: roomCode, playerId: id(), name: playerName, tokenHash: hash(raw), now: now() });
          if (await write(roomCode, room, null)) return json({ token: raw, state: publicState(room, room.players[0].id, now()) });
        }
        return fail('Could not create a unique room. Try again.', 503);
      }

      if (!code) return fail('Enter a valid six-character room code.');
      if (action === 'join') {
        if (!playerName) return fail('Enter a nickname.');
        const current = await read(code);
        if (!current) return fail('Room not found. Check the code.', 404);
        const raw = token(); const playerId = id();
        const room = await update(code, r => {
          if (r.status !== 'lobby') throw new Error('This game has already started.');
          if (r.players.length >= 8) throw new Error('This room is full.');
          if (r.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) throw new Error('That nickname is already taken.');
          r.players.push({ id: playerId, name: playerName, tokenHash: hash(raw), alive: true, ready: true, role: null, joinedAt: now(), lastSeen: now() });
          r.lastEvent = `${playerName} joined the room.`;
        });
        return json({ token: raw, state: publicState(room, playerId, now()) });
      }

      const current = await read(code);
      if (!current) return fail('Room not found.', 404);
      const me = identify(current.room, rawToken);
      if (action === 'poll') {
        let room = current.room;
        const heartbeatDue = !me.lastSeen || now() - me.lastSeen > 10_000;
        const host = room.players.find(p => p.id === room.hostId);
        const hostExpired = host && host.id !== me.id && (!host.lastSeen || now() - host.lastSeen > 30_000);
        if ((room.status === 'playing' && room.deadline && now() >= room.deadline) || heartbeatDue || hostExpired) {
          try {
            room = await update(code, r => {
              const actor = identify(r, rawToken);
              actor.lastSeen = now();
              if (r.status === 'playing' && r.deadline && now() >= r.deadline) advanceIfExpired(r, now());
              const currentHost = r.players.find(p => p.id === r.hostId);
              if (currentHost && (!currentHost.lastSeen || now() - currentHost.lastSeen > 30_000)) {
                const nextHost = r.players.filter(p => p.id !== currentHost.id && (!p.lastSeen || now() - p.lastSeen <= 30_000)).sort((a,b) => a.joinedAt - b.joinedAt)[0];
                if (nextHost) { r.hostId = nextHost.id; r.lastEvent = `${nextHost.name} is now the host because the previous host disconnected.`; }
              }
            });
          } catch (e) { if (e.status !== 409) throw e; }
        }
        const latest = await read(code);
        return json({ state: publicState(latest.room, me.id, now()) });
      }

      const room = await update(code, r => {
        const actor = identify(r, rawToken);
        actor.lastSeen = now();
        if (action === 'ready') {
          if (r.status !== 'lobby') throw new Error('The game has already started.');
          actor.ready = !!body.ready; return;
        }
        if (action === 'start') {
          if (actor.id !== r.hostId) throw new Error('Only the host can start the game.');
          startGame(r, now(), random); return;
        }
        if (r.status !== 'playing') throw new Error('The game is not in progress.');
        advanceIfExpired(r, now());
        if (r.status !== 'playing') throw new Error('The game has ended.');
        if (!actor.alive) throw new Error('Eliminated players cannot act.');
        if (action === 'chat') {
          if (r.phase !== 'discussion' && !(r.phase === 'night' && actor.role === 'mafia')) throw new Error('Chat is unavailable in this phase.');
          const message = String(body.message || '').trim().slice(0, 240);
          if (!message) throw new Error('Message cannot be empty.');
          const channel = r.phase === 'night' ? 'mafia' : 'public';
          r.chat.push({ id: id(), playerId: actor.id, name: actor.name, message, channel, at: now() });
          r.chat = r.chat.slice(-120); return;
        }
        if (action === 'night') {
          if (r.phase !== 'night') throw new Error('Night actions are closed.');
          const expected = actor.role === 'mafia' ? 'kill' : actor.role === 'detective' ? 'investigate' : actor.role === 'doctor' ? 'protect' : null;
          if (!expected || body.type !== expected) throw new Error('Your role cannot perform that action.');
          const target = r.players.find(p => p.id === body.targetId && p.alive && p.id !== actor.id && !(actor.role === 'mafia' && p.role === 'mafia'));
          if (!target) throw new Error('Choose a valid living target.');
          if (actor.role === 'doctor' && r.lastProtectedId === target.id) throw new Error('You cannot protect the same player on consecutive nights.');
          r.actions[actor.id] = target.id;
          if (actor.role === 'doctor') r.lastProtectedId = target.id;
          const required = r.players.filter(p => p.alive && ['mafia','detective','doctor'].includes(p.role));
          if (required.every(p => r.actions[p.id])) {
            resolveNight(r, now());
          }
          return;
        }
        if (action === 'vote') {
          if (r.phase !== 'vote') throw new Error('Voting is not open.');
          if (r.votes[actor.id]) throw new Error('You have already voted.');
          const target = r.players.find(p => p.id === body.targetId && p.alive && p.id !== actor.id);
          if (!target) throw new Error('Choose a valid living player.');
          r.votes[actor.id] = target.id;
          if (r.players.filter(p => p.alive).every(p => r.votes[p.id])) resolveVote(r, now());
          return;
        }
        throw new Error('Unknown game action.');
      });
      return json({ state: publicState(room, me.id, now()) });
    } catch (error) {
      return fail(error.message || 'Unexpected server error.', error.status || 400);
    }
  };
}
