// DiscordNotifier.js
// Sends rich Discord embeds for each signal with full breakdown

const WEBHOOK_URL = process.env.DISCORD_MASTER_WEBHOOK;

// Colour codes per action
const COLORS = {
  BUY_SCALP:       0x00C853,  // Bright green
  BUY_INTRADAY:    0x1B5E20,  // Dark green
  SELL_SCALP:      0xD50000,  // Bright red
  SELL_INTRADAY:   0xB71C1C,  // Dark red
};

const PAIR_EMOJIS = {
  'XAU/USD': '🥇',
  'EUR/USD': '🇪🇺',
  'GBP/USD': '🇬🇧',
  'BTC/USD': '₿',
  'ETH/USD': 'Ξ',
};

export class DiscordNotifier {

  async send(signals) {
    if (!signals || signals.length === 0) return;

    for (const signal of signals) {
      try {
        await this._sendSignal(signal);
        await this._sleep(1500); // Respect Discord rate limit (max ~30 req/min per webhook)
      } catch (err) {
        console.error('Discord send failed:', err.message);
      }
    }
  }

  async _sendSignal(s) {
    const pairEmoji = PAIR_EMOJIS[s.pair] || '📊';
    const actionEmoji = s.action === 'BUY' ? '🟢' : '🔴';
    const typeEmoji   = s.type === 'SCALP' ? '⚡' : '📈';
    const colorKey    = `${s.action}_${s.type}`;
    const color       = COLORS[colorKey] || 0x607D8B;

    // Score bar (visual)
    const scoreBar = this._scoreBar(s.score);

    // Format price based on pair
    const fmt = (n) => this._formatPrice(s.pair, n);

    // Breakdown details
    const bd = s.breakdown;
    const breakdownText = [
      `Macro:    ${this._pts(bd.macro)}  +  Strength: ${this._pts(bd.macroStrength)}`,
      `MTF 15m:  ${this._pts(bd.mtf)}`,
      `Signal 5m: ${this._pts(bd.signal5m)}`,
      `RSI:      ${this._pts(bd.rsi)}   MACD: ${this._pts(bd.macd)}   Stoch: ${this._pts(bd.stoch)}`,
      `CCI:      ${this._pts(bd.cci)}   BB:   ${this._pts(bd.bb)}`,
      `News:     ${this._pts(bd.news)}  Session: ${this._pts(bd.session)}`,
    ].join('\n');

    const embed = {
      title: `${pairEmoji} ${s.pair}  ${actionEmoji} ${s.action}  ${typeEmoji} ${s.type}`,
      color,
      fields: [
        {
          name: '📍 Entry',
          value: `\`${fmt(s.entry)}\``,
          inline: true
        },
        {
          name: '🛑 Stop Loss',
          value: `\`${fmt(s.sl)}\``,
          inline: true
        },
        {
          name: '🎯 Take Profit',
          value: `\`${fmt(s.tp)}\`  (RR 1:${s.rr})`,
          inline: true
        },
        {
          name: `📊 Confluence Score: ${s.score}/100`,
          value: `${scoreBar}\n\`\`\`\n${breakdownText}\n\`\`\``,
          inline: false
        },
        {
          name: '🔍 Context',
          value: `Macro: **${s.macro}** | ATR: \`${fmt(s.atr)}\` | Type: **${s.type}**`,
          inline: false
        }
      ],
      footer: {
        text: `Master Signal Agent • ${this._getPKT()}`
      },
      timestamp: new Date().toISOString()
    };

    const body = {
      username: 'Master Signal Agent 🤖',
      avatar_url: 'https://i.imgur.com/AfFp7pu.png',
      embeds: [embed]
    };

    await this._postWithRetry(body);
  }

  // Visual score bar: ████████░░ 82/100
  _scoreBar(score) {
    const filled = Math.round(score / 10);
    const empty  = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty) + ` ${score}/100`;
  }

  // Format points with colour indicator
  _pts(val) {
    if (val === undefined || val === null) return '—';
    const n = Number(val);
    if (n > 0)  return `+${n}✅`;
    if (n < 0)  return `${n}❌`;
    return `0`;
  }

  // Format price based on pair precision
  _formatPrice(pair, price) {
    if (!price || isNaN(price)) return '—';
    if (pair === 'XAU/USD') return price.toFixed(2);
    if (['BTC/USD'].includes(pair)) return price.toFixed(0);
    if (['ETH/USD'].includes(pair)) return price.toFixed(1);
    return price.toFixed(5); // Forex: 5 decimal places
  }

  _getPKT() {
    const now = new Date();
    const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    return pkt.toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
  }

  async sendSkip(pair, action, reason) {
    const pairEmoji   = PAIR_EMOJIS[pair] || '📊';
    const actionEmoji = action === 'BUY' ? '🟢' : '🔴';

    const body = {
      username: 'Master Signal Agent 🤖',
      avatar_url: 'https://i.imgur.com/AfFp7pu.png',
      embeds: [{
        title: `${pairEmoji} ${pair}  ${actionEmoji} ${action}  ⛔ SKIPPED`,
        color: 0x607D8B,
        description: `**${reason}**`,
        footer: { text: `Master Signal Agent • ${this._getPKT()}` },
        timestamp: new Date().toISOString()
      }]
    };

    try {
      await this._postWithRetry(body);
    } catch (err) {
      console.error('Discord skip send failed:', err.message);
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
        console.warn(`Discord fetch error (attempt ${attempt}/${maxRetries}): ${err.message}`);
        await this._sleep(5000 * attempt);
        continue;
      }

      if (res.ok) return; // Success

      if (res.status === 429) {
        // Discord rate limit — read retry_after and wait
        let waitMs = 30000; // fallback 30s
        try {
          const text = await res.text();
          console.warn(`Discord 429 raw response: ${text.substring(0, 200)}`);
          const json = JSON.parse(text);
          if (json.retry_after) waitMs = Math.ceil(json.retry_after * 1000) + 500;
        } catch (_) { /* ignore parse errors, use fallback */ }

        console.warn(`Discord rate limited (429). Waiting ${waitMs}ms before retry ${attempt}/${maxRetries}...`);
        await this._sleep(waitMs);
        continue; // retry
      }

      // Any other non-OK status — throw immediately
      throw new Error(`Discord webhook failed: ${res.status} ${res.statusText}`);
    }

    throw new Error(`Discord webhook failed after ${maxRetries} retries (rate limit)`);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}