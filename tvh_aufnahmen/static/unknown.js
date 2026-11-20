// Reiter „Nicht eingetragene Dateien“: Import
function renderUnknown(){
 if(!S.unknown.length){$('#main').innerHTML=`<p class="muted">${L('unk.none')}</p>`;return}
 let h=`<div class="bar"><button class="b sec" onclick="bulk()">${L('unk.bulk')}</button>
 <label><input type="checkbox" onchange="document.querySelectorAll('.cu').forEach(c=>c.checked=this.checked)"> ${L('common.select_all')}</label></div>
 <table><tr><th></th><th>${L('common.file')}</th><th>${L('unk.suggestion')}</th><th>${L('common.size')}</th><th></th></tr>`;
 S.unknown.forEach((u,i)=>{h+=`<tr><td><input type="checkbox" class="cu" data-i="${i}"></td><td class="f">${esc(u.rel)}</td>
 <td>${esc(u.suggest.title)}<br><span class="muted">${esc(u.suggest.channelname||L('unk.channel_unknown'))} · ${fmt(u.suggest.start)}${u.suggest.duration_known?'':' · '+L('unk.duration_guessed')}</span></td>
 <td>${gb(u.size)}</td><td><button class="b" onclick="edit(${i})">${L('common.edit')}</button></td></tr><tr id="ed${i}" hidden><td colspan="5"></td></tr>`});
 $('#main').innerHTML=h+'</table>'}
function edit(i){const row=$('#ed'+i);if(!row.hidden){row.hidden=true;return}
 const u=S.unknown[i],s=u.suggest;row.hidden=false;
 row.firstElementChild.innerHTML=`<form class="ed" onsubmit="event.preventDefault();save(${i},this)">
 <label class="wide">${L('common.title')}<input name="title" required value="${esc(s.title)}"></label>
 <label class="wide">${L('unk.subtitle')}<input name="subtitle"></label>
 <label>${L('common.channel')}<input name="channelname" list="chans" value="${esc(s.channelname)}" placeholder="${L('unk.unknown')}"></label>
 <label>${L('common.start')}<input type="datetime-local" name="start" required value="${dtl(s.start)}"></label>
 <label>${L('common.end')}<input type="datetime-local" name="stop" required value="${dtl(s.stop)}"></label>
 <label class="wide">${L('common.description')}<textarea name="description"></textarea></label>
 <label class="wide">${L('common.comment')}<input name="comment" value="${L('unk.imported')}"></label>
 <div class="wide" style="display:flex;gap:10px"><button class="b">${L('unk.add')}</button>
  <button type="button" class="b sec" onclick="$('#ed${i}').hidden=true">${L('common.close')}</button></div></form>`}
function payload(u,f){const ch=S.channels.find(c=>c.name===f.channelname);
 return {path:u.path,title:f.title,subtitle:f.subtitle,description:f.description,comment:f.comment,
  channelname:f.channelname,channel:ch?ch.uuid:'',start:Math.floor(new Date(f.start).getTime()/1000),stop:Math.floor(new Date(f.stop).getTime()/1000)}}
async function save(i,form){const f=Object.fromEntries(new FormData(form));
 try{await api('/api/import',payload(S.unknown[i],f));msg(L('unk.added',{t:f.title}),true);await load()}catch(e){msg(e.message)}}
async function bulk(){const sel=[...document.querySelectorAll('.cu:checked')].map(c=>S.unknown[c.dataset.i]);
 if(!sel.length)return msg(L('common.nothing_selected'));
 if(!confirm(L('unk.confirm_bulk',{n:sel.length})))return;
 let ok=0,err=[];for(const u of sel){const s=u.suggest;
  try{await api('/api/import',{path:u.path,title:s.title,channelname:s.channelname,start:s.start,stop:s.stop,comment:L('unk.imported')});ok++}catch(e){err.push(u.rel+': '+e.message)}}
 msg(L('unk.added_n',{n:ok})+(err.length?'. '+L('common.error',{err:err.join('; ')}):''),!err.length);await load()}
