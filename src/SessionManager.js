// SessionManager.js — v2 (Apr 5 2026 audit rewrite)
// Detects current market session and returns boost multiplier for signal scoring
//
// CHANGELOG v2:
// Session boosts rebalanced based on actual WR data (1,097 closed signals):
//   Session          Old Boost  WR      New Boost  Rationale
//   ─────────────────────────────────────────────────────────
//   London Open       +15      49.4%    +10        Best session, still top boost
//   London-NY Overlap +15      46.7%    +8         Was over-boosted vs its WR
//   London            +10      45.1%    +6         Mediocre WR, reduced
//   NY                +8       (est)    +4         Average session
//   Asian             +5       42.9%    +2         Below avg, signals need stronger TA
//   Off-Hours         +0       41.4%    +0         Unchanged
//
// Max session boost now +10 (was +15). MasterEngine caps at 10.

export class SessionManager {

  getSession() {
    const utcHour = new Date().getUTCHours();
    const utcMin = new Date().getUTCMinutes();
    const timeDecimal = utcHour + utcMin / 60;

    // Asian Session: 00:00 – 07:00 UTC
    if (timeDecimal >= 0 && timeDecimal < 7) {
      return {
        name: 'Asian',
        emoji: '🌏',
        boost: 2,          // was 5. Below-avg WR (42.9%), signals need stronger technicals
        active: true,
        description: 'Asian Session — Lower volatility, signals need stronger confluence'
      };
    }

    // London Open: 07:00 – 09:30 UTC (most explosive)
    if (timeDecimal >= 7 && timeDecimal < 9.5) {
      return {
        name: 'London Open',
        emoji: '🇬🇧',
        boost: 10,         // was 15. Best session (49.4% WR), still gets top boost
        active: true,
        description: 'London Open — Highest momentum, best session by WR'
      };
    }

    // London Session: 09:30 – 12:00 UTC
    if (timeDecimal >= 9.5 && timeDecimal < 12) {
      return {
        name: 'London',
        emoji: '🏦',
        boost: 6,          // was 10. Mediocre WR (45.1%)
        active: true,
        description: 'London Session — Moderate directional moves'
      };
    }

    // London-NY Overlap: 12:00 – 16:00 UTC
    if (timeDecimal >= 12 && timeDecimal < 16) {
      return {
        name: 'London-NY Overlap',
        emoji: '🔥',
        boost: 8,          // was 15. Good but not as good as London Open (46.7% WR)
        active: true,
        description: 'London-NY Overlap — High liquidity, strong signals'
      };
    }

    // NY Session: 16:00 – 21:00 UTC
    if (timeDecimal >= 16 && timeDecimal < 21) {
      return {
        name: 'NY',
        emoji: '🗽',
        boost: 4,          // was 8. Average session
        active: true,
        description: 'NY Session — Moderate momentum'
      };
    }

    // Off-hours: 21:00 – 00:00 UTC
    return {
      name: 'Off-Hours',
      emoji: '🌙',
      boost: 0,            // unchanged
      active: false,
      description: 'Off-Hours — Low liquidity for forex'
    };
  }

  isForexPair(pair) {
    return ['XAU/USD', 'EUR/USD'].includes(pair);  // GBP/USD removed from system
  }

  shouldAnalyze(pair) {
    if (!this.isForexPair(pair)) return true;
    const session = this.getSession();
    return session.active;
  }

  getPKTTime() {
    const now = new Date();
    const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    return pkt.toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
  }
}