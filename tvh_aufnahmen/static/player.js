// Interner Player: Live-TV und Aufnahmen direkt im Browser (mpegts.js). Der Server liefert dafür
// MPEG-TS mit H.264 und AAC (siehe player.py). Aufnahmen spulen über eine eigene Zeitleiste:
// beim Springen startet der Server ab der neuen Stelle, die Anzeige rechnet den Versatz dazu.
let PLAYER=null,POFF=0,PTIMER=null,PSUBT=null;
// Untertitel (Videotext): der Server schreibt sie je Wiedergabe mit (Kennung sid), hier werden sie als Spur angezeigt
const subsOn=()=>store('subs')=='on';
const subsBtn=()=>`<button class="b sec" id="psubbtn" onclick="toggleSubs()" title="${L('pl.subs_tip')}">${subsOn()?L('pl.subs_on'):L('pl.subs_off')}</button>`;
function subsTrack(){const v=$('#pv');if(!v._tt){v._tt=v.addTextTrack('subtitles','Untertitel','de')}
 const t=v._tt;while(t.cues&&t.cues.length)t.removeCue(t.cues[0]);t.mode=subsOn()?'showing':'hidden';return t}
async function pollSubs(sid){const v=$('#pv');if(!v||!v._tt||!PLAYER)return;
 try{const r=await api('/api/subs?sid='+sid),t=v._tt;
  while(t.cues&&t.cues.length)t.removeCue(t.cues[0]);
  r.cues.forEach(c=>{const q=new VTTCue(c.start,c.end,c.text);q.line=-2;t.addCue(q)});
  if($('#pmsg')&&!r.cues.length&&r.active&&v.currentTime>20)$('#pmsg').textContent=L('pl.no_subs')}catch(e){}
 PSUBT=setTimeout(()=>pollSubs(sid),1500)}
function toggleSubs(){store('subs',subsOn()?'off':'on');const b=$('#psubbtn');if(b)b.textContent=subsOn()?L('pl.subs_on'):L('pl.subs_off');
 if(PLAYER&&PLAYER._restart)PLAYER._restart()}
const playerMode=()=>store('player')||'intern';
const canPlayInline=()=>!!(window.mpegts&&mpegts.getFeatureList().mseLivePlayback);
const hms=s=>{s=Math.max(0,Math.floor(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+':'+pad(m):m)+':'+pad(s%60)};

// Klick auf „Abspielen“: im internen Player öffnen statt die m3u-Datei herunterzuladen
document.addEventListener('click',e=>{const a=e.target.closest('a[data-play],a[data-playrec]');
 if(!a||playerMode()!='intern'||!canPlayInline())return;
 e.preventDefault();a.dataset.play?playLive(a.dataset.play):playRec(a.dataset.playrec)});

function stopPlayer(){clearInterval(PTIMER);clearTimeout(PSUBT);if(PLAYER){try{PLAYER.pause();PLAYER.unload();PLAYER.detachMediaElement();PLAYER.destroy()}catch(e){}PLAYER=null}}
function startPlayer(url,restart){stopPlayer();const v=$('#pv');let sid=null;
 if(subsOn()){sid=Math.random().toString(36).slice(2,12);url+='&sid='+sid}
 subsTrack();url=new URL(url,location.href).href;  // der Worker braucht eine volle Adresse
 PLAYER=mpegts.createPlayer({type:'mpegts',isLive:true,url},{enableWorker:true,lazyLoad:false,liveBufferLatencyChasing:false});
 PLAYER.attachMediaElement(v);PLAYER.load();
 PLAYER.on(mpegts.Events.ERROR,(t,d)=>{$('#pmsg').textContent=L('pl.aborted',{err:t+(d?': '+d:'')})});
 v.play().catch(()=>{$('#pmsg').textContent=L('pl.tap')});
 PLAYER._restart=restart;if(sid)PSUBT=setTimeout(()=>pollSubs(sid),3000)}
function playerDialog(title,sub,extra){dialog(`<h2 style="margin:0 90px 2px 0">${esc(title)}</h2><div class="muted">${esc(sub)}</div>
 <div class="pwrap"><video id="pv" controls playsinline autoplay></video></div>${extra||''}
 <p class="muted small" id="pmsg">${L('pl.loading')}</p>`);
 $('#dlg').addEventListener('close',stopPlayer,{once:true})}
const qualityName=()=>{const q=(QUALS||[]).find(x=>x.profile==quality());return q?q.name:L('pl.home')};

async function playLive(uuid){await qualities();const c=(LIVE&&LIVE.channels.find(x=>x.uuid==uuid))||(EPG&&EPG.channels.find(x=>x.uuid==uuid))||{name:L('common.channel')};
 playerDialog(c.name,L('pl.live_sub',{q:qualityName()}),`<div class="bar" style="margin:8px 0 0"><button class="b sec" onclick="playLive('${uuid}')">${L('pl.reload')}</button>
  <a class="b sec" style="text-decoration:none" href="${playHref(uuid)}" onclick="event.stopPropagation()">${L('pl.vlc')}</a>
  <button class="b sec" onclick="openTeletext('${uuid}','${esc(c.name).replace(/'/g,'')}')">${L('common.teletext')}</button>${subsBtn()}</div>`);
 startPlayer(`/api/play-live?uuid=${uuid}&q=${encodeURIComponent(quality())}`,()=>playLive(uuid));
 $('#pv').addEventListener('playing',()=>$('#pmsg').textContent='',{once:true})}

async function playRec(uuid,from){await qualities();const r=R(uuid),dur=Math.max(60,r.stop-r.start);POFF=from||0;
 if(!($('#dlg').open&&$('#pseek')&&$('#pseek').dataset.uuid==uuid)){playerDialog(r.title,(r.subtitle?r.subtitle.split('\n')[0]+' · ':'')+r.channel+' · '+fmt(r.start)+' · '+L('pl.quality',{q:qualityName()}),
  `<div class="pbar"><span id="ptime">0:00</span><input type="range" id="pseek" data-uuid="${uuid}" min="0" max="${dur}" step="1" value="${POFF}"><span>${hms(dur)}</span></div>
  <div class="bar" style="margin:6px 0 0"><button class="b sec" onclick="recJump('${uuid}',-300)">−5 min</button><button class="b sec" onclick="recJump('${uuid}',-30)">−30 s</button>
  <button class="b sec" onclick="recJump('${uuid}',30)">+30 s</button><button class="b sec" onclick="recJump('${uuid}',300)">+5 min</button>
  <a class="b sec" style="text-decoration:none" href="/api/playlist?uuid=${uuid}" onclick="event.stopPropagation()">${L('pl.vlc')}</a>${subsBtn()}</div>`);
  $('#pseek').addEventListener('change',e=>playRec(uuid,+e.target.value));
  $('#pseek').addEventListener('input',e=>$('#ptime').textContent=hms(+e.target.value))}
 $('#pmsg').textContent=L('pl.loading_from',{t:hms(POFF)});
 startPlayer(`/api/play-rec?uuid=${uuid}&q=${encodeURIComponent(quality())}&t=${Math.floor(POFF)}`,()=>{const v=$('#pv');playRec(uuid,POFF+(v?v.currentTime:0))});
 $('#pv').addEventListener('playing',()=>$('#pmsg').textContent='',{once:true});
 PTIMER=setInterval(()=>{const v=$('#pv');if(!v)return clearInterval(PTIMER);const t=POFF+v.currentTime,s=$('#pseek');
  if(document.activeElement!==s){s.value=t;$('#ptime').textContent=hms(t)}},500)}
function recJump(uuid,d){const v=$('#pv'),t=POFF+(v?v.currentTime:0)+d,r=R(uuid);playRec(uuid,Math.max(0,Math.min(t,r.stop-r.start-5)))}
