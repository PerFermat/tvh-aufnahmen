// Reiter „Sicherung“: Komplettsicherung des TVHeadend-Ordners und JSON-Export/-Import
let IMP=null;
const SECT={tags:'Sender-Tags',channels:'Sender',autorecs:'Serien-Timer',recordings:'Aufnahmen'};
function renderBackup(){
 $('#main').innerHTML=`<div id="autobk"><p class="muted">Lade …</p></div>
 <h3>Komplettsicherung</h3>
 <p class="muted">Sichert den ganzen TVHeadend-Ordner: Aufnahmen, Sender, Timer, Tuner und Benutzer. Wiederhergestellt ist danach alles exakt wie vorher, auch der Gesehen-Status. Passt nur zur gleichen Hardware und gleichen oder neueren TVHeadend-Version.</p>
 <form class="ed" onsubmit="event.preventDefault();backupDownload(this)">
 <label>TVHeadend-Passwort (aus den Einstellungen)<input type="password" name="password" autocomplete="off"></label>
 <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="epg" checked> Programmdaten (EPG) mitsichern</label>
 <div class="wide"><button class="b">Sicherung herunterladen</button> <span id="bk" class="muted"></span></div></form>
 <form class="ed" style="margin-top:10px" onsubmit="event.preventDefault();restoreUpload()">
 <label class="wide">Sicherung einspielen (.tar.gz)<input type="file" id="rs" accept=".gz,.tgz,application/gzip"></label>
 <div class="wide"><button class="b bad">Einspielen und TVHeadend neu starten</button> <span id="rp" class="muted"></span></div></form>
 <h3>Aufnahmen und Sender (JSON)</h3>
 <p class="muted">Für eine Neuinstallation mit anderer Hardware, Version oder anderem Aufnahmeordner. Vor dem Import in TVHeadend den Suchlauf machen, damit die Sender gefunden werden. Aufnahmen bekommen dabei neue IDs.</p>
 <div class="bar"><a class="b" style="text-decoration:none" href="/api/export">Export herunterladen</a>
 <label>Import-Datei <input type="file" id="imf" accept=".json,application/json" onchange="importPreview()"></label></div>
 <div id="imp"></div>`;
 if(IMP)showImport(IMP.result,IMP.done);renderAutoBackup()}
// Automatische Sicherung: jede Nacht Komplettsicherung + JSON-Export in einen Ordner, die letzten N behalten
async function renderAutoBackup(){let j;try{j=await api('/api/jobs')}catch(e){$('#autobk').innerHTML='';return}
 if(cur!='backup'||!$('#autobk'))return;const b=j.autobackup,st=j.state.backup;
 $('#autobk').innerHTML=`<h3 style="margin-top:0">Automatische Sicherung</h3>
 <form class="ed" onsubmit="event.preventDefault();saveAutoBackup(this)">
  <label class="chk wide"><input type="checkbox" name="enabled" ${b.enabled?'checked':''}> Jede Nacht automatisch sichern (Komplettsicherung, JSON-Export und EPG-Archiv)</label>
  <label class="wide">Ordner (am besten auf einer anderen Platte als das System)<input name="dir" value="${esc(b.dir)}"></label>
  <label>Uhrzeit<input type="time" name="time" value="${pad(b.hour)}:${pad(b.minute)}" required></label>
  <label>Wie viele behalten<input type="number" name="keep" min="1" max="365" value="${b.keep}"></label>
  <div class="wide bar" style="margin:0"><button class="b">Speichern</button><button type="button" class="b sec" onclick="backupNow(this)">Jetzt sichern</button>
   <span class="muted">${st?(st.ok?`Letzte Sicherung: ${fmt(st.ts)} (${(st.size/1048576).toFixed(1)} MB)`:`<span class="bad-t">Letzter Versuch ${fmt(st.ts)} fehlgeschlagen: ${esc(st.error)}</span>`):'Noch keine automatische Sicherung.'}</span></div></form>
 ${j.backups.length?`<details style="margin-top:8px"><summary class="muted">Vorhandene Sicherungen (${j.backups.length})</summary><table class="bars">${j.backups.map(x=>`<tr><td>${esc(x.name)}</td><td class="muted">${fmt(x.mtime)}</td><td style="text-align:right">${(x.size/1048576).toFixed(1)} MB</td></tr>`).join('')}</table>
  <p class="muted small">Einspielen: Datei unten unter „Sicherung einspielen“ bzw. „Import-Datei“ auswählen.</p></details>`:''}
 <h3>EPG-Archiv</h3>
 <p class="muted">Die vergangenen Sendungen fürs Programm liegen auf der SD-Karte. Die nächtliche Sicherung legt davon eine Kopie in den Ordner oben (<code>epg-archiv.sqlite</code>, jede Nacht ersetzt).
 ${j.archive_copy?`Letzte Kopie: ${fmt(j.archive_copy.mtime)} (${(j.archive_copy.size/1048576).toFixed(1)} MB).`:'Noch keine Kopie vorhanden – „Jetzt sichern“ legt eine an.'}</p>
 ${j.archive_copy?`<div class="bar" style="margin:0"><button class="b sec" onclick="restoreArchive(this)" title="Sendungen aus der Kopie übernehmen, die im Archiv fehlen – vorhandene bleiben unverändert">Archiv aus der Kopie ergänzen</button></div>`:''}`}
async function restoreArchive(btn){if(!confirm('Sendungen aus der Kopie übernehmen, die im Archiv fehlen? Vorhandene bleiben unverändert.'))return;
 btn.disabled=true;try{const r=await api('/api/archive-restore',{});msg(r.added?`${r.added.toLocaleString('de-DE')} Sendungen aus der Kopie übernommen`:'Das Archiv war schon vollständig – nichts zu übernehmen',true)}catch(e){msg(e.message)}btn.disabled=false}
async function saveAutoBackup(f){const [h,m]=f.time.value.split(':').map(Number),j=await api('/api/jobs').catch(()=>null);
 try{await api('/api/jobs',{autobackup:{enabled:f.enabled.checked,dir:f.dir.value,hour:h,minute:m,keep:+f.keep.value},notify:j?j.notify:{}});
  msg('Automatische Sicherung gespeichert',true);renderAutoBackup()}catch(e){msg(e.message)}}
async function backupNow(btn){btn.disabled=true;btn.textContent='Sichere …';
 try{const r=await api('/api/backup-now',{});msg(`Gesichert: ${r.file} (${(r.size/1048576).toFixed(1)} MB), JSON-Export und EPG-Archiv (${((r.archive||0)/1048576).toFixed(1)} MB)`,true)}catch(e){msg(e.message)}
 renderAutoBackup()}
async function backupDownload(form){const f=Object.fromEntries(new FormData(form)),st=$('#bk');st.textContent='Sicherung wird erstellt …';
 try{const r=await fetch('/api/backup',{method:'POST',body:JSON.stringify({password:f.password,epg:!!f.epg})});
  if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||r.status)}
  const name=decodeURIComponent((r.headers.get('Content-Disposition')||'').split("''")[1]||'tvheadend-sicherung.tar.gz');
  const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),10000);st.textContent='';msg('Sicherung heruntergeladen: '+name+' ('+(blob.size/1048576).toFixed(1)+' MB)',true)}
 catch(e){st.textContent='';msg(e.message)}}
function restoreUpload(force){const f=$('#rs').files[0];if(!f)return msg('Bitte zuerst eine Sicherung auswählen');
 if(!force&&!confirm(`„${f.name}“ einspielen?\n\nTVHeadend wird dafür gestoppt, der bisherige Konfigurationsordner wird umbenannt (nicht gelöscht) und durch die Sicherung ersetzt. Danach startet TVHeadend neu.`))return;
 const pr=$('#rp'),x=new XMLHttpRequest();x.open('POST','/api/restore'+(force?'?force=1':''));
 x.upload.onprogress=e=>{if(e.lengthComputable)pr.textContent='Hochladen … '+Math.round(e.loaded/e.total*100)+' %'+(e.loaded==e.total?' – spiele ein, TVHeadend startet neu …':'')};
 x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch(e){}pr.textContent='';
  if(x.status!=200)return msg(j.error||'Fehler '+x.status);
  if(j.confirm){if(confirm(j.confirm))restoreUpload(true);return}
  msg('Sicherung eingespielt'+(j.from?' (vom '+j.from+')':'')+'. Der bisherige Ordner liegt unter '+j.previous,true);load()};
 x.onerror=()=>{pr.textContent='';msg('Upload abgebrochen')};x.send(f)}
async function importPreview(){const f=$('#imf').files[0];if(!f)return;$('#imp').innerHTML='<p class="muted">Vergleiche mit TVHeadend …</p>';
 try{const data=JSON.parse(await f.text());const result=await api('/api/import-preview',{data});IMP={data,result,done:false};showImport(result,false)}
 catch(e){IMP=null;$('#imp').innerHTML='';msg(e.message)}}
const ACTIONABLE=['neu','anpassen'];
function showImport(result,done){
 $('#imp').innerHTML=Object.keys(SECT).map(k=>{const items=result[k]||[],c={};items.forEach(i=>c[i.action]=(c[i.action]||0)+1);
  const todo=items.filter(i=>i.action!='vorhanden');
  return `<div style="margin:12px 0"><label style="font-weight:600">${done?'':`<input type="checkbox" class="ims" value="${k}" ${items.some(i=>ACTIONABLE.includes(i.action))?'checked':'disabled'}> `}${SECT[k]}</label>
  <span class="muted"> – ${Object.entries(c).map(([a,n])=>n+' '+a).join(', ')||'nichts im Export'}</span>
  ${todo.length?`<details><summary class="muted">Details (${todo.length})</summary><table>${todo.map(i=>`<tr><td>${esc(i.label)}</td><td><span class="tag">${esc(i.action)}</span></td><td class="muted f">${esc(i.detail)}</td></tr>`).join('')}</table></details>`:''}</div>`}).join('')
  +(done?'':`<button class="b" onclick="importApply()">Ausgewählte übernehmen</button>`)}
async function importApply(){const sections=[...document.querySelectorAll('.ims:checked')].map(c=>c.value);if(!sections.length)return msg('Nichts ausgewählt');
 if(!confirm('In TVHeadend anlegen bzw. anpassen: '+sections.map(s=>SECT[s]).join(', ')+'?'))return;
 $('#imp').insertAdjacentHTML('beforeend','<p class="muted">Übernehme …</p>');
 try{const result=await api('/api/import-apply',{data:IMP.data,sections});IMP={result,done:true};showImport(result,true);msg('Import abgeschlossen',true);load()}catch(e){msg(e.message)}}
