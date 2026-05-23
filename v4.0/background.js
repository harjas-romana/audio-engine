/* ================================================================
   SONICFORGE STUDIO v4.0 — Service Worker
   Professional Audio Processing Engine
   ================================================================ */

const KEEP_ALIVE_INTERVAL = 25000; // 25 seconds
let keepAliveTimer = null;

// State management
const tabStates = new Map();

chrome.runtime.onInstalled.addListener((details) => {
    console.log('[SonicForge Studio] v4.0.0 installed.');

    if (details.reason === 'install') {
        // Initialize default state on first install
        const defaultState = {
            enabled: false,
            mode: 'default',
            eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            spatial: {
                depth16d: 0,
                spatialSpread: 0,
                stereoWidth: 100,
                crossfeed: 0,
                wetDry: 0,
                roomSize: 0,
                reverbDecay: 0,
                earlyRef: 0,
                preDelay: 0
            },
            enhance: {
                masterVol: 100,
                balance: 0,
                clarity: 0,
                warmth: 22000,
                compThreshold: -24,
                compRatio: 4,
                compAttack: 3,
                compRelease: 250,
                speed: 100,
                loudnessNorm: false,
                noiseGate: false,
                analogWarmth: false,
                monoCompat: false
            },
            tone: {
                subBass: 0,
                presence: 0,
                air: 0
            }
        };

        chrome.storage.local.set({ hrState: defaultState });
    }
});

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'HR_PING') {
        sendResponse({ ok: true, version: '4.0.0' });
        return true;
    }

    if (msg.type === 'HR_GET_TAB_ID') {
        sendResponse({ tabId: sender.tab?.id });
        return true;
    }

    if (msg.type === 'HR_STATE_SYNC') {
        if (sender.tab?.id) {
            tabStates.set(sender.tab.id, msg.state);
        }
        sendResponse({ ok: true });
        return true;
    }

    return false;
});

// Tab cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
});

// Keep service worker alive
function startKeepAlive() {
    if (keepAliveTimer) clearInterval(keepAliveTimer);

    keepAliveTimer = setInterval(() => {
        chrome.storage.local.get(['hrState'], () => {
            // Just accessing storage keeps worker alive
            if (chrome.runtime.lastError) {
                console.warn('[SonicForge] Keep-alive error:', chrome.runtime.lastError);
            }
        });
    }, KEEP_ALIVE_INTERVAL);
}

// Initialize keep-alive
startKeepAlive();

// Restart keep-alive on wake
chrome.runtime.onStartup.addListener(() => {
    console.log('[SonicForge Studio] Service worker started.');
    startKeepAlive();
}); 
 
