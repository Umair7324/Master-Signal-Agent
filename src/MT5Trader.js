// MT5Trader.js
// Auto-executes trades on MT5 via MetaAPI when a signal fires
// Free tier: 1 MT5 account, unlimited trades
// Env vars required: METAAPI_TOKEN, METAAPI_ACCOUNT_ID
// Optional: AUTO_TRADE_ENABLED=true (default false — safety first)

import MetaApi from 'metaapi.cloud-sdk';

// MT5 symbol format (no slash)
const SYMBOL_MAP = {
  'XAU/USD': 'XAUUSD',
  'EUR/USD': 'EURUSD',
  'GBP/USD': 'GBPUSD',
  'BTC/USD': 'BTCUSD',
  'ETH/USD': 'ETHUSD',
};

// Default lot sizes per pair — conservative
// Override via env: LOT_XAUUSD, LOT_EURUSD, etc.
const DEFAULT_LOTS = {
  'XAU/USD': 0.01,
  'EUR/USD': 0.01,
  'GBP/USD': 0.01,
  'BTC/USD': 0.001,
  'ETH/USD': 0.01,
};

export class MT5Trader {
  constructor() {
    this.enabled = process.env.AUTO_TRADE_ENABLED === 'true';
    this.token     = process.env.METAAPI_TOKEN;
    this.accountId = process.env.METAAPI_ACCOUNT_ID;
    this.api        = null;
    this.account    = null;
    this.connection = null;
    this.connected  = false;

    if (this.enabled) {
      if (!this.token || !this.accountId) {
        console.error('❌ MT5Trader: METAAPI_TOKEN or METAAPI_ACCOUNT_ID missing — auto trade disabled');
        this.enabled = false;
      } else {
        console.log('🤖 MT5Trader: Auto-trading ENABLED');
      }
    } else {
      console.log('⏸️  MT5Trader: Auto-trading DISABLED (set AUTO_TRADE_ENABLED=true to enable)');
    }
  }

  // ─── CONNECT (call once on startup) ──────────────────────────
  async connect() {
    if (!this.enabled) return;

    try {
      console.log('🔌 MT5Trader: Connecting to MetaAPI...');
      this.api     = new MetaApi.default(this.token);
      this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);

      // Deploy account if not deployed
      if (this.account.state !== 'DEPLOYED') {
        console.log('🚀 MT5Trader: Deploying MT5 account...');
        await this.account.deploy();
      }

      // Wait for broker connection
      console.log('⏳ MT5Trader: Waiting for broker connection...');
      await this.account.waitConnected();

      // RPC connection — stays alive
      this.connection = this.account.getRPCConnection();
      await this.connection.connect();
      await this.connection.waitSynchronized();

      this.connected = true;
      console.log('✅ MT5Trader: Connected to MT5 via MetaAPI');
    } catch (err) {
      console.error('❌ MT5Trader connect failed:', err.message);
      this.connected = false;
    }
  }

  // ─── PLACE TRADE ─────────────────────────────────────────────
  async executeTrade(signal) {
    if (!this.enabled) return null;

    if (!this.connected) {
      console.warn('⚠️  MT5Trader: Not connected — attempting reconnect...');
      await this.connect();
      if (!this.connected) return null;
    }

    const symbol = SYMBOL_MAP[signal.pair];
    if (!symbol) {
      console.error(`❌ MT5Trader: Unknown pair ${signal.pair}`);
      return null;
    }

    const lots = this._getLotSize(signal.pair);
    const isBuy = signal.action === 'BUY';

    try {
      console.log(`📤 MT5Trader: Placing ${signal.action} ${symbol} @ market | SL: ${signal.sl?.toFixed(2)} | TP: ${signal.tp?.toFixed(2)} | Lots: ${lots}`);

      let result;

      if (isBuy) {
        result = await this.connection.createMarketBuyOrder(
          symbol,
          lots,
          signal.sl,
          signal.tp,
          {
            comment: `MA-${signal.type}-${signal.score}`, // MA = Master Agent
          }
        );
      } else {
        result = await this.connection.createMarketSellOrder(
          symbol,
          lots,
          signal.sl,
          signal.tp,
          {
            comment: `MA-${signal.type}-${signal.score}`,
          }
        );
      }

      const tradeResult = {
        success:    true,
        ticket:     result.orderId || result.positionId || '—',
        symbol,
        action:     signal.action,
        lots,
        entry:      signal.entry,
        sl:         signal.sl,
        tp:         signal.tp,
        pair:       signal.pair,
        type:       signal.type,
        score:      signal.score,
      };

      console.log(`✅ MT5Trader: Trade placed! Ticket: #${tradeResult.ticket}`);
      return tradeResult;

    } catch (err) {
      console.error(`❌ MT5Trader: Trade failed for ${symbol}:`, err.message);
      return {
        success: false,
        pair:    signal.pair,
        action:  signal.action,
        error:   err.message,
      };
    }
  }

  // ─── GET LIVE SPREAD ─────────────────────────────────────────
  // Returns current spread in price units (e.g. 0.30 for XAU/USD)
  // Returns null if not connected or auto-trade disabled
  async getSpread(pair) {
    if (!this.enabled || !this.connected) return null;

    const symbol = SYMBOL_MAP[pair];
    if (!symbol) return null;

    try {
      const price = await this.connection.getSymbolPrice(symbol);
      if (!price || price.ask == null || price.bid == null) return null;
      return parseFloat((price.ask - price.bid).toFixed(5));
    } catch (err) {
      console.warn(`⚠️  MT5Trader: getSpread failed for ${symbol}: ${err.message}`);
      return null;
    }
  }

  // ─── STATUS ───────────────────────────────────────────────────
  getStatus() {
    return {
      enabled:   this.enabled,
      connected: this.connected,
    };
  }

  // ─── PRIVATE ──────────────────────────────────────────────────
  _getLotSize(pair) {
    // Allow per-pair override via env: LOT_XAUUSD=0.03
    const envKey = `LOT_${SYMBOL_MAP[pair]}`;
    const envVal = parseFloat(process.env[envKey]);
    return !isNaN(envVal) ? envVal : DEFAULT_LOTS[pair] || 0.01;
  }
}