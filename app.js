/* ============================================================================
   Hubs — app.js (Fixed & Optimized)
   ============================================================================ */

const STORAGE_KEY = 'aiCharacterAppData';
const HISTORY_LIMIT = 40;
const SIDEBAR_AD_KEY = 'hubs_sidebar_ad_dismissed';
const POPUNDER_KEY = 'hubs_popunder_enabled';
const POPUNDER_LAST_KEY = 'hubs_popunder_last_armed';
const POPUNDER_COOLDOWN_MS = 30 * 60 * 1000;

const PROVIDERS = {
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it:free', editableUrl: false },
    gemini:     { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', editableUrl: false },
    openai:     { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', editableUrl: false },
    anthropic:  { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', editableUrl: false },
    groq:       { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', editableUrl: false },
    ollama:     { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', editableUrl: true },
    custom:     { baseUrl: '', model: '', editableUrl: true }
};

const ADSTERRA = {
    topBanner: {
        containerId: 'container-a3f099d87b664187036e6176973d0255',
        scriptSrc: 'https://archeryconditionssniff.com/a3f099d87b664187036e6176973d0255/invoke.js'
    },
    popunder: {
        scriptSrc: 'https://archeryconditionssniff.com/a1/e6/0b/a1e60b63132f321aa7152ef962227e12.js'
    }
};

const SIDEBAR_PLACEMENTS = [
    { wrap: 'sidebar-ad', slot: 'sidebar-ad-slot', house: 'sidebar-house', btn: 'sidebar-house-btn', close: 'sidebar-ad-close' },
    { wrap: 'mobile-ad',  slot: 'mobile-ad-slot',  house: 'mobile-house',  btn: 'mobile-house-btn',  close: 'mobile-ad-close' }
];

function defaultAppData() {
    return {
        aiSettings: {
            provider: 'gemini',
            apiKey: '',
            model: 'gemini-2.5-flash',
            baseUrl: '',
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxTokens: 1024,
            disableReasoning: true
        },
        adDismissed: false,
        characters: [],
        chats: {},
        lastCharacterId: null
    };
}

let appData = defaultAppData();
let currentCharacterId = null;
let isGenerating = false;
let pendingImportAvatar = null;
let topBannerLoaded = false;
let popunderLoaded = false;

/* ============================================================================
   BOOTSTRAP
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupEventListeners();
    restoreSession();
    initAds();
    initSupport();
    updateSettingsUI();
});

function restoreSession() {
    const id = appData.lastCharacterId;
    currentCharacterId = getCharacter(id) ? id : (appData.characters[0]?.id || null);
    renderAll();
}

function renderAll() {
    renderCharacterList();
    updateHeader();
    renderMessages();
    updateComposerState();
}

/* ============================================================================
   PERSISTENCE
   ============================================================================ */
function loadData() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
    if (!raw) return;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;

        if (parsed.aiSettings && typeof parsed.aiSettings === 'object') {
            appData.aiSettings = { ...appData.aiSettings, ...parsed.aiSettings };
        }
        if (Array.isArray(parsed.characters)) {
            appData.characters = parsed.characters
                .filter(c => c && c.id && c.name)
                .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }));
        }
        if (parsed.chats && typeof parsed.chats === 'object') appData.chats = parsed.chats;
        if (typeof parsed.adDismissed === 'boolean') appData.adDismissed = parsed.adDismissed;
        if (typeof parsed.lastCharacterId === 'string') appData.lastCharacterId = parsed.lastCharacterId;
    } catch (e) {
        console.error('Error loading data', e);
    }
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        return true;
    } catch (e) {
        showToast('Storage full or unavailable.', 'error');
        return false;
    }
}

function getCharacter(id) {
    return appData.characters.find(c => c.id === id) || null;
}

function getChat(id) {
    if (!Array.isArray(appData.chats[id])) appData.chats[id] = [];
    return appData.chats[id];
}

function newId() {
    return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ============================================================================
   HELPERS
   ============================================================================ */
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMessage(text) {
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/gs, '<em style="color:inherit;opacity:.72;font-style:italic">$1</em>');
}

function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v == null ? '' : v;
}

function setChecked(id, v) {
    const el = document.getElementById(id);
    if (el) el.checked = !!v;
}

function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v == null ? '' : String(v);
}

function defaultAvatarDataUri(name) {
    const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#d946ef"/>
        </linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="url(#g)"/>
        <text x="32" y="42" font-size="30" font-family="system-ui,sans-serif"
              font-weight="700" fill="#fff" text-anchor="middle">${letter}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function normalizeModelName(model, provider) {
    if (!model) return model;
    let m = model.trim();
    if (provider === 'gemini') {
        m = m.replace(/^models\//, '');
        m = m.replace(/^[a-zA-Z0-9_-]+\//, '');
        m = m.replace(/:[a-zA-Z0-9_-]+$/, '');
    } else if (provider === 'openrouter') {
        if (!m.includes('/') && (m.startsWith('gemma') || m.startsWith('gemini'))) {
            m = 'google/' + m;
        }
    }
    return m;
}

function cleanAIResponse(raw, characterName) {
    if (!raw) return '';
    let reply = raw.replace(/[REASONING][\s\S]*?\[\/REASONING\]/gi, '').trim();
    if (characterName) {
        const esc = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        reply = reply.replace(new RegExp(`^\\s*\\*?\\s*${esc}\\s*\\*?\\s*:\\s*`, 'i'), '');
    }
    return reply || raw.trim();
}

/* ============================================================================
   ADS & UI LOGIC
   ============================================================================ */
function renderTopAd() {
    const banner = document.getElementById('ad-banner');
    if (!banner) return;
    if (appData.adDismissed) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'flex';
}

function dismissTopAd() {
    appData.adDismissed = true;
    saveData();
    const banner = document.getElementById('ad-banner');
    if (banner) banner.style.display = 'none';
    setChecked('show-ads-toggle', false);
    showToast('Top banner disabled.', 'info');
}

function isPopunderEnabled() {
    try { return localStorage.getItem(POPUNDER_KEY) !== '0'; } catch (_) { return true; }
}

function isSidebarAdHidden() {
    try { return localStorage.getItem(SIDEBAR_AD_KEY) === '1'; } catch (_) { return false; }
}

function setSidebarAdHidden(hidden) {
    try { localStorage.setItem(SIDEBAR_AD_KEY, hidden ? '1' : '0'); } catch (_) {}
    applySidebarVisibility();
}

function applySidebarVisibility() {
    const hidden = isSidebarAdHidden();
    for (const p of SIDEBAR_PLACEMENTS) {
        const el = document.getElementById(p.wrap);
        if (el) el.classList.toggle('hidden', hidden);
    }
}

function initAds() {
    renderTopAd();
    applySidebarVisibility();
}

function initSupport() {}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 200);
    }, 3000);
}

/* ============================================================================
   EVENT LISTENERS
   ============================================================================ */
function setupEventListeners() {
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => toggleSidebar(true));
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => toggleSidebar(false));
    document.getElementById('mobile-settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('settings-btn')?.addEventListener('click', () => openModal('settings-modal'));

    document.getElementById('close-ad')?.addEventListener('click', () => openModal('disable-ads-modal'));
    document.getElementById('confirm-disable-ads')?.addEventListener('click', () => {
        dismissTopAd();
        closeModal('disable-ads-modal');
    });
    document.getElementById('keep-ads')?.addEventListener('click', () => closeModal('disable-ads-modal'));
    document.getElementById('sidebar-ad-close')?.addEventListener('click', () => setSidebarAdHidden(true));
    document.getElementById('mobile-ad-close')?.addEventListener('click', () => setSidebarAdHidden(true));

    document.getElementById('add-char-btn')?.addEventListener('click', () => openCharacterModal());
    document.getElementById('save-char-btn')?.addEventListener('click', saveCharacterFromModal);
    document.getElementById('search-input')?.addEventListener('input', (e) => filterCharacterList(e.target.value));

    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('message-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById('clear-chat-btn')?.addEventListener('click', clearCurrentChat);

    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettingsFromModal);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
    document.getElementById('provider-select')?.addEventListener('change', (e) => handleProviderChange(e.target.value));
    
    // Model test button wiring
    document.getElementById('test-models-btn')?.addEventListener('click', testAIModel);

    setupSliderSync('temperature-slider', 'temperature-value');
    setupSliderSync('top-p-slider', 'top-p-value');
    setupSliderSync('top-k-slider', 'top-k-value');

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.getAttribute('data-modal')));
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });
}

function toggleSidebar(open) {
    document.getElementById('sidebar')?.classList.toggle('open', open);
    document.getElementById('sidebar-overlay')?.classList.toggle('open', open);
}

function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
    if (id === 'settings-modal') updateSettingsUI();
}

function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

function setupSliderSync(sliderId, valueId) {
    const slider = document.getElementById(sliderId);
    const span = document.getElementById(valueId);
    if (!slider || !span) return;
    slider.addEventListener('input', () => { span.textContent = slider.value; });
}

/* ============================================================================
   CHARACTER LIST & CHAT
   ============================================================================ */
function renderCharacterList() {
    const listEl = document.getElementById('character-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const query = (document.getElementById('search-input')?.value || '').toLowerCase();
    const chars = appData.characters.filter(c => c.name.toLowerCase().includes(query) || (c.intro && c.intro.toLowerCase().includes(query)));

    if (chars.length === 0) {
        listEl.innerHTML = `<div class="empty-list">No characters found. Click + to create one.</div>`;
        return;
    }

    for (const c of chars) {
        const card = document.createElement('div');
        card.className = `character-card ${c.id === currentCharacterId ? 'active' : ''}`;
        card.onclick = () => selectCharacter(c.id);

        const img = document.createElement('img');
        img.src = c.avatar || defaultAvatarDataUri(c.name);
        img.alt = c.name;

        const details = document.createElement('div');
        details.className = 'char-details';
        details.innerHTML = `<h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.intro || c.backstory || 'No intro')}</p>`;

        card.appendChild(img);
        card.appendChild(details);
        listEl.appendChild(card);
    }
}

function filterCharacterList(query) {
    renderCharacterList();
}

function selectCharacter(id) {
    currentCharacterId = id;
    appData.lastCharacterId = id;
    saveData();
    renderAll();
    toggleSidebar(false);
}

function updateHeader() {
    const char = getCharacter(currentCharacterId);
    const avatarEl = document.getElementById('chat-avatar');
    const nameEl = document.getElementById('chat-name');
    const subtitleEl = document.getElementById('chat-subtitle');
    const clearBtn = document.getElementById('clear-chat-btn');

    if (!char) {
        avatarEl?.classList.add('hidden');
        if (nameEl) nameEl.textContent = 'Select a character';
        if (subtitleEl) subtitleEl.textContent = 'Pick from your hubs or create a new one';
        clearBtn?.classList.add('hidden');
        return;
    }

    if (avatarEl) {
        avatarEl.src = char.avatar || defaultAvatarDataUri(char.name);
        avatarEl.classList.remove('hidden');
    }
    if (nameEl) nameEl.textContent = char.name;
    if (subtitleEl) subtitleEl.textContent = char.intro || 'AI Character';
    clearBtn?.classList.remove('hidden');
}

function renderMessages() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    container.innerHTML = '';

    const char = getCharacter(currentCharacterId);
    if (!char) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-orb"></div>
                <h3>No conversation yet</h3>
                <p>Select or create a character to begin.</p>
            </div>`;
        return;
    }

    const messages = getChat(currentCharacterId);
    if (messages.length === 0 && char.greetings) {
        messages.push({ role: 'assistant', content: char.greetings });
    }

    for (const msg of messages) {
        const div = document.createElement('div');
        div.className = `message ${msg.role === 'user' ? 'user' : 'assistant'}`;
        div.innerHTML = `<div class="message-text">${formatMessage(msg.content)}</div>`;
        container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
}

function updateComposerState() {
    const input = document.getElementById('message-input');
    const btn = document.getElementById('send-btn');
    const hasChar = !!getCharacter(currentCharacterId);
    if (input) input.disabled = !hasChar || isGenerating;
    if (btn) btn.disabled = !hasChar || isGenerating;
}

function clearCurrentChat() {
    if (!currentCharacterId) return;
    if (confirm('Clear all messages for this character?')) {
        appData.chats[currentCharacterId] = [];
        saveData();
        renderMessages();
        showToast('Chat cleared.', 'info');
    }
}

/* ============================================================================
   AI CALL & MESSAGE HANDLING
   ============================================================================ */
async function sendMessage() {
    const input = document.getElementById('message-input');
    if (!input || isGenerating) return;
    const text = input.value.trim();
    if (!text || !currentCharacterId) return;

    const char = getCharacter(currentCharacterId);
    if (!char) return;

    input.value = '';
    const messages = getChat(currentCharacterId);
    messages.push({ role: 'user', content: text });
    saveData();
    renderMessages();

    isGenerating = true;
    updateComposerState();
    showTypingIndicator();

    try {
        const reply = await callAIProvider(char, messages);
        messages.push({ role: 'assistant', content: reply });
        saveData();
    } catch (err) {
        showToast(err.message || 'Failed to generate response', 'error');
    } finally {
        isGenerating = false;
        hideTypingIndicator();
        renderMessages();
        updateComposerState();
    }
}

function showTypingIndicator() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    const div = document.createElement('div');
    div.id = 'typing-indicator-el';
    div.className = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
    document.getElementById('typing-indicator-el')?.remove();
}

async function callAIProvider(char, history) {
    const { provider, apiKey, model, baseUrl, temperature, topP, topK, maxTokens } = appData.aiSettings;
    const conf = PROVIDERS[provider] || PROVIDERS.custom;
    const url = provider === 'custom' || provider === 'ollama' ? (baseUrl || conf.baseUrl) : conf.baseUrl;
    const normModel = normalizeModelName(model || conf.model, provider);

    if (provider === 'gemini' && !apiKey) {
        throw new Error("Missing API Key for Google Gemini.");
    }

    const systemPrompt = `You are roleplaying as ${char.name}.
Backstory: ${char.backstory || char.intro || 'An AI character.'}
Guidelines: Stay in character. Write dialogue and actions in asterisks.`;

    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content }))
    ];

    let endpoint = url;
    let headers = { 'Content-Type': 'application/json' };
    let body = {};

    if (provider === 'gemini') {
        endpoint = `${url}/models/${normModel}:generateContent?key=${apiKey}`;
        const contents = history.slice(-HISTORY_LIMIT).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        body = {
            system_instruct
