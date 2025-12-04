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
import { getUncachableGmailClient, sendEmail, sendEmailWithAttachment, getInboxMessages, ParsedEmail, EmailConfig, isGmailAvailable } from "./gmail";
import { syncRecordDayToSheet, createSheetHeader, updateCellInRecordDaySheet, updateRowInRecordDaySheet, getRecordDaySheetData, isGoogleSheetsAvailable } from "./google-sheets";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

// Google Sheets config keys for database storage
const SHEETS_SPREADSHEET_ID_KEY = 'google_sheets_spreadsheet_id';
const SHEETS_LAST_SYNC_KEY = 'google_sheets_last_sync';
const SHEETS_AUTO_SYNC_KEY = 'google_sheets_auto_sync';

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

  // Generate real photos for ALL contestants
  app.post("/api/contestants/generate-avatars", async (req, res) => {
    try {
      const contestants = await storage.getContestants();
      let updatedCount = 0;
      let femaleIndex = 0;
      let maleIndex = 0;
      
      for (const contestant of contestants) {
        // Generate photo URL using randomuser.me portraits for everyone
        let photoUrl: string;
        if (contestant.gender === 'Female') {
          photoUrl = `https://randomuser.me/api/portraits/women/${femaleIndex % 100}.jpg`;
          femaleIndex++;
        } else {
          photoUrl = `https://randomuser.me/api/portraits/men/${maleIndex % 100}.jpg`;
          maleIndex++;
        }
        
        await storage.updateContestantPhoto(contestant.id, photoUrl);
        updatedCount++;
      }
      
      res.json({ 
        message: `Generated photos for ${updatedCount} contestants`,
        updatedCount 
      });
    } catch (error) {
      console.error("Photo generation error:", error);
      res.status(500).json({ error: "Failed to generate photos" });
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
          location: row.ADDRESS || row.Address || row.address || 
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
          location: row.location,
          medicalInfo: row.medicalInfo,
          mobilityNotes: row.mobilityNotes,
          criminalRecord: row.criminalRecord,
          groupId: nameToGroupId.get(row.name) || null,
          availabilityStatus: "available",
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
      // First names by gender
      const femaleFirstNames = [
        "Emma", "Olivia", "Ava", "Isabella", "Sophia", "Mia", "Charlotte", "Amelia", "Harper", "Evelyn",
        "Abigail", "Emily", "Elizabeth", "Sofia", "Avery", "Ella", "Scarlett", "Grace", "Victoria", "Riley",
        "Aria", "Lily", "Aubrey", "Zoey", "Penelope", "Chloe", "Layla", "Lillian", "Nora", "Hazel",
        "Madison", "Ellie", "Hannah", "Paisley", "Natalie", "Addison", "Brooklyn", "Leah", "Savannah", "Audrey",
        "Claire", "Eleanor", "Skylar", "Eliana", "Naomi", "Maya", "Elena", "Sarah", "Allison", "Gabriella",
        "Alice", "Madelyn", "Cora", "Ruby", "Eva", "Serenity", "Autumn", "Adeline", "Hailey", "Gianna",
        "Valentina", "Isla", "Eliza", "Quinn", "Nevaeh", "Ivy", "Sadie", "Piper", "Lydia", "Alexa"
      ];
      const maleFirstNames = [
        "Liam", "Noah", "Oliver", "Elijah", "James", "William", "Benjamin", "Lucas", "Henry", "Theodore",
        "Jack", "Levi", "Alexander", "Mason", "Ethan", "Jacob", "Michael", "Daniel", "Logan", "Jackson",
        "Sebastian", "Aiden", "Owen", "Samuel", "Ryan", "Nathan", "David", "Joseph", "John", "Luke",
        "Anthony", "Isaac", "Dylan", "Wyatt", "Andrew", "Joshua", "Christopher", "Grayson", "Jayden", "Matthew",
        "Leo", "Lincoln", "Mateo", "Adam", "Caleb", "Christian", "Jaxon", "Julian", "Cameron", "Aaron",
        "Thomas", "Charles", "Josiah", "Ezra", "Isaiah", "Colton", "Hunter", "Adrian", "Nolan", "Connor"
      ];
      const lastNames = [
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
        "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
        "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
        "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
        "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
        "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes",
        "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper"
      ];
      const cities = [
        "Los Angeles", "San Diego", "San Francisco", "Sacramento", "Fresno", "Oakland", "Long Beach",
        "Bakersfield", "Anaheim", "Santa Ana", "Riverside", "Stockton", "Irvine", "Chula Vista", "Fremont",
        "San Jose", "Pasadena", "Burbank", "Glendale", "Torrance", "Pomona", "Santa Monica", "Newport Beach"
      ];
      const ratings = ["A+", "A", "B+", "B", "C"];
      const ratingWeights = [0.05, 0.15, 0.25, 0.35, 0.20]; // 5% A+, 15% A, 25% B+, 35% B, 20% C

      // Helper to pick weighted random rating
      const getWeightedRating = (): string => {
        const rand = Math.random();
        let cumulative = 0;
        for (let i = 0; i < ratings.length; i++) {
          cumulative += ratingWeights[i];
          if (rand < cumulative) return ratings[i];
        }
        return ratings[ratings.length - 1];
      };

      // Helper to generate email from name
      const generateEmail = (name: string): string => {
        const domains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];
        const cleanName = name.toLowerCase().replace(/\s+/g, '.');
        const randomNum = Math.floor(Math.random() * 99);
        const domain = domains[Math.floor(Math.random() * domains.length)];
        return `${cleanName}${randomNum}@${domain}`;
      };

      // Helper to generate photo URL using randomuser.me portraits
      let femalePhotoIndex = 0;
      let malePhotoIndex = 0;
      const generatePhotoUrl = (name: string, gender: string): string => {
        // randomuser.me has portraits numbered 0-99 for each gender
        if (gender === "Female") {
          const index = femalePhotoIndex % 100;
          femalePhotoIndex++;
          return `https://randomuser.me/api/portraits/women/${index}.jpg`;
        } else {
          const index = malePhotoIndex % 100;
          malePhotoIndex++;
          return `https://randomuser.me/api/portraits/men/${index}.jpg`;
        }
      };

      // Helper to generate phone number
      const generatePhone = (): string => {
        const areaCode = Math.floor(Math.random() * 900) + 100;
        const prefix = Math.floor(Math.random() * 900) + 100;
        const lineNum = Math.floor(Math.random() * 9000) + 1000;
        return `(${areaCode}) ${prefix}-${lineNum}`;
      };

      const fakeContestants: Array<{
        name: string;
        age: number;
        gender: "Male" | "Female";
        email: string;
        phone: string;
        location: string;
        auditionRating: string;
        photoUrl: string;
        attendingWith?: string;
      }> = [];

      // Generate 130 contestants - aim for ~60% female, 40% male
      const totalCount = 130;
      const femaleCount = Math.floor(totalCount * 0.60);
      const maleCount = totalCount - femaleCount;

      // Track used names to avoid duplicates
      const usedNames = new Set<string>();

      const generateUniqueName = (gender: "Male" | "Female"): string => {
        const firstNames = gender === "Female" ? femaleFirstNames : maleFirstNames;
        let name = "";
        let attempts = 0;
        do {
          const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
          const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
          name = `${firstName} ${lastName}`;
          attempts++;
        } while (usedNames.has(name) && attempts < 100);
        usedNames.add(name);
        return name;
      };

      // Generate females first
      for (let i = 0; i < femaleCount; i++) {
        const name = generateUniqueName("Female");
        const age = Math.floor(Math.random() * 40) + 21; // 21-60
        fakeContestants.push({
          name,
          age,
          gender: "Female",
          email: generateEmail(name),
          phone: generatePhone(),
          location: cities[Math.floor(Math.random() * cities.length)],
          auditionRating: getWeightedRating(),
          photoUrl: generatePhotoUrl(name, "Female"),
        });
      }

      // Generate males
      for (let i = 0; i < maleCount; i++) {
        const name = generateUniqueName("Male");
        const age = Math.floor(Math.random() * 40) + 21; // 21-60
        fakeContestants.push({
          name,
          age,
          gender: "Male",
          email: generateEmail(name),
          phone: generatePhone(),
          location: cities[Math.floor(Math.random() * cities.length)],
          auditionRating: getWeightedRating(),
          photoUrl: generatePhotoUrl(name, "Male"),
        });
      }

      // Create some groups (about 15 pairs)
      const shuffled = [...fakeContestants].sort(() => Math.random() - 0.5);
      for (let i = 0; i < 30; i += 2) {
        if (shuffled[i] && shuffled[i + 1]) {
          shuffled[i].attendingWith = shuffled[i + 1].name;
          shuffled[i + 1].attendingWith = shuffled[i].name;
          // Find and update in original array
          const idx1 = fakeContestants.findIndex(c => c.name === shuffled[i].name);
          const idx2 = fakeContestants.findIndex(c => c.name === shuffled[i + 1].name);
          if (idx1 >= 0) fakeContestants[idx1].attendingWith = shuffled[i + 1].name;
          if (idx2 >= 0) fakeContestants[idx2].attendingWith = shuffled[i].name;
        }
      }

      // Create contestants
      const createdContestants = [];

      for (const data of fakeContestants) {
        const contestant = await storage.createContestant({
          name: data.name,
          age: data.age,
          gender: data.gender,
          availabilityStatus: "available",
          attendingWith: data.attendingWith,
          email: data.email,
          phone: data.phone,
          location: data.location,
          auditionRating: data.auditionRating,
          photoUrl: data.photoUrl,
        });
        createdContestants.push(contestant);
      }

      // Count groups
      const groupCount = fakeContestants.filter(c => c.attendingWith).length / 2;

      res.json({ 
        message: `Generated ${createdContestants.length} fake contestants`,
        count: createdContestants.length,
        groups: Math.floor(groupCount),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all record days
  app.get("/api/record-days", async (req, res) => {
    try {
      const allRecordDays = await storage.getRecordDays();
      // Sort by date ascending (earliest first)
      const sorted = allRecordDays.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      res.json(sorted);
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
      
      // Check if contestant is already a standby for this record day
      const existingStandbys = await storage.getStandbyAssignmentsByRecordDay(recordDayId);
      const isContestantStandby = existingStandbys.some((s: any) => s.contestantId === contestantId);
      if (isContestantStandby) {
        return res.status(409).json({ error: "Contestant is already a standby for this record day. Remove them from standbys first." });
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
      const existingStandbys = await storage.getStandbyAssignmentsByRecordDay(recordDayId);
      
      // Check if any contestant is already seated or a standby in this record day
      for (const contestantId of contestantIds) {
        const isContestantSeated = existingAssignments.some((a: any) => a.contestantId === contestantId);
        if (isContestantSeated) {
          const contestant = await storage.getContestantById(contestantId);
          return res.status(409).json({ error: `${contestant?.name || 'A contestant'} is already seated in this record day` });
        }
        
        const isContestantStandby = existingStandbys.some((s: any) => s.contestantId === contestantId);
        if (isContestantStandby) {
          const contestant = await storage.getContestantById(contestantId);
          return res.status(409).json({ error: `${contestant?.name || 'A contestant'} is already a standby for this record day. Remove them from standbys first.` });
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
      const { blocks: selectedBlocks, onlyConfirmedAvailability } = req.body as { 
        blocks?: number[]; 
        onlyConfirmedAvailability?: boolean;
      };

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
      let availableAll = allContestants.filter((c) => c.availabilityStatus === "available");
      
      // If onlyConfirmedAvailability is true, filter to only contestants who confirmed for this record day
      if (onlyConfirmedAvailability) {
        const availabilityResponses = await storage.getAvailabilityByRecordDay(recordDayId);
        const confirmedContestantIds = new Set(
          availabilityResponses
            .filter(a => a.responseValue === 'yes')
            .map(a => a.contestantId)
        );
        availableAll = availableAll.filter(c => confirmedContestantIds.has(c.id));
      }
      
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
      const MAX_AUTO_ASSIGN_SEATS = 20; // Never fill more than 20 seats per block in auto-assign
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

      // PHASE 1: Create Group Bundles based on attendingWith matching
      // Build groups by matching contestants where Person A's attendingWith matches Person B's name
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

      // Build a name lookup map for matching attendingWith
      const nameToContestant = new Map<string, typeof available[0]>();
      available.forEach(c => {
        // Use lowercase for case-insensitive matching
        const key = c.name.toLowerCase().trim();
        nameToContestant.set(key, c);
      });

      // Track which contestants have been grouped
      const groupedContestantIds = new Set<string>();
      const groupMap = new Map<string, typeof available>();

      // First pass: find all groups based on attendingWith matching
      // BUT: Don't group anyone with an A+ contestant (A+ must be manually assigned)
      available.forEach((contestant) => {
        if (groupedContestantIds.has(contestant.id)) return;

        // Check if this contestant has an attendingWith value
        if (contestant.attendingWith && contestant.attendingWith.trim()) {
          // Split by comma or ampersand to handle multiple people (e.g., "John, Jane, Bob")
          const attendingWithNames = contestant.attendingWith
            .split(/[,&]/)
            .map((name: string) => name.toLowerCase().trim())
            .filter((name: string) => name.length > 0);

          // Find all matching people for this contestant
          const groupMembers: typeof available = [contestant];
          let hasNonAPlusPartners = false;

          for (const name of attendingWithNames) {
            const partner = nameToContestant.get(name);
            if (partner && !groupedContestantIds.has(partner.id)) {
              // Only add if not A+ rated (A+ must be manually assigned)
              if (partner.auditionRating !== 'A+') {
                groupMembers.push(partner);
                hasNonAPlusPartners = true;
              }
            }
          }

          // Create a group if we found at least one valid partner
          if (hasNonAPlusPartners && groupMembers.length > 1) {
            const groupId = `group-${contestant.id}`;
            groupMap.set(groupId, groupMembers);
            groupMembers.forEach(member => groupedContestantIds.add(member.id));
          }
        }
      });

      // Second pass: add solo contestants (those not in any group)
      available.forEach((contestant) => {
        if (!groupedContestantIds.has(contestant.id)) {
          const soloId = `solo-${contestant.id}`;
          groupMap.set(soloId, [contestant]);
        }
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
        // Find feasible blocks (capacity depends on block type)
        // PB blocks: max 20 seats, NPB blocks: can fill entire 22 seats
        let feasibleBlocks = blocks.filter((block) => {
          const maxSeats = block.blockType === 'NPB' ? SEATS_PER_BLOCK : MAX_AUTO_ASSIGN_SEATS;
          // Check capacity
          if (block.seatsUsed + bundle.size > maxSeats) return false;
          
          // CONSTRAINT: No block should exceed 70% female
          const newFemaleCount = block.femaleCount + bundle.femaleCount;
          const newMaleCount = block.maleCount + bundle.maleCount;
          const newTotal = newFemaleCount + newMaleCount;
          const newFemaleRatio = newTotal > 0 ? newFemaleCount / newTotal : 0;
          if (newFemaleRatio > 0.70) return false;
          
          // CONSTRAINT: NPB blocks can ONLY have B and C ratings (no A or B+)
          if (block.blockType === 'NPB') {
            const hasAOrBPlus = bundle.ratingCounts['A'] > 0 || bundle.ratingCounts['B+'] > 0;
            if (hasAOrBPlus) return false;
          }
          
          return true;
        });

        // CRITICAL: C-rated contestants can ONLY go to NPB blocks (max 6 per NPB block)
        if (bundle.hasCRating) {
          feasibleBlocks = feasibleBlocks.filter(block => {
            if (block.blockType !== 'NPB') return false;
            // Check if adding this bundle would exceed 6 C-rated contestants
            const cCount = block.ratingCounts['C'] + bundle.ratingCounts['C'];
            return cCount <= 6;
          });
          
          if (feasibleBlocks.length === 0) {
            console.log(`Warning: Could not place group ${bundle.id} with C-rated contestants - no NPB blocks with capacity`);
            skippedBundles.push({ id: bundle.id, reason: 'C-rated contestants require NPB block, none available with capacity (max 6 C-rated per NPB block)' });
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

      // PHASE 3B: Ensure all solos are assigned (solos always fill available spots)
      // Track which bundles were assigned
      const assignedBundleIds = new Set(assignments.map(a => a.bundle.id));
      
      // Find unassigned solo bundles
      const unassignedSoloBundles = bundles.filter(bundle => 
        !assignedBundleIds.has(bundle.id) && bundle.size === 1
      );
      
      // For each unassigned solo, find a block with available capacity
      for (const solo of unassignedSoloBundles) {
        // C-rated solos can ONLY go to NPB blocks (with max 6 C-rated per NPB block)
        let eligibleBlocks = blocks.filter(block => {
          const maxSeats = block.blockType === 'NPB' ? SEATS_PER_BLOCK : MAX_AUTO_ASSIGN_SEATS;
          if (block.seatsUsed + 1 > maxSeats) return false;
          
          if (solo.hasCRating) {
            if (block.blockType !== 'NPB') return false;
            const cCount = block.ratingCounts['C'] + solo.ratingCounts['C'];
            if (cCount > 6) return false;
          }
          
          return true;
        });
        
        if (eligibleBlocks.length === 0) {
          console.log(`Warning: Could not place solo ${solo.id} (${solo.contestants[0].name}) - no block has capacity`);
          skippedBundles.push({ id: solo.id, reason: 'No block has capacity for solo' });
          continue;
        }
        
        // Pick the first eligible block (or could use a simple strategy like least-filled block)
        const selectedBlock = eligibleBlocks[0];
        assignments.push({ bundle: solo, blockNumber: selectedBlock.blockNumber });
        
        // Update block state
        selectedBlock.seatsUsed += 1;
        selectedBlock.femaleCount += solo.femaleCount;
        selectedBlock.maleCount += solo.maleCount;
        selectedBlock.totalAge += solo.totalAge;
        selectedBlock.ageCount += 1;
        selectedBlock.meanAge = selectedBlock.ageCount > 0 ? selectedBlock.totalAge / selectedBlock.ageCount : 0;
        Object.keys(solo.ratingCounts).forEach(rating => {
          selectedBlock.ratingCounts[rating] += solo.ratingCounts[rating];
        });
        selectedBlock.bundles.push(solo.id);
        
        // Update global state
        globalFemaleCount += solo.femaleCount;
        globalMaleCount += solo.maleCount;
        globalTotalAge += solo.totalAge;
        globalAgeCount += 1;
        Object.keys(solo.ratingCounts).forEach(rating => {
          globalRatingCounts[rating] += solo.ratingCounts[rating];
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
      const poolMeetsRequirements = poolFemaleRatio >= TARGET_FEMALE_MIN && poolFemaleRatio <= TARGET_FEMALE_MAX;

      // Log warning if ratio is outside target, but proceed anyway
      if (finalFemaleRatio < TARGET_FEMALE_MIN || finalFemaleRatio > TARGET_FEMALE_MAX) {
        console.log(`Warning: Final ratio ${(finalFemaleRatio * 100).toFixed(1)}% is outside target 60-70%. Proceeding anyway.`);
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
        rowState: { currentRow: number; positionInRow: number },
        usedSeats: Set<string>
      ): { seatLabels: string[]; newRowState: { currentRow: number; positionInRow: number }; success: boolean } => {
        const seatLabels: string[] = [];
        const bundleSize = bundle.size;
        let { currentRow, positionInRow } = rowState;
        
        // Try to fit group in current row first (in remaining space)
        if (currentRow < ROWS.length) {
          const row = ROWS[currentRow];
          
          // Find consecutive empty seats in current row starting from positionInRow
          let consecutiveEmpty = 0;
          let startPos = -1;
          
          for (let pos = positionInRow; pos < row.count; pos++) {
            const seatLabel = `${row.label}${pos + 1}`;
            if (usedSeats.has(seatLabel)) {
              // Hit an occupied seat, reset count
              consecutiveEmpty = 0;
              startPos = -1;
            } else {
              if (startPos === -1) startPos = pos;
              consecutiveEmpty++;
              if (consecutiveEmpty >= bundleSize) {
                // Found enough consecutive empty seats!
                for (let i = 0; i < bundleSize; i++) {
                  const assignedLabel = `${row.label}${startPos + i + 1}`;
                  seatLabels.push(assignedLabel);
                  usedSeats.add(assignedLabel);
                }
                return {
                  seatLabels,
                  newRowState: { currentRow, positionInRow: startPos + bundleSize },
                  success: true
                };
              }
            }
          }
        }
        
        // Doesn't fit in current row - find next row with enough consecutive empty seats
        currentRow++;
        
        while (currentRow < ROWS.length) {
          const row = ROWS[currentRow];
          let consecutiveEmpty = 0;
          let firstEmptyPos = -1;
          
          // Count consecutive empty seats in this row from the start
          for (let pos = 0; pos < row.count; pos++) {
            const seat = `${row.label}${pos + 1}`;
            if (usedSeats.has(seat)) {
              consecutiveEmpty = 0;
              firstEmptyPos = -1;
            } else {
              if (firstEmptyPos === -1) firstEmptyPos = pos;
              consecutiveEmpty++;
              if (consecutiveEmpty >= bundleSize) {
                // Found enough consecutive empty seats!
                positionInRow = firstEmptyPos;
                for (let i = 0; i < bundleSize; i++) {
                  const seatLabel = `${row.label}${positionInRow + 1}`;
                  seatLabels.push(seatLabel);
                  usedSeats.add(seatLabel);
                  positionInRow++;
                }
                return {
                  seatLabels,
                  newRowState: { currentRow, positionInRow },
                  success: true
                };
              }
            }
          }
          
          currentRow++;
        }
        
        // No more rows available
        return {
          seatLabels: [],
          newRowState: rowState,
          success: false
        };
      }
      
      // Get existing seat assignments from database for this record day
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      
      // For each block, assign seats to bundles with row-aware logic
      for (const block of blocks) {
        const blockAssignments = assignments.filter(a => a.blockNumber === block.blockNumber);
        let rowState = { currentRow: 0, positionInRow: 0 };
        const usedSeats = new Set<string>(); // Track used seats per block
        
        // Pre-populate usedSeats with existing assignments in this block
        existingAssignments
          .filter(a => a.blockNumber === block.blockNumber)
          .forEach(a => {
            usedSeats.add(a.seatLabel);
          });
        
        // For PB blocks, reserve the last 2 adjacent seats in row E (E3 and E4) to ensure 
        // the 2 empty seats are next to each other in the same row.
        // Since auto-assign bundles are max size 2 (pairs from attendingWith matching),
        // E1-E2 still provides 2 consecutive seats for any pair, and rows A-D remain fully available.
        if (block.blockType === 'PB') {
          usedSeats.add('E3');
          usedSeats.add('E4');
        }

        for (const { bundle } of blockAssignments) {
          const result = assignSeatsToBundle(bundle, block.blockNumber, rowState, usedSeats);
          
          if (!result.success) {
            // Skip this bundle - no capacity left in block
            console.log(`Skipping bundle in block ${block.blockNumber} - no seat capacity`);
            continue;
          }
          
          rowState = result.newRowState;
          
          // All contestants in a bundle get consecutive seats in the same row
          bundle.contestants.forEach((contestant, idx) => {
            if (result.seatLabels[idx]) {
              plan.push({
                contestant,
                blockNumber: block.blockNumber,
                seatLabel: result.seatLabels[idx],
              });
            }
          });
        }
      }
      
      // PHASE 4B: Cleanup - Place any remaining solo contestants into any available single seat
      // This ensures all empty seats are filled (except reserved E3-E4 in PB blocks)
      const placedContestantIds = new Set(plan.map(p => p.contestant.id));
      const unplacedContestants = assignments
        .filter(a => a.bundle.size === 1) // Only solos
        .flatMap(a => a.bundle.contestants)
        .filter(c => !placedContestantIds.has(c.id));
      
      // For each unplaced solo, find any available empty seat in its assigned block
      for (const solo of unplacedContestants) {
        const assignment = assignments.find(a => 
          a.bundle.contestants.some(c => c.id === solo.id)
        );
        
        if (!assignment) continue;
        
        const blockNumber = assignment.blockNumber;
        
        // Build set of all occupied seats in this block (from plan and existing)
        const occupiedSeats = new Set<string>();
        plan
          .filter(p => p.blockNumber === blockNumber)
          .forEach(p => occupiedSeats.add(p.seatLabel));
        
        existingAssignments
          .filter(a => a.blockNumber === blockNumber)
          .forEach(a => occupiedSeats.add(a.seatLabel));
        
        // Reserve E3-E4 for PB blocks
        const block = blocks.find(b => b.blockNumber === blockNumber);
        if (block?.blockType === 'PB') {
          occupiedSeats.add('E3');
          occupiedSeats.add('E4');
        }
        
        // Find first available seat in this block
        let placed = false;
        for (const row of ROWS) {
          if (placed) break;
          for (let i = 1; i <= row.count; i++) {
            const seatLabel = `${row.label}${i}`;
            if (!occupiedSeats.has(seatLabel)) {
              plan.push({
                contestant: solo,
                blockNumber,
                seatLabel,
              });
              occupiedSeats.add(seatLabel);
              placed = true;
              break;
            }
          }
        }
        
        if (!placed) {
          console.log(`Warning: Could not place solo ${solo.name} in block ${blockNumber} - no available seats`);
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

  // Delete canceled assignment and return contestant to available pool
  app.delete("/api/canceled-assignments/:id", async (req, res) => {
    try {
      // First get the canceled assignment to find the contestant
      const canceledAssignments = await storage.getCanceledAssignments();
      const canceled = canceledAssignments.find(c => c.id === req.params.id);
      
      if (canceled) {
        // Update contestant status back to 'available' so they appear in contestants tab
        await storage.updateContestantAvailability(canceled.contestantId, 'available');
      }
      
      await storage.deleteCanceledAssignment(req.params.id);
      res.json({ message: "Contestant returned to available pool" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Availability Management Routes

  // Generate tokens and send availability check emails via Gmail
  app.post("/api/availability/send", async (req, res) => {
    try {
      // Check if Gmail integration is available
      if (!isGmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Gmail integration requires Replit Connectors or local OAuth setup." 
        });
      }

      const { contestantIds, recordDayIds } = req.body;

      if (!contestantIds || !Array.isArray(contestantIds) || contestantIds.length === 0) {
        return res.status(400).json({ error: "contestantIds array is required" });
      }

      if (!recordDayIds || !Array.isArray(recordDayIds) || recordDayIds.length === 0) {
        return res.status(400).json({ error: "recordDayIds array is required" });
      }

      const tokensCreated = [];
      const emailsSent = [];
      const emailsFailed = [];

      // Get record day info for email
      const recordDays = await Promise.all(
        recordDayIds.map(id => storage.getRecordDayById(id))
      );

      for (const contestantId of contestantIds) {
        const contestant = await storage.getContestantById(contestantId);
        if (!contestant) continue;

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

        // Send ONE email per contestant with all record days
        try {
          const baseUrl = process.env.REPLIT_DEPLOYMENT_URL || 'http://localhost:5000';
          if (!contestant.email) {
            throw new Error(`Contestant ${contestant.name} has no email address`);
          }

          const responseUrl = `${baseUrl}/availability/respond/${tokenRecord.token}`;
          
          // Format record day dates for the email
          const recordDaysList = recordDays
            .filter((rd): rd is NonNullable<typeof recordDays[0]> => rd !== null && rd !== undefined && rd.date !== undefined)
            .map(rd => new Date(rd.date!).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }))
            .join('\n  • ');

          // Create email with all record days listed
          const gmail = await getUncachableGmailClient();
          
          const emailContent = `
Hi ${contestant.name},

We need to confirm your availability for our upcoming recording sessions. Please respond to let us know which dates you can attend.

Recording Dates:
  • ${recordDaysList}

Please click the link below to select your availability for each date:
${responseUrl}

This link will expire in 14 days.

Thank you!
Deal or No Deal Production Team
          `.trim();

          const message = [
            `To: ${contestant.email}`,
            'Subject: Availability Confirmation Request - Multiple Dates',
            'Content-Type: text/plain; charset="UTF-8"',
            'MIME-Version: 1.0',
            '',
            emailContent
          ].join('\n');

          const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              raw: encodedMessage
            }
          });

          emailsSent.push({
            contestantId,
            email: contestant.email,
            recordDayId: null,
          });
        } catch (emailError: any) {
          console.error(`Failed to send email to ${contestant.email}:`, emailError);
          emailsFailed.push({
            contestantId,
            email: contestant.email,
            error: emailError.message,
          });
        }
      }

      res.json({
        message: `Processed ${tokensCreated.length} contestants`,
        emailsSent: emailsSent.length,
        emailsFailed: emailsFailed.length,
        tokens: tokensCreated,
        failures: emailsFailed.length > 0 ? emailsFailed : undefined,
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
      // Check if Gmail integration is available
      if (!isGmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Gmail integration requires Replit Connectors or local OAuth setup." 
        });
      }

      const { seatAssignmentIds, emailSubject, emailBody: customEmailBody, attachmentPaths } = req.body;

      if (!seatAssignmentIds || !Array.isArray(seatAssignmentIds)) {
        return res.status(400).json({ error: "seatAssignmentIds array is required" });
      }

      // Get base URL from request headers
      const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
      const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
      const baseUrl = `${protocol}://${host}`;

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
        const responseUrl = `${baseUrl}/booking-confirmation/${token}`;

        // Send booking confirmation email via Gmail
        try {
          const confirmationLink = `${baseUrl}/booking-confirmation/${token}`;
          const recordDate = new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          
          // Use custom email body if provided, otherwise use default HTML template
          let emailBody: string;
          if (customEmailBody) {
            // Replace placeholders in custom email body
            emailBody = customEmailBody
              .replace(/\{\{name\}\}/g, contestant.name)
              .replace(/\{\{date\}\}/g, recordDate)
              .replace(/\{\{block\}\}/g, String(assignment.blockNumber))
              .replace(/\{\{seat\}\}/g, assignment.seatLabel)
              .replace(/\{\{confirmationLink\}\}/g, confirmationLink);
          } else {
            // Get banner URL from system config or use default
            const bannerUrl = await storage.getSystemConfig('email_banner_url') || `${baseUrl}/uploads/branding/dond_banner.png`;
            
            // Get configurable text from system config with defaults
            const emailHeadline = await storage.getSystemConfig('booking_email_headline') || 'Your Booking is Confirmed!';
            const emailIntro = await storage.getSystemConfig('booking_email_intro') || 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.';
            const emailInstructions = await storage.getSystemConfig('booking_email_instructions') || 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.';
            const emailButtonText = await storage.getSystemConfig('booking_email_button_text') || 'Confirm Attendance';
            const emailAdditionalInstructions = await storage.getSystemConfig('booking_email_additional_instructions') || '';
            const emailFooter = await storage.getSystemConfig('booking_email_footer') || 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.';
            
            // Professional HTML email template with configurable content
            emailBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #2a0a0a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
    <!-- Full-width Banner Image -->
    <tr>
      <td style="padding: 0; line-height: 0;">
        <img src="${bannerUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />
      </td>
    </tr>
    
    <!-- Gold Title Bar -->
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 26px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${emailHeadline}
        </h1>
      </td>
    </tr>
    
    <!-- Content Card -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 35px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Hi ${contestant.name.split(' ')[0]},
              </p>
              
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                ${emailIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <!-- Booking Details Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                      Your Record Day Details
                    </h2>
                    <p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0 0 6px 0;">
                      <strong>Date:</strong> ${recordDate}
                    </p>
                    <p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0 0 6px 0;">
                      <strong>Time:</strong> 7:30AM
                    </p>
                    <p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0;">
                      <strong>Location:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008
                    </p>
                  </td>
                </tr>
              </table>
              
              <div style="color: #555555; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                ${emailInstructions.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <!-- Gold/Red CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 25px auto;">
                <tr>
                  <td style="background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%); border-radius: 8px; box-shadow: 0 4px 10px rgba(139,0,0,0.3);">
                    <a href="${confirmationLink}" target="_blank" style="display: inline-block; padding: 16px 40px; color: #2a0a0a; text-decoration: none; font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px;">${emailButtonText}</a>
                  </td>
                </tr>
              </table>
              
              ${emailAdditionalInstructions ? `
              <!-- Additional Instructions -->
              <div style="margin: 25px 0 0 0;">
                ${emailAdditionalInstructions.split('\n\n').map((paragraph: string) => 
                  `<p style="color: #444444; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              ` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    
    <!-- Footer -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 15px 30px 30px 30px; text-align: center;">
        <p style="color: #aa8888; font-size: 11px; line-height: 1.6; margin: 0;">
          ${emailFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
          }
          
          const subject = emailSubject || 'Deal or No Deal - Booking Confirmation Required';
          
          // Get sender name from system config
          const senderNameConfig = await storage.getSystemConfig('email_sender_name');
          const emailConfig: EmailConfig = {
            senderName: senderNameConfig || 'Deal or No Deal',
          };
          
          // Check if there are attachments to include
          if (attachmentPaths && Array.isArray(attachmentPaths) && attachmentPaths.length > 0) {
            const objectStorageService = new ObjectStorageService();
            const attachments = [];
            
            for (const attachmentPath of attachmentPaths) {
              try {
                const { buffer, contentType, filename } = await objectStorageService.getObjectAsBuffer(attachmentPath);
                attachments.push({ content: buffer, contentType, filename });
              } catch (attachErr: any) {
                console.error(`Failed to load attachment ${attachmentPath}:`, attachErr.message);
              }
            }
            
            if (attachments.length > 0) {
              await sendEmailWithAttachment(contestant.email, subject, emailBody, attachments, emailConfig);
            } else {
              await sendEmail(contestant.email, subject, emailBody, undefined, emailConfig);
            }
          } else {
            await sendEmail(contestant.email, subject, emailBody, undefined, emailConfig);
          }
        } catch (error: any) {
          console.error(`Failed to send booking confirmation email to ${contestant.email}:`, error.message);
        }

        // Create a booking message record for this initial email
        const recordDateForLog = new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const confirmationLinkForLog = `${baseUrl}/booking-confirmation/${token}`;
        let storedBody: string;
        if (customEmailBody) {
          storedBody = customEmailBody
            .replace(/\{\{name\}\}/g, contestant.name)
            .replace(/\{\{date\}\}/g, recordDateForLog)
            .replace(/\{\{block\}\}/g, String(assignment.blockNumber))
            .replace(/\{\{seat\}\}/g, assignment.seatLabel)
            .replace(/\{\{confirmationLink\}\}/g, confirmationLinkForLog);
        } else {
          storedBody = `Hi ${contestant.name},\n\nYou have been booked for Deal or No Deal on ${recordDateForLog}.\nSeat: Block ${assignment.blockNumber}, ${assignment.seatLabel}\n\nPlease confirm your attendance using the link provided.`;
        }
        
        await storage.createBookingMessage({
          confirmationId: tokenRecord.id,
          direction: 'outbound',
          messageType: 'booking_email',
          subject: emailSubject || 'Deal or No Deal - Booking Confirmation Required',
          body: storedBody,
          sentAt: new Date(),
        });

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

  // Get booking confirmation responses for a record day (for viewing dietary requirements, questions, etc.)
  app.get("/api/booking-confirmations/record-day/:recordDayId", async (req, res) => {
    try {
      const { recordDayId } = req.params;

      const confirmations = await storage.getBookingConfirmationsByRecordDay(recordDayId);

      res.json(confirmations);
    } catch (error: any) {
      console.error("Error getting booking confirmations:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Send follow-up email to a contestant (reply to their questions)
  app.post("/api/booking-confirmations/:id/follow-up", async (req, res) => {
    try {
      // Check if Gmail integration is available
      if (!isGmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Gmail integration requires Replit Connectors or local OAuth setup." 
        });
      }

      const { id } = req.params;
      const { message, subject } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      // Get the booking confirmation to find the contestant
      const confirmations = await storage.getContestants();
      
      // Find the seat assignment first
      const allAssignments = await storage.getAllSeatAssignments();
      const allRecordDays = await storage.getRecordDays();
      
      // Get all booking confirmations to find this one
      let targetConfirmation = null;
      for (const recordDay of allRecordDays) {
        const dayConfirmations = await storage.getBookingConfirmationsByRecordDay(recordDay.id);
        const found = dayConfirmations.find(c => c.id === id);
        if (found) {
          targetConfirmation = found;
          break;
        }
      }

      if (!targetConfirmation) {
        return res.status(404).json({ error: "Confirmation not found" });
      }

      const contestant = targetConfirmation.contestant;
      const recordDay = allRecordDays.find(rd => rd.id === targetConfirmation!.seatAssignment.recordDayId);

      // Send follow-up email via Gmail
      try {
        if (!contestant.email) {
          return res.status(400).json({ error: "Contestant has no email address" });
        }
        
        // Get sender name from system config
        const senderNameConfig = await storage.getSystemConfig('email_sender_name');
        const emailConfig: EmailConfig = {
          senderName: senderNameConfig || 'Deal or No Deal',
        };
        
        await sendEmail(
          contestant.email,
          subject || 'Re: Your Deal or No Deal Booking',
          message,
          undefined,
          emailConfig
        );
      } catch (error: any) {
        console.error(`Failed to send follow-up email to ${contestant.email}:`, error.message);
      }

      // Create a booking message record for this reply
      await storage.createBookingMessage({
        confirmationId: id,
        direction: 'outbound',
        messageType: 'follow_up',
        subject: subject || 'Re: Your Deal or No Deal Booking',
        body: message,
        sentAt: new Date(),
      });

      res.json({
        success: true,
        message: "Follow-up email sent",
        emailStubbed: true,
        sentTo: {
          name: contestant.name,
          email: contestant.email,
        },
      });
    } catch (error: any) {
      console.error("Error sending follow-up email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get messages for a booking confirmation (conversation thread)
  app.get("/api/booking-confirmations/:id/messages", async (req, res) => {
    try {
      const { id } = req.params;
      const messages = await storage.getBookingMessagesByConfirmation(id);
      res.json(messages);
    } catch (error: any) {
      console.error("Error getting booking messages:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark a message as read
  app.post("/api/booking-messages/:messageId/read", async (req, res) => {
    try {
      const { messageId } = req.params;
      const updated = await storage.markMessageAsRead(messageId);
      if (!updated) {
        return res.status(404).json({ error: "Message not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error marking message as read:", error);
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

      if (tokenRecord.status === 'revoked') {
        return res.status(403).json({ error: "This confirmation link has been revoked" });
      }

      // For 'used' tokens, allow resubmissions (updating their response)
      // Only block if the token was revoked
      if (tokenRecord.status !== 'active' && tokenRecord.status !== 'used') {
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

      // Check if this is a resubmission
      const isResubmission = tokenRecord.confirmationStatus !== 'pending';

      // Update confirmation response (allows resubmissions to update existing response)
      const updatedToken = await storage.updateBookingConfirmationResponseAllowResubmit(
        tokenRecord.id,
        confirmationStatus,
        attendingWith,
        notes
      );

      if (!updatedToken) {
        return res.status(500).json({ error: "Failed to update confirmation" });
      }

      // Upsert the booking message record - updates existing if present, creates if not
      const responseBody = [];
      responseBody.push(`Status: ${confirmationStatus === 'confirmed' ? 'CONFIRMED' : 'DECLINED'}`);
      if (attendingWith) {
        responseBody.push(`Attending with: ${attendingWith}`);
      }
      if (notes) {
        responseBody.push(`Notes/Questions: ${notes}`);
      }
      
      await storage.upsertInboundBookingMessage({
        confirmationId: tokenRecord.id,
        direction: 'inbound',
        messageType: 'confirmation_response',
        subject: confirmationStatus === 'confirmed' ? 'Booking Confirmed' : 'Booking Declined',
        body: responseBody.join('\n'),
        sentAt: new Date(),
      });

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

        // Send auto-confirmation email with PDF attachments (only on first confirmation, not resubmissions)
        if (!isResubmission) {
          try {
            const contestant = await storage.getContestantById(assignment.contestantId);
            const recordDay = await storage.getRecordDayById(assignment.recordDayId);
            
            if (contestant && recordDay && contestant.email) {
              const recordDate = new Date(recordDay.date).toLocaleDateString('en-AU', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
              });
              
              // Get base URL for email links/images
              const protocol = req.headers['x-forwarded-proto'] || 'https';
              const host = req.headers.host || 'localhost:5000';
              const confirmEmailBaseUrl = `${protocol}://${host}`;
              
              // Get email config
              const senderNameConfig = await storage.getSystemConfig('email_sender_name');
              const emailConfig: EmailConfig = {
                senderName: senderNameConfig || 'Deal or No Deal',
              };
              
              // Get banner URL from system config or use default
              const bannerUrl = await storage.getSystemConfig('email_banner_url') || `${confirmEmailBaseUrl}/uploads/branding/dond_banner.png`;
              
              // Build confirmation receipt email matching booking email style
              const confirmationEmailSubject = `Deal or No Deal - Attendance Confirmed for ${recordDate}`;
              const confirmationEmailBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #2a0a0a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
    <!-- Full-width Banner Image -->
    <tr>
      <td style="padding: 0; line-height: 0;">
        <img src="${bannerUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />
      </td>
    </tr>
    
    <!-- Gold Title Bar -->
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 26px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          Attendance Confirmed!
        </h1>
      </td>
    </tr>
    
    <!-- Content Card -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 35px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Hi ${contestant.name.split(' ')[0]},
              </p>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                Thank you for confirming your attendance! We're excited to have you join us for the <strong style="color: #8B0000;">Deal or No Deal</strong> recording.
              </p>
              
              <!-- Booking Details Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                      Your Record Day Details
                    </h2>
                    <p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0 0 6px 0;">
                      <strong>Date:</strong> ${recordDate}
                    </p>
                    <p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0 0 6px 0;">
                      <strong>Time:</strong> 7:30AM
                    </p>
                    <p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0 0 6px 0;">
                      <strong>Location:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008
                    </p>
                    ${attendingWith ? `<p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0;">
                      <strong>Attending with:</strong> ${attendingWith}
                    </p>` : ''}
                  </td>
                </tr>
              </table>
              
              <p style="color: #555555; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
                Please keep this email for your records. If you have any attached documents, please read them carefully before your recording date.
              </p>
              
              <p style="color: #555555; font-size: 15px; line-height: 1.6; margin: 0;">
                If you need to make any changes to your booking or have questions, please contact us as soon as possible.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    
    <!-- Footer -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 15px 30px 30px 30px; text-align: center;">
        <p style="color: #aa8888; font-size: 11px; line-height: 1.6; margin: 0;">
          This is an automated confirmation from the Deal or No Deal production team.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
              
              // Get PDF attachments from email assets
              const objectStorageService = new ObjectStorageService();
              const allAssets = await objectStorageService.listEmailAssets();
              const pdfAssets = allAssets.filter(asset => asset.contentType === 'application/pdf');
              
              const attachments = [];
              for (const pdfAsset of pdfAssets) {
                try {
                  const { buffer, contentType, filename } = await objectStorageService.getObjectAsBuffer(pdfAsset.path);
                  attachments.push({ content: buffer, contentType, filename });
                } catch (attachErr: any) {
                  console.error(`Failed to load PDF attachment ${pdfAsset.path}:`, attachErr.message);
                }
              }
              
              // Send the confirmation email
              if (attachments.length > 0) {
                await sendEmailWithAttachment(contestant.email, confirmationEmailSubject, confirmationEmailBody, attachments, emailConfig);
                console.log(`📧 Auto-confirmation email sent to ${contestant.email} with ${attachments.length} PDF attachment(s)`);
              } else {
                await sendEmail(contestant.email, confirmationEmailSubject, confirmationEmailBody, undefined, emailConfig);
                console.log(`📧 Auto-confirmation email sent to ${contestant.email} (no attachments)`);
              }
            }
          } catch (emailErr: any) {
            console.error(`Failed to send auto-confirmation email:`, emailErr.message);
            // Don't fail the response - confirmation was still successful
          }
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

  // Poll Gmail inbox for contestant email replies and store them in booking_messages
  app.post("/api/booking-confirmations/poll-inbox", async (req, res) => {
    try {
      // Check if Gmail integration is available
      if (!isGmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Inbox polling is not available. Gmail integration requires Replit Connectors or local OAuth setup." 
        });
      }

      console.log("📥 Starting inbox polling for contestant replies...");
      
      // Fetch recent inbox messages (last 24 hours by default)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const inboxMessages = await getInboxMessages(50, oneDayAgo);
      console.log(`📥 Retrieved ${inboxMessages.length} inbox messages`);
      
      const processedMessages: any[] = [];
      const skippedMessages: any[] = [];
      
      for (const email of inboxMessages) {
        // Check if this Gmail message has already been processed
        const alreadyProcessed = await storage.isGmailMessageProcessed(email.id);
        if (alreadyProcessed) {
          skippedMessages.push({
            gmailId: email.id,
            from: email.fromEmail,
            subject: email.subject,
            reason: 'Already processed'
          });
          continue;
        }
        
        // Find booking confirmations for this sender's email
        const confirmations = await storage.getBookingConfirmationsByContestantEmail(email.fromEmail);
        
        if (confirmations.length === 0) {
          skippedMessages.push({
            gmailId: email.id,
            from: email.fromEmail,
            subject: email.subject,
            reason: 'No matching booking confirmation found'
          });
          continue;
        }
        
        // Find the most recent/relevant confirmation for this contestant
        // Sort by createdAt desc to get the most recent first
        const sortedConfirmations = confirmations.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        
        // Use the most recent active or used confirmation
        const relevantConfirmation = sortedConfirmations.find(c => 
          c.status === 'active' || c.status === 'used'
        ) || sortedConfirmations[0];
        
        // Store the inbound message
        const message = await storage.createBookingMessage({
          confirmationId: relevantConfirmation.id,
          direction: 'inbound',
          messageType: 'reply',
          subject: email.subject || 'Email Reply',
          body: email.body || '[No content]',
          senderEmail: email.fromEmail,
          gmailMessageId: email.id,
          sentAt: email.date,
        });
        
        processedMessages.push({
          gmailId: email.id,
          messageId: message.id,
          from: email.fromEmail,
          subject: email.subject,
          contestant: relevantConfirmation.contestant.name,
          confirmationId: relevantConfirmation.id,
        });
        
        console.log(`📨 Stored reply from ${email.fromEmail} (${relevantConfirmation.contestant.name})`);
      }
      
      console.log(`📥 Inbox polling complete: ${processedMessages.length} processed, ${skippedMessages.length} skipped`);
      
      res.json({
        success: true,
        processed: processedMessages.length,
        skipped: skippedMessages.length,
        processedMessages,
        skippedMessages,
      });
    } catch (error: any) {
      console.error("Error polling inbox:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== STANDBY ENDPOINTS =====
  
  // Get all standbys grouped by record day
  app.get("/api/standbys", async (req, res) => {
    try {
      const standbys = await storage.getStandbyAssignments();
      res.json(standbys);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get standbys for a specific record day
  app.get("/api/standbys/record-day/:recordDayId", async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const standbys = await storage.getStandbyAssignmentsByRecordDay(recordDayId);
      res.json(standbys);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create standby assignments (bulk)
  app.post("/api/standbys", async (req, res) => {
    try {
      const { contestantIds, recordDayId } = req.body;

      if (!contestantIds || !Array.isArray(contestantIds) || contestantIds.length === 0) {
        return res.status(400).json({ error: "contestantIds array is required" });
      }

      if (!recordDayId) {
        return res.status(400).json({ error: "recordDayId is required" });
      }

      // Verify record day exists
      const recordDay = await storage.getRecordDayById(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }

      // Get existing standbys for this record day to identify duplicates
      const existingStandbys = await storage.getStandbyAssignmentsByRecordDay(recordDayId);
      const existingStandbyContestantIds = new Set(existingStandbys.map(s => s.contestantId));
      
      // Get existing seat assignments to check if contestants are already seated
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      const seatedContestantIds = new Set(existingAssignments.map((a: any) => a.contestantId));
      
      // Check if any contestant is already seated - if so, reject the request
      const alreadySeatedIds = contestantIds.filter((id: string) => seatedContestantIds.has(id));
      if (alreadySeatedIds.length > 0) {
        // Get names of already seated contestants
        const seatedContestants = await Promise.all(
          alreadySeatedIds.slice(0, 3).map((id: string) => storage.getContestantById(id))
        );
        const names = seatedContestants.map(c => c?.name).filter(Boolean).join(', ');
        const moreCount = alreadySeatedIds.length > 3 ? ` and ${alreadySeatedIds.length - 3} more` : '';
        return res.status(409).json({ 
          error: `Cannot add as standby: ${names}${moreCount} already seated for this record day` 
        });
      }
      
      // Filter out contestants who are already standbys for this record day
      const newContestantIds = contestantIds.filter((id: string) => !existingStandbyContestantIds.has(id));
      const skippedCount = contestantIds.length - newContestantIds.length;

      if (newContestantIds.length === 0) {
        return res.json({
          message: "All contestants are already standbys for this record day",
          count: 0,
          skipped: skippedCount,
          standbys: [],
        });
      }

      const assignments = newContestantIds.map((contestantId: string) => ({
        contestantId,
        recordDayId,
        status: 'pending' as const,
      }));

      const created = await storage.createStandbyAssignments(assignments);
      
      res.json({
        message: `Created ${created.length} standby assignments${skippedCount > 0 ? ` (${skippedCount} already existed)` : ''}`,
        count: created.length,
        skipped: skippedCount,
        standbys: created,
      });
    } catch (error: any) {
      console.error("Error creating standby assignments:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update standby assignment
  app.patch("/api/standbys/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const updated = await storage.updateStandbyAssignment(id, updateData);
      
      if (!updated) {
        return res.status(404).json({ error: "Standby assignment not found" });
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete standby assignment
  app.delete("/api/standbys/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteStandbyAssignment(id);
      res.json({ message: "Standby assignment deleted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Move a standby to the reschedule tab
  app.post("/api/standbys/:id/move-to-reschedule", async (req, res) => {
    try {
      const { id } = req.params;

      // Get the standby assignment with contestant and record day info
      const allStandbys = await storage.getStandbyAssignments();
      const standby = allStandbys.find(s => s.id === id);

      if (!standby) {
        return res.status(404).json({ error: "Standby assignment not found" });
      }

      // Check if already moved to reschedule
      if (standby.movedToReschedule) {
        return res.status(400).json({ error: "This standby has already been moved to reschedule" });
      }

      // Create a canceled assignment entry for the reschedule tab
      const canceledAssignment = await storage.createCanceledAssignment({
        contestantId: standby.contestantId,
        recordDayId: standby.recordDayId,
        blockNumber: null,
        seatLabel: standby.assignedToSeat || null,
        reason: 'Standby - eligible for reschedule',
        isFromStandby: true,
        originalAttendanceDate: new Date(standby.recordDay.date),
      });

      // Update the standby to mark it as moved to reschedule
      const updatedStandby = await storage.updateStandbyAssignment(id, {
        movedToReschedule: true,
        movedToRescheduleAt: new Date(),
      });

      res.json({
        message: "Standby moved to reschedule tab",
        standby: updatedStandby,
        canceledAssignment,
      });
    } catch (error: any) {
      console.error("Error moving standby to reschedule:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Assign a standby to a seat (called from booking master when standby is selected)
  app.post("/api/standbys/assign-seat", async (req, res) => {
    try {
      const { recordDayId, contestantName, seatLabel } = req.body;

      if (!recordDayId || !contestantName) {
        return res.status(400).json({ error: "recordDayId and contestantName are required" });
      }

      // Get all standbys for this record day
      const allStandbys = await storage.getStandbyAssignments();
      const standbyForDay = allStandbys.filter(s => s.recordDayId === recordDayId);
      
      // Find the standby that matches the contestant name
      const matchingStandby = standbyForDay.find(s => s.contestant.name === contestantName);
      
      if (!matchingStandby) {
        return res.status(404).json({ error: "Standby not found for this contestant and record day" });
      }

      // Update the standby with the seat assignment
      // When clearing (seatLabel is null/empty), reset status to 'pending'
      const updated = await storage.updateStandbyAssignment(matchingStandby.id, {
        assignedToSeat: seatLabel || null,
        assignedAt: seatLabel ? new Date() : null,
        status: seatLabel ? 'seated' : 'pending',
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error assigning standby to seat:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Preview standby booking emails
  app.post("/api/standbys/preview-emails", async (req, res) => {
    try {
      const { standbyIds } = req.body;

      if (!standbyIds || !Array.isArray(standbyIds) || standbyIds.length === 0) {
        return res.status(400).json({ error: "standbyIds array is required" });
      }

      // Get all standbys with contestant details
      const allStandbys = await storage.getStandbyAssignments();
      const selectedStandbys = allStandbys.filter(s => standbyIds.includes(s.id));

      if (selectedStandbys.length === 0) {
        return res.status(404).json({ error: "No standbys found" });
      }

      // Build recipient list with emails
      const recipients = selectedStandbys
        .filter(s => s.contestant.email)
        .map(s => ({
          standbyId: s.id,
          contestantId: s.contestant.id,
          name: s.contestant.name,
          email: s.contestant.email,
          recordDate: s.recordDay.date,
          rxNumber: s.recordDay.rxNumber,
        }));

      const noEmail = selectedStandbys.filter(s => !s.contestant.email);

      res.json({
        recipients,
        totalSelected: standbyIds.length,
        withEmail: recipients.length,
        withoutEmail: noEmail.length,
        missingEmailNames: noEmail.map(s => s.contestant.name),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send standby booking emails
  app.post("/api/standbys/send-emails", async (req, res) => {
    try {
      const { standbyIds } = req.body;

      if (!standbyIds || !Array.isArray(standbyIds) || standbyIds.length === 0) {
        return res.status(400).json({ error: "standbyIds array is required" });
      }

      // Get all standbys with contestant details
      const allStandbys = await storage.getStandbyAssignments();
      const selectedStandbys = allStandbys.filter(s => standbyIds.includes(s.id));

      if (selectedStandbys.length === 0) {
        return res.status(404).json({ error: "No standbys found" });
      }

      // Filter to only those with emails
      const standbysWithEmail = selectedStandbys.filter(s => s.contestant.email);
      
      if (standbysWithEmail.length === 0) {
        return res.status(400).json({ error: "No standbys have email addresses" });
      }

      const results = {
        sent: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const standby of standbysWithEmail) {
        try {
          // Generate confirmation token
          const tokenString = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

          const token = await storage.createStandbyConfirmationToken({
            standbyAssignmentId: standby.id,
            token: tokenString,
            status: 'active',
            expiresAt,
          });

          // Format date
          const recordDate = new Date(standby.recordDay.date);
          const formattedDate = recordDate.toLocaleDateString('en-AU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });

          // Build confirmation URL
          const baseUrl = process.env.REPLIT_DEV_DOMAIN 
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : 'http://localhost:5000';
          const confirmationUrl = `${baseUrl}/standby-confirmation/${tokenString}`;

          // Build email content
          const subject = `Deal or No Deal - Standby Booking for ${formattedDate}`;
          const htmlBody = `
            <p>Dear ${standby.contestant.name},</p>
            
            <p>Thank you for your interest in being part of Deal or No Deal!</p>
            
            <p>You have been selected as a <strong>STANDBY</strong> for the recording on <strong>${formattedDate}</strong>${standby.recordDay.rxNumber ? ` (${standby.recordDay.rxNumber})` : ''}.</p>
            
            <p><strong>Important Information:</strong></p>
            <ul>
              <li>As a standby, you are not guaranteed a seat in the studio audience</li>
              <li>You will only be seated if a spot becomes available on the day</li>
              <li>If you are not seated, you will be given a fast-track invitation to another upcoming studio day</li>
            </ul>
            
            <p>Please confirm your availability by clicking the link below:</p>
            
            <p><a href="${confirmationUrl}" style="display: inline-block; background-color: #E91E63; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Confirm Standby Booking</a></p>
            
            <p>If you are no longer available, please click the link above and select "Decline".</p>
            
            <p>This confirmation link will expire in 7 days.</p>
            
            <p>Thank you,<br>Deal or No Deal Production Team</p>
          `;

          // Send email via Gmail API
          const gmail = await getUncachableGmailClient();
          
          const message = [
            `To: ${standby.contestant.email}`,
            `Subject: ${subject}`,
            'Content-Type: text/html; charset="UTF-8"',
            'MIME-Version: 1.0',
            '',
            htmlBody
          ].join('\n');

          const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              raw: encodedMessage
            }
          });

          // Update standby assignment
          await storage.updateStandbyAssignment(standby.id, {
            status: 'email_sent',
            standbyEmailSent: new Date(),
          });

          // Update token lastSentAt
          await storage.updateStandbyConfirmationToken(token.id, {
            lastSentAt: new Date(),
          });

          results.sent++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${standby.contestant.name}: ${error.message}`);
        }
      }

      res.json({
        message: `Sent ${results.sent} standby booking emails`,
        ...results,
      });
    } catch (error: any) {
      console.error("Error sending standby emails:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get standby confirmation by token (public endpoint)
  app.get("/api/standby-confirmation/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const tokenRecord = await storage.getStandbyConfirmationByToken(token);
      
      if (!tokenRecord) {
        return res.status(404).json({ error: "Invalid confirmation link" });
      }

      if (tokenRecord.status === 'used') {
        return res.status(410).json({ 
          error: "This confirmation link has already been used",
          alreadyResponded: true,
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

      // Get standby assignment details
      const standby = await storage.getStandbyAssignmentById(tokenRecord.standbyAssignmentId);
      
      if (!standby) {
        return res.status(404).json({ error: "Standby booking not found" });
      }

      // Get contestant and record day details
      const contestant = await storage.getContestantById(standby.contestantId);
      const recordDay = await storage.getRecordDayById(standby.recordDayId);

      if (!contestant || !recordDay) {
        return res.status(404).json({ error: "Booking details not found" });
      }

      res.json({
        standbyId: standby.id,
        contestantName: contestant.name,
        recordDate: recordDay.date,
        rxNumber: recordDay.rxNumber,
        status: standby.status,
        isStandby: true,
      });
    } catch (error: any) {
      console.error("Error fetching standby confirmation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Submit standby confirmation response (public endpoint)
  app.post("/api/standby-confirmation/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { response } = req.body; // 'confirmed' or 'declined'

      const tokenRecord = await storage.getStandbyConfirmationByToken(token);
      
      if (!tokenRecord) {
        return res.status(404).json({ error: "Invalid confirmation link" });
      }

      if (tokenRecord.status === 'used') {
        return res.status(410).json({ 
          error: "This confirmation link has already been used",
          alreadyResponded: true,
        });
      }

      if (tokenRecord.status !== 'active') {
        return res.status(403).json({ error: "This confirmation link is no longer active" });
      }

      if (new Date(tokenRecord.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This confirmation link has expired" });
      }

      if (!response || !['confirmed', 'declined'].includes(response)) {
        return res.status(400).json({ error: "Valid response required (confirmed or declined)" });
      }

      // Get standby assignment
      const standby = await storage.getStandbyAssignmentById(tokenRecord.standbyAssignmentId);
      
      if (!standby) {
        return res.status(404).json({ error: "Standby booking not found" });
      }

      // Update standby assignment status
      await storage.updateStandbyAssignment(standby.id, {
        status: response,
        confirmedAt: new Date(),
      });

      // Mark token as used
      await storage.updateStandbyConfirmationToken(tokenRecord.id, {
        status: 'used',
      });

      res.json({
        message: response === 'confirmed' 
          ? "Thank you for confirming! Remember, as a standby you'll only be seated if a spot becomes available. If not, you'll receive a fast-track invitation to another show date."
          : "Your standby booking has been cancelled. Thank you for letting us know.",
        response,
      });
    } catch (error: any) {
      console.error("Error processing standby confirmation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // System Integrations Status Endpoint
  // ==========================================

  // Get status of all external integrations (Gmail, Google Sheets, etc.)
  app.get("/api/system/integrations", async (req, res) => {
    try {
      const gmailAvailable = isGmailAvailable();
      const googleSheetsAvailable = isGoogleSheetsAvailable();
      
      res.json({
        gmail: {
          available: gmailAvailable,
          message: gmailAvailable 
            ? 'Gmail integration is connected' 
            : 'Gmail integration requires Replit Connectors or local OAuth setup'
        },
        googleSheets: {
          available: googleSheetsAvailable,
          message: googleSheetsAvailable 
            ? 'Google Sheets integration is connected' 
            : 'Google Sheets integration requires Replit Connectors or local OAuth setup'
        },
        allAvailable: gmailAvailable && googleSheetsAvailable
      });
    } catch (error: any) {
      console.error("Error checking integrations:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // System Config Endpoints
  // ==========================================

  // Get a system config value
  app.get("/api/system-config/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const value = await storage.getSystemConfig(key);
      res.json(value);
    } catch (error: any) {
      console.error("Error getting system config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Set a system config value
  app.put("/api/system-config/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      
      if (value === undefined) {
        return res.status(400).json({ error: "Value is required" });
      }
      
      await storage.setSystemConfig(key, value);
      res.json({ success: true, key, value });
    } catch (error: any) {
      console.error("Error setting system config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Google Sheets Sync Endpoints
  // ==========================================

  // Get current Google Sheets sync configuration
  app.get("/api/google-sheets/config", async (req, res) => {
    try {
      const spreadsheetId = await storage.getSystemConfig(SHEETS_SPREADSHEET_ID_KEY);
      const lastSyncTime = await storage.getSystemConfig(SHEETS_LAST_SYNC_KEY);
      const autoSync = await storage.getSystemConfig(SHEETS_AUTO_SYNC_KEY);
      const integrationAvailable = isGoogleSheetsAvailable();
      
      res.json({
        spreadsheetId,
        lastSyncTime: lastSyncTime ? new Date(lastSyncTime) : null,
        autoSync: autoSync !== 'false',
        isConfigured: !!spreadsheetId,
        integrationAvailable,
        integrationMessage: integrationAvailable 
          ? null 
          : 'Google Sheets integration requires Replit Connectors or local OAuth setup'
      });
    } catch (error: any) {
      console.error("Error getting Google Sheets config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Set Google Sheets spreadsheet ID
  app.post("/api/google-sheets/config", async (req, res) => {
    try {
      // Check if integration is available
      if (!isGoogleSheetsAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Google Sheets integration is not available. This feature requires Replit Connectors or local OAuth setup." 
        });
      }

      const { spreadsheetId, autoSync } = req.body;
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "Spreadsheet ID is required" });
      }

      // Validate spreadsheet ID format (basic validation)
      if (typeof spreadsheetId !== 'string' || spreadsheetId.length < 10 || spreadsheetId.length > 100) {
        return res.status(400).json({ error: "Invalid spreadsheet ID format. Get this from your Google Sheets URL." });
      }

      // Try to create header row to verify connection
      await createSheetHeader(spreadsheetId);

      // Save config to database
      await storage.setSystemConfig(SHEETS_SPREADSHEET_ID_KEY, spreadsheetId);
      if (autoSync !== undefined) {
        await storage.setSystemConfig(SHEETS_AUTO_SYNC_KEY, String(autoSync));
      }
      
      res.json({ 
        success: true, 
        message: "Google Sheets configured successfully. You can now sync your booking data.",
        config: {
          spreadsheetId,
          autoSync: autoSync !== false,
          isConfigured: true,
        }
      });
    } catch (error: any) {
      console.error("Error configuring Google Sheets:", error);
      // Provide more helpful error messages
      if (error.message?.includes('not connected')) {
        return res.status(401).json({ error: "Google Sheets not connected. Please authorize the integration first." });
      }
      if (error.message?.includes('not found') || error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet not found. Check the ID and ensure the sheet is shared with the integration." });
      }
      res.status(500).json({ error: `Failed to configure Google Sheets: ${error.message}` });
    }
  });

  // Sync all booking master data to Google Sheets (one tab per record day)
  app.post("/api/google-sheets/sync", async (req, res) => {
    try {
      // Check if integration is available
      if (!isGoogleSheetsAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Google Sheets integration is not available. This feature requires Replit Connectors or local OAuth setup." 
        });
      }

      const spreadsheetId = await storage.getSystemConfig(SHEETS_SPREADSHEET_ID_KEY);
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "Google Sheets not configured. Please set a spreadsheet ID first." });
      }

      // Get all record days and their assignments
      const recordDays = await storage.getRecordDays();
      const allAssignments = await storage.getAllSeatAssignments();
      
      // Sort record days chronologically
      const sortedRecordDays = [...recordDays].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      const syncResults: { recordDay: string; count: number }[] = [];
      
      // Sync each record day to its own tab
      for (const recordDay of sortedRecordDays) {
        const dayAssignments = allAssignments.filter(a => a.recordDayId === recordDay.id);
        
        if (dayAssignments.length === 0) continue;
        
        // Build booking data for this record day
        const bookingData = [];
        
        for (const assignment of dayAssignments) {
          const contestant = await storage.getContestantById(assignment.contestantId);
          if (!contestant) continue;

          // Determine workflow status indicators
          const hasBookingEmail = !!assignment.bookingEmailSent;
          const hasConfirmedRsvp = !!assignment.confirmedRsvp;
          const hasPaperworkSent = !!assignment.paperworkSent;
          const hasPaperworkReceived = !!assignment.paperworkReceived;
          const hasSignedIn = !!assignment.signedIn;

          bookingData.push({
            seatLabel: `Block ${assignment.blockNumber} - ${assignment.seatLabel}`,
            contestantName: contestant.name || '',
            contestantId: contestant.id || '',
            auditionRating: contestant.auditionRating || '',
            gender: contestant.gender || '',
            age: contestant.age,
            location: assignment.location || contestant.location || '',
            workflow: [
              hasBookingEmail ? 'Email Sent' : '',
              hasConfirmedRsvp ? 'RSVP Confirmed' : '',
              hasPaperworkSent ? 'Paperwork Sent' : '',
              hasPaperworkReceived ? 'Paperwork Received' : '',
              hasSignedIn ? 'Signed In' : '',
            ].filter(Boolean).join(', ') || 'Pending',
            availabilityRsvp: contestant.availabilityStatus === 'available' ? 'Yes' : contestant.availabilityStatus === 'pending' ? 'Pending' : 'No',
            confirmedRsvp: assignment.confirmedRsvp ? new Date(assignment.confirmedRsvp).toLocaleDateString() : '',
            declined: contestant.availabilityStatus === 'invited' ? 'Declined' : '',
            notes: assignment.notes || assignment.otdNotes || '',
          });
        }

        if (bookingData.length > 0) {
          // Format record day date for tab name (e.g., "Dec 15, 2024")
          const tabName = new Date(recordDay.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });
          
          await syncRecordDayToSheet(spreadsheetId, tabName, bookingData);
          syncResults.push({ recordDay: tabName, count: bookingData.length });
        }
      }

      // Update last sync time in database
      await storage.setSystemConfig(SHEETS_LAST_SYNC_KEY, new Date().toISOString());

      const totalBookings = syncResults.reduce((sum, r) => sum + r.count, 0);
      
      res.json({
        success: true,
        message: `Synced ${totalBookings} bookings across ${syncResults.length} record day tabs`,
        tabs: syncResults,
        lastSyncTime: new Date(),
      });
    } catch (error: any) {
      console.error("Error syncing to Google Sheets:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update a specific cell in a record day's Google Sheet tab (sheet-only, doesn't affect database)
  app.patch("/api/google-sheets/cell", async (req, res) => {
    try {
      const spreadsheetId = await storage.getSystemConfig(SHEETS_SPREADSHEET_ID_KEY);
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "Google Sheets not configured" });
      }
      
      const { sheetTitle, rowIndex, columnIndex, value } = req.body;
      
      if (!sheetTitle || rowIndex === undefined || columnIndex === undefined) {
        return res.status(400).json({ error: "Missing required fields: sheetTitle, rowIndex, columnIndex" });
      }
      
      await updateCellInRecordDaySheet(spreadsheetId, sheetTitle, rowIndex, columnIndex, value || '');
      
      res.json({ success: true, message: "Cell updated in Google Sheet" });
    } catch (error: any) {
      console.error("Error updating Google Sheets cell:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update an entire row in a record day's Google Sheet tab (sheet-only, doesn't affect database)
  app.patch("/api/google-sheets/row", async (req, res) => {
    try {
      const spreadsheetId = await storage.getSystemConfig(SHEETS_SPREADSHEET_ID_KEY);
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "Google Sheets not configured" });
      }
      
      const { sheetTitle, rowIndex, rowData } = req.body;
      
      if (!sheetTitle || rowIndex === undefined || !rowData) {
        return res.status(400).json({ error: "Missing required fields: sheetTitle, rowIndex, rowData" });
      }
      
      await updateRowInRecordDaySheet(spreadsheetId, sheetTitle, rowIndex, rowData);
      
      res.json({ success: true, message: "Row updated in Google Sheet" });
    } catch (error: any) {
      console.error("Error updating Google Sheets row:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get data from a specific record day's Google Sheet tab
  app.get("/api/google-sheets/sheet/:sheetTitle", async (req, res) => {
    try {
      const spreadsheetId = await storage.getSystemConfig(SHEETS_SPREADSHEET_ID_KEY);
      
      if (!spreadsheetId) {
        return res.status(400).json({ error: "Google Sheets not configured" });
      }
      
      const { sheetTitle } = req.params;
      
      const data = await getRecordDaySheetData(spreadsheetId, decodeURIComponent(sheetTitle));
      
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error reading Google Sheets data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // =============================================
  // Object Storage Routes for Email Assets
  // =============================================

  // Upload file directly (server-side upload to Object Storage)
  const emailAssetUpload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  app.post("/api/objects/upload", emailAssetUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }
      
      const objectStorageService = new ObjectStorageService();
      const { objectPath, url } = await objectStorageService.uploadFile(req.file.buffer, req.file.originalname);
      res.json({ objectPath, url });
    } catch (error: any) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Serve uploaded objects
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.downloadObject(`/objects/${req.params.objectPath}`, res);
    } catch (error: any) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "File not found" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // List all email assets
  app.get("/api/email-assets", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const assets = await objectStorageService.listEmailAssets();
      res.json(assets);
    } catch (error: any) {
      console.error("Error listing email assets:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete an email asset
  app.delete("/api/email-assets/:path(*)", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteObject(`/objects/${req.params.path}`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting email asset:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "File not found" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // =============================================
  // Form Configuration Routes
  // =============================================

  // Get form configurations for a specific form type
  app.get("/api/form-configs/:formType", async (req, res) => {
    try {
      const { formType } = req.params;
      if (!['availability', 'booking'].includes(formType)) {
        return res.status(400).json({ error: "Invalid form type. Must be 'availability' or 'booking'." });
      }
      const configs = await storage.getFormConfigurations(formType);
      res.json(configs);
    } catch (error: any) {
      console.error("Error getting form configurations:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update form configurations for a specific form type
  app.put("/api/form-configs/:formType", async (req, res) => {
    try {
      const { formType } = req.params;
      if (!['availability', 'booking'].includes(formType)) {
        return res.status(400).json({ error: "Invalid form type. Must be 'availability' or 'booking'." });
      }
      const configs = req.body;
      if (typeof configs !== 'object' || configs === null) {
        return res.status(400).json({ error: "Request body must be an object with field key-value pairs." });
      }
      await storage.setFormConfigurations(formType, configs);
      res.json({ success: true, message: `${formType} form configurations updated successfully.` });
    } catch (error: any) {
      console.error("Error updating form configurations:", error);
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
