export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;
export const DISCUSSION_MS = 60_000;
export const VOTE_MS = 30_000;
export const REVOTE_MS = 20_000;
export const NIGHT_MS = 30_000;

export function roleCounts(n) {
  if (n < 4 || n > 8) throw new Error('Games require 4–8 players.');
  return n === 4 ? { mafia: 1, detective: 1, doctor: 0, citizen: 2 }
    : n === 5 ? { mafia: 1, detective: 1, doctor: 1, citizen: 2 }
    : n === 6 ? { mafia: 2, detective: 1, doctor: 1, citizen: 2 }
    : n === 7 ? { mafia: 2, detective: 1, doctor: 1, citizen: 3 }
    : { mafia: 2, detective: 1, doctor: 1, citizen: 4 };
}

export function shuffle(items, random = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeRoles(n, random = Math.random) {
  const counts = roleCounts(n);
  return shuffle(Object.entries(counts).flatMap(([role, count]) => Array(count).fill(role)), random);
}

export function makeRoomCode(random = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}

export function publicState(room, playerId, now = Date.now()) {
  const me = room.players.find(p => p.id === playerId);
  if (!me) throw new Error('Player not found.');
  const alive = room.players.filter(p => p.alive);
  const phase = room.phase;
  const visibleChat = me.alive ? (room.chat || []).filter(m => m.channel === 'public' || (m.channel === 'mafia' && me.role === 'mafia')) : [];
  const view = {
    code: room.code, status: room.status, phase, round: room.round,
    hostId: room.hostId, me: { id: me.id, name: me.name, role: room.status === 'playing' ? me.role : null, alive: me.alive },
    players: room.players.map(p => ({ id: p.id, name: p.name, alive: p.alive, role: room.status === 'finished' || !p.alive ? p.role : undefined, isHost: p.id === room.hostId, ready: !!p.ready })),
    chat: visibleChat.slice(-80), deadline: room.deadline, serverNow: now,
    timeLeftMs: room.deadline ? Math.max(0, room.deadline - now) : null,
    winner: room.winner, lastEvent: room.lastEvent,
    canStart: me.id === room.hostId && room.status === 'lobby' && room.players.length >= 4 && room.players.every(p => p.ready),
    actions: {}
  };
  view.actions.hasActed = !!room.actions?.[playerId];
  view.actions.hasVoted = !!room.votes?.[playerId];
  if (me.role === 'detective' && room.status === 'playing') view.actions.investigation = room.privateResults?.[me.id] || null;
  if (room.status === 'playing' && me.alive) {
    if (phase === 'night') {
      view.actions.targets = alive.filter(p => p.id !== me.id).map(p => ({ id: p.id, name: p.name }));
      view.actions.canAct = ['mafia','detective','doctor'].includes(me.role);
      view.actions.actionType = me.role === 'mafia' ? 'kill' : me.role === 'detective' ? 'investigate' : me.role === 'doctor' ? 'protect' : null;
      view.actions.teammates = me.role === 'mafia' ? room.players.filter(p => p.role === 'mafia').map(p => ({ id: p.id, name: p.name, alive: p.alive })) : [];
      view.actions.investigation = room.privateResults?.[me.id] || null;
    }
    if (phase === 'discussion') view.actions.canChat = true;
    if (phase === 'night' && me.role === 'mafia') view.actions.canChat = true;
    if (phase === 'vote') {
      view.actions.targets = alive.filter(p => p.id !== me.id).map(p => ({ id: p.id, name: p.name }));
      view.actions.hasVoted = !!room.votes?.[me.id];
    }
  }
  return view;
}

export function createRoom({ code, playerId, name, tokenHash, now = Date.now() }) {
  return {
    code, status: 'lobby', phase: 'lobby', round: 0, hostId: playerId,
    players: [{ id: playerId, name, tokenHash, alive: true, ready: true, role: null, joinedAt: now, lastSeen: now }],
    chat: [], createdAt: now, updatedAt: now, deadline: null,
    actions: {}, votes: {}, privateResults: {}, lastEvent: 'Room created. Waiting for players.', winner: null
  };
}

export function startGame(room, now = Date.now(), random = Math.random) {
  if (room.status !== 'lobby') throw new Error('Game has already started.');
  if (room.players.length < 4 || room.players.length > 8) throw new Error('The game needs 4–8 players.');
  if (!room.players.every(p => p.ready)) throw new Error('Everyone must be ready.');
  const roles = makeRoles(room.players.length, random);
  room.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
  room.status = 'playing'; room.phase = 'night'; room.round = 1;
  room.actions = {}; room.votes = {}; room.privateResults = {}; room.revoteUsed = false;
  room.deadline = now + NIGHT_MS;
  room.lastEvent = 'Night 1 begins. Special roles, make your choices.';
  room.chat = [];
  return room;
}

export function checkWinner(room) {
  const mafia = room.players.filter(p => p.alive && p.role === 'mafia').length;
  const town = room.players.filter(p => p.alive && p.role !== 'mafia').length;
  if (mafia === 0) return 'town';
  if (mafia >= town) return 'mafia';
  return null;
}

export function resolveNight(room, now = Date.now()) {
  if (room.phase !== 'night') throw new Error('It is not night.');
  const alive = room.players.filter(p => p.alive);
  const mafia = alive.filter(p => p.role === 'mafia');
  const mafiaVotes = mafia.map(p => room.actions[p.id]).filter(Boolean);
  let killTarget = null;
  if (mafiaVotes.length) {
    const counts = new Map(); mafiaVotes.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    const max = Math.max(...counts.values());
    const leaders = [...counts].filter(([, n]) => n === max).map(([id]) => id);
    if (leaders.length === 1 && mafiaVotes.length === mafia.length) killTarget = leaders[0];
  }
  const doctor = alive.find(p => p.role === 'doctor');
  const protectedId = doctor ? room.actions[doctor.id] : null;
  const detective = alive.find(p => p.role === 'detective');
  if (detective && room.actions[detective.id]) {
    const target = room.players.find(p => p.id === room.actions[detective.id]);
    if (target) room.privateResults[detective.id] = { name: target.name, result: target.role === 'mafia' ? 'mafia' : 'town', round: room.round };
  }
  let eliminated = null;
  if (killTarget && killTarget !== protectedId) {
    const target = room.players.find(p => p.id === killTarget && p.alive);
    if (target) { target.alive = false; eliminated = { id: target.id, name: target.name, role: target.role }; }
  }
  room.actions = {};
  const winner = checkWinner(room);
  if (winner) {
    room.status = 'finished'; room.phase = 'finished'; room.winner = winner; room.deadline = null;
    room.lastEvent = winner === 'town' ? 'All Mafia have been eliminated. Town wins!' : 'Mafia now controls the majority. Mafia wins!';
  } else {
    room.phase = 'discussion'; room.deadline = now + DISCUSSION_MS;
    room.lastEvent = eliminated ? `${eliminated.name} was eliminated. Their role was ${eliminated.role.toUpperCase()}.` : 'No one was eliminated last night.';
    room.lastElimination = eliminated;
  }
  return room;
}

export function resolveVote(room, now = Date.now()) {
  if (room.phase !== 'vote') throw new Error('Voting is not active.');
  const alive = room.players.filter(p => p.alive);
  const votes = Object.entries(room.votes).filter(([voter, target]) => alive.some(p => p.id === voter) && alive.some(p => p.id === target));
  const counts = new Map(); votes.forEach(([, target]) => counts.set(target, (counts.get(target) || 0) + 1));
  let eliminated = null;
  let tied = false;
  if (counts.size) {
    const max = Math.max(...counts.values());
    const leaders = [...counts].filter(([, n]) => n === max).map(([id]) => id);
    tied = leaders.length > 1;
    if (!tied) {
      const p = room.players.find(p => p.id === leaders[0]);
      if (p?.alive) { p.alive = false; eliminated = { id: p.id, name: p.name, role: p.role }; }
    }
  }
  room.votes = {};
  if (tied && !room.revoteUsed) {
    room.revoteUsed = true;
    room.phase = 'vote';
    room.deadline = now + REVOTE_MS;
    room.lastEvent = 'The vote was tied. A final revote begins.';
    return room;
  }
  room.revoteUsed = false;
  const winner = checkWinner(room);
  if (winner) {
    room.status = 'finished'; room.phase = 'finished'; room.winner = winner; room.deadline = null;
    room.lastEvent = winner === 'town' ? 'All Mafia have been eliminated. Town wins!' : 'Mafia now controls the majority. Mafia wins!';
  } else {
    room.round += 1; room.phase = 'night'; room.deadline = now + NIGHT_MS;
    room.lastEvent = eliminated ? `${eliminated.name} was voted out. Their role was ${eliminated.role.toUpperCase()}.` : 'The final vote was tied. Nobody was eliminated.';
  }
  return room;
}

export function advanceIfExpired(room, now = Date.now()) {
  if (room.status !== 'playing' || !room.deadline || now < room.deadline) return room;
  if (room.phase === 'night') return resolveNight(room, now);
  if (room.phase === 'discussion') {
    room.phase = 'vote'; room.deadline = now + VOTE_MS; room.lastEvent = 'Discussion ended. Cast your vote.';
    return room;
  }
  if (room.phase === 'vote') return resolveVote(room, now);
  return room;
}
