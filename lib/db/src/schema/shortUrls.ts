import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const shortUrls = pgTable("short_urls", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  originalUrl: text("original_url").notNull(),
  userId: integer("user_id").references(() => users.id),
  clickCount: integer("click_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ShortUrl = typeof shortUrls.$inferSelect;
