// Gemeinsame Hilfsfunktionen, Laden der Daten und Reiter
let S=null,Q='';
// Sprache: T (gewählte Sprache) und TDE (Deutsch als Rückfall) liefert /lang.js vor allen Skripten.
// L('schluessel',{n:3}) setzt Platzhalter {n} ein. Gewählt wird je Gerät über das Cookie „lang“.
const L=(k,v)=>{let s=(window.T||{})[k]??(window.TDE||{})[k]??k;return v?s.replace(/\{(\w+)\}/g,(m,n)=>v[n]??m):s};
const LOCALE=(window.T||{})._locale||'de-DE',UILANG=(document.cookie.match(/(?:^|;\s*)lang=([\w-]+)/)||[])[1]||'';
document.documentElement.lang=LOCALE.split('-')[0];
// feste Texte in index.html: data-i18n (Inhalt), data-i18n-title (Tooltip und aria-label)
function applyI18n(){document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=L(e.dataset.i18n));
 document.querySelectorAll('[data-i18n-title]').forEach(e=>{e.title=L(e.dataset.i18nTitle);e.setAttribute('aria-label',e.title)});document.title=L('app.title');
 document.documentElement.style.setProperty('--nowtag',JSON.stringify(L('epg.now_tag')))}  // Etikett der laufenden Sendung (CSS)
// Sprache wählen (leer = wie der Browser); der Server merkt sie sich für Benachrichtigungen
function setUiLang(code){document.cookie=`lang=${code};path=/;max-age=${code?31536000:0};samesite=lax`;
 (code?api('/api/ui-lang',{lang:code}).catch(()=>{}):Promise.resolve()).finally(()=>location.reload())}
const nfmt=n=>Number(n).toLocaleString(LOCALE);  // Zahl mit Tausenderpunkt je Sprache
const store=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}};
let cur=store('tab')||'live';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const dtl=t=>{const d=new Date(t*1000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())};
const fmt=t=>t?new Date(t*1000).toLocaleString(LOCALE,{dateStyle:'medium',timeStyle:'short'}):'–';
const hm=t=>{const d=new Date(t*1000);return pad(d.getHours())+':'+pad(d.getMinutes())};
const gb=b=>(b/1073741824).toFixed(2)+' GB';
let msgTimer=null;
function msg(t,ok){const m=$('#msg');m.textContent=t;m.className=ok?'ok':'err';clearTimeout(msgTimer);msgTimer=setTimeout(()=>m.className='',ok?5000:15000)}
// Darstellung: automatisch (wie das System), hell oder dunkel
const THEMES={auto:['◐',L('theme.auto')],light:['☀',L('theme.light')],dark:['☾',L('theme.dark')]};
function applyTheme(){const t=store('theme')||'auto',[icon,name]=THEMES[t]||THEMES.auto;
 if(t=='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=t;
 const b=$('#theme');if(b)b.innerHTML=`${icon} <span>${name}</span>`}
// Vollbild für die ganze Seite (auf dem iPhone gibt es das nicht – dort bleibt der Knopf weg)
const FSICON={on:'<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',off:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'};
const fsEl=()=>document.fullscreenElement||document.webkitFullscreenElement;
function fsState(){const b=$('#fsbtn');if(!b)return;const on=!!fsEl();b.hidden=!(document.fullscreenEnabled||document.webkitFullscreenEnabled);
 b.title=on?L('fs.leave'):L('fs.enter');b.setAttribute('aria-label',b.title);b.classList.toggle('on',on);
 b.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${on?FSICON.on:FSICON.off}</svg>`}
function toggleFullscreen(){const d=document,e=d.documentElement;
 const r=fsEl()?(d.exitFullscreen||d.webkitExitFullscreen).call(d):(e.requestFullscreen||e.webkitRequestFullscreen).call(e);
 if(r&&r.catch)r.catch(err=>msg(L('fs.failed',{err:err.message})))}
document.addEventListener('fullscreenchange',fsState);document.addEventListener('webkitfullscreenchange',fsState);
document.addEventListener('DOMContentLoaded',fsState);
function cycleTheme(){const k=Object.keys(THEMES),t=store('theme')||'auto';store('theme',k[(k.indexOf(t)+1)%k.length]);applyTheme()}
async function api(p,body){const r=await fetch(p,body?{method:'POST',body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){try{S=await api('/api/state');}catch(e){S=null;$('#info').textContent=L('common.error',{err:e.message});tab('config');msg(e.message);return}
 $('#info').textContent=L('nav.info',{dir:S.recdir,n:S.known_count});
 $('#t-rec').textContent=L('nav.rec_n',{n:S.recordings.length});
 $('#t-unknown').textContent=L('nav.unknown_n',{n:S.unknown.length});
 $('#t-missing').textContent=L('nav.missing_n',{n:S.missing.length});
 $('#chans').innerHTML=S.channels.map(c=>`<option value="${esc(c.name)}">`).join('');$('#curtab').textContent=$('#t-'+cur).textContent;render()}
const TABS={live:()=>renderLive(),epg:()=>renderEpg(),autorec:()=>renderAutorecs(),upcoming:()=>renderUpcoming(),rec:()=>renderRecordings(),unknown:()=>renderUnknown(),missing:()=>renderMissing(),config:()=>renderConfig(),backup:()=>renderBackup(),scan:()=>renderScan(),status:()=>renderStatus()};
function tab(n){if(!TABS[n])n='live';cur=n;store('tab',n);document.querySelectorAll('nav button').forEach(b=>b.className=b.id=='t-'+n?'on':'');
 $('#curtab').textContent=$('#t-'+n).textContent;toggleMenu(false);$('main').classList.toggle('tight',n=='epg');if(n!='epg')$('#hdrslot').innerHTML=HACTS[n]||'';render();toolsState()}
// Knöpfe im Kopf je Reiter (auf dem Handy nur „＋“)
const newRecBtn=`<button class="b hact" onclick="manualRecording()" title="${L('hdr.new_rec_tip')}">＋<span class="lbl">&nbsp;${L('hdr.new_rec')}</span></button>`;
const HACTS={autorec:`<button class="b hact" onclick="editAutorec()" title="${L('hdr.new_autorec_tip')}">＋<span class="lbl">&nbsp;${L('hdr.new_autorec')}</span></button>`,
 rec:newRecBtn,upcoming:newRecBtn};
// Suche und Filter (Elemente mit class="tools") über 🔍 im Kopf ein-/ausblenden; gilt für alle Reiter und wird gemerkt
const TOOLTABS=['live','epg','rec','upcoming'];
const activeQuery=()=>({live:()=>LQ,epg:()=>EPGQ||EPGT,rec:()=>Q,upcoming:()=>UPQ}[cur]||(()=>''))();
function toolsState(){const open=store('tools')=='open',b=$('#toolsbtn');document.body.classList.toggle('tools-closed',!open);
 if(!b)return;b.hidden=!TOOLTABS.includes(cur);b.classList.toggle('on',open);b.classList.toggle('dot',!open&&!!activeQuery())}
function toggleTools(){store('tools',store('tools')=='open'?'closed':'open');toolsState();
 if(store('tools')=='open'){const i=document.querySelector('main .tools input[type=search],main input.tools[type=search]');if(i)i.focus()}
 if(cur=='epg'&&typeof sizeEpg=='function')sizeEpg()}
// Handy: Reiter als Klappmenü hinter dem ☰-Knopf
function toggleMenu(open){const t=$('#top'),o=open??!t.classList.contains('open');t.classList.toggle('open',o);
 document.body.classList.toggle('menu-open',o);$('.menu').setAttribute('aria-expanded',o)}
addEventListener('keydown',e=>{if(e.key=='Escape')toggleMenu(false)})
function render(){if(['live','epg','autorec','upcoming','config','backup','scan','status'].includes(cur))return TABS[cur]();if(!S){$('#main').innerHTML=`<p class="muted">${L('common.no_data')}</p>`;return}
 TABS[cur]()}
// Formulare aus der Klassenbeschreibung von TVHeadend (/api/form) – zeigt alle Optionen einer Klasse
const FORMS={};
async function formSchema(cls){return FORMS[cls]||(FORMS[cls]=await api('/api/form?class='+cls))}
const NUMTYPES=['int','u32','u16','s64','s32','dbl','time'];
function idnodeField(p,v){if(v===undefined||v===null)v=p.default;const t=p.description?` title="${esc(p.description)}"`:'',n=`name="${p.id}"`;
 if(p.type=='bool')return `<label class="chk"${t}><input type="checkbox" ${n} ${v?'checked':''}> ${esc(p.caption)}</label>`;
 if(p.list&&p.enum)return `<fieldset class="wide"${t}><legend>${esc(p.caption)}</legend>${p.enum.map(o=>`<label class="chk"><input type="checkbox" ${n} value="${esc(o.key)}" ${(v||[]).map(String).includes(String(o.key))?'checked':''}> ${esc(o.val)}</label>`).join('')}</fieldset>`;
 if(p.enum)return `<label${t}>${esc(p.caption)}<select ${n}>${p.enum.some(o=>String(o.key)==String(v??''))?'':`<option value="${esc(v??'')}">${esc(v??'')}</option>`}${p.enum.map(o=>`<option value="${esc(o.key)}" ${String(o.key)==String(v??'')?'selected':''}>${esc(o.val===''?'–':o.val)}</option>`).join('')}</select></label>`;
 if(NUMTYPES.includes(p.type))return `<label${t}>${esc(p.caption)}<input type="number" ${n} value="${esc(v??'')}"></label>`;
 return `<label${t}>${esc(p.caption)}<input ${n} value="${esc(v??'')}"></label>`}
function idnodeForm(schema,values){const main=schema.props.filter(p=>!p.advanced&&!p.expert&&!p.hidden),more=schema.props.filter(p=>!main.includes(p));
 return `<div class="ed" style="padding:0;background:none">${main.map(p=>idnodeField(p,values[p.id])).join('')}</div>
 <details style="margin-top:10px"><summary class="muted">${L('form.more',{n:more.length})}</summary><div class="ed" style="padding:10px 0 0;background:none">${more.map(p=>idnodeField(p,values[p.id])).join('')}</div></details>`}
function readIdnodeForm(form,schema){const out={},num=p=>NUMTYPES.includes(p.type);
 for(const p of schema.props){const els=[...form.querySelectorAll(`[name="${p.id}"]`)];if(!els.length)continue;
  if(p.type=='bool')out[p.id]=els[0].checked;
  else if(p.list)out[p.id]=els.filter(e=>e.checked).map(e=>num(p)?Number(e.value):e.value);
  else out[p.id]=num(p)?Number(els[0].value||0):els[0].value}
 return out}
function dialog(html){const d=$('#dlg');d.innerHTML=`<button class="b sec x" onclick="$('#dlg').close()">${L('common.close')}</button>`+html;if(!d.open)d.showModal();d.scrollTop=0;return d}
// Wochentage 1–7 = Montag–Sonntag, kurz, in der Sprache der Oberfläche (5.1.1970 war ein Montag)
const WD=['',...[0,1,2,3,4,5,6].map(i=>new Date(1970,0,5+i).toLocaleDateString(LOCALE,{weekday:'short'}))];
// Qualität beim Abspielen (je Gerät gemerkt): Home = Original, sonst ein Transcode-Profil von TVHeadend
let QUALS=null;
async function qualities(){return QUALS||(QUALS=(await api('/api/qualities').catch(()=>({qualities:[]}))).qualities)}
const quality=()=>store('quality')||'pass';
const playHref=uuid=>`/api/channel-playlist?uuid=${uuid}`+(quality()!='pass'?'&profile='+encodeURIComponent(quality()):'');

const days=w=>!w||!w.length||w.length==7?L('common.daily'):w.map(d=>WD[d]).join(', ');
