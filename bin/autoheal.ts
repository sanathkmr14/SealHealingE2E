#!/usr/bin/env node
import { Command } from 'commander';
import { runPlaywright } from '../src/runner.js';
import { generateTestFromHTML } from '../src/generator/test-generator.js';
import { logger } from '../src/utils/logger.js';
import { ensureConfig } from '../src/utils/configurator.js';
import { loadConfig } from '../src/utils/config-loader.js';
import { startWatcher } from '../src/watcher.js';
import ora from 'ora';
import fs from 'fs';
import path from 'path';

import chalk from 'chalk';

process.on('SIGINT', () => {
  console.log(chalk.yellow('\nReceived SIGINT. Gracefully shutting down...'));
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

const program = new Command();
const config = loadConfig();

function showBanner() {
  const bannerText = `
   █████╗ ██╗   ██╗████████╗ ██████╗ ██╗  ██╗███████╗ █████╗ ██╗     
  ██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗██║  ██║██╔════╝██╔══██╗██║     
  ███████║██║   ██║   ██║   ██║   ██║███████║█████╗  ███████║██║     
  ██╔══██║██║   ██║   ██║   ██║   ██║██╔══██║██╔══╝  ██╔══██║██║     
  ██║  ██║╚██████╔╝   ██║   ╚██████╔╝██║  ██║███████╗██║  ██║███████╗
  ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝
      A U T O N O M O U S   S E L F - H E A L I N G   E 2 E
`;
  console.log(chalk.cyan.bold(bannerText));
}

program
  .name('autoheal')
  .description('Autonomous Self-Healing E2E Test Generator')
  .version('1.0.0');

program
  .command('init')
  .description('Interactively configure your AI Provider and API Keys')
  .action(async () => {
    showBanner();
    await ensureConfig(true);
  });

program
  .command('test [playwrightArgs...]')
  .description('Run Playwright tests with AutoHeal watching for failures')
  .option('-i, --interactive', 'Interactively review and approve each fix before patching')
  .option('--headed', 'Run tests in headed mode (visible browser)', false)
  .option('--slow-mo <ms>', 'Slow down Playwright actions by specified milliseconds', '0')
  .action(async (playwrightArgs: string[], options: { interactive: boolean; headed: boolean; slowMo: string }) => {
    showBanner();
    await ensureConfig();

    const provider = process.env.AI_PROVIDER || config.ai?.provider || 'openai';
    const keyName = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : `${provider.toUpperCase()}_API_KEY`;
    if (!process.env[keyName]) {
      logger.error(`\nMissing API Key: ${keyName} is not set in your environment or .env file.`);
      logger.info(`Run 'npx autoheal init' to configure your keys.\n`);
      return;
    }

    const providerName = provider.toUpperCase();
    const modelName = process.env[`${providerName}_MODEL`] || 'default';
    logger.info(`Engine: \x1b[33m${providerName}\x1b[0m (\x1b[32m${modelName}\x1b[0m)`);
    
    if (options.headed || config.visual) {
      process.env.VISUAL = 'true';
      if (options.slowMo === '0') {
        process.env.PW_SLOWMO = '500';
      }
    }

    if (options.slowMo !== '0') {
      process.env.PW_SLOWMO = options.slowMo;
    }

    // Let Playwright use its default projects configured in playwright.config.ts
    // Removed forced chromium.

    logger.info('Starting AutoHeal wrapper for Playwright...');
    await runPlaywright({ interactive: options.interactive, playwrightArgs, gitCommit: true });
  });

program
  .command('generate <target>')
  .description('Auto-generate Playwright test from a local HTML file or Live URL')
  .action(async (target: string) => {
    showBanner();
    await ensureConfig();

    const provider = process.env.AI_PROVIDER || config.ai?.provider || 'openai';
    const keyName = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : `${provider.toUpperCase()}_API_KEY`;
    if (!process.env[keyName]) {
      logger.error(`\nMissing API Key: ${keyName} is not set in your environment or .env file.`);
      logger.info(`Run 'npx autoheal init' to configure your keys.\n`);
      return;
    }
    
    const isUrl = target.startsWith('http://') || target.startsWith('https://');

    if (!isUrl) {
      if (!fs.existsSync(target)) {
        logger.error(`\nFile not found: ${target}`);
        return;
      }

      if (fs.statSync(target).isDirectory()) {
        logger.error(`\nGeneration failed: Path '${target}' is a directory.`);
        logger.info(`To generate tests for all files in a directory, use the 'generate-all' command:`);
        logger.info(`   npx autoheal generate-all -d ${target}\n`);
        return;
      }
    }

    logger.info(`\nAI Test Generator`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(isUrl ? `Target URL: ${target}` : `Reading: ${target}`);

    const providerName = (process.env.AI_PROVIDER || 'gemini').toUpperCase();
    const modelName = process.env[`${providerName}_MODEL`] || 'default';
    logger.info(`Using: ${providerName} (${modelName})`);
    
    const spinner = ora('Generating test file using AI...').start();

    try {
      const outputPath = await generateTestFromHTML(target);
      spinner.succeed('Test file generated successfully!');
      const content = fs.readFileSync(outputPath, 'utf-8');
      const lineCount = content.split('\n').length;
      
      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`Output: ${outputPath}`);
      logger.info(`Lines: ${lineCount}`);
      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      logger.info(`Preview:\n`);
      console.log(content);
      logger.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.success(`Run 'npx autoheal test' to execute your new test!`);
    } catch (e: any) {
      spinner.fail(`Generation failed: ${e.message}`);
    }
  });

function getFilesRecursive(dir: string, excludes: string[] = []): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name);
    
    // Check if path matches any exclusion pattern
    const isExcluded = excludes.some(pattern => {
      const normalizedPath = res.replace(/\\/g, '/');
      const cleanPattern = pattern.replace(/\*\*\//g, '').replace(/^\/|\/$/g, '');
      return normalizedPath.includes(cleanPattern);
    });
    
    if (isExcluded) continue;

    if (entry.isDirectory()) {
      files.push(...getFilesRecursive(res, excludes));
    } else if (entry.name.endsWith('.html')) {
      files.push(res);
    }
  }
  return files;
}

program
  .command('generate-all')
  .description('Auto-generate Playwright tests for ALL HTML files in target-app/')
  .option('-d, --dir <directory>', 'Target directory to search for HTML files', config.targetDir || 'tests/target-app')
  .action(async (options: { dir: string }) => {
    showBanner();
    await ensureConfig();
    
    const targetDir = path.resolve(process.cwd(), options.dir);
    if (!fs.existsSync(targetDir)) {
      logger.error(`Directory not found: ${targetDir}`);
      return;
    }

    const htmlFiles = getFilesRecursive(targetDir, config.exclude || []);
    logger.info(`\nAI Test Generator — Batch Mode`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`Found ${htmlFiles.length} HTML files in ${path.relative(process.cwd(), targetDir)}/ (recursive)\n`);

    let generated = 0;
    for (let i = 0; i < htmlFiles.length; i++) {
      const htmlPath = htmlFiles[i];
      if (!htmlPath) continue;
      const relativePath = path.relative(targetDir, htmlPath);
      const spinner = ora(`[${i + 1}/${htmlFiles.length}] Generating test for ${relativePath}...`).start();
      try {
        const { generateTestFromHTML } = await import('../src/generator/test-generator.js');
        const outputPath = await generateTestFromHTML(htmlPath);
        spinner.succeed(`Generated: ${path.basename(outputPath)}`);
        generated++;
      } catch (e: any) {
        spinner.fail(`Failed (${relativePath}): ${e.message}`);
      }

      // Add a delay between API calls to avoid rate-limiting on free providers
      if (i < htmlFiles.length - 1) {
          logger.info(`Waiting 10 seconds to respect API rate limits...`);
          await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    logger.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.success(`Generated ${generated}/${htmlFiles.length} test files!`);
    logger.success(`Run 'npx autoheal test' to execute them all!`);
  });

program
  .command('flow <htmlPaths...>')
  .description('Generate a single E2E flow test covering multiple pages (e.g. login dashboard profile)')
  .action(async (htmlPaths: string[]) => {
    showBanner();
    await ensureConfig();

    logger.info(`\nAI Flow Generator — Multi-Page Journey`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    logger.info(`Pages: ${htmlPaths.join(' → ')}\n`);

    const providerName = (process.env.AI_PROVIDER || 'gemini').toUpperCase();
    const modelName = process.env[`${providerName}_MODEL`] || 'default';
    logger.info(`Using: ${providerName} (${modelName})`);
    const spinner = ora('Knitting pages into a single journey...').start();

    try {
      const { generateFlowTest } = await import('../src/generator/test-generator.js');
      const outputPath = await generateFlowTest(htmlPaths);
      spinner.succeed('Flow test generated successfully!');
      logger.info(`\nOutput: ${outputPath}`);
      logger.info(`Run 'npx autoheal test' to execute your new multi-page journey!`);
    } catch (e: any) {
      spinner.fail(`Flow generation failed: ${e.message}`);
    }
  });

program
  .command('watch [playwrightArgs...]')
  .description('Continuously watch for file changes, generating and healing tests in real-time')
  .option('-d, --dir <directory>', 'Target directory to watch', config.targetDir || 'tests/target-app')
  .option('-i, --interactive', 'Interactively review and approve each fix before patching', false)
  .action(async (playwrightArgs: string[], options: { dir: string; interactive: boolean }) => {
    showBanner();
    await ensureConfig();
    
    const providerName = (process.env.AI_PROVIDER || 'openai').toUpperCase();
    const modelName = process.env[`${providerName}_MODEL`] || 'default';
    logger.info(`Engine: \x1b[33m${providerName}\x1b[0m (\x1b[32m${modelName}\x1b[0m)`);

    if (config.visual && process.env.VISUAL === undefined) {
      process.env.VISUAL = 'true';
    }

    startWatcher(options.dir, options.interactive, playwrightArgs);
  });

program
  .command('view [playwrightArgs...]')
  .description('Instantly run tests in visible browser with slow-motion for visual review')
  .action(async (playwrightArgs: string[]) => {
    showBanner();
    await ensureConfig();
    
    logger.box('Visual Mode', '👁️  Opening Browser in Accelerated Slow-Motion mode...\n🏁 Focused on Desktop Chromium for Developer Efficiency.');
    
    process.env.VISUAL = 'true';
    process.env.PW_SLOWMO = '1500'; // 1.5 seconds slow-mo (Slow typing for easy viewing)

    // Force only Chromium for the 'view' command to avoid multi-browser noise
    if (!playwrightArgs.some(arg => arg.startsWith('--project'))) {
      playwrightArgs.push('--project=chromium');
    }

    logger.info('Starting AutoHeal visual executor...');
    await runPlaywright({ interactive: false, playwrightArgs, gitCommit: false });
  });

program
  .command('ui [playwrightArgs...]')
  .description('Open Playwright UI Mode for visual testing and debugging of all tests')
  .action(async (playwrightArgs: string[]) => {
    showBanner();
    await ensureConfig();
    
    logger.info(`\nOpening Playwright UI Mode for visual testing...`);
    logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const { spawn } = await import('child_process');
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', '--ui', ...playwrightArgs], {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      logger.info(`\nPlaywright UI closed.`);
    });
  });

program.parse(process.argv);
