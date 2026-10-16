/* ============================================================================
   Hubs — app.js
   ============================================================================ */

/* ============================================================================
   SECTION 1 — CONSTANTS & STATE
   ============================================================================ */
const STORAGE_KEY = 'aiCharacterAppData';

let appData = {
    aiSettings: {
        provider: 'gemini',
        apiKey: '',
        model: 'gemini-2.0-flash',
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

/* Adsterra config */
const ADSTERRA_CONFIG = {
    topBanner: {
        enabled: true,
        containerId: 'container-a3f099d87b664187036e6176973d0255',
        scriptSrc: 'https://archeryconditionssniff.com/a3f099d87b664187036e6176973d0255/invoke.js'
    },
    sidebarBanner: {
        enabled: true,
        key: 'a9543a4355279a22639348e9331bf68e',
        width: 300,
        height: 250,
        invokeUrl: 'https://archeryconditionssniff.com'
    },
    popunder: {
        enabled: true,
        scriptSrc: 'https://archeryconditionssniff.com/a1/e6/0b/a1e60b63132f321aa7152ef962227e12.js'
    }
};

const POPUNDER_SESSION_KEY = 'hubs_popunder_hidden_session';
const POPUNDER_LAST_LOAD_KEY = 'hubs_popunder_last_load_timestamp';
const POPUNDER_INTERVAL_MS = 20 * 60 * 1000;
const SIDEBAR_AD_DISMISSED_KEY = 'hubs_sidebar_ad_dismissed';

/* ============================================================================
   SECTION 2 — BOOTSTRAP (fail-isolated, listeners first)
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const safe = (name, fn) => {
        try { fn(); } catch (e) { console.error(`[boot] ${name} failed:`, e); }
    };
    safe('loadData', loadData);
    safe('setupEventListeners', setupEventListeners);
    safe('renderCharacterList', () => renderCharacterList());
    safe('updateSettingsUI', updateSettingsUI);
    safe('initAds', initAds);
});

/* ============================================================================
   SECTION 3 — PERSISTENCE
   ============================================================================ */
function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            if (parsed.aiSettings && typeof parsed.aiSettings === 'object') {
                appData.aiSettings = { ...appData.aiSettings, ...parsed.aiSettings };
            }
            if (Array.isArray(parsed.characters)) appData.characters = parsed.characters;
            if (parsed.chats && typeof parsed.chats === 'object') appData.chats = parsed.chats;
            if (typeof parsed.adDismissed === 'boolean') appData.adDismissed = parsed.adDismissed;
        }
    } catch (e) {
        console.error('Failed to load data', e);
    }
}

function saveData() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); }
    catch (e) { console.error('Failed to save data', e); }
}

/* ============================================================================
   SECTION 4 — HELPERS
   ============================================================================ */
function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
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

/* ============================================================================
   SECTION 5 — MODEL NAME NORMALIZATION
   ============================================================================ */
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

/* ============================================================================
   SECTION 6 — RESPONSE SANITIZER (regexes fixed)
   ============================================================================ */
function cleanAIResponse(raw, characterName) {
    if (!raw) return '';
    let reply = raw;

    /* Drop leading "pseudo-header" lines like "* User asks: ..." */
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

    /* FIXED: was /.*\$/gim which matched a literal "$" */
    const headerLines = [
        /^\s*\*?\s*format\s*:.*$/gim,
        /^\s*\*?\s*user\s+asks?\s*:.*$/gim,
        /^\s*\*?\s*character\s*:.*$/gim,
        /^\s*\*?\s*input\s+context\s*:.*$/gim,
        /^\s*\*?\s*internal\s+state\s*:.*$/gim,
        /^\s*\*?\s*motivation\s*:.*$/gim,
        /^\s*\*?\s*emotion\s*:.*$/gim,
        /^\s*\*?\s*direct\s+response\s*:.*$/gim,
        /^\s*\*?\s*dialogue\s*\/\s*action\s*:.*$/gim,
        /^\s*\*?\s*length\s*:.*$/gim,
        /^\s*\*?\s*followed\s+by.*$/gim,
        /^\s*\*?\s*no\s+meta-text.*$/gim,
        /^\s*\*?\s*first\s+person.*$/gim
    ];
    for (const p of headerLines) reply = reply.replace(p, '');

    /* FIXED: use (?=\n\n|$) end-of-line, dropped the "okay, so" killer */
    const prefixes = [
        /^\s*\*?\s*(reasoning|analysis|thoughts?|thinking|internal monologue|chain of thought|let me think)\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/i,
        /^\s*(as an ai|i'm an ai|i am an ai|as a language model)\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/i
    ];
    for (const p of prefixes) reply = reply.replace(p, '');

    if (characterName) {
        const esc = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        reply = reply.replace(new RegExp(`^\\s*\\*?\\s*${esc}\\s*\\*?\\s*:\\s*`, 'i'), '');
    }

    const trailing = reply.search(/\n\s*\*?\s*(reasoning|analysis|thoughts?|note|ooc|end of response|format)\s*[:\-]/i);
    if (trailing !== -1) reply = reply.slice(0, trailing);

    reply = reply.replace(/^\s*THOUGHT\s*:\s*[\s\S]*?(?=\n\n|$)/i, '');
    reply = reply.replace(/\n{3,}/g, '\n\n').trim();

    if (!reply) {
        /* FIXED: [...fallback].reverse() so we don't mutate the source array */
        const fallback = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const spoken = [...fallback].reverse()
            .find(l => /^["*]/.test(l) && !/^\*\s*\w+\s*:/.test(l));
        reply = spoken || fallback[0] || raw.trim();
    }
    return reply;
}

/* ============================================================================
   SECTION 7 — ADS & POPUNDER (idempotent, no click-gate)
   ============================================================================ */
let popunderOn = true;
let popunderScriptLoaded = false;
let topBannerLoaded = false;
let sidebarBannerLoaded = false;

function isPopunderHiddenThisSession() {
    try { return sessionStorage.getItem(POPUNDER_SESSION_KEY) === '1'; }
    catch (_) { return false; }
}
function markPopunderHidden() {
    try { sessionStorage.setItem(POPUNDER_SESSION_KEY, '1'); } catch (_) {}
}
function markPopunderVisible() {
    try { sessionStorage.removeItem(POPUNDER_SESSION_KEY); } catch (_) {}
}

function loadPopunderOnce() {
    if (!popunderOn) return;
    const cfg = ADSTERRA_CONFIG.popunder;
    if (!cfg.enabled) return;

    const lastLoad = localStorage.getItem(POPUNDER_LAST_LOAD_KEY);
    const now = Date.now();
    if (lastLoad && (now - parseInt(lastLoad, 10) < POPUNDER_INTERVAL_MS)) return;
    if (popunderScriptLoaded) return;

    const s = document.createElement('script');
    s.id = 'adsterra-popunder-script';
    s.type = 'text/javascript';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = cfg.scriptSrc;
    s.onerror = () => console.warn('[ads] Popunder blocked or failed to load.');
    document.body.appendChild(s);
    popunderScriptLoaded = true;
    localStorage.setItem(POPUNDER_LAST_LOAD_KEY, now.toString());
}

function updatePopunderUI() {
    const pill = document.getElementById('popunder-pill');
    const state = document.getElementById('popunder-state');
    const switchEl = document.getElementById('popunder-switch');
    const settingsToggle = document.getElementById('show-popunder-toggle');

    if (pill) pill.classList.remove('hidden');

    if (popunderOn) {
        pill?.classList.remove('off');
        if (state) state.textContent = 'ON';
        if (switchEl) switchEl.checked = true;
        if (settingsToggle) settingsToggle.checked = true;
    } else {
        pill?.classList.add('off');
        if (state) state.textContent = 'OFF';
        if (switchEl) switchEl.checked = false;
        if (settingsToggle) settingsToggle.checked = false;
    }
}

function turnPopunderOn() {
    popunderOn = true;
    markPopunderVisible();
    loadPopunderOnce();
    updatePopunderUI();
}
function turnPopunderOff() {
    popunderOn = false;
    markPopunderHidden();
    updatePopunderUI();
}

function loadAdsterraTopBanner() {
    const cfg = ADSTERRA_CONFIG.topBanner;
    const slot = document.getElementById(cfg.containerId);
    const fallback = document.getElementById('ad-fallback');
    if (!slot) return;

    if (!cfg.enabled) {
        slot.innerHTML = '';
        if (fallback) fallback.style.display = 'inline';
        return;
    }
    if (topBannerLoaded) return;
    topBannerLoaded = true;

    slot.innerHTML = '';
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = cfg.scriptSrc;
    s.onload = () => { if (fallback) fallback.style.display = 'none'; };
    s.onerror = () => {
        if (fallback) fallback.style.display = 'inline';
        topBannerLoaded = false;
    };
    slot.appendChild(s);
}

function renderTopAdBanner() {
    const banner = document.getElementById('ad-banner');
    if (!banner) return;
    if (appData.adDismissed) { banner.style.display = 'none'; return; }
    banner.style.display = 'flex';
    loadAdsterraTopBanner();
}

function actuallyDismissTopAd() {
    appData.adDismissed = true;
    saveData();
    const banner = document.getElementById('ad-banner');
    if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
    const toggle = document.getElementById('show-ads-toggle');
    if (toggle) toggle.checked = false;
    try {
        document.querySelectorAll(
            'body > iframe[src*="archeryconditionssniff"],' +
            'body > iframe[src*="highperformanceformat"],' +
            'body > div[id^="container-"]'
        ).forEach(el => el.remove());
    } catch (_) {}
    showToast('Top banner disabled.', 'info');
}

function requestDisableTopAd() {
    if (appData.adDismissed) return;
    openModal('disable-ads-modal');
}

function isSidebarAdDismissed() {
    try { return localStorage.getItem(SIDEBAR_AD_DISMISSED_KEY) === '1'; }
    catch (_) { return false; }
}
function markSidebarAdDismissed() {
    try { localStorage.setItem(SIDEBAR_AD_DISMISSED_KEY, '1'); } catch (_) {}
}

function loadAdsterraSidebarBanner() {
    const cfg = ADSTERRA_CONFIG.sidebarBanner;
    const slot = document.getElementById('sidebar-ad-slot');
    const fallback = document.getElementById('sidebar-ad-fallback');
    if (!slot) return;

    if (!cfg.enabled || !cfg.key) {
        slot.innerHTML = '';
        if (fallback) fallback.style.display = 'inline';
        return;
    }
    if (sidebarBannerLoaded) return;
    sidebarBannerLoaded = true;

    slot.innerHTML = '';
    window.atOptions = {
        key: cfg.key,
        format: 'iframe',
        height: cfg.height,
        width: cfg.width,
        params: {}
    };

    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = `${cfg.invokeUrl}/${cfg.key}/invoke.js`;
    s.onload = () => { if (fallback) fallback.style.display = 'none'; };
    s.onerror = () => {
        if (fallback) fallback.style.display = 'inline';
        sidebarBannerLoaded = false;
    };
    slot.appendChild(s);
}

function renderSidebarAd() {
    const wrap = document.getElementById('sidebar-ad');
    if (!wrap) return;
    if (isSidebarAdDismissed()) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    loadAdsterraSidebarBanner();
}

function dismissSidebarAd() {
    markSidebarAdDismissed();
    const wrap = document.getElementById('sidebar-ad');
    if (wrap) {
        wrap.classList.add('hidden');
        const slot = document.getElementById('sidebar-ad-slot');
        if (slot) slot.innerHTML = '';
    }
    showToast('Sidebar ad hidden.', 'info');
}

function wireCloseButtons() {
    const wire = (btn, handler) => {
        if (!btn || btn.dataset.wired === '1') return;
        btn.dataset.wired = '1';
        btn.setAttribute('data-no-ad-block', '1');
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handler();
        });
    };
    wire(document.getElementById('close-ad'), requestDisableTopAd);
    wire(document.getElementById('sidebar-ad-close'), dismissSidebarAd);
}

function initAds() {
    popunderOn = !isPopunderHiddenThisSession();
    loadPopunderOnce();
    renderTopAdBanner();
    renderSidebarAd();
    wireCloseButtons();

    document.getElementById('confirm-disable-ads')?.addEventListener('click', () => {
        actuallyDismissTopAd();
        closeModal('disable-ads-modal');
    });
    document.getElementById('keep-ads')?.addEventListener('click', () => {
        closeModal('disable-ads-modal');
    });

    const bannerToggle = document.getElementById('show-ads-toggle');
    if (bannerToggle) {
        bannerToggle.checked = !appData.adDismissed;
        bannerToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                appData.adDismissed = false;
                saveData();
                renderTopAdBanner();
            } else {
                e.target.checked = true;
                requestDisableTopAd();
            }
        });
    }

    document.getElementById('popunder-switch')?.addEventListener('change', (e) => {
        if (e.target.checked) turnPopunderOn();
        else turnPopunderOff();
    });
    document.getElementById('show-popunder-toggle')?.addEventListener('change', (e) => {
        if (e.target.checked) turnPopunderOn();
        else turnPopunderOff();
    });

    updatePopunderUI();
}

/* ============================================================================
   SECTION 8 — EVENT LISTENERS
   ============================================================================ */
function setupEventListeners() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const openDrawer = () => { sidebar?.classList.add('open'); overlay?.classList.remove('hidden'); };
    const closeDrawer = () => { sidebar?.classList.remove('open'); overlay?.classList.add('hidden'); };

    document.getElementById('mobile-menu-btn')?.addEventListener('click', openDrawer);
    document.getElementById('mobile-settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    overlay?.addEventListener('click', closeDrawer);

    document.getElementById('add-char-btn')?.addEventListener('click', () => openModal('character-modal'));
    document.getElementById('settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('clear-chat-btn')?.addEventListener('click', clearCurrentChat);

    const ta = document.getElementById('message-input');
    ta?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    ta?.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
        updateComposerState();
    });

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
    document.querySelectorAll('.modal-overlay').forEach(ov => {
        ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(ov.id); });
    });

    document.getElementById('provider-select')?.addEventListener('change', (e) => {
        const baseUrlGrp = document.getElementById('base-url-group');
        if (baseUrlGrp) baseUrlGrp.style.display = e.target.value === 'custom' ? 'flex' : 'none';
        updateModelInput(e.target.value);
    });
    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
    document.getElementById('test-models-btn')?.addEventListener('click', testAndAutoSelectModel);

    document.getElementById('temperature-slider')?.addEventListener('input', (e) => {
        const el = document.getElementById('temperature-value');
        if (el) el.textContent = e.target.value;
    });
    document.getElementById('top-p-slider')?.addEventListener('input', (e) => {
        const el = document.getElementById('top-p-value');
        if (el) el.textContent = e.target.value;
    });
    document.getElementById('top-k-slider')?.addEventListener('input', (e) => {
        const el = document.getElementById('top-k-value');
        if (el) el.textContent = e.target.value;
    });
    document.getElementById('max-tokens-input')?.addEventListener('input', (e) => {
        const el = document.getElementById('max-tokens-value');
        if (el) el.textContent = e.target.value;
    });

    document.getElementById('disable-reasoning-toggle')?.addEventListener('change', (e) => {
        appData.aiSettings.disableReasoning = e.target.checked;
        saveData();
    });

    document.getElementById('save-char-btn')?.addEventListener('click', saveCharacter);
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        renderCharacterList(e.target.value);
    });
    document.getElementById('import-png')?.addEventListener('change', importCharacterPng);
}

/* ============================================================================
   SECTION 9 — MODALS & TOASTS
   ============================================================================ */
function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('hidden');
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('hidden');
}
function showToast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => t.remove(), 3000);
}

/* ============================================================================
   SECTION 10 — CHARACTER LIST & SELECTION
   ============================================================================ */
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function closeSidebarDrawer() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.add('hidden');
}

function renderCharacterList(filter = '') {
    const list = document.getElementById('character-list');
    if (!list) return;
    const q = (filter || '').trim().toLowerCase();
    const chars = appData.characters.filter(c => {
        if (!q) return true;
        const tags = Array.isArray(c.tags) ? c.tags.join(' ') : (c.tags || '');
        return [c.name, c.intro, c.gender, tags].join(' ').toLowerCase().includes(q);
    });
    list.innerHTML = '';
    if (!chars.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-list';
        empty.textContent = q ? 'No characters match your search.' : 'No characters yet. Tap + to create one.';
        list.appendChild(empty);
        return;
    }
    for (const c of chars) {
        const card = document.createElement('div');
        card.className = 'character-card' + (c.id === currentCharacterId ? ' active' : '');
        card.innerHTML = `
            <img src="${c.avatar || defaultAvatarDataUri(c.name)}" alt="">
            <div class="char-details">
                <h3>${escapeHtml(c.name)}</h3>
                <p>${escapeHtml(c.intro || c.greetings || '')}</p>
            </div>`;
        card.addEventListener('click', () => selectCharacter(c.id));
        list.appendChild(card);
    }
}

function selectCharacter(id) {
    currentCharacterId = id;
    renderCharacterList(document.getElementById('search-input')?.value || '');
    const c = appData.characters.find(x => x.id === id);
    const avatar = document.getElementById('chat-avatar');
    const nameEl = document.getElementById('chat-name');
    const subEl = document.getElementById('chat-subtitle');
    if (c) {
        if (avatar) { avatar.src = c.avatar || defaultAvatarDataUri(c.name); avatar.classList.remove('hidden'); }
        if (nameEl) nameEl.textContent = c.name;
        if (subEl) subEl.textContent = c.intro || (Array.isArray(c.tags) ? c.tags.join(', ') : 'Character chat');
        const greet = (c.greetings || '').trim();
        if (greet && (!appData.chats[c.id] || !appData.chats[c.id].length)) {
            appData.chats[c.id] = [{ role: 'assistant', content: greet, ts: Date.now() }];
            saveData();
        }
    }
    document.getElementById('clear-chat-btn')?.classList.toggle('hidden', !c);
    closeSidebarDrawer();
    renderMessages();
    updateComposerState();
}

/* ============================================================================
   SECTION 11 — CHAT RENDERING
   ============================================================================ */
function getCurrentChat() {
    if (!currentCharacterId) return [];
    if (!appData.chats[currentCharacterId]) appData.chats[currentCharacterId] = [];
    return appData.chats[currentCharacterId];
}

function renderMessages() {
    const box = document.getElementById('messages-container');
    if (!box) return;
    const chat = getCurrentChat();
    box.innerHTML = '';
    if (!currentCharacterId || !chat.length) {
        box.innerHTML = `<div class="empty-state">
            <div class="empty-orb"></div>
            <h3>${currentCharacterId ? 'Say something to begin' : 'No conversation yet'}</h3>
            <p>${currentCharacterId ? 'Type a message below.' : 'Select or create a character to begin.'}</p>
        </div>`;
        return;
    }
    for (const m of chat) appendMessageNode(m.role, m.content);
    box.scrollTop = box.scrollHeight;
}

function appendMessageNode(role, text) {
    const box = document.getElementById('messages-container');
    if (!box) return null;
    const empty = box.querySelector('.empty-state');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `<div class="message-text">${escapeHtml(text)}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function updateComposerState() {
    const ta = document.getElementById('message-input');
    const btn = document.getElementById('send-btn');
    const ready = !!currentCharacterId && !isGenerating;
    if (ta) ta.disabled = !ready;
    if (btn) btn.disabled = !ready || !(ta && ta.value.trim());
}

function clearCurrentChat() {
    if (!currentCharacterId) return;
    appData.chats[currentCharacterId] = [];
    saveData();
    renderMessages();
    showToast('Chat cleared.', 'info');
}

/* ============================================================================
   SECTION 12 — SETTINGS
   ============================================================================ */
const PROVIDER_DEFAULTS = {
    openrouter: 'google/gemma-3-4b-it',
    gemini: 'gemini-2.0-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest',
    groq: 'llama-3.3-70b-versatile',
    ollama: 'llama3.1',
    custom: 'model-name'
};

function updateModelInput(provider) {
    const input = document.getElementById('model-input');
    if (!input) return;
    const def = PROVIDER_DEFAULTS[provider];
    input.placeholder = def ? `e.g. ${def}` : 'model';
}

function updateSettingsUI() {
    const s = appData.aiSettings;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('provider-select', s.provider);
    set('api-key-input', s.apiKey);
    set('model-input', s.model);
    set('temperature-slider', s.temperature); set('temperature-value', s.temperature);
    set('top-p-slider', s.topP); set('top-p-value', s.topP);
    set('top-k-slider', s.topK); set('top-k-value', s.topK);
    set('max-tokens-input', s.maxTokens); set('max-tokens-value', s.maxTokens);
    set('base-url-input', s.baseUrl);
    const b = document.getElementById('base-url-group');
    if (b) b.style.display = s.provider === 'custom' ? 'flex' : 'none';
    const rt = document.getElementById('disable-reasoning-toggle');
    if (rt) rt.checked = !!s.disableReasoning;
    const ads = document.getElementById('show-ads-toggle');
    if (ads) ads.checked = !appData.adDismissed;
    updateModelInput(s.provider);
}

function saveSettings() {
    const s = appData.aiSettings;
    const val = (id) => document.getElementById(id)?.value;
    s.provider = val('provider-select') || s.provider;
    s.apiKey = (val('api-key-input') || '').trim();
    s.model = (val('model-input') || '').trim() || s.model;
    s.baseUrl = (val('base-url-input') || '').trim();
    s.temperature = parseFloat(val('temperature-slider')) || 0;
    s.topP = parseFloat(val('top-p-slider')) || 1;
    s.topK = parseInt(val('top-k-slider'), 10) || 40;
    s.maxTokens = parseInt(val('max-tokens-input'), 10) || 1024;
    saveData();
    closeModal('settings-modal');
    showToast('Settings saved.', 'success');
}

function clearAllData() {
    if (!confirm('Delete ALL local data (characters, chats, settings)? This cannot be undone.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    location.reload();
}

/* ============================================================================
   SECTION 13 — MODEL TEST / AUTO-SELECT
   ============================================================================ */
async function testAndAutoSelectModel() {
    const result = document.getElementById('model-test-result');
    const s = appData.aiSettings;
    const provider = document.getElementById('provider-select')?.value || s.provider;
    const key = (document.getElementById('api-key-input')?.value || '').trim() || s.apiKey;
    const modelInput = document.getElementById('model-input');
    const fail = (msg) => { if (result) { result.textContent = msg; result.style.color = 'var(--danger)'; } };
    const ok = (msg) => { if (result) { result.textContent = msg; result.style.color = 'var(--success)'; } };
    if (result) { result.textContent = 'Testing…'; result.style.color = ''; }

    const pickBest = (ids, preferred) => {
        return ids.map(id => {
            let score = 0;
            if (preferred && id.toLowerCase().includes(preferred.toLowerCase())) score += 10;
            if (/flash|mini|haiku|gemma|llama|8b|4b/i.test(id)) score += 5;
            return { id, score };
        }).sort((a, b) => b.score - a.score)[0]?.id || ids[0];
    };

    try {
        let ids = [];
        if (provider === 'openrouter') {
            if (!key) return fail('API key required.');
            const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } });
            if (!r.ok) return fail(`Error ${r.status}`);
            ids = ((await r.json()).data || []).map(m => m.id);
        } else if (provider === 'gemini') {
            if (!key) return fail('API key required.');
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
            if (!r.ok) return fail(`Error ${r.status}`);
            ids = ((await r.json()).models || []).map(m => m.name.split('/').pop()).filter(n => n.startsWith('gemini'));
        } else if (provider === 'groq') {
            if (!key) return fail('API key required.');
            const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
            if (!r.ok) return fail(`Error ${r.status}`);
            ids = ((await r.json()).data || []).map(m => m.id);
        } else if (provider === 'ollama') {
            const base = ((document.getElementById('base-url-input')?.value || '').trim()) || s.baseUrl || 'http://localhost:11434';
            const r = await fetch(`${base.replace(/\/$/, '')}/api/tags`);
            if (!r.ok) return fail(`Error ${r.status}`);
            ids = ((await r.json()).models || []).map(m => m.name);
        } else {
            return fail('Auto-detect not supported here — type the model name manually.');
        }
        if (!ids.length) return fail('No models found.');
        const best = pickBest(ids, modelInput?.value?.trim());
        if (modelInput) modelInput.value = best;
        ok(`✓ ${ids.length} models found — selected "${best}"`);
    } catch (e) {
        console.error(e);
        fail('Connection failed (network/CORS).');
    }
}

/* ============================================================================
   SECTION 14 — CREATE CHARACTER & PNG IMPORT
   ============================================================================ */
async function saveCharacter() {
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const name = val('char-name');
    if (!name) { showToast('Name is required.', 'error'); return; }
    const file = document.getElementById('char-avatar')?.files?.[0];
    let avatar = '';
    if (file) {
        try { avatar = await fileToDataURL(file); } catch (e) { console.error(e); }
    }
    const char = {
        id: 'c_' + Date.now().toString(36),
        name,
        gender: val('char-gender') || 'Other',
        intro: val('char-intro'),
        greetings: val('char-greetings'),
        backstory: val('char-backstory'),
        private: !!document.getElementById('char-private')?.checked,
        tags: val('char-tags').split(',').map(t => t.trim()).filter(Boolean),
        avatar: avatar || defaultAvatarDataUri(name),
        createdAt: Date.now()
    };
    appData.characters.push(char);
    saveData();
    closeModal('character-modal');
    ['char-avatar', 'char-name', 'char-intro', 'char-greetings', 'char-backstory', 'char-tags']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const priv = document.getElementById('char-private');
    if (priv) priv.checked = false;
    renderCharacterList(document.getElementById('search-input')?.value || '');
    selectCharacter(char.id);
    showToast(`"${name}" created.`, 'success');
}

function extractPngText(buf, keywords) {
    const dv = new DataView(buf);
    const dec = new TextDecoder();
    let off = 8; // skip PNG signature
    while (off + 8 <= buf.byteLength) {
        const len = dv.getUint32(off);
        const type = dec.decode(new Uint8Array(buf, off + 4, 4));
        if (type === 'tEXt') {
            const raw = dec.decode(new Uint8Array(buf, off + 8, len));
            const idx = raw.indexOf('\0');
            const keyword = (idx === -1 ? raw : raw.slice(0, idx)).trim();
            if (keywords.includes(keyword)) {
                return idx === -1 ? '' : raw.slice(idx + 1);
            }
        }
        off += 12 + len;
    }
    return null;
}

function importCharacterPng(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            let jsonStr = extractPngText(reader.result, ['ccv3', 'chara', 'character_card']);
            if (!jsonStr) throw new Error('no character data chunk');
            let decoded = jsonStr;
            try { decoded = atob(jsonStr); } catch (_) {}
            const data = JSON.parse(decoded);
            const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
            openModal('character-modal');
            set('char-name', data.name);
            set('char-intro', data.creator_notes || data.tagline || '');
            set('char-greetings', data.first_mes || '');
            set('char-backstory',
                [data.description, data.personality, data.scenario, data.system_prompt]
                    .filter(Boolean).join('\n\n'));
            if (Array.isArray(data.tags)) set('char-tags', data.tags.join(', '));
            showToast('Character imported — review and save.', 'success');
        } catch (err) {
            console.error(err);
            showToast('Not a valid character PNG.', 'error');
        } finally {
            e.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

/* ============================================================================
   SECTION 15 — AI CALL & SEND
   ============================================================================ */
function buildSystemPrompt(c) {
    return [
        `You are ${c.name}${c.gender ? ` (${c.gender})` : ''}.`,
        c.intro && `Intro: ${c.intro}`,
        c.backstory && `Backstory and personality:\n${c.backstory}`,
        `Stay fully in character as ${c.name}. Write in first person. Never break character, never mention being an AI, and never add meta-commentary, labels, or formatting instructions.`
    ].filter(Boolean).join('\n\n');
}

function buildApiMessages(chat, system) {
    const recent = chat.slice(-20);
    return {
        system,
        messages: recent.map(m => ({ role: m.role, content: m.content }))
    };
}

async function callAI(system, messages) {
    const s = { ...appData.aiSettings };
    s.model = normalizeModelName(s.model, s.provider);
    if (!s.apiKey && s.provider !== 'ollama' && s.provider !== 'custom') {
        throw new Error('Missing API key — add it in Settings.');
    }
    const { temperature: temp, topP, topK, maxTokens } = s;

    if (s.provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
                generationConfig: { temperature: temp, topP, topK, maxOutputTokens: maxTokens }
            })
        });
        if (!r.ok) throw new Error(`Gemini error ${r.status}`);
        const j = await r.json();
        return (j.candidates?.[0]?.content?.parts || []).map(p => p.text).join('');
    }

    if (s.provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': s.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: s.model, max_tokens: maxTokens,
                temperature: temp, top_p: topP, top_k: topK,
                system,
                messages: messages.map(m => ({ role: m.role, content: m.content }))
            })
        });
        if (!r.ok) throw new Error(`Anthropic error ${r.status}`);
        const j = await r.json();
        return (j.content || []).map(b => b.text).join('');
    }

    if (s.provider === 'ollama') {
        const base = (s.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
        const r = await fetch(`${base}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: s.model, stream: false,
                messages: [{ role: 'system', content: system }, ...messages],
                options: { temperature: temp, top_p: topP, top_k: topK, num_predict: maxTokens }
            })
        });
        if (!r.ok) throw new Error(`Ollama error ${r.status}`);
        const j = await r.json();
        return j.message?.content || '';
    }

    const baseUrls = {
        openai: 'https://api.openai.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        openrouter: 'https://openrouter.ai/api/v1',
        custom: (s.baseUrl || '').replace(/\/$/, '')
    };
    const base = baseUrls[s.provider];
    if (!base) throw new Error('Unknown provider.');
    const headers = { 'Content-Type': 'application/json' };
    if (s.apiKey) headers['Authorization'] = `Bearer ${s.apiKey}`;
    const body = {
        model: s.model,
        messages: [{ role: 'system', content: system }, ...messages],
        temperature: temp, top_p: topP, max_tokens: maxTokens
    };
    if (s.frequencyPenalty) body.frequency_penalty = s.frequencyPenalty;
    if (s.presencePenalty) body.presence_penalty = s.presencePenalty;
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) {
        let detail = '';
        try { detail = (await r.json())?.error?.message || ''; } catch (_) {}
        throw new Error(`API error ${r.status}${detail ? ` — ${detail}` : ''}`);
    }
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
}

async function sendMessage() {
    const ta = document.getElementById('message-input');
    const text = (ta?.value || '').trim();
    if (!text || !currentCharacterId || isGenerating) return;
    const c = appData.characters.find(x => x.id === currentCharacterId);
    if (!c) return;
    if (!appData.aiSettings.apiKey && !['ollama', 'custom'].includes(appData.aiSettings.provider)) {
        showToast('Add your API key in Settings first.', 'error');
        openModal('settings-modal');
        return;
    }

    isGenerating = true;
    ta.value = '';
    ta.style.height = 'auto';
    updateComposerState();

    const chat = getCurrentChat();
    chat.push({ role: 'user', content: text, ts: Date.now() });
    saveData();
    appendMessageNode('user', text);

    const box = document.getElementById('messages-container');
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    if (box) { box.appendChild(typing); box.scrollTop = box.scrollHeight; }

    try {
        const { system, messages } = buildApiMessages(chat, buildSystemPrompt(c));
        const raw = await callAI(system, messages);
        typing.remove();
        const reply = cleanAIResponse(raw, c.name) || '…';
        chat.push({ role: 'assistant', content: reply, ts: Date.now() });
        saveData();
        appendMessageNode('assistant', reply);
    } catch (e) {
        typing.remove();
        console.error(e);
        showToast(e.message || 'Generation failed.', 'error');
    } finally {
        isGenerating = false;
        updateComposerState();
    }
}
