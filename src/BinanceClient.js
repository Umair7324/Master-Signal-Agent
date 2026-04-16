// BinanceClient.js — Apr 16 2026
// Fallback crypto data source for BTC/USD and ETH/USD.
//
// WHY: TwelveData free plan no longer includes ETH/USD 1h, so every ETH
// cycle was failing silently and logging "no signal". This costs us ~50%
// of crypto signal opportunities.
//
// Uses Binance's public data endpoint (no auth, globally accessible).
// Base: https://data-api.binance.vision (CDN-backed, reliable).
//
// Output shape matches TwelveDataClient.fetchCandles so it's a drop-in
// for crypto pairs. Symbol mapping: BTC/USD→BTCUSDT, ETH/USD→ETHUSDT.
// (Using USDT as USD proxy — practical identity for our purposes.)

const BASE_URL = 'https://data-api.binance.vision';

// TwelveData interval → Binance interval
const INTERVAL_MAP = {
  '1min':  '1m',
  '5min':  '5m',
  '15min': '15m',
  '1h':    '1h',
};

// Our pair format → Binance symbol
const SYMBOL_MAP = {
  'BTC/USD': 'BTCUSDT',
  'ETH/USD': 'ETHUSDT',
};

export class BinanceClient {
  constructor() {
    console.log(`🟡 BinanceClient: using data-api.binance.vision for BTC/ETH`);
  }

  static supports(pair) {
    return pair in SYMBOL_MAP;
  }

  async fetchCandles(pair, interval, outputSize = 100) {
    const symbol = SYMBOL_MAP[pair];
    if (!symbol) throw new Error(`BinanceClient: unsupported pair ${pair}`);

    const binanceInterval = INTERVAL_MAP[interval];
    if (!binanceInterval) throw new Error(`BinanceClient: unsupported interval ${interval}`);

    // Binance max limit is 1000, we want the most recent `outputSize` candles
    const limit = Math.min(outputSize, 1000);
    const url = `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;

    const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const json = await res.json();

    if (!Array.isArray(json)) {
      throw new Error(`Binance error for ${pair} ${interval}: ${json.msg || 'bad response'}`);
    }

    // Binance klines format: [openTime, open, high, low, close, volume, closeTime, ...]
    // Already chronological (oldest first), matches our engine expectation.
    return json.map(k => ({
      open:  parseFloat(k[1]),
      high:  parseFloat(k[2]),
      low:   parseFloat(k[3]),
      close: parseFloat(k[4]),
      time:  new Date(k[0]).toISOString(),
    }));
  }
}