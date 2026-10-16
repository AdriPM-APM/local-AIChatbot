/* ============================================================================
   Hubs — app.js (recoded)
   Chat, AI providers, characters, settings, and ad placements.
   ============================================================================ */

/* ============================================================================
   SECTION 1 — CONSTANTS & STATE
   ============================================================================ */
const STORAGE_KEY = 'aiCharacterAppData';
const HISTORY_LIMIT = 40;
const SIDEBAR_AD_KEY = 'hubs_sidebar_ad_dismissed';   // '1' = hidden. Read by anti-adblock.js
const POPUNDER_KEY = 'hubs_popunder_enabled';         // '0' = off, anything else = on
const POPUNDER_LAST_KEY = 'hubs_popunder_last_armed'; // timestamp of the last popunder armed
const POPUNDER_COOLDOWN_MS = 30 * 60 * 1000;          // at most one popunder every 30 minutes

const PROVIDERS = {
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it:free', editableUrl: false },
    gemini:     { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-lite', editableUrl: false },
    openai:     { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', editableUrl: false },
    anthropic:  { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', editableUrl: false },
    groq:       { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', editableUrl: false },
    ollama:     { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', editableUrl: true },
    custom:     { baseUrl: '', model: '', editableUrl: true }
};

/* Adsterra. The 300x250 sidebar code lives inline in index.html (it must, for document.write). */
const ADSTERRA = {
    topBanner: {
        containerId: 'container-a3f099d87b664187036e6176973d0255',
        scriptSrc: 'https://archeryconditionssniff.com/a3f099d87b664187036e6176973d0255/invoke.js'
    },
    popunder: {
        scriptSrc: 'https://archeryconditionssniff.com/a1/e6/0b/a1e60b63132f321aa7152ef962227e12.js'
    }
};

/* Every 300x250 placement. "house" is the built-in card shown when the ad slot stays empty. */
const SIDEBAR_PLACEMENTS = [
    { wrap: 'sidebar-ad', slot: 'sidebar-ad-slot', house: 'sidebar-house', btn: 'sidebar-house-btn', close: 'sidebar-ad-close' },
    { wrap: 'mobile-ad',  slot: 'mobile-ad-slot',  house: 'mobile-house',  btn: 'mobile-house-btn',  close: 'mobile-ad-close' }
];

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
        adDismissed: false,          // top banner closed by the user
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
   SECTION 2 — BOOTSTRAP
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    const safe = (name, fn) => {
        try { fn(); } catch (e) { console.error(`[boot] ${name} failed:`, e); }
    };
    safe('loadData', loadData);
    safe('setupEventListeners', setupEventListeners);
    safe('restoreSession', restoreSession);
    safe('initAds', initAds);
    safe('initSupport', initSupport);
    safe('updateSettingsUI', updateSettingsUI);
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

/* PolyBuzz-style formatting: **bold** and *action in grey italics*. Input is escaped first. */
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

/* Shrinks an image so avatars don't fill localStorage. */
function resizeImageToDataURL(source, max = 256) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const isBlob = typeof source !== 'string';
        const url = isBlob ? URL.createObjectURL(source) : source;
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
                if (isBlob) URL.revokeObjectURL(url);
            }
        };
        img.onerror = () => {
            if (isBlob) URL.revokeObjectURL(url);
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
   SECTION 6 — RESPONSE SANITIZER (strips leaked reasoning and labels)
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
   SECTION 7 — ADS
   Top banner: dynamic container script (works).
   Popunder: loaded on page load when enabled; toggling off applies on next load.
   Sidebar and mobile 300x250: inline Adsterra code, with a house card when empty.
   ============================================================================ */

/* ---- Top banner ---- */
function renderTopAd() {
    const banner = document.getElementById('ad-banner');
    if (!banner) return;
    if (appData.adDismissed) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'flex';
    loadTopBannerScript();
}

function loadTopBannerScript() {
    if (topBannerLoaded) return;
    const slot = document.getElementById(ADSTERRA.topBanner.containerId);
    const fallback = document.getElementById('ad-fallback');
    if (!slot) return;

    topBannerLoaded = true;
    slot.innerHTML = '';
    const s = document.createElement('script');
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = ADSTERRA.topBanner.scriptSrc;
    s.onload = () => { if (fallback) fallback.style.display = 'none'; };
    s.onerror = () => {
        topBannerLoaded = false;
        if (fallback) fallback.style.display = 'inline';
    };
    slot.appendChild(s);
}

/* Hides the banner but keeps its wrapper, so the ✕ button and the re-enable path still work. */
function dismissTopAd() {
    appData.adDismissed = true;
    saveData();
    const banner = document.getElementById('ad-banner');
    if (banner) banner.style.display = 'none';
    const slot = document.getElementById(ADSTERRA.topBanner.containerId);
    if (slot) slot.innerHTML = '';
    topBannerLoaded = false;
    setChecked('show-ads-toggle', false);
    showToast('Top banner disabled.', 'info');
}

function requestDisableTopAd() {
    if (appData.adDismissed) return;
    openModal('disable-ads-modal');
}

/* ---- Popunder ---- */
function isPopunderEnabled() {
    try { return localStorage.getItem(POPUNDER_KEY) !== '0'; }
    catch (_) { return true; }
}

function loadPopunder() {
    if (popunderLoaded || !isPopunderEnabled()) return;
    popunderLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = ADSTERRA.popunder.scriptSrc;
    s.onerror = () => {
        popunderLoaded = false;
        console.warn('[ads] Popunder blocked or failed to load.');
    };
    document.body.appendChild(s);
}

/* Arms the popunder on the visitor's first tap/click, and only when 30 minutes
   have passed since the last one. Loading on a gesture also keeps browsers
   from treating it as a pop-up on arrival. */
function armPopunder() {
    if (!isPopunderEnabled() || popunderLoaded) return;
    const onFirstInteraction = () => {
        if (!isPopunderEnabled() || popunderLoaded) return;
        let last = 0;
        try { last = Number(localStorage.getItem(POPUNDER_LAST_KEY)) || 0; } catch (_) {}
        if (Date.now() - last < POPUNDER_COOLDOWN_MS) return;
        loadPopunder();
        try { localStorage.setItem(POPUNDER_LAST_KEY, String(Date.now())); } catch (_) {}
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, onFirstInteraction, { once: true, passive: true })
    );
}

function setPopunderEnabled(on) {
    try { localStorage.setItem(POPUNDER_KEY, on ? '1' : '0'); } catch (_) {}
    if (on) {
        armPopunder();
        showToast('Popunder on — at most once every 30 minutes.', 'success');
    } else {
        showToast('Popunder off.', 'info');
    }
    updatePopunderUI();
}

function updatePopunderUI() {
    const on = isPopunderEnabled();
    const pill = document.getElementById('popunder-pill');
    if (pill) {
        pill.classList.remove('hidden');
        pill.classList.toggle('off', !on);
    }
    setText('popunder-state', on ? 'ON' : 'OFF');
    setChecked('popunder-switch', on);
    setChecked('show-popunder-toggle', on);
}

/* ---- Sidebar and mobile 300x250 ---- */
function isSidebarAdHidden() {
    try { return localStorage.getItem(SIDEBAR_AD_KEY) === '1'; }
    catch (_) { return false; }
}

function setSidebarAdHidden(hidden) {
    try { localStorage.setItem(SIDEBAR_AD_KEY, hidden ? '1' : '0'); } catch (_) {}
    applySidebarVisibility();
    setChecked('show-sidebar-toggle', !hidden);
}

function applySidebarVisibility() {
    const hidden = isSidebarAdHidden();
    for (const p of SIDEBAR_PLACEMENTS) {
        document.getElementById(p.wrap)?.classList.toggle('hidden', hidden);
    }
    if (!hidden) refreshSidebarHouse();
}

/* Shows the house card when Adsterra has not written an iframe into the slot; shows the ad otherwise. */
function refreshSidebarHouse() {
    for (const p of SIDEBAR_PLACEMENTS) {
        const slot = document.getElementById(p.slot);
        const house = document.getElementById(p.house);
        if (!slot || !house) continue;
        const hasAd = !!slot.querySelector('iframe, ins');
        slot.hidden = !hasAd;
        house.hidden = hasAd;
    }
}

function dismissSidebarAd() {
    setSidebarAdHidden(true);
    showToast('Sidebar ad hidden. Turn it back on in Settings.', 'info');
}

function initAds() {
    /* The sidebar ad comes back on every page load. The Settings switch only applies to this visit. */
    try { localStorage.removeItem(SIDEBAR_AD_KEY); } catch (_) {}
    renderTopAd();
    applySidebarVisibility();

    /* Re-check the slots when the ad writes into them (no polling needed). */
    if ('MutationObserver' in window) {
        const mo = new MutationObserver(refreshSidebarHouse);
        for (const p of SIDEBAR_PLACEMENTS) {
            const slot = document.getElementById(p.slot);
            if (slot) mo.observe(slot, { childList: true, subtree: true });
        }
    }
    [4000, 10000, 20000].forEach(ms => setTimeout(refreshSidebarHouse, ms));

    armPopunder();
    updatePopunderUI();
}

/* ============================================================================
   SECTION 8 — UI HELPERS (modals, toasts, drawer)
   ============================================================================ */
/* ============================================================================
   SECTION 7b — SUPPORT & TIPS
   PayPal.me links only. Hubs never handles, stores, or sees payment details.
   ============================================================================ */
const SUPPORT = {
    /* Your PayPal.me name, e.g. 'yourname' for paypal.me/yourname.
       Leave it empty to hide the "Support Hubs" button. */
    siteUser: 'https://paypal.me/AdriaPozo',
    presets: [1, 3, 5, 10]
};

/* Accepts "yourname" or "https://paypal.me/yourname"; returns the bare name or ''. */
function normalizePaypalUser(input) {
    const v = (input || '').trim();
    if (!v) return '';
    const m = v.match(/paypal\.me\/([A-Za-z0-9._-]{1,50})/i);
    if (m) return m[1];
    return /^[A-Za-z0-9._-]{1,50}$/.test(v) ? v : '';
}

function paypalLink(user, amount) {
    const base = `https://paypal.me/${encodeURIComponent(user)}`;
    return amount ? `${base}/${Number(amount).toFixed(2)}USD` : base;
}

function renderPresetLinks(containerId, user) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = '';
    for (const amt of SUPPORT.presets) {
        const a = document.createElement('a');
        a.className = 'pill-btn preset-btn';
        a.href = paypalLink(user, amt);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
               a.textContent = `$${amt}`;
        box.appendChild(a);
    }
}

function initSupport() {
    const user = normalizePaypalUser(SUPPORT.siteUser);
    const btn = document.getElementById('support-btn');
    if (!user) {
        if (btn) btn.classList.add('hidden');
        return;
    }
    if (btn) btn.classList.remove('hidden');
    renderPresetLinks('support-presets', user);
    const other = document.getElementById('support-other');
    if (other) other.href = paypalLink(user, '');
}

/* ============================================================================
   SECTION 8 — TOAST NOTIFICATIONS
   ============================================================================ */
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
   SECTION 9 — EVENT LISTENERS & UI WIRING
   ============================================================================ */
function setupEventListeners() {
    // Mobile navigation & sidebar toggles
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => toggleSidebar(true));
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => toggleSidebar(false));
    document.getElementById('mobile-settings-btn')?.addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('settings-btn')?.addEventListener('click', () => openModal('settings-modal'));

    // Ad close buttons
    document.getElementById('close-ad')?.addEventListener('click', requestDisableTopAd);
    document.getElementById('confirm-disable-ads')?.addEventListener('click', () => {
        dismissTopAd();
        closeModal('disable-ads-modal');
    });
    document.getElementById('keep-ads')?.addEventListener('click', () => closeModal('disable-ads-modal'));
    document.getElementById('sidebar-ad-close')?.addEventListener('click', dismissSidebarAd);
    document.getElementById('mobile-ad-close')?.addEventListener('click', dismissSidebarAd);

    // Popunder switch
    document.getElementById('popunder-switch')?.addEventListener('change', (e) => setPopunderEnabled(e.target.checked));
    document.getElementById('show-popunder-toggle')?.addEventListener('change', (e) => setPopunderEnabled(e.target.checked));

    // Sidebar House buttons
    document.getElementById('sidebar-house-btn')?.addEventListener('click', () => openCharacterModal());
    document.getElementById('mobile-house-btn')?.addEventListener('click', () => openCharacterModal());

    // Character management
    document.getElementById('add-char-btn')?.addEventListener('click', () => openCharacterModal());
    document.getElementById('save-char-btn')?.addEventListener('click', saveCharacterFromModal);
    document.getElementById('search-input')?.addEventListener('input', (e) => filterCharacterList(e.target.value));

    // Chat interactions
    document.getElementById('send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('message-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById('clear-chat-btn')?.addEventListener('click', clearCurrentChat);

    // Support modal
    document.getElementById('support-btn')?.addEventListener('click', () => openModal('support-modal'));

    // Settings actions
    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettingsFromModal);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
    document.getElementById('provider-select')?.addEventListener('change', (e) => handleProviderChange(e.target.value));

    // Sliders live updates
    setupSliderSync('temperature-slider', 'temperature-value');
    setupSliderSync('top-p-slider', 'top-p-value');
    setupSliderSync('top-k-slider', 'top-k-value');

    // Generic close modal buttons
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
   SECTION 10 — CHARACTER RENDERING & LIST
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

/* ============================================================================
   SECTION 11 — CHAT & MESSAGES
   ============================================================================ */
function updateHeader() {
    const char = getCharacter(currentCharacterId);
    const avatarEl = document.getElementById('chat-avatar');
    const nameEl = document.getElementById('chat-name');
    const subtitleEl = document.getElementById('chat-subtitle');
    const clearBtn = document.getElementById('clear-chat-btn');
    const tipBtn = document.getElementById('tip-btn');

    if (!char) {
        avatarEl?.classList.add('hidden');
        if (nameEl) nameEl.textContent = 'Select a character';
        if (subtitleEl) subtitleEl.textContent = 'Pick from your hubs or create a new one';
        clearBtn?.classList.add('hidden');
        tipBtn?.classList.add('hidden');
        return;
    }

    if (avatarEl) {
        avatarEl.src = char.avatar || defaultAvatarDataUri(char.name);
        avatarEl.classList.remove('hidden');
    }
    if (nameEl) nameEl.textContent = char.name;
    if (subtitleEl) subtitleEl.textContent = char.intro || 'AI Character';
    clearBtn?.classList.remove('hidden');

    if (char.paypal) {
        tipBtn?.classList.remove('hidden');
        const user = normalizePaypalUser(char.paypal);
        if (tipBtn && user) tipBtn.onclick = () => window.open(paypalLink(user, 3), '_blank');
    } else {
        tipBtn?.classList.add('hidden');
    }
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

    if (messages.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-orb"></div>
                <h3>Start chatting with ${escapeHtml(char.name)}</h3>
                <p>Send a message below.</p>
            </div>`;
        return;
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
   SECTION 12 — AI API CLIENT
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
        console.error('AI error:', err);
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

    const systemPrompt = `You are roleplaying as ${char.name}.
Backstory & Personality: ${char.backstory || char.intro || 'An AI character.'}
Guidelines: Stay completely in character. Never break character. Write engaging dialogue and actions in asterisks.`;

    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content }))
    ];

    let endpoint = url;
    let headers = { 'Content-Type': 'application/json' };
    let body = {};

    if (provider === 'gemini') {
        endpoint = `${url}/models/${normModel}:generateContent?key=${apiKey}`;
        const contents = apiMessages.map(m => ({
            role: m.role === 'system' ? 'user' : m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        body = { contents, generationConfig: { temperature, topP, topK, maxOutputTokens: maxTokens } };
    } else if (provider === 'anthropic') {
        endpoint = `${url}/messages`;
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        body = {
            model: normModel,
            system: systemPrompt,
            messages: history.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content })),
            max_tokens: maxTokens,
            temperature
        };
    } else {
        // OpenAI compatible (OpenRouter, Groq, OpenAI, Ollama, Custom)
        endpoint = `${url}/chat/completions`;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        if (provider === 'openrouter') {
            headers['HTTP-Referer'] = window.location.origin;
            headers['X-Title'] = 'Hubs Chat';
        }
        body = {
            model: normModel,
            messages: apiMessages,
            temperature,
            top_p: topP,
            max_tokens: maxTokens
        };
    }

    const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error (${res.status}): ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    let rawReply = '';

    if (provider === 'gemini') {
        rawReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (provider === 'anthropic') {
        rawReply = data.content?.[0]?.text || '';
    } else {
        rawReply = data.choices?.[0]?.message?.content || '';
    }

    return cleanAIResponse(rawReply, char.name);
}

/* ============================================================================
   SECTION 13 — SETTINGS & CHARACTER MODALS
   ============================================================================ */
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
    setChecked('disable-reasoning-toggle', s.disableReasoning);
    setChecked('show-ads-toggle', !appData.adDismissed);
    setChecked('show-sidebar-toggle', !isSidebarAdHidden());
    setChecked('show-popunder-toggle', isPopunderEnabled());

    handleProviderChange(s.provider);
}

function handleProviderChange(provider) {
    const conf = PROVIDERS[provider] || PROVIDERS.custom;
    const baseUrlGroup = document.getElementById('base-url-group');
    if (baseUrlGroup) {
        baseUrlGroup.style.display = conf.editableUrl ? 'flex' : 'none';
    }
    const modelInput = document.getElementById('model-input');
    if (modelInput && !modelInput.value) {
        modelInput.value = conf.model;
    }
}

function saveSettingsFromModal() {
    const provider = val('provider-select');
    appData.aiSettings = {
        provider,
        apiKey: val('api-key-input').trim(),
        model: val('model-input').trim() || PROVIDERS[provider].model,
        baseUrl: val('base-url-input').trim(),
        temperature: parseFloat(val('temperature-slider')) || 0.7,
        topP: parseFloat(val('top-p-slider')) || 0.95,
        topK: parseInt(val('top-k-slider'), 10) || 40,
        maxTokens: parseInt(val('max-tokens-input'), 10) || 1024,
        disableReasoning: document.getElementById('disable-reasoning-toggle')?.checked ?? true
    };

    const showAds = document.getElementById('show-ads-toggle')?.checked ?? true;
    if (showAds && appData.adDismissed) {
        appData.adDismissed = false;
        renderTopAd();
    } else if (!showAds && !appData.adDismissed) {
        dismissTopAd();
    }

    setSidebarAdHidden(!(document.getElementById('show-sidebar-toggle')?.checked ?? true));
    setPopunderEnabled(document.getElementById('show-popunder-toggle')?.checked ?? true);

    if (saveData()) {
        showToast('Settings saved successfully.', 'success');
        closeModal('settings-modal');
    }
}

function clearAllData() {
    if (confirm('Are you sure you want to delete all characters, chats, and settings? This cannot be undone.')) {
        localStorage.removeItem(STORAGE_KEY);
        appData = defaultAppData();
        currentCharacterId = null;
        renderAll();
        closeModal('settings-modal');
        showToast('All data cleared.', 'info');
    }
}

function openCharacterModal() {
    setVal('char-name', '');
    setVal('char-intro', '');
    setVal('char-greetings', '');
    setVal('char-backstory', '');
    setVal('char-paypal', '');
    setVal('char-tags', '');
    setChecked('char-private', false);
    pendingImportAvatar = null;
    openModal('character-modal');
}

async function saveCharacterFromModal() {
    const name = val('char-name').trim();
    if (!name) {
        showToast('Character name is required.', 'error');
        return;
    }

    let avatar = pendingImportAvatar;
    const fileInput = document.getElementById('char-avatar');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        try {
            avatar = await resizeImageToDataURL(fileInput.files[0], 256);
        } catch (e) {
            console.error('Avatar resize failed', e);
        }
    }

    const newChar = {
        id: newId(),
        name,
        gender: val('char-gender'),
        intro: val('char-intro').trim(),
        greetings: val('char-greetings').trim(),
        backstory: val('char-backstory').trim(),
        paypal: val('char-paypal').trim(),
        private: document.getElementById('char-private')?.checked || false,
        tags: val('char-tags').split(',').map(t => t.trim()).filter(Boolean),
        avatar: avatar || defaultAvatarDataUri(name)
    };

    appData.characters.push(newChar);
    currentCharacterId = newChar.id;
    appData.lastCharacterId = newChar.id;
    saveData();
    renderAll();
    closeModal('character-modal');
    showToast(`Created character ${name}!`, 'success');
}

/* ============================================================================
   SECTION 14 — AI MODEL TESTING & AUTO-DISCOVERY ALGORITHM (UPDATED)
   ============================================================================ */
async function testAIModel() {
    const resultEl = document.getElementById('model-test-result');
    const modelInput = document.getElementById('model-input');
    const provider = val('provider-select');
    const apiKey = val('api-key-input').trim();
    const baseUrl = val('base-url-input').trim();

    if (!resultEl || !modelInput) return;

    let targetModel = modelInput.value.trim();

    // OpenRouter: El usuario puede escribirlo, pero si lo olvida o hay un despiste, `:free` es el valor por defecto [Verificable].
    if (provider === 'openrouter') {
        if (!targetModel) {
            targetModel = 'google/gemma-3-27b-it:free'; // Modelo ligero y gratuito por defecto [Verificable]
        } else if (!targetModel.includes(':free') && !targetModel.includes(':paid')) {
            targetModel = targetModel + ':free';
        }
    }

    resultEl.textContent = 'Probando conexión y modelo...';
    resultEl.style.color = 'var(--text-2)';

    try {
        let success = false;
        let workingModel = targetModel;

        if (provider === 'gemini') {
            // Gemini: Prioriza el modelo introducido por el usuario, luego busca opciones ligeras y actuales [Verificable].
            const candidates = [
/* ============================================================================
   SECTION 14 — AI MODEL TESTING & AUTO-DISCOVERY ALGORITHM (UPDATED)
   ============================================================================ */
async function testAIModel() {
    const resultEl = document.getElementById('model-test-result');
    const modelInput = document.getElementById('model-input');
    const provider = val('provider-select');
    const apiKey = val('api-key-input').trim();
    const baseUrl = val('base-url-input').trim();

    if (!resultEl || !modelInput) return;

    let targetModel = modelInput.value.trim();

    // OpenRouter: El usuario puede escribirlo; si se olvida o hay despiste, `:free` es el valor por defecto [Verificable].
    if (provider === 'openrouter') {
        if (!targetModel) {
            targetModel = 'google/gemma-3-27b-it:free'; // Modelo ligero y gratuito por defecto [Verificable]
        } else if (!targetModel.includes(':free') && !targetModel.includes(':paid')) {
            targetModel = targetModel + ':free';
        }
    }

    resultEl.textContent = 'Probando conexión y modelo...';
    resultEl.style.color = 'var(--text-2)';

    try {
        let success = false;
        let workingModel = targetModel;

        if (provider === 'gemini') {
            // Gemini: Prioriza la entrada del usuario, luego recorre los modelos ligeros y actuales disponibles
            const candidates = [
                targetModel,
                'gemini-3.8-flash',
                'gemini-3.5-flash-lite',
                'gemini-3.1-flash-lite'
            ].filter(Boolean);

            const uniqueCandidates = [...new Set(candidates)];

            for (const m of uniqueCandidates) {
                try {
                    const normM = normalizeModelName(m, 'gemini');
                    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${normM}:generateContent?key=${apiKey}`;
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: 'Ping' }] }] })
                    });
                    if (res.ok) {
                        workingModel = m;
                        success = true;
                        break;
                    }
                } catch (e) {
                    // Pasa al siguiente candidato si este no responde
                }
            }
        } else {
            // Comprobación estándar para OpenAI, Anthropic, Groq, Ollama y personalizados
            const conf = PROVIDERS[provider] || PROVIDERS.custom;
            const url = provider === 'custom' || provider === 'ollama' ? (baseUrl || conf.baseUrl) : conf.baseUrl;
            const endpoint = provider === 'anthropic' ? `${url}/messages` : `${url}/chat/completions`;
            
            let headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            if (provider === 'anthropic') {
                headers['x-api-key'] = apiKey;
                headers['anthropic-version'] = '2023-06-01';
            }
            if (provider === 'openrouter') {
                headers['HTTP-Referer'] = window.location.origin;
                headers['X-Title'] = 'Hubs Chat';
            }

            let body = {
                model: workingModel,
                messages: [{ role: 'user', content: 'Ping' }],
                max_tokens: 10
            };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            success = res.ok;
            if (!res.ok) {
                const errData = await res.text();
                throw new Error(errData.slice(0, 100));
            }
        }

        if (success) {
            modelInput.value = workingModel;
            resultEl.textContent = `✓ ¡Conectado con éxito! El modelo "${workingModel}" responde correctamente [Verificable].`;
            resultEl.style.color = 'var(--success)';
            showToast(`¡Modelo ${workingModel} verificado y operativo!`, 'success');
        } else {
            throw new Error('La prueba del modelo falló o no hay conexión [Verificable].');
        }
    } catch (err) {
        resultEl.textContent = `✗ Error de conexión: ${err.message} [Verificable].`;
        resultEl.style.color = 'var(--danger)';
        showToast('Fallo en la prueba del modelo. Comprueba la clave API.', 'error');
    }
    }
               
