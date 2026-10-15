// ==========================================
// 1. Constants & State
// ==========================================
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
        disableReasoning: true
    },
    adDismissed: false,
    characters: [],
    chats: {}
};

let currentCharacterId = null;
let isGenerating = false;

const TEST_MODELS = {
    openrouter: ['google/gemma-2-9b-it:free', 'meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free'],
    gemini: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro', 'gemma-2-9b-it'],
    openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307'],
    groq: ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
    ollama: ['llama3.2', 'mistral', 'gemma2'],
    custom: ['gpt-3.5-turbo']
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

    // 0. Drop leading bulleted planning block
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
    if (firstRealIdx > 0) {
        reply = lines.slice(firstRealIdx).join('\n');
    }

    // 1. Remove [REASONING] blocks
    reply = reply.replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '');
    reply = reply.replace(/\[\/?REASONING\]/gi, '');

    // 2. Remove leaked header lines
    const headerLines = [
        /^\s*\*\s*format\s*:.*$/gim,
        /^\s*\*\s*user\s+asks?\s*:.*$/gim,
        /^\s*\*\s*character\s*:.*$/gim,
        /^\s*\*\s*input\s+context\s*:.*$/gim,
        /^\s*\*\s*internal\s+state\s*:.*$/gim,
        /^\s*\*\s*motivation\s*:.*$/gim,
        /^\s*\*\s*emotion\s*:.*$/gim,
        /^\s*\*\s*direct\s+response\s*:.*$/gim,
        /^\s*\*\s*dialogue\s*\/\s*action\s*:.*$/gim,
        /^\s*\*\s*length\s*:.*$/gim,
        /^\s*\*\s*followed\s+by.*$/gim,
        /^\s*\*\s*no\s+meta-text.*$/gim,
        /^\s*\*\s*first\s+person.*$/gim
    ];
    for (const p of headerLines) reply = reply.replace(p, '');

    // 3. Remove classic reasoning prefixes
    const prefixes = [
        /^\s*\*?\s*(reasoning|analysis|thoughts?|thinking|internal monologue|chain of thought|let me think|okay,?\s*so)\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/i,
        /^\s*(as an ai|i'm an ai|i am an ai|as a language model)\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/i,
        /^\s*\*?[^*\n]{0,120}?\*?\s*(reaction|response|body language|personality|context|scenario|note)\s*[:\-]\s*[\s\S]*?(?=\n\n|$)/i
    ];
    for (const p of prefixes) reply = reply.replace(p, '');

    // 4. Strip leading "Name:" prefix
    if (characterName) {
        const esc = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        reply = reply.replace(new RegExp(`^\\s*\\*?\\s*${esc}\\s*\\*?\\s*:\\s*`, 'i'), '');
    }

    // 5. Cut off trailing meta
    const trailing = reply.search(/\n\s*\*?\s*(reasoning|analysis|thoughts?|note|ooc|end of response|format)\s*[:\-]/i);
    if (trailing !== -1) reply = reply.slice(0, trailing);

    // 6. Remove THOUGHT: prefix
    reply = reply.replace(/^\s*THOUGHT\s*:\s*[\s\S]*?(?=\n\n|$)/i, '');

    // 7. Collapse blank lines
    reply = reply.replace(/\n{3,}/g, '\n\n').trim();

    // 8. Salvage fallback
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
    });
    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
    document.getElementById('test-models-btn')?.addEventListener('click', testAndAutoSelectModel);
    document.getElementById('show-ads-toggle')?.addEventListener('change', (e) => {
        appData.adDismissed = !e.target.checked;
        saveData();
        renderAdBanner();
    });

    // Sliders
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

    // Disable reasoning toggle
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
// 9. Toast
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

// ==========================================
// 10. Character rendering
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
    return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4YjVjZjYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAgMjF2LTJhNCA0IDAgMCAwLTQtNEg4YTQgNCAwIDAgMC00IDR2MiI+PC9wYXRoPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCI+PC9jaXJjbGU+PC9zdmc+";
}

async function selectCharacter(id) {
    currentCharacterId = id;
    renderCharacterList(document.getElementById('search-input').value);

    const char = appData.characters.find(c => c.id === id);
    if (!char) return;

    document.getElementById('chat-name').textContent = char.name;
    document.getElementById('chat-subtitle').textContent = char.intro || 'Ready to chat';

    const avatarImg = document.getElementById('chat-avatar');
    if
