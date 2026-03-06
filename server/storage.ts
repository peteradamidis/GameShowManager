import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { 
  contestants, 
  groups, 
  recordDays, 
  seatAssignments,
  canceledAssignments,
  availabilityTokens,
  contestantAvailability,
  bookingConfirmationTokens,
  bookingMessages,
  blockTypes,
  standbyAssignments,
  standbyConfirmationTokens,
  standbyAttendanceHistory,
  prizeWinners,
  systemConfig,
  formConfigurations,
  users,
  rebookingHistory,
  attendanceIssues,
  movementHistory,
  noticeboardPosts,
  noticeboardComments,
  noticeboardLikes,
  postRecordTracking,
  castingCards,
  castingCardVersions,
  birthdayEntries,
  blockNotes,
  systemSettings,
  type Contestant,
  type InsertContestant,
  type Group,
  type InsertGroup,
  type RecordDay,
  type InsertRecordDay,
  type SeatAssignment,
  type InsertSeatAssignment,
  type CanceledAssignment,
  type InsertCanceledAssignment,
  type AvailabilityToken,
  type InsertAvailabilityToken,
  type ContestantAvailability,
  type InsertContestantAvailability,
  type BookingConfirmationToken,
  type InsertBookingConfirmationToken,
  type BookingMessage,
  type InsertBookingMessage,
  type BlockType,
  type InsertBlockType,
  type StandbyAssignment,
  type InsertStandbyAssignment,
  type StandbyConfirmationToken,
  type InsertStandbyConfirmationToken,
  type StandbyAttendanceHistory,
  type InsertStandbyAttendanceHistory,
  type PrizeWinner,
  type InsertPrizeWinner,
  type SystemConfig,
  type User,
  type InsertUser,
  type RebookingHistory,
  type InsertRebookingHistory,
  type AttendanceIssue,
  type InsertAttendanceIssue,
  type MovementHistory,
  type InsertMovementHistory,
  type NoticeboardPost,
  type InsertNoticeboardPost,
  type NoticeboardComment,
  type InsertNoticeboardComment,
  type NoticeboardLike,
  type InsertNoticeboardLike,
  type PostRecordTracking,
  type InsertPostRecordTracking,
  type CastingCard,
  type InsertCastingCard,
  type CastingCardVersion,
  type InsertCastingCardVersion,
  type BirthdayEntry,
  type InsertBirthdayEntry,
  type BlockNote,
  type InsertBlockNote,
  rxPlanningEntries,
  type RxPlanningEntry,
  type InsertRxPlanningEntry,
} from "@shared/schema";
import { eq, and, sql, inArray, desc } from "drizzle-orm";

// Log database configuration status (don't crash - let app start for health checks)
if (!process.env.DATABASE_URL) {
  console.error("⚠ DATABASE_URL is not set. Database operations will fail.");
}

// Create pool with production-ready settings (works with any PostgreSQL: Neon, Digital Ocean, etc.)
// Enable SSL for all cloud databases in production
const needsSsl = process.env.NODE_ENV === 'production' || 
                 (process.env.DATABASE_URL && (
                   process.env.DATABASE_URL.includes('sslmode=require') ||
                   process.env.DATABASE_URL.includes('.ondigitalocean.com') ||
                   process.env.DATABASE_URL.includes('.neon.tech') ||
                   process.env.DATABASE_URL.includes('.supabase.') ||
                   process.env.DATABASE_URL.includes('.render.com')
                 ));

// Log SSL configuration for debugging
console.log(`  DB Config: NODE_ENV=${process.env.NODE_ENV}, SSL enabled=${needsSsl}`);

const pool = process.env.DATABASE_URL 
  ? new Pool({ 
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 10000,  // 10s connection timeout
      idleTimeoutMillis: 30000,        // 30s idle timeout
      max: 10,                          // Max connections
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    })
  : null;

// CRITICAL: Handle idle client errors so Neon timeouts don't crash the process
if (pool) {
  pool.on('error', (err: Error) => {
    const code = (err as any).code;
    if (code === '57P01' || code === '57P02' || code === '57P03') {
      console.warn('[Storage Pool] Idle client terminated by server (Neon timeout) — reconnecting automatically.');
    } else {
      console.error('[Storage Pool] Unexpected client error:', err.message);
    }
  });
}

const db = pool ? drizzle(pool) : null;

// Helper to ensure db is available before operations
function getDb() {
  if (!db) {
    throw new Error("DATABASE_URL is not configured. Please set the DATABASE_URL environment variable.");
  }
  return db;
}

// Warm up the database connection (call after server starts)
export async function warmupDatabaseConnection(): Promise<boolean> {
  if (!pool) {
    console.log('  DB Warmup: No pool available');
    return false;
  }
  
  const maxRetries = 3;
  const baseDelay = 1000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  DB Warmup: Attempt ${attempt}/${maxRetries}...`);
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('  DB Warmup: Connection established successfully');
      return true;
    } catch (error) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`  DB Warmup: Attempt ${attempt} failed, retrying in ${delay}ms...`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error('  DB Warmup: Failed to establish connection after all retries');
  return false;
}

// Fix phone numbers that start with 4 (missing Australian 0 prefix)
export async function fixPhoneNumbers(): Promise<number> {
  if (!pool) {
    console.log('  [Fix Phone] No pool available');
    return 0;
  }
  
  try {
    const database = getDb();
    
    // Find all contestants with phone numbers starting with "4"
    const allContestants = await database.select().from(contestants);
    const toFix = allContestants.filter(c => c.phone && c.phone.trim().startsWith('4'));
    
    if (toFix.length === 0) {
      console.log('  [Fix Phone] No phone numbers need fixing');
      return 0;
    }
    
    console.log(`  [Fix Phone] Fixing ${toFix.length} phone numbers with missing 0 prefix...`);
    
    // Update each one
    for (const contestant of toFix) {
      const newPhone = '0' + contestant.phone!.trim();
      await database
        .update(contestants)
        .set({ phone: newPhone })
        .where(eq(contestants.id, contestant.id));
    }
    
    console.log(`  [Fix Phone] Fixed ${toFix.length} phone numbers`);
    return toFix.length;
  } catch (error) {
    console.error('  [Fix Phone] Error fixing phone numbers:', error);
    return 0;
  }
}

export interface IStorage {
  // Contestants
  createContestant(contestant: InsertContestant): Promise<Contestant>;
  getContestants(): Promise<Contestant[]>;
  getContestantById(id: string): Promise<Contestant | undefined>;
  updateContestant(id: string, data: Partial<Contestant>): Promise<Contestant | undefined>;
  updateContestantAvailability(id: string, status: string): Promise<Contestant | undefined>;
  updateContestantField(id: string, field: string, value: any): Promise<Contestant | undefined>;
  updateContestantPhoto(id: string, photoUrl: string | null): Promise<Contestant | undefined>;
  deleteContestant(id: string): Promise<void>;
  
  // Groups
  createGroup(group: InsertGroup): Promise<Group>;
  getGroups(): Promise<Group[]>;
  getGroupById(id: string): Promise<Group | undefined>;
  
  // Record Days
  createRecordDay(recordDay: InsertRecordDay): Promise<RecordDay>;
  getRecordDays(): Promise<RecordDay[]>;
  getRecordDay(id: string): Promise<RecordDay | undefined>;
  getRecordDayById(id: string): Promise<RecordDay | undefined>;
  updateRecordDay(id: string, data: Partial<InsertRecordDay>): Promise<RecordDay | undefined>;
  updateRecordDayStatus(id: string, status: string): Promise<RecordDay | undefined>;
  updateRecordDayLock(id: string, lockedAt: Date | null): Promise<RecordDay | undefined>;
  deleteRecordDay(id: string): Promise<{ success: boolean; error?: string }>;
  
  // Seat Assignments
  createSeatAssignment(assignment: InsertSeatAssignment): Promise<SeatAssignment>;
  getSeatAssignmentById(id: string): Promise<SeatAssignment | undefined>;
  getSeatAssignmentsByRecordDay(recordDayId: string): Promise<SeatAssignment[]>;
  getSeatAssignmentByRecordDayAndContestant(recordDayId: string, contestantId: string): Promise<SeatAssignment | undefined>;
  getAllSeatAssignments(): Promise<SeatAssignment[]>;
  deleteSeatAssignment(id: string): Promise<void>;
  updateSeatAssignment(id: string, blockNumber: number, seatLabel: string): Promise<SeatAssignment | undefined>;
  updateSeatAssignmentWorkflow(id: string, workflowFields: Partial<SeatAssignment>): Promise<SeatAssignment | undefined>;
  updateSeatAssignmentCastingCard(id: string, castingCardUrl: string | null): Promise<SeatAssignment | undefined>;
  atomicSwapSeats(
    sourceId: string,
    targetId: string | null,
    targetBlock?: number,
    targetSeat?: string
  ): Promise<{ source: SeatAssignment; target?: SeatAssignment }>;
  swapSeatAssignmentsWithTracking(
    assignment1Id: string,
    assignment2Id: string,
    assignment1Block: number,
    assignment1Seat: string,
    assignment2Block: number,
    assignment2Seat: string
  ): Promise<{ assignment1: SeatAssignment; assignment2: SeatAssignment }>;
  moveSeatAssignmentWithTracking(
    assignmentId: string,
    newBlockNumber: number,
    newSeatLabel: string
  ): Promise<SeatAssignment>;
  swapBlocks(
    recordDayId: string,
    blockA: number,
    blockB: number
  ): Promise<{ swappedCount: number; blockAAssignments: SeatAssignment[]; blockBAssignments: SeatAssignment[] }>;
  cancelSeatAssignment(id: string, reason?: string, movedBy?: string, isDecline?: boolean): Promise<CanceledAssignment>;
  
  // Canceled Assignments
  getCanceledAssignments(): Promise<Array<CanceledAssignment & { contestant: Contestant; recordDay: RecordDay }>>;
  getCanceledAssignmentByPosition(recordDayId: string, blockNumber: number, seatLabel: string): Promise<CanceledAssignment | undefined>;
  getCanceledAssignmentByContestant(contestantId: string): Promise<CanceledAssignment | undefined>;
  createCanceledAssignment(data: Partial<InsertCanceledAssignment> & { contestantId: string; recordDayId: string }): Promise<CanceledAssignment>;
  createOrUpdateCanceledAssignment(data: Partial<InsertCanceledAssignment> & { contestantId: string; recordDayId: string }): Promise<CanceledAssignment>;
  updateCanceledAssignment(id: string, data: Partial<CanceledAssignment>): Promise<CanceledAssignment>;
  updateCanceledAssignmentPosition(id: string, blockNumber: number, seatLabel: string): Promise<void>;
  deleteCanceledAssignment(id: string): Promise<void>;
  
  // Availability Tokens
  createAvailabilityToken(token: InsertAvailabilityToken): Promise<AvailabilityToken>;
  getAvailabilityTokenByToken(token: string): Promise<AvailabilityToken | undefined>;
  getAvailabilityTokensByContestant(contestantId: string): Promise<AvailabilityToken[]>;
  updateTokenStatus(id: string, status: string): Promise<AvailabilityToken | undefined>;
  revokeContestantTokens(contestantId: string): Promise<void>;
  
  // Contestant Availability
  createContestantAvailability(availability: InsertContestantAvailability): Promise<ContestantAvailability>;
  getContestantAvailability(contestantId: string): Promise<ContestantAvailability[]>;
  getAvailabilityByRecordDay(recordDayId: string): Promise<Array<ContestantAvailability & { contestant: Contestant }>>;
  getAllAvailabilityResponses(): Promise<ContestantAvailability[]>;
  updateAvailabilityResponse(id: string, responseValue: string, notes?: string): Promise<ContestantAvailability | undefined>;
  upsertContestantAvailability(contestantId: string, recordDayId: string, responseValue: string, notes?: string): Promise<ContestantAvailability>;
  getContestantsAvailableForRecordDay(recordDayId: string): Promise<Contestant[]>;
  
  // Booking Confirmation Tokens
  createBookingConfirmationToken(token: InsertBookingConfirmationToken): Promise<BookingConfirmationToken>;
  getBookingConfirmationByToken(token: string): Promise<BookingConfirmationToken | undefined>;
  getBookingConfirmationBySeatAssignment(seatAssignmentId: string): Promise<BookingConfirmationToken | undefined>;
  getBookingConfirmationsByRecordDay(recordDayId: string): Promise<Array<BookingConfirmationToken & { seatAssignment: SeatAssignment; contestant: Contestant }>>;
  updateBookingConfirmationResponse(id: string, confirmationStatus: string, attendingWith?: string, notes?: string): Promise<BookingConfirmationToken | undefined>;
  updateBookingConfirmationResponseAllowResubmit(id: string, confirmationStatus: string, attendingWith?: string, notes?: string): Promise<BookingConfirmationToken | undefined>;
  revokeBookingConfirmationToken(seatAssignmentId: string): Promise<void>;
  
  // Booking Messages
  createBookingMessage(message: InsertBookingMessage): Promise<BookingMessage>;
  upsertInboundBookingMessage(message: InsertBookingMessage): Promise<BookingMessage>;
  getBookingMessagesByConfirmation(confirmationId: string): Promise<BookingMessage[]>;
  markMessageAsRead(messageId: string): Promise<BookingMessage | undefined>;
  getBookingConfirmationsByContestantEmail(email: string): Promise<Array<BookingConfirmationToken & { contestant: Contestant; seatAssignment: SeatAssignment }>>;
  isGmailMessageProcessed(gmailMessageId: string): Promise<boolean>;
  
  // Block Types (PB/NPB)
  getAllBlockTypes(): Promise<BlockType[]>;
  getBlockTypesByRecordDay(recordDayId: string): Promise<BlockType[]>;
  upsertBlockType(recordDayId: string, blockNumber: number, blockType: 'PB' | 'NPB'): Promise<BlockType>;
  upsertBlockTypes(recordDayId: string, configs: Array<{blockNumber: number, blockType: 'PB' | 'NPB'}>): Promise<BlockType[]>;
  isBlockConfigurationComplete(recordDayId: string): Promise<{complete: boolean; pbCount: number; npbCount: number}>;
  
  // Standby Assignments
  createStandbyAssignment(assignment: InsertStandbyAssignment): Promise<StandbyAssignment>;
  createStandbyAssignments(assignments: InsertStandbyAssignment[]): Promise<StandbyAssignment[]>;
  getStandbyAssignments(): Promise<Array<StandbyAssignment & { contestant: Contestant; recordDay: RecordDay }>>;
  getStandbyAssignmentsByRecordDay(recordDayId: string): Promise<Array<StandbyAssignment & { contestant: Contestant }>>;
  getStandbyAssignmentById(id: string): Promise<StandbyAssignment | undefined>;
  updateStandbyAssignment(id: string, data: Partial<StandbyAssignment>): Promise<StandbyAssignment | undefined>;
  deleteStandbyAssignment(id: string): Promise<void>;
  
  // Standby Confirmation Tokens
  createStandbyConfirmationToken(token: InsertStandbyConfirmationToken): Promise<StandbyConfirmationToken>;
  getStandbyConfirmationByToken(token: string): Promise<StandbyConfirmationToken | undefined>;
  getStandbyConfirmationByAssignment(standbyAssignmentId: string): Promise<StandbyConfirmationToken | undefined>;
  updateStandbyConfirmationToken(id: string, data: Partial<StandbyConfirmationToken>): Promise<StandbyConfirmationToken | undefined>;
  
  // Standby Attendance History
  createStandbyAttendanceHistory(data: InsertStandbyAttendanceHistory): Promise<StandbyAttendanceHistory>;
  getStandbyAttendanceHistory(): Promise<Array<StandbyAttendanceHistory & { contestant: Contestant; recordDay: RecordDay }>>;
  getStandbyAttendanceHistoryByRecordDay(recordDayId: string): Promise<Array<StandbyAttendanceHistory & { contestant: Contestant }>>;
  getStandbyAttendanceHistoryByContestant(contestantId: string): Promise<Array<StandbyAttendanceHistory & { recordDay: RecordDay }>>;
  getReturningStandbys(): Promise<Array<Contestant & { attendanceHistory: StandbyAttendanceHistory[] }>>;
  deleteStandbyAttendanceHistory(id: string): Promise<void>;
  
  // Prize Winners
  addPrizeWinner(data: InsertPrizeWinner): Promise<PrizeWinner>;
  getPrizeWinnersByRecordDay(recordDayId: string): Promise<PrizeWinner[]>;
  updatePrizeWinner(id: string, data: { hasPresent?: boolean; hasBriefcase?: boolean }): Promise<PrizeWinner | null>;
  removePrizeWinner(id: string): Promise<void>;
  removePrizeWinnerByContestant(recordDayId: string, contestantId: string): Promise<void>;
  
  // System Configuration
  getSystemConfig(key: string): Promise<string | null>;
  setSystemConfig(key: string, value: string): Promise<void>;
  
  // Form Configurations
  getFormConfigurations(formType: string): Promise<Record<string, string>>;
  setFormConfiguration(formType: string, fieldKey: string, value: string): Promise<void>;
  setFormConfigurations(formType: string, configs: Record<string, string>): Promise<void>;
  
  // Users (Authentication)
  createUser(user: InsertUser): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  updateUserPassword(id: string, hashedPassword: string): Promise<User | undefined>;
  updateUsername(id: string, newUsername: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;
  
  // Rebooking History
  logRebooking(data: InsertRebookingHistory): Promise<RebookingHistory>;
  getAllRebookingHistory(): Promise<Array<RebookingHistory>>;
  getRebookingHistoryByContestant(contestantId: string): Promise<Array<RebookingHistory & { fromRecordDay: RecordDay; toRecordDay: RecordDay }>>;
  getRebookingHistoryByRecordDay(recordDayId: string): Promise<Array<RebookingHistory & { contestant: Contestant; fromRecordDay: RecordDay; toRecordDay: RecordDay }>>;
  
  // Atomic Rebooking (transaction-based)
  atomicRebook(params: {
    oldAssignmentId: string;
    contestantId: string;
    newRecordDayId: string;
    blockNumber: number;
    seatLabel: string;
    reason?: string;
    rebookedBy: string;
  }): Promise<{ newAssignment: SeatAssignment; history: RebookingHistory }>;
  
  // Attendance Issues (No-Shows and Early Leavers)
  createAttendanceIssue(issue: InsertAttendanceIssue): Promise<AttendanceIssue>;
  createBulkNoShows(issues: Array<{ contestantId: string; recordDayId: string; blockNumber: number; seatLabel: string; notes?: string; markedBy?: string }>): Promise<{ success: boolean; count: number; issues: AttendanceIssue[] }>;
  getAttendanceIssues(): Promise<Array<AttendanceIssue & { contestant: Contestant; recordDay: RecordDay }>>;
  getAttendanceIssuesByRecordDay(recordDayId: string): Promise<Array<AttendanceIssue & { contestant: Contestant }>>;
  deleteAttendanceIssue(id: string): Promise<void>;
  moveAttendanceIssueToReschedule(id: string, options?: { movedBy?: string; reason?: string }): Promise<{ attendanceIssue: AttendanceIssue; canceledAssignment: CanceledAssignment }>;
  restoreAttendanceIssue(id: string): Promise<{ attendanceIssue: AttendanceIssue; seatAssignment: SeatAssignment }>;
  
  // Movement History
  logMovement(data: InsertMovementHistory): Promise<MovementHistory>;
  getMovementHistory(): Promise<Array<MovementHistory & { contestant: Contestant; recordDay?: RecordDay }>>;
  getMovementHistoryByRecordDay(recordDayId: string): Promise<Array<MovementHistory & { contestant: Contestant }>>;
  getMovementHistoryByContestant(contestantId: string): Promise<Array<MovementHistory & { recordDay?: RecordDay }>>;
  
  // Noticeboard
  createNoticeboardPost(post: InsertNoticeboardPost): Promise<NoticeboardPost>;
  getNoticeboardPosts(): Promise<Array<NoticeboardPost & { likeCount: number; commentCount: number; likedByCurrentUser?: boolean }>>;
  getNoticeboardPostById(id: string): Promise<NoticeboardPost | undefined>;
  updateNoticeboardPost(id: string, data: Partial<NoticeboardPost>): Promise<NoticeboardPost | undefined>;
  deleteNoticeboardPost(id: string): Promise<void>;
  togglePinPost(id: string): Promise<NoticeboardPost | undefined>;
  
  // Noticeboard Comments
  createNoticeboardComment(comment: InsertNoticeboardComment): Promise<NoticeboardComment>;
  getCommentsByPost(postId: string): Promise<NoticeboardComment[]>;
  deleteNoticeboardComment(id: string): Promise<void>;
  
  // Noticeboard Likes
  toggleLike(postId: string, browserId: string): Promise<{ liked: boolean; likeCount: number }>;
  getLikesByPost(postId: string): Promise<NoticeboardLike[]>;
  hasBrowserLikedPost(postId: string, browserId: string): Promise<boolean>;
  
  // Birthday Entries
  getBirthdayEntries(): Promise<BirthdayEntry[]>;
  createBirthdayEntry(entry: InsertBirthdayEntry): Promise<BirthdayEntry>;
  updateBirthdayEntry(id: string, data: Partial<BirthdayEntry>): Promise<BirthdayEntry | undefined>;
  deleteBirthdayEntry(id: string): Promise<void>;
  getTodayBirthdays(): Promise<BirthdayEntry[]>;
  
  // Block Notes
  getBlockNotes(recordDayId: string): Promise<BlockNote[]>;
  upsertBlockNote(recordDayId: string, blockNumber: number, notes: string): Promise<BlockNote>;
  getSystemSetting(key: string): Promise<SystemSetting | undefined>;
  setSystemSetting(key: string, value: string): Promise<SystemSetting>;

  // RX Planning
  getRxPlanningData(recordDayId: string): Promise<RxPlanningEntry[]>;
  getAllRxPlanningData(): Promise<RxPlanningEntry[]>;
  saveRxPlanningBlock(recordDayId: string, blockNumber: number, contestantData: string): Promise<RxPlanningEntry>;
  deleteRxPlanningBlock(recordDayId: string, blockNumber: number): Promise<void>;
  clearRxPlanningDay(recordDayId: string): Promise<void>;
}

export interface SystemSetting {
  key: string;
  value: string;
  updatedAt: Date;
}

export class DbStorage implements IStorage {
  // Helper function to generate deterministic lock key from seat location
  private hashSeatLocation(recordDayId: string, blockNumber: number, seatLabel: string): number {
    // Simple hash function to convert seat location to integer for advisory lock
    // Format: recordDayId-blockNumber-seatLabel
    const str = `${recordDayId}-${blockNumber}-${seatLabel}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Ensure positive integer for pg_advisory_xact_lock
    return Math.abs(hash);
  }

  // Contestants
  async createContestant(contestant: InsertContestant): Promise<Contestant> {
    const [created] = await getDb().insert(contestants).values(contestant).returning();
    return created;
  }

  async getContestants(): Promise<Contestant[]> {
    return getDb().select().from(contestants);
  }

  async getContestantById(id: string): Promise<Contestant | undefined> {
    const [contestant] = await getDb().select().from(contestants).where(eq(contestants.id, id));
    return contestant;
  }

  // Fetch only the contestants needed for a specific set of seat assignments.
  // Loads the directly-assigned contestants PLUS all members of their groups so
  // attendingWith resolution works without pulling all 692 contestants.
  async getContestantsForAssignments(contestantIds: string[]): Promise<Contestant[]> {
    if (contestantIds.length === 0) return [];
    const db = getDb();
    // Step 1: get the assigned contestants
    const assigned = await db
      .select()
      .from(contestants)
      .where(inArray(contestants.id, contestantIds));
    // Step 2: collect the groupIds of those contestants (may be empty)
    const groupIds = [...new Set(assigned.map(c => c.groupId).filter(Boolean) as string[])];
    if (groupIds.length === 0) return assigned;
    // Step 3: fetch all group members not already in the assigned set
    const assignedSet = new Set(assigned.map(c => c.id));
    const groupMembers = await db
      .select()
      .from(contestants)
      .where(inArray(contestants.groupId, groupIds));
    // Merge, deduplicating by id
    const merged = [...assigned];
    for (const c of groupMembers) {
      if (!assignedSet.has(c.id)) merged.push(c);
    }
    return merged;
  }

  async updateContestant(id: string, data: Partial<Contestant>): Promise<Contestant | undefined> {
    // Remove id and createdAt from update data
    const { id: _, createdAt, ...updateData } = data as any;
    const [updated] = await db
      .update(contestants)
      .set(updateData)
      .where(eq(contestants.id, id))
      .returning();
    return updated;
  }

  async updateContestantAvailability(id: string, status: string): Promise<Contestant | undefined> {
    const [updated] = await db
      .update(contestants)
      .set({ availabilityStatus: status as any })
      .where(eq(contestants.id, id))
      .returning();
    return updated;
  }

  async updateContestantPhoto(id: string, photoUrl: string | null): Promise<Contestant | undefined> {
    const [updated] = await db
      .update(contestants)
      .set({ photoUrl })
      .where(eq(contestants.id, id))
      .returning();
    return updated;
  }

  async updateContestantField(id: string, field: string, value: any): Promise<Contestant | undefined> {
    const [updated] = await db
      .update(contestants)
      .set({ [field]: value })
      .where(eq(contestants.id, id))
      .returning();
    return updated;
  }

  async deleteContestant(id: string): Promise<void> {
    await getDb().delete(contestants).where(eq(contestants.id, id));
  }

  // Dedicated method to update contestant's "Attending With" field
  async updateContestantAttendingWith(id: string, attendingWith: string): Promise<Contestant | undefined> {
    const [updated] = await db
      .update(contestants)
      .set({ attendingWith })
      .where(eq(contestants.id, id))
      .returning();
    return updated;
  }

  // Groups
  async createGroup(group: InsertGroup): Promise<Group> {
    const [created] = await getDb().insert(groups).values(group).returning();
    return created;
  }

  async getGroups(): Promise<Group[]> {
    return getDb().select().from(groups);
  }

  async getGroupById(id: string): Promise<Group | undefined> {
    const [group] = await getDb().select().from(groups).where(eq(groups.id, id));
    return group;
  }

  // Record Days
  async createRecordDay(recordDay: InsertRecordDay): Promise<RecordDay> {
    const [created] = await getDb().insert(recordDays).values(recordDay).returning();
    return created;
  }

  async getRecordDays(): Promise<RecordDay[]> {
    return getDb().select().from(recordDays);
  }

  async getRecordDayById(id: string): Promise<RecordDay | undefined> {
    const [recordDay] = await getDb().select().from(recordDays).where(eq(recordDays.id, id));
    return recordDay;
  }

  async getRecordDay(id: string): Promise<RecordDay | undefined> {
    return this.getRecordDayById(id);
  }

  async updateRecordDayLock(id: string, lockedAt: Date | null): Promise<RecordDay | undefined> {
    const [updated] = await db
      .update(recordDays)
      .set({ lockedAt })
      .where(eq(recordDays.id, id))
      .returning();
    return updated;
  }

  async updateRecordDayStatus(id: string, status: string): Promise<RecordDay | undefined> {
    const [updated] = await db
      .update(recordDays)
      .set({ status: status as any })
      .where(eq(recordDays.id, id))
      .returning();
    return updated;
  }

  async updateRecordDay(id: string, data: Partial<InsertRecordDay>): Promise<RecordDay | undefined> {
    const db = getDb();
    const [updated] = await db
      .update(recordDays)
      .set(data as any)
      .where(eq(recordDays.id, id))
      .returning();
    return updated;
  }

  async deleteRecordDay(id: string): Promise<{ success: boolean; error?: string }> {
    const db = getDb();
    
    // Check if record day has any seat assignments (including temporary contestants)
    // Join with contestants to get details for error message
    const assignmentsWithContestants = await db
      .select({
        assignment: seatAssignments,
        contestant: contestants,
      })
      .from(seatAssignments)
      .leftJoin(contestants, eq(seatAssignments.contestantId, contestants.id))
      .where(eq(seatAssignments.recordDayId, id));
    
    if (assignmentsWithContestants.length > 0) {
      // Count regular vs temporary contestants for detailed error message
      const tempCount = assignmentsWithContestants.filter(a => a.contestant?.isTemporary).length;
      const regularCount = assignmentsWithContestants.length - tempCount;
      
      let errorDetail = `Cannot delete: This record day has ${assignmentsWithContestants.length} seat assignment(s)`;
      if (tempCount > 0 && regularCount > 0) {
        errorDetail += ` (${regularCount} regular, ${tempCount} temporary)`;
      } else if (tempCount > 0) {
        errorDetail += ` (${tempCount} temporary contestant${tempCount > 1 ? 's' : ''})`;
      }
      errorDetail += `. Remove all contestants first.`;
      
      console.log(`[deleteRecordDay] Blocked deletion of record day ${id}: ${assignmentsWithContestants.length} assignments found`);
      
      return { 
        success: false, 
        error: errorDetail
      };
    }
    
    // Check for standby assignments
    const standbys = await db
      .select()
      .from(standbyAssignments)
      .where(eq(standbyAssignments.recordDayId, id));
    
    if (standbys.length > 0) {
      return { 
        success: false, 
        error: `Cannot delete: This record day has ${standbys.length} standby assignment(s). Remove all standbys first.` 
      };
    }
    
    // Delete related data first (block types, availability records, canceled assignments)
    await getDb().delete(blockTypes).where(eq(blockTypes.recordDayId, id));
    await getDb().delete(contestantAvailability).where(eq(contestantAvailability.recordDayId, id));
    await getDb().delete(canceledAssignments).where(eq(canceledAssignments.recordDayId, id));
    
    // Now delete the record day
    await getDb().delete(recordDays).where(eq(recordDays.id, id));
    
    return { success: true };
  }

  // Seat Assignments
  async createSeatAssignment(assignment: InsertSeatAssignment): Promise<SeatAssignment> {
    // Use transaction to atomically create assignment and update contestant status
    try {
      return await getDb().transaction(async (tx) => {
        // Check if contestant is returning to auto-fill paperwork
        const seatHistory = await tx
          .select({
            recordDayId: seatAssignments.recordDayId,
          })
          .from(seatAssignments)
          .innerJoin(recordDays, eq(seatAssignments.recordDayId, recordDays.id))
          .where(and(eq(seatAssignments.contestantId, assignment.contestantId), sql`${recordDays.lockedAt} IS NOT NULL`))
          .limit(1);

        if (seatHistory.length > 0) {
          // Auto-fill paperwork status in assignment
          (assignment as any).paperworkSent = new Date();
          (assignment as any).paperworkReceived = new Date();
          (assignment as any).paperworkSentBy = "SYSTEM (RTN)";
          (assignment as any).paperworkReceivedBy = "SYSTEM (RTN)";
        }

        // SAFETY NET: Check if contestant already has a seat on ANY unlocked record day
        const existingActiveAssignment = await tx
          .select({
            date: recordDays.date,
            rxNumber: recordDays.rxNumber
          })
          .from(seatAssignments)
          .innerJoin(recordDays, eq(seatAssignments.recordDayId, recordDays.id))
          .where(and(
            eq(seatAssignments.contestantId, assignment.contestantId),
            sql`${recordDays.lockedAt} IS NULL`
          ))
          .limit(1);

        if (existingActiveAssignment.length > 0) {
          const day = existingActiveAssignment[0];
          const dateStr = day.date ? new Date(day.date).toLocaleDateString('en-AU') : 'another day';
          const label = day.rxNumber || dateStr;
          throw new Error(`CONTESTANT_ALREADY_ACTIVE: Contestant is already assigned to ${label}`);
        }

        // Create the seat assignment
        const [created] = await tx.insert(seatAssignments).values(assignment).returning();
        
        // Update contestant status to 'assigned' and reset state from 'rescheduled' if applicable
        await tx
          .update(contestants)
          .set({ availabilityStatus: 'assigned', state: 'assigned' })
          .where(eq(contestants.id, assignment.contestantId));
        
        return created;
      });
    } catch (error: any) {
      if (error.message?.startsWith('CONTESTANT_ALREADY_ACTIVE')) {
        throw error;
      }
      // Check for unique constraint violation (PostgreSQL error code 23505)
      if (error.code === '23505') {
        // Log the error for debugging (helps identify unexpected constraint names)
        console.log('Unique constraint violation detected:', {
          code: error.code,
          constraint: error.constraint,
          detail: error.detail,
          message: error.message
        });
        
        // Check for seat conflict - the constraint includes block_number and seat_label
        // Constraint name: seat_assignments_record_day_id_block_number_seat_label_key
        const constraintName = error.constraint || '';
        const errorDetail = error.detail || '';
        
        if (constraintName.includes('block_number') && constraintName.includes('seat_label')) {
          throw new Error('SEAT_CONFLICT: This seat is already occupied by another contestant');
        }
        if (errorDetail.includes('block_number') || errorDetail.includes('seat_label')) {
          throw new Error('SEAT_CONFLICT: This seat is already occupied by another contestant');
        }
        
        // Check for contestant conflict - contestant already assigned to this record day
        // Constraint name: seat_assignments_record_day_id_contestant_id_key
        if (constraintName.includes('contestant_id')) {
          throw new Error('CONTESTANT_CONFLICT: This contestant is already assigned to this record day');
        }
        if (errorDetail.includes('contestant_id')) {
          throw new Error('CONTESTANT_CONFLICT: This contestant is already assigned to this record day');
        }
        
        // Fallback for any other unique constraint violation
        throw new Error('CONFLICT: A duplicate assignment already exists');
      }
      throw error;
    }
  }

  async getSeatAssignmentById(id: string): Promise<SeatAssignment | undefined> {
    const [assignment] = await getDb().select().from(seatAssignments).where(eq(seatAssignments.id, id));
    return assignment;
  }

  async getSeatAssignmentsByRecordDay(recordDayId: string): Promise<SeatAssignment[]> {
    return db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.recordDayId, recordDayId));
  }

  async getSeatAssignmentByRecordDayAndContestant(recordDayId: string, contestantId: string): Promise<SeatAssignment | undefined> {
    const [assignment] = await db
      .select()
      .from(seatAssignments)
      .where(and(
        eq(seatAssignments.recordDayId, recordDayId),
        eq(seatAssignments.contestantId, contestantId)
      ));
    return assignment;
  }

  async getAllSeatAssignments(): Promise<SeatAssignment[]> {
    return getDb().select().from(seatAssignments);
  }

  async deleteSeatAssignment(id: string): Promise<void> {
    // Use transaction to atomically delete assignment and update contestant status
    await getDb().transaction(async (tx) => {
      // Get the assignment to find the contestant
      const [assignment] = await tx
        .select()
        .from(seatAssignments)
        .where(eq(seatAssignments.id, id));
      
      if (assignment) {
        // Delete the seat assignment
        await tx.delete(seatAssignments).where(eq(seatAssignments.id, id));
        
        // Check if contestant has any OTHER seat assignments remaining
        const otherAssignments = await tx
          .select()
          .from(seatAssignments)
          .where(eq(seatAssignments.contestantId, assignment.contestantId));
        
        // Also check if they're a standby somewhere
        const existingStandbys = await tx
          .select()
          .from(standbyAssignments)
          .where(eq(standbyAssignments.contestantId, assignment.contestantId));
        
        // Only set to 'available' if no other assignments exist
        if (otherAssignments.length === 0 && existingStandbys.length === 0) {
          await tx
            .update(contestants)
            .set({ availabilityStatus: 'available' })
            .where(eq(contestants.id, assignment.contestantId));
        }

        // Log movement history - removed from seat
        await tx.insert(movementHistory).values({
          contestantId: assignment.contestantId,
          movementType: 'seat_change',
          fromBlockNumber: assignment.blockNumber,
          fromSeatLabel: assignment.seatLabel,
          recordDayId: assignment.recordDayId,
          notes: 'Removed from seat assignment',
          movedBy: 'System',
        });
      }
    });
  }

  async updateSeatAssignment(
    id: string,
    blockNumber: number,
    seatLabel: string
  ): Promise<SeatAssignment | undefined> {
    const [updated] = await db
      .update(seatAssignments)
      .set({ blockNumber, seatLabel })
      .where(eq(seatAssignments.id, id))
      .returning();
    return updated;
  }

  async updateSeatAssignmentWorkflow(
    id: string,
    workflowFields: Partial<SeatAssignment>
  ): Promise<SeatAssignment | undefined> {
    const allowedFields = {
      firstNations: workflowFields.firstNations,
      rating: workflowFields.rating,
      location: workflowFields.location,
      medicalQuestion: workflowFields.medicalQuestion,
      criminalBankruptcy: workflowFields.criminalBankruptcy,
      castingCategory: workflowFields.castingCategory,
      notes: workflowFields.notes,
      playerType: workflowFields.playerType,
      bookingEmailSent: workflowFields.bookingEmailSent,
      confirmedRsvp: workflowFields.confirmedRsvp,
      ticketEmailSent: workflowFields.ticketEmailSent,
      paperworkSent: workflowFields.paperworkSent,
      paperworkReceived: workflowFields.paperworkReceived,
      paperworkOnDay: workflowFields.paperworkOnDay,
      signedIn: workflowFields.signedIn,
      otdNotes: workflowFields.otdNotes,
      standbyReplacementSwaps: workflowFields.standbyReplacementSwaps,
      rxNumber: workflowFields.rxNumber,
      rxEpNumber: workflowFields.rxEpNumber,
      caseNumber: workflowFields.caseNumber,
      winningMoneyRole: workflowFields.winningMoneyRole,
      winningMoneyAmount: workflowFields.winningMoneyAmount,
      winningMoneyText: workflowFields.winningMoneyText,
      caseAmount: workflowFields.caseAmount,
      quickCash: workflowFields.quickCash,
      hnGiftcard: workflowFields.hnGiftcard,
      bankOfferTaken: workflowFields.bankOfferTaken,
      spinTheWheel: workflowFields.spinTheWheel,
      prize: workflowFields.prize,
      txNumber: workflowFields.txNumber,
      txDate: workflowFields.txDate,
      notifiedOfTx: workflowFields.notifiedOfTx,
      photosSent: workflowFields.photosSent,
      attendingWithOverride: workflowFields.attendingWithOverride,
      mobilityNotesOverride: workflowFields.mobilityNotesOverride,
      emailsCopiedAt: workflowFields.emailsCopiedAt,
      called: workflowFields.called,
      calledAt: workflowFields.calledAt,
    };

    const fieldsToUpdate = Object.fromEntries(
      Object.entries(allowedFields).filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(fieldsToUpdate).length === 0) {
      const [existing] = await getDb().select().from(seatAssignments).where(eq(seatAssignments.id, id));
      return existing;
    }

    const fieldToColumn: Record<string, string> = {
      firstNations: 'first_nations', rating: 'rating', location: 'location',
      medicalQuestion: 'medical_question', criminalBankruptcy: 'criminal_bankruptcy',
      castingCategory: 'casting_category', notes: 'notes', playerType: 'player_type',
      bookingEmailSent: 'booking_email_sent', confirmedRsvp: 'confirmed_rsvp',
      ticketEmailSent: 'ticket_email_sent', paperworkSent: 'paperwork_sent',
      paperworkReceived: 'paperwork_received', paperworkOnDay: 'paperwork_on_day',
      signedIn: 'signed_in', otdNotes: 'otd_notes',
      standbyReplacementSwaps: 'standby_replacement_swaps',
      rxNumber: 'rx_number', rxEpNumber: 'rx_ep_number', caseNumber: 'case_number',
      winningMoneyRole: 'winning_money_role', winningMoneyAmount: 'winning_money_amount',
      winningMoneyText: 'winning_money_text', caseAmount: 'case_amount',
      hnGiftcard: 'hn_giftcard', bankOfferTaken: 'bank_offer_taken',
      spinTheWheel: 'spin_the_wheel', prize: 'prize',
      txNumber: 'tx_number', txDate: 'tx_date',
      notifiedOfTx: 'notified_of_tx', photosSent: 'photos_sent',
      attendingWithOverride: 'attending_with_override',
      mobilityNotesOverride: 'mobility_notes_override',
      emailsCopiedAt: 'emails_copied_at', called: 'called', calledAt: 'called_at',
      quickCash: 'quick_cash',
    };

    const realColumns = new Set(['caseAmount', 'quickCash', 'winningMoneyAmount']);
    const booleanColumns = new Set(['bankOfferTaken', 'spinTheWheel', 'hnGiftcard', 'called', 'notifiedOfTx', 'photosSent']);
    const timestampColumns = new Set(['bookingEmailSent', 'confirmedRsvp', 'ticketEmailSent', 'paperworkSent', 'paperworkReceived', 'paperworkOnDay', 'signedIn', 'emailsCopiedAt', 'calledAt']);

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const [jsField, value] of Object.entries(fieldsToUpdate)) {
      const col = fieldToColumn[jsField];
      if (!col) continue;

      let safeValue = value;
      let castSuffix = '';

      if (realColumns.has(jsField)) {
        if (safeValue === null || safeValue === undefined || typeof safeValue === 'boolean') {
          safeValue = null;
        } else {
          const num = Number(safeValue);
          safeValue = isNaN(num) ? null : num;
        }
        castSuffix = '::real';
      } else if (booleanColumns.has(jsField)) {
        if (safeValue === null || safeValue === undefined) {
          safeValue = null;
        } else {
          safeValue = safeValue === true || safeValue === 'true';
        }
        castSuffix = '::boolean';
      } else if (timestampColumns.has(jsField)) {
        if (safeValue instanceof Date) {
          safeValue = safeValue.toISOString();
        }
        castSuffix = '::timestamp';
      }

      setClauses.push(`"${col}" = $${paramIndex}${castSuffix}`);
      params.push(safeValue);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      const [existing] = await getDb().select().from(seatAssignments).where(eq(seatAssignments.id, id));
      return existing;
    }

    params.push(id);
    const query = `UPDATE seat_assignments SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    console.log("[RAW SQL UPDATE]", query, "params:", JSON.stringify(params));

    const result = await pool!.query(query, params);
    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    const mapped: any = {};
    for (const [jsField, colName] of Object.entries(fieldToColumn)) {
      if (colName in row) {
        mapped[jsField] = row[colName];
      }
    }
    mapped.id = row.id;
    mapped.contestantId = row.contestant_id;
    mapped.recordDayId = row.record_day_id;
    mapped.blockNumber = row.block_number;
    mapped.seatLabel = row.seat_label;
    mapped.contestantName = row.contestant_name;
    mapped.contestantGender = row.contestant_gender;
    mapped.contestantAge = row.contestant_age;
    mapped.groupId = row.group_id;
    mapped.groupName = row.group_name;
    mapped.createdAt = row.created_at;
    mapped.bookingEmailError = row.booking_email_error;
    mapped.paperworkSentBy = row.paperwork_sent_by;
    mapped.paperworkReceivedBy = row.paperwork_received_by;
    mapped.seatNotes = row.seat_notes;
    mapped.castingCardUrl = row.casting_card_url;
    mapped.seatedAsBlockType = row.seated_as_block_type;
    mapped.seatedFromStandby = row.seated_from_standby;
    mapped.standbyMovementNotes = row.standby_movement_notes;
    mapped.originalBlockNumber = row.original_block_number;
    mapped.originalSeatLabel = row.original_seat_label;
    mapped.swappedAt = row.swapped_at;
    mapped.quickCash = row.quick_cash;
    mapped.txDate = row.tx_date;
    return mapped as SeatAssignment;
  }

  async updateSeatAssignmentCastingCard(
    id: string,
    castingCardUrl: string | null
  ): Promise<SeatAssignment | undefined> {
    const [updated] = await db
      .update(seatAssignments)
      .set({ castingCardUrl })
      .where(eq(seatAssignments.id, id))
      .returning();
    return updated;
  }

  async atomicSwapSeats(
    sourceId: string,
    targetId: string | null,
    targetBlock?: number,
    targetSeat?: string
  ): Promise<{ source: SeatAssignment; target?: SeatAssignment }> {
    // Use Drizzle transaction for atomic operation
    return await getDb().transaction(async (tx) => {
      // Get source assignment with row-level lock
      const [source] = await tx
        .select()
        .from(seatAssignments)
        .where(eq(seatAssignments.id, sourceId))
        .for('update'); // Row-level lock

      if (!source) {
        throw new Error('Source assignment not found');
      }

      if (targetId) {
        // Swapping two assigned seats
        const [target] = await tx
          .select()
          .from(seatAssignments)
          .where(eq(seatAssignments.id, targetId))
          .for('update'); // Row-level lock

        if (!target) {
          throw new Error('Target assignment not found');
        }

        if (source.recordDayId !== target.recordDayId) {
          throw new Error('Cannot swap assignments from different record days');
        }

        // Store original source location
        const tempBlock = source.blockNumber;
        const tempSeat = source.seatLabel;

        // Move source to a unique temporary location to avoid constraint violation
        // Use source ID to ensure uniqueness across concurrent swaps
        const [tempSource] = await tx
          .update(seatAssignments)
          .set({
            blockNumber: -1,
            seatLabel: `TEMP_${sourceId}`,
          })
          .where(eq(seatAssignments.id, sourceId))
          .returning();

        // Update target to source's original location
        const [updatedTarget] = await tx
          .update(seatAssignments)
          .set({
            blockNumber: tempBlock,
            seatLabel: tempSeat,
          })
          .where(eq(seatAssignments.id, targetId))
          .returning();

        // Update source to target's original location
        const [updatedSource] = await tx
          .update(seatAssignments)
          .set({
            blockNumber: target.blockNumber,
            seatLabel: target.seatLabel,
          })
          .where(eq(seatAssignments.id, sourceId))
          .returning();

        return { source: updatedSource, target: updatedTarget };
      } else {
        // Moving to empty seat
        if (!targetBlock || !targetSeat) {
          throw new Error('Target block and seat are required for moves');
        }

        // Use PostgreSQL advisory lock to serialize moves to the same destination
        // Hash the target location to a deterministic integer for the lock
        const lockKey = this.hashSeatLocation(source.recordDayId, targetBlock, targetSeat);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

        // Check for collision at target location (after acquiring lock)
        const [existing] = await tx
          .select()
          .from(seatAssignments)
          .where(
            and(
              eq(seatAssignments.recordDayId, source.recordDayId),
              eq(seatAssignments.blockNumber, targetBlock),
              eq(seatAssignments.seatLabel, targetSeat)
            )
          );

        if (existing && existing.id !== sourceId) {
          throw new Error('Target seat is already occupied');
        }

        // Update source to new location
        const [updatedSource] = await tx
          .update(seatAssignments)
          .set({
            blockNumber: targetBlock,
            seatLabel: targetSeat,
          })
          .where(eq(seatAssignments.id, sourceId))
          .returning();

        return { source: updatedSource };
      }
    });
  }

  async swapSeatAssignmentsWithTracking(
    assignment1Id: string,
    assignment2Id: string,
    assignment1Block: number,
    assignment1Seat: string,
    assignment2Block: number,
    assignment2Seat: string
  ): Promise<{ assignment1: SeatAssignment; assignment2: SeatAssignment }> {
    return await getDb().transaction(async (tx) => {
      // Get both assignments with row-level locks
      const [assign1] = await tx
        .select()
        .from(seatAssignments)
        .where(eq(seatAssignments.id, assignment1Id))
        .for('update');

      const [assign2] = await tx
        .select()
        .from(seatAssignments)
        .where(eq(seatAssignments.id, assignment2Id))
        .for('update');

      if (!assign1 || !assign2) {
        throw new Error('One or both assignments not found');
      }

      const now = new Date();
      
      // Determine true original positions for each assignment
      const trueOriginal1Block = assign1.originalBlockNumber ?? assignment1Block;
      const trueOriginal1Seat = assign1.originalSeatLabel ?? assignment1Seat;
      const trueOriginal2Block = assign2.originalBlockNumber ?? assignment2Block;
      const trueOriginal2Seat = assign2.originalSeatLabel ?? assignment2Seat;
      
      // After swap: assign1 goes to assignment2's current position, assign2 goes to assignment1's current position
      // Check if each assignment is returning to their original position
      const assign1ReturningToOriginal = assignment2Block === trueOriginal1Block && assignment2Seat === trueOriginal1Seat;
      const assign2ReturningToOriginal = assignment1Block === trueOriginal2Block && assignment1Seat === trueOriginal2Seat;

      // Move assignment1 to a temporary location first to avoid unique constraint violation
      await tx
        .update(seatAssignments)
        .set({
          blockNumber: -1,
          seatLabel: `TEMP_SWAP_${assignment1Id}`,
        })
        .where(eq(seatAssignments.id, assignment1Id));

      // Update assignment2: move to assignment1's location
      const update2Data = assign2ReturningToOriginal
        ? {
            blockNumber: assignment1Block,
            seatLabel: assignment1Seat,
            originalBlockNumber: null,
            originalSeatLabel: null,
            swappedAt: null,
          }
        : {
            blockNumber: assignment1Block,
            seatLabel: assignment1Seat,
            originalBlockNumber: trueOriginal2Block,
            originalSeatLabel: trueOriginal2Seat,
            swappedAt: now,
          };
      
      const [updated2] = await tx
        .update(seatAssignments)
        .set(update2Data)
        .where(eq(seatAssignments.id, assignment2Id))
        .returning();

      // Update assignment1: move to assignment2's location
      const update1Data = assign1ReturningToOriginal
        ? {
            blockNumber: assignment2Block,
            seatLabel: assignment2Seat,
            originalBlockNumber: null,
            originalSeatLabel: null,
            swappedAt: null,
          }
        : {
            blockNumber: assignment2Block,
            seatLabel: assignment2Seat,
            originalBlockNumber: trueOriginal1Block,
            originalSeatLabel: trueOriginal1Seat,
            swappedAt: now,
          };
      
      const [updated1] = await tx
        .update(seatAssignments)
        .set(update1Data)
        .where(eq(seatAssignments.id, assignment1Id))
        .returning();

      return { assignment1: updated1, assignment2: updated2 };
    });
  }

  async moveSeatAssignmentWithTracking(
    assignmentId: string,
    newBlockNumber: number,
    newSeatLabel: string
  ): Promise<SeatAssignment> {
    return await getDb().transaction(async (tx) => {
      // Get the assignment with row-level lock
      const [assignment] = await tx
        .select()
        .from(seatAssignments)
        .where(eq(seatAssignments.id, assignmentId))
        .for('update');

      if (!assignment) {
        throw new Error('Assignment not found');
      }

      const now = new Date();
      
      // Determine the "original" position (either tracked original or current position)
      const trueOriginalBlock = assignment.originalBlockNumber ?? assignment.blockNumber;
      const trueOriginalSeat = assignment.originalSeatLabel ?? assignment.seatLabel;
      
      // Check if moving back to original position
      const isMovingBackToOriginal = newBlockNumber === trueOriginalBlock && newSeatLabel === trueOriginalSeat;

      let updateData;
      if (isMovingBackToOriginal) {
        // Moving back to original - clear tracking fields
        updateData = {
          blockNumber: newBlockNumber,
          seatLabel: newSeatLabel,
          originalBlockNumber: null,
          originalSeatLabel: null,
          swappedAt: null,
        };
      } else {
        // Moving to a new location - set/keep tracking fields
        updateData = {
          blockNumber: newBlockNumber,
          seatLabel: newSeatLabel,
          originalBlockNumber: trueOriginalBlock,
          originalSeatLabel: trueOriginalSeat,
          swappedAt: now,
        };
      }

      const [updated] = await tx
        .update(seatAssignments)
        .set(updateData)
        .where(eq(seatAssignments.id, assignmentId))
        .returning();

      return updated;
    });
  }

  async swapBlocks(
    recordDayId: string,
    blockA: number,
    blockB: number
  ): Promise<{ swappedCount: number; blockAAssignments: SeatAssignment[]; blockBAssignments: SeatAssignment[] }> {
    return await getDb().transaction(async (tx) => {
      // Get all assignments for both blocks with row-level locks
      const blockAAssignments = await tx
        .select()
        .from(seatAssignments)
        .where(
          and(
            eq(seatAssignments.recordDayId, recordDayId),
            eq(seatAssignments.blockNumber, blockA)
          )
        )
        .for('update');

      const blockBAssignments = await tx
        .select()
        .from(seatAssignments)
        .where(
          and(
            eq(seatAssignments.recordDayId, recordDayId),
            eq(seatAssignments.blockNumber, blockB)
          )
        )
        .for('update');

      // Use a temporary block number (e.g., -1) to avoid unique constraint violations
      // during the swap process. The constraint is on (recordDayId, blockNumber, seatLabel).
      
      // Phase 1: Move block A to temp
      for (const assignment of blockAAssignments) {
        await tx
          .update(seatAssignments)
          .set({ blockNumber: -1 })
          .where(eq(seatAssignments.id, assignment.id));
      }

      // Phase 2: Move block B to block A
      for (const assignment of blockBAssignments) {
        await tx
          .update(seatAssignments)
          .set({ blockNumber: blockA })
          .where(eq(seatAssignments.id, assignment.id));
      }

      // Phase 3: Move temp (original block A) to block B
      for (const assignment of blockAAssignments) {
        await tx
          .update(seatAssignments)
          .set({ blockNumber: blockB })
          .where(eq(seatAssignments.id, assignment.id));
      }

      const totalSwapped = blockAAssignments.length + blockBAssignments.length;

      // Return updated assignments with swapped block numbers
      const updatedBlockAAssignments = blockAAssignments.map(a => ({ ...a, blockNumber: blockB }));
      const updatedBlockBAssignments = blockBAssignments.map(a => ({ ...a, blockNumber: blockA }));

      return {
        swappedCount: totalSwapped,
        blockAAssignments: updatedBlockAAssignments,
        blockBAssignments: updatedBlockBAssignments
      };
    });
  }

  async cancelSeatAssignment(id: string, reason?: string, movedBy?: string, isDecline: boolean = false): Promise<CanceledAssignment> {
    // Get the seat assignment first
    const [assignment] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.id, id));

    if (!assignment) {
      throw new Error('Seat assignment not found');
    }

    // Use createOrUpdateCanceledAssignment to prevent duplicates and preserve history
    const canceled = await this.createOrUpdateCanceledAssignment({
      contestantId: assignment.contestantId,
      recordDayId: assignment.recordDayId,
      blockNumber: assignment.blockNumber,
      seatLabel: assignment.seatLabel,
      reason,
      movedBy,
      // Track if this was a decline vs a producer move
      wasDeclined: isDecline,
      declinedAt: isDecline ? new Date() : null,
      declinedBy: isDecline ? movedBy : null,
      // Carry over booking status for rescheduling
      bookingEmailSent: assignment.bookingEmailSent,
      confirmedRsvp: assignment.confirmedRsvp,
      // Carry over paperwork status for rescheduling
      paperworkSent: assignment.paperworkSent,
      paperworkSentBy: assignment.paperworkSentBy,
      paperworkReceived: assignment.paperworkReceived,
      paperworkReceivedBy: assignment.paperworkReceivedBy,
      paperworkOnDay: assignment.paperworkOnDay,
      // Carry over standby block type (if from standby)
      seatedAsBlockType: assignment.seatedAsBlockType,
      standbyMovementNotes: assignment.standbyMovementNotes,
    });

    // Delete the seat assignment
    await getDb().delete(seatAssignments).where(eq(seatAssignments.id, id));

    // Update contestant status to 'rescheduled'
    await db
      .update(contestants)
      .set({ availabilityStatus: 'rescheduled' })
      .where(eq(contestants.id, assignment.contestantId));

    // Log movement history
    await getDb().insert(movementHistory).values({
      contestantId: assignment.contestantId,
      movementType: 'added_to_reschedule',
      fromBlockNumber: assignment.blockNumber,
      fromSeatLabel: assignment.seatLabel,
      recordDayId: assignment.recordDayId,
      notes: isDecline ? `Declined booking: ${reason || 'No reason'}` : `Canceled and moved to reschedule: ${reason || 'No reason'}`,
      movedBy: movedBy || 'System',
    });

    return canceled;
  }

  // Canceled Assignments
  async getCanceledAssignments(): Promise<Array<CanceledAssignment & { contestant: Contestant; recordDay: RecordDay }>> {
    const results = await db
      .select({
        id: canceledAssignments.id,
        contestantId: canceledAssignments.contestantId,
        recordDayId: canceledAssignments.recordDayId,
        blockNumber: canceledAssignments.blockNumber,
        seatLabel: canceledAssignments.seatLabel,
        canceledAt: canceledAssignments.canceledAt,
        reason: canceledAssignments.reason,
        movedBy: canceledAssignments.movedBy,
        isFromStandby: canceledAssignments.isFromStandby,
        originalAttendanceDate: canceledAssignments.originalAttendanceDate,
        wasDeclined: canceledAssignments.wasDeclined,
        declinedAt: canceledAssignments.declinedAt,
        declinedBy: canceledAssignments.declinedBy,
        bookingEmailSent: canceledAssignments.bookingEmailSent,
        confirmedRsvp: canceledAssignments.confirmedRsvp,
        paperworkSent: canceledAssignments.paperworkSent,
        paperworkSentBy: canceledAssignments.paperworkSentBy,
        paperworkReceived: canceledAssignments.paperworkReceived,
        paperworkReceivedBy: canceledAssignments.paperworkReceivedBy,
        paperworkOnDay: canceledAssignments.paperworkOnDay,
        seatedAsBlockType: canceledAssignments.seatedAsBlockType,
        standbyMovementNotes: canceledAssignments.standbyMovementNotes,
        // Rebooked tracking fields
        rebookedToRecordDayId: canceledAssignments.rebookedToRecordDayId,
        rebookedAt: canceledAssignments.rebookedAt,
        rebookedBy: canceledAssignments.rebookedBy,
        // Reschedule count and history
        rescheduleCount: canceledAssignments.rescheduleCount,
        declineHistory: canceledAssignments.declineHistory,
        contestant: contestants,
        recordDay: recordDays,
      })
      .from(canceledAssignments)
      .innerJoin(contestants, eq(canceledAssignments.contestantId, contestants.id))
      .innerJoin(recordDays, eq(canceledAssignments.recordDayId, recordDays.id));

    return results as any;
  }

  async getCanceledAssignmentByPosition(recordDayId: string, blockNumber: number, seatLabel: string): Promise<CanceledAssignment | undefined> {
    const [result] = await db
      .select()
      .from(canceledAssignments)
      .where(
        and(
          eq(canceledAssignments.recordDayId, recordDayId),
          eq(canceledAssignments.blockNumber, blockNumber),
          eq(canceledAssignments.seatLabel, seatLabel)
        )
      )
      .limit(1);
    return result;
  }

  async updateCanceledAssignmentPosition(id: string, blockNumber: number, seatLabel: string): Promise<void> {
    await db
      .update(canceledAssignments)
      .set({ blockNumber, seatLabel })
      .where(eq(canceledAssignments.id, id));
  }

  async createCanceledAssignment(data: Partial<InsertCanceledAssignment> & { contestantId: string; recordDayId: string }): Promise<CanceledAssignment> {
    const [created] = await db
      .insert(canceledAssignments)
      .values({
        contestantId: data.contestantId,
        recordDayId: data.recordDayId,
        blockNumber: data.blockNumber ?? null,
        seatLabel: data.seatLabel ?? null,
        reason: data.reason ?? null,
        movedBy: data.movedBy ?? null,
        isFromStandby: data.isFromStandby ?? false,
        originalAttendanceDate: data.originalAttendanceDate ?? null,
        wasDeclined: (data as any).wasDeclined ?? false,
        declinedAt: (data as any).declinedAt ?? null,
        declinedBy: (data as any).declinedBy ?? null,
        bookingEmailSent: (data as any).bookingEmailSent ?? null,
        confirmedRsvp: (data as any).confirmedRsvp ?? null,
        paperworkSent: (data as any).paperworkSent ?? null,
        paperworkSentBy: (data as any).paperworkSentBy ?? null,
        paperworkReceived: (data as any).paperworkReceived ?? null,
        paperworkReceivedBy: (data as any).paperworkReceivedBy ?? null,
        paperworkOnDay: (data as any).paperworkOnDay ?? null,
        seatedAsBlockType: (data as any).seatedAsBlockType ?? null,
        standbyMovementNotes: (data as any).standbyMovementNotes ?? null,
      })
      .returning();
    
    // Update contestant state to 'rescheduled'
    await db
      .update(contestants)
      .set({ state: 'rescheduled' })
      .where(eq(contestants.id, data.contestantId));
    
    return created;
  }

  async getCanceledAssignmentByContestant(contestantId: string): Promise<CanceledAssignment | undefined> {
    const [result] = await db
      .select()
      .from(canceledAssignments)
      .where(eq(canceledAssignments.contestantId, contestantId));
    return result;
  }

  async createOrUpdateCanceledAssignment(data: Partial<InsertCanceledAssignment> & { contestantId: string; recordDayId: string }): Promise<CanceledAssignment> {
    // Check if contestant already has a reschedule entry
    const existing = await this.getCanceledAssignmentByContestant(data.contestantId);
    
    if (existing) {
      // Build decline history entry from existing record
      const historyEntry: any = {
        reason: existing.reason,
        recordDayId: existing.recordDayId,
        blockNumber: existing.blockNumber,
        seatLabel: existing.seatLabel,
        canceledAt: existing.canceledAt,
        movedBy: existing.movedBy,
        wasDeclined: existing.wasDeclined,
        declinedAt: existing.declinedAt,
        rebookedToRecordDayId: existing.rebookedToRecordDayId,
        rebookedAt: existing.rebookedAt,
      };
      
      // Append to existing decline history
      const existingHistory = (existing.declineHistory as any[]) || [];
      const newHistory = [...existingHistory, historyEntry];
      
      // Update existing record with new info
      const [updated] = await db
        .update(canceledAssignments)
        .set({
          recordDayId: data.recordDayId,
          blockNumber: data.blockNumber ?? null,
          seatLabel: data.seatLabel ?? null,
          reason: data.reason ?? null,
          movedBy: data.movedBy ?? null,
          isFromStandby: data.isFromStandby ?? false,
          originalAttendanceDate: data.originalAttendanceDate ?? null,
          canceledAt: new Date(),
          rescheduleCount: (existing.rescheduleCount || 1) + 1,
          declineHistory: newHistory,
          // Clear rebooked status since they're back in reschedule
          rebookedToRecordDayId: null,
          rebookedAt: null,
          rebookedBy: null,
          // Reset declined tracking for new entry
          wasDeclined: data.wasDeclined ?? false,
          declinedAt: data.declinedAt ?? null,
          declinedBy: data.declinedBy ?? null,
          // Carry over booking and paperwork status from the new assignment
          bookingEmailSent: (data as any).bookingEmailSent ?? null,
          confirmedRsvp: (data as any).confirmedRsvp ?? null,
          paperworkSent: (data as any).paperworkSent ?? null,
          paperworkSentBy: (data as any).paperworkSentBy ?? null,
          paperworkReceived: (data as any).paperworkReceived ?? null,
          paperworkReceivedBy: (data as any).paperworkReceivedBy ?? null,
          paperworkOnDay: (data as any).paperworkOnDay ?? null,
          seatedAsBlockType: (data as any).seatedAsBlockType ?? null,
          standbyMovementNotes: (data as any).standbyMovementNotes ?? null,
        })
        .where(eq(canceledAssignments.id, existing.id))
        .returning();
      
      // Update contestant state to 'rescheduled'
      await db
        .update(contestants)
        .set({ state: 'rescheduled' })
        .where(eq(contestants.id, data.contestantId));
      
      return updated;
    } else {
      // No existing entry, create new one
      return this.createCanceledAssignment(data);
    }
  }

  async updateCanceledAssignment(id: string, data: Partial<CanceledAssignment>): Promise<CanceledAssignment> {
    const [updated] = await db
      .update(canceledAssignments)
      .set(data as any)
      .where(eq(canceledAssignments.id, id))
      .returning();
    return updated;
  }

  async deleteCanceledAssignment(id: string): Promise<void> {
    await getDb().delete(canceledAssignments).where(eq(canceledAssignments.id, id));
  }

  // Availability Tokens
  async createAvailabilityToken(token: InsertAvailabilityToken): Promise<AvailabilityToken> {
    const [created] = await getDb().insert(availabilityTokens).values(token).returning();
    return created;
  }

  async getAvailabilityTokenByToken(token: string): Promise<AvailabilityToken | undefined> {
    const [result] = await db
      .select()
      .from(availabilityTokens)
      .where(eq(availabilityTokens.token, token));
    return result;
  }

  async getAvailabilityTokensByContestant(contestantId: string): Promise<AvailabilityToken[]> {
    return db
      .select()
      .from(availabilityTokens)
      .where(eq(availabilityTokens.contestantId, contestantId));
  }

  async updateTokenStatus(id: string, status: string): Promise<AvailabilityToken | undefined> {
    const [updated] = await db
      .update(availabilityTokens)
      .set({ status: status as any })
      .where(eq(availabilityTokens.id, id))
      .returning();
    return updated;
  }

  async revokeContestantTokens(contestantId: string): Promise<void> {
    await db
      .update(availabilityTokens)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(availabilityTokens.contestantId, contestantId),
          eq(availabilityTokens.status, 'active')
        )
      );
  }

  // Contestant Availability
  async createContestantAvailability(availability: InsertContestantAvailability): Promise<ContestantAvailability> {
    const [created] = await getDb().insert(contestantAvailability).values(availability).returning();
    return created;
  }

  async getContestantAvailability(contestantId: string): Promise<ContestantAvailability[]> {
    return db
      .select()
      .from(contestantAvailability)
      .where(eq(contestantAvailability.contestantId, contestantId));
  }

  async getAvailabilityByRecordDay(recordDayId: string): Promise<Array<ContestantAvailability & { contestant: Contestant }>> {
    const results = await db
      .select()
      .from(contestantAvailability)
      .leftJoin(contestants, eq(contestantAvailability.contestantId, contestants.id))
      .where(eq(contestantAvailability.recordDayId, recordDayId));
    
    // Drizzle uses snake_case for table names in join results
    return results.map(row => ({
      ...(row.contestant_availability as ContestantAvailability),
      contestant: row.contestants!,
    }));
  }

  async getAllAvailabilityResponses(): Promise<ContestantAvailability[]> {
    return getDb().select().from(contestantAvailability);
  }

  async updateAvailabilityResponse(id: string, responseValue: string, notes?: string): Promise<ContestantAvailability | undefined> {
    const [updated] = await db
      .update(contestantAvailability)
      .set({ 
        responseValue: responseValue as any,
        notes,
        respondedAt: new Date(),
      })
      .where(eq(contestantAvailability.id, id))
      .returning();
    return updated;
  }

  async upsertContestantAvailability(
    contestantId: string,
    recordDayId: string,
    responseValue: string,
    notes?: string
  ): Promise<ContestantAvailability> {
    // Check if record exists
    const [existing] = await db
      .select()
      .from(contestantAvailability)
      .where(
        and(
          eq(contestantAvailability.contestantId, contestantId),
          eq(contestantAvailability.recordDayId, recordDayId)
        )
      );

    if (existing) {
      // Update existing
      const [updated] = await db
        .update(contestantAvailability)
        .set({
          responseValue: responseValue as any,
          notes,
          respondedAt: new Date(),
        })
        .where(eq(contestantAvailability.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new
      const [created] = await db
        .insert(contestantAvailability)
        .values({
          contestantId,
          recordDayId,
          responseValue: responseValue as any,
          notes,
          respondedAt: new Date(),
        })
        .returning();
      return created;
    }
  }

  async getContestantsAvailableForRecordDay(recordDayId: string): Promise<Contestant[]> {
    const results = await db
      .select()
      .from(contestants)
      .leftJoin(contestantAvailability, eq(contestants.id, contestantAvailability.contestantId))
      .where(
        and(
          eq(contestantAvailability.recordDayId, recordDayId),
          eq(contestantAvailability.responseValue, 'yes')
        )
      );
    
    return results.map(row => row.contestants);
  }

  // Booking Confirmation Tokens
  async createBookingConfirmationToken(token: InsertBookingConfirmationToken): Promise<BookingConfirmationToken> {
    const [created] = await db
      .insert(bookingConfirmationTokens)
      .values(token)
      .returning();
    return created;
  }

  async getBookingConfirmationByToken(token: string): Promise<BookingConfirmationToken | undefined> {
    const [confirmation] = await db
      .select()
      .from(bookingConfirmationTokens)
      .where(eq(bookingConfirmationTokens.token, token));
    return confirmation;
  }

  async getBookingConfirmationBySeatAssignment(seatAssignmentId: string): Promise<BookingConfirmationToken | undefined> {
    const [confirmation] = await db
      .select()
      .from(bookingConfirmationTokens)
      .where(eq(bookingConfirmationTokens.seatAssignmentId, seatAssignmentId));
    return confirmation;
  }

  async getBookingConfirmationsByRecordDay(recordDayId: string): Promise<Array<BookingConfirmationToken & { seatAssignment: SeatAssignment; contestant: Contestant }>> {
    const results = await db
      .select({
        bookingConfirmation: bookingConfirmationTokens,
        seatAssignment: seatAssignments,
        contestant: contestants,
      })
      .from(bookingConfirmationTokens)
      .innerJoin(seatAssignments, eq(bookingConfirmationTokens.seatAssignmentId, seatAssignments.id))
      .innerJoin(contestants, eq(seatAssignments.contestantId, contestants.id))
      .where(
        and(
          eq(seatAssignments.recordDayId, recordDayId),
          inArray(bookingConfirmationTokens.status, ['active', 'used'])
        )
      );

    return results.map(row => ({
      ...row.bookingConfirmation,
      seatAssignment: row.seatAssignment,
      contestant: row.contestant,
    }));
  }

  async updateBookingConfirmationResponse(
    id: string,
    confirmationStatus: string,
    attendingWith?: string,
    notes?: string
  ): Promise<BookingConfirmationToken | undefined> {
    const updateData: any = {
      confirmationStatus,
      confirmedAt: new Date(),
      status: 'used',
    };
    
    if (attendingWith !== undefined) {
      updateData.attendingWith = attendingWith;
    }
    
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    // Use transactional WHERE clause to prevent race conditions
    // Only update if confirmation status is still 'pending'
    const [updated] = await db
      .update(bookingConfirmationTokens)
      .set(updateData)
      .where(
        and(
          eq(bookingConfirmationTokens.id, id),
          eq(bookingConfirmationTokens.confirmationStatus, 'pending')
        )
      )
      .returning();
    return updated;
  }

  async revokeBookingConfirmationToken(seatAssignmentId: string): Promise<void> {
    await db
      .update(bookingConfirmationTokens)
      .set({ status: 'revoked' })
      .where(eq(bookingConfirmationTokens.seatAssignmentId, seatAssignmentId));
  }

  async updateBookingConfirmationResponseAllowResubmit(
    id: string,
    confirmationStatus: string,
    attendingWith?: string,
    notes?: string
  ): Promise<BookingConfirmationToken | undefined> {
    const updateData: any = {
      confirmationStatus,
      confirmedAt: new Date(),
      status: 'used',
    };
    
    if (attendingWith !== undefined) {
      updateData.attendingWith = attendingWith;
    }
    
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    // Update regardless of current confirmation status (allows resubmissions)
    const [updated] = await db
      .update(bookingConfirmationTokens)
      .set(updateData)
      .where(eq(bookingConfirmationTokens.id, id))
      .returning();
    return updated;
  }

  // Booking Messages
  async createBookingMessage(message: InsertBookingMessage): Promise<BookingMessage> {
    const [created] = await db
      .insert(bookingMessages)
      .values(message)
      .returning();
    return created;
  }

  async upsertInboundBookingMessage(message: InsertBookingMessage): Promise<BookingMessage> {
    // Check if an inbound confirmation_response message already exists for this confirmation
    const [existing] = await db
      .select()
      .from(bookingMessages)
      .where(
        and(
          eq(bookingMessages.confirmationId, message.confirmationId),
          eq(bookingMessages.direction, 'inbound'),
          eq(bookingMessages.messageType, 'confirmation_response')
        )
      )
      .limit(1);

    if (existing) {
      // Update the existing message
      const [updated] = await db
        .update(bookingMessages)
        .set({
          subject: message.subject,
          body: message.body,
          sentAt: message.sentAt,
          readAt: null, // Mark as unread since it's been updated
        })
        .where(eq(bookingMessages.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new message
      const [created] = await db
        .insert(bookingMessages)
        .values(message)
        .returning();
      return created;
    }
  }

  async getBookingMessagesByConfirmation(confirmationId: string): Promise<BookingMessage[]> {
    return db
      .select()
      .from(bookingMessages)
      .where(eq(bookingMessages.confirmationId, confirmationId))
      .orderBy(bookingMessages.sentAt);
  }

  async markMessageAsRead(messageId: string): Promise<BookingMessage | undefined> {
    const [updated] = await db
      .update(bookingMessages)
      .set({ readAt: new Date() })
      .where(eq(bookingMessages.id, messageId))
      .returning();
    return updated;
  }

  async getBookingConfirmationsByContestantEmail(email: string): Promise<Array<BookingConfirmationToken & { contestant: Contestant; seatAssignment: SeatAssignment }>> {
    const normalizedEmail = email.toLowerCase().trim();
    const results = await db
      .select({
        bookingConfirmation: bookingConfirmationTokens,
        seatAssignment: seatAssignments,
        contestant: contestants,
      })
      .from(bookingConfirmationTokens)
      .innerJoin(seatAssignments, eq(bookingConfirmationTokens.seatAssignmentId, seatAssignments.id))
      .innerJoin(contestants, eq(seatAssignments.contestantId, contestants.id))
      .where(sql`LOWER(${contestants.email}) = ${normalizedEmail}`);

    return results.map(row => ({
      ...row.bookingConfirmation,
      seatAssignment: row.seatAssignment,
      contestant: row.contestant,
    }));
  }

  async isGmailMessageProcessed(gmailMessageId: string): Promise<boolean> {
    const [existing] = await db
      .select()
      .from(bookingMessages)
      .where(eq(bookingMessages.gmailMessageId, gmailMessageId))
      .limit(1);
    return !!existing;
  }

  // Block Types (PB/NPB)
  async getAllBlockTypes(): Promise<BlockType[]> {
    return getDb().select().from(blockTypes);
  }

  async getBlockTypesByRecordDay(recordDayId: string): Promise<BlockType[]> {
    return db
      .select()
      .from(blockTypes)
      .where(eq(blockTypes.recordDayId, recordDayId));
  }

  async upsertBlockType(recordDayId: string, blockNumber: number, blockType: 'PB' | 'NPB'): Promise<BlockType> {
    // Try to update existing record first
    const existing = await db
      .select()
      .from(blockTypes)
      .where(
        and(
          eq(blockTypes.recordDayId, recordDayId),
          eq(blockTypes.blockNumber, blockNumber)
        )
      );

    if (existing.length > 0) {
      // Update existing
      const [updated] = await db
        .update(blockTypes)
        .set({ blockType })
        .where(eq(blockTypes.id, existing[0].id))
        .returning();
      return updated;
    } else {
      // Insert new
      const [created] = await db
        .insert(blockTypes)
        .values({ recordDayId, blockNumber, blockType })
        .returning();
      return created;
    }
  }

  async upsertBlockTypes(recordDayId: string, configs: Array<{blockNumber: number, blockType: 'PB' | 'NPB'}>): Promise<BlockType[]> {
    const results: BlockType[] = [];
    for (const config of configs) {
      const result = await this.upsertBlockType(recordDayId, config.blockNumber, config.blockType);
      results.push(result);
    }
    return results;
  }

  async isBlockConfigurationComplete(recordDayId: string): Promise<{complete: boolean; pbCount: number; npbCount: number}> {
    const blockConfigs = await this.getBlockTypesByRecordDay(recordDayId);
    const pbCount = blockConfigs.filter(b => b.blockType === 'PB').length;
    const npbCount = blockConfigs.filter(b => b.blockType === 'NPB').length;
    // Complete when we have exactly 5 PB and 2 NPB (7 total blocks configured)
    const complete = pbCount === 5 && npbCount === 2;
    return { complete, pbCount, npbCount };
  }

  // Standby Assignments
  async createStandbyAssignment(assignment: InsertStandbyAssignment): Promise<StandbyAssignment> {
    const [created] = await db
      .insert(standbyAssignments)
      .values(assignment)
      .returning();
    return created;
  }

  async createStandbyAssignments(assignments: InsertStandbyAssignment[]): Promise<StandbyAssignment[]> {
    if (assignments.length === 0) return [];
    return db
      .insert(standbyAssignments)
      .values(assignments)
      .onConflictDoNothing()
      .returning();
  }

  async getStandbyAssignments(): Promise<Array<StandbyAssignment & { contestant: Contestant; recordDay: RecordDay }>> {
    const results = await db
      .select({
        standby: standbyAssignments,
        contestant: contestants,
        recordDay: recordDays,
      })
      .from(standbyAssignments)
      .innerJoin(contestants, eq(standbyAssignments.contestantId, contestants.id))
      .innerJoin(recordDays, eq(standbyAssignments.recordDayId, recordDays.id));
    
    return results.map(r => ({
      ...r.standby,
      contestant: r.contestant,
      recordDay: r.recordDay,
    }));
  }

  async getStandbyAssignmentsByRecordDay(recordDayId: string): Promise<Array<StandbyAssignment & { contestant: Contestant }>> {
    const results = await db
      .select({
        standby: standbyAssignments,
        contestant: contestants,
      })
      .from(standbyAssignments)
      .innerJoin(contestants, eq(standbyAssignments.contestantId, contestants.id))
      .where(eq(standbyAssignments.recordDayId, recordDayId));
    
    return results.map(r => ({
      ...r.standby,
      contestant: r.contestant,
    }));
  }

  async getStandbyAssignmentById(id: string): Promise<StandbyAssignment | undefined> {
    const [standby] = await db
      .select()
      .from(standbyAssignments)
      .where(eq(standbyAssignments.id, id));
    return standby;
  }

  async updateStandbyAssignment(id: string, data: Partial<StandbyAssignment>): Promise<StandbyAssignment | undefined> {
    const [updated] = await db
      .update(standbyAssignments)
      .set(data)
      .where(eq(standbyAssignments.id, id))
      .returning();
    return updated;
  }

  async deleteStandbyAssignment(id: string): Promise<void> {
    const db = getDb();
    
    // Get details before deletion for history
    const [standby] = await db
      .select()
      .from(standbyAssignments)
      .where(eq(standbyAssignments.id, id));

    // First delete any confirmation tokens that reference this standby assignment
    await db
      .delete(standbyConfirmationTokens)
      .where(eq(standbyConfirmationTokens.standbyAssignmentId, id));
    
    // Then delete the standby assignment
    await db
      .delete(standbyAssignments)
      .where(eq(standbyAssignments.id, id));

    if (standby) {
      // Log movement history - removed from standby
      await getDb().insert(movementHistory).values({
        contestantId: standby.contestantId,
        movementType: 'standby_removed',
        recordDayId: standby.recordDayId,
        notes: 'Removed from standby list',
        movedBy: 'System',
      });
    }
  }

  // Standby Confirmation Tokens
  async createStandbyConfirmationToken(token: InsertStandbyConfirmationToken): Promise<StandbyConfirmationToken> {
    const [created] = await db
      .insert(standbyConfirmationTokens)
      .values(token)
      .returning();
    return created;
  }

  async getStandbyConfirmationByToken(token: string): Promise<StandbyConfirmationToken | undefined> {
    const [confirmation] = await db
      .select()
      .from(standbyConfirmationTokens)
      .where(eq(standbyConfirmationTokens.token, token));
    return confirmation;
  }

  async getStandbyConfirmationByAssignment(standbyAssignmentId: string): Promise<StandbyConfirmationToken | undefined> {
    const [confirmation] = await db
      .select()
      .from(standbyConfirmationTokens)
      .where(eq(standbyConfirmationTokens.standbyAssignmentId, standbyAssignmentId));
    return confirmation;
  }

  async updateStandbyConfirmationToken(id: string, data: Partial<StandbyConfirmationToken>): Promise<StandbyConfirmationToken | undefined> {
    const [updated] = await db
      .update(standbyConfirmationTokens)
      .set(data)
      .where(eq(standbyConfirmationTokens.id, id))
      .returning();
    return updated;
  }

  // Standby Attendance History
  async createStandbyAttendanceHistory(data: InsertStandbyAttendanceHistory): Promise<StandbyAttendanceHistory> {
    const [created] = await db
      .insert(standbyAttendanceHistory)
      .values(data)
      .returning();
    return created;
  }

  async getStandbyAttendanceHistory(): Promise<Array<StandbyAttendanceHistory & { contestant: Contestant; recordDay: RecordDay }>> {
    const results = await getDb()
      .select({
        history: standbyAttendanceHistory,
        contestant: contestants,
        recordDay: recordDays,
      })
      .from(standbyAttendanceHistory)
      .innerJoin(contestants, eq(standbyAttendanceHistory.contestantId, contestants.id))
      .innerJoin(recordDays, eq(standbyAttendanceHistory.recordDayId, recordDays.id));
    
    return results.map(r => ({
      ...r.history,
      contestant: r.contestant,
      recordDay: r.recordDay,
    }));
  }

  async getStandbyAttendanceHistoryByRecordDay(recordDayId: string): Promise<Array<StandbyAttendanceHistory & { contestant: Contestant }>> {
    const results = await getDb()
      .select({
        history: standbyAttendanceHistory,
        contestant: contestants,
      })
      .from(standbyAttendanceHistory)
      .innerJoin(contestants, eq(standbyAttendanceHistory.contestantId, contestants.id))
      .where(eq(standbyAttendanceHistory.recordDayId, recordDayId));
    
    return results.map(r => ({
      ...r.history,
      contestant: r.contestant,
    }));
  }

  async getStandbyAttendanceHistoryByContestant(contestantId: string): Promise<Array<StandbyAttendanceHistory & { recordDay: RecordDay }>> {
    const results = await getDb()
      .select({
        history: standbyAttendanceHistory,
        recordDay: recordDays,
      })
      .from(standbyAttendanceHistory)
      .innerJoin(recordDays, eq(standbyAttendanceHistory.recordDayId, recordDays.id))
      .where(eq(standbyAttendanceHistory.contestantId, contestantId));
    
    return results.map(r => ({
      ...r.history,
      recordDay: r.recordDay,
    }));
  }

  async getReturningStandbys(): Promise<Array<Contestant & { attendanceHistory: StandbyAttendanceHistory[] }>> {
    const db = getDb();
    // Get all contestants with 'returning_standby' status
    const returningContestants = await db
      .select()
      .from(contestants)
      .where(eq(contestants.availabilityStatus, 'returning_standby'));
    
    // Get their attendance history
    const result = await Promise.all(
      returningContestants.map(async (contestant) => {
        const history = await db
          .select()
          .from(standbyAttendanceHistory)
          .where(eq(standbyAttendanceHistory.contestantId, contestant.id));
        return {
          ...contestant,
          attendanceHistory: history,
        };
      })
    );
    
    return result;
  }

  async deleteStandbyAttendanceHistory(id: string): Promise<void> {
    await getDb()
      .delete(standbyAttendanceHistory)
      .where(eq(standbyAttendanceHistory.id, id));
  }

  // System Configuration
  async getSystemConfig(key: string): Promise<string | null> {
    const [config] = await db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, key));
    return config?.value || null;
  }

  async setSystemConfig(key: string, value: string): Promise<void> {
    await db
      .insert(systemConfig)
      .values({ key, value })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value, updatedAt: new Date() }
      });
  }

  // Form Configurations
  async getFormConfigurations(formType: string): Promise<Record<string, string>> {
    const configs = await db
      .select()
      .from(formConfigurations)
      .where(eq(formConfigurations.formType, formType));
    
    const result: Record<string, string> = {};
    for (const config of configs) {
      result[config.fieldKey] = config.value;
    }
    return result;
  }

  async setFormConfiguration(formType: string, fieldKey: string, value: string): Promise<void> {
    await db
      .insert(formConfigurations)
      .values({ formType, fieldKey, value })
      .onConflictDoUpdate({
        target: [formConfigurations.formType, formConfigurations.fieldKey],
        set: { value, updatedAt: new Date() }
      });
  }

  async setFormConfigurations(formType: string, configs: Record<string, string>): Promise<void> {
    for (const [fieldKey, value] of Object.entries(configs)) {
      await this.setFormConfiguration(formType, fieldKey, value);
    }
  }

  // Users (Authentication)
  async createUser(user: InsertUser): Promise<User> {
    const [created] = await getDb().insert(users).values(user).returning();
    return created;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await getDb().select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await getDb().select().from(users).where(eq(users.id, id));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return getDb().select().from(users);
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<User | undefined> {
    const [updated] = await getDb()
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async updateUsername(id: string, newUsername: string): Promise<User | undefined> {
    const [updated] = await getDb()
      .update(users)
      .set({ username: newUsername })
      .where(eq(users.id, id))
      .returning();
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    await getDb().delete(users).where(eq(users.id, id));
  }

  // Rebooking History
  async logRebooking(data: InsertRebookingHistory): Promise<RebookingHistory> {
    const [created] = await getDb().insert(rebookingHistory).values(data).returning();
    return created;
  }

  async getAllRebookingHistory(): Promise<Array<RebookingHistory & { contestant: Contestant }>> {
    const db = getDb();
    const results = await db
      .select({
        history: rebookingHistory,
        contestant: contestants,
      })
      .from(rebookingHistory)
      .innerJoin(contestants, eq(rebookingHistory.contestantId, contestants.id))
      .orderBy(desc(rebookingHistory.rebookedAt));
    
    return results.map(r => ({
      ...r.history,
      contestant: r.contestant,
    }));
  }

  async getRebookingHistoryByContestant(contestantId: string): Promise<Array<RebookingHistory & { fromRecordDay: RecordDay; toRecordDay: RecordDay }>> {
    const fromRd = getDb()
      .select()
      .from(recordDays)
      .as('from_rd');
    const toRd = getDb()
      .select()
      .from(recordDays)
      .as('to_rd');
    
    const results = await getDb()
      .select({
        history: rebookingHistory,
        fromRecordDay: recordDays,
      })
      .from(rebookingHistory)
      .leftJoin(recordDays, eq(rebookingHistory.fromRecordDayId, recordDays.id))
      .where(eq(rebookingHistory.contestantId, contestantId));
    
    // Need to fetch toRecordDay separately and merge
    const enriched = await Promise.all(results.map(async (r) => {
      const [toRecordDay] = await getDb()
        .select()
        .from(recordDays)
        .where(eq(recordDays.id, r.history.toRecordDayId));
      return {
        ...r.history,
        fromRecordDay: r.fromRecordDay!,
        toRecordDay: toRecordDay,
      };
    }));
    
    return enriched;
  }

  async getRebookingHistoryByRecordDay(recordDayId: string): Promise<Array<RebookingHistory & { contestant: Contestant; fromRecordDay: RecordDay; toRecordDay: RecordDay }>> {
    // Get history where this record day was either the from or to
    const results = await getDb()
      .select({
        history: rebookingHistory,
        contestant: contestants,
        fromRecordDay: recordDays,
      })
      .from(rebookingHistory)
      .leftJoin(contestants, eq(rebookingHistory.contestantId, contestants.id))
      .leftJoin(recordDays, eq(rebookingHistory.fromRecordDayId, recordDays.id))
      .where(
        sql`${rebookingHistory.fromRecordDayId} = ${recordDayId} OR ${rebookingHistory.toRecordDayId} = ${recordDayId}`
      );
    
    // Fetch toRecordDay separately and merge
    const enriched = await Promise.all(results.map(async (r) => {
      const [toRecordDay] = await getDb()
        .select()
        .from(recordDays)
        .where(eq(recordDays.id, r.history.toRecordDayId));
      return {
        ...r.history,
        contestant: r.contestant!,
        fromRecordDay: r.fromRecordDay!,
        toRecordDay: toRecordDay,
      };
    }));
    
    return enriched;
  }

  // Atomic rebooking with transaction
  async atomicRebook(params: {
    oldAssignmentId: string;
    contestantId: string;
    newRecordDayId: string;
    blockNumber: number;
    seatLabel: string;
    reason?: string;
    rebookedBy: string;
  }): Promise<{ newAssignment: SeatAssignment; history: RebookingHistory }> {
    if (!pool) {
      throw new Error("Database pool not available");
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get the old assignment details within transaction with FOR UPDATE lock
      const oldAssignmentResult = await client.query(
        'SELECT * FROM seat_assignments WHERE id = $1 FOR UPDATE',
        [params.oldAssignmentId]
      );
      
      if (oldAssignmentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error("Old seat assignment not found");
      }
      
      const oldAssignment = oldAssignmentResult.rows[0];
      
      // Verify contestant matches
      if (oldAssignment.contestant_id !== params.contestantId) {
        await client.query('ROLLBACK');
        throw new Error("Contestant ID mismatch");
      }
      
      // Lock the target seat location using advisory lock to prevent concurrent insertions
      // We acquire an advisory lock on the hash of the target seat location
      const targetSeatHash = Math.abs(`${params.newRecordDayId}-${params.blockNumber}-${params.seatLabel}`.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0));
      await client.query('SELECT pg_advisory_xact_lock($1)', [targetSeatHash]);
      
      // Check if target seat is available (after lock acquired)
      const seatCheckResult = await client.query(
        'SELECT id FROM seat_assignments WHERE record_day_id = $1 AND block_number = $2 AND seat_label = $3 FOR UPDATE',
        [params.newRecordDayId, params.blockNumber, params.seatLabel]
      );
      
      if (seatCheckResult.rows.length > 0) {
        await client.query('ROLLBACK');
        throw new Error("Target seat is already occupied");
      }
      
      // Generate new UUID for the seat assignment
      const newIdResult = await client.query('SELECT gen_random_uuid() as id');
      const newId = newIdResult.rows[0].id;
      
      // Create new seat assignment - carry over paperwork status from old assignment
      // RESET invitation email (paperwork_sent) when rebooking to a new day
      const insertResult = await client.query(
        `INSERT INTO seat_assignments (id, record_day_id, contestant_id, block_number, seat_label, paperwork_sent, paperwork_sent_by, paperwork_received, paperwork_received_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING *`,
        [newId, params.newRecordDayId, params.contestantId, params.blockNumber, params.seatLabel, 
         null, null, 
         oldAssignment.paperwork_received, oldAssignment.paperwork_received_by]
      );
      
      const newAssignment = insertResult.rows[0];
      
      // Generate UUID for rebooking history
      const historyIdResult = await client.query('SELECT gen_random_uuid() as id');
      const historyId = historyIdResult.rows[0].id;
      
      // Log rebooking history
      const historyResult = await client.query(
        `INSERT INTO rebooking_history 
         (id, contestant_id, from_record_day_id, from_block_number, from_seat_label, 
          to_record_day_id, to_block_number, to_seat_label, reason, rebooked_by, rebooked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         RETURNING *`,
        [
          historyId,
          params.contestantId,
          oldAssignment.record_day_id,
          oldAssignment.block_number,
          oldAssignment.seat_label,
          params.newRecordDayId,
          params.blockNumber,
          params.seatLabel,
          params.reason || null,
          params.rebookedBy
        ]
      );
      
      const history = historyResult.rows[0];
      
      // Delete the old assignment
      await client.query(
        'DELETE FROM seat_assignments WHERE id = $1',
        [params.oldAssignmentId]
      );
      
      // Update contestant status
      await client.query(
        `UPDATE contestants SET availability_status = 'assigned' WHERE id = $1`,
        [params.contestantId]
      );
      
      await client.query('COMMIT');
      
      // Convert snake_case to camelCase for return
      return {
        newAssignment: {
          id: newAssignment.id,
          recordDayId: newAssignment.record_day_id,
          contestantId: newAssignment.contestant_id,
          blockNumber: newAssignment.block_number,
          seatLabel: newAssignment.seat_label,
          createdAt: newAssignment.created_at,
          notes: newAssignment.notes,
          originalBlockNumber: newAssignment.original_block_number,
          originalSeatLabel: newAssignment.original_seat_label,
          bookingEmailSent: newAssignment.booking_email_sent,
          ticketEmailSent: newAssignment.ticket_email_sent,
          confirmedRsvp: newAssignment.confirmed_rsvp,
          playerType: newAssignment.player_type,
          rxNumber: newAssignment.rx_number,
          rxEpNumber: newAssignment.rx_ep_number,
          caseNumber: newAssignment.case_number,
          winningMoneyRole: newAssignment.winning_money_role,
          winningMoneyAmount: newAssignment.winning_money_amount,
          caseAmount: newAssignment.case_amount,
          hnGiftcard: newAssignment.hn_giftcard,
          bankOfferTaken: newAssignment.bank_offer_taken,
          spinTheWheel: newAssignment.spin_the_wheel,
          prize: newAssignment.prize,
        },
        history: {
          id: history.id,
          contestantId: history.contestant_id,
          fromRecordDayId: history.from_record_day_id,
          fromBlockNumber: history.from_block_number,
          fromSeatLabel: history.from_seat_label,
          toRecordDayId: history.to_record_day_id,
          toBlockNumber: history.to_block_number,
          toSeatLabel: history.to_seat_label,
          reason: history.reason,
          rebookedBy: history.rebooked_by,
          rebookedAt: history.rebooked_at,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Attendance Issues (No-Shows and Early Leavers)
  async createAttendanceIssue(issue: InsertAttendanceIssue): Promise<AttendanceIssue> {
    return await getDb().transaction(async (tx) => {
      // First, get the seat assignment data to preserve history
      const [seatAssignment] = await tx
        .select()
        .from(seatAssignments)
        .where(
          and(
            eq(seatAssignments.contestantId, issue.contestantId),
            eq(seatAssignments.recordDayId, issue.recordDayId)
          )
        );
      
      // Create the attendance issue with historical data from seat assignment
      const issueData: any = {
        ...issue,
      };
      
      // If we have a seat assignment, preserve all its historical data
      if (seatAssignment) {
        issueData.originalSeatAssignmentId = seatAssignment.id;
        issueData.playerType = seatAssignment.playerType;
        issueData.firstNations = seatAssignment.firstNations;
        issueData.rating = seatAssignment.rating;
        issueData.location = seatAssignment.location;
        issueData.medicalQuestion = seatAssignment.medicalQuestion;
        issueData.criminalBankruptcy = seatAssignment.criminalBankruptcy;
        issueData.castingCategory = seatAssignment.castingCategory;
        issueData.assignmentNotes = seatAssignment.notes;
        issueData.bookingEmailSent = seatAssignment.bookingEmailSent;
        issueData.bookingEmailError = seatAssignment.bookingEmailError;
        issueData.confirmedRsvp = seatAssignment.confirmedRsvp;
        issueData.ticketEmailSent = seatAssignment.ticketEmailSent;
        issueData.emailsCopiedAt = seatAssignment.emailsCopiedAt;
        issueData.paperworkSent = seatAssignment.paperworkSent;
        issueData.paperworkSentBy = seatAssignment.paperworkSentBy;
        issueData.paperworkReceived = seatAssignment.paperworkReceived;
        issueData.paperworkReceivedBy = seatAssignment.paperworkReceivedBy;
        issueData.paperworkOnDay = seatAssignment.paperworkOnDay;
        issueData.signedIn = seatAssignment.signedIn;
        issueData.otdNotes = seatAssignment.otdNotes;
        issueData.standbyReplacementSwaps = seatAssignment.standbyReplacementSwaps;
        issueData.originalBlockNumber = seatAssignment.originalBlockNumber;
        issueData.originalSeatLabel = seatAssignment.originalSeatLabel;
        issueData.swappedAt = seatAssignment.swappedAt;
        // RX/TX tracking fields
        issueData.rxNumber = seatAssignment.rxNumber;
        issueData.rxEpNumber = seatAssignment.rxEpNumber;
        issueData.caseNumber = seatAssignment.caseNumber;
        issueData.winningMoneyRole = seatAssignment.winningMoneyRole;
        issueData.winningMoneyAmount = seatAssignment.winningMoneyAmount;
        issueData.winningMoneyText = seatAssignment.winningMoneyText;
        issueData.caseAmount = seatAssignment.caseAmount;
        issueData.hnGiftcard = seatAssignment.hnGiftcard;
        issueData.bankOfferTaken = seatAssignment.bankOfferTaken;
        issueData.spinTheWheel = seatAssignment.spinTheWheel;
        issueData.prize = seatAssignment.prize;
        issueData.txNumber = seatAssignment.txNumber;
        issueData.txDate = seatAssignment.txDate;
        issueData.notifiedOfTx = seatAssignment.notifiedOfTx;
        issueData.photosSent = seatAssignment.photosSent;
        // Override fields
        issueData.seatNotes = seatAssignment.seatNotes;
        issueData.attendingWithOverride = seatAssignment.attendingWithOverride;
        issueData.mobilityNotesOverride = seatAssignment.mobilityNotesOverride;
        issueData.castingCardUrl = seatAssignment.castingCardUrl;
        // Standby seating tracking
        issueData.seatedAsBlockType = seatAssignment.seatedAsBlockType;
        issueData.seatedFromStandby = seatAssignment.seatedFromStandby;
        issueData.standbyMovementNotes = seatAssignment.standbyMovementNotes;
        // Call tracking
        issueData.called = seatAssignment.called;
        issueData.calledAt = seatAssignment.calledAt;
      }
      
      const [created] = await tx.insert(attendanceIssues).values(issueData).returning();
      
      // Increment the appropriate counter on the contestant
      if (issue.issueType === 'no_show') {
        await tx
          .update(contestants)
          .set({ noShowCount: sql`COALESCE(${contestants.noShowCount}, 0) + 1` })
          .where(eq(contestants.id, issue.contestantId));
      } else if (issue.issueType === 'early_leaver') {
        await tx
          .update(contestants)
          .set({ earlyLeaverCount: sql`COALESCE(${contestants.earlyLeaverCount}, 0) + 1` })
          .where(eq(contestants.id, issue.contestantId));
      }
      
      // Delete the seat assignment to free up the seat
      if (seatAssignment) {
        // Nullify any post_record_tracking references to this seat assignment
        await tx
          .update(postRecordTracking)
          .set({ seatAssignmentId: null })
          .where(eq(postRecordTracking.seatAssignmentId, seatAssignment.id));
        
        await tx.delete(seatAssignments).where(eq(seatAssignments.id, seatAssignment.id));
      }
      
      return created;
    });
  }

  async createBulkNoShows(issues: Array<{ contestantId: string; recordDayId: string; blockNumber: number; seatLabel: string; notes?: string; markedBy?: string }>): Promise<{ success: boolean; count: number; issues: AttendanceIssue[] }> {
    return await getDb().transaction(async (tx) => {
      const createdIssues: AttendanceIssue[] = [];
      
      for (const issue of issues) {
        // First, get the seat assignment data to preserve history
        const [seatAssignment] = await tx
          .select()
          .from(seatAssignments)
          .where(
            and(
              eq(seatAssignments.contestantId, issue.contestantId),
              eq(seatAssignments.recordDayId, issue.recordDayId)
            )
          );
        
        // Create the attendance issue with historical data from seat assignment
        const issueData: any = {
          contestantId: issue.contestantId,
          recordDayId: issue.recordDayId,
          blockNumber: issue.blockNumber,
          seatLabel: issue.seatLabel,
          issueType: 'no_show',
          notes: issue.notes || 'Marked via Booking Master bulk action',
          markedBy: issue.markedBy || 'System',
        };
        
        // If we have a seat assignment, preserve all its historical data
        if (seatAssignment) {
          issueData.originalSeatAssignmentId = seatAssignment.id;
          issueData.playerType = seatAssignment.playerType;
          issueData.firstNations = seatAssignment.firstNations;
          issueData.rating = seatAssignment.rating;
          issueData.location = seatAssignment.location;
          issueData.medicalQuestion = seatAssignment.medicalQuestion;
          issueData.criminalBankruptcy = seatAssignment.criminalBankruptcy;
          issueData.castingCategory = seatAssignment.castingCategory;
          issueData.assignmentNotes = seatAssignment.notes;
          issueData.bookingEmailSent = seatAssignment.bookingEmailSent;
          issueData.bookingEmailError = seatAssignment.bookingEmailError;
          issueData.confirmedRsvp = seatAssignment.confirmedRsvp;
          issueData.ticketEmailSent = seatAssignment.ticketEmailSent;
          issueData.emailsCopiedAt = seatAssignment.emailsCopiedAt;
          issueData.paperworkSent = seatAssignment.paperworkSent;
          issueData.paperworkSentBy = seatAssignment.paperworkSentBy;
          issueData.paperworkReceived = seatAssignment.paperworkReceived;
          issueData.paperworkReceivedBy = seatAssignment.paperworkReceivedBy;
          issueData.paperworkOnDay = seatAssignment.paperworkOnDay;
          issueData.signedIn = seatAssignment.signedIn;
          issueData.otdNotes = seatAssignment.otdNotes;
          issueData.standbyReplacementSwaps = seatAssignment.standbyReplacementSwaps;
          issueData.originalBlockNumber = seatAssignment.originalBlockNumber;
          issueData.originalSeatLabel = seatAssignment.originalSeatLabel;
          issueData.swappedAt = seatAssignment.swappedAt;
          // RX/TX tracking fields
          issueData.rxNumber = seatAssignment.rxNumber;
          issueData.rxEpNumber = seatAssignment.rxEpNumber;
          issueData.caseNumber = seatAssignment.caseNumber;
          issueData.winningMoneyRole = seatAssignment.winningMoneyRole;
          issueData.winningMoneyAmount = seatAssignment.winningMoneyAmount;
          issueData.winningMoneyText = seatAssignment.winningMoneyText;
          issueData.caseAmount = seatAssignment.caseAmount;
          issueData.quickCash = seatAssignment.quickCash;
          issueData.bankOfferTaken = seatAssignment.bankOfferTaken;
          issueData.spinTheWheel = seatAssignment.spinTheWheel;
          issueData.prize = seatAssignment.prize;
          issueData.txNumber = seatAssignment.txNumber;
          issueData.txDate = seatAssignment.txDate;
          issueData.notifiedOfTx = seatAssignment.notifiedOfTx;
          issueData.photosSent = seatAssignment.photosSent;
          // Override fields
          issueData.seatNotes = seatAssignment.seatNotes;
          issueData.attendingWithOverride = seatAssignment.attendingWithOverride;
          issueData.mobilityNotesOverride = seatAssignment.mobilityNotesOverride;
          issueData.castingCardUrl = seatAssignment.castingCardUrl;
          // Standby seating tracking
          issueData.seatedAsBlockType = seatAssignment.seatedAsBlockType;
          issueData.seatedFromStandby = seatAssignment.seatedFromStandby;
          issueData.standbyMovementNotes = seatAssignment.standbyMovementNotes;
          // Call tracking
          issueData.called = seatAssignment.called;
          issueData.calledAt = seatAssignment.calledAt;
        }
        
        const [created] = await tx.insert(attendanceIssues).values(issueData).returning();
        
        createdIssues.push(created);
        
        // Increment no-show counter on contestant
        await tx
          .update(contestants)
          .set({ noShowCount: sql`COALESCE(${contestants.noShowCount}, 0) + 1` })
          .where(eq(contestants.id, issue.contestantId));
        
        if (seatAssignment) {
          // Nullify any post_record_tracking references to this seat assignment
          await tx
            .update(postRecordTracking)
            .set({ seatAssignmentId: null })
            .where(eq(postRecordTracking.seatAssignmentId, seatAssignment.id));
          
          // Delete the seat assignment to free up the seat
          await tx.delete(seatAssignments).where(eq(seatAssignments.id, seatAssignment.id));
        }
      }
      
      return { success: true, count: createdIssues.length, issues: createdIssues };
    });
  }

  async restoreAttendanceIssue(id: string): Promise<{ attendanceIssue: AttendanceIssue; seatAssignment: SeatAssignment }> {
    return await getDb().transaction(async (tx) => {
      // 1. Get the attendance issue
      const [issue] = await tx
        .select()
        .from(attendanceIssues)
        .where(eq(attendanceIssues.id, id));

      if (!issue) {
        throw new Error("Attendance issue not found");
      }

      if (issue.movedToReschedule) {
        throw new Error("Cannot restore an issue that has already been moved to reschedule");
      }

      // 2. Check if the seat is still available
      const [existing] = await tx
        .select()
        .from(seatAssignments)
        .where(
          and(
            eq(seatAssignments.recordDayId, issue.recordDayId),
            eq(seatAssignments.blockNumber, issue.blockNumber),
            eq(seatAssignments.seatLabel, issue.seatLabel)
          )
        );

      if (existing) {
        throw new Error(`Seat (Block ${issue.blockNumber}, Seat ${issue.seatLabel}) is already occupied`);
      }

      // 3. Create the seat assignment back with ALL preserved historical data
      const [assignment] = await tx
        .insert(seatAssignments)
        .values({
          contestantId: issue.contestantId,
          recordDayId: issue.recordDayId,
          blockNumber: issue.blockNumber,
          seatLabel: issue.seatLabel,
          status: 'confirmed',
          // Restore all historical data from attendance issue
          playerType: issue.playerType,
          firstNations: issue.firstNations,
          rating: issue.rating,
          location: issue.location,
          medicalQuestion: issue.medicalQuestion,
          criminalBankruptcy: issue.criminalBankruptcy,
          castingCategory: issue.castingCategory,
          notes: issue.assignmentNotes,
          // Booking workflow fields
          bookingEmailSent: issue.bookingEmailSent,
          bookingEmailError: issue.bookingEmailError,
          confirmedRsvp: issue.confirmedRsvp,
          ticketEmailSent: issue.ticketEmailSent,
          emailsCopiedAt: issue.emailsCopiedAt,
          // Paperwork tracking
          paperworkSent: issue.paperworkSent,
          paperworkSentBy: issue.paperworkSentBy,
          paperworkReceived: issue.paperworkReceived,
          paperworkReceivedBy: issue.paperworkReceivedBy,
          paperworkOnDay: issue.paperworkOnDay,
          // Sign-in and OTD
          signedIn: issue.signedIn,
          otdNotes: issue.otdNotes,
          standbyReplacementSwaps: issue.standbyReplacementSwaps,
          // Original position tracking
          originalBlockNumber: issue.originalBlockNumber,
          originalSeatLabel: issue.originalSeatLabel,
          swappedAt: issue.swappedAt,
          // RX/TX tracking fields
          rxNumber: issue.rxNumber,
          rxEpNumber: issue.rxEpNumber,
          caseNumber: issue.caseNumber,
          winningMoneyRole: issue.winningMoneyRole,
          winningMoneyAmount: issue.winningMoneyAmount,
          winningMoneyText: issue.winningMoneyText,
          caseAmount: issue.caseAmount,
          hnGiftcard: issue.hnGiftcard,
          bankOfferTaken: issue.bankOfferTaken,
          spinTheWheel: issue.spinTheWheel,
          prize: issue.prize,
          txNumber: issue.txNumber,
          txDate: issue.txDate,
          notifiedOfTx: issue.notifiedOfTx,
          photosSent: issue.photosSent,
          // Override fields
          seatNotes: issue.seatNotes,
          attendingWithOverride: issue.attendingWithOverride,
          mobilityNotesOverride: issue.mobilityNotesOverride,
          castingCardUrl: issue.castingCardUrl,
          // Standby seating tracking
          seatedAsBlockType: issue.seatedAsBlockType,
          seatedFromStandby: issue.seatedFromStandby,
          standbyMovementNotes: issue.standbyMovementNotes,
          // Call tracking
          called: issue.called,
          calledAt: issue.calledAt,
        })
        .returning();

      // 4. Decrement the appropriate counter on the contestant
      if (issue.issueType === 'no_show') {
        await tx
          .update(contestants)
          .set({ noShowCount: sql`GREATEST(COALESCE(${contestants.noShowCount}, 0) - 1, 0)` })
          .where(eq(contestants.id, issue.contestantId));
      } else if (issue.issueType === 'early_leaver') {
        await tx
          .update(contestants)
          .set({ earlyLeaverCount: sql`GREATEST(COALESCE(${contestants.earlyLeaverCount}, 0) - 1, 0)` })
          .where(eq(contestants.id, issue.contestantId));
      }

      // 5. Delete the attendance issue record
      await tx
        .delete(attendanceIssues)
        .where(eq(attendanceIssues.id, id));

      // 6. Log movement
      await tx.insert(movementHistory).values({
        contestantId: issue.contestantId,
        movementType: 'removed_from_reschedule',
        fromBlockNumber: issue.blockNumber,
        fromSeatLabel: issue.seatLabel,
        toBlockNumber: issue.blockNumber,
        toSeatLabel: issue.seatLabel,
        recordDayId: issue.recordDayId,
        notes: `Restored to original seat from ${issue.issueType.replace('_', ' ')}`,
        movedBy: 'System',
      });

      return { attendanceIssue: issue, seatAssignment: assignment };
    });
  }

  async getAttendanceIssues(): Promise<Array<AttendanceIssue & { contestant: Contestant; recordDay: RecordDay }>> {
    const results = await getDb()
      .select({
        issue: attendanceIssues,
        contestant: contestants,
        recordDay: recordDays,
      })
      .from(attendanceIssues)
      .leftJoin(contestants, eq(attendanceIssues.contestantId, contestants.id))
      .leftJoin(recordDays, eq(attendanceIssues.recordDayId, recordDays.id))
      .orderBy(sql`${attendanceIssues.createdAt} DESC`);

    return results.map(r => ({
      ...r.issue,
      contestant: r.contestant!,
      recordDay: r.recordDay!,
    }));
  }

  async getAttendanceIssuesByRecordDay(recordDayId: string): Promise<Array<AttendanceIssue & { contestant: Contestant }>> {
    const results = await getDb()
      .select({
        issue: attendanceIssues,
        contestant: contestants,
      })
      .from(attendanceIssues)
      .leftJoin(contestants, eq(attendanceIssues.contestantId, contestants.id))
      .where(eq(attendanceIssues.recordDayId, recordDayId))
      .orderBy(sql`${attendanceIssues.createdAt} DESC`);

    return results.map(r => ({
      ...r.issue,
      contestant: r.contestant!,
    }));
  }

  async deleteAttendanceIssue(id: string): Promise<void> {
    // First get the issue to know which counter to decrement
    const [issue] = await getDb()
      .select()
      .from(attendanceIssues)
      .where(eq(attendanceIssues.id, id));
    
    if (!issue) return;
    
    await getDb().transaction(async (tx) => {
      // Decrement the appropriate counter on the contestant
      if (issue.issueType === 'no_show') {
        await tx
          .update(contestants)
          .set({ noShowCount: sql`GREATEST(COALESCE(${contestants.noShowCount}, 0) - 1, 0)` })
          .where(eq(contestants.id, issue.contestantId));
      } else if (issue.issueType === 'early_leaver') {
        await tx
          .update(contestants)
          .set({ earlyLeaverCount: sql`GREATEST(COALESCE(${contestants.earlyLeaverCount}, 0) - 1, 0)` })
          .where(eq(contestants.id, issue.contestantId));
      }
      
      // Delete the attendance issue
      await tx.delete(attendanceIssues).where(eq(attendanceIssues.id, id));
    });
  }

  async moveAttendanceIssueToReschedule(id: string, options?: { movedBy?: string; reason?: string }): Promise<{ attendanceIssue: AttendanceIssue; canceledAssignment: CanceledAssignment }> {
    // Get the attendance issue
    const [issue] = await getDb()
      .select()
      .from(attendanceIssues)
      .where(eq(attendanceIssues.id, id));
    
    if (!issue) {
      throw new Error("Attendance issue not found");
    }
    
    if (issue.movedToReschedule) {
      throw new Error("This attendance issue has already been moved to reschedule");
    }
    
    // Use provided values or defaults
    const defaultReason = issue.issueType === 'no_show' ? 'No-show - eligible for reschedule' : 'Early leaver - eligible for reschedule';
    const reason = options?.reason || defaultReason;
    const movedBy = options?.movedBy || issue.markedBy;
    
    return await getDb().transaction(async (tx) => {
      // Create a canceled assignment for the reschedule list
      const [canceledAssignment] = await tx
        .insert(canceledAssignments)
        .values({
          contestantId: issue.contestantId,
          recordDayId: issue.recordDayId,
          blockNumber: issue.blockNumber,
          seatLabel: issue.seatLabel,
          reason,
          movedBy,
        })
        .returning();
      
      // Update the attendance issue to mark it as moved to reschedule
      const [updatedIssue] = await tx
        .update(attendanceIssues)
        .set({
          movedToReschedule: true,
          movedToRescheduleAt: new Date(),
        })
        .where(eq(attendanceIssues.id, id))
        .returning();
      
      // Update contestant status to 'rescheduled'
      await tx
        .update(contestants)
        .set({ availabilityStatus: 'rescheduled' })
        .where(eq(contestants.id, issue.contestantId));

      // Log movement history
      await tx.insert(movementHistory).values({
        contestantId: issue.contestantId,
        movementType: 'added_to_reschedule',
        fromBlockNumber: issue.blockNumber,
        fromSeatLabel: issue.seatLabel,
        recordDayId: issue.recordDayId,
        notes: `Moved to reschedule from attendance issue: ${reason}`,
        movedBy: movedBy || 'System',
      });
      
      return {
        attendanceIssue: updatedIssue,
        canceledAssignment: canceledAssignment,
      };
    });
  }

  // Movement History
  async logMovement(data: InsertMovementHistory): Promise<MovementHistory> {
    const [created] = await db
      .insert(movementHistory)
      .values(data)
      .returning();
    return created;
  }

  async getMovementHistory(): Promise<Array<MovementHistory & { contestant: Contestant; recordDay?: RecordDay }>> {
    const results = await getDb()
      .select({
        movementHistory: movementHistory,
        contestant: contestants,
        recordDay: recordDays,
      })
      .from(movementHistory)
      .innerJoin(contestants, eq(movementHistory.contestantId, contestants.id))
      .leftJoin(recordDays, eq(movementHistory.recordDayId, recordDays.id))
      .orderBy(desc(movementHistory.createdAt));
    
    return results.map(r => ({
      ...r.movementHistory,
      contestant: r.contestant,
      recordDay: r.recordDay || undefined,
    }));
  }

  async getMovementHistoryByRecordDay(recordDayId: string): Promise<Array<MovementHistory & { contestant: Contestant }>> {
    const results = await getDb()
      .select({
        movementHistory: movementHistory,
        contestant: contestants,
      })
      .from(movementHistory)
      .innerJoin(contestants, eq(movementHistory.contestantId, contestants.id))
      .where(eq(movementHistory.recordDayId, recordDayId))
      .orderBy(desc(movementHistory.createdAt));
    
    return results.map(r => ({
      ...r.movementHistory,
      contestant: r.contestant,
    }));
  }

  async getMovementHistoryByContestant(contestantId: string): Promise<Array<MovementHistory & { recordDay?: RecordDay }>> {
    const results = await getDb()
      .select({
        movementHistory: movementHistory,
        recordDay: recordDays,
      })
      .from(movementHistory)
      .leftJoin(recordDays, eq(movementHistory.recordDayId, recordDays.id))
      .where(eq(movementHistory.contestantId, contestantId))
      .orderBy(desc(movementHistory.createdAt));
    
    return results.map(r => ({
      ...r.movementHistory,
      recordDay: r.recordDay || undefined,
    }));
  }

  // Prize Winners
  async addPrizeWinner(data: InsertPrizeWinner): Promise<PrizeWinner> {
    const [created] = await db
      .insert(prizeWinners)
      .values(data)
      .onConflictDoNothing() // Don't error if already added
      .returning();
    // If already exists, fetch and return it
    if (!created) {
      const [existing] = await db
        .select()
        .from(prizeWinners)
        .where(and(
          eq(prizeWinners.recordDayId, data.recordDayId),
          eq(prizeWinners.contestantId, data.contestantId)
        ));
      return existing;
    }
    return created;
  }

  async getPrizeWinnersByRecordDay(recordDayId: string): Promise<PrizeWinner[]> {
    return db
      .select()
      .from(prizeWinners)
      .where(eq(prizeWinners.recordDayId, recordDayId));
  }

  async updatePrizeWinner(id: string, data: { hasPresent?: boolean; hasBriefcase?: boolean }): Promise<PrizeWinner | null> {
    const updateData: any = {};
    if (typeof data.hasPresent === 'boolean') updateData.hasPresent = data.hasPresent;
    if (typeof data.hasBriefcase === 'boolean') updateData.hasBriefcase = data.hasBriefcase;
    
    const [updated] = await db
      .update(prizeWinners)
      .set(updateData)
      .where(eq(prizeWinners.id, id))
      .returning();
    return updated || null;
  }

  async removePrizeWinner(id: string): Promise<void> {
    await getDb().delete(prizeWinners).where(eq(prizeWinners.id, id));
  }

  async removePrizeWinnerByContestant(recordDayId: string, contestantId: string): Promise<void> {
    await db
      .delete(prizeWinners)
      .where(and(
        eq(prizeWinners.recordDayId, recordDayId),
        eq(prizeWinners.contestantId, contestantId)
      ));
  }

  // Noticeboard Posts
  async createNoticeboardPost(post: InsertNoticeboardPost): Promise<NoticeboardPost> {
    const db = getDb();
    const [created] = await db
      .insert(noticeboardPosts)
      .values(post)
      .returning();
    return created;
  }

  async getNoticeboardPosts(): Promise<Array<NoticeboardPost & { likeCount: number; commentCount: number }>> {
    const db = getDb();
    const posts = await db
      .select()
      .from(noticeboardPosts)
      .orderBy(sql`${noticeboardPosts.isPinned} DESC, ${noticeboardPosts.createdAt} DESC`);
    
    // Get like counts for all posts
    const likeCounts = await db
      .select({
        postId: noticeboardLikes.postId,
        count: sql<number>`count(*)::int`,
      })
      .from(noticeboardLikes)
      .groupBy(noticeboardLikes.postId);
    
    // Get comment counts for all posts
    const commentCounts = await db
      .select({
        postId: noticeboardComments.postId,
        count: sql<number>`count(*)::int`,
      })
      .from(noticeboardComments)
      .groupBy(noticeboardComments.postId);
    
    const likeMap = new Map(likeCounts.map(l => [l.postId, l.count]));
    const commentMap = new Map(commentCounts.map(c => [c.postId, c.count]));
    
    return posts.map(post => ({
      ...post,
      likeCount: likeMap.get(post.id) || 0,
      commentCount: commentMap.get(post.id) || 0,
    }));
  }

  async getNoticeboardPostById(id: string): Promise<NoticeboardPost | undefined> {
    const db = getDb();
    const [post] = await db
      .select()
      .from(noticeboardPosts)
      .where(eq(noticeboardPosts.id, id));
    return post;
  }

  async updateNoticeboardPost(id: string, data: Partial<NoticeboardPost>): Promise<NoticeboardPost | undefined> {
    const db = getDb();
    const [updated] = await db
      .update(noticeboardPosts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(noticeboardPosts.id, id))
      .returning();
    return updated;
  }

  async deleteNoticeboardPost(id: string): Promise<void> {
    const db = getDb();
    await getDb().delete(noticeboardPosts).where(eq(noticeboardPosts.id, id));
  }

  async togglePinPost(id: string): Promise<NoticeboardPost | undefined> {
    const db = getDb();
    const post = await this.getNoticeboardPostById(id);
    if (!post) return undefined;
    
    const [updated] = await db
      .update(noticeboardPosts)
      .set({ isPinned: !post.isPinned, updatedAt: new Date() })
      .where(eq(noticeboardPosts.id, id))
      .returning();
    return updated;
  }

  // Noticeboard Comments
  async createNoticeboardComment(comment: InsertNoticeboardComment): Promise<NoticeboardComment> {
    const db = getDb();
    const [created] = await db
      .insert(noticeboardComments)
      .values(comment)
      .returning();
    return created;
  }

  async getCommentsByPost(postId: string): Promise<NoticeboardComment[]> {
    const db = getDb();
    return db
      .select()
      .from(noticeboardComments)
      .where(eq(noticeboardComments.postId, postId))
      .orderBy(noticeboardComments.createdAt);
  }

  async deleteNoticeboardComment(id: string): Promise<void> {
    const db = getDb();
    await getDb().delete(noticeboardComments).where(eq(noticeboardComments.id, id));
  }

  // Noticeboard Likes
  async toggleLike(postId: string, browserId: string): Promise<{ liked: boolean; likeCount: number }> {
    const db = getDb();
    // Check if already liked by this browser
    const [existing] = await db
      .select()
      .from(noticeboardLikes)
      .where(and(
        eq(noticeboardLikes.postId, postId),
        eq(noticeboardLikes.browserId, browserId)
      ));
    
    if (existing) {
      // Unlike
      await getDb().delete(noticeboardLikes).where(eq(noticeboardLikes.id, existing.id));
    } else {
      // Like
      await getDb().insert(noticeboardLikes).values({ postId, browserId });
    }
    
    // Get new like count
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(noticeboardLikes)
      .where(eq(noticeboardLikes.postId, postId));
    
    return {
      liked: !existing,
      likeCount: result?.count || 0,
    };
  }

  async getLikesByPost(postId: string): Promise<NoticeboardLike[]> {
    const db = getDb();
    return db
      .select()
      .from(noticeboardLikes)
      .where(eq(noticeboardLikes.postId, postId));
  }

  async hasBrowserLikedPost(postId: string, browserId: string): Promise<boolean> {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(noticeboardLikes)
      .where(and(
        eq(noticeboardLikes.postId, postId),
        eq(noticeboardLikes.browserId, browserId)
      ));
    return !!existing;
  }

  // Post-Record Tracking
  async getPostRecordEntries(recordDayId?: string): Promise<PostRecordTracking[]> {
    const db = getDb();
    if (recordDayId) {
      return db
        .select()
        .from(postRecordTracking)
        .where(eq(postRecordTracking.recordDayId, recordDayId))
        .orderBy(postRecordTracking.createdAt);
    }
    return db
      .select()
      .from(postRecordTracking)
      .orderBy(postRecordTracking.createdAt);
  }

  async getPostRecordEntriesWithDetails(recordDayId?: string): Promise<Array<PostRecordTracking & { contestant: Contestant | null; recordDay: RecordDay | null; seatAssignment: SeatAssignment | null }>> {
    const db = getDb();
    
    // Get all entries
    const entries = recordDayId 
      ? await getDb().select().from(postRecordTracking).where(eq(postRecordTracking.recordDayId, recordDayId)).orderBy(postRecordTracking.createdAt)
      : await getDb().select().from(postRecordTracking).orderBy(postRecordTracking.createdAt);
    
    if (entries.length === 0) return [];
    
    // Batch fetch contestants
    const contestantIds = Array.from(new Set(entries.map(e => e.contestantId).filter(Boolean)));
    const contestantsData = contestantIds.length > 0 
      ? await getDb().select().from(contestants).where(inArray(contestants.id, contestantIds))
      : [];
    const contestantMap = new Map(contestantsData.map(c => [c.id, c]));
    
    // Batch fetch record days
    const recordDayIds = Array.from(new Set(entries.map(e => e.recordDayId).filter((id): id is string => !!id)));
    const recordDaysData = recordDayIds.length > 0 
      ? await getDb().select().from(recordDays).where(inArray(recordDays.id, recordDayIds))
      : [];
    const recordDayMap = new Map(recordDaysData.map(rd => [rd.id, rd]));
    
    // Batch fetch seat assignments
    const seatAssignmentIds = Array.from(new Set(entries.map(e => e.seatAssignmentId).filter((id): id is string => !!id)));
    const seatAssignmentsData = seatAssignmentIds.length > 0 
      ? await getDb().select().from(seatAssignments).where(inArray(seatAssignments.id, seatAssignmentIds))
      : [];
    const seatAssignmentMap = new Map(seatAssignmentsData.map(sa => [sa.id, sa]));
    
    // Combine data
    return entries.map(entry => ({
      ...entry,
      contestant: contestantMap.get(entry.contestantId) || null,
      recordDay: entry.recordDayId ? recordDayMap.get(entry.recordDayId) || null : null,
      seatAssignment: entry.seatAssignmentId ? seatAssignmentMap.get(entry.seatAssignmentId) || null : null,
    }));
  }

  async getPostRecordEntryById(id: string): Promise<PostRecordTracking | undefined> {
    const db = getDb();
    const [entry] = await db
      .select()
      .from(postRecordTracking)
      .where(eq(postRecordTracking.id, id));
    return entry;
  }

  async getPostRecordEntryByContestant(contestantId: string, recordDayId?: string): Promise<PostRecordTracking | undefined> {
    const db = getDb();
    if (recordDayId) {
      const [entry] = await db
        .select()
        .from(postRecordTracking)
        .where(and(
          eq(postRecordTracking.contestantId, contestantId),
          eq(postRecordTracking.recordDayId, recordDayId)
        ));
      return entry;
    }
    const [entry] = await db
      .select()
      .from(postRecordTracking)
      .where(eq(postRecordTracking.contestantId, contestantId));
    return entry;
  }

  async createPostRecordEntry(data: InsertPostRecordTracking): Promise<PostRecordTracking> {
    const db = getDb();
    const [created] = await db
      .insert(postRecordTracking)
      .values(data)
      .returning();
    return created;
  }

  async updatePostRecordEntry(id: string, data: Partial<InsertPostRecordTracking>): Promise<PostRecordTracking | undefined> {
    const db = getDb();
    const [updated] = await db
      .update(postRecordTracking)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(postRecordTracking.id, id))
      .returning();
    return updated;
  }

  async deletePostRecordEntry(id: string): Promise<void> {
    const db = getDb();
    await getDb().delete(postRecordTracking).where(eq(postRecordTracking.id, id));
  }

  // Casting Cards methods
  async getCastingCards(): Promise<CastingCard[]> {
    const db = getDb();
    return getDb().select().from(castingCards);
  }

  async getCastingCardByContestantId(contestantId: string): Promise<CastingCard | undefined> {
    const db = getDb();
    const [card] = await db
      .select()
      .from(castingCards)
      .where(eq(castingCards.contestantId, contestantId));
    return card;
  }

  // System Settings
  async getSystemSetting(key: string): Promise<SystemSetting | undefined> {
    const db = getDb();
    const [setting] = await getDb().select().from(systemSettings).where(eq(systemSettings.key, key));
    return setting;
  }

  async setSystemSetting(key: string, value: string): Promise<SystemSetting> {
    const db = getDb();
    const [updated] = await db
      .insert(systemSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date() }
      })
      .returning();
    return updated;
  }

  async createCastingCard(data: InsertCastingCard): Promise<CastingCard> {
    const db = getDb();
    const [created] = await db
      .insert(castingCards)
      .values(data)
      .returning();
    return created;
  }

  async updateCastingCard(contestantId: string, data: Partial<InsertCastingCard>): Promise<CastingCard | undefined> {
    const db = getDb();
    const [updated] = await db
      .update(castingCards)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(castingCards.contestantId, contestantId))
      .returning();
    return updated;
  }

  async upsertCastingCard(data: InsertCastingCard): Promise<CastingCard> {
    const db = getDb();
    const existing = await this.getCastingCardByContestantId(data.contestantId);
    if (existing) {
      const [updated] = await db
        .update(castingCards)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(castingCards.contestantId, data.contestantId))
        .returning();
      return updated;
    } else {
      return this.createCastingCard(data);
    }
  }

  async deleteCastingCard(contestantId: string): Promise<void> {
    const db = getDb();
    await getDb().delete(castingCards).where(eq(castingCards.contestantId, contestantId));
  }

  async deleteAllCastingCards(): Promise<void> {
    const db = getDb();
    await getDb().delete(castingCards);
  }

  // Casting Card Version History methods
  async getCastingCardVersions(castingCardId: string): Promise<CastingCardVersion[]> {
    const db = getDb();
    return db
      .select()
      .from(castingCardVersions)
      .where(eq(castingCardVersions.castingCardId, castingCardId))
      .orderBy(desc(castingCardVersions.createdAt));
  }

  async getLatestCastingCardVersion(castingCardId: string): Promise<CastingCardVersion | undefined> {
    const db = getDb();
    const [latest] = await db
      .select()
      .from(castingCardVersions)
      .where(eq(castingCardVersions.castingCardId, castingCardId))
      .orderBy(desc(castingCardVersions.createdAt))
      .limit(1);
    return latest;
  }

  async createCastingCardVersion(data: InsertCastingCardVersion): Promise<CastingCardVersion> {
    const db = getDb();
    const [created] = await db
      .insert(castingCardVersions)
      .values(data)
      .returning();
    return created;
  }

  async deleteCastingCardVersion(id: string): Promise<void> {
    const db = getDb();
    await getDb().delete(castingCardVersions).where(eq(castingCardVersions.id, id));
  }

  // Birthday Entries methods
  async getBirthdayEntries(): Promise<BirthdayEntry[]> {
    const db = getDb();
    return getDb().select().from(birthdayEntries);
  }

  async createBirthdayEntry(entry: InsertBirthdayEntry): Promise<BirthdayEntry> {
    const db = getDb();
    const [created] = await getDb().insert(birthdayEntries).values(entry).returning();
    return created;
  }

  async updateBirthdayEntry(id: string, data: Partial<BirthdayEntry>): Promise<BirthdayEntry | undefined> {
    const db = getDb();
    const [updated] = await db
      .update(birthdayEntries)
      .set(data)
      .where(eq(birthdayEntries.id, id))
      .returning();
    return updated;
  }

  async deleteBirthdayEntry(id: string): Promise<void> {
    const db = getDb();
    await getDb().delete(birthdayEntries).where(eq(birthdayEntries.id, id));
  }

  async getTodayBirthdays(): Promise<BirthdayEntry[]> {
    const db = getDb();
    // Get today's month and day, compare with birthdate's month and day
    const today = new Date();
    const month = today.getMonth() + 1; // JavaScript months are 0-indexed
    const day = today.getDate();
    
    // Query all entries and filter in JS for date matching (simpler than complex SQL date extraction)
    const allEntries = await getDb().select().from(birthdayEntries);
    return allEntries.filter(entry => {
      const birthDate = new Date(entry.birthdate);
      return birthDate.getMonth() + 1 === month && birthDate.getDate() === day;
    });
  }

  // Block Notes methods
  async getBlockNotes(recordDayId: string): Promise<BlockNote[]> {
    const db = getDb();
    return await getDb().select().from(blockNotes).where(eq(blockNotes.recordDayId, recordDayId));
  }

  async upsertBlockNote(recordDayId: string, blockNumber: number, notes: string): Promise<BlockNote> {
    const db = getDb();
    // Check if note already exists
    const existing = await getDb().select().from(blockNotes)
      .where(and(
        eq(blockNotes.recordDayId, recordDayId),
        eq(blockNotes.blockNumber, blockNumber)
      ));
    
    if (existing.length > 0) {
      // Update existing
      const [updated] = await getDb().update(blockNotes)
        .set({ notes, updatedAt: new Date() })
        .where(eq(blockNotes.id, existing[0].id))
        .returning();
      return updated;
    } else {
      // Create new
      const [created] = await getDb().insert(blockNotes)
        .values({ recordDayId, blockNumber, notes })
        .returning();
      return created;
    }
  }

  async getRxPlanningData(recordDayId: string): Promise<RxPlanningEntry[]> {
    const db = getDb();
    return await getDb().select().from(rxPlanningEntries).where(eq(rxPlanningEntries.recordDayId, recordDayId));
  }

  async getAllRxPlanningData(): Promise<RxPlanningEntry[]> {
    const db = getDb();
    return await getDb().select().from(rxPlanningEntries);
  }

  async saveRxPlanningBlock(recordDayId: string, blockNumber: number, contestantData: string): Promise<RxPlanningEntry> {
    const db = getDb();
    const existing = await getDb().select().from(rxPlanningEntries)
      .where(and(eq(rxPlanningEntries.recordDayId, recordDayId), eq(rxPlanningEntries.blockNumber, blockNumber)));
    if (existing.length > 0) {
      const [updated] = await getDb().update(rxPlanningEntries)
        .set({ contestantData, updatedAt: new Date() })
        .where(eq(rxPlanningEntries.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [created] = await getDb().insert(rxPlanningEntries)
        .values({ recordDayId, blockNumber, contestantData })
        .returning();
      return created;
    }
  }

  async deleteRxPlanningBlock(recordDayId: string, blockNumber: number): Promise<void> {
    const db = getDb();
    await getDb().delete(rxPlanningEntries)
      .where(and(eq(rxPlanningEntries.recordDayId, recordDayId), eq(rxPlanningEntries.blockNumber, blockNumber)));
  }

  async clearRxPlanningDay(recordDayId: string): Promise<void> {
    const db = getDb();
    await getDb().delete(rxPlanningEntries).where(eq(rxPlanningEntries.recordDayId, recordDayId));
  }
}

export const storage = new DbStorage();
export { db, pool };
