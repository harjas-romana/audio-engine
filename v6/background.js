/* ================================================================
   AUDIO ENGINE v2.2 — Service Worker
   Made by Harjas Singh. All rights reserved.
   ================================================================ */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Audio Engine] v2.2 installed.');
});

// Keep-alive ping handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'HR_PING') sendResponse({ ok: true });
  return true;
});