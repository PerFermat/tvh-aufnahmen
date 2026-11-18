// Gemeinsame Hilfsfunktionen, Laden der Daten und Reiter
let S=null,Q='';
const store=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}};
let cur=store('tab')||'live';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const dtl=t=>{const d=new Date(t*1000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())};
const fmt=t=>t?new Date(t*1000).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}):'–';
const hm=t=>{const d=new Date(t*1000);return pad(d.getHours())+':'+pad(d.getMinutes())};
const gb=b=>(b/1073741824).toFixed(2)+' GB';
let msgTimer=null;
function msg(t,ok){const m=$('#msg');m.textContent=t;m.className=ok?'ok':'err';clearTimeout(msgTimer);msgTimer=setTimeout(()=>m.className='',ok?5000:15000)}
// Darstellung: automatisch (wie das System), hell oder dunkel
const THEMES={auto:['◐','Automatisch'],light:['☀','Hell'],dark:['☾','Dunkel']};
function applyTheme(){const t=store('theme')||'auto',[icon,name]=THEMES[t]||THEMES.auto;
 if(t=='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=t;
 const b=$('#theme');if(b)b.innerHTML=`${icon} <span>${name}</span>`}
function cycleTheme(){const k=Object.keys(THEMES),t=store('theme')||'auto';store('theme',k[(k.indexOf(t)+1)%k.length]);applyTheme()}
async function api(p,body){const r=await fetch(p,body?{method:'POST',body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){try{S=await api('/api/state');}catch(e){S=null;$('#info').textContent='Fehler: '+e.message;tab('config');msg(e.message);return}
 $('#info').textContent=`${S.recdir} · ${S.known_count} Einträge in TVHeadend`;
 $('#t-rec').textContent=`Aufnahmen (${S.recordings.length})`;
 $('#t-unknown').textContent=`Nicht eingetragene Dateien (${S.unknown.length})`;
 $('#t-missing').textContent=`Einträge ohne Datei (${S.missing.length})`;
 $('#chans').innerHTML=S.channels.map(c=>`<option value="${esc(c.name)}">`).join('');$('#curtab').textContent=$('#t-'+cur).textContent;render()}
const TABS={live:()=>renderLive(),epg:()=>renderEpg(),autorec:()=>renderAutorecs(),upcoming:()=>renderUpcoming(),rec:()=>renderRecordings(),unknown:()=>renderUnknown(),missing:()=>renderMissing(),config:()=>renderConfig(),backup:()=>renderBackup(),scan:()=>renderScan(),status:()=>renderStatus()};
function tab(n){if(!TABS[n])n='live';cur=n;store('tab',n);document.querySelectorAll('nav button').forEach(b=>b.className=b.id=='t-'+n?'on':'');
 $('#curtab').textContent=$('#t-'+n).textContent;toggleMenu(false);$('main').classList.toggle('tight',n=='epg');if(n!='epg')$('#hdrslot').innerHTML=HACTS[n]||'';render();toolsState()}
// Knöpfe im Kopf je Reiter (auf dem Handy nur „＋“)
const newRecBtn=`<button class="b hact" onclick="manualRecording()" title="Aufnahme mit festem Sender und festen Zeiten planen">＋<span class="lbl">&nbsp;Neue Aufnahme</span></button>`;
const HACTS={autorec:`<button class="b hact" onclick="editAutorec()" title="Neue Serienaufnahme anlegen">＋<span class="lbl">&nbsp;Neue Serienaufnahme</span></button>`,
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
function render(){if(['live','epg','autorec','upcoming','config','backup','scan','status'].includes(cur))return TABS[cur]();if(!S){$('#main').innerHTML='<p class="muted">Keine Daten – bitte Einstellungen prüfen.</p>';return}
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
 <details style="margin-top:10px"><summary class="muted">Weitere Optionen (${more.length})</summary><div class="ed" style="padding:10px 0 0;background:none">${more.map(p=>idnodeField(p,values[p.id])).join('')}</div></details>`}
function readIdnodeForm(form,schema){const out={},num=p=>NUMTYPES.includes(p.type);
 for(const p of schema.props){const els=[...form.querySelectorAll(`[name="${p.id}"]`)];if(!els.length)continue;
  if(p.type=='bool')out[p.id]=els[0].checked;
  else if(p.list)out[p.id]=els.filter(e=>e.checked).map(e=>num(p)?Number(e.value):e.value);
  else out[p.id]=num(p)?Number(els[0].value||0):els[0].value}
 return out}
function dialog(html){const d=$('#dlg');d.innerHTML=`<button class="b sec x" onclick="$('#dlg').close()">Schließen</button>`+html;if(!d.open)d.showModal();d.scrollTop=0;return d}
const WD=['','Mo','Di','Mi','Do','Fr','Sa','So'];
// Qualität beim Abspielen (je Gerät gemerkt): Home = Original, sonst ein Transcode-Profil von TVHeadend
let QUALS=null;
async function qualities(){return QUALS||(QUALS=(await api('/api/qualities').catch(()=>({qualities:[]}))).qualities)}
const quality=()=>store('quality')||'pass';
const playHref=uuid=>`/api/channel-playlist?uuid=${uuid}`+(quality()!='pass'?'&profile='+encodeURIComponent(quality()):'');

const days=w=>!w||!w.length||w.length==7?'täglich':w.map(d=>WD[d]).join(', ');
