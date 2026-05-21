import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const uploadedFiles = pgTable("uploaded_files", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type UploadedFile = typeof uploadedFiles.$inferSelect;
