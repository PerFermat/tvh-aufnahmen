// Videotext-Fenster: zeichnet Videotext-Seiten (Level 1) auf ein Canvas – Farben, Blockgrafik,
// doppelte Höhe, Blinken, verdeckter Text. Die Seiten liest der Server live aus dem Sender (teletext.py).
const TT={ch:null,page:100,sub:null,data:null,timer:null,flash:true,reveal:false,typed:'',W:12,H:20};
const TTCOL=['#000','#f00','#0f0','#ff0','#00f','#f0f','#0ff','#fff'];
// Nationale Zeichensätze (G0-Ersetzungen an 0x23,24,40,5B–60,7B–7E); Index nach ETS 300 706
const TTNAT={0:'£$@←½→↑#—¼‖¾÷',1:'#$§ÄÖÜ^_°äöüß',2:'#¤ÉÄÖÅÜ_éäöåü',3:'£$é°ç→↑#ùàòèì',4:'éïàëêùîñèâôûç',5:'çü¡ÿÁÍÓÚ¿üñèà',6:'#ůčťžýířéáěúš'};
const TTPOS=[0x23,0x24,0x40,0x5B,0x5C,0x5D,0x5E,0x5F,0x60,0x7B,0x7C,0x7D,0x7E];
const ttNat=nos=>((nos&1)<<2)|(nos&2)|((nos&4)>>2);  // C12–C14 in Sende-Reihenfolge

async function openTeletext(ch,name){TT.ch=ch;TT.page=+store('ttpage-'+ch)||100;TT.sub=null;TT.data=null;TT.typed='';
 dialog(`<h2 style="margin:0 90px 8px 0">${L('common.teletext')} · ${esc(name||'')}</h2>
 <div class="ttwrap"><canvas id="ttc" width="${40*TT.W}" height="${25*TT.H}"></canvas><div id="tttext" class="tttext"></div><div id="ttinfo" class="ttinfo">${L('tt.reading')}</div></div>
 <div class="bar ttbar"><button class="b sec" onclick="ttStep(-1)" title="${L('tt.prev')}">◀</button>
  <input id="ttnum" inputmode="numeric" maxlength="3" value="${TT.page}" onkeydown="if(event.key=='Enter')ttGo(+this.value)" onfocus="this.select()">
  <button class="b sec" onclick="ttStep(1)" title="${L('tt.next')}">▶</button>
  <span class="ttsub"><button class="b sec" onclick="ttSub(-1)" title="${L('tt.prev_sub')}">‹</button><span id="ttsubl">–</span><button class="b sec" onclick="ttSub(1)" title="${L('tt.next_sub')}">›</button></span>
  <button class="b sec" onclick="ttGo(100)">100</button><button class="b sec" onclick="TT.reveal=!TT.reveal;ttDraw();ttTextLayer()" title="${L('tt.reveal')}">?</button>
  <button class="b sec" id="ttcopy" onclick="ttCopy()" title="${L('tt.copy_tip')}">${L('tt.copy')}</button></div>
 <p class="muted small" style="margin:6px 0 0">${L('tt.hint')}</p>`);
 $('#tttext').addEventListener('click',ttClick);$('#tttext').addEventListener('copy',ttCopyEvent);ttSize();const ro=new ResizeObserver(()=>ttSize()&&ttDraw());ro.observe($('#ttc'));
 $('#dlg').addEventListener('close',()=>{clearTimeout(TT.timer);TT.ch=null;ro.disconnect();document.removeEventListener('keydown',ttKey)},{once:true});
 document.addEventListener('keydown',ttKey);ttLoad()}
// in echter Bildschirmauflösung zeichnen (Anzeigebreite × Pixeldichte), sonst wird die Schrift beim Hochskalieren unscharf
function ttSize(){const c=$('#ttc');if(!c||!c.clientWidth)return false;const W=Math.max(8,Math.floor(c.clientWidth*(window.devicePixelRatio||1)/40)),H=Math.round(W*5/3);
 if(W==TT.W&&c.width==40*W)return false;TT.W=W;TT.H=H;c.width=40*W;c.height=25*H;
 const t=$('#tttext').style;t.fontSize=(c.clientHeight/25*0.82)+'px';t.lineHeight=(c.clientHeight/25)+'px';return true}
async function ttLoad(){clearTimeout(TT.timer);if(!TT.ch||!$('#ttc'))return;
 try{const d=await api(`/api/vt?ch=${TT.ch}&p=${TT.page}`+(TT.sub!=null?`&s=${TT.sub}`:''));if(!TT.ch)return;
  const changed=JSON.stringify(d.rows)!==JSON.stringify(TT.data&&TT.data.rows)||JSON.stringify(d.header)!==JSON.stringify(TT.data&&TT.data.header);
  TT.data=d;if(changed){ttDraw();ttTextLayer()}ttInfo()}catch(e){$('#ttinfo').textContent=e.message;$('#ttinfo').hidden=false}
 TT.timer=setTimeout(ttLoad,1500)}
function ttInfo(){const d=TT.data,i=$('#ttinfo');$('#ttnum')!==document.activeElement&&($('#ttnum').value=TT.page);
 $('#ttsubl').textContent=d.subpages.length>1?`${d.subpages.indexOf(d.sub)+1}/${d.subpages.length}`:'–';
 if(d.error){i.textContent=L('tt.unavailable',{err:d.error});i.hidden=false}
 else if(!d.rows){i.textContent=d.pages.length?(d.since<30?L('tt.page_pending',{p:TT.page}):L('tt.page_missing',{p:TT.page})):L('tt.reading');i.hidden=false}
 else i.hidden=true}
function ttGo(p){if(!(p>=100&&p<=899))return;TT.page=p;TT.sub=null;TT.typed='';store('ttpage-'+TT.ch,p);TT.data=null;ttDraw();ttTextLayer();ttLoad()}
function ttStep(d){const ps=(TT.data&&TT.data.pages)||[];const n=d>0?ps.find(p=>p>TT.page):[...ps].reverse().find(p=>p<TT.page);ttGo(n||TT.page+d)}
function ttSub(d){const s=(TT.data&&TT.data.subpages)||[];if(s.length<2)return;const i=(s.indexOf(TT.data.sub)+d+s.length)%s.length;TT.sub=s[i];ttLoad()}
function ttKey(e){if(!TT.ch||e.target.tagName=='INPUT')return;
 if(/^\d$/.test(e.key)){TT.typed+=e.key;$('#ttnum').value=TT.typed.padEnd(3,'-');if(TT.typed.length==3)ttGo(+TT.typed);e.preventDefault()}
 else if(e.key=='ArrowRight')ttStep(1);else if(e.key=='ArrowLeft')ttStep(-1);else if(e.key=='ArrowUp')ttSub(1);else if(e.key=='ArrowDown')ttSub(-1)}
function ttClick(e){const d=TT.data;if(!d||!d.rows||String(getSelection()).trim())return;const r=$('#ttc').getBoundingClientRect();
 const col=Math.floor((e.clientX-r.left)/r.width*40),row=Math.floor((e.clientY-r.top)/r.height*25);
 const line=(row==0?d.header:d.rows[row])||[],s=line.map(b=>b>=0x30&&b<=0x39?String.fromCharCode(b):' ').join('');
 for(const m of s.matchAll(/\d{3}/g))if(col>=m.index-1&&col<=m.index+3){ttGo(+m[0]);return}}

// ---------- Text zum Markieren und Kopieren ----------
// Unsichtbare Textebene über dem Bild: je Zelle ein Zeichen, Blockgrafik und Steuerzeichen als Leerzeichen
function ttLines(){const d=TT.data;if(!d||!d.rows)return [];const nat=TTNAT[ttNat(d.nos)]||TTNAT[1],out=[];let skip=false;
 for(let r=0;r<25;r++){if(skip){skip=false;out.push(' '.repeat(40));continue}
  const row=r==0?(d.header||d.rows[0]):d.rows[r];let mos=false,conc=false,line='';
  for(let x=0;x<40;x++){let b=row[x]||0;if(r==0&&x<8)b=(' P'+TT.page+'    ').charCodeAt(x)||0x20;
   if(b<0x20){if(b<=0x07){mos=false;conc=false}else if(b>=0x10&&b<=0x17){mos=true;conc=false}else if(b==0x18)conc=true;else if(b==0x0D&&r<23)skip=true;line+=' ';continue}
   if((mos&&(b&0x20))||(conc&&!TT.reveal)){line+=' ';continue}
   const k=TTPOS.indexOf(b);line+=b==0x7F?' ':k>=0?nat[k]:String.fromCharCode(b)}
  out.push(line)}
 return out}
function ttTextLayer(){const el=$('#tttext');if(!el)return;const ls=ttLines();
 while(el.children.length<25)el.append(document.createElement('div'));
 // nur geänderte Zeilen ersetzen – die Uhr in der Kopfzeile tickt, eine Markierung darunter soll bleiben
 [...el.children].forEach((row,i)=>{const l=ls[i]||'';if(row.dataset.l===l)return;row.dataset.l=l;
  row.innerHTML=[...l].map(ch=>'<span>'+esc(ch)+'</span>').join('')})}
const ttClean=t=>t.split('\n').map(l=>l.replace(/\s+$/,'')).join('\n').replace(/^\n+|\n+$/g,'');
function ttCopyEvent(e){const t=String(getSelection());if(!t)return;e.clipboardData.setData('text/plain',ttClean(t));e.preventDefault()}
async function ttCopy(){const t=ttClean(ttLines().join('\n')),b=$('#ttcopy');if(!t)return;
 try{await navigator.clipboard.writeText(t)}  // ohne HTTPS gibt es die Zwischenablage-API nicht: alter Weg
 catch(e){const a=document.createElement('textarea');a.value=t;$('#dlg').append(a);a.select();document.execCommand('copy');a.remove()}
 b.textContent=L('tt.copied');setTimeout(()=>b.textContent=L('tt.copy'),1500)}

// ---------- Zeichnen (Level 1) ----------
function ttDraw(){const c=$('#ttc');if(!c)return;const g=c.getContext('2d'),W=TT.W,H=TT.H,d=TT.data;
 g.fillStyle='#000';g.fillRect(0,0,c.width,c.height);if(!d||!d.rows)return;
 const nat=TTNAT[ttNat(d.nos)]||TTNAT[1];let flashUsed=false,skip=false;
 for(let r=0;r<25;r++){if(skip){skip=false;continue}
  const row=r==0?(d.header||d.rows[0]):d.rows[r];
  let fg=7,bg=0,mos=false,sep=false,dbl=false,conc=false,fl=false,hold=false,held=0x20,heldSep=false,rowDbl=false;
  for(let x=0;x<40;x++){let b=row[x]||0;
   if(r==0&&x<8){b=(' P'+TT.page+'    ').charCodeAt(x)||0x20}
   if(b<0x20){ // Steuerzeichen: „set-at“ vor dem Zeichnen
    if(b==0x09)fl=false;else if(b==0x0C){dbl=false;held=0x20}else if(b==0x18)conc=true;else if(b==0x19)sep=false;else if(b==0x1A)sep=true;
    else if(b==0x1C)bg=0;else if(b==0x1D)bg=fg;else if(b==0x1E)hold=true;
    ttCell(g,x,r,(hold&&mos)?held:0x20,fg,bg,mos,heldSep,dbl,false,false,nat);
    // „set-after“
    if(b<=0x07){fg=b;mos=false;conc=false;held=0x20}else if(b>=0x10&&b<=0x17){fg=b-0x10;mos=true;conc=false}
    else if(b==0x08)fl=true;else if(b==0x0D){dbl=true;rowDbl=r<23}else if(b==0x1F)hold=false;
    continue}
   if(fl)flashUsed=true;
   const hide=(fl&&!TT.flash)||(conc&&!TT.reveal);
   const isMos=mos&&(b&0x20);if(isMos){held=b;heldSep=sep}
   ttCell(g,x,r,hide?0x20:b,fg,bg,isMos,sep,dbl,false,false,nat)}
  if(rowDbl)skip=true}
 clearTimeout(TT.ftimer);if(flashUsed)TT.ftimer=setTimeout(()=>{TT.flash=!TT.flash;ttDraw()},TT.flash?900:400)}
function ttCell(g,x,r,b,fg,bg,mos,sep,dbl,_a,_b,nat){const W=TT.W,H=TT.H,h=dbl?2*H:H,X=x*W,Y=r*H;
 g.fillStyle=TTCOL[bg];g.fillRect(X,Y,W,h);if(b==0x20)return;g.fillStyle=TTCOL[fg];
 if(mos){const bits=[b&1,b&2,b&4,b&8,b&16,b&64],xs=[X,X+Math.round(W/2),X+W],ys=[Y,Y+Math.round(h/3),Y+Math.round(2*h/3),Y+h],gap=sep?Math.max(1,Math.round(W/6)):0;
  bits.forEach((on,i)=>{const cx=i%2,cy=Math.floor(i/2);if(on)g.fillRect(xs[cx]+gap,ys[cy]+gap,xs[cx+1]-xs[cx]-gap,ys[cy+1]-ys[cy]-gap)});return}
 if(b==0x7F){g.fillRect(X+1,Y+1,W-2,h-2);return}
 const k=TTPOS.indexOf(b),chr=k>=0?nat[k]:String.fromCharCode(b);
 g.save();g.font=`${Math.round(H*0.82)}px "DejaVu Sans Mono","Courier New",monospace`;g.textBaseline='top';
 g.translate(X,Y+H*0.05);if(dbl)g.scale(1,2);g.fillText(chr,0,0,W);g.restore()}
