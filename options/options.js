// options.js - Configuration management for Userscript AI Agent

const aiProviderSelect = document.getElementById('aiProviderSelect');
const geminiSection = document.getElementById('geminiSection');
const openrouterSection = document.getElementById('openrouterSection');

// Gemini inputs
const apiKeyInput = document.getElementById('apiKey');
const toggleApiKeyBtn = document.getElementById('toggleApiKey');
const modelSelect = document.getElementById('modelSelect');
const customModelInput = document.getElementById('customModelInput');

// OpenRouter inputs
const openrouterApiKeyInput = document.getElementById('openrouterApiKey');
const toggleOpenrouterApiKeyBtn = document.getElementById('toggleOpenrouterApiKey');
const openrouterModelSelect = document.getElementById('openrouterModelSelect');
const customOpenrouterModelInput = document.getElementById('customOpenrouterModelInput');

// Common inputs
const customInstructionsInput = document.getElementById('customInstructions');
const maxTurnsInput = document.getElementById('maxTurnsInput');
const autoCompactCheckbox = document.getElementById('autoCompactCheckbox');
const compactThresholdInput = document.getElementById('compactThresholdInput');
const testBtn = document.getElementById('testBtn');
const saveBtn = document.getElementById('saveBtn');
const statusBox = document.getElementById('statusMessage');

if (autoCompactCheckbox && compactThresholdInput) {
  autoCompactCheckbox.addEventListener('change', () => {
    compactThresholdInput.disabled = !autoCompactCheckbox.checked;
  });
}

function updateProviderSections() {
  const provider = aiProviderSelect ? aiProviderSelect.value : 'gemini';
  if (geminiSection && openrouterSection) {
    if (provider === 'openrouter') {
      geminiSection.style.display = 'none';
      openrouterSection.style.display = 'block';
    } else {
      geminiSection.style.display = 'block';
      openrouterSection.style.display = 'none';
    }
  }
}

if (aiProviderSelect) {
  aiProviderSelect.addEventListener('change', updateProviderSections);
}

// Toggle Gemini API key visibility
if (toggleApiKeyBtn && apiKeyInput) {
  toggleApiKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyBtn.textContent = 'Show';
    }
  });
}

// Toggle OpenRouter API key visibility
if (toggleOpenrouterApiKeyBtn && openrouterApiKeyInput) {
  toggleOpenrouterApiKeyBtn.addEventListener('click', () => {
    if (openrouterApiKeyInput.type === 'password') {
      openrouterApiKeyInput.type = 'text';
      toggleOpenrouterApiKeyBtn.textContent = 'Hide';
    } else {
      openrouterApiKeyInput.type = 'password';
      toggleOpenrouterApiKeyBtn.textContent = 'Show';
    }
  });
}

// Toggle custom Gemini model input
if (modelSelect && customModelInput) {
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      customModelInput.style.display = 'block';
      customModelInput.focus();
    } else {
      customModelInput.style.display = 'none';
    }
  });
}

// Toggle custom OpenRouter model input
if (openrouterModelSelect && customOpenrouterModelInput) {
  openrouterModelSelect.addEventListener('change', () => {
    if (openrouterModelSelect.value === 'custom') {
      customOpenrouterModelInput.style.display = 'block';
      customOpenrouterModelInput.focus();
    } else {
      customOpenrouterModelInput.style.display = 'none';
    }
  });
}

function getEffectiveGeminiModel() {
  if (modelSelect && modelSelect.value === 'custom') {
    return (customModelInput ? customModelInput.value.trim() : '') || 'gemini-flash-latest';
  }
  return modelSelect ? modelSelect.value : 'gemini-flash-latest';
}

function getEffectiveOpenRouterModel() {
  if (openrouterModelSelect && openrouterModelSelect.value === 'custom') {
    return (customOpenrouterModelInput ? customOpenrouterModelInput.value.trim() : '') || 'deepseek/deepseek-v4.1-flash';
  }
  return openrouterModelSelect ? openrouterModelSelect.value : 'deepseek/deepseek-v4.1-flash';
}

function getEffectiveModel() {
  const provider = aiProviderSelect ? aiProviderSelect.value : 'gemini';
  return provider === 'openrouter' ? getEffectiveOpenRouterModel() : getEffectiveGeminiModel();
}

function showStatus(message, isSuccess = true, autoHideMs = 4000) {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = `status-box ${isSuccess ? 'success' : 'error'}`;
  statusBox.classList.remove('hidden');

  if (autoHideMs > 0) {
    setTimeout(() => {
      statusBox.classList.add('hidden');
    }, autoHideMs);
  }
}

// Restore saved settings on page load
function restoreOptions() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  chrome.storage.local.get(
    {
      aiProvider: 'gemini',
      geminiApiKey: '',
      geminiModel: 'gemini-flash-latest',
      openrouterApiKey: '',
      openrouterModel: 'deepseek/deepseek-v4.1-flash',
      customInstructions: '',
      maxTurns: 15,
      autoCompact: true,
      compactThreshold: 30000
    },
    (items) => {
      if (aiProviderSelect) {
        aiProviderSelect.value = items.aiProvider || 'gemini';
        updateProviderSections();
      }

      // Restore Gemini options
      if (apiKeyInput) {
        apiKeyInput.value = items.geminiApiKey || '';
      }
      const gemModel = items.geminiModel || 'gemini-flash-latest';
      const standardGemOptions = [
        'gemini-flash-latest',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-2.5-pro',
        'gemini-2.5-flash'
      ];

      if (modelSelect) {
        if (standardGemOptions.includes(gemModel)) {
          modelSelect.value = gemModel;
          if (customModelInput) {
            customModelInput.style.display = 'none';
            customModelInput.value = '';
          }
        } else {
          modelSelect.value = 'custom';
          if (customModelInput) {
            customModelInput.style.display = 'block';
            customModelInput.value = gemModel;
          }
        }
      }

      // Restore OpenRouter options
      if (openrouterApiKeyInput) {
        openrouterApiKeyInput.value = items.openrouterApiKey || '';
      }
      const orModel = items.openrouterModel || 'deepseek/deepseek-v4.1-flash';
      const standardOrOptions = [
        'deepseek/deepseek-v4.1-flash',
        'deepseek/deepseek-v4-pro-0813',
        'deepseek/deepseek-v3.2',
        'deepseek/deepseek-r1',
        'anthropic/claude-fable-5.1',
        'anthropic/claude-sonnet-5',
        'anthropic/claude-opus-5',
        'anthropic/claude-sonnet-4.6',
        'anthropic/claude-haiku-4.5',
        'openai/gpt-6-astra',
        'openai/gpt-6-astra-pro',
        'openai/gpt-5.6-luna',
        'openai/gpt-5.4-mini',
        'openai/gpt-5.3-codex',
        'google/gemini-3.8-flash',
        'google/gemini-3.5-flash',
        'google/gemini-3.5-flash-lite',
        'google/gemini-2.5-pro',
        'qwen/qwen3.8-flash',
        'qwen/qwen3.8-max-0902',
        'qwen/qwen3-coder-plus',
        'mistralai/codestral-2508',
        'mistralai/devstral-2512',
        'meta/muse-spark-1.3',
        'meta-llama/llama-4-maverick',
        'z-ai/glm-5.3-flash'
      ];

      if (openrouterModelSelect) {
        if (standardOrOptions.includes(orModel)) {
          openrouterModelSelect.value = orModel;
          if (customOpenrouterModelInput) {
            customOpenrouterModelInput.style.display = 'none';
            customOpenrouterModelInput.value = '';
          }
        } else {
          openrouterModelSelect.value = 'custom';
          if (customOpenrouterModelInput) {
            customOpenrouterModelInput.style.display = 'block';
            customOpenrouterModelInput.value = orModel;
          }
        }
      }

      if (customInstructionsInput) customInstructionsInput.value = items.customInstructions || '';
      if (maxTurnsInput) maxTurnsInput.value = items.maxTurns || 15;
      if (autoCompactCheckbox) {
        autoCompactCheckbox.checked = items.autoCompact !== false;
      }
      if (compactThresholdInput) {
        compactThresholdInput.value = items.compactThreshold || 30000;
        compactThresholdInput.disabled = items.autoCompact === false;
      }
    }
  );
}

// Save settings to chrome.storage.local
function saveOptions() {
  const provider = aiProviderSelect ? aiProviderSelect.value : 'gemini';
  const geminiApiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
  const geminiModel = getEffectiveGeminiModel();
  const openrouterApiKey = openrouterApiKeyInput ? openrouterApiKeyInput.value.trim() : '';
  const openrouterModel = getEffectiveOpenRouterModel();
  const customInstructions = customInstructionsInput ? customInstructionsInput.value.trim() : '';
  const maxTurns = parseInt(maxTurnsInput ? maxTurnsInput.value : 15, 10) || 15;
  const autoCompact = autoCompactCheckbox ? autoCompactCheckbox.checked : true;
  const compactThreshold = parseInt(compactThresholdInput ? compactThresholdInput.value : 30000, 10) || 30000;

  if (provider === 'gemini' && !geminiApiKey) {
    showStatus('Please enter a valid Gemini API Key.', false);
    if (apiKeyInput) apiKeyInput.focus();
    return;
  }

  if (provider === 'openrouter' && !openrouterApiKey) {
    showStatus('Please enter a valid OpenRouter API Key.', false);
    if (openrouterApiKeyInput) openrouterApiKeyInput.focus();
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  chrome.storage.local.set(
    {
      aiProvider: provider,
      geminiApiKey: geminiApiKey,
      geminiModel: geminiModel,
      openrouterApiKey: openrouterApiKey,
      openrouterModel: openrouterModel,
      customInstructions: customInstructions,
      maxTurns: maxTurns,
      autoCompact: autoCompact,
      compactThreshold: compactThreshold
    },
    () => {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
      }
      const activeModel = provider === 'openrouter' ? openrouterModel : geminiModel;
      const providerName = provider === 'openrouter' ? 'OpenRouter' : 'Google Gemini';
      showStatus(`Settings saved successfully! Provider: ${providerName} (${activeModel})`);
    }
  );
}

// Test connection with active AI API
async function testConnection() {
  const provider = aiProviderSelect ? aiProviderSelect.value : 'gemini';

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
  }
  if (statusBox) statusBox.classList.add('hidden');

  try {
    if (provider === 'openrouter') {
      const apiKey = openrouterApiKeyInput ? openrouterApiKeyInput.value.trim() : '';
      const model = getEffectiveOpenRouterModel();

      if (!apiKey) {
        showStatus('Please enter an OpenRouter API Key first before testing.', false);
        if (openrouterApiKeyInput) openrouterApiKeyInput.focus();
        return;
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/ntdunglc/userscript-ai-agent',
          'X-Title': 'Userscript AI Agent'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: 'Respond with the single word "READY"' }],
          max_tokens: 10
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        let message = `API Error ${response.status}`;
        try {
          const json = JSON.parse(errText);
          if (json.error && json.error.message) {
            message = json.error.message;
          }
        } catch (e) {
          message = errText;
        }

        if (response.status === 401) {
          message = 'Invalid OpenRouter API key. Please check your key at openrouter.ai/keys.';
        } else if (response.status === 402) {
          message = 'Insufficient OpenRouter credits. Please add credits at openrouter.ai/credits.';
        }
        showStatus(`Connection failed: ${message}`, false, 8000);
        return;
      }

      const data = await response.json();
      const replyText = data.choices?.[0]?.message?.content || '';
      showStatus(`Connection successful! Connected to OpenRouter "${model}". Response: ${replyText.trim()}`, true, 5000);
    } else {
      // Google Gemini
      const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      const model = getEffectiveGeminiModel();

      if (!apiKey) {
        showStatus('Please enter a Gemini API Key first before testing.', false);
        if (apiKeyInput) apiKeyInput.focus();
        return;
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: 'Respond with the single word "READY"' }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 10
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        let message = `API Error ${response.status}`;
        try {
          const json = JSON.parse(errText);
          if (json.error && json.error.message) {
            message = json.error.message;
          }
        } catch (e) {
          message = errText;
        }

        if (response.status === 400 && message.toLowerCase().includes('api key not valid')) {
          message = 'Invalid API key. Please check your key from Google AI Studio.';
        } else if (response.status === 404 || (response.status === 400 && message.toLowerCase().includes('not found'))) {
          message = `Model '${model}' not found or not supported by your API key. Try 'gemini-flash-latest' or 'gemini-2.5-flash'.`;
        }
        showStatus(`Connection failed: ${message}`, false, 8000);
        return;
      }

      const data = await response.json();
      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      showStatus(`Connection successful! Connected to "${model}". Response: ${replyText.trim()}`, true, 5000);
    }
  } catch (err) {
    showStatus(`Network or fetch error: ${err.message}`, false, 8000);
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreOptions);
  } else {
    restoreOptions();
  }

  if (saveBtn) saveBtn.addEventListener('click', saveOptions);
  if (testBtn) testBtn.addEventListener('click', testConnection);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getEffectiveGeminiModel,
    getEffectiveOpenRouterModel,
    getEffectiveModel,
    restoreOptions,
    saveOptions,
    testConnection
  };
}
