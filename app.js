/* ============================================================================
   SECTION 1 — CONSTANTS & STATE
   ============================================================================ */
const STORAGE_KEY = 'aiCharacterAppData';

let appData = {
    aiSettings: {
        provider: 'gemini',
        apiKey: '',
        model: 'gemini-3.1-flash-lite',
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

/* =========================================================
   ADSTERRA CONFIG
   ========================================================= */
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
const POPUNDER_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes interval
const SIDEBAR_AD_DISMISSED_KEY = 'hubs_sidebar_ad_dismissed';

/* ============================================================================
   SECTION 2 — BOOTSTRAP
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    loadPopunderOnce();
    initAds();
    renderCharacterList();
    setupEventListeners();
    updateSettingsUI();
});

/* ============================================================================
   SECTION 3 — PERSISTENCE
   ============================================================================ */
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
    } catch (e) { console.error('Failed to load data', e); }
}

function saveData() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); }
    catch (e) { console.error('Failed to save data', e); }
}

/* ============================================================================
   SECTION 4 — INDEXEDDB FOR AVATARS
   ============================================================================ */
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
   SECTION 6 — RESPONSE SANITIZER
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
        firstRealIdx = i; break;
    }
    if (firstRealIdx > 0) reply = lines.slice(firstRealIdx).join('\n');

    reply = reply.replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '');
    reply = reply.replace(/\[\/?REASONING\]/gi, '');

    const headerLines = [
        /^\s*\*\s*format\s*:.*\$/gim, /^\s*\*\s*user\s+asks?\s*:.*\$/gim,
        /^\s*\*\s*character\s*:.*\$/gim, /^\s*\*\s*input\s+context\s*:.*\$/gim,
        /^\s*\*\s*internal\s+state\s*:.*\$/gim, /^\s*\*\s*motivation\s*:.*\$/gim,
        /^\s*\*\s*emotion\s*:.*\$/gim, /^\s*\*\s*direct\s+response\s*:.*\$/gim,
        /^\s*\*\s*dialogue\s*\/\s*action\s*:.*\$/gim, /^\s*\*\s*length\s*:.*\$/gim,
        /^\s*\*\s*followed\s+by.*\$/gim, /^\s*\*\s*no\s+meta-text.*\$/gim,
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

/* ============================================================================
   SECTION 7 — ADS & POPUNDER RECODED
   ============================================================================ */
let popunderOn = true;
let popunderScriptLoaded = false;

const ALLOWED_TARGETS = 'button, input, textarea, select, label, a, [data-no-ad-block]';

function installPopunderGate() {
    document.addEventListener('click', (e) => {
        if (popunderOn) return;
        const t = e.target;
        if (!t) return;
        if (t.closest && t.closest(ALLOWED_TARGETS)) return;
        e.stopImmediatePropagation();
    }, true);
}

function loadPopunderOnce() {
    if (!popunderOn) return;
    const cfg = ADSTERRA_CONFIG.popunder;
    if (!cfg.enabled) return;

    const lastLoad = localStorage.getItem(POPUNDER_LAST_LOAD_KEY);
    const now = Date.now();
    if (lastLoad && (now - parseInt(lastLoad, 10) < POPUNDER_INTERVAL_MS)) {
        return;
    }

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
    slot.innerHTML = '';

    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = cfg.scriptSrc;

    s.onload = () => { if (fallback) fallback.style.display = 'none'; };
    s.onerror = () => { if (fallback) fallback.style.display = 'inline'; };

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
    s.src = `${cfg.invokeUrl}/${cfg.key}/invoke.js`;

    s.onload = () => { if (fallback) fallback.style.display = 'none'; };
    s.onerror = () => { if (fallback) fallback.style.display = 'inline'; };

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
    installPopunderGate();
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
}

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

/* ============================================================================
   SECTION 9 — TOAST & SETTINGS HELPERS
   ============================================================================ */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icons = { info: 'ℹ️', error: '⚠️', success: '✅' };
    toast.innerHTML =
