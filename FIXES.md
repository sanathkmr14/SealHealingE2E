# Recommended Fixes for Critical Bugs

## Fix #1: Add Error Handler & Timeout to spawnPlaywright()

**File:** `src/runner.ts` (lines 329-362)

**Replace this:**
```typescript
function spawnPlaywright(args: string[]): Promise<{ exitCode: number; jsonReport: any }> {
  return new Promise(resolve => {
    const reportName = `playwright-report-${Date.now()}-${Math.floor(Math.random() * 10000)}.json`;
    const env = { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_NAME: reportName };

    const child = spawn('npx', ['playwright', 'test', ...args], {
      stdio: 'pipe',
      env,
    });

    child.on('close', code => {
      let json = null;
      try {
        if (fs.existsSync(reportName)) {
          json = JSON.parse(fs.readFileSync(reportName, 'utf8'));
          fs.unlinkSync(reportName);
        }
      } catch {}
      resolve({ exitCode: code ?? 1, jsonReport: json });
    });
  });
}
```

**With this:**
```typescript
function spawnPlaywright(args: string[]): Promise<{ exitCode: number; jsonReport: any }> {
  return new Promise((resolve) => {
    const reportName = `playwright-report-${Date.now()}-${Math.floor(Math.random() * 10000)}.json`;
    const env = { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_NAME: reportName };

    const child = spawn('npx', ['playwright', 'test', ...args], {
      stdio: 'pipe',
      env,
    });

    // Timeout after 5 minutes to prevent hanging
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      logger.warn(`Playwright timeout - no response within 5 minutes`);
      resolve({ exitCode: 124, jsonReport: { errors: ['Process timeout after 300s'] } });
    }, 300000);

    const cleanup = () => {
      clearTimeout(timeoutId);
    };

    child.on('close', code => {
      cleanup();
      let json = null;
      try {
        if (fs.existsSync(reportName)) {
          json = JSON.parse(fs.readFileSync(reportName, 'utf8'));
          fs.unlinkSync(reportName);
        }
      } catch {}
      resolve({ exitCode: code ?? 1, jsonReport: json });
    });

    // CRITICAL: Add error handler to prevent promise from hanging
    child.on('error', err => {
      cleanup();
      logger.error(`Failed to spawn Playwright: ${err.message}`);
      resolve({ exitCode: 1, jsonReport: { errors: [`Failed to spawn process: ${err.message}`] } });
    });
  });
}
```

---

## Fix #2: Add Null Safety to printTestResultsSync()

**File:** `src/runner.ts` (lines 363-396)

**Replace this:**
```typescript
function printTestResultsSync(shortName: string, jsonReport: any) {
  const stats = extractTestStats(jsonReport);
  if (stats.total === 0) return;
  const failedCount = stats.tests.filter(t => t.status === 'failed').length;
  // ... rest
}
```

**With this:**
```typescript
function printTestResultsSync(shortName: string, jsonReport: any) {
  if (!jsonReport) {
    logger.warn(`No test report available for ${shortName} — may indicate test runner failure`);
    return;
  }

  const stats = extractTestStats(jsonReport);
  if (stats.total === 0) {
    logger.info(`No tests found in ${shortName}`);
    return;
  }

  const failedCount = stats.tests.filter(t => t.status === 'failed').length;
  // ... rest
}
```

---

## Fix #3: Update extractTestStats to Handle Null Report

**File:** `src/runner.ts` (lines 404-427)

**Replace this:**
```typescript
function extractTestStats(report: any): { total: number; tests: any[] } {
  const stats = { total: 0, tests: [] as any[] };
  if (!report?.suites) return stats;

  const traverse = (suites: any[], projectName = '') => {
    // ...
  };
  traverse(report.suites);
  return stats;
}
```

**With this:**
```typescript
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
```

---

## Fix #4: Improve Error Classification in Healer

**File:** `src/healer.ts` (lines 20-60)

**Current (works but could be more maintainable):**
```typescript
function classifyError(errorMsg: string): ErrorClass {
  const m = errorMsg.toLowerCase();

  if (
    m.includes('getbylabel(') ||
    m.includes('getbytext(') ||
    // ... many more string checks
  ) return 'LOCATOR_NOT_FOUND';
  // ...
}
```

**Better approach (more maintainable):**
```typescript
function classifyError(errorMsg: string): ErrorClass {
  const m = errorMsg.toLowerCase();

  // Define patterns more clearly
  const locatorNotFoundPatterns = [
    /getby(label|text|role|placeholder|testid)\(/i,
    /locator\s*\(/i,
    /strict mode violation/i,
    /(no element|could not find)/i,
    /waiting for.*(locator|selector)/i,
    /resolve to/i,
  ];

  const assertionPatterns = [
    /locator resolved to/i,
    /expected to have (value|text|attribute)/i,
    /(tobevisible|tohaveattribute|tohavetext|received string)/i,
  ];

  const timeoutPatterns = [
    /locator\.waitfor|page\.waitfor/i,
    /timeout.*exceeded/i,
  ];

  const apiErrorPatterns = [
    /is not a function/i,
    /getbyid is not/i,
    /property.*undefined/i,
    /typeerror/i,
  ];

  if (locatorNotFoundPatterns.some(p => p.test(m))) return 'LOCATOR_NOT_FOUND';
  if (assertionPatterns.some(p => p.test(m))) return 'ASSERTION_MISMATCH';
  if (timeoutPatterns.some(p => p.test(m))) return 'TIMEOUT';
  if (apiErrorPatterns.some(p => p.test(m))) return 'API_ERROR';

  return 'UNKNOWN';
}
```

---

## Implementation Steps

1. **Start with Fix #1** - Edit `spawnPlaywright()` function to add error handler and timeout
2. **Apply Fix #2** - Add null check in `printTestResultsSync()`
3. **Apply Fix #3** - Improve `extractTestStats()` with defensive programming
4. **Apply Fix #4** - Refactor error classification for maintainability

Each fix is independent and can be tested individually.
