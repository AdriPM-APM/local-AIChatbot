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

// Common models for auto-testing
const TEST_MODELS = {
    openrouter: ['google/gemma-2-9b-it:free', 'meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free', 'openai/gpt-4o-mini'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemma-2-9b-it'],
    openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307'],
    groq: ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
    ollama: ['llama3.2', 'mistral', 'gemma2'],
    custom: ['gpt-3.5-turbo']
};

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
    
    // Mobile Menu
    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('sidebar-overlay').classList.toggle('hidden');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.add('hidden');
    });

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
    document
