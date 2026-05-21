import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  statusCode: integer("status_code").notNull(),
  ip: text("ip"),
  userId: integer("user_id"),
  apiKeyId: integer("api_key_id"),
  responseTime: integer("response_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
