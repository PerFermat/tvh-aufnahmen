// Reiter „Programm“: Fernsehzeitschrift für einen ganzen Tag – Sender als Spalten, sechs Zeilen zu je 4 Stunden.
// In einer Zeile stehen alle Sendungen, die in diesem Zeitraum beginnen; die Schnellauswahl springt nur dorthin.
let EPG=null,EPGS=0,EPGQ='',EPGT=store('epgtag')||'',EPGE=false,EPGSEQ=0,EPGPT=null;  // EPGPT: Sprungziel, das noch aussteht
const BLOCKS=[0,4,8,12,16,20],CELLMAX=10,EPGX=new Set();  // EPGX: aufgeklappte Zellen
const dkey=t=>{const d=new Date(t*1000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const wday=t=>new Date(t*1000).toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});
const blockOf=t=>Math.floor(new Date(t*1000).getHours()/4)*4;
async function renderEpg(start,jump){
 if(start!==undefined)EPGS=start;
 const now=Date.now()/1000,fresh=!$('#epgwrap');
 // Sprungziel: angegeben; „Jetzt“ → aktueller Block; Reiter neu geöffnet → aktueller Block (heute) bzw. Tagesanfang
 EPGPT=jump??(start!==undefined?(start?0:blockOf(now)):fresh?(EPGS&&dkey(EPGS)!=dkey(now)?0:blockOf(now)):EPGPT);
 const seq=++EPGSEQ;let day;
 if(fresh)$('#main').innerHTML=`<div id="epgbar" class="epgbar"></div><div id="epgwrap" class="epgwrap"><p class="muted">Lade Programm …</p></div>`;
 try{day=await api('/api/epg'+(EPGS?'?start='+EPGS:''))}catch(e){if(seq===EPGSEQ)$('#epgwrap').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(seq!==EPGSEQ||cur!='epg')return;  // inzwischen neuer angefordert oder Reiter gewechselt – verwerfen
 EPG=day;EPGS=EPG.start;const target=EPGPT;EPGPT=null;
 const tags=[...new Set(EPG.channels.flatMap(c=>c.tags))].sort();
 // Zeile 1 immer sichtbar und kompakt (bei genug Breite oben im Kopf); Zeile 2 (Filter, Suche) über 🔍 aufklappbar
 $('#hdrslot').innerHTML='';
 $('#epgbar').innerHTML=`<div class="epgnav"><button class="b sec sq" onclick="renderEpg(EPG.prev,0)" title="Voriger Tag">‹</button>
 <input type="date" value="${dkey(EPG.start)}" onchange="epgDay(this.value)" title="${esc(wday(EPG.start))}">
 <button class="b sec sq" onclick="renderEpg(EPG.next,0)" title="Nächster Tag">›</button>
 <span class="seg blocks">${BLOCKS.map(h=>`<button id="jb${h}" onclick="epgJump(${h})" title="${h}–${h+4} Uhr">${h}<span class="to">–${h+4}</span></button>`).join('')}</span>
 <button class="b sec" onclick="renderEpg(0)">Jetzt</button></div>
 <div class="bar tools" style="margin:8px 0 0"><select onchange="EPGT=this.value;store('epgtag',EPGT);fillEpg();toolsState()"><option value="">Alle Sender</option>${tags.map(t=>`<option ${t==EPGT?'selected':''}>${esc(t)}</option>`).join('')}</select>
 <input type="search" id="epgq" placeholder="Im ganzen Programm suchen …" value="${esc(EPGQ)}" oninput="epgTyped(this.value)" onkeydown="if(event.key=='Enter'){clearTimeout(EPGQT);epgSearch(EPGFULL)}" style="flex:1;min-width:160px">
 <label class="chk"><input type="checkbox" ${EPGE?'checked':''} onchange="EPGE=this.checked;fillEpg()"> Sender ohne Programm</label></div>`;
 const keep=$('#epgwrap').scrollTop,keepX=$('#epgwrap').scrollLeft;fillEpg();
 placeEpgNav();toolsState();
 if(target!==null)epgJump(target);else{$('#epgwrap').scrollTop=keep;epgMark()}
 $('#epgwrap').scrollLeft=keepX;
 if(EPG.posters_pending)setTimeout(()=>epgPosters(EPG),4000)}
// Bilder werden auf dem Server im Hintergrund gesucht – hier nachfragen und eintragen, sobald sie da sind
async function epgPosters(day,tries=0){if(day!==EPG||cur!='epg'||tries>60)return;
 const open=EPG.events.filter(e=>e.poster_pending),keys=[...new Set(open.map(e=>e.poster_key))];if(!keys.length)return;
 let res;try{res=await api('/api/posters',{keys})}catch(e){return}
 if(day!==EPG)return;let found=false;
 open.forEach(e=>{const p=res[e.poster_key];if(p==='pending')return;delete e.poster_pending;if(p){e.poster=p;found=true}});
 if(found&&cur=='epg'){const w=$('#epgwrap'),y=w.scrollTop,x=w.scrollLeft;fillEpg();w.scrollTop=y;w.scrollLeft=x;epgMark()}
 if(EPG.events.some(e=>e.poster_pending))setTimeout(()=>epgPosters(day,tries+1),5000)}
// Die Zeitschrift bekommt die ganze restliche Bildschirmhöhe (eigener Scrollbereich mit festem Kopf)
function sizeEpg(){const w=$('#epgwrap');if(!w||cur!='epg')return;
 w.style.maxHeight=Math.max(260,innerHeight-(w.getBoundingClientRect().top+scrollY)-14)+'px'}
// Tag, Blöcke und „Jetzt“ in den Kopf, wenn das Fenster breit genug ist – spart eine Zeile
const WIDE=matchMedia('(min-width:980px)');
function placeEpgNav(){const nav=document.querySelector('.epgnav'),slot=$('#hdrslot');if(!nav||!slot)return;
 if(cur=='epg'&&WIDE.matches){if(nav.parentNode!==slot)slot.appendChild(nav)}
 else if(nav.parentNode===slot)$('#epgbar')?.prepend(nav);
 sizeEpg()}
addEventListener('resize',()=>placeEpgNav());
function epgDay(v){if(!v)return;const [y,m,d]=v.split('-').map(Number);renderEpg(new Date(y,m-1,d,12).getTime()/1000,0)}
function epgJump(h){const w=$('#epgwrap'),r=$('#blk'+h);if(!r)return;
 w.scrollTop=r.offsetTop-w.querySelector('thead').offsetHeight;w.scrollIntoView({block:'nearest'});epgMark()}
function epgMark(){const w=$('#epgwrap'),th=w&&w.querySelector('thead');if(!th)return;  // sichtbaren Block in der Schnellauswahl markieren
 const top=w.scrollTop+th.offsetHeight+5,h=BLOCKS.filter(b=>$('#blk'+b).offsetTop<=top).pop()??0;
 BLOCKS.forEach(b=>$('#jb'+b)&&($('#jb'+b).className=b==h?'on':''))}
function epgMore(k){EPGX.add(k);const w=$('#epgwrap'),y=w.scrollTop,x=w.scrollLeft;fillEpg();w.scrollTop=y;w.scrollLeft=x}
// Zellen füllen: Erst ohne Beschreibung zeichnen und messen. Die vollste Zelle der Zeile (mindestens ROW_MIN px)
// bestimmt die Höhe. Innerhalb der Zelle steht jede Sendung möglichst an der Stelle ihrer Uhrzeit (die Zeile ist
// eine Zeitachse über 4 Stunden) – so stehen gleichzeitige Sendungen verschiedener Sender nebeneinander.
// Den freien Platz bis zur nächsten Sendung bekommt die Beschreibung (lange Sendungen also mehr), bei viel Platz ein Bild.
const ROW_MIN=300,LINE_PX=16,IMG_PX=110,MIN_DESC=2,MAX_DESC=40,EV_GAP=7;
const blockAt=h=>{const d=new Date(EPGS*1000);d.setHours(h,0,0,0);return d.getTime()/1000};
function evHtml(e){
 return `<div class="ev${e.planned?' pl':''}" data-s="${e.start}" data-e="${e.stop}" onclick="showEvent(${e.eventId})">
  ${e.poster?`<img class="poster" src="${esc(e.poster.thumb)}" alt="" loading="lazy" hidden onerror="this.remove()">`:''}
  <b>${esc(e.title)}</b><div class="muted tt">${hm(e.start)}–${hm(e.stop)}${e.hd?' · HD':''}</div>
  ${e.subtitle&&e.subtitle!=e.title?`<div class="st">${esc(e.subtitle)}</div>`:''}${e.description?`<div class="ds" hidden>${esc(e.description)}</div>`:''}</div>`}
function layoutEpg(){
 for(const tr of document.querySelectorAll('table.epg tbody tr')){
  const h=+tr.id.slice(3),B=blockAt(h),E=blockAt(h+4);
  const cells=[...tr.querySelectorAll('td > .cell')],base=cells.map(c=>c.offsetHeight);
  const H=Math.max(ROW_MIN,...base);
  cells.forEach((c,i)=>{const evs=[...c.querySelectorAll(':scope > .ev')];if(!evs.length)return;
   const first=c.querySelector(':scope > .more.first'),more=c.querySelector(':scope > .more:not(.first)');
   const top0=first?first.offsetHeight+EV_GAP:0,bottom=H-(more?more.offsetHeight+EV_GAP:0);
   const y=t=>top0+(Math.min(Math.max(t,B),E)-B)/(E-B)*(bottom-top0);  // Uhrzeit → Höhe in der Zelle
   // 1. Beschreibungen: Platz bis zur Uhrzeit der nächsten Sendung, zusammen höchstens der freie Platz der Zelle
   const free=evs.map((ev,j)=>Math.max(0,(j+1<evs.length?y(+evs[j+1].dataset.s):bottom)-y(+ev.dataset.s)-ev.offsetHeight-EV_GAP));
   const sum=free.reduce((a,b)=>a+b,0),k=sum>0?Math.min(1,(H-base[i])/sum):0;
   evs.forEach((ev,j)=>{const d=ev.querySelector('.ds');if(!d)return;
    let n=Math.min(MAX_DESC,Math.floor(free[j]*k/LINE_PX));const img=ev.querySelector('.poster');
    if(img&&n*LINE_PX>=IMG_PX+4*LINE_PX){img.hidden=false;n-=Math.ceil(IMG_PX/LINE_PX)}
    if(n>=MIN_DESC){d.hidden=false;d.style.webkitLineClamp=n}});
   // 2. Verschieben: jede Sendung nach unten bis zu ihrer Uhrzeit, aber nie über das Zellenende hinaus
   const ct=c.getBoundingClientRect().top,tops=evs.map(ev=>ev.getBoundingClientRect().top-ct);
   const room=bottom-(evs[evs.length-1].getBoundingClientRect().bottom-ct);if(room<=1)return;
   const S=[];evs.forEach((ev,j)=>S[j]=Math.max(j?S[j-1]:0,y(+ev.dataset.s)-tops[j]));
   for(let j=evs.length-1;j>=0;j--)S[j]=Math.max(0,Math.min(S[j],room,j+1<evs.length?S[j+1]:room));
   // Der Abstand gehört zur Sendung davor (deren Kasten wird länger, Hover und „Jetzt“ decken ihn mit ab);
   // nur vor der ersten Sendung bleibt er frei – dort läuft noch die Sendung aus dem Block davor.
   const grow=(el,px)=>el.style.paddingBottom=(parseFloat(getComputedStyle(el).paddingBottom)+px)+'px';
   evs.forEach((ev,j)=>{const dlt=S[j]-(j?S[j-1]:0);if(dlt<1)return;
    if(j)grow(evs[j-1],dlt);else ev.style.marginTop=(parseFloat(getComputedStyle(ev).marginTop)+dlt)+'px'});
   // die letzte Sendung bis zu ihrem Ende ziehen (höchstens bis zum Zellenende)
   const last=evs[evs.length-1],lb=last.getBoundingClientRect().bottom-c.getBoundingClientRect().top,want=Math.min(y(+last.dataset.e),bottom);
   if(want-lb>=1)grow(last,want-lb)})}}
// Volle Zelle: CELLMAX Sendungen zeigen, aber die laufende muss dabei sein – davor liegende
// verschwinden dann oben unter „+ n frühere“, spätere wie bisher unten unter „+ n weitere“.
function cellCut(all,k){if(EPGX.has(k)||all.length<=CELLMAX)return 0;const now=Date.now()/1000,i=all.findIndex(e=>e.start<=now&&now<e.stop);
 return i<CELLMAX?0:Math.min(i,all.length-CELLMAX)}
function fillEpg(){if(EPGQ.trim().length>=2)return epgSearch(EPGFULL);  // Suchtext da: Ergebnisliste statt Zeitschrift
 const chans=EPG.channels.filter(c=>(EPGE||c.epg)&&(!EPGT||c.tags.includes(EPGT)));
 const evs=EPG.events,cell={};evs.forEach(e=>{(cell[blockOf(e.start)+'|'+e.channelUuid]??=[]).push(e)});EPGCELLS=cell;
 if(!chans.length||!evs.length){$('#epgwrap').innerHTML='<p class="muted">Keine Sendungen an diesem Tag.</p>';return}
 const rows=BLOCKS.map(h=>{
  const cells=chans.map(c=>{const k=EPGS+'|'+h+'|'+c.uuid,all=cell[h+'|'+c.uuid]||[];const from=cellCut(all,k);return {k,all,from,list:EPGX.has(k)?all:all.slice(from,from+CELLMAX)}});
  return `<tr id="blk${h}"><th class="tm"><div>${h}–${h+4}<br><span class="muted">Uhr</span></div></th>${cells.map(x=>{const after=x.all.length-x.from-x.list.length;return `<td><div class="cell">${x.from?`<button class="b sec more first" onclick="epgMore('${x.k}')">+ ${x.from} frühere</button>`:''}${x.list.map(evHtml).join('')}${after>0?`<button class="b sec more" onclick="epgMore('${x.k}')">+ ${after} weitere</button>`:''}</div></td>`}).join('')}</tr>`});
 $('#epgwrap').innerHTML=`<table class="epg"><thead><tr><th class="tm"></th>${chans.map(c=>`<th><div class="chh">${c.number?`<span class="chnr">${c.number}</span>`:''}${c.icon?`<img src="${c.icon}" alt="" loading="lazy">`:''}</div><div>${esc(c.name)}</div></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
 EPGCUT=cutSig();epgNow();layoutEpg();$('#epgwrap').onscroll=epgMark}
// Fingerabdruck aller Ausschnitte – ändert er sich (die laufende Sendung ist aus dem Ausschnitt gewandert), neu zeichnen
let EPGCUT='',EPGCELLS={};
const cutSig=()=>Object.entries(EPGCELLS).map(([k,a])=>cellCut(a,EPGS+'|'+k)).join(',');
// Laufende Sendung je Sender hervorheben, mit Fortschritt; jede Minute aktualisiert.
// Nur Rahmen, Hintergrund und eine eingeblendete Leiste – die Zellenhöhen bleiben dadurch gleich.
function epgNow(){const now=Date.now()/1000;
 document.querySelectorAll('table.epg .ev').forEach(el=>{const s=+el.dataset.s,e=+el.dataset.e,on=s<=now&&now<e;
  el.classList.toggle('now',on);el.classList.toggle('past',e<=now);if(on)el.style.setProperty('--p',((now-s)/(e-s)*100).toFixed(1)+'%');else el.style.removeProperty('--p')})}
setInterval(()=>{if(cur!='epg'||!$('table.epg'))return;
 if(cutSig()!==EPGCUT){const w=$('#epgwrap'),y=w.scrollTop,x=w.scrollLeft;fillEpg();w.scrollTop=y;w.scrollLeft=x}else epgNow()},60000);
async function showEvent(id){let e;try{e=await api('/api/epg/event?id='+id)}catch(err){return msg(err.message)}
 const schema=await formSchema('dvrautorec'),cfg=(schema.props.find(p=>p.id=='config_name')||{enum:[]}).enum;
 const flags=['hd','widescreen','subtitled','audiodesc','deafsigned','new','repeat'].filter(k=>e[k]).map(k=>({hd:'HD',widescreen:'16:9',subtitled:'Untertitel',audiodesc:'Audiodeskription',deafsigned:'Gebärdensprache',new:'Neu',repeat:'Wiederholung'})[k]);
 const extra=[['Folge',e.episodeOnscreen],['Staffel/Folge',e.seasonNumber?`S${e.seasonNumber} E${e.episodeNumber||'?'}`:''],['Jahr',e.copyright_year],['Altersfreigabe',e.ageRating],['Bewertung',e.starRating],['Kategorie',(e.category||[]).join(', ')],['Stichwörter',(e.keyword||[]).join(', ')],['Erstausstrahlung',e.first_aired?fmt(e.first_aired):'']].filter(x=>x[1]);
 const wdv=(new Date(e.start*1000).getDay()+6)%7+1;
 EVENT=e;if(e.poster_pending)setTimeout(()=>eventPoster(e),1500);dialog(`<h2 style="margin:0 40px 4px 0">${esc(e.title)}</h2>${e.subtitle?`<div class="muted">${esc(e.subtitle)}</div>`:''}
 <p><b>${esc(e.channelName)}</b> · ${esc(wday(e.start))}, ${hm(e.start)}–${hm(e.stop)} (${Math.round((e.stop-e.start)/60)} min)${flags.length?' · '+flags.join(' · '):''}</p>
 ${e.image?`<img src="${esc(e.image)}" alt="" style="max-width:100%;max-height:220px;border-radius:6px">`:''}
 <div id="evposter">${e.poster?posterFig(e.poster):e.poster_pending?'<figure class="wp muted" style="font-size:12px">Bild wird gesucht …</figure>':''}</div>
 ${e.summary&&e.summary!=e.description?`<p><i>${esc(e.summary)}</i></p>`:''}<p style="white-space:pre-line">${esc(e.description||'Keine Beschreibung.')}</p>
 ${extra.length?`<table>${extra.map(x=>`<tr><td class="muted">${x[0]}</td><td>${esc(x[1])}</td></tr>`).join('')}</table>`:''}
 ${e.dvrUuid?`<p class="tag">Aufnahme ist geplant</p>`:''}
 ${e.stop<=Date.now()/1000?`<p class="muted" style="margin-top:14px">Diese Sendung ist vorbei${e.archived?' (aus dem Archiv dieses Tools)':''}.</p>`:`<div class="bar" style="margin-top:14px"><select id="evcfg">${cfg.map(o=>`<option value="${esc(o.key)}">${esc(o.val)}</option>`).join('')}</select>
  ${e.start<=Date.now()/1000&&e.channelUuid?`<a class="b" style="text-decoration:none" href="${playHref(e.channelUuid)}" data-play="${e.channelUuid}" title="Öffnet den Sender als Stream in VLC">▶ Abspielen</a>
  <button class="b sec" data-ch="${e.channelUuid}" data-n="${esc(e.channelName||'')}" onclick="openTeletext(this.dataset.ch,this.dataset.n)">Videotext</button>`:''}
  <button class="b" onclick="recordEvent(${e.eventId})">Aufnehmen</button>
  <button class="b sec" onclick="$('#serform').hidden=!$('#serform').hidden">Serienaufnahme …</button></div>`}
 ${e.start<=Date.now()/1000?`<div class="bar" style="margin-top:10px"><button class="b sec" onclick="findRepeats(${e.eventId},this)">🔁 Wiederholungen suchen</button></div><div id="reps"></div>`:''}
 <form id="serform" hidden onsubmit="event.preventDefault();saveSeries(this)"><h3>Serienaufnahme</h3>
  ${idnodeForm(schema,{name:e.title,title:'^'+e.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',channel:e.channelUuid,weekdays:[wdv]})}
  <div class="bar" style="margin-top:12px"><button class="b">Serienaufnahme anlegen</button></div></form>`)}
let EVENT=null;
const posterFig=p=>`<figure class="wp"><a href="${esc(p.page)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="" onerror="this.closest('figure').remove()"></a><figcaption class="muted">Bild: <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.caption)}</a> (${p.src=='tvmaze'?'TVmaze':p.src=='trakt'?'Trakt':p.src=='wikidata'||String(p.thumb).includes('Special:FilePath')?'Wikidata':'Wikipedia'})</figcaption></figure>`;
// Bild für die geöffnete Sendung: Der Server sucht es vorrangig, hier nachfragen, bis es da ist (max. 1 Minute)
async function eventPoster(e,tries=0){if(EVENT!==e||!$('#dlg').open)return;
 let res;try{res=await api('/api/posters',{keys:[e.poster_key],urgent:true})}catch(err){return}
 const p=res[e.poster_key],box=$('#evposter');if(EVENT!==e||!box)return;
 if(p==='pending'){if(tries<30)setTimeout(()=>eventPoster(e,tries+1),2000);else box.innerHTML='';return}
 box.innerHTML=p?posterFig(p):''}
async function recordEvent(id){try{const r=await api('/api/record',{event:id,config:$('#evcfg').value});$('#dlg').close();
 if(r.conflict)msg(`Aufnahme geplant: ${EVENT.title}\n\n⚠ Konflikt: Zu dieser Zeit sind schon ${r.conflict.titles.length-1} andere Aufnahme(n) auf anderen Transpondern geplant – es gibt aber nur ${r.tuners} Tuner. Eine davon wird nicht aufgenommen:\n${r.conflict.titles.join(', ')}`);
 else msg('Aufnahme geplant: '+EVENT.title,true);if(cur=='epg')renderEpg()}catch(e){msg(e.message)}}
async function saveSeries(form){const schema=await formSchema('dvrautorec'),conf=readIdnodeForm(form,schema);
 try{await api('/api/autorec-save',conf);$('#dlg').close();msg('Serienaufnahme angelegt: '+(conf.name||conf.title),true);if(cur=='epg')renderEpg()}catch(e){msg(e.message)}}

// Suche über das ganze Programm (alle Tage). Sie startet beim Tippen nach einer kurzen Pause (EPG_DELAY ms),
// Ergebnisse ersetzen die Zeitschrift; Feld leeren oder „Zurück“ zeigt wieder die Zeitschrift.
const EPG_DELAY=400;let EPGQT=null,EPGFULL=false,EPGRSEQ=0;
function epgTyped(v){EPGQ=v;clearTimeout(EPGQT);
 if(!v.trim()){EPGR=null;EPGFULL=false;EPGRSEQ++;fillEpg();epgNow();return}
 if(v.trim().length>=2)EPGQT=setTimeout(()=>epgSearch(EPGFULL),EPG_DELAY)}
function epgBack(){EPGQ='';EPGR=null;EPGFULL=false;EPGRSEQ++;const i=$('#epgq');if(i)i.value='';fillEpg();epgNow();toolsState()}
async function epgSearch(full){const q=EPGQ.trim();if(q.length<2)return msg('Bitte mindestens 2 Zeichen eingeben');
 EPGFULL=!!full;const seq=++EPGRSEQ;
 if(!$('#epgwrap .srch'))$('#epgwrap').innerHTML='<p class="muted" style="padding:12px">Suche im ganzen Programm …</p>';  // alte Treffer bis zu den neuen stehen lassen
 let r;try{r=await api('/api/epg-search?q='+encodeURIComponent(q)+(full?'&full=1':''))}catch(e){if(seq===EPGRSEQ)msg(e.message);return}
 if(cur!='epg'||seq!==EPGRSEQ)return;EPGR=r;  // inzwischen weitergetippt – veraltetes Ergebnis verwerfenconst days={};r.events.forEach(e=>(days[dkey(e.start)]??=[]).push(e));
 $('#epgwrap').innerHTML=`<div class="srch"><div class="bar"><button class="b sec" onclick="epgBack()">‹ Zurück zum Programm</button>
  <span class="muted">${r.events.length} Sendungen mit „${esc(q)}“${full?' (auch in Beschreibungen)':''}</span>
  ${full?'':`<button class="b sec" onclick="epgSearch(true)">Auch in Beschreibungen suchen</button>`}</div>
  ${r.events.length?Object.entries(days).map(([d,evs])=>`<h3>${esc(wday(evs[0].start))}</h3><table>${evs.map(e=>`<tr class="hit" onclick="showEvent(${e.eventId})">
   <td style="white-space:nowrap;width:110px"><b>${hm(e.start)}</b>–${hm(e.stop)}</td><td style="width:180px">${esc(e.channelName||'')}</td>
   <td><b>${e.planned?'<span class="dot"></span>':''}${esc(e.title)}</b>${e.subtitle&&e.subtitle!=e.title?`<div class="muted">${esc(e.subtitle.split('\n')[0])}</div>`:''}${e.description?`<div class="muted ds2">${esc(e.description)}</div>`:''}</td></tr>`).join('')}</table>`).join(''):'<p class="muted">Nichts gefunden.</p>'}</div>`}
let EPGR=null;

// Wiederholungen einer laufenden oder vergangenen Sendung in den kommenden Tagen
async function findRepeats(id,btn){btn.disabled=true;$('#reps').innerHTML='<p class="muted">Suche …</p>';
 let r;try{r=await api('/api/repeats?id='+id)}catch(e){$('#reps').innerHTML='';btn.disabled=false;return msg(e.message)}
 btn.disabled=false;
 $('#reps').innerHTML=r.repeats.length?`<p class="muted" style="margin:6px 0">${r.repeats.length} weitere Ausstrahlung(en)${r.episode?' dieser Folge':''}:</p>
 <table class="reps">${r.repeats.map(e=>`<tr><td style="white-space:nowrap"><b>${esc(wday(e.start))}</b><br><span class="muted">${hm(e.start)}–${hm(e.stop)}</span></td>
  <td>${esc(e.channelName||'')}${e.hd?' <span class="tag">HD</span>':''}<br><a class="evl" onclick="showEvent(${e.eventId})">${esc(e.title)}</a>${e.subtitle&&e.subtitle!=e.title?' <span class="muted">– '+esc(e.subtitle.split('\n')[0])+'</span>':''}</td>
  <td style="white-space:nowrap">${e.planned?'<span class="tag keep">geplant</span>':`<button class="b" onclick="recordRepeat(${e.eventId},this)">Aufnehmen</button>`}</td></tr>`).join('')}</table>`
  :`<p class="muted">Keine weitere Ausstrahlung${r.episode?' dieser Folge':''} in den Programmdaten gefunden (reichen etwa 4 Wochen voraus).</p>`}
async function recordRepeat(id,btn){btn.disabled=true;
 try{const r=await api('/api/record',{event:id,config:''});btn.outerHTML='<span class="tag keep">geplant</span>';
  if(r.conflict)msg(`Aufnahme geplant – aber ⚠ Konflikt: zu der Zeit sind schon ${r.conflict.titles.length-1} andere Aufnahme(n) auf anderen Transpondern geplant, es gibt nur ${r.tuners} Tuner:\n${r.conflict.titles.join(', ')}`);
  else msg('Aufnahme geplant',true)}catch(e){btn.disabled=false;msg(e.message)}}
