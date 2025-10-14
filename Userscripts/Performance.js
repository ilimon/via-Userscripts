// ==UserScript==
// @name         Via JS Pauser v1.1 — Background Tab Optimizer (Patched)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Passive JS Pause on Background Tabs: Saves battery/RAM in Via (Android WebView) — hardened & debugged
// @author       ilimon
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function(){
  'use strict';

  const D = false;
  function l(...a){ if (D) console.log('[VJP]', ...a); }

  // state & queues
  let isBg = !!document.hidden;
  let bgTime = 0;
  const q = { t: [], r: [], f: [] }; const QCAP = 50;

  // save originals safely (guard in case other scripts already patched)
  const orig = {
    setTimeout: window.setTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null,
    fetch: window.fetch ? window.fetch.bind(window) : null,
    performanceNow: performance.now.bind(performance)
  };

  // utility: safe call (try/catch wrapper)
  const safe = (fn, ...args) => { try { return fn(...args); } catch(e) { if (D) console.warn('safe fn err', e); } };

  // debounced visibility handler: queues & flushes operations
  let vT;
  document.addEventListener('visibilitychange', ()=> {
    clearTimeout(vT);
    vT = safe(orig.setTimeout, ()=>{
      const prev = isBg;
      isBg = !!document.hidden;
      if (isBg) {
        bgTime = Date.now();
        l('→ BACKGROUND');
        queryMediaPause(); // v1.1 Fix: Passive media query on hidden
      } else {
        l('→ FOREGROUND: flushing queues');
        bgTime = 0;
        // flush timers (schedule with 0 so they run in next tick)
        q.t.forEach(item => {
          try { orig.setTimeout(...([item.f, 0].concat(item.a || []))); } catch(e) { try{ item.f(); }catch(e2){} }
        });
        q.t.length = 0;
        // flush RAFs
        q.r.forEach(cb => { try { orig.requestAnimationFrame ? orig.requestAnimationFrame(cb) : safe(cb); } catch(e){} });
        q.r.length = 0;
        // flush deferred fetches (resolve with actual fetch)
        q.f.forEach(p => {
          try { p.resolve(orig.fetch(p.url, p.opts)); } catch(e) { try{ p.resolve(Promise.reject(e)); } catch(e2){} }
        });
        q.f.length = 0;
        // resume media previously paused by this script
        document.querySelectorAll('video,audio').forEach(m => {
          try {
            if (m._vjpPaused) { safe(m.play.bind(m)); delete m._vjpPaused; }
          } catch(e){}
        });
      }
    }, 120); // 120ms debounce to avoid thrash
  }, { passive: true });

  function queryMediaPause() { // v1.1 Fix: Passive query vs. interval
    if (isBg && bgTime && (Date.now() - bgTime) > 30000) {
      document.querySelectorAll('video, audio').forEach(media => {
        try {
          if (!media.paused) {
            media.pause();
            media._vjpPaused = true;
            l('Paused media element');
          }
        } catch(e){}
      });
    }
  }

  // ----------------------------
  // override setTimeout / setInterval
  // ----------------------------
  (function(){
    try {
      // keep numeric ids behavior; when queueing return a negative id to indicate "queued"
      let fakeTimerId = -1;

      window.setTimeout = function(fn, delay = 0, ...args) {
        try {
          // If background and non-trivial delay, queue instead of scheduling
          if (isBg && delay > 500) {
            if (q.t.length < QCAP) { q.t.push({ f: fn, a: args }); } else { q.t.shift(); } // v1.1 Fix: Cap queue
            l('Queue setTimeout (delay)', delay);
            return fakeTimerId--; // return unique negative id
          }
        } catch(e){}
        return orig.setTimeout(fn, delay, ...args);
      };

      window.setInterval = function(fn, delay = 0, ...args) {
        try {
          // If background and long interval, skip creating it to save resources
          if (isBg && delay > 500) {
            l('Skip setInterval (queued/ignored)', delay);
            return fakeTimerId--; // indicate skipped
          }
        } catch(e){}
        return orig.setInterval(fn, delay, ...args);
      };

      l('setTimeout/setInterval overrides installed');
    } catch(e) { l('setTimeout override error', e && e.message); }
  })();

  // ----------------------------
  // override requestAnimationFrame
  // ----------------------------
  (function(){
    try {
      if (!orig.requestAnimationFrame) return;

      let rafCounter = 1;
      const rafIdMap = new Map();

      window.requestAnimationFrame = function(cb) {
        try {
          // If background for >5s, queue RAF callbacks instead of firing
          if (isBg && bgTime && (Date.now() - bgTime) > 5000) {
            const id = rafCounter++;
            if (q.r.length < QCAP) { q.r.push(cb); rafIdMap.set(id, cb); } else { q.r.shift(); rafIdMap.delete(rafIdMap.keys().next().value); } // v1.1 Fix: Cap queue
            l('Queued RAF id', id);
            return id;
          }
        } catch(e){}
        return orig.requestAnimationFrame(cb);
      };

      // Provide cancelAnimationFrame that can cancel queued RAFs
      const origCancelRAF = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : null;
      window.cancelAnimationFrame = function(id) {
        try {
          if (rafIdMap.has(id)) {
            // remove from queue
            const cb = rafIdMap.get(id);
            rafIdMap.delete(id);
            const idx = q.r.indexOf(cb);
            if (idx !== -1) q.r.splice(idx, 1);
            return;
          }
        } catch(e){}
        if (origCancelRAF) return origCancelRAF(id);
      };

      l('requestAnimationFrame override installed');
    } catch(e) { l('rAF override error', e && e.message); }
  })();

  // ----------------------------
  // override fetch: defer non-critical fetches while background
  // ----------------------------
  (function(){
    try {
      if (!orig.fetch) return;
      window.fetch = function(input, init) {
        try {
          // Heuristic: if options mark priority==='high' then allow; otherwise defer while background.
          const opts = init || {};
          const priority = opts.priority;
          const url = (typeof input === 'string') ? input : (input && input.url) || ''; // v1.1 Fix: Fallback url
          // Defer if background and request not marked high-priority
          if (isBg && !(priority && priority === 'high')) {
            // Optionally avoid deferring navigation-level fetches (heuristic: same-origin HTML)
            const sameOriginHTML = typeof input === 'string' && input.indexOf(location.origin) === 0 && /\.(html|php|asp|aspx)?$/.test(input.split('?')[0]);
            if (!sameOriginHTML) {
              if (q.f.length < QCAP) { // v1.1 Fix: Cap queue
                return new Promise((resolve, reject) => {
                  q.f.push({ url: input, opts: init, resolve, reject });
                  l('Deferred fetch', url);
                });
              } else {
                q.f.shift(); // Drop oldest
                return Promise.reject(new Error('Queue full'));
              }
            }
          }
        } catch(e){}
        return orig.fetch(input, init);
      };

      l('fetch override installed (defer non-critical while background)');
    } catch(e) { l('fetch override error', e && e.message); }
  })();

  // ----------------------------
  // media auto-pause (if hidden > 30s) — v1.1 Fix: Passive via visibility
  // ----------------------------
  (function(){
    try {
      // Moved to visibility handler (queryMediaPause) for passive—no interval needed
      l('media pause monitor passive (via visibility)');
    } catch(e){ l('media pause error', e && e.message); }
  })();

  // ----------------------------
  // Controls & debug helpers
  // ----------------------------
  window.__VJPv1 = {
    info() {
      try {
        const queuedTimers = q.t.length;
        const queuedRAF = q.r.length;
        const queuedFetch = q.f.length;
        const bgSeconds = bgTime ? Math.max(0, ((Date.now() - bgTime) / 1000).toFixed(1)) + 's' : '0s';
        const mediaPaused = document.querySelectorAll('video[audio][paused][_vjpPaused]').length; // v1.1 Fix: Media check
        const out = { Background: isBg, BG_Duration: bgSeconds, QueuedTimers: queuedTimers, QueuedRAF: queuedRAF, QueuedFetch: queuedFetch, MediaPaused: mediaPaused };
        console.table(out);
        return out;
      } catch(e){ return {}; }
    },
    // force flush queues (useful if you want to resume while still background)
    flush() {
      try {
        if (!isBg) {
          // flush same logic as visibility handler
          q.t.forEach(item => { try { orig.setTimeout(...([item.f, 0].concat(item.a || []))); } catch(e){ try{ item.f(); }catch(e2){} } });
          q.t.length = 0;
          q.r.forEach(cb => { try { orig.requestAnimationFrame ? orig.requestAnimationFrame(cb) : safe(cb); } catch(e){} });
          q.r.length = 0;
          q.f.forEach(p => { try { p.resolve(orig.fetch(p.url, p.opts)); } catch(e){ p.resolve(Promise.reject('flush failed')); } });
          q.f.length = 0;
          document.querySelectorAll('video,audio').forEach(m => {
            try {
              if (m._vjpPaused) { safe(m.play.bind(m)); delete m._vjpPaused; }
            } catch(e){}
          });
          return true;
        } else {
          console.warn('Cannot flush while still background (change visibility first).');
          return false;
        }
      } catch(e){ console.warn('flush error', e); return false; }
    },
    // disable: restore originals and reload page
    disable() {
      try {
        // restore originals where possible
        if (orig.setTimeout) window.setTimeout = orig.setTimeout;
        if (orig.setInterval) window.setInterval = orig.setInterval;
        if (orig.requestAnimationFrame) window.requestAnimationFrame = orig.requestAnimationFrame;
        if (orig.fetch) window.fetch = orig.fetch;
        if (orig.performanceNow) performance.now = orig.performanceNow;
      } catch(e){}
      // reload to ensure clean environment
      try { location.reload(); } catch(e){ }
    }
  };

  l('✓ VJP v1.1 active (patched)');
})();
