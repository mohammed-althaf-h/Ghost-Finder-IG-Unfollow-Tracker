// background.js — Ghost Finder Service Worker v2
'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Relay scraper events from content script → popup
  const relayTypes = ['SCRAPER_PROGRESS', 'SCRAPER_DONE', 'SCRAPER_ERROR', 'SCRAPER_BATCH'];
  if (relayTypes.includes(msg.type)) {
    // Send to all extension pages (popup)
    chrome.runtime.sendMessage(msg).catch(() => {
      // Popup may not be open — that's fine, storage is still updated
    });
  }

  // File download triggered by popup
  if (msg.type === 'TRIGGER_DOWNLOAD') {
    const blob = new Blob([msg.data], { type: msg.mime });
    const url  = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: msg.filename, saveAs: false }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }

  sendResponse({ ok: true });
  return true;
});
