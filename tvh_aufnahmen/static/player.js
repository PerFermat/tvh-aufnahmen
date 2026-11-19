// Interner Player: Live-TV und Aufnahmen direkt im Browser (mpegts.js). Der Server liefert dafür
// MPEG-TS mit H.264 und AAC (siehe player.py). Aufnahmen spulen über eine eigene Zeitleiste:
// beim Springen startet der Server ab der neuen Stelle, die Anzeige rechnet den Versatz dazu.
let PLAYER=null,POFF=0,PTIMER=null;
const playerMode=()=>store('player')||'intern';
const canPlayInline=()=>!!(window.mpegts&&mpegts.getFeatureList().mseLivePlayback);
const hms=s=>{s=Math.max(0,Math.floor(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+':'+pad(m):m)+':'+pad(s%60)};

// Klick auf „Abspielen“: im internen Player öffnen statt die m3u-Datei herunterzuladen
document.addEventListener('click',e=>{const a=e.target.closest('a[data-play],a[data-playrec]');
 if(!a||playerMode()!='intern'||!canPlayInline())return;
 e.preventDefault();a.dataset.play?playLive(a.dataset.play):playRec(a.dataset.playrec)});

function stopPlayer(){clearInterval(PTIMER);if(PLAYER){try{PLAYER.pause();PLAYER.unload();PLAYER.detachMediaElement();PLAYER.destroy()}catch(e){}PLAYER=null}}
function startPlayer(url){stopPlayer();const v=$('#pv');url=new URL(url,location.href).href;  // der Worker braucht eine volle Adresse
 PLAYER=mpegts.createPlayer({type:'mpegts',isLive:true,url},{enableWorker:true,lazyLoad:false,liveBufferLatencyChasing:false});
 PLAYER.attachMediaElement(v);PLAYER.load();
 PLAYER.on(mpegts.Events.ERROR,(t,d)=>{$('#pmsg').textContent='Wiedergabe abgebrochen ('+t+(d?': '+d:'')+'). Bei SD-/HD-Wechsel oder schwachem Empfang hilft oft „Neu laden“.'});
 v.play().catch(()=>{$('#pmsg').textContent='Zum Starten auf ▶ tippen.'})}
function playerDialog(title,sub,extra){dialog(`<h2 style="margin:0 90px 2px 0">${esc(title)}</h2><div class="muted">${esc(sub)}</div>
 <div class="pwrap"><video id="pv" controls playsinline autoplay></video></div>${extra||''}
 <p class="muted small" id="pmsg">Lade … (Sender einstimmen bzw. Aufnahme vorbereiten dauert einige Sekunden)</p>`);
 $('#dlg').addEventListener('close',stopPlayer,{once:true})}
const qualityName=()=>{const q=(QUALS||[]).find(x=>x.profile==quality());return q?q.name:'Home'};

async function playLive(uuid){await qualities();const c=(LIVE&&LIVE.channels.find(x=>x.uuid==uuid))||(EPG&&EPG.channels.find(x=>x.uuid==uuid))||{name:'Sender'};
 playerDialog(c.name,'Live · Qualität: '+qualityName(),`<div class="bar" style="margin:8px 0 0"><button class="b sec" onclick="playLive('${uuid}')">Neu laden</button>
  <a class="b sec" style="text-decoration:none" href="${playHref(uuid)}" onclick="event.stopPropagation()">In VLC öffnen</a></div>`);
 startPlayer(`/api/play-live?uuid=${uuid}&q=${encodeURIComponent(quality())}`);
 $('#pv').addEventListener('playing',()=>$('#pmsg').textContent='',{once:true})}

async function playRec(uuid,from){await qualities();const r=R(uuid),dur=Math.max(60,r.stop-r.start);POFF=from||0;
 if(!($('#dlg').open&&$('#pseek')&&$('#pseek').dataset.uuid==uuid)){playerDialog(r.title,(r.subtitle?r.subtitle.split('\n')[0]+' · ':'')+r.channel+' · '+fmt(r.start)+' · Qualität: '+qualityName(),
  `<div class="pbar"><span id="ptime">0:00</span><input type="range" id="pseek" data-uuid="${uuid}" min="0" max="${dur}" step="1" value="${POFF}"><span>${hms(dur)}</span></div>
  <div class="bar" style="margin:6px 0 0"><button class="b sec" onclick="recJump('${uuid}',-300)">−5 min</button><button class="b sec" onclick="recJump('${uuid}',-30)">−30 s</button>
  <button class="b sec" onclick="recJump('${uuid}',30)">+30 s</button><button class="b sec" onclick="recJump('${uuid}',300)">+5 min</button>
  <a class="b sec" style="text-decoration:none" href="/api/playlist?uuid=${uuid}" onclick="event.stopPropagation()">In VLC öffnen</a></div>`);
  $('#pseek').addEventListener('change',e=>playRec(uuid,+e.target.value));
  $('#pseek').addEventListener('input',e=>$('#ptime').textContent=hms(+e.target.value))}
 $('#pmsg').textContent='Lade ab '+hms(POFF)+' …';
 startPlayer(`/api/play-rec?uuid=${uuid}&q=${encodeURIComponent(quality())}&t=${Math.floor(POFF)}`);
 $('#pv').addEventListener('playing',()=>$('#pmsg').textContent='',{once:true});
 PTIMER=setInterval(()=>{const v=$('#pv');if(!v)return clearInterval(PTIMER);const t=POFF+v.currentTime,s=$('#pseek');
  if(document.activeElement!==s){s.value=t;$('#ptime').textContent=hms(t)}},500)}
function recJump(uuid,d){const v=$('#pv'),t=POFF+(v?v.currentTime:0)+d,r=R(uuid);playRec(uuid,Math.max(0,Math.min(t,r.stop-r.start-5)))}
