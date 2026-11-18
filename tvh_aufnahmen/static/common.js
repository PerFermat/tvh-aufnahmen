// Gemeinsame Hilfsfunktionen, Laden der Daten und Reiter
let S=null,cur=0,Q='';
const store=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const dtl=t=>{const d=new Date(t*1000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())};
const fmt=t=>t?new Date(t*1000).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}):'–';
const gb=b=>(b/1073741824).toFixed(2)+' GB';
function msg(t,ok){const m=$('#msg');m.textContent=t;m.className=ok?'ok':'err';if(ok)setTimeout(()=>m.className='',5000)}
async function api(p,body){const r=await fetch(p,body?{method:'POST',body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){try{S=await api('/api/state');}catch(e){S=null;$('#info').textContent='Fehler: '+e.message;tab(3);msg(e.message);return}
 $('#info').textContent=`${S.recdir} · ${S.known_count} Einträge in TVHeadend`;
 $('#t0').textContent=`Aufnahmen (${S.recordings.length})`;
 $('#t1').textContent=`Nicht eingetragene Dateien (${S.unknown.length})`;
 $('#t2').textContent=`Einträge ohne Datei (${S.missing.length})`;
 $('#chans').innerHTML=S.channels.map(c=>`<option value="${esc(c.name)}">`).join('');render()}
function tab(n){cur=n;[0,1,2,3].forEach(k=>$('#t'+k).className=n==k?'on':'');render()}
function render(){if(cur==3)return renderConfig();if(!S){$('#main').innerHTML='<p class="muted">Keine Daten – bitte Einstellungen prüfen.</p>';return}
 [renderRecordings,renderUnknown,renderMissing][cur]()}
