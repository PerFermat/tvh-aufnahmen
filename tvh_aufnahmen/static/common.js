// Gemeinsame Hilfsfunktionen, Laden der Daten und Reiter
let S=null,Q='';
const store=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}};
let cur=store('tab')||'live';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const dtl=t=>{const d=new Date(t*1000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())};
const fmt=t=>t?new Date(t*1000).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}):'–';
const gb=b=>(b/1073741824).toFixed(2)+' GB';
function msg(t,ok){const m=$('#msg');m.textContent=t;m.className=ok?'ok':'err';if(ok)setTimeout(()=>m.className='',5000)}
async function api(p,body){const r=await fetch(p,body?{method:'POST',body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){try{S=await api('/api/state');}catch(e){S=null;$('#info').textContent='Fehler: '+e.message;tab('config');msg(e.message);return}
 $('#info').textContent=`${S.recdir} · ${S.known_count} Einträge in TVHeadend`;
 $('#t-rec').textContent=`Aufnahmen (${S.recordings.length})`;
 $('#t-unknown').textContent=`Nicht eingetragene Dateien (${S.unknown.length})`;
 $('#t-missing').textContent=`Einträge ohne Datei (${S.missing.length})`;
 $('#chans').innerHTML=S.channels.map(c=>`<option value="${esc(c.name)}">`).join('');render()}
const TABS={live:()=>renderLive(),rec:()=>renderRecordings(),unknown:()=>renderUnknown(),missing:()=>renderMissing(),config:()=>renderConfig(),backup:()=>renderBackup()};
function tab(n){if(!TABS[n])n='live';cur=n;store('tab',n);document.querySelectorAll('nav button').forEach(b=>b.className=b.id=='t-'+n?'on':'');render()}
function render(){if(['live','config','backup'].includes(cur))return TABS[cur]();if(!S){$('#main').innerHTML='<p class="muted">Keine Daten – bitte Einstellungen prüfen.</p>';return}
 TABS[cur]()}
