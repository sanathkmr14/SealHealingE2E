import fs from 'fs';
import { logger } from './utils/logger.js';
import { updateWatcherCache } from './utils/watcher-cache.js';

/**
 * Patches a file by replacing `originalCode` with `newCode`.
 *
 * Three-tier matching strategy (most precise → most resilient):
 *  1. Exact string match  — fastest, works when AI preserves whitespace perfectly
 *  2. Normalized match    — trims each line before comparing, tolerates indent drift
 *  3. Line-range splice   — targets the ±8 lines around `errorLine`, picks the
 *                           window whose trimmed content overlaps most with the
 *                           diff's removal lines. Virtually unbreakable.
 */
export function patchFile(
  filePath: string,
  originalCode: string,
  newCode: string,
  errorLine?: number
): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');

  // ── Tier 1: exact string match ─────────────────────────────────────────
  if (raw.includes(originalCode)) {
    const matchCount = raw.split(originalCode).length - 1;
    // Skip exact match if there are multiple occurrences and we have an errorLine (defer to proximity match)
    if (errorLine === undefined || matchCount === 1) {
      const patched = raw.replace(originalCode, newCode);
      fs.writeFileSync(filePath, patched, 'utf8');
      updateWatcherCache(filePath, patched);
      logger.success(`Successfully patched ${filePath} (exact match)`);
      return true;
    }
  }

  const contentLines = raw.split('\n');

  // Normalize: trim each line, collapse to a fingerprint string
  const normalize = (s: string) =>
    s
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join('\n');

  const origNorm = normalize(originalCode);
  const origTrimmed = origNorm.split('\n');
  const newLinesBase = newCode.split('\n');

  if (origTrimmed.length === 0) {
    logger.error('patchFile: originalCode is empty — nothing to replace.');
    return false;
  }

  // ── Tier 2: normalized whitespace match (skipping empty lines) ─────────────
  let bestMatchStartIndex = -1;
  let bestMatchEndIndex = -1;
  let minDistance = Infinity;

  // We want to find a contiguous block of code in `contentLines` that matches `origTrimmed`
  // if we ignore all empty lines.
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i]!.trim() === '') continue; // Start on a non-empty line

    let matches = true;
    let origIdx = 0;
    let fileIdx = i;

    while (origIdx < origTrimmed.length && fileIdx < contentLines.length) {
      const fLine = contentLines[fileIdx]!.trim();
      if (fLine === '') {
        fileIdx++; // Skip empty lines in source
        continue;
      }
      
      if (fLine !== origTrimmed[origIdx]) {
        matches = false;
        break;
      }
      origIdx++;
      fileIdx++;
    }

    if (matches && origIdx === origTrimmed.length) {
      const distance = errorLine !== undefined ? Math.abs(i + 1 - errorLine) : i;
      if (distance < minDistance) {
        minDistance = distance;
        bestMatchStartIndex = i;
        bestMatchEndIndex = fileIdx; // The line after the last matched line
      }
    }
  }

  if (bestMatchStartIndex !== -1) {
    const before = contentLines.slice(0, bestMatchStartIndex);
    const after = contentLines.slice(bestMatchEndIndex);
    const indent = leadingWhitespace(contentLines[bestMatchStartIndex] ?? '');
    const newLines = reindent(newLinesBase, indent);
    const patched = [...before, ...newLines, ...after].join('\n');
    fs.writeFileSync(filePath, patched, 'utf8');
    updateWatcherCache(filePath, patched);
    logger.success(`Successfully patched ${filePath} near line ${bestMatchStartIndex + 1} (normalized match)`);
    return true;
  }

  // ── Tier 3: line-range splice (Full file search with errorLine proximity scoring)
  if (errorLine !== undefined) {
    const windowStart = 0;
    const windowEnd = contentLines.length;

    // Score each possible start position inside the file
    let bestScore = -1;
    let bestStart = -1;
    let bestEnd = -1;
    let closestDistance = Infinity;

    for (let i = windowStart; i <= windowEnd; i++) {
      let score = 0;
      let fileIdx = i;

      for (let j = 0; j < origTrimmed.length && fileIdx < contentLines.length; j++) {
        while (fileIdx < contentLines.length && contentLines[fileIdx]!.trim() === '') {
          fileIdx++;
        }
        if (fileIdx >= contentLines.length) break;

        const fileLine = contentLines[fileIdx]!.trim();
        const diffLine = origTrimmed[j] ?? '';
        if (fileLine === diffLine) {
          score++;
        } else if (fileLine.includes(diffLine) || diffLine.includes(fileLine)) {
          score += 0.5;
        }
        fileIdx++;
      }
      
      // If scores are tied, pick the one closest to the errorLine
      const distance = Math.abs(i + 1 - errorLine);
      if (score > bestScore || (score === bestScore && distance < closestDistance)) {
        bestScore = score;
        bestStart = i;
        bestEnd = fileIdx;
        closestDistance = distance;
      }
    }

    // Adaptive threshold: large AI diffs (>15 lines) tend to include many shared context
    // lines between tests, so we lower the bar from 50% to 30% for them.
    const tier3Threshold = origTrimmed.length > 15
      ? origTrimmed.length * 0.30
      : origTrimmed.length * 0.50;

    if (bestStart !== -1 && bestScore >= tier3Threshold) {
      const before = contentLines.slice(0, bestStart);
      const after = contentLines.slice(bestEnd);
      const indent = leadingWhitespace(contentLines[bestStart] ?? '');
      const newLines = reindent(newLinesBase, indent);
      const patched = [...before, ...newLines, ...after].join('\n');
      fs.writeFileSync(filePath, patched, 'utf8');
      updateWatcherCache(filePath, patched);
      logger.success(
        `Successfully patched ${filePath} near line ${bestStart + 1} (line-range splice, score=${bestScore.toFixed(1)}/${origTrimmed.length})`
      );
      return true;
    }

    // ── Tier 4: proximity window splice — last resort when AI diff is large/mismatched ──
    // Scan a tight ±15-line window around errorLine, find the sub-block with highest
    // match density against the first & last lines of origTrimmed, and splice there.
    const PROX_WINDOW = 15;
    const winStart = Math.max(0, errorLine - PROX_WINDOW - 1);
    const winEnd = Math.min(contentLines.length, errorLine + PROX_WINDOW);
    const proxBlockLen = origTrimmed.length;

    let proxBestScore = -1;
    let proxBestStart = -1;
    let proxBestEnd = -1;

    for (let i = winStart; i <= winEnd; i++) {
      let score = 0;
      let fileIdx = i;
      
      for (let j = 0; j < proxBlockLen && fileIdx < contentLines.length; j++) {
        while (fileIdx < contentLines.length && contentLines[fileIdx]!.trim() === '') {
          fileIdx++;
        }
        if (fileIdx >= contentLines.length) break;

        const fileLine = contentLines[fileIdx]!.trim();
        const diffLine = origTrimmed[j] ?? '';
        if (fileLine === diffLine) score++;
        else if (fileLine.includes(diffLine) || diffLine.includes(fileLine)) score += 0.5;
        fileIdx++;
      }
      if (score > proxBestScore) {
        proxBestScore = score;
        proxBestStart = i;
        proxBestEnd = fileIdx;
      }
    }

    const tier4Threshold = Math.min(proxBlockLen, PROX_WINDOW) * 0.25;
    if (proxBestStart !== -1 && proxBestScore >= tier4Threshold) {
      const before = contentLines.slice(0, proxBestStart);
      const after = contentLines.slice(proxBestEnd);
      const indent = leadingWhitespace(contentLines[proxBestStart] ?? '');
      const newLines = reindent(newLinesBase, indent);
      const patched = [...before, ...newLines, ...after].join('\n');
      fs.writeFileSync(filePath, patched, 'utf8');
      updateWatcherCache(filePath, patched);
      logger.success(
        `Successfully patched ${filePath} near line ${proxBestStart + 1} (proximity splice, score=${proxBestScore.toFixed(1)})`
      );
      return true;
    }
  }

  logger.error(
    `patchFile: Could not match the target code in ${filePath}. ` +
    `Tried exact, normalized, and line-range strategies.`
  );
  return false;
}

/** Returns the leading whitespace of a line */
function leadingWhitespace(line: string): string {
  return line.match(/^(\s*)/)?.[1] ?? '';
}

/**
 * Re-applies a base indentation to a set of new lines.
 * Calculates the minimum leading whitespace of the block and strips it,
 * then applies the target baseIndent to keep relative indentation intact.
 */
function reindent(lines: string[], baseIndent: string): string[] {
  // Find minimum common whitespace of non-empty lines
  let minCommon = -1;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const match = line.match(/^(\s*)/);
    const lead = match ? match[1]!.length : 0;
    if (minCommon === -1 || lead < minCommon) minCommon = lead;
  }
  
  if (minCommon === -1) minCommon = 0;

  return lines.map(line => {
    if (line.trim() === '') return '';
    const currentLeadMatch = line.match(/^(\s*)/);
    const currentLead = currentLeadMatch ? currentLeadMatch[1]!.length : 0;
    // Strip only up to minCommon to preserve relative nesting
    const strippedLine = line.substring(Math.min(currentLead, minCommon));
    return baseIndent + strippedLine;
  });
}
