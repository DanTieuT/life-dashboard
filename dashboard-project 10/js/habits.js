// ── HABITS GRID ───────────────────────────────────────────────────
function renderHabitsGrid(containerId){
  const el=document.getElementById(containerId);
  if(!el)return;
  if(!window._dataLoaded){el.innerHTML=window.skeletonHTML;return;}
  if(!appData.habits.length){
    el.innerHTML='<div class="habit-empty">No habits yet — add your first one above!</div>';
    return;
  }
  // Filter archived, sort by order property
  const sorted=[...appData.habits].filter(h=>!h.archived).sort((a,b)=>{
    const ao=typeof a.order==='number'?a.order:9999;
    const bo=typeof b.order==='number'?b.order:9999;
    return ao-bo;
  });
  el.innerHTML=sorted.map((h,idx)=>habitCardHTML(h,idx)).join('');
  // Attach drag listeners + archived-button visibility post-render
  afterRenderHabitsGrid(containerId);
}

// Progress-ring button: N arc segments around a circle, like HabitKit
function habitRingBtn(count,target,c,size=38){
  const cx=size/2,cy=size/2,r=size*0.34,sw=size*0.11;
  const circ=2*Math.PI*r;
  const isDone=count>=target;
  // Gap between segments as arc-length; 0 for single-segment ring
  const gapArc=target>1?Math.min(circ*0.055,circ/target*0.22):0;
  const segArc=(circ-gapArc*target)/target;
  // Offset each segment by half a gap so gaps land exactly at 12 o'clock / 6 o'clock
  const halfGapDeg=target>1?(gapArc/circ)*180:0;
  let segs='';
  for(let i=0;i<target;i++){
    const startDeg=-90+i*(360/target)+halfGapDeg;
    const filled=i<count;
    segs+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${filled?c.dot:'rgba(0,0,0,0.35)'}"
      stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${segArc.toFixed(2)} ${(circ-segArc).toFixed(2)}"
      transform="rotate(${startDeg.toFixed(1)} ${cx} ${cy})"/>`;
  }
  const icon=isDone?'✓':'+';
  const iconFill=isDone?c.dot:'rgba(255,255,255,0.75)';
  const iconSz=(size*(isDone?0.26:0.32)).toFixed(0);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block">
    ${segs}
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      font-size="${iconSz}" font-weight="700" fill="${iconFill}"
      font-family="-apple-system,'SF Pro Text',sans-serif">${icon}</text>
  </svg>`;
}
function habitCardHTML(h,idx){
  const colors=habitColors();
  const ci=typeof h.colorIdx==='number'?h.colorIdx:idx%colors.length;
  let c=colors[ci];
  // If custom color set, build a synthetic color object
  if(h.customColor){
    const hex=h.customColor;
    c={bg:hex+'22',dot:hex,dim:hex+'33',btn:hex,ico:hex+'22'};
  }
  const today=todayStr();
  const isWeekly=h.type==='weekly';
  const dailyTarget=h.dailyTarget||1;
  const weeklyTarget=h.target||1;
  const count=habitCount(h,today);
  const done=isWeekly?(count>0):(count>=dailyTarget);

  const dots=[];
  if(isWeekly){
    for(let week=0;week<52;week++){
      const baseAgo=(51-week)*7;
      let sessionsThisWeek=0;
      for(let day=0;day<7;day++){
        const daysAgo=baseAgo+(6-day);
        const d=new Date();d.setDate(d.getDate()-daysAgo);
        sessionsThisWeek+=habitCount(h,d.toLocaleDateString('en-CA'));
      }
      sessionsThisWeek=Math.min(sessionsThisWeek,weeklyTarget);
      for(let slot=0;slot<weeklyTarget;slot++){
        dots.push(`<div class="yd" style="background:${slot<sessionsThisWeek?c.dot:c.dim}"></div>`);
      }
    }
  } else {
    for(let week=0;week<52;week++){
      for(let day=0;day<7;day++){
        const daysAgo=(51-week)*7+(6-day);
        const d=new Date();d.setDate(d.getDate()-daysAgo);
        const cnt=habitCount(h,d.toLocaleDateString('en-CA'));
        const dotBg=cnt>0?c.dot:c.dim;
        const dotOp=cnt>0?(cnt/dailyTarget).toFixed(2):'1';
        dots.push(`<div class="yd" style="background:${dotBg};opacity:${dotOp}"></div>`);
      }
    }
  }
  const gridStyle=isWeekly
    ?`grid-template-rows:repeat(${weeklyTarget},1fr);aspect-ratio:${52}/${weeklyTarget}`
    :`grid-template-rows:repeat(7,1fr);aspect-ratio:52/7`;

  const ringTarget=isWeekly?1:dailyTarget;
  const btnContent=habitRingBtn(count,ringTarget,c);

  return `<div class="habit-card" data-habit-id="${h.id}" style="background:${c.bg}" draggable="true">
    <div class="habit-card-top">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <div class="habit-icon" style="background:${c.dim}">${h.emoji||'⭐'}</div>
      <div class="habit-info">
        <div class="habit-name">${h.name}</div>
        <div class="habit-sub">${h.sub||h.name}</div>
      </div>
      <div class="habit-card-actions">
        <button class="habit-action-btn" onclick="openEditHabitModal('${h.id}')" title="Edit">✎</button>
        <button class="habit-action-btn habit-del-btn" onclick="deleteHabit('${h.id}')" title="Delete">✕</button>
      </div>
      <button class="habit-log-btn" style="background:${c.dim};padding:0;opacity:1"
        onclick="logHabit('${h.id}')">
        ${btnContent}
      </button>
    </div>
    <div class="year-grid" style="${gridStyle}">${dots.join('')}</div>
  </div>`;
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
let _dragHabitId=null;

function attachHabitDragListeners(containerId){
  const container=document.getElementById(containerId);
  if(!container)return;
  container.querySelectorAll('.habit-card[data-habit-id]').forEach(card=>{
    card.addEventListener('dragstart',e=>{
      _dragHabitId=card.dataset.habitId;
      setTimeout(()=>card.classList.add('dragging'),0);
      e.dataTransfer.effectAllowed='move';
    });
    card.addEventListener('dragend',()=>{
      card.classList.remove('dragging');
      container.querySelectorAll('.habit-card').forEach(c=>c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover',e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      container.querySelectorAll('.habit-card').forEach(c=>c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });
    card.addEventListener('drop',e=>{
      e.preventDefault();
      const fromId=_dragHabitId;
      const toId=card.dataset.habitId;
      if(fromId&&toId&&fromId!==toId){
        const habits=appData.habits;
        const fromIdx=habits.findIndex(h=>h.id===fromId);
        const toIdx=habits.findIndex(h=>h.id===toId);
        if(fromIdx>-1&&toIdx>-1){
          const [moved]=habits.splice(fromIdx,1);
          habits.splice(toIdx,0,moved);
          // Update order property
          habits.forEach((h,i)=>h.order=i);
          saveData();
          renderHabitsGrid('habitsGridDash');
          renderHabitsGrid('habitsGridTab');
          attachHabitDragListeners('habitsGridDash');
          attachHabitDragListeners('habitsGridTab');
        }
      }
      card.classList.remove('drag-over');
    });
  });

  // Touch drag support for mobile
  let touchDragCard=null,touchClone=null,touchStartY=0,touchStartX=0;
  container.querySelectorAll('.drag-handle').forEach(handle=>{
    handle.addEventListener('touchstart',e=>{
      const card=handle.closest('.habit-card[data-habit-id]');
      if(!card)return;
      touchDragCard=card;
      _dragHabitId=card.dataset.habitId;
      const t=e.touches[0];
      touchStartX=t.clientX;touchStartY=t.clientY;
      // Create clone for visual feedback
      touchClone=card.cloneNode(true);
      touchClone.style.cssText=`position:fixed;top:${card.getBoundingClientRect().top}px;left:${card.getBoundingClientRect().left}px;width:${card.offsetWidth}px;opacity:0.7;z-index:9999;pointer-events:none;box-shadow:0 8px 32px rgba(0,0,0,.5);border-radius:var(--radius)`;
      document.body.appendChild(touchClone);
      card.style.opacity='0.3';
    },{passive:true});
    handle.addEventListener('touchmove',e=>{
      if(!touchDragCard||!touchClone)return;
      const t=e.touches[0];
      const dx=t.clientX-touchStartX,dy=t.clientY-touchStartY;
      touchClone.style.transform=`translate(${dx}px,${dy}px)`;
      // Find card under finger
      touchClone.style.pointerEvents='none';
      const el=document.elementFromPoint(t.clientX,t.clientY);
      const overCard=el?.closest('.habit-card[data-habit-id]');
      container.querySelectorAll('.habit-card').forEach(c=>c.classList.remove('drag-over'));
      if(overCard&&overCard!==touchDragCard)overCard.classList.add('drag-over');
    },{passive:true});
    handle.addEventListener('touchend',e=>{
      if(!touchDragCard)return;
      const t=e.changedTouches[0];
      const el=document.elementFromPoint(t.clientX,t.clientY);
      const overCard=el?.closest('.habit-card[data-habit-id]');
      if(overCard&&overCard!==touchDragCard){
        const fromId=_dragHabitId;
        const toId=overCard.dataset.habitId;
        const habits=appData.habits;
        const fromIdx=habits.findIndex(h=>h.id===fromId);
        const toIdx=habits.findIndex(h=>h.id===toId);
        if(fromIdx>-1&&toIdx>-1){
          const [moved]=habits.splice(fromIdx,1);
          habits.splice(toIdx,0,moved);
          habits.forEach((h,i)=>h.order=i);
          saveData();
          renderHabitsGrid('habitsGridDash');
          renderHabitsGrid('habitsGridTab');
          attachHabitDragListeners('habitsGridDash');
          attachHabitDragListeners('habitsGridTab');
        }
      }
      if(touchClone){touchClone.remove();touchClone=null;}
      if(touchDragCard){touchDragCard.style.opacity='';touchDragCard=null;}
      container.querySelectorAll('.habit-card').forEach(c=>c.classList.remove('drag-over'));
    },{passive:true});
  });
}

// After renderHabitsGrid runs: attach drag listeners + archived-btn visibility
function afterRenderHabitsGrid(containerId){
  attachHabitDragListeners(containerId);
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
Object.assign(window, { renderHabitsGrid, updateHabitsSummary, habitCount, habitDone });
