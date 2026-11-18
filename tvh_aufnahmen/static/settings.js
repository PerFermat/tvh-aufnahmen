// Reiter „Einstellungen“
async function renderConfig(){let c;try{c=await api('/api/config')}catch(e){$('#main').textContent=e.message;return}
 $('#main').innerHTML=`<form class="ed" onsubmit="event.preventDefault();saveConfig(this)">
 <label class="wide">Aufnahmeverzeichnis (auf dem OSMC)<input name="recdir" required value="${esc(c.recdir)}" placeholder="/media/HDD/recordings"></label>
 <label class="wide">TVHeadend-Server<input name="tvh" required value="${esc(c.tvh)}" placeholder="http://localhost:9981"></label>
 <label>Benutzer<input name="user" value="${esc(c.user)}" autocomplete="off"></label>
 <label>Passwort<input type="password" name="password" autocomplete="new-password" placeholder="${c.has_password?'gespeichert – leer lassen = unverändert':''}"></label>
 <label>Sprachcode<input name="lang" value="${esc(c.lang)}" placeholder="ger"></label>
 <label class="wide">TVHeadend-Konfigurationsordner (für die Komplettsicherung)<input name="tvhconf" value="${esc(c.tvhconf)}" placeholder="/home/hts/.config/hts"></label>
 ${c.has_password?'<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="clear_password"> Passwort entfernen</label>':''}
 <div class="wide muted">Gespeichert in ${esc(c.config_file)}</div>
 <div class="wide"><button class="b">Verbindung prüfen und speichern</button></div></form>
 <div id="notifycfg"></div>`;renderNotify()}
// Benachrichtigungen aufs Handy über ntfy (App „ntfy“, kostenlos, ohne Konto)
async function renderNotify(){let j;try{j=await api('/api/jobs')}catch(e){return}if(cur!='config'||!$('#notifycfg'))return;const n=j.notify;
 $('#notifycfg').innerHTML=`<h3>Benachrichtigungen aufs Handy</h3>
 <p class="muted">Über <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a>: App „ntfy“ installieren, ein Thema mit einem schwer zu erratenden Namen abonnieren (z. B. <code>tvh-${Math.random().toString(36).slice(2,10)}</code>) und hier die vollständige Adresse eintragen. Jeder, der den Namen kennt, kann mitlesen.</p>
 <form class="ed" onsubmit="event.preventDefault();saveNotify(this)">
  <label class="wide">ntfy-Adresse<input name="url" value="${esc(n.url)}" placeholder="https://ntfy.sh/mein-geheimes-thema"></label>
  <label class="chk"><input type="checkbox" name="done" ${n.done?'checked':''}> Aufnahme fertig</label>
  <label class="chk"><input type="checkbox" name="failed" ${n.failed?'checked':''}> Aufnahme fehlgeschlagen</label>
  <label class="chk"><input type="checkbox" name="disk" ${n.disk?'checked':''}> Speicher fast voll (unter 10 % frei)</label>
  <div class="wide bar" style="margin:0"><button class="b">Speichern</button><button type="button" class="b sec" onclick="testNotify(this.form)">Testnachricht senden</button></div></form>`}
async function saveNotify(f){const j=await api('/api/jobs').catch(()=>null);
 try{await api('/api/jobs',{autobackup:j?j.autobackup:{},notify:{url:f.url.value,done:f.done.checked,failed:f.failed.checked,disk:f.disk.checked}});msg('Benachrichtigungen gespeichert',true)}catch(e){msg(e.message)}}
async function testNotify(f){if(!f.url.value.trim())return msg('Bitte zuerst die ntfy-Adresse eintragen');
 try{const r=await api('/api/notify-test',{url:f.url.value});msg(r.sent?'Testnachricht gesendet – sie sollte gleich auf dem Handy erscheinen':'Nicht gesendet',r.sent)}catch(e){msg(e.message)}}
async function saveConfig(form){const f=Object.fromEntries(new FormData(form));f.clear_password=!!f.clear_password;
 try{await api('/api/config',f);msg('Einstellungen gespeichert',true);await load();if(S)tab('live')}catch(e){msg(e.message)}}
