// Reiter „Aufnahmen“: Liste/Ordner, Sortierung, Suche, Bearbeiten, Ersetzen, Löschen
let VIEW=store('view')||'list',SORT=store('sort')||'date',DESC=(store('desc')??'1')=='1';const OPEN=new Set();
const mins=r=>Math.round((r.stop-r.start)/60)+' min';
const R=u=>S.recordings.find(r=>r.uuid===u);
function renderRecordings(){
 $('#main').innerHTML=`<div class="bar"><input id="q" class="tools" type="search" placeholder="Suchen: Titel, Untertitel, Sender, Datei …" value="${esc(Q)}" style="flex:1;min-width:220px" oninput="Q=this.value;fillRecordings()">
 <span class="seg"><button id="v-list" onclick="setView('list')">Liste</button><button id="v-dir" onclick="setView('dir')">Ordner</button><button id="v-dup" onclick="setView('dup')" title="Doppelt aufgenommene Sendungen finden">Doppelte</button></span>
 <button class="b bad" onclick="removeSel()">Ausgewählte löschen</button>
 <label><input type="checkbox" id="allr" onchange="document.querySelectorAll('.cr').forEach(c=>c.checked=this.checked)"> alle sichtbaren</label></div>
 <p class="muted" id="rcount"></p>
 <table><thead><tr><th></th><th>${sh('title','Name')}</th><th>${sh('channel','Sender')} / ${sh('date','Datum')}</th><th>${sh('dur','Dauer')} / ${sh('size','Größe')}</th><th></th></tr></thead><tbody id="rbody"></tbody></table>`;
 fillRecordings()}
const sh=(k,t)=>`<a class="${SORT==k?'on':''}" onclick="sortBy('${k}')">${t}${SORT==k?(DESC?' ▼':' ▲'):''}</a>`;
function sortBy(k){if(SORT==k)DESC=!DESC;else{SORT=k;DESC=k=='date'||k=='size'||k=='dur'}store('sort',SORT);store('desc',DESC?'1':'0');renderRecordings()}
function setView(v){VIEW=v;store('view',v);fillRecordings()}
const folder=r=>{const i=r.rel.lastIndexOf('/');return i<0?'':r.rel.slice(0,i)};
const coll=new Intl.Collator('de',{numeric:true,sensitivity:'base'});
const KEYS={title:r=>r.title+' '+r.subtitle,channel:r=>r.channel,date:r=>r.start,dur:r=>r.stop-r.start,size:r=>r.size};
function cmp(a,b){const k=KEYS[SORT],x=k(a),y=k(b);
 const c=typeof x=='number'?x-y:coll.compare(x,y);return (DESC?-c:c)||b.start-a.start}
function toggleFolder(f){OPEN.has(f)?OPEN.delete(f):OPEN.add(f);fillRecordings()}
function fillRecordings(){const words=Q.toLowerCase().split(/\s+/).filter(Boolean);
 ['list','dir','dup'].forEach(v=>$('#v-'+v).className=VIEW==v?'on':'');
 const list=S.recordings.filter(r=>{const t=(r.title+' '+r.subtitle+' '+r.channel+' '+r.rel).toLowerCase();return words.every(w=>t.includes(w))});
 list.sort(cmp);
 $('#rcount').textContent=list.length+' von '+S.recordings.length+' Aufnahmen';$('#allr').checked=false;
 if(VIEW=='list'){$('#rbody').innerHTML=list.map(recRow).join('');return}
 if(VIEW=='dup')return fillDuplicates(list);
 const groups=new Map();list.forEach(r=>{const f=folder(r);if(!groups.has(f))groups.set(f,[]);groups.get(f).push(r)});
 let gs=[...groups];const total=g=>g[1].reduce((n,r)=>n+r.size,0);
 if(SORT=='title')gs.sort((a,b)=>coll.compare(a[0],b[0])*(DESC?-1:1));
 if(SORT=='size')gs.sort((a,b)=>(total(a)-total(b))*(DESC?-1:1));
 const root=gs.filter(g=>!g[0]);gs=gs.filter(g=>g[0]);
 $('#rbody').innerHTML=gs.map(g=>{const open=OPEN.has(g[0])||words.length>0;
  return `<tr class="fold" onclick="toggleFolder(this.dataset.f)" data-f="${esc(g[0])}"><td>${open?'▾':'▸'}</td><td colspan="2">📁 ${esc(g[0])} <span class="muted">(${g[1].length})</span></td><td colspan="2"><span class="muted">${gb(total(g))}</span></td></tr>`+(open?g[1].map(recRow).join(''):'')}).join('')
  +root.flatMap(g=>g[1]).map(recRow).join('')}
const recRow=r=>`<tr><td><input type="checkbox" class="cr" value="${r.uuid}"></td>
 <td><img class="thumb" src="/api/thumb?uuid=${r.uuid}" alt="" loading="lazy" onerror="this.remove()" onclick="showThumb('${r.uuid}')" title="Vergrößern"><a class="rtitle" onclick="recInfo('${r.uuid}')" title="Details anzeigen">${esc(r.title)}</a>${r.subtitle?'<br><span class="muted">'+esc(r.subtitle.split('\n')[0])+'</span>':''}${r.status&&r.status!='Completed OK'?'<br><span class="tag">'+esc(r.status)+'</span>':''}</td>
 <td>${esc(r.channel)}<br><span class="muted">${fmt(r.start)}</span></td>
 <td>${mins(r)}<br><span class="muted">${gb(r.size)}</span></td>
 <td style="white-space:nowrap"><a class="b" style="text-decoration:none;display:inline-block" href="/api/download?uuid=${r.uuid}">Download</a>
 <a class="b sec" style="text-decoration:none;display:inline-block" href="/api/playlist?uuid=${r.uuid}" title="Öffnet die Aufnahme als Stream in VLC">Abspielen</a>
 <button class="b sec" id="eb-${r.uuid}" onclick="editRec('${r.uuid}')">Bearbeiten</button>
 <button class="b bad" onclick="removeRec(['${r.uuid}'])" title="Diese Aufnahme samt Datei löschen">Löschen</button></td></tr>
 <tr id="er-${r.uuid}" hidden><td colspan="5"></td></tr>`;
function closeRec(u){$('#er-'+u).hidden=true;$('#eb-'+u).textContent='Bearbeiten';$('#eb-'+u).scrollIntoView({block:'nearest'})}
function editRec(u){const row=$('#er-'+u);if(!row.hidden)return closeRec(u);
 const r=R(u);row.hidden=false;$('#eb-'+u).textContent='Schließen';
 row.firstElementChild.innerHTML=`<form class="ed" onsubmit="event.preventDefault();saveRec('${u}',this)">
 <label class="wide">Titel<input name="title" required value="${esc(r.title)}"></label>
 <label class="wide">Untertitel / Episode<textarea name="subtitle" rows="2" style="min-height:0">${esc(r.subtitle)}</textarea></label>
 <label class="wide">Beschreibung<textarea name="description" rows="6">${esc(r.description)}</textarea></label>
 <div class="wide muted">Datei: ${esc(r.rel)}</div>
 <div class="wide" style="display:flex;gap:10px"><button class="b">Speichern</button>
  <button type="button" class="b sec" onclick="closeRec('${u}')">Schließen</button></div>
 <label class="wide">Datei ersetzen (z. B. nach dem Schneiden)<input type="file" accept="video/*,.ts,.mkv,.mp4,.m2ts,.mpg,.mpeg,.avi,.mov" id="up-${u}"></label>
 <div class="wide" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
  <button type="button" class="b sec" onclick="upload('${u}')">Hochladen und ersetzen</button><span id="pr-${u}" class="muted"></span>
  <button type="button" class="b bad" style="margin-left:auto" onclick="removeRec(['${u}'])">Aufnahme löschen</button></div></form>`}
async function saveRec(u,form){const f=Object.fromEntries(new FormData(form));
 const btn=form.querySelector('button');btn.disabled=true;
 try{await api('/api/edit',{uuid:u,title:f.title,subtitle:f.subtitle,description:f.description});msg('Gespeichert: '+f.title,true);await load()}catch(e){msg(e.message);btn.disabled=false}}
async function removeRec(uuids){if(!uuids.length)return msg('Nichts ausgewählt');
 const names=uuids.map(u=>R(u).title).slice(0,5).join(', ')+(uuids.length>5?' …':'');
 if(!confirm(`${uuids.length} Aufnahme(n) samt Videodatei endgültig löschen?\n\n${names}`))return;
 try{const r=await api('/api/remove',{uuids});if($('#dlg').open)$('#dlg').close();msg(r.removed+' Aufnahme(n) gelöscht',true);await load()}catch(e){msg(e.message)}}
function removeSel(){removeRec([...document.querySelectorAll('.cr:checked')].map(c=>c.value))}
function upload(u){const f=$('#up-'+u).files[0];if(!f)return msg('Bitte zuerst eine Datei auswählen');
 if(!confirm(`Die Videodatei von „${R(u).title}“ durch „${f.name}“ (${gb(f.size)}) ersetzen?\nDie bisherige Datei wird überschrieben.`))return;
 const pr=$('#pr-'+u),x=new XMLHttpRequest();
 x.open('POST','/api/upload?uuid='+u+'&name='+encodeURIComponent(f.name));
 x.upload.onprogress=e=>{if(e.lengthComputable)pr.textContent='Hochladen … '+Math.round(e.loaded/e.total*100)+' %'};
 x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch(e){}
  if(x.status==200){pr.textContent='';msg('Datei ersetzt: '+f.name,true);load()}else{pr.textContent='';msg(j.error||'Fehler '+x.status)}};
 x.onerror=()=>{pr.textContent='';msg('Upload abgebrochen')};
 x.send(f)}
// Vorschaubild vergrößert: großes Standbild (1280 px) im Fenster, mit Titel
function showThumb(u){const r=R(u);dialog(`<h3 style="margin:0 90px 10px 0">${esc(r.title)}</h3>${r.subtitle?`<div class="muted" style="margin:-6px 0 10px">${esc(r.subtitle.split('\n')[0])}</div>`:''}
 <div class="bigthumb"><img src="/api/thumb?uuid=${u}&size=large" alt="" onerror="this.parentNode.innerHTML='<p class=muted>Kein Bild verfügbar.</p>'"><p class="muted">Bild wird erzeugt …</p></div>
 <p class="muted small">${esc(r.channel)} · ${fmt(r.start)} · ${mins(r)} · ${gb(r.size)}</p>`)}

// ---------- Doppelte Aufnahmen ----------
// Gleich sind Aufnahmen mit gleichem Titel und Untertitel (Episode) – ohne Untertitel mit gleicher Beschreibung.
// Nutzt ein Sender immer denselben Untertitel („Moderation: …“), trennen unterschiedliche Beschreibungen die Folgen.
const dnorm=s=>(s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
// ganze Beschreibung vergleichen – die ersten Sätze sind oft eine allgemeine Einleitung, erst danach kommen z. B. die Gäste
const ddesc=r=>dnorm(r.description);
const perMin=r=>r.size/Math.max(60,r.stop-r.start)*60;
const isHD=r=>/\bhd\b/i.test(r.channel)||perMin(r)>45e6;  // HD-Sender oder > ~6 Mbit/s
// beste Fassung zuerst: HD, dann längste, dann größte, dann älteste
const dupScore=(a,b)=>(isHD(b)-isHD(a))||((b.stop-b.start)-(a.stop-a.start))||(b.size-a.size)||(a.start-b.start);
function duplicateGroups(list){
 const byEpisode=new Map();
 for(const r of list){const t=dnorm(r.title),sub=dnorm(r.subtitle.split('\n')[0]),d=ddesc(r);
  const key=sub&&sub!=t?t+'|'+sub:d?t+'||'+d:null;if(!key||!t)continue;
  (byEpisode.get(key)||byEpisode.set(key,[]).get(key)).push(r)}
 const groups=[];
 for(const [key,rs] of byEpisode){if(rs.length<2)continue;
  // gleicher Untertitel, aber verschiedene Beschreibungen: allgemeiner Untertitel → nach Beschreibung trennen
  const descs=new Set(rs.map(ddesc).filter(Boolean));
  if(!key.includes('||')&&descs.size>1){const by=new Map();rs.forEach(r=>{const d=ddesc(r)||'';(by.get(d)||by.set(d,[]).get(d)).push(r)});
   const empty=by.get('')||[];by.delete('');const parts=[...by.values()];
   if(parts.length==1)parts[0].push(...empty);parts.filter(p=>p.length>1).forEach(p=>groups.push(p))}
  else groups.push(rs)}
 groups.forEach(g=>g.sort(dupScore));
 return groups.sort((a,b)=>coll.compare(a[0].title,b[0].title)||(a[0].start-b[0].start))}
let DUPS=new Map();  // uuid → Gruppe, für den Vergleich im Detailfenster
function fillDuplicates(list){const groups=duplicateGroups(list);DUPS=new Map();groups.forEach(g=>g.forEach(r=>DUPS.set(r.uuid,g)));
 const extra=groups.reduce((n,g)=>n+g.length-1,0),space=groups.reduce((n,g)=>n+g.slice(1).reduce((m,r)=>m+r.size,0),0);
 $('#rcount').textContent=groups.length?`${groups.length} Sendungen doppelt aufgenommen · ${extra} Kopien vorausgewählt (${gb(space)}) – „Ausgewählte löschen“ entfernt sie`:'Keine doppelten Aufnahmen gefunden.';
 $('#rbody').innerHTML=groups.map(g=>`<tr class="fold dup"><td></td><td colspan="4">${g.length}× <b>${esc(g[0].title)}</b>${g[0].subtitle&&g[0].subtitle!=g[0].title?' – '+esc(g[0].subtitle.split('\n')[0]):' <span class="muted">(gleiche Beschreibung)</span>'}</td></tr>`
  +g.map((r,i)=>recRow(r).replace('class="cr"',`class="cr"${i?' checked':''}`).replace('<td><img',`<td>${i?'':'<span class="tag keep">behalten</span><br>'}<span class="tag">${isHD(r)?'HD':'SD'}</span> <img`)).join('')).join('')}

// ---------- Details einer Aufnahme ----------
// In der Ansicht „Doppelte“: links die zu behaltende Fassung, rechts die angeklickte (bzw. die erste Kopie)
function recCard(r,label,keep){return `<div class="rcard${keep?' keep':''}"><div class="rcard-h"><span class="tag ${keep?'keep':''}">${label}</span> <span class="tag">${isHD(r)?'HD':'SD'}</span></div>
 <img class="rthumb" src="/api/thumb?uuid=${r.uuid}" alt="" onerror="this.remove()" onclick="showThumb('${r.uuid}')" title="Vergrößern">
 <h3>${esc(r.title)}</h3>${r.subtitle&&r.subtitle!=r.title?`<div class="muted" style="white-space:pre-line">${esc(r.subtitle)}</div>`:''}
 <table class="kvt"><tr><td>Sender</td><td>${esc(r.channel)}</td></tr><tr><td>Gesendet</td><td>${esc(wday(r.start))}, ${hm(r.start)}–${hm(r.stop)}</td></tr>
 <tr><td>Dauer</td><td>${mins(r)}</td></tr><tr><td>Größe</td><td>${gb(r.size)} <span class="muted">(${(perMin(r)*8/60/1e6).toFixed(1)} Mbit/s)</span></td></tr>
 <tr><td>Datei</td><td class="f">${esc(r.rel)}</td></tr>${r.status&&r.status!='Completed OK'?`<tr><td>Status</td><td>${esc(r.status)}</td></tr>`:''}</table>
 <p style="white-space:pre-line">${esc(r.description||'Keine Beschreibung.')}</p>
 <div class="bar" style="margin:0"><a class="b sec" style="text-decoration:none" href="/api/playlist?uuid=${r.uuid}">Abspielen</a>
  <a class="b sec" style="text-decoration:none" href="/api/download?uuid=${r.uuid}">Download</a>
  <button class="b bad" onclick="removeRec(['${r.uuid}'])">Löschen</button></div></div>`}
function recInfo(u){const r=R(u),g=VIEW=='dup'?DUPS.get(u):null;
 if(!g)return dialog(`<div style="margin-top:34px">${recCard(r,'Aufnahme',false)}</div>`);
 const keep=g[0],other=u==keep.uuid?g[1]:r,same=dnorm(keep.description)==dnorm(other.description);
 dialog(`<h2 style="margin:0 90px 4px 0">Vergleich</h2><p class="muted" style="margin-top:0">${g.length} Fassungen dieser Sendung · Beschreibungen ${same?'<b>identisch</b>':'<b class="bad-t">unterschiedlich</b>'}${g.length>2?' · weitere Fassungen in der Liste anklicken':''}</p>
 <div class="cmp">${recCard(keep,'behalten (Vorschlag)',true)}${recCard(other,u==keep.uuid?'Kopie':'angeklickt',false)}</div>`)}
