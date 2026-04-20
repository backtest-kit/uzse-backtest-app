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
  return Math.floor(tsMs / (minutes * MIN_MS)) * (minutes * MIN_MS);
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

  // Step 1: aggregate real 1m minutes via async cursor
  const minuteMap = new Map<number, OHLCV>();

  const cursor = TradeModel
    .find({ symbol: isin }, { time: 1, tradePrice: 1, quantity: 1 })
    .sort({ time: 1 })
    .lean()
    .cursor();

  for await (const t of cursor) {
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
  const startMs = new Date(allTs[0]).setHours(0, 0, 0, 0);
  const endMs   = new Date(allTs[allTs.length - 1]).setHours(23, 59, 0, 0);

  // minuteMap no longer needed — free memory before the main loop
  const firstOpen = minuteMap.get(allTs[0])!.open;
  minuteMap.clear();

  // Step 3+4: walk 1m series, aggregate all timeframes simultaneously
  const tfMaps = new Map<string, Map<number, OHLCV>>(
    TIMEFRAMES.map(({ interval }) => [interval, new Map()])
  );

  let lastClose = firstOpen;

  for (let ts = startMs; ts <= endMs; ts += MIN_MS) {
    const real = minuteMap.get(ts);
    const c: OHLCV = real
      ? { ...real }
      : { open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: 0 };

    if (real) lastClose = real.close;

    for (const { interval, minutes } of TIMEFRAMES) {
      const tfTs = floorTo(ts, minutes);
      const tfMap = tfMaps.get(interval)!;
      const existing = tfMap.get(tfTs);
      if (!existing) {
        tfMap.set(tfTs, { ...c });
      } else {
        existing.high    = Math.max(existing.high, c.high);
        existing.low     = Math.min(existing.low, c.low);
        existing.close   = c.close;
        existing.volume += c.volume;
      }
    }
  }

  // Step 5: insert each timeframe
  for (const { interval } of TIMEFRAMES) {
    const tfMap = tfMaps.get(interval)!;
    const candles = [...tfMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([timestamp, ohlcv]) => ({ symbol, interval, timestamp, ...ohlcv }));

    console.log(`[${interval}] Total candles: ${candles.length}`);
    await bulkInsert(candles, interval);
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
