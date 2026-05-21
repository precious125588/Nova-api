import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const ipBlocks = pgTable("ip_blocks", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull().unique(),
  reason: text("reason"),
  blockedAt: timestamp("blocked_at").notNull().defaultNow(),
  blockedBy: text("blocked_by"),
});

export type IpBlock = typeof ipBlocks.$inferSelect;
