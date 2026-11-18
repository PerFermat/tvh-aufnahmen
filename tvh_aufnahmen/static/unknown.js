// Reiter „Nicht eingetragene Dateien“: Import
function renderUnknown(){
 if(!S.unknown.length){$('#main').innerHTML='<p class="muted">Alle Dateien im Aufnahmeverzeichnis sind in TVHeadend eingetragen.</p>';return}
 let h=`<div class="bar"><button class="b sec" onclick="bulk()">Ausgewählte mit Vorschlägen importieren</button>
 <label><input type="checkbox" onchange="document.querySelectorAll('.cu').forEach(c=>c.checked=this.checked)"> alle auswählen</label></div>
 <table><tr><th></th><th>Datei</th><th>Vorschlag</th><th>Größe</th><th></th></tr>`;
 S.unknown.forEach((u,i)=>{h+=`<tr><td><input type="checkbox" class="cu" data-i="${i}"></td><td class="f">${esc(u.rel)}</td>
 <td>${esc(u.suggest.title)}<br><span class="muted">${esc(u.suggest.channelname||'Sender unbekannt')} · ${fmt(u.suggest.start)}${u.suggest.duration_known?'':' · Dauer geschätzt'}</span></td>
 <td>${gb(u.size)}</td><td><button class="b" onclick="edit(${i})">Bearbeiten</button></td></tr><tr id="ed${i}" hidden><td colspan="5"></td></tr>`});
 $('#main').innerHTML=h+'</table>'}
function edit(i){const row=$('#ed'+i);if(!row.hidden){row.hidden=true;return}
 const u=S.unknown[i],s=u.suggest;row.hidden=false;
 row.firstElementChild.innerHTML=`<form class="ed" onsubmit="event.preventDefault();save(${i},this)">
 <label class="wide">Titel<input name="title" required value="${esc(s.title)}"></label>
 <label class="wide">Untertitel / Episode<input name="subtitle"></label>
 <label>Sender<input name="channelname" list="chans" value="${esc(s.channelname)}" placeholder="Unbekannt"></label>
 <label>Start<input type="datetime-local" name="start" required value="${dtl(s.start)}"></label>
 <label>Ende<input type="datetime-local" name="stop" required value="${dtl(s.stop)}"></label>
 <label class="wide">Beschreibung<textarea name="description"></textarea></label>
 <label class="wide">Kommentar<input name="comment" value="nachträglich importiert"></label>
 <div class="wide" style="display:flex;gap:10px"><button class="b">In TVHeadend eintragen</button>
  <button type="button" class="b sec" onclick="$('#ed${i}').hidden=true">Schließen</button></div></form>`}
function payload(u,f){const ch=S.channels.find(c=>c.name===f.channelname);
 return {path:u.path,title:f.title,subtitle:f.subtitle,description:f.description,comment:f.comment,
  channelname:f.channelname,channel:ch?ch.uuid:'',start:Math.floor(new Date(f.start).getTime()/1000),stop:Math.floor(new Date(f.stop).getTime()/1000)}}
async function save(i,form){const f=Object.fromEntries(new FormData(form));
 try{await api('/api/import',payload(S.unknown[i],f));msg('Eingetragen: '+f.title,true);await load()}catch(e){msg(e.message)}}
async function bulk(){const sel=[...document.querySelectorAll('.cu:checked')].map(c=>S.unknown[c.dataset.i]);
 if(!sel.length)return msg('Nichts ausgewählt');
 if(!confirm(sel.length+' Dateien mit den vorgeschlagenen Titeln und Zeiten eintragen?'))return;
 let ok=0,err=[];for(const u of sel){const s=u.suggest;
  try{await api('/api/import',{path:u.path,title:s.title,channelname:s.channelname,start:s.start,stop:s.stop,comment:'nachträglich importiert'});ok++}catch(e){err.push(u.rel+': '+e.message)}}
 msg(ok+' eingetragen'+(err.length?'. Fehler: '+err.join('; '):''),!err.length);await load()}
