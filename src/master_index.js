// master_index.js
// Master Signal Agent — Main Entry Point
// Runs 24/7 (Render Web Service), polls every 5 minutes
// Covers: XAU/USD, EUR/USD, GBP/USD, BTC/USD, ETH/USD
// Signals: BUY + SELL | SCALP + INTRADAY
// TP/SL Monitor: pings Discord when trade closes

import 'dotenv/config';
import { MasterEngine }    from './MasterEngine.js';
import { DiscordNotifier } from './DiscordNotifier.js';
import { SessionManager }  from './SessionManager.js';
import { NewsCache }       from './NewsCache.js';
import { TradeMonitor }    from './TradeMonitor.js';
import http                from 'http';

// ── Config ─────────────────────────────────────────────────────
const PAIRS = [
  'XAU/USD',
  'EUR/USD',
  'GBP/USD',
  'BTC/USD',
  'ETH/USD',
];

const POLL_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const DEBUG = process.env.DEBUG_MODE === 'true';

// ── Instances ──────────────────────────────────────────────────
const engine   = new MasterEngine();
const notifier = new DiscordNotifier();
const session  = new SessionManager();
const news     = new NewsCache();
const monitor  = new TradeMonitor();

// ── Stats ──────────────────────────────────────────────────────
let stats = {
  cycles:    0,
  signals:   0,
  startTime: Date.now(),
};

// ── Main Cycle ─────────────────────────────────────────────────
async function runCycle() {
  stats.cycles++;
  const cycleTime = new Date().toISOString();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${cycleTime}] 🔄 Cycle #${stats.cycles}`);

  // 1. Check open trades FIRST (cheap — 1 price call per pair)
  if (monitor.openTrades.size > 0) {
    console.log(`🔍 Checking ${monitor.openTrades.size} open trade(s)...`);
    await monitor.checkAll();
  }

  // 2. Refresh news bias (cached every 30min)
  await news.refresh();
  const newsBias       = news.getBias();
  const newsSummary    = news.getSummary();
  const currentSession = session.getSession();

  console.log(`📰 News bias: ${newsBias} (score: ${newsSummary.score?.toFixed(1)}, events: ${newsSummary.eventCount})`);
  console.log(`🕐 Session:   ${currentSession.emoji} ${currentSession.name} (boost: +${currentSession.boost})`);

  // 3. Analyze each pair
  // ⚠️  Rate limit: TwelveData free = 8 credits/min, each pair = 4 TF calls
  //     Max 2 pairs per minute — pause 65s after every 2 pairs
  let pairCount = 0;

  for (const pair of PAIRS) {
    const isCrypto = ['BTC/USD', 'ETH/USD'].includes(pair);

    if (!isCrypto && !session.shouldAnalyze(pair)) {
      if (DEBUG) console.log(`⏸️  ${pair} — skipped (off-hours for forex)`);
      continue;
    }

    // Pause after every 2 pairs to reset the per-minute credit window
    if (pairCount > 0 && pairCount % 2 === 0) {
      console.log(`⏳ Rate limit pause (65s) before ${pair}...`);
      await sleep(65000);
    }

    try {
      if (DEBUG) console.log(`🔍 Analyzing ${pair}...`);

      const signals = await engine.analyze(pair, newsBias, currentSession.boost);
      pairCount++;

      if (signals && signals.length > 0) {
        const pairBias = _pairBias(pair, newsBias);
        for (const sig of signals) {

          // Filter 1: News bias conflict — skip BUY when news is strongly bearish
          if (sig.action === 'BUY' && ['BEARISH_GOLD', 'BEARISH'].includes(pairBias)) {
            console.log(`⛔ ${pair} ${sig.action} ${sig.type} — skipped (news bias conflict: ${pairBias})`);
            await notifier.sendSkip(pair, sig.action, 'Signal skipped — News bias conflict');
            continue;
          }

          // Filter 2: RSI + Stoch both zero — no momentum confirmation
          if (sig.breakdown.rsi === 0 && sig.breakdown.stoch === 0) {
            console.log(`⛔ ${pair} ${sig.action} ${sig.type} — skipped (RSI=0 and Stoch=0)`);
            await notifier.sendSkip(pair, sig.action, 'Signal skipped — RSI & Stoch both 0');
            continue;
          }

          console.log(`✅ SIGNAL: ${pair} ${sig.action} ${sig.type} | Score: ${sig.score}/100 | Entry: ${sig.entry?.toFixed(2)}`);
          stats.signals++;
          monitor.addTrade(sig);
          await notifier.send([sig]);
        }
      } else {
        if (DEBUG) console.log(`   ${pair} — no signal`);
      }

      await sleep(2000);

    } catch (err) {
      console.error(`❌ ${pair} error: ${err.message}`);
      pairCount++; // Still count so rate limit logic stays correct
    }
  }

  // 4. Stats summary
  const uptime = Math.round((Date.now() - stats.startTime) / 1000 / 60);
  const monitorStatus = monitor.getStatus();
  console.log(`\n📊 Stats: ${stats.signals} signals | ${monitorStatus.openTrades} open trades | Uptime: ${uptime}min`);
}

// ── Health Check Server (required by Render) ───────────────────
function startHealthServer() {
  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => {
    const uptime = Math.round((Date.now() - stats.startTime) / 1000 / 60);
    const monitorStatus = monitor.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status:     'running',
      cycles:     stats.cycles,
      signals:    stats.signals,
      openTrades: monitorStatus.openTrades,
      trades:     monitorStatus.trades,
      uptime:     `${uptime} minutes`,
      pairs:      PAIRS,
      session:    session.getSession().name,
      news:       news.getBias(),
    }));
  }).listen(PORT, () => {
    console.log(`🌐 Health check running on port ${PORT}`);
  });
}

// ── Startup ────────────────────────────────────────────────────
async function start() {
  console.log('🚀 Master Signal Agent starting...');
  console.log(`📋 Pairs: ${PAIRS.join(', ')}`);
  console.log(`⏱️  Poll interval: every 5 minutes`);
  console.log(`📌 TP/SL Monitor: active (checks every cycle)`);
  console.log(`📡 Webhook: ${process.env.DISCORD_MASTER_WEBHOOK ? '✅ connected' : '❌ MISSING'}`);
  console.log(`🔑 API Key: ${process.env.TWELVEDATA_API_KEY_MASTER ? '✅ connected' : '❌ MISSING'}`);
  console.log('');

  if (!process.env.TWELVEDATA_API_KEY_MASTER) {
    console.error('❌ FATAL: TWELVEDATA_API_KEY_MASTER not set!');
    process.exit(1);
  }
  if (!process.env.DISCORD_MASTER_WEBHOOK) {
    console.error('❌ FATAL: DISCORD_MASTER_WEBHOOK not set!');
    process.exit(1);
  }

  startHealthServer();
  await runCycle();
  setInterval(runCycle, POLL_INTERVAL_MS);
}

// ── Error handling ─────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught exception:', err.message);
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _pairBias(pair, globalBias) {
  if (pair === 'XAU/USD') return globalBias;
  if (['EUR/USD', 'GBP/USD'].includes(pair)) {
    if (globalBias === 'BEARISH_GOLD') return 'BEARISH';
    if (globalBias === 'BULLISH_GOLD') return 'BULLISH';
  }
  return 'NEUTRAL';
}

start();