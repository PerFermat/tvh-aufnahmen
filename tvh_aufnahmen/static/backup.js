// Reiter „Sicherung“: Komplettsicherung des TVHeadend-Ordners und JSON-Export/-Import
let IMP=null;
const SECT={tags:L('bk.s_tags'),channels:L('common.channel'),autorecs:L('bk.s_autorecs'),recordings:L('nav.rec')};
function renderBackup(){
 $('#main').innerHTML=`<div id="autobk"><p class="muted">${L('common.loading')}</p></div>
 <h3>${L('bk.full')}</h3>
 <p class="muted">${L('bk.full_hint')}</p>
 <form class="ed" onsubmit="event.preventDefault();backupDownload(this)">
 <label>${L('bk.password')}<input type="password" name="password" autocomplete="off"></label>
 <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="epg" checked> ${L('bk.with_epg')}</label>
 <div class="wide"><button class="b">${L('bk.download')}</button> <span id="bk" class="muted"></span></div></form>
 <form class="ed" style="margin-top:10px" onsubmit="event.preventDefault();restoreUpload()">
 <label class="wide">${L('bk.restore_file')}<input type="file" id="rs" accept=".gz,.tgz,application/gzip"></label>
 <div class="wide"><button class="b bad">${L('bk.restore')}</button> <span id="rp" class="muted"></span></div></form>
 <h3>${L('bk.json')}</h3>
 <p class="muted">${L('bk.json_hint')}</p>
 <div class="bar"><a class="b" style="text-decoration:none" href="/api/export">${L('bk.export')}</a>
 <label>${L('bk.import_file')} <input type="file" id="imf" accept=".json,application/json" onchange="importPreview()"></label></div>
 <div id="imp"></div>`;
 if(IMP)showImport(IMP.result,IMP.done);renderAutoBackup()}
// Automatische Sicherung: jede Nacht Komplettsicherung + JSON-Export in einen Ordner, die letzten N behalten
async function renderAutoBackup(){let j;try{j=await api('/api/jobs')}catch(e){$('#autobk').innerHTML='';return}
 if(cur!='backup'||!$('#autobk'))return;const b=j.autobackup,st=j.state.backup;
 $('#autobk').innerHTML=`<h3 style="margin-top:0">${L('bk.auto')}</h3>
 <form class="ed" onsubmit="event.preventDefault();saveAutoBackup(this)">
  <label class="chk wide"><input type="checkbox" name="enabled" ${b.enabled?'checked':''}> ${L('bk.auto_enable')}</label>
  <label class="wide">${L('bk.dir')}<input name="dir" value="${esc(b.dir)}"></label>
  <label>${L('bk.time')}<input type="time" name="time" value="${pad(b.hour)}:${pad(b.minute)}" required></label>
  <label>${L('bk.keep')}<input type="number" name="keep" min="1" max="365" value="${b.keep}"></label>
  <div class="wide bar" style="margin:0"><button class="b">${L('common.save')}</button><button type="button" class="b sec" onclick="backupNow(this)">${L('bk.now')}</button>
   <span class="muted">${st?(st.ok?L('bk.last',{t:fmt(st.ts),mb:(st.size/1048576).toFixed(1)}):`<span class="bad-t">${L('bk.last_failed',{t:fmt(st.ts),err:esc(st.error)})}</span>`):L('bk.none_yet')}</span></div></form>
 ${j.backups.length?`<details style="margin-top:8px"><summary class="muted">${L('bk.existing',{n:j.backups.length})}</summary><table class="bars">${j.backups.map(x=>`<tr><td>${esc(x.name)}</td><td class="muted">${fmt(x.mtime)}</td><td style="text-align:right">${(x.size/1048576).toFixed(1)} MB</td></tr>`).join('')}</table>
  <p class="muted small">${L('bk.existing_hint')}</p></details>`:''}
 <h3>${L('st.archive')}</h3>
 <p class="muted">${L('bk.arch_hint',{f:'<code>epg-archiv.sqlite</code>'})}
 ${j.archive_copy?L('bk.arch_last',{t:fmt(j.archive_copy.mtime),mb:(j.archive_copy.size/1048576).toFixed(1)}):L('bk.arch_none')}</p>
 ${j.archive_copy?`<div class="bar" style="margin:0"><button class="b sec" onclick="restoreArchive(this)" title="${L('bk.arch_restore_tip')}">${L('bk.arch_restore')}</button></div>`:''}`}
async function restoreArchive(btn){if(!confirm(L('bk.arch_confirm')))return;
 btn.disabled=true;try{const r=await api('/api/archive-restore',{});msg(r.added?L('bk.arch_added',{n:nfmt(r.added)}):L('bk.arch_complete'),true)}catch(e){msg(e.message)}btn.disabled=false}
async function saveAutoBackup(f){const [h,m]=f.time.value.split(':').map(Number),j=await api('/api/jobs').catch(()=>null);
 try{await api('/api/jobs',{autobackup:{enabled:f.enabled.checked,dir:f.dir.value,hour:h,minute:m,keep:+f.keep.value},notify:j?j.notify:{}});
  msg(L('bk.auto_saved'),true);renderAutoBackup()}catch(e){msg(e.message)}}
async function backupNow(btn){btn.disabled=true;btn.textContent=L('bk.saving');
 try{const r=await api('/api/backup-now',{});msg(L('bk.done',{f:r.file,mb:(r.size/1048576).toFixed(1),amb:((r.archive||0)/1048576).toFixed(1)}),true)}catch(e){msg(e.message)}
 renderAutoBackup()}
async function backupDownload(form){const f=Object.fromEntries(new FormData(form)),st=$('#bk');st.textContent=L('bk.creating');
 try{const r=await fetch('/api/backup',{method:'POST',body:JSON.stringify({password:f.password,epg:!!f.epg})});
  if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||r.status)}
  const name=decodeURIComponent((r.headers.get('Content-Disposition')||'').split("''")[1]||'tvheadend-sicherung.tar.gz');
  const blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),10000);st.textContent='';msg(L('bk.downloaded',{f:name,mb:(blob.size/1048576).toFixed(1)}),true)}
 catch(e){st.textContent='';msg(e.message)}}
function restoreUpload(force){const f=$('#rs').files[0];if(!f)return msg(L('bk.choose_file'));
 if(!force&&!confirm(L('bk.restore_confirm',{f:f.name})))return;
 const pr=$('#rp'),x=new XMLHttpRequest();x.open('POST','/api/restore'+(force?'?force=1':''));
 x.upload.onprogress=e=>{if(e.lengthComputable)pr.textContent=L('bk.uploading',{p:Math.round(e.loaded/e.total*100)})+(e.loaded==e.total?' – '+L('bk.restoring'):'')};
 x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch(e){}pr.textContent='';
  if(x.status!=200)return msg(j.error||L('common.error',{err:x.status}));
  if(j.confirm){if(confirm(j.confirm))restoreUpload(true);return}
  msg(L('bk.restored',{prev:j.previous})+(j.from?' ('+j.from+')':''),true);load()};
 x.onerror=()=>{pr.textContent='';msg(L('bk.upload_aborted'))};x.send(f)}
async function importPreview(){const f=$('#imf').files[0];if(!f)return;$('#imp').innerHTML=`<p class="muted">${L('bk.comparing')}</p>`;
 try{const data=JSON.parse(await f.text());const result=await api('/api/import-preview',{data});IMP={data,result,done:false};showImport(result,false)}
 catch(e){IMP=null;$('#imp').innerHTML='';msg(e.message)}}
const ACTIONABLE=['new','adjust'];
function showImport(result,done){
 $('#imp').innerHTML=Object.keys(SECT).map(k=>{const items=result[k]||[],c={};items.forEach(i=>c[i.action]=(c[i.action]||0)+1);
  const todo=items.filter(i=>i.action!='exists');
  return `<div style="margin:12px 0"><label style="font-weight:600">${done?'':`<input type="checkbox" class="ims" value="${k}" ${items.some(i=>ACTIONABLE.includes(i.action))?'checked':'disabled'}> `}${SECT[k]}</label>
  <span class="muted"> – ${Object.entries(c).map(([a,n])=>n+' '+L('imp.'+a)).join(', ')||L('bk.nothing_in_export')}</span>
  ${todo.length?`<details><summary class="muted">${L('common.details')} (${todo.length})</summary><table>${todo.map(i=>`<tr><td>${esc(i.label)}</td><td><span class="tag">${esc(L('imp.'+i.action))}</span></td><td class="muted f">${esc(i.detail)}</td></tr>`).join('')}</table></details>`:''}</div>`}).join('')
  +(done?'':`<button class="b" onclick="importApply()">${L('bk.apply')}</button>`)}
async function importApply(){const sections=[...document.querySelectorAll('.ims:checked')].map(c=>c.value);if(!sections.length)return msg(L('common.nothing_selected'));
 if(!confirm(L('bk.apply_confirm',{s:sections.map(s=>SECT[s]).join(', ')})))return;
 $('#imp').insertAdjacentHTML('beforeend',`<p class="muted">${L('bk.applying')}</p>`);
 try{const result=await api('/api/import-apply',{data:IMP.data,sections});IMP={result,done:true};showImport(result,true);msg(L('bk.import_done'),true);load()}catch(e){msg(e.message)}}
