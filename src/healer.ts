import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { loadConfig, getProjectRoot } from './utils/config-loader.js';
import { logger } from './utils/logger.js';
import { patchFile } from './patcher.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { analyzeHtmlFile } from './utils/dom-analyzer.js';
import { findSourceFileForElement, getAllFiles } from './utils/source-mapper.js';
import { saveAiAttemptLog, saveReport } from './utils/reporter.js';
import type { HealRecord, AiAttemptStatus } from './utils/reporter.js';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import OpenAI from 'openai';
import { Project, Node, SyntaxKind } from 'ts-morph';

// ── Error root-cause types ────────────────────────────────────────────────────
type ErrorClass =
  | 'LOCATOR_NOT_FOUND'    // Element doesn't exist / getByLabel broken
  | 'STRICT_MODE_VIOLATION' // Locator matches multiple elements
  | 'ASSERTION_MISMATCH'   // Element found, but value/text wrong
  | 'TIMEOUT'              // Element exists but took too long
  | 'API_ERROR'            // Wrong Playwright method / TypeScript error
  | 'BROWSER_CRASH'        // Environment or browser launch issue
  | 'ELEMENT_NOT_ACTIONABLE' // Element intercepted or not visible
  | 'NAVIGATION_ERROR'       // Page failed to load, connection refused
  | 'UNKNOWN';

function classifyError(errorMsg: string): ErrorClass {
  const m = errorMsg.toLowerCase();

  const locatorNotFoundPatterns = [
    /getby(label|text|role|placeholder|testid)/i,
    /locator\s*\(/i,
    /waiting for/i,
    /(no element|could not find)/i,
    /resolve to/i,
  ];

  const strictModePatterns = [
    /strict mode violation/i,
    /resolved to \d+ elements/i,
    /expected 1 element, but found/i,
  ];

  const assertionPatterns = [
    /expected to have (value|text|attribute)/i,
    /to have (text|value|attribute)/i,
    /(tobevisible|tohaveattribute|tohavetext|received string)/i,
    /actual:\s*["'].*["']/i,
    /locator resolved to/i,
  ];

  const timeoutPatterns = [
    /locator\.waitfor|page\.waitfor/i,
    /timeout.*exceeded/i,
  ];

  const notActionablePatterns = [
    /intercepted by another element/i,
    /element is not visible/i,
    /element is outside of the viewport/i,
    /not actionable/i,
    /is not attached to the dom/i,
  ];

  const navigationPatterns = [
    /net::err_name_not_resolved/i,
    /net::err_internet_disconnected/i,
    /^page\.goto/i,
    /page\.goto:.*timeout/i,
    /navigation failed/i,
  ];

  const browserCrashPatterns = [
    /target page, context or browser has been closed/i,
    /browser closed/i,
    /net::err_file_not_found/i,
    /net::err_connection_refused/i,
    /fatal error/i,
    /mach_port_rendezvous/i,
  ];

  const apiErrorPatterns = [
    /is not a function/i,
    /getbyid is not/i,
    /property.*undefined/i,
    /typeerror/i,
  ];

  // PRIORITY CHECK: 
  // 1. Check for specific assertion failures FIRST.
  // If the log contains "actual:" or "expected", it means the element WAS FOUND,
  // so it's definitely an assertion mismatch, even if "waiting for" appears in the log.
  const explicitAssertionPatterns = [
    /expected to have (value|text|attribute)/i,
    /actual:\s*["'].*["']/i,
    /received string/i,
  ];
  if (explicitAssertionPatterns.some(p => p.test(m))) return 'ASSERTION_MISMATCH';

  // 2. Check for missing elements (if no explicit mismatch was found)
  if (locatorNotFoundPatterns.some(p => p.test(m))) return 'LOCATOR_NOT_FOUND';
  
  // 3. Check for elements that exist but can't be interacted with
  if (notActionablePatterns.some(p => p.test(m))) return 'ELEMENT_NOT_ACTIONABLE';
  
  // 4. Check for specific strict mode issues (multiple elements)
  if (strictModePatterns.some(p => p.test(m))) return 'STRICT_MODE_VIOLATION';
  
  // 5. Remaining assertion patterns
  if (assertionPatterns.some(p => p.test(m))) return 'ASSERTION_MISMATCH';
  
  // 5. Environmental/Navigation errors
  if (browserCrashPatterns.some(p => p.test(m))) return 'BROWSER_CRASH';
  if (navigationPatterns.some(p => p.test(m))) return 'NAVIGATION_ERROR';
  if (timeoutPatterns.some(p => p.test(m))) return 'TIMEOUT';
  if (apiErrorPatterns.some(p => p.test(m))) return 'API_ERROR';

  return 'UNKNOWN';
}

// ── AI provider abstraction ───────────────────────────────────────────────────
export async function askAI(prompt: string, config: any): Promise<string> {
  const provider = process.env.AI_PROVIDER || config.ai?.provider || 'openai';
  const model = process.env[`${provider.toUpperCase()}_MODEL`] || config.ai?.model || 'default';

  logger.step(`Transmitting context to AI provider (${provider}:${model})...`);

  if (provider === 'gemini') {
    const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const genModel = ai.getGenerativeModel({ model });
    const res = await genModel.generateContent(prompt);
    return res.response.text();
  }

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const res = await client.messages.create({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const firstBlock = res.content[0];
    return firstBlock && 'text' in firstBlock ? firstBlock.text : '';
  }

  if (provider === 'openrouter') {
    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
    });
    return completion?.choices?.[0]?.message?.content || '';
  }

  // Default: OpenAI
  const aiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await aiClient.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
  });
  return response?.choices?.[0]?.message?.content || '';
}

// ── Extract only the lines around the failing test ───────────────────────────
function extractFailingTestBlock(content: string, errorLine: number): string {
  try {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('temp.ts', content);

    // ts-morph uses 0-based lines and characters.
    // getPositionOfLineAndCharacter throws if line is out of bounds
    const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(errorLine - 1, 0);
    const descendant = sourceFile.getDescendantAtPos(pos);
    
    if (descendant) {
      // Find closest CallExpression (test, test.step, test.describe) or MethodDeclaration
      const testBlock = descendant.getFirstAncestor(node => {
        if (Node.isCallExpression(node)) {
          const exp = node.getExpression().getText();
          if (exp.includes('test.step')) return false; // Ignore test.step to get full test scope
          if (exp.includes('test') || exp.includes('describe') || exp.includes('it')) return true;
        }
        if (Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node)) {
          return true;
        }
        return false;
      });

      if (testBlock) {
        return testBlock.getText();
      }
    }
  } catch (e) {
    // Silently fall back to string parsing on AST failure
  }

  const lines = content.split('\n');
  let start = Math.max(0, errorLine - 30);
  for (let i = errorLine - 1; i >= Math.max(0, errorLine - 50); i--) {
    // Match test blocks or generic methods (async xxx(), class xxx) for POM support
    if (/^\s*(test\(|function|class|async\s+\w+\s*\(|\w+\s*\()/.test(lines[i] ?? '')) {
      start = i;
      break;
    }
  }
  let depth = 0;
  let end = Math.min(lines.length - 1, errorLine + 30);
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i] ?? '') {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    if (depth <= 0 && i >= errorLine - 1) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end + 1).join('\n');
}

// ── Build targeted system prompt based on error class ────────────────────────
// NOTE: We use a REPLACEMENT-only format (not unified diff).
// The AI is given the EXACT block we extracted from the file and must return
// only the fixed version. We supply the original ourselves — the AI never has
// to reproduce original lines, eliminating all diff-parsing / patcher failures.
function buildPrompt(opts: {
  errorClass: ErrorClass;
  fileName: string;
  errorLine: number;
  errorMsg: string;
  failingBlock: string;       // exact block taken from the file — shown to AI
  fullTestContent: string;
  domContext: string;
  locatorMapBlock: string;
  globalContext: string;      // results from global codebase search
  previousFix?: string;       // the last replacement the AI produced (not the original)
  verificationError?: string;
}): string {
  const {
    errorClass, fileName, errorLine, errorMsg,
    failingBlock, fullTestContent, domContext,
    locatorMapBlock, globalContext, previousFix, verificationError,
  } = opts;

  const retrySection = previousFix
    ? `
⛔ YOUR PREVIOUS FIX FAILED — DO NOT REPEAT IT.
The replacement block you returned last time was:
\`\`\`typescript
${previousFix}
\`\`\`
Verification error after that fix:
${verificationError}

The FAILING TEST BLOCK below is unchanged — it is still the original. Output a completely different FIXED BLOCK.`
    : '';

  const classGuidance: Record<ErrorClass, string> = {
    LOCATOR_NOT_FOUND: `
🔍 ERROR CLASS: LOCATOR_NOT_FOUND
The locator cannot find the element. Read the VALIDATED LOCATOR MAP carefully.
- If the element has a DISCONNECTED LABEL warning → you MUST NOT use getByLabel(). Use the given locator() instead.
- If the element has no label at all → use locator('#id') or locator('[name="x"]').
- Only use getByLabel() when the map explicitly shows a connected label (no ⚠️ warning).
- For 'select' (dropdown) → Use .selectOption('value'). NEVER use .fill().
- For 'checkbox' or 'radio' → Use .check() or .uncheck(). NEVER use .fill().
- For 'file' inputs → Use .setInputFiles('path').
- For 'textarea' or 'input' → .fill('text') is correct.`,

    STRICT_MODE_VIOLATION: `
🔍 ERROR CLASS: STRICT_MODE_VIOLATION
The locator matches multiple elements on the page. You must make it more specific and resolve duplicates.
- Use the VALIDATED LOCATOR MAP to find more unique attributes (e.g., placeholder, name, ID).
- If the elements are truly identical, use \`.first()\`, \`.last()\`, or \`.nth(i)\`.
- If a text node, heading, or element label appears multiple times (e.g., in a header/banner and also in a footer like 'ScoopDreams'), automatically scope the locator to its parent container (e.g., \`page.getByRole('banner').getByText('ScoopDreams')\` or \`page.locator('header').getByText('ScoopDreams')\`) or append \`.first()\`.
- If targeting a word nested inside formatted child elements (like \`Taste the <span>Magic</span>\`), Playwright's \`getByText('Magic')\` will match both the span and parent heading. Target it uniquely using a role locator like \`page.getByRole('heading', { name: /Magic/ })\` instead of a plain \`getByText\`.
- If one is visible and others are hidden, use \`locator('...').filter({ visible: true })\`.`,

    ASSERTION_MISMATCH: `
🔍 ERROR CLASS: ASSERTION_MISMATCH
The element was found but its value/text/attribute does not match the assertion.
- Read the actual value from the error message and update the assertion to match the real value.
- Do NOT change the locator — only fix the expected value in toHaveValue/toHaveText/toHaveAttribute.
- If the page is static HTML (file://), do NOT assert dynamic state.`,

    TIMEOUT: `
🔍 ERROR CLASS: TIMEOUT
The element exists but Playwright timed out waiting for it.
- Add \`{ timeout: 10000 }\` to the failing locator or action.
- If it is a navigation/state-change, add \`await page.waitForLoadState('domcontentloaded')\` before the assertion.
- Do NOT change the locator string itself.`,

    API_ERROR: `
🔍 ERROR CLASS: API_ERROR — Wrong Playwright API or TypeScript error
- Only use real Playwright methods: locator(), getByRole(), getByLabel(), getByText(), getByPlaceholder(), getByTestId().
- getByById() does NOT exist — use locator('#id').
- Check for missing await, wrong argument types, or typos in method names.`,

    BROWSER_CRASH: `
🔍 ERROR CLASS: BROWSER_CRASH
The browser crashed or failed to launch (e.g., Permission Denied, Target Closed).
- This is likely an environment issue, NOT a test bug.
- Check if the URL (page.goto) is correct and the file exists.
- Do NOT change the test code unless the URL is clearly wrong.`,

    ELEMENT_NOT_ACTIONABLE: `
🔍 ERROR CLASS: ELEMENT_NOT_ACTIONABLE
The element is found but cannot be clicked or typed into. It might be covered by an overlay, animated, or hidden.
- If it's covered by a modal/overlay, try to close the overlay first or use \`{ force: true }\` on the action (e.g., \`.click({ force: true })\`).
- If it's a scrolling issue, add \`.scrollIntoViewIfNeeded()\` before interacting.
- If it's hidden but exists, ensure the test is interacting with the correct visible element instead of a hidden input (like a hidden file input or hidden custom checkbox).`,

    NAVIGATION_ERROR: `
🔍 ERROR CLASS: NAVIGATION_ERROR
The page failed to load or navigation was interrupted.
- If the URL is wrong, fix the \`page.goto()\` call.
- If it timed out loading, add \`{ waitUntil: 'domcontentloaded', timeout: 60000 }\` to \`page.goto()\`.
- Ensure you are awaiting navigation events correctly.`,

    UNKNOWN: `
🔍 ERROR CLASS: GENERAL
Analyze the error carefully. It could be a wrong locator, wrong value, missing await, or wrong API.`,
  };

  const systemPrompt = `You are an expert E2E test engineer specializing in Playwright. 
Your goal is to provide a surgical, production-grade fix for a failing test.

STRICT REPAIR RULES:
1. NEVER use page.waitForTimeout() for transient UI states. It causes race conditions.
2. ALWAYS use Playwright's auto-waiting assertions like expect(locator).toHaveText().
3. PREFER stable ID locators (e.g., #submitBtn) over text-based locators for elements that change state.
4. If an element changes text (e.g., from "Submit" to "Sending"), do NOT use the new text in the locator. Target the element by ID and assert on the text.
5. PLAYWRIGHT STRICT MODE & DUPLICATE LOCATOR ELIMINATION: Every selector must resolve to a single unique element. If a text node or label appears multiple times (e.g., in a header/banner and also in a footer), scope the locator to its parent container (e.g., page.getByRole('banner').getByText('ScoopDreams')) or use .first()/.last().
6. NESTED TEXT TARGETING: If a word is nested inside formatting tags (like <span> or <strong>) inside a parent element (like <h1>), page.getByText() will match both child and parent. Target it uniquely using a role locator (e.g., page.getByRole('heading', { name: /Magic/ })).
7. Preserve the original test structure and indentation perfectly.`;

  return `${systemPrompt}

You are a Senior QA Automation Engineer. Your job is to fix a failing Playwright test.
You must avoid "blind fixes" and "hallucinations". Base your fix ONLY on the provided code and DOM map.

Test File: ${fileName}
Failed near line: ${errorLine}
${classGuidance[errorClass]}
${retrySection}

━━━ VALIDATED LOCATOR MAP (MUST follow — overrides all other sources) ━━━
${locatorMapBlock || '(No HTML context available — use error message to infer the fix)'}

━━━ FULL DOM CONTEXT (HTML source) ━━━
\`\`\`html
${domContext.substring(0, 8000)}
\`\`\`

━━━ FAILING TEST BLOCK (exact text from file — this is what you must fix) ━━━
\`\`\`typescript
${failingBlock}
\`\`\`

━━━ FULL TEST FILE (for context only) ━━━
\`\`\`typescript
${fullTestContent}
\`\`\`

━━━ PLAYWRIGHT ERROR ━━━
${errorMsg}
${globalContext}

━━━ ANTI-HALLUCINATION RULES ━━━
1. NO INVENTING: Do NOT use any locator strategy or text that is not explicitly present in the VALIDATED LOCATOR MAP or the HTML source.
2. NO API FAKES: Do NOT use getByById(), getByAttribute(), or any non-existent Playwright methods.
3. DOM ALIGNMENT: Every locator you use must correspond to an actual tag in the provided HTML.
4. DEEP THINKING: If the test refers to an element that simply DOES NOT exist in the HTML, do not invent a replacement. Explain that the UI is missing the expected element.
5. PRESERVATION: Do not delete assertions unless the global clues clearly show the business logic has changed.
6. Preserve the original indentation exactly.

Respond in EXACTLY this format:
ANALYSIS:
(Step-by-step logic: 1. Identify the failing locator. 2. Locate the corresponding element in the HTML. 3. Determine if the bug is in the TEST or the APP SOURCE.)

EXPLANATION:
(First sentence: The deep root cause. Second sentence: How you fixed it.)

ROOT_CAUSE_LOCATION:
(Either "TEST_CODE" or "APP_SOURCE")

ORIGINAL BLOCK:
\`\`\`
(The exact snippet from the file that is broken. REQUIRED if ROOT_CAUSE_LOCATION is APP_SOURCE.)
\`\`\`

FIXED BLOCK:
\`\`\`typescript
(The complete fixed version of the ORIGINAL BLOCK. If TEST_CODE, this must be the 'test(...)' block.)
\`\`\`
`;
}

// ── Parse the FIXED BLOCK from AI response ───────────────────────────────────
// The AI now returns only a replacement block — we never ask it to reproduce
// original lines. This parser simply extracts the typescript code block that
// follows the "FIXED BLOCK:" marker (with several fallbacks).
function parseReplacement(suggestion: string): string | null {
  // Primary: look for the block after the "FIXED BLOCK:" marker
  const fixedBlockMatch = suggestion.match(
    /FIXED\s+BLOCK\s*:?\s*```(?:typescript|ts)?\s*\n([\s\S]*?)```/i
  );
  if (fixedBlockMatch?.[1]) {
    return trimEdges(fixedBlockMatch[1]);
  }

  // Fallback 1: any ```typescript block
  const tsBlocks = [...suggestion.matchAll(/```(?:typescript|ts)\s*\n([\s\S]*?)```/gi)];
  if (tsBlocks.length > 0) {
    // Prefer the last typescript block (most likely to be the fix, not the context)
    const last = tsBlocks[tsBlocks.length - 1]![1];
    if (last && last.trim()) return trimEdges(last);
  }

  // Fallback 2: any fenced code block at all
  const anyBlock = [...suggestion.matchAll(/```[a-z]*\s*\n([\s\S]*?)```/gi)];
  if (anyBlock.length > 0) {
    const last = anyBlock[anyBlock.length - 1]![1];
    if (last && last.trim()) return trimEdges(last);
  }

  return null;
}

function trimEdges(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === '') start++;
  let end = lines.length - 1;
  while (end >= start && lines[end]!.trim() === '') end--;
  return lines.slice(start, end + 1).join('\n');
}

// ── Main heal function ────────────────────────────────────────────────────────
export async function healTest(
  file: string,
  errorLine: number,
  errorMsg: string,
  interactive: boolean,
  previousFix?: string,
  verificationError?: string,
  originalContent?: string  // stable baseline — always diff against this
): Promise<any> {
  const config = loadConfig();
  const testContent = fs.readFileSync(file, 'utf8');

  const provider = process.env.AI_PROVIDER || config.ai?.provider || 'openai';
  const model = process.env[`${provider.toUpperCase()}_MODEL`] || config.ai?.model || 'default';

  let aiStatus: AiAttemptStatus = 'ai_parse_failed';
  let explanation = 'No explanation provided.';
  let originalString = '';
  let replacementString = '';
  let rootCauseLocation = 'TEST_CODE';

  const errorClass = classifyError(errorMsg);
  logger.step(`Classified error as: ${errorClass}`);

  // ── Extract DOM context ───────────────────────────────────────────────────
  let domContext = 'No DOM context found.';
  let locatorMapBlock = '';
  let htmlPath: string | undefined;

  // 1. Try to find an HTML path mentioned in the test (e.g., page.goto('...'))
  const htmlPathRegex = /['"`]([^'"`]+\.html)['"`]/;
  const htmlPathMatch = testContent.match(htmlPathRegex);

  if (htmlPathMatch) {
    const rawPath = htmlPathMatch[1]!;
    const testFileDir = path.dirname(file);
    
    // Try resolving relative to the test file (handles ../../ paths)
    let resolvedPath = path.resolve(testFileDir, rawPath);
    
    // If it's a file:// URL, strip the protocol
    if (rawPath.startsWith('file://')) {
      resolvedPath = fileURLToPath(rawPath);
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      htmlPath = resolvedPath;
    } else {
      // 🚀 ELASTIC DISCOVERY: Deep Workspace Search
      const fileName = path.basename(rawPath);
      logger.step(`File not at target. Commencing deep workspace search for "${fileName}"...`);
      
      const projectRoot = getProjectRoot();
      // Search from project root to prevent out-of-bounds traversal
      const searchRoot = projectRoot; 
      
      const searchOptions = {
        maxDepth: 5,
        exclude: ['node_modules', '.git', 'dist', 'build', '.next', '.playwright-browsers']
      };

      const deepSearch = (dir: string, depth: number): string | null => {
        if (depth > searchOptions.maxDepth) return null;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          // Check files in current dir first (fastest)
          for (const entry of entries) {
            if (!entry.isDirectory() && entry.name === fileName) {
              return path.join(dir, entry.name);
            }
          }
          // Then recurse into subdirs
          for (const entry of entries) {
            if (entry.isDirectory() && !searchOptions.exclude.includes(entry.name)) {
              const found = deepSearch(path.join(dir, entry.name), depth + 1);
              if (found) return found;
            }
          }
        } catch (e) { /* ignore permission errors */ }
        return null;
      };

      htmlPath = deepSearch(searchRoot, 0) || undefined;
    }

    if (htmlPath) {
      domContext = fs.readFileSync(htmlPath, 'utf8');
      const relativeDisplay = path.relative(getProjectRoot(), htmlPath);
      logger.success(`Elastic Discovery found target: ${relativeDisplay}`);
      const analysis = analyzeHtmlFile(htmlPath);
      if (analysis) {
        locatorMapBlock = analysis.promptBlock + 
          (analysis.semanticHints ? '\n' + analysis.semanticHints : '') +
          (analysis.ambiguityReport ? '\n' + analysis.ambiguityReport : '');
        logger.step(`Locator map built (${analysis.locators.length} interactive elements)`);
      }
    }
  }

  if (!htmlPath) {
    // Fallback to old smart mapping if no explicit HTML path was found
    const sourceMap = findSourceFileForElement(
      errorMsg,
      config.targetDir || 'tests/target-app',
      config.exclude
    );
    if (sourceMap) {
      htmlPath = sourceMap.filePath;
      domContext = sourceMap.snippet;
      logger.step(`Fallback DOM Context resolved: ${path.basename(htmlPath)}`);
      const analysis = analyzeHtmlFile(htmlPath);
      if (analysis) {
        locatorMapBlock = analysis.promptBlock + 
          (analysis.semanticHints ? '\n' + analysis.semanticHints : '') +
          (analysis.ambiguityReport ? '\n' + analysis.ambiguityReport : '');
      }
    }
  }

  // Use the stable baseline for AI prompting so diffs always target lines that exist
  const baseContent = originalContent ?? testContent;

  // ── Extract failing block (not entire file) ───────────────────────────────
  const failingBlock = extractFailingTestBlock(testContent, errorLine);

  // ── GLOBAL WORKSPACE SEARCH (The "Smart" part) ───────────────────────────
  let globalContext = '';
  if (errorClass === 'LOCATOR_NOT_FOUND' || errorClass === 'ASSERTION_MISMATCH') {
    // Extract the locator or value being queried
    const queryMatch = errorMsg.match(/getBy(?:Label|Placeholder|Text|Role|TestId)\(['"]([^'"]+)['"]/i) || 
                      errorMsg.match(/locator\(['"]([^'"]+)['"]\)/i);
    if (queryMatch && queryMatch[1]) {
      const query = queryMatch[1].replace(/^[#.]/, '');
      logger.step(`Searching entire codebase for clues about "${query}"...`);
      
      const projectRoot = getProjectRoot();
      const files = getAllFiles(projectRoot, config.exclude || ['node_modules', '.git', 'dist', 'build', '.playwright-browsers']);
      let findings: string[] = [];
      
      for (const f of files) {
        if (!f.match(/\.(html|jsx|tsx|vue|svelte|js|ts)$/)) continue;
        if (f === file) continue; // Skip current file

        try {
          const content = fs.readFileSync(f, 'utf8');
          if (content.includes(query)) {
            const lines = content.split('\n');
            const matchLine = lines.findIndex(l => l.includes(query));
            const snippet = lines.slice(Math.max(0, matchLine - 2), matchLine + 3).join('\n');
            findings.push(`File: ${path.relative(projectRoot, f)}\n\`\`\`${path.extname(f).slice(1)}\n${snippet}\n\`\`\``);
            if (findings.length >= 5) break; // Limit to 5 findings for token efficiency
          }
        } catch {}
      }
      if (findings.length > 0) {
        globalContext = `\n━━━ GLOBAL CLUES (Found in other files) ━━━\n${findings.join('\n\n')}\n`;
      }
    }
  }

  const prompt = buildPrompt({
    errorClass,
    fileName: path.basename(file),
    errorLine,
    errorMsg,
    failingBlock,
    fullTestContent: baseContent,
    domContext,
    locatorMapBlock,
    globalContext, // Pass the new global context
    ...(previousFix !== undefined ? { previousFix } : {}),
    ...(verificationError !== undefined ? { verificationError } : {}),
  });

  try {
    const suggestion = await askAI(prompt, config);

    // Parse ROOT_CAUSE_LOCATION
    const locationMatch = suggestion.match(/ROOT_CAUSE_LOCATION:\s*(TEST_CODE|APP_SOURCE)/i);
    rootCauseLocation = locationMatch?.[1] || 'TEST_CODE';

    // Parse ORIGINAL BLOCK (for APP_SOURCE)
    const originalBlockMatch = suggestion.match(/ORIGINAL\s+BLOCK\s*:?\s*```[a-z]*\s*\n([\s\S]*?)```/i);
    const aiOriginalBlock = originalBlockMatch?.[1] ? trimEdges(originalBlockMatch[1]) : '';

    // Parse explanation
    const explanationMatch = suggestion.match(/EXPLANATION:\s*([\s\S]*?)(?:\n```|\nFIXED|\nROOT|\nORIGINAL)/i);
    if (explanationMatch?.[1]) {
      explanation = explanationMatch[1].trim();
    } else {
      logger.warn('⚠️ AI response missing standard EXPLANATION block.');
      const fallback = suggestion.split(/FIXED\s+BLOCK/i)[0];
      if (fallback && fallback.trim().length > 0) {
        explanation = fallback.trim();
      }
    }

    const replacement = parseReplacement(suggestion);
    if (!replacement) {
      logger.error('AI did not return a valid FIXED BLOCK.');
      aiStatus = 'ai_parse_failed';
      logAttempt(file, errorLine, provider, model, prompt, suggestion, aiStatus, explanation);
      return false;
    }

    // 🚀 HALLUCINATION & BAD PRACTICE CHECK
    const forbiddenPatterns = [
      /getByById\s*\(/i, 
      /getByAttribute\s*\(/i, 
      /getByClass\s*\(/i, 
      /page\.pause\s*\(/i, 
      /page\.waitForTimeout\s*\(/i, 
      /page\.debug\s*\(/i
    ];
    if (forbiddenPatterns.some(p => p.test(replacement))) {
      logger.error('⚠️ Detected AI hallucination or bad practice (e.g., page.pause).');
      aiStatus = 'ai_parse_failed';
      verificationError = 'Your fix used a non-existent method or a forbidden practice like page.pause() or page.waitForTimeout().';
      logAttempt(file, errorLine, provider, model, prompt, suggestion, aiStatus, explanation);
      return false;
    }

    // Determine what we are replacing
    let targetFile = file;
    if (rootCauseLocation === 'APP_SOURCE' && htmlPath && aiOriginalBlock) {
      targetFile = htmlPath;
      originalString = aiOriginalBlock;
      replacementString = replacement;
      logger.step(chalk.yellow(`🛠️  App Healing Detected!`) + ` Root cause is in ${path.basename(targetFile)}`);
    } else {
      // Default: patching the test
      originalString = failingBlock;
      replacementString = replacement;
    }

    console.log(chalk.cyan(`  💡  Fix Strategy: `) + chalk.italic.dim(explanation));

    if (interactive) {
      logger.box(
        `Proposed ${rootCauseLocation === 'APP_SOURCE' ? 'APP SOURCE' : 'TEST'} Fix`,
        `EXPLANATION:\n${explanation}\n\nTARGET: ${path.relative(getProjectRoot(), targetFile)}\n\nDIFF:\n- ${originalString.substring(0, 200)}...\n+ ${replacementString.substring(0, 200)}...`
      );
      const approved = await confirm({
        message: `Apply this fix to ${path.basename(targetFile)}?`,
        default: true,
      });
      if (!approved) {
        logger.info('Healing cancelled by user.');
        return false;
      }
    }

    const originalTargetContent = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
    const success = patchFile(targetFile, originalString, replacementString, errorLine);
    aiStatus = success ? 'ai_healed' : 'patch_failed';
    logAttempt(targetFile, errorLine, provider, model, prompt, suggestion, aiStatus, explanation, originalString, replacementString);
    
    return {
      success,
      targetFile,
      originalTargetContent
    };
  } catch (e: any) {
    logger.error(`Healer error: ${e.message}`);
    logAttempt(file, errorLine, provider, model, prompt, '', 'ai_parse_failed', explanation);
    return { success: false };
  }
}

// ── Logging helpers ───────────────────────────────────────────────────────────
function logAttempt(
  file: string,
  line: number,
  provider: string,
  model: string,
  prompt: string,
  suggestion: string,
  status: AiAttemptStatus,
  explanation: string,
  originalCode = '',
  newCode = ''
) {
  const testName = path.basename(file);
  saveAiAttemptLog({
    timestamp: new Date().toISOString(),
    status,
    testName,
    file,
    line,
    attempt: 1,
    provider,
    model,
    prompt,
    rawResponse: suggestion,
    selectorBefore: originalCode,
    selectorAfter: newCode,
    explanation,
  });

  // Update HTML dashboard
  let existingRecords: HealRecord[] = [];
  const logPath = path.join(getProjectRoot(), 'autoheal-attempts.jsonl');
  if (fs.existsSync(logPath)) {
    try {
      const raw = fs.readFileSync(logPath, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim() !== '');
      existingRecords = lines.map(line => {
        const p = JSON.parse(line);
        return {
          testName: p.testName,
          file: p.file,
          line: p.line,
          oldSelector: p.selectorBefore || '',
          newSelector: p.selectorAfter || '',
          explanation: p.parseError ? `Error: ${p.parseError}` : (p.explanation || 'No explanation provided.'),
          status: p.status === 'ai_healed' || p.status === 'verify_passed' ? 'healed' : 'failed',
          timestamp: p.timestamp,
        };
      });
    } catch {}
  }
  saveReport(existingRecords);
}
