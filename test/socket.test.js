import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { createStandaloneServer } from '../server.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const emit=(s,event,data={})=>new Promise((resolve,reject)=>s.timeout(2000).emit(event,data,(e,r)=>e?reject(e):resolve(r)));
async function fixture(t){const server=createStandaloneServer();await new Promise(resolve=>server.http.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.http.address().port}`,clients=[];
  t.after(async()=>{for(const c of clients)c.disconnect();await server.close();});
  async function client(token=randomUUID()){const s=connect(`${url}/nightfall`,{auth:{token},forceNew:true,transports:['websocket']});s.latest=null;s.identity=null;s.on('state',v=>{s.latest=v?{...v,map:{...s.latest?.map,...v.map}}:null;});s.on('identity',id=>s.identity=id);clients.push(s);await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});return s;}
  return {server,url,client};
}
test('real sockets create/join, validate roles, move, isolate rooms, reconnect and serve assets',async t=>{
  const {server,url,client}=await fixture(t),k=await client(),aToken=randomUUID(),a=await client(aToken),b=await client(),other=await client();
  assert.equal((await fetch(`${url}/dbd/api/health`)).status,200);assert.match(await (await fetch(`${url}/dbd/`)).text(),/NIGHTFALL/);assert.equal((await fetch(`${url}/dbd/no-file`)).status,404);
  assert.equal((await emit(k,'create',{name:'room',nickname:'K',maxPlayers:6})).ok,true);await sleep(20);const code=k.latest.code;
  assert.equal((await emit(a,'join',{code,nickname:'A'})).ok,true);assert.equal((await emit(b,'join',{code,nickname:'B'})).ok,true);
  assert.equal((await emit(other,'create',{name:'other',nickname:'O',maxPlayers:3})).ok,true);await sleep(120);
  assert.equal((await emit(a,'start')).ok,false);assert.equal((await emit(k,'start')).ok,true);await sleep(120);
  assert.equal(a.latest.phase,'playing');assert.equal(other.latest.phase,'lobby');const room=server.game.rooms.get(code),p=room.players.get(a.identity),initial=p.x;
  a.emit('input',{x:1,y:0,space:false});await sleep(180);a.emit('input',{x:0,y:0,space:false});assert.ok(p.x>initial);
  const id=a.identity;a.disconnect();await sleep(40);assert.equal(p.connected,false);const again=await client(aToken);await sleep(120);assert.equal(again.identity,id);assert.equal(p.connected,true);assert.equal(again.latest.phase,'playing');
  assert.equal((await emit(again,'leave')).ok,true);await sleep(120);assert.equal(again.latest,null);assert.equal(room.players.get(id).status,'out');
});
test('server masks positions outside view, cabinets and bushes; spectator gets followed vision',async t=>{
  const {server,client}=await fixture(t),k=await client(),a=await client(),b=await client();await emit(k,'create',{name:'fog',nickname:'K',maxPlayers:3});await sleep(30);const code=k.latest.code;await emit(a,'join',{code,nickname:'A'});await emit(b,'join',{code,nickname:'B'});await sleep(120);await emit(k,'start');await sleep(120);
  const room=server.game.rooms.get(code),killer=room.players.get(k.identity),survivor=room.players.get(a.identity);killer.x=100;killer.y=100;survivor.x=2800;survivor.y=2200;await sleep(150);assert.equal(k.latest.players.find(p=>p.id===a.identity).x,null);
  survivor.x=200;survivor.y=100;await sleep(150);assert.equal(k.latest.players.find(p=>p.id===a.identity).x,200);
  const bush=room.map.bushes[0];survivor.x=bush.x+50;survivor.y=bush.y+50;killer.x=survivor.x-160;killer.y=survivor.y;await sleep(150);assert.equal(k.latest.players.find(p=>p.id===a.identity).x,null);killer.x=survivor.x-50;await sleep(150);assert.notEqual(k.latest.players.find(p=>p.id===a.identity).x,null);
  survivor.hidden=room.map.cabinets[0].id;await sleep(150);assert.equal(k.latest.players.find(p=>p.id===a.identity).x,null);assert.equal(k.latest.map.cabinets[0].occupant,undefined);
  survivor.hidden=null;survivor.status='out';survivor.spectateId=killer.id;await sleep(150);assert.equal(a.latest.viewId,killer.id);assert.notEqual(a.latest.players.find(p=>p.id===killer.id).x,null);
});
test('admin can inspect the lobby and full map; regular users retain fog and cannot enable debug',async t=>{
  const {server,url,client}=await fixture(t),adminToken=randomUUID(),admin=await client(adminToken),a=await client(),b=await client();
  assert.equal((await fetch(`${url}/dbd/debug.js`)).status,200);assert.equal((await fetch(`${url}/dbd/debug.css`)).status,200);
  await emit(admin,'create',{name:'debug',nickname:'admin',maxPlayers:3});await sleep(30);const code=admin.latest.code;
  await emit(a,'join',{code,nickname:'normal'});await emit(b,'join',{code,nickname:'second'});await sleep(120);
  assert.equal(admin.latest.debug.enabled,true);assert.equal(a.latest.debug.enabled,false);
  assert.equal((await emit(a,'debug-view',{fullMap:true})).ok,false);
  assert.equal((await emit(admin,'debug-view',{fullMap:'true'})).ok,false);await sleep(120);
  assert.equal((await emit(admin,'debug-view',{fullMap:true})).ok,true);await sleep(30);
  assert.equal(admin.latest.debug.fullMap,true);assert.equal(admin.latest.phase,'lobby');assert.equal(admin.latest.map.walls.length,60);
  await sleep(120);await emit(admin,'start');await sleep(120);
  const room=server.game.rooms.get(code),p=room.players.get(a.identity),other=room.players.get(b.identity),h=room.map.cabinets[0];
  p.x=h.x;p.y=h.y;p.hidden=h.id;h.occupant=p.id;other.x=3000;other.y=2200;
  await sleep(150);
  assert.equal(admin.latest.players.find(q=>q.id===p.id).x,h.x);assert.equal(admin.latest.map.cabinets[0].occupant,p.id);
  assert.equal(admin.latest.players.find(q=>q.id===other.id).x,3000);assert.equal(a.latest.players.find(q=>q.id===other.id).x,null);assert.equal(a.latest.map.cabinets[0].occupant,undefined);
  assert.equal((await emit(admin,'debug-view',{fullMap:false})).ok,true);await sleep(120);
  assert.equal(admin.latest.players.find(q=>q.id===p.id).x,null);assert.equal(admin.latest.map.cabinets[0].occupant,undefined);
  await emit(admin,'debug-view',{fullMap:true});await sleep(120);admin.disconnect();await sleep(40);const again=await client(adminToken);await sleep(120);assert.equal(again.latest.debug.fullMap,true);
  const ping=await new Promise((resolve,reject)=>again.timeout(2000).emit('debug-ping',(err,r)=>err?reject(err):resolve(r)));assert.equal(ping.ok,true);
  await emit(again,'leave');await sleep(120);await emit(again,'create',{name:'ordinary',nickname:'regular',maxPlayers:3});await sleep(30);assert.equal(again.latest.debug.enabled,false);assert.equal(again.latest.debug.fullMap,false);
});
