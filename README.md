# 🛡️ AutoHeal: AI-Powered Self-Healing E2E Testing

![AutoHeal Banner](https://img.shields.io/badge/AutoHeal-v1.0.0-blue?style=for-the-badge)
![License MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**AutoHeal** is an autonomous end-to-end test modifier and generator that prevents flaky Playwright tests from breaking your deployment pipelines. 

When your UI changes, AutoHeal catches the failure, analyzes the new DOM using AI (Gemini/OpenRouter), and surgically patches your test code—keeping your tests green without manual intervention.

---

## 🚀 Key Features

- **🤖 AI-Powered Self-Healing**: Automatically repairs broken selectors (IDs, classes, labels) by analyzing DOM traces.
- **🧠 Intelligent Test Generator**: Build entire Playwright test suites from raw HTML files or React pages in seconds.
- **📂 Recursive Support**: Handles complex, nested project structures automatically.
- **🖥️ Visual Debugging**: Run with `VISUAL=true` to watch the healing happen in real-time in a headed Chrome window.
- **🔗 CLI-First**: Seamlessly wraps `npx playwright test`.

## ⚙️ Configuration (`autoheal.config.json`)

You can permanently save your project settings in an `autoheal.config.json` file in your root directory:

```json
{
  "targetDir": "tests/target-app",
  "ai": { "provider": "gemini", "model": "gemini-2.0-flash" },
  "visual": false
}
```
*CLI flags (like `--dir`) will always override settings in this file.*

---

## 🛠️ Installation & Setup

1. **Clone and Install**:
   ```bash
   git clone <your-repo-url>
   npm install
   ```

2. **Initialize Configuration**:
   ```bash
   npx tsx bin/autoheal.ts init
   ```
   *Follow the prompts to enter your Gemini or OpenRouter API keys.*

---

## 📖 Usage

### ⚙️ Generate Tests
Generate tests for a single file or a whole directory (recursive):
```bash
npx tsx bin/autoheal.ts generate path/to/page.html
npx tsx bin/autoheal.ts generate-all --dir tests/target-app
```

### 🧪 Run & Heal
Run your entire test suite. If any test fails, AutoHeal will automatically attempt to repair it:
```bash
npx tsx bin/autoheal.ts test
```

### 📺 Visual Mode (Watch the Healing)
```bash
VISUAL=true npx tsx bin/autoheal.ts test
```

---

## 🤝 Roadmap
- [x] Recursive file support
- [x] Multi-AI Provider support (Gemini, OpenRouter)
- [x] Integration with CI/CD (GitHub Actions)
- [x] Support for Mobile Viewports

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
