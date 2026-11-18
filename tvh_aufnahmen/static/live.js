// Reiter „Live-TV“: Sender mit laufender und folgenden Sendungen, Abspielen in VLC
let LIVE=null,LQ='',liveTimer=null;
async function renderLive(){
 if(!$('#lbody')){$('#main').innerHTML=`<div class="bar"><input id="lq" class="tools" type="search" placeholder="Suchen: Sender oder Sendung …" value="${esc(LQ)}" style="flex:1;min-width:220px" oninput="LQ=this.value;fillLive()"><span id="qsel"></span></div>
 <p class="muted" id="lcount">Lade Sender …</p><table><tbody id="lbody"></tbody></table>`;qualitySelect().then(h=>{if($('#qsel'))$('#qsel').innerHTML=h});if(LIVE)fillLive()}
 clearTimeout(liveTimer);
 try{LIVE=await api('/api/live')}catch(e){if(cur=='live')$('#lcount').textContent=e.message;return}
 if(cur!='live'||!$('#lbody'))return;
 fillLive();liveTimer=setTimeout(()=>{if(cur=='live')renderLive()},60000)}
function fillLive(){const words=LQ.toLowerCase().split(/\s+/).filter(Boolean),now=Date.now()/1000;
 const list=LIVE.channels.filter(c=>{const t=[c.name,c.now?.title,...c.next.map(e=>e.title)].join(' ').toLowerCase();return words.every(w=>t.includes(w))});
 $('#lcount').textContent=list.length+' von '+LIVE.channels.length+' Sendern';
 $('#lbody').innerHTML=list.map(c=>{const n=c.now,p=n?Math.min(100,Math.max(0,(now-n.start)/(n.stop-n.start)*100)):0;
  return `<tr><td class="logo">${c.icon?`<img src="${c.icon}" alt="" loading="lazy">`:''}</td>
 <td style="width:22%"><b>${esc(c.name)}</b>${c.number?'<br><span class="muted">'+c.number+'</span>':''}</td>
 <td>${n?`<b>${esc(n.title)}</b> <span class="muted">${hm(n.start)}–${hm(n.stop)}</span>${n.subtitle&&n.subtitle!=n.title?'<br><span class="muted">'+esc(n.subtitle)+'</span>':''}
  <div class="prog"><div style="width:${p.toFixed(1)}%"></div></div>`:'<span class="muted">Keine Programmdaten</span>'}
  ${c.next.map(e=>`<div class="nxt"><span class="muted">${hm(e.start)}</span> ${esc(e.title)}</div>`).join('')}</td>
 <td style="white-space:nowrap"><a class="b" style="text-decoration:none;display:inline-block" href="${playHref(c.uuid)}" data-play="${c.uuid}" title="Öffnet den Sender als Stream in VLC">Abspielen</a></td></tr>`}).join('')}
