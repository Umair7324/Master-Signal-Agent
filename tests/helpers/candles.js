/**
 * Synthetic OHLC candle data generators for backtesting.
 *
 * All generators return arrays of { open, high, low, close, time } in
 * chronological order (oldest → newest), matching the format produced by
 * MasterEngine._fetchCandles() after it reverses TwelveData's response.
 */

// ── Strong linear UPTREND ────────────────────────────────────────────────────
// Produces: ADX >= 20, EMA21 > EMA50, price > EMA21  →  BULLISH macro/MTF
export function makeBullishCandles(length = 100, startPrice = 1800, increment = 4) {
  return Array.from({ length }, (_, i) => {
    const close = startPrice + i * increment;
    const prev  = i === 0 ? close : startPrice + (i - 1) * increment;
    return {
      open:  prev,
      high:  close + increment * 0.4,
      low:   close - increment * 0.4,
      close,
      time:  new Date(Date.now() - (length - i) * 3_600_000).toISOString(),
    };
  });
}

// ── Strong linear DOWNTREND ──────────────────────────────────────────────────
// Produces: ADX >= 20, EMA21 < EMA50, price < EMA21  →  BEARISH macro/MTF
export function makeBearishCandles(length = 100, startPrice = 2100, decrement = 4) {
  return Array.from({ length }, (_, i) => {
    const close = startPrice - i * decrement;
    const prev  = i === 0 ? close : startPrice - (i - 1) * decrement;
    return {
      open:  prev,
      high:  close + decrement * 0.4,
      low:   close - decrement * 0.4,
      close,
      time:  new Date(Date.now() - (length - i) * 3_600_000).toISOString(),
    };
  });
}

// ── FLAT / sideways market ───────────────────────────────────────────────────
// Produces: ADX < 20  →  NEUTRAL macro
export function makeFlatCandles(length = 100, price = 1950) {
  return Array.from({ length }, (_, i) => ({
    open:  price,
    high:  price + 0.3,
    low:   price - 0.3,
    close: price,
    time:  new Date(Date.now() - (length - i) * 3_600_000).toISOString(),
  }));
}

// ── Bullish candles WITH a pullback on the last N bars ───────────────────────
// Useful for testing scalp entry: price pulls back close to EMA21.
export function makeBullishWithPullback(length = 50, startPrice = 1800, increment = 3, pullbackBars = 5) {
  const candles = [];
  for (let i = 0; i < length; i++) {
    const isPullback = i >= length - pullbackBars;
    const base = startPrice + i * increment;
    const close = isPullback ? base - increment * (i - (length - pullbackBars) + 1) * 0.5 : base;
    const prev  = i === 0 ? close : candles[i - 1].close;
    candles.push({
      open:  prev,
      high:  Math.max(prev, close) + increment * 0.3,
      low:   Math.min(prev, close) - increment * 0.3,
      close,
      time:  new Date(Date.now() - (length - i) * 60_000).toISOString(),
    });
  }
  return candles;
}

// ── Quick factory for a single candle (for unit tests) ───────────────────────
export function makeCandle(close, { open, high, low } = {}) {
  return {
    open:  open  ?? close - 0.1,
    high:  high  ?? close + 0.2,
    low:   low   ?? close - 0.2,
    close,
    time:  new Date().toISOString(),
  };
}

// ── Build a mock signal object ────────────────────────────────────────────────
export function makeMockSignal(overrides = {}) {
  return {
    pair:   'XAU/USD',
    action: 'BUY',
    type:   'INTRADAY',
    entry:  1900.25,
    sl:     1885.00,
    tp:     1927.44,
    rr:     1.8,
    score:  74,
    breakdown: {
      macro: 20, macroStrength: 5, mtf: 12, signal5m: 10,
      rsi: 8, macd: 8, stoch: 6, cci: 4, bb: 4, news: 0, session: 10,
    },
    macro: 'BULLISH',
    atr:   7.61,
    ...overrides,
  };
}

// ── Build mock layer objects for _scoreSignal ─────────────────────────────────
export function makeMacro(trend = 'BULLISH', adx = 30) {
  return { trend, adx, ema21: 1855, ema50: 1800, price: 1900 };
}

export function makeMTF(trend = 'BULLISH') {
  return { trend, adx: 22 };
}

export function makeSignal5m(overrides = {}) {
  return {
    bias:       'BULLISH',
    rsi:        52,
    macdHist:   0.5,
    stochK:     55,
    stochD:     42,
    cci:        50,
    bbPosition: 'MIDDLE',
    ema9:       1895,
    ema21:      1880,
    price:      1900,
    ...overrides,
  };
}

export function makeScalp1m(pullbackValid = true) {
  return { pullbackValid, ema21: 1897, atr: 3.5, rsi: 52, price: 1898 };
}
