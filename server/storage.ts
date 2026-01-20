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
  noticeboardPosts,
  noticeboardComments,
  noticeboardLikes,
  postRecordTracking,
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
  type NoticeboardPost,
  type InsertNoticeboardPost,
  type NoticeboardComment,
  type InsertNoticeboardComment,
  type NoticeboardLike,
  type InsertNoticeboardLike,
  type PostRecordTracking,
  type InsertPostRecordTracking,
} from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

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
  updateCanceledAssignment(id: string, data: Partial<CanceledAssignment>): Promise<CanceledAssignment | undefined>;
  
  // Canceled Assignments
  getCanceledAssignments(): Promise<Array<CanceledAssignment & { contestant: Contestant; recordDay: RecordDay }>>;
  createCanceledAssignment(data: Partial<InsertCanceledAssignment> & { contestantId: string; recordDayId: string }): Promise<CanceledAssignment>;
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
  
  // Rebooking History
  logRebooking(data: InsertRebookingHistory): Promise<RebookingHistory>;
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
  getAttendanceIssues(): Promise<Array<AttendanceIssue & { contestant: Contestant; recordDay: RecordDay }>>;
  getAttendanceIssuesByRecordDay(recordDayId: string): Promise<Array<AttendanceIssue & { contestant: Contestant }>>;
  deleteAttendanceIssue(id: string): Promise<void>;
  moveAttendanceIssueToReschedule(id: string, options?: { movedBy?: string; reason?: string }): Promise<{ attendanceIssue: AttendanceIssue; canceledAssignment: CanceledAssignment }>;
  
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
    const [created] = await db.insert(contestants).values(contestant).returning();
    return created;
  }

  async getContestants(): Promise<Contestant[]> {
    return db.select().from(contestants);
  }

  async getContestantById(id: string): Promise<Contestant | undefined> {
    const [contestant] = await db.select().from(contestants).where(eq(contestants.id, id));
    return contestant;
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
    await db.delete(contestants).where(eq(contestants.id, id));
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
    const [created] = await db.insert(groups).values(group).returning();
    return created;
  }

  async getGroups(): Promise<Group[]> {
    return db.select().from(groups);
  }

  async getGroupById(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  // Record Days
  async createRecordDay(recordDay: InsertRecordDay): Promise<RecordDay> {
    const [created] = await db.insert(recordDays).values(recordDay).returning();
    return created;
  }

  async getRecordDays(): Promise<RecordDay[]> {
    return db.select().from(recordDays);
  }

  async getRecordDayById(id: string): Promise<RecordDay | undefined> {
    const [recordDay] = await db.select().from(recordDays).where(eq(recordDays.id, id));
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
    await db.delete(blockTypes).where(eq(blockTypes.recordDayId, id));
    await db.delete(contestantAvailability).where(eq(contestantAvailability.recordDayId, id));
    await db.delete(canceledAssignments).where(eq(canceledAssignments.recordDayId, id));
    
    // Now delete the record day
    await db.delete(recordDays).where(eq(recordDays.id, id));
    
    return { success: true };
  }

  // Seat Assignments
  async createSeatAssignment(assignment: InsertSeatAssignment): Promise<SeatAssignment> {
    // Use transaction to atomically create assignment and update contestant status
    try {
      return await db.transaction(async (tx) => {
        // Create the seat assignment
        const [created] = await tx.insert(seatAssignments).values(assignment).returning();
        
        // Update contestant status to 'assigned'
        await tx
          .update(contestants)
          .set({ availabilityStatus: 'assigned' })
          .where(eq(contestants.id, assignment.contestantId));
        
        return created;
      });
    } catch (error: any) {
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
    const [assignment] = await db.select().from(seatAssignments).where(eq(seatAssignments.id, id));
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
    return db.select().from(seatAssignments);
  }

  async deleteSeatAssignment(id: string): Promise<void> {
    // Use transaction to atomically delete assignment and update contestant status
    await db.transaction(async (tx) => {
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
      signedIn: workflowFields.signedIn,
      otdNotes: workflowFields.otdNotes,
      standbyReplacementSwaps: workflowFields.standbyReplacementSwaps,
      rxNumber: workflowFields.rxNumber,
      rxEpNumber: workflowFields.rxEpNumber,
      caseNumber: workflowFields.caseNumber,
      winningMoneyRole: workflowFields.winningMoneyRole,
      winningMoneyAmount: workflowFields.winningMoneyAmount,
      caseAmount: workflowFields.caseAmount,
      quickCash: workflowFields.quickCash,
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
    };

    const fieldsToUpdate = Object.fromEntries(
      Object.entries(allowedFields).filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(fieldsToUpdate).length === 0) {
      const [existing] = await db.select().from(seatAssignments).where(eq(seatAssignments.id, id));
      return existing;
    }

    const [updated] = await db
      .update(seatAssignments)
      .set(fieldsToUpdate)
      .where(eq(seatAssignments.id, id))
      .returning();
    return updated;
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
    return await db.transaction(async (tx) => {
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
    return await db.transaction(async (tx) => {
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
    return await db.transaction(async (tx) => {
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
    return await db.transaction(async (tx) => {
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

      // Move block A assignments to block B
      for (const assignment of blockAAssignments) {
        await tx
          .update(seatAssignments)
          .set({ blockNumber: blockB })
          .where(eq(seatAssignments.id, assignment.id));
      }

      // Move block B assignments to block A
      for (const assignment of blockBAssignments) {
        await tx
          .update(seatAssignments)
          .set({ blockNumber: blockA })
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
    return await db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(seatAssignments)
        .where(eq(seatAssignments.id, id));

      if (!assignment) {
        throw new Error('Seat assignment not found');
      }

      const [canceled] = await tx
        .insert(canceledAssignments)
        .values({
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
        })
        .returning();

      await tx.delete(seatAssignments).where(eq(seatAssignments.id, id));

      await tx
        .update(contestants)
        .set({ availabilityStatus: 'rescheduled' })
        .where(eq(contestants.id, assignment.contestantId));

      return canceled;
    });
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
        contestant: contestants,
        recordDay: recordDays,
      })
      .from(canceledAssignments)
      .innerJoin(contestants, eq(canceledAssignments.contestantId, contestants.id))
      .innerJoin(recordDays, eq(canceledAssignments.recordDayId, recordDays.id));

    return results as any;
  }

  async updateCanceledAssignment(id: string, data: Partial<CanceledAssignment>): Promise<CanceledAssignment | undefined> {
    const [updated] = await db
      .update(canceledAssignments)
      .set(data)
      .where(eq(canceledAssignments.id, id))
      .returning();
    return updated;
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
      })
      .returning();
    return created;
  }

  async deleteCanceledAssignment(id: string): Promise<void> {
    await db.delete(canceledAssignments).where(eq(canceledAssignments.id, id));
  }

  // Availability Tokens
  async createAvailabilityToken(token: InsertAvailabilityToken): Promise<AvailabilityToken> {
    const [created] = await db.insert(availabilityTokens).values(token).returning();
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
    const [created] = await db.insert(contestantAvailability).values(availability).returning();
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
    return db.select().from(contestantAvailability);
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
    await db
      .delete(standbyAssignments)
      .where(eq(standbyAssignments.id, id));
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
    const results = await db
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
    const results = await db
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
    const results = await db
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
    await db
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

  // Rebooking History
  async logRebooking(data: InsertRebookingHistory): Promise<RebookingHistory> {
    const [created] = await getDb().insert(rebookingHistory).values(data).returning();
    return created;
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
      const insertResult = await client.query(
        `INSERT INTO seat_assignments (id, record_day_id, contestant_id, block_number, seat_label, paperwork_sent, paperwork_sent_by, paperwork_received, paperwork_received_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING *`,
        [newId, params.newRecordDayId, params.contestantId, params.blockNumber, params.seatLabel, 
         oldAssignment.paperwork_sent, oldAssignment.paperwork_sent_by, 
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
          quickCash: newAssignment.quick_cash,
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
    return await db.transaction(async (tx) => {
      // Create the attendance issue
      const [created] = await tx.insert(attendanceIssues).values(issue).returning();
      
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
      await tx.delete(seatAssignments).where(
        and(
          eq(seatAssignments.contestantId, issue.contestantId),
          eq(seatAssignments.recordDayId, issue.recordDayId)
        )
      );
      
      return created;
    });
  }

  async getAttendanceIssues(): Promise<Array<AttendanceIssue & { contestant: Contestant; recordDay: RecordDay }>> {
    const results = await db
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
    const results = await db
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
    const [issue] = await db
      .select()
      .from(attendanceIssues)
      .where(eq(attendanceIssues.id, id));
    
    if (!issue) return;
    
    await db.transaction(async (tx) => {
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
    const [issue] = await db
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
    
    return await db.transaction(async (tx) => {
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
      
      return {
        attendanceIssue: updatedIssue,
        canceledAssignment,
      };
    });
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

  async removePrizeWinner(id: string): Promise<void> {
    await db.delete(prizeWinners).where(eq(prizeWinners.id, id));
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
    const [created] = await db
      .insert(noticeboardPosts)
      .values(post)
      .returning();
    return created;
  }

  async getNoticeboardPosts(): Promise<Array<NoticeboardPost & { likeCount: number; commentCount: number }>> {
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
    const [post] = await db
      .select()
      .from(noticeboardPosts)
      .where(eq(noticeboardPosts.id, id));
    return post;
  }

  async updateNoticeboardPost(id: string, data: Partial<NoticeboardPost>): Promise<NoticeboardPost | undefined> {
    const [updated] = await db
      .update(noticeboardPosts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(noticeboardPosts.id, id))
      .returning();
    return updated;
  }

  async deleteNoticeboardPost(id: string): Promise<void> {
    await db.delete(noticeboardPosts).where(eq(noticeboardPosts.id, id));
  }

  async togglePinPost(id: string): Promise<NoticeboardPost | undefined> {
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
    const [created] = await db
      .insert(noticeboardComments)
      .values(comment)
      .returning();
    return created;
  }

  async getCommentsByPost(postId: string): Promise<NoticeboardComment[]> {
    return db
      .select()
      .from(noticeboardComments)
      .where(eq(noticeboardComments.postId, postId))
      .orderBy(noticeboardComments.createdAt);
  }

  async deleteNoticeboardComment(id: string): Promise<void> {
    await db.delete(noticeboardComments).where(eq(noticeboardComments.id, id));
  }

  // Noticeboard Likes
  async toggleLike(postId: string, browserId: string): Promise<{ liked: boolean; likeCount: number }> {
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
      await db.delete(noticeboardLikes).where(eq(noticeboardLikes.id, existing.id));
    } else {
      // Like
      await db.insert(noticeboardLikes).values({ postId, browserId });
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
    return db
      .select()
      .from(noticeboardLikes)
      .where(eq(noticeboardLikes.postId, postId));
  }

  async hasBrowserLikedPost(postId: string, browserId: string): Promise<boolean> {
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
      ? await db.select().from(postRecordTracking).where(eq(postRecordTracking.recordDayId, recordDayId)).orderBy(postRecordTracking.createdAt)
      : await db.select().from(postRecordTracking).orderBy(postRecordTracking.createdAt);
    
    if (entries.length === 0) return [];
    
    // Batch fetch contestants
    const contestantIds = [...new Set(entries.map(e => e.contestantId).filter(Boolean))];
    const contestantsData = contestantIds.length > 0 
      ? await db.select().from(contestants).where(inArray(contestants.id, contestantIds))
      : [];
    const contestantMap = new Map(contestantsData.map(c => [c.id, c]));
    
    // Batch fetch record days
    const recordDayIds = [...new Set(entries.map(e => e.recordDayId).filter((id): id is string => !!id))];
    const recordDaysData = recordDayIds.length > 0 
      ? await db.select().from(recordDays).where(inArray(recordDays.id, recordDayIds))
      : [];
    const recordDayMap = new Map(recordDaysData.map(rd => [rd.id, rd]));
    
    // Batch fetch seat assignments
    const seatAssignmentIds = [...new Set(entries.map(e => e.seatAssignmentId).filter((id): id is string => !!id))];
    const seatAssignmentsData = seatAssignmentIds.length > 0 
      ? await db.select().from(seatAssignments).where(inArray(seatAssignments.id, seatAssignmentIds))
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
    await db.delete(postRecordTracking).where(eq(postRecordTracking.id, id));
  }
}

export const storage = new DbStorage();
export { db, pool };
