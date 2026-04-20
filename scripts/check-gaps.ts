// Usage: npx tsx scripts/check-gaps.ts
import mongoose from "mongoose";
import "../config/setup";
import { TradeModel } from "../schema/Trade.schema";

const DOW = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

function toKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  await mongoose.connection.asPromise();

  const trades = await TradeModel.find({}, { time: 1 }).lean();
  const days = new Set(trades.map((t) => toKey(new Date(t.time))));

  const sorted = [...days].sort();
  const start = new Date(sorted[0]);
  const end = new Date(sorted[sorted.length - 1]);

  const missing: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = toKey(d);
    if (!days.has(key)) missing.push(`${key} (${DOW[d.getDay()]})`);
  }

  console.log(`Trading days in DB: ${days.size}`);
  console.log(`Missing days (${missing.length}):`);
  missing.forEach((d) => console.log(" ", d));

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
