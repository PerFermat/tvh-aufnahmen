// Reiter „Einträge ohne Datei“: Pfad reparieren, Einträge löschen
function renderMissing(){
 if(!S.missing.length){$('#main').innerHTML=`<p class="muted">${L('miss.none')}</p>`;return}
 const rep=S.missing.filter(m=>m.candidate).length;
 let h=`<div class="bar">${rep?`<button class="b" onclick="repairAll()">${L('miss.repair_n',{n:rep})}</button>`:''}
 <button class="b bad" onclick="del()">${L('miss.delete_sel')}</button>
 <label><input type="checkbox" onchange="document.querySelectorAll('.cm').forEach(c=>c.checked=this.checked)"> ${L('common.select_all')}</label></div>
 <p class="muted">${L('miss.hint')}</p>
 <table><tr><th></th><th>${L('common.title')}</th><th>${L('common.channel_date')}</th><th>${L('miss.th_file')}</th><th></th></tr>`;
 S.missing.forEach((m,i)=>{h+=`<tr><td><input type="checkbox" class="cm" data-i="${i}"></td>
 <td>${esc(m.title)}${m.subtitle?'<br><span class="muted">'+esc(m.subtitle)+'</span>':''}<br><span class="tag">${esc(m.status)}</span></td>
 <td>${esc(m.channel)}<br><span class="muted">${fmt(m.start)}</span></td>
 <td class="f">${m.filename?esc(m.filename):`<span class="muted">${L('miss.no_file')}</span>`}${m.candidate?'<br>→ '+L('miss.found',{f:esc(m.candidate)}):''}</td>
 <td>${m.candidate?`<button class="b" onclick="repair([${i}])">${L('miss.repair')}</button>`:''}</td></tr>`});
 $('#main').innerHTML=h+'</table>'}
async function repair(idx){const moves=idx.map(i=>({src:S.missing[i].filename,dst:S.missing[i].candidate}));
 try{const r=await api('/api/move',{moves});msg(L('miss.repaired',{n:r.moved})+(r.skipped?', '+L('common.skipped',{n:r.skipped}):''),true);await load()}catch(e){msg(e.message)}}
function repairAll(){repair(S.missing.map((m,i)=>m.candidate?i:-1).filter(i=>i>=0))}
async function del(){const uuids=[...document.querySelectorAll('.cm:checked')].map(c=>S.missing[c.dataset.i].uuid);
 if(!uuids.length)return msg(L('common.nothing_selected'));
 if(!confirm(L('miss.confirm_delete',{n:uuids.length})))return;
 try{const r=await api('/api/delete',{uuids});msg(L('common.deleted_n',{n:r.deleted})+(r.skipped?', '+L('miss.skipped_exists',{n:r.skipped}):''),true);await load()}catch(e){msg(e.message)}}
