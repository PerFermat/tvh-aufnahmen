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
// Qualität nur für diese Wiedergabe (PQ); beim Schließen gilt wieder die gemerkte aus den Einstellungen
let PQ=null;
const pq=()=>PQ||quality();
const qualSel=()=>(QUALS||[]).length<2?'':`<select id="pqsel" title="${L('pl.q_tip')}" onchange="PQ=this.value;if(PLAYER&&PLAYER._restart)PLAYER._restart()">
 ${QUALS.map(x=>`<option value="${esc(x.profile)}" ${x.profile==pq()?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`;
// Vollbild und Zoom: Vollbild bekommt der ganze Bildbereich (.pwrap), nicht nur das Video – so bleiben die
// eigenen Knöpfe sichtbar. „Füllen“ (object-fit: cover) schneidet das Bild auf die Bildschirmform zu: auf
// breiten Bildschirmen fallen dann die mitgesendeten Balken oben/unten weg und die Seiten sind nicht mehr schwarz.
// Zoom: 'fit' (einpassen), 'fill' (füllen) oder eine Zahl – stufenlos über den Regler, Faktor bezogen auf
// das eingepasste Bild (1 = einpassen). Ein Klick auf den Zoom-Knopf: einpassen → füllen → Regler → einpassen.
// Bei einer Zahl wird das Video-Element selbst größer als der Bildbereich und mittig ausgerichtet (der Rest ist
// abgeschnitten). Die Steuerleiste des Browsers würde dabei aus dem Bild rutschen – deshalb ist sie dann aus,
// Pause und Ton gibt es oben rechts.
let PZ='fit',PZS=false,PZT=null;  // PZS: Regler sichtbar
// Faktor, um den das eingepasste Bild wachsen muss, bis es die ganze Fläche füllt
function zFill(){const w=$('#pwrap'),v=$('#pv');if(!w||!v||!v.videoWidth)return 1.33;
 const W=w.clientWidth,H=w.clientHeight,a=v.videoWidth/v.videoHeight,fw=Math.min(W,H*a),fh=fw/a;return Math.max(W/fw,H/fh)}
function pZoom(){if(PZ=='fit'&&!PZS)PZ='fill';else if(!PZS){PZS=true;PZ=zFill()}else{PZ='fit';PZS=false}pZoomState();pControls()}
function pZoomSet(z){z=Math.round(Math.max(1,Math.min(4,z))*100)/100;PZ=z<=1?'fit':z;pZoomState();pControls()}
function pZoomState(){const w=$('#pwrap'),b=$('#pzb'),v=$('#pv');if(!w)return;const num=typeof PZ=='number';
 w.classList.toggle('zfill',PZ=='fill');w.classList.toggle('zcustom',num);
 if(v)v.controls=!num;pZoomApply();
 const box=$('#pzs');if(box){box.hidden=!PZS;const z=num?PZ:PZ=='fill'?zFill():1;$('#pzr').value=z;$('#pzv').textContent=Math.round(z*100)+' %'}
 if(b){b.textContent=PZS?'⤡ '+L('pl.z_fit'):PZ=='fill'?'🔍 '+L('pl.z_more'):'⤢ '+L('pl.z_fill');b.title=L('pl.z_tip')}
 const pp=$('#ppp'),mu=$('#pmu');if(v&&pp){pp.textContent=v.paused?'▶':'⏸';mu.textContent=v.muted?'🔇':'🔊'}}
function pZoomApply(){const w=$('#pwrap'),v=$('#pv');if(!w||!v)return;const fs=fsEl()===w;
 if(typeof PZ!='number'){w.style.height='';Object.assign(v.style,{position:'',width:'',height:'',left:'',top:'',maxHeight:''});return}
 const a=v.videoWidth?v.videoWidth/v.videoHeight:16/9,W=w.clientWidth,H=fs?w.clientHeight:Math.min(W/a,innerHeight*.7);
 w.style.height=fs?'':H+'px';  // Bildbereich behält seine Größe, auch wenn das Video größer wird
 Object.assign(v.style,{position:'absolute',maxHeight:'none',width:W*PZ+'px',height:H*PZ+'px',left:(W-W*PZ)/2+'px',top:(H-H*PZ)/2+'px'})}
addEventListener('resize',()=>{if($('#pwrap'))pZoomApply()});
function pPlay(){const v=$('#pv');if(v){v.paused?v.play():v.pause();setTimeout(pZoomState,50)}}
function pMute(){const v=$('#pv');if(v){v.muted=!v.muted;pZoomState()}}
function pFull(){const w=$('#pwrap');if(!w)return;if(fsEl())(document.exitFullscreen||document.webkitExitFullscreen).call(document);
 else{const r=(w.requestFullscreen||w.webkitRequestFullscreen).call(w);if(r&&r.catch)r.catch(err=>msg(L('fs.failed',{err:err.message})))}}
// Knöpfe im Vollbild nach kurzer Zeit ausblenden, bei Bewegung wieder zeigen
function pControls(){const w=$('#pwrap');if(!w)return;w.classList.add('show');clearTimeout(PZT);PZT=setTimeout(()=>w.classList.remove('show'),2500)}
document.addEventListener('keydown',e=>{if(!$('#pwrap')||!$('#dlg').open||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
 if(e.key=='z'||e.key=='Z'){pZoom();e.preventDefault()}else if(e.key=='f'||e.key=='F'){pFull();e.preventDefault()}
 else if(e.key=='+'||e.key=='-'){const z=typeof PZ=='number'?PZ:PZ=='fill'?zFill():1;PZS=true;pZoomSet(z+(e.key=='+'?.05:-.05));e.preventDefault()}});
document.addEventListener('fullscreenchange',()=>{const w=$('#pwrap');if(w){w.classList.toggle('isfs',fsEl()===w);pZoomApply()}});
function playerDialog(title,sub,extra){dialog(`<h2 style="margin:0 90px 2px 0">${esc(title)}</h2><div class="muted">${esc(sub)}</div>
 <div class="pwrap" id="pwrap" onmousemove="pControls()" ontouchstart="pControls()"><video id="pv" controls controlslist="nofullscreen" playsinline autoplay ondblclick="event.preventDefault();pFull()"></video>
  <div class="pctl"><div class="pbtns"><button class="b sec zc" id="ppp" onclick="pPlay()">⏸</button><button class="b sec zc" id="pmu" onclick="pMute()">🔊</button>
   <button class="b sec" id="pzb" onclick="pZoom()"></button><button class="b sec" onclick="pFull()" title="${L('pl.fs_tip')}">⛶</button></div>
   <div class="pzs" id="pzs" hidden><input type="range" id="pzr" min="1" max="4" step="0.01" oninput="pZoomSet(+this.value)" title="${L('pl.z_slider')}"><span id="pzv"></span></div></div></div>${extra||''}
 <p class="muted small" id="pmsg">${L('pl.loading')}</p>`);pZoomState();
 ['play','pause','volumechange'].forEach(ev=>$('#pv').addEventListener(ev,pZoomState));
 $('#dlg').addEventListener('close',()=>{stopPlayer();PQ=null;PZ='fit';PZS=false},{once:true})}

async function playLive(uuid){await qualities();const c=(LIVE&&LIVE.channels.find(x=>x.uuid==uuid))||(EPG&&EPG.channels.find(x=>x.uuid==uuid))||{name:L('common.channel')};
 playerDialog(c.name,'Live',`<div class="bar" style="margin:8px 0 0">${qualSel()}<button class="b sec" onclick="playLive('${uuid}')">${L('pl.reload')}</button>
  <a class="b sec" style="text-decoration:none" href="${playHref(uuid)}" onclick="event.stopPropagation()">${L('pl.vlc')}</a>
  <button class="b sec" onclick="openTeletext('${uuid}','${esc(c.name).replace(/'/g,'')}')">${L('common.teletext')}</button>${subsBtn()}</div>`);
 startPlayer(`/api/play-live?uuid=${uuid}&q=${encodeURIComponent(pq())}`,()=>playLive(uuid));
 $('#pv').addEventListener('playing',()=>$('#pmsg').textContent='',{once:true})}

// Weiterschauen: Der Stand wird in TVHeadend gespeichert (playposition/playcount – wie bei Kodi), alle 30 s,
// beim Schließen und am Ende (ab 95 % gilt die Aufnahme als angesehen). Ohne Startzeit geht es dort weiter.
let PLAST={uuid:null,t:0,saved:0};
async function recSavePos(uuid,t,done){const r=R(uuid);if(!r)return;t=Math.floor(t);
 if(done===undefined)done=t>=(r.stop-r.start)*.95;
 if(!done&&Math.abs(t-PLAST.saved)<5&&PLAST.uuid==uuid)return;PLAST.saved=t;
 try{const x=await api('/api/playpos',{uuid,pos:done?0:t,done});r.pos=x.pos;r.played=x.played}catch(e){}}
async function playRec(uuid,from){await qualities();const r=R(uuid),dur=Math.max(60,r.stop-r.start);
 const resume=from===undefined&&r.pos>30&&!watched(r)?r.pos:0;POFF=from??resume;
 if(!($('#dlg').open&&$('#pseek')&&$('#pseek').dataset.uuid==uuid)){playerDialog(r.title,(r.subtitle?r.subtitle.split('\n')[0]+' · ':'')+r.channel+' · '+fmt(r.start),
  `<div class="pbar"><span id="ptime">0:00</span><input type="range" id="pseek" data-uuid="${uuid}" min="0" max="${dur}" step="1" value="${POFF}"><span>${hms(dur)}</span></div>
  <div class="bar" style="margin:6px 0 0">${qualSel()}<button class="b sec" onclick="recJump('${uuid}',-300)">−5 min</button><button class="b sec" onclick="recJump('${uuid}',-30)">−30 s</button>
  <button class="b sec" onclick="recJump('${uuid}',30)">+30 s</button><button class="b sec" onclick="recJump('${uuid}',300)">+5 min</button>
  <a class="b sec" style="text-decoration:none" href="/api/playlist?uuid=${uuid}" onclick="event.stopPropagation()">${L('pl.vlc')}</a>${subsBtn()}</div>`);
  $('#pseek').addEventListener('change',e=>playRec(uuid,+e.target.value));
  PLAST={uuid,t:POFF,saved:r.pos};$('#dlg').addEventListener('close',()=>{if(PLAST.uuid==uuid&&PLAST.t>30)recSavePos(uuid,PLAST.t);if(cur=='rec')fillRecordings()},{once:true});
  $('#pseek').addEventListener('input',e=>$('#ptime').textContent=hms(+e.target.value))}
 $('#pmsg').textContent=L('pl.loading_from',{t:hms(POFF)});
 if(resume)$('#pmsg').innerHTML=`${L('pl.resume',{t:hms(resume)})} <button class="b sec sm" onclick="playRec('${uuid}',0)">${L('pl.from_start')}</button>`;
 startPlayer(`/api/play-rec?uuid=${uuid}&q=${encodeURIComponent(pq())}&t=${Math.floor(POFF)}`,()=>{const v=$('#pv');playRec(uuid,POFF+(v?v.currentTime:0))});
 $('#pv').addEventListener('playing',()=>{if(!resume)$('#pmsg').textContent='';else setTimeout(()=>{if($('#pmsg'))$('#pmsg').textContent=''},8000)},{once:true});
 $('#pv').addEventListener('ended',()=>recSavePos(uuid,dur,true),{once:true});
 PTIMER=setInterval(()=>{const v=$('#pv');if(!v)return clearInterval(PTIMER);const t=POFF+v.currentTime,s=$('#pseek');
  if(v.currentTime>0){PLAST.t=t;if(Math.abs(t-PLAST.saved)>=30)recSavePos(uuid,t)}
  if(document.activeElement!==s){s.value=t;$('#ptime').textContent=hms(t)}},500)}
function recJump(uuid,d){const v=$('#pv'),t=POFF+(v?v.currentTime:0)+d,r=R(uuid);playRec(uuid,Math.max(0,Math.min(t,r.stop-r.start-5)))}
