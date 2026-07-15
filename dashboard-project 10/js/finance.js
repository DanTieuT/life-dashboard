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
  const accounts=appData.accounts||[];

  // ── Account Table ───────────────────────────────────────────────
  const acctRow=document.getElementById('acctCardsRow');
  if(acctRow){
    if(!accounts.length){
      acctRow.innerHTML=`<div class="accounts-empty">No accounts yet — click <b>+ Account</b> to add one.</div>`;
    } else {
      acctRow.innerHTML=`<div class="accounts-table-head">
          <span>Account</span><span>Type</span><span style="text-align:right">Balance</span>
        </div>
        ${accounts.map(a=>{
          const meta=ACCT_TYPE_META[a.type]||{label:a.type,color:'#888'};
          const isDebt=a.type==='debt';
          const mask=a.mask||'';
          const creditLimit=a.creditLimit||0;
          const barPct=isDebt&&creditLimit>0?Math.min(a.balance/creditLimit*100,100):0;
          return`<div class="accounts-table-row" onclick="openAccountModal('${a.id}')">
            <div class="accounts-table-name">
              ${a.name}${mask?` <span class="accounts-table-mask">••${mask}</span>`:''}${a.source==='plaid'?' <span class="accounts-table-synced" title="Synced via Plaid">Synced</span>':''}
              ${isDebt&&creditLimit>0?`<div class="acct-card-bar"><div class="acct-card-bar-fill" style="width:${barPct}%;background:${meta.color}"></div></div>`:''}
            </div>
            <div class="accounts-table-type">${meta.label}</div>
            <div class="accounts-table-bal${isDebt?' red':''}">${isDebt?'-':''}${fmtM(a.balance)}</div>
          </div>`;
        }).join('')}`;
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
  if(typeof renderBestCard==='function')renderBestCard();
  if(typeof renderMissedRewards==='function')renderMissedRewards(mt);
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
  document.getElementById('txnEditId').value='';
  document.getElementById('txnModalTitle').textContent='Add Transaction';
  document.getElementById('txnSaveBtn').textContent='Add';
  document.getElementById('txnDeleteBtn').style.display='none';
  document.getElementById('txnName').value='';
  document.getElementById('txnAmount').value='';
  document.getElementById('txnCategory').value='Housing';
  document.getElementById('txnType').value='out';
  document.getElementById('txnDate').value=todayStr();
  const cb=document.getElementById('txnRecurring');
  const sel=document.getElementById('txnRecurFreq');
  if(cb)cb.checked=false;
  if(sel)sel.style.display='none';
  openModal('txnModal');
};
window.openEditTxnModal=function(id){
  const t=(appData.transactions||[]).find(x=>x.id===id);
  if(!t)return;
  document.getElementById('txnEditId').value=id;
  document.getElementById('txnModalTitle').textContent='Edit Transaction';
  document.getElementById('txnSaveBtn').textContent='Save changes';
  document.getElementById('txnDeleteBtn').style.display='';
  document.getElementById('txnName').value=t.name;
  document.getElementById('txnAmount').value=t.amount;
  document.getElementById('txnCategory').value=t.category||'Other';
  document.getElementById('txnType').value=t.type;
  document.getElementById('txnDate').value=t.date;
  const cb=document.getElementById('txnRecurring');
  const sel=document.getElementById('txnRecurFreq');
  if(cb)cb.checked=!!t.recurring;
  if(sel){sel.style.display=t.recurring?'block':'none';sel.value=t.recurrence||'monthly';}
  openModal('txnModal');
};
window.saveTxn=function(){
  const name=document.getElementById('txnName').value.trim();
  const amount=parseFloat(document.getElementById('txnAmount').value);
  if(!name||isNaN(amount)||amount<=0)return;
  const recurring=document.getElementById('txnRecurring')?.checked||false;
  const recurrence=recurring?(document.getElementById('txnRecurFreq')?.value||'monthly'):null;
  const editId=document.getElementById('txnEditId').value;
  const fields={
    name,amount,
    category:document.getElementById('txnCategory').value,
    type:document.getElementById('txnType').value,
    date:document.getElementById('txnDate').value,
    recurring:recurring||false,
    recurrence:recurrence||null,
  };
  if(editId){
    const t=appData.transactions.find(x=>x.id===editId);
    if(t)Object.assign(t,fields);
  } else {
    appData.transactions.push({id:uid(),...fields});
  }
  saveData();
  closeModal('txnModal');renderFinanceTab();toast(editId?'✓ Transaction updated':'✓ Transaction added');
};
window.deleteTxnFromModal=function(){
  const id=document.getElementById('txnEditId').value;
  if(!id)return;
  closeModal('txnModal');
  deleteTxn(id);
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

// ── Finance header "more" menu (Link Bank / Add Account / Budget) ─
window.toggleFinMoreMenu=function(){
  document.getElementById('finMoreMenu')?.classList.toggle('open');
};

// Export ALL transactions (not just the selected month) as a CSV download.
window.exportTransactionsCSV=function(){
  const txns=[...(appData.transactions||[])].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!txns.length){toast('No transactions to export','error');return;}
  const esc=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const rows=[['Date','Description','Category','Type','Amount','Recurring']];
  txns.forEach(t=>rows.push([t.date,t.name||'',t.category||'',t.type==='in'?'Income':'Expense',(t.amount||0).toFixed(2),t.recurring?'Yes':'No']));
  const csv=rows.map(r=>r.map(esc).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`transactions-${todayStr()}.csv`;
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(url);
  toast(`✓ Exported ${txns.length} transactions`);
};
window.closeFinMoreMenu=function(){
  document.getElementById('finMoreMenu')?.classList.remove('open');
};
document.addEventListener('click',e=>{
  if(!e.target.closest('.fin-more-wrap'))closeFinMoreMenu();
});

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
  document.getElementById('accountDeleteBtn').style.display=a?'':'none';
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
  saveData();closeModal('accountModal');renderFinanceTab();renderGoals();renderNWSparkline();toast('✓ Account saved');
};
window.deleteAccount=async function(id){
  const a=(appData.accounts||[]).find(x=>x.id===id);
  if(!a)return;
  if(!confirm(`Remove "${a.name}"?${a.source==='plaid'?' This will disconnect it from the bank if no other linked accounts share the connection.':''}`))return;

  if(a.source==='plaid'){
    try{
      const res=await fetch('/.netlify/functions/plaid-link?action=unlink',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({accountId:id}),
      });
      const out=await res.json();
      if(!res.ok||out.error)throw new Error(out.error||'Unlink failed');
      appData.accounts=(appData.accounts||[]).filter(x=>x.id!==id);
    }catch(e){
      toast('✗ Failed to remove account: '+e.message);
      return;
    }
  } else {
    appData.accounts=(appData.accounts||[]).filter(x=>x.id!==id);
  }
  saveData();closeModal('accountModal');renderFinanceTab();renderGoals();renderNWSparkline();toast('Account removed');
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
  if(last&&last.date===today){
    last.netWorth=nw; // keep today's entry live as balances/accounts change
  } else {
    appData.netWorthHistory.push({date:today,netWorth:nw});
    if(appData.netWorthHistory.length>365)appData.netWorthHistory=appData.netWorthHistory.slice(-365);
  }
}

// ── Net worth chart (multi-instance: finance tab + dashboard widget) ──
// Each .nw-chart-card carries data-nw-id ("fin"/"dash") used only as a
// localStorage key suffix so range + collapsed state persist per instance.
// All DOM lookups are scoped to the card via [data-role] — no shared IDs.
function fmtNWDate(ds){
  const d=new Date(ds+'T12:00:00');
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function _nwRangeFor(id){return parseInt(localStorage.getItem('nwRange-'+id)||'30',10);}
window.setNWRange=function(days,btnEl){
  const card=btnEl.closest('.nw-chart-card');
  localStorage.setItem('nwRange-'+card.dataset.nwId,String(days));
  _renderOneNWCard(card);
};
window.toggleNWCollapse=function(btnEl){
  const card=btnEl.closest('.nw-chart-card');
  const collapsed=card.classList.toggle('collapsed');
  localStorage.setItem('nwCollapsed-'+card.dataset.nwId,collapsed?'1':'0');
  btnEl.textContent=collapsed?'⌄':'⌃';
};
function renderNWSparkline(){
  document.querySelectorAll('.nw-chart-card').forEach(_renderOneNWCard);
}
function _renderOneNWCard(card){
  const id=card.dataset.nwId;
  const svg=card.querySelector('[data-role="svg"]');
  const hist=appData.netWorthHistory||[];
  const accounts=appData.accounts||[];
  if(!svg||!accounts.length||hist.length<2){card.style.display='none';return;}
  card.style.display='';
  // Collapsed state (persisted per card instance)
  const collapsed=localStorage.getItem('nwCollapsed-'+id)==='1';
  card.classList.toggle('collapsed',collapsed);
  const collapseBtn=card.querySelector('[data-role="collapseBtn"]');
  if(collapseBtn)collapseBtn.textContent=collapsed?'⌄':'⌃';

  // Privacy mode: swap the eye icon and, if hidden, redact everything —
  // including the chart SHAPE, not just the text (a visible trend line still
  // leaks relative net worth even with numbers masked).
  const hidden=typeof isNumbersHidden==='function'&&isNumbersHidden();
  const hideIcon=card.querySelector('[data-role="hideIcon"]');
  if(hideIcon)hideIcon.innerHTML=hidden
    ?'<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    :'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const readout=card.querySelector('[data-role="readout"]');
  const subline=card.querySelector('[data-role="subline"]');
  const x0=card.querySelector('[data-role="x0"]'),x1=card.querySelector('[data-role="x1"]');
  if(hidden){
    if(readout)readout.innerHTML=`<span class="nw-chart-val">••••••</span>`;
    if(subline)subline.textContent='Amounts hidden';
    if(x0)x0.textContent='';if(x1)x1.textContent='';
    svg.innerHTML=`<line x1="0" y1="85" x2="100%" y2="85" stroke="var(--border)" stroke-width="2" stroke-dasharray="6 6"/>`;
    svg._nwPts=null; // scrubbing disabled while hidden
    return;
  }

  const range=_nwRangeFor(id);
  card.querySelectorAll('.nw-range-btn').forEach(b=>{
    b.classList.toggle('active',parseInt(b.dataset.range,10)===range);
  });
  const slice=range>0?hist.slice(-range):hist;
  const data=slice.length>=2?slice:hist.slice(-2);
  const vals=data.map(h=>h.netWorth);
  const min=Math.min(...vals),max=Math.max(...vals);
  const span=max-min||Math.max(Math.abs(max)*0.02,1); // flat line → thin band, not full-height noise
  const W=svg.getBoundingClientRect().width||320,H=170;
  const PAD_T=10,PAD_B=10;
  const plotH=H-PAD_T-PAD_B;
  const xy=(v,i)=>({x:(i/(vals.length-1))*W,y:H-PAD_B-((v-min)/span)*plotH});
  const pts=data.map((h,i)=>{const p=xy(h.netWorth,i);return{x:p.x,y:p.y,date:h.date,val:h.netWorth};});
  svg._nwPts=pts; // stashed per-instance for the scrub handler
  const line=pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lastVal=vals[vals.length-1];
  const up=lastVal>=vals[0];
  const color=up?'var(--green)':'var(--red)';
  const gradId='nwFill-'+id;
  const gy=[max,(max+min)/2,min].map(v=>({v,y:xy(v,0).y}));
  svg.innerHTML=`
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${up?'#30d158':'#ff453a'}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${up?'#30d158':'#ff453a'}" stop-opacity="0"/>
    </linearGradient></defs>
    ${gy.map(g=>`<line x1="0" y1="${g.y.toFixed(1)}" x2="${W}" y2="${g.y.toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 4"/>
      <text x="4" y="${(g.y-4).toFixed(1)}" font-size="10" fill="var(--muted)">${fmtM(g.v)}</text>`).join('')}
    <polygon points="0,${(H-PAD_B).toFixed(1)} ${line} ${W},${(H-PAD_B).toFixed(1)}" fill="url(#${gradId})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle data-role="scrubDot" cx="${pts[pts.length-1].x.toFixed(1)}" cy="${pts[pts.length-1].y.toFixed(1)}" r="3.5" fill="${color}"/>`;
  // Readout: latest value + change over the selected range
  const delta=lastVal-vals[0];
  if(readout)readout.innerHTML=`<span class="nw-chart-val">${fmtM(lastVal)}</span> <span class="nw-chart-delta" style="color:${color}">${delta>=0?'+':'−'}${fmtM(Math.abs(delta))}</span>`;
  // Subline: assets/liabilities breakdown (was the old separate "hero" text)
  const assets=accounts.filter(a=>a.type!=='debt').reduce((s,a)=>s+a.balance,0);
  const liabilities=accounts.filter(a=>a.type==='debt').reduce((s,a)=>s+a.balance,0);
  if(subline)subline.textContent=`${fmtM(assets)} assets`+(liabilities>0?` · ${fmtM(liabilities)} liabilities`:'');
  if(x0)x0.textContent=fmtNWDate(data[0].date);
  if(x1)x1.textContent=fmtNWDate(data[data.length-1].date);
  _attachNWScrub(svg,card);
}
function _attachNWScrub(svg,card){
  if(svg._scrubAttached)return;
  svg._scrubAttached=true;
  const move=e=>{
    const pts=svg._nwPts;
    if(!pts||!pts.length)return;
    const rect=svg.getBoundingClientRect();
    const cx=(e.touches?e.touches[0].clientX:e.clientX)-rect.left;
    let best=pts[0];
    for(const p of pts)if(Math.abs(p.x-cx)<Math.abs(best.x-cx))best=p;
    const dot=svg.querySelector('[data-role="scrubDot"]');
    if(dot){dot.setAttribute('cx',best.x);dot.setAttribute('cy',best.y);}
    const r=card.querySelector('[data-role="readout"]');
    if(r)r.innerHTML=`<span class="nw-chart-val">${fmtM(best.val)}</span> <span class="nw-chart-delta" style="color:var(--muted)">${fmtNWDate(best.date)}</span>`;
  };
  const end=()=>_renderOneNWCard(card); // restore latest-value readout + dot
  svg.addEventListener('mousemove',move);
  svg.addEventListener('mouseleave',end);
  svg.addEventListener('touchstart',move,{passive:true});
  svg.addEventListener('touchmove',move,{passive:true});
  svg.addEventListener('touchend',end,{passive:true});
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
  // Hide the whole card until there's actually spending to show —
  // six colored stubs over $0 data just looks broken.
  const trendCard=document.getElementById('trendCard');
  if(!data.some(d=>d.spent>0)){if(trendCard)trendCard.style.display='none';return;}
  if(trendCard)trendCard.style.display='';
  const maxSpent=Math.max(...data.map(d=>d.spent),1);
  chartEl.innerHTML=data.map(d=>{
    const h=d.spent>0?Math.max(Math.round(d.spent/maxSpent*70),4):1;
    return`<div class="trend-bar-wrap">
      <div class="trend-bar-val">${d.spent>0?fmtM(d.spent):''}</div>
      <div class="trend-bar" style="height:${h}px;background:${d.spent>0?(d.isCurrent?'var(--green)':d.color+'66'):'var(--border)'}"></div>
    </div>`;
  }).join('');
  if(lblEl)lblEl.innerHTML=data.map(d=>`<div class="trend-bar-label" style="flex:1;text-align:center;color:${d.isCurrent?'var(--green)':'var(--muted)'}">${d.label}</div>`).join('');
}

// ── Subscription detection ──────────────────────────────────────
// Strips trailing merchant codes Plaid/banks append ("NETFLIX.COM *A1B2C3",
// "SPOTIFY   #4821", "AMAZON PRIME*7X3K9") so repeat charges from the same
// merchant group together even when the suffix changes each cycle.
function _normMerchant(name){
  return(name||'').toLowerCase()
    .replace(/[*#][a-z0-9]+$/i,'')
    .replace(/\s+\d{3,}$/,'')
    .replace(/\s+/g,' ')
    .trim();
}
const SUB_FREQS=[
  {label:'weekly',days:7,tolerance:2,monthly:x=>x*4.33},
  {label:'monthly',days:30,tolerance:5,monthly:x=>x},
  {label:'yearly',days:365,tolerance:20,monthly:x=>x/12},
];
// Scans real transaction history for merchant+amount+interval patterns that
// look like subscriptions (2+ charges, consistent amount, regular gap).
// Unlike the old version, this doesn't depend on the manual "Recurring"
// checkbox — it works on ordinary Plaid-synced transactions too.
function detectSubscriptions(){
  const out=(appData.transactions||[]).filter(t=>t.type==='out');
  const groups={};
  out.forEach(t=>{
    const key=_normMerchant(t.name);
    if(!key)return;
    (groups[key]=groups[key]||[]).push(t);
  });
  const byPlaidId={};
  (appData.accounts||[]).forEach(a=>{if(a.plaidAccountId)byPlaidId[a.plaidAccountId]=a;});
  const results=[];
  Object.values(groups).forEach(txns=>{
    if(txns.length<2)return; // need at least 2 charges to see a pattern
    txns.sort((a,b)=>new Date(a.date)-new Date(b.date));
    const gaps=[];
    for(let i=1;i<txns.length;i++)gaps.push((new Date(txns[i].date)-new Date(txns[i-1].date))/86400000);
    const avgGap=gaps.reduce((s,g)=>s+g,0)/gaps.length;
    const freq=SUB_FREQS.find(f=>Math.abs(avgGap-f.days)<=f.tolerance);
    if(!freq)return; // irregular spacing — not a subscription pattern
    const amounts=txns.map(t=>t.amount);
    const avgAmt=amounts.reduce((s,a)=>s+a,0)/amounts.length;
    const maxDrift=Math.max(...amounts.map(a=>Math.abs(a-avgAmt)))/avgAmt;
    if(maxDrift>0.15)return; // amount varies too much to be a subscription
    const last=txns[txns.length-1];
    const acct=byPlaidId[last.plaidAccountId];
    results.push({
      name:last.name,category:last.category,amount:last.amount,
      freq:freq.label,monthlyEquivalent:freq.monthly(last.amount),
      lastDate:last.date,
      nextDate:new Date(new Date(last.date+'T12:00:00').getTime()+freq.days*86400000).toLocaleDateString('en-CA'),
      accountName:acct?acct.name+(acct.mask?' ••'+acct.mask:''):null,
      occurrences:txns.length,
    });
  });
  // Fold in anything manually flagged "Recurring" in the txn modal that the
  // pattern detector didn't catch yet (e.g. only 1 charge in history so far).
  const seen=new Set(results.map(r=>_normMerchant(r.name)));
  (appData.transactions||[]).filter(t=>t.recurring&&t.type==='out').forEach(t=>{
    const key=_normMerchant(t.name);
    if(seen.has(key))return;
    seen.add(key);
    const acct=byPlaidId[t.plaidAccountId];
    const freq=SUB_FREQS.find(f=>f.label===(t.recurrence||'monthly'))||SUB_FREQS[1];
    results.push({
      name:t.name,category:t.category,amount:t.amount,
      freq:freq.label,monthlyEquivalent:freq.monthly(t.amount),
      lastDate:t.date,nextDate:null,
      accountName:acct?acct.name+(acct.mask?' ••'+acct.mask:''):null,
      occurrences:1,
    });
  });
  return results.sort((a,b)=>b.monthlyEquivalent-a.monthlyEquivalent);
}
function renderRecurringTxns(){
  const card=document.getElementById('recurringTxnCard');
  const list=document.getElementById('recurringTxnList');
  if(!card||!list)return;
  const subs=detectSubscriptions();
  if(!subs.length){card.style.display='none';return;}
  card.style.display='';
  const totalMonthly=subs.reduce((s,x)=>s+x.monthlyEquivalent,0);
  const totalEl=document.getElementById('subTotalLine');
  if(totalEl)totalEl.textContent=`~${fmtM(totalMonthly)}/mo across ${subs.length} subscription${subs.length!==1?'s':''}`;
  list.innerHTML=subs.map(s=>`<div class="recur-txn-row">
    <div class="txn-icon">${CATS_EMOJI[s.category]||'📦'}</div>
    <div style="flex:1;min-width:0">
      <div class="txn-name">${s.name}</div>
      <div class="txn-cat">${s.accountName?s.accountName+' · ':''}${s.nextDate?'next '+fmtNWDate(s.nextDate):'seen once'}</div>
    </div>
    <span class="recur-freq-badge">${s.freq}</span>
    <span class="txn-amount out" style="margin-left:8px">-${fmtM(s.amount)}</span>
  </div>`).join('');
}

// ── #26: Transaction search ───────────────────────────────────────
function renderTxnListFiltered(mt){
  const searchEl=document.getElementById('txnSearch');
  const countEl=document.getElementById('txnCount');
  const txnEl=document.getElementById('txnList');
  if(!txnEl)return;
  if(!window._dataLoaded){txnEl.innerHTML=window.skeletonHTML;return;}
  const byPlaidId={};
  (appData.accounts||[]).forEach(a=>{if(a.plaidAccountId)byPlaidId[a.plaidAccountId]=a;});
  const q=(searchEl?.value||'').trim().toLowerCase();
  let sorted=[...mt].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(q)sorted=sorted.filter(t=>(t.name||'').toLowerCase().includes(q)||(t.category||'').toLowerCase().includes(q));
  const shown=sorted.slice(0,50);
  if(countEl)countEl.textContent=q?`${shown.length} result${shown.length!==1?'s':''}`:'';
  txnEl.innerHTML=!shown.length
    ?`<div class="empty-state" style="padding:30px">${q?'No matching transactions':'No transactions this month'}</div>`
    :shown.map(t=>{
      const acct=byPlaidId[t.plaidAccountId];
      const acctLabel=acct?acct.name+(acct.mask?' ••'+acct.mask:''):'';
      return`<div class="txn-item" onclick="openEditTxnModal('${t.id}')">
      <div class="txn-icon">${CATS_EMOJI[t.category]||'📦'}</div>
      <div class="txn-name-col">
        <div class="txn-name">${t.name}${t.recurring?' <span style="font-size:10px;color:var(--blue)">↻</span>':''}</div>
        <div class="txn-cat">${t.category||'Other'} · ${t.date}${acctLabel?' · '+acctLabel:''}</div>
      </div>
      <span class="txn-amount ${t.type}">${t.type==='out'?'-':'+'}${fmtM(t.amount)}</span>
      <button class="txn-del" onclick="event.stopPropagation();deleteTxn('${t.id}')">✕</button>
    </div>`;
    }).join('');
}

// ── CARD REWARDS ──────────────────────────────────────────────────
// appData.cardRewards = { [accountId]: { defaultPct: 1,
//   rules: [{category, pct, from?, to?}] } }   (from/to = rotating quarters)
// "pct" is a generic rate — cashback % or points-per-dollar multiplier,
// whichever your card actually earns. Ranking is relative, within your own
// cards, so mixing cashback cards and points cards is fine for comparison.
const REWARD_CATS=[
  'Dining','Groceries','Gas & EV Charging','Drug Store','Streaming',
  'Hotels/Rental Cars (Portal)','Flights/Vacation Rentals (Portal)','Other Travel',
  'Housing','Shopping','Entertainment','Health & Fitness','Other',
];

function rewardCards(){
  return (appData.accounts||[]).filter(a=>a.type==='debt');
}
// Effective cashback % for a card on a category on a given date.
// Date-scoped rules (rotating categories) beat evergreen rules beat default.
function effectiveRewardPct(acctId,category,dateStr){
  const cfg=(appData.cardRewards||{})[acctId];
  if(!cfg)return null; // unconfigured card
  let best=null;
  for(const r of cfg.rules||[]){
    if(r.category!==category)continue;
    if(r.from&&dateStr<r.from)continue;
    if(r.to&&dateStr>r.to)continue;
    if(best===null||r.pct>best)best=r.pct;
  }
  return best!==null?best:(cfg.defaultPct??1);
}
function anyRewardsConfigured(){
  return Object.keys(appData.cardRewards||{}).length>0;
}

// Best-effort mapping from a real (broad) transaction category + merchant
// name to a specific reward category. Plaid's stored transactions only carry
// the app's broad budget category (Food/Transport/etc), not fine-grained
// sub-categories, so this uses merchant-name keywords to split them out.
// Falls through to the broad category when no keyword matches — imperfect,
// but covers the common everyday cases (dining vs groceries, gas vs transit).
function classifyRewardCategory(t){
  const name=(t.name||'').toLowerCase();
  const has=(...kws)=>kws.some(k=>name.includes(k));
  switch(t.category){
    case'Food':
      if(has('grocery','groceries','market','safeway','whole foods','trader joe','kroger','costco','ralphs','vons','albertsons','wegmans','publix','aldi','sprouts','food 4 less','winco'))return'Groceries';
      return'Dining';
    case'Transport':
      if(has('chevron','shell','exxon','arco','mobil','76 ','valero','circle k','gas station','chargepoint','tesla supercharger','electrify america','ev charg','evgo'))return'Gas & EV Charging';
      if(has('marriott','hilton','hyatt','airbnb','vrbo','holiday inn','best western','resort',' inn ','hertz','avis','enterprise rent','budget rent','national car','rental car'))return'Hotels/Rental Cars (Portal)';
      if(has('airlines','air lines','delta ','united ','southwest','jetblue','alaska air','american air','spirit air','frontier air',' flight'))return'Flights/Vacation Rentals (Portal)';
      return'Other Travel';
    case'Shopping':
      if(has('walgreens','cvs','rite aid','duane reade',' drug'))return'Drug Store';
      return'Shopping';
    case'Entertainment':
      if(has('netflix','hulu','spotify','disney+','disney plus','hbo','max.com','paramount+','peacock','youtube premium','apple tv','audible'))return'Streaming';
      return'Entertainment';
    default:
      return t.category; // Housing, Health & Fitness, Other pass through
  }
}

// ── Setup modal ───────────────────────────────────────────────────
window.openCardRewardsModal=function(){
  const body=document.getElementById('cardRewardsBody');
  const cards=rewardCards();
  if(!cards.length){
    body.innerHTML='<div style="color:var(--muted);font-size:13px;padding:10px 0">No credit cards found — link a bank with a credit card first.</div>';
  } else {
    body.innerHTML=cards.map(a=>{
      const cfg=(appData.cardRewards||{})[a.id]||{defaultPct:1,rules:[]};
      return`<div class="cr-card" data-acct="${a.id}">
        <div class="cr-card-name">${a.name}${a.mask?` <span class="accounts-table-mask">••${a.mask}</span>`:''}</div>
        <div class="cr-default-row">
          <label>Default cashback</label>
          <input class="cr-default" type="number" min="0" step="0.25" value="${cfg.defaultPct??1}"><span>%</span>
        </div>
        <div class="cr-rules">${(cfg.rules||[]).map(r=>_crRuleHTML(r)).join('')}</div>
        <button class="cr-add-rule" onclick="addCardRewardRule(this)">+ Category rule</button>
      </div>`;
    }).join('');
  }
  openModal('cardRewardsModal');
};
function _crRuleHTML(r){
  r=r||{category:'Dining',pct:3,from:'',to:''};
  return`<div class="cr-rule">
    <select class="cr-cat">${REWARD_CATS.map(c=>`<option${c===r.category?' selected':''}>${c}</option>`).join('')}</select>
    <input class="cr-pct" type="number" min="0" step="0.25" value="${r.pct}" title="Cashback % or points multiplier">
    <input class="cr-from" type="date" value="${r.from||''}" title="From (optional — rotating category)">
    <input class="cr-to" type="date" value="${r.to||''}" title="To (optional)">
    <button class="cr-del" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
window.addCardRewardRule=function(btn){
  btn.previousElementSibling.insertAdjacentHTML('beforeend',_crRuleHTML());
};
window.saveCardRewards=function(){
  const out={};
  document.querySelectorAll('#cardRewardsBody .cr-card').forEach(cardEl=>{
    const rules=[...cardEl.querySelectorAll('.cr-rule')].map(row=>({
      category:row.querySelector('.cr-cat').value,
      pct:parseFloat(row.querySelector('.cr-pct').value)||0,
      from:row.querySelector('.cr-from').value||null,
      to:row.querySelector('.cr-to').value||null,
    })).filter(r=>r.pct>0);
    out[cardEl.dataset.acct]={
      defaultPct:parseFloat(cardEl.querySelector('.cr-default').value)||0,
      rules,
    };
  });
  appData.cardRewards=out;
  saveData();
  closeModal('cardRewardsModal');
  renderFinanceTab();
  toast('✓ Card rewards saved');
};

// ── Best Card lookup ──────────────────────────────────────────────
let _bestCardCat=localStorage.getItem('bestCardCat')||'Dining';
if(!REWARD_CATS.includes(_bestCardCat))_bestCardCat='Dining'; // stale value from old category list
window.setBestCardCat=function(cat){
  _bestCardCat=cat;
  localStorage.setItem('bestCardCat',cat);
  renderBestCard();
};
function renderBestCard(){
  const card=document.getElementById('bestCardCard');
  if(!card)return;
  if(!anyRewardsConfigured()||!rewardCards().length){card.style.display='none';return;}
  card.style.display='';
  const chips=document.getElementById('bestCardChips');
  chips.innerHTML=REWARD_CATS.map(c=>`<button class="bestcard-chip${c===_bestCardCat?' active':''}" onclick="setBestCardCat('${c.replace(/'/g,"\\'")}')">${CATS_EMOJI[c]||''} ${c}</button>`).join('');
  const today=todayStr();
  const ranked=rewardCards().map(a=>{
    const pct=effectiveRewardPct(a.id,_bestCardCat,today);
    const cfg=(appData.cardRewards||{})[a.id];
    const boosted=cfg&&(cfg.rules||[]).some(r=>r.category===_bestCardCat&&(!r.from||today>=r.from)&&(!r.to||today<=r.to)&&r.pct>(cfg.defaultPct??1));
    return{a,pct:pct??0,configured:pct!==null,boosted};
  }).sort((x,y)=>y.pct-x.pct);
  document.getElementById('bestCardList').innerHTML=ranked.map((r,i)=>`
    <div class="bestcard-row${i===0?' best':''}">
      <span class="bestcard-rank">${i===0?'★':i+1}</span>
      <span class="bestcard-name">${r.a.name}${r.a.mask?` <span class="accounts-table-mask">••${r.a.mask}</span>`:''}${r.boosted?' <span class="bestcard-boost">bonus</span>':''}${!r.configured?' <span class="bestcard-unset">not set up</span>':''}</span>
      <span class="bestcard-pct">${r.pct}%</span>
    </div>`).join('');
}

// ── Missed rewards report ─────────────────────────────────────────
function renderMissedRewards(mt){
  const card=document.getElementById('missedRewardsCard');
  if(!card)return;
  if(!anyRewardsConfigured()){card.style.display='none';return;}
  const cards=rewardCards();
  const byPlaidId={};
  (appData.accounts||[]).forEach(a=>{if(a.plaidAccountId)byPlaidId[a.plaidAccountId]=a;});
  let earned=0,missed=0;
  const offenders=[];
  (mt||[]).forEach(t=>{
    if(t.type!=='out'||!t.plaidAccountId)return;
    const usedAcct=byPlaidId[t.plaidAccountId];
    const cat=classifyRewardCategory(t);
    const usedPct=(usedAcct&&usedAcct.type==='debt')?(effectiveRewardPct(usedAcct.id,cat,t.date)??0):0;
    let bestPct=0,bestCard=null;
    cards.forEach(c=>{
      const p=effectiveRewardPct(c.id,cat,t.date);
      if(p!==null&&p>bestPct){bestPct=p;bestCard=c;}
    });
    earned+=t.amount*usedPct/100;
    const delta=t.amount*(bestPct-usedPct)/100;
    if(delta>0.005){
      missed+=delta;
      offenders.push({t,delta,bestCard,cat,usedName:usedAcct?usedAcct.name:'unknown',usedPct,bestPct});
    }
  });
  if(earned===0&&missed===0){card.style.display='none';return;}
  card.style.display='';
  offenders.sort((a,b)=>b.delta-a.delta);
  const money=n=>typeof isNumbersHidden==='function'&&isNumbersHidden()?'••••':'$'+n.toFixed(2);
  document.getElementById('missedRewardsBody').innerHTML=`
    <div class="missed-summary">
      <div class="missed-stat"><div class="missed-val" style="color:var(--green)">${money(earned)}</div><div class="missed-lbl">earned this month</div></div>
      <div class="missed-stat"><div class="missed-val" style="color:${missed>1?'var(--red)':'var(--sub)'}">${money(missed)}</div><div class="missed-lbl">left on the table</div></div>
    </div>
    ${offenders.slice(0,4).map(o=>`<div class="missed-row">
      <div class="missed-row-main">
        <span class="missed-txn">${o.t.name}</span>
        <span class="missed-delta">−${money(o.delta)}</span>
      </div>
      <div class="missed-row-sub">${fmtM(o.t.amount)} ${o.cat} on ${o.usedName} (${o.usedPct}%) — ${o.bestCard?o.bestCard.name+' pays '+o.bestPct+'%':''}</div>
    </div>`).join('')}
    ${offenders.length>4?`<div style="font-size:12px;color:var(--muted);padding-top:6px">+ ${offenders.length-4} more this month</div>`:''}`;
}

// ── GLOBAL EXPORTS ──
Object.assign(window, {
  renderFinanceRing, renderGoals, renderNWSparkline, logGoalBalanceHistory,
  trackNetWorthHistory, goalCurrentBalance,
});
