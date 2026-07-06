// ── FINANCE RING (legacy, kept for any callers) ───────────────────
function renderFinanceRing(){
  // All ring DOM elements were removed from the dashboard; this is a no-op
  // unless the elements exist (e.g. custom HTML adds them back).
  const arc=document.getElementById('ringArc');
  if(!arc)return;
  const budget=appData.budget.monthly||(appData.budget.income)||0;
  const mt=appData.transactions.filter(t=>{
    const d=new Date(t.date);return d.getMonth()===currentMonth&&d.getFullYear()===currentYear;
  });
  const spent=mt.filter(t=>t.type==='out').reduce((s,t)=>s+t.amount,0);
  if(!budget)return;
  const circ=2*Math.PI*70;
  const offset=circ*(1-Math.min(spent/budget,1));
  arc.setAttribute('stroke',spent>budget?'#ff453a':spent>budget*.8?'#ffd60a':'#30d158');
  arc.style.strokeDashoffset=offset;
  const pm=document.getElementById('paceMark');
  if(pm){
    const today=new Date();const dim=daysInMonth(today.getFullYear(),today.getMonth());
    const paceAngle=(today.getDate()/dim)*2*Math.PI;
    pm.setAttribute('cx',90+70*Math.cos(paceAngle));pm.setAttribute('cy',90+70*Math.sin(paceAngle));
  }
}
function renderDashNW(){
  const el=document.getElementById('dashNWList');
  const subEl=document.getElementById('dashNWSub');
  if(!el)return;
  const accounts=appData.accounts||[];
  if(!accounts.length){
    el.innerHTML='<div style="padding:16px 20px;color:var(--muted);font-size:13px">No accounts — <button onclick="switchTab(\'finance\')" style="background:none;border:none;color:var(--green);cursor:pointer;font-size:13px;font-family:inherit">add one →</button></div>';
    if(subEl)subEl.textContent='—';
    return;
  }
  const assets=accounts.filter(a=>a.type!=='debt').reduce((s,a)=>s+a.balance,0);
  const liabilities=accounts.filter(a=>a.type==='debt').reduce((s,a)=>s+a.balance,0);
  const netWorth=assets-liabilities;
  if(subEl)subEl.textContent='Total '+fmtM(netWorth);
  el.innerHTML=accounts.slice(0,5).map(a=>{
    const meta=ACCT_TYPE_META[a.type]||{label:a.type,color:'#888'};
    return`<div class="dash-proj-row" style="grid-template-columns:1fr auto">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:8px;height:8px;border-radius:50%;background:${meta.color};flex-shrink:0"></div>
        <div>
          <div class="dash-proj-name">${a.name}</div>
          <div class="dash-proj-cat">${meta.label}</div>
        </div>
      </div>
      <div style="font-size:14px;font-weight:600;color:${a.type==='debt'?'var(--red)':'var(--text)'}">${a.type==='debt'?'-':''}${fmtM(a.balance)}</div>
    </div>`;
  }).join('')+(accounts.length>5?`<div style="padding:10px 20px;font-size:12px;color:var(--muted)">${accounts.length-5} more accounts</div>`:'');
}
// ── FINANCE TAB ───────────────────────────────────────────────────
window.renderFinanceTab=renderFinanceTab;
function renderFinanceTab(){
  renderFinanceRing();
  updateHideNumBtn();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthEl=document.getElementById('financeTabMonth');
  if(monthEl) monthEl.textContent=months[currentMonth]+' '+currentYear;

  const mt=appData.transactions.filter(t=>{const d=new Date(t.date);return d.getMonth()===currentMonth&&d.getFullYear()===currentYear;});
  const spent=mt.filter(t=>t.type==='out').reduce((s,t)=>s+t.amount,0);
  const budget=appData.budget.monthly||appData.budget.income||0;

  // ── Net Worth Hero ──────────────────────────────────────────────
  const accounts=appData.accounts||[];
  const assets=accounts.filter(a=>a.type!=='debt').reduce((s,a)=>s+a.balance,0);
  const liabilities=accounts.filter(a=>a.type==='debt').reduce((s,a)=>s+a.balance,0);
  const netWorth=assets-liabilities;
  const nwAmount=document.getElementById('nwHeroAmount');
  const nwBadge=document.getElementById('nwHeroBadge');
  const nwSub=document.getElementById('nwHeroSub');
  if(nwAmount) nwAmount.textContent=fmtM(netWorth);
  if(nwBadge){
    nwBadge.style.display=accounts.length?'inline-flex':'none';
    nwBadge.textContent='↑ '+fmtM(spent)+' this month';
  }
  if(nwSub) nwSub.textContent=accounts.length?`${fmtM(assets)} assets · `+(liabilities>0?`${fmtM(liabilities)} liabilities`:'no liabilities'):'Add accounts to track net worth';

  // ── Account Cards ───────────────────────────────────────────────
  const acctRow=document.getElementById('acctCardsRow');
  if(acctRow){
    if(!accounts.length){
      acctRow.innerHTML=`<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--muted);font-size:13px">No accounts yet — click <b>+ Account</b> to add one.</div>`;
    } else {
      const ACCT_ICON={checking:'💳',savings:'🛡️',investment:'📈',crypto:'₿',property:'🏠',debt:'💸'};
      acctRow.innerHTML=accounts.map(a=>{
        const meta=ACCT_TYPE_META[a.type]||{label:a.type,color:'#888'};
        const isDebt=a.type==='debt';
        const last4=a.id.slice(-4).toUpperCase();
        const creditLimit=a.creditLimit||0;
        const barPct=isDebt&&creditLimit>0?Math.min(a.balance/creditLimit*100,100):0;
        return`<div class="acct-card" onclick="openAccountModal('${a.id}')">
          <div class="acct-card-icon" style="background:${meta.color}22">${ACCT_ICON[a.type]||'💰'}</div>
          <div class="acct-card-name">${a.name}${a.source==='plaid'?' <span class="acct-plaid-badge" title="Synced via Plaid">🔗</span>':''}</div>
          <div class="acct-card-num">•••• ${last4}</div>
          <div class="acct-card-bal${isDebt?' red':''}">${isDebt?'-':''}${fmtM(a.balance)}</div>
          ${isDebt&&creditLimit>0?`
            <div class="acct-card-bar"><div class="acct-card-bar-fill" style="width:${barPct}%;background:${meta.color}"></div></div>
            <div class="acct-card-limit">${fmtM(a.balance)} of ${fmtM(creditLimit)} limit</div>
          `:''}
        </div>`;
      }).join('');
    }
  }

  // ── Payday Bar ──────────────────────────────────────────────────
  const now=new Date();
  const daysInMonth=new Date(currentYear,currentMonth+1,0).getDate();
  const dayOfMonth=currentMonth===now.getMonth()&&currentYear===now.getFullYear()?now.getDate():1;
  const paidDay=1; // pay period starts 1st
  const nextPayDay=new Date(currentYear,currentMonth+1,1);
  const daysLeft=Math.max(0,Math.ceil((nextPayDay-now)/(1000*60*60*24)));
  const pct=Math.round((dayOfMonth-1)/(daysInMonth-1)*100);
  const startLabel=months[currentMonth].slice(0,3)+' 1';
  const endLabel=months[(currentMonth+1)%12].slice(0,3)+' 1';
  const pEl=id=>document.getElementById(id);
  if(pEl('paydayDays')) pEl('paydayDays').textContent=daysLeft;
  if(pEl('paydayDaysText')) pEl('paydayDaysText').textContent='days';
  if(pEl('paydayDate')) pEl('paydayDate').textContent=endLabel+' '+currentYear;
  if(pEl('paydayStart')) pEl('paydayStart').textContent=startLabel+' '+currentYear;
  if(pEl('paydayEnd')) pEl('paydayEnd').textContent=endLabel+' '+currentYear;
  if(pEl('paydayFill')) pEl('paydayFill').style.width=pct+'%';
  if(pEl('paydayPct')) pEl('paydayPct').textContent=pct+'% through pay period';

  // ── Spending Donut ──────────────────────────────────────────────
  const catEntries=Object.entries(appData.budget.categories||{});
  const spendingHdr=document.getElementById('spendingCardHdr');
  if(spendingHdr) spendingHdr.textContent=months[currentMonth]+' spending';
  const donutSvg=document.getElementById('spendingDonutSvg');
  const legendEl=document.getElementById('spendingLegend');
  const totalEl=document.getElementById('spendingTotal');
  const ofEl=document.getElementById('spendingOf');
  if(totalEl) totalEl.textContent=fmtM(spent);
  if(ofEl) ofEl.textContent='of '+fmtM(budget||spent||1);

  // Build donut segments from category spending
  const DONUT_COLORS=['#ff453a','#ff9f0a','#30d158','#bf5af2','#0a84ff','#64d2ff','#ffd60a','#ff6b35'];
  const catSpends=catEntries.map(([cat,limit],i)=>{
    const catSpent=mt.filter(t=>t.type==='out'&&t.category===cat).reduce((s,t)=>s+t.amount,0);
    return{cat,limit,catSpent,color:DONUT_COLORS[i%DONUT_COLORS.length]};
  }).filter(c=>c.catSpent>0).sort((a,b)=>b.catSpent-a.catSpent);

  if(donutSvg){
    const r=56,cx=80,cy=80,circ=2*Math.PI*r;
    const total=catSpends.reduce((s,c)=>s+c.catSpent,0)||1;
    let offset=0;
    let segs='<circle cx="80" cy="80" r="56" fill="none" stroke="var(--track)" stroke-width="18"/>';
    for(const c of catSpends){
      const dash=(c.catSpent/total)*circ;
      const gap=circ-dash;
      segs+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.color}" stroke-width="18" stroke-linecap="butt"
        stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"/>`;
      offset+=dash;
    }
    donutSvg.innerHTML=segs;
  }
  if(legendEl){
    if(!catSpends.length){
      legendEl.innerHTML='<div style="color:var(--muted);font-size:13px">No spending this month</div>';
    } else {
      legendEl.innerHTML=catSpends.slice(0,6).map(c=>`
        <div class="spending-leg-row">
          <div class="spending-leg-dot" style="background:${c.color}"></div>
          <div class="spending-leg-name">${CATS_EMOJI[c.cat]||''} ${c.cat}</div>
          <div class="spending-leg-amt">${fmtM(c.catSpent)}</div>
        </div>`).join('');
    }
  }

  // ── Transactions ────────────────────────────────────────────────
  if(typeof renderTxnListFiltered==='function'){
    renderTxnListFiltered(mt);
  } else {
    const sorted=[...mt].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,30);
    const txnEl=document.getElementById('txnList');
    if(txnEl) txnEl.innerHTML=!sorted.length
      ?'<div class="empty-state" style="padding:30px">No transactions this month</div>'
      :sorted.map(t=>`<div class="txn-item">
        <div class="txn-icon">${CATS_EMOJI[t.category]||'📦'}</div>
        <div class="txn-name-col"><div class="txn-name">${t.name}</div><div class="txn-cat">${t.category||'Other'} · ${t.date}</div></div>
        <span class="txn-amount ${t.type}">${t.type==='out'?'-':'+'}${fmtM(t.amount)}</span>
        <button class="txn-del" onclick="deleteTxn('${t.id}')">✕</button>
      </div>`).join('');
  }
  // ── Batch-3 finance sections ────────────────────────────────────
  if(typeof renderSavingsRate==='function')renderSavingsRate(mt);
  if(typeof renderCatBarChart==='function')renderCatBarChart(mt);
  if(typeof renderMonthlyTrend==='function')renderMonthlyTrend();
  if(typeof renderRecurringTxns==='function')renderRecurringTxns();
  if(typeof renderNWSparkline==='function')renderNWSparkline();
}

window.changeMonth=function(dir){
  currentMonth+=dir;
  if(currentMonth<0){currentMonth=11;currentYear--;}
  if(currentMonth>11){currentMonth=0;currentYear++;}
  renderFinanceTab();
};
window.updateTxnRecurVis=function(){
  const cb=document.getElementById('txnRecurring');
  const sel=document.getElementById('txnRecurFreq');
  if(sel)sel.style.display=cb&&cb.checked?'block':'none';
};
window.openTxnModal=function(){
  document.getElementById('txnDate').value=todayStr();
  const cb=document.getElementById('txnRecurring');
  const sel=document.getElementById('txnRecurFreq');
  if(cb)cb.checked=false;
  if(sel)sel.style.display='none';
  openModal('txnModal');
};
window.saveTxn=function(){
  const name=document.getElementById('txnName').value.trim();
  const amount=parseFloat(document.getElementById('txnAmount').value);
  if(!name||isNaN(amount)||amount<=0)return;
  const recurring=document.getElementById('txnRecurring')?.checked||false;
  const recurrence=recurring?(document.getElementById('txnRecurFreq')?.value||'monthly'):null;
  appData.transactions.push({
    id:uid(),name,amount,
    category:document.getElementById('txnCategory').value,
    type:document.getElementById('txnType').value,
    date:document.getElementById('txnDate').value,
    recurring:recurring||false,
    recurrence:recurrence||null,
  });
  saveData();
  document.getElementById('txnName').value='';
  document.getElementById('txnAmount').value='';
  closeModal('txnModal');renderFinanceTab();toast('✓ Transaction added');
};
// Immediate delete with 6s undo toast (#7)
window.deleteTxn=function(id){
  const idx=appData.transactions.findIndex(t=>t.id===id);
  if(idx===-1)return;
  const [removed]=appData.transactions.splice(idx,1);
  saveData();renderFinanceTab();
  toastUndo(removed.name,()=>{
    appData.transactions.splice(Math.min(idx,appData.transactions.length),0,removed);
    saveData();renderFinanceTab();
  });
};

// Enter advances fields; Cmd/Ctrl+Enter saves (#11)
setupModalEnterFlow('txnModal',['txnName','txnAmount','txnCategory','txnType','txnDate'],()=>saveTxn());
window.openBudgetModal=function(){
  document.getElementById('budgetIncome').value=appData.budget.income||appData.budget.monthly||'';
  const inp=document.getElementById('budgetInputs');
  inp.innerHTML=Object.entries(appData.budget.categories||{}).map(([cat,val])=>
    `<div class="form-group"><label class="form-label">${CATS_EMOJI[cat]||''} ${cat} ($)</label><input class="form-input" type="number" id="bc_${cat.replace(/[^a-z]/gi,'_')}" value="${val}" min="0"></div>`
  ).join('');
  // Category budget limits
  const catBudgetEl=document.getElementById('catBudgetInputs');
  if(catBudgetEl){
    const catBudgets=appData.categoryBudgets||{};
    catBudgetEl.innerHTML=Object.keys(appData.budget.categories||{}).map(cat=>`
      <div class="cat-budget-row">
        <span class="cat-budget-name">${CATS_EMOJI[cat]||''} ${cat}</span>
        <input class="cat-budget-input" type="number" id="cb_${cat.replace(/[^a-z]/gi,'_')}"
          value="${catBudgets[cat]||''}" min="0" placeholder="No limit">
      </div>`).join('');
  }
  openModal('budgetModal');
};
window.saveBudget=function(){
  const income=parseFloat(document.getElementById('budgetIncome').value)||0;
  appData.budget.income=income;appData.budget.monthly=income;
  Object.keys(appData.budget.categories||{}).forEach(cat=>{
    const el=document.getElementById('bc_'+cat.replace(/[^a-z]/gi,'_'));
    if(el)appData.budget.categories[cat]=parseFloat(el.value)||0;
  });
  // Save category budgets
  if(!appData.categoryBudgets)appData.categoryBudgets={};
  Object.keys(appData.budget.categories||{}).forEach(cat=>{
    const el=document.getElementById('cb_'+cat.replace(/[^a-z]/gi,'_'));
    if(el){
      const v=parseFloat(el.value);
      if(v>0)appData.categoryBudgets[cat]=v;
      else delete appData.categoryBudgets[cat];
    }
  });
  saveData();closeModal('budgetModal');renderFinanceTab();toast('✓ Budget saved');
};
// ── ACCOUNTS ──────────────────────────────────────────────────────
window.openAccountModal=function(id){
  const a=id?(appData.accounts||[]).find(x=>x.id===id):null;
  document.getElementById('accountEditId').value=id||'';
  document.getElementById('accountModalTitle').textContent=a?'Edit Account':'Add Account';
  document.getElementById('accountName').value=a?a.name:'';
  document.getElementById('accountType').value=a?a.type:'savings';
  document.getElementById('accountBalance').value=a?a.balance:'';
  openModal('accountModal');
};
window.saveAccount=function(){
  const name=document.getElementById('accountName').value.trim();
  const balance=parseFloat(document.getElementById('accountBalance').value)||0;
  const type=document.getElementById('accountType').value;
  const editId=document.getElementById('accountEditId').value;
  if(!name)return;
  if(!appData.accounts)appData.accounts=[];
  if(editId){
    const a=appData.accounts.find(x=>x.id===editId);
    if(a){a.name=name;a.type=type;a.balance=balance;a.updatedAt=Date.now();}
  } else {
    appData.accounts.push({id:uid(),name,type,balance,updatedAt:Date.now()});
  }
  saveData();closeModal('accountModal');renderFinanceTab();renderGoals();renderDashNW();toast('✓ Account saved');
};
window.deleteAccount=function(id){
  appData.accounts=(appData.accounts||[]).filter(a=>a.id!==id);
  saveData();renderFinanceTab();renderGoals();renderDashNW();toast('Account removed');
};
// ── GOALS ─────────────────────────────────────────────────────────
const GOAL_COLORS=['#30d158','#0a84ff','#ff9f0a','#bf5af2','#ff453a','#64d2ff','#ff6eb4','#30d158'];

// Get current balance for a goal (supports multiple linked accounts)
function goalCurrentBalance(g){
  const ids=g.linkedAccountIds||(g.linkedAccountId?[g.linkedAccountId]:[]);
  if(ids.length){
    const accounts=appData.accounts||[];
    const sum=ids.reduce((s,id)=>{
      const a=accounts.find(x=>x.id===id);
      return s+(a?a.balance:0);
    },0);
    return sum;
  }
  return g.current||0;
}

// Append today's balance to balanceHistory if not already logged
function logGoalBalanceHistory(g){
  const today=todayStr();
  if(!g.balanceHistory)g.balanceHistory=[];
  const alreadyLogged=g.balanceHistory.some(h=>h.date===today);
  if(!alreadyLogged){
    g.balanceHistory.push({date:today,balance:goalCurrentBalance(g)});
    // Keep last 90 days
    if(g.balanceHistory.length>90)g.balanceHistory=g.balanceHistory.slice(-90);
  }
}

// Get balance from 7 days ago for weekly change calc
function goalBalanceWeekAgo(g){
  if(!g.balanceHistory||!g.balanceHistory.length)return null;
  const sevenAgo=new Date();sevenAgo.setDate(sevenAgo.getDate()-7);
  const sevenAgoStr=sevenAgo.toLocaleDateString('en-CA');
  // Find closest entry at or before 7 days ago
  const older=g.balanceHistory.filter(h=>h.date<=sevenAgoStr);
  if(!older.length)return null;
  return older[older.length-1].balance;
}

function renderGoals(){
  const el=document.getElementById('goalsGrid');
  if(!el)return;
  if(!window._dataLoaded){el.innerHTML=window.skeletonHTML;return;}
  const goals=appData.goals||[];
  const sub=document.getElementById('goalsSub');
  if(sub){
    const done=goals.filter(g=>goalCurrentBalance(g)>=(g.target||1)).length;
    sub.textContent=goals.length?`${done} of ${goals.length} goal${goals.length!==1?'s':''} reached`:'Track what you\'re building toward.';
  }
  if(!goals.length){
    el.innerHTML='<div class="goals-empty">No goals yet — click <b>+ New Goal</b> to add one.</div>';
    return;
  }
  el.innerHTML=goals.map((g,i)=>{
    const color=GOAL_COLORS[i%GOAL_COLORS.length];
    const current=goalCurrentBalance(g);
    const target=g.target||1;
    const pct=Math.min(current/target*100,100);
    const done=pct>=100;
    // Weekly change
    const weekAgo=goalBalanceWeekAgo(g);
    let weeklyHtml='';
    if(weekAgo!==null){
      const diff=current-weekAgo;
      if(diff>0) weeklyHtml=`<div class="goal-weekly-change">+ ${fmt(diff)} this week</div>`;
      else if(diff<0) weeklyHtml=`<div class="goal-weekly-change" style="color:var(--red)">- ${fmt(Math.abs(diff))} this week</div>`;
      else weeklyHtml=`<div class="goal-weekly-change none">no change this week</div>`;
    }
    // Linked account names
    const ids=g.linkedAccountIds||(g.linkedAccountId?[g.linkedAccountId]:[]);
    const linkedNames=ids.map(id=>(appData.accounts||[]).find(a=>a.id===id)?.name).filter(Boolean);
    const linkedSub=linkedNames.length?`<div class="goal-sub">Linked: ${linkedNames.join(', ')}</div>`:'';
    return `<div class="goal-card">
      <div class="goal-top">
        <div class="goal-icon" style="background:${color}22;color:${color}">${g.emoji||'🎯'}</div>
        <div style="flex:1">
          <div class="goal-name">${g.name}</div>
          ${linkedSub}
        </div>
        <div class="goal-actions">
          <button class="goal-action-btn" onclick="openGoalModal('${g.id}')">✏️</button>
          <button class="goal-action-btn" onclick="deleteGoal('${g.id}')" style="color:var(--red)">✕</button>
        </div>
      </div>
      <div class="goal-amounts">
        <div class="goal-current" style="color:${color}">${fmtM(current)}</div>
        <div class="goal-target">of ${fmtM(target)}</div>
      </div>
      <div class="goal-bar-track">
        <div class="goal-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="goal-pct">${done?'🎉 Goal reached!':Math.round(pct)+'% · '+fmtM(target-current)+' to go'}</div>
      ${weeklyHtml}
    </div>`;
  }).join('');
}

window.openGoalModal=function(id){
  const g=id?(appData.goals||[]).find(x=>x.id===id):null;
  document.getElementById('goalEditId').value=id||'';
  document.getElementById('goalModalTitle').textContent=g?'Edit Goal':'New Goal';
  document.getElementById('goalName').value=g?g.name:'';
  document.getElementById('goalEmoji').value=g?g.emoji:'🎯';
  document.getElementById('goalTarget').value=g?g.target:'';
  document.getElementById('goalCurrent').value=g?g.current:'';
  // Populate multi-select linked accounts
  const wrap=document.getElementById('goalLinkedAccountsWrap');
  const selectedIds=g?(g.linkedAccountIds||(g.linkedAccountId?[g.linkedAccountId]:[])):[];
  wrap.innerHTML=(appData.accounts||[]).length
    ?(appData.accounts||[]).map(a=>`<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:2px 0">
        <input type="checkbox" value="${a.id}" ${selectedIds.includes(a.id)?'checked':''} onchange="updateGoalCurrentFromAccounts()" style="cursor:pointer">
        ${a.name} <span style="color:var(--muted);font-size:12px">${fmt(a.balance)}</span>
      </label>`).join('')
    :'<div style="color:var(--muted);font-size:13px">No accounts yet</div>';
  // If any linked account checked, disable current field
  const anyChecked=selectedIds.length>0;
  document.getElementById('goalCurrent').disabled=anyChecked;
  openModal('goalModal');
};

window.updateGoalCurrentFromAccounts=function(){
  const wrap=document.getElementById('goalLinkedAccountsWrap');
  const checked=[...wrap.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
  document.getElementById('goalCurrent').disabled=checked.length>0;
  if(checked.length>0){
    const total=checked.reduce((s,id)=>{
      const a=(appData.accounts||[]).find(x=>x.id===id);
      return s+(a?a.balance:0);
    },0);
    document.getElementById('goalCurrent').value=total.toFixed(0);
  }
};

window.saveGoal=function(){
  const name=document.getElementById('goalName').value.trim();
  const emoji=document.getElementById('goalEmoji').value.trim()||'🎯';
  const target=parseFloat(document.getElementById('goalTarget').value)||0;
  const current=parseFloat(document.getElementById('goalCurrent').value)||0;
  // Get checked account IDs
  const wrap=document.getElementById('goalLinkedAccountsWrap');
  const linkedAccountIds=[...wrap.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
  const editId=document.getElementById('goalEditId').value;
  if(!name||!target)return;
  if(!appData.goals)appData.goals=[];
  if(editId){
    const g=appData.goals.find(x=>x.id===editId);
    if(g){Object.assign(g,{name,emoji,target,current,linkedAccountIds,linkedAccountId:linkedAccountIds[0]||null});}
  } else {
    appData.goals.push({id:uid(),name,emoji,target,current,linkedAccountIds,linkedAccountId:linkedAccountIds[0]||null,created:todayStr()});
  }
  saveData();closeModal('goalModal');renderGoals();toast('✓ Goal saved');
};
window.deleteGoal=function(id){
  appData.goals=(appData.goals||[]).filter(g=>g.id!==id);
  saveData();renderGoals();toast('Goal removed');
};
// ── #25: Net worth history ────────────────────────────────────────
function trackNetWorthHistory(){
  const today=todayStr();
  if(!appData.netWorthHistory)appData.netWorthHistory=[];
  const accounts=appData.accounts||[];
  const assets=accounts.filter(a=>a.type!=='debt').reduce((s,a)=>s+a.balance,0);
  const liabilities=accounts.filter(a=>a.type==='debt').reduce((s,a)=>s+a.balance,0);
  const nw=assets-liabilities;
  const last=appData.netWorthHistory[appData.netWorthHistory.length-1];
  if(!last||last.date!==today){
    appData.netWorthHistory.push({date:today,netWorth:nw});
    if(appData.netWorthHistory.length>365)appData.netWorthHistory=appData.netWorthHistory.slice(-365);
  }
}

// Patch saveData to track NW history
function renderNWSparkline(){
  const card=document.getElementById('nwSparklineCard');
  const svg=document.getElementById('nwSparklineSvg');
  const hist=appData.netWorthHistory||[];
  if(!card||!svg||hist.length<2){if(card)card.style.display='none';return;}
  card.style.display='';
  const last30=hist.slice(-30);
  const vals=last30.map(h=>h.netWorth);
  const min=Math.min(...vals),max=Math.max(...vals);
  const range=max-min||1;
  const W=svg.getBoundingClientRect().width||300,H=60;
  const pts=vals.map((v,i)=>{
    const x=(i/(vals.length-1))*W;
    const y=H-((v-min)/range)*(H-8)-4;
    return`${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastVal=vals[vals.length-1];
  const color=lastVal>=0?'var(--green)':'var(--red)';
  svg.innerHTML=`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${((vals.length-1)/(vals.length-1)*W).toFixed(1)}" cy="${(H-((lastVal-min)/range)*(H-8)-4).toFixed(1)}" r="3" fill="${color}"/>`;
}

// ── #30: Savings rate ─────────────────────────────────────────────
function renderSavingsRate(mt){
  const card=document.getElementById('savingsRateCard');
  if(!card)return;
  const income=mt.filter(t=>t.type==='in').reduce((s,t)=>s+t.amount,0);
  const expenses=mt.filter(t=>t.type==='out').reduce((s,t)=>s+t.amount,0);
  if(income<=0){card.style.display='none';return;}
  card.style.display='';
  const rate=Math.round((income-expenses)/income*100);
  const ratePct=document.getElementById('savingsRatePct');
  const fill=document.getElementById('savingsRateFill');
  const detail=document.getElementById('savingsRateDetail');
  if(ratePct)ratePct.textContent=rate+'%';
  const color=rate>=20?'var(--green)':rate>=10?'var(--yellow)':'var(--red)';
  if(ratePct)ratePct.style.color=color;
  if(fill){fill.style.width=Math.max(0,Math.min(rate,100))+'%';fill.style.background=color;}
  if(detail)detail.textContent=`${fmtM(income)} income · ${fmtM(expenses)} expenses`;
}

// ── #21: Category bar chart ───────────────────────────────────────
function renderCatBarChart(mt){
  const el=document.getElementById('catBarChart');
  if(!el)return;
  const DONUT_COLORS=['#ff453a','#ff9f0a','#30d158','#bf5af2','#0a84ff','#64d2ff','#ffd60a','#ff6b35'];
  const spent=mt.filter(t=>t.type==='out');
  const total=spent.reduce((s,t)=>s+t.amount,0)||1;
  // Group by category
  const bycat={};
  spent.forEach(t=>{bycat[t.category]=(bycat[t.category]||0)+t.amount;});
  let cats=Object.entries(bycat).sort((a,b)=>b[1]-a[1]);
  // Top 6 + Other
  if(cats.length>6){
    const other=cats.slice(6).reduce((s,[,v])=>s+v,0);
    cats=cats.slice(0,6);
    if(other>0)cats.push(['Other',other]);
  }
  const catBudgets=appData.categoryBudgets||{};
  if(!cats.length){el.innerHTML='<div style="color:var(--muted);font-size:13px">No spending this month</div>';return;}
  el.innerHTML=cats.map(([cat,amt],i)=>{
    const pct=Math.round(amt/total*100);
    const barW=Math.round(amt/total*100);
    const color=DONUT_COLORS[i%DONUT_COLORS.length];
    const limit=catBudgets[cat]||0;
    const limitMarker=limit>0?`<div class="cat-bar-limit" style="left:${Math.min(limit/total*100,100).toFixed(1)}%"></div>`:'';
    const overBudget=limit>0&&amt>limit;
    return`<div class="cat-bar-row">
      <span class="cat-bar-label" title="${cat}">${CATS_EMOJI[cat]||''} ${cat}</span>
      <div class="cat-bar-track">
        <div class="cat-bar-fill" style="width:${barW}%;background:${overBudget?'var(--red)':color}">${limitMarker}</div>
      </div>
      <span class="cat-bar-amt" style="color:${overBudget?'var(--red)':'var(--text)'}">${fmtM(amt)}</span>
      <span class="cat-bar-pct">${pct}%</span>
    </div>`;
  }).join('');
}

// ── #22: 6-month trend ────────────────────────────────────────────
function renderMonthlyTrend(){
  const chartEl=document.getElementById('trendChart');
  const lblEl=document.getElementById('trendLabels');
  if(!chartEl)return;
  const now=new Date();
  const months=[];
  for(let i=5;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    months.push({m:d.getMonth(),y:d.getFullYear(),label:d.toLocaleDateString('en-US',{month:'short'})});
  }
  const DONUT_COLORS=['#ff453a','#ff9f0a','#30d158','#bf5af2','#0a84ff','#64d2ff'];
  const data=months.map((mo,i)=>{
    const txns=(appData.transactions||[]).filter(t=>{const d=new Date(t.date);return d.getMonth()===mo.m&&d.getFullYear()===mo.y;});
    const spent=txns.filter(t=>t.type==='out').reduce((s,t)=>s+t.amount,0);
    const income=txns.filter(t=>t.type==='in').reduce((s,t)=>s+t.amount,0);
    const isCurrent=mo.m===now.getMonth()&&mo.y===now.getFullYear();
    return{...mo,spent,income,isCurrent,color:DONUT_COLORS[i]};
  });
  const maxSpent=Math.max(...data.map(d=>d.spent),1);
  chartEl.innerHTML=data.map(d=>{
    const h=Math.max(Math.round(d.spent/maxSpent*70),4);
    return`<div class="trend-bar-wrap">
      <div class="trend-bar-val">${d.spent>0?fmtM(d.spent):''}</div>
      <div class="trend-bar" style="height:${h}px;background:${d.isCurrent?'var(--green)':d.color+'66'}"></div>
    </div>`;
  }).join('');
  if(lblEl)lblEl.innerHTML=data.map(d=>`<div class="trend-bar-label" style="flex:1;text-align:center;color:${d.isCurrent?'var(--green)':'var(--muted)'}">${d.label}</div>`).join('');
}

// ── #23: Recurring transactions list ─────────────────────────────
function renderRecurringTxns(){
  const card=document.getElementById('recurringTxnCard');
  const list=document.getElementById('recurringTxnList');
  if(!card||!list)return;
  const recurring=(appData.transactions||[]).filter(t=>t.recurring);
  // Deduplicate by name+category
  const seen=new Set();
  const unique=recurring.filter(t=>{const k=t.name+'|'+t.category;if(seen.has(k))return false;seen.add(k);return true;});
  if(!unique.length){card.style.display='none';return;}
  card.style.display='';
  list.innerHTML=unique.map(t=>`<div class="recur-txn-row">
    <div class="txn-icon">${CATS_EMOJI[t.category]||'📦'}</div>
    <div style="flex:1;min-width:0">
      <div class="txn-name">${t.name}</div>
      <div class="txn-cat">${t.category}</div>
    </div>
    <span class="recur-freq-badge">${t.recurrence||'monthly'}</span>
    <span class="txn-amount ${t.type}" style="margin-left:8px">${t.type==='out'?'-':'+'}${fmtM(t.amount)}</span>
  </div>`).join('');
}

// ── #26: Transaction search ───────────────────────────────────────
function renderTxnListFiltered(mt){
  const searchEl=document.getElementById('txnSearch');
  const countEl=document.getElementById('txnCount');
  const txnEl=document.getElementById('txnList');
  if(!txnEl)return;
  if(!window._dataLoaded){txnEl.innerHTML=window.skeletonHTML;return;}
  const q=(searchEl?.value||'').trim().toLowerCase();
  let sorted=[...mt].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(q)sorted=sorted.filter(t=>(t.name||'').toLowerCase().includes(q)||(t.category||'').toLowerCase().includes(q));
  const shown=sorted.slice(0,50);
  if(countEl)countEl.textContent=q?`${shown.length} result${shown.length!==1?'s':''}`:'';
  txnEl.innerHTML=!shown.length
    ?`<div class="empty-state" style="padding:30px">${q?'No matching transactions':'No transactions this month'}</div>`
    :shown.map(t=>`<div class="txn-item">
      <div class="txn-icon">${CATS_EMOJI[t.category]||'📦'}</div>
      <div class="txn-name-col">
        <div class="txn-name">${t.name}${t.recurring?' <span style="font-size:10px;color:var(--blue)">↻</span>':''}</div>
        <div class="txn-cat">${t.category||'Other'} · ${t.date}</div>
      </div>
      <span class="txn-amount ${t.type}">${t.type==='out'?'-':'+'}${fmtM(t.amount)}</span>
      <button class="txn-del" onclick="deleteTxn('${t.id}')">✕</button>
    </div>`).join('');
}

// ── GLOBAL EXPORTS ──
Object.assign(window, {
  renderFinanceRing, renderGoals, renderDashNW, logGoalBalanceHistory,
  trackNetWorthHistory, goalCurrentBalance,
});
