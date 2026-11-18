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
 if(fresh)$('#main').innerHTML=`<div class="bar" id="epgbar"></div><div id="epgwrap" class="epgwrap"><p class="muted">Lade Programm …</p></div>`;
 try{day=await api('/api/epg'+(EPGS?'?start='+EPGS:''))}catch(e){if(seq===EPGSEQ)$('#epgwrap').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(seq!==EPGSEQ||cur!='epg')return;  // inzwischen neuer angefordert oder Reiter gewechselt – verwerfen
 EPG=day;EPGS=EPG.start;const target=EPGPT;EPGPT=null;
 const tags=[...new Set(EPG.channels.flatMap(c=>c.tags))].sort();
 $('#epgbar').innerHTML=`<button class="b sec" onclick="renderEpg(EPG.prev,0)" title="Voriger Tag">‹</button>
 <input type="date" value="${dkey(EPG.start)}" onchange="epgDay(this.value)">
 <button class="b sec" onclick="renderEpg(EPG.next,0)" title="Nächster Tag">›</button>
 <span class="seg">${BLOCKS.map(h=>`<button id="jb${h}" onclick="epgJump(${h})">${h}–${h+4}</button>`).join('')}</span>
 <button class="b sec" onclick="renderEpg(0)">Jetzt</button>
 <select onchange="EPGT=this.value;store('epgtag',EPGT);fillEpg()"><option value="">Alle Sender</option>${tags.map(t=>`<option ${t==EPGT?'selected':''}>${esc(t)}</option>`).join('')}</select>
 <input type="search" placeholder="Suchen an diesem Tag …" value="${esc(EPGQ)}" oninput="EPGQ=this.value;fillEpg()" style="flex:1;min-width:160px">
 <label class="chk"><input type="checkbox" ${EPGE?'checked':''} onchange="EPGE=this.checked;fillEpg()"> Sender ohne Programm</label>
 <span class="muted">${esc(wday(EPG.start))}</span>`;
 const keep=$('#epgwrap').scrollTop,keepX=$('#epgwrap').scrollLeft;fillEpg();
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
function epgDay(v){if(!v)return;const [y,m,d]=v.split('-').map(Number);renderEpg(new Date(y,m-1,d,12).getTime()/1000,0)}
function epgJump(h){const w=$('#epgwrap'),r=$('#blk'+h);if(!r)return;
 w.scrollTop=r.offsetTop-w.querySelector('thead').offsetHeight;w.scrollIntoView({block:'nearest'});epgMark()}
function epgMark(){const w=$('#epgwrap'),th=w.querySelector('thead');if(!th)return;  // sichtbaren Block in der Schnellauswahl markieren
 const top=w.scrollTop+th.offsetHeight+5,h=BLOCKS.filter(b=>$('#blk'+b).offsetTop<=top).pop()??0;
 BLOCKS.forEach(b=>$('#jb'+b)&&($('#jb'+b).className=b==h?'on':''))}
function epgMore(k){EPGX.add(k);const w=$('#epgwrap'),y=w.scrollTop,x=w.scrollLeft;fillEpg();w.scrollTop=y;w.scrollLeft=x}
// Zellen gleichmäßig füllen: Erst ohne Beschreibung zeichnen und messen. Die vollste Zelle der Zeile
// (mindestens ROW_MIN px) bestimmt die Höhe; den übrigen Platz jeder Zelle bekommen ihre Beschreibungen –
// bei vielen Sendungen bleibt keiner, bei wenigen werden sie lang, bei viel Platz kommt ein Bild dazu.
const ROW_MIN=300,LINE_PX=16,IMG_PX=110,MIN_DESC=2,MAX_DESC=40;
function evHtml(e){
 return `<div class="ev${e.planned?' pl':''}" data-s="${e.start}" data-e="${e.stop}" onclick="showEvent(${e.eventId})">
  ${e.poster?`<img class="poster" src="${esc(e.poster.thumb)}" alt="" loading="lazy" hidden onerror="this.remove()">`:''}
  <b>${esc(e.title)}</b><div class="muted tt">${hm(e.start)}–${hm(e.stop)}${e.hd?' · HD':''}</div>
  ${e.subtitle&&e.subtitle!=e.title?`<div class="st">${esc(e.subtitle)}</div>`:''}${e.description?`<div class="ds" hidden>${esc(e.description)}</div>`:''}</div>`}
function layoutEpg(){
 for(const tr of document.querySelectorAll('table.epg tbody tr')){
  const cells=[...tr.querySelectorAll('td > .cell')],base=cells.map(c=>c.offsetHeight);
  const H=Math.max(ROW_MIN,...base);
  cells.forEach((c,i)=>{const ds=[...c.querySelectorAll('.ds')];if(!ds.length)return;
   let lines=Math.min(MAX_DESC,Math.floor((H-base[i])/LINE_PX/ds.length));
   ds.forEach(d=>{let n=lines;const img=d.parentNode.querySelector('.poster');
    if(img&&n*LINE_PX>=IMG_PX+4*LINE_PX){img.hidden=false;n-=Math.ceil(IMG_PX/LINE_PX)}
    if(n>=MIN_DESC){d.hidden=false;d.style.webkitLineClamp=n}})})}}
function fillEpg(){const words=EPGQ.toLowerCase().split(/\s+/).filter(Boolean),match=e=>words.every(w=>(e.title+' '+(e.subtitle||'')+' '+(e.description||'')).toLowerCase().includes(w));
 const chans=EPG.channels.filter(c=>(EPGE||c.epg)&&(!EPGT||c.tags.includes(EPGT)));
 const evs=EPG.events.filter(match),cell={};evs.forEach(e=>{(cell[blockOf(e.start)+'|'+e.channelUuid]??=[]).push(e)});
 if(!chans.length||!evs.length){$('#epgwrap').innerHTML='<p class="muted">Keine Sendungen an diesem Tag.</p>';return}
 const rows=BLOCKS.map(h=>{
  const cells=chans.map(c=>{const k=EPGS+'|'+h+'|'+c.uuid,all=cell[h+'|'+c.uuid]||[];return {k,all,list:EPGX.has(k)?all:all.slice(0,CELLMAX)}});
  return `<tr id="blk${h}"><th class="tm"><div>${h}–${h+4}<br><span class="muted">Uhr</span></div></th>${cells.map(x=>`<td><div class="cell">${x.list.map(evHtml).join('')}${x.all.length>x.list.length?`<button class="b sec more" onclick="epgMore('${x.k}')">+ ${x.all.length-x.list.length} weitere</button>`:''}</div></td>`).join('')}</tr>`});
 $('#epgwrap').innerHTML=`<table class="epg"><thead><tr><th class="tm"></th>${chans.map(c=>`<th>${c.icon?`<img src="${c.icon}" alt="" loading="lazy">`:''}<div>${esc(c.name)}</div></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
 epgNow();layoutEpg();$('#epgwrap').onscroll=epgMark}
// Laufende Sendung je Sender hervorheben, mit Fortschritt; jede Minute aktualisiert.
// Nur Rahmen, Hintergrund und eine eingeblendete Leiste – die Zellenhöhen bleiben dadurch gleich.
function epgNow(){const now=Date.now()/1000;
 document.querySelectorAll('table.epg .ev').forEach(el=>{const s=+el.dataset.s,e=+el.dataset.e,on=s<=now&&now<e;
  el.classList.toggle('now',on);if(on)el.style.setProperty('--p',((now-s)/(e-s)*100).toFixed(1)+'%');else el.style.removeProperty('--p')})}
setInterval(()=>{if(cur=='epg'&&$('table.epg'))epgNow()},60000);
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
 <div class="bar" style="margin-top:14px"><select id="evcfg">${cfg.map(o=>`<option value="${esc(o.key)}">${esc(o.val)}</option>`).join('')}</select>
  <button class="b" onclick="recordEvent(${e.eventId})">Aufnehmen</button>
  <button class="b sec" onclick="$('#serform').hidden=!$('#serform').hidden">Serienaufnahme …</button></div>
 <form id="serform" hidden onsubmit="event.preventDefault();saveSeries(this)"><h3>Serienaufnahme</h3>
  ${idnodeForm(schema,{name:e.title,title:'^'+e.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',channel:e.channelUuid,weekdays:[wdv]})}
  <div class="bar" style="margin-top:12px"><button class="b">Serienaufnahme anlegen</button></div></form>`)}
let EVENT=null;
const posterFig=p=>`<figure class="wp"><a href="${esc(p.page)}" target="_blank" rel="noopener"><img src="${esc(p.thumb)}" alt="" onerror="this.closest('figure').remove()"></a><figcaption class="muted">Bild: <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.caption)}</a> (Wikipedia)</figcaption></figure>`;
// Bild für die geöffnete Sendung: Der Server sucht es vorrangig, hier nachfragen, bis es da ist (max. 1 Minute)
async function eventPoster(e,tries=0){if(EVENT!==e||!$('#dlg').open)return;
 let res;try{res=await api('/api/posters',{keys:[e.poster_key],urgent:true})}catch(err){return}
 const p=res[e.poster_key],box=$('#evposter');if(EVENT!==e||!box)return;
 if(p==='pending'){if(tries<30)setTimeout(()=>eventPoster(e,tries+1),2000);else box.innerHTML='';return}
 box.innerHTML=p?posterFig(p):''}
async function recordEvent(id){try{await api('/api/record',{event:id,config:$('#evcfg').value});$('#dlg').close();msg('Aufnahme geplant: '+EVENT.title,true);if(cur=='epg')renderEpg()}catch(e){msg(e.message)}}
async function saveSeries(form){const schema=await formSchema('dvrautorec'),conf=readIdnodeForm(form,schema);
 try{await api('/api/autorec-save',conf);$('#dlg').close();msg('Serienaufnahme angelegt: '+(conf.name||conf.title),true);if(cur=='epg')renderEpg()}catch(e){msg(e.message)}}
