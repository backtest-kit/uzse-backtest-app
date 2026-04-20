// Usage: npx tsx scripts/build-candles.ts [symbol] [isin]
// Example: npx tsx scripts/build-candles.ts HMKB UZ7011340005
import mongoose from "mongoose";
import "../config/setup";
import { TradeModel } from "../schema/Trade.schema";
import { CandleModel } from "../schema/Candle.schema";

const symbol = process.argv[2] ?? "HMKB";
const isin   = process.argv[3] ?? "UZ7011340005";
const MIN_MS = 60_000;

const TIMEFRAMES: { interval: string; minutes: number }[] = [
  { interval: "1m",  minutes: 1    },
  { interval: "3m",  minutes: 3    },
  { interval: "5m",  minutes: 5    },
  { interval: "15m", minutes: 15   },
  { interval: "30m", minutes: 30   },
  { interval: "1h",  minutes: 60   },
  { interval: "2h",  minutes: 120  },
  { interval: "4h",  minutes: 240  },
  { interval: "6h",  minutes: 360  },
  { interval: "8h",  minutes: 480  },
  { interval: "1d",  minutes: 1440 },
];

type OHLCV = { open: number; high: number; low: number; close: number; volume: number };

function floorTo(tsMs: number, minutes: number): number {
  const periodMs = minutes * MIN_MS;
  return Math.floor(tsMs / periodMs) * periodMs;
}

async function bulkInsert(candles: object[], label: string) {
  const BATCH = 10_000;
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < candles.length; i += BATCH) {
    const batch = candles.slice(i, i + BATCH);
    try {
      const res = await CandleModel.insertMany(batch, { ordered: false });
      inserted += res.length;
    } catch (e: any) {
      const ok = e.result?.insertedCount ?? 0;
      inserted += ok;
      skipped  += batch.length - ok;
    }
    process.stdout.write(`\r[${label}] Inserted: ${inserted}, skipped: ${skipped}   `);
  }
  console.log(`\n[${label}] Done. Inserted: ${inserted}, skipped (duplicates): ${skipped}`);
}

async function main() {
  await mongoose.connection.asPromise();
  console.log("MongoDB connected");

  const trades = await TradeModel.find({ symbol: isin }, { time: 1, tradePrice: 1, quantity: 1 })
    .sort({ time: 1 })
    .lean();

  console.log(`Loaded ${trades.length} trades for ${isin}`);

  // Step 1: aggregate real 1m minutes from trades
  const minuteMap = new Map<number, OHLCV>();

  for (const t of trades) {
    const ts = floorTo(new Date(t.time).getTime(), 1);
    const existing = minuteMap.get(ts);
    if (!existing) {
      minuteMap.set(ts, { open: t.tradePrice, high: t.tradePrice, low: t.tradePrice, close: t.tradePrice, volume: t.quantity });
    } else {
      existing.high    = Math.max(existing.high, t.tradePrice);
      existing.low     = Math.min(existing.low, t.tradePrice);
      existing.close   = t.tradePrice;
      existing.volume += t.quantity;
    }
  }

  console.log(`Real trading minutes: ${minuteMap.size}`);

  // Step 2: determine full range (day boundaries)
  const allTs = [...minuteMap.keys()].sort((a, b) => a - b);
  const startDay = new Date(allTs[0]);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(allTs[allTs.length - 1]);
  endDay.setHours(23, 59, 0, 0);
  const startMs = startDay.getTime();
  const endMs   = endDay.getTime();

  // Step 3: build continuous 1m series with gap-fill
  const filled1m: (OHLCV & { timestamp: number })[] = [];
  let lastClose = minuteMap.get(allTs[0])!.open;

  for (let ts = startMs; ts <= endMs; ts += MIN_MS) {
    const real = minuteMap.get(ts);
    if (real) {
      lastClose = real.close;
      filled1m.push({ timestamp: ts, ...real });
    } else {
      filled1m.push({ timestamp: ts, open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: 0 });
    }
  }

  // Step 4: for each timeframe — aggregate from filled1m and insert
  for (const { interval, minutes } of TIMEFRAMES) {
    const tfMap = new Map<number, OHLCV>();

    for (const c of filled1m) {
      const ts = floorTo(c.timestamp, minutes);
      const existing = tfMap.get(ts);
      if (!existing) {
        tfMap.set(ts, { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
      } else {
        existing.high    = Math.max(existing.high, c.high);
        existing.low     = Math.min(existing.low, c.low);
        existing.close   = c.close;
        existing.volume += c.volume;
      }
    }

    const candles = [...tfMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([timestamp, ohlcv]) => ({ symbol, interval, timestamp, ...ohlcv }));

    console.log(`[${interval}] Total candles: ${candles.length}`);
    await bulkInsert(candles, interval);
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
