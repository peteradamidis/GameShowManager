import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { 
  contestants, 
  groups, 
  recordDays, 
  seatAssignments,
  type Contestant,
  type InsertContestant,
  type Group,
  type InsertGroup,
  type RecordDay,
  type InsertRecordDay,
  type SeatAssignment,
  type InsertSeatAssignment,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export interface IStorage {
  // Contestants
  createContestant(contestant: InsertContestant): Promise<Contestant>;
  getContestants(): Promise<Contestant[]>;
  getContestantById(id: string): Promise<Contestant | undefined>;
  updateContestantAvailability(id: string, status: string): Promise<Contestant | undefined>;
  
  // Groups
  createGroup(group: InsertGroup): Promise<Group>;
  getGroups(): Promise<Group[]>;
  getGroupById(id: string): Promise<Group | undefined>;
  
  // Record Days
  createRecordDay(recordDay: InsertRecordDay): Promise<RecordDay>;
  getRecordDays(): Promise<RecordDay[]>;
  getRecordDayById(id: string): Promise<RecordDay | undefined>;
  updateRecordDayStatus(id: string, status: string): Promise<RecordDay | undefined>;
  
  // Seat Assignments
  createSeatAssignment(assignment: InsertSeatAssignment): Promise<SeatAssignment>;
  getSeatAssignmentById(id: string): Promise<SeatAssignment | undefined>;
  getSeatAssignmentsByRecordDay(recordDayId: string): Promise<SeatAssignment[]>;
  deleteSeatAssignment(id: string): Promise<void>;
  updateSeatAssignment(id: string, blockNumber: number, seatLabel: string): Promise<SeatAssignment | undefined>;
}

export class DbStorage implements IStorage {
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

  async updateContestantAvailability(id: string, status: string): Promise<Contestant | undefined> {
    const [updated] = await db
      .update(contestants)
      .set({ availabilityStatus: status as any })
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

  // Seat Assignments
  async createSeatAssignment(assignment: InsertSeatAssignment): Promise<SeatAssignment> {
    const [created] = await db.insert(seatAssignments).values(assignment).returning();
    return created;
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

  async deleteSeatAssignment(id: string): Promise<void> {
    await db.delete(seatAssignments).where(eq(seatAssignments.id, id));
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
}

export const storage = new DbStorage();
