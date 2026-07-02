import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth, signInWithPopup, signOut, GoogleAuthProvider, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc }
  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// ── FIREBASE ──────────────────────────────────────────────────────
const app = initializeApp({
  apiKey:"AIzaSyBxha20jT2FO2wIze_hgVP6SDzy6yI9QD0",
  authDomain:"my-dashboard-7d8b2.firebaseapp.com",
  projectId:"my-dashboard-7d8b2",
  storageBucket:"my-dashboard-7d8b2.firebasestorage.app",
  messagingSenderId:"959767882750",
  appId:"1:959767882750:web:1b612e426cca9c7c752eaf"
});
const auth = getAuth(app);
const db   = getFirestore(app);
window.auth = auth; // read by renderGreeting (dashboard.js)
window.userRef = null; // set on sign-in; read cross-module (jarvis history, backups)
// ── CONSTANTS ─────────────────────────────────────────────────────
const CATS_EMOJI = { Housing:'🏠',Food:'🍔',Transport:'🚗','Health & Fitness':'💪',Entertainment:'🎬',Shopping:'🛍️',Savings:'💰',Other:'📦' };
const DEFAULT_BUDGET = { income:0, monthly:0, categories:{ Housing:1200,Food:400,Transport:200,'Health & Fitness':80,Entertainment:100,Shopping:150,Savings:500,Other:100 } };
const DEFAULT_SAVINGS = { robinhood:0,schwab:0,savingsplus:0,updatedAt:{} };
const HABIT_COLORS_DARK = [
  { bg:'#1a1208',dot:'#c8900a',dim:'#2e1f08',btn:'#c8900a',ico:'#1a1208' }, // gold
  { bg:'#081a14',dot:'#37d99a',dim:'#0d2b1e',btn:'#37d99a',ico:'#081a14' }, // teal
  { bg:'#081a0c',dot:'#2ecc71',dim:'#0d2b14',btn:'#2ecc71',ico:'#081a0c' }, // green
  { bg:'#1a0808',dot:'#e05050',dim:'#2e1010',btn:'#e05050',ico:'#1a0808' }, // red
  { bg:'#08101a',dot:'#4a90d9',dim:'#0e1e30',btn:'#4a90d9',ico:'#08101a' }, // blue
  { bg:'#140a1a',dot:'#a855f7',dim:'#221030',btn:'#a855f7',ico:'#140a1a' }, // purple
  { bg:'#1a1208',dot:'#f59e0b',dim:'#2e1f08',btn:'#f59e0b',ico:'#1a1208' }, // amber
  { bg:'#081a1a',dot:'#06b6d4',dim:'#0d2a2e',btn:'#06b6d4',ico:'#081a1a' }, // cyan
];
const HABIT_COLORS_LIGHT = [
  { bg:'#fde68a',dot:'#92650a',dim:'#fbbf24',btn:'#92650a',ico:'#fde68a' }, // gold
  { bg:'#6ee7b7',dot:'#065f46',dim:'#34d399',btn:'#065f46',ico:'#6ee7b7' }, // teal
  { bg:'#86efac',dot:'#14532d',dim:'#4ade80',btn:'#14532d',ico:'#86efac' }, // green
  { bg:'#fca5a5',dot:'#7f1d1d',dim:'#f87171',btn:'#7f1d1d',ico:'#fca5a5' }, // red
  { bg:'#93c5fd',dot:'#1e3a8a',dim:'#60a5fa',btn:'#1e3a8a',ico:'#93c5fd' }, // blue
  { bg:'#d8b4fe',dot:'#4a044e',dim:'#c084fc',btn:'#4a044e',ico:'#d8b4fe' }, // purple
  { bg:'#fcd34d',dot:'#78350f',dim:'#fbbf24',btn:'#78350f',ico:'#fcd34d' }, // amber
  { bg:'#67e8f9',dot:'#164e63',dim:'#22d3ee',btn:'#164e63',ico:'#67e8f9' }, // cyan
];
const HABIT_COLORS=HABIT_COLORS_DARK; // resolved at render time via habitColors()
function habitColors(){return document.documentElement.getAttribute('data-theme')==='light'?HABIT_COLORS_LIGHT:HABIT_COLORS_DARK;}
const DEFAULT_HABITS = [
  {id:'brush_teeth',name:'Brush Teeth',sub:'Twice a day',emoji:'🪥',colorIdx:0,type:'daily',dailyTarget:2,log:{}},
  {id:'make_bed',name:'Making the Bed',sub:'Every morning',emoji:'🛏️',colorIdx:1,type:'daily',log:{}},
  {id:'gym',name:'Gym',sub:'Going to the gym',emoji:'🏋️',colorIdx:2,type:'weekly',target:3,log:{}},
  {id:'tidy_room',name:'Tidy Room',sub:'Keep it clean',emoji:'🧹',colorIdx:6,type:'daily',log:{}},
  {id:'water',name:'Drink Water',sub:'Stay hydrated',emoji:'💧',colorIdx:3,type:'daily',log:{}},
  {id:'tennis',name:'Tennis',sub:'On the court',emoji:'🎾',colorIdx:4,type:'weekly',target:2,log:{}},
  {id:'get_outside',name:'Get Outside',sub:'Fresh air daily',emoji:'☀️',colorIdx:6,type:'weekly',target:5,log:{}},
  {id:'review_goals',name:'Review Goals',sub:'Monthly check-in',emoji:'🎯',colorIdx:5,type:'monthly',target:1,log:{}},
];

// ── STATE (window-scoped: shared across all modules) ─────────────
window.appData = {
  intention:'', focusTasks:[], projects:[], userProjects:[], habits:[...DEFAULT_HABITS],
  events:[], transactions:[], budget:{...DEFAULT_BUDGET}, savings:{...DEFAULT_SAVINGS},
  accounts:[], goals:[], notes:[], profile:''
};
window.currentFilter='all';
window.currentMonth=new Date().getMonth();
window.currentYear=new Date().getFullYear();
let saveTimer=null;

// ── HELPERS ───────────────────────────────────────────────────────
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2);
const todayStr=()=>new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in browser's local timezone
// ── THEME ──────────────────────────────────────────────────────────────
(function(){
  const saved=localStorage.getItem('theme');
  if(saved==='light') document.documentElement.setAttribute('data-theme','light');
})();
window.toggleTheme=function(){
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  if(isLight){
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme','dark');
  }else{
    document.documentElement.setAttribute('data-theme','light');
    localStorage.setItem('theme','light');
  }
  updateThemeBtn();
  // Re-render habit cards so they pick up the correct color palette
  if(typeof renderHabitsGrid==='function'){
    renderHabitsGrid('habitsGridDash');
    renderHabitsGrid('habitsGridTab');
  }
};
function updateThemeBtn(){
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  const lbl=document.getElementById('themeLabel');
  if(lbl) lbl.textContent=isLight?'Dark':'Light';
  updateThemeSwitch();
}
// ── HIDE NUMBERS ─────────────────────────────────────────────────────
let numbersHidden=localStorage.getItem('hideNumbers')==='1';
function toggleHideNumbers(){
  numbersHidden=!numbersHidden;
  localStorage.setItem('hideNumbers',numbersHidden?'1':'0');
  updateHideNumBtn();
  renderFinanceTab();
  renderGoals();
}
function updateHideNumBtn(){
  const btn=document.getElementById('hideNumBtn');
  const lbl=document.getElementById('hideNumLabel');
  const icon=document.getElementById('hideNumIcon');
  if(!btn)return;
  if(lbl) lbl.textContent=numbersHidden?'Show':'Hide';
  if(icon) icon.innerHTML=numbersHidden
    ?'<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    :'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}
window.toggleHideNumbers=toggleHideNumbers;
// ── MIGRATE old savings object → accounts array ───────────────────
function migrateOldSavings(sv){
  if(!sv)return[];
  const map={robinhood:{name:'Robinhood',type:'investment'},schwab:{name:'Schwab',type:'investment'},savingsplus:{name:'Savings+',type:'savings'}};
  return Object.entries(map).filter(([k])=>sv[k]>0).map(([k,meta])=>({id:k,name:meta.name,type:meta.type,balance:sv[k]||0,updatedAt:sv.updatedAt?.[k]||Date.now()}));
}

// ── ACCOUNT COLORS by type ────────────────────────────────────────
const ACCT_TYPE_META={
  checking:{label:'Checking',color:'#0a84ff'},
  savings:{label:'Savings',color:'#30d158'},
  investment:{label:'Investment',color:'#ff9f0a'},
  crypto:{label:'Crypto',color:'#bf5af2'},
  property:{label:'Property',color:'#64d2ff'},
  debt:{label:'Debt',color:'#ff453a'},
};

const fmt=n=>'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtM=n=>numbersHidden?'••••':fmt(n); // masked version
function humanDate(dateStr,today){
  const d=new Date(dateStr+'T12:00:00'),t=new Date(today+'T12:00:00');
  const diff=Math.round((d-t)/86400000);
  const md=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  if(diff===0)return`Today (${md})`;
  if(diff===1)return`Tomorrow (${md})`;
  if(diff===-1)return`Yesterday (${md})`;
  const wd=d.toLocaleDateString('en-US',{weekday:'long'});
  if(diff>1&&diff<=6)return`${wd} (${md})`;
  if(diff>=7&&diff<=13)return`Next ${wd} (${md})`;
  if(diff<-1&&diff>=-6)return`Last ${wd} (${md})`;
  if(diff<-6&&diff>=-13)return`${wd}, last week (${md})`;
  return md;
}
function calcStreak(h){
  let s=0,d=new Date();
  if(!habitDone(h,todayStr()))d.setDate(d.getDate()-1);
  for(let i=0;i<365;i++){const k=d.toLocaleDateString('en-CA');if(habitDone(h,k)){s++;d.setDate(d.getDate()-1);}else break;}
  return s;
}
function getGreeting(){
  const h=new Date().getHours();
  if(h<12)return'Good morning';if(h<18)return'Good afternoon';return'Good evening';
}
function daysInMonth(y,m){return new Date(y,m+1,0).getDate();}
// ── AUTH ──────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user=>{
  if(user){
    document.getElementById('auth-screen').style.display='none';
    const appEl=document.getElementById('app');
    appEl.style.display='flex';
    appEl.style.flexDirection='column';
    updateThemeBtn();
    const initials=(user.displayName||'D').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const avatarEl=document.getElementById('userAvatar');
    if(avatarEl)avatarEl.textContent=initials;
    userRef=doc(db,'users',user.uid,'data','main');
    await loadData();
    renderAll();
  } else {
    document.getElementById('auth-screen').style.display='flex';
    document.getElementById('app').style.display='none';
  }
});

document.getElementById('signInBtn').onclick=()=>signInWithPopup(auth,new GoogleAuthProvider());

window.doSignOut=()=>{signOut(auth);closeModal('signOutModal');};

// ── PROFILE DROPDOWN ──────────────────────────────────────────────
window.toggleProfileDropdown=function(){
  const dd=document.getElementById('profileDropdown');
  const bd=document.getElementById('pddBackdrop');
  if(!dd)return;
  const isOpen=dd.classList.contains('open');
  if(isOpen){closeProfileDropdown();}
  else{openProfileDropdown();}
};
window.openProfileDropdown=function(){
  const dd=document.getElementById('profileDropdown');
  const bd=document.getElementById('pddBackdrop');
  if(!dd)return;
  updateThemeSwitch();
  updateCompactSwitch();
  updateFontSizeBtns();
  dd.classList.add('open');
  if(bd)bd.classList.add('open');
};
window.closeProfileDropdown=function(){
  const dd=document.getElementById('profileDropdown');
  const bd=document.getElementById('pddBackdrop');
  if(dd)dd.classList.remove('open');
  if(bd)bd.classList.remove('open');
};
window.pddToggleTheme=function(){
  toggleTheme();
  updateThemeSwitch();
};
function updateThemeSwitch(){
  const toggle=document.getElementById('pddThemeToggle');
  if(!toggle)return;
  const isDark=document.documentElement.getAttribute('data-theme')!=='light';
  toggle.classList.toggle('on',isDark);
}
// ── DATA ──────────────────────────────────────────────────────────
async function loadData(){
  try{
    const snap=await getDoc(userRef);
    if(snap.exists()){
      const d=snap.data();
      appData={
        intention:d.intention||'',
        focusTasks:d.focusTasks||[],
        projects:d.projects||[],
        userProjects:d.userProjects||[],
        habits:d.habits!=null?d.habits:[...DEFAULT_HABITS],
        events:d.events||[],
        transactions:d.transactions||[],
        budget:d.budget||{...DEFAULT_BUDGET},
        savings:d.savings||{...DEFAULT_SAVINGS},
        accounts:d.accounts||migrateOldSavings(d.savings),
        goals:d.goals||[],
        notes:d.notes||[],
        profile:d.profile||'',
        timetreeEvents:d.timetreeEvents||[],
        timetreeSyncedAt:d.timetreeSyncedAt||0,
      };
    }
  }catch(e){console.error('Load error',e);}
}

function saveData(){
  // Log goal balance history daily before saving
  (appData.goals||[]).forEach(g=>logGoalBalanceHistory(g));
  // Track net worth history daily (#25)
  if(typeof trackNetWorthHistory==='function')trackNetWorthHistory();
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    if(!userRef)return;
    try{await setDoc(userRef,appData);}catch(e){console.error('Save error',e);}
  },600);
}

// ── RENDER ALL ────────────────────────────────────────────────────
function renderAll(){
  renderGreeting();
  renderIntention();
  renderStats();
  renderFocusTasks();
  renderTodaySchedule();
  syncTimetreeEvents();
  renderFinanceRing();
  renderHabitsGrid('habitsGridDash');
  renderHabitsGrid('habitsGridTab');
  renderTasks();
  renderFinanceTab();
  updateHabitsSummary();
  renderProjects();
  renderDashProjectsWidget();
  renderGoals();
  renderDashNW();
  renderBrainDump();
  renderJarvisHistory();
  updateLastBackupLabel();
}

// ── SHARED HELPERS ────────────────────────────────────────────────
function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// ── MODALS ────────────────────────────────────────────────────────
function openModal(id){document.getElementById(id).classList.add('open');}
window.openModal=openModal;
function closeModal(id){document.getElementById(id).classList.remove('open');}
window.closeModal=closeModal;
['addEventModal','addHabitModal','newTaskModal','txnModal','budgetModal','savingsModal','signOutModal','projectModal','accountModal','goalModal','weeklyReviewModal','calEventModal'].forEach(id=>{
  document.getElementById(id)?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal(id);});
});
// ── TAB SWITCHING ─────────────────────────────────────────────────
window.switchTab=function(tab){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+tab)?.classList.add('active');
  document.querySelectorAll('.nav-tab[data-tab],.bottom-tab[data-tab]').forEach(b=>{
    b.classList.toggle('active',b.dataset.tab===tab);
  });
  if(tab==='dashboard'){renderTodaySchedule();renderStats();syncTimetreeEvents();}
  if(tab==='finance')renderFinanceTab();
  if(tab==='habits'){renderHabitsGrid('habitsGridTab');updateHabitsSummary();}
  if(tab==='tasks')renderTasks();
  if(tab==='projects')renderProjects();
  if(tab==='goals')renderGoals();
  if(tab==='calendar')renderCalendar();
};
// ── TOAST ─────────────────────────────────────────────────────────
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className='toast show '+(type||'');
  clearTimeout(window._toastTimer);
  window._toastTimer=setTimeout(()=>el.className='toast',3000);
}
window.toast=toast;
// ── OFFLINE DETECTION ─────────────────────────────────────────────
function updateOnlineStatus(){
  const banner=document.getElementById('offlineBanner');
  if(!banner)return;
  banner.classList.toggle('show',!navigator.onLine);
}
window.addEventListener('online',updateOnlineStatus);
window.addEventListener('offline',updateOnlineStatus);
updateOnlineStatus();

// ── DATA EXPORT ───────────────────────────────────────────────────
window.exportData=function(){
  const blob=new Blob([JSON.stringify(appData,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`dashboard-export-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('✓ Export downloaded');
};

// ── DATA BACKUP ───────────────────────────────────────────────────
window.createBackup=async function(){
  if(!userRef)return;
  toast('Creating backup…');
  try{
    const ts=Date.now();
    const pathParts=userRef.path.split('/');
    const uid=pathParts[1];
    const backupRef=doc(db,`users/${uid}/backups/${ts}`);
    await setDoc(backupRef,{...appData,_backedUpAt:ts});
    localStorage.setItem('lastBackupAt',String(ts));
    updateLastBackupLabel();
    toast('✓ Backup saved');
  }catch(e){toast('Backup failed: '+e.message,'error');}
};

function updateLastBackupLabel(){
  const el=document.getElementById('lastBackupLabel');
  if(!el)return;
  const ts=localStorage.getItem('lastBackupAt');
  if(!ts){el.textContent='';return;}
  const d=new Date(parseInt(ts));
  el.textContent=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────
async function enablePushNotifications(){
  const statusEl=document.getElementById('pddPushStatus');
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){
    toast('Push notifications not supported in this browser','error');return;
  }
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){toast('Notification permission denied','error');return;}
    // Get VAPID public key
    const keyRes=await fetch('/.netlify/functions/push-notify?action=vapid-key');
    const keyData=await keyRes.json();
    if(keyData.error){toast('Notifications not configured yet — see push-notify.js for setup instructions');return;}
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(keyData.publicKey),
    });
    // Send subscription to server
    await fetch('/.netlify/functions/push-notify?action=subscribe',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({subscription:sub.toJSON()}),
    });
    if(statusEl)statusEl.textContent='✓ On';
    toast('✓ Push notifications enabled');
  }catch(e){
    console.error('Push subscribe error:',e);
    toast('Could not enable notifications: '+e.message,'error');
  }
}
window.enablePushNotifications=enablePushNotifications;

function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=window.atob(base64);
  return new Uint8Array([...raw].map(c=>c.charCodeAt(0)));
}

// Check existing push permission state on load
(function checkPushStatus(){
  const statusEl=document.getElementById('pddPushStatus');
  if(!statusEl)return;
  if(!('Notification' in window)){statusEl.textContent='N/A';return;}
  statusEl.textContent=Notification.permission==='granted'?'✓ On':Notification.permission==='denied'?'Blocked':'—';
})();

// ── SERVICE WORKER ────────────────────────────────────────────────
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('SW reg failed',e.message));
  });
}

// ── SKELETON SCREENS ──────────────────────────────────────────────
// Show skeletons during initial load (before renderAll fires)
(function showSkeletons(){
  const skeletonHTML=`<div class="skeleton-wrap">
    <div class="skeleton-line tall"></div>
    <div class="skeleton-line med"></div>
    <div class="skeleton-line short"></div>
  </div>`;
  ['habitsGridDash','focusTasksList','todayEventsList','brainDumpList'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.innerHTML=skeletonHTML;
  });
})();
// ── COMPACT MODE (#72) ────────────────────────────────────────────
(function(){
  const saved=localStorage.getItem('compact');
  if(saved==='1')document.documentElement.setAttribute('data-compact','true');
})();
window.pddToggleCompact=function(){
  const isOn=document.documentElement.getAttribute('data-compact')==='true';
  if(isOn){
    document.documentElement.removeAttribute('data-compact');
    localStorage.setItem('compact','0');
  }else{
    document.documentElement.setAttribute('data-compact','true');
    localStorage.setItem('compact','1');
  }
  updateCompactSwitch();
};
function updateCompactSwitch(){
  const toggle=document.getElementById('pddCompactToggle');
  if(!toggle)return;
  const isOn=document.documentElement.getAttribute('data-compact')==='true';
  toggle.classList.toggle('on',isOn);
}
// ── FONT SIZE (#73) ────────────────────────────────────────────────
(function(){
  const saved=localStorage.getItem('fontSize');
  if(saved) document.documentElement.style.fontSize=saved+'px';
})();
window.setFontSize=function(px){
  document.documentElement.style.fontSize=px+'px';
  localStorage.setItem('fontSize',String(px));
  updateFontSizeBtns();
};
function updateFontSizeBtns(){
  const saved=localStorage.getItem('fontSize')||'15';
  document.querySelectorAll('.pdd-font-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.size===saved);
  });
}
updateFontSizeBtns();

// ── HAPTIC FEEDBACK (#85/#9) ──────────────────────────────────────
// iOS Safari has no navigator.vibrate. Toggling a hidden <input switch> inside a
// label fires the system haptic on iOS 17.4+ when triggered within a user gesture.
let _hapticSwitch=null;
function _initHapticSwitch(){
  if(_hapticSwitch)return;
  const label=document.createElement('label');
  label.setAttribute('aria-hidden','true');
  label.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input=document.createElement('input');
  input.type='checkbox';
  input.setAttribute('switch','');
  label.appendChild(input);
  document.body.appendChild(label);
  _hapticSwitch=label;
}
function haptic(ms=40){
  // Android / browsers that support the Vibration API
  try{if(navigator.vibrate)navigator.vibrate(ms);}catch(e){}
  // iOS Safari fallback
  try{_initHapticSwitch();_hapticSwitch.click();}catch(e){}
}
// ── PULL TO REFRESH (#75) ─────────────────────────────────────────
(function(){
  let _ptrStartY=0,_ptrActive=false,_ptrRefreshing=false;
  const THRESHOLD=60;
  const ind=()=>document.getElementById('ptrIndicator');
  const spinner=()=>document.getElementById('ptrSpinner');
  const txt=()=>document.getElementById('ptrText');
  document.addEventListener('touchstart',e=>{
    if(window.scrollY===0&&!_ptrRefreshing){
      _ptrStartY=e.touches[0].clientY;
      _ptrActive=true;
    }
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!_ptrActive||_ptrRefreshing)return;
    const dy=e.touches[0].clientY-_ptrStartY;
    if(dy>20){
      const el=ind();
      if(el){
        el.classList.add('visible');
        if(txt())txt().textContent=dy>THRESHOLD?'↑ Release to refresh':'↓ Pull to refresh';
      }
    }
  },{passive:true});
  document.addEventListener('touchend',async e=>{
    if(!_ptrActive)return;
    _ptrActive=false;
    const dy=e.changedTouches[0].clientY-_ptrStartY;
    if(dy>THRESHOLD&&!_ptrRefreshing){
      _ptrRefreshing=true;
      const el=ind();
      if(el&&spinner()&&txt()){
        spinner().style.display='block';
        txt().textContent='Refreshing…';
      }
      try{
        await syncTimetreeEvents(true);
        renderAll();
      }catch(err){}
      _ptrRefreshing=false;
      if(el){el.classList.remove('visible');}
      if(spinner())spinner().style.display='none';
      if(txt())txt().textContent='↓ Pull to refresh';
      toast('✓ Refreshed');
    } else {
      const el=ind();
      if(el)el.classList.remove('visible');
    }
  },{passive:true});
})();

// ── KEYBOARD HEIGHT HANDLING (#87) ────────────────────────────────
(function(){
  if(!window.visualViewport)return;
  const mainEl=()=>document.querySelector('.main');
  let _basePad=0;
  window.visualViewport.addEventListener('resize',()=>{
    const main=mainEl();
    if(!main)return;
    const focused=document.activeElement;
    const isInput=focused&&(focused.tagName==='INPUT'||focused.tagName==='TEXTAREA'||focused.tagName==='SELECT');
    if(!isInput){main.style.paddingBottom='';return;}
    const kbHeight=window.innerHeight-window.visualViewport.height;
    if(kbHeight>50){
      main.style.paddingBottom=kbHeight+'px';
    } else {
      main.style.paddingBottom='';
    }
  });
  document.addEventListener('focusout',()=>{
    setTimeout(()=>{
      const main=mainEl();
      if(main&&!document.activeElement?.tagName.match(/INPUT|TEXTAREA|SELECT/)){
        main.style.paddingBottom='';
      }
    },150);
  });
})();
// ── Mobile swipe navigation ────────────────────────────────────────
(function(){
  const TAB_ORDER=['dashboard','tasks','finance','goals','projects','calendar'];
  let _sx=0,_sy=0;
  function curTabIdx(){
    const el=document.querySelector('.page.active');
    if(!el)return 0;
    return Math.max(0,TAB_ORDER.indexOf(el.id.replace('page-','')));
  }
  let _swipeOnWeekCal=false;
  document.addEventListener('touchstart',e=>{
    _sx=e.touches[0].clientX;
    _sy=e.touches[0].clientY;
    _swipeOnWeekCal=!!e.target.closest('.week-cal-wrap');
  },{passive:true});
  document.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-_sx;
    const dy=Math.abs(e.changedTouches[0].clientY-_sy);
    if(Math.abs(dx)<55||dy>Math.abs(dx)*0.8)return;
    if(e.target.closest('.modal,.chat-panel,.bottom-nav'))return;
    // Swipe on week calendar → navigate weeks
    if(_swipeOnWeekCal&&_calView==='week'){
      weekCalNav(dx<0?1:-1);
      return;
    }
    const i=curTabIdx();
    if(dx<0&&i<TAB_ORDER.length-1)switchTab(TAB_ORDER[i+1]);
    else if(dx>0&&i>0)switchTab(TAB_ORDER[i-1]);
  },{passive:true});
})();

// ── GLOBAL EXPORTS (inline handlers + cross-module refs resolve via window) ──
Object.assign(window, {
  uid, todayStr, fmt, fmtM, humanDate, getGreeting, daysInMonth, escHtml,
  habitColors, calcStreak, migrateOldSavings, saveData, loadData, renderAll,
  updateThemeBtn, updateHideNumBtn, haptic, updateCompactSwitch, updateFontSizeBtns,
  updateLastBackupLabel,
  CATS_EMOJI, DEFAULT_BUDGET, DEFAULT_SAVINGS, DEFAULT_HABITS,
  HABIT_COLORS_DARK, HABIT_COLORS_LIGHT, ACCT_TYPE_META,
});
export { db, auth, doc, getDoc, setDoc };
