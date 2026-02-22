/* ================================================================
   AUDIO ENGINE v2.0 — Service Worker
   ================================================================ */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Audio Engine] v2.0 installed.');
});

// Keep-alive ping handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'HR_PING') sendResponse({ ok: true });
  return true;
});