// TradeMonitor.js
// Tracks all open signals after they fire
// Every poll cycle → checks live price → pings Discord when TP or SL hit

const WEBHOOK_URL = process.env.DISCORD_MASTER_WEBHOOK;
const API_KEY     = process.env.TWELVEDATA_API_KEY_MASTER;
const BASE_URL    = 'https://api.twelvedata.com';

export class TradeMonitor {
  constructor() {
    // Map of signalId → trade object
    // signalId = `${pair}:${action}:${type}:${timestamp}`
    this.openTrades = new Map();
  }

  // ── Add a new signal to monitor ────────────────────────────────
  addTrade(signal) {
    const id = `${signal.pair}:${signal.action}:${signal.type}:${Date.now()}`;
    this.openTrades.set(id, {
      id,
      pair:      signal.pair,
      action:    signal.action,
      type:      signal.type,
      entry:     signal.entry,
      sl:        signal.sl,
      tp:        signal.tp,
      rr:        signal.rr,
      score:     signal.score,
      openTime:  Date.now(),
      openTimeStr: this._getPKT(),
    });
    console.log(`📌 Monitoring trade: ${signal.pair} ${signal.action} ${signal.type} | Entry: ${signal.entry?.toFixed(2)}`);
  }

  // ── Check all open trades against live prices ──────────────────
  // Called every poll cycle from master_index.js
  async checkAll() {
    if (this.openTrades.size === 0) return;

    // Get unique pairs that have open trades
    const pairs = [...new Set([...this.openTrades.values()].map(t => t.pair))];

    // Fetch live price for each pair
    const prices = {};
    for (const pair of pairs) {
      try {
        prices[pair] = await this._getLivePrice(pair);
        await this._sleep(500);
      } catch (err) {
        console.error(`[Monitor] Price fetch failed for ${pair}: ${err.message}`);
      }
    }

    // Check each trade
    for (const [id, trade] of this.openTrades) {
      const livePrice = prices[trade.pair];
      if (!livePrice) continue;

      const hit = this._checkHit(trade, livePrice);

      if (hit) {
        await this._sendResult(trade, hit, livePrice);
        this.openTrades.delete(id);
        console.log(`🏁 Trade closed: ${trade.pair} ${trade.action} → ${hit.result} | Price: ${livePrice}`);
      }
    }
  }

  // ── Check if TP or SL was hit ──────────────────────────────────
  _checkHit(trade, livePrice) {
    const { action, tp, sl, entry } = trade;

    if (action === 'BUY') {
      if (livePrice >= tp) return { result: 'TP_HIT', pips: this._pips(trade, tp) };
      if (livePrice <= sl) return { result: 'SL_HIT', pips: this._pips(trade, sl) };
    }

    if (action === 'SELL') {
      if (livePrice <= tp) return { result: 'TP_HIT', pips: this._pips(trade, tp) };
      if (livePrice >= sl) return { result: 'SL_HIT', pips: this._pips(trade, sl) };
    }

    return null;
  }

  // ── Calculate R gained/lost ────────────────────────────────────
  _pips(trade, closePrice) {
    const riskPips = Math.abs(trade.entry - trade.sl);
    const rewardPips = Math.abs(closePrice - trade.entry);
    const r = (rewardPips / riskPips).toFixed(2);
    return r;
  }

  // ── Send result notification to Discord ───────────────────────
  async _sendResult(trade, hit, closePrice) {
    const isWin   = hit.result === 'TP_HIT';
    const emoji   = isWin ? '✅' : '❌';
    const color   = isWin ? 0x00C853 : 0xD50000;
    const label   = isWin ? 'TAKE PROFIT HIT 🎯' : 'STOP LOSS HIT 🛑';
    const rLabel  = isWin ? `+${trade.rr}R 💰` : `-1R 💸`;
    const fmt     = (n) => this._formatPrice(trade.pair, n);

    const duration = this._getDuration(trade.openTime);

    const embed = {
      title:  `${emoji} ${trade.pair} ${trade.action} ${trade.type} — ${label}`,
      color,
      fields: [
        {
          name: '📍 Entry',
          value: `\`${fmt(trade.entry)}\``,
          inline: true
        },
        {
          name: `🏁 Close Price`,
          value: `\`${fmt(closePrice)}\``,
          inline: true
        },
        {
          name: '📊 Result',
          value: `**${rLabel}** (RR was 1:${trade.rr})`,
          inline: true
        },
        {
          name: '🛑 SL',
          value: `\`${fmt(trade.sl)}\``,
          inline: true
        },
        {
          name: '🎯 TP',
          value: `\`${fmt(trade.tp)}\``,
          inline: true
        },
        {
          name: '⏱️ Duration',
          value: duration,
          inline: true
        },
        {
          name: '📈 Signal Score',
          value: `${trade.score}/100 at entry`,
          inline: true
        },
        {
          name: '🕐 Opened',
          value: trade.openTimeStr,
          inline: true
        },
        {
          name: '🕐 Closed',
          value: this._getPKT(),
          inline: true
        },
      ],
      footer: {
        text: `Master Signal Agent — Trade Result`
      },
      timestamp: new Date().toISOString()
    };

    const body = {
      username:   'Master Signal Agent 🤖',
      content:    isWin ? `🎯 **TP HIT** — ${trade.pair} ${trade.action}` : `🛑 **SL HIT** — ${trade.pair} ${trade.action}`,
      embeds:     [embed]
    };

    try {
      await this._postWithRetry(body);
    } catch (err) {
      console.error('[Monitor] Discord result notification failed:', err.message);
    }
  }

  // POST to Discord webhook with automatic 429 retry-after handling
  async _postWithRetry(body, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let res;
      try {
        res = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        });
      } catch (err) {
        console.warn(`[Monitor] Discord fetch error (attempt ${attempt}/${maxRetries}): ${err.message}`);
        await this._sleep(5000 * attempt);
        continue;
      }

      if (res.ok) return; // Success

      if (res.status === 429) {
        // Discord rate limit — read retry_after and wait
        let waitMs = 30000; // fallback 30s
        try {
          const text = await res.text();
          console.warn(`[Monitor] Discord 429 raw response: ${text.substring(0, 200)}`);
          const json = JSON.parse(text);
          if (json.retry_after) waitMs = Math.ceil(json.retry_after * 1000) + 500;
        } catch (_) { /* ignore parse errors, use fallback */ }

        console.warn(`[Monitor] Discord rate limited (429). Waiting ${waitMs}ms before retry ${attempt}/${maxRetries}...`);
        await this._sleep(waitMs);
        continue; // retry
      }

      // Any other non-OK status — throw immediately
      throw new Error(`${res.status} ${res.statusText}`);
    }

    throw new Error(`Discord webhook failed after ${maxRetries} retries (rate limit)`);
  }

  // ── Fetch live price from TwelveData ──────────────────────────
  async _getLivePrice(pair) {
    const url = `${BASE_URL}/price?symbol=${encodeURIComponent(pair)}&apikey=${API_KEY}`;
    const res  = await fetch(url, { timeout: 10000 });
    const json = await res.json();
    if (!json.price) throw new Error(`No price returned for ${pair}`);
    return parseFloat(json.price);
  }

  // ── Helpers ───────────────────────────────────────────────────
  _getDuration(openTime) {
    const ms  = Date.now() - openTime;
    const min = Math.floor(ms / 60000);
    const hr  = Math.floor(min / 60);
    const rem = min % 60;
    if (hr > 0) return `${hr}h ${rem}m`;
    return `${min}m`;
  }

  _formatPrice(pair, price) {
    if (!price || isNaN(price)) return '—';
    if (pair === 'XAU/USD')  return price.toFixed(2);
    if (pair === 'BTC/USD')  return price.toFixed(0);
    if (pair === 'ETH/USD')  return price.toFixed(1);
    return price.toFixed(5);
  }

  _getPKT() {
    const now = new Date();
    const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    return pkt.toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Status (for health check) ─────────────────────────────────
  getStatus() {
    return {
      openTrades: this.openTrades.size,
      trades: [...this.openTrades.values()].map(t => ({
        pair:   t.pair,
        action: t.action,
        type:   t.type,
        entry:  t.entry,
        openedAt: t.openTimeStr
      }))
    };
  }
}