# 🛡️ AutoHeal: AI-Powered Self-Healing E2E Testing

![NPM Version](https://img.shields.io/npm/v/selfhealinge2e)
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

Since AutoHeal is a CLI tool, it is highly recommended to install it globally so you can use the `autoheal` command anywhere:

```bash
npm install -g selfhealinge2e
```

*(Alternatively, you can run it locally in your project without installing globally using `npx selfhealinge2e`)*

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

AutoHeal provides a full suite of commands to make E2E testing effortless.

### 1. Run & Heal Tests
Run your entire test suite. If any test fails due to a broken locator or mismatched text, AutoHeal will automatically pause, analyze the DOM, rewrite your test script, and verify the fix.

```bash
autoheal test
```
*Add the `--interactive` (or `-i`) flag if you want to manually approve every AI code change before it is saved.*

### 2. Live Watcher (TDD Mode)
Continuously watch your project files. Whenever you save an HTML or Source file, AutoHeal will instantly find the matching test, run it, and heal it if you broke the UI.

```bash
autoheal watch --dir tests/target-app
```

### 3. Generate a New Test
Give AutoHeal an HTML file or a live URL, and it will read the DOM and write a complete, robust Playwright test file from scratch.

```bash
# Generate from a local file
autoheal generate tests/target-app/login.html

# Generate from a live URL
autoheal generate https://example.com/login
```

### 4. Batch Generate Tests
Point AutoHeal at a folder, and it will recursively find all HTML files and generate Playwright tests for every single one.

```bash
autoheal generate-all --dir tests/target-app
```

### 5. Visual Debugging
Want to actually *see* what the browser is doing? Run the tests in headed mode with accelerated slow-motion so you can watch the AI interact with your app.

```bash
autoheal view
```

### 6. Playwright UI Mode
Quickly open Playwright's built-in time-travel UI for deep debugging.

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
- [x] Multi-AI Provider support (Gemini, OpenRouter, OpenAI, Anthropic)
- [x] Recursive file support
- [x] Strict Mode Violation detection
- [ ] Integration with CI/CD (GitHub Actions)
- [ ] Support for Mobile Viewports

## 📄 License
This project is licensed under the MIT License.