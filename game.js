import { randomUUID, randomInt } from 'node:crypto';
import { CONFIG as C } from './config.js';

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function intersects(x, y, r, rect) {
  return Math.hypot(x - clamp(x, rect.x, rect.x + rect.w), y - clamp(y, rect.y, rect.y + rect.h)) < r;
}
export function createMap(seed = randomInt(1, 2147483646)) {
  let value = seed;
  const rand = () => ((value = (value * 16807) % 2147483647) - 1) / 2147483646;
  const walls = [], pallets = [], bushes = [], cabinets = [], cages = [];
  // Open lanes separate compounds; all objectives are placed in reachable lanes.
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
    const x = 330 + col * 570, y = 250 + row * 510;
    walls.push({ x, y, w: 135, h: 28 }, { x: x + 210, y, w: 130, h: 28 }, { x, y: y + 28, w: 28, h: 145 });
    pallets.push({ id: `p${pallets.length}`, x: x + 135, y, w: 75, h: 28, state: 'ready', breakProgress: 0 });
    bushes.push({ x: x + 120, y: y + 190, w: 150, h: 95 });
    cabinets.push({ id: `h${cabinets.length}`, x: x + 315, y: y + 90, occupant: null });
  }
  const generators = [ {x: 220,y:650}, {x:1100,y:450}, {x:2200,y:450}, {x:1100,y:1850}, {x:2800,y:1900} ].map((p,i)=>({...p,id:`g${i}`,progress:0}));
  for (const [x,y] of [[650,900],[1650,900],[2700,900],[650,2100],[2100,2100]]) cages.push({ id:`c${cages.length}`,x,y,occupant:null,rescueProgress:0 });
  const horizontal = rand() > .5;
  const exits = horizontal ? [{x:55,y:C.mapHeight/2},{x:C.mapWidth-55,y:C.mapHeight/2}] : [{x:C.mapWidth/2,y:55},{x:C.mapWidth/2,y:C.mapHeight-55}];
  return { seed, width:C.mapWidth,height:C.mapHeight,walls,pallets,bushes,cabinets,cages,generators,exits:exits.map((e,i)=>({...e,id:`e${i}`})) };
}
export class Room {
  constructor(code, name, maxPlayers = C.defaultPlayers) {
    this.code=code; this.name=name; this.maxPlayers=clamp(maxPlayers,3,C.maxPlayers); this.players=new Map();
    this.hostId=null; this.phase='lobby'; this.map=createMap(); this.events=[]; this.elapsed=0; this.result=null; this.updatedAt=Date.now();
  }
  addPlayer(name) {
    if(this.phase!=='lobby') throw new Error('이미 시작된 방입니다.');
    if(this.players.size>=this.maxPlayers) throw new Error('방이 가득 찼습니다.');
    const id=randomUUID();
    const p={id,name,role:this.players.size===0?'killer':'survivor',x:0,y:0,status:'alive',cageCount:0,connected:true,disconnectTime:0,stun:0,immunity:0,carrying:null,hidden:null,action:null,input:{x:0,y:0,space:false},wasSpace:false,spectateId:null};
    this.players.set(id,p); this.hostId??=id; this.updatedAt=Date.now(); return p;
  }
  setRole(id,role) {
    if(this.phase!=='lobby') return;
    const p=this.players.get(id); if(!p || !['killer','survivor'].includes(role)) return;
    if(role==='killer') for(const q of this.players.values()) if(q.role==='killer') q.role='survivor';
    p.role=role;
  }
  start(id) {
    if(id!==this.hostId) throw new Error('방장만 게임을 시작할 수 있습니다.');
    if(this.phase!=='lobby') throw new Error('게임이 이미 진행 중입니다.');
    const roster=[...this.players.values()];
    if(roster.filter(p=>p.role==='killer'&&p.connected).length!==1) throw new Error('살인마는 정확히 1명이어야 합니다.');
    if(roster.filter(p=>p.role==='survivor'&&p.connected).length<C.minSurvivors) throw new Error('도망자는 최소 2명이 필요합니다.');
    if(roster.some(p=>!p.connected)) throw new Error('접속이 끊긴 참가자가 있습니다.');
    this.map=createMap(); this.phase='playing'; this.elapsed=0; this.result=null; this.events=[];
    let n=0;
    for(const p of roster) {
      const killer=p.role==='killer'; Object.assign(p,{x:killer?1600:140+(n%5)*570,y:killer?1200:350+Math.floor(n/5)*510,status:'alive',cageCount:0,stun:0,immunity:0,carrying:null,hidden:null,action:null,wasSpace:false,input:{x:0,y:0,space:false}}); if(!killer)n++;
    }
    this.event('추격이 시작되었습니다. 발전기 5개를 가동하세요.');
  }
  event(text) { this.events.push({id:randomUUID(),text,time:this.elapsed}); this.events=this.events.slice(-8); }
  move(p,dt) {
    if(p.status!=='alive'||p.stun>0||p.hidden) return;
    let {x,y}=p.input; const length=Math.hypot(x,y); if(length>1){x/=length;y/=length;}
    const speed=C.survivorSpeed*(p.role==='killer'?C.killerSpeedMultiplier:1)*(p.carrying ? .8 : 1);
    const blockers=[...this.map.walls,...(p.role==='killer'?this.map.pallets.filter(q=>q.state==='dropped'):[])];
    const nx=clamp(p.x+x*speed*dt,C.playerRadius,this.map.width-C.playerRadius);
    if(!blockers.some(w=>intersects(nx,p.y,C.playerRadius,w)))p.x=nx;
    const ny=clamp(p.y+y*speed*dt,C.playerRadius,this.map.height-C.playerRadius);
    if(!blockers.some(w=>intersects(p.x,ny,C.playerRadius,w)))p.y=ny;
    if(p.carrying){const victim=this.players.get(p.carrying); if(victim){victim.x=p.x;victim.y=p.y+24;}}
  }
  near(p,list,r=C.interactionRadius) {return list.filter(q=>distance(p,{x:q.x+(q.w||0)/2,y:q.y+(q.h||0)/2})<r).sort((a,b)=>distance(p,a)-distance(p,b))[0];}
  dropCarried(p) {if(p.carrying){const q=this.players.get(p.carrying);if(q)q.status='down';p.carrying=null;}}
  interact(p,dt,pressed) {
    p.action=null;
    if(p.status==='out'||p.status==='escaped') {
      if(pressed){const targets=[...this.players.values()].filter(q=>['alive','down','caged','carried'].includes(q.status));const index=targets.findIndex(q=>q.id===p.spectateId);p.spectateId=targets[(index+1)%targets.length]?.id??null;} return;
    }
    if(p.status!=='alive'||p.stun>0||!p.input.space)return;
    if(p.hidden){if(pressed){const cabinet=this.map.cabinets.find(c=>c.id===p.hidden);if(cabinet)cabinet.occupant=null;p.hidden=null;}return;}
    if(p.role==='killer') {
      if(p.carrying){const cage=this.near(p,this.map.cages.filter(c=>!c.occupant));if(cage){p.action={label:'감옥에 가두기',progress:0};if(pressed){const q=this.players.get(p.carrying);q.cageCount++;q.x=cage.x;q.y=cage.y;q.status=q.cageCount>=2?'out':'caged';q.immunity=0;p.carrying=null;if(q.status==='caged')cage.occupant=q.id;this.event(`${q.name} ${q.status==='out'?'탈락 · 관전 모드로 전환': '감금 (1/2)'}`);}return;}return;}
      const down=this.near(p,[...this.players.values()].filter(q=>q.status==='down'));
      if(down){p.action={label:'들어 올리기',progress:0};if(pressed){down.status='carried';p.carrying=down.id;}return;}
      const pallet=this.near(p,this.map.pallets.filter(q=>q.state==='dropped'));
      if(pallet){pallet.breakProgress+=dt;p.action={label:'파레트 부수기',progress:pallet.breakProgress/C.breakPalletSeconds};if(pallet.breakProgress>=C.breakPalletSeconds){pallet.state='broken';this.event('살인마가 파레트를 부쉈습니다.');}return;}
      const cabinet=this.near(p,this.map.cabinets);
      if(cabinet&&pressed&&cabinet.occupant){const q=this.players.get(cabinet.occupant);q.hidden=null;q.status='down';cabinet.occupant=null;this.event(`${q.name} 캐비넷에서 발각`);} return;
    }
    const cage=this.near(p,this.map.cages.filter(c=>c.occupant));
    if(cage){cage.rescuers??=[];cage.rescuers.push(p.id);p.action={label:'동료 구출',progress:cage.rescueProgress/C.rescueSeconds};return;}
    const pallet=this.near(p,this.map.pallets.filter(q=>q.state==='ready'),75);
    if(pallet){p.action={label:'파레트 내리기',progress:0};if(pressed){pallet.state='dropped';const center={x:pallet.x+pallet.w/2,y:pallet.y+pallet.h/2};for(const killer of this.players.values())if(killer.role==='killer'&&distance(killer,center)<130){killer.stun=C.stunSeconds;this.dropCarried(killer);this.event('파레트 적중! 살인마 2초 기절');}}return;}
    const generator=this.near(p,this.map.generators.filter(g=>g.progress<C.generatorSeconds));
    if(generator){generator.workers??=[];generator.workers.push(p.id);p.action={label:'발전기 수리',progress:generator.progress/C.generatorSeconds};return;}
    const cabinet=this.near(p,this.map.cabinets.filter(c=>!c.occupant),65);
    if(cabinet){p.action={label:'캐비넷 숨기',progress:0};if(pressed){cabinet.occupant=p.id;p.hidden=cabinet.id;p.x=cabinet.x;p.y=cabinet.y;}}
  }
  tick(dt) {
    if(this.phase!=='playing')return; this.elapsed+=dt;
    for(const g of this.map.generators)g.workers=[];
    for(const c of this.map.cages)c.rescuers=[];
    for(const p of this.players.values()) {
      if(!p.connected){p.disconnectTime+=dt;if(p.disconnectTime>=C.disconnectGraceSeconds&& !['out','escaped'].includes(p.status)){this.dropCarried(p);p.status='out';for(const carrier of this.players.values())if(carrier.carrying===p.id)carrier.carrying=null;if(p.hidden){const h=this.map.cabinets.find(h=>h.id===p.hidden);if(h)h.occupant=null;p.hidden=null;}for(const c of this.map.cages)if(c.occupant===p.id)c.occupant=null;this.event(`${p.name} 연결 종료로 탈락`);}p.input={x:0,y:0,space:false};}
      p.stun=Math.max(0,p.stun-dt);p.immunity=Math.max(0,p.immunity-dt);this.move(p,dt);
    }
    const killer=[...this.players.values()].find(p=>p.role==='killer');
    if(killer&&killer.status==='alive'&&killer.stun===0&&!killer.carrying)for(const p of this.players.values())if(p.role==='survivor'&&p.status==='alive'&&!p.hidden&&p.immunity===0&&distance(p,killer)<C.playerRadius*2){p.status='down';this.event(`${p.name} 기절`);}
    for(const p of this.players.values()){this.interact(p,dt,p.input.space&&!p.wasSpace);p.wasSpace=p.input.space;}
    for(const g of this.map.generators)if(g.workers.length&&g.progress<C.generatorSeconds){g.progress=Math.min(C.generatorSeconds,g.progress+dt);if(g.progress===C.generatorSeconds)this.event(`발전기 가동 완료 (${this.map.generators.filter(q=>q.progress>=C.generatorSeconds).length}/5)`);}
    for(const c of this.map.cages){if(c.occupant&&c.rescuers.length){c.rescueProgress+=dt;if(c.rescueProgress>=C.rescueSeconds){const q=this.players.get(c.occupant);q.status='alive';q.immunity=C.releaseImmunitySeconds;q.x=c.x+45;this.event(`${q.name} 구출 완료`);c.occupant=null;c.rescueProgress=0;}}else c.rescueProgress=0;}
    const open=this.map.generators.every(g=>g.progress>=C.generatorSeconds);
    if(open)for(const p of this.players.values())if(p.role==='survivor'&&p.status==='alive'&&!p.hidden&&this.near(p,this.map.exits,65)){p.status='escaped';this.event(`${p.name} 탈출 성공`);}
    const survivors=[...this.players.values()].filter(p=>p.role==='survivor');
    if(killer?.status==='out')this.finish('survivors','살인마의 연결이 종료되었습니다.');
    else if(survivors.every(p=>['out','escaped'].includes(p.status)))this.finish(survivors.some(p=>p.status==='escaped')?'survivors':'killer',survivors.some(p=>p.status==='escaped')?'추격 종료 · 생존자 탈출 성공':'모든 도망자가 탈락했습니다.');
  }
  finish(winner,reason){this.phase='finished';this.result={winner,reason,escaped:[...this.players.values()].filter(p=>p.status==='escaped').length};}
  reset(id){if(id!==this.hostId||this.phase!=='finished')return;for(const [key,p]of this.players){if(!p.connected){this.players.delete(key);continue;}Object.assign(p,{status:'alive',carrying:null,hidden:null,action:null,input:{x:0,y:0,space:false}});}if(![...this.players.values()].some(p=>p.role==='killer'))this.players.get(this.hostId).role='killer';this.phase='lobby';this.result=null;this.map=createMap();}
  snapshot(){return {code:this.code,name:this.name,maxPlayers:this.maxPlayers,hostId:this.hostId,phase:this.phase,map:this.map,players:[...this.players.values()].map(({input,wasSpace,disconnectTime,...p})=>p),elapsed:this.elapsed,result:this.result,events:this.events,config:C};}
}
