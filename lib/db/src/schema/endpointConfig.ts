import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const endpointConfig = pgTable("endpoint_config", {
  id: serial("id").primaryKey(),
  path: text("path").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EndpointConfig = typeof endpointConfig.$inferSelect;
