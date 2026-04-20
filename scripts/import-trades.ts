// Usage: npx tsx scripts/import-trades.ts
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import "../config/setup";
import { TradeModel } from "../schema/Trade.schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, "../tmp");

const RU_MONTHS: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

function parseRuDate(text: string): Date | null {
  const match = text.trim().match(/(\d+)\s+(\S+)\s+(\d{4}),\s+(\d+):(\d+)/);
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match;
  return new Date(+year, RU_MONTHS[month], +day, +hours, +minutes);
}

function parseNumber(text: string): number {
  return parseFloat(text.replace(/\s/g, "").replace(",", ".")) || 0;
}

function parseHtmlTable(html: string, pageIndex: number) {
  const rows: object[] = [];
  const trRegex = /<tr[\s\S]*?<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const tagRegex = /<[^>]+>/g;
  let rowIndex = 0;

  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[0];
    const cells: string[] = [];
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(tdMatch[1].replace(tagRegex, " ").replace(/\s+/g, " ").trim());
    }
    if (cells.length < 10) continue;

    const symbolParts = cells[2].split(/\s+/).filter(Boolean);
    const volumeParts = cells[9].split(/\s+/).filter(Boolean);

    const time = parseRuDate(cells[0]);
    const symbol = symbolParts[0] ?? "";
    const tradePrice = parseNumber(cells[7]);
    const quantity = parseNumber(cells[8]);
    const volume = parseNumber(volumeParts[volumeParts.length - 1] ?? "");
    const hash = crypto
      .createHash("sha1")
      .update(`${symbol}|${time?.toISOString()}|${tradePrice}|${quantity}|${volume}|${pageIndex}|${rowIndex}`)
      .digest("hex");

    rowIndex++;
    rows.push({ time, symbol, issuer: cells[3], securityType: cells[4], market: cells[5], platform: cells[6], tradePrice, quantity, volume, hash });
  }
  return rows.filter((r: any) => r.time !== null);
}

async function main() {
  const files = fs.readdirSync(TMP_DIR)
    .filter((f) => f.startsWith("trades_page_") && f.endsWith(".html"))
    .sort((a, b) => {
      const pa = parseInt(a.match(/(\d+)/)?.[1] ?? "0");
      const pb = parseInt(b.match(/(\d+)/)?.[1] ?? "0");
      return pa - pb;
    });

  if (!files.length) {
    console.error(`No trades_page_*.html files found in ${TMP_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} file(s)`);

  await mongoose.connection.asPromise();
  console.log("MongoDB connected");

  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const html = fs.readFileSync(path.join(TMP_DIR, file), "utf8");
    const pageIndex = parseInt(file.match(/(\d+)/)?.[1] ?? "0");
    const rows = parseHtmlTable(html, pageIndex);
    console.log(`${file}: ${rows.length} rows`);

    for (const doc of rows) {
      try {
        await TradeModel.create(doc);
        inserted++;
      } catch (e: any) {
        if (e.code === 11000) skipped++;
        else console.error("Insert error:", e.message);
      }
    }
  }

  await mongoose.disconnect();
  console.log(`Done. Inserted: ${inserted}, skipped (duplicates): ${skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
