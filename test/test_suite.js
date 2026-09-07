// test/test_suite.js - Comprehensive test suite for Userscript AI Agent

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log('🧪 Running Userscript AI Agent Test Suite...\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}\n`);
    failed++;
  }
}

async function run() {
  // -------------------------------------------------------------
  // Test 1: Manifest V3 Schema & Asset Verification
  // -------------------------------------------------------------
  console.log('1. Manifest V3 & File Integrity Tests:');

  await test('manifest.json exists and is valid JSON', () => {
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json does not exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
    assert.ok(manifest.name, 'Manifest must have a name');
    assert.ok(manifest.version, 'Manifest must have a version');
    assert.ok(manifest.permissions.includes('sidePanel'), 'Must request sidePanel permission');
    assert.ok(manifest.permissions.includes('scripting'), 'Must request scripting permission');
    assert.ok(manifest.permissions.includes('storage'), 'Must request storage permission');
    assert.ok(manifest.permissions.includes('activeTab'), 'Must request activeTab permission');
  });

  await test('all icon assets referenced in manifest.json exist on disk', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
    const iconSizes = ['16', '32', '48', '128'];
    for (const size of iconSizes) {
      const iconRel = manifest.icons[size];
      assert.ok(iconRel, `Icon ${size} is missing in manifest icons`);
      const fullPath = path.join(ROOT_DIR, iconRel);
      assert.ok(fs.existsSync(fullPath), `Icon file ${fullPath} does not exist`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 0, `Icon ${fullPath} is empty`);
    }
  });

  await test('service worker background.js exists and is valid JS', () => {
    const bgPath = path.join(ROOT_DIR, 'background.js');
    assert.ok(fs.existsSync(bgPath), 'background.js does not exist');
    const code = fs.readFileSync(bgPath, 'utf8');
    assert.ok(code.includes('chrome.sidePanel'), 'Must configure sidePanel');
    assert.ok(code.includes('chrome.tabs.onUpdated'), 'Must listen to tabs onUpdated for auto-injection');
  });

  await test('options and sidepanel files exist with correct HTML/CSS/JS pairs', () => {
    const files = [
      'options/options.html',
      'options/options.css',
      'options/options.js',
      'sidepanel/sidepanel.html',
      'sidepanel/sidepanel.css',
      'sidepanel/sidepanel.js',
      'sidepanel/dom_dehydrator.js',
      'sidepanel/script_manager.js'
    ];
    for (const f of files) {
      const fullPath = path.join(ROOT_DIR, f);
      assert.ok(fs.existsSync(fullPath), `Expected file ${f} does not exist`);
    }
  });

  // -------------------------------------------------------------
  // Test 2: URL Pattern Matcher Logic
  // -------------------------------------------------------------
  console.log('\n2. URL Match Pattern & Glob Tests:');

  const scriptManagerCode = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel/script_manager.js'), 'utf8');
  const ScriptManagerMock = {};
  eval(scriptManagerCode.replace('window.ScriptManager = ScriptManager;', 'Object.assign(ScriptManagerMock, ScriptManager);'));

  await test('<all_urls> matches any http and https URL', () => {
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://google.com', ['<all_urls>']), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('http://localhost:3000', ['<all_urls>']), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://sub.domain.com/path?q=1', ['<all_urls>']), true);
  });

  await test('wildcard domain patterns match correctly for both apex domain and subdomains', () => {
    const patterns = ['*://*.youtube.com/*'];
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://www.youtube.com/watch?v=abc', patterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://m.youtube.com/', patterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://youtube.com/feed', patterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://vimeo.com/watch', patterns), false);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://notyoutube.com/feed', patterns), false);

    // Test apex domain like archive.ph
    const archivePatterns = ['*://*.archive.ph/*'];
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://archive.ph/5NP50', archivePatterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://www.archive.ph/5NP50', archivePatterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('http://archive.ph/', archivePatterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://notarchive.ph/5NP50', archivePatterns), false);
  });

  await test('multiple patterns in array evaluate with OR logic', () => {
    const patterns = ['https://github.com/*', 'https://news.ycombinator.com/*'];
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://github.com/alibaba/page-agent', patterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://news.ycombinator.com/item?id=1', patterns), true);
    assert.strictEqual(ScriptManagerMock.matchesUrl('https://reddit.com/r/javascript', patterns), false);
  });

  // -------------------------------------------------------------
  // Test 3: Script Manager Backup Serialization & Tampermonkey Compatibility
  // -------------------------------------------------------------
  console.log('\n3. Script Manager Backup & Compatibility Tests:');

  let memoryStorage = {};
  global.chrome = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          if (typeof keys === 'string') {
            res[keys] = memoryStorage[keys];
          } else if (Array.isArray(keys)) {
            keys.forEach(k => res[k] = memoryStorage[k]);
          } else if (typeof keys === 'object' && keys !== null) {
            Object.keys(keys).forEach(k => res[k] = memoryStorage[k] !== undefined ? memoryStorage[k] : keys[k]);
          } else {
            res.saved_userscripts = memoryStorage.saved_userscripts || [];
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (obj, cb) => {
          Object.assign(memoryStorage, obj);
          if (cb) cb();
          return Promise.resolve();
        }
      }
    }
  };

  await test('ScriptManager can save, retrieve, and toggle userscripts', async () => {
    memoryStorage = {};
    const saved = await ScriptManagerMock.saveScript({
      name: 'Ad Blocker Test',
      matchPatterns: ['*://*.example.com/*'],
      code: 'document.querySelector(".ad").remove();',
      enabled: true
    });

    assert.ok(saved.id, 'Must generate script ID');
    assert.strictEqual(saved.name, 'Ad Blocker Test');

    const all = await ScriptManagerMock.getAllScripts();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].name, 'Ad Blocker Test');

    // Toggle
    await ScriptManagerMock.toggleScript(saved.id, false);
    const updated = await ScriptManagerMock.getAllScripts();
    assert.strictEqual(updated[0].enabled, false);
  });

  await test('ScriptManager can export and import JSON backup files', async () => {
    const jsonExport = await ScriptManagerMock.exportScripts();
    assert.ok(typeof jsonExport === 'string', 'Export must return JSON string');
    const parsed = JSON.parse(jsonExport);
    assert.ok(Array.isArray(parsed.scripts), 'Exported payload must have scripts array');
    assert.strictEqual(parsed.scripts.length, 1);

    // Clear and re-import
    memoryStorage = {};
    const importRes = await ScriptManagerMock.importScripts(jsonExport);
    assert.strictEqual(importRes.success, true);
    assert.strictEqual(importRes.count, 1);

    const restored = await ScriptManagerMock.getAllScripts();
    assert.strictEqual(restored.length, 1);
    assert.strictEqual(restored[0].name, 'Ad Blocker Test');
  });

  await test('ScriptManager parses Tampermonkey // ==UserScript== metadata block correctly', () => {
    const rawUserScript = `// ==UserScript==
// @name         Archive.today Fix & Clean
// @namespace    http://tampermonkey.net/
// @version      2026.09.06
// @description  Hides header banner and restores normal layout
// @author       PowerUser
// @match        *://*.archive.ph/*
// @match        *://*.archive.today/*
// @include      https://archive.is/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
  console.log("Running...");
})();`;

    const meta = ScriptManagerMock.parseMetadata(rawUserScript);
    assert.strictEqual(meta.name, 'Archive.today Fix & Clean');
    assert.strictEqual(meta.description, 'Hides header banner and restores normal layout');
    assert.strictEqual(meta.version, '2026.09.06');
    assert.strictEqual(meta.author, 'PowerUser');
    assert.strictEqual(meta.runAt, 'document_end');
    assert.strictEqual(meta.matchPatterns.length, 3);
    assert.ok(meta.matchPatterns.includes('*://*.archive.ph/*'));
    assert.ok(meta.matchPatterns.includes('*://*.archive.today/*'));
    assert.ok(meta.matchPatterns.includes('https://archive.is/*'));
  });

  await test('ScriptManager formats scripts to Tampermonkey format with match patterns', () => {
    const script = {
      name: 'HN Dark Mode',
      description: 'Make Hacker News dark',
      matchPatterns: ['https://news.ycombinator.com/*'],
      code: 'document.body.style.background = "#121212";'
    };

    const formatted = ScriptManagerMock.formatAsUserScript(script, '<all_urls>');
    assert.ok(formatted.includes('// ==UserScript=='));
    assert.ok(formatted.includes('// ==/UserScript=='));
    assert.ok(formatted.includes('// @name         HN Dark Mode'));
    assert.ok(formatted.includes('// @match        https://news.ycombinator.com/*'));
    assert.ok(formatted.includes('document.body.style.background = "#121212";'));

    // Formatting an already formatted script should return it untouched
    const untouched = ScriptManagerMock.formatAsUserScript({ code: formatted });
    assert.strictEqual(untouched, formatted);
  });

  await test('ScriptManager auto-extracts metadata when saving raw userscript code', async () => {
    memoryStorage = {};
    const fullCode = `// ==UserScript==
// @name         Economist Paywall Reader
// @description  Bypasses overlay
// @match        *://*.economist.com/*
// @run-at       document-idle
// ==/UserScript==

document.querySelector('.paywall')?.remove();`;

    const saved = await ScriptManagerMock.saveScript({
      code: fullCode,
      enabled: true
    });

    assert.strictEqual(saved.name, 'Economist Paywall Reader');
    assert.strictEqual(saved.description, 'Bypasses overlay');
    assert.deepStrictEqual(saved.matchPatterns, ['*://*.economist.com/*']);
    assert.strictEqual(saved.runAt, 'document_idle');
  });

  await test('ScriptManager imports raw .user.js files directly into database', async () => {
    memoryStorage = {};
    const rawUserJs = `// ==UserScript==
// @name         Direct UserJS Import
// @description  Test raw file import
// @match        *://*.github.com/*
// ==/UserScript==
console.log("imported directly!");`;

    const importRes = await ScriptManagerMock.importScripts(rawUserJs);
    assert.strictEqual(importRes.success, true);
    assert.strictEqual(importRes.count, 1);

    const all = await ScriptManagerMock.getAllScripts();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].name, 'Direct UserJS Import');
    assert.deepStrictEqual(all[0].matchPatterns, ['*://*.github.com/*']);
  });

  // -------------------------------------------------------------
  // Test 4: DOM Dehydration Engine Logic
  // -------------------------------------------------------------
  console.log('\n4. Page-Agent DOM Dehydration Tests:');

  const domDehydratorCode = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel/dom_dehydrator.js'), 'utf8');
  const DomDehydratorMock = {};
  eval(domDehydratorCode.replace('window.DomDehydrator = DomDehydrator;', 'Object.assign(DomDehydratorMock, DomDehydrator);'));

  await test('DomDehydrator provides an executable injection script', () => {
    const script = DomDehydratorMock.getInjectionScript();
    assert.ok(typeof script === 'string', 'Must return string');
    assert.ok(script.includes('TreeWalker'), 'Must use efficient DOM TreeWalker');
    assert.ok(script.includes('isVisible'), 'Must filter invisible elements');
  });

  await test('DomDehydrator.scanPage serializes to valid function expression for executeScript', () => {
    const fnStr = DomDehydratorMock.scanPage.toString().trim();
    assert.ok(fnStr.startsWith('function'), 'scanPage must start with "function" to avoid syntax error when wrapped in (...)()');
    assert.doesNotThrow(() => {
      eval('(' + fnStr + ')');
    }, 'Must evaluate without SyntaxError: Unexpected token {');
  });

  await test('DomDehydrator formatForPrompt produces structured markdown table', () => {
    const mockDehydrated = {
      title: 'Test Article',
      url: 'https://example.com/page',
      elementCount: 2,
      elements: [
        {
          tag: 'button',
          selector: '#submit-btn',
          id: 'submit-btn',
          classes: 'btn primary',
          text: 'Submit Application',
          isInteractive: true,
          isHeading: false,
          isAd: false
        },
        {
          tag: 'div',
          selector: '#sponsor-banner',
          id: 'sponsor-banner',
          classes: 'banner-ad',
          text: 'Advertisement',
          isInteractive: false,
          isHeading: false,
          isAd: true
        }
      ]
    };

    const md = DomDehydratorMock.formatForPrompt(mockDehydrated);
    assert.ok(md.includes('## Page: "Test Article"'), 'Markdown contains page title');
    assert.ok(md.includes('#submit-btn'), 'Markdown contains selector');
    assert.ok(md.includes('potential-ad/banner'), 'Markdown highlights ad classification');
  });

  // -------------------------------------------------------------
  // Test 5: Gemini API Protocol & Role Schema Validation
  // -------------------------------------------------------------
  console.log('\n5. Gemini API Schema & Role Validation:');

  const sidepanelCode = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel/sidepanel.js'), 'utf8');

  await test('sidepanel.js does not use disallowed role: "function"', () => {
    assert.strictEqual(sidepanelCode.includes("role: 'function'"), false, 'Must not use role "function"');
    assert.strictEqual(sidepanelCode.includes('role: "function"'), false, 'Must not use role "function"');
  });

  await test('sidepanel.js adheres to Gemini REST functionResponse format', () => {
    assert.ok(sidepanelCode.includes('functionResponse:'), 'Must format tool results as functionResponse');
    assert.ok(sidepanelCode.includes("role: 'user'"), 'Must send functionResponse with role "user"');
  });

  // -------------------------------------------------------------
  // Test 6: Multimodal Screenshot & Visual Inspection Tests
  // -------------------------------------------------------------
  console.log('\n6. Multimodal Screenshot & Visual Inspection Tests:');

  const sidepanelHtml = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel/sidepanel.html'), 'utf8');
  const sidepanelCss = fs.readFileSync(path.join(ROOT_DIR, 'sidepanel/sidepanel.css'), 'utf8');

  await test('sidepanel.html includes screenshot toolbar button and preview container', () => {
    assert.ok(sidepanelHtml.includes('id="captureScreenshotBtn"'), 'Must have captureScreenshotBtn');
    assert.ok(sidepanelHtml.includes('id="screenshotPreviewContainer"'), 'Must have screenshotPreviewContainer');
    assert.ok(sidepanelHtml.includes('id="screenshotPreviewImg"'), 'Must have screenshotPreviewImg');
    assert.ok(sidepanelHtml.includes('id="removeScreenshotBtn"'), 'Must have removeScreenshotBtn');
  });

  await test('sidepanel.css defines styles for screenshot preview and thumbnail displays', () => {
    assert.ok(sidepanelCss.includes('.screenshot-preview-container'), 'Must style .screenshot-preview-container');
    assert.ok(sidepanelCss.includes('.screenshot-preview-thumb'), 'Must style .screenshot-preview-thumb');
    assert.ok(sidepanelCss.includes('.chat-screenshot-thumb'), 'Must style .chat-screenshot-thumb');
    assert.ok(sidepanelCss.includes('.tool-step-screenshot'), 'Must style .tool-step-screenshot');
  });

  await test('sidepanel.js declares capture_screenshot tool in function_declarations and systemInstruction', () => {
    assert.ok(sidepanelCode.includes("name: 'capture_screenshot'"), 'Tools array must declare capture_screenshot');
    assert.ok(sidepanelCode.includes('capture_screenshot:'), 'System instruction must explain capture_screenshot');
  });

  await test('sidepanel.js handles capture_screenshot tool and formats multimodal inlineData', () => {
    assert.ok(sidepanelCode.includes("call.name === 'capture_screenshot'"), 'Must dispatch capture_screenshot call');
    assert.ok(sidepanelCode.includes("mimeType: 'image/jpeg'"), 'Must specify image/jpeg mimeType');
    assert.ok(sidepanelCode.includes('inlineData:'), 'Must format screenshot data as inlineData');
  });

  await test('sidepanel.js provides capture_screenshot tool for on-demand visual inspection without auto-injection', () => {
    assert.ok(sidepanelCode.includes("name: 'capture_screenshot'"), 'Tools array must declare capture_screenshot');
    assert.ok(sidepanelCode.includes('captureTabScreenshot'), 'Must implement captureTabScreenshot');
  });

  const optionsHtml = fs.readFileSync(path.join(ROOT_DIR, 'options/options.html'), 'utf8');
  const optionsJs = fs.readFileSync(path.join(ROOT_DIR, 'options/options.js'), 'utf8');

  await test('options page provides autoCompact and compactThreshold configuration', () => {
    assert.ok(optionsHtml.includes('id="autoCompactCheckbox"'), 'options.html must have autoCompactCheckbox');
    assert.ok(optionsHtml.includes('id="compactThresholdInput"'), 'options.html must have compactThresholdInput');
    assert.ok(optionsJs.includes('autoCompact:'), 'options.js must save/restore autoCompact');
    assert.ok(optionsJs.includes('compactThreshold:'), 'options.js must save/restore compactThreshold');
  });

  // -------------------------------------------------------------
  // Test 7: Per-Tab Scoped Side Panel & Isolated Chat Sessions
  // -------------------------------------------------------------
  console.log('\n7. Per-Tab Scoped Side Panel & Isolated Session Tests:');

  const manifestData = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));

  await test('manifest.json omits default_path in side_panel to allow per-tab scoping', () => {
    assert.strictEqual(manifestData.side_panel?.default_path, undefined, 'default_path must not be set globally');
  });

  const bgCode = fs.readFileSync(path.join(ROOT_DIR, 'background.js'), 'utf8');

  await test('background.js disables side panel globally on initial start', () => {
    assert.ok(bgCode.includes('chrome.sidePanel.setOptions({ enabled: false })'), 'Must disable side panel globally');
  });

  await test('background.js toggles per-tab side panel with tabId and scoped path on action click', () => {
    assert.ok(bgCode.includes('chrome.action.onClicked'), 'Must listen to action clicked');
    assert.ok(bgCode.includes('enabledTabs.has(tab.id)'), 'Must track enabled tabs');
    assert.ok(bgCode.includes('path: `sidepanel/sidepanel.html?tabId=${tab.id}`'), 'Must scope path with tabId query param');
    assert.ok(bgCode.includes('chrome.sidePanel.open({ tabId: tab.id })'), 'Must open panel for specific tabId');
  });

  await test('background.js cleans up tab session and tracked state when tab is closed', () => {
    assert.ok(bgCode.includes('chrome.tabs.onRemoved'), 'Must listen to tabs onRemoved');
    assert.ok(bgCode.includes('tab_session_${tabId}'), 'Must clean up tab_session key');
  });

  await test('sidepanel.js implements per-tab session isolation logic and storage methods', () => {
    assert.ok(sidepanelCode.includes('TabSessionManager'), 'Must define TabSessionManager');
    assert.ok(sidepanelCode.includes('saveTabSession'), 'Must define saveTabSession');
    assert.ok(sidepanelCode.includes('loadTabSession'), 'Must define loadTabSession');
    assert.ok(sidepanelCode.includes('handleTabSwitch'), 'Must define handleTabSwitch');
    assert.ok(sidepanelCode.includes('reattachFeedListeners'), 'Must define reattachFeedListeners');
    assert.ok(sidepanelCode.includes("urlParams.has('tabId')"), 'Must parse tabId from query parameters');
  });

  await test('TabSessionManager saves, isolates, restores, and clears sessions for different tabs', async () => {
    // Mock storage environment for TabSessionManager
    let sessionStore = {};
    const mockStorage = {
      get: (key) => Promise.resolve({ [key]: sessionStore[key] }),
      set: (obj) => {
        Object.assign(sessionStore, obj);
        return Promise.resolve();
      },
      remove: (key) => {
        delete sessionStore[key];
        return Promise.resolve();
      }
    };

    global.chrome = global.chrome || {};
    global.chrome.storage = global.chrome.storage || {};
    global.chrome.storage.session = mockStorage;

    global.document = {
      getElementById: () => ({
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {} },
        appendChild: () => {},
        querySelectorAll: () => []
      }),
      querySelectorAll: () => [],
      addEventListener: () => {}
    };
    global.window = {
      location: { search: '' },
      addEventListener: () => {}
    };

    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const tsm = SidepanelModule.TabSessionManager;
    assert.ok(tsm, 'TabSessionManager must be exported');

    // Save Tab 101 session
    const session101 = {
      conversationHistory: [{ role: 'user', parts: [{ text: 'Clean Economist page' }] }],
      messageQueue: [],
      feedHtml: '<div class="message-row user">Clean Economist page</div>',
      url: 'https://archive.ph/test1',
      domain: 'archive.ph',
      timestamp: Date.now()
    };
    await tsm.saveSession(101, session101);

    // Save Tab 102 session
    const session102 = {
      conversationHistory: [{ role: 'user', parts: [{ text: 'Dark mode for Hacker News' }] }],
      messageQueue: [],
      feedHtml: '<div class="message-row user">Dark mode for Hacker News</div>',
      url: 'https://news.ycombinator.com/',
      domain: 'news.ycombinator.com',
      timestamp: Date.now()
    };
    await tsm.saveSession(102, session102);

    // Verify isolation
    const loaded101 = await tsm.loadSession(101);
    const loaded102 = await tsm.loadSession(102);
    assert.strictEqual(loaded101.domain, 'archive.ph');
    assert.strictEqual(loaded101.conversationHistory[0].parts[0].text, 'Clean Economist page');
    assert.strictEqual(loaded102.domain, 'news.ycombinator.com');
    assert.strictEqual(loaded102.conversationHistory[0].parts[0].text, 'Dark mode for Hacker News');

    // Clear Tab 101 session
    await tsm.clearSession(101);
    const cleared101 = await tsm.loadSession(101);
    const retained102 = await tsm.loadSession(102);
    assert.strictEqual(cleared101, null);
    assert.strictEqual(retained102.domain, 'news.ycombinator.com');
  });

  // -------------------------------------------------------------
  // Test 8: Context Auto-Compactor Tests (Page-Agent Compaction)
  // -------------------------------------------------------------
  console.log('\n8. Context Auto-Compactor Tests (Page-Agent Compaction):');

  await test('ContextCompactor is exported and available in SidepanelModule', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    assert.ok(SidepanelModule.ContextCompactor, 'ContextCompactor must be exported');
  });

  await test('ContextCompactor prunes older base64 screenshots and preserves most recent one', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    const mockHistory = [
      {
        role: 'user',
        parts: [
          { text: 'Look at the page header' },
          { inlineData: { mimeType: 'image/jpeg', data: 'FIRST_BASE64_IMAGE_DATA_VERY_LARGE' } }
        ]
      },
      {
        role: 'model',
        parts: [{ text: 'I see the header. I will inspect it.' }]
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'capture_screenshot',
              response: {
                status: 'success',
                inlineData: { mimeType: 'image/jpeg', data: 'SECOND_BASE64_IMAGE_DATA' }
              }
            }
          }
        ]
      },
      {
        role: 'user',
        parts: [
          { text: 'Now check the footer' },
          { inlineData: { mimeType: 'image/jpeg', data: 'THIRD_BASE64_IMAGE_DATA_MOST_RECENT' } }
        ]
      }
    ];

    const res = compactor.compact(mockHistory, { maxRecentImages: 1 });
    assert.strictEqual(res.prunedImages, 2, 'Must prune 2 older screenshots');

    // Verify first user message image was pruned
    const firstUserMsg = res.compacted[0];
    assert.strictEqual(firstUserMsg.parts.some(p => p.inlineData), false, 'First message must have inlineData removed');
    assert.ok(firstUserMsg.parts.some(p => p.text && p.text.includes('Previous viewport screenshot analyzed')), 'Must include replacement text');

    // Verify tool screenshot was pruned
    const toolMsg = res.compacted[2];
    assert.strictEqual(toolMsg.parts[0].functionResponse.response.inlineData, undefined, 'Tool screenshot must have inlineData pruned');
    assert.strictEqual(toolMsg.parts[0].functionResponse.response.status, 'pruned');
    assert.strictEqual(toolMsg.parts[0].functionResponse.parts, undefined, 'functionResponse must never have parts array with text');

    // Verify most recent screenshot was retained in full fidelity
    const latestUserMsg = res.compacted[3];
    assert.ok(latestUserMsg.parts.some(p => p.inlineData && p.inlineData.data === 'THIRD_BASE64_IMAGE_DATA_MOST_RECENT'), 'Most recent screenshot must be preserved');
  });

  await test('ContextCompactor ensures no functionResponse has parts array with text (Gemini 400 schema fix)', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    const mockHistory = [
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'capture_screenshot',
              response: { status: 'pruned' },
              parts: [{ text: 'invalid text inside functionResponse.parts' }]
            }
          }
        ]
      }
    ];

    const res = compactor.compact(mockHistory);
    const part = res.compacted[0].parts[0];
    assert.strictEqual(part.functionResponse.parts, undefined, 'Must delete functionResponse.parts containing text');
  });

  await test('ContextCompactor deduplicates older DOM tree snapshots', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    const mockHistory = [
      {
        role: 'user',
        parts: [
          { text: 'First prompt\n\n[Active Page DOM Context]\n## Page: "Test Title"\n| tag | selector |\n| button | #btn |' }
        ]
      },
      {
        role: 'model',
        parts: [{ text: 'Ran query' }]
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'dehydrate_dom',
              response: { dom: '## Page: "Fresh Title"\n| tag | selector |\n| input | #input |' }
            }
          }
        ]
      }
    ];

    const res = compactor.compact(mockHistory, { maxRecentImages: 1 });
    assert.strictEqual(res.prunedDomSnapshots, 1, 'Must deduplicate older DOM snapshot');
    assert.ok(res.compacted[0].parts[0].text.includes('Earlier DOM snapshot pruned'), 'Old DOM snapshot must be trimmed');
    assert.ok(res.compacted[2].parts[0].functionResponse.response.dom.includes('Fresh Title'), 'Fresh DOM snapshot must be preserved');
  });

  await test('ContextCompactor applies sliding-window turn compaction when history exceeds limit', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    // Create a 20-entry history (10 turns)
    const mockHistory = [];
    mockHistory.push({ role: 'user', parts: [{ text: 'Initial Goal: Clean the entire page layout' }] });
    for (let i = 1; i <= 9; i++) {
      mockHistory.push({ role: 'model', parts: [{ text: `Step ${i}: Inspecting element ${i}` }] });
      mockHistory.push({ role: 'user', parts: [{ text: `Follow-up ${i}: Now proceed with step ${i + 1}` }] });
    }
    mockHistory.push({ role: 'model', parts: [{ text: 'Final model response' }] });

    assert.strictEqual(mockHistory.length, 20);

    const res = compactor.compact(mockHistory, { maxRecentTurns: 4 });
    assert.ok(res.compactedTurns > 0, 'Must compact intermediate turns');
    assert.ok(res.compacted.length < 20, 'Compacted history must have fewer total entries');
    assert.strictEqual(res.compacted[0].parts[0].text, 'Initial Goal: Clean the entire page layout', 'Must preserve initial goal');
    assert.ok(res.compacted[1].parts[0].text.includes('Context Compaction Summary'), 'Must summarize intermediate steps');
  });

  await test('ContextCompactor estimates token count accurately across text, images, and tools', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    const sampleHistory = [
      {
        role: 'user',
        parts: [
          { text: 'A'.repeat(400) }, // ~100 tokens
          { inlineData: { mimeType: 'image/jpeg', data: 'B'.repeat(50000) } } // 258 image tokens
        ]
      },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'dehydrate_dom', args: {} } } // ~10 tokens
        ]
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'dehydrate_dom', response: { status: 'ok', dom: 'C'.repeat(400) } } } // ~100 tokens
        ]
      }
    ];

    const tokens = compactor.estimateTokens(sampleHistory);
    assert.ok(tokens >= 400 && tokens <= 600, `Tokens (${tokens}) should be approximately 450-500 tokens`);
  });

  await test('ContextCompactor skips compaction when conversation is under token limit', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    const mockHistory = [
      {
        role: 'user',
        parts: [
          { text: 'Short query' },
          { inlineData: { mimeType: 'image/jpeg', data: 'IMG_1' } }
        ]
      },
      {
        role: 'user',
        parts: [
          { text: 'Second query' },
          { inlineData: { mimeType: 'image/jpeg', data: 'IMG_2' } }
        ]
      }
    ];

    // Under 30,000 token limit: nothing should be compacted or pruned
    const res = compactor.compact(mockHistory, { tokenLimit: 30000, maxRecentImages: 1 });
    assert.strictEqual(res.skipped, true, 'Compaction must be skipped when within token budget');
    assert.strictEqual(res.prunedImages, 0, 'No images should be pruned');
    assert.strictEqual(res.prunedDomSnapshots, 0, 'No DOM snapshots should be pruned');
    assert.strictEqual(res.compactedTurns, 0, 'No turns should be compacted');
    assert.strictEqual(res.compacted[0].parts.some(p => p.inlineData), true, 'First image must remain untouched');
  });

  await test('ContextCompactor triggers progressive compaction when conversation exceeds token limit', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    const mockHistory = [
      {
        role: 'user',
        parts: [
          { text: 'First query' },
          { inlineData: { mimeType: 'image/jpeg', data: 'IMG_1' } }
        ]
      },
      {
        role: 'user',
        parts: [
          { text: 'Second query' },
          { inlineData: { mimeType: 'image/jpeg', data: 'IMG_2' } }
        ]
      }
    ];

    // Tokens before is ~520 (two images = 516 + text). With limit 300, it exceeds and prunes the older image!
    const res = compactor.compact(mockHistory, { tokenLimit: 300, maxRecentImages: 1 });
    assert.strictEqual(res.skipped, false, 'Compaction must run when exceeding token limit');
    assert.strictEqual(res.prunedImages, 1, 'Must prune older screenshot');
    assert.strictEqual(res.compacted[0].parts.some(p => p.inlineData), false, 'Older image must be pruned');
    assert.strictEqual(res.compacted[1].parts.some(p => p.inlineData), true, 'Recent image must be preserved');
    assert.ok(res.tokensAfter < res.tokensBefore, 'Tokens after must be lower than tokens before');
  });

  await test('ContextCompactor.sanitizeAndRepairHistory enforces strict role alternation and repairs function call sequences', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    // Case 1: Interrupted function call followed by user "continue"
    const interruptedHistory = [
      { role: 'user', parts: [{ text: 'Make the header dark' }] },
      {
        role: 'model',
        parts: [
          { text: 'Inspecting...' },
          { functionCall: { name: 'capture_screenshot', args: {} } }
        ]
      },
      // User sent "continue" without a functionResponse!
      { role: 'user', parts: [{ text: 'continue' }] }
    ];

    const repaired1 = compactor.sanitizeAndRepairHistory(interruptedHistory);
    // Unanswered function call must be converted to text so Gemini does not expect a functionResponse
    assert.strictEqual(repaired1[1].role, 'model');
    assert.strictEqual(repaired1[1].parts.some(p => p.functionCall), false, 'Unanswered functionCall must be converted to text');
    assert.ok(repaired1[1].parts.some(p => p.text && p.text.includes('Model planned tool call')), 'Must describe planned tool call');
    assert.strictEqual(repaired1[2].role, 'user');
    assert.strictEqual(repaired1[2].parts[0].text, 'continue');

    // Case 2: User follow-up right after functionResponse (two consecutive user turns)
    const consecutiveUserHistory = [
      { role: 'user', parts: [{ text: 'Goal 1' }] },
      { role: 'model', parts: [{ functionCall: { name: 'apply_userscript', args: { name: 'test', script: '1' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'apply_userscript', response: { status: 'ok' } } }] },
      { role: 'user', parts: [{ text: 'continue' }] }
    ];

    const repaired2 = compactor.sanitizeAndRepairHistory(consecutiveUserHistory);
    // Must insert an acknowledging model turn so roles strictly alternate: user -> model -> user -> model -> user
    assert.strictEqual(repaired2.length, 5, 'Must insert acknowledging model turn');
    assert.strictEqual(repaired2[0].role, 'user');
    assert.strictEqual(repaired2[1].role, 'model');
    assert.strictEqual(repaired2[2].role, 'user');
    assert.strictEqual(repaired2[3].role, 'model', 'Must have intermediate model turn');
    assert.strictEqual(repaired2[4].role, 'user');
    assert.strictEqual(repaired2[4].parts[0].text, 'continue');

    // Case 3: Orphaned functionResponse without preceding functionCall
    const orphanedHistory = [
      { role: 'user', parts: [{ text: 'Prompt' }] },
      { role: 'model', parts: [{ text: 'Just regular text, no functionCall' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'inspect_dom', response: { result: '42' } } }] }
    ];

    const repaired3 = compactor.sanitizeAndRepairHistory(orphanedHistory);
    assert.strictEqual(repaired3[2].parts.some(p => p.functionResponse), false, 'Orphaned functionResponse must be converted to text');
    assert.ok(repaired3[2].parts.some(p => p.text && p.text.includes('Tool result for "inspect_dom"')), 'Must convert to text representation');
  });

  await test('ContextCompactor Stage 3 turn compaction maintains strict user-model alternation and valid function call placement', () => {
    const SidepanelModule = require('../sidepanel/sidepanel.js');
    const compactor = SidepanelModule.ContextCompactor;

    // Build multi-turn ReAct history with tool calls
    const mockHistory = [
      { role: 'user', parts: [{ text: 'Initial Goal: Redesign page header' }] }
    ];

    for (let i = 1; i <= 6; i++) {
      mockHistory.push({
        role: 'model',
        parts: [
          { text: `Executing step ${i}` },
          { functionCall: { name: 'inspect_dom', args: { script: `document.querySelectorAll('.item_${i}').length` } } }
        ]
      });
      mockHistory.push({
        role: 'user',
        parts: [
          { functionResponse: { name: 'inspect_dom', response: { count: i } } }
        ]
      });
      mockHistory.push({
        role: 'model',
        parts: [{ text: `Step ${i} complete.` }]
      });
      mockHistory.push({
        role: 'user',
        parts: [{ text: `Now proceed with step ${i + 1}` }]
      });
    }

    const res = compactor.compact(mockHistory, { maxRecentTurns: 3, tokenLimit: 0, force: true });
    assert.ok(res.compactedTurns > 0, 'Must compact intermediate turns');

    // Verify strict role alternation across the entire compacted history
    for (let i = 0; i < res.compacted.length; i++) {
      const expectedRole = i % 2 === 0 ? 'user' : 'model';
      assert.strictEqual(res.compacted[i].role, expectedRole, `Turn ${i} must have role "${expectedRole}"`);

      // Verify every functionCall turn only comes after a user turn
      if (res.compacted[i].role === 'model' && res.compacted[i].parts.some(p => p.functionCall)) {
        assert.ok(i > 0, 'Function call turn cannot be first turn');
        assert.strictEqual(res.compacted[i - 1].role, 'user', 'Function call turn must come immediately after a user turn');
      }
    }
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
