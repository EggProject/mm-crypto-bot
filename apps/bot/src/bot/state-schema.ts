import { z } from "zod";

const positionSchema = z.object({
  id: z.string(),
  strategy: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  currentPrice: z.number().positive(),
  leverage: z.number().int().min(1).max(10),
  unrealizedPnl: z.number(),
  realizedPnl: z.number(),
  openedAt: z.number(),
  notionalUsd: z.number().positive(),
});

const closedTradeSchema = z.object({
  strategy: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  pnl: z.number(),
  pnlPct: z.number(),
  closedAt: z.number(),
});

const countersSchema = z.object({
  placed: z.number().int().min(0),
  filled: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  rejected: z.number().int().min(0),
});

export const BotStateSchema = z.object({
  version: z.literal(1),
  savedAt: z.number(),
  equityUsd: z.number(),
  initialEquityUsd: z.number().positive(),
  realizedPnlUsd: z.number(),
  positions: z.array(positionSchema),
  closedTrades: z.array(closedTradeSchema),
  inFlightOrderIds: z.array(z.string()),
  counters: countersSchema,
});
