import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, pgEnum, date, unique, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const availabilityStatusEnum = pgEnum('availability_status', ['pending', 'available', 'assigned', 'invited']);
export const recordDayStatusEnum = pgEnum('record_day_status', ['draft', 'ready', 'invited', 'completed']);
export const tokenStatusEnum = pgEnum('token_status', ['active', 'expired', 'used', 'revoked']);
export const responseValueEnum = pgEnum('response_value', ['pending', 'yes', 'no', 'maybe']);
export const confirmationStatusEnum = pgEnum('confirmation_status', ['pending', 'confirmed', 'declined']);
export const blockTypeEnum = pgEnum('block_type', ['PB', 'NPB']);
export const standbyStatusEnum = pgEnum('standby_status', ['pending', 'email_sent', 'confirmed', 'declined', 'seated']);
export const messageDirectionEnum = pgEnum('message_direction', ['outbound', 'inbound']); // outbound = system to contestant, inbound = contestant to system
export const playerTypeEnum = pgEnum('player_type', ['player', 'backup', 'player_partner']);

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
  location: text("location"), // City/suburb location
  postcode: text("postcode"), // Australian postcode
  state: text("state"), // Australian state (VIC, NSW, QLD, etc.)
  medicalInfo: text("medical_info"),
  mobilityNotes: text("mobility_notes"), // Mobility/Access/Medical notes
  criminalRecord: text("criminal_record"), // Criminal record information
  photoUrl: text("photo_url"), // URL to contestant photo
  auditionRating: text("audition_rating"), // Rating: A+, A, B+, B, C
  playerType: playerTypeEnum("player_type"), // Player, Backup, Player Partner
  groupSize: integer("group_size"), // Group size (1 = solo, 2+ = group), null = undefined
  podiumStory: boolean("podium_story").default(false), // Has podium story
  availableForStandby: boolean("available_for_standby").default(false), // Marked as available for standby in import
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Record Days table
export const recordDays = pgTable("record_days", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  rxNumber: text("rx_number"), // e.g., "RX EP 6 - 10"
  totalSeats: integer("total_seats").default(154).notNull(),
  status: recordDayStatusEnum("status").default('draft').notNull(),
  producer: text("producer"), // Producer assigned to this record day
  lockedAt: timestamp("locked_at"), // When record day is locked for RX Day Mode
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Seat Assignments table
export const seatAssignments = pgTable("seat_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordDayId: varchar("record_day_id").references(() => recordDays.id).notNull(),
  contestantId: varchar("contestant_id").references(() => contestants.id).notNull(),
  blockNumber: integer("block_number").notNull(), // 1-7
  seatLabel: text("seat_label").notNull(), // e.g., "A1", "B3"
  playerType: playerTypeEnum("player_type"), // PLAYER, BACKUP, PLAYER_PARTNER
  
  // Original seat tracking for RX Day Mode swaps
  originalBlockNumber: integer("original_block_number"), // Original block before swap
  originalSeatLabel: text("original_seat_label"), // Original seat before swap
  swappedAt: timestamp("swapped_at"), // When the swap occurred
  
  // Booking Master workflow fields
  firstNations: text("first_nations"),
  rating: text("rating"),
  location: text("location"),
  medicalQuestion: text("medical_question"),
  criminalBankruptcy: text("criminal_bankruptcy"),
  castingCategory: text("casting_category"),
  notes: text("notes"),
  bookingEmailSent: timestamp("booking_email_sent"),
  confirmedRsvp: timestamp("confirmed_rsvp"),
  paperworkSent: timestamp("paperwork_sent"),
  paperworkReceived: timestamp("paperwork_received"),
  paperworkOnDay: timestamp("paperwork_on_day"),
  signedIn: timestamp("signed_in"),
  otdNotes: text("otd_notes"),
  standbyReplacementSwaps: text("standby_replacement_swaps"),
  
  // RX Day Mode - Winning money tracking
  rxNumber: text("rx_number"), // RX Day number for this seat
  rxEpNumber: text("rx_ep_number"), // RX Episode number for this seat
  caseNumber: text("case_number"), // Case number for this seat
  winningMoneyRole: text("winning_money_role"), // 'player' or 'case_holder'
  winningMoneyAmount: integer("winning_money_amount"), // Amount in dollars
  winningMoneyText: text("winning_money_text"), // Text description for case holders (e.g. "Car", "Trip")
  
  // Player-specific winning fields
  caseAmount: integer("case_amount"), // Amount in case for player
  quickCash: integer("quick_cash"), // Quick cash amount offered
  bankOfferTaken: boolean("bank_offer_taken"), // Whether bank offer was taken
  spinTheWheel: boolean("spin_the_wheel"), // Whether they spun the wheel
  prize: text("prize"), // Prize won from spinning the wheel
  
  // TX tracking fields
  txNumber: text("tx_number"), // TX number
  txDate: date("tx_date"), // Date of TX
  notifiedOfTx: boolean("notified_of_tx"), // Whether contestant was notified of TX
  photosSent: boolean("photos_sent"), // Whether photos were sent
  
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
  isFromStandby: boolean("is_from_standby").default(false), // True if this came from standby tab
  originalAttendanceDate: timestamp("original_attendance_date"), // Date standby originally attended
  // Carry over paperwork status when rescheduling
  paperworkSent: timestamp("paperwork_sent"),
  paperworkReceived: timestamp("paperwork_received"),
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

// Booking Confirmation Tokens table - stores unique tokens for booking confirmations
export const bookingConfirmationTokens = pgTable("booking_confirmation_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  seatAssignmentId: varchar("seat_assignment_id").references(() => seatAssignments.id, { onDelete: "cascade" }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: tokenStatusEnum("status").default('active').notNull(),
  confirmationStatus: confirmationStatusEnum("confirmation_status").default('pending').notNull(),
  attendingWith: text("attending_with"), // Updated attending with info
  notes: text("notes"), // Dietary requirements, special requests, etc.
  confirmedAt: timestamp("confirmed_at"),
  expiresAt: timestamp("expires_at").notNull(),
  lastSentAt: timestamp("last_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Booking Messages table - tracks conversation history between system and contestants
export const bookingMessages = pgTable("booking_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  confirmationId: varchar("confirmation_id").references(() => bookingConfirmationTokens.id, { onDelete: "cascade" }).notNull(),
  direction: messageDirectionEnum("direction").notNull(), // outbound = we sent, inbound = contestant replied
  messageType: text("message_type").notNull(), // 'booking_email', 'follow_up', 'confirmation_response', 'reply'
  subject: text("subject"),
  body: text("body").notNull(),
  senderEmail: text("sender_email"), // Email address of sender (for inbound messages)
  gmailMessageId: text("gmail_message_id"), // Gmail message ID to prevent duplicate ingestion
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  readAt: timestamp("read_at"), // When admin read the message (for inbound)
});

// Block Types table - stores PB/NPB designation for each block per record day
export const blockTypes = pgTable("block_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordDayId: varchar("record_day_id").references(() => recordDays.id).notNull(),
  blockNumber: integer("block_number").notNull(), // 1-7
  blockType: blockTypeEnum("block_type").notNull(), // PB or NPB
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Each block on a record day can only have one type
  uniqueBlockPerDay: unique().on(table.recordDayId, table.blockNumber),
}));

// Standby Assignments table - tracks backup contestants for each record day
export const standbyAssignments = pgTable("standby_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contestantId: varchar("contestant_id").references(() => contestants.id).notNull(),
  recordDayId: varchar("record_day_id").references(() => recordDays.id).notNull(),
  status: standbyStatusEnum("status").default('pending').notNull(),
  standbyEmailSent: timestamp("standby_email_sent"),
  confirmedAt: timestamp("confirmed_at"),
  notes: text("notes"),
  assignedToSeat: varchar("assigned_to_seat", { length: 10 }), // Seat label when standby is used (e.g., "1A3")
  assignedAt: timestamp("assigned_at"), // When they were assigned to a seat
  movedToReschedule: boolean("moved_to_reschedule").default(false), // True when moved to reschedule tab
  movedToRescheduleAt: timestamp("moved_to_reschedule_at"), // When they were moved
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure one standby entry per contestant per record day
  uniqueStandbyPerDay: unique().on(table.recordDayId, table.contestantId),
}));

// Standby Confirmation Tokens table - stores tokens for standby booking confirmations
export const standbyConfirmationTokens = pgTable("standby_confirmation_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  standbyAssignmentId: varchar("standby_assignment_id").references(() => standbyAssignments.id).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: tokenStatusEnum("status").default('active').notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastSentAt: timestamp("last_sent_at"),
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

export const insertBookingConfirmationTokenSchema = createInsertSchema(bookingConfirmationTokens).omit({
  id: true,
  createdAt: true,
});

export const insertBookingMessageSchema = createInsertSchema(bookingMessages).omit({
  id: true,
});

export const insertBlockTypeSchema = createInsertSchema(blockTypes).omit({
  id: true,
  createdAt: true,
});

export const insertStandbyAssignmentSchema = createInsertSchema(standbyAssignments).omit({
  id: true,
  createdAt: true,
});

export const insertStandbyConfirmationTokenSchema = createInsertSchema(standbyConfirmationTokens).omit({
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

export type InsertBookingConfirmationToken = z.infer<typeof insertBookingConfirmationTokenSchema>;
export type BookingConfirmationToken = typeof bookingConfirmationTokens.$inferSelect;

export type InsertBookingMessage = z.infer<typeof insertBookingMessageSchema>;
export type BookingMessage = typeof bookingMessages.$inferSelect;

export type InsertBlockType = z.infer<typeof insertBlockTypeSchema>;
export type BlockType = typeof blockTypes.$inferSelect;

export type InsertStandbyAssignment = z.infer<typeof insertStandbyAssignmentSchema>;
export type StandbyAssignment = typeof standbyAssignments.$inferSelect;

export type InsertStandbyConfirmationToken = z.infer<typeof insertStandbyConfirmationTokenSchema>;
export type StandbyConfirmationToken = typeof standbyConfirmationTokens.$inferSelect;

// System Configuration table - stores app-wide settings like Google Sheets config
export const systemConfig = pgTable("system_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSystemConfigSchema = createInsertSchema(systemConfig).omit({
  id: true,
  updatedAt: true,
});

export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type SystemConfig = typeof systemConfig.$inferSelect;

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

// Form Configurations table - stores customizable text for public forms
export const formConfigurations = pgTable("form_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  formType: text("form_type").notNull(), // 'availability' or 'booking'
  fieldKey: text("field_key").notNull(), // e.g., 'title', 'description', 'yesLabel'
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueFormField: unique().on(table.formType, table.fieldKey),
}));

export const insertFormConfigurationSchema = createInsertSchema(formConfigurations).omit({
  id: true,
  updatedAt: true,
});

export type InsertFormConfiguration = z.infer<typeof insertFormConfigurationSchema>;
export type FormConfiguration = typeof formConfigurations.$inferSelect;
