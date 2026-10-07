// Read-only map inspection. Server decides whether this session is admin.
export function createDebugger({canvas,getState,getMyId,socket,notify,clearInput}) {
  const $=id=>document.getElementById(id);
  let collapsed=true,hitboxes=false,labels=false,zoom=1,center=null,selected=null,drag=null,pending=false;
  let fps=0,frames=0,frameStart=performance.now(),ping=null,lastPing=0,lastMetrics=0,lastRoom=null,previousFull=false,snapshotName='';
  const enabled=()=>getState()?.debug?.enabled===true;
  const full=()=>enabled()&&getState().debug.fullMap===true;
  function fit(){const map=getState()?.map;if(!map)return;zoom=1;center={x:map.width/2,y:map.height/2};}
  function transform(){const map=getState().map;center??={x:map.width/2,y:map.height/2};const scale=Math.min((innerWidth-40)/map.width,(innerHeight-185)/map.height)*zoom;return {scale:Math.max(.03,scale),x:innerWidth/2-center.x*scale,y:innerHeight/2+20-center.y*scale,center};}
  function showPanel(){collapsed=!collapsed;update();}
  function toggleMap(){if(!enabled()||pending)return;pending=true;clearInput();socket.timeout(5000).emit('debug-view',{fullMap:!full()},(err,r)=>{pending=false;if(err||!r?.ok)notify(r?.error||'디버그 맵 요청에 실패했습니다.');});}
  $('debug-toggle').onclick=toggleMap;$('debug-fit').onclick=fit;
  $('debug-collapse').onclick=showPanel;$('debug-open').onclick=showPanel;
  $('debug-hitboxes').onclick=()=>{hitboxes=!hitboxes;update();};$('debug-labels').onclick=()=>{labels=!labels;update();};
  $('debug-export').onclick=()=>{if(!full())return;clearInput();const s=getState();$('debug-json').value=JSON.stringify({capturedAt:new Date().toISOString(),...s},null,2);snapshotName=`nightfall-${s.code}-${Math.floor(s.elapsed)}s.json`;$('debug-snapshot').hidden=false;$('debug-json').focus();};
  function closeSnapshot(){$('debug-snapshot').hidden=true;clearInput();}
  $('debug-json-close').onclick=closeSnapshot;
  $('debug-json-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('debug-json').value);notify('상태 JSON을 복사했습니다.');}catch{notify('JSON 내용을 선택해 직접 복사해주세요.');}};
  $('debug-json-save').onclick=()=>{const blob=new Blob([$('debug-json').value],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=snapshotName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function entities(){const s=getState();if(!s)return [];const m=s.map;return [
    ...s.players.filter(p=>p.x!==null&&p.y!==null).map(p=>({type:'player',id:p.id,data:p,x:p.x,y:p.y})),
    ...['generators','cages','cabinets','exits'].flatMap(type=>m[type].map(p=>({type,id:p.id,data:p,x:p.x,y:p.y}))),
    ...['pallets','walls','bushes'].flatMap(type=>m[type].map((p,i)=>({type,id:p.id||`${type==='walls'?'w':'b'}${i}`,data:p,x:p.x+p.w/2,y:p.y+p.h/2}))) ];}
  const names={player:'플레이어',generators:'발전기',cages:'감옥',cabinets:'캐비넷',exits:'탈출구',pallets:'파레트',walls:'벽',bushes:'풀숲'};
  function inspect(x,y){const scale=transform().scale,r=Math.max(20,10/scale),all=entities();let match=all.filter(o=>!o.data.w&&Math.hypot(x-o.x,y-o.y)<=r).sort((a,b)=>Math.hypot(x-a.x,y-a.y)-Math.hypot(x-b.x,y-b.y))[0];match??=all.find(o=>o.data.w&&x>=o.data.x&&x<=o.data.x+o.data.w&&y>=o.data.y&&y<=o.data.y+o.data.h);selected=match?{type:match.type,id:match.id}:null;collapsed=false;update();}
  canvas.addEventListener('pointerdown',e=>{if(!full()||e.button!==0)return;const t=transform();drag={x:e.clientX,y:e.clientY,cx:center.x,cy:center.y,scale:t.scale,moved:false};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag||!full())return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved ||= Math.hypot(dx,dy)>5;if(drag.moved)center={x:drag.cx-dx/drag.scale,y:drag.cy-dy/drag.scale};});
  canvas.addEventListener('pointerup',e=>{if(!drag)return;if(!drag.moved&&full()){const t=transform();inspect((e.clientX-t.x)/t.scale,(e.clientY-t.y)/t.scale);}drag=null;});
  canvas.addEventListener('pointercancel',()=>drag=null);
  canvas.addEventListener('wheel',e=>{if(!full())return;e.preventDefault();const before=transform(),x=(e.clientX-before.x)/before.scale,y=(e.clientY-before.y)/before.scale;zoom=Math.max(.75,Math.min(8,zoom*Math.exp(-e.deltaY*.001)));const after=transform();center.x+=(e.clientX-after.x)/after.scale-x;center.y+=(e.clientY-after.y)/after.scale-y;},{passive:false});
  function key(e){if(!enabled()||!['KeyT','KeyB','KeyO','KeyI'].includes(e.code))return false;e.preventDefault();if(e.repeat)return true;if(e.code==='KeyT')toggleMap();else if(e.code==='KeyB'){hitboxes=!hitboxes;update();}else if(e.code==='KeyO'){labels=!labels;update();}else showPanel();return true;}
  function name(id){if(!id)return '없음';return getState().players.find(p=>p.id===id)?.name||id.slice(0,8);}
  function details(o){const d=o.data,c=getState().config;const fields=[['ID',o.type==='player'?d.id.slice(0,8):o.id],['종류',names[o.type]],['좌표',`${d.x.toFixed(1)}, ${d.y.toFixed(1)}`]];
    if(d.w)fields.push(['크기',`${d.w} × ${d.h}`]);
    if(o.type==='player')fields.push(['이름 / 역할',`${d.name} / ${d.role}`],['상태',`${d.status}${d.connected?'':' · 연결 끊김'}`],['감금 횟수',`${d.cageCount}/2`],['숨은 장소',d.hidden||'없음'],['운반 대상',name(d.carrying)],['스턴 / 면역',`${d.stun.toFixed(2)}s / ${d.immunity.toFixed(2)}s`]);
    if(o.type==='generators')fields.push(['진행도',`${d.progress.toFixed(2)} / ${c.generatorSeconds}s (${(d.progress/c.generatorSeconds*100).toFixed(1)}%)`],['수리 중',(d.workers||[]).map(name).join(', ')||'없음']);
    if(o.type==='cages')fields.push(['수감자',name(d.occupant)],['구출 진행',`${d.rescueProgress.toFixed(2)} / ${c.rescueSeconds}s`],['구출 중',(d.rescuers||[]).map(name).join(', ')||'없음']);
    if(o.type==='cabinets')fields.push(['숨은 플레이어',full()?name(d.occupant):'전체 맵 모드에서 확인']);
    if(o.type==='pallets')fields.push(['상태',{ready:'사용 가능',dropped:'내려짐',broken:'부서짐'}[d.state]],['파괴 진행',`${d.breakProgress.toFixed(2)} / ${c.breakPalletSeconds}s`]);
    if(o.type==='exits')fields.push(['상태',getState().map.generators.every(g=>g.progress>=c.generatorSeconds)?'열림':'잠김']);
    if(o.type==='walls')fields.push(['충돌','모든 플레이어 이동 차단']);if(o.type==='bushes')fields.push(['효과','살인마가 65px 이내로 접근할 때 보임']);return fields;
  }
  function update(){const s=getState(),active=enabled(),wide=full();if(!s||s.code!==lastRoom){lastRoom=s?.code;selected=null;center=null;collapsed=true;hitboxes=false;labels=false;ping=null;previousFull=false;}
    if(wide&&!previousFull){fit();collapsed=false;}previousFull=wide;
    $('debug-panel').hidden=!active||collapsed;$('debug-open').hidden=!active||!collapsed;$('debug-map-banner').hidden=!wide;document.body.classList.toggle('debug-full-map',wide);
    if(!active){if(!$('debug-snapshot').hidden)closeSnapshot();return;}
    $('debug-toggle').textContent=wide?'일반 시야 T':'전체 맵 T';$('debug-toggle').classList.toggle('active',wide);$('debug-fit').disabled=!wide;$('debug-export').disabled=!wide;$('debug-hitboxes').classList.toggle('active',hitboxes);$('debug-labels').classList.toggle('active',labels);
    const p=s.players.find(p=>p.id===getMyId()),c=s.config,m=s.map;
    $('debug-stats').textContent=`FPS ${fps} · PING ${ping===null?'—':`${ping}ms`} · SERVER ${s.debug.serverTickRate}Hz\n맵 ${m.width} × ${m.height} · SEED ${m.seed}\n내 좌표 ${p?.x===null?'관전':`${p?.x?.toFixed(1)}, ${p?.y?.toFixed(1)}`}\n속도 ${c.survivorSpeed} / ${c.survivorSpeed*c.killerSpeedMultiplier}px/s\n시야 반지름 ${c.survivorVision} / ${c.survivorVision*c.killerVisionMultiplier}px\n${s.phase==='lobby'?'대기실 · 게임 미시작':s.phase==='playing'?'게임 진행 중':'게임 종료'} · ${wide?`전체 맵 ${zoom.toFixed(2)}×`:'일반 시야'}`;
    $('debug-counts').textContent=`플레이어 ${s.players.length} · 벽 ${m.walls.length} · 풀숲 ${m.bushes.length}\n발전기 ${m.generators.length} · 감옥 ${m.cages.length} · 캐비넷 ${m.cabinets.length} · 파레트 ${m.pallets.length} · 출구 ${m.exits.length}`;
    const o=selected?entities().find(o=>o.type===selected.type&&o.id===selected.id):null;$('debug-selected-title').textContent=o?`${names[o.type]} · ${o.type==='player'?o.data.name:o.id}`:'오브젝트를 클릭해 상태 확인';$('debug-selected-fields').replaceChildren();if(o)for(const [label,value]of details(o)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('debug-selected-fields').append(dt,dd);}
    $('debug-generators').replaceChildren(...m.generators.map(g=>{const row=document.createElement('div');row.className='debug-gen-row';const id=document.createElement('span'),value=document.createElement('span');id.textContent=g.id;value.textContent=`${g.progress.toFixed(1)}s / ${c.generatorSeconds}s · ${(g.progress/c.generatorSeconds*100).toFixed(0)}%`;row.append(id,value);return row;}));
  }
  function frame(now){frames++;if(now-frameStart>=500){fps=Math.round(frames*1000/(now-frameStart));frames=0;frameStart=now;}if(!enabled())return;if(now-lastPing>=5000&&socket.connected){lastPing=now;const started=performance.now();socket.timeout(2000).emit('debug-ping',(err,r)=>{ping=!err&&r?.ok?Math.round(performance.now()-started):null;});}if(now-lastMetrics>=500){lastMetrics=now;update();}}
  function overlay(ctx,scale=1){if(!enabled())return;ctx.save();ctx.lineWidth=1.5/scale;const list=entities(),c=getState().config;for(const o of list){const d=o.data;
      if(hitboxes){ctx.strokeStyle=o.type==='player'?'#ff91ae':o.type==='walls'?'#ff7777':o.type==='pallets'&&d.state==='dropped'?'#ffb95d':'#62c9a277';if(d.w)ctx.strokeRect(d.x,d.y,d.w,d.h);else{ctx.beginPath();ctx.arc(o.x,o.y,o.type==='player'?c.playerRadius:c.interactionRadius,0,Math.PI*2);ctx.stroke();}}
      if(labels){ctx.fillStyle='#d9f5c5';ctx.font=`${10/scale}px Consolas,monospace`;ctx.textAlign='center';ctx.fillText(o.type==='player'?`${d.name} · ${d.status}`:o.id,o.x,o.y-18/scale);}
      if(selected?.type===o.type&&selected.id===o.id){ctx.strokeStyle='#f4e995';ctx.lineWidth=3/scale;if(d.w)ctx.strokeRect(d.x-3/scale,d.y-3/scale,d.w+6/scale,d.h+6/scale);else{ctx.beginPath();ctx.arc(o.x,o.y,Math.max(28,15/scale),0,Math.PI*2);ctx.stroke();}ctx.lineWidth=1.5/scale;}
    }ctx.restore();}
  return {get fullMap(){return full();},get modalOpen(){return !$('debug-snapshot').hidden;},closeSnapshot,key,update,frame,transform,overlay};
}
