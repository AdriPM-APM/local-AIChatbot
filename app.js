// ==========================================
// 1. Storage & Constants
// ==========================================
const STORAGE_KEY = 'aiCharacterAppData';
let appData = {
    aiSettings: { provider: 'openrouter', apiKey: '', model: 'google/gemma-2-9b-it:free', baseUrl: '' },
    adDismissed: false,
    characters: [],
    chats: {}
};

let currentCharacterId = null;
let isGenerating = false;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    loadData();
    renderAdBanner();
    renderCharacterList();
    setupEventListeners();
    updateSettingsUI();
});

// ==========================================
// 2. Data Management (localStorage + IndexedDB)
// ==========================================
function loadData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            appData = { ...appData, ...parsed };
        } catch (e) {
            console.error("Failed to parse stored data", e);
        }
    }
}

function saveData() {
    // Save everything except avatars to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

// IndexedDB for Avatars
const DB_NAME = 'CharacterAvatarsDB';
const STORE_NAME = 'avatars';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveAvatar(id, file) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(file, id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getAvatar(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteAvatar(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ==========================================
// 3. Ad Banner Logic
// ==========================================
function renderAdBanner() {
    const banner = document.getElementById('ad-banner');
    if (appData.adDismissed) {
        banner.classList.add('hidden');
        document.getElementById('show-ads-toggle').checked = false;
    } else {
        banner.classList.remove('hidden');
        document.getElementById('show-ads-toggle').checked = true;
    }
}

function dismissAd() {
    appData.adDismissed = true;
    saveData();
    renderAdBanner();
}

// ==========================================
// 4. UI Rendering & Event Listeners
// ==========================================
function setupEventListeners() {
    // Ad Banner
    document.getElementById('close-ad').addEventListener('click', dismissAd);
    
    // Sidebar & Chat
    document.getElementById('add-char-btn').addEventListener('click', () => openModal('character-modal'));
    document.getElementById('settings-btn').addEventListener('click', () => openModal('settings-modal'));
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    document.getElementById('clear-chat-btn').addEventListener('click', clearCurrentChat);

    // Modals
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.target.getAttribute('data-modal');
            closeModal(modalId);
        });
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Settings Modal
    document.getElementById('provider-select').addEventListener('change', (e) => {
        const baseUrlGroup = document.getElementById('base-url-group');
        baseUrlGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    document.getElementById('clear-data-btn').addEventListener('click', clearAllData);
    document.getElementById('show-ads-toggle').addEventListener('change', (e) => {
        appData.adDismissed = !e.target.checked;
        saveData();
        renderAdBanner();
    });

    // Character Creation Modal
    document.getElementById('save-char-btn').addEventListener('click', saveCharacter);
    document.getElementById('import-png').addEventListener('change', handlePngImport);
    
    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        renderCharacterList(e.target.value);
    });
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// 5. Character Management
// ==========================================
async function renderCharacterList(searchTerm = '') {
    const list = document.getElementById('character-list');
    list.innerHTML = '';
    
    const filtered = appData.characters.filter(c => 
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    for (const char of filtered) {
        const card = document.createElement('div');
        card.className = `character-card ${char.id === currentCharacterId ? 'active' : ''}`;
        
        let avatarSrc = '';
        if (char.avatarId) {
            const blob = await getAvatar(char.avatarId);
            if (blob) avatarSrc = URL.createObjectURL(blob);
        }

        card.innerHTML = `
            <img src="${avatarSrc || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NCIgaGVpZ2h0PSI0NCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM5NGEzYjgiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAgMjF2LTJhNCA0IDAgMCAwLTQtNEg4YTQgNCAwIDAgMC00IDR2MiI+PC9wYXRoPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCI+PC9jaXJjbGU+PC9zdmc+'}" alt="${char.name}">
            <div class="char-details">
                <h3>${char.name}</h3>
                <p>${char.intro || 'No description'}</p>
            </div>
        `;
        
        card.addEventListener('click', () => selectCharacter(char.id));
        list.appendChild(card);
    }
}

async function selectCharacter(id) {
    currentCharacterId = id;
    renderCharacterList(document.getElementById('search-input').value);
    const char = appData.characters.find(c => c.id === id);
    
    if (!char) return;

    // Update Header
    document.getElementById('chat-name').textContent = char.name;
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

    // Enable input
    document.getElementById('message-input').disabled = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('clear-chat-btn').classList.remove('hidden');

    // Load chat
    renderChat();
}

function saveCharacter() {
    const name = document.getElementById('char-name').value.trim();
    if (!name) return showToast('Name is required', 'error');

    const newChar = {
        id: Date.now().toString(),
        name: name,
        gender: document.getElementById('char-gender').value,
        intro: document.getElementById('char-intro').value.trim(),
        greetings: document.getElementById('char-greetings').value.trim(),
        backstory: document.getElementById('char-backstory').value.trim(),
        privateOnly: document.getElementById('char-private').checked,
        tags: document.getElementById('char-tags').value.split(',').map(t => t.trim()).filter(t => t),
        createdAt: new Date().toISOString(),
        avatarId: null
    };

    const avatarFile = document.getElementById('char-avatar').files[0];
    if (avatarFile) {
        newChar.avatarId = newChar.id;
        saveAvatar(newChar.id, avatarFile).catch(console.error);
    }

    appData.characters.push(newChar);
    appData.chats[newChar.id] = [];
    
    // Add greeting as first message
    if (newChar.greetings) {
        appData.chats[newChar.id].push({
            role: 'assistant',
            content: newChar.greetings,
            ts: Date.now()
        });
    }

    saveData();
    closeModal('character-modal');
    document.getElementById('char-name').value = '';
    document.getElementById('char-intro').value = '';
    document.getElementById('char-greetings').value = '';
    document.getElementById('char-backstory').value = '';
    document.getElementById('char-avatar').value = '';
    
    renderCharacterList();
    showToast(`✨ Character "${newChar.name}" created!`, 'success');
    selectCharacter(newChar.id);
}

// ==========================================
// 6. Chat Engine
// ==========================================
function renderChat() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    if (!currentCharacterId) return;

    const messages = appData.chats[currentCharacterId] || [];
    
    if (messages.length === 0) {
        container.innerHTML = '<div class="empty-state">Send a message to start the conversation.</div>';
        return;
    }

    messages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.role}`;
        msgDiv.textContent = msg.content;
       
