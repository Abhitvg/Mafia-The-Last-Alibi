import test from 'node:test';
import assert from 'node:assert/strict';
import { roleCounts, makeRoles, createRoom, startGame, resolveNight, resolveVote, publicState, checkWinner, advanceIfExpired } from '../src/game-engine.mjs';
import { createApi } from '../src/api-core.mjs';

const fixedRandom = () => 0.17;

test('role distribution is correct for every supported player count', () => {
  const expected = {
    4: {mafia:1,detective:1,doctor:0,citizen:2},
    5: {mafia:1,detective:1,doctor:1,citizen:2},
    6: {mafia:2,detective:1,doctor:1,citizen:2},
    7: {mafia:2,detective:1,doctor:1,citizen:3},
    8: {mafia:2,detective:1,doctor:1,citizen:4}
  };
  for (let n=4;n<=8;n++) assert.deepEqual(roleCounts(n), expected[n]);
  assert.throws(()=>roleCounts(3)); assert.throws(()=>roleCounts(9));
});

test('secret roles are not exposed to other players', () => {
  const room=createRoom({code:'ABC234',playerId:'p1',name:'One',tokenHash:'x',now:1});
  room.players.push({id:'p2',name:'Two',tokenHash:'y',alive:true,ready:true,role:'mafia'});
  room.status='playing'; room.phase='night'; room.players[0].role='citizen';
  const view=publicState(room,'p1',2);
  assert.equal(view.me.role,'citizen');
  assert.equal(view.players.find(p=>p.id==='p2').role,undefined);
});

test('doctor protection blocks a night elimination and detective result stays private', () => {
  const room={code:'ABC234',status:'playing',phase:'night',round:1,players:[
    {id:'m',name:'M',role:'mafia',alive:true},{id:'d',name:'D',role:'detective',alive:true},{id:'h',name:'H',role:'doctor',alive:true},{id:'c',name:'C',role:'citizen',alive:true}
  ],actions:{m:'c',d:'m',h:'c'},votes:{},privateResults:{},chat:[],deadline:100};
  resolveNight(room,50);
  assert.equal(room.players.find(p=>p.id==='c').alive,true);
  assert.equal(room.privateResults.d.result,'mafia');
  assert.equal(room.phase,'discussion');
});

test('vote tie triggers one revote; second tie moves to the next night', () => {
  const room={code:'ABC234',status:'playing',phase:'vote',round:1,players:[
    {id:'m',name:'M',role:'mafia',alive:true},{id:'a',name:'A',role:'citizen',alive:true},{id:'b',name:'B',role:'citizen',alive:true},{id:'d',name:'D',role:'detective',alive:true}
  ],votes:{m:'a',a:'b',b:'a',d:'b'},deadline:100};
  resolveVote(room,50); assert.equal(room.phase,'vote'); assert.equal(room.revoteUsed,true);
  room.votes={m:'a',a:'b',b:'a',d:'b'}; resolveVote(room,70);
  assert.equal(room.phase,'night'); assert.equal(room.round,2); assert.equal(room.revoteUsed,false);
});

test('full match reaches a winner after a night and a town vote', () => {
  const room={code:'ABC234',status:'playing',phase:'night',round:1,players:[
    {id:'m',name:'M',role:'mafia',alive:true},{id:'d',name:'D',role:'detective',alive:true},{id:'c1',name:'C1',role:'citizen',alive:true},{id:'c2',name:'C2',role:'citizen',alive:true}
  ],actions:{m:'c1',d:'m'},votes:{},privateResults:{},chat:[],deadline:100};
  resolveNight(room,50); assert.equal(room.phase,'discussion'); assert.equal(room.players.find(p=>p.id==='c1').alive,false);
  room.phase='vote'; room.votes={m:'d',d:'m',c2:'m'}; resolveVote(room,70);
  assert.equal(room.status,'finished'); assert.equal(room.winner,'town'); assert.equal(checkWinner(room),'town');
});

test('server API creates room, joins another player, starts game and rejects unauthorized start', async () => {
  const data=new Map();let version=0;let tokenCounter=0;
  const store={
    async getWithMetadata(k){const e=data.get(k);return e?{data:structuredClone(e.data),etag:e.etag}:null;},
    async setJSON(k,v,o={}){const old=data.get(k);if(o.onlyIfNew&&old)return{modified:false};if(o.onlyIfMatch&&(!old||old.etag!==o.onlyIfMatch))return{modified:false};const etag=`"${++version}"`;data.set(k,{data:structuredClone(v),etag});return{modified:true,etag};}
  };
  const api=createApi({store,now:()=>1000,random:()=>0.12,id:(()=>{let n=0;return()=>`id${++n}`})(),token:()=>`token-${++tokenCounter}`});
  const call=async(action,body={},token)=>{const r=await api(new Request(`http://x/.netlify/functions/game?action=${action}`,{method:'POST',headers:{'content-type':'application/json',...(token?{'x-player-token':token}:{})},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
  const host=await call('create',{name:'Host'});assert.equal(host.status,200);
  const code=host.data.state.code;
  const joiners=[];for(let i=0;i<3;i++)joiners.push(await call('join',{code,name:`Player${i+2}`}));
  assert.equal(joiners.length,3);
  const unauthorized=await call('start',{code},joiners[0].data.token);assert.equal(unauthorized.status,400);
  const started=await call('start',{code},host.data.token);assert.equal(started.status,200);assert.equal(started.data.state.phase,'night');
  assert.equal(started.data.state.players.length,4);
});

test('three-round multiplayer match resolves protection, votes, elimination and final Mafia victory', () => {
  const room={code:'ABC234',status:'playing',phase:'night',round:1,players:[
    {id:'m',name:'M',role:'mafia',alive:true},{id:'d',name:'D',role:'detective',alive:true},{id:'h',name:'H',role:'doctor',alive:true},{id:'c1',name:'C1',role:'citizen',alive:true},{id:'c2',name:'C2',role:'citizen',alive:true}
  ],actions:{m:'c1',d:'m',h:'c1'},votes:{},privateResults:{},chat:[],deadline:100};
  resolveNight(room,50); assert.equal(room.phase,'discussion'); assert.equal(room.players.find(p=>p.id==='c1').alive,true);
  room.phase='vote'; room.votes={m:'c2',d:'c2',h:'c2',c1:'m',c2:'m'}; resolveVote(room,70);
  assert.equal(room.round,2); assert.equal(room.players.find(p=>p.id==='c2').alive,false);
  room.phase='night'; room.actions={m:'d',d:'m',h:'d'}; resolveNight(room,90);
  assert.equal(room.phase,'discussion'); assert.equal(room.players.find(p=>p.id==='d').alive,true);
  room.phase='vote'; room.votes={m:'c1',d:'c1',h:'c1'}; resolveVote(room,110);
  assert.equal(room.round,3); assert.equal(room.players.find(p=>p.id==='c1').alive,false);
  room.phase='night'; room.actions={m:'d',d:'m',h:'h'}; resolveNight(room,130);
  assert.equal(room.status,'finished'); assert.equal(room.winner,'mafia');
});

test('stale host privileges transfer to a recently active player', async () => {
  const data=new Map();let version=0;let clock=1000;let tokenCounter=0;
  const store={
    async getWithMetadata(k){const e=data.get(k);return e?{data:structuredClone(e.data),etag:e.etag}:null;},
    async setJSON(k,v,o={}){const old=data.get(k);if(o.onlyIfNew&&old)return{modified:false};if(o.onlyIfMatch&&(!old||old.etag!==o.onlyIfMatch))return{modified:false};const etag=`"${++version}"`;data.set(k,{data:structuredClone(v),etag});return{modified:true,etag};}
  };
  const api=createApi({store,now:()=>clock,random:()=>0.13,id:(()=>{let n=0;return()=>`p${++n}`})(),token:()=>`t${++tokenCounter}`});
  const call=async(action,body={},token)=>{const r=await api(new Request(`http://x/.netlify/functions/game?action=${action}`,{method:'POST',headers:{'content-type':'application/json',...(token?{'x-player-token':token}:{})},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()};};
  const host=await call('create',{name:'Host'});const guest=await call('join',{code:host.data.state.code,name:'Guest'});
  clock=32_000;const polled=await call('poll',{code:host.data.state.code},guest.data.token);
  assert.equal(polled.data.state.hostId,guest.data.state.me.id);
});
