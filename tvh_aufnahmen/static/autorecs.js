// Reiter „Serienaufnahmen“: Regeln von TVHeadend anzeigen, bearbeiten, (de)aktivieren, löschen
async function renderAutorecs(){let d;try{d=await api('/api/autorecs')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='autorec')return;const win=a=>a.start=='Any'&&a.start_window=='Any'?L('ar.anytime'):(a.start=='Any'?'':L('ar.from',{t:a.start}))+(a.start_window=='Any'?'':' '+L('ar.until',{t:a.start_window}));
 $('#main').innerHTML=`<p class="muted" style="margin-top:0">${L('ar.count',{n:d.autorecs.length})}</p>
 ${d.autorecs.length?`<table><thead><tr><th>${L('ar.th_name')}</th><th>${L('common.channel')}</th><th>${L('ar.th_when')}</th><th>${L('ar.th_planned')}</th><th></th></tr></thead><tbody>${d.autorecs.map(a=>`<tr${a.enabled?'':' class="muted"'}>
 <td><b>${esc(a.name||a.title)}</b>${a.title&&a.title!=a.name?`<br><span class="muted">${L('ar.title',{t:esc(a.title)})}${a.fulltext?' '+L('ar.fulltext'):''}</span>`:''}${a.enabled?'':`<br><span class="tag">${L('common.disabled')}</span>`}</td>
 <td>${esc(a.channelname||L('ar.all_channels'))}${a.tagname?'<br><span class="muted">'+L('ar.tag',{t:esc(a.tagname)})+'</span>':''}</td>
 <td>${days(a.weekdays)}<br><span class="muted">${esc(win(a))}</span></td><td>${a.planned}</td>
 <td style="white-space:nowrap"><button class="b sec" onclick="editAutorec('${a.uuid}')">${L('common.edit')}</button>
 <button class="b sec" onclick="toggleAutorec('${a.uuid}',${!a.enabled})">${a.enabled?L('ar.disable'):L('ar.enable')}</button>
 <button class="b bad" onclick="deleteAutorec('${a.uuid}',this.dataset.n)" data-n="${esc(a.name||a.title)}">${L('common.delete')}</button></td></tr>`).join('')}</tbody></table>`:`<p class="muted">${L('ar.none')}</p>`}`}
async function editAutorec(uuid){const schema=await formSchema('dvrautorec');let v={};
 if(uuid)try{v=await api('/api/autorec?uuid='+uuid)}catch(e){return msg(e.message)}
 dialog(`<h2 style="margin:0 40px 12px 0">${uuid?L('ar.edit_title'):L('hdr.new_autorec')}</h2>
 <form onsubmit="event.preventDefault();saveAutorec(this,'${uuid||''}')">${idnodeForm(schema,v)}
 <div class="bar" style="margin-top:12px"><button class="b">${L('common.save')}</button>${previewBtn}</div><div class="arprev"></div></form>`)}
// Vorschau: welche Sendungen die Regel (so wie gerade ausgefüllt) treffen würde
const previewBtn=`<button type="button" class="b sec" onclick="autorecPreview(this.form)">👁 ${L('ar.preview')}</button>`;
async function autorecPreview(form){const box=form.querySelector('.arprev'),schema=await formSchema('dvrautorec');
 box.innerHTML=`<p class="muted">${L('common.loading')}</p>`;
 let r;try{r=await api('/api/autorec-preview',readIdnodeForm(form,schema))}catch(e){box.innerHTML=`<p class="alert">${esc(e.message)}</p>`;return}
 const off=form.querySelector('[name=enabled]');
 box.innerHTML=`<h3>${L('ar.preview_n',{n:r.count})}</h3>${off&&!off.checked?`<p class="alert">${L('ar.preview_off')}</p>`:''}${r.count>50?`<p class="alert">⚠ ${L('ar.preview_many',{n:r.count})}</p>`:''}
 ${r.hits.length?`<table><tbody>${r.hits.map(h=>`<tr><td style="white-space:nowrap">${esc(wday(h.start))} ${hm(h.start)}</td><td>${esc(h.channelName)}</td>
  <td><b>${esc(h.title)}</b>${h.subtitle?`<br><span class="muted">${esc(h.subtitle)}</span>`:''}</td><td>${h.planned?`<span class="tag ok">${L('ar.preview_planned')}</span>`:h.recorded?`<span class="tag idle">${L('ar.preview_recorded')}</span>`:''}</td></tr>`).join('')}</tbody></table>${r.count>r.hits.length?`<p class="muted">${L('ar.preview_more',{n:r.count-r.hits.length})}</p>`:''}`
  :`<p class="muted">${L('ar.preview_none')}</p>`}`;box.scrollIntoView({block:'nearest',behavior:'smooth'})}
async function saveAutorec(form,uuid){const schema=await formSchema('dvrautorec'),conf=readIdnodeForm(form,schema);if(uuid)conf.uuid=uuid;
 try{await api('/api/autorec-save',conf);$('#dlg').close();msg(L('ar.saved',{name:conf.name||conf.title}),true);renderAutorecs()}catch(e){msg(e.message)}}
async function toggleAutorec(uuid,on){try{await api('/api/autorec-save',{uuid,enabled:on});renderAutorecs()}catch(e){msg(e.message)}}
async function deleteAutorec(uuid,name){if(!confirm(L('ar.confirm_delete',{name})))return;
 try{await api('/api/autorec-delete',{uuid});msg(L('ar.deleted',{name}),true);renderAutorecs()}catch(e){msg(e.message)}}
