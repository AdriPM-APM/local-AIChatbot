# Local AI Character Chat

A fully client-side AI Character Chat application. No backend required. All data stays in your browser.

## Features
- **Local Storage**: Characters, chats, and settings are stored in `localStorage` and `IndexedDB`.
- **Multi-Provider Support**: OpenRouter, Google Gemini, OpenAI, Anthropic, Groq, Ollama, and custom OpenAI-compatible endpoints.
- **Character Creation**: Create custom characters with avatars, backstories, greetings, and more.
- **Chai AI PNG Import**: Drag and drop compatible PNG files to automatically import characters.
- **Modern UI**: Glassmorphism design with dark/light mode, smooth animations, and responsive layout.
- **Mock Ad Banner**: A dismissible ad placeholder that respects user preferences.
- **Privacy First**: API keys are stored locally and only sent to the chosen provider. No telemetry.

## How to Run
1. Download or clone this repository.
2. Ensure all three files (`index.html`, `styles.css`, `app.js`) are in the same folder.
3. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).
4. Alternatively, serve it using a local server: `python -m http.server`.

## How to Add API Keys
1. Click the **⚙️ Settings** button in the bottom left.
2. Select your desired provider from the dropdown.
3. Paste your API Key and specify the model name.
4. Click **Save Locally**. The key is stored only in your browser.

## How Chai Import Works
The app includes a built-in PNG metadata parser. It scans for `tEXt` and `iTXt` chunks in PNG files, extracts character data (like `chara` or `chai` fields), decodes the Base64 JSON, and maps it to the app's character schema. Just click **Import from PNG** in the character creation modal.

## Acceptance Checklist
- [x] Works offline except for the AI API call.
- [x] Two+ provider options in dropdown.
- [x] Dismissible test ad banner (X button + localStorage flag).
- [x] + opens creation modal with all listed fields.
- [x] Backstory is 100% user-authored and injected into system prompt.
- [x] Chai AI PNG drag-drop import works instantly.
- [x] All data saved locally; refresh preserves everything.
- [x] Modern glass UI, dark/light, mobile responsive.
- [x] API key stored only in localStorage, sent only to the chosen provider.
