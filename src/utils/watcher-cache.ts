import crypto from 'crypto';

export const lastContentCache = new Map<string, string>();

export function hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

export function updateWatcherCache(filePath: string, content: string) {
  lastContentCache.set(filePath, hashContent(content));
}
