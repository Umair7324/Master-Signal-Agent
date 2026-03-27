// TwelveDataClient.js
// Auto-rotating TwelveData API key manager
// Rotates to next key when daily credit limit is hit
// Add keys as: TWELVEDATA_API_KEY_1, TWELVEDATA_API_KEY_2, ... TWELVEDATA_API_KEY_12

const BASE_URL = 'https://api.twelvedata.com';

// Matches TwelveData's daily credit exhaustion error message
const CREDIT_EXHAUSTED_MSG = 'You have run out of API credits for the day';

export class TwelveDataClient {
  constructor() {
    // Load all keys from env — skip undefined ones
    this.keys = [
      process.env.TWELVEDATA_API_KEY_1,
      process.env.TWELVEDATA_API_KEY_2,
      process.env.TWELVEDATA_API_KEY_3,
      process.env.TWELVEDATA_API_KEY_4,
      process.env.TWELVEDATA_API_KEY_5,
      process.env.TWELVEDATA_API_KEY_6,
      process.env.TWELVEDATA_API_KEY_7,
      process.env.TWELVEDATA_API_KEY_8,
      process.env.TWELVEDATA_API_KEY_9,
      process.env.TWELVEDATA_API_KEY_10,
      process.env.TWELVEDATA_API_KEY_11,
      process.env.TWELVEDATA_API_KEY_12,
    ].filter(Boolean);

    // Fallback: support old single key env var
    if (this.keys.length === 0 && process.env.TWELVEDATA_API_KEY_MASTER) {
      this.keys = [process.env.TWELVEDATA_API_KEY_MASTER];
    }

    if (this.keys.length === 0) {
      throw new Error('❌ No TwelveData API keys found! Set TWELVEDATA_API_KEY_1 ... _12 in env');
    }

    this.currentIndex = 0;         // Active key index
    this.exhaustedKeys = new Set(); // Track exhausted keys (reset at midnight)

    console.log(`🔑 TwelveDataClient: ${this.keys.length} key(s) loaded`);
    this._scheduleMidnightReset();
  }

  // ─── PUBLIC: Fetch candles (drop-in replacement) ──────────────
  async fetchCandles(pair, interval, outputSize = 100) {
    const maxAttempts = this.keys.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = this._currentKey();

      if (!key) {
        throw new Error(`❌ All ${this.keys.length} TwelveData API keys exhausted for today. Resumes at midnight UTC.`);
      }

      const url = `${BASE_URL}/time_series?symbol=${encodeURIComponent(pair)}&interval=${interval}&outputsize=${outputSize}&apikey=${key}`;

      try {
        const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const json = await res.json();

        // Daily credit exhausted → rotate key and retry
        if (json.status === 'error' && json.message?.includes(CREDIT_EXHAUSTED_MSG)) {
          console.warn(`⚠️  Key #${this.currentIndex + 1} daily limit hit — rotating to next key...`);
          this._markCurrentExhausted();
          continue; // retry with next key
        }

        // Any other error → throw immediately (don't rotate)
        if (json.status === 'error' || !json.values) {
          throw new Error(`TwelveData error for ${pair} ${interval}: ${json.message || 'no values'}`);
        }

        // Success — return parsed candles (newest-first → reverse to chronological)
        return json.values.reverse().map(v => ({
          open:  parseFloat(v.open),
          high:  parseFloat(v.high),
          low:   parseFloat(v.low),
          close: parseFloat(v.close),
          time:  v.datetime,
        }));

      } catch (err) {
        // Re-throw non-rotation errors directly
        if (err.message.includes('TwelveData error') || err.message.includes('exhausted')) {
          throw err;
        }
        // Network/timeout error — throw without rotating
        throw new Error(`TwelveData fetch error for ${pair} ${interval}: ${err.message}`);
      }
    }

    throw new Error(`❌ All ${this.keys.length} TwelveData keys exhausted for today.`);
  }

  // ─── STATUS (for health check) ────────────────────────────────
  getStatus() {
    return {
      totalKeys:     this.keys.length,
      activeKeyIndex: this.currentIndex + 1,
      exhaustedCount: this.exhaustedKeys.size,
      availableKeys:  this.keys.length - this.exhaustedKeys.size,
    };
  }

  // ─── PRIVATE ──────────────────────────────────────────────────

  _currentKey() {
    // Find next non-exhausted key starting from currentIndex
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      if (!this.exhaustedKeys.has(idx)) {
        this.currentIndex = idx;
        return this.keys[idx];
      }
    }
    return null; // All exhausted
  }

  _markCurrentExhausted() {
    this.exhaustedKeys.add(this.currentIndex);
    console.log(`🔑 Key #${this.currentIndex + 1} marked exhausted. ${this.keys.length - this.exhaustedKeys.size} key(s) remaining today.`);
    // Move index forward
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  // Reset exhausted keys every day at midnight UTC (TwelveData resets at midnight UTC)
  _scheduleMidnightReset() {
    const now       = new Date();
    const midnight  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const msUntil   = midnight - now;

    setTimeout(() => {
      this.exhaustedKeys.clear();
      this.currentIndex = 0;
      console.log('🔄 TwelveDataClient: All API keys reset at midnight UTC');
      this._scheduleMidnightReset(); // Schedule next day's reset
    }, msUntil);

    console.log(`⏰ API key reset scheduled in ${Math.round(msUntil / 1000 / 60)} minutes (midnight UTC)`);
  }
}