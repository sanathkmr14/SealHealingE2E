import { select, input } from '@inquirer/prompts';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import dotenv from 'dotenv';
import { saveDefaultConfig, getProjectRoot } from './config-loader.js';

export async function ensureConfig(force = false): Promise<void> {
  const rootDir = getProjectRoot();
  const envPath = path.join(rootDir, '.env');
  
  // Load current env values
  let currentEnv: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    currentEnv = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  }

  // If not forcing, and already configured, we are done
  if (!force && (process.env.AI_PROVIDER || currentEnv.AI_PROVIDER)) {
    return;
  }

  logger.info('\nWelcome to AutoHeal! Let\'s set up your AI Engine.\n');

  if (currentEnv.AI_PROVIDER) {
    const currentProvider = currentEnv.AI_PROVIDER;
    const currentModel = currentEnv[`${currentProvider.toUpperCase()}_MODEL`] || 'default';
    logger.info(`Current Configuration: \x1b[33m${currentProvider}\x1b[0m (\x1b[32m${currentModel}\x1b[0m)`);
    logger.info(`   Running 'init' will update these settings.\n`);
  }

  const provider = await select({
    message: 'Which AI Provider would you like to use?',
    choices: [
      { name: 'Google Gemini (Pro/Flash)', value: 'gemini' },
      { name: 'Anthropic Claude', value: 'anthropic' },
      { name: 'OpenAI (GPT-4o)', value: 'openai' },
      { name: 'OpenRouter (Free Open Source Models)', value: 'openrouter' },
    ],
    default: currentEnv.AI_PROVIDER as any,
  });

  const apiKey = await input({
    message: `Enter your ${provider.toUpperCase()} API Key:`,
    default: currentEnv[`${provider.toUpperCase()}_API_KEY`] || '',
    validate: (val: string) => val.trim().length > 0 || 'API key is required',
  });

  const defaultModelMap: Record<string, string> = {
    openrouter: 'meta-llama/llama-3-8b-instruct:free',
    gemini: 'gemini-1.5-pro',
    openai: 'gpt-4o',
    anthropic: 'claude-3-5-sonnet-20241022'
  };

  const modelName = await input({
    message: `Enter the ${provider.toUpperCase()} model:`,
    default: currentEnv[`${provider.toUpperCase()}_MODEL`] || defaultModelMap[provider] || ''
  });

  // Update original env object safely while preserving comments and structure
  let rawEnv = '';
  if (fs.existsSync(envPath)) {
    rawEnv = fs.readFileSync(envPath, 'utf8');
  }

  const updateEnvKey = (key: string, value: string) => {
    const safeValue = value.includes('\n') || value.includes('"') 
        ? `"${value.replace(/"/g, '\\"')}"` 
        : value;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(rawEnv)) {
      rawEnv = rawEnv.replace(regex, `${key}=${safeValue}`);
    } else {
      rawEnv += (rawEnv && !rawEnv.endsWith('\n') ? '\n' : '') + `${key}=${safeValue}\n`;
    }
  };

  updateEnvKey('AI_PROVIDER', provider);
  updateEnvKey(`${provider.toUpperCase()}_API_KEY`, apiKey);
  updateEnvKey(`${provider.toUpperCase()}_MODEL`, modelName);
  
  try {
    fs.writeFileSync(envPath, rawEnv);
  } catch (e) {
    logger.error(`Failed to write configuration to ${envPath}: ${e}`);
  }
  
  // Inject into current process
  process.env.AI_PROVIDER = provider;
  process.env[`${provider.toUpperCase()}_API_KEY`] = apiKey;
  process.env[`${provider.toUpperCase()}_MODEL`] = modelName;

  logger.success(`\nConfiguration updated successfully! \n`);

  // Also save the default config file for paths/settings
  saveDefaultConfig();
}
