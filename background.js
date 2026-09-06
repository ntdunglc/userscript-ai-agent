// background.js - Service Worker for Userscript AI Agent

// Disable side panel globally so it never shows on tabs unless explicitly opened for that tab
if (chrome.sidePanel && chrome.sidePanel.setOptions) {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}

// Track tabs where user enabled the side panel
const enabledTabs = new Set();

// Action click: toggle per-tab side panel
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    if (enabledTabs.has(tab.id)) {
      // Toggle OFF: disable panel for this tab (automatically hides/closes it)
      enabledTabs.delete(tab.id);
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        enabled: false
      });
    } else {
      // Toggle ON: enable and open panel specifically for this tab
      enabledTabs.add(tab.id);
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: `sidepanel/sidepanel.html?tabId=${tab.id}`,
        enabled: true
      });
      if (chrome.sidePanel.open) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    }
  } catch (err) {
    console.warn('[Userscript AI Agent] Failed to toggle per-tab side panel:', err);
  }
});

// Clean up tab session storage and tracked state when tab is closed
if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    enabledTabs.delete(tabId);
    const key = `tab_session_${tabId}`;
    if (chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(key).catch(() => {});
    } else if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(key).catch(() => {});
    }
  });
}

/**
 * Converts a userscript match pattern into a RegExp.
 * Supports apex domains, subdomains (*.domain.com), schemes, and paths.
 */
function patternToRegExp(pattern) {
  if (!pattern || typeof pattern !== 'string') return null;
  pattern = pattern.trim();
  if (pattern === '<all_urls>' || pattern === '*' || pattern === '*://*/*') {
    return /^https?:\/\/.+/i;
  }

  let scheme = 'https?';
  let rest = pattern;
  if (pattern.startsWith('*://')) {
    scheme = 'https?';
    rest = pattern.slice(4);
  } else if (pattern.startsWith('http://')) {
    scheme = 'http';
    rest = pattern.slice(7);
  } else if (pattern.startsWith('https://')) {
    scheme = 'https';
    rest = pattern.slice(8);
  } else if (pattern.startsWith('*')) {
    scheme = 'https?';
    rest = pattern.slice(1);
    if (rest.startsWith('://')) rest = rest.slice(3);
  }

  const slashIdx = rest.indexOf('/');
  let host = slashIdx !== -1 ? rest.slice(0, slashIdx) : rest;
  let path = slashIdx !== -1 ? rest.slice(slashIdx) : '/*';

  let hostRegex = '';
  if (host === '*' || host === '') {
    hostRegex = '[^/]+';
  } else if (host.startsWith('*.')) {
    const domain = host.slice(2).replace(/([.+?^=!:${}()|[\]/\\])/g, '\\$1');
    // Matches apex domain (archive.ph) and any subdomain (www.archive.ph, sub.archive.ph)
    hostRegex = '(?:[a-zA-Z0-9-]+\\.)*' + domain;
  } else {
    const escaped = host.replace(/([.+?^=!:${}()|[\]/\\])/g, '\\$1').replace(/\*/g, '[a-zA-Z0-9-]+');
    hostRegex = '(?:[a-zA-Z0-9-]+\\.)*' + escaped;
  }

  const pathRegex = path
    .replace(/([.+?^=!:${}()|[\]/\\])/g, '\\$1')
    .replace(/\*/g, '.*');

  return new RegExp('^' + scheme + ':\\/\\/' + hostRegex + (pathRegex ? pathRegex : '.*') + '$', 'i');
}

/**
 * Checks if a given URL matches any of the provided pattern strings.
 */
function isUrlMatching(url, patterns) {
  if (!url || !patterns) return false;
  if (!Array.isArray(patterns)) patterns = [patterns];

  for (const pat of patterns) {
    if (!pat) continue;
    try {
      const rx = patternToRegExp(pat);
      if (rx && rx.test(url)) return true;
    } catch (e) {
      console.warn('[Userscript AI Agent] Invalid pattern regex:', pat, e);
    }
  }
  return false;
}

/**
 * Auto-inject saved, enabled userscripts when a web page finishes loading.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const currentUrl = tab?.url || changeInfo?.url;
  if (!currentUrl) return;

  // Ignore browser internal URLs
  if (
    currentUrl.startsWith('chrome://') ||
    currentUrl.startsWith('chrome-extension://') ||
    currentUrl.startsWith('edge://') ||
    currentUrl.startsWith('devtools://') ||
    currentUrl.startsWith('about:') ||
    currentUrl.startsWith('view-source:')
  ) {
    return;
  }

  try {
    const data = await chrome.storage.local.get('saved_userscripts');
    const scripts = data.saved_userscripts || [];

    for (const script of scripts) {
      if (!script.enabled || !script.code) continue;

      const matches = isUrlMatching(currentUrl, script.matchPatterns || ['<all_urls>']);
      if (matches) {
        console.log(`[Userscript AI Agent] Auto-injecting "${script.name}" into tab ${tabId} (${currentUrl})`);

        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (code, name) => {
            try {
              let res;
              try {
                const run = new Function(code);
                res = run();
              } catch (evalErr) {
                // CSP fallback for sites restricting eval / new Function
                const s = document.createElement('script');
                s.textContent = code;
                (document.head || document.documentElement).appendChild(s);
                s.remove();
                res = 'Executed via script tag injection fallback';
              }
              console.log(`[Userscript AI Agent] Auto-injected: "${name}":`, res);
            } catch (err) {
              console.error(`[Userscript AI Agent] Execution error in "${name}":`, err);
            }
          },
          args: [script.code, script.name]
        });
      }
    }
  } catch (err) {
    console.error('[Userscript AI Agent] Error checking/injecting scripts:', err);
  }
});

/**
 * Message handler for extension components.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_MATCHING_SCRIPTS') {
    (async () => {
      try {
        const data = await chrome.storage.local.get('saved_userscripts');
        const scripts = data.saved_userscripts || [];
        const matching = scripts.filter((s) =>
          isUrlMatching(message.url, s.matchPatterns || ['<all_urls>'])
        );
        sendResponse({ matching });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (message.type === 'RELOAD_TAB') {
    (async () => {
      try {
        if (message.tabId) {
          await chrome.tabs.reload(message.tabId);
          sendResponse({ success: true });
        } else {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab) {
            await chrome.tabs.reload(activeTab.id);
            sendResponse({ success: true });
          } else {
            sendResponse({ error: 'No active tab found' });
          }
        }
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});
