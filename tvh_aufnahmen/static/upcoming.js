// Reiter „Geplante Aufnahmen“: alle zukünftigen Termine, auch die einzelnen Termine von Serienaufnahmen
let UPQ='',UP=[];
async function renderUpcoming(){let d;try{d=await api('/api/upcoming')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='upcoming')return;UP=d.upcoming;
 $('#main').innerHTML=`<div class="bar tools"><input type="search" placeholder="Suchen: Titel, Sender, Serie …" value="${esc(UPQ)}" oninput="UPQ=this.value;fillUpcoming()" style="flex:1;min-width:220px"></div>
 ${d.conflicts.length?`<div class="alert">⚠ <b>${d.conflicts.length} Zeitraum/Zeiträume mit Konflikt:</b> Dort sollen mehr Sender von verschiedenen Transpondern gleichzeitig aufgenommen werden, als es Tuner gibt (${d.tuners}). Mindestens eine Aufnahme fällt dann aus – betroffene sind rot markiert.<ul>${d.conflicts.map(g=>`<li>${esc(wday(g.start))} ab ${hm(g.start)}: ${esc(g.titles.join(', '))}</li>`).join('')}</ul></div>`:''}
 <p class="muted" id="upcount"></p><table><thead><tr><th>Wann</th><th>Sender</th><th>Titel</th><th>Serie</th><th></th></tr></thead><tbody id="upbody"></tbody></table>`;fillUpcoming()}
function fillUpcoming(){const words=UPQ.toLowerCase().split(/\s+/).filter(Boolean);
 const list=UP.filter(e=>words.every(w=>[e.disp_title,e.disp_subtitle,e.channelname,e.autorec_caption].join(' ').toLowerCase().includes(w)));
 $('#upcount').textContent=list.length+' von '+UP.length+' geplanten Aufnahmen';
 $('#upbody').innerHTML=list.map(e=>`<tr><td style="white-space:nowrap">${esc(wday(e.start))}<br><span class="muted">${hm(e.start)}–${hm(e.stop)}</span></td>
 <td>${esc(e.channelname)}</td><td><b>${esc(e.disp_title)}</b>${e.disp_subtitle?'<br><span class="muted">'+esc(e.disp_subtitle.split('\n')[0])+'</span>':''}${e.sched_status=='recording'?'<br><span class="tag" style="color:var(--bad)">nimmt gerade auf</span>':''}${e.enabled===false?'<br><span class="tag">deaktiviert</span>':''}${e.conflict?'<br><span class="tag conflict">⚠ Konflikt: zu wenig Tuner</span>':''}</td>
 <td>${e.autorec?esc(e.autorec_caption||'Serie'):'<span class="muted">einzeln</span>'}</td>
 <td><button class="b bad" onclick="cancelUpcoming('${e.uuid}')">${e.sched_status=='recording'?'Stoppen':'Löschen'}</button></td></tr>`).join('')}
async function cancelUpcoming(uuid){const e=UP.find(x=>x.uuid==uuid);
 const q=e.sched_status=='recording'?`Laufende Aufnahme „${e.disp_title}“ stoppen? Das bisher Aufgenommene bleibt erhalten.`
  :`Geplante Aufnahme „${e.disp_title}“ am ${wday(e.start)} um ${hm(e.start)} löschen?`+(e.autorec?'\nDie Serienaufnahme bleibt bestehen.':'');
 if(!confirm(q))return;try{await api('/api/upcoming-cancel',{uuid});msg('Erledigt: '+e.disp_title,true);renderUpcoming()}catch(err){msg(err.message)}}
// Aufnahme von Hand: fester Sender, Titel und Zeitraum – unabhängig von den Programmdaten
async function manualRecording(){const schema=await formSchema('dvrautorec');
 const chans=(schema.props.find(p=>p.id=='channel')||{enum:[]}).enum.filter(o=>o.key),cfgs=(schema.props.find(p=>p.id=='config_name')||{enum:[]}).enum;
 const now=new Date(),d=new Date(Math.ceil(now.getTime()/900000)*900000),e=new Date(d.getTime()+3600000),last=store('manualchan');
 const ymd=x=>x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate()),hhmm=x=>pad(x.getHours())+':'+pad(x.getMinutes());
 dialog(`<h2 style="margin:0 90px 12px 0">Neue Aufnahme</h2>
 <form class="ed" onsubmit="event.preventDefault();saveManual(this)">
  <label class="wide">Sender<select name="channel" required>${chans.map(o=>`<option value="${esc(o.key)}" ${o.key==last?'selected':''}>${esc(o.val)}</option>`).join('')}</select></label>
  <label class="wide">Titel<input name="title" required placeholder="z. B. Fußball-Länderspiel"></label>
  <label class="wide">Untertitel (optional)<input name="subtitle"></label>
  <label>Datum<input type="date" name="date" value="${ymd(d)}" required></label>
  <label>Beginn<input type="time" name="from" value="${hhmm(d)}" required></label>
  <label>Ende<input type="time" name="to" value="${hhmm(e)}" required></label>
  <label>Vorlauf (Minuten)<input type="number" name="pre" min="0" max="60" value="2"></label>
  <label>Nachlauf (Minuten)<input type="number" name="post" min="0" max="120" value="5"></label>
  ${cfgs.length>1?`<label>Aufnahmeprofil<select name="config">${cfgs.map(o=>`<option value="${esc(o.key)}">${esc(o.val)}</option>`).join('')}</select></label>`:''}
  <p class="muted wide" style="margin:0">Endet die Aufnahme vor dem Beginn (z. B. 23:00–01:00), geht sie bis zum nächsten Tag.</p>
  <div class="wide bar" style="margin:0"><button class="b">Aufnahme planen</button></div></form>`)}
async function saveManual(f){const start=new Date(f.date.value+'T'+f.from.value);let stop=new Date(f.date.value+'T'+f.to.value);
 if(stop<=start)stop=new Date(stop.getTime()+86400000);
 try{const r=await api('/api/record-manual',{channel:f.channel.value,title:f.title.value,subtitle:f.subtitle.value,
  start:Math.floor(start/1000),stop:Math.floor(stop/1000),start_extra:+f.pre.value,stop_extra:+f.post.value,config:f.config?f.config.value:''});
  store('manualchan',f.channel.value);$('#dlg').close();
  if(r.conflict)msg(`Aufnahme geplant: ${f.title.value}\n\n⚠ Konflikt: Zu dieser Zeit sind schon ${r.conflict.titles.length-1} andere Aufnahme(n) auf anderen Transpondern geplant – es gibt aber nur ${r.tuners} Tuner:\n${r.conflict.titles.join(', ')}`);
  else msg(`Aufnahme geplant: ${f.title.value}, ${wday(start/1000)} ${hm(start/1000)}–${hm(stop/1000)}`,true);
  if(cur=='upcoming')renderUpcoming()}catch(e){msg(e.message)}}
