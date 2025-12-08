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
  systemConfig,
  formConfigurations,
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
  type SystemConfig,
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
  getRecordDayById(id: string): Promise<RecordDay | undefined>;
  updateRecordDay(id: string, data: Partial<InsertRecordDay>): Promise<RecordDay | undefined>;
  updateRecordDayStatus(id: string, status: string): Promise<RecordDay | undefined>;
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
  atomicSwapSeats(
    sourceId: string,
    targetId: string | null,
    targetBlock?: number,
    targetSeat?: string
  ): Promise<{ source: SeatAssignment; target?: SeatAssignment }>;
  cancelSeatAssignment(id: string, reason?: string): Promise<CanceledAssignment>;
  
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
  
  // System Configuration
  getSystemConfig(key: string): Promise<string | null>;
  setSystemConfig(key: string, value: string): Promise<void>;
  
  // Form Configurations
  getFormConfigurations(formType: string): Promise<Record<string, string>>;
  setFormConfiguration(formType: string, fieldKey: string, value: string): Promise<void>;
  setFormConfigurations(formType: string, configs: Record<string, string>): Promise<void>;
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
    
    // Check if record day has any seat assignments
    const assignments = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.recordDayId, id));
    
    if (assignments.length > 0) {
      return { 
        success: false, 
        error: `Cannot delete: This record day has ${assignments.length} seat assignment(s). Remove all contestants first.` 
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
        
        // Update contestant status back to 'available'
        await tx
          .update(contestants)
          .set({ availabilityStatus: 'available' })
          .where(eq(contestants.id, assignment.contestantId));
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
      bookingEmailSent: workflowFields.bookingEmailSent,
      confirmedRsvp: workflowFields.confirmedRsvp,
      paperworkSent: workflowFields.paperworkSent,
      paperworkReceived: workflowFields.paperworkReceived,
      signedIn: workflowFields.signedIn,
      otdNotes: workflowFields.otdNotes,
      standbyReplacementSwaps: workflowFields.standbyReplacementSwaps,
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

  async cancelSeatAssignment(id: string, reason?: string): Promise<CanceledAssignment> {
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
        })
        .returning();

      await tx.delete(seatAssignments).where(eq(seatAssignments.id, id));

      await tx
        .update(contestants)
        .set({ availabilityStatus: 'available' })
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
        isFromStandby: canceledAssignments.isFromStandby,
        originalAttendanceDate: canceledAssignments.originalAttendanceDate,
        contestant: contestants,
        recordDay: recordDays,
      })
      .from(canceledAssignments)
      .innerJoin(contestants, eq(canceledAssignments.contestantId, contestants.id))
      .innerJoin(recordDays, eq(canceledAssignments.recordDayId, recordDays.id));

    return results as any;
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
}

export const storage = new DbStorage();
