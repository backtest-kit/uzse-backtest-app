// Usage: npx tsx scripts/build-candles.ts [symbol] [isin]
// Example: npx tsx scripts/build-candles.ts HMKB UZ7011340005
import mongoose from "mongoose";
import "../config/setup";
import { TradeModel } from "../schema/Trade.schema";
import { CandleModel } from "../schema/Candle.schema";

const symbol = process.argv[2] ?? "HMKB";
const isin   = process.argv[3] ?? "UZ7011340005";

const MIN_MS = 60_000;
const DAY_MS = 1440 * MIN_MS;

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

function floorToMin(tsMs: number, minutes: number): number {
  const stepMs = minutes * MIN_MS;
  return Math.floor(tsMs / stepMs) * stepMs;
}

async function insertBatch(docs: object[]): Promise<{ inserted: number; skipped: number }> {
  if (docs.length === 0) return { inserted: 0, skipped: 0 };
  try {
    const res = await CandleModel.insertMany(docs, { ordered: false });
    return { inserted: res.length, skipped: 0 };
  } catch (e: any) {
    const inserted = e.result?.insertedCount ?? 0;
    return { inserted, skipped: docs.length - inserted };
  }
}

async function main() {
  await mongoose.connection.asPromise();
  console.log("MongoDB connected");

  const first = await TradeModel.findOne({ symbol: isin }).sort({ time: 1 }).lean();
  const last  = await TradeModel.findOne({ symbol: isin }).sort({ time: -1 }).lean();
  if (!first || !last) {
    console.error("No trades found for", isin);
    process.exit(1);
  }

  // Day boundaries in UTC
  const startDay = new Date(first.time);
  startDay.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(last.time);
  endDay.setUTCHours(0, 0, 0, 0);

  const totalDays = Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
  console.log(`Range: ${startDay.toISOString().slice(0, 10)} — ${endDay.toISOString().slice(0, 10)} (${totalDays} days)`);

  let lastClose: number = first.tradePrice;
  let totalInserted = 0;
  let totalSkipped  = 0;

  for (let d = 0; d < totalDays; d++) {
    const dayStartMs = startDay.getTime() + d * DAY_MS;
    const dayEndMs   = dayStartMs + DAY_MS - 1;

    // Load only this day's trades from DB
    const trades = await TradeModel
      .find(
        { symbol: isin, time: { $gte: new Date(dayStartMs), $lte: new Date(dayEndMs) } },
        { time: 1, tradePrice: 1, quantity: 1, _id: 0 }
      )
      .sort({ time: 1 })
      .lean();

    // Aggregate trades into 1m buckets
    const minuteMap = new Map<number, OHLCV>();
    for (const t of trades) {
      const ts = floorToMin(new Date(t.time).getTime(), 1);
      const ex = minuteMap.get(ts);
      if (!ex) {
        minuteMap.set(ts, { open: t.tradePrice, high: t.tradePrice, low: t.tradePrice, close: t.tradePrice, volume: t.quantity });
      } else {
        if (t.tradePrice > ex.high) ex.high = t.tradePrice;
        if (t.tradePrice < ex.low)  ex.low  = t.tradePrice;
        ex.close   = t.tradePrice;
        ex.volume += t.quantity;
      }
    }

    // Build higher timeframe accumulators
    const tfAccum = new Map<string, Map<number, OHLCV>>();
    for (const { interval } of TIMEFRAMES) {
      tfAccum.set(interval, new Map());
    }

    // Walk every minute of the day, filling gaps with lastClose
    for (let ts = dayStartMs; ts < dayStartMs + DAY_MS; ts += MIN_MS) {
      const real = minuteMap.get(ts);
      const c: OHLCV = real
        ? { open: real.open, high: real.high, low: real.low, close: real.close, volume: real.volume }
        : { open: lastClose, high: lastClose, low: lastClose, close: lastClose, volume: 0 };

      if (real) lastClose = real.close;

      for (const { interval, minutes } of TIMEFRAMES) {
        const tfTs = floorToMin(ts, minutes);
        const acc  = tfAccum.get(interval)!;
        const ex   = acc.get(tfTs);
        if (!ex) {
          acc.set(tfTs, { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
        } else {
          if (c.high > ex.high) ex.high = c.high;
          if (c.low  < ex.low)  ex.low  = c.low;
          ex.close   = c.close;
          ex.volume += c.volume;
        }
      }
    }

    // Flatten into documents
    const docs: object[] = [];
    for (const { interval } of TIMEFRAMES) {
      for (const [ts, ohlcv] of tfAccum.get(interval)!) {
        docs.push({ symbol, interval, timestamp: ts, open: ohlcv.open, high: ohlcv.high, low: ohlcv.low, close: ohlcv.close, volume: ohlcv.volume });
      }
    }

    const { inserted, skipped } = await insertBatch(docs);
    totalInserted += inserted;
    totalSkipped  += skipped;

    const dateStr   = new Date(dayStartMs).toISOString().slice(0, 10);
    const realMins  = minuteMap.size;
    process.stdout.write(`\r[${d + 1}/${totalDays}] ${dateStr}  trades:${trades.length}  real_min:${realMins}  candles:${docs.length}  inserted:${totalInserted}  skipped:${totalSkipped}   `);
  }

  console.log(`\nDone. Inserted: ${totalInserted}, skipped (duplicates): ${totalSkipped}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
