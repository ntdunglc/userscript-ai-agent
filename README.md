# Userscript AI Agent ⚡

A Manifest V3 Chrome Extension inspired by the **Alibaba Page-Agent** architecture that embeds an autonomous DOM Copilot directly in your browser's Side Panel. 

Chat with Gemini, inspect the active page's DOM, generate custom userscripts to modify styles, hide ads, or add new page features, and save/rerun them like **Tampermonkey** on matching URLs.

---

## 🌟 Key Features

1. **Alibaba Page-Agent In-Page DOM Dehydration**:
   - Scans the active page and dehydrates the DOM into a token-efficient `FlatDomTree` of interactive elements, headings, landmarks, and potential ad/banner containers.
   - Provides exact CSS selectors and element metadata to Gemini without token bloat.

2. **Autonomous Multimodal Vision & Screenshot Perception**:
   - Automatically captures active tab viewports when visual appearance, broken layouts, styling, or banners are mentioned.
   - The agent autonomously invokes `capture_screenshot` to inspect visual renders and verify fixes without requiring manual button clicks.
   - Built-in toolbar screenshot attachment button for manual snapshot sharing with chat thumbnails.

3. **Interactive ReAct / Tool-Calling Loop**:
   - Supports **Gemini Flash Latest**, **Gemini 3.5 Flash-Lite**, **Gemini 3.8 Flash**, **Gemini 2.5 Flash**, or custom model names.
   - High-demand (503) auto-retry and one-click fallback to Flash-Lite.
   - Follow-up message queuing while agent is executing.
   - Agent runs multi-step DOM queries via `inspect_dom` and generates idempotent, TrustedTypes-compliant userscripts via `apply_userscript`.

4. **Tampermonkey-like Script Manager & In-App Editor**:
   - Save scripts with wildcard URL match patterns (e.g. `*://*.youtube.com/*`, `https://github.com/*`, `<all_urls>`).
   - Apex domain and subdomain matching support (`archive.ph` and `*.archive.ph`).
   - Single-text form editor modal with live metadata preview (`// ==UserScript==`), tab indentation, and `Cmd+S` shortcuts.
   - Immediate auto-run upon saving or toggling scripts on matching active tabs.
   - Export and import full JSON backups compatible with Tampermonkey workflows.

5. **Auto-Run with Review Option**:
   - Header toggle for **Auto-Run**:
     - When **ON**: Generated script executes immediately in the active tab with visual status confirmation.
     - When **OFF**: Provides an interactive preview card with `[▶ Run in Page]`, `[💾 Save as Userscript]`, and `[↺ Undo (Reload)]`.

6. **Point-and-Click Element Picker**:
   - Click `[🎯 Pick Element]` to hover over any element on the page with a live highlight outline.
   - Clicking sends the exact CSS selector, tag, classes, and inner text directly into the agent prompt.

7. **Extensive Automated Test Suite**:
   - 24 comprehensive unit tests verifying Manifest V3 integrity, match pattern logic, Tampermonkey metadata parsing, DOM dehydration serialization, and Gemini REST API schema compliance.

---

## 🚀 Quick Start

### 1. Load the Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top right corner.
3. Click **Load unpacked** and select this directory:
   ```
   /Users/dungnguyen/workspace/userscript-ai-agent
   ```
4. Click the extension's `Details` &rarr; `Extension options` (or right-click the extension icon &rarr; `Options`).
5. Enter your **Gemini API Key** (from [Google AI Studio](https://aistudio.google.com/app/apikey)) and click **Test Connection** &rarr; **Save Settings**.

### 2. Using the Extension
1. Click the extension action icon in the Chrome toolbar. The **Userscript AI Agent** side panel will open.
2. Navigate to any website (e.g., YouTube, Hacker News, Reddit, GitHub, or any news site).
3. Type a request or click a suggestion chip:
   - *"Hide all sponsored posts and ads on this page."*
   - *"Make the navigation header sticky with a blurred dark backdrop."*
   - *"Add an export button to the main data table to download rows as CSV."*
4. The agent will dehydrate the DOM, inspect the elements, and inject the userscript into the active page!
5. Click **💾 Save as Userscript** to have it auto-run whenever you visit that domain in the future.

---

## 📂 File Architecture

```
userscript-ai-agent/
├── manifest.json              # Chrome Manifest V3 configuration
├── background.js              # Service worker handling side panel & auto-injecting saved scripts
├── sidepanel/
│   ├── sidepanel.html         # Main UI: Chat view & Saved Scripts manager
│   ├── sidepanel.css          # Modern dark/light responsive layout
│   ├── sidepanel.js           # Agent controller, Gemini ReAct loop, & element picker
│   ├── dom_dehydrator.js      # Alibaba Page-Agent style DOM dehydration engine
│   └── script_manager.js      # Tampermonkey storage, matching & export/import
├── options/
│   ├── options.html           # Settings UI for API key and model selection
│   ├── options.css            # Options page styling
│   └── options.js             # API key verification & storage
├── icons/                     # 16, 32, 48, 128 px icons
└── README.md                  # Documentation
```
