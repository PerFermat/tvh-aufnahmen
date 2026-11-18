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
