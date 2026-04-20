import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/backtest";

mongoose.connect(MONGO_URI);
