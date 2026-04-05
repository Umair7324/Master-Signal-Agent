// MasterEngine.js — v2 (Apr 5 2026 audit rewrite)
// Core signal engine — analyzes all pairs, both BUY and SELL
// Multi-timeframe: 1H macro → 15min MTF → 5min signal → 1min scalp
// Confluence scoring 0-100, fires if score >= threshold
//
// CHANGELOG v2:
// - Removed GBP/USD (35.8% WR — worst pair across every dimension)
// - Blocked EUR/USD INTRADAY (39.8% WR — only SCALP allowed, raised minScore to 68)
// - Disabled XAU/USD SCALP (41.9% WR vs 54.5% INTRADAY — gold eats tight stops)
// - Redesigned _scoreSignal(): removed dead-weight macro +20, killed CCI/BB freebies,
//   flattened MTF, added SELL direction bias, capped session boost
// - New threshold: 62 (calibrated for new ~85pt max budget)
// - CCI removed from scoring (was free +4, always passed)

import {
  EMA, RSI, ATR, ADX, MACD, Stochastic, BollingerBands
} from 'technicalindicators';
import { TwelveDataClient } from './TwelveDataClient.js';

// ─── PAIR CONFIG ──────────────────────────────────────────────────
// GBP/USD: REMOVED — 35.8% WR, unsalvageable (9.1% WR in Asian, max 9 consecutive SLs)
// EUR/USD: INTRADAY blocked, SCALP only, minScore raised to 68
// XAU/USD: SCALP disabled — 41.9% WR vs 54.5% INTRADAY
const PAIR_CONFIG = {
  'XAU/USD': {
    minScore: 62, scalpMinScore: 62, cooldown: 15, intradayCooldown: 60,
    type: 'forex', minATR5m: 1.5, minATR1m: 0.5,
    scalpEnabled: false,        // XAU SCALP killed — 41.9% WR
    intradayEnabled: true,
  },
  'EUR/USD': {
    minScore: 68, scalpMinScore: 68, cooldown: 15, intradayCooldown: 60,
    type: 'forex', minATR5m: 0.0003, minATR1m: 0.0001,
    scalpEnabled: true,
    intradayEnabled: false,     // EUR INTRADAY killed — 39.8% WR
  },
  // GBP/USD: REMOVED
  'BTC/USD': {
    minScore: 62, scalpMinScore: 62, cooldown: 20, intradayCooldown: 60,
    type: 'crypto', minATR5m: 50, minATR1m: 20,
    scalpEnabled: true,
    intradayEnabled: true,
  },
  'ETH/USD': {
    minScore: 62, scalpMinScore: 62, cooldown: 20, intradayCooldown: 60,
    type: 'crypto', minATR5m: 3.0, minATR1m: 1.0,
    scalpEnabled: true,
    intradayEnabled: true,
  },
};

export class MasterEngine {
  constructor() {
    this.cooldowns = new Map();
    this.tdClient  = new TwelveDataClient();
  }

  // ─── MAIN ENTRY ───────────────────────────────────────────────
  async analyze(pair, newsBias, sessionBoost = 0) {
    const config = PAIR_CONFIG[pair];
    if (!config) {
      console.log(`⛔ ${pair} — not in PAIR_CONFIG, skipping`);
      return null;
    }

    const signals = [];

    try {
      const candles1H  = await this._fetchCandles(pair, '1h',    100); await this._sleep(500);
      const candles15m = await this._fetchCandles(pair, '15min', 100); await this._sleep(500);
      const candles5m  = await this._fetchCandles(pair, '5min',  100); await this._sleep(500);
      const candles1m  = await this._fetchCandles(pair, '1min',   50);

      if (!candles1H || !candles15m || !candles5m || !candles1m) return null;

      // ── Layer 1: 1H Macro ──────────────────────────────────────
      const macro = this._getMacro(candles1H);
      if (macro.trend === 'NEUTRAL') return null;

      // ── Layer 2: 15min MTF ────────────────────────────────────
      const mtf = this._getMTF(candles15m);

      // ── Layer 3: 5min Signal ──────────────────────────────────
      const signal5m = this._getSignal(candles5m);

      // ── Layer 4: 1min Scalp Entry ─────────────────────────────
      const scalp1m = this._getScalpEntry(candles1m);

      // ── Layer 5: Candle Pattern Detection (5min) ──────────────
      const patterns = this._getCandlePatterns(candles5m);

      const currentPrice = candles1m[candles1m.length - 1].close;
      const atr1m = this._getATR(candles1m, 14);
      const atr5m = this._getATR(candles5m, 14);

      // ── Try BUY Signal ─────────────────────────────────────────
      if (macro.trend === 'BULLISH') {
        const buyScore = this._scoreSignal({
          action: 'BUY',
          macro, mtf, signal5m, scalp1m, patterns,
          newsBias: this._newsBiasForPair(pair, newsBias),
          sessionBoost
        });

        // INTRADAY BUY — gated by intradayEnabled
        if (config.intradayEnabled &&
            buyScore.total >= config.minScore &&
            !this._inCooldown(pair, 'BUY', 'intraday', config.intradayCooldown)) {
          if (atr5m < config.minATR5m) {
            console.log(`⛔ ${pair} BUY INTRADAY — skipped (ATR ${atr5m.toFixed(4)} < min ${config.minATR5m})`);
          } else {
            const entry = currentPrice;
            const sl = entry - (atr5m * 2.0);
            const tp = entry + (atr5m * 2.0 * 1.2);
            signals.push({
              pair, action: 'BUY', type: 'INTRADAY',
              entry, sl, tp, rr: 1.2,
              score: buyScore.total, breakdown: buyScore.breakdown,
              macro: macro.trend, mtf: mtf.trend, atr: atr5m
            });
            this._setCooldown(pair, 'BUY', 'intraday');
          }
        }

        // SCALP BUY — gated by scalpEnabled
        if (config.scalpEnabled &&
            scalp1m.pullbackValid &&
            buyScore.total >= config.scalpMinScore &&
            !this._inCooldown(pair, 'BUY', 'scalp', config.cooldown)) {
          if (atr1m < config.minATR1m) {
            console.log(`⛔ ${pair} BUY SCALP — skipped (ATR1m ${atr1m.toFixed(4)} < min ${config.minATR1m})`);
          } else {
            const entry = currentPrice;
            const sl = entry - (atr1m * 0.8);
            const tp = entry + (atr1m * 0.8 * 1.5);
            signals.push({
              pair, action: 'BUY', type: 'SCALP',
              entry, sl, tp, rr: 1.5,
              score: buyScore.total, breakdown: buyScore.breakdown,
              macro: macro.trend, mtf: mtf.trend, atr: atr1m
            });
            this._setCooldown(pair, 'BUY', 'scalp');
          }
        }
      }

      // ── Try SELL Signal ────────────────────────────────────────
      if (macro.trend === 'BEARISH') {
        const sellScore = this._scoreSignal({
          action: 'SELL',
          macro, mtf, signal5m, scalp1m, patterns,
          newsBias: this._newsBiasForPair(pair, newsBias),
          sessionBoost
        });

        // INTRADAY SELL — gated by intradayEnabled
        if (config.intradayEnabled &&
            sellScore.total >= config.minScore &&
            !this._inCooldown(pair, 'SELL', 'intraday', config.intradayCooldown)) {
          if (atr5m < config.minATR5m) {
            console.log(`⛔ ${pair} SELL INTRADAY — skipped (ATR ${atr5m.toFixed(4)} < min ${config.minATR5m})`);
          } else {
            const entry = currentPrice;
            const sl = entry + (atr5m * 2.0);
            const tp = entry - (atr5m * 2.0 * 1.2);
            signals.push({
              pair, action: 'SELL', type: 'INTRADAY',
              entry, sl, tp, rr: 1.2,
              score: sellScore.total, breakdown: sellScore.breakdown,
              macro: macro.trend, mtf: mtf.trend, atr: atr5m
            });
            this._setCooldown(pair, 'SELL', 'intraday');
          }
        }

        // SCALP SELL — gated by scalpEnabled
        if (config.scalpEnabled &&
            scalp1m.pullbackValid &&
            sellScore.total >= config.scalpMinScore &&
            !this._inCooldown(pair, 'SELL', 'scalp', config.cooldown)) {
          if (atr1m < config.minATR1m) {
            console.log(`⛔ ${pair} SELL SCALP — skipped (ATR1m ${atr1m.toFixed(4)} < min ${config.minATR1m})`);
          } else {
            const entry = currentPrice;
            const sl = entry + (atr1m * 0.8);
            const tp = entry - (atr1m * 0.8 * 1.5);
            signals.push({
              pair, action: 'SELL', type: 'SCALP',
              entry, sl, tp, rr: 1.5,
              score: sellScore.total, breakdown: sellScore.breakdown,
              macro: macro.trend, mtf: mtf.trend, atr: atr1m
            });
            this._setCooldown(pair, 'SELL', 'scalp');
          }
        }
      }

      return signals.length > 0 ? signals : null;

    } catch (err) {
      console.error(`[${pair}] Analysis error:`, err.message);
      return null;
    }
  }

  // ─── CONFLUENCE SCORING v2 ─────────────────────────────────────
  // Max score = ~85 (clamp 100). New threshold = 62.
  //
  // v2 changes vs v1:
  //  Component        v1 pts    v2 pts    Why
  //  ─────────────────────────────────────────────────────────
  //  Macro align      +20 free  removed   Always true, zero discriminative power
  //  Macro ADX        +0/5/8    +0/4/8/12 Merged — now the only macro component
  //  MTF 15m          +0/4/12   +2/4/6    Flattened — aligned ≈ neutral WR in data
  //  5m signal        +10       +12       Promoted — actual signal timeframe
  //  RSI              +0/4/8    +0/4/8    Tighter ranges
  //  MACD             +8        +6        Reduced — lagging on 5m
  //  Stoch            +6        +3        Reduced — noisy on 5m
  //  CCI              +4        REMOVED   Free points, always passed
  //  BB               +4        +0/5      Fixed — no more "or MIDDLE" freebie
  //  News             +12/-8    +10/-10   Increased penalty (pipeline was dead)
  //  Session          +0-15     +0-10     Capped lower, rebalanced
  //  Patterns         +10/-6    +8/-6     Slight reduce
  //  Direction bias   N/A       +5 SELL   NEW — SELL 48.7% vs BUY 44.4%
  //  ─────────────────────────────────────────────────────────
  //  Old max: 117     New max: ~85
  _scoreSignal({ action, macro, mtf, signal5m, scalp1m, patterns, newsBias, sessionBoost }) {
    const breakdown = {};
    let total = 0;

    // 1. Macro trend strength via ADX (max 12pts)
    //    Replaces old free +20 alignment + separate ADX component.
    //    Now: only earn points for STRONG trends.
    breakdown.macro = macro.adx > 35 ? 12 :
                      macro.adx > 28 ? 8  :
                      macro.adx > 22 ? 4  : 0;
    total += breakdown.macro;

    // 2. 15min MTF alignment (max 6pts) — FLATTENED
    //    Data: aligned=45.9% WR, neutral=46.2% WR, opposing=76.9% WR (n=13)
    //    Old 12/4/0 spread was not justified. Opposing gets small bonus.
    const mtfAligned = (action === 'BUY' && mtf.trend === 'BULLISH') ||
                       (action === 'SELL' && mtf.trend === 'BEARISH');
    const mtfOpposing = (action === 'BUY' && mtf.trend === 'BEARISH') ||
                        (action === 'SELL' && mtf.trend === 'BULLISH');
    breakdown.mtf = mtfAligned ? 6 : mtfOpposing ? 2 : 4;
    total += breakdown.mtf;

    // 3. 5min signal aligned (max 12pts) — PROMOTED from 10
    const signalAligned = (action === 'BUY' && signal5m.bias === 'BULLISH') ||
                          (action === 'SELL' && signal5m.bias === 'BEARISH');
    breakdown.signal5m = signalAligned ? 12 : 0;
    total += breakdown.signal5m;

    // 4. RSI confirmation (max 8pts) — tighter ranges
    if (action === 'BUY') {
      breakdown.rsi = (signal5m.rsi > 45 && signal5m.rsi < 60) ? 8 :
                      (signal5m.rsi > 35 && signal5m.rsi < 65) ? 4 : 0;
    } else {
      breakdown.rsi = (signal5m.rsi > 40 && signal5m.rsi < 55) ? 8 :
                      (signal5m.rsi > 35 && signal5m.rsi < 65) ? 4 : 0;
    }
    total += breakdown.rsi;

    // 5. MACD confirmation (max 6pts) — reduced from 8
    const macdAligned = (action === 'BUY' && signal5m.macdHist > 0) ||
                        (action === 'SELL' && signal5m.macdHist < 0);
    breakdown.macd = macdAligned ? 6 : 0;
    total += breakdown.macd;

    // 6. Stochastic (max 3pts) — reduced from 6
    const stochOk = (action === 'BUY' && signal5m.stochK < 75 && signal5m.stochK > signal5m.stochD) ||
                    (action === 'SELL' && signal5m.stochK > 25 && signal5m.stochK < signal5m.stochD);
    breakdown.stoch = stochOk ? 3 : 0;
    total += breakdown.stoch;

    // 7. CCI — REMOVED (was +4 free points, range too wide, always passed)

    // 8. Bollinger Bands (max 5pts) — FIXED
    //    Bug fix: removed "|| bbPosition === 'MIDDLE'" which gave free +4 ~80% of the time
    const bbEdge = (action === 'BUY' && signal5m.bbPosition === 'LOWER') ||
                   (action === 'SELL' && signal5m.bbPosition === 'UPPER');
    breakdown.bb = bbEdge ? 5 : 0;
    total += breakdown.bb;

    // 9. News bias (max 10pts / -10pts penalty)
    //    NOTE: News pipeline was dead (always NEUTRAL) as of Apr 5 2026.
    //    When fixed, this will provide real edge. Penalty increased.
    const newsAligned = (action === 'BUY' && ['BULLISH_GOLD', 'BULLISH', 'SLIGHT_BULLISH_GOLD', 'SLIGHT_BULLISH'].includes(newsBias)) ||
                        (action === 'SELL' && ['BEARISH_GOLD', 'BEARISH', 'SLIGHT_BEARISH_GOLD', 'SLIGHT_BEARISH'].includes(newsBias));
    const newsOpposite = (action === 'BUY' && ['BEARISH_GOLD', 'BEARISH'].includes(newsBias)) ||
                         (action === 'SELL' && ['BULLISH_GOLD', 'BULLISH'].includes(newsBias));
    breakdown.news = newsAligned ? 10 : newsOpposite ? -10 : 0;
    total += breakdown.news;

    // 10. Session boost (max 10pts) — CAPPED from 15
    breakdown.session = Math.min(sessionBoost, 10);
    total += breakdown.session;

    // 11. Candle patterns (max 8pts / -6pts) — slightly reduced from 10
    if (patterns) {
      const aligned  = action === 'BUY' ? patterns.bullishCount : patterns.bearishCount;
      const opposing = action === 'BUY' ? patterns.bearishCount : patterns.bullishCount;
      const patternScore = Math.min(aligned * 4, 8) - (opposing * 3);
      breakdown.patterns = Math.max(-6, patternScore);
    } else {
      breakdown.patterns = 0;
    }
    total += breakdown.patterns;

    // 12. Direction bias (max 5pts) — NEW
    //     SELL: 48.7% WR vs BUY: 44.4% across 1,097 signals.
    //     Consistent edge on XAU (+6.7%), BTC (+7.9%), ETH (+2.9%).
    breakdown.directionBias = (action === 'SELL') ? 5 : 0;
    total += breakdown.directionBias;

    // Clamp 0-100
    total = Math.max(0, Math.min(100, total));

    return { total: Math.round(total), breakdown };
  }

  // ─── MACRO ANALYSIS (1H) ──────────────────────────────────────
  _getMacro(candles) {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const ema21 = EMA.calculate({ period: 21, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const adxVals = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

    const lastEma21 = ema21[ema21.length - 1];
    const lastEma50 = ema50[ema50.length - 1];
    const lastPrice = closes[closes.length - 1];
    const lastAdx   = adxVals[adxVals.length - 1]?.adx || 0;

    let trend = 'NEUTRAL';
    if (lastAdx >= 20) {
      if (lastEma21 > lastEma50 && lastPrice > lastEma21) trend = 'BULLISH';
      else if (lastEma21 < lastEma50 && lastPrice < lastEma21) trend = 'BEARISH';
    }

    return { trend, adx: lastAdx, ema21: lastEma21, ema50: lastEma50, price: lastPrice };
  }

  // ─── MTF ANALYSIS (15min) ─────────────────────────────────────
  _getMTF(candles) {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const ema9  = EMA.calculate({ period: 9,  values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });
    const adxVals = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

    const lastEma9  = ema9[ema9.length - 1];
    const lastEma21 = ema21[ema21.length - 1];
    const lastPrice = closes[closes.length - 1];
    const lastAdx   = adxVals[adxVals.length - 1]?.adx || 0;

    let trend = 'NEUTRAL';
    if (lastAdx >= 18) {
      if (lastEma9 > lastEma21 && lastPrice > lastEma9) trend = 'BULLISH';
      else if (lastEma9 < lastEma21 && lastPrice < lastEma9) trend = 'BEARISH';
    }

    return { trend, adx: lastAdx };
  }

  // ─── SIGNAL ANALYSIS (5min) ───────────────────────────────────
  _getSignal(candles) {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const ema9  = EMA.calculate({ period: 9,  values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });

    const rsiVals  = RSI.calculate({ period: 14, values: closes });
    const macdVals = MACD.calculate({
      fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, values: closes
    });
    const stochVals = Stochastic.calculate({
      period: 14, signalPeriod: 3, high: highs, low: lows, close: closes
    });
    const bbVals = BollingerBands.calculate({
      period: 20, stdDev: 2, values: closes
    });

    const price   = closes[closes.length - 1];
    const lastBB  = bbVals[bbVals.length - 1];

    let bbPosition = 'MIDDLE';
    if (lastBB) {
      if (price <= lastBB.lower * 1.002)      bbPosition = 'LOWER';
      else if (price >= lastBB.upper * 0.998) bbPosition = 'UPPER';
    }

    const lastEma9  = ema9[ema9.length - 1];
    const lastEma21 = ema21[ema21.length - 1];

    let bias = 'NEUTRAL';
    if (lastEma9 > lastEma21 && price > lastEma9)       bias = 'BULLISH';
    else if (lastEma9 < lastEma21 && price < lastEma9)  bias = 'BEARISH';

    return {
      bias,
      rsi:      rsiVals[rsiVals.length - 1] || 50,
      macdHist: macdVals[macdVals.length - 1]?.histogram || 0,
      stochK:   stochVals[stochVals.length - 1]?.k || 50,
      stochD:   stochVals[stochVals.length - 1]?.d || 50,
      bbPosition,
      ema9: lastEma9, ema21: lastEma21, price
    };
  }

  // ─── CANDLE PATTERN DETECTION (5min) ─────────────────────────
  _getCandlePatterns(candles) {
    const len = candles.length;
    if (len < 5) return { bullishCount: 0, bearishCount: 0 };

    const last  = candles[len - 1];
    const prev  = candles[len - 2];
    const prev2 = candles[len - 3];

    let bullishCount = 0;
    let bearishCount = 0;

    // ── Engulfing ──────────────────────────────────────────────
    const lastBody = Math.abs(last.close - last.open);
    const prevBody = Math.abs(prev.close - prev.open);
    const lastBullish = last.close > last.open;
    const prevBullish = prev.close > prev.open;

    const bullishEngulf = !prevBullish && lastBullish &&
                          last.open  <= prev.close &&
                          last.close >= prev.open  &&
                          lastBody    > prevBody;

    const bearishEngulf = prevBullish && !lastBullish &&
                          last.open  >= prev.close &&
                          last.close <= prev.open  &&
                          lastBody    > prevBody;

    if (bullishEngulf) bullishCount++;
    if (bearishEngulf) bearishCount++;

    // ── Pin Bar ────────────────────────────────────────────────
    const lastRange  = last.high - last.low;
    const lastLowWick  = Math.min(last.open, last.close) - last.low;
    const lastHighWick = last.high - Math.max(last.open, last.close);

    if (lastRange > 0) {
      const bodyRatio = lastBody / lastRange;
      if (bodyRatio < 0.35) {
        if (lastLowWick >= lastBody * 2)  bullishCount++;
        if (lastHighWick >= lastBody * 2) bearishCount++;
      }
    }

    // ── CHoCH (Change of Character) ───────────────────────────
    const wasLowerHighs = prev.high < prev2.high;
    const brokeHighUp   = last.close > prev.high;
    if (wasLowerHighs && brokeHighUp) bullishCount++;

    const wasHigherLows = prev.low > prev2.low;
    const brokeLowDown  = last.close < prev.low;
    if (wasHigherLows && brokeLowDown) bearishCount++;

    return {
      bullishEngulf, bearishEngulf,
      bullishCount, bearishCount,
    };
  }

  // ─── SCALP ENTRY CHECK (1min) ─────────────────────────────────
  _getScalpEntry(candles) {
    const closes = candles.map(c => c.close);
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);

    const ema21   = EMA.calculate({ period: 21, values: closes });
    const atrVals = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
    const rsiVals = RSI.calculate({ period: 14, values: closes });

    const lastEma21 = ema21[ema21.length - 1];
    const lastATR   = atrVals[atrVals.length - 1];
    const lastPrice = closes[closes.length - 1];
    const lastRSI   = rsiVals[rsiVals.length - 1];

    const distance = Math.abs(lastPrice - lastEma21);
    const pullbackValid = distance <= lastATR * 0.4;

    return { pullbackValid, ema21: lastEma21, atr: lastATR, rsi: lastRSI, price: lastPrice };
  }

  // ─── ATR HELPER ───────────────────────────────────────────────
  _getATR(candles, period = 14) {
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const vals   = ATR.calculate({ period, high: highs, low: lows, close: closes });
    return vals[vals.length - 1] || 0;
  }

  // ─── NEWS BIAS FOR PAIR ───────────────────────────────────────
  _newsBiasForPair(pair, globalBias) {
    if (pair === 'XAU/USD') return globalBias;
    if (pair === 'EUR/USD') {
      if (globalBias === 'BEARISH_GOLD') return 'BEARISH';
      if (globalBias === 'BULLISH_GOLD') return 'BULLISH';
      if (globalBias === 'SLIGHT_BEARISH_GOLD') return 'SLIGHT_BEARISH';
      if (globalBias === 'SLIGHT_BULLISH_GOLD') return 'SLIGHT_BULLISH';
    }
    return 'NEUTRAL';
  }

  // ─── COOLDOWN HELPERS ─────────────────────────────────────────
  _cooldownKey(pair, direction, type) {
    return `${pair}:${direction}:${type}`;
  }

  _inCooldown(pair, direction, type, minutes) {
    const key = this._cooldownKey(pair, direction, type);
    const last = this.cooldowns.get(key);
    if (!last) return false;
    return Date.now() - last < minutes * 60 * 1000;
  }

  _setCooldown(pair, direction, type) {
    this.cooldowns.set(this._cooldownKey(pair, direction, type), Date.now());
  }

  // ─── TWELVEDATA FETCHER ───────────────────────────────────────
  async _fetchCandles(pair, interval, outputSize = 100) {
    return this.tdClient.fetchCandles(pair, interval, outputSize);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}