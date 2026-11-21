// Reiter „Heute Abend“: je Sender die Sendung um 20:15 und die danach, mit Plakat – Klick öffnet die Details
let TND=0,TNDAY=null,TNSEQ=0;// TND: Tage ab heute
const TNSLOT=20*60+15;// Minuten nach Mitternacht
async function renderTonight(){const seq=++TNSEQ,base=new Date();base.setHours(0,0,0,0);base.setDate(base.getDate()+TND);
 const start=Math.floor(base/1000);
 $('#main').innerHTML=`<div class="bar"><span class="seg">${[0,1,2,3,4,5,6].map(d=>{const x=new Date(base);x.setDate(x.getDate()-TND+d);
  return `<button class="${d==TND?'on':''}" onclick="TND=${d};renderTonight()">${d==0?L('tn.today'):d==1?L('tn.tomorrow'):x.toLocaleDateString(LOCALE,{weekday:'short'})}</button>`}).join('')}</span>
  ${listSel('fillTonight()')}<span class="muted">${L('tn.hint')}</span></div><div class="tngrid" id="tngrid"><p class="muted">${L('common.loading')}</p></div>`;
 let day;try{day=await api('/api/epg?start='+start)}catch(e){if(seq==TNSEQ)$('#tngrid').innerHTML='<p class="muted">'+esc(e.message)+'</p>';return}
 if(seq!=TNSEQ||cur!='tonight')return;TNDAY=day;fillTonight();
 if(day.posters_pending)setTimeout(()=>{if(seq==TNSEQ&&cur=='tonight')renderTonight()},15000)}
function fillTonight(){const day=TNDAY,t=day.start+TNSLOT*60+60,by=new Map();
 day.events.forEach(e=>{(by.get(e.channelUuid)||by.set(e.channelUuid,[]).get(e.channelUuid)).push(e)});
 const rows=chFilter(day.channels).map(c=>{const evs=by.get(c.uuid)||[],a=evs.find(e=>e.start<t&&e.stop>t);if(!a)return '';
  const b=evs.find(e=>e.start>=a.stop);
  return `<div class="tncard"><div class="tnch">${c.icon?`<img src="${c.icon}" alt="" loading="lazy">`:''}<b>${esc(c.name)}</b></div>${tnItem(a)}${b?tnItem(b,true):''}</div>`}).join('');
 $('#tngrid').innerHTML=rows||`<p class="muted">${L('tn.none')}</p>`}
const tnItem=(e,later)=>`<a class="tnev${later?' later':''}" onclick="showEvent(${e.eventId})">
 ${e.poster&&!later?`<img class="tnp" src="${esc(e.poster.thumb)}" alt="" loading="lazy" onerror="this.remove()">`:''}
 <span class="muted">${hm(e.start)}–${hm(e.stop)}</span>${e.planned?` <span class="tag conflict">● ${L('tn.rec')}</span>`:''}
 <b>${esc(e.title)}</b>${e.subtitle?`<span class="muted st">${esc(e.subtitle.split('\n')[0])}</span>`:''}</a>`;
