import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { logger } from './utils/logger.js';
import { getProjectRoot } from './utils/config-loader.js';
import { generateTestFromHTML } from './generator/test-generator.js';
import { runPlaywright } from './runner.js';
import { lastContentCache, hashContent } from './utils/watcher-cache.js';
import { getAllFiles } from './utils/source-mapper.js';

const directoryCache = new Map<string, { time: number; files: string[] }>();

function getCachedAllFiles(dir: string, excludes: string[]): string[] {
  const now = Date.now();
  const cached = directoryCache.get(dir);
  // Cache the directory tree for 5 seconds to prevent synchronous I/O thrashing during active typing/saving
  if (cached && now - cached.time < 5000) {
    return cached.files;
  }
  const files = getAllFiles(dir, excludes);
  directoryCache.set(dir, { time: now, files });
  return files;
}

/** Infer the corresponding spec file for a given HTML file */
function htmlToSpecPath(htmlPath: string, testsDir: string): string | null {
  const baseName = path.basename(htmlPath, path.extname(htmlPath));
  const targetSpecName = `${baseName}.spec.ts`;
  
  // Quick direct check first
  const directPath = path.join(testsDir, targetSpecName);
  if (fs.existsSync(directPath)) return directPath;
  
  // Recursive deep search using cache
  try {
    const allFiles = getCachedAllFiles(testsDir, ['node_modules', 'dist', '.playwright-browsers']);
    const match = allFiles.find(f => path.basename(f) === targetSpecName);
    return match || null;
  } catch (e) {
    return null;
  }
}

/** Debounced last-content cache — skip saves that didn't change anything */
function hasContentChanged(filePath: string): boolean {
  try {
    const current = fs.readFileSync(filePath, 'utf8');
    const currentHash = hashContent(current);
    const prevHash = lastContentCache.get(filePath);
    if (prevHash === currentHash) return false;
    lastContentCache.set(filePath, currentHash);
    return true;
  } catch {
    return true; // If we can't read, assume changed
  }
}

import { loadConfig } from './utils/config-loader.js';

export function startWatcher(dir: string, interactive: boolean, playwrightArgs: string[] = []) {
  const config = loadConfig();
  const targetDir = path.resolve(getProjectRoot(), dir);
  const testsDir = path.resolve(getProjectRoot(), config.generatedTestDir || 'tests');

  if (!fs.existsSync(targetDir)) {
    logger.error(`Watch directory not found: ${targetDir}`);
    return;
  }

  logger.info(`\nAutoHeal Watcher started in real-time mode`);
  logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.info(`Watching: ${path.relative(getProjectRoot(), targetDir)} & tests/`);
  logger.info(`Save any .html or .spec.ts file to trigger auto-heal\n`);

  const watcher = chokidar.watch([targetDir, testsDir], {
    ignored: /(^|[\/\\])\.|node_modules|dist|autoheal-report\.html/,
    persistent: true,
    ignoreInitial: true,
  });

  // ── Task queue ─────────────────────────────────────────────────────────
  let isRunning = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  const DEBOUNCE_MS = 600;
  const taskQueue: { filePath: string; type: 'html' | 'spec' | 'source' }[] = [];

  // Status tracking
  let lastFile = '';
  let lastStatus = '';
  let queueSize = 0;

  const printStatus = () => {
    if (lastFile) {
      logger.info(`[Watching] Last: ${lastFile} ${lastStatus} | Queue: ${queueSize}`);
    }
  };

  const processQueue = async () => {
    if (isRunning || taskQueue.length === 0) return;
    isRunning = true;
    queueSize = taskQueue.length;

    const task = taskQueue.shift()!;
    // De-duplicate: remove all remaining tasks for the same file, regardless of position
    for (let i = taskQueue.length - 1; i >= 0; i--) {
      if (taskQueue[i]?.filePath === task.filePath) {
        taskQueue.splice(i, 1);
      }
    }

    const shortName = path.basename(task.filePath);
    lastFile = shortName;
    lastStatus = '⏳';

    try {
      if (task.type === 'html') {
        // HTML file changed → re-generate its spec, then run ONLY that spec
        logger.info(`\nHTML changed: ${shortName}`);
        logger.info(`Regenerating spec...`);
        try {
          const specPath = await generateTestFromHTML(task.filePath);
          logger.success(`Spec updated: ${path.basename(specPath)}`);
          logger.info(`Running: ${path.basename(specPath)}`);
          await runPlaywright({
            interactive,
            playwrightArgs: [specPath, ...playwrightArgs],
            gitCommit: false,
          });
          lastStatus = '✅';
        } catch (err: any) {
          logger.error(`Generation failed: ${err.message}`);
          lastStatus = '❌';
        }
      } else if (task.type === 'spec') {
        // Spec file directly changed → run ONLY that spec
        logger.info(`\nSpec changed: ${shortName}`);
        logger.info(`Running: ${shortName}`);
        await runPlaywright({
          interactive,
          playwrightArgs: [task.filePath, ...playwrightArgs],
          gitCommit: false,
        });
        lastStatus = '✅';
      } else {
        // Non-HTML source (JS/TS component) changed →
        // find its corresponding spec if it has one, else run full suite
        logger.info(`\nSource changed: ${shortName}`);
        const correspondingSpec = htmlToSpecPath(task.filePath, testsDir);
        if (correspondingSpec) {
          logger.info(`Scoped to matching spec: ${path.basename(correspondingSpec)}`);
          await runPlaywright({
            interactive,
            playwrightArgs: [correspondingSpec, ...playwrightArgs],
            gitCommit: false,
          });
        } else {
          logger.info(`No matching spec found — running full suite`);
          await runPlaywright({ interactive, playwrightArgs, gitCommit: false });
        }
        lastStatus = '✅';
      }
    } catch (e: any) {
      logger.error(`Watcher task error: ${e.message}`);
      lastStatus = '❌';
    } finally {
      isRunning = false;
      queueSize = taskQueue.length;
      printStatus();
      logger.info(`\nWatching for changes...`);
      if (taskQueue.length > 0) setImmediate(processQueue);
    }
  };

  const queueTask = (filePath: string, type: 'html' | 'spec' | 'source') => {
    // Skip if content hasn't actually changed (e.g., editor auto-save)
    if (!hasContentChanged(filePath)) {
      // Intentionally omitting log to prevent console spam when Playwright or IDE touches files without modifying content
      return;
    }

    taskQueue.push({ filePath, type });
    queueSize = taskQueue.length;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processQueue, DEBOUNCE_MS);
  };

  const classifyFile = (filePath: string): 'html' | 'spec' | 'source' | null => {
    if (filePath.endsWith('.spec.ts')) return 'spec';
    if (filePath.endsWith('.html')) return 'html';
    if (filePath.match(/\.(jsx|tsx|vue|svelte|js|ts)$/)) return 'source';
    return null;
  };

  watcher
    .on('change', (filePath) => {
      const type = classifyFile(filePath);
      if (type) queueTask(filePath, type);
    })
    .on('add', (filePath) => {
      const type = classifyFile(filePath);
      if (type) queueTask(filePath, type);
    })
    .on('error', (error) => logger.error(`Watcher error: ${error}`));
}
