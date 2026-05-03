// popup.js — Ghost Finder UI Controller
'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════
let currentTab   = null;
let activeMode   = null;      // 'followers' | 'following'
let isScraping   = false;
let pendingReset = null;      // what we're about to reset
let ghostsCache  = [];        // computed ghosts list
let currentProfile = null;   // 'username' extracted from URL

// Per-profile storage key prefix
const KEY = (profile, type) => `gf_${profile}_${type}`;

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE  (chrome.storage.local, per-profile)
// ═══════════════════════════════════════════════════════════════════════════════
async function loadData(profile, type) {
  // Returns { entries: [...], total: N|null, sessions: N, updatedAt: iso }
  const key = KEY(profile, type);
  const res = await chrome.storage.local.get(key);
  return res[key] || { entries: [], total: null, sessions: 0, updatedAt: null };
}

async function saveData(profile, type, data) {
  const key = KEY(profile, type);
  await chrome.storage.local.set({ [key]: data });
}

async function clearData(profile, type) {
  const key = KEY(profile, type);
  await chrome.storage.local.remove(key);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const $  = id => document.getElementById(id);
const esc = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function setDot(state) {
  $('dot').className = 'dot ' + state;
}
function setStatus(state, text) {
  setDot(state);
  $('statusTxt').textContent = text;
}

// ── Logging ──────────────────────────────────────────────────────────────────
function log(logId, text, type = '') {
  const body = $(logId + '-body');
  if (!body) return;
  const ts   = new Date().toTimeString().slice(0,8);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-msg ${type}">${esc(text)}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  // Keep at most 80 lines
  while (body.children.length > 80) body.removeChild(body.firstChild);
}
function clearLog(logId) {
  const body = $(logId + '-body');
  if (body) body.innerHTML = '';
}
window.clearLog = clearLog;

// ── Ring progress ────────────────────────────────────────────────────────────
function updateRing(ringId, numId, pctId, collected, total) {
  const CIRCUMFERENCE = 138.2;
  let pct = 0;
  if (total && total > 0) {
    pct = Math.min(100, Math.round((collected / total) * 100));
    $(ringId).style.strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * pct / 100);
    $(numId).textContent = pct + '%';
    $(pctId).textContent = `${fmt(collected)}/${fmt(total)}`;
  } else {
    // unknown total — fill to 50% to show activity
    const fakePct = collected > 0 ? 50 : 0;
    $(ringId).style.strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * fakePct / 100);
    $(numId).textContent = collected > 0 ? fmt(collected) : '0';
    $(pctId).textContent = collected > 0 ? 'collected' : '';
  }
}

// ── Stat boxes ───────────────────────────────────────────────────────────────
function updateStatsUI(mode, data) {
  const p    = mode === 'followers' ? 'fl' : 'fw';
  const n    = data.entries.length;
  const tot  = data.total;
  $(p+'-collected').textContent  = fmt(n);
  $(p+'-total').textContent      = tot ? fmt(tot) : '—';
  $(p+'-sessions').textContent   = data.sessions;
  $('badge-'+mode).textContent   = n > 0 ? fmt(n) : '0';
  updateRing('ring-'+p, 'ring-'+p+'-num', 'ring-'+p+'-pct', n, tot);

  // Mark tab done if collection matches total
  const tab = $('tab-'+mode);
  if (tot && n >= tot) tab.classList.add('done');
  else tab.classList.remove('done');
}

function fmt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('tab-'+name).classList.add('active');
  $('panel-'+name).classList.add('active');
  if (name === 'ghosts') renderGhosts();
}
window.switchTab = switchTab;

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
function extractUsername(url) {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean);
    // Typical IG paths: /username/ or /username/followers/ etc.
    if (path.length >= 1 && !['explore','accounts','direct','stories'].includes(path[0])) {
      return path[0].toLowerCase();
    }
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
async function init() {
  setStatus('', 'Checking page…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    const url  = tab?.url || '';
    const short = url.replace('https://www.instagram.com','').slice(0,44) || '/';
    $('activeUrl').textContent = short || '—';

    if (!url.includes('instagram.com')) {
      $('screen-noig').style.display = 'block';
      $('screen-main').style.display = 'none';
      setStatus('err', 'Not on Instagram');
      return;
    }

    $('screen-noig').style.display = 'none';
    $('screen-main').style.display = 'flex';

    // Extract profile
    const username = extractUsername(url);
    currentProfile = username || '__unknown__';
    $('footer-profile').textContent = username ? '@'+username : '';

    // Pre-inject content script silently (ensures latest version is loaded)
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch {}

    // Load saved data for this profile
    const [flData, fwData] = await Promise.all([
      loadData(currentProfile, 'followers'),
      loadData(currentProfile, 'following'),
    ]);

    updateStatsUI('followers', flData);
    updateStatsUI('following', fwData);

    if (flData.entries.length > 0) {
      log('log-fl', `Loaded ${fmt(flData.entries.length)} saved followers (${flData.sessions} session${flData.sessions!==1?'s':''})`, 'ok');
    }
    if (fwData.entries.length > 0) {
      log('log-fw', `Loaded ${fmt(fwData.entries.length)} saved following (${fwData.sessions} session${fwData.sessions!==1?'s':''})`, 'ok');
    }

    setStatus('ready', 'Ready');
  } catch (err) {
    setStatus('err', 'Init error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPE
// ═══════════════════════════════════════════════════════════════════════════════
async function startScrape(mode) {
  if (isScraping || !currentTab) return;
  isScraping  = true;
  activeMode  = mode;

  const p   = mode === 'followers' ? 'fl' : 'fw';
  const logId = 'log-' + p;

  $('btn-'+p+'-scrape').disabled = true;
  $('btn-'+p+'-abort').style.display = 'inline-flex';
  $('btn-'+p+'-reset').disabled = true;

  setStatus('busy', 'Scraping '+mode+'…');
  log(logId, 'Starting scrape session…', 'hi');

  // Load existing data to pass usernames already collected
  const saved = await loadData(currentProfile, mode);
  const existingUsernames = saved.entries.map(e => e.username);
  log(logId, `Existing: ${fmt(existingUsernames.length)} unique entries`, '');

  try {
    // Always force-inject the latest content.js so we never run a stale version
    log(logId, 'Injecting scraper into page…', '');
    try {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['content.js'] });
    } catch (injectErr) {
      log(logId, 'Injection failed: ' + injectErr.message, 'err');
      resetScrapeUI();
      return;
    }
    // Give the script a moment to register its message listener
    await new Promise(r => setTimeout(r, 400));

    // Confirm the script is alive
    let alive = false;
    try {
      const pong = await chrome.tabs.sendMessage(currentTab.id, { type: 'PING' });
      alive = pong?.ok === true;
    } catch {}

    if (!alive) {
      log(logId, 'Content script did not respond. Try refreshing Instagram and try again.', 'err');
      resetScrapeUI();
      return;
    }
    log(logId, 'Scraper ready ✓ — sending start command…', 'hi');

    await chrome.tabs.sendMessage(currentTab.id, {
      type: 'START_SCRAPE',
      options: { mode, maxResults: 0, existingUsernames },
    });
  } catch (err) {
    log(logId, 'Error: ' + err.message, 'err');
    resetScrapeUI();
  }
}
window.startScrape = startScrape;

async function abortScrape() {
  if (!currentTab) return;
  try {
    await chrome.tabs.sendMessage(currentTab.id, { type: 'ABORT_SCRAPE' });
  } catch {}
  resetScrapeUI();
  setStatus('ready', 'Aborted');
}
window.abortScrape = abortScrape;

function resetScrapeUI() {
  isScraping = false;
  const p    = activeMode === 'followers' ? 'fl' : 'fw';
  if (!p) return;
  $('btn-'+p+'-scrape').disabled = false;
  $('btn-'+p+'-abort').style.display = 'none';
  $('btn-'+p+'-reset').disabled = false;
  setStatus('ready', 'Ready');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER (from content.js via background)
// ═══════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener(async (msg) => {

  // ── Progress event ─────────────────────────────────────────────────────────
  if (msg.type === 'SCRAPER_PROGRESS') {
    const p     = activeMode === 'followers' ? 'fl' : 'fw';
    const logId = 'log-' + p;
    const typeMap = {
      init:'hi', modal:'hi', container:'hi', total:'',
      scrolling:'', done_limit:'ok', done_complete:'ok',
      done_stable:'ok', timeout:'warn', aborted:'warn',
    };
    log(logId, msg.message, typeMap[msg.step] || '');

    if (msg.collected != null) {
      // Update stats from progress
      const saved = await loadData(currentProfile, activeMode);
      const total = msg.total || saved.total || null;
      const fakeData = { entries: { length: msg.collected }, total, sessions: saved.sessions };
      // Update rings
      const p2 = activeMode === 'followers' ? 'fl' : 'fw';
      $(p2+'-collected').textContent = fmt(msg.collected);
      if (total) $(p2+'-total').textContent = fmt(total);
      updateRing('ring-'+p2, 'ring-'+p2+'-num', 'ring-'+p2+'-pct', msg.collected, total);
      $('badge-'+activeMode).textContent = fmt(msg.collected);
    }
  }

  // ── Batch event — save incrementally ────────────────────────────────────────
  if (msg.type === 'SCRAPER_BATCH') {
    const { entries: newEntries, mode, totalCollected, total } = msg;
    if (!currentProfile || !mode) return;

    const saved = await loadData(currentProfile, mode);
    const existingSet = new Set(saved.entries.map(e => e.username));

    let added = 0;
    for (const e of newEntries) {
      if (!existingSet.has(e.username)) {
        saved.entries.push(e);
        existingSet.add(e.username);
        added++;
      }
    }

    if (total && (!saved.total || total > saved.total)) saved.total = total;
    saved.updatedAt = new Date().toISOString();
    await saveData(currentProfile, mode, saved);

    updateStatsUI(mode, saved);
  }

  // ── Done event ──────────────────────────────────────────────────────────────
  if (msg.type === 'SCRAPER_DONE') {
    const { mode, sessionCount, totalCollected, total } = msg;
    const p     = mode === 'followers' ? 'fl' : 'fw';
    const logId = 'log-' + p;

    // Increment session counter
    const saved = await loadData(currentProfile, mode);
    saved.sessions = (saved.sessions || 0) + 1;
    if (total && (!saved.total || total > saved.total)) saved.total = total;
    await saveData(currentProfile, mode, saved);

    log(logId, `Session complete: ${fmt(sessionCount)} new — total ${fmt(saved.entries.length)}`, 'ok');
    if (total && saved.entries.length >= total) {
      log(logId, `✓ Complete! All ${fmt(total)} collected.`, 'ok');
      $('tab-'+mode).classList.add('done');
    } else if (total) {
      log(logId, `Refresh Instagram & scrape again to collect more.`, 'warn');
    }

    updateStatsUI(mode, saved);
    resetScrapeUI();

    // Auto-compute ghosts if both lists have data
    const other = mode === 'followers' ? 'following' : 'followers';
    const otherData = await loadData(currentProfile, other);
    if (otherData.entries.length > 0 && saved.entries.length > 0) {
      log(logId, `Both lists ready — check 👻 Ghosts tab!`, 'ghost');
    }
  }

  // ── Error event ─────────────────────────────────────────────────────────────
  if (msg.type === 'SCRAPER_ERROR') {
    const p     = activeMode === 'followers' ? 'fl' : 'fw';
    const logId = activeMode ? 'log-' + p : 'log-fl';
    log(logId, msg.message, 'err');
    setStatus('err', 'Error occurred');
    resetScrapeUI();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GHOST ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
// Ghosts = people in Following who are NOT in Followers
// i.e. friend is following them but they didn't follow back (or unfollowed)

async function computeGhosts() {
  const [flData, fwData] = await Promise.all([
    loadData(currentProfile, 'followers'),
    loadData(currentProfile, 'following'),
  ]);

  const flSet = new Set(flData.entries.map(e => e.username));
  const fwMap = new Map(fwData.entries.map(e => [e.username, e]));

  // Ghosts: in following, not in followers
  const ghosts = [];
  for (const [username, entry] of fwMap) {
    if (!flSet.has(username)) {
      ghosts.push(entry);
    }
  }

  return { ghosts, flData, fwData };
}

async function renderGhosts() {
  const { ghosts, flData, fwData } = await computeGhosts();
  ghostsCache = ghosts;

  const flCount  = flData.entries.length;
  const fwCount  = fwData.entries.length;
  const flTotal  = flData.total;
  const fwTotal  = fwData.total;

  // Hero count
  $('ghost-count').textContent = ghosts.length > 0 ? ghosts.length : (flCount > 0 && fwCount > 0 ? '0' : '—');
  $('badge-ghosts').textContent = ghosts.length > 0 ? ghosts.length : '—';

  // Meta pills
  const mutualCount = fwCount - ghosts.length;
  $('ghost-meta').innerHTML = `
    <span class="ghost-stat">👥 Followers: <strong>${fmt(flCount)}</strong>${flTotal ? '/'+fmt(flTotal) : ''}</span>
    <span class="ghost-stat">🔗 Following: <strong>${fmt(fwCount)}</strong>${fwTotal ? '/'+fmt(fwTotal) : ''}</span>
    <span class="ghost-stat">🤝 Mutuals: <strong>${fmt(mutualCount >= 0 ? mutualCount : '—')}</strong></span>
  `;

  // Needs-more warning
  const flIncomplete = flTotal && flCount < flTotal;
  const fwIncomplete = fwTotal && fwCount < fwTotal;
  const hasNoData    = flCount === 0 || fwCount === 0;

  if (hasNoData) {
    $('needs-more').style.display = 'flex';
    $('needs-more-txt').textContent = 'Collect both Followers and Following before analysing ghosts.';
  } else if (flIncomplete || fwIncomplete) {
    $('needs-more').style.display = 'flex';
    let parts = [];
    if (flIncomplete) parts.push(`followers (${fmt(flCount)}/${fmt(flTotal)})`);
    if (fwIncomplete) parts.push(`following (${fmt(fwCount)}/${fmt(fwTotal)})`);
    $('needs-more-txt').textContent = `Partial data: ${parts.join(', ')} — ghost list may be incomplete. Refresh & re-scrape.`;
  } else {
    $('needs-more').style.display = 'none';
  }

  renderGhostList(ghosts);
}

function renderGhostList(list) {
  const body = $('ghost-list-body');
  if (!body) return;

  if (list.length === 0) {
    body.innerHTML = `<div class="ghost-empty">${
      ghostsCache.length === 0 && !$('ghost-count').textContent.match(/^\d/)
        ? 'Collect Followers & Following first.'
        : '🎉 No ghosts found! Everyone follows back.'
    }</div>`;
    return;
  }

  body.innerHTML = '';
  list.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'ghost-item';
    div.innerHTML = `
      ${entry.avatarUrl
        ? `<img class="gi-avatar" src="${esc(entry.avatarUrl)}" onerror="this.src=''" alt=""/>`
        : `<div class="gi-avatar" style="display:flex;align-items:center;justify-content:center;font-size:12px">👤</div>`
      }
      <div class="gi-info">
        <div class="gi-user">@${esc(entry.username)}</div>
        ${entry.displayName ? `<div class="gi-name">${esc(entry.displayName)}</div>` : ''}
      </div>
      <a class="gi-link" href="${esc(entry.profileUrl)}" target="_blank" title="Open profile">↗</a>
    `;
    body.appendChild(div);
  });
}

function filterGhosts(query) {
  if (!ghostsCache.length) return;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? ghostsCache.filter(e =>
        e.username.toLowerCase().includes(q) ||
        (e.displayName||'').toLowerCase().includes(q)
      )
    : ghostsCache;
  renderGhostList(filtered);
}
window.filterGhosts = filterGhosts;

// ═══════════════════════════════════════════════════════════════════════════════
// DOWNLOADS
// ═══════════════════════════════════════════════════════════════════════════════
async function downloadGhosts(format) {
  const { ghosts, flData, fwData } = await computeGhosts();
  if (!ghosts.length) return;

  const ts   = new Date().toISOString().replace(/[:.]/g,'-');
  const meta = {
    profile:     currentProfile,
    generatedAt: new Date().toISOString(),
    ghostCount:  ghosts.length,
    followingTotal: fwData.entries.length,
    followersTotal: flData.entries.length,
  };

  let data, mime, filename;

  if (format === 'json') {
    data     = JSON.stringify({ meta, ghosts }, null, 2);
    mime     = 'application/json';
    filename = `ghosts_${currentProfile}_${ts}.json`;
  } else {
    const rows = ghosts.map(e =>
      [csvCell(e.username), csvCell(e.displayName||''), csvCell(e.profileUrl)].join(',')
    );
    data     = ['username,displayName,profileUrl', ...rows].join('\n');
    mime     = 'text/csv';
    filename = `ghosts_${currentProfile}_${ts}.csv`;
  }

  chrome.runtime.sendMessage({ type: 'TRIGGER_DOWNLOAD', data, mime, filename });
}
window.downloadGhosts = downloadGhosts;

function csvCell(v) {
  const s = String(v||'');
  return (s.includes(',')||s.includes('"')||s.includes('\n'))
    ? '"'+s.replace(/"/g,'""')+'"' : s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════════════════════
function confirmReset(what) {
  pendingReset = what;
  const descs = {
    followers: 'This will clear all saved followers data for this profile. You\'ll need to scrape again.',
    following: 'This will clear all saved following data for this profile. You\'ll need to scrape again.',
    all:       'This will clear ALL data (followers + following) for this profile. The ghost list will be empty.',
  };
  $('modal-desc').textContent = descs[what] || descs.all;
  $('reset-modal').classList.add('open');
}
window.confirmReset = confirmReset;

async function doReset() {
  closeModal();
  if (!currentProfile) return;

  if (pendingReset === 'followers' || pendingReset === 'all') {
    await clearData(currentProfile, 'followers');
    updateStatsUI('followers', { entries: [], total: null, sessions: 0 });
    log('log-fl', 'Followers data cleared.', 'warn');
    $('tab-followers').classList.remove('done');
  }
  if (pendingReset === 'following' || pendingReset === 'all') {
    await clearData(currentProfile, 'following');
    updateStatsUI('following', { entries: [], total: null, sessions: 0 });
    log('log-fw', 'Following data cleared.', 'warn');
    $('tab-following').classList.remove('done');
  }

  ghostsCache = [];
  $('ghost-count').textContent = '—';
  $('badge-ghosts').textContent = '—';
  $('ghost-list-body').innerHTML = '<div class="ghost-empty">Collect Followers & Following first.</div>';

  pendingReset = null;
}
window.doReset = doReset;

function closeModal() {
  $('reset-modal').classList.remove('open');
}
window.closeModal = closeModal;

// ═══════════════════════════════════════════════════════════════════════════════
// BOOT — bind all events here (no inline handlers in HTML, CSP compliant)
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  $('tab-followers').addEventListener('click', () => switchTab('followers'));
  $('tab-following').addEventListener('click', () => switchTab('following'));
  $('tab-ghosts').addEventListener('click',    () => switchTab('ghosts'));

  // Followers panel
  $('btn-fl-scrape').addEventListener('click', () => startScrape('followers'));
  $('btn-fl-abort').addEventListener('click',  () => abortScrape());
  $('btn-fl-reset').addEventListener('click',  () => confirmReset('followers'));
  $('btn-clear-fl')?.addEventListener('click', () => clearLog('log-fl'));

  // Following panel
  $('btn-fw-scrape').addEventListener('click', () => startScrape('following'));
  $('btn-fw-abort').addEventListener('click',  () => abortScrape());
  $('btn-fw-reset').addEventListener('click',  () => confirmReset('following'));
  $('btn-clear-fw')?.addEventListener('click', () => clearLog('log-fw'));

  // Ghosts panel
  $('ghost-filter')?.addEventListener('input', (e) => filterGhosts(e.target.value));
  $('btn-dl-json')?.addEventListener('click', () => downloadGhosts('json'));
  $('btn-dl-csv')?.addEventListener('click',  () => downloadGhosts('csv'));
  $('btn-reset-all')?.addEventListener('click', () => confirmReset('all'));

  // Reset modal
  $('btn-modal-confirm')?.addEventListener('click', () => doReset());
  $('btn-modal-cancel')?.addEventListener('click',  () => closeModal());

  init();
});
