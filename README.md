# QuickSolve AI

**Made by [Aman](https://github.com/aman-dev23)**

An AI practice assistant for the NxtWave learning platform (`learning.ccbp.in`). It reads the question on your screen, asks an AI (Gemini and/or Groq), and can fill in the answer for you. It runs as a **Tampermonkey userscript**, so there is nothing to build or host.

- Works on multiple-choice, single-choice, text-answer and coding questions (HTML / CSS / JavaScript / Python / SQL)
- Reads test cases and question images, including picture options
- Keyboard shortcuts for picking options, submitting and moving to the next question
- Built-in 🐞 Debug page that shows exactly what was read, what was sent to the AI and what it answered
- Built-in 💬 Feedback form: report a bug or suggest an idea without leaving the page
- Updates itself: when a new version is uploaded here, Tampermonkey installs it for you

> **Use it responsibly.** QuickSolve is meant as a practice helper. Check your course and platform rules before using any automation, and always understand the answer instead of just copying it. You are responsible for how you use it.

---

## Install (about 5 minutes)

### Step 1: Install Tampermonkey

Tampermonkey is the browser extension that runs userscripts.

1. Go to **https://www.tampermonkey.net/** and choose your browser (Chrome, Edge, Brave, Firefox, Safari).
2. Click **Add to Chrome** (or your browser's equivalent), then confirm.
3. Pin the Tampermonkey icon from the puzzle-piece menu so you can find it easily.

> **Chrome / Edge / Brave users:** on newer browser versions you must allow user scripts, or QuickSolve will not appear.
> Open `chrome://extensions` (or `edge://extensions`) → **Tampermonkey → Details** → turn on **Allow User Scripts**. If you do not see that switch, turn on **Developer mode** (top-right of the extensions page) instead.

### Step 2: Install QuickSolve from this repo

1. Open this link: **[Install QuickSolve](https://raw.githubusercontent.com/aman-dev23/QuickSolve-Extention-for-Nxtwave/main/quicksolve.user.js)**
2. Tampermonkey opens an install page. Click **Install**.

   *Alternative:* Tampermonkey icon → **Dashboard** → **Utilities** tab → paste the link above under **Install from URL** → **Install**.
3. Open or reload **https://learning.ccbp.in/**. A small **QuickSolve** panel appears in the bottom-right corner.

Because you installed from this link, you get new versions automatically. To check manually: Tampermonkey Dashboard → **Installed Userscripts** → click the update icon, or press **Last updated**.

### Step 3: Get your free API keys

QuickSolve needs at least one key. Both are free:

| Provider | Where to get the key | Used for |
|---|---|---|
| **Google Gemini** (recommended) | https://aistudio.google.com/apikey | All questions, and anything with images |
| **Groq** (optional) | https://console.groq.com/keys | Fast second opinion, mostly for HTML/CSS tasks |

Sign in, click **Create API key**, and copy the key. Keep it private, like a password.

### Step 4: Paste your keys into QuickSolve

1. Click the **⚙** icon in the QuickSolve panel (marked **1** below).
2. Scroll down to the key fields and paste your keys.

Settings page with the key fields marked

<img width="358" height="679" alt="settings" src="https://github.com/user-attachments/assets/55d6ddaa-cf49-4a57-b8fd-57edc970ef27" />

|---|---|---|
| # | Field | What to do |
|---|---|---|
| 1 | **AI provider** | `auto` uses both (web-dev tasks go to Groq, the rest to Gemini). Pick `gemini` if you only added a Gemini key. |
| 2 | **Gemini API key** | Paste your Gemini key here. |
| 3 | **Gemini model** | Leave as `gemini-3.1-flash-lite`. If a field is left empty, this default is used. |
| 4 | **Groq API key** | Paste your Groq key here (optional). The Groq model below it defaults to `openai/gpt-oss-120b`. |

Your keys are saved **only in your own Tampermonkey** on your computer. They are not inside the script file and are never sent anywhere except to Google or Groq when you ask a question. Never paste a key into the `.js` file before sharing it with anyone.

---

## Using QuickSolve


The QuickSolve panel with every button numbered

<img width="458" height="388" alt="panel" src="https://github.com/user-attachments/assets/ec037732-86d6-4f57-9e10-ce37413e6178" />

|---|---|---|
| # | Control | What it does |
|---|---|---|
| 1 | ⚙ **Settings** | Keys, models, shortcuts, theme and panel width |
| 2 | 🐞 **Debug** | Shows what was read, what was sent to the AI and what it replied. Has a **Copy** button for bug reports |
| 3 | ⚡ **Solve** | Reads the current question and asks the AI |
| 4 | ✓ **Auto / ○ Show** | *Auto* fills the answer for you. *Show* only displays it |
| 5 | **AI: Both / Gemini / Groq** | Which AI answers |
| 6 | **Ask box** | Ask the AI anything. Press Enter or ➤ |
| 7 | 📎 **File** / 📄 **Page** | Attach an image, or let the AI read the whole page (including test cases) |
| 8 | **Keyboard shortcuts** | Expands the shortcut list |
| 9 | 💬 **Feedback** | Send a bug report, suggestion or feedback straight to the author |

**Basic flow:** open a question → press **⚡ Solve** (or `Alt+A`) → check the answer → submit.

### Keyboard shortcuts (defaults, editable in Settings)

| Key | Action |
|---|---|
| `1`–`9` | Pick an option |
| `Enter` | Submit |
| `Ctrl+Enter` | Submit from a code editor |
| `Alt+A` | Solve |
| `Alt+M` | Switch Auto-fill / Show only |
| `Alt+P` | Switch AI provider |
| `Alt+N` | Next question |
| `Alt+K` | Jump to the Ask box |
| `Alt+H` | Hide / show the answer |
| `Alt+S` | Turn QuickSolve on / off |
| `Alt+Q` | Hide the whole panel |

### Tips

- **Coding questions:** click **Run** first, so the test-case results are fresh, then press Solve. QuickSolve reads which test cases passed or failed and fixes only what is failing.
- **Panel too wide or narrow?** Drag the **Popup width** slider in Settings. Drag the panel header to move it.
- **Wrong or odd answer?** Open 🐞 **Debug**: *Question as read* shows exactly what QuickSolve saw. If the question text is empty, the page layout was not recognised, so send a report.

---

## Send feedback or report a bug

Click **💬 Feedback** in the panel, fill in your email, choose *Feedback / Suggestion / Issue*, describe it, and press **Send**. Tick **Attach last debug report** for bugs, since it shows what QuickSolve saw and what the AI replied. You can also open an [issue on GitHub](https://github.com/aman-dev23/QuickSolve-Extention-for-Nxtwave/issues).

## Troubleshooting

| Problem | Fix |
|---|---|
| The panel does not appear | Make sure Tampermonkey is enabled and **Allow User Scripts** (or Developer mode) is on, then reload the page. Check the URL starts with `https://learning.ccbp.in/`. |
| "No Gemini API key" | Add your key in ⚙ Settings (Step 4). |
| "Rate limit / free quota reached" | Wait a minute, or switch AI with `Alt+P`. |
| Answer not filled in | Make sure the button shows **✓ Auto**, not **○ Show**. |
| Keys lost after reinstalling | Settings are tied to the script. Paste your keys again. |

## Credits and license

Created by **Aman**. Released under the [MIT License](LICENSE). You may use, share and modify it, but the copyright notice and the author's name must stay in every copy. If you share it, please link to this repository instead of passing the file around, so everyone gets updates and fixes.
