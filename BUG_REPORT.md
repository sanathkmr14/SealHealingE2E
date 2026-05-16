# Bug Report: SelfHealingE2E

## 🔴 Critical Bugs

### Bug #1: Missing Error Handler in spawnPlaywright() → Promise Never Resolves
**Severity:** 🔴 CRITICAL  
**File:** [src/runner.ts](src/runner.ts#L356-L370)  
**Issue:** The spawn wrapper only listens to `close` event but not `error` event. If `npx` command fails to execute, the promise never resolves.

**Current Code:**
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
    // ❌ MISSING: child.on('error', ...)
  });
}
```

**Impact:** 
- If `npx` is not in PATH, the process hangs forever
- Tests hang without timeout
- No error message to user

**Fix:** Add error handler:
```typescript
child.on('error', err => {
  resolve({ exitCode: 1, jsonReport: { errors: [err.message] } });
});
```

---

### Bug #2: No Process Cleanup on Timeout
**Severity:** 🔴 CRITICAL  
**File:** [src/runner.ts](src/runner.ts#L313-L333)  
**Issue:** The `spawnPlaywright()` function returns a promise without a timeout or cleanup mechanism. If a test hangs, the process leaks.

**Impact:**
- Orphaned `npx` processes consume resources
- Multiple runs without cleanup = resource exhaustion

**Fix:** Add timeout and cleanup:
```typescript
function spawnPlaywright(args: string[]): Promise<{ exitCode: number; jsonReport: any }> {
  return new Promise((resolve, reject) => {
    const reportName = `playwright-report-${Date.now()}-${Math.floor(Math.random() * 10000)}.json`;
    const env = { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_NAME: reportName };

    let timeoutId: NodeJS.Timeout;
    const child = spawn('npx', ['playwright', 'test', ...args], {
      stdio: 'pipe',
      env,
    });

    // Timeout after 5 minutes
    timeoutId = setTimeout(() => {
      child.kill();
      resolve({ exitCode: 1, jsonReport: { errors: ['Process timeout'] } });
    }, 300000);

    child.on('close', code => {
      clearTimeout(timeoutId);
      let json = null;
      try {
        if (fs.existsSync(reportName)) {
          json = JSON.parse(fs.readFileSync(reportName, 'utf8'));
          fs.unlinkSync(reportName);
        }
      } catch {}
      resolve({ exitCode: code ?? 1, jsonReport: json });
    });

    child.on('error', err => {
      clearTimeout(timeoutId);
      resolve({ exitCode: 1, jsonReport: { errors: [err.message] } });
    });
  });
}
```

---

## 🟠 High Severity Bugs

### Bug #3: Unchecked Null Access in printTestResultsSync()
**Severity:** 🟠 HIGH  
**File:** [src/runner.ts](src/runner.ts#L364-L395)  
**Issue:** If `jsonReport` is null/undefined, accessing properties will crash.

**Current Code:**
```typescript
function printTestResultsSync(shortName: string, jsonReport: any) {
  const stats = extractTestStats(jsonReport);  // ❌ jsonReport could be null
  if (stats.total === 0) return;
  
  stats.tests.forEach((t: any) => {
    // ... accessing t.title without null check ...
  });
}
```

**Fix:** Add null check:
```typescript
function printTestResultsSync(shortName: string, jsonReport: any) {
  if (!jsonReport) {
    console.error(`No report available for ${shortName}`);
    return;
  }
  const stats = extractTestStats(jsonReport);
  // ... rest of code
}
```

---

### Bug #4: Potential Unchecked Array Access in extractTestErrors()
**Severity:** 🟠 HIGH  
**File:** [src/runner.ts](src/runner.ts#L434-L470)  
**Issue:** The function traverses nested structures without validating existence of properties.

**Current Code:**
```typescript
for (const suite of suites) {
  if (suite.specs) {  // ✓ Checks suit doesn't have .specs
    for (const spec of suite.specs) {
      if (spec.tests) {  // ✓ Checks spec has .tests
        for (const test of spec.tests) {
          if (test.results) {  // ✓ Checks test has .results
            for (const result of test.results) {
              if (result.errors) {
                // ✓ But what if result.errors[i].location is undefined?
                const sorted = [...result.errors].sort((a, b) => {
                  if (a.location && !b.location) return -1;
                  if (!a.location && b.location) return 1;
                  return 0;
                });
              }
            }
          }
        }
      }
    }
  }
}
```

**Note:** This code actually HAS null checks, so it's **Fixed** ✓

---

## 🟡 Medium Severity Bugs

### Bug #5: Missing Environment Variable Not Used Correctly
**Severity:** 🟡 MEDIUM  
**File:** [src/runner.ts](src/runner.ts#L347)  
**Issue:** `PLAYWRIGHT_JSON_OUTPUT_NAME` is set in env but may not be recognized by older Playwright versions. The fallback doesn't create the file in the right location.

**Current Code:**
```typescript
const env = { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_NAME: reportName };
// ...
child.on('close', code => {
  let json = null;
  try {
    if (fs.existsSync(reportName)) {  // ❌ Looks in cwd, not in specified location
      json = JSON.parse(fs.readFileSync(reportName, 'utf8'));
      fs.unlinkSync(reportName);
    }
  } catch {}
```

**Fix:** Use proper Playwright JSON report location:
```typescript
const child = spawn('npx', ['playwright', 'test', '--reporter=json', ...args], {
  stdio: 'pipe',
  env,
});
// Playwright writes to `playwright-report/index.json` by default
const reportPath = path.join(process.cwd(), 'playwright-report', 'index.json');
```

---

### Bug #6: Array Mutation Inefficiency in parseDiff()
**Severity:** 🟡 MEDIUM  
**File:** [src/healer.ts](src/healer.ts#L260-L280)  
**Issue:** Using `shift()` and `pop()` on arrays repeatedly is O(n) inefficient. Should use slice.

**Current Code:**
```typescript
const trimEdges = (lines: string[]) => {
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();  // ❌ O(n) per iteration
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();  // ✓ O(1)
};
```

**Better Approach:**
```typescript
const trimEdges = (lines: string[]) => {
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === '') start++;
  let end = lines.length - 1;
  while (end >= start && lines[end]!.trim() === '') end--;
  return lines.slice(start, end + 1);
};
```

---

### Bug #7: Infinity Sentinel Value Not Type-Safe
**Severity:** 🟡 MEDIUM  
**File:** [src/patcher.ts](src/patcher.ts#L105-L125)  
**Issue:** Using `Infinity` as sentinel can cause subtle bugs with floating-point comparison.

**Current Code:**
```typescript
let minCommon = Infinity;
for (const line of lines) {
  if (line.trim() === '') continue;
  const match = line.match(/^(\s*)/);
  const lead = match ? match[1]!.length : 0;
  if (lead < minCommon) minCommon = lead;  // ✓ Works but not type-safe
}

if (minCommon === Infinity) minCommon = 0;  // ❌ Could fail with rounding
```

**Fix:**
```typescript
let minCommon = -1;
for (const line of lines) {
  if (line.trim() === '') continue;
  const match = line.match(/^(\s*)/);
  const lead = match ? match[1]!.length : 0;
  if (minCommon === -1 || lead < minCommon) minCommon = lead;
}

if (minCommon === -1) minCommon = 0;
```

---

## 🟢 Low Severity Issues

### Bug #8: Loose Equality in Error Message Check
**Severity:** 🟢 LOW  
**File:** [src/healer.ts](src/healer.ts#L43)  
**Issue:** Using loose string matching for error classification is fragile.

```typescript
if (m.includes('getbylabel(') || m.includes('getbytext(') || ...)  // ✓ Works but could be more resilient with regex
```

---

### Bug #9: No Validation of AI Response Structure
**Severity:** 🟢 LOW  
**File:** [src/healer.ts](src/healer.ts#L310)  
**Issue:** Assumes AI response always has EXPLANATION section but doesn't validate.

```typescript
const explanationMatch = suggestion.match(/EXPLANATION:\s*([\s\S]*?)\n```/i);
if (explanationMatch?.[1]) {
  explanation = explanationMatch[1].trim();
}
// ❌ If no match, explanation stays as "No explanation provided" - no error feedback
```

---

## 📋 Summary

| Bug | Severity | Category | Status |
|-----|----------|----------|--------|
| #1: Missing error handler in spawn | 🔴 CRITICAL | Process Management | ❌ NEEDS FIX |
| #2: No process timeout/cleanup | 🔴 CRITICAL | Resource Leaks | ❌ NEEDS FIX |
| #3: Unchecked null in printResults | 🟠 HIGH | Null Safety | ❌ NEEDS FIX |
| #4: Array access validation | 🟠 HIGH | Type Safety | ✓ ALREADY FIXED |
| #5: JSON report path handling | 🟡 MEDIUM | Configuration | ⚠️ VERIFY |
| #6: Array mutation efficiency | 🟡 MEDIUM | Performance | ⚠️ OPTIMIZE |
| #7: Infinity sentinel issue | 🟡 MEDIUM | Type Safety | ⚠️ REFACTOR |
| #8: Loose string matching | 🟢 LOW | Error Handling | ✓ ACCEPTABLE |
| #9: AI response validation | 🟢 LOW | Data Validation | ⚠️ ENHANCE |

---

## Recommended Fix Priority
1. **Bug #1** - Fix missing error handler (5 min)
2. **Bug #2** - Add process timeout (10 min)
3. **Bug #3** - Add null safety check (3 min)
4. **Bug #5** - Verify Playwright JSON output (5 min)
