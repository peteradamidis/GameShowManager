import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, pgEnum, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const availabilityStatusEnum = pgEnum('availability_status', ['pending', 'available', 'assigned', 'invited']);
export const recordDayStatusEnum = pgEnum('record_day_status', ['draft', 'ready', 'invited', 'completed']);
export const tokenStatusEnum = pgEnum('token_status', ['active', 'expired', 'used', 'revoked']);
export const responseValueEnum = pgEnum('response_value', ['pending', 'yes', 'no', 'maybe']);

// Groups table
export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referenceNumber: text("reference_number").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Contestants table
export const contestants = pgTable("contestants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  age: integer("age").notNull(),
  gender: text("gender").notNull(),
  groupId: varchar("group_id").references(() => groups.id),
  availabilityStatus: availabilityStatusEnum("availability_status").default('pending').notNull(),
  attendingWith: text("attending_with"), // Raw data from Excel
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  medicalInfo: text("medical_info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Record Days table
export const recordDays = pgTable("record_days", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  totalSeats: integer("total_seats").default(154).notNull(),
  status: recordDayStatusEnum("status").default('draft').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Seat Assignments table
export const seatAssignments = pgTable("seat_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordDayId: varchar("record_day_id").references(() => recordDays.id).notNull(),
  contestantId: varchar("contestant_id").references(() => contestants.id).notNull(),
  blockNumber: integer("block_number").notNull(), // 1-7
  seatLabel: text("seat_label").notNull(), // e.g., "A1", "B3"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure one contestant per record day
  uniqueContestantPerDay: unique().on(table.recordDayId, table.contestantId),
  // Ensure one contestant per seat
  uniqueSeatPerDay: unique().on(table.recordDayId, table.blockNumber, table.seatLabel),
}));

// Canceled Assignments table - tracks contestants who canceled from a specific record day
export const canceledAssignments = pgTable("canceled_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contestantId: varchar("contestant_id").references(() => contestants.id).notNull(),
  recordDayId: varchar("record_day_id").references(() => recordDays.id).notNull(),
  blockNumber: integer("block_number"),
  seatLabel: text("seat_label"),
  canceledAt: timestamp("canceled_at").defaultNow().notNull(),
  reason: text("reason"),
});

// Availability Tokens table - stores unique tokens for availability check responses
export const availabilityTokens = pgTable("availability_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contestantId: varchar("contestant_id").references(() => contestants.id).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: tokenStatusEnum("status").default('active').notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastSentAt: timestamp("last_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Contestant Availability table - join table tracking availability for specific record days
export const contestantAvailability = pgTable("contestant_availability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contestantId: varchar("contestant_id").references(() => contestants.id).notNull(),
  recordDayId: varchar("record_day_id").references(() => recordDays.id).notNull(),
  responseValue: responseValueEnum("response_value").default('pending').notNull(),
  respondedAt: timestamp("responded_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertGroupSchema = createInsertSchema(groups).omit({
  id: true,
  createdAt: true,
});

export const insertContestantSchema = createInsertSchema(contestants).omit({
  id: true,
  createdAt: true,
});

export const insertRecordDaySchema = createInsertSchema(recordDays).omit({
  id: true,
  createdAt: true,
});

export const insertSeatAssignmentSchema = createInsertSchema(seatAssignments).omit({
  id: true,
  createdAt: true,
});

export const insertCanceledAssignmentSchema = createInsertSchema(canceledAssignments).omit({
  id: true,
  canceledAt: true,
});

export const insertAvailabilityTokenSchema = createInsertSchema(availabilityTokens).omit({
  id: true,
  createdAt: true,
});

export const insertContestantAvailabilitySchema = createInsertSchema(contestantAvailability).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groups.$inferSelect;

export type InsertContestant = z.infer<typeof insertContestantSchema>;
export type Contestant = typeof contestants.$inferSelect;

export type InsertRecordDay = z.infer<typeof insertRecordDaySchema>;
export type RecordDay = typeof recordDays.$inferSelect;

export type InsertSeatAssignment = z.infer<typeof insertSeatAssignmentSchema>;
export type SeatAssignment = typeof seatAssignments.$inferSelect;

export type InsertCanceledAssignment = z.infer<typeof insertCanceledAssignmentSchema>;
export type CanceledAssignment = typeof canceledAssignments.$inferSelect;

export type InsertAvailabilityToken = z.infer<typeof insertAvailabilityTokenSchema>;
export type AvailabilityToken = typeof availabilityTokens.$inferSelect;

export type InsertContestantAvailability = z.infer<typeof insertContestantAvailabilitySchema>;
export type ContestantAvailability = typeof contestantAvailability.$inferSelect;

// Legacy user table (can be removed if not needed for auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
