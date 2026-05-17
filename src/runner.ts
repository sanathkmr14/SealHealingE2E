import fs from 'fs';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { healTest } from './healer.js';
import { logger } from './utils/logger.js';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { updateWatcherCache } from './utils/watcher-cache.js';
import { getProjectRoot, loadConfig } from './utils/config-loader.js';
import { Project, Node } from 'ts-morph';

// ── Spec file discovery ───────────────────────────────────────────────────────
function getSpecFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      files.push(...getSpecFiles(res));
    } else if (entry.name.endsWith('.spec.ts')) {
      files.push(res);
    }
  }
  return files;
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function runPlaywright(options: {
  interactive: boolean;
  playwrightArgs: string[];
  gitCommit?: boolean;
}) {
  const isGit = isInsideGitRepo();
  let healBranch = '';

  // Skip internal auto-branching in CI environments (let GitHub Actions handle commits)
  if (isGit && options.gitCommit !== false && !process.env.CI) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      healBranch = `autoheal/fix-${timestamp}`;
      logger.info(`🌿 Creating review branch: ${healBranch}`);
      execSync(`git checkout -b ${healBranch}`, { stdio: 'ignore' });
    } catch { /* branch creation not critical */ }
  }
  
  // Clear previous session logs so the report is fresh
  const projectRoot = getProjectRoot();
  const attemptsLog = path.join(projectRoot, 'autoheal-attempts.jsonl');
  if (fs.existsSync(attemptsLog)) {
    try { fs.writeFileSync(attemptsLog, '', 'utf8'); } catch {}
  }

  logger.info(`🚀 Starting AutoHeal Execution Loop...`);
  const allPassed = await loop(options.interactive, options.playwrightArgs);

  if (allPassed && healBranch && options.gitCommit !== false && !process.env.CI) {
    try {
      execSync('git add .', { stdio: 'ignore' });
      execSync('git commit -m "AutoHeal: E2E tests fixed autonomously"', { stdio: 'ignore' });
      execSync(`git push origin ${healBranch}`, { stdio: 'ignore' });
      logger.success(`📤 Pushed healed branch → origin/${healBranch}`);
    } catch { /* push failure is non-critical */ }
  }
}

// ── Main execution loop ───────────────────────────────────────────────────────
async function loop(interactive: boolean, args: string[]): Promise<boolean> {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  let specFiles: string[] = [];

  // 1. Explicit files from args
  const explicitFiles = args.filter(arg => arg.endsWith('.spec.ts') || arg.endsWith('.spec.js'));
  if (explicitFiles.length > 0) {
    specFiles.push(...explicitFiles.map(f => path.resolve(process.cwd(), f)).filter(f => fs.existsSync(f)));
  } else {
    // 2. Local tests directory (only if no explicit files)
    const testsDir = path.resolve(projectRoot, config.generatedTestDir || 'tests');
    if (fs.existsSync(testsDir)) {
      specFiles.push(...getSpecFiles(testsDir));
    }

    // 3. 🚀 ELASTIC TEST DISCOVERY: Scan project to find all relevant tests
    const searchRoot = projectRoot; 
    const deepSearchTests = (dir: string, depth = 0): string[] => {
      if (depth > 3) return [];
      const results: string[] = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (['node_modules', '.git', 'dist', 'build', 'SelfHealingE2E'].includes(entry.name)) continue;
            results.push(...deepSearchTests(fullPath, depth + 1));
          } else if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.js')) {
            results.push(fullPath);
          }
        }
      } catch (e) {}
      return results;
    };
    
    // Deduplicate files by their absolute path
    const discovered = deepSearchTests(searchRoot);
    specFiles = Array.from(new Set([...specFiles, ...discovered]));
  }

  if (specFiles.length === 0) {
    logger.error('No spec files found anywhere in the accessible workspace.');
    return false;
  }

  logger.step(`Discovered ${specFiles.length} test suite(s). Commencing execution...`);

  let allHealed = true;
  for (let i = 0; i < specFiles.length; i++) {
    const file = specFiles[i]!;
    const shortName = path.basename(file);
    
    // Run the file to see if it needs healing
    const spinner = ora({
      text: chalk.hex('#60A5FA')(`[${i + 1}/${specFiles.length}] Testing ${shortName}...`),
      spinner: 'dots',
      color: 'blue',
    }).start();

    const { exitCode, jsonReport } = await runSpecFile(file, args);
    spinner.stop();
    printTestResultsSync(shortName, jsonReport);

    if (exitCode !== 0) {
      const badge = chalk.bgHex('#7F1D1D').hex('#FECACA').bold(' NEEDS HEALING ');
      console.log(`\n  ${badge}  ${chalk.hex('#FCA5A5')(shortName)}\n`);
      const healed = await healFile(file, args, interactive, jsonReport);
      if (!healed) allHealed = false;
    } else {
      const badge = chalk.bgHex('#065F46').hex('#A7F3D0').bold(' PASSED ');
      console.log(`  ${badge}         ${chalk.hex('#34D399')(`${shortName} passed successfully.`)}\n`);
    }
  }

  if (allHealed) {
    const badge = chalk.bgHex('#065F46').hex('#A7F3D0').bold(' SUCCESS ');
    console.log(`\n  ${badge}  ${chalk.hex('#34D399')('All test files passed! Suite is fully green.')}\n`);
  } else {
    const badge = chalk.bgHex('#7F1D1D').hex('#FECACA').bold(' FAILED ');
    console.log(`\n  ${badge}  ${chalk.hex('#FCA5A5')('Some files could not be fully healed. See autoheal-report.html for details.')}\n`);
  }

  return allHealed;
}

// ── Heal a single spec file (all failing tests in it) ────────────────────────
async function healFile(
  file: string,
  args: string[],
  interactive: boolean,
  initialReport?: any
): Promise<boolean> {
  const shortName = path.basename(file);
  const MAX_FILE_ROUNDS = 5; // max full-file re-run rounds
  let fileRound = 0;
  let jsonReport: any = initialReport;
  let exitCode: number = initialReport ? 1 : (initialReport === null ? 1 : 0); // treat initial report as failing

  while (fileRound < MAX_FILE_ROUNDS) {
    fileRound++;

    if (fileRound > 1) {
      // Re-run to get fresh errors after the previous heal attempt
      const healBadge = chalk.bgHex('#065F46').hex('#A7F3D0').bold(' VERIFYING ');
      console.log(`\n  ${healBadge}  ${chalk.hex('#34D399')(shortName)} running full suite to verify fixes...`);

      const preRunSpinner = ora({
        text: chalk.blue(`  🧪 Running ${shortName} to collect failures for AI (round ${fileRound})...`),
        spinner: 'dots',
        color: 'blue'
      }).start();
      const result = await runSpecFile(file, args);
      preRunSpinner.stop();
      exitCode = result.exitCode;
      jsonReport = result.jsonReport;
      printTestResultsSync(shortName, jsonReport);
    }

    if (exitCode === 0) {
      logger.success(`${shortName} fully healed after ${fileRound} round(s).`);
      return true;
    }

    const allErrors = extractTestErrors(jsonReport);
    if (allErrors.length === 0) {
      logger.error(`${shortName}: Playwright failed but no errors found in report.`);
      return false;
    }

    console.log('');
    const uniqueFailingTestCount = new Set(allErrors.map(e => e.testTitle || 'unknown')).size;
    logger.step(`Initiating AI repair sequence for ${uniqueFailingTestCount} failing test(s) in ${shortName}...`);

    // Save original to allow full reverts
    const originalContent = fs.readFileSync(file, 'utf8');
    let anyHealedThisRound = false;

    // Heal each unique failing test (by title) in this round
    const seenTitles = new Set<string>();
    for (const err of allErrors) {
      const title = err.testTitle || 'unknown';
      if (seenTitles.has(title)) continue;

      const errorMsg = err.stack || err.message || '';
      const stackLoc = extractLocationFromStack(errorMsg);
      let errorFile = err.location?.file || stackLoc.file || file;
      let errorLine = err.location?.line || stackLoc.line || 0;

      // Fallback: if Playwright omits the location (e.g., timeout), locate the test by title
      if (!errorLine && title && title !== 'unknown' && errorFile === file) {
        const lines = originalContent.split('\n');
        const titleIndex = lines.findIndex(l => l.includes(title));
        if (titleIndex !== -1) {
          errorLine = titleIndex + 1;
        }
      }

      if (!errorLine) {
        continue; // Don't mark as seen, wait for another error for this test that might have the line
      }

      seenTitles.add(title);

      console.log(chalk.hex('#EF4444')(`  ✕  `) + chalk.hex('#FCA5A5')(`"${title}"`) + chalk.hex('#9CA3AF')(` — line ${errorLine} in ${path.basename(errorFile)}`));

      // Read the original content of the file where the error actually happened (might be a POM)
      let originalErrorFileContent = originalContent;
      try {
        if (errorFile && fs.existsSync(errorFile)) {
          originalErrorFileContent = fs.readFileSync(errorFile, 'utf8');
        } else {
          errorFile = file; // Fallback to spec file
        }
      } catch (e) {
        errorFile = file;
      }

      const healed = await healWithRetries(
        file, errorFile, errorLine, errorMsg, title, interactive, args, originalErrorFileContent
      );
      if (healed) {
        anyHealedThisRound = true;
        logger.success(`Test "${title}" healed`);
        // CRITICAL: Break after one success to prevent line-number shift bugs on subsequent tests in the same file.
        // The outer while(fileRound) loop will re-run the file to get fresh line numbers for remaining failures.
        break; 
      } else {
        logger.error(`Test "${title}" could not be healed`);
      }
    }

    if (!anyHealedThisRound) {
      logger.error(`${shortName}: No progress made in round ${fileRound}. Stopping.`);
      // Restore original to leave the file in a known state
      fs.writeFileSync(file, originalContent, 'utf8');
      updateWatcherCache(file, originalContent);
      return false;
    }
  }

  logger.error(`${shortName}: Exceeded ${MAX_FILE_ROUNDS} healing rounds.`);
  return false;
}

// ── Retry healing a single test with exponential backoff ─────────────────────
async function healWithRetries(
  specFile: string,
  errorFile: string,
  errorLine: number,
  errorMsg: string,
  testTitle: string,
  interactive: boolean,
  args: string[],
  originalContent: string
): Promise<boolean> {
  const MAX_RETRIES = 3;
  // previousFix holds the PATCHED content that failed verification,
  // so the AI knows what it tried before. Always diffed against originalContent.
  let previousFix: string | undefined;
  let verificationError: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const delayMs = Math.pow(2, attempt - 1) * 1500; // 1.5s, 3s, 6s
      const delaySec = Math.round(delayMs / 1000);
      const waitSpinner = ora({
        text: chalk.dim(`  ⏳ Retry ${attempt}/${MAX_RETRIES} — waiting ${delaySec}s before next attempt...`),
        spinner: 'clock',
        color: 'gray',
      }).start();
      await new Promise(r => setTimeout(r, delayMs));
      waitSpinner.stop();
    }

    const aiSpinner = ora({
      text: chalk.magenta(`  🤖 [${attempt}/${MAX_RETRIES}] AI analyzing "${testTitle.substring(0, 45)}"...`),
      spinner: 'dots2',
      color: 'magenta',
    }).start();

    // Tick elapsed time every second so the user sees it's thinking
    let elapsed = 0;
    const ticker = setInterval(() => {
      elapsed++;
      aiSpinner.text = chalk.magenta(
        `  🤖 [${attempt}/${MAX_RETRIES}] AI analyzing "${testTitle.substring(0, 40)}"... ${elapsed}s`
      );
    }, 1000);

    /**
     * PROMPT GUIDELINES:
     * 1. NEVER use waitForTimeout() for transient states.
     * 2. ALWAYS use expect(locator).toHaveText() or similar to synchronize.
     * 3. Prefer stable ID locators over text-based ones.
     */
    const healResult = await healTest(
      errorFile, errorLine, errorMsg, interactive, previousFix, verificationError, originalContent
    );

    clearInterval(ticker);
    aiSpinner.stop();

    if (healResult === false || !healResult || !healResult.success) {
      logger.error(`  Patch generation failed on attempt ${attempt}.`);
      verificationError = 'AI could not generate a valid patch or user cancelled.';
      continue;
    }

    const { targetFile, originalTargetContent } = healResult;

    // Capture the patched test block BEFORE verifying — this is what we show
    // the AI as "previousFix" (your last replacement) on the next retry attempt.
    const patchedContent = fs.readFileSync(targetFile, 'utf8');
    const patchedTestBlock = targetFile.endsWith('.html') ? patchedContent : extractTestBlock(patchedContent, errorLine);

    // Verify: run only the specific test that was just fixed
    const verifySpinner = ora(`  🔍 Verifying fix (attempt ${attempt})...`).start();
    // Filter out visual flags to ensure verification runs headlessly (fixes macOS SIGTRAP)
    const headlessArgs = args.filter(a => a !== '--headed' && a !== '-h');
    const verifyArgs = buildVerifyArgs(specFile, testTitle, headlessArgs);
    const { exitCode: verifyExit, jsonReport: verifyReport } = await spawnPlaywright(verifyArgs);
    verifySpinner.stop();

    if (verifyExit === 0) {
      return true;
    }

    logger.error(`Verification failed (attempt ${attempt}). Reverting...`);
    // Store just the patched test block so the AI sees what its replacement was
    previousFix = patchedTestBlock;
    // Revert the file so the next attempt starts clean from the original
    fs.writeFileSync(targetFile, originalTargetContent, 'utf8');
    updateWatcherCache(targetFile, originalTargetContent);

    const verifyErrors = extractTestErrors(verifyReport);
    verificationError =
      verifyErrors[0]
        ? verifyErrors[0].stack || verifyErrors[0].message || 'Unknown verification error'
        : 'Test failed without explicit error message.';
  }

  // All attempts exhausted — restore original
  fs.writeFileSync(errorFile, originalContent, 'utf8');
  updateWatcherCache(errorFile, originalContent);
  return false;
}

// ── Extract the test block surrounding errorLine from content ─────────────────
// Mirrors healer.ts's extractFailingTestBlock. Used to capture the patched test
// block (not the whole file) for previousFix context on retries.
function extractTestBlock(content: string, errorLine: number): string {
  try {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile('temp.ts', content);

    const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(errorLine - 1, 0);
    const descendant = sourceFile.getDescendantAtPos(pos);
    
    if (descendant) {
      const testBlock = descendant.getFirstAncestor(node => {
        if (Node.isCallExpression(node)) {
          const exp = node.getExpression().getText();
          if (exp.includes('test.step')) return false; // Ignore test.step to get full test scope
          if (exp.includes('test') || exp.includes('describe') || exp.includes('it')) return true;
        }
        if (Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node)) return true;
        return false;
      });

      if (testBlock) return testBlock.getText();
    }
  } catch (e) {}

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
    if (depth <= 0 && i >= errorLine - 1) { end = i; break; }
  }
  return lines.slice(start, end + 1).join('\n');
}

// ── Build verify args: run the specific failing test by title ─────────────────
function buildVerifyArgs(file: string, testTitle: string, baseArgs: string[]): string[] {
  const verifyArgs = [
    file, 
    ...baseArgs.filter(a => !a.endsWith('.spec.ts')),
    '--retries=0', // Enforce isolation: never retry during verification
    '--workers=1' // Enforce isolation: prevent parallel execution chaos
  ];
  if (testTitle && testTitle !== 'unknown') {
    verifyArgs.push('-g', testTitle);
  }
  return verifyArgs;
}

// ── Playwright spawn wrapper ───────────────────────────────────────────────────
function runSpecFile(
  file: string,
  args: string[]
): Promise<{ exitCode: number; jsonReport: any }> {
  const pwArgs = [
    file, 
    ...args.filter(a => !a.endsWith('.spec.ts')),
    '--retries=0', // Disable retries for raw test detection
    '--workers=1'
  ];
  if (!pwArgs.some(a => a.startsWith('--reporter'))) {
    pwArgs.push('--reporter=line,json');
  }
  return spawnPlaywright(pwArgs);
}

function spawnPlaywright(args: string[]): Promise<{ exitCode: number; jsonReport: any }> {
  return new Promise((resolve) => {
    const projectRoot = getProjectRoot();
    const tempReportPath = path.resolve(projectRoot, `temp_report_${Date.now()}_${Math.floor(Math.random() * 10000)}.json`);
    
    const env = { 
      ...process.env, 
      PLAYWRIGHT_JSON_OUTPUT_NAME: tempReportPath
    };

    const pwBin = process.platform === 'win32' ? 'playwright.cmd' : 'playwright';
    const pwPath = path.resolve(projectRoot, 'node_modules', '.bin', pwBin);

    // Filter args to remove conflicting reporters and traces
    const cleanArgs = args.filter(a => !a.startsWith('--reporter') && !a.includes('trace'));
    
    const child = spawn(pwPath, ['test', '--reporter=json', ...cleanArgs], {
      stdio: 'pipe',
      env,
      detached: true // Spawn detached so we can kill the whole process group
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // Timeout after 5 minutes to prevent hanging (Bug #2)
    const timeoutId = setTimeout(() => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { child.kill('SIGTERM'); }
      } else {
        child.kill('SIGTERM');
      }
      logger.warn(`⏱️  Playwright timeout - no response within 5 minutes`);
      resolve({ exitCode: 124, jsonReport: { errors: [{ message: 'Process timeout' }] } });
    }, 300000);

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    child.on('close', (exitCode) => {
      cleanup();
      let jsonReport = null;
      try {
        if (fs.existsSync(tempReportPath)) {
          const reportContent = fs.readFileSync(tempReportPath, 'utf-8');
          jsonReport = JSON.parse(reportContent);
          fs.unlinkSync(tempReportPath);
        }
      } catch (e) {
        logger.error(`Failed to parse Playwright JSON file: ${e}`);
      }
      resolve({ exitCode: exitCode ?? 1, jsonReport });
    });

    // CRITICAL: Add error handler to prevent promise from hanging (Bug #1)
    child.on('error', err => {
      cleanup();
      logger.error(`❌ Failed to spawn Playwright: ${err.message}`);
      resolve({ exitCode: 1, jsonReport: { errors: [{ message: `Failed to spawn process: ${err.message}` }] } });
    });
  });
}

// ── Result display ─────────────────────────────────────────────────────
// Synchronous so it can safely be called from inside a Promise.all callback
function printTestResultsSync(shortName: string, jsonReport: any) {
  if (!jsonReport) {
    const headerColor = chalk.hex('#EF4444');
    const borderCol = chalk.hex('#374151'); 
    console.log(borderCol(`\n  ╭────────────────────────────────────────────────────────────────────────╮`));
    console.log(borderCol(`  │`) + headerColor.bold(` ERROR: ${shortName.padEnd(64)} `) + borderCol(`│`));
    console.log(borderCol(`  ├────────────────────────────────────────────────────────────────────────┤`));
    console.log(borderCol(`  │ `) + chalk.hex('#FCA5A5')('Test runner failed to generate a report. Possible browser crash.') + borderCol(' '.repeat(10)) + borderCol(` │`));
    console.log(borderCol(`  ╰────────────────────────────────────────────────────────────────────────╯\n`));
    return;
  }

  const stats = extractTestStats(jsonReport);
  if (stats.total === 0) {
    logger.info(`ℹ️  No tests found in ${shortName}`);
    return;
  }
  const failedCount = stats.tests.filter(t => t.status === 'failed').length;

  const headerColor = failedCount === 0 ? chalk.hex('#10B981') : chalk.hex('#EF4444');
  const borderCol = chalk.hex('#374151'); 
  
  console.log(borderCol(`\n  ╭────────────────────────────────────────────────────────────────────────╮`));
  console.log(borderCol(`  │`) + headerColor.bold(` RESULTS: ${shortName.padEnd(62)} `) + borderCol(`│`));
  console.log(borderCol(`  ├────────────────────────────────────────────────────────────────────────┤`));
  
  stats.tests.forEach((t: any) => {
    let icon, nameColor;
    if (t.status === 'passed') {
      icon = chalk.bgHex('#065F46').hex('#A7F3D0').bold(' PASS ');
      nameColor = chalk.hex('#D1D5DB');
    } else if (t.status === 'failed') {
      icon = chalk.bgHex('#991B1B').hex('#FECACA').bold(' FAIL ');
      nameColor = chalk.bold.hex('#FCA5A5');
    } else {
      icon = chalk.bgHex('#92400E').hex('#FDE68A').bold(' SKIP ');
      nameColor = chalk.hex('#9CA3AF');
    }
    
    // Total inside width is 72
    // ' PASS ' (6) + ' ' (1) + title (48) + ' ' (1) + projectText (15) + ' ' (1) = 72
    const titleWidth = 48;
    const titleStr = t.title.length > titleWidth 
      ? t.title.substring(0, titleWidth - 3) + '...' 
      : t.title.padEnd(titleWidth);
      
    const projectText = `[${t.project}]`.padEnd(15);
    
    console.log(borderCol(`  │ `) + icon + ` ` + nameColor(titleStr) + ` ` + chalk.hex('#6B7280')(projectText) + borderCol(` │`));
  });
  
  console.log(borderCol(`  ╰────────────────────────────────────────────────────────────────────────╯\n`));
}

// ── JSON report extraction helpers ───────────────────────────────────────────
function extractTestStats(report: any): { total: number; tests: any[] } {
  const stats = { total: 0, tests: [] as any[] };
  
  // Guard against null/undefined report
  if (!report || typeof report !== 'object') {
    return stats;
  }
  
  if (!report.suites || !Array.isArray(report.suites)) {
    return stats;
  }

  const traverse = (suites: any[], projectName = '') => {
    for (const suite of suites) {
      if (!suite || typeof suite !== 'object') continue;
      
      const currentProject = suite.project ? suite.title : projectName;
      
      if (Array.isArray(suite.specs)) {
        for (const spec of suite.specs) {
          if (!spec || !Array.isArray(spec.tests)) continue;
          
          for (const test of spec.tests) {
            if (!test) continue;
            
            stats.total++;
            const passed = test.results?.some((r: any) => r?.status === 'passed');
            const failed = test.results?.some((r: any) => r?.status === 'failed' || r?.status === 'timedOut');
            
            stats.tests.push({
              title: spec.title || 'Unknown',
              project: currentProject || test.projectName || 'default',
              status: passed ? 'passed' : failed ? 'failed' : 'skipped',
            });
          }
        }
      }
      
      if (Array.isArray(suite.suites)) {
        traverse(suite.suites, currentProject);
      }
    }
  };
  traverse(report.suites);
  return stats;
}

function extractTestErrors(report: any): any[] {
  const errors: any[] = [];
  if (report?.errors) errors.push(...report.errors);
  if (!report?.suites) return errors;

  const traverse = (suites: any[]) => {
    for (const suite of suites) {
      if (suite.specs) {
        for (const spec of suite.specs) {
          if (spec.tests) {
            for (const test of spec.tests) {
              if (test.results) {
                for (const result of test.results) {
                  if ((result.status === 'failed' || result.status === 'timedOut') && result.errors) {
                    const sorted = [...result.errors].sort((a, b) => {
                      if (a.location && !b.location) return -1;
                      if (!a.location && b.location) return 1;
                      return 0;
                    });
                    sorted.forEach(e => (e.testTitle = spec.title));
                    errors.push(...sorted);
                  }
                }
              }
            }
          }
        }
      }
      if (suite.suites) traverse(suite.suites);
    }
  };
  traverse(report.suites);
  return errors;
}

function extractLocationFromStack(errorMsg: string): { file: string | null; line: number } {
  // Try to match standard Playwright stack traces: `at /Users/.../my-test.spec.ts:12:34`
  const lines = errorMsg.split('\n');
  for (const line of lines) {
    if (line.includes('at ')) {
      // Don't match internal Playwright code or node_modules
      if (line.includes('playwright/test') || line.includes('node_modules')) continue;
      
      const match = line.match(/(?:at|file:\/\/)?[ \t]*([a-zA-Z0-9_\-\/\.\\]+\.[jt]sx?):(\d+):\d+/i);
      if (match && match[1] && match[2]) {
        return { file: match[1], line: parseInt(match[2], 10) };
      }
    }
  }

  // Fallback to old simple match
  const fileMatch = errorMsg.match(/([a-zA-Z0-9_\-\/]+\.[jt]s):(\d+):\d+/);
  if (fileMatch) {
    return { file: fileMatch[1] || null, line: parseInt(fileMatch[2]!, 10) };
  }

  const lineOnlyMatch = errorMsg.match(/:(\d+):\d+/);
  if (lineOnlyMatch) {
    return { file: null, line: parseInt(lineOnlyMatch[1]!, 10) };
  }

  return { file: null, line: 0 };
}

function isInsideGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
