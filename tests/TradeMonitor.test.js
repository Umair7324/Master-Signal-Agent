import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TradeMonitor } from '../src/TradeMonitor.js';
import { makeMockSignal } from './helpers/candles.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function addTrade(monitor, overrides = {}) {
  monitor.addTrade(makeMockSignal(overrides));
}

function firstTrade(monitor) {
  return [...monitor.openTrades.values()][0];
}

// ─────────────────────────────────────────────────────────────────────────────
describe('TradeMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new TradeMonitor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // addTrade()
  // ══════════════════════════════════════════════════════════════════════════
  describe('addTrade()', () => {
    it('adds a trade to openTrades map', () => {
      addTrade(monitor);
      expect(monitor.openTrades.size).toBe(1);
    });

    it('stores correct pair, action, type', () => {
      addTrade(monitor, { pair: 'EUR/USD', action: 'SELL', type: 'SCALP' });
      const trade = firstTrade(monitor);
      expect(trade.pair).toBe('EUR/USD');
      expect(trade.action).toBe('SELL');
      expect(trade.type).toBe('SCALP');
    });

    it('trade ID follows ${pair}:${action}:${type}:${timestamp} pattern', () => {
      addTrade(monitor, { pair: 'BTC/USD', action: 'BUY', type: 'INTRADAY' });
      const id = [...monitor.openTrades.keys()][0];
      expect(id).toMatch(/^BTC\/USD:BUY:INTRADAY:\d+$/);
    });

    it('stores entry, sl, tp, rr, score', () => {
      addTrade(monitor, { entry: 1900, sl: 1885, tp: 1927.4, rr: 1.8, score: 74 });
      const trade = firstTrade(monitor);
      expect(trade.entry).toBe(1900);
      expect(trade.sl).toBe(1885);
      expect(trade.tp).toBeCloseTo(1927.4, 1);
      expect(trade.rr).toBe(1.8);
      expect(trade.score).toBe(74);
    });

    it('stores openTime as a timestamp number', () => {
      addTrade(monitor);
      const trade = firstTrade(monitor);
      expect(typeof trade.openTime).toBe('number');
      expect(trade.openTime).toBeGreaterThan(0);
    });

    it('stores openTimeStr in PKT format', () => {
      addTrade(monitor);
      const trade = firstTrade(monitor);
      expect(trade.openTimeStr).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} PKT$/);
    });

    it('multiple trades are tracked independently', () => {
      addTrade(monitor, { pair: 'XAU/USD' });
      addTrade(monitor, { pair: 'BTC/USD' });
      addTrade(monitor, { pair: 'ETH/USD' });
      expect(monitor.openTrades.size).toBe(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _checkHit() — TP/SL detection logic
  // ══════════════════════════════════════════════════════════════════════════
  describe('_checkHit()', () => {
    const buyTrade = {
      action: 'BUY', entry: 1900, sl: 1880, tp: 1936, rr: 1.8
    };
    const sellTrade = {
      action: 'SELL', entry: 1900, sl: 1920, tp: 1864, rr: 1.8
    };

    // ── BUY trade ──────────────────────────────────────────────────────────
    it('BUY: price >= TP → TP_HIT', () => {
      const hit = monitor._checkHit(buyTrade, 1936);
      expect(hit).not.toBeNull();
      expect(hit.result).toBe('TP_HIT');
    });

    it('BUY: price exactly at TP → TP_HIT', () => {
      const hit = monitor._checkHit(buyTrade, buyTrade.tp);
      expect(hit.result).toBe('TP_HIT');
    });

    it('BUY: price <= SL → SL_HIT', () => {
      const hit = monitor._checkHit(buyTrade, 1879);
      expect(hit).not.toBeNull();
      expect(hit.result).toBe('SL_HIT');
    });

    it('BUY: price exactly at SL → SL_HIT', () => {
      const hit = monitor._checkHit(buyTrade, buyTrade.sl);
      expect(hit.result).toBe('SL_HIT');
    });

    it('BUY: price between SL and TP → null (still open)', () => {
      const hit = monitor._checkHit(buyTrade, 1910);
      expect(hit).toBeNull();
    });

    it('BUY: price just below TP → null (still open)', () => {
      const hit = monitor._checkHit(buyTrade, buyTrade.tp - 0.01);
      expect(hit).toBeNull();
    });

    it('BUY: price just above SL → null (still open)', () => {
      const hit = monitor._checkHit(buyTrade, buyTrade.sl + 0.01);
      expect(hit).toBeNull();
    });

    // ── SELL trade ─────────────────────────────────────────────────────────
    it('SELL: price <= TP → TP_HIT', () => {
      const hit = monitor._checkHit(sellTrade, 1864);
      expect(hit).not.toBeNull();
      expect(hit.result).toBe('TP_HIT');
    });

    it('SELL: price exactly at TP → TP_HIT', () => {
      const hit = monitor._checkHit(sellTrade, sellTrade.tp);
      expect(hit.result).toBe('TP_HIT');
    });

    it('SELL: price >= SL → SL_HIT', () => {
      const hit = monitor._checkHit(sellTrade, 1921);
      expect(hit).not.toBeNull();
      expect(hit.result).toBe('SL_HIT');
    });

    it('SELL: price exactly at SL → SL_HIT', () => {
      const hit = monitor._checkHit(sellTrade, sellTrade.sl);
      expect(hit.result).toBe('SL_HIT');
    });

    it('SELL: price between TP and SL → null', () => {
      const hit = monitor._checkHit(sellTrade, 1885);
      expect(hit).toBeNull();
    });

    it('SELL: price just above TP → null', () => {
      const hit = monitor._checkHit(sellTrade, sellTrade.tp + 0.01);
      expect(hit).toBeNull();
    });

    it('SELL: price just below SL → null', () => {
      const hit = monitor._checkHit(sellTrade, sellTrade.sl - 0.01);
      expect(hit).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _pips() — R calculation
  // ══════════════════════════════════════════════════════════════════════════
  describe('_pips()', () => {
    const trade = { entry: 1900, sl: 1880, tp: 1936 };  // risk = 20, reward = 36

    it('TP close: R = reward/risk', () => {
      const r = monitor._pips(trade, 1936);
      expect(parseFloat(r)).toBeCloseTo(36 / 20, 2);
    });

    it('SL close: R = 1.00 (at stop)', () => {
      const r = monitor._pips(trade, 1880);
      expect(parseFloat(r)).toBeCloseTo(1.00, 2);
    });

    it('partial win: R > 0 but < TP', () => {
      const r = monitor._pips(trade, 1920);
      expect(parseFloat(r)).toBeCloseTo(20 / 20, 2);
    });

    it('returns string value (from .toFixed(2))', () => {
      const r = monitor._pips(trade, 1936);
      expect(typeof r).toBe('string');
    });

    it('SELL trade: R calculated on absolute difference', () => {
      const sellTrade = { entry: 1900, sl: 1920, tp: 1864 };
      // Close at TP (1864): reward = |1864 - 1900| = 36, risk = |1900 - 1920| = 20
      const r = monitor._pips(sellTrade, 1864);
      expect(parseFloat(r)).toBeCloseTo(36 / 20, 2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _formatPrice()
  // ══════════════════════════════════════════════════════════════════════════
  describe('_formatPrice()', () => {
    it('XAU/USD → 2 decimal places', () => {
      expect(monitor._formatPrice('XAU/USD', 1923.456)).toBe('1923.46');
    });

    it('BTC/USD → 0 decimal places', () => {
      expect(monitor._formatPrice('BTC/USD', 65432.8)).toBe('65433');
    });

    it('ETH/USD → 1 decimal place', () => {
      expect(monitor._formatPrice('ETH/USD', 3145.67)).toBe('3145.7');
    });

    it('EUR/USD → 5 decimal places', () => {
      expect(monitor._formatPrice('EUR/USD', 1.08756)).toBe('1.08756');
    });

    it('GBP/USD → 5 decimal places', () => {
      expect(monitor._formatPrice('GBP/USD', 1.26543)).toBe('1.26543');
    });

    it('invalid price returns —', () => {
      expect(monitor._formatPrice('XAU/USD', null)).toBe('—');
      expect(monitor._formatPrice('XAU/USD', NaN)).toBe('—');
      expect(monitor._formatPrice('XAU/USD', 0)).toBe('—');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getDuration()
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getDuration()', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('less than 60 minutes → shows Xm', () => {
      const openTime = Date.now();
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(monitor._getDuration(openTime)).toBe('30m');
    });

    it('exactly 60 minutes → 1h 0m', () => {
      const openTime = Date.now();
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(monitor._getDuration(openTime)).toBe('1h 0m');
    });

    it('90 minutes → 1h 30m', () => {
      const openTime = Date.now();
      vi.advanceTimersByTime(90 * 60 * 1000);
      expect(monitor._getDuration(openTime)).toBe('1h 30m');
    });

    it('3 hours 15 min → 3h 15m', () => {
      const openTime = Date.now();
      vi.advanceTimersByTime((3 * 60 + 15) * 60 * 1000);
      expect(monitor._getDuration(openTime)).toBe('3h 15m');
    });

    it('0 minutes → 0m', () => {
      const openTime = Date.now();
      expect(monitor._getDuration(openTime)).toBe('0m');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getStatus()
  // ══════════════════════════════════════════════════════════════════════════
  describe('getStatus()', () => {
    it('returns openTrades count = 0 when empty', () => {
      expect(monitor.getStatus().openTrades).toBe(0);
    });

    it('returns correct count after adding trades', () => {
      addTrade(monitor, { pair: 'XAU/USD' });
      addTrade(monitor, { pair: 'EUR/USD' });
      expect(monitor.getStatus().openTrades).toBe(2);
    });

    it('trades array has correct shape', () => {
      addTrade(monitor, { pair: 'BTC/USD', action: 'BUY', type: 'SCALP', entry: 65000 });
      const { trades } = monitor.getStatus();
      expect(trades).toHaveLength(1);
      expect(trades[0]).toMatchObject({
        pair: 'BTC/USD', action: 'BUY', type: 'SCALP', entry: 65000
      });
      expect(trades[0]).toHaveProperty('openedAt');
    });

    it('status reflects removed trade after checkAll', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      expect(monitor.getStatus().openTrades).toBe(1);

      // Mock getLivePrice to return price at TP → trade closes
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1940);
      vi.spyOn(monitor, '_sendResult').mockResolvedValue();   // skip Discord call
      vi.spyOn(monitor, '_sleep').mockResolvedValue();

      await monitor.checkAll();
      expect(monitor.getStatus().openTrades).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // checkAll() — end-to-end trade monitoring (mocked API + Discord)
  // ══════════════════════════════════════════════════════════════════════════
  describe('checkAll()', () => {
    beforeEach(() => {
      vi.spyOn(monitor, '_sendResult').mockResolvedValue();
      vi.spyOn(monitor, '_sleep').mockResolvedValue();
    });

    it('does nothing when no open trades', async () => {
      const getLivePriceSpy = vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1900);
      await monitor.checkAll();
      expect(getLivePriceSpy).not.toHaveBeenCalled();
    });

    it('removes BUY trade when TP hit', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1940); // above TP

      await monitor.checkAll();
      expect(monitor.openTrades.size).toBe(0);
    });

    it('removes BUY trade when SL hit', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1875); // below SL

      await monitor.checkAll();
      expect(monitor.openTrades.size).toBe(0);
    });

    it('keeps BUY trade open when price between SL and TP', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1910); // still open

      await monitor.checkAll();
      expect(monitor.openTrades.size).toBe(1);
    });

    it('removes SELL trade when TP hit (price dropped)', async () => {
      addTrade(monitor, { pair: 'XAU/USD', action: 'SELL', entry: 1900, sl: 1920, tp: 1864 });
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1860); // at/below TP

      await monitor.checkAll();
      expect(monitor.openTrades.size).toBe(0);
    });

    it('removes SELL trade when SL hit (price rose)', async () => {
      addTrade(monitor, { pair: 'XAU/USD', action: 'SELL', entry: 1900, sl: 1920, tp: 1864 });
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1925); // above SL

      await monitor.checkAll();
      expect(monitor.openTrades.size).toBe(0);
    });

    it('calls _sendResult with correct result on TP hit', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1940);
      const sendSpy = vi.spyOn(monitor, '_sendResult').mockResolvedValue();

      await monitor.checkAll();
      expect(sendSpy).toHaveBeenCalledOnce();
      const [, hitArg] = sendSpy.mock.calls[0];
      expect(hitArg.result).toBe('TP_HIT');
    });

    it('calls _sendResult with SL_HIT when stop hit', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1875);
      const sendSpy = vi.spyOn(monitor, '_sendResult').mockResolvedValue();

      await monitor.checkAll();
      const [, hitArg] = sendSpy.mock.calls[0];
      expect(hitArg.result).toBe('SL_HIT');
    });

    it('handles price fetch failure gracefully (keeps trade open)', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      vi.spyOn(monitor, '_getLivePrice').mockRejectedValue(new Error('API down'));

      await expect(monitor.checkAll()).resolves.not.toThrow();
      expect(monitor.openTrades.size).toBe(1); // trade still tracked
    });

    it('only fetches price once per unique pair across multiple trades', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      addTrade(monitor, { pair: 'XAU/USD', entry: 1905, sl: 1885, tp: 1940 });
      const getLiveSpy = vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1910);

      await monitor.checkAll();
      // Only called once for XAU/USD (deduplicated)
      expect(getLiveSpy).toHaveBeenCalledTimes(1);
    });

    it('fetches price for each unique pair', async () => {
      addTrade(monitor, { pair: 'XAU/USD', entry: 1900, sl: 1880, tp: 1936 });
      addTrade(monitor, { pair: 'BTC/USD', entry: 65000, sl: 64000, tp: 66170 });
      const getLiveSpy = vi.spyOn(monitor, '_getLivePrice').mockResolvedValue(1910);

      await monitor.checkAll();
      expect(getLiveSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getPKT() — timezone helper
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getPKT()', () => {
    it('returns a string matching YYYY-MM-DD HH:MM PKT', () => {
      expect(monitor._getPKT()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} PKT$/);
    });

    it('PKT is UTC+5', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
      expect(monitor._getPKT()).toBe('2024-06-15 17:00 PKT');
      vi.useRealTimers();
    });
  });
});
