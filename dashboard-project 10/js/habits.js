// ── HABITS — combined card (tabs + 12-week heatmap + streak list) ──
// Design-synced to the mockup: one card, "All" + per-habit tabs, an 84-cell
// (12-week) heatmap, and a streak list. Logging/edit/delete aren't part of
// the mockup (it's a read-only demo) — kept reachable via the focused
// per-habit tab so the real quick-log workflow isn't lost.
let _habitTab='all';
window.setHabitTab=function(key){
  _habitTab=key;
  renderHabitsGrid('habitsGridDash');
};

const HEATMAP_WEEKS=12;
function last84Dates(){
  const dates=[];
  for(let week=0;week<HEATMAP_WEEKS;week++){
    for(let day=0;day<7;day++){
      const daysAgo=(HEATMAP_WEEKS-1-week)*7+(6-day);
      const d=new Date();d.setDate(d.getDate()-daysAgo);
      dates.push(d.toLocaleDateString('en-CA'));
    }
  }
  return dates; // oldest → newest, column-major (matches grid-auto-flow:column)
}

function combinedHeatmapCellsHTML(habits){
  const LEVEL_COLORS=['var(--track)','rgba(52,199,89,.35)','rgba(52,199,89,.65)','var(--green)'];
  const total=habits.length;
  return last84Dates().map(ds=>{
    const doneCount=habits.filter(h=>habitDone(h,ds)).length;
    const ratio=total?doneCount/total:0;
    const level=ratio===0?0:ratio>0.75?3:ratio>0.4?2:1;
    return `<div class="hh-cell" style="background:${LEVEL_COLORS[level]}" title="${ds}: ${doneCount}/${total}"></div>`;
  }).join('');
}

function habitHeatmapCellsHTML(h,c){
  return last84Dates().map(ds=>{
    const done=habitDone(h,ds);
    return `<div class="hh-cell" style="background:${done?c.dot:'var(--track)'}" title="${ds}"></div>`;
  }).join('');
}

function habitColorFor(h,idx){
  const colors=habitColors();
  const ci=typeof h.colorIdx==='number'?h.colorIdx:idx%colors.length;
  if(h.customColor){
    const hex=h.customColor;
    return{bg:hex+'22',dot:hex,dim:hex+'33',btn:hex,ico:hex+'22'};
  }
  return colors[ci];
}

function renderHabitsGrid(containerId){
  const el=document.getElementById(containerId);
  if(!el)return;
  if(!window._dataLoaded){el.innerHTML=window.skeletonHTML;return;}
  if(!appData.habits.length){
    el.innerHTML='<div class="habit-empty">No habits yet — add your first one above!</div>';
    return;
  }
  const sorted=[...appData.habits].filter(h=>!h.archived).sort((a,b)=>{
    const ao=typeof a.order==='number'?a.order:9999;
    const bo=typeof b.order==='number'?b.order:9999;
    return ao-bo;
  });
  if(!sorted.length){
    el.innerHTML='<div class="habit-empty">No active habits — add one above, or restore an archived habit.</div>';
    return;
  }
  if(_habitTab!=='all'&&!sorted.find(h=>h.id===_habitTab))_habitTab='all';

  const tabsHTML=['<button class="habit-tab-pill'+(_habitTab==='all'?' active':'')+'" onclick="setHabitTab(\'all\')">All</button>']
    .concat(sorted.map(h=>`<button class="habit-tab-pill${_habitTab===h.id?' active':''}" onclick="setHabitTab('${h.id}')">${h.name}</button>`))
    .join('');

  let bodyHTML;
  if(_habitTab==='all'){
    const heatmap=combinedHeatmapCellsHTML(sorted);
    const streakRows=sorted.map((h,idx)=>{
      const c=habitColorFor(h,idx);
      const streak=calcStreak(h);
      return `<div class="habit-streak-row" onclick="setHabitTab('${h.id}')">
        <span class="habit-streak-left">
          <span class="habit-streak-dot" style="background:${c.dot}"></span>
          <span class="habit-streak-name">${h.name}</span>
        </span>
        <span class="habit-streak-val">${streak>0?`${streak} day streak`:'no streak yet'}</span>
      </div>`;
    }).join('');
    bodyHTML=`<div class="habit-heatmap">${heatmap}</div><div class="habit-streak-list">${streakRows}</div>`;
  } else {
    const idx=sorted.findIndex(h=>h.id===_habitTab);
    const h=sorted[idx];
    const c=habitColorFor(h,idx);
    const today=todayStr();
    const isWeekly=h.type==='weekly'||h.type==='monthly';
    const dailyTarget=h.dailyTarget||1;
    const count=habitCount(h,today);
    const done=isWeekly?count>0:count>=dailyTarget;
    const streak=calcStreak(h);
    const heatmap=habitHeatmapCellsHTML(h,c);
    bodyHTML=`<div class="habit-focused-row">
        <span class="habit-streak-left">
          <span class="habit-streak-dot" style="background:${c.dot}"></span>
          <span class="habit-focused-name">${h.name}</span>
        </span>
        <span class="habit-streak-val">${streak>0?`${streak} day streak`:'no streak yet'}</span>
      </div>
      <div class="habit-heatmap" style="margin-bottom:14px">${heatmap}</div>
      <div class="habit-focused-actions">
        <button class="habit-log-check${done?' checked':''}" style="${done?`background:${c.dot};border-color:${c.dot}`:''}" onclick="logHabit('${h.id}')" title="${isWeekly?'Log':`Log (${count}/${dailyTarget})`}">${done?'✓':(dailyTarget>1?count:'')}</button>
        <span class="habit-focused-sub">${h.sub||''}</span>
        <button class="habit-action-btn" onclick="openEditHabitModal('${h.id}')" title="Edit">✎</button>
        <button class="habit-action-btn habit-del-btn" onclick="deleteHabit('${h.id}')" title="Delete">✕</button>
      </div>`;
  }

  el.innerHTML=`<div class="habit-combined-card">
    <div class="habit-tabs-row">${tabsHTML}</div>
    ${bodyHTML}
  </div>`;
  afterRenderHabitsGrid(containerId);
}
window.logHabit=function(id){
  haptic(40);
  const h=appData.habits.find(h=>h.id===id);
  if(!h)return;
  if(!h.log)h.log={};
  const today=todayStr();
  const target=h.dailyTarget||1;
  const current=habitCount(h,today);
  // cycle: 0 → 1 → 2 → ... → target → 0
  h.log[today]=current>=target?0:current+1;
  saveData();
  renderHabitsGrid('habitsGridDash');
  renderHabitsGrid('habitsGridTab');
  updateHabitsSummary();
  renderStats();
};

// Get the completion count for a habit on a given day (handles legacy boolean logs)
function habitCount(h,dateStr){
  const val=h.log&&h.log[dateStr];
  if(!val)return 0;
  if(val===true)return 1; // legacy
  return typeof val==='number'?val:0;
}

function habitDone(h,dateStr){
  const cnt=habitCount(h,dateStr);
  return h.type==='weekly'||h.type==='monthly'?cnt>0:cnt>=(h.dailyTarget||1);
}

// Longest streak ever, scanned from full log history (no separate stored
// field to keep in sync — cheap enough to recompute on render).
function bestStreakEver(h){
  const dates=Object.keys(h.log||{}).filter(d=>habitDone(h,d)).sort();
  if(!dates.length)return 0;
  let best=1,cur=1;
  for(let i=1;i<dates.length;i++){
    const diff=Math.round((new Date(dates[i]+'T12:00:00')-new Date(dates[i-1]+'T12:00:00'))/86400000);
    cur=diff===1?cur+1:1;
    if(cur>best)best=cur;
  }
  return best;
}

function updateHabitsSummary(){
  const today=todayStr();
  // Exclude archived habits (batch-2 feature)
  const all=(appData.habits||[]).filter(h=>!h.archived);
  const done=all.filter(h=>{
    const cnt=habitCount(h,today);
    return h.type==='weekly'||h.type==='monthly'?cnt>0:cnt>=(h.dailyTarget||1);
  }).length;
  const txt=`${done} of ${all.length} done today · keep the streak alive`;
  const s1=document.getElementById('habitsSummary');
  const s2=document.getElementById('habitsTabSub');
  if(s1)s1.textContent=txt;
  if(s2)s2.textContent=txt;
}

// ── HABIT MODALS ──────────────────────────────────────────────────
window.buildColorSwatches=function(selectedIdx){
  const el=document.getElementById('colorSwatches');
  if(!el)return;
  el.innerHTML=HABIT_COLORS_DARK.map((c,i)=>
    `<div class="color-swatch${i===(selectedIdx||0)?' selected':''}" style="background:${c.dot}" onclick="selectColor(${i})" data-idx="${i}"></div>`
  ).join('');
};
window.selectColor=function(i){
  document.getElementById('newHabitColor').value=i;
  document.getElementById('newHabitCustomColorVal').value=''; // clear custom
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('selected',parseInt(s.dataset.idx)===i));
};
window.selectCustomColor=function(hex){
  // Clear preset selection when custom color set
  document.getElementById('newHabitCustomColorVal').value=hex;
  document.getElementById('customColorHex').textContent=hex;
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
};
window.clearCustomColor=function(){
  document.getElementById('newHabitCustomColorVal').value='';
  // re-select first swatch
  const first=document.querySelector('.color-swatch');
  if(first){
    first.classList.add('selected');
    document.getElementById('newHabitColor').value='0';
  }
};
window.updateHabitTargetVis=function(){
  const type=document.getElementById('newHabitType').value;
  document.getElementById('habitTargetGroup').style.display=(type==='weekly'||type==='monthly')?'block':'none';
  document.getElementById('habitDailyTargetGroup').style.display=type==='daily'?'block':'none';
};
window.openAddHabitModal=function(){
  buildColorSwatches(0);
  document.getElementById('habitModalTitle').textContent='New Habit';
  document.getElementById('habitModalSaveBtn').textContent='Add Habit';
  document.getElementById('editHabitId').value='';
  document.getElementById('newHabitName').value='';
  document.getElementById('newHabitSub').value='';
  document.getElementById('newHabitEmoji').value='';
  document.getElementById('newHabitColor').value='0';
  document.getElementById('newHabitCustomColorVal').value='';
  document.getElementById('newHabitCustomColor').value='#30d158';
  document.getElementById('customColorHex').textContent='#30d158';
  document.getElementById('newHabitType').value='daily';
  updateHabitTargetVis();
  const archBtn=document.getElementById('habitArchiveBtn');
  if(archBtn)archBtn.style.display='none';
  openModal('addHabitModal');
};
window.openEditHabitModal=function(id){
  const h=appData.habits.find(h=>h.id===id);
  if(!h)return;
  buildColorSwatches(h.colorIdx||0);
  document.getElementById('habitModalTitle').textContent='Edit Habit';
  document.getElementById('habitModalSaveBtn').textContent='Save Changes';
  document.getElementById('editHabitId').value=id;
  document.getElementById('newHabitName').value=h.name||'';
  document.getElementById('newHabitSub').value=h.sub||'';
  document.getElementById('newHabitEmoji').value=h.emoji||'';
  document.getElementById('newHabitColor').value=h.colorIdx||0;
  document.getElementById('newHabitCustomColorVal').value=h.customColor||'';
  if(h.customColor){
    document.getElementById('newHabitCustomColor').value=h.customColor;
    document.getElementById('customColorHex').textContent=h.customColor;
    document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
  }
  document.getElementById('newHabitType').value=h.type||'daily';
  document.getElementById('newHabitTarget').value=h.target||3;
  document.getElementById('newHabitDailyTarget').value=h.dailyTarget||1;
  updateHabitTargetVis();
  // Show Archive button when editing an existing habit
  const archBtn=document.getElementById('habitArchiveBtn');
  if(archBtn)archBtn.style.display=id?'':'none';
  openModal('addHabitModal');
};
window.saveHabitModal=function(){
  const name=document.getElementById('newHabitName').value.trim();
  const sub=document.getElementById('newHabitSub').value.trim();
  const emoji=document.getElementById('newHabitEmoji').value.trim()||'⭐';
  const colorIdx=parseInt(document.getElementById('newHabitColor').value)||0;
  const customColor=document.getElementById('newHabitCustomColorVal').value||'';
  const type=document.getElementById('newHabitType').value;
  const target=parseInt(document.getElementById('newHabitTarget').value)||1;
  const dailyTarget=parseInt(document.getElementById('newHabitDailyTarget').value)||1;
  const editId=document.getElementById('editHabitId').value;
  if(!name)return;
  if(editId){
    const h=appData.habits.find(h=>h.id===editId);
    if(h){
      Object.assign(h,{name,sub,emoji,colorIdx,type});
      if(customColor)h.customColor=customColor;else delete h.customColor;
      if(type==='daily')h.dailyTarget=dailyTarget>1?dailyTarget:undefined;
      else{h.target=target;delete h.dailyTarget;}
    }
  } else {
    const h={id:uid(),name,sub,emoji,colorIdx,type,log:{}};
    if(customColor)h.customColor=customColor;
    if(type==='daily'&&dailyTarget>1)h.dailyTarget=dailyTarget;
    if(type!=='daily')h.target=target;
    appData.habits.push(h);
  }
  saveData();
  closeModal('addHabitModal');
  renderHabitsGrid('habitsGridDash');renderHabitsGrid('habitsGridTab');
  updateHabitsSummary();toast(editId?'✓ Habit updated':'✓ Habit added');
};
// Immediate delete with 6s undo toast (#7)
window.deleteHabit=function(id){
  const idx=appData.habits.findIndex(h=>h.id===id);
  if(idx===-1)return;
  const [removed]=appData.habits.splice(idx,1);
  saveData();
  renderHabitsGrid('habitsGridDash');renderHabitsGrid('habitsGridTab');
  updateHabitsSummary();renderStats();
  toastUndo(removed.name,()=>{
    appData.habits.splice(Math.min(idx,appData.habits.length),0,removed);
    saveData();
    renderHabitsGrid('habitsGridDash');renderHabitsGrid('habitsGridTab');
    updateHabitsSummary();renderStats();
  });
};

// Enter advances fields; Cmd/Ctrl+Enter saves (#11)
setupModalEnterFlow('addHabitModal',['newHabitName','newHabitSub','newHabitEmoji'],()=>saveHabitModal());

// After renderHabitsGrid runs: show/hide the archived-habits toggle
function afterRenderHabitsGrid(containerId){
  const hasArchived=(appData.habits||[]).some(h=>h.archived);
  const btn=document.getElementById('showArchivedHabitsBtn');
  if(btn)btn.style.display=hasArchived?'':'none';
}

let _showArchivedHabits=false;

window.archiveHabitFromModal=function(){
  const id=document.getElementById('editHabitId').value;
  if(!id)return;
  const h=appData.habits.find(h=>h.id===id);
  if(!h)return;
  h.archived=true;
  saveData();
  closeModal('addHabitModal');
  renderHabitsGrid('habitsGridDash');
  renderHabitsGrid('habitsGridTab');
  updateHabitsSummary();
  toast('Habit archived');
};

window.toggleShowArchivedHabits=function(){
  _showArchivedHabits=!_showArchivedHabits;
  const btn=document.getElementById('showArchivedHabitsBtn');
  if(btn)btn.textContent=_showArchivedHabits?'Hide archived habits':'Show archived habits';
  const grid=document.getElementById('habitsGridArchived');
  if(!grid)return;
  if(_showArchivedHabits){
    const archived=(appData.habits||[]).filter(h=>h.archived);
    grid.style.display=archived.length?'grid':'none';
    if(archived.length){
      grid.innerHTML=archived.map((h,idx)=>{
        const c=habitColors()[h.colorIdx||0];
        return `<div class="habit-card" style="background:${c.bg}">
          <div class="habit-card-top">
            <div class="habit-icon" style="background:${c.dim}">${h.emoji||'⭐'}</div>
            <div class="habit-info">
              <div class="habit-name">${h.name}</div>
              <div class="habit-sub">Archived</div>
            </div>
            <button class="habit-action-btn" onclick="unarchiveHabit('${h.id}')" title="Restore" style="opacity:1">↩</button>
          </div>
        </div>`;
      }).join('');
    }
  } else {
    grid.style.display='none';
    grid.innerHTML='';
  }
};

window.unarchiveHabit=function(id){
  const h=appData.habits.find(h=>h.id===id);
  if(h){h.archived=false;saveData();toggleShowArchivedHabits();toggleShowArchivedHabits();renderHabitsGrid('habitsGridTab');toast('Habit restored');}
};

// ── GLOBAL EXPORTS ──
Object.assign(window, { renderHabitsGrid, updateHabitsSummary, habitCount, habitDone, bestStreakEver });
