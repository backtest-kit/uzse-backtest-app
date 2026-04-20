import mongoose, { Document, Schema } from "mongoose";

interface ITradeDto {
  /** Дата и время сделки, напр. "17 апреля 2026, 16:02" */
  time: Date;
  /** ISIN код ценной бумаги, напр. "UZ7011340005" */
  symbol: string;
  /** Наименование эмитента, напр. "<Hamkorbank> ATB" */
  issuer: string;
  /** Тип ценной бумаги, напр. "Простые акции", "Привилегированные акции" */
  securityType: string;
  /** Рынок (сектор торгов), напр. "STK" (акции), "BON" (облигации) */
  market: string;
  /** Торговая площадка (сессия), напр. "G1", "G2" */
  platform: string;
  /** Цена одной ценной бумаги в сделке */
  tradePrice: number;
  /** Количество ценных бумаг в сделке */
  quantity: number;
  /** Объём сделки в UZS (tradePrice * quantity) */
  volume: number;
  /** SHA1 от symbol|time|tradePrice|quantity|volume|pageIndex|rowIndex — уникальный ключ для идемпотентного импорта */
  hash: string;
}

interface TradeDocument extends ITradeDto, Document {}

interface ITradeRow extends ITradeDto {
  id: string;
  createDate: Date;
  updatedDate: Date;
}

const TradeSchema: Schema<TradeDocument> = new Schema(
  {
    time: { type: Date, required: true, index: true },
    symbol: { type: String, required: true, index: true },
    issuer: { type: String, required: true },
    securityType: { type: String, required: true },
    market: { type: String, required: true },
    platform: { type: String, required: true },
    tradePrice: { type: Number, required: true },
    quantity: { type: Number, required: true },
    volume: { type: Number, required: true },
    hash: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: "createDate", updatedAt: "updatedDate" } }
);

TradeSchema.index({ symbol: 1, time: 1 });

const TradeModel = mongoose.model<TradeDocument>(
  "trade-results",
  TradeSchema
);

export { TradeModel, ITradeDto, TradeDocument, ITradeRow };
