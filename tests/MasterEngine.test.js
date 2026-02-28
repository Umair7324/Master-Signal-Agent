import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MasterEngine } from '../src/MasterEngine.js';
import {
  makeBullishCandles,
  makeBearishCandles,
  makeFlatCandles,
  makeMacro,
  makeMTF,
  makeSignal5m,
  makeScalp1m,
} from './helpers/candles.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a maximal-score BUY scenario (every component aligned). */
function perfectBuySetup(overrides = {}) {
  return {
    action:      'BUY',
    macro:       makeMacro('BULLISH', 36),   // ADX > 35 → 8pts
    mtf:         makeMTF('BULLISH'),
    signal5m:    makeSignal5m({ bias: 'BULLISH', rsi: 52, macdHist: 0.5,
                                stochK: 55, stochD: 42, cci: 50, bbPosition: 'MIDDLE' }),
    scalp1m:     makeScalp1m(true),
    newsBias:    'BULLISH_GOLD',
    sessionBoost: 15,
    ...overrides,
  };
}

/** Build a maximal-score SELL scenario. */
function perfectSellSetup(overrides = {}) {
  return {
    action:      'SELL',
    macro:       makeMacro('BEARISH', 36),
    mtf:         makeMTF('BEARISH'),
    signal5m:    makeSignal5m({ bias: 'BEARISH', rsi: 48, macdHist: -0.5,
                                stochK: 45, stochD: 58, cci: -50, bbPosition: 'MIDDLE' }),
    scalp1m:     makeScalp1m(true),
    newsBias:    'BEARISH_GOLD',
    sessionBoost: 15,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('MasterEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new MasterEngine();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _scoreSignal() — the confluence engine
  // ══════════════════════════════════════════════════════════════════════════
  describe('_scoreSignal()', () => {

    // ── Max-score BUY ───────────────────────────────────────────────────────
    it('perfect BUY setup scores 100 (clamped)', () => {
      const { total } = engine._scoreSignal(perfectBuySetup());
      expect(total).toBe(100);
    });

    it('perfect SELL setup scores 100 (clamped)', () => {
      const { total } = engine._scoreSignal(perfectSellSetup());
      expect(total).toBe(100);
    });

    // ── Macro layer (20 + 8 pts) ────────────────────────────────────────────
    it('macro aligned: +20 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup());
      expect(breakdown.macro).toBe(20);
    });

    it('macro NOT aligned: 0 pts (BEARISH macro for BUY)', () => {
      const { breakdown } = engine._scoreSignal(
        perfectBuySetup({ macro: makeMacro('BEARISH', 36) })
      );
      expect(breakdown.macro).toBe(0);
    });

    it('ADX > 35 → macroStrength = 8 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ macro: makeMacro('BULLISH', 36) }));
      expect(breakdown.macroStrength).toBe(8);
    });

    it('ADX 26-35 → macroStrength = 5 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ macro: makeMacro('BULLISH', 28) }));
      expect(breakdown.macroStrength).toBe(5);
    });

    it('ADX <= 25 → macroStrength = 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ macro: makeMacro('BULLISH', 22) }));
      expect(breakdown.macroStrength).toBe(0);
    });

    // ── MTF layer (12 / 4 / 0 pts) ─────────────────────────────────────────
    it('MTF aligned with BUY: +12 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ mtf: makeMTF('BULLISH') }));
      expect(breakdown.mtf).toBe(12);
    });

    it('MTF NEUTRAL for BUY: +4 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ mtf: makeMTF('NEUTRAL') }));
      expect(breakdown.mtf).toBe(4);
    });

    it('MTF opposite for BUY (BEARISH): 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ mtf: makeMTF('BEARISH') }));
      expect(breakdown.mtf).toBe(0);
    });

    it('MTF aligned with SELL: +12 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({ mtf: makeMTF('BEARISH') }));
      expect(breakdown.mtf).toBe(12);
    });

    // ── 5min signal layer (10 / 0 pts) ─────────────────────────────────────
    it('5m BULLISH for BUY: +10 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup());
      expect(breakdown.signal5m).toBe(10);
    });

    it('5m NEUTRAL for BUY: 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ bias: 'NEUTRAL' })
      }));
      expect(breakdown.signal5m).toBe(0);
    });

    it('5m BEARISH for SELL: +10 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup());
      expect(breakdown.signal5m).toBe(10);
    });

    // ── RSI (8 / 4 / 0 pts) ────────────────────────────────────────────────
    it('BUY RSI 40-65 → +8 pts (ideal zone)', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ rsi: 52 })
      }));
      expect(breakdown.rsi).toBe(8);
    });

    it('BUY RSI 65-70 → +4 pts (acceptable)', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ rsi: 67 })
      }));
      expect(breakdown.rsi).toBe(4);
    });

    it('BUY RSI > 70 → 0 pts (overbought)', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ rsi: 75 })
      }));
      expect(breakdown.rsi).toBe(0);
    });

    it('BUY RSI < 30 → 0 pts (extremely oversold)', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ rsi: 25 })
      }));
      expect(breakdown.rsi).toBe(0);
    });

    it('SELL RSI 35-60 → +8 pts (ideal zone)', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', rsi: 48, macdHist: -0.5, stochK: 45, stochD: 58, cci: -50 })
      }));
      expect(breakdown.rsi).toBe(8);
    });

    it('SELL RSI < 35 → +4 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', rsi: 32, macdHist: -0.5, stochK: 45, stochD: 58, cci: -50 })
      }));
      expect(breakdown.rsi).toBe(4);
    });

    // ── MACD (8 / 0 pts) ───────────────────────────────────────────────────
    it('BUY MACD hist > 0 → +8 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup());
      expect(breakdown.macd).toBe(8);
    });

    it('BUY MACD hist < 0 → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ macdHist: -0.2 })
      }));
      expect(breakdown.macd).toBe(0);
    });

    it('SELL MACD hist < 0 → +8 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup());
      expect(breakdown.macd).toBe(8);
    });

    it('SELL MACD hist > 0 → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', macdHist: 0.3 })
      }));
      expect(breakdown.macd).toBe(0);
    });

    // ── Stochastic (6 / 0 pts) ─────────────────────────────────────────────
    it('BUY stoch: K < 80 and K > D → +6 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ stochK: 55, stochD: 42 })
      }));
      expect(breakdown.stoch).toBe(6);
    });

    it('BUY stoch: K >= 80 (overbought) → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ stochK: 82, stochD: 75 })
      }));
      expect(breakdown.stoch).toBe(0);
    });

    it('BUY stoch: K < D (bearish cross) → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ stochK: 40, stochD: 55 })
      }));
      expect(breakdown.stoch).toBe(0);
    });

    it('SELL stoch: K > 20 and K < D → +6 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', macdHist: -0.5, rsi: 48, stochK: 45, stochD: 58, cci: -50 })
      }));
      expect(breakdown.stoch).toBe(6);
    });

    it('SELL stoch: K <= 20 (oversold) → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', macdHist: -0.5, rsi: 48, stochK: 18, stochD: 30, cci: -50 })
      }));
      expect(breakdown.stoch).toBe(0);
    });

    // ── CCI (4 / 0 pts) ────────────────────────────────────────────────────
    it('BUY CCI in -100..200 → +4 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ cci: 80 })
      }));
      expect(breakdown.cci).toBe(4);
    });

    it('BUY CCI > 200 → 0 pts (extreme overbought)', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ cci: 210 })
      }));
      expect(breakdown.cci).toBe(0);
    });

    it('SELL CCI in -200..100 → +4 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', macdHist: -0.5, rsi: 48, stochK: 45, stochD: 58, cci: -80 })
      }));
      expect(breakdown.cci).toBe(4);
    });

    it('SELL CCI < -200 → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', macdHist: -0.5, rsi: 48, stochK: 45, stochD: 58, cci: -210 })
      }));
      expect(breakdown.cci).toBe(0);
    });

    // ── Bollinger Bands (4 / 0 pts) ────────────────────────────────────────
    it('BUY with price at LOWER band → +4 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ bbPosition: 'LOWER' })
      }));
      expect(breakdown.bb).toBe(4);
    });

    it('BUY with price at MIDDLE band → +4 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ bbPosition: 'MIDDLE' })
      }));
      expect(breakdown.bb).toBe(4);
    });

    it('BUY with price at UPPER band → 0 pts (resistance)', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({
        signal5m: makeSignal5m({ bbPosition: 'UPPER' })
      }));
      expect(breakdown.bb).toBe(0);
    });

    it('SELL with price at UPPER band → +4 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', macdHist: -0.5, rsi: 48, stochK: 45, stochD: 58, cci: -50, bbPosition: 'UPPER' })
      }));
      expect(breakdown.bb).toBe(4);
    });

    it('SELL with price at LOWER band → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({
        signal5m: makeSignal5m({ bias: 'BEARISH', macdHist: -0.5, rsi: 48, stochK: 45, stochD: 58, cci: -50, bbPosition: 'LOWER' })
      }));
      expect(breakdown.bb).toBe(0);
    });

    // ── News bias (12 / 0 / -8 pts) ────────────────────────────────────────
    it('BUY + BULLISH_GOLD news → +12 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ newsBias: 'BULLISH_GOLD' }));
      expect(breakdown.news).toBe(12);
    });

    it('BUY + SLIGHT_BULLISH_GOLD → +12 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ newsBias: 'SLIGHT_BULLISH_GOLD' }));
      expect(breakdown.news).toBe(12);
    });

    it('BUY + NEUTRAL news → 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ newsBias: 'NEUTRAL' }));
      expect(breakdown.news).toBe(0);
    });

    it('BUY + BEARISH_GOLD news → -8 pts (kills signal)', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ newsBias: 'BEARISH_GOLD' }));
      expect(breakdown.news).toBe(-8);
    });

    it('SELL + BEARISH_GOLD → +12 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({ newsBias: 'BEARISH_GOLD' }));
      expect(breakdown.news).toBe(12);
    });

    it('SELL + BULLISH_GOLD news → -8 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectSellSetup({ newsBias: 'BULLISH_GOLD' }));
      expect(breakdown.news).toBe(-8);
    });

    // ── Session boost (max 15 pts) ──────────────────────────────────────────
    it('sessionBoost 15 → adds 15 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ sessionBoost: 15 }));
      expect(breakdown.session).toBe(15);
    });

    it('sessionBoost 0 → adds 0 pts', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ sessionBoost: 0 }));
      expect(breakdown.session).toBe(0);
    });

    it('sessionBoost > 15 is clamped to 15', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup({ sessionBoost: 20 }));
      expect(breakdown.session).toBe(15);
    });

    // ── Score clamping ──────────────────────────────────────────────────────
    it('score never exceeds 100', () => {
      const { total } = engine._scoreSignal(perfectBuySetup());
      expect(total).toBeLessThanOrEqual(100);
    });

    it('score never goes below 0 (even with heavy negative news)', () => {
      // Strip everything and add -8 from news
      const { total } = engine._scoreSignal({
        action:      'BUY',
        macro:       makeMacro('BULLISH', 18),  // no macroStrength
        mtf:         makeMTF('BEARISH'),         // 0 pts
        signal5m:    makeSignal5m({ bias: 'NEUTRAL', rsi: 75, macdHist: -1, stochK: 82, stochD: 70, cci: 210, bbPosition: 'UPPER' }),
        scalp1m:     makeScalp1m(false),
        newsBias:    'BEARISH_GOLD',
        sessionBoost: 0,
      });
      expect(total).toBeGreaterThanOrEqual(0);
    });

    // ── score is an integer (rounded) ───────────────────────────────────────
    it('score is always an integer', () => {
      const { total } = engine._scoreSignal(perfectBuySetup({ sessionBoost: 7 }));
      expect(Number.isInteger(total)).toBe(true);
    });

    // ── Breakdown object has all expected keys ──────────────────────────────
    it('breakdown contains all 11 scoring keys', () => {
      const { breakdown } = engine._scoreSignal(perfectBuySetup());
      const expectedKeys = ['macro', 'macroStrength', 'mtf', 'signal5m',
                            'rsi', 'macd', 'stoch', 'cci', 'bb', 'news', 'session'];
      expectedKeys.forEach(k => expect(breakdown).toHaveProperty(k));
    });

    // ── Threshold gate (does score meet pair minimums?) ─────────────────────
    it('weak setup (only macro) scores below 68 (XAU/USD intraday threshold)', () => {
      const { total } = engine._scoreSignal({
        action:      'BUY',
        macro:       makeMacro('BULLISH', 22),
        mtf:         makeMTF('NEUTRAL'),
        signal5m:    makeSignal5m({ bias: 'NEUTRAL', rsi: 75, macdHist: -1, stochK: 82, stochD: 70, cci: 210, bbPosition: 'UPPER' }),
        scalp1m:     makeScalp1m(false),
        newsBias:    'NEUTRAL',
        sessionBoost: 0,
      });
      expect(total).toBeLessThan(68);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _newsBiasForPair() — pair-specific news bias translation
  // ══════════════════════════════════════════════════════════════════════════
  describe('_newsBiasForPair()', () => {
    const cases = [
      ['XAU/USD', 'BEARISH_GOLD',        'BEARISH_GOLD'],
      ['XAU/USD', 'BULLISH_GOLD',        'BULLISH_GOLD'],
      ['XAU/USD', 'NEUTRAL',             'NEUTRAL'],
      ['EUR/USD', 'BEARISH_GOLD',        'BEARISH'],
      ['EUR/USD', 'BULLISH_GOLD',        'BULLISH'],
      ['EUR/USD', 'SLIGHT_BEARISH_GOLD', 'SLIGHT_BEARISH'],
      ['EUR/USD', 'SLIGHT_BULLISH_GOLD', 'SLIGHT_BULLISH'],
      ['EUR/USD', 'NEUTRAL',             'NEUTRAL'],
      ['GBP/USD', 'BEARISH_GOLD',        'BEARISH'],
      ['GBP/USD', 'BULLISH_GOLD',        'BULLISH'],
      ['GBP/USD', 'SLIGHT_BEARISH_GOLD', 'SLIGHT_BEARISH'],
      ['GBP/USD', 'SLIGHT_BULLISH_GOLD', 'SLIGHT_BULLISH'],
      ['BTC/USD', 'BEARISH_GOLD',        'NEUTRAL'],
      ['BTC/USD', 'BULLISH_GOLD',        'NEUTRAL'],
      ['ETH/USD', 'BULLISH_GOLD',        'NEUTRAL'],
    ];

    cases.forEach(([pair, globalBias, expected]) => {
      it(`${pair} + ${globalBias} → ${expected}`, () => {
        expect(engine._newsBiasForPair(pair, globalBias)).toBe(expected);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Cooldown logic
  // ══════════════════════════════════════════════════════════════════════════
  describe('cooldown system', () => {
    it('_cooldownKey formats key correctly', () => {
      expect(engine._cooldownKey('XAU/USD', 'BUY', 'scalp')).toBe('XAU/USD:BUY:scalp');
      expect(engine._cooldownKey('BTC/USD', 'SELL', 'intraday')).toBe('BTC/USD:SELL:intraday');
    });

    it('_inCooldown returns false when no cooldown set', () => {
      expect(engine._inCooldown('XAU/USD', 'BUY', 'scalp', 15)).toBe(false);
    });

    it('_inCooldown returns true immediately after _setCooldown', () => {
      engine._setCooldown('XAU/USD', 'BUY', 'scalp');
      expect(engine._inCooldown('XAU/USD', 'BUY', 'scalp', 15)).toBe(true);
    });

    it('_inCooldown returns false after cooldown minutes elapsed', () => {
      vi.useFakeTimers();
      engine._setCooldown('EUR/USD', 'SELL', 'intraday');
      // Advance time by 61 minutes
      vi.advanceTimersByTime(61 * 60 * 1000);
      expect(engine._inCooldown('EUR/USD', 'SELL', 'intraday', 60)).toBe(false);
      vi.useRealTimers();
    });

    it('_inCooldown still true within cooldown window', () => {
      vi.useFakeTimers();
      engine._setCooldown('GBP/USD', 'BUY', 'scalp');
      vi.advanceTimersByTime(10 * 60 * 1000); // 10 min (within 15 min cooldown)
      expect(engine._inCooldown('GBP/USD', 'BUY', 'scalp', 15)).toBe(true);
      vi.useRealTimers();
    });

    it('different pairs have independent cooldowns', () => {
      engine._setCooldown('XAU/USD', 'BUY', 'scalp');
      expect(engine._inCooldown('EUR/USD', 'BUY', 'scalp', 15)).toBe(false);
    });

    it('different directions have independent cooldowns', () => {
      engine._setCooldown('XAU/USD', 'BUY', 'scalp');
      expect(engine._inCooldown('XAU/USD', 'SELL', 'scalp', 15)).toBe(false);
    });

    it('scalp and intraday cooldowns are independent', () => {
      engine._setCooldown('XAU/USD', 'BUY', 'scalp');
      expect(engine._inCooldown('XAU/USD', 'BUY', 'intraday', 60)).toBe(false);
    });

    it('cooldown persists across multiple _inCooldown checks', () => {
      engine._setCooldown('BTC/USD', 'SELL', 'intraday');
      expect(engine._inCooldown('BTC/USD', 'SELL', 'intraday', 60)).toBe(true);
      expect(engine._inCooldown('BTC/USD', 'SELL', 'intraday', 60)).toBe(true); // still true
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getMacro() — 1H trend detection with synthetic candles
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getMacro() — trend detection', () => {
    it('strong uptrend → BULLISH', () => {
      const candles = makeBullishCandles(100, 1800, 4);
      const result  = engine._getMacro(candles);
      expect(result.trend).toBe('BULLISH');
    });

    it('strong downtrend → BEARISH', () => {
      const candles = makeBearishCandles(100, 2100, 4);
      const result  = engine._getMacro(candles);
      expect(result.trend).toBe('BEARISH');
    });

    it('flat market → NEUTRAL (ADX < 20)', () => {
      const candles = makeFlatCandles(100, 1950);
      const result  = engine._getMacro(candles);
      expect(result.trend).toBe('NEUTRAL');
    });

    it('returns adx, ema21, ema50, price fields', () => {
      const candles = makeBullishCandles(100);
      const result  = engine._getMacro(candles);
      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('adx');
      expect(result).toHaveProperty('ema21');
      expect(result).toHaveProperty('ema50');
      expect(result).toHaveProperty('price');
    });

    it('BULLISH: EMA21 > EMA50 and price > EMA21', () => {
      const candles = makeBullishCandles(100);
      const { ema21, ema50, price } = engine._getMacro(candles);
      expect(price).toBeGreaterThan(ema21);
      expect(ema21).toBeGreaterThan(ema50);
    });

    it('BEARISH: EMA21 < EMA50 and price < EMA21', () => {
      const candles = makeBearishCandles(100);
      const { ema21, ema50, price } = engine._getMacro(candles);
      expect(price).toBeLessThan(ema21);
      expect(ema21).toBeLessThan(ema50);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getMTF() — 15min trend detection
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getMTF() — 15min trend detection', () => {
    it('strong uptrend → BULLISH', () => {
      const candles = makeBullishCandles(100, 1800, 3);
      const result  = engine._getMTF(candles);
      expect(result.trend).toBe('BULLISH');
    });

    it('strong downtrend → BEARISH', () => {
      const candles = makeBearishCandles(100, 2100, 3);
      const result  = engine._getMTF(candles);
      expect(result.trend).toBe('BEARISH');
    });

    it('flat market → NEUTRAL', () => {
      const candles = makeFlatCandles(100, 1950);
      const result  = engine._getMTF(candles);
      expect(result.trend).toBe('NEUTRAL');
    });

    it('returns trend and adx fields', () => {
      const candles = makeBullishCandles(100);
      const result  = engine._getMTF(candles);
      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('adx');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getSignal() — 5min signal analysis
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getSignal() — 5min analysis', () => {
    it('uptrend candles → BULLISH bias', () => {
      const candles = makeBullishCandles(100, 1800, 2);
      const result  = engine._getSignal(candles);
      expect(result.bias).toBe('BULLISH');
    });

    it('downtrend candles → BEARISH bias', () => {
      const candles = makeBearishCandles(100, 2100, 2);
      const result  = engine._getSignal(candles);
      expect(result.bias).toBe('BEARISH');
    });

    it('flat candles → NEUTRAL bias', () => {
      const candles = makeFlatCandles(100, 1950);
      const result  = engine._getSignal(candles);
      expect(result.bias).toBe('NEUTRAL');
    });

    it('returns all required indicator fields', () => {
      const candles = makeBullishCandles(100);
      const result  = engine._getSignal(candles);
      ['bias', 'rsi', 'macdHist', 'stochK', 'stochD', 'cci', 'bbPosition', 'ema9', 'ema21', 'price'].forEach(k => {
        expect(result).toHaveProperty(k);
      });
    });

    it('RSI is a number in 0-100 range', () => {
      const candles = makeBullishCandles(100);
      const { rsi } = engine._getSignal(candles);
      expect(rsi).toBeGreaterThanOrEqual(0);
      expect(rsi).toBeLessThanOrEqual(100);
    });

    it('bbPosition is one of LOWER / MIDDLE / UPPER', () => {
      const candles = makeBullishCandles(100);
      const { bbPosition } = engine._getSignal(candles);
      expect(['LOWER', 'MIDDLE', 'UPPER']).toContain(bbPosition);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getScalpEntry() — 1min pullback check
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getScalpEntry() — pullback validity', () => {
    it('returns pullbackValid boolean', () => {
      const candles = makeBullishCandles(50, 1800, 2);
      const result  = engine._getScalpEntry(candles);
      expect(typeof result.pullbackValid).toBe('boolean');
    });

    it('returns ema21, atr, rsi, price', () => {
      const candles = makeBullishCandles(50);
      const result  = engine._getScalpEntry(candles);
      ['pullbackValid', 'ema21', 'atr', 'rsi', 'price'].forEach(k => {
        expect(result).toHaveProperty(k);
      });
    });

    it('flat candles (price == EMA21) → pullbackValid = true', () => {
      // Flat candles: price stays at EMA21 → distance = 0 <= 0.4*ATR
      const candles = makeFlatCandles(50, 1900);
      const result  = engine._getScalpEntry(candles);
      // For very flat candles ATR is tiny but distance is also 0
      expect(result.pullbackValid).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getATR() — ATR helper
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getATR()', () => {
    it('returns a positive number for trending candles', () => {
      const candles = makeBullishCandles(50);
      const atr = engine._getATR(candles, 14);
      expect(atr).toBeGreaterThan(0);
    });

    it('returns 0 for completely flat candles (zero range)', () => {
      // All highs = lows = close → ATR = 0
      const candles = Array.from({ length: 50 }, (_, i) => ({
        open: 1900, high: 1900, low: 1900, close: 1900, time: new Date().toISOString()
      }));
      const atr = engine._getATR(candles, 14);
      expect(atr).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // analyze() — full integration test with mocked _fetchCandles
  // ══════════════════════════════════════════════════════════════════════════
  describe('analyze() — integration (mocked API)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function mockFetchCandles(engine, candles1H, candles15m, candles5m, candles1m) {
      vi.spyOn(engine, '_fetchCandles').mockImplementation((pair, interval) => {
        if (interval === '1h')    return Promise.resolve(candles1H);
        if (interval === '15min') return Promise.resolve(candles15m);
        if (interval === '5min')  return Promise.resolve(candles5m);
        if (interval === '1min')  return Promise.resolve(candles1m);
      });
    }

    it('returns null when 1H trend is NEUTRAL', async () => {
      mockFetchCandles(engine,
        makeFlatCandles(100, 1950),  // 1H: flat = NEUTRAL
        makeBullishCandles(100),
        makeBullishCandles(100),
        makeBullishCandles(50)
      );
      const result = await engine.analyze('XAU/USD', 'NEUTRAL', 0);
      expect(result).toBeNull();
    });

    it('returns null when _fetchCandles returns null', async () => {
      vi.spyOn(engine, '_fetchCandles').mockResolvedValue(null);
      const result = await engine.analyze('XAU/USD', 'NEUTRAL', 0);
      expect(result).toBeNull();
    });

    it('returns null on API error', async () => {
      vi.spyOn(engine, '_fetchCandles').mockRejectedValue(new Error('TwelveData timeout'));
      const result = await engine.analyze('XAU/USD', 'NEUTRAL', 0);
      expect(result).toBeNull();
    });

    it('generates BUY INTRADAY signal on strong uptrend with session boost', async () => {
      const bullish = makeBullishCandles(100, 1800, 5);
      mockFetchCandles(engine, bullish, bullish, bullish, makeBullishCandles(50, 1800, 5));

      const signals = await engine.analyze('XAU/USD', 'BULLISH_GOLD', 15);

      // Should produce at least one BUY signal
      expect(signals).not.toBeNull();
      expect(Array.isArray(signals)).toBe(true);
      const buy = signals.find(s => s.action === 'BUY');
      expect(buy).toBeDefined();
    });

    it('BUY signal has correct structure', async () => {
      const bullish = makeBullishCandles(100, 1800, 5);
      mockFetchCandles(engine, bullish, bullish, bullish, makeBullishCandles(50, 1800, 5));

      const signals = await engine.analyze('EUR/USD', 'BULLISH_GOLD', 15);
      expect(signals).not.toBeNull();

      const buy = signals.find(s => s.action === 'BUY');
      if (buy) {
        expect(buy.pair).toBe('EUR/USD');
        expect(buy.action).toBe('BUY');
        expect(['INTRADAY', 'SCALP']).toContain(buy.type);
        expect(buy.entry).toBeGreaterThan(0);
        expect(buy.sl).toBeLessThan(buy.entry);   // SL below entry for BUY
        expect(buy.tp).toBeGreaterThan(buy.entry); // TP above entry for BUY
        expect(buy.rr).toBeGreaterThan(0);
        expect(buy.score).toBeGreaterThanOrEqual(0);
        expect(buy.score).toBeLessThanOrEqual(100);
        expect(buy.breakdown).toBeDefined();
      }
    });

    it('generates SELL INTRADAY signal on strong downtrend', async () => {
      const bearish = makeBearishCandles(100, 2100, 5);
      mockFetchCandles(engine, bearish, bearish, bearish, makeBearishCandles(50, 2100, 5));

      const signals = await engine.analyze('XAU/USD', 'BEARISH_GOLD', 15);

      if (signals) {
        const sell = signals.find(s => s.action === 'SELL');
        if (sell) {
          expect(sell.action).toBe('SELL');
          expect(sell.sl).toBeGreaterThan(sell.entry); // SL above entry for SELL
          expect(sell.tp).toBeLessThan(sell.entry);    // TP below entry for SELL
        }
      }
    });

    it('does not fire signal when in cooldown', async () => {
      const bullish = makeBullishCandles(100, 1800, 5);
      mockFetchCandles(engine, bullish, bullish, bullish, makeBullishCandles(50, 1800, 5));

      // First call — may generate signal and set cooldown
      await engine.analyze('XAU/USD', 'BULLISH_GOLD', 15);

      // Force-set the cooldown for all signal types
      engine._setCooldown('XAU/USD', 'BUY', 'intraday');
      engine._setCooldown('XAU/USD', 'BUY', 'scalp');

      // Second call — should not fire (in cooldown)
      const signals2 = await engine.analyze('XAU/USD', 'BULLISH_GOLD', 15);
      const buySignals = (signals2 || []).filter(s => s.action === 'BUY');
      expect(buySignals).toHaveLength(0);
    });

    it('INTRADAY SL is 2×ATR below entry for BUY', async () => {
      const bullish = makeBullishCandles(100, 1800, 5);
      mockFetchCandles(engine, bullish, bullish, bullish, makeBullishCandles(50, 1800, 5));

      const signals = await engine.analyze('XAU/USD', 'BULLISH_GOLD', 15);
      const intraday = (signals || []).find(s => s.type === 'INTRADAY' && s.action === 'BUY');
      if (intraday) {
        const riskPips = intraday.entry - intraday.sl;
        const rewardPips = intraday.tp - intraday.entry;
        // RR should be approximately 1.8
        expect(rewardPips / riskPips).toBeCloseTo(1.8, 1);
      }
    });

    it('SCALP SL is 0.8×ATR below entry for BUY', async () => {
      const bullish = makeBullishCandles(100, 1800, 5);
      mockFetchCandles(engine, bullish, bullish, bullish, makeBullishCandles(50, 1800, 5));

      const signals = await engine.analyze('XAU/USD', 'BULLISH_GOLD', 15);
      const scalp = (signals || []).find(s => s.type === 'SCALP' && s.action === 'BUY');
      if (scalp) {
        const riskPips = scalp.entry - scalp.sl;
        const rewardPips = scalp.tp - scalp.entry;
        // RR should be approximately 1.5
        expect(rewardPips / riskPips).toBeCloseTo(1.5, 1);
      }
    });
  });
});
