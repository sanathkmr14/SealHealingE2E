import fs from 'fs';
import path from 'path';

export interface AutoHealConfig {
  targetDir?: string;
  generatedTestDir?: string;
  ai?: {
    provider?: string;
    model?: string;
    temperature?: number;
  };
  visual?: boolean;
  exclude?: string[];
}

const CONFIG_FILENAME = 'autoheal.config.json';

/**
 * Searches upward from the current directory to find the project root
 * (identified by playwright.config.ts, package.json, or .git).
 * Falls back to process.cwd() if none is found.
 */
export function getProjectRoot(): string {
  let currentDir = process.cwd();

  while (currentDir !== path.parse(currentDir).root) {
    if (
      fs.existsSync(path.join(currentDir, 'playwright.config.ts')) ||
      fs.existsSync(path.join(currentDir, 'package.json')) ||
      fs.existsSync(path.join(currentDir, '.git'))
    ) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return process.cwd();
}

export function loadConfig(): AutoHealConfig {
  const rootDir = getProjectRoot();
  const configPath = path.resolve(rootDir, CONFIG_FILENAME);

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      console.error(`Error reading ${CONFIG_FILENAME}:`, e);
      return {};
    }
  }
  return {};
}

export function saveDefaultConfig() {
  const rootDir = getProjectRoot();
  const configPath = path.resolve(rootDir, CONFIG_FILENAME);

  if (fs.existsSync(configPath)) {
    return;
  }

  const defaultConfig: AutoHealConfig = {
    targetDir: 'tests/target-app',
    generatedTestDir: 'tests',
    ai: {
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      temperature: 0.2
    },
    visual: false,
    exclude: ['**/node_modules/**', '**/dist/**']
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  } catch (e) {
    console.error(`Failed to write default config to ${configPath}:`, e);
  }
}
