# uzse-backtest-app

![screenshot](./assets/screenshot.png)

## Articles

- [RU: Running Pine Script on Exchanges Without TradingView](./article/RU.md)
- [EN: Running Pine Script on Exchanges Without TradingView](./article/EN.md)

## Download Trade History

```bash
npx tsx scripts/download-trades.ts UZ7011340005 01.03.2026 31.03.2026
```

## Import Trades into MongoDB

```bash
npx tsx scripts/import-trades.ts
```

## Check Which Days the Exchange Was Closed

```bash
npx tsx scripts/check-gaps.ts
```

## Build Japanese Candlesticks from Trade Dump

```bash
npx tsx scripts/build-candles.ts HMKB UZ7011340005
```

## Start the Editor

```bash
npm start
```

## Candle Building Algorithm

### 1. Aggregating Real Minutes

Each trade from the `trade-results` collection is placed into a 1-minute bucket using `floor(time, 1m)`.  
Within a bucket:
- `open` — price of the first trade
- `high` / `low` — maximum / minimum price
- `close` — price of the last trade
- `volume` — sum of `quantity` (number of securities)

### 2. Filling Intraday Gaps

A continuous series is generated with a 1-minute step from `00:00` to `23:59` for each day.  
Minutes with no trades are filled with: `OHLC = close` of the previous candle, `volume = 0`.

### 3. Filling Non-Trading Days

Weekends and holidays (days with no trades at all) are filled similarly:  
all 1440 minutes of the day receive `OHLC = close` of the last trading day, `volume = 0`.

### 4. Aggregating Higher Timeframes

Higher timeframes are built from the already-filled 1m series by grouping via `floor(timestamp, N minutes)`:
- `open` — taken from the first 1m candle of the period
- `high` / `low` — max / min across all 1m candles in the period
- `close` — from the last 1m candle of the period
- `volume` — sum of volume across all 1m candles in the period

Supported timeframes: `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `1d`.

### 5. Idempotency

The unique index `{ symbol, interval, timestamp }` on the `candle-items` collection ensures  
that re-running the script does not create duplicates — existing candles are skipped.

## Parser Sequence Script

```js
const lines = ['#!/bin/bash', 'cd \"\$(dirname \"\$0\")/../..\"', ''];
const start = new Date(2018, 1, 1);
const end = new Date(2026, 3, 1);
let d = new Date(start);
while (d <= end) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const isFirstMonth = (y === 2018 && m === 1);
  const isLastMonth  = (y === 2026 && m === 3);
  const beginDay = isFirstMonth ? '08' : '01';
  const lastDay  = new Date(y, m + 1, 0).getDate();
  const endDay   = isLastMonth ? '20' : lastDay;
  const mm = String(m + 1).padStart(2, '0');
  const beginStr = String(beginDay).padStart(2,'0') + '.' + mm + '.' + y;
  const endStr   = String(endDay).padStart(2,'0')   + '.' + mm + '.' + y;
  lines.push('npx -y tsx scripts/download-trades.ts UZ7011340005 ' + beginStr + ' ' + endStr);
  lines.push('npx -y tsx scripts/import-trades.ts');
  lines.push('');
  d.setMonth(m + 1);
}
require('fs').mkdirSync('./scripts/linux', { recursive: true });
require('fs').writeFileSync('./scripts/linux/fetch.sh', lines.join('\n'), 'utf8');
console.log('Done, lines:', lines.length);
```

## Import Candles into MongoDB

```bash
mongoimport --db backtest --collection trade-results --file backtest.trade-results.json --jsonArray
mongoimport --db backtest --collection candle-items  --file backtest.candle-items.json  --jsonArray
```
