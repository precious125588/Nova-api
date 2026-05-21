import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  key: text("key").notNull().unique(),
  name: text("name"),
  isActive: boolean("is_active").notNull().default(true),
  requestsUsed: integer("requests_used").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true, createdAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
