import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
import { askAI } from '../healer.js';
import { loadConfig, getProjectRoot } from '../utils/config-loader.js';
import { analyzeHtml, type DomAnalysis } from '../utils/dom-analyzer.js';
import { chromium } from '@playwright/test';
dotenv.config();

// ---------------------------------------------------------------------------
// DOM Inventory — extracted from the real page/HTML so the AI has no excuse
// to hallucinate element names.
// ---------------------------------------------------------------------------
interface DomInventory {
  title: string;
  headings: string[];
  labels: { text: string; forId: string | null }[];
  inputs: { id: string; type: string; placeholder: string; value: string; ariaLabel: string; name: string }[];
  textareas: { id: string; placeholder: string; ariaLabel: string; name: string }[];
  selects: { id: string; ariaLabel: string; labelText: string; options: { value: string; text: string }[] }[];
  checkboxes: { id: string; ariaLabel: string; labelText: string; checked: boolean }[];
  buttons: { text: string; id: string; type: string; ariaLabel: string }[];
  links: { text: string; href: string }[];
  ariaRoles: { role: string; name: string; tag: string }[];
  formIds: { id: string; ariaLabel: string }[];
  visibleTexts: string[];
}

async function extractDomInventory(page: any): Promise<DomInventory> {
  // Use a string to avoid transpiler injecting __name into the evaluate function block which breaks in browser context
  return await page.evaluate(`(() => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const getText = (el) => el?.textContent?.trim() ?? '';
    const getAttr = (el, attr) => el?.getAttribute(attr)?.trim() ?? '';
    const labelFor = (id) => {
      if (!id) return '';
      const lbl = document.querySelector(\`label[for="\${id}"]\`);
      if (lbl) return getText(lbl);
      const el = document.getElementById(id);
      if (el) { const parent = el.closest('label'); if (parent) return getText(parent); }
      return '';
    };

    const title = document.title;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(isVisible).map(h => getText(h)).filter(Boolean);
    const labels = Array.from(document.querySelectorAll('label'))
      .filter(isVisible).map(l => ({ text: getText(l), forId: l.getAttribute('for') }));
    const inputs = Array.from(document.querySelectorAll('input'))
      .filter(isVisible).map(i => ({
        id: i.id, type: i.type, placeholder: i.placeholder,
        value: i.defaultValue ?? i.value,
        ariaLabel: getAttr(i, 'aria-label') || labelFor(i.id), name: i.name,
      }));
    const textareas = Array.from(document.querySelectorAll('textarea'))
      .filter(isVisible).map(t => ({
        id: t.id, placeholder: t.placeholder,
        ariaLabel: getAttr(t, 'aria-label') || labelFor(t.id), name: t.name,
      }));
    const selects = Array.from(document.querySelectorAll('select'))
      .filter(isVisible).map(s => ({
        id: s.id, ariaLabel: getAttr(s, 'aria-label') || labelFor(s.id),
        labelText: labelFor(s.id),
        options: Array.from(s.options).map(o => ({ value: o.value, text: o.text.trim() })),
      }));
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
      .filter(isVisible).map(c => ({
        id: c.id,
        ariaLabel: getAttr(c, 'aria-label') || labelFor(c.id),
        labelText: labelFor(c.id),
        checked: c.defaultChecked,
      }));
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'))
      .filter(isVisible).map(b => ({
        text: getText(b) || getAttr(b, 'value'), id: b.id,
        type: b.type || 'submit', ariaLabel: getAttr(b, 'aria-label'),
      }));
    const links = Array.from(document.querySelectorAll('a'))
      .filter(isVisible).map(a => ({ text: getText(a), href: a.getAttribute('href') ?? '' })).filter(l => l.text);
    const ariaRoles = Array.from(document.querySelectorAll('[role]'))
      .filter(isVisible).map(el => ({
        role: getAttr(el, 'role'),
        name: getAttr(el, 'aria-label') || getAttr(el, 'aria-labelledby') || getText(el).substring(0, 60),
        tag: el.tagName.toLowerCase(),
      }));
    const formIds = Array.from(document.querySelectorAll('form'))
      .filter(isVisible).map(f => ({ id: f.id, ariaLabel: getAttr(f, 'aria-label') }));
    const visibleTexts = Array.from(document.querySelectorAll('p, span, li, td, div'))
      .filter(isVisible).map(el => getText(el)).filter(t => t.length > 3 && t.length < 120).slice(0, 20);

    return { title, headings, labels, inputs, textareas, selects, checkboxes, buttons, links, ariaRoles, formIds, visibleTexts };
  })()`);
}

function formatInventory(inv: DomInventory): string {
  const lines: string[] = [];
  lines.push(`PAGE INVENTORY (use ONLY these exact strings in locators):`);
  lines.push(`  title: "${inv.title}"`);
  lines.push(`  headings: ${JSON.stringify(inv.headings)}`);
  if (inv.labels.length)
    lines.push(`  labels: ${inv.labels.map(l => `"${l.text}" (for="${l.forId ?? 'none'}")`).join(', ')}`);
  if (inv.inputs.length) {
    lines.push(`  inputs:`);
    inv.inputs.forEach(i => lines.push(`    - id="${i.id}" type="${i.type}" placeholder="${i.placeholder}" value="${i.value}" aria-label="${i.ariaLabel}" name="${i.name}"`));
  }
  if (inv.textareas.length) {
    lines.push(`  textareas:`);
    inv.textareas.forEach(t => lines.push(`    - id="${t.id}" placeholder="${t.placeholder}" aria-label="${t.ariaLabel}" name="${t.name}"`));
  }
  if (inv.selects.length) {
    lines.push(`  selects:`);
    inv.selects.forEach(s => lines.push(`    - id="${s.id}" accessible-label="${s.ariaLabel || s.labelText}" options=[${s.options.map(o => `{value:"${o.value}",text:"${o.text}"}`).join(', ')}]`));
  }
  if (inv.checkboxes.length) {
    lines.push(`  checkboxes:`);
    inv.checkboxes.forEach(c => lines.push(`    - id="${c.id}" accessible-label="${c.ariaLabel || c.labelText}" defaultChecked=${c.checked}`));
  }
  if (inv.buttons.length)
    lines.push(`  buttons: ${inv.buttons.map(b => `"${b.text}" (id="${b.id}" type="${b.type}" aria-label="${b.ariaLabel}")`).join(', ')}`);
  if (inv.links.length)
    lines.push(`  links: ${inv.links.map(l => `"${l.text}"`).join(', ')}`);
  if (inv.ariaRoles.length)
    lines.push(`  explicit-aria-roles: ${inv.ariaRoles.map(r => `role="${r.role}" name="${r.name}" tag="${r.tag}"`).join(' | ')}`);
  if (inv.formIds.length)
    lines.push(`  forms: ${inv.formIds.map(f => `id="${f.id}" aria-label="${f.ariaLabel}"`).join(', ')}`);
  if (inv.visibleTexts.length)
    lines.push(`  visible-text-samples: ${JSON.stringify(inv.visibleTexts.slice(0, 10))}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function generateTestFromHTML(target: string): Promise<string> {
  const isUrl = target.startsWith('http://') || target.startsWith('https://');
  let fileName = '';
  let rawHtmlContent = '';
  let inventory: DomInventory;
  let domAnalysis: DomAnalysis | null = null;
  let liveHtml = '';

  logger.info(isUrl ? `Launching browser → ${target}` : `Rendering HTML → ${target}`);

  const browser = await chromium.launch();
  
  try {
    const page = await browser.newPage();

    if (isUrl) {
      await page.goto(target, { waitUntil: 'networkidle' });
      try {
        const urlObj = new URL(target);
        fileName = (urlObj.hostname + urlObj.pathname)
          .replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'live-page';
      } catch { fileName = 'live-page'; }
    } else {
      const absolutePath = path.resolve(target);
      if (!fs.existsSync(absolutePath)) throw new Error(`File not found: ${absolutePath}`);
      rawHtmlContent = fs.readFileSync(absolutePath, 'utf-8');
      fileName = path.basename(absolutePath, '.html');
      await page.setContent(rawHtmlContent, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForTimeout(500);
    inventory = await extractDomInventory(page);
    liveHtml = await page.content();
  } finally {
    await browser.close();
  }

  // Run dom-analyzer on the HTML (either raw or live) to get the validated locator map
  const htmlToAnalyze = isUrl ? liveHtml : rawHtmlContent;
  domAnalysis = analyzeHtml(htmlToAnalyze);
  logger.info(`Locator map built: ${domAnalysis.locators.length} elements analyzed`);

  const config = loadConfig();
  const absoluteTestDir = path.join(getProjectRoot(), config.generatedTestDir || 'tests');
  const absoluteTarget = isUrl ? '' : path.resolve(target);
  const relativeHtmlPath = isUrl ? '' : path.relative(absoluteTestDir, absoluteTarget).split(path.sep).join('/');

  const navigationCode = isUrl
    ? `await page.goto('${target}');`
    : `const __dirname = path.dirname(fileURLToPath(import.meta.url));\n  const localUrl = \`file://\${path.resolve(__dirname, '${relativeHtmlPath}')}\`;\n  await page.goto(localUrl);`;

  const importCode = isUrl
    ? `import { test, expect } from '@playwright/test';`
    : `import { test, expect } from '@playwright/test';\nimport { fileURLToPath } from 'url';\nimport * as path from 'path';`;

  const inventoryBlock = formatInventory(inventory);

  // Use dom-analyzer's validated locator map instead of buildLocatorRules
  const validatedLocatorBlock = domAnalysis
    ? `\n${domAnalysis.promptBlock}\n`
    : '';

  const prompt = `
You are an expert QA automation engineer generating a Playwright E2E test file.

Your ONLY job is to produce tests that PASS on the first run by using EXACT element
locators from the VALIDATED LOCATOR MAP below — which has already resolved all
label/input associations for you.

${validatedLocatorBlock}

${inventoryBlock}

RAW HTML (for additional reference — use ONLY locators from the map above):
====================
${liveHtml.substring(0, 8000)}
====================

STRICT RULES:
1. ALL locators MUST come from the VALIDATED LOCATOR MAP above. Copy them verbatim.
2. For any element marked ⚠️ DISCONNECTED LABEL → use the given locator() expression, NEVER getByLabel().
3. Use getByRole() for buttons, links, headings.
4. Use getByRole() for checkboxes with the EXACT label text from the map.
5. NEVER use getByRole('form') unless the form has an aria-label in the inventory.
6. NEVER assert a default value (toHaveValue) unless listed in the inventory.
7. NEVER assert getByText() for text not in visible-text-samples.
8. Static file:// pages with no <script> tags are FULLY STATIC — do NOT assert dynamic state changes.
9. Write MULTIPLE test() blocks in a test.describe() — one per concern (load, form fill, buttons, etc.). MUST use test.describe not describe.
10. PLAYWRIGHT STRICT MODE CONSTRAINTS & DUPLICATE ELIMINATION: Playwright requires locators to resolve to EXACTLY ONE unique element. Scan the provided DOM/RAW HTML to ensure any text or elements you target are strictly unique.
    - If a text node, heading, or element label appears multiple times in the DOM (e.g., 'ScoopDreams' in the header/banner and also in the footer), you MUST scope the locator to its parent container (e.g., \`page.getByRole('banner').getByText('ScoopDreams')\` or \`page.locator('header').getByText('ScoopDreams')\`) or append \`.first()\`.
    - If targeting a word nested inside elements like spans/formatting tags within a heading (e.g., \`Taste the <span>Magic</span> in Every Scoop\`), using \`page.getByText('Magic')\` will match both the span and heading, causing a strict mode failure. You MUST target the specific tag uniquely or use \`page.getByRole('heading', { name: /Magic/ })\`.
11. Start with:
${importCode}
12. Navigate inside each test using:
   ${navigationCode}
13. Output ONLY raw TypeScript. No markdown fences, no explanations, no prose.
`;

  let generatedCode = await askAI(
    'You are an expert Playwright test automation engineer. Generate ONLY correct, runnable TypeScript.\n\n' + prompt,
    config
  );

  // Strip markdown fences if AI wrapped despite instructions
  generatedCode = generatedCode
    .replace(/^```(?:typescript|ts|javascript|js)?\n/gm, '')
    .replace(/```$/gm, '')
    .trim();

  const testFileName = `${fileName}.spec.ts`;
  const testFilePath = path.join(absoluteTestDir, testFileName);
  if (!fs.existsSync(path.dirname(testFilePath))) {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
  }

  fs.writeFileSync(testFilePath, generatedCode + '\n');
  logger.success(`Generated test: ${testFileName}`);

  // ── Post-generation syntax check (--list just enumerates tests, no browser) ──
  try {
    const { spawnSync } = await import('child_process');
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    spawnSync(npxCmd, ['playwright', 'test', testFilePath, '--list'], { stdio: 'pipe' });
    logger.success(`Syntax check passed — test file is valid.`);
  } catch (e: any) {
    const output = e.stdout?.toString() || e.stderr?.toString() || '';
    logger.warn(`Post-generation syntax check failed:\n${output.slice(0, 500)}`);
    logger.warn(`The file was written but may need manual review.`);
  }

  return testFilePath;
}

export async function generateFlowTest(htmlFilePaths: string[]): Promise<string> {
  const browser = await chromium.launch();
  const inventories: { name: string; inventory: DomInventory; content: string; analysis: DomAnalysis | null }[] = [];

  try {
    for (const p of htmlFilePaths) {
      const name = path.basename(p, '.html');
      const raw = fs.readFileSync(path.resolve(p), 'utf-8');
      const analysis = analyzeHtml(raw);
      const bPage = await browser.newPage();
      await bPage.setContent(raw, { waitUntil: 'domcontentloaded' });
      await bPage.waitForTimeout(300);
      const inv = await extractDomInventory(bPage);
      const liveHtml = await bPage.content();
      await bPage.close();
      inventories.push({ name, inventory: inv, content: liveHtml, analysis });
    }
  } finally {
    await browser.close();
  }

  const flowName = inventories.map(i => i.name).join('_');

  const pagesBlock = inventories.map((p, i) => {
    const locatorBlock = p.analysis ? p.analysis.promptBlock : '';
    return `--- STEP ${i + 1}: ${p.name}.html ---\n${formatInventory(p.inventory)}\n${locatorBlock}`;
  }).join('\n\n');

  const prompt = `
You are an expert Playwright automation engineer. Create ONE single E2E "Flow" test navigating these pages in order.

${pagesBlock}

MANDATORY RULES:
1. ALL locator strings MUST come verbatim from the VALIDATED LOCATOR MAP sections above.
2. For any element marked ⚠️ DISCONNECTED LABEL → use the given locator() expression.
3. PLAYWRIGHT STRICT MODE CONSTRAINTS & DUPLICATE ELIMINATION: Playwright requires locators to resolve to EXACTLY ONE unique element. Scan the provided DOM/RAW HTML to ensure any text or elements you target are strictly unique.
   - If a text node, heading, or element label appears multiple times (e.g., in a header/banner and also in a footer), scope the locator to its parent container (e.g., \`page.getByRole('banner').getByText('ScoopDreams')\` or \`page.locator('header').getByText('ScoopDreams')\`) or append \`.first()\`.
   - If targeting a word nested inside formatted child elements (e.g. \`Taste the <span>Magic</span>\`), avoid plain \`getByText\` which matches both parent and child; target it uniquely using \`page.getByRole('heading', { name: /Magic/ })\`.
4. ESM boilerplate at top:
   import { test, expect } from '@playwright/test';
   import { fileURLToPath } from 'url';
   import * as path from 'path';
   const __dirname = path.dirname(fileURLToPath(import.meta.url));
5. Use file:// protocol for local files.
6. One test block: test('should complete the ${flowName} journey', async ({ page }) => { ... });
7. Output ONLY raw TypeScript.
`;

  const config = loadConfig();
  let generatedCode = await askAI('Create a Playwright flow test.\n\n' + prompt, config);
  generatedCode = generatedCode
    .replace(/^```(?:typescript|ts)?\n/gm, '')
    .replace(/```$/gm, '')
    .trim();

  const testFilePath = path.join(getProjectRoot(), config.generatedTestDir || 'tests', `${flowName}.flow.spec.ts`);
  fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
  fs.writeFileSync(testFilePath, generatedCode + '\n');
  return testFilePath;
}
