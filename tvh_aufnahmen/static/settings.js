// Reiter „Einstellungen“
async function renderConfig(){let c;try{c=await api('/api/config')}catch(e){$('#main').textContent=e.message;return}
 $('#main').innerHTML=`<h3 style="margin-top:0">${L('cfg.ui_lang')}</h3>
 <div class="ed" style="margin-bottom:12px"><label>${L('cfg.ui_lang_label')}<select onchange="setUiLang(this.value)">
  <option value="" ${UILANG?'':'selected'}>${L('cfg.ui_lang_browser')}</option>
  ${(window.LANGS||[]).map(l=>`<option value="${esc(l.code)}" ${UILANG==l.code?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>
  <p class="muted wide" style="margin:0">${L('cfg.ui_lang_hint')}</p></div>
 <h3>${L('cfg.connection')}</h3>
 <form class="ed" onsubmit="event.preventDefault();saveConfig(this)">
 <label class="wide">${L('cfg.recdir')}<input name="recdir" required value="${esc(c.recdir)}" placeholder="/media/HDD/recordings"></label>
 <label class="wide">${L('cfg.server')}<input name="tvh" required value="${esc(c.tvh)}" placeholder="http://localhost:9981"></label>
 <label>${L('cfg.user')}<input name="user" value="${esc(c.user)}" autocomplete="off"></label>
 <label>${L('cfg.password')}<input type="password" name="password" autocomplete="new-password" placeholder="${c.has_password?L('cfg.stored'):''}"></label>
 <label>${L('cfg.epg_lang')}<input name="lang" value="${esc(c.lang)}" placeholder="ger"></label>
 <label class="wide">${L('cfg.tvhconf')}<input name="tvhconf" value="${esc(c.tvhconf)}" placeholder="~/.config/hts"></label>
 ${c.has_password?`<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="clear_password"> ${L('cfg.clear_password')}</label>`:''}
 <div class="wide muted">${L('cfg.stored_in',{f:esc(c.config_file)})}</div>
 <div class="wide"><button class="b">${L('cfg.save')}</button></div></form>
 <div id="qualitycfg"></div>
 <div id="notifycfg"></div>
 <div id="traktcfg"></div>
 <div id="authcfg"></div>`;renderQuality();renderNotify();renderTrakt(c);renderAuth()}
// Anmeldung für den Zugriff von außen: wann nötig, Benutzer anlegen/ändern/löschen
async function renderAuth(a){if(!a)try{a=await api('/api/users')}catch(e){return}if(cur!='config'||!$('#authcfg'))return;
 $('#authcfg').innerHTML=`<h3>${L('auth.title')}</h3>
 <p class="muted">${L('auth.hint')} ${a.me?L('auth.as',{u:esc(a.me)})+` <a href="#" onclick="logout();return false">${L('auth.logout')}</a>`:a.local?L('auth.local')+(a.users.length?` <a href="/static/login.html">${L('login.title')}</a>`:''):''}</p>
 <div class="ed" style="margin-bottom:12px"><label class="wide">${L('auth.mode')}<select onchange="authDo({action:'mode',mode:this.value})">
  ${['external','always','off'].map(m=>`<option value="${m}" ${a.mode==m?'selected':''}>${L('auth.mode_'+m)}</option>`).join('')}</select></label>
  ${a.mode=='off'?`<p class="wide bad-t" style="margin:0">⚠ ${L('auth.off_warn')}</p>`:''}
  ${a.mode!='off'&&!a.users.length?`<p class="wide warn-t" style="margin:0">${L('auth.no_users')}</p>`:''}</div>
 ${a.users.length?`<table><thead><tr><th>${L('cfg.user')}</th><th></th></tr></thead><tbody>${a.users.map(u=>`<tr><td><b>${esc(u)}</b>${u==a.me?` <span class="tag">${L('auth.you')}</span>`:''}</td>
  <td style="white-space:nowrap;text-align:right"><button class="b sec" data-u="${esc(u)}" onclick="authPw(this.dataset.u)">${L('auth.change_pw')}</button>
  <button class="b bad" data-u="${esc(u)}" onclick="authDel(this.dataset.u)">${L('common.delete')}</button></td></tr>`).join('')}</tbody></table>`:''}
 <form class="ed" style="margin-top:10px" onsubmit="event.preventDefault();authDo({action:'set',name:this.name.value,password:this.pw.value},this)">
  <label>${L('auth.new_user')}<input name="name" autocomplete="off" required></label>
  <label>${L('cfg.password')}<input type="password" name="pw" autocomplete="new-password" minlength="8" required></label>
  <div class="wide"><button class="b">${L('auth.add')}</button></div></form>`}
async function authDo(req,form){try{const a=await api('/api/users',req);msg(L('auth.saved'),true);if(form)form.reset();renderAuth(a)}catch(e){msg(e.message);renderAuth()}}
function authPw(u){const pw=prompt(L('auth.pw_prompt',{u}));if(pw)authDo({action:'set',name:u,password:pw})}
function authDel(u){if(confirm(L('auth.del_confirm',{u})))authDo({action:'delete',name:u})}
// Qualität beim Abspielen – gilt nur für dieses Gerät (Handy z. B. „Mobil“, PC „Home“)
async function renderQuality(){const q=await qualities();if(cur!='config'||!$('#qualitycfg'))return;
 if(q.length<2){$('#qualitycfg').innerHTML='';return}
 $('#qualitycfg').innerHTML=`<h3>${L('cfg.player')}</h3>
 <div class="ed" style="margin-bottom:12px">
  <label class="chk wide"><input type="radio" name="player" value="intern" ${playerMode()=='intern'?'checked':''} onchange="store('player','intern');msg(L('cfg.player_int_msg'),true)"> <b>${L('cfg.player_int')}</b>&nbsp;<span class="muted">– ${L('cfg.player_int_hint')}</span></label>
  <label class="chk wide"><input type="radio" name="player" value="extern" ${playerMode()=='extern'?'checked':''} onchange="store('player','extern');msg(L('cfg.player_ext_msg'),true)"> <b>${L('cfg.player_ext')}</b>&nbsp;<span class="muted">– ${L('cfg.player_ext_hint')}</span></label>
  ${canPlayInline()?'':`<p class="muted wide" style="margin:0">⚠ ${L('cfg.no_inline')}</p>`}</div>
 <h3>${L('cfg.quality')}</h3>
 <p class="muted">${L('cfg.quality_hint')}</p>
 <div class="ed">${q.map(x=>`<label class="chk wide"><input type="radio" name="quality" value="${esc(x.profile)}" ${x.profile==quality()?'checked':''} onchange="store('quality',this.value);msg(L('cfg.quality_msg',{q:this.dataset.n}),true)" data-n="${esc(x.name)}"> <b>${esc(x.name)}</b>&nbsp;<span class="muted">– ${esc(x.info)}</span></label>`).join('')}</div>`}
// Benachrichtigungen aufs Handy über ntfy (App „ntfy“, kostenlos, ohne Konto)
async function renderNotify(){let j;try{j=await api('/api/jobs')}catch(e){return}if(cur!='config'||!$('#notifycfg'))return;const n=j.notify;
 $('#notifycfg').innerHTML=`<h3>${L('cfg.notify')}</h3>
 <p class="muted">${L('cfg.notify_hint',{link:'<a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a>',ex:'<code>tvh-'+Math.random().toString(36).slice(2,10)+'</code>'})}</p>
 <form class="ed" onsubmit="event.preventDefault();saveNotify(this)">
  <label class="wide">${L('cfg.ntfy_url')}<input name="url" value="${esc(n.url)}" placeholder="https://ntfy.sh/${L('cfg.ntfy_ph')}"></label>
  <label class="wide">${L('cfg.n_link')}<input name="link" value="${esc(n.link||'')}" placeholder="${esc(location.origin)}"><span class="muted small">${L('cfg.n_link_hint')}</span></label>
  <label class="chk"><input type="checkbox" name="done" ${n.done?'checked':''}> ${L('cfg.n_done')}</label>
  <label class="chk"><input type="checkbox" name="failed" ${n.failed?'checked':''}> ${L('cfg.n_failed')}</label>
  <label class="chk"><input type="checkbox" name="disk" ${n.disk?'checked':''}> ${L('cfg.n_disk')}</label>
  <div class="wide bar" style="margin:0"><button class="b">${L('common.save')}</button><button type="button" class="b sec" onclick="testNotify(this.form)">${L('cfg.n_test')}</button></div></form>`}
async function saveNotify(f){const j=await api('/api/jobs').catch(()=>null);
 try{await api('/api/jobs',{autobackup:j?j.autobackup:{},notify:{url:f.url.value,link:f.link.value,done:f.done.checked,failed:f.failed.checked,disk:f.disk.checked}});msg(L('cfg.n_saved'),true)}catch(e){msg(e.message)}}
async function testNotify(f){if(!f.url.value.trim())return msg(L('cfg.n_need_url'));
 try{const r=await api('/api/notify-test',{url:f.url.value});msg(r.sent?L('cfg.n_sent'):L('cfg.n_not_sent'),r.sent)}catch(e){msg(e.message)}}
// Bilder von Trakt: Filme und Serien, die Wikipedia und TVmaze nicht kennen
function renderTrakt(c){$('#traktcfg').innerHTML=`<h3>${L('cfg.trakt')}</h3>
 <p class="muted">${L('cfg.trakt_hint',{site:'<a href="https://trakt.tv" target="_blank" rel="noopener">trakt.tv</a>',
  apps:'<a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noopener">Applications → New Application</a>',name:'<code>tvh-aufnahmen</code>',uri:'<code>urn:ietf:wg:oauth:2.0:oob</code>'})}</p>
 <form class="ed" onsubmit="event.preventDefault();saveTrakt(this)">
  <label class="wide">Client ID<input name="id" autocomplete="off" spellcheck="false" placeholder="${c.has_trakt?L('cfg.stored'):''}"></label>
  <div class="wide bar" style="margin:0"><button class="b">${L('cfg.check_save')}</button>${c.has_trakt?`<button type="button" class="b sec" onclick="saveTrakt(null)">${L('cfg.remove')}</button>`:''}</div></form>`}
async function saveTrakt(f){if(f&&!f.id.value.trim())return msg(L('cfg.trakt_need'));
 try{const c=await api('/api/trakt',f?{id:f.id.value}:{clear:true});renderTrakt(c);msg(f?L('cfg.trakt_saved'):L('cfg.trakt_removed'),true)}catch(e){msg(e.message)}}
async function saveConfig(form){const f=Object.fromEntries(new FormData(form));f.clear_password=!!f.clear_password;
 try{await api('/api/config',f);msg(L('cfg.saved'),true);await load();if(S)tab('live')}catch(e){msg(e.message)}}
