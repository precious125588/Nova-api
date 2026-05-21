import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userLimits = pgTable("user_limits", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id).unique(),
  dailyLimit: integer("daily_limit").notNull().default(100),
  monthlyLimit: integer("monthly_limit").notNull().default(1000),
  requestsToday: integer("requests_today").notNull().default(0),
  requestsThisMonth: integer("requests_this_month").notNull().default(0),
  lastDailyReset: timestamp("last_daily_reset").notNull().defaultNow(),
  lastMonthlyReset: timestamp("last_monthly_reset").notNull().defaultNow(),
});

export type UserLimit = typeof userLimits.$inferSelect;
