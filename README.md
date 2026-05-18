# 🛡️ AutoHeal: AI-Powered Self-Healing E2E Testing

![NPM Version](https://img.shields.io/npm/v/@sanathkumar/selfhealinge2e)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

**AutoHeal** is an autonomous end-to-end test modifier and generator that prevents flaky Playwright tests from breaking your deployment pipelines. 

Writing and maintaining E2E tests is a massive pain. When your UI changes—a button ID is updated, a label is changed, or an element is moved—your tests break. AutoHeal catches the failure, analyzes the new DOM using AI (Gemini, OpenAI, or Anthropic), and surgically patches your test code so it passes, keeping your tests green without manual intervention.

---

## 🚀 Key Features

- **🤖 AI-Powered Self-Healing:** Automatically repairs broken selectors (IDs, classes, labels) by analyzing DOM traces and rewriting the exact broken line of code in your test.
- **🧠 Intelligent Test Generator:** Build entire Playwright test suites from raw HTML files or React pages in seconds.
- **👁️ Visual Debugging:** Instantly watch the healing happen in real-time in a headed Chrome window.
- **⚡ Real-Time Watcher:** Edit your HTML or React code, and AutoHeal will instantly run and fix the corresponding Playwright tests in the background.
- **🔗 CLI-First:** Seamlessly wraps Playwright with an intuitive, interactive command-line interface.

---

## 🛠️ Installation

Since AutoHeal is a CLI tool, you can install it globally so you can use the `autoheal` command anywhere:

```bash
npm install -g @sanathkumar/selfhealinge2e
```

### 📦 Playwright Project Setup
To run tests in your project, make sure Playwright and the browser binaries are installed in your target project:

```bash
# 1. Install Playwright test runner in your target project
npm install --save-dev @playwright/test

# 2. Install the Chromium browser binary
npx playwright install chromium
```

---

## 🔑 Getting Started

Before using AutoHeal, you need to configure your AI provider (e.g., Gemini, OpenAI, or Anthropic).

Run the initialization command in your project folder:

```bash
autoheal init
```
*This interactive prompt will ask for your API key and preferred model, and securely save them in a `.env` file.*

---

## 📖 Usage Guide

AutoHeal provides a powerful set of commands to make E2E testing effortless. You can pass any standard Playwright arguments to these commands (like specific file names or `--headed`).

### 🛠️ 1. Test & Auto-Heal (`autoheal test`)
This is the core command. It runs your Playwright test suite. If any test fails due to a UI change (e.g., a missing button, changed text, or broken selector), AutoHeal catches the error, analyzes your application's DOM, and surgically rewrites the broken line of code in your test file so it passes.

**Basic Usage (Run all tests):**
```bash
autoheal test
```

**Run a specific test file:**
```bash
autoheal test tests/login.spec.ts
```

**Interactive Mode (Recommended for safety):**
If you want to review and approve the AI's code changes before they are saved to your files, use the `-i` flag.
```bash
autoheal test -i
```

### ⚡ 2. Live Watcher (TDD Mode)
Watch your project files continuously. Whenever you save a React (`.jsx`/`.tsx`), Vue (`.vue`), Svelte (`.svelte`), or HTML source file, AutoHeal instantly finds the matching test, runs it, and heals it if your code changes broke the UI.

**Watch a specific folder (recommended):**
```bash
autoheal watch --dir src
```

**Watch the entire project workspace:**
```bash
autoheal watch --dir .
```

**Watch in headed visual mode (to see browsers open and test in real-time):**
```bash
VISUAL=true autoheal watch --dir src
```

### 🧠 3. Generate New Tests (`autoheal generate`)
Don't write tests by hand! Give AutoHeal a React component, Svelte file, Vue page, static HTML file, or a live URL, and it will analyze the UI elements and write a complete, robust Playwright test file from scratch.

**Generate from a React component, Vue, or Svelte file:**
```bash
autoheal generate src/components/LoginForm.tsx
```

**Generate from a local HTML file:**
```bash
autoheal generate public/pages/login.html
```

**Generate from a live URL:**
```bash
autoheal generate https://example.com/login
```

### 🏗️ 4. Batch Generate Tests (`autoheal generate-all`)
Point AutoHeal at a folder, and it will recursively find all source files/components (HTML, JSX, TSX, Vue, Svelte) and generate Playwright tests for every single one automatically.

**Basic Usage:**
```bash
autoheal generate-all --dir src/pages
```

### 🗺️ 5. Multi-Page User Journeys (`autoheal flow`)
Generate a single, end-to-end "Flow" test that navigates through multiple components or pages in order (e.g., Login -> Dashboard -> Settings).

**Basic Usage:**
```bash
autoheal flow src/pages/login.tsx src/pages/dashboard.tsx
```

### 👁️ 6. Visual Debugging (`autoheal view`)
Want to actually *see* what the browser is doing? This runs your tests in a visible Chrome window with "accelerated slow-motion" so you can watch the AI interact with your app and understand why a test is failing.

**Basic Usage:**
```bash
autoheal view tests/checkout.spec.ts
```

### 🔬 7. Playwright UI Mode (`autoheal ui`)
Quickly open Playwright's built-in time-travel UI for deep debugging and tracing.

**Basic Usage:**
```bash
autoheal ui
```

---

## ⚙️ Configuration

AutoHeal uses an `autoheal.config.json` file in your project root to remember your preferences. It is automatically created when you run `autoheal init`.

```json
{
  "targetDir": "tests/target-app",
  "generatedTestDir": "tests",
  "ai": {
    "provider": "gemini",
    "model": "gemini-2.0-flash"
  },
  "visual": false,
  "exclude": ["**/node_modules/**", "**/dist/**"]
}
```
*Note: CLI flags (like `--dir`) will always override settings in this file.*

---

## 🤝 Roadmap

**✅ Completed**
- [x] Multi-AI Provider support (Gemini, OpenRouter, OpenAI, Anthropic)
- [x] Recursive file support & Elastic Test Discovery
- [x] Strict Mode Violation detection & Smart Healing
- [x] Integration with CI/CD (GitHub Actions)
---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for the full text.
