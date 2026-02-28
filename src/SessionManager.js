// SessionManager.js
// Detects current market session and returns boost multiplier for signal scoring

export class SessionManager {
  
  // Returns session info based on current UTC hour
  getSession() {
    const utcHour = new Date().getUTCHours();
    const utcMin = new Date().getUTCMinutes();
    const timeDecimal = utcHour + utcMin / 60;

    // Asian Session: 00:00 – 07:00 UTC
    if (timeDecimal >= 0 && timeDecimal < 7) {
      return {
        name: 'Asian',
        emoji: '🌏',
        boost: 5,          // Least volatile for forex, ok for crypto
        active: true,
        description: 'Asian Session — Lower volatility, good for crypto'
      };
    }

    // London Open: 07:00 – 09:30 UTC (most explosive)
    if (timeDecimal >= 7 && timeDecimal < 9.5) {
      return {
        name: 'London Open',
        emoji: '🇬🇧',
        boost: 15,         // Highest volatility = strongest signals
        active: true,
        description: 'London Open — Highest momentum, premium signals'
      };
    }

    // London Session: 09:30 – 12:00 UTC
    if (timeDecimal >= 9.5 && timeDecimal < 12) {
      return {
        name: 'London',
        emoji: '🏦',
        boost: 10,
        active: true,
        description: 'London Session — Strong directional moves'
      };
    }

    // London-NY Overlap: 12:00 – 16:00 UTC (2nd most volatile)
    if (timeDecimal >= 12 && timeDecimal < 16) {
      return {
        name: 'London-NY Overlap',
        emoji: '🔥',
        boost: 15,
        active: true,
        description: 'London-NY Overlap — Maximum liquidity, best signals'
      };
    }

    // NY Session: 16:00 – 21:00 UTC
    if (timeDecimal >= 16 && timeDecimal < 21) {
      return {
        name: 'NY',
        emoji: '🗽',
        boost: 8,
        active: true,
        description: 'NY Session — Solid momentum'
      };
    }

    // Off-hours: 21:00 – 00:00 UTC (forex only, crypto still active)
    return {
      name: 'Off-Hours',
      emoji: '🌙',
      boost: 0,
      active: false,        // For forex pairs — still valid for crypto
      description: 'Off-Hours — Low liquidity for forex'
    };
  }

  // Crypto pairs always active (24/7)
  isForexPair(pair) {
    return ['XAU/USD', 'EUR/USD', 'GBP/USD'].includes(pair);
  }

  // Should this pair be analyzed right now?
  shouldAnalyze(pair) {
    if (!this.isForexPair(pair)) return true; // BTC/ETH always on
    const session = this.getSession();
    return session.active;
  }

  // Get PKT time string for Discord display
  getPKTTime() {
    const now = new Date();
    const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    return pkt.toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
  }
}
