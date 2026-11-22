// Reiter „Suchlauf“: Sendersuchlauf starten, neue Sender anlegen (Sprache und Verschlüsselung wählbar),
// Sender löschen, die es nicht mehr gibt
let SCANR=null,scanTimer=null;
// Filter: Verschlüsselung (free/enc/all) und Sprachen (leer = alle); je Gerät gemerkt
const scanEnc=()=>store('scanenc')||'free';
// ohne eigene Wahl: die Sprache der Oberfläche (ISO 639-1 → 639-2, wie in den Tonspuren)
const ISO3={de:'deu',en:'eng',fr:'fra',es:'spa',it:'ita',nl:'nld',pl:'pol',tr:'tur',pt:'por',da:'dan',sv:'swe',cs:'ces'};
const scanLangs=()=>{const d=[ISO3[LOCALE.split('-')[0]]||'deu'];try{return JSON.parse(store('scanlangs'))||d}catch(e){return d}};
// Sprachname aus dem ISO-639-Code (deu → Deutsch), über den Browser
const langName=c=>{if(!c)return '?';if(c=='qaa')return L('scan.original');if(c=='mul')return L('scan.multi');try{return new Intl.DisplayNames([document.documentElement.lang||'de'],{type:'language'}).of(c)||c}catch(e){return c}};
async function renderScan(){let st;try{st=await api('/api/scan-status')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='scan')return;
 const pct=st.muxes?Math.round(st.scanned/st.muxes*100):0;
 $('#main').innerHTML=`<div class="bar"><button class="b" onclick="scanStart()" ${st.running?'disabled':''}>${L('scan.start')}</button>
 <button class="b sec" onclick="scanEval()" ${!st.started||st.running?'disabled':''}>${L('scan.eval')}</button>
 <span class="muted">${st.started?L('scan.last',{t:fmt(st.started),n:st.scanned,total:st.muxes})+(st.running?' · '+L('scan.running',{n:st.queued}):st.failed.length?' · '+L('scan.no_signal_n',{n:st.failed.length}):''):L('scan.never')}</span></div>
 ${st.running?`<div class="prog" style="max-width:none"><div style="width:${pct}%"></div></div>`:''}
 <p class="muted">${L('scan.hint')}</p>
 <div id="scanres"></div>`;
 if(SCANR)showScan();
 clearTimeout(scanTimer);if(st.running)scanTimer=setTimeout(()=>{if(cur=='scan')renderScan()},10000)}
async function scanStart(){if(!confirm(L('scan.confirm')))return;
 try{await api('/api/scan-start',{});SCANR=null;msg(L('scan.started'),true);renderScan()}catch(e){msg(e.message)}}
async function scanEval(){$('#scanres').innerHTML=`<p class="muted">${L('scan.evaluating')}</p>`;
 try{SCANR=await api('/api/scan-result');showScan()}catch(e){$('#scanres').innerHTML='';msg(e.message)}}
const langs=l=>l.map(x=>x?langName(x):'?').join(', ');
function scanTable(list,cls,checked){return `<table><thead><tr><th><input type="checkbox" ${checked?'checked':''} onchange="document.querySelectorAll('.${cls}').forEach(c=>c.checked=this.checked);scanNumbers()"></th><th>${L('common.channel')}</th><th>${L('scan.provider')}</th><th>${L('scan.video')}</th><th>${L('scan.audio')}</th><th></th><th>${L('scan.mux')}</th><th class="nr"></th></tr></thead><tbody>
 ${list.map(s=>`<tr><td><input type="checkbox" class="${cls} sadd" value="${s.uuid}" ${checked?'checked':''} onchange="scanNumbers()"></td><td><b>${esc(s.name)}</b></td><td>${esc(s.provider)}</td><td>${s.hd?'HD':'SD'}</td><td class="muted">${esc(langs(s.langs))}</td><td>${s.encrypted?`<span class="tag" title="${L('scan.enc_tip')}">🔒</span>`:''}</td><td class="muted">${esc(s.mux)}</td><td class="nr muted" data-u="${s.uuid}"></td></tr>`).join('')}</tbody></table>`}
// Filterleiste: Verschlüsselung und Sprachen (mit Anzahl der neuen Sender je Sprache)
function scanFilter(){const r=SCANR,sel=scanLangs(),all=!sel.length,enc=scanEnc();
 const codes=Object.entries(r.languages).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
 return `<div class="ed scanf"><label>${L('scan.encryption')}<select onchange="store('scanenc',this.value);showScan()">
  ${[['free',L('scan.free')],['enc',L('scan.enc')],['all',L('scan.all')]].map(([v,n])=>`<option value="${v}" ${enc==v?'selected':''}>${n}</option>`).join('')}</select></label>
  <div class="wide"><span class="muted">${L('scan.lang')}</span>
   <label class="chk"><input type="checkbox" ${all?'checked':''} onchange="store('scanlangs','[]');showScan()"> <b>${L('scan.all_langs')}</b></label>
   ${codes.map(c=>`<label class="chk"><input type="checkbox" ${!all&&sel.includes(c)?'checked':''} onchange="scanLangToggle('${esc(c)}',this.checked)"> ${esc(langName(c))} <span class="muted">(${r.languages[c]})</span></label>`).join('')}</div></div>`}
function scanLangToggle(c,on){let s=scanLangs().filter(x=>x!=c);if(on)s.push(c);store('scanlangs',JSON.stringify(s));showScan()}
function showScan(){const r=SCANR;if(!$('#scanres'))return;
 const sel=scanLangs(),enc=scanEnc();
 const ok=i=>(enc=='all'||(enc=='enc')==i.encrypted)&&(!sel.length||!i.lang||sel.includes(i.lang));
 const g=k=>r.items.filter(i=>i.group==k&&ok(i));
 const neu=g('new'),other=g('other'),unknown=g('unknown'),adult=g('adult');
 $('#scanres').innerHTML=`${scanFilter()}
 <h3>${L('scan.new',{n:neu.length})}</h3>${neu.length?scanTable(neu,'sn',true):`<p class="muted">${L('scan.no_new')}</p>`}
 ${other.length?`<details><summary><b>${L('scan.other',{n:other.length})}</b> <span class="muted">– ${L('scan.other_hint')}</span></summary>${scanTable(other,'so',false)}</details>`:''}
 ${unknown.length?`<details><summary><b>${L('scan.unknown',{n:unknown.length})}</b> <span class="muted">– ${L('scan.unknown_hint')}</span></summary>${scanTable(unknown,'su',false)}</details>`:''}
 ${adult.length?`<details><summary><b>${L('scan.adult',{n:adult.length})}</b></summary>${scanTable(adult,'sx',false)}</details>`:''}
 <div class="bar" style="margin-top:10px"><button class="b" onclick="scanAdd()">${L('scan.add')}</button><span class="muted" id="scanhint"></span></div>
 <h3>${L('scan.dead',{n:r.dead.length})}</h3>
 ${r.dead.length?`<table><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll('.sd').forEach(c=>c.checked=this.checked)"></th><th>${L('scan.nr')}</th><th>${L('common.channel')}</th><th>${L('scan.last_seen')}</th><th>${L('scan.note')}</th></tr></thead><tbody>
 ${r.dead.map(d=>`<tr><td><input type="checkbox" class="sd" value="${d.uuid}" checked></td><td>${d.number||''}</td><td><b>${esc(d.name)}</b>${d.enabled?'':` <span class="tag">${L('common.disabled')}</span>`}</td><td>${d.last_seen?fmt(d.last_seen):L('scan.never_seen')}</td><td>${d.missing?`<span class="tag" title="${L('scan.missing_tip')}">${L('scan.missing')}</span> `:''}${d.noname?`<span class="tag" title="${L('scan.noname_tip')}">${L('scan.noname')}</span> `:''}${d.autorecs.length?`<span class="tag" style="color:var(--bad)">${L('scan.has_autorec',{t:esc(d.autorecs.join(', '))})}</span>`:''}</td></tr>`).join('')}</tbody></table>
 <div class="bar" style="margin-top:10px"><button class="b bad" onclick="scanDelete()">${L('common.delete_sel')}</button></div>`:`<p class="muted">${L('scan.all_found')}</p>`}
 ${r.status.failed.length?`<p class="muted">${L('scan.no_signal',{m:esc(r.status.failed.join(', '))})}</p>`:''}`;
 scanNumbers()}
function scanNumbers(){let n=SCANR.next_number;document.querySelectorAll('.nr[data-u]').forEach(td=>td.textContent='');
 const sel=[...document.querySelectorAll('.sadd:checked')];sel.forEach(c=>{const td=document.querySelector(`.nr[data-u="${c.value}"]`);if(td)td.textContent=L('scan.nr')+' '+(n++)});
 const h=$('#scanhint');if(h)h.textContent=sel.length?L('scan.sel_hint',{n:sel.length,a:SCANR.next_number,b:n-1}):''}
async function scanAdd(){const uuids=[...document.querySelectorAll('.sadd:checked')].map(c=>c.value);if(!uuids.length)return msg(L('common.nothing_selected'));
 if(!confirm(L('scan.add_confirm',{n:uuids.length,a:SCANR.next_number})))return;
 try{const r=await api('/api/scan-add',{uuids});msg(L('scan.added',{n:r.added.length})+(r.added.length?`: ${L('scan.nr')} ${r.added[0].number}–${r.added[r.added.length-1].number}`:''),true);await scanEval()}catch(e){msg(e.message)}}
async function scanDelete(){const uuids=[...document.querySelectorAll('.sd:checked')].map(c=>c.value);if(!uuids.length)return msg(L('common.nothing_selected'));
 const names=SCANR.dead.filter(d=>uuids.includes(d.uuid)),ar=names.filter(d=>d.autorecs.length);
 if(!confirm(L('scan.del_confirm',{n:uuids.length})+`\n\n${names.map(d=>d.name).slice(0,15).join(', ')}${names.length>15?' …':''}`+(ar.length?'\n\n'+L('scan.del_autorec',{n:ar.length}):'')+'\n\n'+L('scan.del_keep')))return;
 try{const r=await api('/api/scan-delete',{uuids});msg(L('scan.deleted',{n:r.deleted.length}),true);await scanEval()}catch(e){msg(e.message)}}
