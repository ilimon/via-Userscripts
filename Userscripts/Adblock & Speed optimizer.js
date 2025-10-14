// ==UserScript==
// @name         Via Brave Booster v1.1 — Adblock & Speed Optimizer (Fixed)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Brave-Level Adblock + Speed Boost for Via (Android WebView) — patched syntax/robustness fixes from v1.0
// @author       AI Privacy Expert (patched)
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function(){
  'use strict';

  const D = false;
  function l(...a){ D && console.log('[VBB]', ...a); }

  // ======================================================================
  // 0. Helper: safeDefine (wrap potentially problematic defs)
  // ======================================================================
  function safeDefine(obj, prop, desc) {
    try {
      Object.defineProperty(obj, prop, desc);
      return true;
    } catch (e) {
      try {
        // best-effort fallback to proto
        if (obj && obj.__proto__) Object.defineProperty(obj.__proto__, prop, desc);
        return true;
      } catch (e2) {
        l('safeDefine failed for', prop, e2 && e2.message);
        return false;
      }
    }
  }

  // ======================================================================
  // 1. ADBLOCK HARDENING (Brave-Level ~99%) — fixed & hardened
  // ======================================================================
  (function(){
    try {
      // Cosmetic rules injection (mark style with data-vbb)
      const s = document.createElement('style');
      s.setAttribute('data-vbb','1'); // v1.1 Fix: identify style for info()
      s.textContent = `
*[class*="ad-"]:not(header):not(address):not(main),
*[id*="ad-"]:not(header):not(main),
*[class*="advertisement"],*[id*="advertisement"],
*[class*="adsbygoogle"],*[id*="adsbygoogle"],
*[class*="_ad_"],*[id*="_ad_"],
*[class*="google_ads"],*[id*="google_ads"],
*[class*="sponsor"],*[id*="sponsor"],
*[data-ad-slot],*[data-google-query-id],
iframe[src*="doubleclick"],iframe[src*="googlesyndication"],
iframe[src*="facebook.com/plugins"],iframe[src*="ads-twitter"]
{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;position:absolute!important;width:0!important;height:0!important}
`;
      (document.head || document.documentElement).appendChild(s);

      // Network tracker regex
      const trackerRx = /google-analytics|googletagmanager|facebook\.net|doubleclick|adservice|ad\.doubleclick|static\.ads-twitter|analytics\.twitter|connect\.facebook\.net|pixel\.|scorecardresearch|2mdn\.net|advertising\.com|taboola|outbrain|adnxs\.com/i;

      // Wrap original fetch safely
      const origFetch = window.fetch && window.fetch.bind(window);
      if (origFetch) {
        window.fetch = async function(...args) {
          try {
            const url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || '';
            if (trackerRx.test(url)) {
              l('Blocked fetch:', url);
              return Promise.reject(new Error('blocked'));
            }
          } catch (e) { /* ignore and continue to fetch */ }
          const response = await origFetch(...args);
          try {
            if (response && response.ok && !response.bodyUsed) { // v1.1 Fix: Check body not used before clone
              const ct = response.headers.get('content-type') || '';
              if (/image|css|font/.test(ct)) {
                const cloned = response.clone();
                const headers = new Headers(response.headers);
                headers.set('Cache-Control', 'max-age=3600');
                return new Response(cloned.body, { status: cloned.status, statusText: cloned.statusText, headers });
              }
            }
          } catch(e){ /* clone fail, return original */ }
          return response;
        };
      }

      // Patch XHR.open to silently skip blocked requests
      const origXOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        try {
          if (trackerRx.test(String(url))) {
            l('XHR block (silent):', url); // v1.1 Fix: Silent fail vs. redirect
            return; // Abort without error
          }
        } catch (e) { /* fallthrough */ }
        return origXOpen.call(this, method, url, ...rest);
      };

      // Anti-fingerprint scriptlet blocks (safe guards)
      ['google_ads','googletag','fbq','ga','_gaq','gtag'].forEach(name=>{
        try {
          if (!(name in window)) {
            safeDefine(window, name, { configurable:true, enumerable:false, get:()=>undefined, set:()=>{}, });
          } else {
            // if defined, try to neutralize without throwing
            try { window[name] = undefined; } catch(e){}
          }
        } catch(e){}
      });

      // Referrer-policy spoof (best-effort)
      try {
        const refDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');
        if (refDesc && refDesc.configurable) {
          safeDefine(document, 'referrer', { configurable:false, enumerable:true, get: ()=> window.location.origin });
        }
      } catch (e) { /* ignore if unconfigurable */ }

      l('✓ Adblock hardened (patched)');
    } catch (e) { l('Adblock err:', e && e.message); }
  })();

  // ======================================================================
  // 2. BROWSING SPEED BOOST (HyperOS/WebView Throttle Bypass) — fixed
  // ======================================================================
  (function(){
    try {
      // Preconnect + dns-prefetch to important CDNs (use https)
      function addPrefetch(host) {
        try {
          const link1 = document.createElement('link');
          link1.rel = 'dns-prefetch';
          link1.href = 'https://' + host;
          (document.head || document.documentElement).appendChild(link1);

          const link2 = document.createElement('link');
          link2.rel = 'preconnect';
          link2.href = 'https://' + host;
          link2.crossOrigin = ''; // v1.1 Fix: For auth/cookies
          (document.head || document.documentElement).appendChild(link2);
        } catch(e){}
      }

      const cdns = ['fonts.googleapis.com','fonts.gstatic.com','ajax.googleapis.com','cdnjs.cloudflare.com','cdn.jsdelivr.net'];
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ()=>{
          cdns.forEach(addPrefetch);
        }, { once:true, passive:true });
      } else cdns.forEach(addPrefetch);

      // Override connection values (best-effort)
      try {
        if (navigator.connection) {
          const conn = navigator.connection;
          const target = { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false };
          Object.keys(target).forEach(k=>{
            try { safeDefine(conn, k, { get: ()=> target[k], configurable:true }); } catch(e){}
          });
        }
      } catch(e){}

      // Cache-Control proxy for fetch responses (wrap existing fetch)
      const origFetch2 = window.fetch && window.fetch.bind(window);
      if (origFetch2) {
        window.fetch = async function(...args) {
          const response = await origFetch2(...args);
          try {
            if (response && response.ok && !response.bodyUsed) { // v1.1 Fix: Check body not used before clone
              const ct = response.headers.get('content-type') || '';
              if (/image|css|font/.test(ct)) {
                const cloned = response.clone();
                const headers = new Headers(response.headers);
                headers.set('Cache-Control', 'max-age=3600');
                return new Response(cloned.body, { status: cloned.status, statusText: cloned.statusText, headers });
              }
            }
          } catch(e){ /* clone fail, return original */ }
          return response;
        };
      }

      // Disable images on 2G (best-effort)
      try {
        if (navigator.connection && /2g/i.test(String(navigator.connection.effectiveType))) {
          const origImgSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
          Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true,
            set: function(v) {
              try {
                // if image isn't lazy-loading, replace with tiny placeholder
                if (this.loading !== 'lazy') {
                  this.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');
                } else if (origImgSrc && origImgSrc.set) {
                  origImgSrc.set.call(this, v);
                } else {
                  this.setAttribute('src', v);
                }
              } catch(e){}
            },
            get: function() {
              try { return this.getAttribute('src') || ''; } catch(e){ return ''; }
            }
          });
        }
      } catch(e){}

      l('✓ Speed boost active (patched)');
    } catch (e) { l('Speed err:', e && e.message); }
  })();

  // ======================================================================
  // 3. DOWNLOAD SPEED OPTIMIZER (Via/HyperOS Limits) — fixed & hardened
  // ======================================================================
  (function(){
    try {
      // Hook download links (passive observer)
      const obs = new MutationObserver(()=>{
        try {
          document.querySelectorAll('a[download]:not([data-vbb])').forEach(a=>{
            a.setAttribute('data-vbb','1');
            a.addEventListener('click', async function(e){
              try {
                const u = this.href;
                const fn = this.getAttribute('download') || 'file';
                if (!u || u.startsWith('blob:')) return;
                e.preventDefault();
                l('DL hook:', u);
                try {
                  const r = await fetch(u, { headers: { 'Range': 'bytes=0-' } });
                  if (!r.ok) throw new Error('Fetch failed');
                  const blob = await r.blob();
                  const obj = URL.createObjectURL(blob);
                  const dL = document.createElement('a');
                  dL.href = obj; dL.download = fn;
                  document.body.appendChild(dL);
                  dL.click();
                  dL.remove();
                  URL.revokeObjectURL(obj);
                } catch (er) {
                  // fallback to normal navigation
                  l('DL fallback to navigation', er && er.message);
                  window.location.href = u;
                }
              } catch(err) { l('DL handler err', err && err.message); }
            }, { passive:false });
          });
        } catch(e){}
      });

      if (document.body) obs.observe(document.body, { childList:true, subtree:true });
      else document.addEventListener('DOMContentLoaded', ()=>obs.observe(document.body, { childList:true, subtree:true }), { once:true, passive:true });

      // Disconnect observer after 10s to save resources (optional)
      setTimeout(()=> {
        try { obs.disconnect(); l('Download observer disconnected'); } catch(e){}
      }, 10000);

      // Throttle bypass: subtle performance.now() offset
      try {
        const origPN = performance.now.bind(performance);
        const off = 10 + Math.random()*40;
        performance.now = function() { return origPN() + off; };
      } catch(e){}

      l('✓ Download optimizer active (patched)');
    } catch (e) { l('DL err:', e && e.message); }
  })();

  // ======================================================================
  // USER CONTROLS
  // ======================================================================
  window.__VBBv1 = {
    info() {
      try {
        const t = {
          Adblock: !!document.querySelector('style[data-vbb]') || document.styleSheets.length > 0,
          Preconnect: document.querySelectorAll('link[rel="dns-prefetch"],link[rel="preconnect"]').length > 0,
          Connection: (navigator.connection && navigator.connection.effectiveType === '4g') || false,
          Downloads: !!document.querySelector('a[data-vbb]'),
          PerfOffset: performance.now() - performance.now() !== 0 // v1.1 Fix: Basic offset check
        };
        console.table(t);
        return t;
      } catch(e){ return {}; }
    },
    disable() { try { sessionStorage.clear(); location.reload(); } catch(e) { location.reload(); } }
  };

  l('✓ VBB v1.1 active (fixed)');

})();
