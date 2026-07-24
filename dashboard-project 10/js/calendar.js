// ── CALENDAR ─────────────────────────────────────────────────────
// Indices 0-7: local-event color picker swatches (see openCalEventModal).
// Indices 8+: fixed per-Apple-calendar colors (see CALENDAR_COLOR_IDX below).
const CAL_COLORS=[
  {bg:'#3d7eff',text:'#fff'},
  {bg:'#30d158',text:'#000'},
  {bg:'#ffd60a',text:'#000'},
  {bg:'#ff6b6b',text:'#fff'},
  {bg:'#c47dff',text:'#fff'},
  {bg:'#ff9a3c',text:'#000'},
  {bg:'#4ecdc4',text:'#000'},
  {bg:'#ff6eb4',text:'#fff'},
  {bg:'#64d2ff',text:'#000'}, // 8  Home — light blue
  {bg:'#32d74b',text:'#000'}, // 9  Work — green
  {bg:'#ff9500',text:'#000'}, // 10 Shared D+J — orange
  {bg:'#ffb6d9',text:'#000'}, // 11 Personal Private — light pink
  {bg:'#0a84ff',text:'#fff'}, // 12 Dan's Calendar — blue
  {bg:'#ff375f',text:'#fff'}, // 13 Julia's Calendar — pink
  {bg:'#8e8e93',text:'#fff'}, // 14 Dan's Work Calendar — grey
];
const CALENDAR_COLOR_IDX={
  'Home':8, 'Work':9, 'Shared D+J':10, 'Personal Private':11,
  'Dan’s Calendar':12, 'Julia’s Calendar':13, 'Dan’s Work Calendar':14,
};
let calYear=new Date().getFullYear(), calMonth=new Date().getMonth();
let calEditId=null;
let calSyncing=false;
let _calTabView='month'; // 'month' | 'week' — Calendar TAB's own toggle (distinct from Tasks page's mini-cal _calView)
let calWeekAnchor=new Date(); // any date within the currently displayed week
window.showJuliaEvents=localStorage.getItem('showJuliaEvents')==='1'; // read by renderTodaySchedule (dashboard.js)

function isJuliaEvent(e){
  if(e.calendarName==='Julia’s Calendar')return true;
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

// Merge local dashboard events + Apple Calendar events (from Firestore cache) into
// one unified list. Each event's colorIdx is pre-resolved here so callers never
// need to branch on source.
function getAllCalEvents(){
  const localEvents=(appData.events||[]).map(e=>({
    id:e.id, name:e.name, date:e.date, endDate:e.endDate||null,
    time:e.time||'', colorIdx:e.colorIdx||0, source:'local',
  }));
  const calEventsNorm=(appData.calendarEvents||[]).map(e=>({
    id:e.id, name:e.title, date:e.startDate, endDate:e.endDate||null,
    time:e.time||'', colorIdx:calColorIdx(e), source:'calendar',
  }));
  return [...localEvents,...calEventsNorm];
}

function renderCalendar(){
  if(_calTabView==='week') renderCalendarWeek();
  else renderCalendarGrid();
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

  const allEvents=getAllCalEvents();

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
      pill.className='cal-pill single';
      pill.innerHTML=`<span class="cal-dot" style="background:${c.bg}"></span><span class="cal-pill-name"></span>${e.time?`<span class="cal-pill-time"></span>`:''}`;
      pill.querySelector('.cal-pill-name').textContent=e.name;
      if(e.time)pill.querySelector('.cal-pill-time').textContent=e.time;
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

// Color synced calendar events by their source Apple calendar; falls back to the
// old title-keyword heuristic if the event's calendar isn't in the fixed color map.
function calColorIdx(e){
  if(e.calendarName&&CALENDAR_COLOR_IDX[e.calendarName]!=null) return CALENDAR_COLOR_IDX[e.calendarName];
  const t=(e.title||'').toLowerCase();
  if(t.includes('work')||t.includes('office')||t.includes('rdo')||t.includes('timesheet')) return 0; // blue
  if(t.includes('gym')||t.includes('tennis')||t.includes('barre')||t.includes('workout')) return 1; // green
  if(t.includes('pay')||t.includes('rent')||t.includes('bill')) return 2; // yellow
  if(t.includes('doctor')||t.includes('appointment')||t.includes('clinic')||t.includes('orthodon')) return 3; // red
  if(t.includes('julia')) return 7; // pink
  if(t.includes('trip')||t.includes('travel')||t.includes('camp')) return 6; // teal
  return 4; // purple default for synced calendar events
}
// Resolve an event straight to its {bg,text} color, for callers outside this
// module (e.g. the dashboard's Today widget) that don't need the raw index.
function calColorFor(e){
  const idx=e.source==='calendar'?calColorIdx(e):(e.colorIdx||0);
  return CAL_COLORS[idx]||CAL_COLORS[0];
}

window.calNav=function(dir){
  if(_calTabView==='week'){
    calWeekAnchor.setDate(calWeekAnchor.getDate()+dir*7);
  } else {
    calMonth+=dir;
    if(calMonth>11){calMonth=0;calYear++;}
    if(calMonth<0){calMonth=11;calYear--;}
  }
  renderCalendar();
};
window.calGoToday=function(){
  calYear=new Date().getFullYear();calMonth=new Date().getMonth();
  calWeekAnchor=new Date();
  renderCalendar();
};

// ── Month/Week toggle for the Calendar tab ──────────────────────────
window.setCalTabView=function(v){
  if(v===_calTabView)return;
  _calTabView=v;
  document.getElementById('calTabViewMonthBtn')?.classList.toggle('active',v==='month');
  document.getElementById('calTabViewWeekBtn')?.classList.toggle('active',v==='week');
  document.getElementById('calDowRow')?.style.setProperty('display',v==='month'?'':'none');
  const gridEl=document.getElementById('calGrid');
  if(gridEl)gridEl.style.display=v==='month'?'':'none';
  const weekEl=document.getElementById('calWeekView');
  if(weekEl)weekEl.style.display=v==='week'?'':'none';
  if(v==='week'){
    const now=new Date();
    calWeekAnchor=(calYear===now.getFullYear()&&calMonth===now.getMonth())?now:new Date(calYear,calMonth,1);
  }
  renderCalendar();
};

function startOfWeek(d){
  const nd=new Date(d);
  nd.setDate(nd.getDate()-nd.getDay());
  nd.setHours(0,0,0,0);
  return nd;
}

function renderCalendarWeek(){
  const today=todayStr();
  const weekStart=startOfWeek(calWeekAnchor);
  const days=Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d;});
  const MONTHS_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const first=days[0], last=days[6];
  const label=first.getMonth()===last.getMonth()
    ?`${MONTHS_SHORT[first.getMonth()]} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`
    :`${MONTHS_SHORT[first.getMonth()]} ${first.getDate()} – ${MONTHS_SHORT[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;
  const lblEl=document.getElementById('calMonthLabel');
  if(lblEl)lblEl.textContent=label;

  const allEvents=getAllCalEvents();
  const wrap=document.getElementById('calWeekView');
  if(!wrap)return;
  wrap.innerHTML='';

  // Day-of-week circle row
  const DOW=['S','M','T','W','T','F','S'];
  const dowRow=document.createElement('div');
  dowRow.className='cal-week-dow-row';
  days.forEach(d=>{
    const ds=calDateStr(d.getFullYear(),d.getMonth(),d.getDate());
    const isToday=ds===today;
    const dayEvt=allEvents.find(e=>e.date===ds||(e.endDate&&e.date<=ds&&e.endDate>=ds));
    const cell=document.createElement('div');
    cell.className='cal-week-dow-cell';
    cell.onclick=()=>openCalEventModal(ds);
    cell.innerHTML=`<div class="cal-week-dow-label">${DOW[d.getDay()]}</div>`+
      `<div class="cal-week-dow-num${isToday?' today':''}">${d.getDate()}</div>`+
      `<div class="cal-week-dow-dot" style="background:${dayEvt?CAL_COLORS[dayEvt.colorIdx].bg:'transparent'}"></div>`;
    dowRow.appendChild(cell);
  });
  wrap.appendChild(dowRow);

  // All-day / multi-day chip row (only shown if there's at least one)
  const allDayByDay=days.map(d=>{
    const ds=calDateStr(d.getFullYear(),d.getMonth(),d.getDate());
    return allEvents.filter(e=>!e.time&&(e.date===ds||(e.endDate&&e.date<=ds&&e.endDate>=ds)));
  });
  if(allDayByDay.some(list=>list.length)){
    const allDayRow=document.createElement('div');
    allDayRow.className='cal-week-allday-row';
    days.forEach((d,i)=>{
      const ds=calDateStr(d.getFullYear(),d.getMonth(),d.getDate());
      const col=document.createElement('div');
      col.className='cal-week-allday-col';
      allDayByDay[i].forEach(e=>{
        const c=CAL_COLORS[e.colorIdx];
        const chip=document.createElement('div');
        chip.className='cal-week-allday-chip';
        chip.style.cssText=`background:${c.bg};color:${c.text}`;
        chip.textContent=e.name;
        chip.onclick=ev=>{ev.stopPropagation();if(e.source==='local')openCalEventModal(ds,e.id);};
        col.appendChild(chip);
      });
      allDayRow.appendChild(col);
    });
    wrap.appendChild(allDayRow);
  }

  // Hourly grid — 6am to 10pm, colored event blocks, red "now" line
  const HOUR_START=6,HOUR_END=22,ROW_H=48;
  const parseTimeMin=t=>{
    const m=/^(\d{1,2}):(\d{2})$/.exec(t||'');
    if(!m)return null;
    return parseInt(m[1],10)*60+parseInt(m[2],10);
  };
  const hourly=document.createElement('div');
  hourly.className='cal-week-hourly';

  const labelsCol=document.createElement('div');
  labelsCol.className='cal-week-hour-labels';
  for(let h=HOUR_START;h<=HOUR_END;h++){
    const lbl=document.createElement('div');
    lbl.className='cal-week-hour-label';
    lbl.textContent=h===12?'12 PM':h<12?`${h} AM`:h===24?'12 AM':`${h-12} PM`;
    labelsCol.appendChild(lbl);
  }
  hourly.appendChild(labelsCol);

  const daysGrid=document.createElement('div');
  daysGrid.className='cal-week-days-grid';
  daysGrid.style.height=`${(HOUR_END-HOUR_START)*ROW_H}px`;

  const linesEl=document.createElement('div');
  linesEl.className='cal-week-hour-lines';
  for(let h=HOUR_START;h<=HOUR_END;h++){
    const line=document.createElement('div');
    line.className='cal-week-hour-line';
    linesEl.appendChild(line);
  }
  daysGrid.appendChild(linesEl);

  const colsEl=document.createElement('div');
  colsEl.className='cal-week-cols';
  const now=new Date();
  const nowMin=now.getHours()*60+now.getMinutes();
  days.forEach(d=>{
    const ds=calDateStr(d.getFullYear(),d.getMonth(),d.getDate());
    const col=document.createElement('div');
    col.className='cal-week-day-col';
    col.onclick=()=>openCalEventModal(ds);
    const timedToday=allEvents.filter(e=>e.date===ds&&!(e.endDate&&e.endDate>e.date)&&parseTimeMin(e.time)!=null);
    timedToday.forEach(e=>{
      const startMin=parseTimeMin(e.time);
      const top=Math.max(0,((startMin-HOUR_START*60)/60)*ROW_H);
      const c=CAL_COLORS[e.colorIdx];
      const block=document.createElement('div');
      block.className='cal-week-evt-block';
      block.style.cssText=`top:${top}px;height:${ROW_H-4}px;background:${c.bg};color:${c.text}`;
      block.textContent=e.name;
      block.onclick=ev=>{ev.stopPropagation();if(e.source==='local')openCalEventModal(ds,e.id);};
      col.appendChild(block);
    });
    if(ds===today&&nowMin>=HOUR_START*60&&nowMin<=HOUR_END*60){
      const nowLine=document.createElement('div');
      nowLine.className='cal-week-now-line';
      nowLine.style.top=`${((nowMin-HOUR_START*60)/60)*ROW_H}px`;
      col.appendChild(nowLine);
    }
    colsEl.appendChild(col);
  });
  daysGrid.appendChild(colsEl);
  hourly.appendChild(daysGrid);
  wrap.appendChild(hourly);
}

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
Object.assign(window, { renderCalendar, renderCalendarGrid, renderCalendarWeek, syncCalendarEvents, isJuliaEvent, calColorIdx, calColorFor });
