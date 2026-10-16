/* ============================================================================
   Hubs — anti-adblock.js
   Ad-blocker detection with false-positive guards.
   Signals: bait element, ad containers, sidebar ad slot, ad-network reachability.
   Loads after app.js. No DOM rewriting loops.
   ============================================================================ */
(() => {
    'use strict';

    const AD_SCRIPT_URL = 'https://archeryconditionssniff.com/a9543a4355279a22639348e9331bf68e/invoke.js';

    const CONFIG = {
        startDelayMs: 3000,      // grace period after load so the page can settle
        intervalMs: 2500,        // normal check cadence
        wallIntervalMs: 5000,    // cadence while the wall is up (only watching for recovery)
        debounceMs: 300,         // coalesce bursts of DOM mutations into one check
        probeIntervalMs: 30000,  // ad-network reachability probe
        probeFailsToBlock: 2,    // consecutive failed probes before the network counts as blocked
        slotGraceMs: 8000,       // time allowed for the sidebar ad to render before it is inspected
        strikesToWall: 2,        // consecutive failed checks before the wall appears
        scoreThreshold: 2,       // a check fails when its score reaches this

        storageKey: 'aiCharacterAppData',
        sidebarDismissedKey: 'hubs_sidebar_ad_dismissed',

        baitId: 'ad-detection-bait',
        baitClass: 'adsbygoogle ad-unit advertisement adbox sponsored-ad',
        wallId: 'anti-adblock-wall',
        sidebarSlotId: 'sidebar-ad-slot',

        // Ad containers that must render unless the USER turned them off.
        watched: [
            { id: 'ad-banner',  label: 'banner superior', userHidden: () => isTopAdOffByUser() },
            { id: 'sidebar-ad', label: 'anuncio lateral', userHidden: () => isSidebarAdOffByUser() }
        ]
    };

    /* Plain styles on purpose: no !important, so blocker rules (display:none !important)
       can apply and be detected. Inline !important would override them. */
    const BAIT_STYLE = 'display:block;position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none;';

    const WALL_STYLE = [
        'position:fixed', 'inset:0', 'width:100%', 'height:100%',
        'background:rgba(8,6,15,.72)', 'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
        'z-index:99999', 'display:flex', 'align-items:center', 'justify-content:center',
        'padding:20px', 'box-sizing:border-box', 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif'
    ].join(';');

    const WALL_CARD_STYLE = [
        'max-width:460px', 'width:100%', 'padding:28px 24px', 'border-radius:20px',
        'background:#14102a', 'border:1px solid rgba(255,255,255,.12)',
        'box-shadow:0 20px 60px rgba(0,0,0,.5)', 'color:#ece9f5', 'text-align:center'
    ].join(';');

    const BUTTON_STYLE = [
        'display:inline-flex', 'align-items:center', 'gap:8px', 'margin-top:20px',
        'padding:12px 24px', 'border:none', 'border-radius:999px', 'cursor:pointer',
        'background:linear-gradient(135deg,#8b5cf6,#d946ef)', 'color:#fff',
        'font-size:15px', 'font-weight:600'
    ].join(';');

    const state = {
        strikes: 0,
        wallVisible: false,
        wallEl: null,
        baitCreated: false,
        healthy: Object.create(null),
        probeFailures: 0,
        networkBlocked: false,
        timer: null,
        debounceTimer: null,
        observer: null,
        destroyed: false
    };

    /* ------------------------------------------------------------------------
       User preferences (read-only). The app stores these; we only consult them
       so an ad the user turned off is never reported as "blocked".
       ------------------------------------------------------------------------ */
    function isTopAdOffByUser() {
        try {
            const data = JSON.parse(localStorage.getItem(CONFIG.storageKey) || 'null');
            return !!(data && data.adDismissed);
        } catch (_) {
            return false;
        }
    }

    function isSidebarAdOffByUser() {
        try {
            return localStorage.getItem(CONFIG.sidebarDismissedKey) === '1';
        } catch (_) {
            return false;
        }
    }

    /* ------------------------------------------------------------------------
       Rendering check. getClientRects() is empty for display:none and detached
       nodes, and is cheap. Computed style is read only for elements that
       passed that test.
       ------------------------------------------------------------------------ */
    function isRendered(el) {
        if (!el || !el.isConnected) return false;
        if (el.getClientRects().length === 0) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none'
            && cs.visibility !== 'hidden'
            && parseFloat(cs.opacity) > 0.01;
    }

    /* ------------------------------------------------------------------------
       Bait: one invisible element with ad-like classes. Created once, never
       moved, so it doesn't force repeated style recalculations.
       ------------------------------------------------------------------------ */
    function ensureBait() {
        let bait = document.getElementById(CONFIG.baitId);
        if (bait) return bait;
        bait = document.createElement('div');
        bait.id = CONFIG.baitId;
        bait.className = CONFIG.baitClass;
        bait.setAttribute('aria-hidden', 'true');
        bait.style.cssText = BAIT_STYLE;
        document.body.appendChild(bait);
        state.baitCreated = true;
        return bait;
    }

    /* ------------------------------------------------------------------------
       Ad-network probe. A no-cors fetch never reads the response and never runs
       the script, so it can't render a duplicate ad. It rejects only on network
       failure, which is what a blocker causes. Two failures in a row are needed
       before the network counts as blocked, so a brief outage can't trigger it.
       ------------------------------------------------------------------------ */
    async function probeAdNetwork() {
        if (state.destroyed || navigator.onLine === false) return;
        try {
            await fetch(AD_SCRIPT_URL, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' });
            state.probeFailures = 0;
            state.networkBlocked = false;
        } catch (_) {
            if (navigator.onLine === false) return;   // offline: inconclusive
            state.probeFailures++;
            if (state.probeFailures >= CONFIG.probeFailsToBlock) state.networkBlocked = true;
        }
    }

    /* ------------------------------------------------------------------------
       Probe: one snapshot of the page. Returns null when the result can't be
       trusted (offline, tab hidden), so those moments never count as strikes.
       ------------------------------------------------------------------------ */
    function probe() {
        const reasons = [];
        let score = 0;

        // 1) Bait: hidden by a blocker, or removed after we created it.
        const bait = document.getElementById(CONFIG.baitId);
        if (!bait) {
            if (state.baitCreated) {
                score += 2;
                reasons.push('señuelo eliminado');
            }
            ensureBait();
        } else if (!isRendered(bait)) {
            score += 2;
            reasons.push('señuelo oculto');
        }

        // 2) Watched ad containers: must render unless the user turned them off.
        for (const w of CONFIG.watched) {
            if (w.userHidden()) {
                state.healthy[w.id] = false;
                continue;
            }
            const el = document.getElementById(w.id);
            if (el && isRendered(el)) {
                state.healthy[w.id] = true;
                continue;
            }
            score += 2;
            reasons.push(
                !el ? `${w.label} eliminado`
                    : state.healthy[w.id] ? `${w.label} ocultado tras cargar`
                    : `${w.label} bloqueado`
            );
        }

        // 3) Sidebar ad slot. An empty slot is weak evidence (the ad may simply not
        //    fill), so it scores 1. A present but hidden iframe scores 2.
        const slot = document.getElementById(CONFIG.sidebarSlotId);
        if (slot && !isSidebarAdOffByUser() && performance.now() > CONFIG.slotGraceMs) {
            const frame = slot.querySelector('iframe');
            if (!frame) {
                score += 1;
                reasons.push('espacio de anuncio lateral vacío');
            } else if (!isRendered(frame)) {
                score += 2;
                reasons.push('anuncio lateral oculto');
            }
        }

        // 4) Ad network unreachable (confirmed over consecutive probes).
        if (state.networkBlocked) {
            score += 2;
            reasons.push('red de anuncios bloqueada');
        }

        return { blocked: score >= CONFIG.scoreThreshold, reasons, score };
    }

    /* ------------------------------------------------------------------------
       Strike system: a single odd frame (reflow, slow render) never triggers
       the wall. Consecutive failing checks are required. One healthy check
       clears it, so the wall lifts as soon as ads come back.
       ------------------------------------------------------------------------ */
    function runCheck() {
        if (state.destroyed || document.hidden) return;
        if (navigator.onLine === false) return;   // inconclusive while offline

        const result = probe();
        if (result.blocked) {
            state.strikes++;
            if (state.strikes >= CONFIG.strikesToWall) showWall();
        } else {
            state.strikes = 0;
            if (state.wallVisible) hideWall();
        }
    }

    /* ------------------------------------------------------------------------
       Warning wall. Built once and reused. Shown only while blocking is
       detected, removed automatically when ads render again.
       ------------------------------------------------------------------------ */
    function buildWall() {
        const wall = document.createElement('div');
        wall.id = CONFIG.wallId;
        wall.setAttribute('role', 'alertdialog');
        wall.setAttribute('aria-modal', 'true');
        wall.setAttribute('aria-labelledby', 'anti-adblock-title');
        wall.style.cssText = WALL_STYLE;

        const card = document.createElement('div');
        card.style.cssText = WALL_CARD_STYLE;

        const icon = document.createElement('div');
        icon.setAttribute('aria-hidden', 'true');
        icon.style.cssText = 'font-size:44px;line-height:1;margin-bottom:12px;';
        icon.textContent = '🛡️';

        const title = document.createElement('h2');
        title.id = 'anti-adblock-title';
        title.textContent = 'Bloqueador de anuncios detectado';
        title.style.cssText = 'margin:0 0 12px;font-size:20px;font-weight:700;color:#ece9f5;';

        const msg = document.createElement('p');
        msg.textContent = 'Por favor, desactiva tu bloqueador de anuncios y recarga la página.';
        msg.style.cssText = 'margin:0;font-size:15px;line-height:1.5;color:#a49ec1;';

        const note = document.createElement('p');
        note.textContent = 'Este aviso desaparecerá automáticamente cuando los anuncios se muestren.';
        note.style.cssText = 'margin:14px 0 0;font-size:12.5px;line-height:1.5;color:#6f6a8a;';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '↻ Recargar';
        btn.style.cssText = BUTTON_STYLE;
        btn.addEventListener('click', () => location.reload());

        card.append(icon, title, msg, btn, note);
        wall.appendChild(card);
        return { wall, btn };
    }

    function showWall() {
        if (state.wallVisible && state.wallEl && state.wallEl.wall.isConnected) return;
        if (!state.wallEl) state.wallEl = buildWall();
        if (!state.wallEl.wall.isConnected) document.body.appendChild(state.wallEl.wall);
        state.wallVisible = true;
        schedule(CONFIG.wallIntervalMs);
        state.wallEl.btn.focus({ preventScroll: true });
    }

    function hideWall() {
        state.wallVisible = false;
        if (state.wallEl && state.wallEl.wall.isConnected) state.wallEl.wall.remove();
        schedule(CONFIG.intervalMs);
    }

    /* ------------------------------------------------------------------------
       Scheduling: one timer, paused while the tab is hidden.
       ------------------------------------------------------------------------ */
    function schedule(ms) {
        if (state.destroyed) return;
        clearTimeout(state.timer);
        state.timer = setTimeout(tick, ms);
    }

    function tick() {
        if (document.hidden) return;             // resumed by visibilitychange
        runCheck();
        schedule(state.wallVisible ? CONFIG.wallIntervalMs : CONFIG.intervalMs);
    }

    /* ------------------------------------------------------------------------
       Event-driven watcher: reacts when an ad container is hidden, restyled, or
       removed (for example, by a cosmetic filter). Mutations are debounced.
       ------------------------------------------------------------------------ */
    function bindObserver() {
        const trigger = () => {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(runCheck, CONFIG.debounceMs);
        };

        const mo = new MutationObserver(trigger);
        const seenParents = new Set();

        for (const w of CONFIG.watched) {
            const el = document.getElementById(w.id);
            if (!el) continue;
            mo.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
            if (el.parentNode && !seenParents.has(el.parentNode)) {
                seenParents.add(el.parentNode);
                mo.observe(el.parentNode, { childList: true });
            }
        }

        const slot = document.getElementById(CONFIG.sidebarSlotId);
        if (slot) mo.observe(slot, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

        state.observer = mo;
    }

    /* ------------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------------ */
    function init() {
        ensureBait();
        bindObserver();

        setTimeout(() => {
            probeAdNetwork();
            runCheck();
            schedule(CONFIG.intervalMs);
        }, CONFIG.startDelayMs);

        setInterval(probeAdNetwork, CONFIG.probeIntervalMs);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !state.destroyed) {
                runCheck();
                schedule(state.wallVisible ? CONFIG.wallIntervalMs : CONFIG.intervalMs);
            }
        });

        window.addEventListener('pageshow', (e) => {
            if (e.persisted) runCheck();
        });

        window.addEventListener('online', () => { probeAdNetwork(); runCheck(); });
    }

    /* Public handle for debugging from the console. */
    window.AntiAdblock = {
        check: runCheck,
        status: () => ({
            strikes: state.strikes,
            wallVisible: state.wallVisible,
            networkBlocked: state.networkBlocked,
            lastProbe: probe()
        }),
        destroy() {
            state.destroyed = true;
            clearTimeout(state.timer);
            clearTimeout(state.debounceTimer);
            state.observer?.disconnect();
            if (state.wallEl && state.wallEl.wall.isConnected) state.wallEl.wall.remove();
            document.getElementById(CONFIG.baitId)?.remove();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
