# Руководство

## Скачать историю сделок

```bash
npx tsx scripts/download-trades.ts UZ7011340005 01.03.2026 31.03.2026
```

## Импортировать сделки в MongoDb

```bash
npx tsx scripts/import-trades.ts
```

## Узнать по каким дням не работала биржа

```bash
npx tsx scripts/check-gaps.ts
```
