// ── Holdings table sort state (persists across re-renders, not across
//    reloads — resets to the value-descending default each session) ──
let holdingsSortCol=null,holdingsSortDir='desc';
window.sortHoldingsBy=function(col){
  if(holdingsSortCol===col){holdingsSortDir=holdingsSortDir==='desc'?'asc':'desc';}
  else{holdingsSortCol=col;holdingsSortDir=col==='ticker'?'asc':'desc';}
  renderFinanceTab();
};
// Buy price and gain% aren't stored on the holding — Plaid gives total cost
// basis, not per-share — so both the sort comparator and the row renderer
// need identical math. One function, not two copies that could drift apart.
function holdingDerived(h){
  const buyPrice=h.costBasis!=null&&h.quantity?h.costBasis/h.quantity:null;
  const gainPct=h.costBasis!=null&&h.costBasis!==0&&h.currentValue!=null?(h.currentValue-h.costBasis)/h.costBasis*100:null;
  return{buyPrice,gainPct};
}

// ── Stock Watchlist ─────────────────────────────────────────────
// Tickers Dan's tracking, not owned positions — appData.stockWatchlist is
// managed only from the dashboard (added/removed here via saveData(), same
// as goals/accounts/etc). Live prices are a separate concern: fetched
// on-demand from watchlist-quotes.js (Finnhub, server-side — the API key
// can't live in browser JS) rather than on every render, so opening the
// Finance tab never silently burns API quota. Quotes are kept in memory
// only; they're never written back to Firestore.
let watchlistQuotes={}; // ticker (uppercase) -> quote result from get_watchlist_quotes
let watchlistQuotesAt=null;
let watchlistLoading=false;
// Shared with the Investments render block below — one source of truth for
// "$ with cents" formatting instead of two identical copies drifting apart.
const fmtPrice=n=>n==null?'—':'$'+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

function renderWatchlistSection(){
  const row=document.getElementById('watchlistRow');
  if(!row)return;
  const list=appData.stockWatchlist||[];
  if(!list.length){
    row.innerHTML='<div class="watchlist-empty">No tickers yet — add one above.</div>';
    return;
  }
  const refreshLabel=watchlistLoading?'Refreshing…':(watchlistQuotesAt?'Refresh':'Load live prices');
  row.innerHTML=`
    <div class="watchlist-updated">${watchlistQuotesAt?`Updated ${fmtTimeAgo(new Date(watchlistQuotesAt))} · `:''}<span class="watchlist-refresh-link" onclick="refreshWatchlistQuotes()">${refreshLabel}</span></div>
    ${list.map(w=>{
      const q=watchlistQuotes[(w.ticker||'').toUpperCase()];
      let priceHtml='<span class="watchlist-price muted">—</span>';
      if(q&&!q.error){
        const chCls=q.changePercent>=0?'green':'red';
        const chTxt=`${q.changePercent>=0?'▲':'▼'} ${Math.abs(q.changePercent).toFixed(2)}%`;
        priceHtml=`<span class="watchlist-price">${fmtPrice(q.currentPrice)}</span><span class="watchlist-change ${chCls}">${chTxt}</span>`;
      } else if(q&&q.error){
        priceHtml=`<span class="watchlist-price muted" title="${escHtml(q.error)}">—</span>`;
      }
      // w.addedPrice is stamped the first time a live quote comes back for
      // this ticker (see refreshWatchlistQuotes) — not at add time, since
      // adding is deliberately quote-free. Until that first refresh lands
      // there's nothing to show a "since added" line for.
      let sinceHtml='';
      if(w.addedPrice!=null){
        if(q&&!q.error){
          const sincePct=(q.currentPrice-w.addedPrice)/w.addedPrice*100;
          const sinceCls=sincePct>=0?'green':'red';
          const sinceTxt=`${sincePct>=0?'▲':'▼'} ${Math.abs(sincePct).toFixed(2)}% since`;
          sinceHtml=`<div class="watchlist-since ${sinceCls}">Added at ${fmtPrice(w.addedPrice)} · ${sinceTxt}</div>`;
        } else {
          sinceHtml=`<div class="watchlist-since">Added at ${fmtPrice(w.addedPrice)}</div>`;
        }
      }
      return`<div class="watchlist-row-item">
        <div class="watchlist-row-main">
          <span class="watchlist-ticker">${escHtml(w.ticker)}</span>
          ${priceHtml}
          <button class="watchlist-remove" onclick="removeWatchlistTicker('${w.id}')">✕</button>
        </div>
        ${sinceHtml}
      </div>`;
    }).join('')}`;
}

window.addWatchlistTicker=function(){
  const input=document.getElementById('watchlistTickerInput');
  if(!input)return;
  // The watchlist section is deliberately left interactive before real data
  // exists (unlike renderGoals/Investments, which gate on _dataLoaded) so
  // adding the first ticker works right away. But an add that lands *before*
  // the initial loadData() resolves gets silently discarded — loadData()
  // wholesale-replaces appData from the server doc once it lands, and the
  // debounced saveData() write (600ms) may not have committed yet. Block
  // just the write, not the section, until the first load is in.
  if(!window._dataLoaded){
    toast('Still loading your data — try again in a moment','error');
    return;
  }
  const ticker=input.value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,'');
  if(!ticker)return;
  appData.stockWatchlist=appData.stockWatchlist||[];
  if(appData.stockWatchlist.some(w=>w.ticker===ticker)){
    input.value='';
    toast(`${ticker} is already on your watchlist`,'error');
    return;
  }
  appData.stockWatchlist.push({id:uid(),ticker});
  input.value='';
  saveData();
  renderWatchlistSection();
};

window.removeWatchlistTicker=function(id){
  const removed=(appData.stockWatchlist||[]).find(w=>w.id===id);
  appData.stockWatchlist=(appData.stockWatchlist||[]).filter(w=>w.id!==id);
  // Also drop its cached quote — otherwise re-adding the same ticker later
  // in the session shows the old (possibly hours-stale) price immediately,
  // next to an "Updated Xh ago" label that no longer describes it.
  if(removed)delete watchlistQuotes[(removed.ticker||'').toUpperCase()];
  saveData();
  renderWatchlistSection();
};

// Fetches live quotes for the current watchlist via the dashboard's own
// Firebase-ID-token-authed endpoint (plaidFetch attaches the token; despite
// the name it's a generic authed-fetch helper from js/plaid.js, not
// Plaid-specific — watchlist-quotes.js needs the same auth, just not Plaid).
window.refreshWatchlistQuotes=async function(){
  if(watchlistLoading)return;
  if(!(appData.stockWatchlist||[]).length)return;
  watchlistLoading=true;
  renderWatchlistSection();
  try{
    // watchlist-quotes.js reads appData straight from Firestore — flush any
    // debounced add/remove first so a ticker changed seconds ago isn't
    // missed (or a removed one still quoted) by that read.
    if(typeof window.flushSaveNow==='function')await window.flushSaveNow();
    const res=await plaidFetch('/.netlify/functions/watchlist-quotes');
    const data=await res.json();
    // `quotes` is `[]` — a truthy array — both on real success AND on the
    // "watchlist empty" / "API key not configured" responses, so `data.quotes`
    // alone can't distinguish them. Only treat it as a successful refresh
    // when the server actually sent a timestamp for it.
    if(res.ok&&data.quotes&&data.asOf){
      const map={};
      data.quotes.forEach(q=>{map[(q.ticker||'').toUpperCase()]=q;});
      watchlistQuotes=map;
      watchlistQuotesAt=data.asOf;
      // First live quote for a ticker becomes its "added at" baseline — see
      // the comment on watchlistQuotes above for why this isn't fetched
      // eagerly at add time. Only stamp once; later refreshes shouldn't
      // move the baseline just because an earlier one happened to fail.
      let baselinesChanged=false;
      (appData.stockWatchlist||[]).forEach(w=>{
        const q=map[(w.ticker||'').toUpperCase()];
        if(q&&!q.error&&w.addedPrice==null){
          w.addedPrice=q.currentPrice;
          baselinesChanged=true;
        }
      });
      if(baselinesChanged)saveData();
    } else if(res.ok&&data.quotes&&data.note){
      // Empty-but-OK response (empty watchlist / no API key) — surface the
      // note, but don't stamp watchlistQuotesAt as if a real fetch happened.
      toast(data.note,'error');
    } else {
      toast(data.note||data.error||'Could not load watchlist prices','error');
    }
  }catch(e){
    console.error('Watchlist quotes error',e);
    toast('Could not load watchlist prices','error');
  }finally{
    watchlistLoading=false;
    renderWatchlistSection();
  }
};

// ── FINANCE RING (legacy, kept for any callers) ───────────────────
function renderFinanceRing(){
  // All ring DOM elements were removed from the dashboard; this is a no-op
  // unless the elements exist (e.g. custom HTML adds them back).
  const arc=document.getElementById('ringArc');
  if(!arc)return;
  const budget=appData.budget.monthly||(appData.budget.income)||0;
  const mt=appData.transactions.filter(t=>{
    const d=txnLocalDate(t.date);return d.getMonth()===currentMonth&&d.getFullYear()===currentYear;
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

  const mt=appData.transactions.filter(t=>{const d=txnLocalDate(t.date);return d.getMonth()===currentMonth&&d.getFullYear()===currentYear;});
  const spent=mt.filter(t=>t.type==='out').reduce((s,t)=>s+t.amount,0);
  const budget=appData.budget.monthly||appData.budget.income||0;
  const accounts=appData.accounts||[];

  // ── Account Table ───────────────────────────────────────────────
  const acctRow=document.getElementById('acctCardsRow');
  if(acctRow){
    if(!accounts.length){
      acctRow.innerHTML=`<div class="accounts-empty">No accounts yet — click <b>+ Account</b> to add one.</div>`;
    } else {
      acctRow.innerHTML=`${accounts.map(a=>{
          const meta=ACCT_TYPE_META[a.type]||{label:a.type,color:'#888'};
          const isDebt=a.type==='debt';
          const mask=a.mask||'';
          return`<div class="accounts-table-row" onclick="openAccountModal('${a.id}')">
            <div class="accounts-table-name-col">
              <div class="accounts-table-name">
                <span class="accounts-table-dot" style="background:${meta.color}"></span>
                <span>${a.name}${mask?` <span class="accounts-table-mask">••${mask}</span>`:''}${a.source==='plaid'?` <span class="accounts-table-synced" title="Synced via Plaid">${a.updatedAt?fmtTimeAgo(new Date(a.updatedAt)):'Synced'}</span>`:''}</span>
              </div>
            </div>
            <div class="accounts-table-type">${meta.label}</div>
            <div class="accounts-table-bal${isDebt?' red':''}">${isDebt?'-':''}${fmtM(a.balance)}</div>
          </div>`;
        }).join('')}`;
    }
  }

  // ── Investments (real per-position data from Plaid — see
  //    plaid-investments-sync.js; empty/absent for accounts where it isn't
  //    linked). Section stays hidden entirely until there's real data,
  //    rather than showing an empty state most accounts will never fill. ──
  const investSection=document.getElementById('investmentsSection');
  const investRow=document.getElementById('investmentsRow');
  const investCashRow=document.getElementById('investmentsCashRow');
  const holdings=appData.investmentHoldings||[];
  if(investSection&&investRow){
    if(!holdings.length){
      investSection.style.display='none';
    } else {
      investSection.style.display='';
      // Compact numeric formatting for narrow columns — not fmtM() (that's
      // for whole-dollar account balances; positions need cents, and crypto
      // quantities need more decimals than shares do). fmtPrice is shared
      // with the Watchlist section above.
      const fmtQty=n=>n==null?'—':n.toLocaleString(undefined,{maximumFractionDigits:Math.abs(n)<1?4:2});
      const groupKey=h=>`${h.institution||'Unknown'} · ${h.accountName||'Account'}${h.accountMask?` ••${h.accountMask}`:''}`;

      // ── Cash: settled/uninvested balance per account (Plaid's "CUR:USD"-
      //    style cash positions — see securityType) — split out from the
      //    stock/crypto list below, not "a holding" in the same sense. ──
      const cashHoldings=holdings.filter(h=>h.securityType==='cash');
      if(investCashRow){
        if(!cashHoldings.length){
          investCashRow.innerHTML='';
        } else {
          const cashByGroup={};
          cashHoldings.forEach(h=>{const k=groupKey(h);cashByGroup[k]=(cashByGroup[k]||0)+(h.currentValue||0);});
          const total=Object.values(cashByGroup).reduce((s,v)=>s+v,0);
          investCashRow.innerHTML=`<div class="holdings-cash-card">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px">Investable cash</div>
            ${Object.entries(cashByGroup).map(([name,amt])=>
              `<div class="holdings-cash-row"><span class="name">${name}</span><span class="amt">${fmtPrice(amt)}</span></div>`
            ).join('')}
            <div class="holdings-cash-total"><span>Total</span><span>${fmtPrice(total)}</span></div>
          </div>`;
        }
      }

      // ── Stocks/crypto/ETFs, grouped by account ──────────────────────
      const stockHoldings=holdings.filter(h=>h.securityType!=='cash');
      const groups={};
      stockHoldings.forEach(h=>{const k=groupKey(h);(groups[k]=groups[k]||[]).push(h);});
      const groupNames=Object.keys(groups).sort((a,b)=>
        groups[b].reduce((s,h)=>s+(h.currentValue||0),0)-groups[a].reduce((s,h)=>s+(h.currentValue||0),0)
      );

      // Column headers are click-to-sort — same column again flips direction
      // (sortHoldingsBy above), default column/direction (value, descending)
      // matches the old hardcoded behavior so nothing changes until you tap one.
      const sortGetters={
        ticker:h=>(h.ticker||h.name||'').toUpperCase(),
        qty:h=>h.quantity||0,
        buy:h=>holdingDerived(h).buyPrice??-Infinity,
        price:h=>h.currentPrice||0,
        gain:h=>holdingDerived(h).gainPct??-Infinity,
      };
      const sortCol=holdingsSortCol||'value';
      const getter=sortGetters[sortCol]||(h=>h.currentValue||0);
      const dirMul=holdingsSortDir==='asc'?1:-1;
      const sortRows=rows=>[...rows].sort((a,b)=>{
        const av=getter(a),bv=getter(b);
        if(typeof av==='string')return av.localeCompare(bv)*dirMul;
        return (av-bv)*dirMul;
      });
      const arrow=col=>holdingsSortCol===col?(holdingsSortDir==='asc'?' ▲':' ▼'):'';

      const rowHtml=h=>{
        const{buyPrice,gainPct}=holdingDerived(h);
        const gainCls=gainPct==null?'muted':gainPct>=0?'green':'red';
        const gainTxt=gainPct==null?'—':`<span class="arrow">${gainPct>=0?'▲':'▼'}</span>${Math.abs(gainPct).toFixed(1)}%`;
        return`<div class="holdings-table-row">
          <div class="holdings-table-ticker" title="${h.name||''}">${h.ticker||h.name||'—'}</div>
          <div class="holdings-table-cell">${fmtQty(h.quantity)}</div>
          <div class="holdings-table-cell muted">${fmtPrice(buyPrice)}</div>
          <div class="holdings-table-cell">${fmtPrice(h.currentPrice)}</div>
          <div class="holdings-table-gain ${gainCls}">${gainTxt}</div>
        </div>`;
      };

      // Total value sums every stock/crypto holding; total gain/loss only
      // sums holdings that actually have a cost basis (real stocks always
      // do — this guard is for the rare position Plaid doesn't report one
      // for, so it doesn't get silently treated as $0 gain).
      const totalValue=stockHoldings.reduce((s,h)=>s+(h.currentValue||0),0);
      const withBasis=stockHoldings.filter(h=>h.costBasis!=null);
      const totalCostBasis=withBasis.reduce((s,h)=>s+h.costBasis,0);
      const totalCurrentOfBasis=withBasis.reduce((s,h)=>s+(h.currentValue||0),0);
      const totalGain=withBasis.length?totalCurrentOfBasis-totalCostBasis:null;
      const totalGainPct=totalGain!=null&&totalCostBasis!==0?totalGain/totalCostBasis*100:null;
      const totalGainCls=totalGain==null?'muted':totalGain>=0?'green':'red';
      const totalGainTxt=totalGain==null?'—':`${totalGain>=0?'▲':'▼'} ${fmtPrice(Math.abs(totalGain))}${totalGainPct!=null?` (${Math.abs(totalGainPct).toFixed(1)}%)`:''}`;

      investRow.innerHTML=stockHoldings.length?`<div class="holdings-table-head">
          <span class="holdings-sort-btn" onclick="sortHoldingsBy('ticker')">Ticker${arrow('ticker')}</span>
          <span class="holdings-sort-btn" style="text-align:right" onclick="sortHoldingsBy('qty')">Qty${arrow('qty')}</span>
          <span class="holdings-sort-btn" style="text-align:right" onclick="sortHoldingsBy('buy')">Buy${arrow('buy')}</span>
          <span class="holdings-sort-btn" style="text-align:right" onclick="sortHoldingsBy('price')">Price${arrow('price')}</span>
          <span class="holdings-sort-btn" style="text-align:right" onclick="sortHoldingsBy('gain')">Gain${arrow('gain')}</span>
        </div>
        ${groupNames.map(name=>
          `<div class="holdings-group-label">${name}</div>${sortRows(groups[name]).map(rowHtml).join('')}`
        ).join('')}
        <div class="holdings-total-row">
          <div><span class="holdings-total-label">Total value</span><span class="holdings-total-value">${fmtPrice(totalValue)}</span></div>
          <div><span class="holdings-total-label">Gain/loss</span><span class="holdings-total-value ${totalGainCls}">${totalGainTxt}</span></div>
        </div>` : '';
    }
  }

  renderWatchlistSection();

  // ── Payday Bar ──────────────────────────────────────────────────
  const now=new Date();
  const daysInMonth=new Date(currentYear,currentMonth+1,0).getDate();
  const isCurrentMonth=currentMonth===now.getMonth()&&currentYear===now.getFullYear();
  const dayOfMonth=isCurrentMonth?now.getDate():1;
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

  // ── Spending total + progress (category breakdown renders via #21 below) ──
  const spendingHdr=document.getElementById('spendingCardHdr');
  if(spendingHdr) spendingHdr.textContent=months[currentMonth]+' spending';
  const totalEl=document.getElementById('spendingTotal');
  const ofEl=document.getElementById('spendingOf');
  const totalFillEl=document.getElementById('spendingTotalFill');
  if(totalEl) totalEl.textContent=fmtM(spent);
  if(ofEl) ofEl.textContent='of '+fmtM(budget||spent||1);
  if(totalFillEl){
    const pct=budget>0?Math.min(spent/budget,1)*100:(spent>0?100:0);
    totalFillEl.style.width=pct+'%';
    totalFillEl.style.background=!budget?'var(--green)':spent>budget?'var(--red)':spent>budget*.8?'var(--yellow)':'var(--green)';
  }
  // Pace arrow — where spend "should" be today if it tracked evenly across
  // the month (same idea as the home page's budget pace tick). Only
  // meaningful for the month actually in progress.
  const paceTickEl=document.getElementById('spendingPaceTick');
  if(paceTickEl){
    if(isCurrentMonth&&budget>0){
      const pacePct=Math.min(100,(now.getDate()/daysInMonth)*100);
      paceTickEl.style.left=pacePct+'%';
      paceTickEl.style.display='';
    } else {
      paceTickEl.style.display='none';
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
        <div class="txn-name-col"><div class="txn-name">${escHtml(t.name)}</div><div class="txn-cat">${t.category||'Other'} · ${t.date}</div></div>
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
  applyFinCollapseState();
}
// Collapsed/expanded state persists per section (localStorage), independent of
// the show/hide-until-configured logic each section's own render fn applies —
// collapsing only hides the body, never the outer .fin-collapsible/.fin-card.
function applyFinCollapseState(){
  document.querySelectorAll('.fin-collapsible').forEach(card=>{
    const collapsed=localStorage.getItem('finCollapsed-'+card.dataset.finId)==='1';
    card.classList.toggle('collapsed',collapsed);
  });
}
window.toggleFinCollapse=function(hdrEl){
  const card=hdrEl.closest('.fin-collapsible');
  if(!card)return;
  const collapsed=card.classList.toggle('collapsed');
  localStorage.setItem('finCollapsed-'+card.dataset.finId,collapsed?'1':'0');
};

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
// Pre-fills each category field with its average monthly spend over the last
// few full calendar months — real numbers from real transactions, not an LLM
// guessing dollar figures. Fields stay editable; nothing saves until Save.
window.suggestBudget=function(){
  const cats=Object.keys(appData.budget.categories||{});
  if(!cats.length){toast('No categories yet — save a budget once first, then suggest.','error');return;}

  // Parse date-only strings at noon local time, not midnight — "YYYY-MM-DD"
  // with no time component parses as UTC midnight, which lands on the
  // *previous* calendar day in any timezone behind UTC (all of the US).
  // Comparing that against locally-constructed range boundaries silently
  // drops transactions dated on the 1st of the oldest included month.
  const parseLocal=ds=>new Date(ds+'T12:00:00');
  const now=new Date();
  const monthsBack=3;
  const rangeStart=new Date(now.getFullYear(),now.getMonth()-monthsBack,1);
  const rangeEnd=new Date(now.getFullYear(),now.getMonth(),1); // exclude the current, still-in-progress month
  const recent=(appData.transactions||[]).filter(t=>{
    if(t.type!=='out')return false;
    const d=parseLocal(t.date);
    return d>=rangeStart&&d<rangeEnd;
  });
  if(!recent.length){
    toast('Not enough transaction history yet to suggest a budget','error');
    return;
  }
  // Always average over the full window (not just months a category happens
  // to appear in) — a category you only spent in once should suggest a
  // smaller monthly amount, not the same as one you spend in every month.
  const monthCount=Math.max(1,new Set(recent.map(t=>{const d=parseLocal(t.date);return d.getFullYear()+'-'+d.getMonth();})).size);

  let filledCount=0;
  cats.forEach(cat=>{
    const total=recent.filter(t=>t.category===cat).reduce((s,t)=>s+t.amount,0);
    if(total<=0)return;
    const el=document.getElementById('bc_'+cat.replace(/[^a-z]/gi,'_'));
    if(el){el.value=Math.round(total/monthCount);filledCount++;}
  });

  // Only pre-fill the overall income/budget field if Dan hasn't already
  // entered a real number — never overwrite actual income data.
  const incomeEl=document.getElementById('budgetIncome');
  if(incomeEl&&!incomeEl.value){
    const totalAvg=cats.reduce((s,cat)=>s+(parseFloat(document.getElementById('bc_'+cat.replace(/[^a-z]/gi,'_'))?.value)||0),0);
    if(totalAvg>0)incomeEl.value=totalAvg;
  }

  if(filledCount)toast(`✓ Suggested from ${monthCount} month${monthCount!==1?'s':''} of history — review and Save`);
  else toast('No matching category spending found in that history','error');
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
window.deleteAccountFromModal=function(){
  deleteAccount(document.getElementById('accountEditId').value);
};
window.deleteAccount=async function(id){
  const a=(appData.accounts||[]).find(x=>x.id===id);
  if(!a)return;
  if(!confirm(`Remove "${a.name}"?${a.source==='plaid'?' This will disconnect it from the bank if no other linked accounts share the connection.':''}`))return;

  if(a.source==='plaid'){
    try{
      const res=await plaidFetch('/.netlify/functions/plaid-link?action=unlink',{
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

// Sum of a contribution-tracked goal's logged contributions, scoped to the
// current calendar year when resetAnnually is set (the default — the whole
// point is a Roth/brokerage-style annual limit that rolls back to $0 every
// Jan 1 with no manual reset step).
function goalContributionTotal(g){
  const year=new Date().getFullYear();
  return (g.contributions||[])
    .filter(c=>!g.resetAnnually||new Date(c.date+'T12:00:00').getFullYear()===year)
    .reduce((s,c)=>s+(c.amount||0),0);
}

// Get current balance for a goal — contribution-tracked, linked-account, or
// plain manual, in that priority order (mirrors dashboard-lib.js's
// server-side copy of this logic for Telegram/ChatGPT JARVIS).
function goalCurrentBalance(g){
  if(g.trackContributions)return goalContributionTotal(g);
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

// Get balance from ~30 days ago for monthly change calc
function goalBalanceMonthAgo(g){
  if(!g.balanceHistory||!g.balanceHistory.length)return null;
  const monthAgo=new Date();monthAgo.setDate(monthAgo.getDate()-30);
  const monthAgoStr=monthAgo.toLocaleDateString('en-CA');
  // Only trust a reference point that's actually close to 30 days back (within
  // a 15-day buffer). Without this bound, a goal with sparse history — e.g. one
  // logged entry from creation day, then nothing until an account got linked —
  // would fall back to that old one-off snapshot and report a huge, misleading
  // "change" that's really just "current balance minus whatever the goal
  // happened to start at." No qualifying entry means we say nothing instead.
  const minDate=new Date();minDate.setDate(minDate.getDate()-45);
  const minDateStr=minDate.toLocaleDateString('en-CA');
  const older=g.balanceHistory.filter(h=>h.date<=monthAgoStr&&h.date>=minDateStr);
  if(!older.length)return null;
  return older[older.length-1].balance;
}

// How far through the calendar year "today" is, as a percentage — the same
// idea as the spending card's pace arrow (spendingPaceTick), but scoped to
// a year instead of a month. Used to show where a contribution-tracked
// goal "should" be today to land on its target by Dec 31.
function yearPacePct(){
  const now=new Date();
  const startOfYear=new Date(now.getFullYear(),0,1);
  const endOfYear=new Date(now.getFullYear()+1,0,1);
  const dayOfYear=Math.floor((now-startOfYear)/86400000)+1;
  const daysInYear=Math.round((endOfYear-startOfYear)/86400000);
  return Math.min(100,(dayOfYear/daysInYear)*100);
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
    // Monthly change
    const monthAgo=goalBalanceMonthAgo(g);
    let monthlyHtml='';
    if(monthAgo!==null){
      const diff=current-monthAgo;
      const mColor=diff>0?'var(--green)':diff<0?'var(--red)':'var(--sub)';
      const mText=diff>0?`+ ${fmt(diff)} this month`:diff<0?`- ${fmt(Math.abs(diff))} this month`:'no change this month';
      monthlyHtml=`<span class="goal-monthly-change" style="color:${mColor}">${mText}</span>`;
    }
    // Linked account names (balance-linked goals) or contribution count
    // (contribution-tracked goals) — mutually exclusive by design.
    const ids=g.linkedAccountIds||(g.linkedAccountId?[g.linkedAccountId]:[]);
    const linkedNames=ids.map(id=>(appData.accounts||[]).find(a=>a.id===id)?.name).filter(Boolean);
    const year=new Date().getFullYear();
    const yearContribs=(g.contributions||[]).filter(c=>!g.resetAnnually||new Date(c.date+'T12:00:00').getFullYear()===year);
    const linkedSub=g.trackContributions
      ?`<div class="goal-sub">${yearContribs.length?`${yearContribs.length} contribution${yearContribs.length!==1?'s':''} in ${year}`:`No contributions logged in ${year} yet`}</div>`
      :(linkedNames.length?`<div class="goal-sub" title="${escHtml(linkedNames.join(', '))}">Linked: ${linkedNames.join(', ')}</div>`:'');
    const pctText=done?'🎉 Goal reached!':`${Math.round(pct)}% · ${fmtM(target-current)} to go`;
    const logBtn=g.trackContributions?`<button class="goal-pct" style="border:none;background:none;color:${color};cursor:pointer;font-weight:600;padding:0" onclick="openContributionModal('${g.id}')">+ Log contribution</button>`:'';
    // Year-end pace arrow — only meaningful for goals with an annual
    // deadline (contribution-tracked + resetAnnually implies "hit target by
    // Dec 31"). Shows where current should be today to stay on pace,
    // both as a marker on the bar and as a plain-text ahead/behind line
    // (the marker alone doesn't work on touch — no hover to read its title).
    let paceArrow='',paceText='';
    if(g.trackContributions&&g.resetAnnually&&target>0&&!done){
      const pacePct=yearPacePct();
      const paceTarget=target*pacePct/100;
      const diff=current-paceTarget;
      paceArrow=`<div class="goal-pace-arrow" style="left:${pacePct.toFixed(2)}%" title="On pace today: ${fmtM(Math.round(paceTarget))} toward ${fmtM(target)} by Dec 31"></div>`;
      const pColor=diff>=0?'var(--green)':'var(--red)';
      const pText=diff>=0?`${fmtM(diff)} ahead of pace`:`${fmtM(Math.abs(diff))} behind pace`;
      paceText=`<span class="goal-pace-text" style="color:${pColor}">${pText}</span>`;
    }
    return `<div class="goal-card">
      <div class="goal-top">
        <button class="goal-icon" style="background:${color}22;color:${color}" onclick="openGoalModal('${g.id}')" title="Edit ${escHtml(g.name)}">${g.emoji||'🎯'}</button>
        <div style="flex:1">
          <div class="goal-name">${g.name}</div>
          ${linkedSub}
        </div>
      </div>
      <div class="goal-amounts">
        <div class="goal-current" style="color:${color}">${fmtM(current)}</div>
        <div class="goal-target">of ${fmtM(target)}</div>
      </div>
      <div class="goal-bar-track-wrap">
        ${paceArrow}
        <div class="goal-bar-track">
          <div class="goal-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
      <div class="goal-foot-row">
        <span class="goal-pct">${pctText}</span>
        ${logBtn}
        ${paceText}
        ${monthlyHtml}
      </div>
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
  document.getElementById('goalDeleteBtn').style.display=g?'':'none';
  document.getElementById('goalTrackContributions').checked=!!(g&&g.trackContributions);
  document.getElementById('goalAutoMatchKeyword').value=g?(g.autoMatchKeyword||''):'';
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
  renderGoalContributionsList(g);
  toggleGoalTrackMode();
  openModal('goalModal');
};

// Toggles between "linked account / manual current" mode and "logged
// contributions" mode in the goal modal — mutually exclusive.
window.toggleGoalTrackMode=function(){
  const tracking=document.getElementById('goalTrackContributions').checked;
  document.getElementById('goalCurrentGroup').style.display=tracking?'none':'';
  document.getElementById('goalLinkedGroup').style.display=tracking?'none':'';
  document.getElementById('goalAutoMatchGroup').style.display=tracking?'':'none';
  document.getElementById('goalContributionsGroup').style.display=tracking?'':'none';
  const hasId=!!document.getElementById('goalEditId').value;
  document.getElementById('goalLogContribBtn').style.display=hasId?'':'none';
  document.getElementById('goalLogContribHint').style.display=hasId?'none':'';
};

function renderGoalContributionsList(g){
  const el=document.getElementById('goalContributionsList');
  const contribs=(g&&g.contributions||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
  el.innerHTML=contribs.length
    ?contribs.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
        <span>${c.date} — ${fmt(c.amount)}${c.plaidTxnId?' <span style="color:var(--muted);font-size:11px">· auto</span>':''}</span>
        <button onclick="deleteContribution('${g.id}','${c.id}')" style="border:none;background:none;color:var(--red);cursor:pointer;font-size:16px;line-height:1;padding:0 4px" title="Remove">×</button>
      </div>`).join('')
    :'<div style="color:var(--muted);font-size:13px">None logged yet</div>';
}

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
  const trackContributions=document.getElementById('goalTrackContributions').checked;
  const autoMatchKeyword=document.getElementById('goalAutoMatchKeyword').value.trim().toLowerCase();
  // Get checked account IDs
  const wrap=document.getElementById('goalLinkedAccountsWrap');
  const linkedAccountIds=[...wrap.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
  const editId=document.getElementById('goalEditId').value;
  if(!name||!target)return;
  if(!appData.goals)appData.goals=[];
  if(editId){
    const g=appData.goals.find(x=>x.id===editId);
    if(g){
      Object.assign(g,{name,emoji,target,trackContributions});
      if(trackContributions){g.resetAnnually=true;g.contributions=g.contributions||[];g.autoMatchKeyword=autoMatchKeyword||null;}
      else{Object.assign(g,{current,linkedAccountIds,linkedAccountId:linkedAccountIds[0]||null});g.autoMatchKeyword=null;}
    }
  } else {
    const g={id:uid(),name,emoji,target,created:todayStr()};
    if(trackContributions)Object.assign(g,{trackContributions:true,resetAnnually:true,contributions:[],autoMatchKeyword:autoMatchKeyword||null});
    else Object.assign(g,{current,linkedAccountIds,linkedAccountId:linkedAccountIds[0]||null});
    appData.goals.push(g);
  }
  saveData();closeModal('goalModal');renderGoals();toast('✓ Goal saved');
};

// ── Contribution logging (for goals tracking money Plaid can't see, like
// Roth/brokerage transfers) ─────────────────────────────────────────
window.openContributionModal=function(goalId){
  if(!goalId)return; // guard: modal button is hidden until the goal has been saved once
  document.getElementById('contribGoalId').value=goalId;
  document.getElementById('contribAmount').value='';
  document.getElementById('contribDate').value=todayStr();
  openModal('contributionModal');
};

window.saveContribution=function(){
  const goalId=document.getElementById('contribGoalId').value;
  const amount=parseFloat(document.getElementById('contribAmount').value);
  const date=document.getElementById('contribDate').value||todayStr();
  if(!goalId||!amount)return;
  const g=(appData.goals||[]).find(x=>x.id===goalId);
  if(!g)return;
  g.contributions=g.contributions||[];
  g.contributions.push({id:uid(),amount,date});
  saveData();closeModal('contributionModal');renderGoals();
  renderGoalContributionsList(g);
  toast(`✓ Logged ${fmt(amount)}`);
};

window.deleteContribution=function(goalId,contribId){
  const g=(appData.goals||[]).find(x=>x.id===goalId);
  if(!g)return;
  g.contributions=(g.contributions||[]).filter(c=>c.id!==contribId);
  saveData();renderGoals();renderGoalContributionsList(g);
};
window.deleteGoal=function(id){
  const g=(appData.goals||[]).find(x=>x.id===id);
  if(!g)return;
  if(!confirm(`Remove "${g.name}"?`))return;
  appData.goals=(appData.goals||[]).filter(x=>x.id!==id);
  saveData();renderGoals();toast('Goal removed');
};
window.deleteGoalFromModal=function(){
  const id=document.getElementById('goalEditId').value;
  const g=(appData.goals||[]).find(x=>x.id===id);
  if(!g)return;
  if(!confirm(`Remove "${g.name}"?`))return;
  appData.goals=(appData.goals||[]).filter(x=>x.id!==id);
  saveData();closeModal('goalModal');renderGoals();toast('Goal removed');
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
  // PAD_T needs room for the top gridline's label to sit ABOVE the line
  // without its ascenders clipping against the SVG's own top edge.
  const PAD_T=24,PAD_B=10;
  const plotH=H-PAD_T-PAD_B;
  const xy=(v,i)=>({x:(i/(vals.length-1))*W,y:H-PAD_B-((v-min)/span)*plotH});
  const pts=data.map((h,i)=>{const p=xy(h.netWorth,i);return{x:p.x,y:p.y,date:h.date,val:h.netWorth};});
  svg._nwPts=pts; // stashed per-instance for the scrub handler
  const line=pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lastVal=vals[vals.length-1];
  const up=lastVal>=vals[0];
  const color=up?'var(--green)':'var(--red)';
  const gradId='nwFill-'+id;
  // Gridline lines still sit at the real max/mid/min y-positions, but the
  // printed label rounds to a clean step (half a power-of-ten of the span)
  // instead of an exact-looking value like "$175,282".
  const gridStep=Math.pow(10,Math.floor(Math.log10(Math.max(span,1))))/2||1;
  const niceRound=v=>Math.round(v/gridStep)*gridStep;
  const gy=[max,(max+min)/2,min].map(v=>({v:niceRound(v),y:xy(v,0).y}));
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
  // Readout: latest value + TODAY's change (yesterday's close → today's live
  // value), independent of whichever zoom range is selected below — the chart
  // itself still reflects the selected range, but "how did today go" shouldn't
  // change just because you tapped 90D.
  const prevDayVal=hist.length>=2?hist[hist.length-2].netWorth:lastVal;
  const todayDelta=lastVal-prevDayVal;
  const todayPct=prevDayVal!==0?(todayDelta/Math.abs(prevDayVal)*100):0;
  const deltaUp=todayDelta>=0;
  const deltaColor=deltaUp?'var(--green)':'var(--red)';
  const deltaBg=deltaUp?'var(--green-dim)':'var(--red-dim)';
  if(readout)readout.innerHTML=`<span class="nw-chart-val">${fmtM(lastVal)}</span> <span class="nw-delta-pill" style="background:${deltaBg};color:${deltaColor}">${deltaUp?'▲':'▼'} ${fmtM(Math.abs(todayDelta))} · ${Math.abs(todayPct).toFixed(2)}%</span>`;
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
  // Income uses monthlyIncome() rather than mt directly — mt buckets purely
  // by posted date, which would count an end-of-month paycheck (and its
  // ~$5.5k) toward the month it happened to post in instead of the month
  // it actually funds. See monthlyIncome()'s comment in core.js.
  const income=monthlyIncome(appData.transactions,currentMonth,currentYear);
  const expenses=mt.filter(t=>t.type==='out').reduce((s,t)=>s+t.amount,0);
  if(income<=0){card.style.display='none';return;}
  card.style.display='';
  const rate=Math.round((income-expenses)/income*100);
  const ratePct=document.getElementById('savingsRatePct');
  const fill=document.getElementById('savingsRateFill');
  const detail=document.getElementById('savingsRateDetail');
  // Radial gauge: circumference for the SVG circle's r=36 (see index.html).
  // stroke-dashoffset counts down from the full circumference (empty) to 0
  // (full loop) as the percentage climbs — same math as the mockup's gauge.
  const GAUGE_C=2*Math.PI*36;
  const setGauge=(pctClamped,color)=>{
    if(!fill)return;
    fill.style.strokeDasharray=GAUGE_C;
    fill.style.strokeDashoffset=GAUGE_C*(1-pctClamped/100);
    fill.style.stroke=color;
  };
  // A real month's rate realistically runs roughly -100% (spent double your
  // income) to 100% (saved it all). Anything far past that floor means the
  // income side is too small to be a real denominator yet — e.g. only a
  // refund has posted and the paycheck hasn't landed — not that you
  // actually overspent 20x. Say that plainly instead of a nonsense number.
  if(rate<-200){
    if(ratePct){ratePct.textContent='—';ratePct.style.color='var(--muted)';}
    setGauge(0,'var(--track)');
    if(detail)detail.textContent=`Not enough income posted yet this month (${fmtM(income)} in vs ${fmtM(expenses)} spent)`;
    return;
  }
  if(ratePct)ratePct.textContent=rate+'%';
  const color=rate>=20?'var(--green)':rate>=10?'var(--yellow)':'var(--red)';
  if(ratePct)ratePct.style.color=color;
  setGauge(Math.max(0,Math.min(rate,100)),color);
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
  // Pace — same day-of-month/days-in-month fraction as the overall spending
  // bar above this chart, only meaningful for the month in progress (matches
  // spendingPaceTick's isCurrentMonth guard). Shown as one shared reference
  // line through the whole track column (see cat-bar-pace-line below)
  // instead of a tick repeated on every row — a per-row identical mark read
  // as noisy; one shared axis still lets each bar's fill vs. the line tell
  // you that category's own pace.
  const now=new Date();
  const daysInMonth=new Date(currentYear,currentMonth+1,0).getDate();
  const isCurrentMonth=currentMonth===now.getMonth()&&currentYear===now.getFullYear();
  const pacePct=isCurrentMonth?Math.min(now.getDate()/daysInMonth,1)*100:null;
  const rows=cats.map(([cat,amt],i)=>{
    const color=DONUT_COLORS[i%DONUT_COLORS.length];
    const limit=catBudgets[cat]||0;
    const overBudget=limit>0&&amt>limit;
    let barW,amtLabel=fmtM(amt);
    if(limit>0){
      // Bar's full width IS the category's limit — 100% is the budget, not
      // a share of total spend — so going over always reads as a full red
      // bar instead of shrinking relative to unrelated categories.
      barW=Math.min(Math.round(amt/limit*100),100);
      amtLabel=`${fmtM(amt)}<span class="cat-bar-limit-txt">/${fmtM(limit)}</span>`;
    }else{
      barW=Math.round(amt/total*100);
    }
    return`<span class="cat-bar-label" title="${cat}">${cat}</span>
    <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${barW}%;background:${overBudget?'var(--red)':color}"></div></div>
    <span class="cat-bar-amt" style="color:${overBudget?'var(--red)':'var(--text)'}">${amtLabel}</span>`;
  }).join('');
  // Position in plain calc() math (label column + gap, then a fraction of the
  // remaining track width) rather than a bare "%", which would resolve
  // against the whole grid row's width, not just the track column — see the
  // .cat-bar-pace-line comment in styles.css for why. Keep these px values
  // (90 label + 10 gap + 82 amount + 10 gap = 192) in sync with
  // .cat-bar-grid's grid-template-columns.
  const paceLine=pacePct!=null?`<div class="cat-bar-pace-line" style="left:calc(100px + (100% - 192px) * ${(pacePct/100).toFixed(4)})" title="On-pace for today"></div>`:'';
  el.innerHTML=`<div class="cat-bar-grid">${paceLine}${rows}</div>`;
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
    const txns=(appData.transactions||[]).filter(t=>{const d=txnLocalDate(t.date);return d.getMonth()===mo.m&&d.getFullYear()===mo.y;});
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
// Categories that recur on a schedule but are essentially never a personal
// "subscription" — rent/mortgage/utilities is the classic false positive:
// same amount, same day every month, which is exactly the pattern this
// detector is built to catch. Excluded up front rather than relying on
// amount alone, since a cheap utility bill could otherwise slip under the
// cap below.
const SUBSCRIPTION_EXCLUDED_CATS=new Set(['Housing']);
// Subscriptions are typically small recurring charges (streaming, apps,
// memberships, gym). A large fixed monthly amount is far more likely to be
// a loan/lease/insurance payment than something anyone would call a
// "subscription" — capped out rather than trying to classify every loan.
const SUBSCRIPTION_MAX_MONTHLY=150;
function _subDismissed(){
  try{return new Set(JSON.parse(localStorage.getItem('subDismissed')||'[]'));}catch{return new Set();}
}
window.dismissSubscription=function(key){
  const s=_subDismissed();s.add(key);
  localStorage.setItem('subDismissed',JSON.stringify([...s]));
  renderRecurringTxns();
};
// Scans real transaction history for merchant+amount+interval patterns that
// look like subscriptions (2+ charges, consistent amount, regular gap).
// Unlike the old version, this doesn't depend on the manual "Recurring"
// checkbox — it works on ordinary Plaid-synced transactions too.
function detectSubscriptions(){
  const dismissed=_subDismissed();
  const out=(appData.transactions||[]).filter(t=>t.type==='out'&&!SUBSCRIPTION_EXCLUDED_CATS.has(t.category));
  const groups={};
  out.forEach(t=>{
    const key=_normMerchant(t.name);
    if(!key||dismissed.has(key))return;
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
    // Compare each charge to the one right before it (tolerates a gradual
    // price increase, e.g. a streaming service raising its price once) —
    // checking against the lifetime average would reject a subscription
    // the moment its price changed even once.
    let maxStepDrift=0;
    for(let i=1;i<amounts.length;i++)maxStepDrift=Math.max(maxStepDrift,Math.abs(amounts[i]-amounts[i-1])/amounts[i-1]);
    if(maxStepDrift>0.2)return; // amount jumps around too much to be a subscription
    const last=txns[txns.length-1];
    const monthlyEquivalent=freq.monthly(last.amount);
    if(monthlyEquivalent>SUBSCRIPTION_MAX_MONTHLY)return; // too large — likely a loan/lease, not a subscription
    const acct=byPlaidId[last.plaidAccountId];
    results.push({
      key:_normMerchant(last.name),
      name:last.name,category:last.category,amount:last.amount,
      freq:freq.label,monthlyEquivalent,
      lastDate:last.date,
      nextDate:new Date(new Date(last.date+'T12:00:00').getTime()+freq.days*86400000).toLocaleDateString('en-CA'),
      accountName:acct?acct.name+(acct.mask?' ••'+acct.mask:''):null,
      occurrences:txns.length,
    });
  });
  // Fold in anything manually flagged "Recurring" in the txn modal that the
  // pattern detector didn't catch yet (e.g. only 1 charge in history so
  // far — the usual reason a real subscription is missing: an annual charge,
  // or a merchant only linked/added recently. Flagging it "Recurring" on the
  // transaction itself is the way to force it in here immediately.)
  const seen=new Set(results.map(r=>r.key));
  (appData.transactions||[]).filter(t=>t.recurring&&t.type==='out'&&!SUBSCRIPTION_EXCLUDED_CATS.has(t.category)).forEach(t=>{
    const key=_normMerchant(t.name);
    if(seen.has(key)||dismissed.has(key))return;
    seen.add(key);
    const acct=byPlaidId[t.plaidAccountId];
    const freq=SUB_FREQS.find(f=>f.label===(t.recurrence||'monthly'))||SUB_FREQS[1];
    const monthlyEquivalent=freq.monthly(t.amount);
    if(monthlyEquivalent>SUBSCRIPTION_MAX_MONTHLY)return;
    results.push({
      key,name:t.name,category:t.category,amount:t.amount,
      freq:freq.label,monthlyEquivalent,
      lastDate:t.date,nextDate:null,
      accountName:acct?acct.name+(acct.mask?' ••'+acct.mask:''):null,
      occurrences:1,
    });
  });
  return results.sort((a,b)=>b.monthlyEquivalent-a.monthlyEquivalent);
}
// Deterministic color per merchant name — same string always maps to the
// same hue, so a subscription's avatar stays visually stable across
// renders without needing a hand-maintained brand-color lookup table.
function hashColor(str){
  let h=0;
  for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))>>>0;
  return `hsl(${h%360},58%,46%)`;
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
  if(totalEl)totalEl.innerHTML=`<div class="sub-hero">
    <span class="sub-hero-num">${fmtM(totalMonthly)}/mo</span>
    <span class="sub-hero-count">${subs.length} subscription${subs.length!==1?'s':''}</span>
  </div>`;
  list.innerHTML=subs.map(s=>`<div class="recur-txn-row">
    <div class="sub-avatar" style="background:${hashColor(s.name)}">${escHtml((s.name||'?').charAt(0).toUpperCase())}</div>
    <div style="flex:1;min-width:0">
      <div class="txn-name">${s.name}</div>
      <div class="txn-cat">${s.accountName?s.accountName+' · ':''}${s.nextDate?'next '+fmtNWDate(s.nextDate):'seen once'}</div>
    </div>
    <span class="recur-freq-badge">${s.freq}</span>
    <span class="txn-amount out" style="margin-left:8px">-${fmtM(s.amount)}</span>
    <button class="txn-del" title="Not a subscription" onclick="dismissSubscription('${s.key.replace(/'/g,"\\'")}')">✕</button>
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
        <div class="txn-name">${escHtml(t.name)}${t.recurring?' <span style="font-size:10px;color:var(--blue)">↻</span>':''}</div>
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
  chips.innerHTML=`<select class="form-select" onchange="setBestCardCat(this.value)">
    ${REWARD_CATS.map(c=>`<option value="${c.replace(/"/g,'&quot;')}"${c===_bestCardCat?' selected':''}>${c}</option>`).join('')}
  </select>`;
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
      <span class="bestcard-name">${r.a.name}${r.boosted?' <span class="bestcard-boost">bonus</span>':''}${!r.configured?' <span class="bestcard-unset">not set up</span>':''}</span>
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
