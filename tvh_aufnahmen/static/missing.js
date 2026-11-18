// Reiter „Einträge ohne Datei“: Pfad reparieren, Einträge löschen
function renderMissing(){
 if(!S.missing.length){$('#main').innerHTML='<p class="muted">Keine Einträge mit fehlender Datei.</p>';return}
 const rep=S.missing.filter(m=>m.candidate).length;
 let h=`<div class="bar">${rep?`<button class="b" onclick="repairAll()">${rep} Pfade reparieren</button>`:''}
 <button class="b bad" onclick="del()">Ausgewählte Einträge löschen</button>
 <label><input type="checkbox" onchange="document.querySelectorAll('.cm').forEach(c=>c.checked=this.checked)"> alle auswählen</label></div>
 <p class="muted">Gelöscht werden nur Einträge, deren Datei wirklich fehlt. Videodateien werden dabei nicht angefasst.</p>
 <table><tr><th></th><th>Titel</th><th>Sender / Datum</th><th>Erwartete Datei</th><th></th></tr>`;
 S.missing.forEach((m,i)=>{h+=`<tr><td><input type="checkbox" class="cm" data-i="${i}"></td>
 <td>${esc(m.title)}${m.subtitle?'<br><span class="muted">'+esc(m.subtitle)+'</span>':''}<br><span class="tag">${esc(m.status)}</span></td>
 <td>${esc(m.channel)}<br><span class="muted">${fmt(m.start)}</span></td>
 <td class="f">${m.filename?esc(m.filename):'<span class="muted">keine Datei</span>'}${m.candidate?'<br>→ gefunden: '+esc(m.candidate):''}</td>
 <td>${m.candidate?`<button class="b" onclick="repair([${i}])">Pfad reparieren</button>`:''}</td></tr>`});
 $('#main').innerHTML=h+'</table>'}
async function repair(idx){const moves=idx.map(i=>({src:S.missing[i].filename,dst:S.missing[i].candidate}));
 try{const r=await api('/api/move',{moves});msg(r.moved+' Pfade repariert'+(r.skipped?', '+r.skipped+' übersprungen':''),true);await load()}catch(e){msg(e.message)}}
function repairAll(){repair(S.missing.map((m,i)=>m.candidate?i:-1).filter(i=>i>=0))}
async function del(){const uuids=[...document.querySelectorAll('.cm:checked')].map(c=>S.missing[c.dataset.i].uuid);
 if(!uuids.length)return msg('Nichts ausgewählt');
 if(!confirm(uuids.length+' Einträge endgültig aus TVHeadend löschen?'))return;
 try{const r=await api('/api/delete',{uuids});msg(r.deleted+' gelöscht'+(r.skipped?', '+r.skipped+' übersprungen (Datei vorhanden)':''),true);await load()}catch(e){msg(e.message)}}
