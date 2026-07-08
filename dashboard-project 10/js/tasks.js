// ── TASKS ─────────────────────────────────────────────────────────
function taskRowHTML(t){
  const today=todayStr();
  let duePill='';
  if(t.due){
    let cls,label;
    if(t.due<today){cls='overdue';label=humanDate(t.due,today);}
    else if(t.due===today){cls='today';label='Today';}
    else{cls='upcoming';label=humanDate(t.due,today);}
    duePill=`<span class="due-pill ${cls}">${label}</span>`;
  }
  const recentDone=isRecentDone(t);
  const rowCls=t.done?(recentDone?'recent-done-row':'done-row'):'';
  const recurBadge=t.recurrence?`<span class="recur-badge" title="Repeats ${t.recurrence}">↻</span>`:'';
  const subs=t.subtasks||[];
  const subChip=subs.length?`<span class="subtask-chip">${subs.filter(s=>s.done).length}/${subs.length}</span>`:'';
  const hasExpand=!!(t.notes||subs.length);
  const notesBadge=hasExpand?`<button class="task-notes-indicator" onclick="event.stopPropagation();toggleTaskNotes('${t.id}')" title="Show details">📝</button>`:'';
  const subRows=subs.map(s=>`<div class="subtask-row">
      <button class="subtask-check${s.done?' checked':''}" onclick="event.stopPropagation();toggleSubtask('${t.id}','${s.id}')">✓</button>
      <span class="subtask-text${s.done?' done':''}">${escHtml(s.text)}</span>
    </div>`).join('');
  const expandRow=hasExpand?`<div class="task-notes-expand" id="tnotes-${t.id}">${t.notes?escHtml(t.notes):''}${subs.length?`<div class="task-subtasks-inline" style="margin-top:${t.notes?'6px':'0'}">${subRows}</div>`:''}</div>`:'';
  return`<div class="task-row${rowCls?' '+rowCls:''}${hasExpand?' has-notes':''}" data-task-id="${t.id}">
    <span class="task-drag-handle" title="Drag to reorder">⠿</span>
    <button class="task-check${t.done?' checked':''}" onclick="toggleTask('${t.id}')">${t.done?'✓':''}</button>
    ${recurBadge}
    <span class="task-label${t.done?' done-text':''}" onclick="toggleTask('${t.id}')" style="cursor:pointer;flex:1">${t.name}</span>
    ${subChip}
    ${notesBadge}
    ${duePill}
    <button class="task-row-edit" onclick="openEditTaskModal('${t.id}')" title="Edit">✎</button>
    <button class="task-row-del" onclick="deleteTask('${t.id}')">✕</button>
  </div>${expandRow}`;
}

// ── SUBTASKS (#20) ────────────────────────────────────────────────
window.toggleSubtask=function(taskId,subId){
  const t=(appData.projects||[]).find(x=>x.id===taskId);
  const s=t&&(t.subtasks||[]).find(x=>x.id===subId);
  if(!s)return;
  haptic(20);
  s.done=!s.done;
  saveData();
  const wasOpen=document.getElementById('tnotes-'+taskId)?.classList.contains('open');
  renderTasks();
  if(wasOpen)document.getElementById('tnotes-'+taskId)?.classList.add('open');
};
function renderTaskSection(containerId,label,tasks,color){
  const el=document.getElementById(containerId);
  if(!el)return;
  if(!tasks.length){el.innerHTML='';return;}
  const dotColors={red:'var(--red)',yellow:'var(--blue)','':'var(--muted)'};
  const dotColor=dotColors[color]||'var(--muted)';
  el.innerHTML=`<div class="tasks-section">
    <div class="tasks-section-hdr">
      <span class="tasks-section-dot" style="background:${dotColor}"></span>
      <span class="tasks-section-label">${label}</span>
      <span class="tasks-section-count">${tasks.length}</span>
    </div>
    <div class="tasks-section-body">
      ${tasks.map(t=>taskRowHTML(t)).join('')}
    </div>
  </div>`;
}

function renderDoneSection(done){
  const el=document.getElementById('tasksDoneSection');
  if(!el){return;}
  if(!done.length){el.innerHTML='';return;}
  const isOpen=el.dataset.open==='true';
  el.innerHTML=`<div class="tasks-section">
    <div class="tasks-section-hdr">
      <button class="done-toggle-btn" onclick="toggleDoneSection()">
        <span class="tasks-section-dot" style="background:var(--green)"></span>
        <span class="tasks-section-label">${isOpen?'▾ ':'▸ '}Done</span>
        <span class="tasks-section-count">${done.length}</span>
      </button>
    </div>
    ${isOpen?`<div class="tasks-section-body">${done.slice(0,30).map(t=>taskRowHTML(t)).join('')}</div>`:''}
  </div>`;
}
let _weekOffset=0;
window._calView='week'; // read by mobile swipe nav in core.js
let _monthOffset=0;

window.setCalView=function(v){
  _calView=v;
  document.getElementById('calViewWeekBtn').classList.toggle('active',v==='week');
  document.getElementById('calViewMonthBtn').classList.toggle('active',v==='month');
  document.getElementById('weekCalendar').style.display=v==='week'?'':'none';
  document.getElementById('monthCalendar').style.display=v==='month'?'':'none';
  if(v==='week')renderWeekCalendar();else renderMonthCalendar();
};

function renderMonthCalendar(){
  const el=document.getElementById('monthCalendar');
  const monthEl=document.getElementById('weekCalMonth');
  if(!el)return;
  const today=todayStr();
  const now=new Date(today+'T12:00:00');
  const yr=now.getFullYear(),mo=now.getMonth()+_monthOffset;
  const firstDay=new Date(yr,mo,1);
  const lastDay=new Date(yr,mo+1,0);
  const startDow=firstDay.getDay(); // 0=Sun
  const totalDays=lastDay.getDate();
  if(monthEl) monthEl.textContent=firstDay.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const events=appData.events||[];
  const tasks=(appData.projects||[]).filter(t=>t.due);
  const DOWS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // Build cells: pad start with prev month days
  const cells=[];
  const prevLast=new Date(yr,mo,0).getDate();
  for(let i=0;i<startDow;i++) cells.push({ds:null,num:prevLast-startDow+1+i,other:true});
  for(let d=1;d<=totalDays;d++){
    const date=new Date(yr,mo,d);
    const ds=date.toISOString().slice(0,10);
    cells.push({ds,num:d,isToday:ds===today,isPast:ds<today});
  }
  // Pad end to fill 6 rows
  let nextD=1;
  while(cells.length<42) cells.push({ds:null,num:nextD++,other:true});
  const dowRow=DOWS.map(d=>`<div class="month-cal-dow-cell">${d}</div>`).join('');
  const grid=cells.map(cell=>{
    if(cell.other) return`<div class="month-cell mc-other"><div class="mc-num">${cell.num}</div></div>`;
    const evts=events.filter(e=>e.date===cell.ds).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const dayTasks=tasks.filter(t=>t.due===cell.ds);
    const todayCls=cell.isToday?' mc-today':cell.isPast?' mc-past':'';
    const evtHTML=evts.slice(0,2).map(e=>`<div class="week-evt" title="${e.name}" style="font-size:10px;padding:1px 4px;margin-bottom:1px">${e.name}</div>`).join('');
    const taskHTML=dayTasks.slice(0,2).map(t=>`<div class="week-task${t.done?' week-task-done':''}" title="${t.name}" style="font-size:10px;padding:1px 4px;margin-bottom:1px">${t.name}</div>`).join('');
    const overflow=evts.length+dayTasks.length>4?`<div style="font-size:9px;color:var(--muted);margin-top:1px">+${evts.length+dayTasks.length-4} more</div>`:'';
    return`<div class="month-cell${todayCls}" onclick="openAddEventModal('${cell.ds}')" style="cursor:pointer">
      <div class="mc-num">${cell.num}</div>
      ${evtHTML}${taskHTML}${overflow}
    </div>`;
  }).join('');
  el.innerHTML=`<div class="month-cal-dow">${dowRow}</div><div class="month-cal-grid">${grid}</div>`;
}

function renderWeekCalendar(){
  const el=document.getElementById('weekCalendar');
  const monthEl=document.getElementById('weekCalMonth');
  if(!el)return;
  const today=todayStr();
  const todayDate=new Date(today+'T12:00:00');
  // Sunday-start week
  const sun=new Date(todayDate);
  sun.setDate(todayDate.getDate()-todayDate.getDay()+(_weekOffset*7));
  const days=[];
  for(let i=0;i<7;i++){
    const d=new Date(sun);d.setDate(sun.getDate()+i);
    const ds=d.toISOString().slice(0,10);
    days.push({ds,name:['SUN','MON','TUE','WED','THU','FRI','SAT'][i],num:d.getDate(),isToday:ds===today,isPast:ds<today});
  }
  if(monthEl){
    const last=new Date(sun);last.setDate(sun.getDate()+6);
    monthEl.textContent=sun.getMonth()===last.getMonth()
      ?sun.toLocaleDateString('en-US',{month:'long',year:'numeric'})
      :sun.toLocaleDateString('en-US',{month:'short'})+' – '+last.toLocaleDateString('en-US',{month:'short',year:'numeric'});
  }
  const events=appData.events||[];
  const tasks=(appData.projects||[]).filter(t=>t.due);
  el.innerHTML=days.map(day=>{
    const evts=events.filter(e=>e.date===day.ds).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
    const dayTasks=tasks.filter(t=>t.due===day.ds);
    const evtMax=2;
    const evtSlice=evts.slice(0,evtMax);
    const taskMax=Math.max(0,3-evtSlice.length);
    const evtHTML=evtSlice.map(e=>`<div class="week-evt" title="${e.time?e.time+' ':''}${e.name}">${e.name}</div>`).join('')
      +(evts.length>evtMax?`<div class="week-evt" style="background:var(--card2);color:var(--muted)">+${evts.length-evtMax} more</div>`:'');
    const taskHTML=dayTasks.slice(0,taskMax).map(t=>`<div class="week-task${t.done?' week-task-done':''}" title="${t.name}">${t.name}</div>`).join('')
      +(dayTasks.length>taskMax&&taskMax>0?`<div class="week-task" style="background:rgba(255,214,0,.06);color:var(--muted)">+${dayTasks.length-taskMax} more</div>`:'')
      +(dayTasks.length>0&&taskMax===0?`<div class="week-task" style="background:rgba(255,214,0,.06);color:var(--muted)">+${dayTasks.length} tasks</div>`:'');
    return `<div class="week-day${day.isToday?' wk-today':day.isPast?' wk-past':''}" onclick="openAddEventModal('${day.ds}')" style="cursor:pointer" title="Add event on ${day.ds}">
      <div class="week-day-name">${day.name}</div>
      <div class="week-day-num">${day.num}</div>
      <div class="week-day-body">${evtHTML}${taskHTML}</div>
    </div>`;
  }).join('');
}

window.weekCalNav=function(dir){
  if(_calView==='month'){
    if(dir===0)_monthOffset=0;else _monthOffset+=dir;
    renderMonthCalendar();
  }else{
    if(dir===0)_weekOffset=0;else _weekOffset+=dir;
    renderWeekCalendar();
  }
};

function renderTasks(){
  if(_calView==='month')renderMonthCalendar();else renderWeekCalendar();
  const today=todayStr();
  const q=(document.getElementById('taskSearch')?.value||'').trim().toLowerCase();
  const all=q
    ? (appData.projects||[]).filter(t=>(t.name||'').toLowerCase().includes(q)||(t.notes||'').toLowerCase().includes(q))
    : (appData.projects||[]);
  const active=t=>!t.done||isRecentDone(t);
  const doneSort=(a,b)=>{
    if(a.done&&!b.done)return 1;
    if(!a.done&&b.done)return -1;
    return 0;
  };
  const orderSort=(a,b)=>{
    const ao=typeof a.order==='number'?a.order:9999;
    const bo=typeof b.order==='number'?b.order:9999;
    return ao-bo;
  };
  const overdue=all.filter(t=>active(t)&&t.due&&t.due<today).sort((a,b)=>doneSort(a,b)||orderSort(a,b)||(a.due<b.due?-1:1));
  const todayTasks=all.filter(t=>active(t)&&t.due===today).sort((a,b)=>doneSort(a,b)||orderSort(a,b));
  const upcoming=all.filter(t=>active(t)&&(!t.due||t.due>today)).sort((a,b)=>{
    const ds=doneSort(a,b);if(ds)return ds;
    const os=orderSort(a,b);if(os)return os;
    if(!a.due&&!b.due)return 0;if(!a.due)return 1;if(!b.due)return -1;return a.due<b.due?-1:1;
  });
  const done=all.filter(t=>t.done&&!isRecentDone(t)).sort((a,b)=>(b.doneAt||0)>(a.doneAt||0)?1:-1);
  renderTaskSection('tasksOverdueSection','Overdue',overdue,'red');
  renderTaskSection('tasksTodaySection','Today',todayTasks,'yellow');
  renderTaskSection('tasksUpcomingSection','Upcoming',upcoming,'');
  renderDoneSection(done);
  // Attach drag + swipe listeners after render (batch-2)
  document.querySelectorAll('.tasks-section-body').forEach(el=>{ if(typeof attachTaskDragListeners==='function')attachTaskDragListeners(el); });
  document.querySelectorAll('.task-row[data-task-id]').forEach(row=>{ if(typeof attachSwipeDelete==='function')attachSwipeDelete(row); });
  // Nav badge
  const urgentCount=overdue.filter(t=>!t.done).length+todayTasks.filter(t=>!t.done).length;
  const badge=document.getElementById('taskNavBadge');
  if(badge){badge.textContent=urgentCount;badge.style.display=urgentCount>0?'inline-block':'none';}
  // Subtitle
  const remaining=all.filter(t=>!t.done).length;
  const sub=document.getElementById('tasksTabSub');
  if(sub)sub.textContent=remaining?`${remaining} task${remaining!==1?'s':''} remaining`:'All caught up!';
}

window.toggleDoneSection=function(){
  const el=document.getElementById('tasksDoneSection');
  el.dataset.open=el.dataset.open==='true'?'false':'true';
  renderDoneSection((appData.projects||[]).filter(t=>t.done));
};

window.addTask=function(){
  const name=document.getElementById('taskInput').value.trim();
  if(!name)return;
  const due=document.getElementById('taskDueInput').value||'';
  appData.projects.push({id:uid(),name,due,done:false,created:todayStr()});
  saveData();
  document.getElementById('taskInput').value='';
  document.getElementById('taskDueInput').value='';
  renderTasks();renderFocusTasks();renderStats();toast('✓ Task added');
};

function isRecentDone(t){
  if(!t.done||!t.doneAt)return false;
  if(typeof t.doneAt!=='number')return false; // old date-string = not recent
  return(Date.now()-t.doneAt)<86400000;
}
function nextRecurrenceDate(due,recurrence){
  if(!due||!recurrence)return null;
  const d=new Date(due+'T12:00:00');
  if(recurrence==='daily')d.setDate(d.getDate()+1);
  else if(recurrence==='weekly')d.setDate(d.getDate()+7);
  else if(recurrence==='monthly')d.setMonth(d.getMonth()+1);
  return d.toLocaleDateString('en-CA');
}
window.toggleTask=function(id){
  haptic(30);
  const t=appData.projects.find(p=>p.id===id);
  if(!t){return;}
  if(!t.done&&t.recurrence){
    // Mark current done and create next occurrence
    t.done=true;t.doneAt=Date.now();t.completedDate=todayStr();
    if(!t.seriesId)t.seriesId=t.id; // establish series linkage (#22)
    const nextDue=nextRecurrenceDate(t.due||todayStr(),t.recurrence);
    if(nextDue){
      appData.projects.push({
        id:uid(),name:t.name,due:nextDue,done:false,
        recurrence:t.recurrence,notes:t.notes||'',created:todayStr(),
        seriesId:t.seriesId,
        subtasks:(t.subtasks||[]).map(s=>({id:uid(),text:s.text,done:false})),
      });
    }
    saveData();renderTasks();renderFocusTasks();renderStats();
    toast('✓ Done — next scheduled: '+(nextDue||''));
  } else {
    t.done=!t.done;t.doneAt=t.done?Date.now():null;t.completedDate=t.done?todayStr():null;
    saveData();renderTasks();renderFocusTasks();renderStats();
  }
};
window.toggleProject=window.toggleTask;

// Immediate delete with 6s undo toast (#7)
window.deleteTask=function(id){
  const idx=appData.projects.findIndex(p=>p.id===id);
  if(idx===-1)return;
  const [removed]=appData.projects.splice(idx,1);
  saveData();renderTasks();renderFocusTasks();renderStats();
  toastUndo(removed.name,()=>{
    appData.projects.splice(Math.min(idx,appData.projects.length),0,removed);
    saveData();renderTasks();renderFocusTasks();renderStats();
  });
};
window.deleteProject=window.deleteTask;

// ── TASK MODAL SUBTASK EDITOR (#20) ───────────────────────────────
let _modalSubtasks=[]; // working copy while modal is open

function renderModalSubtasks(){
  const list=document.getElementById('modalSubtaskList');
  if(!list)return;
  list.innerHTML=_modalSubtasks.map(s=>`<div class="subtask-row">
    <button class="subtask-check${s.done?' checked':''}" onclick="modalToggleSubtask('${s.id}')">✓</button>
    <span class="subtask-text${s.done?' done':''}">${escHtml(s.text)}</span>
    <button class="subtask-del" onclick="modalRemoveSubtask('${s.id}')">✕</button>
  </div>`).join('');
}
window.modalToggleSubtask=function(id){
  const s=_modalSubtasks.find(x=>x.id===id);
  if(s){s.done=!s.done;renderModalSubtasks();}
};
window.modalRemoveSubtask=function(id){
  _modalSubtasks=_modalSubtasks.filter(x=>x.id!==id);
  renderModalSubtasks();
};
window.modalAddSubtask=function(){
  const inp=document.getElementById('modalSubtaskInput');
  if(!inp)return;
  const text=inp.value.trim();
  if(!text)return;
  _modalSubtasks.push({id:uid(),text,done:false});
  inp.value='';
  renderModalSubtasks();
  inp.focus();
};

// Show/hide the recurring-edit-scope radios (#22)
function updateRecurScopeVis(t){
  const grp=document.getElementById('recurScopeGroup');
  if(!grp)return;
  const show=!!(t&&t.recurrence);
  grp.style.display=show?'':'none';
  if(show){
    const all=document.querySelector('input[name="recurScope"][value="all"]');
    if(all)all.checked=true;
  }
}

window.saveModalTask=function(){
  const name=document.getElementById('modalTaskName').value.trim();
  if(!name)return;
  const due=document.getElementById('modalTaskDue').value||'';
  const recurrence=document.getElementById('modalTaskRecurrence')?.value||'';
  const notes=document.getElementById('modalTaskNotes')?.value.trim()||'';
  const editId=document.getElementById('editTaskId').value;
  const subtasks=_modalSubtasks.map(s=>({id:s.id,text:s.text,done:!!s.done}));
  if(editId){
    const t=(appData.projects||[]).find(x=>x.id===editId);
    if(t){
      // Recurring edit scope (#22)
      const scope=document.querySelector('input[name="recurScope"]:checked')?.value||'all';
      const wasRecurring=!!t.recurrence;
      t.name=name;t.due=due;t.notes=notes||'';t.subtasks=subtasks;
      if(wasRecurring&&scope==='occurrence'){
        // This occurrence only: strip recurrence linkage
        t.recurrence=null;
        t.seriesId=null;
      }else{
        // All future: future spawns copy from this instance, so updating it
        // (plus recurrence settings) is inherited by successors.
        t.recurrence=recurrence||null;
        if(t.recurrence&&!t.seriesId)t.seriesId=t.id;
      }
    }
    toast('✓ Task updated');
  }else{
    const t={id:uid(),name,due,done:false,created:todayStr(),recurrence:recurrence||null,notes:notes||'',subtasks};
    if(t.recurrence)t.seriesId=t.id;
    appData.projects.push(t);
    toast('✓ Task added');
  }
  saveData();renderTasks();renderFocusTasks();renderStats();
  document.getElementById('modalTaskName').value='';
  document.getElementById('modalTaskDue').value='';
  if(document.getElementById('modalTaskRecurrence'))document.getElementById('modalTaskRecurrence').value='';
  if(document.getElementById('modalTaskNotes'))document.getElementById('modalTaskNotes').value='';
  document.getElementById('editTaskId').value='';
  _modalSubtasks=[];
  closeModal('newTaskModal');
  if(window._noteToTaskId){
    const nid=window._noteToTaskId;window._noteToTaskId=null;
    setTimeout(()=>{if(confirm('Delete the original note?')){appData.notes=(appData.notes||[]).filter(n=>n.id!==nid);saveData();renderBrainDump();}},300);
  }
};
window.openNewTaskModal=function(){
  document.getElementById('editTaskId').value='';
  document.getElementById('taskModalTitle').textContent='New Task';
  document.getElementById('taskModalSaveBtn').textContent='Add task';
  document.getElementById('modalTaskName').value='';
  document.getElementById('modalTaskDue').value=todayStr();
  const nr=document.getElementById('modalTaskRecurrence');
  const nn=document.getElementById('modalTaskNotes');
  if(nr)nr.value='';
  if(nn)nn.value='';
  _modalSubtasks=[];
  renderModalSubtasks();
  updateRecurScopeVis(null);
  openModal('newTaskModal');
  setTimeout(()=>document.getElementById('modalTaskName').focus(),80);
};

window.openEditTaskModal=function(id){
  const t=(appData.projects||[]).find(x=>x.id===id);
  if(!t)return;
  document.getElementById('editTaskId').value=id;
  document.getElementById('taskModalTitle').textContent='Edit Task';
  document.getElementById('taskModalSaveBtn').textContent='Save changes';
  document.getElementById('modalTaskName').value=t.name;
  document.getElementById('modalTaskDue').value=t.due||'';
  const nr=document.getElementById('modalTaskRecurrence');
  if(nr)nr.value=t.recurrence||'';
  const nn=document.getElementById('modalTaskNotes');
  if(nn)nn.value=t.notes||'';
  _modalSubtasks=(t.subtasks||[]).map(s=>({id:s.id,text:s.text,done:!!s.done}));
  renderModalSubtasks();
  updateRecurScopeVis(t);
  openModal('newTaskModal');
  setTimeout(()=>document.getElementById('modalTaskName').focus(),80);
};

// Enter advances fields; Cmd/Ctrl+Enter saves (#11)
setupModalEnterFlow('newTaskModal',['modalTaskName','modalTaskDue','modalTaskRecurrence','modalTaskNotes'],()=>saveModalTask());

window.toggleTaskNotes=function(id){
  const el=document.getElementById('tnotes-'+id);
  if(el)el.classList.toggle('open');
};
// ── BATCH 2: TASK DRAG REORDER (#17) ─────────────────────────────
function attachTaskDragListeners(sectionBodyEl){
  if(!sectionBodyEl)return;
  sectionBodyEl.querySelectorAll('.task-row[data-task-id]').forEach(row=>{
    row.setAttribute('draggable','true');
    row.addEventListener('dragstart',e=>{
      row._dragId=row.dataset.taskId;
      setTimeout(()=>row.classList.add('task-dragging'),0);
      e.dataTransfer.effectAllowed='move';
    });
    row.addEventListener('dragend',()=>{
      row.classList.remove('task-dragging');
      sectionBodyEl.querySelectorAll('.task-row').forEach(r=>r.classList.remove('task-drag-over'));
    });
    row.addEventListener('dragover',e=>{
      e.preventDefault();
      sectionBodyEl.querySelectorAll('.task-row').forEach(r=>r.classList.remove('task-drag-over'));
      row.classList.add('task-drag-over');
    });
    row.addEventListener('drop',e=>{
      e.preventDefault();
      const fromId=document.querySelector('.task-row.task-dragging')?.dataset.taskId;
      const toId=row.dataset.taskId;
      if(fromId&&toId&&fromId!==toId){
        const tasks=appData.projects;
        const fi=tasks.findIndex(t=>t.id===fromId);
        const ti=tasks.findIndex(t=>t.id===toId);
        if(fi>-1&&ti>-1){
          const [moved]=tasks.splice(fi,1);
          tasks.splice(ti,0,moved);
          tasks.forEach((t,i)=>t.order=i);
          saveData();renderTasks();
        }
      }
      row.classList.remove('task-drag-over');
    });
  });
}
// ── BATCH 2: SWIPE TO DELETE (#80) ───────────────────────────────
function attachSwipeDelete(row){
  if(row._swipeAttached)return;
  row._swipeAttached=true;
  let startX=0,curX=0,swiping=false;
  const THRESHOLD=70;
  row.addEventListener('touchstart',e=>{
    startX=e.touches[0].clientX;
    curX=startX;
    swiping=true;
  },{passive:true});
  row.addEventListener('touchmove',e=>{
    if(!swiping)return;
    curX=e.touches[0].clientX;
    const dx=curX-startX;
    // Only allow left swipe
    if(dx<0&&Math.abs(dx)<120){
      row.style.transform=`translateX(${dx}px)`;
      row.style.transition='none';
    }
  },{passive:true});
  row.addEventListener('touchend',()=>{
    if(!swiping)return;
    swiping=false;
    const dx=curX-startX;
    row.style.transition='transform .2s ease';
    if(dx<-THRESHOLD){
      haptic(25); // swipe-to-delete trigger (#12) — synchronous in gesture handler
      // Snap open to show delete
      row.style.transform='translateX(-80px)';
      // Show delete indicator via background
      row.style.background=`linear-gradient(to left, var(--red) 80px, var(--card) 80px)`;
      // Auto-reset after 2s or on any tap elsewhere
      const reset=()=>{
        row.style.transform='';
        row.style.background='';
        document.removeEventListener('touchstart',reset);
      };
      setTimeout(reset,2000);
      document.addEventListener('touchstart',reset,{once:true,passive:true});
      // If fully swiped (>100px), delete immediately (undo toast offers recovery)
      if(dx<-100){
        reset();
        const id=row.dataset.taskId;
        if(id)deleteTask(id);
      }
    } else {
      row.style.transform='';
      row.style.background='';
    }
  },{passive:true});
}

// ── GLOBAL EXPORTS ──
Object.assign(window, { renderTasks, isRecentDone, attachTaskDragListeners, attachSwipeDelete, nextRecurrenceDate });
