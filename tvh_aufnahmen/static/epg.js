// Reiter „Programm“: Fernsehzeitschrift für einen ganzen Tag – Sender als Spalten, sechs Zeilen zu je 4 Stunden.
// In einer Zeile stehen alle Sendungen, die in diesem Zeitraum beginnen; die Schnellauswahl springt nur dorthin.
let EPG=null,EPGS=0,EPGQ='',EPGT=store('epgtag')||'',EPGE=false,EPGJ=null;
const BLOCKS=[0,4,8,12,16,20],CELLMAX=10,EPGX=new Set();  // EPGX: aufgeklappte Zellen
const dkey=t=>{const d=new Date(t*1000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const wday=t=>new Date(t*1000).toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});
const blockOf=t=>Math.floor(new Date(t*1000).getHours()/4)*4;
async function renderEpg(start,jump){
 if(start!==undefined)EPGS=start;
 const now=Date.now()/1000,fresh=!$('#epgwrap');
 // Sprungziel: angegeben; „Jetzt“ → aktueller Block; Reiter neu geöffnet → aktueller Block (heute) bzw. Tagesanfang
 EPGJ=jump??(start!==undefined?(start?0:blockOf(now)):fresh?(EPGS&&dkey(EPGS)!=dkey(now)?0:blockOf(now)):null);
 if(fresh)$('#main').innerHTML=`<div class="bar" id="epgbar"></div><div id="epgwrap" class="epgwrap"><p class="muted">Lade Programm …</p></div>`;
 try{EPG=await api('/api/epg'+(EPGS?'?start='+EPGS:''))}catch(e){$('#epgwrap').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='epg')return;EPGS=EPG.start;
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
 if(EPGJ!==null)epgJump(EPGJ);else{$('#epgwrap').scrollTop=keep;epgMark()}
 $('#epgwrap').scrollLeft=keepX;EPGJ=null}
function epgDay(v){if(!v)return;const [y,m,d]=v.split('-').map(Number);renderEpg(new Date(y,m-1,d,12).getTime()/1000,0)}
function epgJump(h){const w=$('#epgwrap'),r=$('#blk'+h);if(!r)return;
 w.scrollTop=r.offsetTop-w.querySelector('thead').offsetHeight;w.scrollIntoView({block:'nearest'});epgMark()}
function epgMark(){const w=$('#epgwrap'),th=w.querySelector('thead');if(!th)return;  // sichtbaren Block in der Schnellauswahl markieren
 const top=w.scrollTop+th.offsetHeight+5,h=BLOCKS.filter(b=>$('#blk'+b).offsetTop<=top).pop()??0;
 BLOCKS.forEach(b=>$('#jb'+b)&&($('#jb'+b).className=b==h?'on':''))}
function epgMore(k){EPGX.add(k);const w=$('#epgwrap'),y=w.scrollTop,x=w.scrollLeft;fillEpg();w.scrollTop=y;w.scrollLeft=x}
function fillEpg(){const words=EPGQ.toLowerCase().split(/\s+/).filter(Boolean),match=e=>words.every(w=>(e.title+' '+(e.subtitle||'')+' '+(e.description||'')).toLowerCase().includes(w));
 const chans=EPG.channels.filter(c=>(EPGE||c.epg)&&(!EPGT||c.tags.includes(EPGT)));
 const evs=EPG.events.filter(match),cell={};evs.forEach(e=>{(cell[blockOf(e.start)+'|'+e.channelUuid]??=[]).push(e)});
 if(!chans.length||!evs.length){$('#epgwrap').innerHTML='<p class="muted">Keine Sendungen an diesem Tag.</p>';return}
 $('#epgwrap').innerHTML=`<table class="epg"><thead><tr><th class="tm"></th>${chans.map(c=>`<th>${c.icon?`<img src="${c.icon}" alt="" loading="lazy">`:''}<div>${esc(c.name)}</div></th>`).join('')}</tr></thead><tbody>
 ${BLOCKS.map(h=>`<tr id="blk${h}"><th class="tm"><div>${h}–${h+4}<br><span class="muted">Uhr</span></div></th>${chans.map(c=>{const k=EPGS+'|'+h+'|'+c.uuid,all=cell[h+'|'+c.uuid]||[],list=EPGX.has(k)?all:all.slice(0,CELLMAX);return `<td>${list.map(e=>`<div class="ev${e.planned?' pl':''}" onclick="showEvent(${e.eventId})">
  <b>${esc(e.title)}</b><div class="muted tt">${hm(e.start)}–${hm(e.stop)}${e.hd?' · HD':''}</div>${e.subtitle&&e.subtitle!=e.title?`<div class="st">${esc(e.subtitle)}</div>`:''}<div class="ds">${esc(e.description||'')}</div></div>`).join('')}${all.length>list.length?`<button class="b sec more" onclick="epgMore('${k}')">+ ${all.length-list.length} weitere</button>`:''}</td>`}).join('')}</tr>`).join('')}</tbody></table>`;
 $('#epgwrap').onscroll=epgMark}
async function showEvent(id){let e;try{e=await api('/api/epg/event?id='+id)}catch(err){return msg(err.message)}
 const schema=await formSchema('dvrautorec'),cfg=(schema.props.find(p=>p.id=='config_name')||{enum:[]}).enum;
 const flags=['hd','widescreen','subtitled','audiodesc','deafsigned','new','repeat'].filter(k=>e[k]).map(k=>({hd:'HD',widescreen:'16:9',subtitled:'Untertitel',audiodesc:'Audiodeskription',deafsigned:'Gebärdensprache',new:'Neu',repeat:'Wiederholung'})[k]);
 const extra=[['Folge',e.episodeOnscreen],['Staffel/Folge',e.seasonNumber?`S${e.seasonNumber} E${e.episodeNumber||'?'}`:''],['Jahr',e.copyright_year],['Altersfreigabe',e.ageRating],['Bewertung',e.starRating],['Kategorie',(e.category||[]).join(', ')],['Stichwörter',(e.keyword||[]).join(', ')],['Erstausstrahlung',e.first_aired?fmt(e.first_aired):'']].filter(x=>x[1]);
 const wdv=(new Date(e.start*1000).getDay()+6)%7+1;
 EVENT=e;dialog(`<h2 style="margin:0 40px 4px 0">${esc(e.title)}</h2>${e.subtitle?`<div class="muted">${esc(e.subtitle)}</div>`:''}
 <p><b>${esc(e.channelName)}</b> · ${esc(wday(e.start))}, ${hm(e.start)}–${hm(e.stop)} (${Math.round((e.stop-e.start)/60)} min)${flags.length?' · '+flags.join(' · '):''}</p>
 ${e.image?`<img src="${esc(e.image)}" alt="" style="max-width:100%;max-height:220px;border-radius:6px">`:''}
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
async function recordEvent(id){try{await api('/api/record',{event:id,config:$('#evcfg').value});$('#dlg').close();msg('Aufnahme geplant: '+EVENT.title,true);if(cur=='epg')renderEpg()}catch(e){msg(e.message)}}
async function saveSeries(form){const schema=await formSchema('dvrautorec'),conf=readIdnodeForm(form,schema);
 try{await api('/api/autorec-save',conf);$('#dlg').close();msg('Serienaufnahme angelegt: '+(conf.name||conf.title),true);if(cur=='epg')renderEpg()}catch(e){msg(e.message)}}
