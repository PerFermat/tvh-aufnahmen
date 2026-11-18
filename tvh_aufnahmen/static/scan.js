// Reiter „Suchlauf“: Sendersuchlauf starten, neue deutschsprachige unverschlüsselte Sender anlegen,
// Sender löschen, die es nicht mehr gibt
let SCANR=null,scanTimer=null;
async function renderScan(){let st;try{st=await api('/api/scan-status')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='scan')return;
 const pct=st.muxes?Math.round(st.scanned/st.muxes*100):0;
 $('#main').innerHTML=`<div class="bar"><button class="b" onclick="scanStart()" ${st.running?'disabled':''}>Suchlauf starten</button>
 <button class="b sec" onclick="scanEval()" ${!st.started||st.running?'disabled':''}>Ergebnis auswerten</button>
 <span class="muted">${st.started?`Letzter Suchlauf: ${fmt(st.started)} · ${st.scanned} von ${st.muxes} Transpondern empfangen${st.running?` · läuft (${st.queued} in der Warteschlange)`:st.failed.length?` · ${st.failed.length} ohne Empfang`:''}`:'Noch kein Suchlauf über dieses Tool.'}</span></div>
 ${st.running?`<div class="prog" style="max-width:none"><div style="width:${pct}%"></div></div>`:''}
 <p class="muted">Sucht auf allen Transpondern nach Sendern. Neue unverschlüsselte Fernsehsender mit deutscher Tonspur werden zum Anlegen vorgeschlagen und bekommen Nummern nach der höchsten vorhandenen. Sender, deren Dienste im Suchlauf nicht mehr gefunden wurden, können gelöscht werden.</p>
 <div id="scanres"></div>`;
 if(SCANR)showScan();
 clearTimeout(scanTimer);if(st.running)scanTimer=setTimeout(()=>{if(cur=='scan')renderScan()},10000)}
async function scanStart(){if(!confirm('Sendersuchlauf starten?\nDas dauert je nach Anzahl der Transponder 10–30 Minuten. Freie Tuner werden dafür benutzt, laufende Aufnahmen haben Vorrang.'))return;
 try{await api('/api/scan-start',{});SCANR=null;msg('Suchlauf gestartet',true);renderScan()}catch(e){msg(e.message)}}
async function scanEval(){$('#scanres').innerHTML='<p class="muted">Werte aus – prüfe Tonspuren der neuen Dienste …</p>';
 try{SCANR=await api('/api/scan-result');showScan()}catch(e){$('#scanres').innerHTML='';msg(e.message)}}
const langs=l=>l.map(x=>x||'?').join(', ');
function scanTable(list,cls,checked){return `<table><thead><tr><th><input type="checkbox" ${checked?'checked':''} onchange="document.querySelectorAll('.${cls}').forEach(c=>c.checked=this.checked);scanNumbers()"></th><th>Sender</th><th>Anbieter</th><th>Bild</th><th>Tonspuren</th><th>Transponder</th><th class="nr"></th></tr></thead><tbody>
 ${list.map(s=>`<tr><td><input type="checkbox" class="${cls} sadd" value="${s.uuid}" ${checked?'checked':''} onchange="scanNumbers()"></td><td><b>${esc(s.name)}</b></td><td>${esc(s.provider)}</td><td>${s.hd?'HD':'SD'}</td><td class="muted">${esc(langs(s.langs))}</td><td class="muted">${esc(s.mux)}</td><td class="nr muted" data-u="${s.uuid}"></td></tr>`).join('')}</tbody></table>`}
function showScan(){const r=SCANR;if(!$('#scanres'))return;
 $('#scanres').innerHTML=`<h3>Neue Sender (${r.new.length})</h3>${r.new.length?scanTable(r.new,'sn',true):'<p class="muted">Keine neuen deutschsprachigen unverschlüsselten Sender gefunden.</p>'}
 ${r.other.length?`<details><summary><b>Andere Fassung eines vorhandenen Senders (${r.other.length})</b> <span class="muted">– SD-, Regional- oder Länderfassung eines Senders, den du schon hast</span></summary>${scanTable(r.other,'so',false)}</details>`:''}
 ${r.unknown.length?`<details><summary><b>Sprache nicht angegeben (${r.unknown.length})</b> <span class="muted">– Tonspur ohne Sprachangabe</span></summary>${scanTable(r.unknown,'su',false)}</details>`:''}
 ${r.adult.length?`<details><summary><b>Erotik / Kontakt (${r.adult.length})</b></summary>${scanTable(r.adult,'sx',false)}</details>`:''}
 <div class="bar" style="margin-top:10px"><button class="b" onclick="scanAdd()">Ausgewählte anlegen</button><span class="muted" id="scanhint"></span></div>
 <h3>Nicht mehr gefunden (${r.dead.length})</h3>
 ${r.dead.length?`<table><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll('.sd').forEach(c=>c.checked=this.checked)"></th><th>Nr.</th><th>Sender</th><th>Zuletzt gesehen</th><th>Hinweis</th></tr></thead><tbody>
 ${r.dead.map(d=>`<tr><td><input type="checkbox" class="sd" value="${d.uuid}" checked></td><td>${d.number||''}</td><td><b>${esc(d.name)}</b>${d.enabled?'':' <span class="tag">deaktiviert</span>'}</td><td>${d.last_seen?fmt(d.last_seen):'nie'}</td><td>${d.autorecs.length?`<span class="tag" style="color:var(--bad)">Serienaufnahme: ${esc(d.autorecs.join(', '))}</span>`:''}</td></tr>`).join('')}</tbody></table>
 <div class="bar" style="margin-top:10px"><button class="b bad" onclick="scanDelete()">Ausgewählte löschen</button></div>`:'<p class="muted">Alle Sender wurden im Suchlauf gefunden.</p>'}
 ${r.status.failed.length?`<p class="muted">Ohne Empfang: ${esc(r.status.failed.join(', '))}. Sender auf diesen Transpondern stehen oben unter „Nicht mehr gefunden“ – bei schlechtem Wetter lieber später noch einmal suchen.</p>`:''}`;
 scanNumbers()}
function scanNumbers(){let n=SCANR.next_number;document.querySelectorAll('.nr[data-u]').forEach(td=>td.textContent='');
 const sel=[...document.querySelectorAll('.sadd:checked')];sel.forEach(c=>{const td=document.querySelector(`.nr[data-u="${c.value}"]`);if(td)td.textContent='Nr. '+(n++)});
 const h=$('#scanhint');if(h)h.textContent=sel.length?`${sel.length} Sender, Nr. ${SCANR.next_number}–${n-1}`:''}
async function scanAdd(){const uuids=[...document.querySelectorAll('.sadd:checked')].map(c=>c.value);if(!uuids.length)return msg('Nichts ausgewählt');
 if(!confirm(`${uuids.length} Sender anlegen (ab Nr. ${SCANR.next_number})?`))return;
 try{const r=await api('/api/scan-add',{uuids});msg(`${r.added.length} Sender angelegt`+(r.added.length?`: Nr. ${r.added[0].number}–${r.added[r.added.length-1].number}`:''),true);await scanEval()}catch(e){msg(e.message)}}
async function scanDelete(){const uuids=[...document.querySelectorAll('.sd:checked')].map(c=>c.value);if(!uuids.length)return msg('Nichts ausgewählt');
 const names=SCANR.dead.filter(d=>uuids.includes(d.uuid)),ar=names.filter(d=>d.autorecs.length);
 if(!confirm(`${uuids.length} Sender löschen?\n\n${names.map(d=>d.name).slice(0,15).join(', ')}${names.length>15?' …':''}${ar.length?`\n\nAchtung: ${ar.length} davon haben Serienaufnahmen.`:''}\n\nAufnahmen dieser Sender bleiben erhalten.`))return;
 try{const r=await api('/api/scan-delete',{uuids});msg(`${r.deleted.length} Sender gelöscht`,true);await scanEval()}catch(e){msg(e.message)}}
