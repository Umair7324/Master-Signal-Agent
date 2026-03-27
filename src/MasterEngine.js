// MasterEngine.js
// Core signal engine — analyzes all pairs, both BUY and SELL
// Multi-timeframe: 1H macro → 15min MTF → 5min signal → 1min scalp
// Confluence scoring 0-100, fires if score >= threshold

import {
  EMA, RSI, ATR, ADX, MACD, Stochastic, BollingerBands, CCI
} from 'technicalindicators';
import { TwelveDataClient } from './TwelveDataClient.js';

// Pair-specific config
// minATR5m / minATR1m: minimum ATR required to fire a signal.
// Protects against stale/frozen API data (e.g. XAU showing ATR 0.16 instead of 3+)
const PAIR_CONFIG = {
  'XAU/USD':  { minScore: 75, scalpMinScore: 72, cooldown: 15, intradayCooldown: 60, type: 'forex',  minATR5m: 1.5,      minATR1m: 0.5      },
  'EUR/USD':  { minScore: 75, scalpMinScore: 72, cooldown: 15, intradayCooldown: 60, type: 'forex',  minATR5m: 0.0003,   minATR1m: 0.0001   },
  'GBP/USD':  { minScore: 75, scalpMinScore: 72, cooldown: 15, intradayCooldown: 60, type: 'forex',  minATR5m: 0.0004,   minATR1m: 0.00015  },
  'BTC/USD':  { minScore: 75, scalpMinScore: 72, cooldown: 20, intradayCooldown: 60, type: 'crypto', minATR5m: 50,       minATR1m: 20       },
  'ETH/USD':  { minScore: 75, scalpMinScore: 72, cooldown: 20, intradayCooldown: 60, type: 'crypto', minATR5m: 3.0,      minATR1m: 1.0      },
};

export class MasterEngine {
  constructor() {
    // Cooldown tracking: { "XAU/USD:BUY:scalp": lastSignalTime, ... }
    this.cooldowns = new Map();
    this.tdClient  = new TwelveDataClient();
  }

  // ─── MAIN ENTRY ───────────────────────────────────────────────
  async analyze(pair, newsBias, sessionBoost = 0) {
    const signals = [];

    try {
      // Fetch timeframes sequentially — 500ms gap prevents burst on TwelveData rate limiter
      const candles1H  = await this._fetchCandles(pair, '1h',    100); await this._sleep(500);
      const candles15m = await this._fetchCandles(pair, '15min', 100); await this._sleep(500);
      const candles5m  = await this._fetchCandles(pair, '5min',  100); await this._sleep(500);
      const candles1m  = await this._fetchCandles(pair, '1min',   50);

      if (!candles1H || !candles15m || !candles5m || !candles1m) return null;

      // ── Layer 1: 1H Macro ──────────────────────────────────────
      const macro = this._getMacro(candles1H);
      if (macro.trend === 'NEUTRAL') return null; // No clear trend = no signal

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

      const config = PAIR_CONFIG[pair];

      // ── Try BUY Signal ─────────────────────────────────────────
      if (macro.trend === 'BULLISH') {
        const buyScore = this._scoreSignal({
          action: 'BUY',
          macro, mtf, signal5m, scalp1m, patterns,
          newsBias: this._newsBiasForPair(pair, newsBias),
          sessionBoost
        });

        // INTRADAY BUY
        if (buyScore.total >= config.minScore && !this._inCooldown(pair, 'BUY', 'intraday', config.intradayCooldown)) {
          // ATR guard: reject stale/frozen data
          if (atr5m < config.minATR5m) {
            console.log(`⛔ ${pair} BUY INTRADAY — skipped (ATR ${atr5m.toFixed(4)} < min ${config.minATR5m})`);
          } else {
          const entry = currentPrice;
          const sl = entry - (atr5m * 2.0);
          const tp = entry + (atr5m * 2.0 * 1.2); // RR 1:1.2
          signals.push({
            pair, action: 'BUY', type: 'INTRADAY',
            entry, sl, tp, rr: 1.2,
            score: buyScore.total, breakdown: buyScore.breakdown,
            macro: macro.trend, atr: atr5m
          });
          this._setCooldown(pair, 'BUY', 'intraday');
          }
        }

        // SCALP BUY (1min entry)
        if (scalp1m.pullbackValid && buyScore.total >= config.scalpMinScore && 
            !this._inCooldown(pair, 'BUY', 'scalp', config.cooldown)) {
          // ATR guard: reject stale/frozen data
          if (atr1m < config.minATR1m) {
            console.log(`⛔ ${pair} BUY SCALP — skipped (ATR1m ${atr1m.toFixed(4)} < min ${config.minATR1m})`);
          } else {
          const entry = currentPrice;
          const sl = entry - (atr1m * 0.8);
          const tp = entry + (atr1m * 0.8 * 1.5); // RR 1:1.5
          signals.push({
            pair, action: 'BUY', type: 'SCALP',
            entry, sl, tp, rr: 1.5,
            score: buyScore.total, breakdown: buyScore.breakdown,
            macro: macro.trend, atr: atr1m
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

        // INTRADAY SELL
        if (sellScore.total >= config.minScore && !this._inCooldown(pair, 'SELL', 'intraday', config.intradayCooldown)) {
          // ATR guard: reject stale/frozen data
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
            macro: macro.trend, atr: atr5m
          });
          this._setCooldown(pair, 'SELL', 'intraday');
          }
        }

        // SCALP SELL
        if (scalp1m.pullbackValid && sellScore.total >= config.scalpMinScore &&
            !this._inCooldown(pair, 'SELL', 'scalp', config.cooldown)) {
          // ATR guard: reject stale/frozen data
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
            macro: macro.trend, atr: atr1m
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

  // ─── CONFLUENCE SCORING ───────────────────────────────────────
  // Max score = 110 (clamp 100). Min to fire = 75 (intraday) / 72 (scalp)
  // Candle patterns add up to 10pts — gate-opener for borderline signals
  _scoreSignal({ action, macro, mtf, signal5m, scalp1m, patterns, newsBias, sessionBoost }) {
    const breakdown = {};
    let total = 0;

    // 1. Macro aligned with signal direction (max 20pts)
    const macroAligned = (action === 'BUY' && macro.trend === 'BULLISH') ||
                         (action === 'SELL' && macro.trend === 'BEARISH');
    breakdown.macro = macroAligned ? 20 : 0;
    total += breakdown.macro;

    // 2. Macro strength — ADX (max 8pts)
    breakdown.macroStrength = macro.adx > 35 ? 8 : macro.adx > 25 ? 5 : 0;
    total += breakdown.macroStrength;

    // 3. 15min MTF aligned (max 12pts)
    const mtfAligned = (action === 'BUY' && mtf.trend === 'BULLISH') ||
                       (action === 'SELL' && mtf.trend === 'BEARISH');
    breakdown.mtf = mtfAligned ? 12 : mtf.trend === 'NEUTRAL' ? 4 : 0;
    total += breakdown.mtf;

    // 4. 5min signal aligned (max 10pts)
    const signalAligned = (action === 'BUY' && signal5m.bias === 'BULLISH') ||
                          (action === 'SELL' && signal5m.bias === 'BEARISH');
    breakdown.signal5m = signalAligned ? 10 : 0;
    total += breakdown.signal5m;

    // 5. RSI confirmation (max 8pts)
    // BUY: RSI 40-60 with upward momentum (not overbought)
    // SELL: RSI 40-60 with downward momentum (not oversold)
    if (action === 'BUY') {
      breakdown.rsi = (signal5m.rsi > 40 && signal5m.rsi < 65) ? 8 :
                      (signal5m.rsi > 30 && signal5m.rsi < 70) ? 4 : 0;
    } else {
      breakdown.rsi = (signal5m.rsi > 35 && signal5m.rsi < 60) ? 8 :
                      (signal5m.rsi > 30 && signal5m.rsi < 70) ? 4 : 0;
    }
    total += breakdown.rsi;

    // 6. MACD confirmation (max 8pts)
    const macdAligned = (action === 'BUY' && signal5m.macdHist > 0) ||
                        (action === 'SELL' && signal5m.macdHist < 0);
    breakdown.macd = macdAligned ? 8 : 0;
    total += breakdown.macd;

    // 7. Stochastic (max 6pts)
    const stochOk = (action === 'BUY' && signal5m.stochK < 80 && signal5m.stochK > signal5m.stochD) ||
                    (action === 'SELL' && signal5m.stochK > 20 && signal5m.stochK < signal5m.stochD);
    breakdown.stoch = stochOk ? 6 : 0;
    total += breakdown.stoch;

    // 8. CCI (max 4pts)
    const cciOk = (action === 'BUY' && signal5m.cci > -100 && signal5m.cci < 200) ||
                  (action === 'SELL' && signal5m.cci < 100 && signal5m.cci > -200);
    breakdown.cci = cciOk ? 4 : 0;
    total += breakdown.cci;

    // 9. Bollinger Bands (max 4pts)
    // BUY: price bouncing off lower band / SELL: price near upper band
    const bbOk = (action === 'BUY' && signal5m.bbPosition === 'LOWER') ||
                 (action === 'SELL' && signal5m.bbPosition === 'UPPER') ||
                 signal5m.bbPosition === 'MIDDLE';
    breakdown.bb = bbOk ? 4 : 0;
    total += breakdown.bb;

    // 10. News bias (max 12pts)
    const newsAligned = (action === 'BUY' && ['BULLISH_GOLD', 'BULLISH', 'SLIGHT_BULLISH_GOLD', 'SLIGHT_BULLISH'].includes(newsBias)) ||
                        (action === 'SELL' && ['BEARISH_GOLD', 'BEARISH', 'SLIGHT_BEARISH_GOLD', 'SLIGHT_BEARISH'].includes(newsBias));
    const newsOpposite = (action === 'BUY' && ['BEARISH_GOLD', 'BEARISH'].includes(newsBias)) ||
                         (action === 'SELL' && ['BULLISH_GOLD', 'BULLISH'].includes(newsBias));
    breakdown.news = newsAligned ? 12 : newsOpposite ? -8 : 0; // Mismatched news hurts score
    total += breakdown.news;

    // 11. Session boost (max 15pts — passed in from SessionManager)
    breakdown.session = Math.min(sessionBoost, 15);
    total += breakdown.session;

    // 12. Candle patterns (max 10pts) ─────────────────────────
    // Each confirmed pattern adds pts. Multiple patterns stack (capped at 10).
    // Mismatched pattern penalises score.
    if (patterns) {
      const aligned  = action === 'BUY' ? patterns.bullishCount : patterns.bearishCount;
      const opposing = action === 'BUY' ? patterns.bearishCount : patterns.bullishCount;
      const patternScore = Math.min(aligned * 5, 10) - (opposing * 3);
      breakdown.patterns = Math.max(-6, patternScore); // cap downside at -6
    } else {
      breakdown.patterns = 0;
    }
    total += breakdown.patterns;

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
    const cciVals = CCI.calculate({ 
      period: 20, high: highs, low: lows, close: closes 
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
      cci:      cciVals[cciVals.length - 1]  || 0,
      bbPosition,
      ema9: lastEma9, ema21: lastEma21, price
    };
  }

  // ─── CANDLE PATTERN DETECTION (5min) ─────────────────────────
  // Detects: engulfing, pin bar, CHoCH
  // Returns { engulfing, pinBar, choch, bullishCount, bearishCount }
  _getCandlePatterns(candles) {
    const len = candles.length;
    if (len < 5) return { bullishCount: 0, bearishCount: 0 };

    const last  = candles[len - 1];
    const prev  = candles[len - 2];
    const prev2 = candles[len - 3];

    let bullishCount = 0;
    let bearishCount = 0;

    // ── Engulfing ──────────────────────────────────────────────
    // Bullish: prev candle red, last candle green and body engulfs prev body
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
    // Bullish pin: lower wick >= 2× body, body in upper 40% of candle range
    const lastRange  = last.high - last.low;
    const lastLowWick  = Math.min(last.open, last.close) - last.low;
    const lastHighWick = last.high - Math.max(last.open, last.close);

    if (lastRange > 0) {
      const bodyRatio = lastBody / lastRange;
      if (bodyRatio < 0.35) {                        // Small body
        if (lastLowWick >= lastBody * 2)  bullishCount++; // Long lower wick = bullish rejection
        if (lastHighWick >= lastBody * 2) bearishCount++; // Long upper wick = bearish rejection
      }
    }

    // ── CHoCH (Change of Character) ───────────────────────────
    // Bullish CHoCH: prev2 and prev were making lower highs, last candle breaks prev high
    const wasLowerHighs = prev.high < prev2.high;
    const brokeHighUp   = last.close > prev.high;
    if (wasLowerHighs && brokeHighUp) bullishCount++;

    // Bearish CHoCH: prev2 and prev were making higher lows, last candle breaks prev low
    const wasHigherLows = prev.low > prev2.low;
    const brokeLowDown  = last.close < prev.low;
    if (wasHigherLows && brokeLowDown) bearishCount++;

    return {
      bullishEngulf, bearishEngulf,
      bullishCount, bearishCount,
    };
  }

  // ─── SCALP ENTRY CHECK (1min) ─────────────────────────────────
  // Checks if price has pulled back cleanly to EMA21 — the proven scalp entry
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

    // Valid pullback = price within 0.4 ATR of EMA21
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
    if (['EUR/USD', 'GBP/USD'].includes(pair)) {
      // Strong USD = bearish EUR/GBP
      if (globalBias === 'BEARISH_GOLD') return 'BEARISH';
      if (globalBias === 'BULLISH_GOLD') return 'BULLISH';
      if (globalBias === 'SLIGHT_BEARISH_GOLD') return 'SLIGHT_BEARISH';
      if (globalBias === 'SLIGHT_BULLISH_GOLD') return 'SLIGHT_BULLISH';
    }
    return 'NEUTRAL'; // BTC/ETH — news agnostic
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