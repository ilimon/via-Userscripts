// ==UserScript==
// @name         Via Stealth Anti-Adblock & Cookie Deleter v1.1 (Patched + Teardown)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Stealth Bypass for Adblock Detectors + Cookie Banner Removal (Site-Safe Hooks)
// @author       AI Privacy Expert (patched)
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function(){
'use strict';
const D=false;const l=(...a)=>D&&console.log('[VSAD]',...a);
const u=location.href,isDownload=/download|file|dl\//i.test(u);

if(sessionStorage.getItem('vsad-disabled')==='1'){l('VSAD disabled');return}

// Store originals for teardown
const _orig={fetch:window.fetch,XOpen:XMLHttpRequest.prototype.open};
let _popObs=null,_ckObs=null;

// ============================================================================
// 1. STEALTH ADBLOCK DETECTOR BYPASS
// ============================================================================
(function(){try{
if(!isDownload){
const injectBait=()=>['google_ads','ad-banner','adsbygoogle'].forEach(id=>{
if(document.getElementById(id))return;
const d=document.createElement('div');d.id=id;
d.style.cssText='width:1px;height:1px;position:absolute;top:-9999px;left:-9999px;opacity:0.001;pointer-events:none';
d.innerHTML='<img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" width="1" height="1"/>';
(document.body||document.documentElement).appendChild(d);l('Bait:',id);
});
if(document.readyState==='loading')
 document.addEventListener('DOMContentLoaded',injectBait,{once:true,passive:true});
else setTimeout(injectBait,100);
}

// Replace known detector functions
['adBlockDetected','checkAdBlock','detectAdBlock','isAdBlockActive','adBlockEnabled','canRunAds','isAdBlockerActive']
.forEach(n=>{Object.defineProperty(window,n,{configurable:true,enumerable:false,writable:false,value:()=>false});});

// Hook fetch/XHR safely
const detRx=/adblock.*detect|antiblock|blockadblock|ad.*blocker.*detect/i;
const safeRx=/api\/|\/file\/|\/download\/|\.json|\.xml/i;
if(typeof window.fetch==='function'){
window.fetch=function(u,...a){
const us=typeof u==='string'?u:u?.url||'';
if(detRx.test(us)&&!safeRx.test(us)){l('Blocked fetch:',us);
return Promise.resolve(new Response('',{status:204,headers:{'Content-Type':'text/javascript'}}));}
return _orig.fetch.apply(this,arguments);
};}
XMLHttpRequest.prototype.open=function(m,u,...r){
if(detRx.test(String(u))&&!safeRx.test(u)){l('Blocked XHR:',u);
return _orig.XOpen.call(this,m,'data:text/javascript,',...r);}
return _orig.XOpen.call(this,m,u,...r);
};

l('✓ Stealth bypass ready');
}catch(e){l('Bypass err:',e)}})();

// ============================================================================
// 2. POPUP/MODAL REMOVAL
// ============================================================================
(function(){try{
const popRx=/adblock|ad\s*blocker|disable.*ad|turn\s*off.*block|whitelist.*site/i;
const legit=/download|confirm|login|subscribe|alert|warning|success/i;
let t;
const scan=()=>{
document.querySelectorAll('div[style*="fixed"],div[class*="modal"],div[class*="popup"],div[class*="overlay"]').forEach(el=>{
if(!el.offsetParent)return;
const txt=(el.textContent||'').toLowerCase();
if(popRx.test(txt)&&!legit.test(txt)){
const s=getComputedStyle(el),w=parseFloat(s.width),h=parseFloat(s.height);
if((w/window.innerWidth>0.8&&h/window.innerHeight>0.8)||s.position==='fixed'){
el.remove();l('Removed popup:',el.className||el.id);
}}});
};
_popObs=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(scan,250);});
document.addEventListener('DOMContentLoaded',()=>_popObs.observe(document.body,{childList:true,subtree:true}),{once:true});
const st=document.createElement('style');st.dataset.vsad='hide';
st.textContent='[class*="adblock-modal"],[id*="adblock-popup"],[class*="anti-adb"]{display:none!important}';
(document.head||document.documentElement).appendChild(st);
l('✓ Popup remover ready');
}catch(e){l('Popup err:',e)}})();

// ============================================================================
// 3. COOKIE BANNER HANDLER
// ============================================================================
(function(){try{
const ckRx=/cookie|consent|gdpr|privacy[\s-]?notice/i;
let ct;
const scan=()=>{
document.querySelectorAll('[class*="cookie"],[id*="cookie"],[class*="consent"],[id*="consent"]').forEach(c=>{
const s=getComputedStyle(c);
if(s.position==='fixed'||s.position==='sticky'){
const btn=[...c.querySelectorAll('button,a,[role="button"]')].find(b=>/accept.*all|agree|allow.*all|got\s*it|ok/i.test(b.textContent||''));
if(btn){btn.click();setTimeout(()=>c.remove(),500);l('Auto-accepted cookie');}
else if(c.offsetHeight/window.innerHeight<0.3){c.remove();l('Removed cookie banner');}
}});
};
_ckObs=new MutationObserver(()=>{clearTimeout(ct);ct=setTimeout(scan,800);});
document.addEventListener('DOMContentLoaded',()=>_ckObs.observe(document.body,{childList:true,subtree:true}),{once:true});
l('✓ Cookie handler ready');
}catch(e){l('Cookie err:',e)}})();

// ============================================================================
// 4. CONTROLS + TEARDOWN
// ============================================================================
window.__VSADv1={
info(){return{
Bait:!!document.getElementById('google_ads'),
FetchHooked:window.fetch!==_orig.fetch,
DownloadMode:isDownload
};},
disable(full=false){
try{
if(_popObs)_popObs.disconnect();
if(_ckObs)_ckObs.disconnect();
if(full){
try{if(_orig.fetch)window.fetch=_orig.fetch;}catch(e){}
try{if(_orig.XOpen)XMLHttpRequest.prototype.open=_orig.XOpen;}catch(e){}
}
sessionStorage.setItem('vsad-disabled','1');
}catch(e){l('disable err:',e);}
location.reload();
}
};
l('✓ VSAD v1.1 active',isDownload?'(download mode)':'');
})();
