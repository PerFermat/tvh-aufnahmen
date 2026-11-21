// Reiter „Sender ordnen“: Sender als Kacheln, per Ziehen (Maus sofort, Finger nach kurzem Halten) oder
// Doppelklick die Nummer ändern. Der verschobene Sender bekommt die Nummer hinter seinem neuen Vorgänger;
// ist sie schon vergeben, wird gefragt, ob die folgenden bis zur nächsten Lücke aufrücken – sonst ist sie
// doppelt (rot markiert). Die Nummer eintippen geht nur innerhalb der Lücke zwischen den Nachbarn (die
// Reihenfolge bleibt); danach wird gefragt, ob die direkt folgenden bis zur nächsten Lücke mitgehen.
// Gespeichert wird erst mit „Speichern“.
let CHN=null,CHUNDO=[],CHQ='';
const chDirty=()=>!!CHN&&CHN.some(c=>c.number!=c.orig);
async function renderChannels(){if(!CHN){$('#main').innerHTML=`<p class="muted">${L('common.loading')}</p>`;
  try{CHN=(await api('/api/channels')).channels.map(c=>({...c,orig:c.number}));CHUNDO=[]}
  catch(e){$('#main').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}}
 if(cur!='channels')return;
 $('#main').innerHTML=`<div class="bar"><button class="b" id="chsave" onclick="chSave()"></button>
 <button class="b sec" id="chundo" onclick="chUndo()">${L('chn.undo')}</button>
 <button class="b sec" id="chreset" onclick="chReset()">${L('chn.reset')}</button>
 <input type="search" placeholder="${L('chn.search')}" value="${esc(CHQ)}" oninput="CHQ=this.value;chFind()" style="flex:1;min-width:180px"></div>
 <p class="muted">${L('chn.hint')}</p><div class="chgrid" id="chgrid"></div>`;
 chDraw()}
function chDraw(){const g=$('#chgrid');if(!g)return;
 const cnt={};CHN.forEach(c=>{if(c.number)cnt[c.number]=(cnt[c.number]||0)+1});
 g.innerHTML=CHN.map((c,i)=>{const dup=cnt[c.number]>1;return `<div class="chtile${c.number!=c.orig?' moved':''}${c.enabled?'':' off'}${dup?' dup':''}" data-i="${i}" title="${esc(c.name)}${c.enabled?'':' · '+L('common.disabled')}${dup?' · '+L('chn.dup'):''}">
  <span class="cn">${c.number||'–'}</span>${c.icon?`<img src="${c.icon}" alt="" loading="lazy" draggable="false">`:''}<span class="nm">${esc(c.name)}</span>
  ${c.number!=c.orig?`<s class="old">${c.orig||'–'}</s>`:''}</div>`}).join('');
 const n=CHN.filter(c=>c.number!=c.orig).length;
 $('#chsave').textContent=n?L('chn.save_n',{n}):L('chn.save');$('#chsave').disabled=!n;
 $('#chundo').disabled=!CHUNDO.length;$('#chreset').disabled=!n;chFind(true)}
// Suche: Treffer hervorheben, den ersten ins Bild holen
function chFind(quiet){const g=$('#chgrid'),q=CHQ.trim().toLowerCase();if(!g)return;g.classList.toggle('q',!!q);let first=null;
 g.querySelectorAll('.chtile').forEach(t=>{const hit=!!q&&CHN[t.dataset.i].name.toLowerCase().includes(q);t.classList.toggle('hit',hit);if(hit&&!first)first=t});
 if(first&&!quiet)first.scrollIntoView({block:'center',behavior:'smooth'})}
// ---------- Verschieben ----------
let CHP=null;// Verschiebung, die auf die Antwort im Dialog wartet
function chMove(from,to){// to: Einfügestelle in der Liste vor dem Herausnehmen
 if(to>from)to--;
 if(to==from)return;
 const list=[...CHN],[c]=list.splice(from,1);list.splice(to,0,c);
 const n=Math.max(0,...list.slice(0,to).map(x=>x.number||0))+1;
 // Wer müsste aufrücken? Die folgenden, solange ihre Nummer nicht größer ist als die davor (bis zur Lücke)
 const shift=[];let prev=n;
 for(let j=to+1;j<list.length;j++){const x=list[j];if(!x.number||x.number>prev)break;prev++;shift.push([x,prev])}
 CHP={list,c,n,shift};
 if(!shift.length)return chApply(false);
 chShiftAsk(L(shift.length>1?'chn.shift_q':'chn.shift_q1',{n,name:esc(shift[0][0].name),k:shift.length,m:shift[0][1]}),
  L(shift.length>1?'chn.shift_yes':'chn.shift_yes1',{k:shift.length}))}
// Rückfrage zu CHP: die folgenden Sender (CHP.shift) mit ändern, nur diesen Sender oder abbrechen
function chShiftAsk(question,yes){const {c,n,shift}=CHP;
 const show=shift.slice(0,8).map(([x,m])=>`<li>${esc(x.name)}: ${x.number} → <b>${m}</b></li>`).join('')+(shift.length>8?`<li>… ${L('chn.more',{n:shift.length-8})}</li>`:'');
 dialog(`<h3>${L('chn.shift_title',{name:esc(c.name),n})}</h3><p>${question}</p><ul class="chshift">${show}</ul>
  <div class="bar"><button class="b" onclick="chApply(true)">${yes}</button>
  <button class="b sec" onclick="chApply(false)">${L('chn.shift_no',{name:esc(c.name)})}</button>
  <button class="b sec" onclick="$('#dlg').close()">${L('chn.cancel')}</button></div>`).classList.add('ask');}
// Dialog geschlossen: offene Rückfrage verwerfen. Das close-Ereignis kommt verzögert – ist der Dialog bis dahin
// schon wieder offen (Nummer eingegeben → gleich die Rückfrage), gilt es nicht mehr.
$('#dlg').addEventListener('close',()=>{if($('#dlg').open)return;$('#dlg').classList.remove('ask');CHP=null});
function chApply(withShift){const p=CHP;if(!p)return;CHP=null;if($('#dlg').open)$('#dlg').close();
 CHUNDO.push(CHN.map(c=>[c.uuid,c.number]));
 CHN=p.list;p.c.number=p.n;if(withShift)p.shift.forEach(([x,m])=>x.number=m);
 chDraw()}
function chUndo(){const s=CHUNDO.pop();if(!s)return;const by=Object.fromEntries(CHN.map(c=>[c.uuid,c]));
 CHN=s.map(([u,n])=>({...by[u],number:n}));chDraw()}
function chReset(){if(!confirm(L('chn.reset_confirm')))return;
 CHN=CHN.map(c=>({...c,number:c.orig})).sort((a,b)=>(a.number||1e9)-(b.number||1e9)||a.name.localeCompare(b.name));CHUNDO=[];chDraw()}
// Doppelklick: Nummer ändern, aber nur innerhalb der Lücke zwischen Vorgänger und Nachfolger – wer weiter
// weg soll, wird verschoben. Beispiel 1 2 3 4 6 8 9 10 12: 1–3 haben keinen Spielraum, 4 kann 5 werden, 8 kann 7 werden.
function chRange(i){const prev=Math.max(0,...CHN.slice(0,i).map(x=>x.number||0)),next=CHN.slice(i+1).find(x=>x.number);
 return [prev+1,next?next.number-1:99999]}
function chAsk(i){const c=CHN[i],[lo,hi]=chRange(i);
 const nb=k=>CHN[k]?`„${esc(CHN[k].name)}“ (${CHN[k].number||'–'})`:'';
 if(lo>hi||(lo==hi&&c.number==lo)){dialog(`<h3>${esc(c.name)}</h3><p>${i?L('chn.no_room',{name:esc(c.name),a:nb(i-1),b:nb(i+1)}):L('chn.no_room_first',{name:esc(c.name),b:nb(i+1)})}</p>
  <div class="bar"><button class="b" onclick="$('#dlg').close()">${L('common.close')}</button></div>`).classList.add('ask');return}
 dialog(`<h3>${L('chn.ask',{name:esc(c.name)})}</h3><form onsubmit="event.preventDefault();chNumber(${i},this.n.value)">
  <p class="muted">${L('chn.range',{lo,hi:hi<99999?hi:'…'})}</p>
  <div class="bar"><input name="n" type="number" min="${lo}" max="${hi}" value="${c.number||lo}" required style="width:8em">
  <button class="b">${L('common.save')}</button><button type="button" class="b sec" onclick="$('#dlg').close()">${L('chn.cancel')}</button></div></form>`).classList.add('ask');
 const inp=$('#dlg input');inp.focus();inp.select()}
// Neue Nummer übernehmen; die direkt anschließenden Sender (lückenlos ab der alten Nummer) können mitgehen
function chNumber(i,v){const c=CHN[i],[lo,hi]=chRange(i),n=parseInt(v,10);
 if(!(n>=lo&&n<=hi)){msg(L('chn.bad_number',{n:v})+' – '+L('chn.range',{lo,hi:hi<99999?hi:'…'}));return}
 $('#dlg').close();if(n==c.number)return;
 const d=n-(c.number||n),shift=[];
 if(c.number)for(let j=i+1,p=c.number;j<CHN.length&&CHN[j].number==p+1;j++,p++)shift.push([CHN[j],CHN[j].number+d]);
 CHP={list:[...CHN],c,n,shift};
 if(!shift.length)return chApply(false);
 chShiftAsk(L('chn.follow_q',{k:shift.length,d:(d>0?'+':'')+d}),L('chn.follow_yes',{k:shift.length}))}
let CHD=null;// laufendes Ziehen
function chDown(e){const t=e.target.closest('.chtile');if(!t||e.button>0)return;
 const touch=e.pointerType!='mouse';
 CHD={t,i:+t.dataset.i,x:e.clientX,y:e.clientY,px:e.clientX,py:e.clientY,on:false,id:e.pointerId,
  timer:touch?setTimeout(()=>chStart(),350):null}}
function chStart(){const d=CHD;if(!d||d.on)return;d.on=true;navigator.vibrate?.(15);
 const r=d.t.getBoundingClientRect();d.dx=d.x-r.left;d.dy=d.y-r.top;
 d.g=d.t.cloneNode(true);d.g.className+=' chghost';d.g.style.width=r.width+'px';document.body.appendChild(d.g);
 d.t.classList.add('drag');chGhost();chScroll()}
function chGhost(){const d=CHD;d.g.style.left=d.px-d.dx+'px';d.g.style.top=d.py-d.dy+'px';
 document.querySelectorAll('.chtile.ib,.chtile.ia').forEach(x=>x.classList.remove('ib','ia'));
 const el=document.elementFromPoint(d.px,d.py)?.closest('#chgrid .chtile');d.to=null;
 if(!el){// über der Lücke am Ende des Rasters: ans Ende
  const g=$('#chgrid').getBoundingClientRect();if(d.py>g.bottom-60&&d.py<g.bottom+40){d.to=CHN.length;$('#chgrid').lastElementChild.classList.add('ia')}return}
 const r=el.getBoundingClientRect(),after=d.px>r.left+r.width/2,k=+el.dataset.i;
 d.to=k+(after?1:0);el.classList.add(after?'ia':'ib')}
// Am oberen oder unteren Rand automatisch weiterblättern
function chScroll(){const d=CHD;if(!d||!d.on)return;const m=70,h=innerHeight;
 const v=d.py<m?-(m-d.py)/3:d.py>h-m?(d.py-(h-m))/3:0;if(v){scrollBy(0,v);chGhost()}
 requestAnimationFrame(chScroll)}
function chPointerMove(e){const d=CHD;if(!d||e.pointerId!=d.id)return;d.px=e.clientX;d.py=e.clientY;
 const far=Math.hypot(d.px-d.x,d.py-d.y)>8;
 if(!d.on){if(far){if(d.timer){clearTimeout(d.timer);CHD=null}else chStart()}return}// Finger: vor dem Halten bewegt = blättern
 e.preventDefault();chGhost()}
function chUp(e){const d=CHD;if(!d||e.pointerId!=d.id)return;clearTimeout(d.timer);CHD=null;if(!d.on)return;
 d.g.remove();d.t.classList.remove('drag');document.querySelectorAll('.chtile.ib,.chtile.ia').forEach(x=>x.classList.remove('ib','ia'));
 if(e.type=='pointerup'&&d.to!=null)chMove(d.i,d.to)}
addEventListener('pointerdown',e=>{if(cur=='channels'&&e.target.closest('#chgrid'))chDown(e)});
addEventListener('pointermove',chPointerMove,{passive:false});
addEventListener('pointerup',chUp);addEventListener('pointercancel',chUp);
// Während des Ziehens mit dem Finger nicht die Seite blättern, beim Halten kein Kontextmenü
addEventListener('touchmove',e=>{if(CHD?.on)e.preventDefault()},{passive:false});
addEventListener('contextmenu',e=>{if(e.target.closest?.('#chgrid'))e.preventDefault()});
addEventListener('dblclick',e=>{const t=cur=='channels'&&e.target.closest('#chgrid .chtile');if(t)chAsk(+t.dataset.i)});
addEventListener('beforeunload',e=>{if(chDirty())e.preventDefault()});
async function chSave(){const changes=CHN.filter(c=>c.number!=c.orig).map(c=>({uuid:c.uuid,number:c.number}));if(!changes.length)return;
 $('#chsave').disabled=true;
 try{const r=await api('/api/channel-numbers',{changes});msg(L('chn.saved',{n:r.saved}),true);CHN=null;renderChannels()}
 catch(e){msg(e.message);chDraw()}}
