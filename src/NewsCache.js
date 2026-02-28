// NewsCache.js
// Fetches Forex Factory RSS, parses USD events, determines gold/forex bias
// Refreshes every 30 minutes to stay current without hammering the API

import fetch from 'node-fetch';
import xml2js from 'xml2js';

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';

// USD event weights — same proven system from your News Agent
const USD_EVENTS = {
  'Non-Farm Employment Change':      { weight: 3, goodForUSD: null },  // direction set by actual vs forecast
  'Non-Farm Payrolls':               { weight: 3, goodForUSD: null },
  'CPI':                             { weight: 3, goodForUSD: null },
  'Core CPI':                        { weight: 3, goodForUSD: null },
  'FOMC':                            { weight: 3, goodForUSD: null },
  'Federal Funds Rate':              { weight: 3, goodForUSD: null },
  'GDP':                             { weight: 3, goodForUSD: null },
  'ADP Non-Farm':                    { weight: 2, goodForUSD: null },
  'Unemployment Claims':             { weight: 2, goodForUSD: null },
  'Retail Sales':                    { weight: 2, goodForUSD: null },
  'ISM':                             { weight: 2, goodForUSD: null },
  'PMI':                             { weight: 2, goodForUSD: null },
  'PPI':                             { weight: 2, goodForUSD: null },
  'Core PPI':                        { weight: 2, goodForUSD: null },
};

// High = good for USD (bad for gold)
const GOOD_FOR_USD_EVENTS = [
  'Non-Farm', 'ADP', 'Retail Sales', 'ISM Manufacturing', 'ISM Services',
  'PMI', 'GDP', 'Federal Funds Rate'  // rate hike = good for USD
];

// Low = bad for USD (good for gold)
const BAD_FOR_USD_EVENTS = [
  'Unemployment Claims', 'Initial Jobless', 'CPI',  // high inflation = gold up
  'Core CPI', 'PPI', 'Core PPI'
];

export class NewsCache {
  constructor() {
    this.bias = 'NEUTRAL';     // BULLISH_GOLD | BEARISH_GOLD | NEUTRAL
    this.score = 0;
    this.events = [];
    this.lastFetch = null;
    this.REFRESH_INTERVAL = 30 * 60 * 1000; // 30 min
  }

  async refresh() {
    const now = Date.now();
    if (this.lastFetch && now - this.lastFetch < this.REFRESH_INTERVAL) return;

    try {
      const res = await fetch(FF_URL, { timeout: 10000 });
      const text = await res.text();
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(text);

      const events = result?.weeklyevents?.event || [];
      const todayStr = this._getTodayStr();

      let bullishScore = 0;
      let bearishScore = 0;
      const parsed = [];

      for (const e of events) {
        const country = (e.country?.[0] || '').toUpperCase();
        const title   = e.title?.[0] || '';
        const date    = e.date?.[0] || '';
        const impact  = e.impact?.[0] || '';
        const forecast = parseFloat(e.forecast?.[0]) || null;
        const actual   = parseFloat(e.actual?.[0])   || null;
        const previous = parseFloat(e.previous?.[0]) || null;

        if (country !== 'USD') continue;
        if (!['High', 'Medium'].includes(impact)) continue;
        if (date !== todayStr) continue;

        // Find matching event
        let weight = 1;
        let direction = null;

        for (const [key, val] of Object.entries(USD_EVENTS)) {
          if (title.includes(key)) {
            weight = val.weight;
            break;
          }
        }

        // Determine direction from actual vs forecast
        if (actual !== null && forecast !== null) {
          const isBetterForUSD = this._isBetterForUSD(title, actual, forecast);
          if (isBetterForUSD) {
            bullishScore += weight;   // USD strong → gold bearish
            direction = 'USD+';
          } else {
            bearishScore += weight;   // USD weak → gold bullish
            direction = 'USD-';
          }
        } else if (forecast !== null && previous !== null) {
          // Pre-release: forecast vs previous
          const isBetterForUSD = this._isBetterForUSD(title, forecast, previous);
          weight *= 0.8; // Pre-release = less weight
          if (isBetterForUSD) {
            bullishScore += weight;
            direction = 'USD+ (expected)';
          } else {
            bearishScore += weight;
            direction = 'USD- (expected)';
          }
        }

        parsed.push({ title, impact, direction, weight });
      }

      const netScore = bullishScore - bearishScore;
      this.score = netScore;
      this.events = parsed;
      this.lastFetch = now;

      // Bias for gold: USD strong → SELL gold / USD weak → BUY gold
      if (netScore > 4)       this.bias = 'BEARISH_GOLD';   // SELL XAU, BUY USD pairs
      else if (netScore < -4) this.bias = 'BULLISH_GOLD';   // BUY XAU, SELL USD pairs
      else if (netScore > 2)  this.bias = 'SLIGHT_BEARISH_GOLD';
      else if (netScore < -2) this.bias = 'SLIGHT_BULLISH_GOLD';
      else                    this.bias = 'NEUTRAL';

      console.log(`📰 News bias updated: ${this.bias} (score: ${netScore.toFixed(1)})`);
    } catch (err) {
      console.error('📰 News fetch failed:', err.message);
      // Keep previous bias on failure
    }
  }

  // Returns bias relevant to a specific pair
  getBiasForPair(pair) {
    if (pair === 'XAU/USD') return this.bias;
    
    // For EUR/GBP: USD strong = sell EUR/GBP (opposite of gold)
    if (['EUR/USD', 'GBP/USD'].includes(pair)) {
      if (this.bias === 'BEARISH_GOLD')        return 'BEARISH'; // sell EUR/GBP
      if (this.bias === 'BULLISH_GOLD')        return 'BULLISH'; // buy EUR/GBP
      if (this.bias === 'SLIGHT_BEARISH_GOLD') return 'SLIGHT_BEARISH';
      if (this.bias === 'SLIGHT_BULLISH_GOLD') return 'SLIGHT_BULLISH';
      return 'NEUTRAL';
    }

    // Crypto: not correlated to USD events — neutral
    return 'NEUTRAL';
  }

  getBias() {
    return this.bias;
  }

  getSummary() {
    return {
      bias: this.bias,
      score: this.score,
      eventCount: this.events.length
    };
  }

  _getTodayStr() {
    const now = new Date();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const yyyy = now.getUTCFullYear();
    return `${mm}-${dd}-${yyyy}`;
  }

  // Higher = better for USD?
  // Employment: higher = good, Unemployment: lower = good, Inflation: tricky
  _isBetterForUSD(title, actual, previous) {
    const t = title.toLowerCase();
    if (t.includes('unemployment') || t.includes('jobless') || t.includes('claims')) {
      return actual < previous; // Lower unemployment = good for USD
    }
    if (t.includes('cpi') || t.includes('ppi') || t.includes('inflation')) {
      return actual > previous; // Higher inflation often hurts USD short-term, helps gold
      // Note: we treat higher CPI as BAD for USD (gold up)
    }
    // Default: higher = good for USD (employment, GDP, PMI, ISM, Retail Sales)
    return actual > previous;
  }
}
