// Usage: npx tsx scripts/download-trades.ts <symbol> <begin> <end> [mktId]
// Example: npx tsx scripts/download-trades.ts UZ7011340005 17.04.2026 18.04.2026
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, "../tmp");

function getLastPage(html: string): number {
  const match = html.match(/class="last next">\s*<a[^>]+[?&](?:amp;)?page=(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

async function main() {
  const [, , symbol, begin, end, mktId = "STK"] = process.argv;
  if (!symbol || !begin || !end) {
    console.error("Usage: npx tsx scripts/download-trades.ts <symbol> <begin> <end> [mktId]");
    process.exit(1);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.readdirSync(TMP_DIR)
    .filter((f) => f.endsWith(".html"))
    .forEach((f) => fs.rmSync(path.join(TMP_DIR, f)));

  const buildUrl = (p: number) =>
    `https://uzse.uz/trade_results?begin=${begin}&end=${end}&mkt_id=${mktId}&page=${p}&search_key=${symbol}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(buildUrl(1), { waitUntil: "networkidle", timeout: 30000 });
  const firstHtml = await page.content();
  fs.writeFileSync(path.join(TMP_DIR, "trades_page_1.html"), firstHtml, "utf8");

  const totalPages = getLastPage(firstHtml);
  console.log(`Total pages: ${totalPages}`);

  for (let p = 2; p <= totalPages; p++) {
    await page.goto(buildUrl(p), { waitUntil: "networkidle", timeout: 30000 });
    const html = await page.content();
    fs.writeFileSync(path.join(TMP_DIR, `trades_page_${p}.html`), html, "utf8");
    console.log(`Downloaded page ${p}/${totalPages}`);
  }

  await browser.close();
  console.log(`Done. HTML saved to ${TMP_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
