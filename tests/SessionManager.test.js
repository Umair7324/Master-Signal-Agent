import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../src/SessionManager.js';

// Helper: fix system time to a specific UTC hour:minute
function setUTC(hour, minute = 0) {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  vi.setSystemTime(d);
}

describe('SessionManager', () => {
  let sm;

  beforeEach(() => {
    sm = new SessionManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── getSession() — session name & boost ─────────────────────────────────
  describe('getSession() — correct session detected', () => {
    it('03:30 UTC → Asian (boost 5, active)', () => {
      setUTC(3, 30);
      const s = sm.getSession();
      expect(s.name).toBe('Asian');
      expect(s.boost).toBe(5);
      expect(s.active).toBe(true);
    });

    it('00:00 UTC → Asian (start of session)', () => {
      setUTC(0, 0);
      const s = sm.getSession();
      expect(s.name).toBe('Asian');
    });

    it('06:59 UTC → still Asian', () => {
      setUTC(6, 59);
      expect(sm.getSession().name).toBe('Asian');
    });

    it('07:00 UTC → London Open (boost 15)', () => {
      setUTC(7, 0);
      const s = sm.getSession();
      expect(s.name).toBe('London Open');
      expect(s.boost).toBe(15);
      expect(s.active).toBe(true);
    });

    it('08:45 UTC → London Open', () => {
      setUTC(8, 45);
      expect(sm.getSession().name).toBe('London Open');
    });

    it('09:29 UTC → still London Open (boundary)', () => {
      setUTC(9, 29);
      expect(sm.getSession().name).toBe('London Open');
    });

    it('09:30 UTC → London (boost 10)', () => {
      setUTC(9, 30);
      const s = sm.getSession();
      expect(s.name).toBe('London');
      expect(s.boost).toBe(10);
      expect(s.active).toBe(true);
    });

    it('11:00 UTC → London', () => {
      setUTC(11, 0);
      expect(sm.getSession().name).toBe('London');
    });

    it('11:59 UTC → still London (boundary)', () => {
      setUTC(11, 59);
      expect(sm.getSession().name).toBe('London');
    });

    it('12:00 UTC → London-NY Overlap (boost 15)', () => {
      setUTC(12, 0);
      const s = sm.getSession();
      expect(s.name).toBe('London-NY Overlap');
      expect(s.boost).toBe(15);
      expect(s.active).toBe(true);
    });

    it('14:30 UTC → London-NY Overlap', () => {
      setUTC(14, 30);
      expect(sm.getSession().name).toBe('London-NY Overlap');
    });

    it('15:59 UTC → still London-NY Overlap (boundary)', () => {
      setUTC(15, 59);
      expect(sm.getSession().name).toBe('London-NY Overlap');
    });

    it('16:00 UTC → NY Session (boost 8)', () => {
      setUTC(16, 0);
      const s = sm.getSession();
      expect(s.name).toBe('NY');
      expect(s.boost).toBe(8);
      expect(s.active).toBe(true);
    });

    it('19:00 UTC → NY Session', () => {
      setUTC(19, 0);
      expect(sm.getSession().name).toBe('NY');
    });

    it('20:59 UTC → still NY Session (boundary)', () => {
      setUTC(20, 59);
      expect(sm.getSession().name).toBe('NY');
    });

    it('21:00 UTC → Off-Hours (boost 0, inactive)', () => {
      setUTC(21, 0);
      const s = sm.getSession();
      expect(s.name).toBe('Off-Hours');
      expect(s.boost).toBe(0);
      expect(s.active).toBe(false);
    });

    it('23:00 UTC → Off-Hours', () => {
      setUTC(23, 0);
      const s = sm.getSession();
      expect(s.name).toBe('Off-Hours');
      expect(s.active).toBe(false);
    });
  });

  // ── boost values capped at 15 by MasterEngine ────────────────────────────
  describe('getSession() — boost values', () => {
    it('highest boosts are 15 (London Open and London-NY Overlap)', () => {
      setUTC(8, 0);
      expect(sm.getSession().boost).toBe(15);
      setUTC(13, 0);
      expect(sm.getSession().boost).toBe(15);
    });

    it('Off-Hours boost is 0', () => {
      setUTC(22, 0);
      expect(sm.getSession().boost).toBe(0);
    });
  });

  // ── isForexPair() ────────────────────────────────────────────────────────
  describe('isForexPair()', () => {
    it('XAU/USD is forex', () => expect(sm.isForexPair('XAU/USD')).toBe(true));
    it('EUR/USD is forex', () => expect(sm.isForexPair('EUR/USD')).toBe(true));
    it('GBP/USD is forex', () => expect(sm.isForexPair('GBP/USD')).toBe(true));
    it('BTC/USD is NOT forex', () => expect(sm.isForexPair('BTC/USD')).toBe(false));
    it('ETH/USD is NOT forex', () => expect(sm.isForexPair('ETH/USD')).toBe(false));
  });

  // ── shouldAnalyze() ──────────────────────────────────────────────────────
  describe('shouldAnalyze()', () => {
    it('BTC/USD always analyzed — even during Off-Hours', () => {
      setUTC(22, 30);
      expect(sm.shouldAnalyze('BTC/USD')).toBe(true);
    });

    it('ETH/USD always analyzed — even during Off-Hours', () => {
      setUTC(23, 0);
      expect(sm.shouldAnalyze('ETH/USD')).toBe(true);
    });

    it('XAU/USD skipped during Off-Hours', () => {
      setUTC(21, 0);
      expect(sm.shouldAnalyze('XAU/USD')).toBe(false);
    });

    it('EUR/USD skipped during Off-Hours', () => {
      setUTC(22, 0);
      expect(sm.shouldAnalyze('EUR/USD')).toBe(false);
    });

    it('GBP/USD analyzed during London Open', () => {
      setUTC(8, 0);
      expect(sm.shouldAnalyze('GBP/USD')).toBe(true);
    });

    it('XAU/USD analyzed during London-NY Overlap', () => {
      setUTC(13, 0);
      expect(sm.shouldAnalyze('XAU/USD')).toBe(true);
    });

    it('forex analyzed during Asian session (active = true)', () => {
      setUTC(4, 0);
      expect(sm.shouldAnalyze('EUR/USD')).toBe(true);
    });
  });

  // ── getPKTTime() ─────────────────────────────────────────────────────────
  describe('getPKTTime()', () => {
    it('returns PKT string in correct format', () => {
      setUTC(12, 0);  // UTC noon = 17:00 PKT
      const pkt = sm.getPKTTime();
      expect(pkt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} PKT$/);
    });

    it('PKT is UTC+5 (17:00 PKT when UTC is 12:00)', () => {
      // Set to a fixed UTC time to verify +5h offset
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
      const pkt = sm.getPKTTime();
      expect(pkt).toBe('2024-06-15 17:00 PKT');
    });
  });
});
