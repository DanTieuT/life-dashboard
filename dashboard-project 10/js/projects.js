// ── PROJECTS ──────────────────────────────────────────────────────
const PROJECT_STAGES={
  planning:{label:'💡 Planning',color:'var(--sub)'},
  sourcing:{label:'🛒 Sourcing',color:'var(--yellow)'},
  building:{label:'🔨 Building',color:'var(--green)'},
  blocked:{label:'⏸ Blocked',color:'var(--red)'},
  done:{label:'✅ Done',color:'rgba(55,217,154,.45)'},
};
const STAGE_STATUS={
  planning:{label:'On Track',dotColor:'#30d158',bg:'var(--green-dim)',accent:'#30d158',filterKey:'on_track'},
  sourcing:{label:'On Track',dotColor:'#30d158',bg:'var(--green-dim)',accent:'#30d158',filterKey:'on_track'},
  building:{label:'At Risk',dotColor:'#ff9f0a',bg:'rgba(255,159,10,.13)',accent:'#ff9f0a',filterKey:'at_risk'},
  blocked:{label:'Blocked',dotColor:'#ff453a',bg:'var(--red-dim)',accent:'#ff453a',filterKey:'blocked'},
  done:{label:'Completed',dotColor:'#0a84ff',bg:'var(--blue-dim)',accent:'#0a84ff',filterKey:'done'},
};
const PRIORITY_COLORS={high:'#ff453a',medium:'#ff9f0a',low:'#636366'};
let projGroupOpen={};
let currentProjFilter='all';

window.setProjFilter=function(f){
  currentProjFilter=f;
  document.querySelectorAll('.proj-filter-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.filter===f);
  });
  renderProjects();
};

function projectRowHTML(p){
  const s=STAGE_STATUS[p.stage]||STAGE_STATUS.planning;
  const prColor=p.priority?PRIORITY_COLORS[p.priority]:'#444';
  const prLabel=p.priority?(p.priority.charAt(0).toUpperCase()+p.priority.slice(1)):'—';
  return`<div class="proj-row" onclick="openProjectModal('${p.id}')">
    <div class="proj-row-name-col">
      <div class="proj-row-checkbox"></div>
      <div class="proj-row-text">
        <div class="proj-row-name">${p.name}</div>
        ${p.category?`<div class="proj-row-cat">${p.category}</div>`:''}
      </div>
    </div>
    <div><span class="proj-status-pill" style="background:${s.bg}"><span class="proj-status-dot" style="background:${s.dotColor}"></span>${s.label}</span></div>
    <div>${p.priority?`<span class="proj-priority"><span class="proj-priority-dot" style="background:${prColor}"></span>${prLabel}</span>`:'<span style="color:var(--muted);font-size:13px">—</span>'}</div>
    <div class="proj-row-actions" onclick="event.stopPropagation()">
      <button class="proj-btn-sm del" onclick="deleteUserProject('${p.id}')">✕</button>
    </div>
  </div>`;
}

function renderProjects(){
  const all=(appData.userProjects||[]).filter(p=>!p.archived);
  const active=all.filter(p=>p.stage!=='done');
  const atRisk=all.filter(p=>p.stage==='building'||p.stage==='blocked');
  const done=all.filter(p=>p.stage==='done');
  const archived=(appData.userProjects||[]).filter(p=>p.archived);
  // Subtitle
  const sub=document.getElementById('projectsTabSub');
  if(sub)sub.textContent=`${active.length} active · ${atRisk.length} need attention · ${done.length} completed`;
  // Card grid
  const gridEl=document.getElementById('projectsCardGrid');
  if(!gridEl)return;
  if(!window._dataLoaded){gridEl.innerHTML=window.skeletonHTML;return;}
  let filtered=all;
  if(currentProjFilter==='on_track') filtered=all.filter(p=>STAGE_STATUS[p.stage]?.filterKey==='on_track');
  else if(currentProjFilter==='at_risk') filtered=all.filter(p=>STAGE_STATUS[p.stage]?.filterKey==='at_risk');
  else if(currentProjFilter==='blocked') filtered=all.filter(p=>p.stage==='blocked');
  else if(currentProjFilter==='done') filtered=all.filter(p=>p.stage==='done');
  if(!filtered.length){
    gridEl.innerHTML=`<div class="projects-empty-row" style="grid-column:1/-1;padding:48px 20px;text-align:center;color:var(--muted);font-size:14px">No projects${currentProjFilter!=='all'?' in this category':''} yet — hit <strong>+ New project</strong> to get started</div>`;
  } else {
    gridEl.innerHTML=filtered.map(projectCardHTML).join('');
  }
  // Archived section
  const archBtn=document.getElementById('showArchivedBtn');
  if(archBtn) archBtn.style.display=archived.length?'':'none';
  const archGrid=document.getElementById('archivedProjectsGrid');
  if(archGrid){
    archGrid.style.display=_showArchivedProjects&&archived.length?'':'none';
    if(_showArchivedProjects&&archived.length){
      archGrid.innerHTML=archived.map(p=>{
        const s=STAGE_STATUS[p.stage]||STAGE_STATUS.planning;
        return`<div class="proj-card" style="opacity:.55">
          <div class="proj-card-accent" style="background:${s.accent}"></div>
          <div class="proj-card-body">
            <div class="proj-card-top">
              <div class="proj-card-name">${p.name}</div>
              <span class="proj-status-badge" style="background:var(--card2);color:var(--muted)">Archived</span>
            </div>
            <div class="proj-card-desc">${p.category||'—'}</div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="proj-btn-sm" onclick="unarchiveProject('${p.id}')">Restore</button>
              <button class="proj-btn-sm del" onclick="deleteUserProject('${p.id}')">Delete</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }
  renderDashProjectsWidget();
}

window.unarchiveProject=function(id){
  const p=(appData.userProjects||[]).find(x=>x.id===id);
  if(p){p.archived=false;saveData();renderProjects();toast('Project restored');}
};

function projectCardHTML(p){
  const s=STAGE_STATUS[p.stage]||STAGE_STATUS.planning;
  const tasks=p.tasks||[];
  const doneCount=tasks.filter(t=>t.done).length;
  const pct=tasks.length>0?Math.round(doneCount/tasks.length*100):{planning:10,sourcing:30,building:60,blocked:20,done:100}[p.stage]||10;
  const dueFmt=p.dueDate?new Date(p.dueDate+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
  const taskMeta=tasks.length?`${doneCount}/${tasks.length} tasks${dueFmt?' · Due '+dueFmt:''}`:(dueFmt?'Due '+dueFmt:'No tasks yet');
  const taskRows=tasks.map(t=>`
    <div class="proj-task-row" onclick="event.stopPropagation();toggleProjTask('${p.id}','${t.id}')">
      <div class="proj-task-circle" style="border-color:${t.done?s.accent:'rgba(255,255,255,0.2)'};background:${t.done?s.accent:'transparent'};color:${t.done?'#000':'transparent'}">✓</div>
      <span class="proj-task-name${t.done?' done':''}${t.milestone?' milestone':''}">${t.milestone?'<span class="proj-task-flag">⚑</span>':''}${t.name}</span>
      <button class="proj-task-milestone-btn${t.milestone?' on':''}" onclick="event.stopPropagation();toggleProjTaskMilestone('${p.id}','${t.id}')" title="Toggle milestone">⚑</button>
    </div>`).join('');
  const notesSnip=p.notes?`<div class="proj-card-notes" title="${escHtml(p.notes)}">${escHtml(p.notes.slice(0,80))}${p.notes.length>80?'…':''}</div>`:'';
  const linkBtn=p.link?`<a class="proj-card-link" href="${escHtml(p.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>`:'';
  return`<div class="proj-card">
    <div class="proj-card-accent" style="background:${s.accent}"></div>
    <div class="proj-card-body">
      <div class="proj-card-top" onclick="openProjectModal('${p.id}')" style="cursor:pointer">
        <div class="proj-card-name">${p.name}</div>
        <div style="display:flex;align-items:center;gap:4px">
          ${linkBtn}
          <span class="proj-status-badge" style="background:${s.bg};color:${s.dotColor}">${s.label}</span>
        </div>
      </div>
      <div class="proj-card-desc" onclick="openProjectModal('${p.id}')" style="cursor:pointer">${p.category||p.nextAction||'—'}</div>
      ${notesSnip}
      <div class="proj-prog-row"><span style="font-weight:600;color:var(--sub)">Progress</span><span class="proj-prog-pct">${pct}%</span></div>
      <div class="proj-prog-track"><div class="proj-prog-fill" style="width:${pct}%;background:${s.accent}"></div></div>
      <div class="proj-task-section">
        <div class="proj-task-toggle" onclick="event.stopPropagation();toggleProjTasks('${p.id}')">
          <span>${taskMeta}</span>
          <svg class="proj-task-chev" id="ptchev-${p.id}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="proj-task-list" id="ptlist-${p.id}">
          ${taskRows}
          <div class="proj-task-add-row" onclick="event.stopPropagation()">
            <input id="ptinput-${p.id}" placeholder="+ Add task" onkeydown="if(event.key==='Enter')addProjTask('${p.id}')">
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="proj-card-del" onclick="event.stopPropagation();deleteUserProject('${p.id}')">✕</button>
      </div>
    </div>
  </div>`;
}

window.toggleProjTaskMilestone=function(projId,taskId){
  const p=(appData.userProjects||[]).find(x=>x.id===projId);
  if(!p||!p.tasks)return;
  const t=p.tasks.find(x=>x.id===taskId);
  if(t){t.milestone=!t.milestone;saveData();renderProjects();}
};

window.toggleProjGroup=function(key){
  projGroupOpen[key]=projGroupOpen[key]===false;
  const el=document.getElementById('projgroup-'+key);
  const chev=document.getElementById('chevron-'+key);
  if(el)el.style.display=projGroupOpen[key]===false?'none':'';
  if(chev)chev.style.transform=projGroupOpen[key]===false?'rotate(-90deg)':'';
};

function renderDashProjectsWidget(){
  const el=document.getElementById('dashProjectsWidget');
  if(!el)return;
  const all=appData.userProjects||[];
  const active=all.filter(p=>p.stage!=='done');
  const inProgress=active.filter(p=>p.stage==='building'||p.stage==='blocked');
  const subEl=document.getElementById('dashProjSub');
  if(subEl)subEl.textContent=`${active.length} active build${active.length!==1?'s':''} · ${inProgress.length} in progress`;
  if(!active.length){
    el.innerHTML='<div style="padding:24px 20px;color:var(--muted);font-size:13px;text-align:center">No active projects — <button onclick="switchTab(\'projects\')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:13px;font-family:inherit">add one →</button></div>';
    return;
  }
  el.innerHTML=active.slice(0,5).map(p=>{
    const s=STAGE_STATUS[p.stage]||STAGE_STATUS.planning;
    const prColor=p.priority?PRIORITY_COLORS[p.priority]:'#444';
    const prLabel=p.priority?(p.priority.charAt(0).toUpperCase()+p.priority.slice(1)):'—';
    return`<div class="dash-proj-row">
      <div><div class="dash-proj-name">${p.name}</div>${p.category?`<div class="dash-proj-cat">${p.category}</div>`:''}</div>
      <div><span class="proj-status-pill" style="background:${s.bg}"><span class="proj-status-dot" style="background:${s.dotColor}"></span>${s.label}</span></div>
      <div>${p.priority?`<span class="proj-priority"><span class="proj-priority-dot" style="background:${prColor}"></span>${prLabel}</span>`:'<span style="color:var(--muted);font-size:13px">—</span>'}</div>
    </div>`;
  }).join('');
}
let _showArchivedProjects=false;

window.toggleShowArchived=function(){
  _showArchivedProjects=!_showArchivedProjects;
  const btn=document.getElementById('showArchivedBtn');
  if(btn)btn.textContent=_showArchivedProjects?'Hide archived projects':'Show archived projects';
  renderProjects();
};

window.archiveProject=function(){
  const id=document.getElementById('projectEditId').value;
  if(!id)return;
  const p=(appData.userProjects||[]).find(x=>x.id===id);
  if(!p)return;
  p.archived=true;
  saveData();closeModal('projectModal');renderProjects();toast('Project archived');
};

window.openProjectModal=function(id){
  const p=id?(appData.userProjects||[]).find(x=>x.id===id):null;
  document.getElementById('projectModalTitle').textContent=p?'Edit Project':'New Project';
  document.getElementById('projectEditId').value=id||'';
  document.getElementById('projectName').value=p?p.name:'';
  document.getElementById('projectCategory').value=p?p.category||'':'';
  document.getElementById('projectStage').value=p?p.stage:'planning';
  document.getElementById('projectPriority').value=p?p.priority||'':'';
  document.getElementById('projectNextAction').value=p?p.nextAction||'':'';
  document.getElementById('projectNotes').value=p?p.notes||'':'';
  document.getElementById('projectLink').value=p?p.link||'':'';
  document.getElementById('projectDueDate').value=p?p.dueDate||'':'';
  // Archive button: only show for done-stage projects
  const archBtn=document.getElementById('projectArchiveBtn');
  if(archBtn) archBtn.style.display=(p&&p.stage==='done'&&!p.archived)?'':'none';
  openModal('projectModal');
};

window.saveProject=function(){
  const name=document.getElementById('projectName').value.trim();
  if(!name)return;
  const id=document.getElementById('projectEditId').value;
  const stage=document.getElementById('projectStage').value;
  const category=document.getElementById('projectCategory').value.trim().toUpperCase();
  const priority=document.getElementById('projectPriority').value;
  const nextAction=document.getElementById('projectNextAction').value.trim();
  const notes=document.getElementById('projectNotes').value.trim();
  const link=document.getElementById('projectLink').value.trim();
  const dueDate=document.getElementById('projectDueDate').value;
  if(!appData.userProjects)appData.userProjects=[];
  if(id){
    const p=appData.userProjects.find(x=>x.id===id);
    if(p){p.name=name;p.stage=stage;p.category=category;p.priority=priority;p.nextAction=nextAction;p.notes=notes;p.link=link;p.dueDate=dueDate;}
  } else {
    appData.userProjects.push({id:uid(),name,stage,category,priority,nextAction,notes,link,dueDate,tasks:[],created:todayStr()});
  }
  saveData();closeModal('projectModal');renderProjects();renderDashProjectsWidget();toast(id?'✓ Project updated':'✓ Project added');
};

window.toggleProjTasks=function(id){
  const list=document.getElementById('ptlist-'+id);
  const chev=document.getElementById('ptchev-'+id);
  if(!list)return;
  const open=list.classList.toggle('open');
  if(chev)chev.style.transform=open?'rotate(180deg)':'';
};

window.toggleProjTask=function(projId,taskId){
  const p=(appData.userProjects||[]).find(x=>x.id===projId);
  if(!p||!p.tasks)return;
  const t=p.tasks.find(x=>x.id===taskId);
  if(t){t.done=!t.done;saveData();renderProjects();}
};

window.addProjTask=function(projId){
  const inp=document.getElementById('ptinput-'+projId);
  if(!inp)return;
  const name=inp.value.trim();
  if(!name)return;
  const p=(appData.userProjects||[]).find(x=>x.id===projId);
  if(!p)return;
  if(!p.tasks)p.tasks=[];
  p.tasks.push({id:uid(),name,done:false});
  saveData();
  renderProjects();
  const list=document.getElementById('ptlist-'+projId);
  const chev=document.getElementById('ptchev-'+projId);
  if(list){list.classList.add('open');}
  if(chev){chev.style.transform='rotate(180deg)';}
  const newInp=document.getElementById('ptinput-'+projId);
  if(newInp){newInp.focus();}
};

window.deleteUserProject=function(id){
  appData.userProjects=(appData.userProjects||[]).filter(p=>p.id!==id);
  saveData();renderProjects();toast('Project removed');
};

// ── GLOBAL EXPORTS ──
Object.assign(window, { renderProjects, renderDashProjectsWidget });
