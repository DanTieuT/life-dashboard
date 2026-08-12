// ── PLAID LINK (client) ───────────────────────────────────────────
// "Link Bank" button in the finance tab → Plaid Link flow → accounts sync
// automatically via the plaid-sync scheduled function. The Plaid script is
// loaded on demand (not in the app shell).

// plaid-link.js now requires a Firebase ID token on every action (it can
// exchange/unlink real bank connections) — same auth pattern the chat panel
// already uses (js/dashboard.js's sendChat). Every call in this file goes
// through here instead of bare fetch().
// Explicitly on window, not a plain module-scoped function — this file and
// finance.js are separate ES modules (see main.js's import order), and only
// window-assigned functions cross that boundary as bare identifiers.
window.plaidFetch=async function(url,opts={}){
  const idToken=auth.currentUser?await auth.currentUser.getIdToken():null;
  if(!idToken)throw new Error('Not signed in');
  return fetch(url,{...opts,headers:{...(opts.headers||{}),'Authorization':'Bearer '+idToken}});
};

let _plaidScriptPromise=null;
function loadPlaidScript(){
  if(window.Plaid)return Promise.resolve();
  if(_plaidScriptPromise)return _plaidScriptPromise;
  _plaidScriptPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload=resolve;
    s.onerror=()=>{_plaidScriptPromise=null;reject(new Error('Could not load Plaid'));};
    document.head.appendChild(s);
  });
  return _plaidScriptPromise;
}

window.openPlaidLink=async function(){
  const btn=document.getElementById('linkBankBtn');
  try{
    if(btn){btn.disabled=true;btn.textContent='Connecting…';}
    await loadPlaidScript();
    const res=await plaidFetch('/.netlify/functions/plaid-link?action=link_token');
    let data;
    try{data=await res.json();}catch{throw new Error('Bank linking unavailable — try again later');}
    if(data.error){toast(data.error,'error');return;}
    const handler=Plaid.create({
      token:data.link_token,
      onSuccess:async(publicToken,metadata)=>{
        toast('Linking account…');
        try{
          const ex=await plaidFetch('/.netlify/functions/plaid-link?action=exchange',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({public_token:publicToken,institution:metadata?.institution?.name||''}),
          });
          const result=await ex.json();
          if(result.error){toast(result.error,'error');return;}
          toast(`✓ Linked ${result.added.length?result.added.join(', '):'bank'} — balances sync automatically`);
          // Pull the server-updated accounts back down and re-render
          await loadData();
          renderAll();
          // Kick a first transaction sync in the background
          fetch('/.netlify/functions/plaid-sync?trigger=manual').catch(()=>{});
        }catch(e){toast('Link failed: '+e.message,'error');}
      },
      onExit:(err)=>{if(err)toast('Plaid: '+(err.display_message||err.error_message||'cancelled'),'error');},
    });
    handler.open();
  }catch(e){
    toast(e.message,'error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='🔗 Link Bank';}
  }
};

// ── Add Investments access to an already-linked institution ────────
// One-time setup flow, not a recurring button — see CHATGPT_BRIDGE.md-adjacent
// finance-toolkit work. Lists linked Items, opens Plaid Link in "update mode"
// (existing access_token + additional_consented_products) for whichever one
// you pick, since adding a product to an existing Item is a different flow
// than the original bank link.
window.openInvestmentsLinkPicker=async function(){
  const menu=document.getElementById('finMoreMenu');
  try{
    const res=await plaidFetch('/.netlify/functions/plaid-link?action=list_items');
    const data=await res.json();
    if(data.error){toast(data.error,'error');return;}
    if(!data.items||!data.items.length){toast('No linked banks yet — use Link Bank first','error');return;}
    // Replace the more-menu's contents with one button per linked item —
    // simplest correct UI for a flow you'll use once or twice ever, not a
    // permanent picker worth a full modal.
    const prevHTML=menu.innerHTML;
    menu.innerHTML=data.items.map(it=>
      `<button onclick="addInvestmentsForItem('${it.itemId}','${(it.institution||'').replace(/'/g,"\\'")}')">📈 Add Investments: ${it.institution}${it.investmentsEnabled?' ✓':''}</button>`
    ).join('')+'<button onclick="closeFinMoreMenu()">Cancel</button>';
  }catch(e){toast('Could not load linked banks: '+e.message,'error');}
};

window.addInvestmentsForItem=async function(itemId,institution){
  closeFinMoreMenu();
  try{
    await loadPlaidScript();
    const res=await plaidFetch(`/.netlify/functions/plaid-link?action=investments_link_token&itemId=${encodeURIComponent(itemId)}`);
    const data=await res.json();
    if(data.error){toast(data.error,'error');return;}
    const handler=Plaid.create({
      token:data.link_token,
      onSuccess:async()=>{
        try{
          await plaidFetch('/.netlify/functions/plaid-link?action=investments_enabled',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({itemId}),
          });
          toast(`✓ Investments enabled for ${institution}`);
        }catch(e){toast('Saved on Plaid but failed to record locally: '+e.message,'error');}
      },
      onExit:(err)=>{if(err)toast('Plaid: '+(err.display_message||err.error_message||'cancelled'),'error');},
    });
    handler.open();
  }catch(e){toast(e.message,'error');}
};
