// Reiter „Sender ordnen“: Sender als Kacheln, per Ziehen (Maus sofort, Finger nach kurzem Halten) oder
// Doppelklick mit Nummer verschieben. Der verschobene Sender bekommt die Nummer hinter seinem neuen Vorgänger,
// die folgenden rücken nur so weit auf, bis eine Lücke kommt. Gespeichert wird erst mit „Speichern“.
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
 g.innerHTML=CHN.map((c,i)=>`<div class="chtile${c.number!=c.orig?' moved':''}${c.enabled?'':' off'}" data-i="${i}" title="${esc(c.name)}${c.enabled?'':' · '+L('common.disabled')}">
  <span class="cn">${c.number||'–'}</span>${c.icon?`<img src="${c.icon}" alt="" loading="lazy" draggable="false">`:''}<span class="nm">${esc(c.name)}</span>
  ${c.number!=c.orig?`<s class="old">${c.orig||'–'}</s>`:''}</div>`).join('');
 const n=CHN.filter(c=>c.number!=c.orig).length;
 $('#chsave').textContent=n?L('chn.save_n',{n}):L('chn.save');$('#chsave').disabled=!n;
 $('#chundo').disabled=!CHUNDO.length;$('#chreset').disabled=!n;chFind(true)}
// Suche: Treffer hervorheben, den ersten ins Bild holen
function chFind(quiet){const g=$('#chgrid'),q=CHQ.trim().toLowerCase();if(!g)return;g.classList.toggle('q',!!q);let first=null;
 g.querySelectorAll('.chtile').forEach(t=>{const hit=!!q&&CHN[t.dataset.i].name.toLowerCase().includes(q);t.classList.toggle('hit',hit);if(hit&&!first)first=t});
 if(first&&!quiet)first.scrollIntoView({block:'center',behavior:'smooth'})}
// ---------- Verschieben ----------
function chMove(from,to,number){// to: Einfügestelle in der Liste vor dem Herausnehmen
 if(to>from)to--;
 if(to==from&&number===undefined)return;
 CHUNDO.push(CHN.map(c=>[c.uuid,c.number]));
 const [c]=CHN.splice(from,1);CHN.splice(to,0,c);
 const before=Math.max(0,...CHN.slice(0,to).map(x=>x.number||0));
 c.number=number??before+1;
 for(let j=to+1;j<CHN.length;j++){const x=CHN[j];if(!x.number||x.number>CHN[j-1].number)break;x.number=CHN[j-1].number+1}
 chDraw()}
function chUndo(){const s=CHUNDO.pop();if(!s)return;const by=Object.fromEntries(CHN.map(c=>[c.uuid,c]));
 CHN=s.map(([u,n])=>({...by[u],number:n}));chDraw()}
function chReset(){if(!confirm(L('chn.reset_confirm')))return;
 CHN=CHN.map(c=>({...c,number:c.orig})).sort((a,b)=>(a.number||1e9)-(b.number||1e9)||a.name.localeCompare(b.name));CHUNDO=[];chDraw()}
// Doppelklick: gewünschte Nummer eintippen – der Sender kommt vor den ersten mit dieser oder höherer Nummer
function chAsk(i){const c=CHN[i],v=prompt(L('chn.ask',{name:c.name}),c.number||'');if(v===null)return;
 const n=parseInt(v,10);if(!(n>0&&n<=99999)){msg(L('chn.bad_number',{n:v}));return}
 let to=CHN.findIndex((x,k)=>k!=i&&x.number&&x.number>=n);if(to<0)to=CHN.length;
 chMove(i,to,n)}
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
