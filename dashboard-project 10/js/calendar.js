// ── CALENDAR ─────────────────────────────────────────────────────
const CAL_COLORS=[
  {bg:'#3d7eff',text:'#fff'},
  {bg:'#30d158',text:'#000'},
  {bg:'#ffd60a',text:'#000'},
  {bg:'#ff6b6b',text:'#fff'},
  {bg:'#c47dff',text:'#fff'},
  {bg:'#ff9a3c',text:'#000'},
  {bg:'#4ecdc4',text:'#000'},
  {bg:'#ff6eb4',text:'#fff'},
];
let calYear=new Date().getFullYear(), calMonth=new Date().getMonth();
let calEditId=null;
let calSyncing=false;
window.showJuliaEvents=localStorage.getItem('showJuliaEvents')==='1'; // read by renderTodaySchedule (dashboard.js)

function isJuliaEvent(e){
  const t=(e.title||'').toLowerCase();
  if(['julia','nails','orthodontist','clinic','earrings','suki'].some(k=>t.includes(k)))return true;
  if(['dan','office','timesheet','rdo'].some(k=>t.includes(k)))return false;
  return false;
}
window.toggleJuliaEvents=function(){
  showJuliaEvents=!showJuliaEvents;
  localStorage.setItem('showJuliaEvents',showJuliaEvents?'1':'0');
  renderTodaySchedule();
};

async function syncCalendarEvents(force=false){
  const SIX_HOURS=6*60*60*1000;
  if(!force&&Date.now()-(appData.calendarSyncedAt||0)<SIX_HOURS)return;
  if(calSyncing)return;
  calSyncing=true;
  const btn=document.getElementById('calRefreshBtn');
  if(btn){btn.style.opacity='.5';btn.style.pointerEvents='none';}
  try{
    const res=await fetch('/.netlify/functions/sync-calendar',{method:'POST'});
    if(res.ok){
      const data=await res.json();
      if(data.events){
        appData.calendarEvents=data.events;
        appData.calendarSyncedAt=data.syncedAt||Date.now();
        renderTodaySchedule();
        renderCalendarGrid();
      }
    }
  }catch(e){console.warn('[cal] sync failed',e.message);}
  calSyncing=false;
  if(btn){btn.style.opacity='';btn.style.pointerEvents='';}
}

function calDateStr(y,m,d){return`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}

function renderCalendar(){
  renderCalendarGrid();
  syncCalendarEvents();
}

window.calRefresh=function(){syncCalendarEvents(true);};

function renderCalendarGrid(){
  const today=todayStr();
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInM=daysInMonth(calYear,calMonth);
  const prevDays=daysInMonth(calYear,calMonth-1);
  const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').textContent=MONTHS[calMonth]+' '+calYear;

  // Merge local dashboard events + Apple Calendar events (from Firestore cache) into unified list
  const localEvents=(appData.events||[]).map(e=>({
    id:e.id, name:e.name, date:e.date, endDate:e.endDate||null,
    time:e.time||'', colorIdx:e.colorIdx||0, source:'local',
  }));
  const calEventsNorm=(appData.calendarEvents||[]).map(e=>({
    id:e.id, name:e.title, date:e.startDate, endDate:e.endDate||null,
    time:e.time||'', colorIdx:calColorIdx(e), source:'calendar',
  }));
  const allEvents=[...localEvents,...calEventsNorm];

  const grid=document.getElementById('calGrid');

  // Build 6-row × 7-col cell array
  const cells=[];
  for(let i=0;i<firstDay;i++){
    const pm=calMonth===0?11:calMonth-1, py=calMonth===0?calYear-1:calYear;
    cells.push({y:py,m:pm,d:prevDays-firstDay+1+i,other:true});
  }
  for(let d=1;d<=daysInM;d++) cells.push({y:calYear,m:calMonth,d,other:false});
  const nm=calMonth===11?0:calMonth+1, ny=calMonth===11?calYear+1:calYear;
  for(let d=1;cells.length<42;d++) cells.push({y:ny,m:nm,d,other:true});

  // Lane layout for multi-day events
  const multiEvents=allEvents.filter(e=>e.endDate&&e.endDate>e.date).sort((a,b)=>a.date.localeCompare(b.date));
  const laneMap={}, usedLanes={};
  multiEvents.forEach(e=>{
    const dates=[];
    const sd=new Date(e.date+'T00:00:00'), ed=new Date(e.endDate+'T00:00:00');
    for(let dt=new Date(sd);dt<=ed;dt.setDate(dt.getDate()+1)) dates.push(dt.toISOString().slice(0,10));
    let lane=0;
    while(!dates.every(ds=>!(usedLanes[ds]?.has(lane)))){lane++;if(lane>5)break;}
    dates.forEach((ds,i)=>{
      if(!laneMap[ds])laneMap[ds]=[];
      if(!usedLanes[ds])usedLanes[ds]=new Set();
      usedLanes[ds].add(lane);
      laneMap[ds].push({event:e,lane,isStart:i===0,isEnd:i===dates.length-1});
    });
  });

  grid.innerHTML='';
  cells.forEach(({y,m,d,other})=>{
    const ds=calDateStr(y,m,d);
    const dow=new Date(y,m,d).getDay();
    const rdo=isRDO(ds);
    const cell=document.createElement('div');
    cell.className='cal-cell'+(other?' other-month':'')+(ds===today?' today':'')+(dow===0?' sunday':'')+(rdo?' rdo-day':'');
    cell.onclick=()=>openCalEventModal(ds);

    const num=document.createElement('div');
    num.className='cal-day-num';
    num.textContent=d;
    cell.appendChild(num);
    if(rdo){
      const badge=document.createElement('div');
      badge.className='cal-rdo-badge';
      badge.textContent='RDO';
      cell.appendChild(badge);
    }

    const evtWrap=document.createElement('div');
    evtWrap.className='cal-events';

    const multiForDay=(laneMap[ds]||[]).sort((a,b)=>a.lane-b.lane);
    const usedMultiIds=new Set(multiForDay.map(x=>x.event.id));

    let lastLane=-1;
    multiForDay.forEach(({event:e,lane,isStart,isEnd})=>{
      for(let l=lastLane+1;l<lane;l++){
        const sp=document.createElement('div');sp.style.height='20px';evtWrap.appendChild(sp);
      }
      lastLane=lane;
      const c=CAL_COLORS[e.colorIdx||0];
      const pill=document.createElement('div');
      const isWeekStart=dow===0;
      pill.className='cal-pill'+(isStart?' multiday-start':isEnd?' multiday-end':' multiday-mid');
      pill.style.cssText=`background:${c.bg};color:${c.text};height:20px;display:flex;align-items:center;`;
      if(isStart||isWeekStart) pill.textContent=(e.time?e.time+' ':'')+e.name;
      else pill.innerHTML='&nbsp;';
      pill.onclick=ev=>{ev.stopPropagation();if(e.source==='local')openCalEventModal(ds,e.id);};
      evtWrap.appendChild(pill);
    });

    const singles=allEvents.filter(e=>e.date===ds&&!usedMultiIds.has(e.id)&&!(e.endDate&&e.endDate>e.date));
    const maxVis=Math.max(1,3-multiForDay.length);
    singles.slice(0,maxVis).forEach(e=>{
      const c=CAL_COLORS[e.colorIdx||0];
      const pill=document.createElement('div');
      pill.className='cal-pill';
      pill.style.cssText=`background:${c.bg};color:${c.text};`;
      pill.textContent=(e.time?e.time+' ':'')+e.name;
      pill.onclick=ev=>{ev.stopPropagation();if(e.source==='local')openCalEventModal(ds,e.id);};
      evtWrap.appendChild(pill);
    });
    if(singles.length>maxVis){
      const more=document.createElement('div');
      more.className='cal-more';
      more.textContent=`+${singles.length-maxVis} more`;
      evtWrap.appendChild(more);
    }

    cell.appendChild(evtWrap);
    grid.appendChild(cell);
  });
}

// Assign a consistent color to synced calendar events based on title keywords
function calColorIdx(e){
  const t=(e.title||'').toLowerCase();
  if(t.includes('work')||t.includes('office')||t.includes('rdo')||t.includes('timesheet')) return 0; // blue
  if(t.includes('gym')||t.includes('tennis')||t.includes('barre')||t.includes('workout')) return 1; // green
  if(t.includes('pay')||t.includes('rent')||t.includes('bill')) return 2; // yellow
  if(t.includes('doctor')||t.includes('appointment')||t.includes('clinic')||t.includes('orthodon')) return 3; // red
  if(t.includes('julia')) return 7; // pink
  if(t.includes('trip')||t.includes('travel')||t.includes('camp')) return 6; // teal
  return 4; // purple default for synced calendar events
}

window.calNav=function(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  renderCalendar();
};
window.calGoToday=function(){calYear=new Date().getFullYear();calMonth=new Date().getMonth();renderCalendar();};

window.openCalEventModal=function(dateStr,eventId){
  calEditId=eventId||null;
  const existing=eventId&&(appData.events||[]).find(e=>e.id===eventId);
  document.getElementById('calEventModalTitle').textContent=existing?'Edit Event':'New Event';
  document.getElementById('calEvtName').value=existing?.name||'';
  document.getElementById('calEvtDate').value=existing?.date||(dateStr||todayStr());
  document.getElementById('calEvtEndDate').value=existing?.endDate||'';
  document.getElementById('calEvtTime').value=existing?.time||'';
  document.getElementById('calEvtDeleteBtn').style.display=existing?'':'none';
  const row=document.getElementById('calColorRow');
  row.innerHTML='';
  const selIdx=existing?.colorIdx||0;
  CAL_COLORS.forEach((c,i)=>{
    const sw=document.createElement('div');
    sw.className='cal-color-swatch'+(i===selIdx?' selected':'');
    sw.style.background=c.bg;sw.dataset.idx=i;
    sw.onclick=()=>{row.querySelectorAll('.cal-color-swatch').forEach(s=>s.classList.remove('selected'));sw.classList.add('selected');};
    row.appendChild(sw);
  });
  openModal('calEventModal');
  setTimeout(()=>document.getElementById('calEvtName').focus(),80);
};

window.saveCalEvent=function(){
  const name=document.getElementById('calEvtName').value.trim();
  if(!name)return;
  const date=document.getElementById('calEvtDate').value||todayStr();
  const endDate=document.getElementById('calEvtEndDate').value||'';
  const time=document.getElementById('calEvtTime').value||'';
  const colorIdx=parseInt(document.getElementById('calColorRow').querySelector('.selected')?.dataset.idx||'0');
  if(!appData.events)appData.events=[];
  if(calEditId){
    const e=appData.events.find(e=>e.id===calEditId);
    if(e)Object.assign(e,{name,date,endDate,time,colorIdx});
  } else {
    appData.events.push({id:uid(),name,date,endDate,time,colorIdx});
  }
  saveData();closeModal('calEventModal');renderCalendar();
};

window.deleteCalEvent=function(){
  if(!calEditId)return;
  appData.events=(appData.events||[]).filter(e=>e.id!==calEditId);
  saveData();closeModal('calEventModal');renderCalendar();
};

// ── GLOBAL EXPORTS ──
Object.assign(window, { renderCalendar, renderCalendarGrid, syncCalendarEvents, isJuliaEvent, calColorIdx });
