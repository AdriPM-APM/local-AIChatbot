/* ============================================================================
   Hubs — app.js (complete rewrite)
   ============================================================================ */

/* ============================================================================
   SECTION 1 — CONSTANTS & STATE
   ============================================================================ */
const STORAGE_KEY = 'aiCharacterAppData';
const HISTORY_LIMIT = 40;

const PROVIDERS = {
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it:free', editableUrl: false },
    gemini:     { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-lite', editableUrl: false },
    openai:     { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', editableUrl: false },
    anthropic:  { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', editableUrl: false },
    groq:       { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', editableUrl: false },
    ollama:     { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', editableUrl: true },
    custom:     { baseUrl: '', model: '', editableUrl: true }
};

function defaultAppData() {
    return {
        aiSettings: {
            provider: 'gemini',
            apiKey: '',
            model: 'gemini-3.1-flash-lite',
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
   SECTION 2 — BOOTSTRAP (each step fail-isolated)
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const safe = (name, fn) => {
        try { fn(); } catch (e) { console.error(`[boot] ${name} failed:`, e); }
    };
    safe('loadData', loadData);
    safe('setupEventListeners', setupEventListeners);
    safe('restoreSession', restoreSession);
    safe('updateSettingsUI', updateSettingsUI);
    safe('initAds', initAds);
});

function restoreSession() {
    const id = appData.lastCharacterId;
    currentCharacterId = getCharacter(id) ? id : null;
    renderAll();
}

function renderAll() {
    renderCharacterList();
    updateHeader();
    renderMessages();
    updateComposerState();
}

/* ============================================================================
   SECTION 3 — PERSISTENCE
   ============================================================================ */
function loadData() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); }
    catch (e) { console.error('localStorage unavailable', e); return; }
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
        console.error('Saved data is corrupt; starting fresh', e);
    }
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        return true;
    } catch (e) {
        console.error('Failed to save data', e);
        showToast('Storage is full or blocked — this change was not saved.', 'error');
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
   SECTION 4 — HELPERS
   ============================================================================ */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* PolyBuzz-style formatting: **bold**, *action in grey italics* */
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

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

/* Shrinks an image so avatars don't fill localStorage. */
function resizeImageToDataURL(source, max = 256) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = typeof source === 'string' ? source : URL.createObjectURL(source);
        img.onload = () => {
            try {
                const scale = Math.min(1, max / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/webp', 0.9));
            } catch (e) {
                reject(e);
            } finally {
                if (typeof source !== 'string') URL.revokeObjectURL(url);
            }
        };
        img.onerror = () => {
            if (typeof source !== 'string') URL.revokeObjectURL(url);
            reject(new Error('Could not read image'));
        };
        img.src = url;
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
   SECTION 6 — RESPONSE SANITIZER (strips leaked reasoning / labels)
   ============================================================================ */
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
        const fallback = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const spoken = [...fallback].reverse()
            .find(l => /^["*]/.test(l) && !/^\*\s*\w+\s*:/.test(l));
        reply = spoken || fallback[0] || raw.trim();
    }
    return reply;
}

/* ============================================================================
   SECTION 7 — ADS & POPUNDER
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
    if (!cfg.enabled || popunderScriptLoaded) return;

    try {
        const lastLoad = localStorage.getItem(POPUNDER_LAST_LOAD_KEY);
        const now = Date.now();
        if (lastLoad && (now - parseInt(lastLoad, 10) < POPUNDER_INTERVAL_MS)) return;
        localStorage.setItem(POPUNDER_LAST_LOAD_KEY, now.toString());
    } catch (_) {}

    const s = document.createElement('script');
    s.id = 'adsterra-popunder-script';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = cfg.scriptSrc;
    s.onerror = () => console.warn('[ads] Popunder blocked or failed to load.');
    document.body.appendChild(s);
    popunderScriptLoaded = true;
}

function updatePopunderUI() {
    const pill = document.getElementById('popunder-pill');
    const state = document.getElementById('popunder-state');
    const switchEl = document.getElementById('popunder-switch');
    const settingsToggle = document.getElementById('show-popunder-toggle');

    if (pill) pill.classList.remove('hidden');
    pill?.classList.toggle('off', !popunderOn);
    if (state) state.textContent = popunderOn ? 'ON' : 'OFF';
    if (switchEl) switchEl.checked = popunderOn;
    if (settingsToggle) settingsToggle.checked = popunderOn;
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
    slot.style.display = '';
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = cfg.scriptSrc;
    s.onload = () => { if (fallback) fallback.style.display = 'none'; };
    s.onerror = () => {
        if (fallback) fallback.style.display = 'inline';
        topBannerLoaded = false;
        slot.style.display = 'none';
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
    if (banner) banner.style.display = 'none';
    // Only clear the ad slot — never the banner itself (it holds the close button).
    const slot = document.getElementById(ADSTERRA_CONFIG.topBanner.containerId);
    if (slot) slot.innerHTML = '';
    topBannerLoaded = false;
    setChecked('show-ads-toggle', false);
    try {
        document.querySelectorAll(
            'body > iframe[src*="archeryconditionssniff"],' +
            'body > iframe[src*="highperformanceformat"]'
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
        sidebarBannerLoaded = false;
        document.getElementById('sidebar-ad')?.classList.add('hidden');
    };
    slot.appendChild(s);
}

/* Was always hidden before (bug). Now shown unless the user closed it. */
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
    if (wrap) wrap.classList.add('hidden');
    const slot = document.getElementById('sidebar-ad-slot');
    if (slot) slot.innerHTML = '';
    showToast('Sidebar ad hidden.', 'info');
}

function wireCloseButtons() {
    const wire = (btn, handler) => {
        if (!btn || btn.dataset.wired === '1') return;
        btn.dataset.wired = '1';
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
                topBannerLoaded = false;
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
   SECTION 8 — UI HELPERS (modals, toasts, drawer)
   ============================================================================ */
function openModal(id) {
    if (id === 'settings-modal') updateSettingsUI();
    document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
    if (id === 'character-modal') resetCharacterForm();
}

function showToast(message, type = 'info') {
    const box = document.getElementById('toast-container');
    if (!box) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3200);
}

function setDrawer(open) {
    document.getElementById('sidebar')?.classList.toggle('open', open);
    document.getElementById('sidebar-overlay')?.classList.toggle('hidden', !open);
}

/* ============================================================================
   SECTION 9 — CHARACTERS
   ============================================================================ */
function renderCharacterList() {
    const list = document.getElementById('character-list');
    if (!list) return;
    const q = val('search-input').trim().toLowerCase();

    const items = appData.characters
        .filter(c => !q
            || c.name.toLowerCase().includes(q)
            || c.tags.some(t => t.toLowerCase().includes(q)))
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    list.innerHTML = '';
    if (!items.length) {
        const e = document.createElement('div');
        e.className = 'empty-list';
        e.textContent = q ? 'No matches.' : 'No characters yet. Tap + to create one.';
        list.appendChild(e);
        return;
    }

    for (const c of items) {
        const card = document.createElement('div');
        card.className = 'character-card' + (c.id === currentCharacterId ? ' active' : '');

        const img = document.createElement('img');
        img.alt = '';
        img.src = c.avatar || defaultAvatarDataUri(c.name);

        const details = document.createElement('div');
        details.className = 'char-details';
        const h = document.createElement('h3');
        h.textContent = c.name;
        const p = document.createElement('p');
        p.textContent = c.intro || c.gender || '';
        details.append(h, p);

        card.append(img, details);
        card.addEventListener('click', () => selectCharacter(c.id));
        list.appendChild(card);
    }
}

function selectCharacter(id) {
    const c = getCharacter(id);
    if (!c) return;
    currentCharacterId = id;
    appData.lastCharacterId = id;

    const chat = getChat(id);
    if (!chat.length && c.greeting) {
        chat.push({ role: 'assistant', content: c.greeting, ts: Date.now() });
    }
    saveData();
    renderAll();
    setDrawer(false);
}

function updateHeader() {
    const c = getCharacter(currentCharacterId);
    const av = document.getElementById('chat-avatar');
    const clear = document.getElementById('clear-chat-btn');

    if (!c) {
        setText('chat-name', 'Select a character');
        setText('chat-subtitle', 'Pick from your hubs or create a new one');
        av?.classList.add('hidden');
        clear?.classList.add('hidden');
        return;
    }
    setText('chat-name', c.name);
    setText('chat-subtitle', c.intro || c.gender || 'Character');
    if (av) {
        av.src = c.avatar || defaultAvatarDataUri(c.name);
        av.classList.remove('hidden');
    }
    clear?.classList.remove('hidden');
}

function resetCharacterForm() {
    ['char-name', 'char-intro', 'char-greetings', 'char-backstory', 'char-tags'].forEach(id => setVal(id, ''));
    setVal('char-gender', 'Male');
    setChecked('char-private', false);
    const file = document.getElementById('char-avatar');
    if (file) file.value = '';
    pendingImportAvatar = null;
}

async function saveCharacter() {
    const name = val('char-name').trim();
    if (!name) {
        showToast('Give the character a name.', 'error');
        return;
    }

    let avatar = pendingImportAvatar;
    const file = document.getElementById('char-avatar')?.files?.[0];
    if (file) {
        try { avatar = await resizeImageToDataURL(file); }
        catch (_) { showToast('Could not read that image; using default avatar.', 'info'); }
    }

    const character = {
        id: newId(),
        name,
        gender: val('char-gender') || '',
        intro: val('char-intro').trim(),
        greeting: val('char-greetings').trim(),
        backstory: val('char-backstory').trim(),
        private: !!document.getElementById('char-private')?.checked,
        tags: val('char-tags').split(',').map(t => t.trim()).filter(Boolean),
        avatar: avatar || null,
        createdAt: Date.now()
    };

    appData.characters.push(character);
    if (!saveData()) {
        appData.characters.pop();
        return;
    }
    resetCharacterForm();
    closeModal('character-modal');
    selectCharacter(character.id);
    showToast(`${name} created`, 'success');
}

/* ---- SillyTavern / TavernAI PNG card import (tEXt chunk "chara" / "ccv3") ---- */
function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

async function readCharaFromPng(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!sig.every((b, i) => buf[i] === b)) throw new Error('Not a valid PNG file');

    const view = new DataView(buf.buffer);
    let offset = 8;
    let v2 = null;
    let v1 = null;

    while (offset + 8 <= buf.length) {
        const len = view.getUint32(offset);
        const type = latin1(buf.subarray(offset + 4, offset + 8));
        const dataStart = offset + 8;
        const dataEnd = dataStart + len;

        if (type === 'tEXt') {
            const bytes = buf.subarray(dataStart, dataEnd);
            const zero = bytes.indexOf(0);
            if (zero > 0) {
                const keyword = latin1(bytes.subarray(0, zero));
                if (keyword === 'chara' || keyword === 'ccv3') {
                    const b64 = latin1(bytes.subarray(zero + 1));
                    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)));
                    const parsed = JSON.parse(json);
                    if (keyword === 'ccv3') v2 = parsed; else v1 = parsed;
                }
            }
        }
        if (type === 'IEND') break;
        offset = dataEnd + 4; // skip CRC
    }
    return v2 || v1;
}

function cardToFields(raw) {
    const d = raw && raw.spec && raw.data ? raw.data : raw;
    const backstory = [
        d.description,
        d.personality ? `Personality: ${d.personality}` : '',
        d.scenario ? `Scenario: ${d.scenario}` : ''
    ].filter(Boolean).join('\n\n');
    return {
        name: d.name || '',
        intro: '',
        greeting: d.first_mes || '',
        backstory,
        tags: Array.isArray(d.tags) ? d.tags.join(', ') : ''
    };
}

async function handlePngImport(file, input) {
    try {
        const card = await readCharaFromPng(file);
        if (!card) throw new Error('No character data found in this PNG.');
        const f = cardToFields(card);
        if (!f.name) throw new Error('Character card has no name.');

        setVal('char-name', f.name);
        setVal('char-intro', f.intro);
        setVal('char-greetings', f.greeting);
        setVal('char-backstory', f.backstory);
        setVal('char-tags', f.tags);
        pendingImportAvatar = await resizeImageToDataURL(file);
        showToast('Card imported — review it, then save.', 'success');
    } catch (err) {
        console.error(err);
        showToast(`Import failed: ${err.message}`, 'error');
    } finally {
        if (input) input.value = '';
    }
}

/* ============================================================================
   SECTION 10 — CHAT
   ============================================================================ */
function renderMessages() {
    const box = document.getElementById('messages-container');
    if (!box) return;
    box.innerHTML = '';

    const c = getCharacter(currentCharacterId);
    if (!c) {
        box.appendChild(makeEmptyState('No conversation yet', 'Select or create a character to begin.'));
        return;
    }

    const chat = getChat(c.id);
    if (!chat.length && !isGenerating) {
        box.appendChild(makeEmptyState('Say hello', `Send a message to start chatting with ${c.name}.`));
    }

    for (const m of chat) box.appendChild(makeMessageNode(m));

    if (isGenerating) {
        const typing = document.createElement('div');
        typing.className = 'typing-indicator';
        typing.innerHTML = '<span></span><span></span><span></span>';
        box.appendChild(typing);
    }
    box.scrollTop = box.scrollHeight;
}

function makeEmptyState(title, text) {
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    const orb = document.createElement('div');
    orb.className = 'empty-orb';
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    wrap.append(orb, h, p);
    return wrap;
}

function makeMessageNode(m) {
    const div = document.createElement('div');
    div.className = `message ${m.role === 'user' ? 'user' : 'assistant'}`;
    const text = document.createElement('div');
    text.className = 'message-text';
    text.innerHTML = formatMessage(m.content || '');
    div.appendChild(text);
    return div;
}

function updateComposerState() {
    const input = document.getElementById('message-input');
    const send = document.getElementById('send-btn');
    const c = getCharacter(currentCharacterId);

    if (input) {
        input.disabled = !c;
        input.placeholder = c ? `Message ${c.name}…` : 'Select a character…';
    }
    if (send) send.disabled = !c || isGenerating || !val('message-input').trim();
}

function setGenerating(v) {
    isGenerating = v;
    updateComposerState();
    renderMessages();
}

/* Builds the history sent to the model: skips error bubbles, caps length,
   merges consecutive same-role turns, and starts with a user turn. */
function buildHistory(chat) {
    const usable = chat.filter(m => !m.error && m.content && m.content.trim());
    const recent = usable.slice(-HISTORY_LIMIT);
    const merged = [];
    for (const m of recent) {
        const last = merged[merged.length - 1];
        if (last && last.role === m.role) last.content += '\n\n' + m.content;
        else merged.push({ role: m.role, content: m.content });
    }
    if (merged[0] && merged[0].role === 'assistant') {
        merged.unshift({ role: 'user', content: '[Conversation begins]' });
    }
    return merged;
}

function buildSystemPrompt(c) {
    return [
        `You are roleplaying as ${c.name}. Stay fully in character at all times.`,
        c.gender ? `Gender: ${c.gender}.` : '',
        c.intro ? `Tagline: ${c.intro}` : '',
        c.backstory ? `Character details:\n${c.backstory}` : '',
        'Reply only with the character\'s words and actions. Use *asterisks* for actions and **double asterisks** for emphasis. Never write reasoning, notes, labels, or analysis. Keep replies natural and conversational.'
    ].filter(Boolean).join('\n\n');
}

async function sendMessage() {
    if (isGenerating) return;
    const c = getCharacter(currentCharacterId);
    if (!c) return;

    const input = document.getElementById('message-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    let cfg;
    try {
        cfg = getActiveConfig();
    } catch (err) {
        showToast(err.message, 'error');
        openModal('settings-modal');
        return;
    }

    const chat = getChat(c.id);
    chat.push({ role: 'user', content: text, ts: Date.now() });
    saveData();

    input.value = '';
    input.style.height = 'auto';
    setGenerating(true);

    try {
        const history = buildHistory(chat);
        const raw = await callModel(history, buildSystemPrompt(c), cfg);
        const reply = cleanAIResponse(raw, c.name) || '…';
        chat.push({ role: 'assistant', content: reply, ts: Date.now() });
        saveData();
    } catch (err) {
        console.error('[chat] request failed:', err);
        showToast(`AI error: ${err.message}`, 'error');
        // Keep the user's message; the error bubble is kept out of the model's history.
        chat.push({ role: 'assistant', content: `⚠️ ${err.message}`, ts: Date.now(), error: true });
        saveData();
    } finally {
        setGenerating(false);
        updateComposerState();
    }
}

function clearCurrentChat() {
    const c = getCharacter(currentCharacterId);
    if (!c) return;
    if (!window.confirm(`Clear your chat with ${c.name}?`)) return;
    appData.chats[c.id] = c.greeting
        ? [{ role: 'assistant', content: c.greeting, ts: Date.now() }]
        : [];
    saveData();
    renderMessages();
    showToast('Chat cleared', 'success');
}

/* ============================================================================
   SECTION 11 — AI PROVIDERS
   ============================================================================ */
function readSettingsFromForm() {
    const provider = val('provider-select') || 'gemini';
    const d = PROVIDERS[provider] || PROVIDERS.gemini;
    return {
        provider,
        apiKey: val('api-key-input').trim(),
        model: val('model-input').trim(),
        baseUrl: d.editableUrl ? val('base-url-input').trim() : '',
        temperature: Number(val('temperature-slider')) || 0.7,
        topP: Number(val('top-p-slider')) || 0.95,
        topK: Number(val('top-k-slider')) || 40,
        maxTokens: clamp(Number(val('max-tokens-input')) || 1024, 64, 8192),
        disableReasoning: !!document.getElementById('disable-reasoning-toggle')?.checked
    };
}

function resolveConfig(s) {
    const d = PROVIDERS[s.provider] || PROVIDERS.gemini;
    return {
        ...s,
        baseUrl: (s.baseUrl || d.baseUrl || '').replace(/\/+$/, ''),
        model: normalizeModelName(s.model || d.model, s.provider)
    };
}

function validateConfig(cfg) {
    if (!cfg.baseUrl) throw new Error('Set a Base URL in Settings for this provider.');
    if (!cfg.apiKey && cfg.provider !== 'ollama') throw new Error('Add your API key in Settings first.');
    if (!cfg.model) throw new Error('Set a model in Settings.');
}

function getActiveConfig() {
    const cfg = resolveConfig(appData.aiSettings);
    validateConfig(cfg);
    return cfg;
}

async function fetchWithTimeout(url, opts = {}, ms = 60000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('Request timed out.');
        throw new Error('Network error — check your connection, API key, or base URL.');
    } finally {
        clearTimeout(timer);
    }
}

async function readError(res) {
    try {
        const j = await res.json();
        const msg = (j && j.error && j.error.message) || (typeof j?.error === 'string' ? j.error : '') || j?.message;
        return msg || `HTTP ${res.status}`;
    } catch (_) {
        return `HTTP ${res.status}`;
    }
}

async function callModel(history, system, cfg) {
    if (cfg.provider === 'gemini') return callGemini(history, system, cfg);
    if (cfg.provider === 'anthropic') return callAnthropic(history, system, cfg);
    return callOpenAICompatible(history, system, cfg);
}

async function callGemini(history, system, cfg) {
    const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const generationConfig = {
        temperature: cfg.temperature,
        topP: cfg.topP,
        topK: cfg.topK,
        maxOutputTokens: cfg.maxTokens
    };
    if (cfg.disableReasoning && /flash/i.test(cfg.model)) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: history.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        })),
        generationConfig
    };

    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await readError(res));

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
    if (!text) {
        const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason;
        throw new Error(reason ? `No reply (${reason}).` : 'Empty response from Gemini.');
    }
    return text;
}

async function callAnthropic(history, system, cfg) {
    const res = await fetchWithTimeout(`${cfg.baseUrl}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: cfg.model,
            max_tokens: cfg.maxTokens,
            system,
            messages: history,
            temperature: Math.min(1, cfg.temperature)
        })
    });
    if (!res.ok) throw new Error(await readError(res));

    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) throw new Error('Empty response from Anthropic.');
    return text;
}

/* OpenAI, Groq, OpenRouter, Ollama and any OpenAI-compatible endpoint */
async function callOpenAICompatible(history, system, cfg) {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

    const res = await fetchWithTimeout(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'system', content: system }, ...history],
            temperature: cfg.temperature,
            top_p: cfg.topP,
            max_tokens: cfg.maxTokens
        })
    });
    if (!res.ok) throw new Error(await readError(res));

    const data = await res.json();
    const c = data.choices?.[0]?.message?.content;
    const text = typeof c === 'string'
        ? c
        : Array.isArray(c) ? c.map(p => p.text || '').join('') : '';
    if (!text.trim()) throw new Error('Empty response from the model.');
    return text.trim();
}

async function listModels(cfg) {
    if (cfg.provider === 'gemini') {
        const res = await fetchWithTimeout(
            `${cfg.baseUrl}/models?key=${encodeURIComponent(cfg.apiKey)}&pageSize=200`
        );
        if (!res.ok) throw new Error(await readError(res));
        const data = await res.json();
        return (data.models || [])
            .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
            .map(m => m.name.replace(/^models\//, ''));
    }

    const headers = {};
    if (cfg.provider === 'anthropic') {
        headers['x-api-key'] = cfg.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (cfg.apiKey) {
        headers.Authorization = `Bearer ${cfg.apiKey}`;
    }

    const res = await fetchWithTimeout(`${cfg.baseUrl}/models`, { headers });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return (data.data || []).map(m => m.id).filter(Boolean);
}

/* ============================================================================
   SECTION 12 — SETTINGS
   ============================================================================ */
function updateBaseUrlVisibility(provider) {
    const grp = document.getElementById('base-url-group');
    if (grp) grp.style.display = PROVIDERS[provider]?.editableUrl ? 'flex' : 'none';
}

function updateSettingsUI() {
    const s = appData.aiSettings;
    setVal('provider-select', s.provider);
    setVal('api-key-input', s.apiKey);
    setVal('model-input', s.model);
    setVal('base-url-input', s.baseUrl);

    setVal('temperature-slider', s.temperature);
    setText('temperature-value', s.temperature);
    setVal('top-p-slider', s.topP);
    setText('top-p-value', s.topP);
    setVal('top-k-slider', s.topK);
    setText('top-k-value', s.topK);
    setVal('max-tokens-input', s.maxTokens);
    setText('max-tokens-value', s.maxTokens);

    setChecked('disable-reasoning-toggle', s.disableReasoning);
    setChecked('show-ads-toggle', !appData.adDismissed);
    setChecked('show-popunder-toggle', popunderOn);
    updateBaseUrlVisibility(s.provider);
    updatePopunderUI();
}

function saveSettings() {
    const form = readSettingsFromForm();
    const d = PROVIDERS[form.provider] || PROVIDERS.gemini;

    if (form.provider === 'custom' && !form.baseUrl) {
        showToast('Enter a Base URL for the custom provider.', 'error');
        return;
    }

    appData.aiSettings = {
        ...appData.aiSettings,
        provider: form.provider,
        apiKey: form.apiKey,
        model: form.model || d.model,
        baseUrl: form.baseUrl,
        temperature: form.temperature,
        topP: form.topP,
        topK: form.topK,
        maxTokens: form.maxTokens,
        disableReasoning: form.disableReasoning
    };
    if (saveData()) {
        showToast('Settings saved', 'success');
        closeModal('settings-modal');
    }
}

async function testAndAutoSelectModel() {
    const out = document.getElementById('model-test-result');
    const setResult = (msg, ok) => {
        if (!out) return;
        out.textContent = msg;
        out.style.color = ok === null ? '' : ok ? 'var(--success)' : 'var(--danger)';
    };

    const cfg = resolveConfig(readSettingsFromForm());
    try {
        validateConfig(cfg);
        setResult('Testing…', null);
        const models = await listModels(cfg);
        if (!models.length) {
            setResult('Connected, but the provider returned no models.', false);
            return;
        }

        const modelInput = document.getElementById('model-input');
        if (modelInput && !modelInput.value.trim()) modelInput.value = models[0];

        const chosen = normalizeModelName(modelInput?.value || cfg.model, cfg.provider);
        const listed = models.includes(chosen);
        setResult(
            `✓ Connected · ${models.length} models${listed ? '' : ' · model not in the provider\'s list'}`,
            true
        );
    } catch (err) {
        setResult(`✕ ${err.message}`, false);
    }
}

function clearAllData() {
    if (!window.confirm('Delete all characters, chats and settings? This cannot be undone.')) return;
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(POPUNDER_LAST_LOAD_KEY);
        localStorage.removeItem(SIDEBAR_AD_DISMISSED_KEY);
        sessionStorage.removeItem(POPUNDER_SESSION_KEY);
    } catch (_) {}
    location.reload();
}

/* ============================================================================
   SECTION 13 — EVENT LISTENERS
   ============================================================================ */
function setupEventListeners() {
    const overlay = document.getElementById('sidebar-overlay');

    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => setDrawer(true));
    document.getElementById('mobile-settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    overlay?.addEventListener('click', () => setDrawer(false));

    document.getElementById('add-char-btn')?.addEventListener('click', () => openModal('character-modal'));
    document.getElementById('settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('clear-chat-btn')?.addEventListener('click', clearCurrentChat);
    document.getElementById('search-input')?.addEventListener('input', renderCharacterList);

    const ta = document.getElementById('message-input');
    ta?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(ov => closeModal(ov.id));
        setDrawer(false);
    });

    document.getElementById('provider-select')?.addEventListener('change', (e) => {
        const p = e.target.value;
        const d = PROVIDERS[p] || PROVIDERS.gemini;
        setVal('model-input', d.model);
        setVal('base-url-input', d.editableUrl && p !== 'ollama' ? '' : d.baseUrl);
        updateBaseUrlVisibility(p);
        setText('model-test-result', '');
    });

    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
    document.getElementById('test-models-btn')?.addEventListener('click', testAndAutoSelectModel);

    const liveLabel = (sliderId, labelId) => {
        document.getElementById(sliderId)?.addEventListener('input', (e) => setText(labelId, e.target.value));
    };
    liveLabel('temperature-slider', 'temperature-value');
    liveLabel('top-p-slider', 'top-p-value');
    liveLabel('top-k-slider', 'top-k-value');
    liveLabel('max-tokens-input', 'max-tokens-value');

    document.getElementById('disable-reasoning-toggle')?.addEventListener('change', (e) => {
        appData.aiSettings.disableReasoning = e.target.checked;
        saveData();
    });

    document.getElementById('char-avatar')?.addEventListener('change', () => {
        pendingImportAvatar = null;
    });
    document.getElementById('save-char-btn')?.addEventListener('click', saveCharacter);
    document.getElementById('import-png')?.addEventListener('change', (e) => {
        const f = e.target.files?.[0];
        if (f) handlePngImport(f, e.target);
    });

}
