import fs from 'fs';
import path from 'path';
import { getProjectRoot } from './config-loader.js';

export interface HealRecord {
  testName: string;
  file: string;
  line: number;
  oldSelector: string;
  newSelector: string;
  explanation: string;
  status: 'healed' | 'failed';
  timestamp: string;
}

export type AiAttemptStatus =
  | 'ai_parse_failed'
  | 'ai_healed'
  | 'patch_failed'
  | 'verify_passed'
  | 'verify_failed';

export interface AiAttemptLogEntry {
  timestamp: string;
  status: AiAttemptStatus;
  testName: string;
  file: string;
  line: number;
  attempt: number;
  provider?: string;
  model?: string;
  prompt?: string;
  rawResponse?: string;
  cleanedResponse?: string;
  parseError?: string;
  selectorBefore?: string;
  selectorAfter?: string;
  importsAfter?: string[];
  patchError?: string;
  verifyError?: string;
  explanation?: string;
}

const AI_ATTEMPTS_LOG_FILE = 'autoheal-attempts.jsonl';

export function saveAiAttemptLog(entry: AiAttemptLogEntry): string {
  const logPath = path.join(getProjectRoot(), AI_ATTEMPTS_LOG_FILE);
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  return logPath;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateHtmlReport(records: HealRecord[]): string {
  const healed = records.filter(r => r.status === 'healed');
  const failed = records.filter(r => r.status === 'failed');
  const total = records.length;
  const healRate = total > 0 ? Math.round((healed.length / total) * 100) : 0;

  // Group records by file for accordion view
  const byFile = new Map<string, HealRecord[]>();
  for (const r of records) {
    const key = path.basename(r.file);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(r);
  }

  const fileAccordions = [...byFile.entries()].map(([fileName, recs]) => {
    const fileHealed = recs.filter(r => r.status === 'healed').length;
    const fileFailed = recs.filter(r => r.status === 'failed').length;
    const fileStatus = fileFailed === 0 ? 'healed' : 'failed';
    const fileIcon = fileFailed === 0 ? '✅' : '❌';

    const cards = recs.map(r => `
      <div class="test-card ${r.status}">
        <div class="test-header">
          <span class="badge ${r.status}">${r.status === 'healed' ? '🛡️ HEALED' : '💀 FAILED'}</span>
          <span class="test-title">${escapeHtml(r.testName)}</span>
          <span class="test-meta">line ${r.line} · ${new Date(r.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="diff-row">
          <div class="diff-box old">
            <label>Before</label>
            <pre><code>${escapeHtml(r.oldSelector || '—')}</code></pre>
          </div>
          <div class="diff-arrow">→</div>
          <div class="diff-box new">
            <label>After</label>
            <pre><code>${escapeHtml(r.newSelector || '—')}</code></pre>
          </div>
        </div>
        <div class="ai-insight">
          <span class="insight-label">🤖 AI Insight</span>
          ${escapeHtml(r.explanation)}
        </div>
      </div>
    `).join('');

    return `
      <details class="file-accordion ${fileStatus}">
        <summary>
          <span class="file-icon">${fileIcon}</span>
          <span class="file-name">${escapeHtml(fileName)}</span>
          <span class="file-stats">
            <span class="stat healed">${fileHealed} healed</span>
            ${fileFailed > 0 ? `<span class="stat failed">${fileFailed} failed</span>` : ''}
          </span>
        </summary>
        <div class="accordion-body">${cards}</div>
      </details>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="4">
  <title>AutoHeal — Live Session Report</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #080e1a;
      --surface: #0f1a2e;
      --card: #132035;
      --border: #1e3050;
      --text: #e2eaf5;
      --muted: #5c7898;
      --green: #22d65f;
      --green-dim: #0f4a27;
      --red: #f04060;
      --red-dim: #4a0f1a;
      --blue: #38aaff;
      --blue-dim: #0a244a;
      --gold: #fbbf24;
      --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; min-height: 100vh; }

    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #0a1628 0%, #0f2044 50%, #0a1628 100%);
      border-bottom: 1px solid var(--border);
      padding: 28px 40px;
      display: flex; align-items: center; gap: 20px;
    }
    .header-logo { font-size: 2rem; }
    .header-title h1 { font-size: 1.5rem; font-weight: 700; color: var(--blue); }
    .header-title p { color: var(--muted); font-size: 0.85rem; margin-top: 3px; }
    .live-badge {
      margin-left: auto;
      background: rgba(34, 214, 95, 0.15);
      border: 1px solid var(--green);
      color: var(--green);
      padding: 4px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
    }
    .live-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--green);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    /* ── Stats bar ── */
    .stats-bar {
      display: grid; grid-template-columns: repeat(4, 1fr);
      gap: 16px; padding: 24px 40px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .stat-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      text-align: center;
    }
    .stat-card .label { font-size: 0.78rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-card .value { font-size: 2.2rem; font-weight: 700; margin-top: 6px; }
    .stat-card.total .value { color: var(--blue); }
    .stat-card.healed .value { color: var(--green); }
    .stat-card.failed .value { color: var(--red); }
    .stat-card.rate .value { color: var(--gold); }

    /* ── Heal rate bar ── */
    .progress-section { padding: 20px 40px; background: var(--surface); border-bottom: 1px solid var(--border); }
    .progress-label { font-size: 0.85rem; color: var(--muted); margin-bottom: 8px; display: flex; justify-content: space-between; }
    .progress-bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
    .progress-fill {
      height: 100%; border-radius: 4px;
      background: linear-gradient(90deg, var(--green), #00ffaa);
      width: ${healRate}%;
      transition: width 0.6s ease;
    }

    /* ── Main content ── */
    .content { padding: 30px 40px; max-width: 1200px; margin: 0 auto; }
    .section-title { font-size: 1rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px; }

    /* ── File accordion ── */
    .file-accordion {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 12px;
      overflow: hidden;
    }
    .file-accordion.healed { border-left: 4px solid var(--green); }
    .file-accordion.failed { border-left: 4px solid var(--red); }

    summary {
      display: flex; align-items: center; gap: 12px;
      padding: 16px 20px; cursor: pointer;
      list-style: none; user-select: none;
    }
    summary::-webkit-details-marker { display: none; }
    summary:hover { background: rgba(56, 170, 255, 0.05); }
    .file-icon { font-size: 1.2rem; }
    .file-name { font-weight: 600; font-size: 1rem; flex: 1; }
    .file-stats { display: flex; gap: 8px; }
    .stat { font-size: 0.78rem; padding: 2px 10px; border-radius: 12px; font-weight: 600; }
    .stat.healed { background: var(--green-dim); color: var(--green); }
    .stat.failed { background: var(--red-dim); color: var(--red); }

    .accordion-body { padding: 0 16px 16px; }

    /* ── Test card ── */
    .test-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-top: 12px;
    }
    .test-card.healed { border-left: 3px solid var(--green); }
    .test-card.failed { border-left: 3px solid var(--red); }

    .test-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .badge { font-size: 0.72rem; padding: 3px 9px; border-radius: 4px; font-weight: 700; }
    .badge.healed { background: var(--green-dim); color: var(--green); }
    .badge.failed { background: var(--red-dim); color: var(--red); }
    .test-title { font-weight: 600; flex: 1; }
    .test-meta { font-size: 0.78rem; color: var(--muted); font-family: 'Fira Code', monospace; }

    .diff-row { display: grid; grid-template-columns: 1fr 40px 1fr; gap: 8px; align-items: start; margin-bottom: 10px; }
    .diff-arrow { text-align: center; color: var(--muted); font-size: 1.2rem; padding-top: 28px; }
    .diff-box { background: #020810; border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
    .diff-box label { font-size: 0.72rem; color: var(--muted); display: block; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    .diff-box pre { font-family: 'Fira Code', monospace; font-size: 0.82rem; white-space: pre-wrap; word-break: break-all; }
    .diff-box.old code { color: #f87171; text-decoration: line-through; }
    .diff-box.new code { color: #86efac; }

    .ai-insight {
      background: rgba(56, 170, 255, 0.07);
      border: 1px solid rgba(56, 170, 255, 0.2);
      border-radius: 6px; padding: 10px 14px;
      font-size: 0.85rem; color: #93c5fd; line-height: 1.5;
    }
    .insight-label { font-weight: 600; margin-right: 8px; color: var(--blue); }

    /* ── Empty state ── */
    .empty { text-align: center; padding: 60px 20px; color: var(--muted); }
    .empty .icon { font-size: 3rem; margin-bottom: 12px; }

    @media (max-width: 768px) {
      .stats-bar { grid-template-columns: 1fr 1fr; }
      .diff-row { grid-template-columns: 1fr; }
      .diff-arrow { display: none; }
      .header, .content, .stats-bar, .progress-section { padding-left: 20px; padding-right: 20px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-logo">🛠️</div>
    <div class="header-title">
      <h1>AutoHeal — Live Session Report</h1>
      <p>Autonomous QA healing engine · auto-refreshes every 4s</p>
    </div>
    <div class="live-badge">
      <div class="live-dot"></div>
      LIVE
    </div>
  </div>

  <div class="stats-bar">
    <div class="stat-card total">
      <div class="label">Total Attempts</div>
      <div class="value">${total}</div>
    </div>
    <div class="stat-card healed">
      <div class="label">Healed</div>
      <div class="value">${healed.length}</div>
    </div>
    <div class="stat-card failed">
      <div class="label">Failed to Heal</div>
      <div class="value">${failed.length}</div>
    </div>
    <div class="stat-card rate">
      <div class="label">Heal Rate</div>
      <div class="value">${healRate}%</div>
    </div>
  </div>

  <div class="progress-section">
    <div class="progress-label">
      <span>Heal Progress</span>
      <span>${healed.length} / ${total}</span>
    </div>
    <div class="progress-bar"><div class="progress-fill"></div></div>
  </div>

  <div class="content">
    ${
      byFile.size === 0
        ? `<div class="empty"><div class="icon">🧘</div><p>No healing attempts recorded yet.</p><p>Run <code>autoheal test</code> to start.</p></div>`
        : `<div class="section-title">Files (${byFile.size})</div>${fileAccordions}`
    }
  </div>
</body>
</html>`;
}

export function saveReport(records: HealRecord[]) {
  const html = generateHtmlReport(records);
  const reportPath = path.join(getProjectRoot(), 'autoheal-report.html');
  fs.writeFileSync(reportPath, html);
  return reportPath;
}
