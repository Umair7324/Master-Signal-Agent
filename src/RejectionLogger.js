// RejectionLogger.js — Apr 16 2026
// Captures every rejected signal with full context so we can diagnose
// why signals aren't firing. Without this, we're blind to calibration issues.
//
// Writes to:
//   1. Local CSV (logs/rejections.csv) — ephemeral on Render but useful
//      during a session and grep-able from Render log tail
//   2. Console in grep-able format (|REJECT| prefix) for log aggregation
//   3. Optional Discord debug webhook (DISCORD_DEBUG_WEBHOOK env var)
//
// On Render's ephemeral FS, the CSV resets on restart. That's fine — use
// the Discord webhook for persistence, or tail Render logs & grep |REJECT|.

import fs from 'fs';
import path from 'path';

const LOG_DIR  = 'logs';
const LOG_FILE = path.join(LOG_DIR, 'rejections.csv');
const HEADER   = 'timestamp,pair,action,type,score,min_score,reason,' +
                 'macro,mtf,signal5m,rsi,macd,stoch,bb,news,session,patterns,directionBias,' +
                 'macro_trend,mtf_trend,notes\n';

export class RejectionLogger {
  constructor(opts = {}) {
    this.enabled       = opts.enabled !== false;
    this.debugWebhook  = opts.debugWebhook || process.env.DISCORD_DEBUG_WEBHOOK || null;
    this.consoleOutput = opts.consoleOutput !== false;
    this.maxDiscordPerCycle = 5;   // avoid spamming Discord
    this.discordThisCycle   = 0;

    if (this.enabled) this._ensureFile();
  }

  // Called by master_index.js at the start of every cycle
  resetCycleCounter() {
    this.discordThisCycle = 0;
  }

  // ── PUBLIC ─────────────────────────────────────────────────────
  // Logs a rejection. Accepts a loose shape — all fields optional except
  // pair + reason. Scoring breakdown is logged when available.
  async log({ pair, action = '-', type = '-', score = null, minScore = null,
              reason, breakdown = {}, macroTrend = '-', mtfTrend = '-', notes = '' }) {
    if (!this.enabled) return;

    const ts = new Date().toISOString();
    const b  = breakdown || {};

    const row = [
      ts, pair, action, type,
      score ?? '', minScore ?? '',
      this._csvSafe(reason),
      b.macro ?? '', b.mtf ?? '', b.signal5m ?? '', b.rsi ?? '',
      b.macd ?? '', b.stoch ?? '', b.bb ?? '', b.news ?? '',
      b.session ?? '', b.patterns ?? '', b.directionBias ?? '',
      macroTrend, mtfTrend,
      this._csvSafe(notes)
    ].join(',') + '\n';

    // 1. Console output (grep-able)
    if (this.consoleOutput) {
      const scoreStr = score !== null ? `${score}/${minScore ?? '-'}` : '-';
      console.log(`|REJECT| ${pair} ${action} ${type} score=${scoreStr} reason="${reason}"`);
    }

    // 2. Local CSV
    try {
      fs.appendFileSync(LOG_FILE, row);
    } catch (err) {
      // File may have been wiped by Render restart — re-create and retry
      try {
        this._ensureFile();
        fs.appendFileSync(LOG_FILE, row);
      } catch (_) { /* give up silently — console still has it */ }
    }

    // 3. Optional Discord debug webhook — rate-limited per cycle
    if (this.debugWebhook && this.discordThisCycle < this.maxDiscordPerCycle) {
      this.discordThisCycle++;
      this._sendDiscord({ pair, action, type, score, minScore, reason, breakdown }).catch(() => {});
    }
  }

  // Pretty-print last N rejections (for debugging via HTTP endpoint)
  getRecent(n = 20) {
    try {
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.slice(-n).join('\n');
    } catch (_) {
      return 'No rejections logged yet.';
    }
  }

  // ── PRIVATE ────────────────────────────────────────────────────
  _ensureFile() {
    try {
      if (!fs.existsSync(LOG_DIR))  fs.mkdirSync(LOG_DIR, { recursive: true });
      if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, HEADER);
    } catch (err) {
      console.warn(`⚠️  RejectionLogger: cannot create ${LOG_FILE}:`, err.message);
      this.enabled = false;
    }
  }

  _csvSafe(str) {
    if (str === null || str === undefined) return '';
    const s = String(str).replace(/"/g, '""');
    return /[,\n"]/.test(s) ? `"${s}"` : s;
  }

  async _sendDiscord({ pair, action, type, score, minScore, reason, breakdown }) {
    try {
      const b = breakdown || {};
      const brk = Object.keys(b).length
        ? `macro:${b.macro ?? 0} mtf:${b.mtf ?? 0} sig:${b.signal5m ?? 0} rsi:${b.rsi ?? 0} ` +
          `macd:${b.macd ?? 0} stoch:${b.stoch ?? 0} bb:${b.bb ?? 0} sess:${b.session ?? 0} ` +
          `pat:${b.patterns ?? 0} dir:${b.directionBias ?? 0}`
        : '(no breakdown)';

      const scoreLine = score !== null ? `**${score}** / min ${minScore ?? '-'}` : '—';
      const content = `🚫 **${pair}** ${action} ${type} — ${reason}\n` +
                      `Score: ${scoreLine}\n\`${brk}\``;

      await fetch(this.debugWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
    } catch (_) { /* silent */ }
  }
}