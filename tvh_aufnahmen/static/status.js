// Reiter „Status“: Tuner und Signal, laufende Aufnahmen und Streams, Raspberry und Speicher (alle 5 s neu)
let statusTimer=null;
const dur=s=>{s=Math.floor(s);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+' T ':'')+(d||h?h+' h ':'')+m+' min'};
const meter=(pct,lvl)=>`<div class="meter ${lvl||''}"><div style="width:${Math.max(0,Math.min(100,pct)).toFixed(0)}%"></div></div>`;
// Signal: relative Angaben direkt in %, SNR in dB auf eine grobe Skala (DVB-S2 gut ab ~10 dB)
const sigPct=x=>!x?0:x.pct!=null?x.pct:Math.max(0,Math.min(100,(x.db+75)/50*100));
const snrPct=x=>!x?0:x.pct!=null?x.pct:Math.max(0,Math.min(100,x.db/15*100));
async function renderStatus(){let s;try{s=await api('/api/status')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='status')return;const y=scrollY,sy=s.system,temp=sy.temp,tl=temp>=75?'bad':temp>=65?'warn':'';
 const memPct=sy.mem_total?(1-sy.mem_avail/sy.mem_total)*100:0,d=s.disk,dp=d.used/d.total*100;
 $('#main').innerHTML=`<div class="cards">
 ${s.tuners.map((t,i)=>`<div class="card"><div class="card-h"><b>Tuner ${i+1}</b><span class="tag ${t.subs?'':'idle'}">${t.subs?'belegt':'frei'}</span></div>
  <div class="muted small">${esc(t.name)}</div>${t.stream?`<div class="small">${esc(t.stream)}</div>`:''}
  ${t.subs?`<div class="kv"><span>Signal</span><b>${t.signal?esc(t.signal.text):'–'}</b></div>${meter(sigPct(t.signal))}
  <div class="kv"><span>SNR</span><b>${t.snr?esc(t.snr.text):'–'}</b></div>${meter(snrPct(t.snr),snrPct(t.snr)<45?'bad':snrPct(t.snr)<65?'warn':'')}
  <div class="kv"><span>Datenrate</span><b>${t.kbps?(t.kbps/1000).toFixed(1)+' Mbit/s':'–'}</b></div>
  <div class="kv"><span>Fehler (BER/UNC/CC)</span><b class="${t.unc||t.cc?'bad-t':''}">${t.ber} / ${t.unc} / ${t.cc}</b></div>`:'<p class="muted small">Gerade nicht in Benutzung.</p>'}</div>`).join('')}
 <div class="card"><div class="card-h"><b>${esc(sy.model||sy.host||'Rechner')}</b>${sy.model&&sy.host?`<span class="muted small">${esc(sy.host)}</span>`:''}</div>
  ${temp!=null?`<div class="kv"><span>Temperatur</span><b class="${tl?tl+'-t':''}">${temp.toFixed(1)} °C</b></div>${meter((temp-30)/55*100,tl)}`:''}
  <div class="kv"><span>Last (1/5/15 min)</span><b>${sy.load.map(x=>x.toFixed(2)).join(' / ')}</b></div>${meter(sy.load[0]/sy.cpus*100,sy.load[0]>sy.cpus?'bad':'')}
  <div class="kv"><span>Arbeitsspeicher</span><b>${gb(sy.mem_total-sy.mem_avail)} von ${gb(sy.mem_total)}</b></div>${meter(memPct,memPct>90?'bad':memPct>80?'warn':'')}
  <div class="kv"><span>Läuft seit</span><b>${dur(sy.uptime)}</b></div>
  <div class="kv"><span>TVHeadend</span><b>${esc(s.version||'')}</b></div>
  <div class="kv"><span>Verbundene Clients</span><b>${s.clients}</b></div></div>
 <div class="card"><div class="card-h"><b>Speicher</b></div>
  <div class="kv"><span>Belegt</span><b>${gb(d.used)} von ${gb(d.total)}</b></div>${meter(dp,dp>=95?'bad':dp>=88?'warn':'')}
  <div class="kv"><span>Frei</span><b>${gb(d.free)}</b></div>
  ${s.archive?`<div class="kv"><span>EPG-Archiv</span><b>${s.archive.events.toLocaleString('de-DE')} Sendungen${s.archive.since?' seit '+new Date(s.archive.since*1000).toLocaleDateString('de-DE'):''} · ${(s.archive.bytes/1048576).toFixed(0)} MB</b></div>`:''}
  ${d.failed_full?`<p class="warn-t">⚠ ${d.failed_full} Aufnahme(n) in den letzten 30 Tagen wegen vollem Speicher fehlgeschlagen.</p>`:''}</div></div>
 <h3>Läuft gerade</h3>
 ${s.recording.length||s.subscriptions.length?`<table>${s.recording.map(r=>`<tr><td><span class="tag" style="color:var(--bad)">● Aufnahme</span></td><td><b>${esc(r.title)}</b><br><span class="muted">${esc(r.channel)} · ${hm(r.start)}–${hm(r.stop)} · ${gb(r.size)}</span></td></tr>`).join('')}
 ${s.subscriptions.map(x=>`<tr><td><span class="tag">${esc(x.title||'Stream')}</span></td><td><b>${esc(x.channel||x.service)}</b><br><span class="muted">${esc(x.state)}${x.client?' · '+esc(x.client):''} · seit ${hm(x.start)}${x.errors?' · '+x.errors+' Fehler':''}</span></td></tr>`).join('')}</table>`:'<p class="muted">Keine laufenden Aufnahmen oder Streams.</p>'}`;
 scrollTo(0,y);clearTimeout(statusTimer);statusTimer=setTimeout(()=>{if(cur=='status')renderStatus()},5000)}
