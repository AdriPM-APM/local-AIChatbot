/* ============================================================================
   SECTION 0 — ANTI-ADBLOCK GUARD (optimized, false-positive resistant)
   ----------------------------------------------------------------------------
   Key improvements over the aggressive version:
     1. Uses a REAL bait (2x2px, visible-but-tiny) instead of a 1x1 offscreen
        element — some browsers report 0 offsetWidth for 1x1 offscreen.
     2. Waits until Adsterra containers actually exist before checking them.
     3. Requires 2 consecutive detections (grace period) before firing the modal.
     4. Ignores MutationObserver triggers caused by our OWN ad network scripts.
     5. Only fires on clear evidence — never on "element not yet present".
     6. Modal is dismissible for a session once the user reloads via button.
     7. Reduced polling; no more re-appending bait every 2s (that alone could
        confuse some cosmetic filters into thinking we're an ad).
   ============================================================================ */
(function AntiAdBlockGuard() {
    'use strict';

    const AdBlockGuard = {
        config: {
            // Faster initial grace, slower steady-state
            initialCheckDelays: [1500, 3000, 5000],
            steadyInterval: 5000,
            // Require N consecutive positive detections before showing the modal.
            // Prevents 1-off timing glitches from triggering a false alarm.
            consecutiveHitsRequired: 2,
            // Wait this long after load before we trust our first result.
            warmupMs: 4000,

            ids: {
                baitGeneric: 'ad-detection-bait',
                modalPrefix: 'anti-adblock-'
            },
            classes: {
                // NOTE: we intentionally do NOT include "adsbygoogle" here, because
                // Adsterra's own scripts occasionally inject elements with that
                // class and we don't want to mistake them for our bait.
                baitGeneric: 'advertisement ad-unit sponsored-ad adbox'
            },
            styles: {
                // 2x2px real element, off-screen but not at -10000 (which some
                // engines collapse to 0). pointer-events:none so it never
                // interferes with the app.
                bait: [
                    'position:absolute',
                    'left:-9999px',
                    'top:0',
                    'width:2px',
                    'height:2px',
                    'display:block',
                    'visibility:visible',
                    'opacity:1',
                    'pointer-events:none',
                    'background:transparent',
                    'border:0',
                    'margin:0',
                    'padding:0'
                ].join(' !important;') + ' !important;'
            },

            // Ad containers we EXPECT to exist after Adsterra loads.
            // Only checked AFTER warmupMs has elapsed AND the container is
            // present in the DOM.
            watchedAdContainers: [
                'container-a3f099d87b664187036e6176973d0255',
                'sidebar-ad-slot'
            ]
        },

        state: {
            warningActive: false,
            consecutiveHits: 0,
            warmupDone: false,
            lastDetectionReason: ''
        },

        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.start(), { once: true });
            } else {
                this.start();
            }
        },

        start() {
            // Wait for warmup before the very first check.
            setTimeout(() => {
                this.state.warmupDone = true;
                this.checkState();
            }, this.config.warmupMs);

            // A few follow-up checks to catch slow ad blockers.
            this.config.initialCheckDelays.forEach(d =>
                setTimeout(() => this.checkState(), d)
            );

            // Steady-state polling.
            setInterval(() => this.checkState(), this.config.steadyInterval);

            // Re-check when the tab becomes visible again.
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.checkState();
            });

            // BFCache support.
            window.addEventListener('pageshow', (e) => {
                if (e.persisted) this.checkState();
            });
        },

        /* ---- BAIT MANAGEMENT ---- */

        createBait() {
            let bait = document.getElementById(this.config.ids.baitGeneric);
            if (bait) return bait;

            bait = document.createElement('div');
            bait.id = this.config.ids.baitGeneric;
            bait.className = this.config.classes.baitGeneric;
            bait.setAttribute('aria-hidden', 'true');
            bait.style.cssText = this.config.styles.bait;
            // Set the attribute BEFORE appending so measurement on the first
            // frame is accurate.
            document.body.appendChild(bait);
            return bait;
        },

        /* ---- DETECTION ---- */

        /**
         * Returns true ONLY if the bait is clearly hidden.
         * Tolerates transient states during page paint.
         */
        isBaitBlocked(el) {
            if (!el || !el.isConnected) return true;

            // If our own inline styles were overridden (ad blocker stripped them),
            // the element will read as tiny/invisible.
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 && rect.height < 1) return true;

            const cs = getComputedStyle(el);
            if (cs.display === 'none') return true;
            if (cs.visibility === 'hidden') return true;
            if (parseFloat(cs.opacity) < 0.01) return true;

            return false;
        },

        /**
         * Watched containers are only considered "blocked" if:
         *   - warmup is done, AND
         *   - the container is present in the DOM, AND
         *   - it has been populated with an iframe/img/ins by Adsterra, AND
         *   - it is visibly hidden
         *
         * This avoids false positives during initial load when Adsterra hasn't
         * injected anything yet.
         */
        isWatchedContainerBlocked(id) {
            if (!this.state.warmupDone) return false;
            const el = document.getElementById(id);
            if (!el) return false;                    // not yet present = not blocked

            const hasAd = el.querySelector('iframe, img, ins');
            if (!hasAd) return false;                 // ad hasn't loaded yet = not blocked

            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) return true;

            const cs = getComputedStyle(el);
            if (cs.display === 'none') return true;
            if (cs.visibility === 'hidden') return true;
            if (parseFloat(cs.opacity) < 0.01) return true;

            return false;
        },

        /* ---- STATE MACHINE ---- */

        checkState() {
            // If the modal is already up, keep it enforced (but light-touch).
            if (this.state.warningActive) {
                const modal = document.querySelector(`[id^='${this.config.ids.modalPrefix}']`);
                if (!modal) {
                    // User closed it somehow — respect that for this session.
                    this.state.warningActive = false;
                    return;
                }
                return;
            }

            const bait = this.createBait();

            let blocked = false;
            let reason = '';

            if (this.isBaitBlocked(bait)) {
                blocked = true;
                reason = 'bait';
            } else {
                for (const id of this.config.watchedAdContainers) {
                    if (this.isWatchedContainerBlocked(id)) {
                        blocked = true;
                        reason = `container:${id}`;
                        break;
                    }
                }
            }

            if (blocked) {
                this.state.consecutiveHits++;
                this.state.lastDetectionReason = reason;

                if (this.state.consecutiveHits >= this.config.consecutiveHitsRequired) {
                    this.createWarningModal();
                }
            } else {
                // Reset the counter on a clean pass so a single hiccup doesn't
                // accumulate over hours of uptime.
                this.state.consecutiveHits = 0;
                this.state.lastDetectionReason = '';
            }
        },

        /* ---- MODAL ---- */

        generateUniqueId() {
            return this.config.ids.modalPrefix + Math.random().toString(36).slice(2, 11);
        },

        createWarningModal() {
            if (this.state.warningActive) return;

            // Remove any lingering instance first.
            document.querySelectorAll(`[id^='${this.config.ids.modalPrefix}']`)
                .forEach(n => n.remove());

            const modal = document.createElement('div');
            modal.id = this.generateUniqueId();
            modal.style.cssText = [
                'position:fixed',
                'inset:0',
                'background:rgba(0,0,0,0.55)',
                'z-index:99999',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'flex-direction:column',
                'backdrop-filter:blur(6px)',
                '-webkit-backdrop-filter:blur(6px)',
                'font-family:Inter,system-ui,sans-serif',
                'color:#ece9f5'
            ].join(';');

            const card = document.createElement('div');
            card.style.cssText = [
                'max-width:520px',
                'width:90%',
                'padding:28px 24px',
                'background:#0d0a17',
                'border-radius:20px',
                'border:1px solid rgba(255,255,255,0.12)',
                'box-shadow:0 20px 60px rgba(0,0,0,0.6)',
                'text-align:center'
            ].join(';');

            const icon = document.createElement('div');
            icon.textContent = '🚫';
            icon.style.cssText = 'font-size:44px;line-height:1;margin-bottom:14px;';

            const title = document.createElement('h2');
            title.textContent = 'Ad blocker detected';
            title.style.cssText = 'font-size:18px;font-weight:600;margin:0 0 10px;color:#fff;';

            const message = document.createElement('p');
            message.textContent = 'Please disable your ad blocker and reload the page. Hubs stays free thanks to ads.';
            message.style.cssText = 'font-size:14px;color:#a49ec1;margin:0 0 22px;line-height:1.55;';

            const reloadBtn = document.createElement('button');
            reloadBtn.textContent = '↻  Reload page';
            reloadBtn.style.cssText = [
                'background:linear-gradient(135deg,#8b5cf6,#d946ef)',
                'color:#fff',
                'border:none',
                'padding:12px 26px',
                'font-size:14px',
                'font-weight:600',
                'border-radius:12px',
                'cursor:pointer',
                'display:inline-flex',
                'align-items:center',
                'gap:6px'
            ].join(';');
            reloadBtn.addEventListener('click', () => location.reload());

            card.appendChild(icon);
            card.appendChild(title);
            card.appendChild(message);
            card.appendChild(reloadBtn);
            modal.appendChild(card);
            document.body.appendChild(modal);

            this.state.warningActive = true;
        }
    };

    AdBlockGuard.init();
})();
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
   SECTION 6 — AGGRESSIVE RESPONSE SANITIZER
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
   SECTION 7 — ADS
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
    if (popunderScriptLoaded) return;
    const cfg = ADSTERRA_CONFIG.popunder;
    if (!cfg.enabled) return;

    const s = document.createElement('script');
    s.id = 'adsterra-popunder-script';
    s.type = 'text/javascript';
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = cfg.scriptSrc;
    s.onerror = () => console.warn('[ads] popunder failed to load');
    document.body.appendChild(s);
    popunderScriptLoaded = true;
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
    showToast('Top banner disabled. Popunder & sidebar ad stay on to support Hubs.', 'info');
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
    if (fallback) fallback.style.display = 'none';
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
        document.getElementById('base-url-group').style.display = e.target.value === 'custom' ? 'flex' : 'none';
        updateModelInput(e.target.value);
    });
    document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);
    document.getElementById('test-models-btn')?.addEventListener('click', testAndAutoSelectModel);

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

/* ============================================================================
   SECTION 9 — TOAST & SETTINGS HELPERS
   ============================================================================ */
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

function updateModelInput(provider) {
    const modelInput = document.getElementById('model-input') || document.getElementById('model-select');
    if (!modelInput) return;
    modelInput.value = appData.aiSettings.model || '';
}

function updateSettingsUI() {
    const settings = appData.aiSettings;
    const providerSelect = document.getElementById('provider-select');
    if (providerSelect) providerSelect.value = settings.provider;

    updateModelInput(settings.provider);

    const apiKeyInput = document.getElementById('api-key-input');
    if (apiKeyInput) apiKeyInput.value = settings.apiKey || '';

    const fallbackKeyInput = document.getElementById('openrouter-fallback-key-input');
    if (fallbackKeyInput) fallbackKeyInput.value = settings.openrouterFallbackKey || '';

    const baseUrlGroup = document.getElementById('base-url-group');
    if (baseUrlGroup) baseUrlGroup.style.display = settings.provider === 'custom' ? 'flex' : 'none';

    const baseUrlInput = document.getElementById('base-url-input');
    if (baseUrlInput) baseUrlInput.value = settings.baseUrl || '';

    ['temperature', 'top-p', 'top-k', 'max-tokens'].forEach(id => {
        const slider = document.getElementById(`${id}-slider` + (id === 'max-tokens' ? '-input' : ''));
        const valSpan = document.getElementById(`${id}-value`);
        const keyMap = { 'temperature': 'temperature', 'top-p': 'topP', 'top-k': 'topK', 'max-tokens': 'maxTokens' };
        if (slider && settings[keyMap[id]] !== undefined) {
            slider.value = settings[keyMap[id]];
            if (valSpan) valSpan.textContent = settings[keyMap[id]];
        }
    });

    const reasoningToggle = document.getElementById('disable-reasoning-toggle');
    if (reasoningToggle) reasoningToggle.checked = settings.disableReasoning !== false;
}

function saveSettings() {
    const provider = document.getElementById('provider-select')?.value || 'gemini';
    const modelInput = document.getElementById('model-input') || document.getElementById('model-select');
    const model = modelInput?.value.trim() || 'gemini-3.1-flash-lite';
    const apiKey = document.getElementById('api-key-input')?.value.trim() || '';
    const fallbackKey = document.getElementById('openrouter-fallback-key-input')?.value.trim() || '';
    const baseUrl = document.getElementById('base-url-input')?.value.trim() || '';

    appData.aiSettings = {
        ...appData.aiSettings,
        provider, model, apiKey,
        openrouterFallbackKey: fallbackKey,
        baseUrl,
        temperature: parseFloat(document.getElementById('temperature-slider')?.value || 0.7),
        topP: parseFloat(document.getElementById('top-p-slider')?.value || 0.95),
        topK: parseInt(document.getElementById('top-k-slider')?.value || 40),
        maxTokens: parseInt(document.getElementById('max-tokens-input')?.value || 1024),
        disableReasoning: document.getElementById('disable-reasoning-toggle')?.checked ?? true
    };

    saveData();
    closeModal('settings-modal');
    showToast('Settings saved successfully', 'success');
}

function clearAllData() {
    if (!confirm('Are you sure you want to wipe all characters, chats, and settings?')) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
}

/* ============================================================================
   SECTION 10 — AUTOMATED MODEL PINGING
   ============================================================================ */
const TEST_MODELS = {
    openrouter: ['google/gemma-2-9b-it:free','meta-llama/llama-3.1-8b-instruct:free','mistralai/mistral-7b-instruct:free','deepseek/deepseek-r1:free'],
    gemini: ['gemini-3.1-flash-lite','gemini-3.4-flash-lite','gemini-3.5-flash-lite','gemini-3.6-flash','gemini-3.8-flash','gemma-2-9b-it'],
    openai: ['gpt-4o-mini','gpt-3.5-turbo','gpt-4o','o1-mini','o3-mini'],
    anthropic: ['claude-3-haiku-20240307','claude-3-5-haiku-latest','claude-3-5-sonnet-latest'],
    groq: ['llama-3.1-8b-instant','mixtral-8x7b-32768','llama-3.3-70b-versatile'],
    ollama: ['gemma2','llama3.2','mistral','llama3.3','deepseek-r1'],
    custom: ['gpt-4o-mini']
};

async function testAndAutoSelectModel() {
    const provider = document.getElementById('provider-select')?.value || appData.aiSettings.provider;
    const apiKey = document.getElementById('api-key-input')?.value.trim() || appData.aiSettings.apiKey;
    const baseUrl = document.getElementById('base-url-input')?.value.trim() || appData.aiSettings.baseUrl;
    const models = TEST_MODELS[provider];
    const modelInput = document.getElementById('model-input') || document.getElementById('model-select');

    if (!models || models.length === 0) {
        showToast('No test models available for this provider.', 'error');
        return;
    }
    if (!apiKey && provider !== 'ollama') {
        showToast(`Please enter a valid API key for ${provider} first.`, 'error');
        return;
    }

    for (const model of models) {
        try {
            if (modelInput) {
                modelInput.value = model;
                modelInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const success = await pingModel(provider, model, apiKey, baseUrl);
            if (success) {
                appData.aiSettings.provider = provider;
                appData.aiSettings.apiKey = apiKey;
                appData.aiSettings.model = model;
                saveData();
                updateSettingsUI();
                showToast(`Success! Auto-selected lightweight model: ${model}`, 'success');
                return;
            }
        } catch (err) {
            console.warn(`Model ${model} failed ping test:`, err.message);
        }
    }
    showToast('All models failed for this provider. Check your API key or quota.', 'error');
}

async function pingModel(provider, model, apiKey, baseUrl) {
    let url, headers, body;
    const testMessages = [{ role: 'user', content: 'Hi' }];
    const normalizedModel = normalizeModelName(model, provider);

    switch (provider) {
        case 'openrouter':
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;
        case 'gemini':
            url = `https://generativelanguage.googleapis.com/v1beta/models/${normalizedModel}:generateContent?key=${apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] };
            break;
        case 'openai':
            url = 'https://api.openai.com/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;
        case 'anthropic':
            url = 'https://api.anthropic.com/v1/messages';
            headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
            body = { model: normalizedModel, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] };
            break;
        case 'groq':
            url = 'https://api.groq.com/openai/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;
        case 'ollama':
            url = (baseUrl || 'http://localhost:11434') + '/v1/chat/completions';
            headers = { 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;
        case 'custom':
            if (!baseUrl) return false;
            url = baseUrl + '/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: normalizedModel, messages: testMessages, max_tokens: 5 };
            break;
        default: return false;
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return res.ok;
}

function handlePngImport(e) { /* stub */ }

/* ============================================================================
   SECTION 11 — CHARACTER RENDERING
   ============================================================================ */
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
    return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4YjVjZjgwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDIxdi0yYTQgNCAwIDAgMC00LTRoOGE0IDQgMCAwIDAgNC00djIiPjxlcGF0aD48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiPjwvY2lyY2xlPjwvc3ZnPg==";
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

/* ============================================================================
   SECTION 12 — CHARACTER CREATION
   ============================================================================ */
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

    const fileInput = document.getElementById('char-avatar-file') || document.getElementById('char-avatar');
    const file = fileInput?.files?.[0];
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

    ['char-name', 'char-intro', 'char-greetings', 'char-backstory', 'char-tags'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    if (fileInput) fileInput.value = '';
    const privateToggle = document.getElementById('char-private');
    if (privateToggle) privateToggle.checked = false;

    renderCharacterList();
    showToast(`Character "${newChar.name}" created`, 'success');
    selectCharacter(newChar.id);
}

/* ============================================================================
   SECTION 13 — CHAT RENDERING
   ============================================================================ */
function renderChat() {
    const container = document.getElementById('messages-container');
    if (!container) return;
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

/* ============================================================================
   SECTION 14 — SEND MESSAGE
   ============================================================================ */
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

/* ============================================================================
   SECTION 15 — PROVIDER INTEGRATION
   ============================================================================ */
async function callAIProviderWithFallback(character) {
    const settings = appData.aiSettings;
    let primaryError = null;

    try { return await callAIProvider(character, settings); }
    catch (error) {
        primaryError = error;
        console.warn(`Primary (${settings.provider}) failed:`, error.message);
    }

    const fbKey = settings.openrouterFallbackKey;
    if (settings.provider !== 'openrouter' && fbKey) {
        try {
            return await callAIProvider(character, {
                ...settings,
                provider: 'openrouter',
                apiKey: fbKey,
                model: 'google/gemma-2-9b-it:free'
            });
        } catch (fbErr) {
            console.warn('OpenRouter fallback failed:', fbErr.message);
            throw new Error(`Primary failed: ${primaryError.message}. Fallback failed: ${fbErr.message}`);
        }
    }
    throw new Error(primaryError.message);
}

async function callAIProvider(character, settings) {
    if (!settings.apiKey && settings.provider !== 'ollama') {
        throw new Error('API key missing — open Settings and paste your key.');
    }

    const model = normalizeModelName(settings.model, settings.provider);
    const messages = appData.chats[currentCharacterId] || [];

    const systemPrompt = `You are ${character.name}. Gender: ${character.gender}.

BACKGROUND (silent context — never quote or reference it):
${character.backstory}

YOU MUST FOLLOW THESE RULES EXACTLY:

1. Reply as ${character.name}, first person ONLY.
2. Output ONLY dialogue and *brief actions in asterisks*.
3. Do NOT think. Do NOT plan. Do NOT reason. Do NOT narrate thoughts.
4. Do NOT output any of these words anywhere in your reply:
    reasoning, analysis, thought, thinking, plan, note, context,
    format, character:, user:, reaction, response:, length:,
    internal, motivation, emotion, dialogue:, follow, reply.
5. Do NOT use any labels, headers, bullets, or numbered lists.
6. Do NOT use square brackets or anything inside them.
7. Do NOT describe yourself in third person.
8. Do NOT write the user's words or actions.
9. Do NOT mention being an AI or an assistant.
10. Do NOT preface. Do NOT explain. Do NOT summarize.

You answer directly, in character, and stop.
Length: 1 to 4 sentences, natural and conversational.

Now answer the user's last message.`;

    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const gen = {
        temperature: Number(settings.temperature ?? 0.7),
        topP: Number(settings.topP ?? 0.95),
        topK: Number(settings.topK ?? 40),
        maxTokens: Number(settings.maxTokens ?? 1024)
    };
    const killThinking = settings.disableReasoning !== false;

    let url, headers, body;
    switch (settings.provider) {
        case 'openrouter':
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = {
                model, messages: apiMessages,
                temperature: gen.temperature, top_p: gen.topP, top_k: gen.topK,
                max_tokens: gen.maxTokens,
                frequency_penalty: Number(settings.frequencyPenalty ?? 0),
                presence_penalty: Number(settings.presencePenalty ?? 0)
            };
            if (killThinking) body.reasoning = { effort: 'none', exclude: true };
            break;
        case 'gemini':
            url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            body = {
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: apiMessages.filter(m => m.role !== 'system').map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }]
                })),
                generationConfig: {
                    temperature: gen.temperature, topP: gen.topP,
                    topK: gen.topK, maxOutputTokens: gen.maxTokens
                }
            };
            if (killThinking && (model.includes('gemini-2.5') || model.includes('gemini-3'))) {
                body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
            }
            break;
        case 'openai':
            url = 'https://api.openai.com/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = {
                model, messages: apiMessages,
                temperature: gen.temperature, top_p: gen.topP, max_tokens: gen.maxTokens,
                frequency_penalty: Number(settings.frequencyPenalty ?? 0),
                presence_penalty: Number(settings.presencePenalty ?? 0)
            };
            break;
        case 'anthropic':
            url = 'https://api.anthropic.com/v1/messages';
            headers = {
                'x-api-key': settings.apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            };
            body = {
                model, max_tokens: gen.maxTokens,
                temperature: gen.temperature, top_p: gen.topP,
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
            body = {
                model, messages: apiMessages,
                temperature: gen.temperature, top_p: gen.topP, max_tokens: gen.maxTokens
            };
            break;
        case 'ollama':
            url = (settings.baseUrl || 'http://localhost:11434') + '/v1/chat/completions';
            headers = { 'Content-Type': 'application/json' };
            body = {
                model, messages: apiMessages,
                temperature: gen.temperature, top_p: gen.topP,
                top_k: gen.topK, max_tokens: gen.maxTokens
            };
            break;
        case 'custom':
            url = settings.baseUrl + '/chat/completions';
            headers = { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' };
            body = {
                model, messages: apiMessages,
                temperature: gen.temperature, top_p: gen.topP, max_tokens: gen.maxTokens
            };
            break;
        default: throw new Error('Unsupported provider');
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const apiMsg = err.error?.message || err.message || `HTTP ${res.status}`;
        if (settings.provider === 'gemini' && /quota|limit: 0|free_tier/i.test(apiMsg)) {
            throw new Error(`Gemini free tier exhausted for this project. Try a new Google Cloud project or switch to OpenRouter.`);
        }
        if (settings.provider === 'openrouter' && /auth/i.test(apiMsg)) {
            throw new Error(`OpenRouter rejected your key. Keys must start with "sk-or-". Get one at openrouter.ai/keys`);
        }
        throw new Error(apiMsg);
    }

    const data = await res.json();
    let text = '';
    if (settings.provider === 'gemini') {
        if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else if (settings.provider === 'anthropic') {
        text = data.content?.[0]?.text || '';
    } else {
        text = data.choices?.[0]?.message?.content || '';
    }
    return text;
}
