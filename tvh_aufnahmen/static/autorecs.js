// Reiter „Serienaufnahmen“: Regeln von TVHeadend anzeigen, bearbeiten, (de)aktivieren, löschen
async function renderAutorecs(){let d;try{d=await api('/api/autorecs')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='autorec')return;const win=a=>a.start=='Any'&&a.start_window=='Any'?'jederzeit':(a.start=='Any'?'':'ab '+a.start)+(a.start_window=='Any'?'':' bis '+a.start_window);
 $('#main').innerHTML=`<div class="bar"><button class="b" onclick="editAutorec()">Neue Serienaufnahme</button><span class="muted">${d.autorecs.length} Serienaufnahmen</span></div>
 ${d.autorecs.length?`<table><thead><tr><th>Name / Titel</th><th>Sender</th><th>Wann</th><th>Geplant</th><th></th></tr></thead><tbody>${d.autorecs.map(a=>`<tr${a.enabled?'':' class="muted"'}>
 <td><b>${esc(a.name||a.title)}</b>${a.title&&a.title!=a.name?`<br><span class="muted">Titel: ${esc(a.title)}${a.fulltext?' (Volltext)':''}</span>`:''}${a.enabled?'':'<br><span class="tag">deaktiviert</span>'}</td>
 <td>${esc(a.channelname||'alle Sender')}${a.tagname?'<br><span class="muted">Tag: '+esc(a.tagname)+'</span>':''}</td>
 <td>${days(a.weekdays)}<br><span class="muted">${esc(win(a))}</span></td><td>${a.planned}</td>
 <td style="white-space:nowrap"><button class="b sec" onclick="editAutorec('${a.uuid}')">Bearbeiten</button>
 <button class="b sec" onclick="toggleAutorec('${a.uuid}',${!a.enabled})">${a.enabled?'Deaktivieren':'Aktivieren'}</button>
 <button class="b bad" onclick="deleteAutorec('${a.uuid}',this.dataset.n)" data-n="${esc(a.name||a.title)}">Löschen</button></td></tr>`).join('')}</tbody></table>`:'<p class="muted">Keine Serienaufnahmen.</p>'}`}
async function editAutorec(uuid){const schema=await formSchema('dvrautorec');let v={};
 if(uuid)try{v=await api('/api/autorec?uuid='+uuid)}catch(e){return msg(e.message)}
 dialog(`<h2 style="margin:0 40px 12px 0">${uuid?'Serienaufnahme bearbeiten':'Neue Serienaufnahme'}</h2>
 <form onsubmit="event.preventDefault();saveAutorec(this,'${uuid||''}')">${idnodeForm(schema,v)}
 <div class="bar" style="margin-top:12px"><button class="b">Speichern</button></div></form>`)}
async function saveAutorec(form,uuid){const schema=await formSchema('dvrautorec'),conf=readIdnodeForm(form,schema);if(uuid)conf.uuid=uuid;
 try{await api('/api/autorec-save',conf);$('#dlg').close();msg('Serienaufnahme gespeichert: '+(conf.name||conf.title),true);renderAutorecs()}catch(e){msg(e.message)}}
async function toggleAutorec(uuid,on){try{await api('/api/autorec-save',{uuid,enabled:on});renderAutorecs()}catch(e){msg(e.message)}}
async function deleteAutorec(uuid,name){if(!confirm(`Serienaufnahme „${name}“ löschen?\nBereits aufgenommene Sendungen bleiben erhalten.`))return;
 try{await api('/api/autorec-delete',{uuid});msg('Serienaufnahme gelöscht: '+name,true);renderAutorecs()}catch(e){msg(e.message)}}
