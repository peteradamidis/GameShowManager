import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContestantSchema, insertRecordDaySchema, insertSeatAssignmentSchema } from "@shared/schema";
import xlsx from "xlsx";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });

// Helper function to identify groups from "Attending With" column
function identifyGroups(contestants: any[]): Map<string, string[]> {
  const groupMap = new Map<string, string[]>();
  const nameToGroup = new Map<string, string>();

  contestants.forEach((contestant) => {
    if (!contestant.attendingWith) return;
    
    const attendingWithNames = contestant.attendingWith
      .split(/[,&]/)
      .map((name: string) => name.trim())
      .filter((name: string) => name.length > 0);

    // Find all people in this group (including this contestant)
    const groupMembers = new Set<string>([contestant.name]);
    attendingWithNames.forEach((name: string) => groupMembers.add(name));

    // Check if any member already has a group
    let existingGroupId: string | null = null;
    for (const member of Array.from(groupMembers)) {
      if (nameToGroup.has(member)) {
        existingGroupId = nameToGroup.get(member)!;
        break;
      }
    }

    // Assign all members to the same group
    const groupId = existingGroupId || `GROUP-${Math.random().toString(36).substr(2, 9)}`;
    Array.from(groupMembers).forEach((member) => {
      nameToGroup.set(member, groupId);
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, []);
      }
      if (!groupMap.get(groupId)!.includes(member)) {
        groupMap.get(groupId)!.push(member);
      }
    });
  });

  return groupMap;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Import contestants from Excel
  app.post("/api/contestants/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = xlsx.utils.sheet_to_json(sheet);

      // Normalize column names to camelCase
      const data = rawData.map((row: any) => ({
        name: row.Name || row.name,
        age: parseInt(row.Age || row.age),
        gender: row.Gender || row.gender,
        attendingWith: row["Attending With"] || row["attending_with"] || row.attendingWith || null,
      }));

      // Identify groups
      const groupMap = identifyGroups(data);
      const createdGroups = new Map<string, string>();

      // Create groups in database
      let groupCounter = 1;
      for (const [groupId, members] of Array.from(groupMap.entries())) {
        if (members.length > 1) {
          const group = await storage.createGroup({
            referenceNumber: `GRP${String(groupCounter).padStart(3, "0")}`,
          });
          createdGroups.set(groupId, group.id);
          groupCounter++;
        }
      }

      // Create contestants
      const createdContestants = [];
      for (const row of data as any[]) {
        const nameToGroupId = new Map<string, string>();
        for (const [groupId, members] of Array.from(groupMap.entries())) {
          members.forEach((member: string) => {
            if (createdGroups.has(groupId)) {
              nameToGroupId.set(member, createdGroups.get(groupId)!);
            }
          });
        }

        const contestant = await storage.createContestant({
          name: row.name,
          age: row.age,
          gender: row.gender,
          attendingWith: row.attendingWith,
          groupId: nameToGroupId.get(row.name) || null,
          availabilityStatus: "pending",
        });
        createdContestants.push(contestant);
      }

      res.json({
        message: `Successfully imported ${createdContestants.length} contestants`,
        contestants: createdContestants,
        groupsCreated: createdGroups.size,
      });
    } catch (error: any) {
      console.error("Import error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all contestants
  app.get("/api/contestants", async (req, res) => {
    try {
      const allContestants = await storage.getContestants();
      res.json(allContestants);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate fake contestants for testing
  app.post("/api/contestants/generate-fake", async (req, res) => {
    try {
      const fakeContestants = [
        // Group 1 - Friends
        { name: "Sarah Johnson", age: 28, gender: "Female" as const, attendingWith: "Mike Chen" },
        { name: "Mike Chen", age: 32, gender: "Male" as const, attendingWith: "Sarah Johnson" },
        
        // Group 2 - Couple
        { name: "Emma Williams", age: 35, gender: "Female" as const, attendingWith: "David Williams" },
        { name: "David Williams", age: 37, gender: "Male" as const, attendingWith: "Emma Williams" },
        
        // Group 3 - Family
        { name: "Lisa Anderson", age: 42, gender: "Female" as const, attendingWith: "James Anderson, Amy Anderson" },
        { name: "James Anderson", age: 45, gender: "Male" as const, attendingWith: "Lisa Anderson, Amy Anderson" },
        { name: "Amy Anderson", age: 19, gender: "Female" as const, attendingWith: "Lisa Anderson, James Anderson" },
        
        // Solo contestants
        { name: "Jennifer Martinez", age: 29, gender: "Female" as const },
        { name: "Robert Taylor", age: 52, gender: "Male" as const },
        { name: "Amanda White", age: 31, gender: "Female" as const },
        { name: "Christopher Lee", age: 38, gender: "Male" as const },
        { name: "Jessica Brown", age: 26, gender: "Female" as const },
        { name: "Daniel Garcia", age: 41, gender: "Male" as const },
        { name: "Michelle Davis", age: 33, gender: "Female" as const },
        { name: "Kevin Miller", age: 29, gender: "Male" as const },
        { name: "Ashley Wilson", age: 27, gender: "Female" as const },
        { name: "Brandon Moore", age: 34, gender: "Male" as const },
        { name: "Stephanie Taylor", age: 36, gender: "Female" as const },
        { name: "Justin Thomas", age: 30, gender: "Male" as const },
        { name: "Rachel Jackson", age: 28, gender: "Female" as const },
        
        // Group 4 - Friends group
        { name: "Melissa Harris", age: 25, gender: "Female" as const, attendingWith: "Nicole Martin" },
        { name: "Nicole Martin", age: 26, gender: "Female" as const, attendingWith: "Melissa Harris" },
        
        // More solo contestants
        { name: "Andrew Thompson", age: 44, gender: "Male" as const },
        { name: "Lauren Clark", age: 31, gender: "Female" as const },
        { name: "Tyler Rodriguez", age: 27, gender: "Male" as const },
        { name: "Samantha Lewis", age: 29, gender: "Female" as const },
        { name: "Jacob Walker", age: 35, gender: "Male" as const },
        { name: "Emily Hall", age: 32, gender: "Female" as const },
        { name: "Ryan Allen", age: 39, gender: "Male" as const },
        { name: "Olivia Young", age: 24, gender: "Female" as const },
      ];

      // Create contestants and identify groups
      const createdContestants = [];
      const groupMap = new Map<string, string>();

      for (const data of fakeContestants) {
        const contestant = await storage.createContestant({
          name: data.name,
          age: data.age,
          gender: data.gender,
          availabilityStatus: "Available",
        });
        createdContestants.push(contestant);

        // Track group associations
        if (data.attendingWith) {
          const groupKey = [data.name, ...data.attendingWith.split(',').map(n => n.trim())].sort().join('|');
          if (!groupMap.has(groupKey)) {
            const group = await storage.createGroup({
              name: `Group ${groupMap.size + 1}`,
              memberNames: groupKey.split('|'),
            });
            groupMap.set(groupKey, group.id);
          }
        }
      }

      res.json({ 
        message: `Generated ${createdContestants.length} fake contestants with ${groupMap.size} groups`,
        count: createdContestants.length,
        groups: groupMap.size
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all record days
  app.get("/api/record-days", async (req, res) => {
    try {
      const allRecordDays = await storage.getRecordDays();
      res.json(allRecordDays);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create record day
  app.post("/api/record-days", async (req, res) => {
    try {
      const validated = insertRecordDaySchema.parse(req.body);
      const recordDay = await storage.createRecordDay(validated);
      res.json(recordDay);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Assign contestants to a record day
  app.post("/api/record-days/:id/contestants", async (req, res) => {
    try {
      const { contestantIds } = req.body;
      const recordDayId = req.params.id;

      if (!Array.isArray(contestantIds) || contestantIds.length === 0) {
        return res.status(400).json({ error: "contestantIds must be a non-empty array" });
      }

      // Verify record day exists
      const recordDay = await storage.getRecordDayById(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }

      // Update each contestant's availability to show they're assigned
      const updates = contestantIds.map((contestantId: string) =>
        storage.updateContestantAvailability(contestantId, "Assigned")
      );
      await Promise.all(updates);

      res.json({ 
        message: `${contestantIds.length} contestants assigned to record day`,
        recordDayId 
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get seat assignments for a record day
  app.get("/api/seat-assignments/:recordDayId", async (req, res) => {
    try {
      const assignments = await storage.getSeatAssignmentsByRecordDay(req.params.recordDayId);
      const contestantIds = assignments.map((a) => a.contestantId);
      
      // Get full contestant data
      const contestantsData = await storage.getContestants();
      const contestantsMap = new Map(contestantsData.map((c) => [c.id, c]));

      const enrichedAssignments = assignments.map((assignment) => ({
        ...assignment,
        contestant: contestantsMap.get(assignment.contestantId),
      }));

      res.json(enrichedAssignments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Auto-assign seats with demographic balancing
  app.post("/api/auto-assign", async (req, res) => {
    try {
      const { recordDayId } = req.body;

      if (!recordDayId) {
        return res.status(400).json({ error: "recordDayId is required" });
      }

      // Get all available contestants (not yet assigned)
      const allContestants = await storage.getContestants();
      const available = allContestants.filter((c) => c.availabilityStatus === "available");

      if (available.length === 0) {
        return res.status(400).json({ error: "No available contestants to assign" });
      }

      // Seat layout: 7 blocks, 22 seats each
      const BLOCKS = 7;
      const SEATS_PER_BLOCK = 22;
      const TOTAL_SEATS = BLOCKS * SEATS_PER_BLOCK;
      const TARGET_FEMALE_MIN = 0.60;
      const TARGET_FEMALE_MAX = 0.70;
      const ROWS = [
        { label: "A", count: 5 },
        { label: "B", count: 5 },
        { label: "C", count: 4 },
        { label: "D", count: 4 },
        { label: "E", count: 4 },
      ];

      // Group contestants by their groupId
      const groupedContestants = new Map<string | null, typeof available>();
      available.forEach((contestant) => {
        const key = contestant.groupId || contestant.id;
        if (!groupedContestants.has(key)) {
          groupedContestants.set(key, []);
        }
        groupedContestants.get(key)!.push(contestant);
      });

      const groups = Array.from(groupedContestants.values());
      
      // Separate groups by gender composition
      const femaleGroups = groups.filter(g => g.every(c => c.gender === "Female"));
      const maleGroups = groups.filter(g => g.every(c => c.gender === "Male"));
      const mixedGroups = groups.filter(g => !femaleGroups.includes(g) && !maleGroups.includes(g));

      // Sort each category by size (larger groups first)
      femaleGroups.sort((a, b) => b.length - a.length);
      maleGroups.sort((a, b) => b.length - a.length);
      mixedGroups.sort((a, b) => b.length - a.length);

      // PHASE 1: Build assignment plan in-memory with comprehensive search
      type PlanItem = {
        contestant: typeof available[0];
        blockNumber: number;
        seatLabel: string;
      };

      // Calculate demographics
      const totalFemales = available.filter(c => c.gender === "Female").length;
      const totalMales = available.filter(c => c.gender === "Male").length;
      const totalAvailable = available.length;

      // All groups to consider
      const allGroups = [...mixedGroups, ...femaleGroups, ...maleGroups];
      
      // Function to try building a plan with a specific group ordering
      const tryBuildPlan = (groupOrder: typeof allGroups): PlanItem[] | null => {
        const plan: PlanItem[] = [];
        let currentBlock = 1;
        let currentSeatInBlock = 0;
        let femaleCount = 0;
        let maleCount = 0;

        for (const group of groupOrder) {
          // Check capacity
          if (plan.length + group.length > TOTAL_SEATS) continue;

          // Check block capacity
          if (currentSeatInBlock + group.length > SEATS_PER_BLOCK) {
            currentBlock++;
            currentSeatInBlock = 0;
            if (currentBlock > BLOCKS) break;
          }

          // Add group to plan
          for (const contestant of group) {
            const seatLabel = getSeatLabel(currentSeatInBlock, ROWS);
            plan.push({
              contestant,
              blockNumber: currentBlock,
              seatLabel,
            });

            if (contestant.gender === "Female") femaleCount++;
            else if (contestant.gender === "Male") maleCount++;
            currentSeatInBlock++;
          }
        }

        // Check if final ratio meets requirements
        const total = plan.length;
        if (total === 0) return null;
        
        const femaleRatio = femaleCount / total;
        if (femaleRatio >= TARGET_FEMALE_MIN && femaleRatio <= TARGET_FEMALE_MAX) {
          return plan;
        }

        return null;
      };

      // Helper to shuffle array
      const shuffle = <T>(array: T[]): T[] => {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
      };

      // Try to find a valid plan
      let bestPlan: PlanItem[] | null = null;

      // Strategy 1: Deterministic orderings
      const deterministicStrategies = [
        [...mixedGroups, ...femaleGroups, ...maleGroups],
        [...mixedGroups, ...maleGroups, ...femaleGroups],
        [...femaleGroups, ...mixedGroups, ...maleGroups],
        [...femaleGroups, ...maleGroups, ...mixedGroups],
        [...maleGroups, ...mixedGroups, ...femaleGroups],
        [...maleGroups, ...femaleGroups, ...mixedGroups],
      ];

      for (const strategy of deterministicStrategies) {
        bestPlan = tryBuildPlan(strategy);
        if (bestPlan) break;
      }

      // Strategy 2: Random shuffles if deterministic failed
      if (!bestPlan) {
        const MAX_RANDOM_ATTEMPTS = 50;
        for (let i = 0; i < MAX_RANDOM_ATTEMPTS && !bestPlan; i++) {
          const shuffled = shuffle(allGroups);
          bestPlan = tryBuildPlan(shuffled);
        }
      }

      if (!bestPlan) {
        return res.status(400).json({
          error: `Could not find a seating arrangement that meets the 60-70% female demographic requirement while keeping groups together.`,
          availablePool: {
            femaleCount: totalFemales,
            maleCount: totalMales,
            total: totalAvailable,
            femalePercentage: totalAvailable > 0 ? ((totalFemales / totalAvailable) * 100).toFixed(1) : "0",
          },
          target: "60-70%",
          suggestion: "Try adjusting the available contestant pool or relaxing group constraints."
        });
      }

      const plan = bestPlan;
      const assignedFemales = plan.filter(p => p.contestant.gender === "Female").length;
      const assignedMales = plan.filter(p => p.contestant.gender === "Male").length;
      const totalAssigned = plan.length;
      const finalFemaleRatio = assignedFemales / totalAssigned;

      // PHASE 2: Persist the plan to database with transaction-like semantics
      const createdAssignments: any[] = [];
      const contestantUpdates: string[] = [];
      
      try {
        // Create all assignments
        for (const item of plan) {
          const assignment = await storage.createSeatAssignment({
            recordDayId,
            contestantId: item.contestant.id,
            blockNumber: item.blockNumber,
            seatLabel: item.seatLabel,
          });
          createdAssignments.push(assignment);
          contestantUpdates.push(item.contestant.id);
        }

        // Update all contestant statuses
        for (const contestantId of contestantUpdates) {
          await storage.updateContestantAvailability(contestantId, "assigned");
        }

        res.json({
          message: `Assigned ${totalAssigned} contestants to seats`,
          assignments: createdAssignments,
          demographics: {
            femaleCount: assignedFemales,
            maleCount: assignedMales,
            femalePercentage: (finalFemaleRatio * 100).toFixed(1),
            targetRange: "60-70%"
          }
        });
      } catch (persistError: any) {
        // If persistence fails, attempt cleanup (best effort)
        console.error("Persistence error, attempting cleanup:", persistError);
        for (const assignment of createdAssignments) {
          try {
            await storage.deleteSeatAssignment(assignment.id);
          } catch (cleanupError) {
            console.error("Cleanup error:", cleanupError);
          }
        }
        for (const contestantId of contestantUpdates) {
          try {
            await storage.updateContestantAvailability(contestantId, "available");
          } catch (cleanupError) {
            console.error("Cleanup error:", cleanupError);
          }
        }
        throw persistError;
      }
    } catch (error: any) {
      console.error("Auto-assign error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Swap two seat assignments atomically
  app.post("/api/seat-assignments/swap", async (req, res) => {
    try {
      const { sourceAssignmentId, targetAssignmentId, blockNumber, seatLabel } = req.body;

      // Validation
      if (!sourceAssignmentId || typeof sourceAssignmentId !== 'string') {
        return res.status(400).json({ error: "sourceAssignmentId is required and must be a string" });
      }

      if (targetAssignmentId && typeof targetAssignmentId !== 'string') {
        return res.status(400).json({ error: "targetAssignmentId must be a string" });
      }

      // For moves to empty seats, blockNumber and seatLabel are required
      if (!targetAssignmentId && (!blockNumber || !seatLabel)) {
        return res.status(400).json({ error: "blockNumber and seatLabel are required for moves to empty seats" });
      }

      if (blockNumber !== undefined && typeof blockNumber !== 'number') {
        return res.status(400).json({ error: "blockNumber must be a number" });
      }

      if (seatLabel !== undefined && typeof seatLabel !== 'string') {
        return res.status(400).json({ error: "seatLabel must be a string" });
      }

      // Use atomic storage method with database transaction and row locking
      const result = await storage.atomicSwapSeats(
        sourceAssignmentId,
        targetAssignmentId || null,
        blockNumber,
        seatLabel
      );

      res.json({
        message: targetAssignmentId ? "Seats swapped successfully" : "Seat moved successfully",
        ...result,
      });
    } catch (error: any) {
      console.error("Swap error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update record day status
  app.put("/api/record-days/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!["draft", "ready", "invited", "completed"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const updated = await storage.updateRecordDayStatus(req.params.id, status);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Update seat assignment (for drag-and-drop) with collision detection
  app.put("/api/seat-assignments/:id", async (req, res) => {
    try {
      const { blockNumber, seatLabel } = req.body;

      // Validate block number and seat label
      if (blockNumber < 1 || blockNumber > 7) {
        return res.status(400).json({ error: "Block number must be between 1 and 7" });
      }

      // Get the assignment to find its recordDayId
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }

      // Check for existing assignment at this seat
      const allAssignments = await storage.getSeatAssignmentsByRecordDay(assignment.recordDayId);
      const collision = allAssignments.find(
        (a) => a.id !== req.params.id && 
               a.blockNumber === blockNumber && 
               a.seatLabel === seatLabel
      );

      if (collision) {
        return res.status(400).json({ 
          error: "Seat already occupied",
          conflictingAssignment: collision
        });
      }

      const updated = await storage.updateSeatAssignment(req.params.id, blockNumber, seatLabel);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete seat assignment
  app.delete("/api/seat-assignments/:id", async (req, res) => {
    try {
      // Get assignment to find contestant
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }

      // Set contestant back to available
      await storage.updateContestantAvailability(assignment.contestantId, "available");

      // Delete the assignment
      await storage.deleteSeatAssignment(req.params.id);
      res.json({ message: "Seat assignment deleted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// Helper to convert seat index to label (A1, B3, etc.)
function getSeatLabel(seatIndex: number, rows: { label: string; count: number }[]): string {
  let remaining = seatIndex;
  for (const row of rows) {
    if (remaining < row.count) {
      return `${row.label}${remaining + 1}`;
    }
    remaining -= row.count;
  }
  return "E4"; // Fallback
}
