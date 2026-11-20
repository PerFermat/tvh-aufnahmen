// Reiter „Suchlauf“: Sendersuchlauf starten, neue Sender anlegen (Sprache und Verschlüsselung wählbar),
// Sender löschen, die es nicht mehr gibt
let SCANR=null,scanTimer=null;
// Filter: Verschlüsselung (free/enc/all) und Sprachen (leer = alle); je Gerät gemerkt
const scanEnc=()=>store('scanenc')||'free';
const scanLangs=()=>{try{return JSON.parse(store('scanlangs')||'["deu"]')}catch(e){return ['deu']}};
// Sprachname aus dem ISO-639-Code (deu → Deutsch), über den Browser
const langName=c=>{if(!c)return '?';if(c=='qaa')return 'Originalton';if(c=='mul')return 'mehrsprachig';try{return new Intl.DisplayNames([document.documentElement.lang||'de'],{type:'language'}).of(c)||c}catch(e){return c}};
async function renderScan(){let st;try{st=await api('/api/scan-status')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='scan')return;
 const pct=st.muxes?Math.round(st.scanned/st.muxes*100):0;
 $('#main').innerHTML=`<div class="bar"><button class="b" onclick="scanStart()" ${st.running?'disabled':''}>Suchlauf starten</button>
 <button class="b sec" onclick="scanEval()" ${!st.started||st.running?'disabled':''}>Ergebnis auswerten</button>
 <span class="muted">${st.started?`Letzter Suchlauf: ${fmt(st.started)} · ${st.scanned} von ${st.muxes} Transpondern empfangen${st.running?` · läuft (${st.queued} in der Warteschlange)`:st.failed.length?` · ${st.failed.length} ohne Empfang`:''}`:'Noch kein Suchlauf über dieses Tool.'}</span></div>
 ${st.running?`<div class="prog" style="max-width:none"><div style="width:${pct}%"></div></div>`:''}
 <p class="muted">Sucht auf allen Transpondern nach Sendern. Neue Fernsehsender werden zum Anlegen vorgeschlagen – welche Sprachen und ob verschlüsselte dabei sein sollen, lässt sich nach dem Auswerten wählen. Neue Sender bekommen Nummern nach der höchsten vorhandenen. Sender, deren Dienste im Suchlauf nicht mehr gefunden wurden, können gelöscht werden.</p>
 <div id="scanres"></div>`;
 if(SCANR)showScan();
 clearTimeout(scanTimer);if(st.running)scanTimer=setTimeout(()=>{if(cur=='scan')renderScan()},10000)}
async function scanStart(){if(!confirm('Sendersuchlauf starten?\nDas dauert je nach Anzahl der Transponder 10–30 Minuten. Freie Tuner werden dafür benutzt, laufende Aufnahmen haben Vorrang.'))return;
 try{await api('/api/scan-start',{});SCANR=null;msg('Suchlauf gestartet',true);renderScan()}catch(e){msg(e.message)}}
async function scanEval(){$('#scanres').innerHTML='<p class="muted">Werte aus – prüfe Tonspuren der neuen Dienste …</p>';
 try{SCANR=await api('/api/scan-result');showScan()}catch(e){$('#scanres').innerHTML='';msg(e.message)}}
const langs=l=>l.map(x=>x?langName(x):'?').join(', ');
function scanTable(list,cls,checked){return `<table><thead><tr><th><input type="checkbox" ${checked?'checked':''} onchange="document.querySelectorAll('.${cls}').forEach(c=>c.checked=this.checked);scanNumbers()"></th><th>Sender</th><th>Anbieter</th><th>Bild</th><th>Tonspuren</th><th></th><th>Transponder</th><th class="nr"></th></tr></thead><tbody>
 ${list.map(s=>`<tr><td><input type="checkbox" class="${cls} sadd" value="${s.uuid}" ${checked?'checked':''} onchange="scanNumbers()"></td><td><b>${esc(s.name)}</b></td><td>${esc(s.provider)}</td><td>${s.hd?'HD':'SD'}</td><td class="muted">${esc(langs(s.langs))}</td><td>${s.encrypted?'<span class="tag" title="verschlüsselt – braucht ein CI-Modul bzw. einen Kartenleser">🔒</span>':''}</td><td class="muted">${esc(s.mux)}</td><td class="nr muted" data-u="${s.uuid}"></td></tr>`).join('')}</tbody></table>`}
// Filterleiste: Verschlüsselung und Sprachen (mit Anzahl der neuen Sender je Sprache)
function scanFilter(){const r=SCANR,sel=scanLangs(),all=!sel.length,enc=scanEnc();
 const codes=Object.entries(r.languages).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
 return `<div class="ed scanf"><label>Verschlüsselung<select onchange="store('scanenc',this.value);showScan()">
  ${[['free','unverschlüsselt'],['enc','verschlüsselt'],['all','alle']].map(([v,n])=>`<option value="${v}" ${enc==v?'selected':''}>${n}</option>`).join('')}</select></label>
  <div class="wide"><span class="muted">Sprache (erste Tonspur):</span>
   <label class="chk"><input type="checkbox" ${all?'checked':''} onchange="store('scanlangs','[]');showScan()"> <b>Alle Sprachen</b></label>
   ${codes.map(c=>`<label class="chk"><input type="checkbox" ${!all&&sel.includes(c)?'checked':''} onchange="scanLangToggle('${esc(c)}',this.checked)"> ${esc(langName(c))} <span class="muted">(${r.languages[c]})</span></label>`).join('')}</div></div>`}
function scanLangToggle(c,on){let s=scanLangs().filter(x=>x!=c);if(on)s.push(c);store('scanlangs',JSON.stringify(s));showScan()}
function showScan(){const r=SCANR;if(!$('#scanres'))return;
 const sel=scanLangs(),enc=scanEnc();
 const ok=i=>(enc=='all'||(enc=='enc')==i.encrypted)&&(!sel.length||!i.lang||sel.includes(i.lang));
 const g=k=>r.items.filter(i=>i.group==k&&ok(i));
 const neu=g('new'),other=g('other'),unknown=g('unknown'),adult=g('adult');
 $('#scanres').innerHTML=`${scanFilter()}
 <h3>Neue Sender (${neu.length})</h3>${neu.length?scanTable(neu,'sn',true):'<p class="muted">Keine neuen Sender mit dieser Auswahl gefunden.</p>'}
 ${other.length?`<details><summary><b>Andere Fassung eines vorhandenen Senders (${other.length})</b> <span class="muted">– SD-, Regional- oder Länderfassung eines Senders, den du schon hast</span></summary>${scanTable(other,'so',false)}</details>`:''}
 ${unknown.length?`<details><summary><b>Sprache nicht angegeben (${unknown.length})</b> <span class="muted">– Tonspur ohne Sprachangabe</span></summary>${scanTable(unknown,'su',false)}</details>`:''}
 ${adult.length?`<details><summary><b>Erotik / Kontakt (${adult.length})</b></summary>${scanTable(adult,'sx',false)}</details>`:''}
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
