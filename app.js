// ==========================================
// 1. Constants & State
// ==========================================
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
    popunderHidden: false,      // NEW: session-only, always reset on load
    characters: [],
    chats: {}
};

let currentCharacterId = null;
let isGenerating = false;

// =========================================================
// ADS CONFIG — your real Adsterra keys
// =========================================================
const ADSTERRA_CONFIG = {
    banner: {
        enabled: true,
        containerId: 'container-a3f099d87b664187036e6176973d0255',
        scriptSrc: 'https://archeryconditionssniff.com/a3f099d87b664187036e6176973d0255/invoke.js'
    },
    popunder: {
        enabled: true,
        scriptSrc: 'https://archeryconditionssniff.com/a1/e6/0b/a1e60b63132f321aa7152ef962227e12.js'
    }
};

// Prioritizes lighter, older, and high-efficiency models first
const TEST_MODELS = {
    openrouter: [
        'google/gemma-2-9b-it:free',
        'meta-llama/llama-3.1-8b-instruct:free',
        'mistralai/mistral-7b-instruct:free',
        'google/gemma-4-26b-a4b-it:free',
        'deepseek/deepseek-r1:free'
    ],
    gemini: [
        'gemini-3.1-flash-lite',
        'gemini-3.4-flash-lite',
        'gemini-3.5-flash-lite',
        'gemini-3.6-flash',
        'gemini-3.8-flash',
        'gemma-2-9b-it',
        'gemma-2-27b-it',
        'gemma-4-26b-a4b-it',
        'gemma-4-31b-it'
    ],
    openai: [
        'gpt-4o-mini',
        'gpt-3.5-turbo',
        'gpt-4o',
        'o1-mini',
        'o3-mini'
    ],
    anthropic: [
        'claude-3-haiku-20240307',
        'claude-3-5-haiku-latest',
        'claude-3-5-sonnet-latest',
        'claude-3-7-sonnet-latest'
    ],
    groq: [
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'llama-3.3-70b-versatile'
    ],
    ollama: [
        'gemma2',
        'llama3.2',
        'mistral',
        'llama3.3',
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
    initAds();              // <-- NEW: ads first
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
// 7. ADS — Banner (Native) + Popunder
// ==========================================
const POPUNDER_SESSION_KEY = 'hubs_popunder_hidden_session';

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

/* ---------- Banner (Adsterra Native) ---------- */
function loadAdsterraBanner() {
    const cfg = ADSTERRA_CONFIG.banner;
    const slot = document.getElementById(cfg.containerId);
    const fallback = document.getElementById('ad-fallback');
    if (!slot) return;

    if (!cfg.enabled) {
        slot.innerHTML = '';
        if (fallback) fallback.style.display = 'inline';
        return;
    }

    if (fallback) fallback.style.display = 'none';
    slot.innerHTML = '';

    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = cfg.scriptSrc;
    s.onerror = () => { if (fallback) fallback.style.display = 'inline'; };
    slot.appendChild(s);
}

function renderAdBanner() {
    const banner = document.getElementById('ad-banner');
    if (!banner) return;
    if (appData.adDismissed) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'flex';
    loadAdsterraBanner();
}

function dismissAd() {
    appData.adDismissed = true;
    saveData();
    renderAdBanner();
}

/* ---------- Popunder (Adsterra) ---------- */
function loadAdsterraPopunder() {
    const cfg = ADSTERRA_CONFIG.popunder;
    if (!cfg.enabled) return;
    if (document.getElementById('adsterra-popunder-script')) return;

    const s = document.createElement('script');
    s.id
