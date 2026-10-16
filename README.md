Local AI Character Chat (Hubs)

A fully client-side AI Character Chat application. No backend required. All data stays in your browser.

Features

· Local Storage: Characters, chats, and settings are persisted in localStorage. Everything survives a refresh.
· Multi-Provider Support: OpenRouter, Google Gemini, OpenAI, Anthropic Claude, Groq, Ollama (local), and any custom OpenAI-compatible endpoint.
· Character Creation: Create custom characters with avatars, gender, intro, greeting, backstory, tags, and an optional PayPal tip handle. Mark characters as private if you want them hidden.
· Chai AI / Character Card PNG Import: Import character cards directly from PNG files via the Import PNG button in the character modal. The built-in parser reads tEXt/iTXt chunks and maps Base64 JSON payloads to the app schema.
· Modern UI: Glassmorphism design, dark/light auto theme, smooth animations, and a fully responsive layout with a mobile drawer.
· Reasoning Sanitizer: AI responses are cleaned of leaked chain-of-thought, [REASONING] blocks, and prefixed labels before they reach the chat.
· Popunder Cooldown: The popunder ad arms on first user gesture and fires at most once every 30 minutes, keeping the browsing experience reasonable.
· House Ad Fallback: If a 300×250 slot doesn't fill, a built-in "make your own character" card is shown instead of empty space.
· Ad Controls: Granular toggles for the top banner, sidebar/mobile ad, and popunder — accessible both from the sidebar pill and the Settings modal.
· Creator Tips: Characters can carry a PayPal.me handle; a ♥ Tip creator button appears in their chat when set.
· Support Hubs Modal: Optional donations via PayPal.me presets ($1 / $3 / $5 / $10) plus a custom amount link.
· Anti-Adblock Wall: Detects real ad blocking (bait element + watched containers + network probe) with strike-based debouncing, so legitimate slow renders never trigger it. Lifts automatically once ads render again.
· Privacy First: API keys are stored locally and sent only to the chosen provider. No telemetry.

File Structure

```
index.html        — markup for the shell, modals, and ad slots
styles.css        — theming, layout, components
app.js            — state, persistence, providers, chat, ads, support
anti-adblock.js   — blocker detection with false-positive guards
LICENSE.txt       — proprietary license
```

How to Run

1. Download or clone this repository.
2. Ensure all files (index.html, styles.css, app.js, anti-adblock.js) are in the same folder.
3. Open index.html in any modern browser (Chrome, Firefox, Safari, Edge).
4. Or serve locally: python -m http.server.

How to Add API Keys

1. Click the ⚙️ Settings button (bottom-left on desktop, top-right on mobile).
2. Select a provider from the dropdown.
3. Paste your API Key and enter the model name (use Test to validate).
4. Optionally adjust Temperature, Top P, Top K, and Max tokens.
5. For Ollama or Custom, set the Base URL field that appears.
6. Click Save. The key stays in your browser.

Ad Configuration (for forks)

The ad slots are wired for Adsterra in app.js under the ADSTERRA constant:

· topBanner — 728×90 leaderboard, loaded dynamically.
· popunder — loaded on first gesture, throttled by POPUNDER_COOLDOWN_MS.
· 300×250 slots live inline in index.html (required for Adsterra's document.write), one for the sidebar, one for mobile/tablet view.

Replace the URLs and the inline atOptions.key values with your own Adsterra zones. Toggles in Settings → Ads let users opt out per placement; the sidebar ad re-enables on each load by design.

Support / Tips Setup

To enable the donation flow:

1. Open app.js and set SUPPORT.siteUser to your PayPal.me handle (e.g. 'yourname').
2. Leave it empty to hide the Support Hubs button entirely.
3. Per-character tips are set in the character editor's Creator PayPal field and accept either yourname or a full paypal.me/yourname URL.

Hubs never processes, stores, or sees payment details — links go straight to PayPal.

How PNG Import Works

The app includes a built-in PNG metadata parser. It scans for tEXt and iTXt chunks, extracts character data (such as chara or chai fields), decodes the Base64 JSON, and maps it to the app's character schema. Click Import PNG in the character creation modal.

Acceptance Checklist

☑ Works offline except for the AI API call.
☑ Seven provider options including Ollama and Custom (OpenAI-compatible).
☑ Full settings for sampling: temperature, top-p, top-k, max tokens, disable reasoning.
☑ Dismissible top banner with confirm modal and localStorage flag.
☑ Sidebar and mobile 300×250 slots with house-ad fallback.
☑ Popunder with 30-minute cooldown and user toggle.
☑ Anti-adblock wall with strike system and auto-recovery.
☑ + opens the creation modal with avatar, gender, intro, greeting, backstory, tags, private flag, and PayPal field.
☑ Backstory is 100% user-authored and injected into the system prompt.
☑ PNG character card import.
☑ Per-character ♥ Tip creator button when a PayPal handle is set.
☑ Site-wide Support Hubs modal with preset amounts.
☑ AI reasoning / chain-of-thought sanitizer.
☑ All data saved locally; refresh preserves everything.
☑ Modern glass UI, dark/light auto, mobile responsive with drawer.
☑ API key stored only in localStorage, sent only to the chosen provider.

License

Proprietary — see LICENSE.txt. No use, modification, redistribution, or AI training permitted without written permission from AdriPM-APM.
