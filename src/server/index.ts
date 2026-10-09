import { startServer } from "./server";

startServer({ development: { origin: "http://127.0.0.1:5173", token: process.env.GITUDIUM_DEV_TOKEN } });
