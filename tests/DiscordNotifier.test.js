import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist the mock so it runs before the module imports node-fetch
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: fetchMock }));

import { DiscordNotifier } from '../src/DiscordNotifier.js';
import { makeMockSignal } from './helpers/candles.js';

describe('DiscordNotifier', () => {
  let notifier;

  beforeEach(() => {
    notifier = new DiscordNotifier();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _scoreBar()
  // ══════════════════════════════════════════════════════════════════════════
  describe('_scoreBar()', () => {
    it('score 100 → 10 filled blocks', () => {
      expect(notifier._scoreBar(100)).toBe('██████████ 100/100');
    });

    it('score 0 → 10 empty blocks', () => {
      expect(notifier._scoreBar(0)).toBe('░░░░░░░░░░ 0/100');
    });

    it('score 50 → 5 filled + 5 empty', () => {
      expect(notifier._scoreBar(50)).toBe('█████░░░░░ 50/100');
    });

    it('score 80 → 8 filled + 2 empty', () => {
      expect(notifier._scoreBar(80)).toBe('████████░░ 80/100');
    });

    it('score 74 → 7 filled + 3 empty (rounds to nearest 10)', () => {
      // Math.round(74/10) = 7
      expect(notifier._scoreBar(74)).toBe('███████░░░ 74/100');
    });

    it('score 65 → 7 filled + 3 empty', () => {
      // Math.round(65/10) = 7 (rounds up)
      expect(notifier._scoreBar(65)).toBe('███████░░░ 65/100');
    });

    it('score 45 → 5 filled + 5 empty', () => {
      // Math.round(45/10) = 5 (rounds up)
      expect(notifier._scoreBar(45)).toBe('█████░░░░░ 45/100');
    });

    it('bar always has exactly 10 total blocks', () => {
      [0, 25, 50, 75, 100].forEach(score => {
        const bar = notifier._scoreBar(score);
        const blocks = (bar.match(/[█░]/g) || []).length;
        expect(blocks).toBe(10);
      });
    });

    it('bar string ends with score/100', () => {
      const bar = notifier._scoreBar(82);
      expect(bar).toContain('82/100');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _pts()
  // ══════════════════════════════════════════════════════════════════════════
  describe('_pts()', () => {
    it('positive value → +N✅', () => {
      expect(notifier._pts(20)).toBe('+20✅');
    });

    it('negative value → N❌', () => {
      expect(notifier._pts(-8)).toBe('-8❌');
    });

    it('zero → "0"', () => {
      expect(notifier._pts(0)).toBe('0');
    });

    it('null → —', () => {
      expect(notifier._pts(null)).toBe('—');
    });

    it('undefined → —', () => {
      expect(notifier._pts(undefined)).toBe('—');
    });

    it('string number → treats as number', () => {
      // Number('12') = 12 → positive
      expect(notifier._pts('12')).toBe('+12✅');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _formatPrice()
  // ══════════════════════════════════════════════════════════════════════════
  describe('_formatPrice()', () => {
    it('XAU/USD → 2 decimal places', () => {
      expect(notifier._formatPrice('XAU/USD', 2013.567)).toBe('2013.57');
    });

    it('BTC/USD → 0 decimal places', () => {
      expect(notifier._formatPrice('BTC/USD', 65432.9)).toBe('65433');
    });

    it('ETH/USD → 1 decimal place', () => {
      expect(notifier._formatPrice('ETH/USD', 3456.78)).toBe('3456.8');
    });

    it('EUR/USD → 5 decimal places', () => {
      expect(notifier._formatPrice('EUR/USD', 1.08756)).toBe('1.08756');
    });

    it('GBP/USD → 5 decimal places', () => {
      expect(notifier._formatPrice('GBP/USD', 1.26543)).toBe('1.26543');
    });

    it('null price → —', () => {
      expect(notifier._formatPrice('XAU/USD', null)).toBe('—');
    });

    it('NaN price → —', () => {
      expect(notifier._formatPrice('XAU/USD', NaN)).toBe('—');
    });

    it('0 price → — (falsy)', () => {
      expect(notifier._formatPrice('XAU/USD', 0)).toBe('—');
    });

    it('unknown pair falls back to 5 decimal places', () => {
      expect(notifier._formatPrice('USD/JPY', 149.123)).toBe('149.12300');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _getPKT()
  // ══════════════════════════════════════════════════════════════════════════
  describe('_getPKT()', () => {
    it('returns YYYY-MM-DD HH:MM PKT format', () => {
      expect(notifier._getPKT()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} PKT$/);
    });

    it('PKT is UTC+5', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T08:00:00Z'));
      expect(notifier._getPKT()).toBe('2024-06-15 13:00 PKT');
      vi.useRealTimers();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // send() — skips on empty input
  // ══════════════════════════════════════════════════════════════════════════
  describe('send()', () => {
    it('does nothing when signals is null', async () => {
      const spy = vi.spyOn(notifier, '_sendSignal').mockResolvedValue();
      await notifier.send(null);
      expect(spy).not.toHaveBeenCalled();
    });

    it('does nothing when signals is empty array', async () => {
      const spy = vi.spyOn(notifier, '_sendSignal').mockResolvedValue();
      await notifier.send([]);
      expect(spy).not.toHaveBeenCalled();
    });

    it('calls _sendSignal once per signal', async () => {
      vi.spyOn(notifier, '_sleep').mockResolvedValue();
      const spy = vi.spyOn(notifier, '_sendSignal').mockResolvedValue();
      const signals = [makeMockSignal(), makeMockSignal({ pair: 'EUR/USD' })];
      await notifier.send(signals);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('continues to next signal even if one _sendSignal throws', async () => {
      vi.spyOn(notifier, '_sleep').mockResolvedValue();
      const spy = vi.spyOn(notifier, '_sendSignal')
        .mockRejectedValueOnce(new Error('Webhook timeout'))
        .mockResolvedValueOnce();
      const signals = [makeMockSignal(), makeMockSignal({ pair: 'EUR/USD' })];
      await expect(notifier.send(signals)).resolves.not.toThrow();
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _sendSignal() — embed structure (node-fetch mocked)
  // ══════════════════════════════════════════════════════════════════════════
  describe('_sendSignal() — embed construction', () => {
    beforeEach(() => {
      // Default: successful webhook response
      fetchMock.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
      fetchMock.mockReset();
    });

    it('is called with correct signal shape', async () => {
      const sendSpy = vi.spyOn(notifier, '_sendSignal');
      vi.spyOn(notifier, '_sleep').mockResolvedValue();
      const sig = makeMockSignal({ pair: 'XAU/USD', action: 'BUY', type: 'INTRADAY', score: 74 });
      await notifier.send([sig]);
      expect(sendSpy).toHaveBeenCalledWith(sig);
    });

    it('does not throw for SCALP BUY signal', async () => {
      const sig = makeMockSignal({ type: 'SCALP', action: 'BUY' });
      await expect(notifier._sendSignal(sig)).resolves.not.toThrow();
    });

    it('does not throw for SELL signal', async () => {
      const sig = makeMockSignal({ action: 'SELL', type: 'INTRADAY' });
      await expect(notifier._sendSignal(sig)).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Color constants (via actual embed building — node-fetch intercepted)
  // ══════════════════════════════════════════════════════════════════════════
  describe('color selection per action+type', () => {
    beforeEach(() => {
      fetchMock.mockReset();
    });

    it('BUY SCALP uses bright green (0x00C853)', async () => {
      let capturedBody;
      fetchMock.mockImplementation(async (_u, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });

      const sig = makeMockSignal({ action: 'BUY', type: 'SCALP' });
      await notifier._sendSignal(sig);

      expect(capturedBody.embeds[0].color).toBe(0x00C853);
    });

    it('BUY INTRADAY uses dark green (0x1B5E20)', async () => {
      let capturedBody;
      fetchMock.mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });

      const sig = makeMockSignal({ action: 'BUY', type: 'INTRADAY' });
      await notifier._sendSignal(sig);

      expect(capturedBody.embeds[0].color).toBe(0x1B5E20);
    });

    it('SELL SCALP uses bright red (0xD50000)', async () => {
      let capturedBody;
      fetchMock.mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });

      const sig = makeMockSignal({ action: 'SELL', type: 'SCALP' });
      await notifier._sendSignal(sig);

      expect(capturedBody.embeds[0].color).toBe(0xD50000);
    });

    it('SELL INTRADAY uses dark red (0xB71C1C)', async () => {
      let capturedBody;
      fetchMock.mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });

      const sig = makeMockSignal({ action: 'SELL', type: 'INTRADAY' });
      await notifier._sendSignal(sig);

      expect(capturedBody.embeds[0].color).toBe(0xB71C1C);
    });

    it('embed title contains pair, action, and type', async () => {
      let capturedBody;
      fetchMock.mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });

      const sig = makeMockSignal({ pair: 'EUR/USD', action: 'BUY', type: 'INTRADAY' });
      await notifier._sendSignal(sig);

      const title = capturedBody.embeds[0].title;
      expect(title).toContain('EUR/USD');
      expect(title).toContain('BUY');
      expect(title).toContain('INTRADAY');
    });

    it('throws when Discord webhook returns non-ok status', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' });

      const sig = makeMockSignal();
      await expect(notifier._sendSignal(sig)).rejects.toThrow('Discord webhook failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // sendSkip() — signal-skipped notifications
  // ══════════════════════════════════════════════════════════════════════════
  describe('sendSkip()', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
      fetchMock.mockReset();
    });

    it('sends a POST to the webhook', async () => {
      await notifier.sendSkip('XAU/USD', 'BUY', 'Signal skipped — News bias conflict');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.method).toBe('POST');
    });

    it('embed uses grey color (0x607D8B)', async () => {
      let body;
      fetchMock.mockImplementation(async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true }; });
      await notifier.sendSkip('XAU/USD', 'BUY', 'Signal skipped — News bias conflict');
      expect(body.embeds[0].color).toBe(0x607D8B);
    });

    it('embed title contains pair, action, and SKIPPED', async () => {
      let body;
      fetchMock.mockImplementation(async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true }; });
      await notifier.sendSkip('EUR/USD', 'SELL', 'Signal skipped — RSI & Stoch both 0');
      const title = body.embeds[0].title;
      expect(title).toContain('EUR/USD');
      expect(title).toContain('SELL');
      expect(title).toContain('SKIPPED');
    });

    it('embed description contains the skip reason', async () => {
      let body;
      fetchMock.mockImplementation(async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true }; });
      const reason = 'Signal skipped — News bias conflict';
      await notifier.sendSkip('XAU/USD', 'BUY', reason);
      expect(body.embeds[0].description).toContain(reason);
    });

    it('uses 🟢 emoji for BUY in title', async () => {
      let body;
      fetchMock.mockImplementation(async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true }; });
      await notifier.sendSkip('XAU/USD', 'BUY', 'reason');
      expect(body.embeds[0].title).toContain('🟢');
    });

    it('uses 🔴 emoji for SELL in title', async () => {
      let body;
      fetchMock.mockImplementation(async (_u, opts) => { body = JSON.parse(opts.body); return { ok: true }; });
      await notifier.sendSkip('GBP/USD', 'SELL', 'reason');
      expect(body.embeds[0].title).toContain('🔴');
    });

    it('does not throw when webhook returns non-ok', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
      await expect(notifier.sendSkip('BTC/USD', 'BUY', 'reason')).resolves.not.toThrow();
    });

    it('does not throw when fetch rejects', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));
      await expect(notifier.sendSkip('ETH/USD', 'BUY', 'reason')).resolves.not.toThrow();
    });
  });
});
