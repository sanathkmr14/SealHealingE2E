import fs from 'fs';
import path from 'path';

/**
 * Maps a broken element snippet from a trace back to its likely source file.
 * This is a heuristic search through the project's source code.
 */
export function findSourceFileForElement(
    errorMsg: string,
    targetDir: string,
    excludePatterns: string[] = ['**/node_modules/**', '**/dist/**']
): { filePath: string; snippet: string } | undefined {
    // 1. Extract the locator from the Playwright error message
    // Matches locator('...'), getByRole('...', { name: '...' }), getByLabel('...'), etc.
    let query = '';

    const roleMatch = errorMsg.match(/getByRole\(['"]([^'"]+)['"](?:,\s*\{.*?name:\s*['"]([^'"]+)['"].*?\})?\)/i);
    const labelMatch = errorMsg.match(/getBy(?:Label|Placeholder|Text|TestId)\(['"]([^'"]+)['"]\)/i);
    const locatorMatch = errorMsg.match(/locator\(['"]([^'"]+)['"]\)/i);

    if (roleMatch) {
        // Prioritize the name (e.g., 'Submit') over the role (e.g., 'button')
        query = roleMatch[2] || roleMatch[1] || '';
    } else if (labelMatch) {
        query = labelMatch[1] || '';
    } else if (locatorMatch) {
        query = locatorMatch[1] || '';
    }

    // Strip out CSS selector junk like '#' or '.' for a clean text search
    query = query.replace(/^[#.]/, '');

    if (!query) return undefined;

    if (!fs.existsSync(targetDir)) return undefined;
    const files = getAllFiles(targetDir, excludePatterns);

    // 2. Sort files by similarity to the test file name (if possible)
    const fileMatch = errorMsg.match(/([a-zA-Z0-9_\-\/\.\\]+\.[jt]sx?)/i);
    const testFileName = fileMatch ? path.basename(fileMatch[1]!).replace('.spec', '').split('.')[0]! : '';
    const sortedFiles = files.sort((a, b) => {
        const aBase = path.basename(a).toLowerCase();
        const bBase = path.basename(b).toLowerCase();
        const aScore = (testFileName && aBase.includes(testFileName.toLowerCase())) ? 1 : 0;
        const bScore = (testFileName && bBase.includes(testFileName.toLowerCase())) ? 1 : 0;
        return bScore - aScore;
    });

    // 3. Search for the query in each file
    for (const file of sortedFiles) {
        if (!file.match(/\.(html|jsx|tsx|vue|svelte|js|ts)$/)) continue;
        
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]?.toLowerCase().includes(query.toLowerCase())) {
                    const start = Math.max(0, i - 10);
                    const end = Math.min(lines.length, i + 10);
                    const snippet = lines.slice(start, end).join('\n');
                    return { filePath: file, snippet };
                }
            }
        } catch (e) {}
    }

    return undefined;
}

/**
 * Recursively gets all files in a directory, respecting exclusions.
 */
export function getAllFiles(dir: string, excludes: string[]): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    
    let list: string[] = [];
    try {
        list = fs.readdirSync(dir);
    } catch (e) {
        return results;
    }

    list.forEach(file => {
        const filePath = path.join(dir, file);
        
        try {
            const stat = fs.statSync(filePath);

            // check if this path matches any exclusion pattern
            if (excludes.some(pattern => {
                const normalizedPath = filePath.replace(/\\/g, '/');
                // Convert simple globs to regex (e.g. *.spec.ts -> .*\.spec\.ts$)
                const regexStr = pattern
                    .replace(/\./g, '\\.')
                    .replace(/\*\*/g, '.*')
                    .replace(/\*/g, '[^/]*');
                const regex = new RegExp(regexStr + '($|/)');
                return regex.test(normalizedPath);
            })) return;

            if (stat && stat.isDirectory()) {
                results = results.concat(getAllFiles(filePath, excludes));
            } else {
                results.push(filePath);
            }
        } catch (e) {
            // Skip inaccessible files
        }
    });

    return results;
}
