// ── PLAID LINK (client) ───────────────────────────────────────────
// "Link Bank" button in the finance tab → Plaid Link flow → accounts sync
// automatically via the plaid-sync scheduled function. The Plaid script is
// loaded on demand (not in the app shell).

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
    const res=await fetch('/.netlify/functions/plaid-link?action=link_token');
    let data;
    try{data=await res.json();}catch{throw new Error('Bank linking unavailable — try again later');}
    if(data.error){toast(data.error,'error');return;}
    const handler=Plaid.create({
      token:data.link_token,
      onSuccess:async(publicToken,metadata)=>{
        toast('Linking account…');
        try{
          const ex=await fetch('/.netlify/functions/plaid-link?action=exchange',{
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
