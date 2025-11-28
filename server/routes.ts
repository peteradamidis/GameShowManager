import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContestantSchema, insertRecordDaySchema, insertSeatAssignmentSchema } from "@shared/schema";
import xlsx from "xlsx";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import express from "express";
import fs from "fs";

const upload = multer({ storage: multer.memoryStorage() });

// Photo upload configuration - store on disk
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), 'uploads', 'photos');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `contestant-${uniqueSuffix}${ext}`);
  }
});

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

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
  // Serve uploaded photos as static files
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Upload contestant photo
  app.post("/api/contestants/:id/photo", (req, res, next) => {
    photoUpload.single("photo")(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: "File too large. Maximum size is 5MB." });
        }
        if (err.message === 'Only image files are allowed') {
          return res.status(400).json({ error: "Only image files (JPEG, PNG, GIF, WebP) are allowed." });
        }
        console.error("Multer error:", err);
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!req.file) {
        return res.status(400).json({ error: "No photo uploaded" });
      }

      // Get existing contestant to check for old photo
      const existingContestant = await storage.getContestantById(id);
      
      if (!existingContestant) {
        // Delete the uploaded file if contestant not found
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: "Contestant not found" });
      }

      // Delete old photo if it exists
      if (existingContestant.photoUrl) {
        const oldFilePath = path.join(process.cwd(), existingContestant.photoUrl.replace(/^\//, ''));
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      const photoUrl = `/uploads/photos/${req.file.filename}`;
      
      // Update contestant with photo URL
      const updated = await storage.updateContestantPhoto(id, photoUrl);

      res.json({ photoUrl, message: "Photo uploaded successfully" });
    } catch (error) {
      console.error("Photo upload error:", error);
      res.status(500).json({ error: "Failed to upload photo" });
    }
  });

  // Delete contestant photo
  app.delete("/api/contestants/:id/photo", async (req, res) => {
    try {
      const { id } = req.params;
      
      const contestant = await storage.getContestantById(id);
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }

      // Delete the file if it exists
      if (contestant.photoUrl) {
        // Remove leading slash to get relative path, then join with cwd
        const filePath = path.join(process.cwd(), contestant.photoUrl.replace(/^\//, ''));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Clear photo URL in database
      await storage.updateContestantPhoto(id, null);
      
      res.json({ message: "Photo deleted successfully" });
    } catch (error) {
      console.error("Photo delete error:", error);
      res.status(500).json({ error: "Failed to delete photo" });
    }
  });

  // Import contestants from Excel
  app.post("/api/contestants/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let rawData: any[];
      
      try {
        const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        rawData = xlsx.utils.sheet_to_json(sheet);
      } catch (parseError: any) {
        console.error("Excel parse error:", parseError);
        return res.status(400).json({ 
          error: "Could not parse Excel file. Please ensure you're uploading a valid .xlsx or .xls file exported from Cast It Reach." 
        });
      }
      
      if (!rawData || rawData.length === 0) {
        return res.status(400).json({ error: "The uploaded file is empty or has no data rows." });
      }

      // Log all column names from first row for debugging
      if (rawData.length > 0) {
        console.log("Excel columns found:", Object.keys(rawData[0]));
      }

      // Helper function to get value by trying multiple column name variations
      const getColumnValue = (row: any, ...names: string[]): string | null => {
        for (const name of names) {
          // Try exact match first
          if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
            return row[name];
          }
          // Try trimmed keys match
          for (const key of Object.keys(row)) {
            if (key.trim().toLowerCase() === name.toLowerCase()) {
              if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
                return row[key];
              }
            }
          }
        }
        return null;
      };

      // Normalize column names - handle various case formats
      const data = rawData.map((row: any) => {
        // Get name with multiple fallbacks
        const nameValue = row.NAME || row.Name || row.name || row["Full Name"] || row["FULL NAME"] || null;
        
        // Skip rows without a name (empty rows, summary rows, etc.)
        if (!nameValue || nameValue.toString().trim() === '') {
          return null;
        }
        
        // Get age value with fallbacks for different column name formats
        const ageValue = row.AGE || row.Age || row.age;
        const parsedAge = parseInt(ageValue);
        
        // Get gender with fallback to "Not Specified" if column doesn't exist
        const genderValue = row.GENDER || row.Gender || row.gender || "Not Specified";
        
        return {
          name: nameValue.toString().trim(),
          age: isNaN(parsedAge) ? 0 : parsedAge,
          gender: genderValue,
          // Handle GROUP ID column or Attending With column
          groupIdFromFile: row["GROUP ID"] || row["Group ID"] || row["group id"] || row["Group"] || row["GROUP"] || null,
          attendingWith: row["ATTENDING WITH"] || row["Attending With"] || row["attending with"] || 
                         row["Attending with"] || row.attendingWith || row["AttendingWith"] ||
                         row["GUEST"] || row["Guest"] || row["Guests"] || row["GUESTS"] ||
                         row["With"] || row["WITH"] || null,
          email: row.EMAIL || row.Email || row.email || row["E-mail"] || row["E-MAIL"] || 
                 row["Email Address"] || row["EMAIL ADDRESS"] || null,
          phone: row.PHONE || row.Phone || row.phone || 
                 row.MOBILE || row.Mobile || row.mobile ||
                 row["Phone Number"] || row["PHONE NUMBER"] ||
                 row["Mobile Number"] || row["MOBILE NUMBER"] ||
                 row["Contact"] || row["CONTACT"] || null,
          address: row.ADDRESS || row.Address || row.address || 
                   row.CITY || row.City || row.city ||
                   row["Location"] || row["LOCATION"] || null,
          medicalInfo: row["MEDICAL INFO"] || row["Medical Info"] || row["medical_info"] || row.medicalInfo ||
                       row["MEDICAL CONDITIONS"] || row["Medical Conditions"] || row["medical conditions"] ||
                       row["Medical"] || row["MEDICAL"] ||
                       row["Health Conditions"] || row["HEALTH CONDITIONS"] ||
                       row["Health"] || row["HEALTH"] || null,
          mobilityNotes: getColumnValue(row, 
                         "Mobility/Access/Medical Notes", "MOBILITY/ACCESS/MEDICAL NOTES",
                         "Mobility/Access/Medical notes", "mobility/access/medical notes",
                         "MOBILITY NOTES", "Mobility Notes", "mobility_notes", 
                         "MOBILITY/ACCESS NOTES", "Mobility/Access Notes", 
                         "ACCESS NOTES", "Access Notes",
                         "Mobility", "MOBILITY",
                         "Access", "ACCESS",
                         "Accessibility", "ACCESSIBILITY",
                         "Special Needs", "SPECIAL NEEDS",
                         "Disability", "DISABILITY"),
          criminalRecord: getColumnValue(row,
                          "Criminal Record", "CRIMINAL RECORD", "criminal record",
                          "Criminal", "CRIMINAL",
                          "Background", "BACKGROUND",
                          "Background Check", "BACKGROUND CHECK"),
        };
      }).filter((row): row is NonNullable<typeof row> => row !== null);

      // Log how many valid rows found
      console.log(`Found ${data.length} valid contestant rows (filtered from ${rawData.length} total rows)`);

      if (data.length === 0) {
        return res.status(400).json({ error: "No valid contestant data found. Make sure your file has a NAME column." });
      }

      // Check if file has GROUP ID column - if so, use it for grouping
      const hasGroupIdColumn = data.some((row: any) => row.groupIdFromFile != null);
      
      let createdGroups = new Map<string, string>();
      let nameToGroupId = new Map<string, string>();
      
      if (hasGroupIdColumn) {
        // Group by GROUP ID from file
        const fileGroupIds = new Set(data.map((row: any) => row.groupIdFromFile).filter(Boolean));
        
        for (const fileGroupId of Array.from(fileGroupIds)) {
          const membersInGroup = data.filter((row: any) => row.groupIdFromFile === fileGroupId);
          if (membersInGroup.length > 1) {
            const group = await storage.createGroup({
              referenceNumber: `GRP${String(fileGroupId)}`,
            });
            createdGroups.set(String(fileGroupId), group.id);
            membersInGroup.forEach((member: any) => {
              nameToGroupId.set(member.name, group.id);
            });
          }
        }
      } else {
        // Use Attending With column for grouping
        const groupMap = identifyGroups(data);
        
        let groupCounter = 1;
        for (const [groupId, members] of Array.from(groupMap.entries())) {
          if (members.length > 1) {
            const group = await storage.createGroup({
              referenceNumber: `GRP${String(groupCounter).padStart(3, "0")}`,
            });
            createdGroups.set(groupId, group.id);
            members.forEach((member: string) => {
              nameToGroupId.set(member, group.id);
            });
            groupCounter++;
          }
        }
      }

      // Create contestants
      const createdContestants = [];
      for (const row of data as any[]) {
        const contestant = await storage.createContestant({
          name: row.name,
          age: row.age,
          gender: row.gender,
          attendingWith: row.attendingWith,
          email: row.email,
          phone: row.phone,
          address: row.address,
          medicalInfo: row.medicalInfo,
          mobilityNotes: row.mobilityNotes,
          criminalRecord: row.criminalRecord,
          groupId: nameToGroupId.get(row.name) || null,
          availabilityStatus: "pending",
        });
        createdContestants.push(contestant);
      }

      res.json({
        message: `Successfully imported ${createdContestants.length} contestants`,
        contestants: createdContestants,
        contestantsCreated: createdContestants.length,
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

  // Get single contestant by ID
  app.get("/api/contestants/:id", async (req, res) => {
    try {
      const contestant = await storage.getContestantById(req.params.id);
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }
      res.json(contestant);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update contestant
  app.patch("/api/contestants/:id", async (req, res) => {
    try {
      const contestant = await storage.getContestantById(req.params.id);
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }
      
      const updated = await storage.updateContestant(req.params.id, req.body);
      res.json(updated);
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

      // Create contestants
      const createdContestants = [];

      for (const data of fakeContestants) {
        const contestant = await storage.createContestant({
          name: data.name,
          age: data.age,
          gender: data.gender,
          availabilityStatus: "available",
          attendingWith: data.attendingWith,
        });
        createdContestants.push(contestant);
      }

      res.json({ 
        message: `Generated ${createdContestants.length} fake contestants`,
        count: createdContestants.length,
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
        storage.updateContestantAvailability(contestantId, "assigned")
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

  // Create a seat assignment
  app.post("/api/seat-assignments", async (req, res) => {
    try {
      const { recordDayId, contestantId, blockNumber, seatLabel } = req.body;

      if (!recordDayId || !contestantId || !blockNumber || !seatLabel) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Check for duplicate assignments
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      
      // Check if contestant is already seated in this record day
      const isContestantSeated = existingAssignments.some((a: any) => a.contestantId === contestantId);
      if (isContestantSeated) {
        return res.status(409).json({ error: "Contestant is already seated in this record day" });
      }
      
      // Check if seat is already occupied
      const isSeatOccupied = existingAssignments.some((a: any) => 
        a.blockNumber === parseInt(blockNumber) && a.seatLabel === seatLabel
      );
      if (isSeatOccupied) {
        return res.status(409).json({ error: "This seat is already occupied" });
      }

      const assignment = await storage.createSeatAssignment({
        recordDayId,
        contestantId,
        blockNumber: parseInt(blockNumber),
        seatLabel,
      });

      res.json(assignment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create group seat assignments (2-4 contestants to consecutive seats)
  app.post("/api/seat-assignments/group", async (req, res) => {
    try {
      const { recordDayId, contestantIds, blockNumber, startingSeat } = req.body;

      if (!recordDayId || !contestantIds || !blockNumber || !startingSeat) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (!Array.isArray(contestantIds) || contestantIds.length < 2 || contestantIds.length > 4) {
        return res.status(400).json({ error: "Must provide 2-4 contestants for group seating" });
      }

      // Define seat structure - same as frontend for consistency
      const SEAT_ROWS: Record<string, number> = { A: 5, B: 5, C: 4, D: 4, E: 4 };

      // Parse starting seat into row letter and seat number
      const rowLetter = startingSeat.charAt(0).toUpperCase();
      const seatNum = parseInt(startingSeat.slice(1));

      // Validate row exists
      if (!SEAT_ROWS[rowLetter]) {
        return res.status(400).json({ error: `Invalid row: ${rowLetter}. Valid rows are A, B, C, D, E.` });
      }

      const maxSeatsInRow = SEAT_ROWS[rowLetter];

      // Validate starting seat number is valid for this row
      if (seatNum < 1 || seatNum > maxSeatsInRow) {
        return res.status(400).json({ error: `Invalid seat number ${seatNum} for row ${rowLetter}. Row ${rowLetter} has seats 1-${maxSeatsInRow}.` });
      }

      // Check if we have enough seats in this row from the starting position
      const seatsRemainingInRow = maxSeatsInRow - seatNum + 1;
      if (contestantIds.length > seatsRemainingInRow) {
        return res.status(400).json({ 
          error: `Not enough consecutive seats in row ${rowLetter} from seat ${seatNum}. Need ${contestantIds.length} seats but only ${seatsRemainingInRow} available in this row.` 
        });
      }

      // Generate consecutive seat labels within the same row
      const seatLabels: string[] = [];
      for (let i = 0; i < contestantIds.length; i++) {
        seatLabels.push(`${rowLetter}${seatNum + i}`);
      }

      // Double-check we have the right number of seats
      if (seatLabels.length !== contestantIds.length) {
        return res.status(400).json({ 
          error: `Could not generate ${contestantIds.length} consecutive seats from ${startingSeat}` 
        });
      }

      // Check for duplicate assignments
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      
      // Check if any contestant is already seated in this record day
      for (const contestantId of contestantIds) {
        const isContestantSeated = existingAssignments.some((a: any) => a.contestantId === contestantId);
        if (isContestantSeated) {
          const contestant = await storage.getContestantById(contestantId);
          return res.status(409).json({ error: `${contestant?.name || 'A contestant'} is already seated in this record day` });
        }
      }
      
      // Check if any seat is already occupied
      for (const seatLabel of seatLabels) {
        const isSeatOccupied = existingAssignments.some((a: any) => 
          a.blockNumber === parseInt(blockNumber) && a.seatLabel === seatLabel
        );
        if (isSeatOccupied) {
          return res.status(409).json({ error: `Seat ${seatLabel} is already occupied` });
        }
      }

      // Create all assignments
      const assignments = [];
      for (let i = 0; i < contestantIds.length; i++) {
        const assignment = await storage.createSeatAssignment({
          recordDayId,
          contestantId: contestantIds[i],
          blockNumber: parseInt(blockNumber),
          seatLabel: seatLabels[i],
        });
        assignments.push(assignment);
      }

      res.json({
        message: `${contestantIds.length} contestants assigned to consecutive seats`,
        assignments,
        seats: seatLabels.map((seat, i) => ({ seat, block: blockNumber }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all seat assignments (for filtering purposes)
  app.get("/api/seat-assignments", async (req, res) => {
    try {
      const allAssignments = await storage.getAllSeatAssignments();
      res.json(allAssignments);
    } catch (error: any) {
      console.error("Error fetching all seat assignments:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get seat assignments for a record day
  app.get("/api/seat-assignments/:recordDayId", async (req, res) => {
    try {
      const assignments = await storage.getSeatAssignmentsByRecordDay(req.params.recordDayId);
      
      // Get full contestant data
      const contestantsData = await storage.getContestants();
      const contestantsMap = new Map(contestantsData.map((c) => [c.id, c]));

      // Flatten the data structure for frontend compatibility
      const enrichedAssignments = assignments.map((assignment) => {
        const contestant = contestantsMap.get(assignment.contestantId);
        return {
          id: assignment.id,
          recordDayId: assignment.recordDayId,
          contestantId: assignment.contestantId,
          blockNumber: assignment.blockNumber,
          seatLabel: assignment.seatLabel,
          firstNations: assignment.firstNations,
          rating: assignment.rating,
          location: assignment.location,
          medicalQuestion: assignment.medicalQuestion,
          criminalBankruptcy: assignment.criminalBankruptcy,
          castingCategory: assignment.castingCategory,
          notes: assignment.notes,
          bookingEmailSent: assignment.bookingEmailSent,
          confirmedRsvp: assignment.confirmedRsvp,
          paperworkSent: assignment.paperworkSent,
          paperworkReceived: assignment.paperworkReceived,
          signedIn: assignment.signedIn,
          otdNotes: assignment.otdNotes,
          standbyReplacementSwaps: assignment.standbyReplacementSwaps,
          contestantName: contestant?.name,
          age: contestant?.age,
          gender: contestant?.gender,
          groupId: contestant?.groupId,
          auditionRating: contestant?.auditionRating,
        };
      });

      res.json(enrichedAssignments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Auto-assign seats with demographic balancing
  // Rules:
  // 1. NEVER assign A+ rated contestants (they must be manually assigned)
  // 2. C-rated contestants can ONLY go to NPB blocks
  // 3. Balance audition ratings (A, B+, B) across blocks
  // 4. Balance ages across blocks
  // 5. Balance genders (target 60-70% female)
  // 6. Groups (from attendingWith) must sit together in consecutive seats
  // 7. Optional: Only assign to selected blocks (if blocks array provided)
  app.post("/api/auto-assign/:recordDayId", async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const { blocks: selectedBlocks } = req.body as { blocks?: number[] };

      if (!recordDayId) {
        return res.status(400).json({ error: "recordDayId is required" });
      }

      // Validate selected blocks if provided
      const validBlocks = selectedBlocks && Array.isArray(selectedBlocks) && selectedBlocks.length > 0
        ? selectedBlocks.filter(b => b >= 1 && b <= 7)
        : [1, 2, 3, 4, 5, 6, 7]; // Default to all blocks

      if (validBlocks.length === 0) {
        return res.status(400).json({ error: "No valid blocks selected" });
      }

      // Get block types (PB/NPB) for this record day
      const blockTypesData = await storage.getBlockTypesByRecordDay(recordDayId);
      const blockTypeMap: Record<number, 'PB' | 'NPB'> = {};
      blockTypesData.forEach(bt => {
        blockTypeMap[bt.blockNumber] = bt.blockType as 'PB' | 'NPB';
      });

      // Get all available contestants (not yet assigned)
      const allContestants = await storage.getContestants();
      
      // Filter: exclude A+ rated contestants (they must be manually assigned)
      const availableAll = allContestants.filter((c) => c.availabilityStatus === "available");
      const aPlusContestants = availableAll.filter(c => c.auditionRating === 'A+');
      const available = availableAll.filter(c => c.auditionRating !== 'A+');

      if (available.length === 0) {
        return res.status(400).json({ 
          error: "No available contestants to assign (A+ contestants must be manually assigned)",
          skippedAPlusCount: aPlusContestants.length
        });
      }

      // Configuration
      const BLOCKS = 7;
      const SEATS_PER_BLOCK = 22;
      const TARGET_FEMALE_RATIO = 0.65; // Midpoint of 60-70%
      const TARGET_FEMALE_MIN = 0.60;
      const TARGET_FEMALE_MAX = 0.70;
      const ROWS = [
        { label: "A", count: 5 },
        { label: "B", count: 5 },
        { label: "C", count: 4 },
        { label: "D", count: 4 },
        { label: "E", count: 4 },
      ];

      // Rating weights for balancing (higher = more desirable to spread)
      const RATING_ORDER = ['A', 'B+', 'B', 'C'];

      // PHASE 1: Create Group Bundles (based on groupId from attendingWith matching)
      type GroupBundle = {
        id: string;
        contestants: typeof available;
        size: number;
        femaleCount: number;
        maleCount: number;
        femaleRatio: number;
        totalAge: number;
        meanAge: number;
        ratingCounts: Record<string, number>;
        hasCRating: boolean; // Bundle contains C-rated contestant(s)
      };

      const groupMap = new Map<string, typeof available>();
      available.forEach((contestant) => {
        const key = contestant.groupId || `solo-${contestant.id}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, []);
        }
        groupMap.get(key)!.push(contestant);
      });

      const bundles: GroupBundle[] = Array.from(groupMap.entries()).map(([id, contestants]) => {
        const femaleCount = contestants.filter(c => c.gender === "Female").length;
        const maleCount = contestants.filter(c => c.gender === "Male").length;
        const totalAge = contestants.reduce((sum, c) => sum + c.age, 0);
        
        // Count ratings in this bundle
        const ratingCounts: Record<string, number> = { 'A': 0, 'B+': 0, 'B': 0, 'C': 0 };
        contestants.forEach(c => {
          if (c.auditionRating && ratingCounts.hasOwnProperty(c.auditionRating)) {
            ratingCounts[c.auditionRating]++;
          }
        });
        
        return {
          id,
          contestants,
          size: contestants.length,
          femaleCount,
          maleCount,
          femaleRatio: femaleCount / contestants.length,
          totalAge,
          meanAge: totalAge / contestants.length,
          ratingCounts,
          hasCRating: ratingCounts['C'] > 0,
        };
      });

      // Sort bundles: larger groups first (easier to place early), then by whether they have C-ratings
      bundles.sort((a, b) => {
        // First, prioritize bundles with C-ratings (they have fewer options)
        if (a.hasCRating !== b.hasCRating) {
          return a.hasCRating ? -1 : 1;
        }
        // Then by size (larger first)
        return b.size - a.size;
      });

      // PHASE 2: Initialize Block States with rating tracking
      type BlockState = {
        blockNumber: number;
        blockType: 'PB' | 'NPB' | undefined;
        seatsUsed: number;
        femaleCount: number;
        maleCount: number;
        totalAge: number;
        ageCount: number;
        meanAge: number;
        ratingCounts: Record<string, number>;
        bundles: string[];
      };

      // Only initialize blocks that were selected
      const blocks: BlockState[] = validBlocks.map(blockNum => ({
        blockNumber: blockNum,
        blockType: blockTypeMap[blockNum],
        seatsUsed: 0,
        femaleCount: 0,
        maleCount: 0,
        totalAge: 0,
        ageCount: 0,
        meanAge: 0,
        ratingCounts: { 'A': 0, 'B+': 0, 'B': 0, 'C': 0 },
        bundles: [],
      }));

      // Global tracking
      let globalFemaleCount = 0;
      let globalMaleCount = 0;
      let globalTotalAge = 0;
      let globalAgeCount = 0;
      const globalRatingCounts: Record<string, number> = { 'A': 0, 'B+': 0, 'B': 0, 'C': 0 };

      // PHASE 3: Greedy Assignment with Enhanced Scoring
      const assignments: { bundle: GroupBundle; blockNumber: number }[] = [];
      const skippedBundles: { id: string; reason: string }[] = [];

      for (const bundle of bundles) {
        // Find feasible blocks (enough capacity)
        let feasibleBlocks = blocks.filter(
          (block) => block.seatsUsed + bundle.size <= SEATS_PER_BLOCK
        );

        // CRITICAL: C-rated contestants can ONLY go to NPB blocks
        if (bundle.hasCRating) {
          feasibleBlocks = feasibleBlocks.filter(block => block.blockType === 'NPB');
          
          if (feasibleBlocks.length === 0) {
            console.log(`Warning: Could not place group ${bundle.id} with C-rated contestants - no NPB blocks with capacity`);
            skippedBundles.push({ id: bundle.id, reason: 'C-rated contestants require NPB block, none available with capacity' });
            continue;
          }
        }

        if (feasibleBlocks.length === 0) {
          console.log(`Warning: Could not place group ${bundle.id} (size ${bundle.size}) - no block has capacity`);
          skippedBundles.push({ id: bundle.id, reason: 'No block has capacity' });
          continue;
        }

        // Score each feasible block
        type BlockScore = {
          block: BlockState;
          score: number;
        };

        const scored: BlockScore[] = feasibleBlocks.map((block) => {
          // Simulate adding bundle to block
          const newSeatsUsed = block.seatsUsed + bundle.size;
          const newFemaleCount = block.femaleCount + bundle.femaleCount;
          const newMaleCount = block.maleCount + bundle.maleCount;
          const newTotal = newFemaleCount + newMaleCount;
          const newFemaleRatio = newTotal > 0 ? newFemaleCount / newTotal : 0;
          const newTotalAge = block.totalAge + bundle.totalAge;
          const newAgeCount = block.ageCount + bundle.size;
          const newMeanAge = newAgeCount > 0 ? newTotalAge / newAgeCount : 0;

          // Simulate rating counts
          const newRatingCounts = { ...block.ratingCounts };
          Object.keys(bundle.ratingCounts).forEach(rating => {
            newRatingCounts[rating] += bundle.ratingCounts[rating];
          });

          // Simulate global state
          const simGlobalFemale = globalFemaleCount + bundle.femaleCount;
          const simGlobalMale = globalMaleCount + bundle.maleCount;
          const simGlobalTotal = simGlobalFemale + simGlobalMale;
          const simGlobalRatio = simGlobalTotal > 0 ? simGlobalFemale / simGlobalTotal : 0;

          // Calculate global mean age
          const simGlobalTotalAge = globalTotalAge + bundle.totalAge;
          const simGlobalAgeCount = globalAgeCount + bundle.size;
          const simGlobalMeanAge = simGlobalAgeCount > 0 ? simGlobalTotalAge / simGlobalAgeCount : 0;

          // Scoring components (lower is better)
          let score = 0;

          // 1. Gender penalty - quadratic distance from target
          const genderDeviation = Math.abs(newFemaleRatio - TARGET_FEMALE_RATIO);
          score += genderDeviation * genderDeviation * 1000;

          // 2. Global ratio constraint - heavy penalty if violating
          if (simGlobalRatio < TARGET_FEMALE_MIN || simGlobalRatio > TARGET_FEMALE_MAX) {
            score += 10000;
          }

          // 3. Age deviation penalty - prefer blocks close to global mean age
          const ageDeviation = Math.abs(newMeanAge - simGlobalMeanAge);
          score += ageDeviation * 2;

          // 4. Rating balance penalty - prefer even distribution of ratings
          const totalRatingsInBlock = Object.values(newRatingCounts).reduce((a, b) => a + b, 0);
          if (totalRatingsInBlock > 0) {
            // Calculate how uneven the rating distribution is (variance-like measure)
            const avgRatingCount = totalRatingsInBlock / RATING_ORDER.length;
            let ratingVariance = 0;
            RATING_ORDER.forEach(rating => {
              const deviation = newRatingCounts[rating] - avgRatingCount;
              ratingVariance += deviation * deviation;
            });
            score += ratingVariance * 5; // Penalize uneven rating distribution
          }

          // 5. Capacity utilization bonus - prefer filling blocks evenly
          const utilizationRatio = newSeatsUsed / SEATS_PER_BLOCK;
          score -= utilizationRatio * 50;

          // 6. Balance penalty - avoid very skewed gender blocks
          if (newTotal > 5) {
            if (newFemaleRatio < 0.3 || newFemaleRatio > 0.9) {
              score += 500;
            }
          }

          // 7. Prefer blocks that already have some variety in ratings
          const uniqueRatings = Object.values(newRatingCounts).filter(c => c > 0).length;
          score -= uniqueRatings * 10; // Bonus for diversity

          return { block, score };
        });

        // Pick best block (lowest score)
        scored.sort((a, b) => a.score - b.score);
        const bestBlock = scored[0].block;

        // Assign bundle to this block
        assignments.push({ bundle, blockNumber: bestBlock.blockNumber });

        // Update block state
        bestBlock.seatsUsed += bundle.size;
        bestBlock.femaleCount += bundle.femaleCount;
        bestBlock.maleCount += bundle.maleCount;
        bestBlock.totalAge += bundle.totalAge;
        bestBlock.ageCount += bundle.size;
        bestBlock.meanAge = bestBlock.ageCount > 0 ? bestBlock.totalAge / bestBlock.ageCount : 0;
        Object.keys(bundle.ratingCounts).forEach(rating => {
          bestBlock.ratingCounts[rating] += bundle.ratingCounts[rating];
        });
        bestBlock.bundles.push(bundle.id);

        // Update global state
        globalFemaleCount += bundle.femaleCount;
        globalMaleCount += bundle.maleCount;
        globalTotalAge += bundle.totalAge;
        globalAgeCount += bundle.size;
        Object.keys(bundle.ratingCounts).forEach(rating => {
          globalRatingCounts[rating] += bundle.ratingCounts[rating];
        });
      }

      // Check global ratio
      const totalAssigned = globalFemaleCount + globalMaleCount;
      const finalFemaleRatio = totalAssigned > 0 ? globalFemaleCount / totalAssigned : 0;
      
      // Calculate pool ratio
      const poolFemaleCount = available.filter(c => c.gender === "Female").length;
      const poolMaleCount = available.filter(c => c.gender === "Male").length;
      const poolTotal = poolFemaleCount + poolMaleCount;
      const poolFemaleRatio = poolTotal > 0 ? poolFemaleCount / poolTotal : 0;

      // If pool itself doesn't meet requirements, be flexible
      const poolMeetsRequirements = poolFemaleRatio >= TARGET_FEMALE_MIN && poolFemaleRatio <= TARGET_FEMALE_MAX;
      
      if (!poolMeetsRequirements) {
        console.log(`Warning: Available pool has ${(poolFemaleRatio * 100).toFixed(1)}% female, outside target range of 60-70%. Proceeding with assignment.`);
      } else if (finalFemaleRatio < TARGET_FEMALE_MIN || finalFemaleRatio > TARGET_FEMALE_MAX) {
        return res.status(400).json({
          error: `Could not achieve 60-70% female ratio. Final ratio: ${(finalFemaleRatio * 100).toFixed(1)}%`,
          availablePool: {
            femaleCount: poolFemaleCount,
            maleCount: poolMaleCount,
            total: poolTotal,
            femalePercentage: (poolFemaleRatio * 100).toFixed(1),
          },
          assigned: {
            femaleCount: globalFemaleCount,
            maleCount: globalMaleCount,
            total: totalAssigned,
            femalePercentage: (finalFemaleRatio * 100).toFixed(1),
          },
        });
      }

      // PHASE 4: Generate seat assignments (groups get consecutive seats WITHIN THE SAME ROW)
      type PlanItem = {
        contestant: typeof available[0];
        blockNumber: number;
        seatLabel: string;
      };

      const plan: PlanItem[] = [];
      
      // Helper to get seat labels within a row, ensuring groups don't span rows
      const assignSeatsToBundle = (
        bundle: GroupBundle,
        blockNumber: number,
        rowState: { currentRow: number; positionInRow: number }
      ): { seatLabels: string[]; newRowState: { currentRow: number; positionInRow: number } } => {
        const seatLabels: string[] = [];
        let { currentRow, positionInRow } = rowState;
        const bundleSize = bundle.size;
        
        // Check if the entire bundle fits in the remaining space of the current row
        const currentRowCapacity = ROWS[currentRow]?.count || 0;
        const remainingInRow = currentRowCapacity - positionInRow;
        
        if (remainingInRow < bundleSize) {
          // Bundle doesn't fit in current row - move to next row
          currentRow++;
          positionInRow = 0;
          
          // Find a row that can fit the entire bundle
          while (currentRow < ROWS.length && ROWS[currentRow].count < bundleSize) {
            currentRow++;
          }
        }
        
        // If we've run out of rows, just assign consecutively (fallback)
        if (currentRow >= ROWS.length) {
          currentRow = ROWS.length - 1; // Last row
          positionInRow = 0;
        }
        
        // Assign seats to all contestants in the bundle
        for (let i = 0; i < bundleSize; i++) {
          const row = ROWS[currentRow];
          if (!row) break;
          
          const seatLabel = `${row.label}${positionInRow + 1}`;
          seatLabels.push(seatLabel);
          positionInRow++;
          
          // Move to next row if current row is full
          if (positionInRow >= row.count) {
            currentRow++;
            positionInRow = 0;
          }
        }
        
        return {
          seatLabels,
          newRowState: { currentRow, positionInRow }
        };
      }
      
      // For each block, assign seats to bundles with row-aware logic
      for (const block of blocks) {
        const blockAssignments = assignments.filter(a => a.blockNumber === block.blockNumber);
        let rowState = { currentRow: 0, positionInRow: 0 };

        for (const { bundle } of blockAssignments) {
          const { seatLabels, newRowState } = assignSeatsToBundle(bundle, block.blockNumber, rowState);
          rowState = newRowState;
          
          // All contestants in a bundle get consecutive seats in the same row
          bundle.contestants.forEach((contestant, idx) => {
            plan.push({
              contestant,
              blockNumber: block.blockNumber,
              seatLabel: seatLabels[idx] || `E${idx + 1}`, // Fallback
            });
          });
        }
      }

      // PHASE 5: Persist the plan to database with transaction-like semantics
      const createdAssignments: any[] = [];
      const contestantUpdates: string[] = [];
      
      try {
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

        for (const contestantId of contestantUpdates) {
          await storage.updateContestantAvailability(contestantId, "assigned");
        }

        res.json({
          message: `Assigned ${totalAssigned} contestants to seats`,
          assignments: createdAssignments,
          skippedAPlusCount: aPlusContestants.length,
          skippedAPlusNames: aPlusContestants.map(c => c.name),
          skippedBundles: skippedBundles.length > 0 ? skippedBundles : undefined,
          demographics: {
            femaleCount: globalFemaleCount,
            maleCount: globalMaleCount,
            femalePercentage: (finalFemaleRatio * 100).toFixed(1),
            targetRange: "60-70%",
            meetsTarget: finalFemaleRatio >= TARGET_FEMALE_MIN && finalFemaleRatio <= TARGET_FEMALE_MAX,
            warning: !poolMeetsRequirements ? `Available pool has ${(poolFemaleRatio * 100).toFixed(1)}% female, outside target range` : undefined,
          },
          ratingDistribution: globalRatingCounts,
          blockStats: blocks.map(b => ({
            block: b.blockNumber,
            blockType: b.blockType || 'Not set',
            seats: b.seatsUsed,
            females: b.femaleCount,
            males: b.maleCount,
            femaleRatio: b.femaleCount + b.maleCount > 0 ? (b.femaleCount / (b.femaleCount + b.maleCount) * 100).toFixed(1) + '%' : 'N/A',
            meanAge: b.meanAge.toFixed(1),
            ratings: b.ratingCounts,
          })).filter(b => b.seats > 0)
        });
      } catch (persistError: any) {
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

  // Get block types for a record day
  app.get("/api/record-days/:id/block-types", async (req, res) => {
    try {
      const recordDayId = req.params.id;
      const blockTypesData = await storage.getBlockTypesByRecordDay(recordDayId);
      res.json(blockTypesData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update block type (PB/NPB) for a specific block on a record day
  app.put("/api/record-days/:id/block-types/:blockNumber", async (req, res) => {
    try {
      const { id: recordDayId, blockNumber } = req.params;
      const { blockType } = req.body;
      
      const blockNum = parseInt(blockNumber);
      if (isNaN(blockNum) || blockNum < 1 || blockNum > 7) {
        return res.status(400).json({ error: "Block number must be between 1 and 7" });
      }
      
      if (!['PB', 'NPB'].includes(blockType)) {
        return res.status(400).json({ error: "Block type must be 'PB' or 'NPB'" });
      }
      
      const updated = await storage.upsertBlockType(recordDayId, blockNum, blockType);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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

  // Update booking workflow fields for a seat assignment
  app.patch("/api/seat-assignments/:id/workflow", async (req, res) => {
    try {
      const allowedFields = [
        'firstNations', 'rating', 'location', 'medicalQuestion', 
        'criminalBankruptcy', 'castingCategory', 'notes', 
        'bookingEmailSent', 'confirmedRsvp', 'paperworkSent', 
        'paperworkReceived', 'signedIn', 'otdNotes', 'standbyReplacementSwaps'
      ];
      
      const timestampFields = [
        'bookingEmailSent', 'confirmedRsvp', 'paperworkSent', 
        'paperworkReceived', 'signedIn'
      ];
      
      const workflowFields: any = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (allowedFields.includes(key)) {
          if (timestampFields.includes(key)) {
            if (typeof value === 'boolean') {
              workflowFields[key] = value ? new Date() : null;
            } else if (value === null || value === undefined) {
              workflowFields[key] = null;
            } else if (typeof value === 'string') {
              workflowFields[key] = new Date(value);
            } else {
              workflowFields[key] = value;
            }
          } else {
            workflowFields[key] = value;
          }
        }
      }
      
      if (Object.keys(workflowFields).length === 0) {
        return res.status(400).json({ error: "No valid workflow fields provided" });
      }
      
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, workflowFields);
      
      if (!updated) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete seat assignment (remove from record day)
  app.delete("/api/seat-assignments/:id", async (req, res) => {
    try {
      // Get assignment to find contestant
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }

      // Delete the assignment (storage handles updating contestant status)
      await storage.deleteSeatAssignment(req.params.id);
      res.json({ message: "Seat assignment removed" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel seat assignment (move to reschedule)
  app.post("/api/seat-assignments/:id/cancel", async (req, res) => {
    try {
      const { reason } = req.body;
      const canceled = await storage.cancelSeatAssignment(req.params.id, reason);
      res.json(canceled);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all canceled assignments
  app.get("/api/canceled-assignments", async (req, res) => {
    try {
      const canceled = await storage.getCanceledAssignments();
      res.json(canceled);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete canceled assignment (when rebooking or permanently removing)
  app.delete("/api/canceled-assignments/:id", async (req, res) => {
    try {
      await storage.deleteCanceledAssignment(req.params.id);
      res.json({ message: "Canceled assignment removed" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Availability Management Routes

  // Generate tokens and prepare to send availability check emails
  app.post("/api/availability/send", async (req, res) => {
    try {
      const { contestantIds, recordDayIds } = req.body;

      if (!contestantIds || !Array.isArray(contestantIds) || contestantIds.length === 0) {
        return res.status(400).json({ error: "contestantIds array is required" });
      }

      if (!recordDayIds || !Array.isArray(recordDayIds) || recordDayIds.length === 0) {
        return res.status(400).json({ error: "recordDayIds array is required" });
      }

      const tokensCreated = [];

      for (const contestantId of contestantIds) {
        // Revoke any existing active tokens for this contestant
        await storage.revokeContestantTokens(contestantId);

        // Generate new cryptographically strong token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

        // Create token record
        const tokenRecord = await storage.createAvailabilityToken({
          contestantId,
          token,
          status: 'active',
          expiresAt,
          lastSentAt: new Date(),
        });

        // Initialize availability records for this contestant for all specified record days
        for (const recordDayId of recordDayIds) {
          await storage.upsertContestantAvailability(
            contestantId,
            recordDayId,
            'pending'
          );
        }

        tokensCreated.push({
          contestantId,
          token: tokenRecord.token,
          responseUrl: `/availability/respond/${tokenRecord.token}`,
        });
      }

      // TODO: When email integration is ready, send emails here
      // For now, just return the tokens
      res.json({
        message: `Tokens generated for ${tokensCreated.length} contestants`,
        tokens: tokensCreated,
        note: "Email sending is not yet configured. Add RESEND_API_KEY and FROM_EMAIL to enable."
      });
    } catch (error: any) {
      console.error("Error sending availability checks:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get contestant and record day context for a token (public endpoint - no auth)
  app.get("/api/availability/token/:token", async (req, res) => {
    try {
      const { token } = req.params;

      // Validate token
      const tokenRecord = await storage.getAvailabilityTokenByToken(token);
      
      if (!tokenRecord) {
        return res.status(404).json({ error: "Invalid token" });
      }

      if (tokenRecord.status !== 'active') {
        return res.status(400).json({ error: "Token is no longer active" });
      }

      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Token has expired" });
      }

      // Get contestant info
      const contestant = await storage.getContestantById(tokenRecord.contestantId);
      
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }

      // Get group info if contestant is in a group
      let groupMembers: Array<{ id: string; name: string }> = [];
      if (contestant.groupId) {
        const allContestants = await storage.getContestants();
        groupMembers = allContestants
          .filter(c => c.groupId === contestant.groupId && c.id !== contestant.id)
          .map(c => ({ id: c.id, name: c.name }));
      }

      // Get all record days
      const recordDays = await storage.getRecordDays();

      // Get contestant's current availability responses
      const availability = await storage.getContestantAvailability(tokenRecord.contestantId);

      res.json({
        contestant: {
          id: contestant.id,
          name: contestant.name,
          age: contestant.age,
          gender: contestant.gender,
        },
        groupMembers,
        recordDays: recordDays.map(rd => ({
          id: rd.id,
          date: rd.date,
          totalSeats: rd.totalSeats,
        })),
        currentAvailability: availability,
      });
    } catch (error: any) {
      console.error("Error fetching token context:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Submit availability response (public endpoint - no auth)
  app.post("/api/availability/respond/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { responses, applyToGroup, notes } = req.body;

      // Validate token
      const tokenRecord = await storage.getAvailabilityTokenByToken(token);
      
      if (!tokenRecord) {
        return res.status(404).json({ error: "Invalid token" });
      }

      if (tokenRecord.status !== 'active') {
        return res.status(400).json({ error: "Token is no longer active" });
      }

      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Token has expired" });
      }

      if (!responses || !Array.isArray(responses)) {
        return res.status(400).json({ error: "responses array is required" });
      }

      // Get contestant to check for group membership
      const contestant = await storage.getContestantById(tokenRecord.contestantId);
      
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }

      // Save availability responses for this contestant
      for (const response of responses) {
        await storage.upsertContestantAvailability(
          tokenRecord.contestantId,
          response.recordDayId,
          response.responseValue,
          notes
        );
      }

      // If apply to group is enabled and contestant has a group, apply to group members
      if (applyToGroup && contestant.groupId) {
        const allContestants = await storage.getContestants();
        const groupMembers = allContestants.filter(
          c => c.groupId === contestant.groupId && c.id !== contestant.id
        );

        for (const member of groupMembers) {
          for (const response of responses) {
            await storage.upsertContestantAvailability(
              member.id,
              response.recordDayId,
              response.responseValue,
              applyToGroup ? `Applied from ${contestant.name}: ${notes || ''}` : notes
            );
          }
        }
      }

      // Mark token as used
      await storage.updateTokenStatus(tokenRecord.id, 'used');

      res.json({
        message: "Availability responses saved successfully",
        appliedToGroupMembers: applyToGroup && contestant.groupId,
      });
    } catch (error: any) {
      console.error("Error saving availability response:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get availability status overview for admin
  app.get("/api/availability/status", async (req, res) => {
    try {
      const contestants = await storage.getContestants();
      const tokens = await Promise.all(
        contestants.map(c => storage.getAvailabilityTokensByContestant(c.id))
      );

      const stats = {
        total: contestants.length,
        sent: tokens.filter(t => t.length > 0 && t.some(tk => tk.status === 'active' || tk.status === 'used')).length,
        responded: tokens.filter(t => t.some(tk => tk.status === 'used')).length,
        pending: tokens.filter(t => t.some(tk => tk.status === 'active')).length,
      };

      res.json(stats);
    } catch (error: any) {
      console.error("Error fetching availability status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all availability tokens with contestant info for tracking table
  app.get("/api/availability/tokens", async (req, res) => {
    try {
      const contestants = await storage.getContestants();
      const tokensWithContestants = [];

      for (const contestant of contestants) {
        const tokens = await storage.getAvailabilityTokensByContestant(contestant.id);
        if (tokens.length > 0) {
          // Get the most recent token for this contestant
          const latestToken = tokens.sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
          
          tokensWithContestants.push({
            ...latestToken,
            contestant: {
              id: contestant.id,
              name: contestant.name,
              email: contestant.email,
              phone: contestant.phone,
            },
          });
        }
      }

      res.json(tokensWithContestants);
    } catch (error: any) {
      console.error("Error fetching availability tokens:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get response statistics breakdown by record day
  app.get("/api/availability/stats-by-day", async (req, res) => {
    try {
      const recordDays = await storage.getRecordDays();
      const statsByDay = [];

      for (const recordDay of recordDays) {
        const availability = await storage.getAvailabilityByRecordDay(recordDay.id);
        
        const stats = {
          recordDayId: recordDay.id,
          date: recordDay.date,
          rxNumber: recordDay.rxNumber,
          yes: availability.filter(a => a.responseValue === 'yes').length,
          maybe: availability.filter(a => a.responseValue === 'maybe').length,
          no: availability.filter(a => a.responseValue === 'no').length,
          pending: availability.filter(a => a.responseValue === 'pending').length,
          total: availability.length,
        };
        
        statsByDay.push(stats);
      }

      res.json(statsByDay);
    } catch (error: any) {
      console.error("Error fetching availability stats by day:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get contestants filtered by availability for a specific record day
  app.get("/api/availability/record-day/:recordDayId", async (req, res) => {
    try {
      const { recordDayId } = req.params;

      // Handle "all" case gracefully - return empty array
      if (recordDayId === "all") {
        return res.json([]);
      }

      // Validate record day exists
      const recordDay = await storage.getRecordDayById(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }

      // Get availability data with contestant info
      const availabilityWithContestants = await storage.getAvailabilityByRecordDay(recordDayId);

      res.json(availabilityWithContestants);
    } catch (error: any) {
      console.error("Error fetching availability by record day:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Booking Confirmation Routes
  // ========================================

  // Send booking confirmation emails for selected seat assignments
  app.post("/api/booking-confirmations/send", async (req, res) => {
    try {
      const { seatAssignmentIds } = req.body;

      if (!seatAssignmentIds || !Array.isArray(seatAssignmentIds)) {
        return res.status(400).json({ error: "seatAssignmentIds array is required" });
      }

      const results = [];

      for (const seatAssignmentId of seatAssignmentIds) {
        // Get seat assignment with contestant and record day data
        const assignment = await storage.getSeatAssignmentById(seatAssignmentId);
        
        if (!assignment) {
          results.push({
            seatAssignmentId,
            success: false,
            error: "Seat assignment not found",
          });
          continue;
        }

        const contestant = await storage.getContestantById(assignment.contestantId);
        const recordDay = await storage.getRecordDayById(assignment.recordDayId);

        if (!contestant || !recordDay) {
          results.push({
            seatAssignmentId,
            success: false,
            error: "Contestant or record day not found",
          });
          continue;
        }

        if (!contestant.email) {
          results.push({
            seatAssignmentId,
            success: false,
            error: "Contestant has no email address",
          });
          continue;
        }

        // Check for existing token and revoke it
        const existingToken = await storage.getBookingConfirmationBySeatAssignment(seatAssignmentId);
        if (existingToken) {
          await storage.revokeBookingConfirmationToken(seatAssignmentId);
        }

        // Generate cryptographically strong token
        const token = crypto.randomBytes(32).toString('hex');
        
        // Token expires in 7 days
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        // Create token record
        const tokenRecord = await storage.createBookingConfirmationToken({
          seatAssignmentId,
          token,
          expiresAt,
          lastSentAt: new Date(),
          status: 'active',
          confirmationStatus: 'pending',
        });

        // Generate response URL
        const responseUrl = `/booking-confirmation/${token}`;

        // EMAIL SENDING STUBBED (like availability system)
        // When Outlook integration is set up, send email here:
        // await sendBookingConfirmationEmail(contestant.email, {
        //   name: contestant.name,
        //   recordDate: recordDay.date,
        //   seatLocation: `Block ${assignment.blockNumber}, Seat ${assignment.seatLabel}`,
        //   confirmationUrl: responseUrl,
        // });

        console.log(`📧 [STUBBED] Booking confirmation email for ${contestant.name} (${contestant.email})`);
        console.log(`   Record Date: ${recordDay.date}`);
        console.log(`   Seat: Block ${assignment.blockNumber}, ${assignment.seatLabel}`);
        console.log(`   Confirmation URL: ${responseUrl}`);

        // Update bookingEmailSent timestamp
        await storage.updateSeatAssignmentWorkflow(seatAssignmentId, {
          bookingEmailSent: new Date(),
        });

        results.push({
          seatAssignmentId,
          success: true,
          contestantName: contestant.name,
          email: contestant.email,
          responseUrl,
        });
      }

      res.json({
        message: `Processed ${results.length} booking confirmations`,
        results,
        emailsStubbed: true,
      });
    } catch (error: any) {
      console.error("Error sending booking confirmations:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get booking confirmation details by token (public endpoint - no auth)
  app.get("/api/booking-confirmations/token/:token", async (req, res) => {
    try {
      const { token } = req.params;

      // Validate token
      const tokenRecord = await storage.getBookingConfirmationByToken(token);
      
      if (!tokenRecord) {
        return res.status(404).json({ error: "Invalid confirmation link" });
      }

      // Check if token has been used
      if (tokenRecord.confirmationStatus !== 'pending') {
        return res.status(410).json({ 
          error: "This confirmation link has already been used",
          alreadyUsed: true,
          previousResponse: tokenRecord.confirmationStatus
        });
      }

      if (tokenRecord.status === 'revoked') {
        return res.status(403).json({ error: "This confirmation link has been revoked" });
      }

      if (tokenRecord.status !== 'active') {
        return res.status(403).json({ error: "This confirmation link is no longer active" });
      }

      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This confirmation link has expired" });
      }

      // Get seat assignment, contestant, and record day
      const assignment = await storage.getSeatAssignmentById(tokenRecord.seatAssignmentId);
      
      if (!assignment) {
        return res.status(404).json({ error: "Booking not found" });
      }

      const contestant = await storage.getContestantById(assignment.contestantId);
      const recordDay = await storage.getRecordDayById(assignment.recordDayId);

      if (!contestant || !recordDay) {
        return res.status(404).json({ error: "Booking details not found" });
      }

      // Get group members if applicable
      let groupMembers: Array<{ id: string; name: string }> = [];
      if (contestant.groupId) {
        const allContestants = await storage.getContestants();
        groupMembers = allContestants
          .filter(c => c.groupId === contestant.groupId && c.id !== contestant.id)
          .map(c => ({ id: c.id, name: c.name }));
      }

      res.json({
        contestant: {
          id: contestant.id,
          name: contestant.name,
          age: contestant.age,
          gender: contestant.gender,
          attendingWith: contestant.attendingWith,
        },
        groupMembers,
        booking: {
          recordDate: recordDay.date,
          seatLocation: `Block ${assignment.blockNumber}, Seat ${assignment.seatLabel}`,
        },
        confirmationStatus: tokenRecord.confirmationStatus,
        currentAttendingWith: tokenRecord.attendingWith || contestant.attendingWith,
        currentNotes: tokenRecord.notes,
      });
    } catch (error: any) {
      console.error("Error fetching booking confirmation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Submit booking confirmation response (public endpoint - no auth)
  app.post("/api/booking-confirmations/respond/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { confirmationStatus, attendingWith, notes } = req.body;

      // Validate token
      const tokenRecord = await storage.getBookingConfirmationByToken(token);
      
      if (!tokenRecord) {
        return res.status(404).json({ error: "Invalid confirmation link" });
      }

      // Check if token has already been used
      if (tokenRecord.confirmationStatus !== 'pending') {
        return res.status(410).json({ 
          error: "This confirmation link has already been used",
          alreadyResponded: true,
          previousResponse: tokenRecord.confirmationStatus
        });
      }

      if (tokenRecord.status === 'revoked') {
        return res.status(403).json({ error: "This confirmation link has been revoked" });
      }

      if (tokenRecord.status !== 'active') {
        return res.status(403).json({ error: "This confirmation link is no longer active" });
      }

      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This confirmation link has expired" });
      }

      if (!confirmationStatus || !['confirmed', 'declined'].includes(confirmationStatus)) {
        return res.status(400).json({ error: "Valid confirmationStatus required (confirmed or declined)" });
      }

      // Get seat assignment
      const assignment = await storage.getSeatAssignmentById(tokenRecord.seatAssignmentId);
      
      if (!assignment) {
        return res.status(404).json({ error: "Booking not found" });
      }

      // Update confirmation response (this also marks token as 'used')
      // This uses a transactional WHERE clause to prevent race conditions
      const updatedToken = await storage.updateBookingConfirmationResponse(
        tokenRecord.id,
        confirmationStatus,
        attendingWith,
        notes
      );

      // If update failed, token was already used (race condition)
      if (!updatedToken) {
        return res.status(409).json({ 
          error: "This confirmation link has already been used",
          alreadyResponded: true
        });
      }

      // Update seat assignment workflow based on response
      if (confirmationStatus === 'confirmed') {
        // Update confirmedRsvp timestamp
        await storage.updateSeatAssignmentWorkflow(tokenRecord.seatAssignmentId, {
          confirmedRsvp: new Date(),
        });

        // Update contestant's attendingWith if provided
        if (attendingWith) {
          await storage.updateContestantAttendingWith(assignment.contestantId, attendingWith);
        }
      } else if (confirmationStatus === 'declined') {
        // Cancel the booking and move to reschedule list
        await storage.cancelSeatAssignment(
          tokenRecord.seatAssignmentId,
          `Declined confirmation: ${notes || 'No reason provided'}`
        );
      }

      res.json({
        message: confirmationStatus === 'confirmed' 
          ? "Booking confirmed successfully!" 
          : "Booking cancelled. You've been moved to the reschedule list.",
        confirmationStatus,
      });
    } catch (error: any) {
      console.error("Error processing confirmation response:", error);
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
