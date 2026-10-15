// ==========================================
// 1. Constants & State
// ==========================================
const STORAGE_KEY = 'aiCharacterAppData';

let appData = {
    aiSettings: {
        provider: 'gemini',
        apiKey: '',
        model: 'gemini-3.8-flash',
        baseUrl: '',
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxTokens: 1024,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        disableReasoning: true,
        openrouterFallbackKey: ''
    },
    adDismissed: false,
    characters: [],
    chats: {}
};

let currentCharacterId = null;
let isGenerating = false;

const TEST_MODELS = {
    openrouter: [
        'google/gemma-2-9b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'meta-llama/llama-3.1-8b-instruct:free',
        'mistralai/mistral-7b-instruct:free',
        'deepseek/deepseek-r1:free'
    ],
    gemini: [
        'gemini-3.8-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemma-4-31b-it',
        'gemma-4-26b-a4b-it',
        'gemma-2-27b-it',
        'gemma-2-9b-it'
    ],
    openai: [
        'gpt-4o-mini',
        'gpt-4o',
        'o1-mini',
        'o3-mini'
    ],
    anthropic: [
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-latest',
        'claude-3-7-sonnet-latest'
    ],
    groq: [
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
        'mixtral-8x7b-32768'
    ],
    ollama: [
        'llama3.3',
        'llama3.2',
        'mistral',
        'gemma2',
        'deepseek-r1'
    ],
    custom: [
        'gpt-4o-mini'
    ]
};

// ==========================================
// 2. Bootstrap
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    renderAdBanner();
    renderCharacterList();
    setupEventListeners();
    updateSettingsUI();
});

// ==========================================
// 3. Persistence
// ==========================================
function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.aiSettings) {
                appData.aiSettings = { ...appData.aiSettings, ...parsed.aiSettings };
            }
            appData = { ...appData, ...parsed, aiSettings: appData.aiSettings };
        }
    } catch (e) {
        console.error('Failed to load data', e);
    }
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
        console.error('Failed to save data', e);
    }
}

// ==========================================
// 4. IndexedDB for avatars
// ==========================================
const DB_NAME = 'CharacterAvatarsDB';
const STORE = 'avatars';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveAvatar(id, file) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(file, id).onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getAvatar(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ==========================================
// 5. Model name normalization
// ==========================================
function normalizeModelName(model, provider) {
    if (!model) return model;
    let m = model.trim();
    if (provider === 'gemini') {
        m = m.replace(/^[a-zA-Z0-9_-]+\//, '');
        m = m.replace(/:[a-zA-Z0-9_-]+$/, '');
    } else if (provider === 'openrouter') {
        if (!m.includes('/') && (m.startsWith('gemma') || m.startsWith('gemini'))) {
            m = 'google/' + m;
        }
    }
    return m;
}

// ==========================================
// 6. Aggressive sanitizer
// ==========================================
function cleanAIResponse(raw, characterName) {
    if (!raw) return '';
    let reply = raw;

    const lines = raw.split('\n');
    let firstRealIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (/^\*\s*[A-Za-z][A-Za-z\s/]+:\s*/.test(l)) continue;
        if (/^\*?\s*(User asks|Character|Input context|Internal state|Motivation|Emotion|Direct response|Dialogue|Length|Format|Followed by|No meta-text|First person|THOUGHT)\b/i.test(l)) continue;
        firstRealIdx = i;
        break;
    }
    if (firstRealIdx > 0) reply = lines.slice(firstRealIdx).join('\n');

    reply = reply.replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '');
    reply = reply.replace(/\[\/?REASONING\]/gi, '');

    const headerLines = [
        /^\s*\*\s*format\s*:.*\$/gim,
        /^\s*\*\s*user\s+asks?\s*:.*\$/gim,
        /^\s*\*\s*character\s*:.*\$/gim,
        /^\s*\*\s*input\s+context\s*:.*\$/gim,
        /^\s*\*\s*internal\s+state\s*:.*\$/gim,
        /^\s*\*\s*motivation\s*:.*\$/gim,
        /^\s*\*\s*emotion\s*:.*\$/gim,
        /^\s*\*\s*direct\s+response\s*:.*\$/gim,
        /^\s*\*\s*dialogue\s*\/\s*action\s*:.*\$/gim,
        /^\s*\*\s*length\s*:.*\$/gim,
        /^\s*\*\s*followed\s+by.*\$/gim,
        /^\s*\*\s*no\s+meta-text.*\$/gim,
        /^\s*\*\s*first\s+person.*\$/gim
    ];
    for (const p of headerLines) reply = reply.replace(p, '');

    const prefixes = [
        /^\s*\*?\s*(reasoning|analysis|thoughts?|thinking|internal monologue|chain of thought|let me think|okay,?\s*so)\s*[:\-]?\s*[\s\S]*?(?=\n\n|\$)/i,
        /^\s*(as an ai|i'm an ai|i am an ai|as a language model)\s*[:\-]?\s*[\s\S]*?(?=\n\n|\$)/i,
        /^\s*\*?[^*\n]{0,120}?\*?\s*(reaction|response|body language|personality|context|scenario|note)\s*[:\-]\s*[\s\S]*?(?=\n\n|\$)/i
    ];
    for (const p of prefixes) reply = reply.replace(p, '');

    if (characterName) {
        const esc = characterName.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
        reply = reply.replace(new RegExp(`^\\s*\\*?\\s*${esc}\\s*\\*?\\s*:\\s*`, 'i'), '');
    }

    const trailing = reply.search(/\n\s*\*?\s*(reasoning|analysis|thoughts?|note|ooc|end of response|format)\s*[:\-]/i);
    if (trailing !== -1) reply = reply.slice(0, trailing);

    reply = reply.replace(/^\s*THOUGHT\s*:\s*[\s\S]*?(?=\n\n|\$)/i, '');
    reply = reply.replace(/\n{3,}/g, '\n\n').trim();

    if (!reply) {
        const fallback = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const spoken = fallback.reverse().find(l => /^["*]/.test(l) && !/^\*\s*\w+\s*:/.test(l));
        reply = spoken || fallback[0] || raw.trim();
    }

    return reply;
}

// ==========================================
// 7. Ad banner
// ==========================================
function renderAdBanner() {
    const banner = document.getElementById('ad-banner');
    const toggle = document.getElementById('show-ads-toggle');
    if (!banner || !toggle) return;
    if (appData.adDismissed) {
        banner.classList.add('hidden');
        toggle.checked = false;
    } else {
        banner.classList.remove('hidden');
        toggle.checked = true;
    }
}

function dismissAd() {
    appData.adDismissed = true;
    saveData();
    renderAdBanner();
}

// ==========================================
// 8. Event listeners
// ==========================================
function setupEventListeners() {
    document.getElementById('close-ad')?.addEventListener('click', dismissAd);

    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const openDrawer = () => { sidebar.classList.add('open'); overlay.classList.remove('hidden'); };
    const closeDrawer = () => { sidebar.classList.remove('open'); overlay.classList.add('hidden'); };

    document.getElementById('mobile-menu-btn')?.addEventListener('click', openDrawer);
    document.getElementById('mobile-settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    overlay?.addEventListener('click', closeDrawer);

    document.getElementById('add-char-btn')?.addEventListener('click', () => openModal('character-modal'));
    document.getElementById('settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('clear-chat-btn')?.addEventListener('click', clearCurrentChat);

    document.getElementById('message-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    const ta = document.getElementById('message-input');
    ta?.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    });

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    document.getElementById('provider-select')?.addEventListener('change', (e) => {
        document.getElementById('base-url-group').style.display = e.target.value === 'custom' ? 'flex' : 'none';
        updateModelDropdown(e.target.value);
    });
    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
    document.getElementById('test-models-btn')?.addEventListener('click', testAndAutoSelectModel);
    document.getElementById('show-ads-toggle')?.addEventListener('change', (e) => {
        appData.adDismissed = !e.target.checked;
        saveData();
        renderAdBanner();
    });

    document.getElementById('temperature-slider')?.addEventListener('input', (e) => {
        document.getElementById('temperature-value').textContent = e.target.value;
    });
    document.getElementById('top-p-slider')?.addEventListener('input', (e) => {
        document.getElementById('top-p-value').textContent = e.target.value;
    });
    document.getElementById('top-k-slider')?.addEventListener('input', (e) => {
        document.getElementById('top-k-value').textContent = e.target.value;
    });
    document.getElementById('max-tokens-input')?.addEventListener('input', (e) => {
        document.getElementById('max-tokens-value').textContent = e.target.value;
    });

    document.getElementById('disable-reasoning-toggle')?.addEventListener('change', (e) => {
        appData.aiSettings.disableReasoning = e.target.checked;
        saveData();
    });

    document.getElementById('save-char-btn')?.addEventListener('click', saveCharacter);
    document.getElementById('import-png')?.addEventListener('change', handlePngImport);

    document.getElementById('search-input')?.addEventListener('input', (e) => {
        renderCharacterList(e.target.value);
    });
}

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

// ==========================================
// 9. Toast & Settings Helpers
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icons = { info: 'ℹ️', error: '⚠️', success: '✅' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 320);
    }, 4000);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function updateModelDropdown(provider) {
    const modelSelect = document.getElementById('model-select');
    if (!modelSelect) return;
    modelSelect.innerHTML = '';
    const models = TEST_MODELS[provider] || TEST_MODELS.gemini;
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === appData.aiSettings.model) opt.selected = true;
        modelSelect.appendChild(opt);
    });
}

function updateSettingsUI() {
    const settings = appData.aiSettings;
    const providerSelect = document.getElementById('provider-select');
    if (providerSelect) providerSelect.value = settings.provider;

    updateModelDropdown(settings.provider);

    const apiKeyInput = document.getElementById('api-key-input');
    if (apiKeyInput) apiKeyInput.value = settings.apiKey || '';

    const fallbackKeyInput = document.getElementById('openrouter-fallback-key-input');
    if (fallbackKeyInput) fallbackKeyInput.value = settings.openrouterFallbackKey || '';

    const baseUrlGroup = document.getElementById('base-url-group');
    if (baseUrlGroup) baseUrlGroup.style.display = settings.provider === 'custom' ? 'flex' : 'none';

    const baseUrlInput = document.getElementById('base-url-input');
    if (baseUrlInput) baseUrlInput.value = settings.baseUrl || '';

    ['temperature', 'top-p', 'top-k', 'max-tokens'].forEach(id => {
        const slider = document.getElementById(`${id}-slider` + (id === 'max-tokens' ? '-input' : ''));
        const valSpan = document.getElementById(`${id}-value`);
        const keyMap = { 'temperature': 'temperature', 'top-p': 'topP', 'top-k': 'topK', 'max-tokens': 'maxTokens' };
        if (slider && settings[keyMap[id]] !== undefined) {
            slider.value = settings[keyMap[id]];
            if (valSpan) valSpan.textContent = settings[keyMap[id]];
        }
    });

    const reasoningToggle = document.getElementById('disable-reasoning-toggle');
    if (reasoningToggle) reasoningToggle.checked = settings.disableReasoning !== false;
}

function saveSettings() {
    const provider = document.getElementById('provider-select')?.value || 'gemini';
    const model = document.getElementById('model-select')?.value || 'gemini-3.8-flash';
    const apiKey = document.getElementById('api-key-input')?.value.trim() || '';
    const fallbackKey = document.getElementById('openrouter-fallback-key-input')?.value.trim() || '';
    const baseUrl = document.getElementById('base-url-input')?.value.trim() || '';

    appData.aiSettings = {
        ...appData.aiSettings,
        provider,
        model,
        apiKey,
        openrouterFallbackKey: fallbackKey,
        baseUrl,
        temperature: parseFloat(document.getElementById('temperature-slider')?.value || 0.7),
        topP: parseFloat(document.getElementById('top-p-slider')?.value || 0.95),
        topK: parseInt(document.getElementById('top-k-slider')?.value || 40),
        maxTokens: parseInt(document.getElementById('max-tokens-input')?.value || 1024),
        disableReasoning: document.getElementById('disable-reasoning-toggle')?.checked ?? true
    };

    saveData();
    closeModal('settings-modal');
    showToast('Settings saved successfully', 'success');
}

function clearAllData() {
    if (!confirm('Are you sure you want to wipe all characters, chats, and settings?')) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
}

// ==========================================
// 10. Automated Model Pinging & Auto-Select
// ==========================================
async function testAndAutoSelectModel() {
    const provider = document.getElementById('provider-select')?.value || appData.aiSettings.provider;
    const apiKey = document.getElementById('api-key-input')?.value.trim() || appData.aiSettings.apiKey;
    const baseUrl = document.getElementById('base-url-input')?.value.trim() || appData.aiSettings.baseUrl;
    const models = TEST_MODELS[provider];

    if (!models || models.length === 0) {
        showToast('No test models available for this provider.', 'error');
        return;
    }

    if (!apiKey && provider !== 'ollama') {
        showToast(`Please enter a valid API key for ${provider} first.`, 'error');
        return;
    }

    showToast(`Pinging ${models.length} models for ${provider}...`, 'info');

    for (const model of models) {
        try {
            showToast(`Testing model: ${model}...`, 'info');
            const success = await pingModel(provider, model, apiKey, baseUrl);
            if (success) {
                // Apply to app data and update dropdown textbox
                appData.aiSettings.provider = provider;
                appData.aiSettings.apiKey = apiKey;
                appData.aiSettings.model = model;
                saveData();
                updateSettingsUI();
                showToast(`Success! Auto-selected working model: ${model}`, 'success');
                return;
            }
        } catch (err) {
            console.warn(`Model ${model} failed ping test:`, err.message);
        }
    }

    showToast('All models failed for this provider. Check your API key or quota.', 'error');
}

async function pingModel(provider, model, apiKey, baseUrl) {
    let url, headers, body;
    const testMessages = [{ role: 'user', content: 'Hi' }];
    const normalizedModel = normalizeModelName(model, provider);

    // Strictly separate providers using their own specific endpoint format and key
    switch (provider) {
        case 'openrouter':
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;

        case 'gemini':
            url = `https://generativelanguage.googleapis.com/v1beta/models/${normalizedModel}:generateContent?key=${apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] };
            break;

        case 'openai':
            url = 'https://api.openai.com/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;

        case 'anthropic':
            url = 'https://api.anthropic.com/v1/messages';
            headers = {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            };
            body = { model: normalizedModel, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] };
            break;

        case 'groq':
            url = 'https://api.groq.com/openai/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;

        case 'ollama':
            url = (baseUrl || 'http://localhost:11434') + '/v1/chat/completions';
            headers = { 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;

        case 'custom':
            if (!baseUrl) return false;
            url = baseUrl + '/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;

        default:
            return false;
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return res.ok;
}

function handlePngImport(e) {
    // Stub or placeholder for character card PNG import
}

// ==========================================
// 11. Character rendering
// ==========================================
async function renderCharacterList(searchTerm = '') {
    const list = document.getElementById('character-list');
    if (!list) return;
    list.innerHTML = '';

    const term = searchTerm.toLowerCase();
    const filtered = appData.characters.filter(c => c.name.toLowerCase().includes(term));

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:20px;text-align:center;font-size:12.5px;color:var(--text-3);';
        empty.textContent = appData.characters.length === 0 ? 'No characters yet. Click + to create one.' : 'No matches.';
        list.appendChild(empty);
        return;
    }

    for (const char of filtered) {
        const card = document.createElement('div');
        card.className = `character-card ${char.id === currentCharacterId ? 'active' : ''}`;

        let avatarSrc = '';
        if (char.avatarId) {
            const blob = await getAvatar(char.avatarId);
            if (blob) avatarSrc = URL.createObjectURL(blob);
        }
        if (!avatarSrc) avatarSrc = defaultAvatar();

        card.innerHTML = `
            <img src="${avatarSrc}" alt="">
            <div class="char-details">
                <h3>${escapeHtml(char.name)}</h3>
                <p>${escapeHtml(char.intro || 'No description')}</p>
            </div>
        `;
        card.addEventListener('click', () => {
            selectCharacter(char.id);
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
                document.getElementById('sidebar-overlay').classList.add('hidden');
            }
        });
        list.appendChild(card);
    }
}

function defaultAvatar() {
    return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4YjVjZjgwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDIxdi0yYTQgNCAwIDAgMC00LTRoOGE0IDQgMCAwIDAgNC00djIiPjxlcGF0aD48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIgcj0iNCI+PC9jaXJjbGU+PC9zdmc+";
}

async function selectCharacter(id) {
    currentCharacterId = id;
    renderCharacterList(document.getElementById('search-input').value);

    const char = appData.characters.find(c => c.id === id);
    if (!char) return;

    document.getElementById('chat-name').textContent = char.name;
    document.getElementById('chat-subtitle').textContent = char.intro || 'Ready to chat';

    const avatarImg = document.getElementById('chat-avatar');
    if (char.avatarId) {
        const blob = await getAvatar(char.avatarId);
        if (blob) {
            avatarImg.src = URL.createObjectURL(blob);
            avatarImg.classList.remove('hidden');
        }
    } else {
        avatarImg.classList.add('hidden');
    }

    const input = document.getElementById('message-input');
    input.disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('clear-chat-btn').classList.remove('hidden');
    renderChat();
}

// ==========================================
// 12. Character creation
// ==========================================
function saveCharacter() {
    const name = document.getElementById('char-name').value.trim();
    if (!name) return showToast('Name is required', 'error');

    const newChar = {
        id: Date.now().toString(),
        name,
        gender: document.getElementById('char-gender').value,
        intro: document.getElementById('char-intro').value.trim(),
        greetings: document.getElementById('char-greetings').value.trim(),
        backstory: document.getElementById('char-backstory').value.trim(),
        privateOnly: document.getElementById('char-private').checked,
        tags: document.getElementById('char-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        createdAt: new Date().toISOString(),
        avatarId: null
    };

    const fileInput = document.getElementById('char-avatar-file') || document.getElementById('char-avatar');
    const file = fileInput?.files?.[0];
    if (file) {
        newChar.avatarId = newChar.id;
        saveAvatar(newChar.id, file).catch(console.error);
    }

    appData.characters.push(newChar);
    appData.chats[newChar.id] = [];
    if (newChar.greetings) {
        appData.chats[newChar.id].push({ role: 'assistant', content: newChar.greetings, ts: Date.now() });
    }

    saveData();
    closeModal('character-modal');

    ['char-name', 'char-intro', 'char-greetings', 'char-backstory', 'char-tags'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    if (fileInput) fileInput.value = '';
    const privateToggle = document.getElementById('char-private');
    if (privateToggle) privateToggle.checked = false;

    renderCharacterList();
    showToast(`Character "${newChar.name}" created`, 'success');
    selectCharacter(newChar.id);
}

// ==========================================
// 13. Chat rendering
// ==========================================
function renderChat() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    container.innerHTML = '';

    if (!currentCharacterId) return;
    const messages = appData.chats[currentCharacterId] || [];

    if (messages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-orb"></div>
                <h3>No conversation yet</h3>
                <p>Send a message to begin.</p>
            </div>
        `;
        return;
    }

    messages.forEach((msg, index) => {
        const el = document.createElement('div');
        el.className = `message ${msg.role}`;

        const text = document.createElement('div');
        text.className = 'message-text';
        text.textContent = msg.content;
        el.appendChild(text);

        const actions = document.createElement('div');
        actions.className = 'message-actions';

        if (msg.role === 'user') {
            const editBtn = document.createElement('button');
            editBtn.className = 'msg-action-btn';
            editBtn.title = 'Edit';
            editBtn.textContent = '✏️';
            editBtn.addEventListener('click', (e) => { e.stopPropagation(); startEditMessage(index); });
            actions.appendChild(editBtn);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'msg-action-btn';
        delBtn.title = 'Delete';
        delBtn.textContent = '🗑️';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteMessage(index); });
        actions.appendChild(delBtn);

        el.appendChild(actions);
        container.appendChild(el);
    });

    container.scrollTop = container.scrollHeight;
}

function startEditMessage(index) {
    if (!currentCharacterId) return;
    const messages = appData.chats[currentCharacterId] || [];
    const msg = messages[index];
    if (!msg || msg.role !== 'user') return;

    const input = document.getElementById('message-input');
    input.value = msg.content;
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';

    messages.splice(index);
    saveData();
    renderChat();
    showToast('Message loaded — edit and send', 'info');
}

function deleteMessage(index) {
    if (!currentCharacterId) return;
    const messages = appData.chats[currentCharacterId] || [];
    if (index < 0 || index >= messages.length) return;
    messages.splice(index, 1);
    saveData();
    renderChat();
    showToast('Message deleted', 'info');
}

function addMessageToChat(role, content) {
    if (!currentCharacterId) return;
    if (!appData.chats[currentCharacterId]) appData.chats[currentCharacterId] = [];
    appData.chats[currentCharacterId].push({ role, content, ts: Date.now() });
    saveData();
    renderChat();
}

// ==========================================
// 14. Send message
// ==========================================
async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || isGenerating || !currentCharacterId) return;

    input.value = '';
    input.style.height = 'auto';
    addMessageToChat('user', text);

    const container = document.getElementById('messages-container');
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;

    isGenerating = true;
    document.getElementById('send-btn').disabled = true;

    try {
        const char = appData.characters.find(c => c.id === currentCharacterId);
        const raw = await callAIProviderWithFallback(char);
        document.getElementById('typing-indicator')?.remove();
        const reply = cleanAIResponse(raw, char.name);
        addMessageToChat('assistant', reply);
    } catch (error) {
        document.getElementById('typing-indicator')?.remove();
        showToast(error.message, 'error');
    } finally {
        isGenerating = false;
        document.getElementById('send-btn').disabled = false;
        input.focus();
    }
}

function clearCurrentChat() {
    if (!currentCharacterId) return;
    if (!confirm('Clear chat history for this character?')) return;
    const char = appData.characters.find(c => c.id === currentCharacterId);
    appData.chats[currentCharacterId] = [];
    if (char?.greetings) {
        appData.chats[currentCharacterId].push({ role: 'assistant', content: char.greetings, ts: Date.now() });
    }
    saveData();
    renderChat();
    showToast('Chat cleared', 'success');
}

// ==========================================
// 15. Provider integration
// ==========================================
async function callAIProviderWithFallback(character) {
    const settings = appData.aiSettings;
    let primaryError = null;

    try {
        return await callAIProvider(character, settings);
    } catch (error) {
        primaryError = error;
        console.warn(`Primary (${settings.provider}) failed:`, error.message);
    }

    const fbKey = settings.openrouterFallbackKey;
    if (settings.provider !== 'openrouter' && fbKey) {
        try {
            return await callAIProvider(character, {
                ...settings,
                provider: 'openrouter',
                apiKey: fbKey,
                model: 'google/gemma-2-9b-it:free'
            });
        } catch (fbErr) {
            console.warn('OpenRouter fallback failed:', fbErr.message);
            throw new Error(`Primary failed: ${primaryError.message}. Fallback failed: ${fbErr.message}`);
        }
    }

    throw new Error(primaryError.message);
}

async function callAIProvider(character, settings) {
    if (!settings.apiKey && settings.provider !== 'ollama') {
        throw new Error('API key missing — open Settings and paste your key.');
    }

    const model = normalizeModelName(settings.model, settings.provider);
    const messages = appData.chats[currentCharacterId] || [];

    const systemPrompt = `You are ${character.name}. Gender: ${character.gender}.

BACKGROUND (silent context — never quote or reference it):
${character.backstory}

YOU MUST FOLLOW THESE RULES EXACTLY:

1. Reply as ${character.name}, first person ONLY.
2. Output ONLY dialogue and *brief actions in asterisks*.
3. Do NOT think. Do NOT plan. Do NOT reason. Do NOT narrate thoughts.
4. Do NOT output any of these words anywhere in your reply:
    reasoning, analysis, thought, thinking, plan, note, context,
    format, character:, user:, reaction, response:, length:,
    internal, motivation, emotion, dialogue:, follow, reply.
5. Do NOT use any labels, headers, bullets, or numbered lists.
6. Do NOT use square brackets or anything inside them.
7. Do NOT describe yourself in third person.
8. Do NOT write the user's words or actions.
9. Do NOT mention being an AI or an assistant.
10. Do NOT preface. Do NOT explain. Do NOT summarize.

You answer directly, in character, and stop.
Length: 1 to 4 sentences, natural and conversational.

Now answer the user's last message.`;

    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const gen = {
        temperature: Number(settings.temperature ?? 0.7),
        topP: Number(settings.topP ?? 0.95),
        topK: Number(settings.topK ?? 40),
        maxTokens: Number(settings.maxTokens ?? 1024)
    };

    const killThinking = settings.disableReasoning !== false;

    let url, headers, body;

    switch (settings.provider) {
        case 'openrouter':
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = {
                model,
                messages: apiMessages,
                temperature: gen.temperature,
                top_p: gen.topP,
                top_k: gen.topK,
                max_tokens: gen.maxTokens,
                frequency_penalty: Number(settings.frequencyPenalty ?? 0),
                presence_penalty: Number(settings.presencePenalty ?? 0)
            };
            if (killThinking) {
                body.reasoning = { effort: 'none', exclude: true };
            }
            break;

        case 'gemini':
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = {
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: apiMessages
                    .filter(m => m.role !== 'system')
                    .map(m => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    })),
                generationConfig: {
                    temperature: gen.temperature,
                    topP: gen.topP,
                    topK: gen.topK,
                    maxOutputTokens: gen.maxTokens
                }
            };
            if (killThinking && (model.includes('gemini-2.5') || model.includes('gemini-3'))) {
                body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
            }
            break;

        case 'openai':
            url = 'https://api.openai.com/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = {
                model,
                messages: apiMessages,
                temperature: gen.temperature,
                top_p: gen.topP,
                max_tokens: gen.maxTokens,
                frequency_penalty: Number(settings.frequencyPenalty ?? 0),
                presence_penalty: Number(settings.presencePenalty ?? 0)
            };
            break;

        case 'anthropic':
            url = 'https://api.anthropic.com/v1/messages';
            headers = {
                'x-api-key': settings.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            };
            body = {
                model,
                max_tokens: gen.maxTokens,
                temperature: gen.temperature,
                top_p: gen.topP,
                system: systemPrompt,
                messages: apiMessages.filter(m => m.role !== 'system').map(m => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content
                }))
            };
            break;

        case 'groq':
            url = 'https://api.groq.com/openai/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = {
                model,
                messages: apiMessages,
                temperature: gen.temperature,
                top_p: gen.topP,
                max_tokens: gen.maxTokens
            };
            break;

        case 'ollama':
            url = (settings.baseUrl || 'http://localhost:11434') + '/v1/chat/completions';
            headers = { 'Content-Type': 'application/json' };
            body = {
                model,
                messages: apiMessages,
                temperature: gen.temperature,
                top_p: gen.topP,
                top_k: gen.topK,
                max_tokens: gen.maxTokens
            };
            break;

        case 'custom':
            url = settings.baseUrl + '/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = {
                model,
                messages: apiMessages,
                temperature: gen.temperature,
                top_p: gen.topP,
                max_tokens: gen.maxTokens
            };
            break;

        default: throw new Error('Unsupported provider');
    }

    try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const apiMsg = err.error?.message || err.message || `HTTP ${res.status}`;

            if (settings.provider === 'gemini' && /quota|limit: 0|free_tier/i.test(apiMsg)) {
                throw new Error(`Gemini free tier exhausted for this project. Try a new Google Cloud project or switch to OpenRouter.`);
            }
            if (settings.provider === 'openrouter' && /auth/i.test(apiMsg)) {
                throw new Error(`OpenRouter rejected your key. Keys must start with "sk-or-". Get one at openrouter.ai/keys`);
            }
            throw new Error(apiMsg);
        }

        const data = await res.json();
        let text = '';
        if (settings.provider === 'gemini') {
            if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
            text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (settings.provider === 'anthropic') {
            text = data.content?.[0]?.text || '';
        } else {
            text = data.choices?.[0]?.message?.content || '';
        }

        return text;
    } catch (fetchErr) {
        throw fetchErr;
    }
}
