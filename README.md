# 🤖 Master Signal Agent

## What It Does
- **5 pairs**: XAU/USD, EUR/USD, GBP/USD, BTC/USD, ETH/USD  
- **Both directions**: BUY + SELL (macro-filtered)  
- **Signal types**: SCALP (1min entry) + INTRADAY (5min entry)  
- **Confluence scoring**: 0–100 score, min 65 to fire  
- **News integrated**: Forex Factory bias built in  
- **Session aware**: London Open and London-NY Overlap get +15 boost  
- **Expected output**: 10–25 signals/day across all pairs  

## Signal Logic (in order)

```
1. Session check      → Is it a valid session for this pair?
2. 1H Macro           → EMA21/50 + ADX ≥ 20 → BULLISH or BEARISH only
3. 15min MTF          → Intermediate trend alignment (+12 pts)
4. 5min Signal        → EMA9/21 bias + MACD + RSI + Stoch + CCI + BB
5. 1min Scalp entry   → Pullback to EMA21 within 0.4 ATR
6. News bias          → Forex Factory alignment (+12 pts) or penalty (-8 pts)
7. Session boost      → London Open / NY Overlap +15 pts
→ Fire if score ≥ 65 (scalp) or 68 (intraday)
```

## Why BUY Works Here (Unlike Current Agents)
The current NY/London scalp agents are SELL-only because they run 1hr sessions without macro alignment.  
Here, **BUY only fires when 1H macro is BULLISH** — so you're buying WITH the trend, not against it.  
Same principle but applied correctly across timeframes.

## Scoring Breakdown (Max 100pts)

| Factor              | Max Points | Notes                        |
|---------------------|-----------|------------------------------|
| 1H Macro aligned    | 20        | Core requirement             |
| 1H ADX strength     | 8         | ADX > 35 = full points       |
| 15min MTF aligned   | 12        | Intermediate confirmation    |
| 5min signal aligned | 10        | EMA9/21 bias                 |
| RSI                 | 8         | Not overbought/oversold      |
| MACD histogram      | 8         | Direction confirmation       |
| Stochastic          | 6         | Cross confirmation           |
| CCI                 | 4         | Momentum                     |
| Bollinger Bands     | 4         | Price position               |
| News bias           | +12/-8    | Match = +12, opposite = -8   |
| Session boost       | 15        | London/NY = +15              |
| **Total**           | **100**   | Fire if ≥ 65 (scalp) or 68  |

## Setup

### 1. Install
```bash
cd MASTER-AGENT
npm install
```

### 2. Environment
```bash
cp .env.example .env
# Fill in TWELVEDATA_API_KEY_MASTER and DISCORD_MASTER_WEBHOOK
```

### 3. Run Locally
```bash
node src/master_index.js
```

## ⚠️ API Credits Warning

**This agent uses more credits than your current agents:**

| Action                        | Credits used |
|-------------------------------|-------------|
| 4 timeframes × 5 pairs        | 20 per cycle |
| Cycles per day (5min interval)| 288          |
| Total per day                 | ~5,760       |

**Free TwelveData = 800/day** — NOT enough.  

**Options:**
1. **Upgrade to Basic** ($8/month = 5,000 API credits/day) — almost enough for 1 key
2. **Use 2 Basic accounts** = 10,000/day — plenty
3. **Reduce pairs** — 3 pairs instead of 5 = 3,456/day — fits in Basic
4. **Increase poll interval** to 8min = 180 cycles × 20 = 3,600/day — fits in Basic

**Recommended**: 1 TwelveData Basic account ($8/mo) with 8-minute interval = works perfectly

## Render Deployment

1. Push to GitHub (new repo: `master-signal-agent`)
2. Render → New Web Service → Connect repo
3. Build command: `npm install`
4. Start command: `node src/master_index.js`
5. Add environment variables (from .env.example)
6. Deploy ✅

## Expected Signals Per Day

| Pair    | Estimated signals/day | Notes              |
|---------|-----------------------|--------------------|
| XAU/USD | 3-5                   | Most filtered      |
| EUR/USD | 3-5                   | Major pair         |
| GBP/USD | 3-5                   | More volatile      |
| BTC/USD | 4-6                   | 24/7               |
| ETH/USD | 4-6                   | 24/7               |
| **Total**| **17-27/day**        |                    |

## Discord Channel
Create `#master-signals` in your server.  
Each signal shows: Entry, SL, TP, RR, Score bar, full breakdown.
