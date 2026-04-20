import { addExchangeSchema } from "backtest-kit";
import { CandleModel } from "../schema/Candle.schema";

import "../config/setup";

addExchangeSchema({
  exchangeName: "mongo-exchange",
  getCandles: async (symbol, interval, since, limit) => {
    const candles = await CandleModel.find(
      { symbol, interval, timestamp: { $gte: since.getTime() } },
      { timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, _id: 0 }
    )
      .sort({ timestamp: 1 })
      .limit(limit)
      .lean();

    return candles.map(({ timestamp, open, high, low, close, volume }) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }));
  },
});
