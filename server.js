import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import { Room, distance } from './game.js';
import { CONFIG as C } from './config.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const clean=(value,max)=>{if(typeof value!=='string')throw new Error('텍스트를 입력해주세요.');const s=value.trim().replace(/[\u0000-\u001f\u007f]/g,'');if(!s||s.length>max)throw new Error(`1~${max}자로 입력해주세요.`);return s;};

// Attach to an existing Socket.IO server without opening another Render port.
export function createNightfall(io) {
  const ns=io.of('/nightfall'),rooms=new Map(),sessions=new Map();
  const directory=()=>[...rooms.values()].map(r=>({code:r.code,name:r.name,count:r.players.size,max:r.maxPlayers,phase:r.phase}));
  const sendDirectory=()=>ns.emit('directory',directory());
  function sendRoom(socket,room,full=false) {
    if(!room)return;
    const session=sessions.get(socket.data.token), own=room.players.get(session?.playerId);
    if(!own)return;
    const s=room.snapshot();
    const admin=own.name==='admin',debugFullMap=admin&&session.debugFullMap===true;
    s.debug={enabled:admin,fullMap:debugFullMap,...(admin?{serverTickRate:C.tickRate}: {})};
    let view=own;
    if(['out','escaped'].includes(own.status)) {
      const targets=s.players.filter(p=>['alive','down','caged','carried'].includes(p.status));
      view=targets.find(p=>p.id===own.spectateId)||targets[0]||own;
    }
    s.viewId=view.id;
    const radius=C.survivorVision*(view.role==='killer'?C.killerVisionMultiplier:1);
    s.players=s.players.map(p=>{
      const bush=room.map.bushes.some(b=>p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h);
      const visible=debugFullMap||p.id===view.id||(!p.hidden&&distance(view,p)<=radius&&!(view.role==='killer'&&p.role==='survivor'&&bush&&distance(view,p)>65));
      return {...p,x:visible?p.x:null,y:visible?p.y:null};
    });
    // Full object inspection is available only to the explicitly requested admin nickname.
    if(!debugFullMap)s.map={...s.map,cabinets:s.map.cabinets.map(({occupant,...c})=>c),generators:s.map.generators.map(({workers,...g})=>g),cages:s.map.cages.map(({rescuers,...c})=>c)};
    if(!full) { const {walls,bushes,width,height,seed,...dynamic}=s.map;s.map=dynamic;delete s.config; }
    socket.emit('state',s);
  }
  function broadcast(room,full=false){for(const socket of ns.sockets.values())if(sessions.get(socket.data.token)?.roomCode===room.code)sendRoom(socket,room,full);}
  function leave(session) {
    const room=rooms.get(session.roomCode), p=room?.players.get(session.playerId);
    if(p){p.connected=false;p.input={x:0,y:0,space:false};p.disconnectTime=C.disconnectGraceSeconds;if(room.phase!=='playing')room.players.delete(p.id);
      if(room.hostId===p.id)room.hostId=[...room.players.values()].find(q=>q.connected)?.id||null;
      if(![...room.players.values()].some(q=>q.connected)){rooms.delete(room.code);}else broadcast(room,true);
    }
    session.roomCode=null;session.playerId=null;session.debugFullMap=false;sendDirectory();
  }
  ns.use((socket,next)=>{try {const token=socket.handshake.auth.token;if(typeof token!=='string'||! /^[a-f0-9-]{36}$/i.test(token))throw new Error('접속 토큰이 올바르지 않습니다.');socket.data.token=token;next();}catch(e){next(e);}});
  ns.on('connection',socket=>{
    const token=socket.data.token;
    let session=sessions.get(token);
    if(session?.socketId)ns.sockets.get(session.socketId)?.disconnect(true);
    session??={roomCode:null,playerId:null,socketId:null,disconnectedAt:null,lastAction:0};
    session.socketId=socket.id;session.disconnectedAt=null;sessions.set(token,session);
    socket.emit('directory',directory());
    const previous=rooms.get(session.roomCode),p=previous?.players.get(session.playerId);
    if(p){p.connected=true;p.disconnectTime=0;socket.emit('identity',p.id);broadcast(previous,true);}else {session.roomCode=null;session.playerId=null;socket.emit('state',null);}
    const active=()=>{const room=rooms.get(session.roomCode);if(!room)throw new Error('먼저 방에 입장해주세요.');return room;};
    const action=(event,fn)=>socket.on(event,(data,ack)=>{try{if(session.socketId!==socket.id)throw new Error('다른 창에서 연결되었습니다.');if(event!=='input'){if(Date.now()-session.lastAction<100)throw new Error('잠시 후 다시 시도해주세요.');session.lastAction=Date.now();}fn(data);if(typeof ack==='function')ack({ok:true});}catch(e){if(typeof ack==='function')ack({ok:false,error:e.message});}});
    action('create',data=>{
      if(session.roomCode)throw new Error('현재 방에서 먼저 나가주세요.');if(rooms.size>=50)throw new Error('현재 생성 가능한 방이 모두 찼습니다.');
      const name=clean(data?.name,24),nickname=clean(data?.nickname,12),max=Number(data?.maxPlayers??6);if(!Number.isInteger(max)||max<3||max>C.maxPlayers)throw new Error('정원은 3~16명입니다.');
      let code;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
      const room=new Room(code,name,max),p=room.addPlayer(nickname);rooms.set(code,room);session.roomCode=code;session.playerId=p.id;socket.emit('identity',p.id);broadcast(room,true);sendDirectory();
    });
    action('join',data=>{if(session.roomCode)throw new Error('현재 방에서 먼저 나가주세요.');const code=clean(data?.code,6).toUpperCase(),room=rooms.get(code);if(!room)throw new Error('방 코드를 확인해주세요.');const p=room.addPlayer(clean(data?.nickname,12));session.roomCode=code;session.playerId=p.id;socket.emit('identity',p.id);broadcast(room,true);sendDirectory();});
    action('debug-view',data=>{const r=active(),p=r.players.get(session.playerId);if(p?.name!=='admin')throw new Error('admin 플레이어만 디버깅 모드를 사용할 수 있습니다.');if(typeof data?.fullMap!=='boolean')throw new Error('맵 보기 값이 올바르지 않습니다.');session.debugFullMap=data.fullMap;sendRoom(socket,r,true);});
    socket.on('debug-ping',ack=>{if(session.socketId===socket.id&&rooms.get(session.roomCode)?.players.get(session.playerId)?.name==='admin'&&typeof ack==='function')ack({ok:true});});
    action('role',data=>{const r=active();r.setRole(session.playerId,data?.role);broadcast(r,true);});
    action('start',()=>{const r=active();r.start(session.playerId);broadcast(r,true);sendDirectory();});
    action('reset',()=>{const r=active();r.reset(session.playerId);broadcast(r,true);sendDirectory();});
    action('leave',()=>{leave(session);socket.emit('state',null);});
    action('input',data=>{const r=active(),p=r.players.get(session.playerId);if(!p)return;p.input={x:Number.isFinite(data?.x)?Math.max(-1,Math.min(1,data.x)):0,y:Number.isFinite(data?.y)?Math.max(-1,Math.min(1,data.y)):0,space:data?.space===true};});
    socket.on('disconnect',()=>{if(session.socketId!==socket.id)return;session.socketId=null;session.disconnectedAt=Date.now();const r=rooms.get(session.roomCode),p=r?.players.get(session.playerId);if(p){p.connected=false;p.input={x:0,y:0,space:false};if(r.hostId===p.id)r.hostId=[...r.players.values()].find(q=>q.connected)?.id||p.id;broadcast(r,true);}});
  });
  let ticks=0,last=performance.now();
  const timer=setInterval(()=>{
    const now=performance.now(),dt=Math.min(.1,(now-last)/1000);last=now;ticks++;
    for(const room of rooms.values()){const before=room.phase;room.tick(dt);if(ticks%3===0&&room.phase!=='lobby')broadcast(room);else if(ticks%3===0)for(const socket of ns.sockets.values()){const s=sessions.get(socket.data.token);if(s?.roomCode===room.code&&s.debugFullMap)sendRoom(socket,room);}if(before!==room.phase)sendDirectory();}
    if(ticks%C.tickRate===0)for(const [token,s] of sessions){if(s.disconnectedAt&&Date.now()-s.disconnectedAt>C.disconnectGraceSeconds*1000){leave(s);sessions.delete(token);}}
  },1000/C.tickRate);timer.unref();
  return {rooms,namespace:ns,close(){clearInterval(timer);ns.disconnectSockets(true);}};
}

export async function handleNightfallRequest(req,res,base='/dbd') {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname===`${base}/api/health`){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,game:'nightfall'}));return true;}
  if(url.pathname===base){res.writeHead(302,{Location:`${base}/`});res.end();return true;}
  if(!url.pathname.startsWith(`${base}/`))return false;
  const file=url.pathname.slice(base.length+1)||'index.html';
  if(!['index.html','app.js','style.css','debug.js','debug.css'].includes(file)){res.writeHead(404);res.end('Not found');return true;}
  try {const body=await readFile(path.join(root,'public',file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(body);}catch{res.writeHead(500);res.end('Game assets unavailable');}return true;
}
export function createStandaloneServer(){const http=createServer(async(req,res)=>{if(await handleNightfallRequest(req,res))return;if(req.url==='/'){res.writeHead(302,{Location:'/dbd/'});res.end();}else{res.writeHead(404);res.end();}});const io=new Server(http,{maxHttpBufferSize:16384});const game=createNightfall(io);return {http,io,game,close:()=>{game.close();return new Promise(resolve=>io.close(resolve));}};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createStandaloneServer(),port=Number(process.env.PORT)||3002;server.http.listen(port,'0.0.0.0',()=>console.log(`NIGHTFALL: http://localhost:${port}/dbd/`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close().then(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
}
