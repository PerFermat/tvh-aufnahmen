// Reiter „Geplante Aufnahmen“: alle zukünftigen Termine, auch die einzelnen Termine von Serienaufnahmen
let UPQ='',UP=[];
async function renderUpcoming(){let d;try{d=await api('/api/upcoming')}catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(cur!='upcoming')return;UP=d.upcoming;
 $('#main').innerHTML=`<div class="bar tools"><input type="search" placeholder="${L('up.search')}" value="${esc(UPQ)}" oninput="UPQ=this.value;fillUpcoming()" style="flex:1;min-width:220px"></div>
 ${d.conflicts.length?`<div class="alert">⚠ <b>${L('up.conflicts',{n:d.conflicts.length})}</b> ${L('up.conflicts_hint',{n:d.tuners})}<ul>${d.conflicts.map(g=>`<li>${esc(wday(g.start))} ${L('ar.from',{t:hm(g.start)})}: ${g.uuids.map(u=>UP.find(e=>e.uuid==u)).filter(Boolean).map(e=>
  `<span class="cfl">${esc(e.disp_title)} <span class="muted">(${esc(e.channelname)})</span>${e.broadcast&&e.sched_status!='recording'?` <button class="b sec sm" onclick="altDialog('${e.uuid}')">${L('up.alt')}</button>`:''}</span>`).join(' · ')}</li>`).join('')}</ul></div>`:''}
 <p class="muted" id="upcount"></p><table><thead><tr><th>${L('ar.th_when')}</th><th>${L('common.channel')}</th><th>${L('common.title')}</th><th>${L('up.series')}</th><th></th></tr></thead><tbody id="upbody"></tbody></table>`;fillUpcoming()}
function fillUpcoming(){const words=UPQ.toLowerCase().split(/\s+/).filter(Boolean);
 const list=UP.filter(e=>words.every(w=>[e.disp_title,e.disp_subtitle,e.channelname,e.autorec_caption].join(' ').toLowerCase().includes(w)));
 $('#upcount').textContent=L('up.count',{n:list.length,total:UP.length});
 $('#upbody').innerHTML=list.map(e=>`<tr><td style="white-space:nowrap">${esc(wday(e.start))}<br><span class="muted">${hm(e.start)}–${hm(e.stop)}</span></td>
 <td>${esc(e.channelname)}</td><td><b>${esc(e.disp_title)}</b>${e.disp_subtitle?'<br><span class="muted">'+esc(e.disp_subtitle.split('\n')[0])+'</span>':''}${e.sched_status=='recording'?`<br><span class="tag" style="color:var(--bad)">${L('up.recording_now')}</span>`:''}${e.enabled===false?`<br><span class="tag">${L('common.disabled')}</span>`:''}${e.conflict?`<br><span class="tag conflict">⚠ ${L('up.conflict_tag')}</span>`:''}</td>
 <td>${e.autorec?esc(e.autorec_caption||L('up.series')):`<span class="muted">${L('up.single')}</span>`}</td>
 <td><button class="b bad" onclick="cancelUpcoming('${e.uuid}')">${e.sched_status=='recording'?L('up.stop'):L('common.delete')}</button></td></tr>`).join('')}
// Konflikt lösen: andere Ausstrahlungen derselben Sendung, je mit „frei“ oder dem, womit sie kollidieren würden
async function altDialog(uuid){const e=UP.find(x=>x.uuid==uuid);
 dialog(`<h2 style="margin:0 90px 6px 0">${L('up.alt_title',{t:esc(e.disp_title)})}</h2><p class="muted">${esc(wday(e.start))} ${hm(e.start)} · ${esc(e.channelname)}</p><div id="altlist"><p class="muted">${L('common.loading')}</p></div>`);
 let r;try{r=await api('/api/alternatives?uuid='+uuid)}catch(err){$('#altlist').innerHTML='<p class="muted">'+esc(err.message)+'</p>';return}
 const a=r.alternatives.sort((x,y)=>(y.free-x.free)||(x.start-y.start));
 $('#altlist').innerHTML=a.length?`<p class="muted">${L(e.autorec?'up.alt_hint_series':'up.alt_hint')}</p><table><tbody>${a.map(x=>`<tr>
  <td style="white-space:nowrap">${esc(wday(x.start))}<br><span class="muted">${hm(x.start)}–${hm(x.stop)}</span></td>
  <td>${esc(x.channelName)}${x.hd?' <span class="tag">HD</span>':''}</td>
  <td>${x.free?`<span class="tag ok">${L('up.alt_free')}</span>`:`<span class="tag conflict">⚠ ${L('up.alt_clash',{t:esc(x.clash.join(', '))})}</span>`}</td>
  <td><button class="b${x.free?'':' sec'}" onclick="altMove('${uuid}',${x.eventId})">${L('up.alt_move')}</button></td></tr>`).join('')}</tbody></table>`
  :`<p>${L('up.alt_none')}</p>`}
async function altMove(uuid,event){try{const r=await api('/api/move-recording',{uuid,event});$('#dlg').close();
  msg(r.conflict?L('up.alt_moved_clash'):L('up.alt_moved'),!r.conflict);renderUpcoming()}catch(err){msg(err.message)}}
async function cancelUpcoming(uuid){const e=UP.find(x=>x.uuid==uuid);
 const q=e.sched_status=='recording'?L('up.confirm_stop',{t:e.disp_title})
  :L('up.confirm_delete',{t:e.disp_title,day:wday(e.start),time:hm(e.start)})+(e.autorec?'\n'+L('up.autorec_stays'):'');
 if(!confirm(q))return;try{await api('/api/upcoming-cancel',{uuid});msg(L('up.done',{t:e.disp_title}),true);renderUpcoming()}catch(err){msg(err.message)}}
// Aufnahme von Hand: fester Sender, Titel und Zeitraum – unabhängig von den Programmdaten
async function manualRecording(){const schema=await formSchema('dvrautorec');
 const chans=(schema.props.find(p=>p.id=='channel')||{enum:[]}).enum.filter(o=>o.key),cfgs=(schema.props.find(p=>p.id=='config_name')||{enum:[]}).enum;
 const now=new Date(),d=new Date(Math.ceil(now.getTime()/900000)*900000),e=new Date(d.getTime()+3600000),last=store('manualchan');
 const ymd=x=>x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate()),hhmm=x=>pad(x.getHours())+':'+pad(x.getMinutes());
 dialog(`<h2 style="margin:0 90px 12px 0">${L('hdr.new_rec')}</h2>
 <form class="ed" onsubmit="event.preventDefault();saveManual(this)">
  <label class="wide">${L('common.channel')}<select name="channel" required>${chans.map(o=>`<option value="${esc(o.key)}" ${o.key==last?'selected':''}>${esc(o.val)}</option>`).join('')}</select></label>
  <label class="wide">${L('common.title')}<input name="title" required placeholder="${L('up.title_ph')}"></label>
  <label class="wide">${L('up.subtitle_opt')}<input name="subtitle"></label>
  <label>${L('common.date')}<input type="date" name="date" value="${ymd(d)}" required></label>
  <label>${L('up.begin')}<input type="time" name="from" value="${hhmm(d)}" required></label>
  <label>${L('common.end')}<input type="time" name="to" value="${hhmm(e)}" required></label>
  <label>${L('up.pre')}<input type="number" name="pre" min="0" max="60" value="2"></label>
  <label>${L('up.post')}<input type="number" name="post" min="0" max="120" value="5"></label>
  ${cfgs.length>1?`<label>${L('up.profile')}<select name="config">${cfgs.map(o=>`<option value="${esc(o.key)}">${esc(o.val)}</option>`).join('')}</select></label>`:''}
  <p class="muted wide" style="margin:0">${L('up.overnight')}</p>
  <div class="wide bar" style="margin:0"><button class="b">${L('up.plan')}</button></div></form>`)}
async function saveManual(f){const start=new Date(f.date.value+'T'+f.from.value);let stop=new Date(f.date.value+'T'+f.to.value);
 if(stop<=start)stop=new Date(stop.getTime()+86400000);
 try{const r=await api('/api/record-manual',{channel:f.channel.value,title:f.title.value,subtitle:f.subtitle.value,
  start:Math.floor(start/1000),stop:Math.floor(stop/1000),start_extra:+f.pre.value,stop_extra:+f.post.value,config:f.config?f.config.value:''});
  store('manualchan',f.channel.value);$('#dlg').close();
  if(r.conflict)msg(L('up.planned',{t:f.title.value})+'\n\n⚠ '+L('up.conflict_msg',{n:r.conflict.titles.length-1,tuners:r.tuners})+'\n'+r.conflict.titles.join(', '));
  else msg(L('up.planned',{t:f.title.value})+`, ${wday(start/1000)} ${hm(start/1000)}–${hm(stop/1000)}`,true);
  if(cur=='upcoming')renderUpcoming()}catch(e){msg(e.message)}}
