import { db, doc, getDoc } from './core.js';

// ── BRAIN DUMP ────────────────────────────────────────────────────
const NOTE_TAGS=[
  {key:'',label:'—',cls:'none'},
  {key:'idea',label:'💡 Idea',cls:'idea'},
  {key:'action',label:'✅ Action',cls:'action'},
  {key:'reference',label:'🔗 Reference',cls:'reference'},
  {key:'car',label:'🚗 Car',cls:'car'},
  {key:'finance',label:'💰 Finance',cls:'finance'},
];
let _brainDumpTagFilter='';
let _showArchivedNotes=false;

window.setBrainDumpTag=function(btn,tag){
  _brainDumpTagFilter=tag;
  document.querySelectorAll('.brain-dump-filter-chip').forEach(b=>b.classList.toggle('active',b.dataset.tag===tag));
  renderBrainDump();
};

window.cycleNoteTag=function(id){
  const n=(appData.notes||[]).find(x=>x.id===id);
  if(!n)return;
  const keys=NOTE_TAGS.map(t=>t.key);
  const cur=keys.indexOf(n.tag||'');
  n.tag=keys[(cur+1)%keys.length];
  saveData();renderBrainDump();
};

window.archiveNote=function(id){
  const n=(appData.notes||[]).find(x=>x.id===id);
  if(!n)return;
  n.archived=true;
  saveData();renderBrainDump();toast('Note archived');
};

window.toggleShowArchivedNotes=function(){
  _showArchivedNotes=!_showArchivedNotes;
  const btn=document.getElementById('showArchivedNotesBtn');
  if(btn)btn.textContent=_showArchivedNotes?'Hide archived notes':'Show archived notes';
  renderBrainDump();
};

window.editNote=function(id){
  const el=document.getElementById('note-text-'+id);
  if(!el)return;
  const n=(appData.notes||[]).find(x=>x.id===id);
  if(!n)return;
  const area=document.createElement('textarea');
  area.className='note-edit-area';
  area.value=n.text;
  area.rows=Math.max(2,n.text.split('\n').length);
  el.style.display='none';
  el.parentNode.insertBefore(area,el);
  area.focus();
  area.onkeydown=e=>{if(e.key==='Escape'){area.remove();el.style.display='';} };
  // show save button
  const saveBtn=document.getElementById('note-savebtn-'+id);
  if(saveBtn)saveBtn.style.display='';
  window['_saveNote_'+id]=function(){
    const val=area.value.trim();
    if(val){n.text=val;saveData();}
    area.remove();el.style.display='';
    if(saveBtn)saveBtn.style.display='none';
    renderBrainDump();
  };
  area.addEventListener('blur',()=>{
    setTimeout(()=>{
      if(document.activeElement!==saveBtn){
        area.remove();el.style.display='';
        if(saveBtn)saveBtn.style.display='none';
      }
    },150);
  });
};

window.convertNoteToTask=function(id){
  const n=(appData.notes||[]).find(x=>x.id===id);
  if(!n)return;
  document.getElementById('editTaskId').value='';
  document.getElementById('taskModalTitle').textContent='New Task';
  document.getElementById('taskModalSaveBtn').textContent='Add task';
  document.getElementById('modalTaskName').value=n.text;
  document.getElementById('modalTaskDue').value=todayStr();
  openModal('newTaskModal');
  setTimeout(()=>document.getElementById('modalTaskName').focus(),80);
  // After save, offer to delete note
  window._noteToTaskId=id;
};

window.convertNoteToProject=function(id){
  const n=(appData.notes||[]).find(x=>x.id===id);
  if(!n)return;
  document.getElementById('projectModalTitle').textContent='New Project';
  document.getElementById('projectEditId').value='';
  document.getElementById('projectName').value=n.text.slice(0,80);
  document.getElementById('projectCategory').value='';
  document.getElementById('projectStage').value='planning';
  document.getElementById('projectPriority').value='';
  document.getElementById('projectNextAction').value='';
  document.getElementById('projectNotes').value='';
  document.getElementById('projectLink').value='';
  document.getElementById('projectDueDate').value='';
  document.getElementById('projectArchiveBtn').style.display='none';
  openModal('projectModal');
};

window.renderBrainDump=renderBrainDump;
function renderBrainDump(){
  const el=document.getElementById('brainDumpList');
  if(!el)return;
  if(!window._dataLoaded){el.innerHTML=window.skeletonHTML;return;}
  let notes=(appData.notes||[]);
  // filter archived
  if(!_showArchivedNotes) notes=notes.filter(n=>!n.archived);
  // filter by tag
  if(_brainDumpTagFilter) notes=notes.filter(n=>(n.tag||'')=== _brainDumpTagFilter);
  // filter by search
  const searchEl=document.getElementById('brainDumpSearch');
  const q=(searchEl?.value||'').trim().toLowerCase();
  if(q) notes=notes.filter(n=>(n.text||'').toLowerCase().includes(q));
  // match count
  const mc=document.getElementById('brainDumpMatchCount');
  if(mc){
    const total=(appData.notes||[]).filter(n=>_showArchivedNotes||!n.archived).length;
    mc.textContent=q?`${notes.length} of ${total} matches`:'';
  }
  if(!notes.length){
    el.innerHTML='<div class="brain-dump-empty">'+(q?'No matching notes':'No notes yet — drop something above or send it to JARVIS')+'</div>';
    return;
  }
  el.innerHTML=notes.map(n=>{
    const d=new Date(n.createdAt||Date.now());
    const ago=fmtTimeAgo(d);
    const src=n.source==='jarvis'?'JARVIS':'you';
    const tagMeta=NOTE_TAGS.find(t=>t.key===(n.tag||''))||NOTE_TAGS[0];
    const archFlag=n.archived?'<span style="font-size:10px;color:var(--muted);background:var(--card2);padding:1px 5px;border-radius:4px;margin-left:4px">archived</span>':'';
    return`<div class="brain-dump-card" id="note-card-${n.id}">
      <div class="brain-dump-card-body">
        <div class="brain-dump-card-text" id="note-text-${n.id}" onclick="editNote('${n.id}')" style="cursor:text">${escHtml(n.text)}</div>
        <div class="brain-dump-card-meta" style="margin-top:6px;gap:8px;flex-wrap:wrap">
          <span class="brain-dump-source">${src}</span>
          <span>${ago}</span>${archFlag}
          <button class="note-tag ${tagMeta.cls}" onclick="event.stopPropagation();cycleNoteTag('${n.id}')" title="Tap to change tag">${tagMeta.label||'tag'}</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <button class="note-save-btn" id="note-savebtn-${n.id}" style="display:none" onclick="window['_saveNote_${n.id}']&&window['_saveNote_${n.id}']()">✓</button>
        <div class="note-actions">
          <button class="note-action-btn" onclick="convertNoteToTask('${n.id}')" title="→ Task">→ Task</button>
          <button class="note-action-btn" onclick="convertNoteToProject('${n.id}')" title="→ Project">→ Proj</button>
          ${!n.archived?`<button class="note-action-btn" onclick="archiveNote('${n.id}')" title="Archive">📦</button>`:''}
          <button class="brain-dump-del" onclick="deleteBrainDumpNote('${n.id}')" title="Delete">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function fmtTimeAgo(d){
  const diff=Math.floor((Date.now()-d.getTime())/1000);
  if(diff<60)return'just now';
  if(diff<3600)return Math.floor(diff/60)+'m ago';
  if(diff<86400)return Math.floor(diff/3600)+'h ago';
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
window.addBrainDumpNote=function(){
  const inp=document.getElementById('brainDumpInput');
  if(!inp)return;
  const text=inp.value.trim();
  if(!text)return;
  if(!appData.notes)appData.notes=[];
  appData.notes.unshift({id:uid(),text,createdAt:Date.now(),source:'dashboard'});
  inp.value='';
  saveData();
  renderBrainDump();
};
// Immediate delete with 6s undo toast (#7)
window.deleteBrainDumpNote=function(id){
  if(!appData.notes)appData.notes=[];
  const idx=appData.notes.findIndex(n=>n.id===id);
  if(idx===-1)return;
  const [removed]=appData.notes.splice(idx,1);
  saveData();
  renderBrainDump();
  const label=(removed.text||'note').slice(0,40)+((removed.text||'').length>40?'…':'');
  toastUndo(label,()=>{
    appData.notes.splice(Math.min(idx,appData.notes.length),0,removed);
    saveData();
    renderBrainDump();
  });
};

// ── GREETING ──────────────────────────────────────────────────────
function renderGreeting(){
  const name=(typeof auth!=='undefined'&&auth.currentUser?.displayName||'Dan').split(' ')[0];
  document.getElementById('greetingText').textContent=`${getGreeting()}, ${name}`;
  const dateEl=document.getElementById('heroDate');
  if(dateEl){
    const now=new Date();
    dateEl.textContent=now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    const today=todayStr();
    const rdoToday=isRDO(today);
    const tomorrow=new Date(now); tomorrow.setDate(now.getDate()+1);
    const rdoTomorrow=isRDO(tomorrow.toLocaleDateString('en-CA'));
    let badge=dateEl.querySelector('.rdo-badge');
    if(rdoToday||rdoTomorrow){
      if(!badge){
        badge=document.createElement('span');
        badge.className='rdo-badge';
        badge.style.cssText='margin-left:8px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:var(--green-dim);color:var(--green);vertical-align:middle';
        dateEl.appendChild(badge);
      }
      badge.textContent=rdoToday?'RDO today':'RDO tomorrow';
      badge.style.display='';
    } else if(badge){
      badge.style.display='none';
    }
  }
}

function updateNavClock(){
  const el=document.getElementById('navClock');
  if(!el)return;
  const now=new Date();
  el.textContent=now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
}
setInterval(updateNavClock,1000);
updateNavClock();

// ── INTENTION ─────────────────────────────────────────────────────
function renderIntention(){
  document.getElementById('intentionInput').value=appData.intention||'';
}
window.saveIntention=()=>{
  appData.intention=document.getElementById('intentionInput').value.trim();
  saveData();
};
// ── GAUGE RING SVG HELPER ─────────────────────────────────────────
function gaugeRingSVG(pct,color,label,sub,size=100){
  const r=size*0.38,cx=size/2,cy=size/2,sw=size*0.09;
  const circ=2*Math.PI*r;
  const offset=circ*(1-Math.min(pct/100,1));
  return`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="gauge-svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${sw}" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
      transform="rotate(-90 ${cx} ${cy})" style="transition:stroke-dashoffset .8s ease"/>
    <text x="${cx}" y="${cy-size*0.06}" text-anchor="middle" dominant-baseline="middle"
      font-family="-apple-system,'SF Pro Display',sans-serif" font-size="${size*0.18}" font-weight="700" fill="var(--text)">${label}</text>
    <text x="${cx}" y="${cy+size*0.13}" text-anchor="middle" dominant-baseline="middle"
      font-family="-apple-system,'SF Pro Display',sans-serif" font-size="${size*0.09}" fill="var(--sub)">${sub}</text>
  </svg>`;
}

// ── STATS ─────────────────────────────────────────────────────────
function renderStats(){
  const today=todayStr();
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  const yStr=yesterday.toISOString().slice(0,10);

  // Tasks done today (completed today) vs yesterday
  const doneAtStr=t=>{if(!t.doneAt)return null;return typeof t.doneAt==='number'?new Date(t.doneAt).toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'}):t.doneAt;};
  const doneTasks=(appData.projects||[]).filter(t=>t.done&&doneAtStr(t)===today).length;
  const yesterdayDone=(appData.projects||[]).filter(t=>t.done&&doneAtStr(t)===yStr).length;
  const activeTotal=(appData.projects||[]).filter(t=>!t.done).length;
  const tdnEl=document.getElementById('tasksDoneNum');if(tdnEl)tdnEl.textContent=doneTasks;
  const ttnEl=document.getElementById('tasksTotalNum');if(ttnEl)ttnEl.textContent=activeTotal;
  const taskDiff=doneTasks-yesterdayDone;
  const taskBadge=document.getElementById('tasksBadge');
  if(taskBadge){taskBadge.textContent=(taskDiff>=0?'↑':'↓')+' '+Math.abs(taskDiff);taskBadge.className='ring-stat-badge'+(taskDiff<0?' red':' green');}

  // Completion: % of daily habits done today
  const dailyHabits=appData.habits.filter(h=>h.type==='daily');
  const doneHabits=dailyHabits.filter(h=>habitDone(h,today)).length;
  const pct=dailyHabits.length?Math.round(doneHabits/dailyHabits.length*100):0;
  const cnEl=document.getElementById('completionNum');if(cnEl)cnEl.textContent=pct;

  // Hero gauge rings
  const totalTasks=(appData.projects||[]).filter(t=>!t.done).length+doneTasks||1;
  const taskPct=doneTasks/totalTasks*100;
  const gl=document.getElementById('heroGaugeLeft');
  const gr=document.getElementById('heroGaugeRight');
  if(gl) gl.innerHTML=gaugeRingSVG(taskPct,'var(--green)',doneTasks,'tasks done');
  if(gr) gr.innerHTML=gaugeRingSVG(pct,'var(--blue)',pct+'%','habits done');

  // Ring stat cards
  const rstTasks=document.getElementById('statsRingTasks');
  if(rstTasks) rstTasks.innerHTML=gaugeRingSVG(taskPct,'var(--blue)',doneTasks,'done',80);
  const rstHabits=document.getElementById('statsRingHabits');
  if(rstHabits) rstHabits.innerHTML=gaugeRingSVG(pct,'var(--cyan)',pct+'%','this week',80);
  const sdn=document.getElementById('statsHabitsDoneN');
  const stn=document.getElementById('statsHabitsTotalN');
  if(sdn) sdn.textContent=doneHabits;
  if(stn) stn.textContent=dailyHabits.length;

  // Budget ring stat
  const rstBudget=document.getElementById('statsRingBudget');
  if(rstBudget){
    const bMonth=currentMonth,bYear=currentYear;
    const budgetAmt=appData.budget.monthly||appData.budget.income||0;
    const bMt=(appData.transactions||[]).filter(t=>{const d=new Date(t.date);return d.getMonth()===bMonth&&d.getFullYear()===bYear;});
    const bSpent=bMt.filter(t=>t.type==='out').reduce((s,t)=>s+t.amount,0);
    const bPct=budgetAmt>0?Math.min(bSpent/budgetAmt*100,100):0;
    const bColor=bPct>=100?'var(--red)':bPct>=80?'var(--yellow)':'var(--orange)';
    rstBudget.innerHTML=gaugeRingSVG(bPct,bColor,fmtM(bSpent),'spent',80);
    const bd=document.getElementById('statsBudgetDetail');
    const bb=document.getElementById('statsBudgetBadge');
    if(bd) bd.textContent=budgetAmt>0?`${fmtM(bSpent)} / ${fmtM(budgetAmt)}`:'set up budget →';
    if(bb){
      // "on track" is meaningless with no budget configured — hide the badge
      bb.style.display=budgetAmt>0?'':'none';
      bb.textContent=bPct>=100?'over budget':bPct>=80?'close to limit':'on track';
      bb.className='ring-stat-badge '+(bPct>=100?'red':bPct>=80?'yellow':'green');
    }
  }
}

function getLast14TaskCounts(){
  return Array.from({length:14},(_,i)=>{
    const d=new Date();d.setDate(d.getDate()-13+i);
    const s=d.toISOString().slice(0,10);
    return (appData.projects||[]).filter(t=>t.done&&(typeof t.doneAt==='number'?new Date(t.doneAt).toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'}):t.doneAt)===s).length;
  });
}
function getLast14HabitCounts(){
  return Array.from({length:14},(_,i)=>{
    const d=new Date();d.setDate(d.getDate()-13+i);
    const s=d.toLocaleDateString('en-CA');
    return appData.habits.filter(h=>habitDone(h,s)).length;
  });
}
function getLast14Completion(){
  const dailyHabits=appData.habits.filter(h=>h.type==='daily');
  if(!dailyHabits.length)return Array(14).fill(0);
  return Array.from({length:14},(_,i)=>{
    const d=new Date();d.setDate(d.getDate()-13+i);
    const s=d.toLocaleDateString('en-CA');
    const done=dailyHabits.filter(h=>habitDone(h,s)).length;
    return Math.round(done/dailyHabits.length*100);
  });
}
function renderMiniChart(id,vals){
  const max=Math.max(...vals,1);
  const el=document.getElementById(id);
  if(!el)return;
  el.innerHTML=vals.map((v,i)=>{
    const h=Math.max(Math.round(v/max*36),3);
    const isToday=i===13;
    const color=isToday?'#30d158':v>0?'rgba(48,209,88,.25)':'var(--border)';
    return `<div class="mini-bar" style="height:${h}px;background:${color}"></div>`;
  }).join('');
}

// ── FOCUS TASKS (auto-pulled from task list) ──────────────────────
function renderFocusTasks(){
  const today=todayStr();
  const all=appData.projects||[];
  // Priority: overdue → today → upcoming (soonest first)
  const overdue=all.filter(t=>!t.done&&t.due&&t.due<today).sort((a,b)=>a.due<b.due?-1:1);
  const todayTasks=all.filter(t=>!t.done&&t.due===today);
  const upcoming=all.filter(t=>!t.done&&t.due&&t.due>today).sort((a,b)=>a.due<b.due?-1:1);
  const noDue=all.filter(t=>!t.done&&!t.due);
  const candidates=[...overdue,...todayTasks,...upcoming,...noDue].slice(0,3);
  const el=document.getElementById('focusTasksList');
  if(!window._dataLoaded){el.innerHTML=window.skeletonHTML;return;}
  if(!candidates.length){
    el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:18px 0;text-align:center">No tasks yet — add some in Tasks tab</div>';
    return;
  }
  const slots=[0,1,2].map(i=>candidates[i]||null);
  el.innerHTML=slots.map((t,i)=>{
    if(!t)return`<div class="focus-item" style="opacity:.25"><div class="focus-num">${i+1}</div><span class="focus-text">—</span></div>`;
    const done=t.done;
    let dueLabel='';
    if(t.due){
      if(t.due<today)dueLabel=`<span style="font-size:11px;color:var(--red);margin-left:auto;flex-shrink:0">${humanDate(t.due,today)}</span>`;
      else if(t.due===today)dueLabel=`<span style="font-size:11px;color:var(--yellow);margin-left:auto;flex-shrink:0">Today</span>`;
      else dueLabel=`<span style="font-size:11px;color:var(--muted);margin-left:auto;flex-shrink:0">${humanDate(t.due,today)}</span>`;
    }
    return`<div class="focus-item" onclick="toggleTask('${t.id}')">
      <div class="focus-num${done?' done':''}">${done?'✓':i+1}</div>
      <span class="focus-text has-text${done?' done-text':''}">${t.name}</span>
      ${dueLabel}
    </div>`;
  }).join('');
}
// ── TODAY SCHEDULE ────────────────────────────────────────────────
function renderTodaySchedule(){
  const today=todayStr();
  const local=(appData.events||[]).filter(e=>e.date===today).map(e=>({
    id:e.id, name:e.name, time:e.time||'', source:'local',
  }));
  const tt=(appData.timetreeEvents||[]).filter(e=>{
    if(e.startDate!==today)return false;
    if(!showJuliaEvents&&isTTJuliaEvent(e))return false;
    return true;
  }).map(e=>({
    id:e.id, name:e.title, time:e.time||'', allDay:e.allDay, source:'timetree',
  }));
  // Update Julia toggle button state
  const jtBtn=document.getElementById('juliaToggleBtn');
  if(jtBtn){jtBtn.style.opacity=showJuliaEvents?'1':'0.45';jtBtn.title=showJuliaEvents?'Hide Julia\'s events':'Show Julia\'s events';}
  const events=[...local,...tt].sort((a,b)=>{
    if(!a.time&&!b.time)return 0;
    if(!a.time)return 1; if(!b.time)return -1;
    return a.time.localeCompare(b.time);
  });
  const badge=document.getElementById('eventsBadge');
  if(badge)badge.textContent=events.length+' event'+(events.length!==1?'s':'');
  const el=document.getElementById('todayEventsList');
  if(!el)return;
  if(!window._dataLoaded){el.innerHTML=window.skeletonHTML;return;}
  if(!events.length){
    el.innerHTML='<div class="evt-empty">No events today — add one below</div>';
    return;
  }
  const now=new Date();
  const nowMins=now.getHours()*60+now.getMinutes();
  let foundNext=false;
  const rows=events.map(e=>{
    let status,cls;
    if(e.allDay){status='All day';cls='upcoming';}
    else if(!e.time){status='All day';cls='upcoming';}
    else{
      const [hh,mm]=(e.time||'00:00').split(':').map(Number);
      const eMins=hh*60+mm, diff=eMins-nowMins;
      if(diff<-30){status='Done';cls='done';}
      else if(diff<=0&&diff>-30){status='Now';cls='now';}
      else if(!foundNext){foundNext=true;status='Next';cls='next';}
      else{status='Upcoming';cls='upcoming';}
    }
    const isBold=cls==='now';
    const ttBadge=e.source==='timetree'?`<span style="font-size:9px;font-weight:700;letter-spacing:.5px;background:rgba(10,132,255,.15);color:var(--blue);padding:2px 5px;border-radius:4px;margin-left:5px">TT</span>`:'';
    const delBtn=e.source==='local'?`<button onclick="deleteEvent('${e.id}')" style="background:none;border:none;color:var(--muted);font-size:14px;margin-left:6px">✕</button>`:'';
    return `<div class="evt-row">
      <div class="evt-time">${e.time||'—'}</div>
      <div class="evt-name${isBold?' bold':cls==='done'?' muted':''}">${e.name}${ttBadge}</div>
      <div class="evt-status">
        <span class="sbadge ${cls}">${status}</span>
        ${delBtn}
      </div>
    </div>`;
  });
  el.innerHTML=`<div class="evt-table-head"><span>TIME</span><span>EVENT</span><span style="text-align:right">STATUS</span></div>`+rows.join('');
}

window.deleteEvent=function(id){
  appData.events=(appData.events||[]).filter(e=>e.id!==id);
  saveData();renderTodaySchedule();
};
// ── WEEKLY REVIEW ─────────────────────────────────────────────────
window.openWeeklyReview=function(){
  const body=document.getElementById('weeklyReviewBody');
  const today=new Date();
  const dayOfWeek=today.getDay(); // 0=Sun
  const weekStart=new Date(today);weekStart.setDate(today.getDate()-dayOfWeek);
  const weekDays=[];
  for(let i=0;i<7;i++){const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);weekDays.push(d.toLocaleDateString('en-CA'));}
  const weekLabel=weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' – '+today.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  // Habits
  const habits=appData.habits.filter(h=>h.type==='daily');
  const habitRows=habits.map(h=>{
    const days=weekDays.filter(d=>d<=todayStr());
    const done=days.filter(d=>habitDone(h,d)).length;
    const dots=days.map(d=>{
      const c=habitDone(h,d)?HABIT_COLORS_DARK[typeof h.colorIdx==='number'?h.colorIdx:0].dot:'var(--card2)';
      return `<div class="review-dot" style="background:${c}"></div>`;
    }).join('');
    return `<div class="review-habit-row">
      <span style="font-size:16px">${h.emoji||'⭐'}</span>
      <span style="flex:1">${h.name}</span>
      <div class="review-habit-dots">${dots}</div>
      <span style="color:var(--sub);min-width:36px;text-align:right">${done}/${days.length}</span>
    </div>`;
  }).join('');
  // Tasks
  const tasksDone=(appData.focusTasks||[]).filter(t=>t.done&&weekDays.includes(t.completedDate||'')).length;
  const tasksTotal=(appData.focusTasks||[]).length;
  // Spending
  const weekSpent=(appData.transactions||[]).filter(t=>t.type==='out'&&weekDays.includes(t.date)).reduce((s,t)=>s+t.amount,0);
  const weekIncome=(appData.transactions||[]).filter(t=>t.type==='in'&&weekDays.includes(t.date)).reduce((s,t)=>s+t.amount,0);
  // Goals progress
  const goals=(appData.goals||[]).map(g=>{
    const current=g.linkedAccountId?(appData.accounts||[]).find(a=>a.id===g.linkedAccountId)?.balance??g.current:g.current;
    const pct=g.target?Math.round(current/g.target*100):0;
    return `<div class="review-stat-row"><span>${g.emoji||'🎯'} ${g.name}</span><span class="review-stat-val">${pct}%</span></div>`;
  }).join('');
  body.innerHTML=`
    <div style="font-size:12px;color:var(--sub);margin-bottom:16px">Week of ${weekLabel}</div>
    <div class="review-section">
      <div class="review-section-title">Daily Habits</div>
      ${habitRows||'<div style="color:var(--muted);font-size:13px">No daily habits tracked</div>'}
    </div>
    <div class="review-section">
      <div class="review-section-title">Tasks & Spending</div>
      <div class="review-stat-row"><span>Tasks completed</span><span class="review-stat-val">${tasksDone}</span></div>
      <div class="review-stat-row"><span>Spent this week</span><span class="review-stat-val">${fmtM(weekSpent)}</span></div>
      ${weekIncome>0?`<div class="review-stat-row"><span>Income this week</span><span class="review-stat-val">${fmtM(weekIncome)}</span></div>`:''}
    </div>
    ${goals?`<div class="review-section"><div class="review-section-title">Goals Progress</div>${goals}</div>`:''}
  `;
  openModal('weeklyReviewModal');
};
window.sendWeeklyReviewToTelegram=async function(){
  const btn=document.getElementById('sendReviewBtn');
  btn.textContent='Sending…';btn.disabled=true;
  try{
    const today=new Date();
    const dayOfWeek=today.getDay();
    const weekStart=new Date(today);weekStart.setDate(today.getDate()-dayOfWeek);
    const weekDays=[];
    for(let i=0;i<7;i++){const d=new Date(weekStart);d.setDate(weekStart.getDate()+i);weekDays.push(d.toLocaleDateString('en-CA'));}
    const habits=appData.habits.filter(h=>h.type==='daily');
    const habitLines=habits.map(h=>{
      const days=weekDays.filter(d=>d<=todayStr());
      const done=days.filter(d=>habitDone(h,d)).length;
      return `${h.emoji||'•'} ${h.name}: ${done}/${days.length}`;
    }).join('\n');
    const weekSpent=(appData.transactions||[]).filter(t=>t.type==='out'&&weekDays.includes(t.date)).reduce((s,t)=>s+t.amount,0);
    const tasksDone=(appData.focusTasks||[]).filter(t=>t.done&&weekDays.includes(t.completedDate||'')).length;
    const goalsLines=(appData.goals||[]).map(g=>{
      const current=g.linkedAccountId?(appData.accounts||[]).find(a=>a.id===g.linkedAccountId)?.balance??g.current:g.current;
      const pct=g.target?Math.round(current/g.target*100):0;
      return `${g.emoji||'🎯'} ${g.name}: ${pct}% (${fmt(current)} / ${fmt(g.target)})`;
    }).join('\n');
    const msg=`📊 Weekly Review\n\nHabits:\n${habitLines}\n\nTasks done: ${tasksDone}\nSpent: ${fmt(weekSpent)}${goalsLines?'\n\nGoals:\n'+goalsLines:''}`;
    await fetch('/.netlify/functions/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,skipAI:true})});
    toast('✓ Sent to JARVIS');
  }catch(e){toast('Error sending');}
  btn.textContent='Send to JARVIS';btn.disabled=false;
};
// ── EVENTS ────────────────────────────────────────────────────────
window.openAddEventModal=function(date){
  document.getElementById('newEvtDate').value=date||todayStr();
  openModal('addEventModal');
};
window.saveEvent=function(){
  const name=document.getElementById('newEvtName').value.trim();
  const time=document.getElementById('newEvtTime').value;
  const date=document.getElementById('newEvtDate').value||todayStr();
  if(!name||!time)return;
  if(!appData.events)appData.events=[];
  appData.events.push({id:uid(),name,time,date});
  saveData();
  document.getElementById('newEvtName').value='';
  document.getElementById('newEvtTime').value='';
  document.getElementById('newEvtDate').value='';
  closeModal('addEventModal');renderTodaySchedule();if(_calView==='month')renderMonthCalendar();else renderWeekCalendar();toast('✓ Event added');
};
// ── AI CHAT ───────────────────────────────────────────────────────
window.toggleChat=function(){
  const panel=document.getElementById('chatPanel');
  panel.classList.toggle('open');
  if(panel.classList.contains('open'))document.getElementById('chatInput').focus();
};

// ── WEATHER ───────────────────────────────────────────────────────
let _weatherCache=null,_weatherCachedAt=0;
function _wmoDesc(code){
  if(code===0)return'Clear sky';
  if(code<=3)return'Partly cloudy';
  if(code<=48)return'Foggy';
  if(code<=55)return'Drizzling';
  if(code<=65)return'Rainy';
  if(code<=75)return'Snowy';
  if(code<=82)return'Rain showers';
  if(code<=99)return'Thunderstorms';
  return'Cloudy';
}
async function fetchWeather(){
  if(_weatherCache&&Date.now()-_weatherCachedAt<30*60*1000)return _weatherCache;
  try{
    const pos=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:5000}));
    const{latitude:lat,longitude:lon}=pos.coords;
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=1`);
    const d=await r.json();
    const c=d.current;
    _weatherCache={temp:Math.round(c.temperature_2m),feelsLike:Math.round(c.apparent_temperature),description:_wmoDesc(c.weather_code),rain:c.rain>0||c.precipitation>0,wind:Math.round(c.wind_speed_10m)};
    _weatherCachedAt=Date.now();
    return _weatherCache;
  }catch{return null;}
}

function buildChatContext(weather){
  const today=todayStr();
  const dayName=new Date().toLocaleDateString('en-US',{weekday:'long'});
  const monthName=new Date().toLocaleDateString('en-US',{month:'long'});
  const tasks=(appData.focusTasks||[]).filter(t=>!t.done).map(t=>({id:t.id,name:t.name,due:t.due||''}));
  const habits=(appData.habits||[]).map(h=>({id:h.id,name:h.name,type:h.type}));
  const events=(appData.events||[]).filter(e=>e.date===today).sort((a,b)=>a.time.localeCompare(b.time)).map(e=>({time:e.time,name:e.name}));
  const budget=appData.budget?.monthly||appData.budget?.income||0;
  const now=new Date();
  const spent=Math.round((appData.transactions||[]).filter(t=>{
    const d=new Date(t.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()&&t.type==='out';
  }).reduce((s,t)=>s+t.amount,0));
  const projects=(appData.userProjects||[]).map(p=>({id:p.id,name:p.name,emoji:p.emoji||'🔨',stage:p.stage,nextAction:p.nextAction||''}));
  // #29: Budget alerts
  const income=Math.round((appData.transactions||[]).filter(t=>{
    const d=new Date(t.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()&&t.type==='in';
  }).reduce((s,t)=>s+t.amount,0));
  const pct=budget>0?Math.round(spent/budget*100):0;
  let budgetAlert=pct>=80?`Spending at ${pct}% of monthly budget ($${spent} of $${Math.round(budget)})`:'';
  const catBudgets=appData.categoryBudgets||{};
  const overBudgetCats=Object.entries(catBudgets).filter(([cat,limit])=>{
    const catSpent=(appData.transactions||[]).filter(t=>{const d=new Date(t.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()&&t.type==='out'&&t.category===cat;}).reduce((s,t)=>s+t.amount,0);
    return catSpent>limit;
  }).map(([cat])=>cat);
  if(overBudgetCats.length)budgetAlert+=(budgetAlert?' · ':'')+`Over budget: ${overBudgetCats.join(', ')}`;
  const savingsRate=income>0?Math.round((income-spent)/income*100):null;
  const nowTime=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
  const reminders=(appData.reminders||[]).filter(r=>!r.sent).sort((a,b)=>a.dueAt-b.dueAt).slice(0,10).map(r=>({
    id:r.id,text:r.text,recurrence:r.recurrence||'',when:fmtReminderWhen(r.dueAt),
  }));
  return{today,dayName,monthName,tasks,habits,events,budget:Math.round(budget),spent,projects,weather:weather||null,monthlyIncome:income,savingsRate,budgetAlert,nowTime,reminders};
}

function appendChatMsg(text,cls){
  const el=document.createElement('div');
  el.className=`chat-msg ${cls}`;
  el.textContent=text;
  const messages=document.getElementById('chatMessages');
  messages.appendChild(el);
  messages.scrollTop=messages.scrollHeight;
  return el;
}

async function executeActions(actions){
  const today=todayStr();
  const labels=[];
  for(const action of (actions||[])){
    switch(action.type){
      case 'add_task':
        appData.projects.push({id:uid(),name:action.name,due:action.due||'',done:false,created:today});
        labels.push(`Added: ${action.name}`);
        break;
      case 'complete_task':{
        const t=appData.projects.find(p=>p.id===action.id);
        if(t){t.done=true;t.doneAt=today;labels.push(`✓ ${t.name}`);}
        break;}
      case 'delete_task':
        appData.projects=appData.projects.filter(p=>p.id!==action.id);
        labels.push('Task removed');
        break;
      case 'log_habit':{
        const h=appData.habits.find(h=>h.id===action.id);
        if(h){if(!h.log)h.log={};h.log[today]=true;labels.push(`Logged: ${h.name}`);}
        break;}
      case 'add_event':
        if(!appData.events)appData.events=[];
        appData.events.push({id:uid(),name:action.name,time:action.time,date:action.date||today});
        labels.push(`Event: ${action.name}`);
        break;
      case 'add_transaction':
        appData.transactions.push({id:uid(),name:action.name,amount:action.amount,category:action.category,type:action.transactionType||'out',date:today});
        labels.push(`$${action.amount} – ${action.name}`);
        break;
      case 'set_intention':
        appData.intention=action.text;
        const iEl=document.getElementById('intentionInput');
        if(iEl)iEl.value=action.text;
        labels.push('Intention set');
        break;
      case 'add_project':
        if(!appData.userProjects)appData.userProjects=[];
        appData.userProjects.push({id:uid(),emoji:action.emoji||'🔨',name:action.name,stage:action.stage||'planning',nextAction:action.nextAction||'',created:today});
        labels.push(`Project: ${action.name}`);
        break;
      case 'update_project_stage':{
        const proj=(appData.userProjects||[]).find(p=>p.id===action.id);
        if(proj){proj.stage=action.stage;labels.push(`${proj.name} → ${action.stage}`);}
        break;}
      case 'update_project_next_action':{
        const proj2=(appData.userProjects||[]).find(p=>p.id===action.id);
        if(proj2){proj2.nextAction=action.nextAction;labels.push(`Updated next action for ${proj2.name}`);}
        break;}
      case 'add_reminder':{
        // date/time are PT; the browser runs in Dan's local (PT) timezone
        const dueAt=new Date(`${action.date}T${action.time||'09:00'}:00`).getTime();
        if(!dueAt||isNaN(dueAt))break;
        if(!appData.reminders)appData.reminders=[];
        appData.reminders.push({id:uid(),text:action.text||'Reminder',dueAt,recurrence:action.recurrence||'',sent:false,createdAt:Date.now(),source:'dashboard'});
        labels.push(`⏰ ${action.text}`);
        break;}
      case 'cancel_reminder':{
        const before=(appData.reminders||[]).length;
        appData.reminders=(appData.reminders||[]).filter(r=>r.id!==action.id);
        if(before!==appData.reminders.length)labels.push('Reminder cancelled');
        break;}
    }
  }
  if(labels.length){saveData();renderAll();}
  return labels;
}

let _currentAudio=null;
let _speechQueue=null;
let _speechAbort=false;

function _cleanForSpeech(text){
  return text.replace(/\*\*(.+?)\*\*/g,'$1').replace(/\*(.+?)\*/g,'$1').replace(/`(.+?)`/g,'$1').replace(/#{1,6}\s/g,'').replace(/\[(.+?)\]\(.+?\)/g,'$1');
}

function _splitChunks(text){
  // First chunk = just the opening sentence so it generates fast and plays immediately
  const firstBreak=text.search(/[.!?]/);
  const first=(firstBreak>0&&firstBreak<text.length-1)?text.slice(0,firstBreak+1).trim():null;
  const remainder=first?text.slice(firstBreak+1).trim():text;
  // Split remainder into ~150 char chunks
  const parts=remainder.split(/(?<=[.!?\n])\s+/).map(s=>s.trim()).filter(Boolean);
  const rest=[];let buf='';
  for(const s of parts){
    const candidate=buf?buf+' '+s:s;
    if(candidate.length>150&&buf){rest.push(buf);buf=s;}else buf=candidate;
  }
  if(buf)rest.push(buf);
  return first?[first,...rest]:(rest.length?rest:[text]);
}

function _fetchChunk(text){
  return fetch('/.netlify/functions/speak',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text,voice:'alloy',speed:1.15})
  }).then(r=>r.json()).catch(()=>null);
}

function _prefetchSpeech(text){
  // Fire all chunk fetches in parallel immediately
  const chunks=_splitChunks(_cleanForSpeech(text));
  _speechQueue=chunks.map(c=>_fetchChunk(c));
}

function _abortSpeech(){
  _speechAbort=true;
  _speechQueue=null;
  if(_currentAudio){_currentAudio.pause();_currentAudio=null;}
}

async function speakReply(text){
  _abortSpeech();
  _speechAbort=false;
  const clean=_cleanForSpeech(text);
  const chunks=_splitChunks(clean);
  const queue=_speechQueue||chunks.map(c=>_fetchChunk(c));
  _speechQueue=null;
  for(let i=0;i<queue.length;i++){
    if(_speechAbort)break;
    const data=await queue[i];
    if(!data||data.error||_speechAbort)break;
    await new Promise(resolve=>{
      const audio=new Audio('data:audio/mpeg;base64,'+data.audio);
      _currentAudio=audio;
      audio.onended=()=>{_currentAudio=null;resolve();};
      audio.onerror=()=>{_currentAudio=null;resolve();};
      audio.play().catch(resolve);
    });
  }
  _currentAudio=null;
}

let _chatHistory=[];

const ACTIONS_MARKER='<<<ACTIONS>>>';

// Consume the chat SSE stream, appending tokens live into msgEl (#23).
// Returns {reply, actions}.
async function _consumeChatStream(res,msgEl){
  const messages=document.getElementById('chatMessages');
  const reader=res.body.getReader();
  const dec=new TextDecoder();
  let buf='',full='';
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    buf+=dec.decode(value,{stream:true});
    let idx;
    while((idx=buf.indexOf('\n\n'))>-1){
      const rawEvent=buf.slice(0,idx);
      buf=buf.slice(idx+2);
      for(const line of rawEvent.split('\n')){
        if(!line.startsWith('data:'))continue;
        const payload=line.slice(5).trim();
        if(!payload)continue;
        try{
          const d=JSON.parse(payload);
          if(d.text){
            full+=d.text;
            // Never show the actions block — only text before the marker
            msgEl.textContent=full.split(ACTIONS_MARKER)[0].trimStart();
            messages.scrollTop=messages.scrollHeight;
          }
        }catch(e){}
      }
    }
  }
  let reply=full,actions=[];
  const mi=full.indexOf(ACTIONS_MARKER);
  if(mi>-1){
    reply=full.slice(0,mi).trim();
    try{actions=JSON.parse(full.slice(mi+ACTIONS_MARKER.length).trim());}catch(e){}
  }else{
    reply=full.trim();
    // Safety: if the model wrapped everything in the legacy JSON shape, unwrap it
    if(reply.startsWith('{')){
      try{const p=JSON.parse(reply);if(p.reply){reply=p.reply;actions=p.actions||[];}}catch(e){}
    }
  }
  msgEl.textContent=reply;
  return{reply,actions};
}

window.sendChat=async function(){
  const input=document.getElementById('chatInput');
  const msg=input.value.trim();
  if(!msg)return;
  appendChatMsg(msg,'user');
  input.value='';
  const thinkEl=appendChatMsg('Thinking…','ai thinking');
  const sendBtn=document.getElementById('chatSendBtn');
  sendBtn.disabled=true;
  try{
    const res=await fetch('/.netlify/functions/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg,context:buildChatContext(await fetchWeather()),history:_chatHistory})
    });
    if(!res.ok)throw new Error('HTTP '+res.status);
    const ctype=res.headers.get('content-type')||'';
    let reply,actions,msgEl;
    if(ctype.includes('text/event-stream')&&res.body){
      // Streaming path — append tokens live
      thinkEl.remove();
      msgEl=appendChatMsg('','ai');
      ({reply,actions}=await _consumeChatStream(res,msgEl));
    }else{
      // Fallback: plain JSON (local dev / older function)
      const data=await res.json();
      reply=data.reply;actions=data.actions||[];
      thinkEl.remove();
      msgEl=appendChatMsg(reply,'ai');
    }
    _chatHistory.push({role:'user',content:msg});
    _chatHistory.push({role:'assistant',content:reply});
    if(_chatHistory.length>40)_chatHistory=_chatHistory.slice(-40);
    if(voiceMode)_prefetchSpeech(reply);
    const labels=await executeActions(actions);
    if(labels.length){
      const row=document.createElement('div');
      row.className='chat-actions-row';
      labels.forEach(l=>{const b=document.createElement('span');b.className='chat-action-tag';b.textContent=l;row.appendChild(b);});
      msgEl.appendChild(row);
    }
    if(voiceMode){await speakReply(reply);if(voiceMode)startListening();}
  }catch(e){
    thinkEl.remove();
    appendChatMsg('Could not reach the AI. Make sure the Netlify function is deployed and ANTHROPIC_API_KEY is set.','ai');
    if(voiceMode)startListening();
  }
  sendBtn.disabled=false;
  document.getElementById('chatMessages').scrollTop=9999;
};
// ── UPDATE GREETING EVERY MINUTE ──────────────────────────────────
setInterval(renderGreeting,60000);

// Avatar click handled by sidebar-user button
// ── VOICE INPUT (Whisper STT via MediaRecorder) ───────────────────
let isListening=false;
let voiceMode=false;
let _mediaRecorder=null;
let _audioChunks=[];
let _audioCtx=null;
let _silenceInterval=null;

window.toggleMic=function(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    toast('Microphone not available in this browser.','error');return;
  }
  if(isListening){voiceMode=false;_stopRecording(false);return;}
  _abortSpeech();
  voiceMode=true;
  startListening();
};

async function startListening(){
  const micBtn=document.getElementById('chatMicBtn');
  const chatInput=document.getElementById('chatInput');
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}
  catch(e){toast('Mic error: '+e.message,'error');return;}

  // Silence detection via AnalyserNode
  _audioCtx=new AudioContext();
  const analyser=_audioCtx.createAnalyser();
  analyser.fftSize=512;
  _audioCtx.createMediaStreamSource(stream).connect(analyser);
  const pcm=new Uint8Array(analyser.frequencyBinCount);

  // MediaRecorder
  _audioChunks=[];
  const mimeType=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
  _mediaRecorder=new MediaRecorder(stream,{mimeType});
  _mediaRecorder.ondataavailable=e=>{if(e.data.size>0)_audioChunks.push(e.data);};
  _mediaRecorder.onstop=_transcribeAudio;
  _mediaRecorder.start(100);

  isListening=true;
  micBtn.classList.add('listening');
  micBtn.textContent='🔴';
  chatInput.placeholder='Listening…';

  // Detect silence: stop when >1.8s of quiet after speech starts
  let speechStarted=false,silenceStart=null,speechAt=null;
  const SPEECH_ON=15,SPEECH_OFF=8,SILENCE_MS=1800,MIN_SPEECH_MS=250;
  _silenceInterval=setInterval(()=>{
    analyser.getByteTimeDomainData(pcm);
    const rms=Math.sqrt(pcm.reduce((s,v)=>s+Math.pow(v-128,2),0)/pcm.length);
    if(!speechStarted){
      if(rms>SPEECH_ON){speechStarted=true;speechAt=Date.now();silenceStart=null;}
    }else{
      if(rms<SPEECH_OFF){
        if(!silenceStart)silenceStart=Date.now();
        else if(Date.now()-silenceStart>SILENCE_MS&&Date.now()-speechAt>MIN_SPEECH_MS+SILENCE_MS){
          _stopRecording(true);
        }
      }else{silenceStart=null;}
    }
  },80);
}

function _stopRecording(transcribe){
  clearInterval(_silenceInterval);
  if(_audioCtx){_audioCtx.close();_audioCtx=null;}
  isListening=false;
  const micBtn=document.getElementById('chatMicBtn');
  const chatInput=document.getElementById('chatInput');
  micBtn.classList.remove('listening');
  micBtn.textContent='🎤';
  if(!transcribe){
    chatInput.placeholder='Ask me anything...';
    _audioChunks=[];
    if(_mediaRecorder&&_mediaRecorder.state!=='inactive'){
      _mediaRecorder.stream.getTracks().forEach(t=>t.stop());
      _mediaRecorder.stop();
    }
    return;
  }
  chatInput.placeholder='Transcribing…';
  if(_mediaRecorder&&_mediaRecorder.state!=='inactive'){
    _mediaRecorder.stop(); // triggers onstop → _transcribeAudio
    _mediaRecorder.stream.getTracks().forEach(t=>t.stop());
  }
}

async function _transcribeAudio(){
  const chatInput=document.getElementById('chatInput');
  if(!_audioChunks.length){
    chatInput.placeholder='Ask me anything...';
    if(voiceMode)setTimeout(startListening,300);
    return;
  }
  const mimeType=_mediaRecorder?(_mediaRecorder.mimeType||'audio/webm'):'audio/webm';
  const blob=new Blob(_audioChunks,{type:mimeType});
  _audioChunks=[];
  try{
    const b64=await new Promise((res,rej)=>{
      const r=new FileReader();
      r.onloadend=()=>res(r.result.split(',')[1]);
      r.onerror=rej;
      r.readAsDataURL(blob);
    });
    const resp=await fetch('/.netlify/functions/transcribe',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({audio:b64,mimeType})
    });
    const data=await resp.json();
    chatInput.placeholder='Ask me anything...';
    if(data.transcript&&data.transcript.trim()){
      chatInput.value=data.transcript;
      sendChat();
    }else if(data.error){
      toast(data.error,'error');
      if(voiceMode)setTimeout(startListening,300);
    }else if(voiceMode){
      setTimeout(startListening,300);
    }
  }catch(e){
    chatInput.placeholder='Ask me anything...';
    toast('Transcription error: '+e.message,'error');
    if(voiceMode)setTimeout(startListening,300);
  }
}
// ── JARVIS HISTORY ────────────────────────────────────────────────
async function renderJarvisHistory(){
  const wrap=document.getElementById('jarvisHistoryWrap');
  if(!wrap||!userRef)return;
  try{
    // userRef path = users/{uid}/data/main → derive history ref
    const pathParts=userRef.path.split('/');
    const uid=pathParts[1];
    const historyRef=doc(db,`users/${uid}/data/telegramHistory`);
    const snap=await getDoc(historyRef);
    if(!snap.exists()){wrap.style.display='none';return;}
    const messages=snap.data().messages||[];
    if(!messages.length){wrap.style.display='none';return;}
    // Build exchanges: pairs of user+assistant
    const exchanges=[];
    for(let i=0;i<messages.length-1;i++){
      if(messages[i].role==='user'&&messages[i+1]?.role==='assistant'){
        exchanges.push({user:messages[i].content,reply:messages[i+1].content});
        i++;
      }
    }
    const last5=exchanges.slice(-5).reverse();
    if(!last5.length){wrap.style.display='none';return;}
    wrap.style.display='';
    const body=document.getElementById('jarvisHistoryBody');
    if(body){
      body.innerHTML=last5.map(ex=>`<div class="jh-exchange">
        <div class="jh-user">You: <span>${escHtml(ex.user.slice(0,120))}${ex.user.length>120?'…':''}</span></div>
        <div class="jh-reply">${escHtml(ex.reply.slice(0,200))}${ex.reply.length>200?'…':''}</div>
      </div>`).join('');
    }
  }catch(e){console.warn('JARVIS history error',e.message);wrap.style.display='none';}
}

window.toggleJarvisHistory=function(){
  const body=document.getElementById('jarvisHistoryBody');
  const chev=document.getElementById('jarvisHistoryChev');
  if(!body)return;
  const open=body.style.display==='none'||!body.style.display;
  body.style.display=open?'flex':'none';
  if(chev)chev.style.transform=open?'rotate(180deg)':'';
};
// ── QUICK ADD FAB ─────────────────────────────────────────────────
window.toggleQuickSheet=function(){
  const sheet=document.getElementById('quickActionSheet');
  if(!sheet)return;
  const opened=sheet.classList.toggle('open');
  if(opened)haptic(20); // quick-fab open (#12)
};
window.closeQuickSheet=function(){
  const sheet=document.getElementById('quickActionSheet');
  if(sheet)sheet.classList.remove('open');
};
document.addEventListener('click',e=>{
  if(!e.target.closest('#quickFab')&&!e.target.closest('#quickActionSheet')){
    closeQuickSheet();
  }
});
window.openHabitLogSheet=function(){
  // Open habits tab and scroll there
  switchTab('dashboard');
  setTimeout(()=>{
    const el=document.querySelector('.habits-section');
    if(el)el.scrollIntoView({behavior:'smooth'});
  },100);
};
window.focusBrainDump=function(){
  switchTab('dashboard');
  setTimeout(()=>{
    const inp=document.getElementById('brainDumpInput');
    if(inp){inp.scrollIntoView({behavior:'smooth'});inp.focus();}
  },100);
};

// ── REMINDERS WIDGET ──────────────────────────────────────────────
// Upcoming reminders on the dashboard. Reminders are created by telling
// JARVIS ("remind me to X at Y") — this widget shows and cancels them.
function fmtReminderWhen(ts){
  const d=new Date(ts);
  const today=todayStr();
  const ds=d.toLocaleDateString('en-CA');
  const time=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  if(ds===today)return`Today ${time}`;
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  if(ds===tomorrow.toLocaleDateString('en-CA'))return`Tomorrow ${time}`;
  return`${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} ${time}`;
}
function renderRemindersWidget(){
  const el=document.getElementById('dashRemindersWidget');
  if(!el)return;
  const upcoming=(appData.reminders||[]).filter(r=>!r.sent).sort((a,b)=>a.dueAt-b.dueAt);
  if(!upcoming.length){el.style.display='none';return;}
  el.style.display='';
  el.innerHTML=`<div class="dash-proj-hdr">
      <div><div class="dash-proj-title">⏰ Reminders</div><div class="dash-proj-sub">${upcoming.length} upcoming</div></div>
    </div>
    <div class="reminder-list">
    ${upcoming.slice(0,5).map(r=>`<div class="reminder-row">
      <span class="reminder-text">${escHtml(r.text)}${r.recurrence?` <span class="reminder-recur">↻ ${r.recurrence}</span>`:''}</span>
      <span class="reminder-when">${fmtReminderWhen(r.dueAt)}</span>
      <button class="reminder-del" onclick="deleteReminder('${r.id}')" title="Cancel">✕</button>
    </div>`).join('')}
    </div>`;
}
window.deleteReminder=function(id){
  const idx=(appData.reminders||[]).findIndex(r=>r.id===id);
  if(idx<0)return;
  const [removed]=appData.reminders.splice(idx,1);
  saveData();
  renderRemindersWidget();
  toastUndo(removed.text,()=>{
    appData.reminders.splice(idx,0,removed);
    saveData();
    renderRemindersWidget();
  });
};

// ── GLOBAL EXPORTS ──
Object.assign(window, {
  renderGreeting, renderStats, renderFocusTasks, renderTodaySchedule,
  renderIntention, renderJarvisHistory, gaugeRingSVG, fmtTimeAgo,
  renderRemindersWidget,
});
