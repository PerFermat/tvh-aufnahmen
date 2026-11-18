// Reiter „Einstellungen“
async function renderConfig(){let c;try{c=await api('/api/config')}catch(e){$('#main').textContent=e.message;return}
 $('#main').innerHTML=`<form class="ed" onsubmit="event.preventDefault();saveConfig(this)">
 <label class="wide">Aufnahmeverzeichnis (auf dem OSMC)<input name="recdir" required value="${esc(c.recdir)}" placeholder="/media/HDD/recordings"></label>
 <label class="wide">TVHeadend-Server<input name="tvh" required value="${esc(c.tvh)}" placeholder="http://localhost:9981"></label>
 <label>Benutzer<input name="user" value="${esc(c.user)}" autocomplete="off"></label>
 <label>Passwort<input type="password" name="password" autocomplete="new-password" placeholder="${c.has_password?'gespeichert – leer lassen = unverändert':''}"></label>
 <label>Sprachcode<input name="lang" value="${esc(c.lang)}" placeholder="ger"></label>
 ${c.has_password?'<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="clear_password"> Passwort entfernen</label>':''}
 <div class="wide muted">Gespeichert in ${esc(c.config_file)}</div>
 <div class="wide"><button class="b">Verbindung prüfen und speichern</button></div></form>`}
async function saveConfig(form){const f=Object.fromEntries(new FormData(form));f.clear_password=!!f.clear_password;
 try{await api('/api/config',f);msg('Einstellungen gespeichert',true);await load();if(S)tab(0)}catch(e){msg(e.message)}}
