import mongoose, { Document, Schema } from "mongoose";

interface ITradeDto {
  time: Date;
  symbol: string;
  issuer: string;
  securityType: string;
  market: string;
  platform: string;
  tradePrice: number;
  quantity: number;
  volume: number;
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
  },
  { timestamps: { createdAt: "createDate", updatedAt: "updatedDate" } }
);

TradeSchema.index({ symbol: 1, time: 1 });

const TradeModel = mongoose.model<TradeDocument>(
  "trade-results",
  TradeSchema
);

export { TradeModel, ITradeDto, TradeDocument, ITradeRow };
