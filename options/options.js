// options.js - Configuration management for Userscript AI Agent

const apiKeyInput = document.getElementById('apiKey');
const toggleApiKeyBtn = document.getElementById('toggleApiKey');
const modelSelect = document.getElementById('modelSelect');
const customModelInput = document.getElementById('customModelInput');
const customInstructionsInput = document.getElementById('customInstructions');
const maxTurnsInput = document.getElementById('maxTurnsInput');
const autoCompactCheckbox = document.getElementById('autoCompactCheckbox');
const testBtn = document.getElementById('testBtn');
const saveBtn = document.getElementById('saveBtn');
const statusBox = document.getElementById('statusMessage');

// Toggle API key visibility
toggleApiKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleApiKeyBtn.textContent = 'Hide';
  } else {
    apiKeyInput.type = 'password';
    toggleApiKeyBtn.textContent = 'Show';
  }
});

// Toggle custom model input
modelSelect.addEventListener('change', () => {
  if (modelSelect.value === 'custom') {
    customModelInput.style.display = 'block';
    customModelInput.focus();
  } else {
    customModelInput.style.display = 'none';
  }
});

function getEffectiveModel() {
  if (modelSelect.value === 'custom') {
    return customModelInput.value.trim() || 'gemini-flash-latest';
  }
  return modelSelect.value;
}

function showStatus(message, isSuccess = true, autoHideMs = 4000) {
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
  chrome.storage.local.get(
    {
      geminiApiKey: '',
      geminiModel: 'gemini-flash-latest',
      customInstructions: '',
      maxTurns: 15,
      autoCompact: true
    },
    (items) => {
      apiKeyInput.value = items.geminiApiKey || '';
      const model = items.geminiModel || 'gemini-flash-latest';
      const standardOptions = [
        'gemini-flash-latest',
        'gemini-3.5-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash-lite',
        'gemini-3.8-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
      ];

      if (standardOptions.includes(model)) {
        modelSelect.value = model;
        customModelInput.style.display = 'none';
        customModelInput.value = '';
      } else {
        modelSelect.value = 'custom';
        customModelInput.style.display = 'block';
        customModelInput.value = model;
      }

      customInstructionsInput.value = items.customInstructions || '';
      maxTurnsInput.value = items.maxTurns || 15;
      if (autoCompactCheckbox) {
        autoCompactCheckbox.checked = items.autoCompact !== false;
      }
    }
  );
}

// Save settings to chrome.storage.local
function saveOptions() {
  const apiKey = apiKeyInput.value.trim();
  const model = getEffectiveModel();
  const customInstructions = customInstructionsInput.value.trim();
  const maxTurns = parseInt(maxTurnsInput.value, 10) || 15;
  const autoCompact = autoCompactCheckbox ? autoCompactCheckbox.checked : true;

  if (!apiKey) {
    showStatus('Please enter a valid Gemini API Key.', false);
    apiKeyInput.focus();
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  chrome.storage.local.set(
    {
      geminiApiKey: apiKey,
      geminiModel: model,
      customInstructions: customInstructions,
      maxTurns: maxTurns,
      autoCompact: autoCompact
    },
    () => {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Settings';
      showStatus(`Settings saved successfully! Model: ${model}`);
    }
  );
}

// Test connection with Gemini API
async function testConnection() {
  const apiKey = apiKeyInput.value.trim();
  const model = getEffectiveModel();

  if (!apiKey) {
    showStatus('Please enter an API Key first before testing.', false);
    apiKeyInput.focus();
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  statusBox.classList.add('hidden');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
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
  } catch (err) {
    showStatus(`Network or fetch error: ${err.message}`, false, 8000);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreOptions);
} else {
  restoreOptions();
}

saveBtn.addEventListener('click', saveOptions);
testBtn.addEventListener('click', testConnection);
