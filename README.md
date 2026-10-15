\# Local AI Character ChatBot



A fully local, single-page AI Character ChatBot web app that runs entirely in your browser. No backend server, no telemetry, and no build tools required.



\## Features

\- \*\*Privacy First\*\*: All data (characters, chats, API keys) is stored locally in your browser (localStorage + IndexedDB). No data is sent anywhere except to your chosen AI provider.

\- \*\*Multiple AI Providers\*\*: Supports OpenRouter, Google Gemini, OpenAI, Anthropic, and custom OpenAI-compatible endpoints.

\- \*\*Chai AI PNG Import\*\*: Drag and drop `.png` character cards exported from Chai to instantly import their avatar, name, greeting, and backstory.

\- \*\*Modern UI\*\*: Glassmorphism design with dark/light mode, smooth animations, and full mobile responsiveness.

\- \*\*No Dependencies\*\*: Zero external libraries or CDNs. Pure HTML, CSS, and vanilla JavaScript.



\## How to Run

1\. Download or clone this repository.

2\. Open `index.html` in any modern web browser (Chrome, Firefox, Edge, Safari).

3\. \*Optional\*: If you prefer serving it locally, run `python -m http.server` in the folder and visit `http://localhost:8000`.



\## How to Add API Keys

1\. Click the ⚙️ \*\*Settings\*\* icon in the top right corner of the sidebar.

2\. Select your \*\*AI Provider\*\* from the dropdown.

3\. Paste your \*\*API Key\*\* (e.g., OpenRouter, Gemini, OpenAI key).

4\. Enter the \*\*Model Name\*\* you wish to use (e.g., `google/gemma-2-9b-it:free` for OpenRouter).

5\. Click \*\*Save Locally\*\*. Your key is stored only in your browser's localStorage and is transmitted solely to the selected provider's API endpoint.



\## How Chai AI Import Works

Chai AI stores character data inside the metadata chunks (`tEXt`/`iTXt`) of exported PNG files under keys like `chara` or `chai`.

1\. Drag and drop a Chai `.png` file anywhere onto the app, or click \*\*📥 Import PNG\*\*.

2\. The app reads the binary PNG data, extracts the metadata, parses the JSON/Base64 payload.

3\. It automatically maps the Chai fields (`name`, `first\_mes`, `personality`, `scenario`) to our character schema and saves the PNG as the avatar.

4\. A toast notification confirms the import, and the new character is selected immediately.



\## Tech Stack

\- HTML5, CSS3 (Custom properties, Flexbox, Grid)

\- Vanilla JavaScript (ES6+)

\- IndexedDB (for avatar image storage)

\- localStorage (for settings and chat history)

\- FileReader API and DataView (for binary PNG parsing)



\## Development

This project is intentionally kept simple to ensure it remains fully local and hackable.

\- `index.html`: Markup and modal templates.

\- `styles.css`: All styling, dark/light theme variables, and responsive design.

\- `app.js`: Logic for providers, chat engine, storage, PNG parser, and UI wiring.



\## License

MIT License. Feel free to use, modify, and distribute.

