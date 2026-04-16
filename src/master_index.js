// master_index.js — v3 (Apr 16 2026 calibration fix)
// Master Signal Agent — Main Entry Point
// Runs 24/7 (Render Web Service), polls every 5 minutes
// Covers: XAU/USD, EUR/USD (SCALP only), BTC/USD, ETH/USD
// Signals: BUY + SELL | SCALP + INTRADAY
// TP/SL Monitor: pings Discord when trade closes
//
// CHANGELOG v3 (Apr 16 2026):
// - Rejection logger wired up — every rejected signal is logged with full
//   breakdown so we can diagnose why signals aren't firing.
// - Filter 2 softened: now requires RSI=0 AND Stoch=0 AND MACD=0 (all three)
//   instead of just RSI + Stoch. This lets trend-continuation signals through
//   (RSI 65+ in strong trends was killing legit setups).
// - XAU London block REMOVED — the 29.6% WR was driven by XAU SCALP (already
//   disabled). XAU INTRADAY London was 47.6% and new scoring will filter the
//   weak ones naturally. Rejection log will tell us if this was wrong.
// - /rejections endpoint added to health server for live debugging.

import 'dotenv/config';
import { MasterEngine }     from './MasterEngine.js';
import { DiscordNotifier }  from './DiscordNotifier.js';
import { SessionManager }   from './SessionManager.js';
import { NewsCache }        from './NewsCache.js';
import { TradeMonitor }     from './TradeMonitor.js';
import { RejectionLogger }  from './RejectionLogger.js';
import http                 from 'http';

// ── Config ─────────────────────────────────────────────────────
const PAIRS = [
  'XAU/USD',
  'EUR/USD',
  // 'GBP/USD' removed — 35.5% WR, -0.225R EV
  'BTC/USD',
  'ETH/USD',
];

const POLL_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const DEBUG = process.env.DEBUG_MODE === 'true';

// ── Instances ──────────────────────────────────────────────────
const logger   = new RejectionLogger();
const engine   = new MasterEngine({ logger });
const notifier = new DiscordNotifier();
const session  = new SessionManager();
const news     = new NewsCache();
const monitor  = new TradeMonitor();

// ── Stats ──────────────────────────────────────────────────────
let stats = {
  cycles:    0,
  signals:   0,
  rejections: 0,
  startTime: Date.now(),
};

// ── Main Cycle ─────────────────────────────────────────────────
async function runCycle() {
  stats.cycles++;
  logger.resetCycleCounter();
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
  // ⚠️  Rate limit: TwelveData free = 8 credits/min. Crypto now uses Binance
  //     (no rate limit), so we only need the pause between forex pairs.
  let forexPairCount = 0;

  for (const pair of PAIRS) {
    const isCrypto = ['BTC/USD', 'ETH/USD'].includes(pair);

    if (!isCrypto && !session.shouldAnalyze(pair)) {
      if (DEBUG) console.log(`⏸️  ${pair} — skipped (off-hours for forex)`);
      logger.log({ pair, reason: 'off_hours_forex', notes: currentSession.name });
      continue;
    }

    // ── Session-based pair guards (backtest-driven) ──────────────
    // ETH/USD + EUR/USD in Asian session: <30% WR in old data
    if (['ETH/USD', 'EUR/USD'].includes(pair) && currentSession.name === 'Asian') {
      console.log(`⛔ ${pair} — blocked (Asian session, <30% WR)`);
      logger.log({ pair, reason: 'blocked_asian_session' });
      continue;
    }
    // XAU/USD London block REMOVED in v3. The 29.6% WR was driven by XAU
    // SCALP (already disabled). New scoring will filter weak XAU INTRADAY
    // signals naturally. Monitor rejection log to verify.

    // Pause only between FOREX pairs (crypto uses Binance, no rate limit)
    if (!isCrypto && forexPairCount > 0 && forexPairCount % 2 === 0) {
      console.log(`⏳ Rate limit pause (65s) before ${pair}...`);
      await sleep(65000);
    }

    try {
      if (DEBUG) console.log(`🔍 Analyzing ${pair}...`);

      const signals = await engine.analyze(pair, newsBias, currentSession.boost);
      if (!isCrypto) forexPairCount++;

      if (signals && signals.length > 0) {
        const pairBias = _pairBias(pair, newsBias);

        // ── Spread Gate ─────────────────────────────────────────
        // NOTE: Live spread check requires MT5 connection.
        // When MT5 is disabled, spread guard is skipped — filter manually
        // via Discord signal review before entering trades.

        for (const sig of signals) {

          // Filter 1: News bias conflict — skip BUY when news is strongly bearish
          if (sig.action === 'BUY' && ['BEARISH_GOLD', 'BEARISH'].includes(pairBias)) {
            console.log(`⛔ ${pair} ${sig.action} ${sig.type} — skipped (news bias conflict: ${pairBias})`);
            logger.log({
              pair, action: sig.action, type: sig.type,
              score: sig.score, minScore: null,
              reason: 'news_bias_conflict',
              breakdown: sig.breakdown,
              macroTrend: sig.macro, mtfTrend: sig.mtf,
              notes: `pairBias=${pairBias}`
            });
            await notifier.sendSkip(pair, sig.action, 'Signal skipped — News bias conflict');
            continue;
          }

          // Filter 2: No momentum at all (all three zero — RSI, Stoch, MACD)
          //   v3: softened from "RSI=0 AND Stoch=0" to require MACD=0 too.
          //   In strong trends, RSI 65+ triggers RSI=0 under new ranges, and
          //   Stoch overbought triggers Stoch=0 — but MACD should still be
          //   aligned. Requiring all three zero = "no momentum anywhere".
          if (sig.breakdown.rsi === 0 && sig.breakdown.stoch === 0 && sig.breakdown.macd === 0) {
            console.log(`⛔ ${pair} ${sig.action} ${sig.type} — skipped (RSI=0, Stoch=0, MACD=0)`);
            logger.log({
              pair, action: sig.action, type: sig.type,
              score: sig.score, minScore: null,
              reason: 'no_momentum',
              breakdown: sig.breakdown,
              macroTrend: sig.macro, mtfTrend: sig.mtf
            });
            await notifier.sendSkip(pair, sig.action, 'Signal skipped — No momentum (RSI+Stoch+MACD all 0)');
            continue;
          }

          // Filter 3: EUR/USD INTRADAY — 39.8% WR in backtest
          if (pair === 'EUR/USD' && sig.type === 'INTRADAY') {
            console.log(`⛔ EUR/USD INTRADAY — blocked (39.8% WR, negative EV)`);
            logger.log({
              pair, action: sig.action, type: sig.type,
              score: sig.score, reason: 'eur_intraday_blocked',
              breakdown: sig.breakdown,
              macroTrend: sig.macro, mtfTrend: sig.mtf
            });
            continue;
          }

          // Filter 4: Ghost signal guard — drop if missing score or entry price
          if (!sig.score || !sig.entry) {
            console.warn(`⚠️  ${pair} ${sig.action} ${sig.type} — dropped (missing score or entry)`);
            logger.log({
              pair, action: sig.action, type: sig.type,
              score: sig.score ?? null, reason: 'ghost_signal',
              notes: `score=${sig.score} entry=${sig.entry}`
            });
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
      if (!isCrypto) forexPairCount++;
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
    // /rejections endpoint — dumps recent rejection log rows for debugging
    if (req.url && req.url.startsWith('/rejections')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(logger.getRecent(50));
      return;
    }

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
      version:    'v3-apr16-2026',
      rejections_url: '/rejections',
    }));
  }).listen(PORT, () => {
    console.log(`🌐 Health check running on port ${PORT}`);
    console.log(`   → /rejections for live rejection log`);
  });
}

// ── Startup ────────────────────────────────────────────────────
async function start() {
  console.log('🚀 Master Signal Agent starting (v3 — Apr 16 2026)...');
  console.log(`📋 Pairs: ${PAIRS.join(', ')}`);
  console.log(`⏱️  Poll interval: every 5 minutes`);
  console.log(`📌 TP/SL Monitor: active (checks every cycle)`);
  console.log(`📡 Webhook: ${process.env.DISCORD_MASTER_WEBHOOK ? '✅ connected' : '❌ MISSING'}`);
  console.log(`🐛 Debug webhook: ${process.env.DISCORD_DEBUG_WEBHOOK ? '✅ connected' : '(not set — rejections go to file/console only)'}`);

  const keyCount = [1,2,3,4,5,6,7,8,9,10,11,12].filter(i => process.env[`TWELVEDATA_API_KEY_${i}`]).length
    || (process.env.TWELVEDATA_API_KEY_MASTER ? 1 : 0);
  console.log(`🔑 TwelveData keys: ${keyCount > 0 ? `✅ ${keyCount} key(s)` : '❌ MISSING'}`);
  console.log(`🟡 Binance: enabled for BTC/ETH (no key needed)`);
  console.log('');

  const hasAnyKey = [1,2,3,4,5,6,7,8,9,10,11,12].some(i => process.env[`TWELVEDATA_API_KEY_${i}`])
    || !!process.env.TWELVEDATA_API_KEY_MASTER;
  if (!hasAnyKey) {
    console.error('❌ FATAL: No TwelveData API keys found! Set TWELVEDATA_API_KEY_1 ... _12');
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
  if (pair === 'EUR/USD') {
    if (globalBias === 'BEARISH_GOLD') return 'BEARISH';
    if (globalBias === 'BULLISH_GOLD') return 'BULLISH';
  }
  return 'NEUTRAL';
}

start();