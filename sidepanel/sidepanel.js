// sidepanel.js - Main agent logic, tool loop, DOM bridge, and UI controller

(function () {
  let activeTab = null;
  let currentTabId = null;
  let autoRun = true;
  let conversationHistory = [];
  let messageQueue = [];
  let isProcessing = false;
  let isPickingElement = false;

  // UI Elements
  const autoRunToggle = document.getElementById('autoRunToggle');
  const optionsBtn = document.getElementById('optionsBtn');
  const activeTabDomain = document.getElementById('activeTabDomain');
  const refreshTabBtn = document.getElementById('refreshTabBtn');
  const quickModelSelect = document.getElementById('quickModelSelect');
  const tabChat = document.getElementById('tabChat');

  function setQuickModelUI(model) {
    if (!quickModelSelect || !quickModelSelect.options) return;
    let found = false;
    for (let i = 0; i < quickModelSelect.options.length; i++) {
      if (quickModelSelect.options[i].value === model) {
        quickModelSelect.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found && model) {
      const opt = document.createElement('option');
      opt.value = model;
      opt.textContent = model.length > 16 ? model.substring(0, 16) + '…' : model;
      quickModelSelect.appendChild(opt);
      quickModelSelect.value = model;
    }
  }
  const tabScripts = document.getElementById('tabScripts');
  const chatView = document.getElementById('chatView');
  const scriptsView = document.getElementById('scriptsView');
  const scriptsCountBadge = document.getElementById('scriptsCountBadge');

  const messagesFeed = document.getElementById('messagesFeed');
  const promptInput = document.getElementById('promptInput');
  const sendBtn = document.getElementById('sendBtn');
  const pickElementBtn = document.getElementById('pickElementBtn');
  const dehydrateDomBtn = document.getElementById('dehydrateDomBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const captureScreenshotBtn = document.getElementById('captureScreenshotBtn');
  const screenshotPreviewContainer = document.getElementById('screenshotPreviewContainer');
  const screenshotPreviewImg = document.getElementById('screenshotPreviewImg');
  const removeScreenshotBtn = document.getElementById('removeScreenshotBtn');
  let pendingScreenshotDataUrl = null;

  // Script Manager UI
  const scriptsSearch = document.getElementById('scriptsSearch');
  const newScriptBtn = document.getElementById('newScriptBtn');
  const exportScriptsBtn = document.getElementById('exportScriptsBtn');
  const importScriptsBtn = document.getElementById('importScriptsBtn');
  const importFileInput = document.getElementById('importFileInput');
  const scriptsList = document.getElementById('scriptsList');

  // Modal UI
  const scriptModal = document.getElementById('scriptModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const saveModalBtn = document.getElementById('saveModalBtn');
  const modalTitle = document.getElementById('modalTitle');
  const modalScriptId = document.getElementById('modalScriptId');
  const modalScriptCode = document.getElementById('modalScriptCode');
  const modalScriptEnabled = document.getElementById('modalScriptEnabled');
  const editorMetadataPreview = document.getElementById('editorMetadataPreview');

  // -------------------------------------------------------------
  // Per-Tab Chat Session Manager
  // -------------------------------------------------------------

  const TabSessionManager = {
    getStorage() {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.session) return chrome.storage.session;
        if (chrome.storage.local) return chrome.storage.local;
      }
      return null;
    },

    async saveSession(tabId, sessionData) {
      if (!tabId) return false;
      const storage = this.getStorage();
      if (!storage) return false;
      const key = `tab_session_${tabId}`;
      try {
        await storage.set({ [key]: sessionData });
        return true;
      } catch (err) {
        console.warn(`[Userscript AI Agent] Failed to save session for tab ${tabId}:`, err);
        return false;
      }
    },

    async loadSession(tabId) {
      if (!tabId) return null;
      const storage = this.getStorage();
      if (!storage) return null;
      const key = `tab_session_${tabId}`;
      try {
        const data = await storage.get(key);
        return data ? (data[key] || null) : null;
      } catch (err) {
        console.warn(`[Userscript AI Agent] Failed to load session for tab ${tabId}:`, err);
        return null;
      }
    },

    async clearSession(tabId) {
      if (!tabId) return false;
      const storage = this.getStorage();
      if (!storage) return false;
      const key = `tab_session_${tabId}`;
      try {
        await storage.remove(key);
        return true;
      } catch (err) {
        console.warn(`[Userscript AI Agent] Failed to clear session for tab ${tabId}:`, err);
        return false;
      }
    }
  };

  // -------------------------------------------------------------
  // Context Auto-Compactor (Page-Agent Architecture)
  // -------------------------------------------------------------

  const ContextCompactor = {
    /**
     * Estimates the token count of the conversation history.
     * Heuristic:
     * - Text & JSON: ~4 characters per token
     * - Inline images: ~258 tokens (standard Gemini vision modality token cost)
     * - Tool calls & responses: JSON length / 4 (or 258 for embedded image responses)
     * @param {Array} history
     * @returns {number} Estimated token count
     */
    estimateTokens(history) {
      if (!Array.isArray(history) || history.length === 0) return 0;
      let total = 0;
      for (const item of history) {
        if (!item || !Array.isArray(item.parts)) continue;
        for (const part of item.parts) {
          if (!part) continue;
          if (typeof part.text === 'string') {
            total += Math.ceil(part.text.length / 4);
          }
          if (part.inlineData) {
            total += 258;
          }
          if (part.functionCall) {
            try {
              total += Math.ceil(JSON.stringify(part.functionCall).length / 4);
            } catch (e) {
              total += 50;
            }
          }
          if (part.functionResponse) {
            const resp = part.functionResponse.response;
            if (resp) {
              if (resp.inlineData) {
                total += 258;
              } else {
                try {
                  total += Math.ceil(JSON.stringify(resp).length / 4);
                } catch (e) {
                  total += 50;
                }
              }
            }
            if (Array.isArray(part.functionResponse.parts)) {
              for (const p of part.functionResponse.parts) {
                if (p && p.inlineData) {
                  total += 258;
                } else if (p) {
                  try {
                    total += Math.ceil(JSON.stringify(p).length / 4);
                  } catch (e) {
                    total += 50;
                  }
                }
              }
            }
          }
        }
      }
      return total;
    },

    /**
     * Ensures functionResponse parts conform strictly to Gemini Protobuf schema
     * (deletes any parts containing text or empty parts).
     */
    sanitizeFunctionResponses(history) {
      if (!Array.isArray(history)) return;
      for (const item of history) {
        if (!item || !Array.isArray(item.parts)) continue;
        for (const part of item.parts) {
          if (part && part.functionResponse && part.functionResponse.parts) {
            part.functionResponse.parts = part.functionResponse.parts.filter(p => p && p.inlineData);
            if (part.functionResponse.parts.length === 0) {
              delete part.functionResponse.parts;
            }
          }
        }
      }
    },

    /**
     * Compacts conversation history when it exceeds a token limit:
     * 1. Checks if estimated tokens exceed options.tokenLimit (if provided).
     * 2. Stage 1: Strips heavy base64 image data from older turns, preserving recent screenshot(s).
     * 3. Stage 2: Deduplicates / trims historical DOM tree dumps if still above token limit.
     * 4. Stage 3: Summarizes older intermediate tool steps when history exceeds maxRecentTurns.
     * @param {Array} history - Full conversation history array
     * @param {Object} options - { tokenLimit: 30000, force: false, maxRecentImages: 1, maxRecentTurns: 6 }
     * @returns {{ compacted: Array, prunedImages: number, prunedDomSnapshots: number, compactedTurns: number, tokensBefore: number, tokensAfter: number, skipped: boolean }}
     */
    compact(history, options = {}) {
      if (!Array.isArray(history) || history.length === 0) {
        return { compacted: history || [], prunedImages: 0, prunedDomSnapshots: 0, compactedTurns: 0, tokensBefore: 0, tokensAfter: 0, skipped: true };
      }

      const tokenLimit = (typeof options.tokenLimit === 'number' && options.tokenLimit > 0) ? options.tokenLimit : 0;
      const tokensBefore = this.estimateTokens(history);

      // If tokenLimit is set and history is within budget, skip compaction
      if (tokenLimit > 0 && tokensBefore <= tokenLimit && !options.force) {
        this.sanitizeFunctionResponses(history);
        return {
          compacted: history,
          prunedImages: 0,
          prunedDomSnapshots: 0,
          compactedTurns: 0,
          tokensBefore,
          tokensAfter: tokensBefore,
          skipped: true
        };
      }

      const maxRecentImages = options.maxRecentImages !== undefined ? options.maxRecentImages : 1;
      const maxRecentTurns = options.maxRecentTurns || 6;
      let prunedImages = 0;
      let prunedDomSnapshots = 0;
      let compactedTurns = 0;

      // Stage 1: Prune older screenshots (walk backwards from most recent)
      let imagesSeen = 0;
      for (let i = history.length - 1; i >= 0; i--) {
        const item = history[i];
        if (!item || !Array.isArray(item.parts)) continue;

        for (let j = item.parts.length - 1; j >= 0; j--) {
          const part = item.parts[j];
          if (!part) continue;

          // Case A: User attached screenshot in inlineData
          if (part.inlineData) {
            imagesSeen++;
            if (imagesSeen > maxRecentImages) {
              delete part.inlineData;
              part.text = '[Previous viewport screenshot analyzed: visual layout and styling previously inspected]';
              prunedImages++;
            }
          }

          // Case B: capture_screenshot tool response
          if (part.functionResponse && part.functionResponse.name === 'capture_screenshot') {
            const resp = part.functionResponse.response;
            const hasImage = (resp && resp.inlineData) || (part.functionResponse.parts && part.functionResponse.parts.some(p => p && p.inlineData));
            if (hasImage) {
              imagesSeen++;
              if (imagesSeen > maxRecentImages) {
                if (resp) {
                  delete resp.inlineData;
                  resp.status = 'pruned';
                  resp.message = '[Historical screenshot pruned to optimize context tokens]';
                }
                delete part.functionResponse.parts;
                prunedImages++;
              }
            }
          }
        }
      }

      // Check if Stage 1 brought tokens below tokenLimit
      if (tokenLimit > 0 && this.estimateTokens(history) <= tokenLimit && !options.force) {
        this.sanitizeFunctionResponses(history);
        const tokensAfter = this.estimateTokens(history);
        return {
          compacted: history,
          prunedImages,
          prunedDomSnapshots: 0,
          compactedTurns: 0,
          tokensBefore,
          tokensAfter,
          skipped: false
        };
      }

      // Stage 2: Deduplicate older DOM tree dumps (keep only the most recent one)
      let domSnapshotSeen = 0;
      for (let i = history.length - 1; i >= 0; i--) {
        const item = history[i];
        if (!item || !Array.isArray(item.parts)) continue;

        for (let j = item.parts.length - 1; j >= 0; j--) {
          const part = item.parts[j];
          if (!part) continue;

          // Case A: Initial DOM Context in user prompt
          if (part.text && part.text.includes('[Active Page DOM Context]')) {
            domSnapshotSeen++;
            if (domSnapshotSeen > 1) {
              part.text = part.text.replace(
                /\[Active Page DOM Context\][\s\S]*$/,
                '[Active Page DOM Context: Earlier DOM snapshot pruned; latest DOM state is in subsequent steps]'
              );
              prunedDomSnapshots++;
            }
          }

          // Case B: dehydrate_dom tool response
          if (part.functionResponse && part.functionResponse.name === 'dehydrate_dom') {
            domSnapshotSeen++;
            if (domSnapshotSeen > 1) {
              if (part.functionResponse.response && part.functionResponse.response.dom) {
                part.functionResponse.response.dom = '[Earlier DOM snapshot pruned; see latest DOM context]';
                prunedDomSnapshots++;
              }
            }
          }
        }
      }

      // Check if Stage 2 brought tokens below tokenLimit
      if (tokenLimit > 0 && this.estimateTokens(history) <= tokenLimit && !options.force) {
        this.sanitizeFunctionResponses(history);
        const tokensAfter = this.estimateTokens(history);
        return {
          compacted: history,
          prunedImages,
          prunedDomSnapshots,
          compactedTurns: 0,
          tokensBefore,
          tokensAfter,
          skipped: false
        };
      }

      // Stage 3: Sliding-window turn compaction
      // Keep initial user request (index 0) + most recent (maxRecentTurns * 2) entries
      const recentEntriesCount = maxRecentTurns * 2;
      if (history.length > recentEntriesCount + 2) {
        const intermediateCount = history.length - 1 - recentEntriesCount;
        if (intermediateCount > 2) {
          const summaryUser = {
            role: 'user',
            parts: [{
              text: `[Context Compaction Summary: The agent previously completed ${Math.floor(intermediateCount / 2)} intermediate DOM analysis and script iteration steps. Relevant element selectors and script refinements have been incorporated. Current goal continues below.]`
            }]
          };
          const summaryModel = {
            role: 'model',
            parts: [{
              text: 'Understood. I will continue from the latest state and current page context.'
            }]
          };
          history.splice(1, intermediateCount, summaryUser, summaryModel);
          compactedTurns = intermediateCount;
        }
      }

      this.sanitizeFunctionResponses(history);
      const tokensAfter = this.estimateTokens(history);

      return {
        compacted: history,
        prunedImages,
        prunedDomSnapshots,
        compactedTurns,
        tokensBefore,
        tokensAfter,
        skipped: false
      };
    }
  };

  async function saveTabSession(tabId) {
    const id = tabId || currentTabId;
    if (!id) return;
    await TabSessionManager.saveSession(id, {
      conversationHistory: conversationHistory || [],
      messageQueue: messageQueue || [],
      feedHtml: messagesFeed ? messagesFeed.innerHTML : '',
      url: activeTab?.url || '',
      domain: activeTabDomain ? activeTabDomain.textContent : '',
      timestamp: Date.now()
    });
  }

  async function loadTabSession(tabId) {
    if (!tabId) return;
    const session = await TabSessionManager.loadSession(tabId);
    if (session && session.feedHtml && session.conversationHistory) {
      conversationHistory = session.conversationHistory || [];
      messageQueue = session.messageQueue || [];
      if (messagesFeed) {
        messagesFeed.innerHTML = session.feedHtml;
        reattachFeedListeners();
        scrollToBottom();
      }
    } else {
      resetConversationFeed();
    }
  }

  async function appendToTabSession(tabId, htmlChunk, historyEntry = null) {
    if (!tabId) return;
    const storage = TabSessionManager.getStorage();
    if (!storage) return;
    const key = `tab_session_${tabId}`;
    try {
      const data = await storage.get(key);
      const session = (data && data[key]) || {
        conversationHistory: [],
        messageQueue: [],
        feedHtml: '',
        timestamp: Date.now()
      };
      if (htmlChunk) {
        session.feedHtml = (session.feedHtml || '') + htmlChunk;
      }
      if (historyEntry) {
        session.conversationHistory = session.conversationHistory || [];
        session.conversationHistory.push(historyEntry);
      }
      session.timestamp = Date.now();
      await storage.set({ [key]: session });
    } catch (err) {
      console.warn(`Failed to update background tab session ${tabId}:`, err);
    }
  }

  function resetConversationFeed() {
    conversationHistory = [];
    messageQueue = [];
    if (messagesFeed) {
      messagesFeed.innerHTML = `
        <div class="welcome-card" id="welcomeCard">
          <div class="welcome-icon">⚡</div>
          <h3>Page-Agent DOM Copilot</h3>
          <p>Chat with the AI agent to inspect the page DOM and generate custom userscripts that modify styles, hide ads, or add features.</p>
          <div class="suggestion-chips">
            <button class="chip" data-prompt="Hide all ads, banners, and sponsored sections on this page">🚫 Hide Ads & Banners</button>
            <button class="chip" data-prompt="Enable high-contrast dark mode for this page">🌙 Dark Mode Stylesheet</button>
            <button class="chip" data-prompt="Make the top navigation header floating sticky with a blur backdrop">📌 Sticky Nav Header</button>
            <button class="chip" data-prompt="Add a button at the top of the main table to export data as CSV">📊 Add Table CSV Export</button>
          </div>
        </div>
      `;
      reattachFeedListeners();
    }
  }

  function reattachFeedListeners() {
    if (!messagesFeed) return;

    // Suggestion chips
    messagesFeed.querySelectorAll('.chip').forEach((chip) => {
      chip.onclick = () => {
        promptInput.value = chip.getAttribute('data-prompt');
        handleSend();
      };
    });

    // Chat screenshot thumbnails
    messagesFeed.querySelectorAll('.chat-screenshot-thumb').forEach((img) => {
      img.onclick = () => {
        window.open(img.src, '_blank');
      };
    });

    // Tool step screenshot thumbnails
    messagesFeed.querySelectorAll('.tool-screenshot-thumb').forEach((img) => {
      img.onclick = () => {
        window.open(img.src, '_blank');
      };
    });

    // Settings button inside chat message bubble
    const settingsBtn = messagesFeed.querySelector('#openSettingsFromChatBtn');
    if (settingsBtn) {
      settingsBtn.onclick = () => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else {
          window.open('../options/options.html', '_blank');
        }
      };
    }

    // Script Cards
    messagesFeed.querySelectorAll('.script-card').forEach((card) => {
      const scriptCode = card.dataset.script || (card.querySelector('pre code')?.textContent || '');
      const scriptName = card.dataset.name || (card.querySelector('.script-card-title')?.textContent || 'Userscript');
      const cardId = card.dataset.id || card.id.replace(/^card_/, '');

      const runBtn = card.querySelector(`[id^="runBtn_"]`);
      const saveBtn = card.querySelector(`[id^="saveBtn_"]`);
      const copyBtn = card.querySelector(`[id^="copyBtn_"]`);
      const undoBtn = card.querySelector(`[id^="undoBtn_"]`);
      const badge = card.querySelector(`[id^="badge_"]`);

      if (runBtn) {
        runBtn.onclick = async () => {
          runBtn.disabled = true;
          runBtn.textContent = 'Running...';
          const targetId = activeTab?.id || currentTabId;
          const res = await ScriptManager.executeInTab(targetId, scriptCode, scriptName);
          runBtn.disabled = false;
          runBtn.textContent = '▶ Re-run';
          if (res && res.success) {
            if (badge) {
              badge.className = 'status-badge executed';
              badge.textContent = '⚡ Executed in page';
            }
          } else {
            if (badge) {
              badge.className = 'status-badge pending';
              badge.textContent = `⚠️ Error: ${res ? res.error : 'Execution failed'}`;
            }
          }
          if (currentTabId) saveTabSession(currentTabId);
        };
      }

      if (saveBtn) {
        saveBtn.onclick = () => {
          let defaultPattern = '<all_urls>';
          if (activeTab && activeTab.url) {
            try {
              const urlObj = new URL(activeTab.url);
              defaultPattern = `*://*.${urlObj.hostname.replace(/^www\./, '')}/*`;
            } catch (e) {}
          }
          openScriptModal({
            name: scriptName || 'AI Generated Script',
            matchPatterns: [defaultPattern],
            code: scriptCode || '',
            enabled: true
          });
        };
      }

      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(scriptCode);
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => (copyBtn.textContent = '📋 Copy'), 2000);
        };
      }

      if (undoBtn) {
        undoBtn.onclick = async () => {
          const targetId = activeTab?.id || currentTabId;
          if (targetId) {
            await chrome.tabs.reload(targetId);
            appendToolStep('Reloaded active tab to revert DOM modifications.');
          }
        };
      }
    });
  }

  // -------------------------------------------------------------
  // Initialization & Tab Handling
  // -------------------------------------------------------------

  async function init() {
    autoRun = autoRunToggle.checked;

    // Attach all event listeners first so UI is immediately interactive
    autoRunToggle.addEventListener('change', (e) => {
      autoRun = e.target.checked;
    });

    optionsBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open('../options/options.html', '_blank');
      }
    });

    refreshTabBtn.addEventListener('click', async () => {
      await updateActiveTab();
      await loadSavedScriptsList();
    });

    tabChat.addEventListener('click', () => switchView('chat'));
    tabScripts.addEventListener('click', () => switchView('scripts'));

    sendBtn.addEventListener('click', handleSend);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Chips
    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        promptInput.value = chip.getAttribute('data-prompt');
        handleSend();
      });
    });

    pickElementBtn.addEventListener('click', toggleElementPicker);
    captureScreenshotBtn?.addEventListener('click', handleCaptureScreenshot);
    removeScreenshotBtn?.addEventListener('click', handleRemoveScreenshot);
    dehydrateDomBtn.addEventListener('click', handleManualDomScan);
    clearChatBtn.addEventListener('click', clearConversation);

    // Scripts View Listeners
    scriptsSearch.addEventListener('input', filterScriptsList);
    newScriptBtn.addEventListener('click', () => openScriptModal());
    exportScriptsBtn.addEventListener('click', handleExportScripts);
    importScriptsBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', handleImportFile);

    closeModalBtn.addEventListener('click', closeScriptModal);
    cancelModalBtn.addEventListener('click', closeScriptModal);
    modalBackdrop.addEventListener('click', closeScriptModal);
    saveModalBtn.addEventListener('click', handleSaveModal);

    modalScriptCode.addEventListener('input', updateEditorMetadataPreview);
    modalScriptCode.addEventListener('keydown', (e) => {
      // Tab key indentation (2 spaces)
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = modalScriptCode.selectionStart;
        const end = modalScriptCode.selectionEnd;
        const val = modalScriptCode.value;
        modalScriptCode.value = val.substring(0, start) + '  ' + val.substring(end);
        modalScriptCode.selectionStart = modalScriptCode.selectionEnd = start + 2;
        updateEditorMetadataPreview();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        // Cmd+S / Ctrl+S to save directly from editor
        e.preventDefault();
        handleSaveModal();
      }
    });

    // Listen to tab changes in browser
    if (chrome.tabs && chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(async (activeInfo) => {
        await handleTabSwitch(activeInfo.tabId);
      });
    }
    if (chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
        if (tabId === currentTabId && (changeInfo.status === 'complete' || changeInfo.url)) {
          await updateActiveTabInfo();
          await loadSavedScriptsList();
        }
      });
    }

    // Quick Model dropdown sync
    const currentConfig = await getConfig();
    setQuickModelUI(currentConfig.geminiModel || 'gemini-flash-latest');

    if (quickModelSelect) {
      quickModelSelect.addEventListener('change', async (e) => {
        const selectedModel = e.target.value;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ geminiModel: selectedModel });
        } else {
          localStorage.setItem('geminiModel', selectedModel);
        }
        appendToolStep(`Switched active model to: ${selectedModel}`);
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.geminiModel && changes.geminiModel.newValue) {
          setQuickModelUI(changes.geminiModel.newValue);
        }
      });
    }

    // Parse query params for ?tabId=
    let queryTabId = null;
    try {
      if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('tabId')) {
          queryTabId = parseInt(urlParams.get('tabId'), 10);
        }
      }
    } catch (e) {}

    if (queryTabId) {
      currentTabId = queryTabId;
      try {
        if (chrome.tabs && chrome.tabs.get) {
          activeTab = await chrome.tabs.get(queryTabId);
          updateTabDomainUI(activeTab);
        } else {
          await updateActiveTabInfo();
        }
      } catch (e) {
        await updateActiveTabInfo();
      }
    } else {
      await updateActiveTabInfo();
      if (activeTab && activeTab.id) {
        currentTabId = activeTab.id;
      }
    }

    if (currentTabId) {
      await loadTabSession(currentTabId);
    } else {
      resetConversationFeed();
    }
    await loadSavedScriptsList();
  }

  function switchView(view) {
    if (view === 'chat') {
      tabChat.classList.add('active');
      tabScripts.classList.remove('active');
      chatView.classList.add('active');
      scriptsView.classList.remove('active');
    } else {
      tabScripts.classList.add('active');
      tabChat.classList.remove('active');
      scriptsView.classList.add('active');
      chatView.classList.remove('active');
      loadSavedScriptsList();
    }
  }

  function updateTabDomainUI(tab) {
    if (!activeTabDomain) return;
    if (tab && tab.url) {
      try {
        const urlObj = new URL(tab.url);
        activeTabDomain.textContent = urlObj.hostname || tab.url;
      } catch (e) {
        activeTabDomain.textContent = tab.url;
      }
    } else if (tab) {
      activeTabDomain.textContent = tab.title || 'Active Tab';
    } else {
      activeTabDomain.textContent = 'No active tab';
    }
  }

  async function handleTabSwitch(newTabId) {
    if (!newTabId || newTabId === currentTabId) return;

    // Save outgoing tab session
    if (currentTabId) {
      await saveTabSession(currentTabId);
    }

    currentTabId = newTabId;

    // Update activeTab reference
    try {
      if (chrome.tabs && chrome.tabs.get) {
        activeTab = await chrome.tabs.get(newTabId);
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTab = tab;
      }
      updateTabDomainUI(activeTab);
    } catch (err) {
      console.warn('Failed to get tab info during switch:', err);
    }

    // Load incoming tab session
    await loadTabSession(currentTabId);
    await loadSavedScriptsList();
  }

  async function updateActiveTab() {
    await updateActiveTabInfo();
    if (activeTab && activeTab.id && activeTab.id !== currentTabId) {
      await handleTabSwitch(activeTab.id);
    }
  }

  async function updateActiveTabInfo() {
    try {
      // In Side Panel, query active tab in last focused window first, then fallback
      let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      }
      if (!tab) {
        const tabs = await chrome.tabs.query({ active: true });
        tab = tabs && tabs.length > 0 ? tabs[0] : null;
      }

      activeTab = tab;
      updateTabDomainUI(activeTab);
      if (tab && tab.id && !currentTabId) {
        currentTabId = tab.id;
      }
    } catch (err) {
      console.warn('Failed to get active tab:', err);
      if (activeTabDomain) activeTabDomain.textContent = 'Active Tab';
    }
  }

  // -------------------------------------------------------------
  // Element Picker Tool
  // -------------------------------------------------------------

  async function toggleElementPicker() {
    if (!activeTab || !activeTab.id) {
      alert('No active tab to inspect.');
      return;
    }

    if (isPickingElement) {
      // Cancel picking
      isPickingElement = false;
      pickElementBtn.classList.remove('active');
      pickElementBtn.textContent = '🎯 Pick Element';
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          if (window.__agentPickerCleanup) window.__agentPickerCleanup();
        }
      });
      return;
    }

    isPickingElement = true;
    pickElementBtn.classList.add('active');
    pickElementBtn.textContent = 'Click an element in page...';

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.id = '__agent_picker_highlight';
            overlay.style.position = 'fixed';
            overlay.style.pointerEvents = 'none';
            overlay.style.border = '2px solid #6366f1';
            overlay.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
            overlay.style.zIndex = '2147483647';
            overlay.style.display = 'none';
            overlay.style.transition = 'all 0.05s ease';
            document.body.appendChild(overlay);

            const badge = document.createElement('div');
            badge.style.position = 'absolute';
            badge.style.top = '-22px';
            badge.style.left = '0';
            badge.style.backgroundColor = '#6366f1';
            badge.style.color = '#fff';
            badge.style.fontSize = '11px';
            badge.style.fontWeight = 'bold';
            badge.style.padding = '2px 6px';
            badge.style.borderRadius = '3px';
            badge.style.whiteSpace = 'nowrap';
            overlay.appendChild(badge);

            function onMouseMove(e) {
              const el = document.elementFromPoint(e.clientX, e.clientY);
              if (!el || el === overlay || el.id === '__agent_picker_highlight') return;
              const rect = el.getBoundingClientRect();
              overlay.style.display = 'block';
              overlay.style.top = rect.top + 'px';
              overlay.style.left = rect.left + 'px';
              overlay.style.width = rect.width + 'px';
              overlay.style.height = rect.height + 'px';
              badge.textContent = `<${el.tagName.toLowerCase()}> ${el.id ? '#' + el.id : (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')}`;
            }

            function cleanup() {
              window.removeEventListener('mousemove', onMouseMove, true);
              window.removeEventListener('click', onClick, true);
              if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
              delete window.__agentPickerCleanup;
            }

            function onClick(e) {
              e.preventDefault();
              e.stopPropagation();
              const el = document.elementFromPoint(e.clientX, e.clientY);
              cleanup();

              if (!el) {
                resolve(null);
                return;
              }

              let selector = el.tagName.toLowerCase();
              if (el.id) {
                selector = '#' + CSS.escape(el.id);
              } else if (el.className && typeof el.className === 'string') {
                selector += '.' + CSS.escape(el.className.trim().split(/\\s+/)[0]);
              }

              resolve({
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                classes: el.className || '',
                selector: selector,
                text: el.innerText ? el.innerText.trim().slice(0, 150) : '',
                outerHtml: el.outerHTML ? el.outerHTML.slice(0, 300) : ''
              });
            }

            window.addEventListener('mousemove', onMouseMove, true);
            window.addEventListener('click', onClick, true);
            window.__agentPickerCleanup = cleanup;
          });
        }
      });

      const picked = results?.[0]?.result;
      if (picked) {
        promptInput.value += ` [Selected Element: <${picked.tag}> ${picked.selector} (Text: "${picked.text}")] `;
        promptInput.focus();
      }
    } catch (err) {
      console.warn('Element picker failed:', err);
    } finally {
      isPickingElement = false;
      pickElementBtn.classList.remove('active');
      pickElementBtn.textContent = '🎯 Pick Element';
    }
  }

  // -------------------------------------------------------------
  // DOM Scanning & Dehydration
  // -------------------------------------------------------------

  async function scanActivePageDom(tabId = null) {
    const targetId = tabId || activeTab?.id;
    if (!targetId) return null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetId },
        func: DomDehydrator.scanPage
      });
      return results?.[0]?.result || null;
    } catch (err) {
      console.warn('Failed to dehydrate active page DOM:', err);
      return null;
    }
  }

  async function handleManualDomScan() {
    dehydrateDomBtn.disabled = true;
    dehydrateDomBtn.textContent = 'Scanning...';

    const domData = await scanActivePageDom();
    dehydrateDomBtn.disabled = false;
    dehydrateDomBtn.textContent = '🔍 Scan DOM';

    if (domData) {
      appendToolStep(`Scanned DOM: Found ${domData.elementCount} key interactive elements on "${domData.title}".`);
    } else {
      appendToolStep('Failed to scan DOM. Make sure the page is fully loaded.');
    }
  }

  // -------------------------------------------------------------
  // Screenshot Helpers
  // -------------------------------------------------------------

  async function captureTabScreenshot() {
    try {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.captureVisibleTab) {
        throw new Error('Screenshot API is only available inside Chrome extension.');
      }
      if (!activeTab || !activeTab.id) {
        await updateActiveTab();
      }
      const windowId = activeTab?.windowId || null;
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 75 });
      return { success: true, dataUrl };
    } catch (err) {
      console.warn('captureVisibleTab error:', err);
      return { success: false, error: err.message };
    }
  }

  async function handleCaptureScreenshot() {
    if (!captureScreenshotBtn) return;
    captureScreenshotBtn.disabled = true;
    const origText = captureScreenshotBtn.textContent;
    captureScreenshotBtn.textContent = '📸 Capturing...';
    try {
      const res = await captureTabScreenshot();
      if (res.success && res.dataUrl) {
        pendingScreenshotDataUrl = res.dataUrl;
        if (screenshotPreviewImg) screenshotPreviewImg.src = res.dataUrl;
        if (screenshotPreviewContainer) screenshotPreviewContainer.classList.remove('hidden');
        appendToolStep('📸 Captured visible tab screenshot (ready to send with your message)');
      } else {
        appendToolStep(`⚠️ Screenshot capture failed: ${res.error || 'Unknown error'}`);
      }
    } finally {
      captureScreenshotBtn.disabled = false;
      captureScreenshotBtn.textContent = origText;
    }
  }

  function handleRemoveScreenshot() {
    pendingScreenshotDataUrl = null;
    if (screenshotPreviewImg) screenshotPreviewImg.src = '';
    if (screenshotPreviewContainer) screenshotPreviewContainer.classList.add('hidden');
  }

  // -------------------------------------------------------------
  // Chat Messages & Gemini Tool Loop
  // -------------------------------------------------------------

  function appendUserMessage(text, screenshotDataUrl = null, targetTabId = null) {
    const targetId = targetTabId || currentTabId;
    const welcomeCard = document.getElementById('welcomeCard');
    if (welcomeCard) welcomeCard.style.display = 'none';

    if (!targetId || targetId === currentTabId) {
      const row = document.createElement('div');
      row.className = 'message-row user';
      let inner = `<div class="bubble"><div class="bubble-text">${escapeHtml(text)}</div>`;
      if (screenshotDataUrl) {
        inner += `
          <div class="chat-screenshot-wrap">
            <img src="${screenshotDataUrl}" class="chat-screenshot-thumb" alt="Attached screenshot" title="Click to view full image" />
          </div>`;
      }
      inner += `</div>`;
      row.innerHTML = inner;
      messagesFeed.appendChild(row);
      scrollToBottom();

      if (screenshotDataUrl) {
        const img = row.querySelector('.chat-screenshot-thumb');
        if (img) {
          img.addEventListener('click', () => {
            window.open(screenshotDataUrl, '_blank');
          });
        }
      }
      if (currentTabId) saveTabSession(currentTabId);
    } else {
      let chunk = `<div class="message-row user"><div class="bubble"><div class="bubble-text">${escapeHtml(text)}</div>`;
      if (screenshotDataUrl) {
        chunk += `<div class="chat-screenshot-wrap"><img src="${screenshotDataUrl}" class="chat-screenshot-thumb" alt="Attached screenshot" /></div>`;
      }
      chunk += `</div></div>`;
      appendToTabSession(targetId, chunk);
    }
  }

  function appendAssistantMessage(text, targetTabId = null) {
    const targetId = targetTabId || currentTabId;
    const formatted = formatMarkdown(text);
    if (!targetId || targetId === currentTabId) {
      const row = document.createElement('div');
      row.className = 'message-row assistant';
      row.innerHTML = `<div class="bubble">${formatted}</div>`;
      messagesFeed.appendChild(row);
      scrollToBottom();
      if (currentTabId) saveTabSession(currentTabId);
    } else {
      const chunk = `<div class="message-row assistant"><div class="bubble">${formatted}</div></div>`;
      appendToTabSession(targetId, chunk);
    }
  }

  function appendToolStep(text, targetTabId = null) {
    const targetId = targetTabId || currentTabId;
    if (!targetId || targetId === currentTabId) {
      const chip = document.createElement('div');
      chip.className = 'tool-step-chip';
      chip.innerHTML = `<span>⚙️</span> <span>${escapeHtml(text)}</span>`;
      messagesFeed.appendChild(chip);
      scrollToBottom();
      if (currentTabId) saveTabSession(currentTabId);
    } else {
      const chunk = `<div class="tool-step-chip"><span>⚙️</span> <span>${escapeHtml(text)}</span></div>`;
      appendToTabSession(targetId, chunk);
    }
  }

  function appendScreenshotToolStep(reason, dataUrl, targetTabId = null) {
    const targetId = targetTabId || currentTabId;
    const innerHtml = `
      <div style="display:flex;align-items:center;gap:5px;">
        <span>📸</span>
        <span><strong>Captured page screenshot</strong>${reason ? ': ' + escapeHtml(reason) : ''}</span>
      </div>
      <img src="${dataUrl}" class="tool-screenshot-thumb" alt="Captured page screenshot" title="Click to view full image" />
    `;
    if (!targetId || targetId === currentTabId) {
      const chip = document.createElement('div');
      chip.className = 'tool-step-chip tool-step-screenshot';
      chip.innerHTML = innerHtml;
      messagesFeed.appendChild(chip);
      scrollToBottom();

      const img = chip.querySelector('.tool-screenshot-thumb');
      if (img) {
        img.addEventListener('click', () => {
          window.open(dataUrl, '_blank');
        });
      }
      if (currentTabId) saveTabSession(currentTabId);
    } else {
      const chunk = `<div class="tool-step-chip tool-step-screenshot">${innerHtml}</div>`;
      appendToTabSession(targetId, chunk);
    }
  }

  function appendScriptCard(scriptData, alreadyExecuted = false, targetTabId = null) {
    const targetId = targetTabId || currentTabId;
    const cardId = scriptData.id || `script_${Date.now()}`;

    if (!targetId || targetId === currentTabId) {
      const existing = document.getElementById(`card_${cardId}`);
      if (existing) {
        // Already displayed; update status badge if needed
        const badge = existing.querySelector(`#badge_${cardId}`);
        if (badge && alreadyExecuted) {
          badge.className = 'status-badge executed';
          badge.textContent = '⚡ Executed in page';
        }
        return;
      }

      const card = document.createElement('div');
      card.className = 'script-card';
      card.id = `card_${cardId}`;
      card.dataset.id = cardId;
      card.dataset.name = scriptData.name || 'Userscript';
      card.dataset.script = scriptData.script || '';
      card.dataset.description = scriptData.description || '';

      const statusBadgeClass = alreadyExecuted ? 'executed' : 'pending';
      const statusText = alreadyExecuted ? '⚡ Executed in page' : '⏸️ Ready to run';

      card.innerHTML = `
        <div class="script-card-header">
          <span class="script-card-title">${escapeHtml(scriptData.name || 'Userscript')}</span>
          <span class="status-badge ${statusBadgeClass}" id="badge_${cardId}">${statusText}</span>
        </div>
        <div class="script-desc">${escapeHtml(scriptData.description || 'Custom DOM userscript')}</div>
        <div class="code-container">
          <pre><code>${escapeHtml(scriptData.script || '')}</code></pre>
        </div>
        <div class="script-actions">
          <button class="action-btn primary" id="runBtn_${cardId}">▶ Run in Page</button>
          <button class="action-btn" id="saveBtn_${cardId}">💾 Save as Userscript</button>
          <button class="action-btn" id="copyBtn_${cardId}">📋 Copy</button>
          <button class="action-btn" id="undoBtn_${cardId}">↺ Reload (Undo)</button>
        </div>
      `;

      messagesFeed.appendChild(card);
      scrollToBottom();

      // Attach Action Listeners
      const runBtn = card.querySelector(`#runBtn_${cardId}`);
      const saveBtn = card.querySelector(`#saveBtn_${cardId}`);
      const copyBtn = card.querySelector(`#copyBtn_${cardId}`);
      const undoBtn = card.querySelector(`#undoBtn_${cardId}`);
      const badge = card.querySelector(`#badge_${cardId}`);

      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        runBtn.textContent = 'Running...';
        const execTargetId = activeTab?.id || currentTabId;
        const res = await ScriptManager.executeInTab(execTargetId, scriptData.script, scriptData.name);
        runBtn.disabled = false;
        runBtn.textContent = '▶ Re-run';
        if (res && res.success) {
          badge.className = 'status-badge executed';
          badge.textContent = '⚡ Executed in page';
        } else {
          badge.className = 'status-badge pending';
          badge.textContent = `⚠️ Error: ${res ? res.error : 'Execution failed'}`;
        }
        if (currentTabId) saveTabSession(currentTabId);
      });

      saveBtn.addEventListener('click', () => {
        let defaultPattern = '<all_urls>';
        if (activeTab && activeTab.url) {
          try {
            const urlObj = new URL(activeTab.url);
            defaultPattern = `*://*.${urlObj.hostname.replace(/^www\./, '')}/*`;
          } catch (e) {}
        }

        openScriptModal({
          name: scriptData.name || 'AI Generated Script',
          matchPatterns: [defaultPattern],
          code: scriptData.script || '',
          enabled: true
        });
      });

      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(scriptData.script);
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => (copyBtn.textContent = '📋 Copy'), 2000);
      });

      undoBtn.addEventListener('click', async () => {
        const undoTargetId = activeTab?.id || currentTabId;
        if (undoTargetId) {
          await chrome.tabs.reload(undoTargetId);
          appendToolStep('Reloaded active tab to revert DOM modifications.');
        }
      });

      if (currentTabId) saveTabSession(currentTabId);
    } else {
      const statusBadgeClass = alreadyExecuted ? 'executed' : 'pending';
      const statusText = alreadyExecuted ? '⚡ Executed in page' : '⏸️ Ready to run';
      const cardHtml = `
        <div class="script-card" id="card_${cardId}" data-id="${escapeHtml(cardId)}" data-name="${escapeHtml(scriptData.name || '')}" data-script="${escapeHtml(scriptData.script || '')}" data-description="${escapeHtml(scriptData.description || '')}">
          <div class="script-card-header">
            <span class="script-card-title">${escapeHtml(scriptData.name || 'Userscript')}</span>
            <span class="status-badge ${statusBadgeClass}" id="badge_${cardId}">${statusText}</span>
          </div>
          <div class="script-desc">${escapeHtml(scriptData.description || 'Custom DOM userscript')}</div>
          <div class="code-container">
            <pre><code>${escapeHtml(scriptData.script || '')}</code></pre>
          </div>
          <div class="script-actions">
            <button class="action-btn primary" id="runBtn_${cardId}">▶ Run in Page</button>
            <button class="action-btn" id="saveBtn_${cardId}">💾 Save as Userscript</button>
            <button class="action-btn" id="copyBtn_${cardId}">📋 Copy</button>
            <button class="action-btn" id="undoBtn_${cardId}">↺ Reload (Undo)</button>
          </div>
        </div>
      `;
      appendToTabSession(targetId, cardHtml);
    }
  }

  async function getConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const data = await chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'customInstructions', 'maxTurns', 'autoScreenshot', 'autoCompact', 'maxRecentImages', 'compactThreshold']);
        return {
          geminiApiKey: data.geminiApiKey || '',
          geminiModel: data.geminiModel || 'gemini-flash-latest',
          customInstructions: data.customInstructions || '',
          maxTurns: data.maxTurns || 15,
          autoScreenshot: data.autoScreenshot !== undefined ? data.autoScreenshot : true,
          autoCompact: data.autoCompact !== undefined ? data.autoCompact : true,
          maxRecentImages: data.maxRecentImages || 1,
          compactThreshold: data.compactThreshold !== undefined ? parseInt(data.compactThreshold, 10) : 30000
        };
      } catch (e) {
        console.warn('chrome.storage error:', e);
      }
    }
    try {
      return {
        geminiApiKey: localStorage.getItem('geminiApiKey') || '',
        geminiModel: localStorage.getItem('geminiModel') || 'gemini-flash-latest',
        customInstructions: localStorage.getItem('customInstructions') || '',
        maxTurns: parseInt(localStorage.getItem('maxTurns'), 10) || 15,
        autoScreenshot: localStorage.getItem('autoScreenshot') !== 'false',
        autoCompact: localStorage.getItem('autoCompact') !== 'false',
        maxRecentImages: parseInt(localStorage.getItem('maxRecentImages'), 10) || 1,
        compactThreshold: parseInt(localStorage.getItem('compactThreshold'), 10) || 30000
      };
    } catch (e) {
      return { geminiApiKey: '', geminiModel: 'gemini-flash-latest', customInstructions: '', maxTurns: 15, autoScreenshot: true, autoCompact: true, maxRecentImages: 1, compactThreshold: 30000 };
    }
  }

  async function handleSend() {
    const text = promptInput.value.trim();
    if (!text && !pendingScreenshotDataUrl) return;

    const screenshotToSend = pendingScreenshotDataUrl;
    handleRemoveScreenshot();

    const displayPrompt = text || 'Please inspect the attached screenshot of this page and suggest userscript improvements.';

    // If agent is currently processing, queue the message so user can keep typing!
    if (isProcessing) {
      messageQueue.push({ text: displayPrompt, screenshot: screenshotToSend });
      appendUserMessage(displayPrompt, screenshotToSend);
      appendToolStep(`⏳ Follow-up queued: "${displayPrompt.length > 45 ? displayPrompt.slice(0, 45) + '…' : displayPrompt}" (will run automatically when current step finishes)`);
      promptInput.value = '';
      promptInput.style.height = 'auto';
      return;
    }

    appendUserMessage(displayPrompt, screenshotToSend);
    promptInput.value = '';
    promptInput.style.height = 'auto';

    await executePrompt(displayPrompt, screenshotToSend);
  }

  async function executePrompt(text, screenshot = null) {
    if (!activeTab || !activeTab.id) {
      await updateActiveTab();
    }

    // Check API configuration
    const config = await getConfig();
    if (!config || !config.geminiApiKey) {
      appendAssistantMessage('⚠️ **Gemini API Key missing!** Please configure your API key in Settings to chat with the agent.<br/><button class="action-btn primary" id="openSettingsFromChatBtn" style="margin-top: 8px;">⚙️ Open Settings</button>');
      const btn = document.getElementById('openSettingsFromChatBtn');
      if (btn) {
        btn.addEventListener('click', () => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
          } else {
            window.open('../options/options.html', '_blank');
          }
        });
      }
      return;
    }

    isProcessing = true;
    promptInput.placeholder = 'Type follow-up to queue (press Enter)...';
    sendBtn.title = 'Queue message';

    try {
      await runAgentLoop(text, config, screenshot);
    } catch (err) {
      console.error('Agent loop failed:', err);
      appendAssistantMessage(`❌ **Error**: ${err.message}`);
    } finally {
      isProcessing = false;
      promptInput.placeholder = 'Ask the agent to modify styles, hide ads, or add features...';
      sendBtn.title = 'Send message';

      // Process any follow-up messages queued while running
      if (messageQueue.length > 0) {
        const nextItem = messageQueue.shift();
        const nextText = typeof nextItem === 'string' ? nextItem : nextItem.text;
        const nextShot = typeof nextItem === 'object' ? nextItem.screenshot : null;
        appendToolStep(`Processing queued follow-up: "${nextText.length > 45 ? nextText.slice(0, 45) + '…' : nextText}"`);
        await executePrompt(nextText, nextShot);
      }
    }
  }

  /**
   * Main ReAct / Tool-Calling Agent Loop
   */
  async function runAgentLoop(userPrompt, config, userScreenshot = null) {
    const apiKey = config.geminiApiKey;
    const model = config.geminiModel || 'gemini-flash-latest';
    const customInstructions = config.customInstructions || '';
    const requestTabId = activeTab?.id;
    const requestTabUrl = activeTab?.url || '';

    // First, scan the DOM if this is the start of a conversation
    let domContext = '';
    if (conversationHistory.length === 0) {
      appendToolStep('Dehydrating page DOM tree (Page-Agent architecture)...');
      const domData = await scanActivePageDom(requestTabId);
      if (domData) {
        domContext = DomDehydrator.formatForPrompt(domData);
      }

      // Automatically include any saved userscripts matching the current page
      try {
        const allScripts = await ScriptManager.getAllScripts();
        const matchingScripts = allScripts.filter(
          (s) => s.enabled && ScriptManager.matchesUrl(requestTabUrl, s.matchPatterns)
        );
        if (matchingScripts.length > 0) {
          domContext += `\n\n[Active Saved Userscripts on this page]:\n` +
            matchingScripts
              .map((s) => `- "${s.name}" (ID: ${s.id}, Match: ${s.matchPatterns.join(', ')}):\n\`\`\`javascript\n${s.code}\n\`\`\``)
              .join('\n\n');
        }
      } catch (e) {
        console.warn('Failed to load matching scripts for prompt:', e);
      }
    }

    let fullUserPrompt = userPrompt;
    if (domContext) {
      fullUserPrompt = `${userPrompt}\n\n[Active Page DOM Context]\n${domContext}`;
    }

    const userParts = [{ text: fullUserPrompt }];
    if (userScreenshot) {
      const base64Data = userScreenshot.replace(/^data:image\/[a-z]+;base64,/, '');
      userParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Data
        }
      });
    }

    conversationHistory.push({
      role: 'user',
      parts: userParts
    });

    const systemInstruction = {
      parts: [
        {
          text: `You are Userscript AI Agent, an expert in-page browser automation and DOM manipulation assistant based on the Alibaba Page-Agent architecture.
Your goal is to inspect the active web page and write robust, clean JavaScript userscripts that execute in the page context.

Capabilities & Tools:
1. inspect_dom: Execute JavaScript queries in the active page to inspect element properties, selectors, text, or DOM hierarchy.
2. apply_userscript: Generate a complete userscript to execute in the page to perform the requested DOM changes (e.g., hiding ads, altering styles, adding buttons, extracting data).
3. dehydrate_dom: Re-scan the active page DOM and return a fresh FlatDomTree summary.
4. capture_screenshot: Capture a visual screenshot of the visible active web page to inspect layout, styling, colors, alignment, or ads.
5. get_saved_scripts: List all saved userscripts stored in the extension database.
6. read_saved_script: Read the full source code and metadata of a specific saved userscript by name or ID.
7. save_userscript: Save or update a userscript into the persistent database so it auto-runs on matching pages. ONLY call save_userscript when the user explicitly asks to save, store, or update the script (e.g. "save this script", "save it as...", "update my saved script"). Do NOT automatically call save_userscript without user's explicit request.

Autonomous Visual Inspection Instructions:
- You have visual perception via the \`capture_screenshot\` tool and automatic visual context. The user relies on you to take screenshots autonomously.
- Call \`capture_screenshot\` proactively whenever:
  a) You need to visually inspect layout, broken styles, alignment, unreadable fonts, ads, or floating overlays.
  b) The user asks about visual appearance ("how does it look", "is it fixed", "check layout", "can you see").
  c) After applying a userscript to verify that visual styling was fixed.
- NEVER ask the user to provide, attach, or upload a screenshot—invoke \`capture_screenshot\` yourself.

Rules for writing userscripts:
- Write clean, modern, idempotent JavaScript.
- Avoid using innerHTML where TrustedTypes might be enforced (e.g. Google, YouTube); prefer document.createElement, textContent, and appendChild.
- When applying styles, inject a <style id="custom-agent-styles"> tag.
- When removing elements, check if they exist first.
- Always provide a concise name, description, and the full self-contained JavaScript code.

${customInstructions ? 'User Custom Instructions: ' + customInstructions : ''}`
        }
      ]
    };

    const tools = [
      {
        function_declarations: [
          {
            name: 'inspect_dom',
            description: 'Execute a read-only JavaScript query snippet in the active page to inspect element counts, IDs, classes, or attributes.',
            parameters: {
              type: 'OBJECT',
              properties: {
                script: {
                  type: 'STRING',
                  description: 'JavaScript code to execute in the page that returns a value (e.g. document.querySelector(".header").innerText)'
                },
                reason: {
                  type: 'STRING',
                  description: 'Brief reason why this query is needed'
                }
              },
              required: ['script']
            }
          },
          {
            name: 'apply_userscript',
            description: 'Apply and execute the completed userscript in the active page to modify the DOM.',
            parameters: {
              type: 'OBJECT',
              properties: {
                name: {
                  type: 'STRING',
                  description: 'Short descriptive title for the userscript'
                },
                description: {
                  type: 'STRING',
                  description: 'Clear description of what this userscript accomplishes'
                },
                script: {
                  type: 'STRING',
                  description: 'Complete, executable JavaScript code to modify the DOM'
                }
              },
              required: ['name', 'description', 'script']
            }
          },
          {
            name: 'dehydrate_dom',
            description: 'Re-scan the current page and return a refreshed FlatDomTree summary of interactive elements.',
            parameters: {
              type: 'OBJECT',
              properties: {}
            }
          },
          {
            name: 'capture_screenshot',
            description: 'Capture a visual screenshot of the current page viewport to visually diagnose layout defects, broken styling, overlapping banners, ads, or readability issues. Call this autonomously whenever visual perception is needed.',
            parameters: {
              type: 'OBJECT',
              properties: {
                reason: {
                  type: 'STRING',
                  description: 'Brief reason why a visual screenshot of the page is needed'
                }
              }
            }
          },
          {
            name: 'get_saved_scripts',
            description: 'List all saved userscripts stored in the extension, including names, IDs, enabled status, and match patterns.',
            parameters: {
              type: 'OBJECT',
              properties: {}
            }
          },
          {
            name: 'read_saved_script',
            description: 'Read the full source code and metadata of a specific saved userscript by its name or ID.',
            parameters: {
              type: 'OBJECT',
              properties: {
                nameOrId: {
                  type: 'STRING',
                  description: 'Name or ID of the userscript to inspect'
                }
              },
              required: ['nameOrId']
            }
          },
          {
            name: 'save_userscript',
            description: 'Save or update a userscript into the persistent database so it auto-runs on matching pages. ONLY call this tool if the user explicitly asked to save, store, or update the script.',
            parameters: {
              type: 'OBJECT',
              properties: {
                name: {
                  type: 'STRING',
                  description: 'Name for the userscript'
                },
                script: {
                  type: 'STRING',
                  description: 'Complete JavaScript code of the userscript (with or without // ==UserScript== header)'
                },
                matchPatterns: {
                  type: 'ARRAY',
                  items: { type: 'STRING' },
                  description: 'Optional array of URL match patterns (e.g. ["*://*.archive.ph/*"]). If omitted, defaults to current website pattern.'
                },
                description: {
                  type: 'STRING',
                  description: 'Optional short description of the script'
                },
                id: {
                  type: 'STRING',
                  description: 'Optional ID of existing userscript if updating/overwriting'
                },
                enabled: {
                  type: 'BOOLEAN',
                  description: 'Whether script should be enabled to auto-run on matching pages (default: true)'
                }
              },
              required: ['name', 'script']
            }
          }
        ]
      }
    ];

    const maxTurns = parseInt(config.maxTurns, 10) || 15;
    let turn = 0;
    let latestScriptToCard = null;
    let latestScriptAlreadyRan = false;

    while (turn < maxTurns) {
      turn++;

      // Auto-Compact context if enabled and token limit exceeded
      if (config.autoCompact !== false) {
        const tokenLimit = parseInt(config.compactThreshold, 10) || 30000;
        const compactRes = ContextCompactor.compact(conversationHistory, {
          tokenLimit: tokenLimit,
          maxRecentImages: config.maxRecentImages || 1,
          maxRecentTurns: 6
        });
        if (!compactRes.skipped && (compactRes.prunedImages > 0 || compactRes.prunedDomSnapshots > 0 || compactRes.compactedTurns > 0)) {
          const details = [];
          if (compactRes.prunedImages > 0) details.push(`pruned ${compactRes.prunedImages} older screenshot(s)`);
          if (compactRes.prunedDomSnapshots > 0) details.push(`pruned ${compactRes.prunedDomSnapshots} older DOM dump(s)`);
          if (compactRes.compactedTurns > 0) details.push(`compacted ${compactRes.compactedTurns} older turn(s)`);
          const beforeStr = compactRes.tokensBefore ? ` (~${compactRes.tokensBefore.toLocaleString()} tokens exceeded ${tokenLimit.toLocaleString()} limit)` : '';
          const afterStr = compactRes.tokensAfter ? ` (now ~${compactRes.tokensAfter.toLocaleString()} tokens)` : '';
          appendToolStep(`⚡ Auto-compacted history${beforeStr}: ${details.join(', ')} to optimize context${afterStr}.`);
          if (currentTabId) saveTabSession(currentTabId);
        }
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const requestBody = {
        contents: conversationHistory,
        systemInstruction: systemInstruction,
        tools: tools,
        generationConfig: {
          temperature: 0.2
        }
      };

      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(60000)
        });
      } catch (fetchErr) {
        if (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError') {
          throw new Error('Google Gemini API request timed out (60s). Please check your connection or switch to Gemini 3.5 Flash-Lite.');
        }
        throw fetchErr;
      }

      // Auto-retry once on temporary 503 high demand spike
      if (response.status === 503) {
        appendToolStep('Model under high demand (503). Retrying in 1.5s...');
        await new Promise((r) => setTimeout(r, 1500));
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(60000)
          });
        } catch (retryErr) {
          if (retryErr.name === 'TimeoutError' || retryErr.name === 'AbortError') {
            throw new Error('Google Gemini API request timed out on retry (60s).');
          }
          throw retryErr;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson = null;
        try { errorJson = JSON.parse(errorText); } catch (e) {}

        if (response.status === 503) {
          appendAssistantMessage(
            `⚠️ **Google Gemini High Demand (503)**: Model "${model}" is temporarily at capacity.<br/><br/>` +
            `👉 Try switching to **Gemini 3.5 Flash-Lite** or retrying in a moment.<br/>` +
            `<button class="action-btn primary" id="switchToFlashLiteBtn" style="margin-top: 8px;">⚡ Switch to Gemini 3.5 Flash-Lite</button>`
          );
          setTimeout(() => {
            const btn = document.getElementById('switchToFlashLiteBtn');
            if (btn) {
              btn.addEventListener('click', async () => {
                const targetModel = 'gemini-3.5-flash-lite';
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                  await chrome.storage.local.set({ geminiModel: targetModel });
                } else {
                  localStorage.setItem('geminiModel', targetModel);
                }
                setQuickModelUI(targetModel);
                btn.textContent = '✓ Switched to Gemini 3.5 Flash-Lite!';
                btn.disabled = true;
                appendToolStep('Switched model to gemini-3.5-flash-lite. Please click Send to retry.');
              });
            }
          }, 100);
          return;
        }

        const msg = errorJson?.error?.message || errorText;
        throw new Error(`Gemini API error (${response.status}): ${msg}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      if (!candidate || !candidate.content) {
        const finishReason = candidate?.finishReason || 'UNKNOWN';
        if (finishReason === 'MAX_TOKENS') {
          appendAssistantMessage('⚠️ **Output truncated**: The model reached its maximum token output limit.');
        } else if (finishReason === 'SAFETY') {
          appendAssistantMessage('⚠️ **Blocked by safety**: Gemini safety filters blocked generation on this page content.');
        } else {
          appendAssistantMessage(`⚠️ Received empty response from Gemini (finishReason: ${finishReason}).`);
        }
        break;
      }

      // Add model response to history
      conversationHistory.push(candidate.content);

      const parts = candidate.content.parts || [];
      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      const textParts = parts.filter((p) => p.text).map((p) => p.text).join('\n');

      if (textParts) {
        appendAssistantMessage(textParts);
      }

      if (functionCalls.length === 0) {
        // No further tool calls; agent has completed its plan.
        if (!textParts && !latestScriptToCard) {
          appendAssistantMessage('✓ Agent completed analysis.');
        }
        if (latestScriptToCard) {
          appendScriptCard(latestScriptToCard, latestScriptAlreadyRan);
          latestScriptToCard = null;
        }
        break;
      }

      // Execute Tool Calls
      const functionResponses = [];
      for (const call of functionCalls) {
        if (call.name === 'inspect_dom') {
          appendToolStep(`Inspecting DOM: ${call.args.reason || call.args.script.slice(0, 50)}`);
          let inspectResult;
          try {
            const queryRes = await chrome.scripting.executeScript({
              target: { tabId: requestTabId || activeTab.id },
              world: 'MAIN',
              func: (snippet) => {
                try {
                  let r;
                  try {
                    const fn = new Function('return (' + snippet + ')');
                    r = fn();
                  } catch (evalErr) {
                    const s = document.createElement('script');
                    const callbackId = '__inspect_' + Math.random().toString(36).slice(2);
                    s.textContent = `try { window['${callbackId}'] = (function(){ return (${snippet}); })(); } catch(e) { window['${callbackId}'] = 'Error: ' + e.message; }`;
                    (document.head || document.documentElement).appendChild(s);
                    s.remove();
                    r = window[callbackId];
                    delete window[callbackId];
                  }
                  return typeof r === 'object' ? JSON.stringify(r) : String(r);
                } catch (e) {
                  return 'Error: ' + e.message;
                }
              },
              args: [call.args.script]
            });
            inspectResult = queryRes?.[0]?.result || 'Executed (no return value)';
          } catch (e) {
            inspectResult = 'Inspection failed: ' + e.message;
          }

          functionResponses.push({
            functionResponse: {
              name: 'inspect_dom',
              response: { result: inspectResult }
            }
          });
        } else if (call.name === 'dehydrate_dom') {
          appendToolStep('Refreshing DOM tree summary...');
          const domData = await scanActivePageDom(requestTabId);
          const formatted = DomDehydrator.formatForPrompt(domData);
          functionResponses.push({
            functionResponse: {
              name: 'dehydrate_dom',
              response: { dom: formatted }
            }
          });
        } else if (call.name === 'capture_screenshot') {
          const reason = call.args.reason || 'Inspecting visual page layout';
          appendToolStep(`📸 Capturing tab screenshot (${reason})...`);
          const shotRes = await captureTabScreenshot();
          if (shotRes.success && shotRes.dataUrl) {
            appendScreenshotToolStep(reason, shotRes.dataUrl);
            const base64Data = shotRes.dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
            functionResponses.push({
              functionResponse: {
                name: 'capture_screenshot',
                response: {
                  status: 'success',
                  message: 'Visual screenshot of active tab viewport was captured and provided to the model.',
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data
                  }
                },
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: base64Data
                    }
                  }
                ]
              }
            });
          } else {
            appendToolStep(`⚠️ Screenshot capture failed: ${shotRes.error || 'Failed'}`);
            functionResponses.push({
              functionResponse: {
                name: 'capture_screenshot',
                response: {
                  status: 'failed',
                  error: shotRes.error || 'Could not capture active tab viewport.'
                }
              }
            });
          }
        } else if (call.name === 'apply_userscript') {
          const scriptData = {
            id: `script_${Date.now()}`,
            name: call.args.name || 'Generated Script',
            description: call.args.description || '',
            script: call.args.script || ''
          };

          let alreadyRan = false;
          const targetExecId = requestTabId || activeTab?.id;
          if (autoRun && targetExecId) {
            appendToolStep(`Auto-running "${scriptData.name}" in page...`);
            const execRes = await ScriptManager.executeInTab(targetExecId, scriptData.script, scriptData.name);
            alreadyRan = execRes?.success || false;
          }

          latestScriptToCard = scriptData;
          latestScriptAlreadyRan = alreadyRan;
          appendScriptCard(scriptData, alreadyRan);

          functionResponses.push({
            functionResponse: {
              name: 'apply_userscript',
              response: {
                status: alreadyRan ? 'Executed in page' : 'Presented to user for review',
                success: true
              }
            }
          });
        } else if (call.name === 'get_saved_scripts') {
          appendToolStep('Listing saved userscripts from database...');
          try {
            const all = await ScriptManager.getAllScripts();
            functionResponses.push({
              functionResponse: {
                name: 'get_saved_scripts',
                response: {
                  count: all.length,
                  scripts: all.map((s) => ({
                    id: s.id,
                    name: s.name,
                    enabled: s.enabled,
                    matchPatterns: s.matchPatterns,
                    description: s.description
                  }))
                }
              }
            });
          } catch (err) {
            functionResponses.push({
              functionResponse: {
                name: 'get_saved_scripts',
                response: { error: err.message }
              }
            });
          }
        } else if (call.name === 'read_saved_script') {
          const target = (call.args.nameOrId || '').toLowerCase().trim();
          appendToolStep(`Reading saved userscript: "${call.args.nameOrId}"...`);
          try {
            const all = await ScriptManager.getAllScripts();
            const found = all.find(
              (s) =>
                s.id === call.args.nameOrId ||
                s.name.toLowerCase() === target ||
                s.name.toLowerCase().includes(target)
            );
            if (found) {
              functionResponses.push({
                functionResponse: {
                  name: 'read_saved_script',
                  response: {
                    found: true,
                    id: found.id,
                    name: found.name,
                    description: found.description,
                    matchPatterns: found.matchPatterns,
                    enabled: found.enabled,
                    code: found.code
                  }
                }
              });
            } else {
              functionResponses.push({
                functionResponse: {
                  name: 'read_saved_script',
                  response: {
                    found: false,
                    error: `No saved userscript matching "${call.args.nameOrId}" was found in storage.`
                  }
                }
              });
            }
          } catch (err) {
            functionResponses.push({
              functionResponse: {
                name: 'read_saved_script',
                response: { error: err.message }
              }
            });
          }
        } else if (call.name === 'save_userscript') {
          const name = call.args.name || 'AI Userscript';
          const code = call.args.script || '';
          const desc = call.args.description || '';
          const id = call.args.id || undefined;
          const enabled = call.args.enabled !== undefined ? call.args.enabled : true;

          let defaultPattern = '<all_urls>';
          if (activeTab?.url) {
            try {
              const u = new URL(activeTab.url);
              defaultPattern = `*://*.${u.hostname.replace(/^www\./, '')}/*`;
            } catch (e) {}
          }

          let matchPatterns = call.args.matchPatterns;
          if (!matchPatterns || (Array.isArray(matchPatterns) && matchPatterns.length === 0)) {
            matchPatterns = [defaultPattern];
          } else if (!Array.isArray(matchPatterns)) {
            matchPatterns = [matchPatterns];
          }

          const formattedCode = ScriptManager.formatAsUserScript(
            { name, description: desc, matchPatterns, code },
            defaultPattern
          );

          appendToolStep(`💾 Saving userscript "${name}" to your library...`);
          try {
            const saved = await ScriptManager.saveScript({
              id,
              name,
              description: desc,
              matchPatterns,
              code: formattedCode,
              enabled
            });

            await loadSavedScriptsList();

            // If enabled and matches current page, execute immediately
            if (enabled && activeTab?.id && activeTab?.url && ScriptManager.matchesUrl(activeTab.url, matchPatterns)) {
              await ScriptManager.executeInTab(activeTab.id, formattedCode, name);
              appendToolStep(`⚡ Auto-ran saved "${saved.name}" on active page.`);
            }

            functionResponses.push({
              functionResponse: {
                name: 'save_userscript',
                response: {
                  success: true,
                  id: saved.id,
                  name: saved.name,
                  matchPatterns: saved.matchPatterns,
                  enabled: saved.enabled,
                  message: `Userscript "${saved.name}" has been successfully saved to your extension library.`
                }
              }
            });
          } catch (err) {
            functionResponses.push({
              functionResponse: {
                name: 'save_userscript',
                response: { success: false, error: err.message }
              }
            });
          }
        }
      }

      // Add function response parts to conversation history (Gemini API requires role: 'user')
      conversationHistory.push({
        role: 'user',
        parts: functionResponses
      });
    }

    // Safety fallback: if loop exited and script card has not been rendered, append it now
    if (latestScriptToCard) {
      appendScriptCard(latestScriptToCard, latestScriptAlreadyRan);
      latestScriptToCard = null;
    } else if (turn >= maxTurns) {
      appendAssistantMessage(
        `⏱️ **Paused at step limit (${maxTurns} steps).**<br/>` +
        `The agent took ${maxTurns} analysis steps without finalizing. If you'd like it to keep going, type **"continue"** or provide more specific selectors.`
      );
    }
  }

  async function clearConversation() {
    resetConversationFeed();
    handleRemoveScreenshot();
    if (currentTabId) {
      await TabSessionManager.clearSession(currentTabId);
    }
  }


  // -------------------------------------------------------------
  // Saved Scripts Manager (Tampermonkey style)
  // -------------------------------------------------------------

  async function loadSavedScriptsList() {
    const scripts = await ScriptManager.getAllScripts();
    scriptsCountBadge.textContent = scripts.length;

    const currentUrl = activeTab?.url || '';
    renderScriptsList(scripts, currentUrl);
  }

  function renderScriptsList(scripts, currentUrl) {
    scriptsList.innerHTML = '';

    if (scripts.length === 0) {
      scriptsList.innerHTML = `
        <div class="empty-state">
          <p>No userscripts saved yet.</p>
          <p style="margin-top: 6px; font-size: 11.5px;">Ask the AI agent to write one, or click <strong>+ New Script</strong>.</p>
        </div>
      `;
      return;
    }

    for (const script of scripts) {
      const matchesActive = ScriptManager.matchesUrl(currentUrl, script.matchPatterns);

      const item = document.createElement('div');
      item.className = `script-item ${matchesActive ? 'matches-page' : ''}`;

      const patternsStr = Array.isArray(script.matchPatterns)
        ? script.matchPatterns.join(', ')
        : script.matchPatterns;

      item.innerHTML = `
        <div class="script-item-top">
          <span class="script-item-name">${escapeHtml(script.name)}</span>
          <label class="toggle-switch">
            <input type="checkbox" class="script-toggle" data-id="${script.id}" ${script.enabled ? 'checked' : ''} />
            <span class="slider"></span>
          </label>
        </div>
        <div class="script-item-patterns">
          ${escapeHtml(patternsStr)}
          ${matchesActive ? '<span class="matches-tag">Matches active page</span>' : ''}
        </div>
        <div class="script-item-controls">
          <div>
            <button class="action-btn primary run-script-btn" data-id="${script.id}">▶ Run</button>
            <button class="action-btn edit-script-btn" data-id="${script.id}">✏️ Edit</button>
          </div>
          <button class="action-btn delete-script-btn text-muted" data-id="${script.id}">🗑️</button>
        </div>
      `;

      scriptsList.appendChild(item);
    }

    // Attach row events
    scriptsList.querySelectorAll('.script-toggle').forEach((t) => {
      t.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-id');
        const enabled = e.target.checked;
        const target = await ScriptManager.toggleScript(id, enabled);
        if (enabled && target && activeTab?.id && activeTab?.url && ScriptManager.matchesUrl(activeTab.url, target.matchPatterns)) {
          await ScriptManager.executeInTab(activeTab.id, target.code, target.name);
          appendToolStep(`⚡ Enabled & auto-ran "${target.name}" on active page.`);
        }
      });
    });

    scriptsList.querySelectorAll('.run-script-btn').forEach((b) => {
      b.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        const script = (await ScriptManager.getAllScripts()).find((s) => s.id === id);
        if (script && activeTab?.id) {
          b.disabled = true;
          b.textContent = 'Running...';
          await ScriptManager.executeInTab(activeTab.id, script.code, script.name);
          b.disabled = false;
          b.textContent = '✓ Done';
          setTimeout(() => (b.textContent = '▶ Run'), 1500);
        }
      });
    });

    scriptsList.querySelectorAll('.edit-script-btn').forEach((b) => {
      b.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        const script = (await ScriptManager.getAllScripts()).find((s) => s.id === id);
        if (script) openScriptModal(script);
      });
    });

    scriptsList.querySelectorAll('.delete-script-btn').forEach((b) => {
      b.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        if (confirm('Delete this saved userscript?')) {
          await ScriptManager.deleteScript(id);
          await loadSavedScriptsList();
        }
      });
    });
  }

  function filterScriptsList() {
    const query = scriptsSearch.value.toLowerCase().trim();
    ScriptManager.getAllScripts().then((scripts) => {
      const filtered = scripts.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          (s.matchPatterns && s.matchPatterns.some((p) => p.toLowerCase().includes(query)))
      );
      renderScriptsList(filtered, activeTab?.url || '');
    });
  }

  // -------------------------------------------------------------
  // Script Modal CRUD
  // -------------------------------------------------------------

  function updateEditorMetadataPreview() {
    if (!editorMetadataPreview || !modalScriptCode) return;
    const meta = ScriptManager.parseMetadata(modalScriptCode.value);
    const name = meta.name || '(no @name)';
    const patterns = meta.matchPatterns.length > 0 ? meta.matchPatterns.join(', ') : '(no @match)';
    editorMetadataPreview.textContent = `@name: ${name} | @match: ${patterns}`;
  }

  function openScriptModal(script = null) {
    let defaultPattern = '<all_urls>';
    if (activeTab?.url) {
      try {
        const u = new URL(activeTab.url);
        defaultPattern = `*://*.${u.hostname.replace(/^www\./, '')}/*`;
      } catch (e) {}
    }

    if (script) {
      modalTitle.textContent = script.id ? 'Edit Userscript' : 'Save Userscript';
      modalScriptId.value = script.id || '';
      modalScriptCode.value = ScriptManager.formatAsUserScript(script, defaultPattern);
      modalScriptEnabled.checked = script.enabled !== undefined ? script.enabled : true;
    } else {
      modalTitle.textContent = 'New Userscript';
      modalScriptId.value = '';
      modalScriptCode.value = ScriptManager.formatAsUserScript(
        {
          name: 'New Userscript',
          description: 'Custom DOM modifier',
          matchPatterns: [defaultPattern],
          code: ''
        },
        defaultPattern
      );
      modalScriptEnabled.checked = true;
    }

    updateEditorMetadataPreview();
    scriptModal.classList.remove('hidden');
    modalScriptCode.focus();
  }

  function closeScriptModal() {
    scriptModal.classList.add('hidden');
  }

  async function handleSaveModal() {
    const rawCode = modalScriptCode.value;
    const enabled = modalScriptEnabled.checked;
    const id = modalScriptId.value || undefined;

    const meta = ScriptManager.parseMetadata(rawCode);
    const name = meta.name || 'Userscript ' + new Date().toISOString().slice(0, 10);
    const matchPatterns = meta.matchPatterns.length > 0 ? meta.matchPatterns : ['<all_urls>'];

    await ScriptManager.saveScript({
      id,
      name,
      description: meta.description || '',
      matchPatterns,
      code: rawCode,
      runAt: meta.runAt || 'document_idle',
      enabled
    });

    closeScriptModal();
    await loadSavedScriptsList();

    // Auto-run immediately on active page if enabled and matches current page
    if (enabled && activeTab?.id && activeTab?.url && ScriptManager.matchesUrl(activeTab.url, matchPatterns)) {
      try {
        const res = await ScriptManager.executeInTab(activeTab.id, rawCode, name);
        if (res?.success) {
          appendToolStep(`⚡ Saved & auto-ran "${name}" on active page.`);
        } else {
          console.warn('[Userscript AI Agent] Auto-run error:', res?.error);
        }
      } catch (err) {
        console.warn('[Userscript AI Agent] Auto-run on save failed:', err);
      }
    }
  }

  async function handleExportScripts() {
    const jsonString = await ScriptManager.exportScripts();
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `userscripts-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target.result;
      const res = await ScriptManager.importScripts(content);
      if (res.success) {
        alert(`Successfully imported ${res.count} userscripts!`);
        await loadSavedScriptsList();
      } else {
        alert(`Import failed: ${res.error}`);
      }
      importFileInput.value = '';
    };
    reader.readAsText(file);
  }

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------

  function scrollToBottom() {
    messagesFeed.scrollTop = messagesFeed.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let escaped = escapeHtml(text);
    // Bold
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Inline code
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
    escaped = escaped.replace(
      /\[(.*?)\]\((https?:\/\/[^\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    // Linebreaks
    escaped = escaped.replace(/\n/g, '<br/>');
    return escaped;
  }

  if (typeof window !== 'undefined') {
    window.TabSessionManager = TabSessionManager;
    window.ContextCompactor = ContextCompactor;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TabSessionManager, ContextCompactor };
  }

  if (typeof document !== 'undefined' && typeof process === 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
