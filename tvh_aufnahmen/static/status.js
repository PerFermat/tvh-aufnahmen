// Reiter „Status“: Tuner und Signal, laufende Aufnahmen und Streams, Rechner und Speicher (alle 5 s neu)
let statusTimer=null;
const dur=s=>{s=Math.floor(s);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+' '+L('st.days')+' ':'')+(d||h?h+' h ':'')+m+' min'};
const meter=(pct,lvl)=>`<div class="meter ${lvl||''}"><div style="width:${Math.max(0,Math.min(100,pct)).toFixed(0)}%"></div></div>`;
// Signal: relative Angaben direkt in %, SNR in dB auf eine grobe Skala (DVB-S2 gut ab ~10 dB)
const sigPct=x=>!x?0:x.pct!=null?x.pct:Math.max(0,Math.min(100,(x.db+75)/50*100));
const snrPct=x=>!x?0:x.pct!=null?x.pct:Math.max(0,Math.min(100,x.db/15*100));
async function renderStatus(){let s;try{s=await api('/api/status')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='status')return;const y=scrollY,sy=s.system,temp=sy.temp,tl=temp>=75?'bad':temp>=65?'warn':'';
 const memPct=sy.mem_total?(1-sy.mem_avail/sy.mem_total)*100:0,d=s.disk,dp=d.used/d.total*100;
 $('#main').innerHTML=`<div class="cards">
 ${s.tuners.map((t,i)=>`<div class="card"><div class="card-h"><b>${L('st.tuner',{n:i+1})}</b><span class="tag ${t.subs?'':'idle'}">${t.subs?L('st.busy'):L('st.free')}</span></div>
  <div class="muted small">${esc(t.name)}</div>${t.stream?`<div class="small">${esc(t.stream)}</div>`:''}
  ${t.subs?`<div class="kv"><span>${L('st.signal')}</span><b>${t.signal?esc(t.signal.text):'–'}</b></div>${meter(sigPct(t.signal))}
  <div class="kv"><span>SNR</span><b>${t.snr?esc(t.snr.text):'–'}</b></div>${meter(snrPct(t.snr),snrPct(t.snr)<45?'bad':snrPct(t.snr)<65?'warn':'')}
  <div class="kv"><span>${L('st.rate')}</span><b>${t.kbps?(t.kbps/1000).toFixed(1)+' Mbit/s':'–'}</b></div>
  <div class="kv"><span>${L('st.errors')}</span><b class="${t.unc||t.cc?'bad-t':''}">${t.ber} / ${t.unc} / ${t.cc}</b></div>`:`<p class="muted small">${L('st.idle')}</p>`}</div>`).join('')}
 <div class="card"><div class="card-h"><b>${esc(sy.model||sy.host||L('st.computer'))}</b>${sy.model&&sy.host?`<span class="muted small">${esc(sy.host)}</span>`:''}</div>
  ${temp!=null?`<div class="kv"><span>${L('st.temp')}</span><b class="${tl?tl+'-t':''}">${temp.toFixed(1)} °C</b></div>${meter((temp-30)/55*100,tl)}`:''}
  <div class="kv"><span>${L('st.load')}</span><b>${sy.load.map(x=>x.toFixed(2)).join(' / ')}</b></div>${meter(sy.load[0]/sy.cpus*100,sy.load[0]>sy.cpus?'bad':'')}
  <div class="kv"><span>${L('st.memory')}</span><b>${L('st.of',{a:gb(sy.mem_total-sy.mem_avail),b:gb(sy.mem_total)})}</b></div>${meter(memPct,memPct>90?'bad':memPct>80?'warn':'')}
  <div class="kv"><span>${L('st.uptime')}</span><b>${dur(sy.uptime)}</b></div>
  <div class="kv"><span>TVHeadend</span><b>${esc(s.version||'')}</b></div>
  <div class="kv"><span>${L('st.clients')}</span><b>${s.clients}</b></div></div>
 <div class="card"><div class="card-h"><b>${L('st.storage')}</b></div>
  <div class="kv"><span>${L('st.used')}</span><b>${L('st.of',{a:gb(d.used),b:gb(d.total)})}</b></div>${meter(dp,dp>=95?'bad':dp>=88?'warn':'')}
  <div class="kv"><span>${L('st.free_space')}</span><b>${gb(d.free)}</b></div>
  ${s.archive?`<div class="kv"><span>${L('st.archive')}</span><b>${L('st.archive_n',{n:nfmt(s.archive.events)})}${s.archive.since?' '+L('st.since',{d:new Date(s.archive.since*1000).toLocaleDateString(LOCALE)}):''} · ${(s.archive.bytes/1048576).toFixed(0)} MB</b></div>`:''}
  ${d.failed_full?`<p class="warn-t">⚠ ${L('st.failed_full',{n:d.failed_full})}</p>`:''}</div></div>
 <h3>${L('st.running')}</h3>
 ${s.recording.length||s.subscriptions.length?`<table>${s.recording.map(r=>`<tr><td><span class="tag" style="color:var(--bad)">● ${L('st.recording')}</span></td><td><b>${esc(r.title)}</b><br><span class="muted">${esc(r.channel)} · ${hm(r.start)}–${hm(r.stop)} · ${gb(r.size)}</span></td></tr>`).join('')}
 ${s.subscriptions.map(x=>`<tr><td><span class="tag">${esc(x.title||'Stream')}</span></td><td><b>${esc(x.channel||x.service)}</b><br><span class="muted">${esc(x.state)}${x.client?' · '+esc(x.client):''} · ${L('st.since',{d:hm(x.start)})}${x.errors?' · '+L('st.errors_n',{n:x.errors}):''}</span></td></tr>`).join('')}</table>`:`<p class="muted">${L('st.nothing')}</p>`}`;
 $('#main').insertAdjacentHTML('beforeend','<div id="recep">'+recepHtml()+'</div>');
 if(!RECP||Date.now()-RECP.at>300000)loadRecep();
 scrollTo(0,y);clearTimeout(statusTimer);statusTimer=setTimeout(()=>{if(cur=='status')renderStatus()},5000)}
// ---------- Empfangsverlauf je Transponder ----------
// SNR als Balken je Stunde, Fehler als rote Balken von oben; dazu die Aufnahmen mit Fehlern (auch ältere)
let RECP=null,RECD=+(store('recdays')||7);
async function loadRecep(){try{RECP=await api('/api/reception?days='+RECD);RECP.at=Date.now()}catch(e){return}if(cur=='status'&&$('#recep'))$('#recep').innerHTML=recepHtml()}
function recepDays(d){RECD=d;store('recdays',d);RECP=null;$('#recep').innerHTML=recepHtml();loadRecep()}
function spark(m,days){const W=days*24,end=Math.floor(Date.now()/3600000)*3600,x=t=>W-1-(end-t)/3600,top=m.unit=='db'?15:100;
 const maxE=Math.max(1,...m.hours.map(h=>h.errors||0)),eh=h=>Math.log10(1+h.errors)/Math.log10(1+maxE)*14;
 const now=Date.now()/3600000%24,grid=[...Array(days).keys()].map(i=>`<line x1="${(W-i*24-now).toFixed(1)}" x2="${(W-i*24-now).toFixed(1)}" y1="0" y2="40" stroke="var(--line)" stroke-width=".4"/>`).join('');
 const bars=m.hours.map(h=>{const v=Math.max(1,Math.min(1,(h.snr||0)/top)*36);return `<rect x="${x(h.t).toFixed(1)}" y="${(40-v).toFixed(1)}" width="1" height="${v.toFixed(1)}" fill="var(--acc)" opacity=".75"><title>${new Date(h.t*1000).toLocaleString(LOCALE,{weekday:'short',hour:'2-digit',minute:'2-digit'})} · SNR ${(h.snr||0).toFixed(1)}${m.unit=='db'?' dB':' %'}${h.errors?' · '+L('st.recep_err',{n:h.errors}):''}</title></rect>`
  +(h.errors>0?`<rect x="${x(h.t).toFixed(1)}" y="0" width="1" height="${Math.max(2,eh(h)).toFixed(1)}" fill="var(--bad)"/>`:'')}).join('');
 return `<svg class="spark" viewBox="0 0 ${W} 40" preserveAspectRatio="none">${grid}${bars}</svg>`}
function recepHtml(){const days=RECD;
 const head=`<h3>${L('st.recep')}</h3><div class="bar"><span class="seg">${[1,7,30].map(d=>`<button class="${d==days?'on':''}" onclick="recepDays(${d})">${L('st.recep_days',{n:d})}</button>`).join('')}</span><span class="muted small">${L('st.recep_hint')}</span></div>`;
 if(!RECP)return head+`<p class="muted">${L('common.loading')}</p>`;
 if(!RECP.muxes.length)return head+`<p class="muted">${L('st.recep_none')}</p>`;
 return head+`<table class="recep"><tbody>${RECP.muxes.map(m=>{const bad=m.recs.filter(r=>r.errors);const last=m.hours[m.hours.length-1];
  return `<tr><td style="white-space:nowrap"><b>${esc(m.mux)}</b><br><span class="muted small">${last?L('st.recep_snr',{v:last.snr.toFixed(1)+(m.unit=='db'?' dB':' %')}):''}</span></td>
  <td style="width:55%">${m.hours.length?spark(m,days):`<span class="muted small">${L('st.recep_nodata')}</span>`}</td>
  <td class="small">${m.errors?`<span class="bad-t">${L('st.recep_err',{n:nfmt(m.errors)})}</span><br>`:''}${m.recs.length?`<details><summary>${L('st.recep_recs',{n:bad.length,total:m.recs.length})}</summary>${bad.slice(0,15).map(r=>`<div>${esc(new Date(r.start*1000).toLocaleDateString(LOCALE))} · ${esc(r.channel)} · ${esc(r.title)} <span class="bad-t">(${nfmt(r.errors)})</span></div>`).join('')||`<span class="muted">${L('st.recep_ok')}</span>`}</details>`:''}</td></tr>`}).join('')}</tbody></table>
 ${RECP.since?`<p class="muted small">${L('st.recep_since',{d:new Date(RECP.since*1000).toLocaleString(LOCALE)})}</p>`:''}`}
