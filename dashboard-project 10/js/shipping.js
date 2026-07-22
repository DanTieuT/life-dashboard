// ── SHIPPING TRACKER ──────────────────────────────────────────────
// Package shape: { id, trackingNumber, carrier, retailer, description,
//   status, statusText, eta, lastUpdate, lastLocation, events:[{time,desc,location}],
//   addedAt, deliveredAt, archived, source:'email'|'manual', registered }
// status is one of STATUS_META keys (17TRACK v2.2 main statuses).

const STATUS_META={
  OutForDelivery:{label:'Out for Delivery',emoji:'🚚',color:'var(--green)',dim:'var(--green-dim)',rank:0},
  AvailableForPickup:{label:'Ready for Pickup',emoji:'📍',color:'var(--green)',dim:'var(--green-dim)',rank:1},
  InTransit:{label:'In Transit',emoji:'📦',color:'var(--blue)',dim:'var(--blue-dim)',rank:2},
  DeliveryFailure:{label:'Delivery Failed',emoji:'⚠️',color:'var(--red)',dim:'var(--red-dim)',rank:3},
  Exception:{label:'Exception',emoji:'⚠️',color:'var(--red)',dim:'var(--red-dim)',rank:4},
  InfoReceived:{label:'Label Created',emoji:'🏷️',color:'var(--yellow)',dim:'var(--yellow-dim)',rank:5},
  NotFound:{label:'Awaiting Scan',emoji:'⏳',color:'var(--muted)',dim:'var(--card2)',rank:6},
  Expired:{label:'Expired',emoji:'🕸️',color:'var(--muted)',dim:'var(--card2)',rank:7},
  Delivered:{label:'Delivered',emoji:'✅',color:'var(--green)',dim:'var(--green-dim)',rank:8},
};
const ARCHIVE_AFTER_DAYS=3;

function pkgStatusMeta(p){return STATUS_META[p.status]||STATUS_META.NotFound;}

function pkgTrackUrl(p){
  const n=encodeURIComponent(p.trackingNumber);
  const c=(p.carrier||'').toLowerCase();
  const num=(p.trackingNumber||'').replace(/\s/g,'').toUpperCase();
  if(/ups/.test(c)||/^1Z[0-9A-Z]{16}$/.test(num))return`https://www.ups.com/track?tracknum=${n}`;
  if(/usps|postal/.test(c)||/^9[0-5][0-9]{14,24}$/.test(num))return`https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if(/fedex/.test(c)||/^[0-9]{12}$|^[0-9]{15}$|^[0-9]{20,22}$/.test(num))return`https://www.fedex.com/fedextrack/?trknbr=${n}`;
  return`https://t.17track.net/en#nums=${n}`;
}

function fmtPkgDate(ts){
  if(!ts)return'';
  const d=new Date(ts);
  if(isNaN(d))return'';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

// Auto-archive delivered packages after a few days (runs on every render).
function autoArchivePackages(){
  const cutoff=Date.now()-ARCHIVE_AFTER_DAYS*86400000;
  let changed=false;
  (appData.packages||[]).forEach(p=>{
    if(p.status==='Delivered'&&!p.archived&&p.deliveredAt&&p.deliveredAt<cutoff){
      p.archived=true;changed=true;
    }
  });
  if(changed)saveData();
}

function pkgCardHTML(p){
  const meta=pkgStatusMeta(p);
  const title=p.description||p.retailer||p.trackingNumber;
  const sub=[p.retailer&&p.description?p.retailer:null,p.carrier||null].filter(Boolean).join(' · ');
  const etaStr=p.status!=='Delivered'&&p.eta?`ETA ${fmtPkgDate(p.eta)}`:'';
  const deliveredStr=p.status==='Delivered'&&p.deliveredAt?`Delivered ${fmtPkgDate(p.deliveredAt)}`:'';
  const lastEvt=(p.events&&p.events[0])?p.events[0]:null;
  const lastLine=p.lastLocation||lastEvt?.location||'';
  return`<div class="pkg-card" data-pkg-id="${p.id}">
    <div class="pkg-status-icon" style="background:${meta.dim}">${meta.emoji}</div>
    <div class="pkg-info" onclick="togglePkgEvents('${p.id}')">
      <div class="pkg-title">${escHtml(title)}</div>
      <div class="pkg-sub">${escHtml(sub)}${sub&&(etaStr||deliveredStr)?' · ':''}${etaStr||deliveredStr}</div>
      ${lastLine?`<div class="pkg-loc">${escHtml(lastLine)}</div>`:''}
      <div class="pkg-events" id="pkgEvents-${p.id}" style="display:none">
        ${(p.events||[]).slice(0,8).map(e=>`<div class="pkg-event"><span class="pkg-event-time">${fmtPkgDate(e.time)}</span> ${escHtml(e.desc||'')}${e.location?` — ${escHtml(e.location)}`:''}</div>`).join('')||'<div class="pkg-event" style="color:var(--muted)">No scan events yet</div>'}
        <div class="pkg-event"><a href="${pkgTrackUrl(p)}" target="_blank" rel="noopener" style="color:var(--blue)">Track on carrier site ↗</a></div>
      </div>
    </div>
    <span class="pkg-status-pill" style="background:${meta.dim};color:${meta.color}">${meta.label}</span>
    <button class="pkg-del" onclick="deletePackage('${p.id}')" title="Remove">✕</button>
  </div>`;
}

function renderShipping(){
  const listEl=document.getElementById('shippingList');
  if(!listEl)return;
  autoArchivePackages();
  const pkgs=(appData.packages||[]).filter(p=>!p.archived)
    .sort((a,b)=>pkgStatusMeta(a).rank-pkgStatusMeta(b).rank||(b.addedAt||0)-(a.addedAt||0));
  if(!pkgs.length){
    listEl.innerHTML=`<div class="empty-state" style="padding:40px;text-align:center">
      <div style="font-size:32px;margin-bottom:10px">📦</div>
      <div style="color:var(--sub);margin-bottom:14px">No packages being tracked</div>
      <button class="btn-new" onclick="openTrackModal()">+ Track a package</button>
    </div>`;
    return;
  }
  const active=pkgs.filter(p=>p.status!=='Delivered');
  const delivered=pkgs.filter(p=>p.status==='Delivered');
  let html='';
  if(active.length)html+=`<div class="pkg-section-hdr">Active (${active.length})</div>`+active.map(pkgCardHTML).join('');
  if(delivered.length)html+=`<div class="pkg-section-hdr" style="margin-top:18px">Recently Delivered</div>`+delivered.map(pkgCardHTML).join('');
  listEl.innerHTML=html;
}

// Compact dashboard widget — the only shipping UI now (no dedicated tab), so it
// shows every active package, not just a capped preview.
function renderDashShippingWidget(){
  const el=document.getElementById('dashShippingWidget');
  if(!el)return;
  const active=(appData.packages||[]).filter(p=>!p.archived&&p.status!=='Delivered')
    .sort((a,b)=>pkgStatusMeta(a).rank-pkgStatusMeta(b).rank);
  if(!active.length){el.style.display='none';return;}
  el.style.display='';
  el.innerHTML=`<div class="section-hdr">
      <div><div class="section-title">📦 Packages</div><div class="section-sub">${active.length} on the way</div></div>
      <button class="btn-new" style="padding:4px 10px;font-size:12px" onclick="openTrackModal()">+ Track</button>
    </div>
    ${active.map(p=>{
      const meta=pkgStatusMeta(p);
      return`<div class="pkg-mini-row">
        <span>${meta.emoji}</span>
        <span class="pkg-mini-name">${escHtml(p.description||p.retailer||p.trackingNumber)}</span>
        <span class="pkg-mini-status" style="color:${meta.color}">${meta.label}${p.eta&&p.status!=='Delivered'?` · ${fmtPkgDate(p.eta)}`:''}</span>
      </div>`;
    }).join('')}`;
}

window.togglePkgEvents=function(id){
  const el=document.getElementById('pkgEvents-'+id);
  if(el)el.style.display=el.style.display==='none'?'':'none';
};

// ── Manual add ────────────────────────────────────────────────────
window.openTrackModal=function(){
  document.getElementById('trackNumber').value='';
  document.getElementById('trackDescription').value='';
  document.getElementById('trackRetailer').value='';
  openModal('trackModal');
  setTimeout(()=>document.getElementById('trackNumber').focus(),80);
};

window.saveTrackModal=function(){
  const num=document.getElementById('trackNumber').value.trim();
  if(!num){toast('Tracking number required','error');return;}
  const desc=document.getElementById('trackDescription').value.trim();
  const retailer=document.getElementById('trackRetailer').value.trim();
  if((appData.packages||[]).some(p=>p.trackingNumber===num&&!p.archived)){
    toast('Already tracking that number','error');return;
  }
  if(!appData.packages)appData.packages=[];
  appData.packages.unshift({
    id:uid(),trackingNumber:num,carrier:'',retailer,description:desc,
    status:'NotFound',statusText:'Added — awaiting first sync',eta:null,
    lastUpdate:Date.now(),lastLocation:'',events:[],
    addedAt:Date.now(),deliveredAt:null,archived:false,source:'manual',registered:false,
  });
  saveData();
  closeModal('trackModal');
  renderShipping();renderDashShippingWidget();
  toast('📦 Tracking added — status syncs within ~2h');
  // Kick an immediate sync so Dan doesn't wait for the cron (best-effort).
  fetch('/.netlify/functions/shipping-sync?trigger=manual').catch(()=>{});
};

window.deletePackage=function(id){
  const idx=(appData.packages||[]).findIndex(p=>p.id===id);
  if(idx<0)return;
  const [removed]=appData.packages.splice(idx,1);
  saveData();
  renderShipping();renderDashShippingWidget();
  toastUndo(removed.description||removed.retailer||removed.trackingNumber,()=>{
    appData.packages.splice(idx,0,removed);
    saveData();
    renderShipping();renderDashShippingWidget();
  });
};

Object.assign(window,{renderShipping,renderDashShippingWidget});
