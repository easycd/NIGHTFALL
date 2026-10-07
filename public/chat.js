export function createChat({socket,clearInput,getState}) {
  const $=id=>document.getElementById(id),panel=$('chat-window'),header=$('chat-header'),input=$('chat-input'),list=$('chat-messages');
  let channel=null,signature='',folded=false,drag=null,position=null,roomCode=null;
  try{const saved=JSON.parse(localStorage.getItem('nightfall-chat-position'));if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))position=saved;}catch{}
  function place(){if(!position)return;position.x=Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,position.x));position.y=Math.max(8,Math.min(innerHeight-panel.offsetHeight-8,position.y));panel.style.left=`${position.x}px`;panel.style.top=`${position.y}px`;panel.style.bottom='auto';}
  header.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button'))return;const rect=panel.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,px:rect.left,py:rect.top};header.setPointerCapture(e.pointerId);e.preventDefault();});
  header.addEventListener('pointermove',e=>{if(!drag)return;position={x:drag.px+e.clientX-drag.x,y:drag.py+e.clientY-drag.y};place();});
  function stop(){if(drag&&position)try{localStorage.setItem('nightfall-chat-position',JSON.stringify(position));}catch{}drag=null;}
  header.addEventListener('pointerup',stop);header.addEventListener('pointercancel',stop);addEventListener('resize',place);
  $('chat-fold').onclick=()=>{folded=!folded;$('chat-body').hidden=folded;$('chat-fold').textContent=folded?'+':'−';$('chat-fold').setAttribute('aria-expanded',String(!folded));if(folded)input.blur();place();};
  input.addEventListener('focus',clearInput);input.addEventListener('keydown',e=>{e.stopPropagation();if(e.code==='Escape'){e.preventDefault();input.blur();}});
  $('chat-form').onsubmit=e=>{e.preventDefault();const text=input.value.trim();if(!text)return;if(!socket.connected){$('chat-error').textContent='서버에 재접속 중입니다.';return;}$('chat-send').disabled=true;socket.timeout(5000).emit('chat',{text},(err,r)=>{$('chat-send').disabled=false;if(err||!r?.ok){$('chat-error').textContent=r?.error||'전송에 실패했습니다.';return;}input.value='';$('chat-error').textContent='';});};
  function update(){const s=getState(),next=s?.chat?.channel||null;if(next!==channel||s?.code!==roomCode){signature='';list.replaceChildren();input.value='';$('chat-error').textContent='';input.blur();channel=next;roomCode=s?.code;}
    panel.hidden=!channel;if(!channel)return;panel.classList.toggle('dead',channel==='dead');$('chat-title').textContent=channel==='dead'?'사망자 채팅 · 드래그 이동':'생존자 채팅 · 드래그 이동';
    const messages=s.chat.messages,key=messages.map(m=>m.id).join();if(key!==signature||!list.childNodes.length){const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<25;signature=key;list.replaceChildren();if(!messages.length){const hint=document.createElement('div');hint.id='chat-empty';hint.textContent=channel==='dead'?'사망자에게만 보이는 채팅입니다.':'생존자에게만 보이는 채팅입니다.';list.append(hint);}for(const m of messages){const row=document.createElement('div');row.className='chat-message';const time=document.createElement('time'),name=document.createElement('b'),text=document.createElement('span');time.textContent=new Date(m.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});name.textContent=m.name;text.textContent=m.text;row.append(time,name,text);list.append(row);}if(bottom)list.scrollTop=list.scrollHeight;}place();
  }
  function focus(){if(!channel)return false;folded=false;$('chat-body').hidden=false;$('chat-fold').textContent='−';$('chat-fold').setAttribute('aria-expanded','true');place();input.focus();return true;}
  return {update,focus};
}
