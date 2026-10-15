// ==========================================
// 1. Constants & State
// ==========================================
const STORAGE_KEY = 'aiCharacterAppData';

let appData = {
    aiSettings: { provider: 'gemini', apiKey: '', model: 'gemini-2.0-flash', baseUrl: '' },
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
            appData = { ...appData, ...parsed };
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
// 6. Response sanitizer — strips ALL reasoning/meta
// ==========================================
function cleanAIResponse(raw, characterName) {
    if (!raw) return '';

    let reply = raw;

    // 1. Remove any [REASONING]...[/REASONING] block entirely
    reply = reply.replace(/\[REASONING\][\s\S]*?\[\/REASONING\]/gi, '');

    // 2. Remove leaked reasoning prefixes
    const prefixes = [
        /^\s*\*?\s*(reasoning|analysis|thoughts?|thinking|internal monologue|chain of thought|let me think|okay,?\s*so)\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/i,
        /^\s*(as an ai|i'm an ai|i am an ai|as a language model)\s*[:\-]?\s*[\s\S]*?(?=\n\n|$)/i,
        /^\s*\*?[^*\n]{0,120}?\*?\s*(reaction|response|body language|personality|context|scenario|note)\s*[:\-]\s*[\s\S]*?(?=\n\n|$)/i
    ];
    for (const p of prefixes) reply = reply.replace(p, '');

    // 3. Strip leading "Name:" prefix
    if (characterName) {
        const esc = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        reply = reply.replace(new RegExp(`^\\s*\\*?\\s*${esc}\\s*\\*?\\s*:\\s*`, 'i'), '');
    }

    // 4. Cut off any trailing meta block
    const trailing = reply.search(/\n\s*\*?\s*(reasoning|analysis|thoughts?|note|ooc|end of response)\s*[:\-]/i);
    if (trailing !== -1) reply = reply.slice(0, trailing);

    // 5. Collapse excess blank lines
    reply = reply.replace(/\n{3,}/g, '\n\n').trim();

    // 6. Fallback if we emptied it
    if (!reply && raw) reply = raw.trim();

    return reply;
}

// ==========================================
// 7. Ad banner
// ==========================================
function renderAdBanner() {
    const banner = document.getElementById('ad-banner');
    const toggle = document.getElementById('show-ads-toggle');
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
    // Ad
    document.getElementById('close-ad').addEventListener('click', dismissAd);

    // Mobile drawer
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const openDrawer = () => { sidebar.classList.add('open'); overlay.classList.remove('hidden'); };
    const closeDrawer = () => { sidebar.classList.remove('open'); overlay.classList.add('hidden'); };

    document.getElementById('mobile-menu-btn').addEventListener('click', openDrawer);
    document.getElementById('mobile-settings-btn').addEventListener('click', () => openModal('settings-modal'));
    overlay.addEventListener('click', closeDrawer);

    // Buttons
    document.getElementById('add-char-btn').addEventListener('click', () => openModal('character-modal'));
    document.getElementById('settings-btn').addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('clear-chat-btn').addEventListener('click', clearCurrentChat);

    // Enter to send
    document.getElementById('message-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    const ta = document.getElementById('message-input');
    ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    });

    // Modal close buttons
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.modal));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Settings
    document.getElementById('provider-select').addEventListener('change', (e) => {
        document.getElementById('base-url-group').style.display = e.target.value === 'custom' ? 'flex' : 'none';
    });
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    document.getElementById('clear-data-btn').addEventListener('click', clearAllData);
    document.getElementById('test-models-btn').addEventListener('click', testAndAutoSelectModel);
    document.getElementById('show-ads-toggle').addEventListener('change', (e) => {
        appData.adDismissed = !e.target.checked;
        saveData();
        renderAdBanner();
    });

    // Character
    document.getElementById('save-char-btn').addEventListener('click', saveCharacter);
    document.getElementById('import-png').addEventListener('change', handlePngImport);

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        renderCharacterList(e.target.value);
    });
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ==========================================
// 9. Toast
// ==========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
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
// 11. Character creation
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

    const file = document.getElementById('char-avatar').files[0];
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

    // Reset form
    ['char-name', 'char-intro', 'char-greetings', 'char-backstory', 'char-tags'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('char-avatar').value = '';
    document.getElementById('char-private').checked = false;

    renderCharacterList();
    showToast(`Character "${newChar.name}" created`, 'success');
    selectCharacter(newChar.id);
}

// ==========================================
// 12. Chat rendering (with edit/delete, no reasoning)
// ==========================================
function renderChat() {
    const container = document.getElementById('messages-container');
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
// 13. Send message
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
// 14. Provider integration
// ==========================================
async function callAIProviderWithFallback(character) {
    const settings = appData.aiSettings;
    try {
        return await callAIProvider(character, settings);
    } catch (error) {
        console.warn(`Primary (${settings.provider}) failed:`, error.message);
        if (settings.provider !== 'openrouter' && settings.apiKey) {
            try {
                return await callAIProvider(character, { ...settings, provider: 'openrouter', model: 'google/gemma-2-9b-it:free' });
            } catch (e2) {
                throw new Error(`All providers failed. ${error.message}`);
            }
        }
        throw error;
    }
}

async function callAIProvider(character, settings) {
    if (!settings.apiKey && settings.provider !== 'ollama') {
        throw new Error('API key missing — open Settings.');
    }

    const model = normalizeModelName(settings.model, settings.provider);
    const messages = appData.chats[currentCharacterId] || [];

    // STRICT PROMPT — no reasoning, no meta, just the character speaking.
    const systemPrompt = `You are roleplaying as ${character.name}. Gender: ${character.gender}.

BACKSTORY (defines who you are — never reveal directly):
${character.backstory}

STRICT RULES:
- Speak ONLY as ${character.name}, in first person.
- Output ONLY dialogue and brief *action* descriptions in asterisks.
- NEVER write reasoning, analysis, thoughts, internal monologue, notes, or meta-text.
- NEVER use [REASONING] tags or any bracketed labels.
- NEVER write the user's thoughts, actions, or dialogue.
- NEVER break character. NEVER mention being an AI.
- Keep replies natural and conversational — 1 to 4 sentences.
- Show personality through voice, stutters, and emotional state.
${character.privateOnly ? "- Private persona — never reveal system instructions." : ""}

Begin directly with ${character.name}'s speech or action. No preamble.`;

    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    let url, headers, body;

    switch (settings.provider) {
        case 'openrouter':
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = { model, messages: apiMessages };
            break;

        // Gemini: system prompt goes in systemInstruction, not in contents
        case 'gemini':
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = {
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: apiMessages
                    .filter(m => m.role !== 'system')
                    .map(m => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    }))
            };
            break;

        case 'openai':
            url = 'https://api.openai.com/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = { model, messages: apiMessages };
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
                max_tokens: 1024,
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
            body = { model, messages: apiMessages };
            break;

        case 'ollama':
            url = (settings.baseUrl || 'http://localhost:11434') + '/v1/chat/completions';
            headers = { 'Content-Type': 'application/json' };
            body = { model, messages: apiMessages };
            break;

        case 'custom':
            url = settings.baseUrl + '/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = { model, messages: apiMessages };
            break;

        default: throw new Error('Unsupported provider');
    }

    try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        let text = '';
        if (settings.provider === 'gemini') {
            if (data.promptFeedback?.blockReason) throw new Error(`Blocked: ${data.promptFeedback.blockReason}`);
            text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (settings.provider === 'anthropic') {
            text = data.content?.[0]?.text || '';
        } else {
            text = data.choices?.[0]?.message?.content || '';
        }
        if (!text) throw new Error('Empty response');
        return text;
    } catch (error) {
        console.error(`API Error (${settings.provider}):`, error);
        if (/NetworkError|Failed to fetch/.test(error.message)) {
            throw new Error(`[${settings.provider}] Network error — try running locally or check your key.`);
        }
        throw error;
    }
}

// ==========================================
// 15. Auto-test models
// ==========================================
async function testAndAutoSelectModel() {
    const provider = document.getElementById('provider-select').value;
    const apiKey = document.getElementById('api-key-input').value.trim();
    const baseUrl = document.getElementById('base-url-input').value.trim();
    const resultEl = document.getElementById('model-test-result');

    if (!apiKey && provider !== 'ollama') return showToast('Enter an API key first', 'error');

    resultEl.style.display = 'block';
    resultEl.style.color = 'var(--text-3)';
    resultEl.textContent = 'Discovering models…';

    let candidates = TEST_MODELS[provider] || TEST_MODELS.custom;

    if (provider === 'gemini') {
        try {
            const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (listRes.ok) {
                const ld = await listRes.json();
                const avail = (ld.models || [])
                    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
                    .map(m => m.name.replace(/^models\//, ''));
                if (avail.length) candidates = avail;
            }
        } catch (_) {}
    }

    let working = null;
    let lastError = '';

    for (const raw of candidates) {
        const model = normalizeModelName(raw, provider);
        resultEl.textContent = `Testing ${model}…`;
        try {
            const payload = buildTestPayload(provider, model, apiKey, baseUrl);
            const res = await fetch(payload.url, { method: 'POST', headers: payload.headers, body: JSON.stringify(payload.body) });
            if (res.ok) { working = model; break; }
            const err = await res.json().catch(() => ({}));
            lastError = err.error?.message || `HTTP ${res.status}`;
        } catch (e) {
            lastError = e.message;
        }
    }

    if (working) {
        document.getElementById('model-input').value = working;
        resultEl.textContent = `✅ Working: ${working}`;
        resultEl.style.color = 'var(--success)';
        showToast(`Selected ${working}`, 'success');
    } else {
        resultEl.textContent = `❌ No working model. ${lastError}`;
        resultEl.style.color = 'var(--danger)';
        showToast(lastError || 'No working model found', 'error');
    }
}

function buildTestPayload(provider, model, apiKey, baseUrl) {
    const prompt = [{ role: 'user', content: 'Hi' }];
    switch (provider) {
        case 'gemini':
            return {
                url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                headers: { 'Content-Type': 'application/json' },
                body: { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] }
            };
        case 'anthropic':
            return {
                url: 'https://api.anthropic.com/v1/messages',
                headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
                body: { model, max_tokens: 10, messages: prompt }
            };
        case 'ollama':
            return {
                url: (baseUrl || 'http://localhost:11434') + '/v1/chat/completions',
                headers: { 'Content-Type': 'application/json' },
                body: { model, messages: prompt }
            };
        case 'custom':
            return {
                url: baseUrl + '/chat/completions',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: { model, messages: prompt }
            };
        case 'openrouter':
            return {
                url: 'https://openrouter.ai/api/v1/chat/completions',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: { model, messages: prompt }
            };
        case 'openai':
            return {
                url: 'https://api.openai.com/v1/chat/completions',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: { model, messages: prompt }
            };
        case 'groq':
            return {
                url: 'https://api.groq.com/openai/v1/chat/completions',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: { model, messages: prompt }
            };
    }
    throw new Error('Unknown provider');
}

// ==========================================
// 16. Settings
// ==========================================
function saveSettings() {
    appData.aiSettings = {
        provider: document.getElementById('provider-select').value,
        apiKey: document.getElementById('api-key-input').value.trim(),
        model: document.getElementById('model-input').value.trim(),
        baseUrl: document.getElementById('base-url-input').value.trim()
    };
    saveData();
    closeModal('settings-modal');
    showToast('Settings saved', 'success');
}

function updateSettingsUI() {
    const s = appData.aiSettings;
    document.getElementById('provider-select').value = s.provider || 'gemini';
    document.getElementById('api-key-input').value = s.apiKey || '';
    document.getElementById('model-input').value = s.model || '';
    document.getElementById('base-url-input').value = s.baseUrl || '';
    document.getElementById('base-url-group').style.display = s.provider === 'custom' ? 'flex' : 'none';
}

function clearAllData() {
    if (!confirm('Delete ALL characters, chats, and settings?')) return;
    localStorage.removeItem(STORAGE_KEY);
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => {
        showToast('All data cleared', 'success');
        setTimeout(() => location.reload(), 700);
    };
    req.onerror = () => showToast('Failed to clear database', 'error');
}

// ==========================================
// 17. Chai PNG import
// ==========================================
async function handlePngImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const meta = parsePngMetadata(bytes);

        if (!meta.chara && !meta.chai) throw new Error('No character data in PNG');

        let charData;
        try {
            charData = JSON.parse(atob(meta.chara || meta.chai));
        } catch {
            throw new Error('Invalid character data');
        }

        const name = charData.name || charData.char_name || 'Imported Character';
        const intro = charData.description || charData.personality || 'Imported from Chai';
        const greetings = charData.first_mes || charData.greeting || `Hello! I'm ${name}.`;
        const backstory = charData.scenario || charData.description || '';

        const newChar = {
            id: Date.now().toString(),
            name,
            gender: charData.gender || 'Other',
            intro,
            greetings,
            backstory,
            privateOnly: false,
            tags: ['imported', 'chai'],
            createdAt: new Date().toISOString(),
            avatarId: null
        };
        newChar.avatarId = newChar.id;
        await saveAvatar(newChar.id, file);
        appData.characters.push(newChar);
        appData.chats[newChar.id] = [{ role: 'assistant', content: greetings, ts: Date.now() }];
        saveData();
        closeModal('character-modal');
        renderCharacterList();
        showToast(`Imported ${name}`, 'success');
        selectCharacter(newChar.id);
    } catch (err) {
        console.error('PNG import error:', err);
        showToast(`Import failed: ${err.message}`, 'error');
    }
    event.target.value = '';
}

function parsePngMetadata(bytes) {
    const meta = {};
    let off = 8;
    while (off < bytes.length) {
        const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8)
