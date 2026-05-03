// content.js — Ghost Finder v1.3
// Injected on-demand by popup only (not auto-injected by manifest).
// Uses var for top-level flags so re-injection is safe (var re-declaration is a no-op).

var __gfLoaded   = __gfLoaded   || false;
var __gfActive   = __gfActive   || false;
var __gfAbort    = __gfAbort    || false;

if (!__gfLoaded) {
  __gfLoaded = true;

  // ── Message listener ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'START_SCRAPE') {
      if (!__gfActive) {
        __gfAbort  = false;
        __gfActive = true;
        runScrape(msg.options || {}).catch(function(err) {
          sendBg({ type: 'SCRAPER_ERROR', message: err.message || String(err) });
          __gfActive = false;
        });
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'ABORT_SCRAPE') {
      __gfAbort  = true;
      __gfActive = false;
      sendResponse({ ok: true });
      return true;
    }
    return true;
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function sendBg(msg) {
    try { chrome.runtime.sendMessage(msg); } catch(e) {}
  }

  function prog(step, message, extra) {
    var payload = { type: 'SCRAPER_PROGRESS', step: step, message: message };
    if (extra) { for (var k in extra) payload[k] = extra[k]; }
    sendBg(payload);
  }

  // ── Main scrape ─────────────────────────────────────────────────────────────
  async function runScrape(opts) {
    var mode              = opts.mode              || 'followers';
    var maxResults        = opts.maxResults        || 0;
    var existingUsernames = opts.existingUsernames || [];

    var sleep = function(ms) { return new Promise(function(r){ setTimeout(r, ms); }); };
    var existingSet = new Set(existingUsernames);

    prog('init', 'Starting ' + mode + ' scraper...');
    await sleep(400);

    // 1 ── Find the open dialog ────────────────────────────────────────────────
    var dialog = null;
    for (var i = 0; i < 30; i++) {
      var all = document.querySelectorAll('div[role="dialog"]');
      if (all.length > 0) { dialog = all[all.length - 1]; break; }
      await sleep(200);
    }
    if (!dialog) {
      sendBg({ type: 'SCRAPER_ERROR',
        message: 'Modal not found. Click Followers / Following on Instagram first, keep it open, then press Scrape.' });
      __gfActive = false;
      return;
    }
    prog('modal', 'Modal detected ✓');

    // 2 ── Read total count ─────────────────────────────────────────────────────
    var total = null;
    try {
      document.querySelectorAll('a[href*="/followers/"] span span, a[href*="/following/"] span span').forEach(function(el) {
        var t = el.getAttribute('title');
        if (t) { var n = parseInt(t.replace(/,/g,'')); if (!isNaN(n) && n > 0) total = n; }
      });
      if (!total) {
        var h = dialog.querySelector('h1,h2,h3,[role="heading"]');
        if (h) { var m = h.textContent.match(/[\d,]+/); if (m) total = parseInt(m[0].replace(/,/g,'')); }
      }
    } catch(e) {}
    prog('total', total ? 'Target: ' + total.toLocaleString() + ' users' : 'Total unknown — scrolling to end.');

    // 3 ── Find scrollable container ───────────────────────────────────────────
    var scrollable = null;
    for (var att = 0; att < 25; att++) {
      var divs = Array.from(dialog.querySelectorAll('div'));
      // Look for div that is taller inside than outside and has overflow
      for (var di = 0; di < divs.length; di++) {
        var el = divs[di];
        if (el.scrollHeight <= el.clientHeight + 5) continue;
        var cs = window.getComputedStyle(el);
        if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
        if (el.querySelector('a[href^="/"]')) { scrollable = el; break; }
      }
      if (scrollable) break;
      await sleep(300);
    }
    if (!scrollable) scrollable = dialog;
    prog('container', 'Scroll container ready ✓');

    // 4 ── Scroll and collect ──────────────────────────────────────────────────
    var collected  = new Map();
    var lastCount  = -1;
    var stableRuns = 0;
    var MAX_STABLE = 10;
    var startTime  = Date.now();
    var MAX_TIME   = 3 * 60 * 1000;

    while (true) {
      if (__gfAbort) { prog('aborted', 'Aborted — ' + collected.size + ' collected.'); break; }

      // Harvest all profile links currently in DOM
      dialog.querySelectorAll('a[href^="/"]').forEach(function(a) {
        var href  = a.getAttribute('href') || '';
        var parts = href.split('/').filter(Boolean);
        if (parts.length !== 1) return;   // skip /p/ /explore/ etc.
        var username = parts[0];
        if (!username || collected.has(username)) return;

        var displayName = null, avatarUrl = null;
        try {
          var li = a.closest('li') || a.closest('[role]') || a.parentElement;
          if (li) {
            var spans = li.querySelectorAll('span');
            for (var si = 0; si < spans.length; si++) {
              var t = spans[si].textContent.trim();
              if (t && t !== username && t.length > 1 && t.length < 80
                  && !/^\d+$/.test(t) && t.toLowerCase() !== 'follow'
                  && t.toLowerCase() !== 'following') {
                displayName = t; break;
              }
            }
            var img = li.querySelector('img[src]');
            if (img) avatarUrl = img.src;
          }
        } catch(e) {}

        collected.set(username, {
          username:   username,
          displayName: displayName,
          avatarUrl:   avatarUrl,
          profileUrl:  'https://www.instagram.com/' + username + '/',
        });
      });

      var count = collected.size;

      if (count > lastCount) {
        stableRuns = 0;
        lastCount  = count;
        sendBg({
          type: 'SCRAPER_BATCH', mode: mode,
          entries: Array.from(collected.values()),
          totalCollected: count, total: total,
        });
        prog('scrolling',
          'Collecting... ' + count.toLocaleString() + (total ? ' / ' + total.toLocaleString() : '') + ' users',
          { collected: count, total: total }
        );
        if (maxResults > 0 && count >= maxResults) { prog('done_limit', 'Reached limit.'); break; }
        if (total && count >= total) { prog('done_complete', 'All ' + total + ' collected! ✓'); break; }
      } else {
        stableRuns++;
        if (stableRuns >= MAX_STABLE) { prog('done_stable', 'Reached end of list.'); break; }
      }

      if (Date.now() - startTime > MAX_TIME) { prog('timeout', 'Timeout — refresh & scrape again.'); break; }

      // Scroll
      try { scrollable.scrollTop = scrollable.scrollHeight + 9999; } catch(e) {}
      try { dialog.scrollTop     = dialog.scrollHeight     + 9999; } catch(e) {}
      try { scrollable.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}

      await sleep(800 + Math.random() * 600 + stableRuns * 200);
    }

    // 5 ── Finished ─────────────────────────────────────────────────────────────
    var finalEntries = Array.from(collected.values());
    var newCount = finalEntries.filter(function(e){ return !existingSet.has(e.username); }).length;
    sendBg({
      type: 'SCRAPER_DONE', mode: mode,
      sessionCount: newCount, totalCollected: finalEntries.length,
      total: total, entries: finalEntries,
    });
    __gfActive = false;
  }

} // end guard
