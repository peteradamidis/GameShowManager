import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import { 
  insertContestantSchema, 
  insertRecordDaySchema, 
  insertSeatAssignmentSchema, 
  seatAssignments, 
  SeatAssignment,
  contestants,
  groups,
  standbyAssignments,
  standbyConfirmationTokens,
  canceledAssignments,
  contestantAvailability,
  availabilityTokens,
  bookingConfirmationTokens
} from "@shared/schema";
import { 
  parseAttendingWith, 
  normalizeName as sharedNormalizeName,
  isSoloContestant,
  getPartnerNames,
  getNormalizedPartnerNames,
  attendingWithMentionsName
} from "@shared/attendingWithParser";
import { sql, eq } from "drizzle-orm";
import xlsx from "xlsx";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import express from "express";
import fs from "fs";
import { sendEmail, sendEmailWithAttachment, sendEmailWithEmbeddedImages, EmbeddedImage, EmailConfig, isEmailAvailable, testSmtpConnection, getSmtpConfig, getSenderEmail } from "./email";
import { syncRecordDayToSheet, createSheetHeader, updateCellInRecordDaySheet, updateRowInRecordDaySheet, getRecordDaySheetData, isGoogleSheetsAvailable } from "./google-sheets";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { requireAuth, hashPassword, verifyPassword } from "./auth";
import { wsManager } from "./websocket";

// Google Sheets config keys for database storage
const SHEETS_SPREADSHEET_ID_KEY = 'google_sheets_spreadsheet_id';
const SHEETS_LAST_SYNC_KEY = 'google_sheets_last_sync';
const SHEETS_AUTO_SYNC_KEY = 'google_sheets_auto_sync';

// Helper function to append bypass parameters to URLs (deprecated, kept for compatibility)
function appendNgrokSkip(url: string): string {
  return url;
}

// Helper function to get base URL for email links
function getBaseUrl(req?: Request): string {
  // 1. Check for explicit BASE_URL (for offline/self-hosted deployments)
  if (process.env.BASE_URL) {
    // Remove any trailing whitespace, quotes, or accidental "->" separators
    let url = process.env.BASE_URL.trim();
    url = url.split(/\s+->\s+/)[0]; // Handle accidental ngrok status line paste
    url = url.replace(/['"]/g, ''); // Remove quotes
    return url.replace(/\/$/, ''); // Remove trailing slash
  }
  
  // 2. Check for Replit deployment URL
  if (process.env.REPLIT_DEPLOYMENT_URL) {
    return process.env.REPLIT_DEPLOYMENT_URL.replace(/\/$/, '');
  }
  
  // 3. Check for Replit dev domain
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  
  // 4. Try to get from request headers (for dynamic detection)
  if (req) {
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host) {
      return `${protocol}://${host}`;
    }
  }
  
  // 5. Fallback to localhost
  return 'http://localhost:5000';
}

const upload = multer({ storage: multer.memoryStorage() });

// PDF upload configuration with size limit (for gallery imports)
const pdfUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for gallery PDFs
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

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
  
  // Create a normalized name to original name mapping for contestants
  const normalizedNameMap = new Map<string, string>();
  contestants.forEach((c) => {
    const normalized = c.name.toLowerCase().trim();
    normalizedNameMap.set(normalized, c.name);
  });

  contestants.forEach((contestant) => {
    const contestantNormalized = contestant.name.toLowerCase().trim();
    
    if (!contestant.attendingWith) return;
    
    // Parse attending with names
    const attendingWithNames = contestant.attendingWith
      .split(/[,&]/)
      .map((name: string) => name.trim().toLowerCase())
      .filter((name: string) => name.length > 0);

    // Find all people in this group (including this contestant)
    const groupMembers = new Set<string>([contestantNormalized]);
    attendingWithNames.forEach((name: string) => {
      // Only add if the person exists in our contestant list (case-insensitive)
      if (normalizedNameMap.has(name)) {
        groupMembers.add(name);
      }
    });

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
      // Use original name from contestant data, not normalized
      const originalName = normalizedNameMap.get(member) || member;
      if (!groupMap.get(groupId)!.includes(originalName)) {
        groupMap.get(groupId)!.push(originalName);
      }
    });
  });

  return groupMap;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Middleware to handle ngrok skip browser warning via query parameter
  // This ensures that even if the header isn't sent by the browser, 
  // we handle the bypass logic server-side.
  app.use((req, res, next) => {
    next();
  });

  // Serve uploaded photos as static files
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // ============ AUTHENTICATION ROUTES (PUBLIC) ============
  
  // Check if user is authenticated
  app.get("/api/auth/check", (req, res) => {
    if (req.session.userId) {
      res.json({ 
        authenticated: true, 
        user: { 
          id: req.session.userId, 
          username: req.session.username 
        } 
      });
    } else {
      res.json({ authenticated: false });
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await storage.getUserByUsername(username);
      
      if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const isValid = await verifyPassword(password, user.password);
      
      if (!isValid) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      // Set session
      req.session.userId = user.id;
      req.session.username = user.username;

      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Change password (requires authentication)
  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }

      const user = await storage.getUserById(req.session.userId!);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const isValid = await verifyPassword(currentPassword, user.password);
      
      if (!isValid) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUserPassword(user.id, hashedPassword);

      res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // Change username (requires authentication)
  app.post("/api/auth/change-username", requireAuth, async (req, res) => {
    try {
      const { newUsername } = req.body;
      
      if (!newUsername || newUsername.trim().length === 0) {
        return res.status(400).json({ error: "New username is required" });
      }

      if (newUsername.length < 3) {
        return res.status(400).json({ error: "Username must be at least 3 characters" });
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(newUsername);
      if (existingUser && existingUser.id !== req.session.userId!) {
        return res.status(400).json({ error: "Username already in use" });
      }

      const user = await storage.getUserById(req.session.userId!);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await storage.updateUsername(user.id, newUsername);
      req.session.username = newUsername;

      res.json({ success: true, message: "Username changed successfully" });
    } catch (error) {
      console.error("Change username error:", error);
      res.status(500).json({ error: "Failed to change username" });
    }
  });

  // ============ PROTECTED API ROUTES ============
  // All routes below this middleware require authentication
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    // Skip auth check for public endpoints
    // Note: req.path is relative to /api mount, so /api/contestants becomes /contestants
    // But req.originalUrl has the full path
    const publicPaths = [
      '/api/auth/',
      '/api/availability-response',  // Public form for contestants
      '/api/booking-confirmation',   // Public form for contestants
      '/api/standby-confirmation',   // Public form for contestants
      '/api/email-preview/',         // Email template previews for iframes
    ];
    
    const isPublicPath = publicPaths.some(path => req.originalUrl.startsWith(path));
    
    if (isPublicPath) {
      return next();
    }
    
    return requireAuth(req, res, next);
  });

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

  // Import photos from Cast It Reach Gallery PDF
  app.post("/api/contestants/import-gallery", (req, res, next) => {
    pdfUpload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: "PDF file too large. Maximum size is 50MB." });
        }
        if (err.message === 'Only PDF files are allowed') {
          return res.status(400).json({ error: "Only PDF files are allowed." });
        }
        console.error("PDF upload error:", err);
        return res.status(400).json({ error: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No PDF file uploaded" });
      }

      console.log(`[Gallery Import] Processing PDF: ${req.file.originalname}, size: ${req.file.buffer.length} bytes`);

      // Dynamic import of pdfjs-dist (ESM module)
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const { createCanvas } = await import('canvas');

      // Load the PDF
      const pdfData = new Uint8Array(req.file.buffer);
      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      
      console.log(`[Gallery Import] PDF has ${pdf.numPages} pages`);

      // Get all contestants for name matching
      const allContestants = await storage.getContestants();
      console.log(`[Gallery Import] Found ${allContestants.length} contestants in database`);

      // Create name lookup maps (case-insensitive, trimmed, normalized spaces)
      const contestantByName = new Map<string, typeof allContestants[0]>();
      const contestantByFirstLastName = new Map<string, typeof allContestants[0]>();
      const matchedContestantIds = new Set<string>(); // Track which contestants already have photos assigned
      
      allContestants.forEach(c => {
        // Normalize: lowercase, trim, and collapse multiple spaces to single space
        const normalized = c.name.toLowerCase().trim().replace(/\s+/g, ' ');
        contestantByName.set(normalized, c);
        
        // Also create lookup by "FirstName LastName" format (in case PDF has different formatting)
        const parts = c.name.split(/\s+/).filter(p => p.length > 0);
        if (parts.length >= 2) {
          // Try first and last only
          const firstLast = `${parts[0]} ${parts[parts.length - 1]}`.toLowerCase();
          contestantByFirstLastName.set(firstLast, c);
        }
      });

      interface ExtractedEntry {
        imageData: Buffer;
        imageName: string;
        imageY: number;
        textItems: { text: string; y: number }[];
        matchedName: string | null;
        matchedContestant: typeof allContestants[0] | null;
        page: number;
      }

      const extractedEntries: ExtractedEntry[] = [];
      const uploadPath = path.join(process.cwd(), 'uploads', 'photos');
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      // Process each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        
        console.log(`[Gallery Import] Processing page ${pageNum}, dimensions: ${viewport.width}x${viewport.height}`);

        // Get text content with positions
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map((item: any) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          height: item.height
        })).filter((item: any) => item.text.trim().length > 0);

        // Get operator list to find images
        const operatorList = await page.getOperatorList();
        const { fnArray, argsArray } = operatorList;

        // Track transform matrices to get image positions
        let currentTransform = [1, 0, 0, 1, 0, 0];
        const transformStack: number[][] = [];

        for (let i = 0; i < fnArray.length; i++) {
          const op = fnArray[i];
          const args = argsArray[i];

          // Track transform operations
          if (op === pdfjsLib.OPS.save) {
            transformStack.push([...currentTransform]);
          } else if (op === pdfjsLib.OPS.restore) {
            if (transformStack.length > 0) {
              currentTransform = transformStack.pop()!;
            }
          } else if (op === pdfjsLib.OPS.transform) {
            // Multiply matrices
            const [a, b, c, d, e, f] = args;
            const [a2, b2, c2, d2, e2, f2] = currentTransform;
            currentTransform = [
              a * a2 + b * c2,
              a * b2 + b * d2,
              c * a2 + d * c2,
              c * b2 + d * d2,
              e * a2 + f * c2 + e2,
              e * b2 + f * d2 + f2
            ];
          }

          // Check for image painting operations
          if (op === pdfjsLib.OPS.paintImageXObject || op === pdfjsLib.OPS.paintJpegXObject) {
            const imageName = args[0];
            
            // Get image position from current transform
            const imageX = currentTransform[4];
            const imageY = currentTransform[5];
            const imageWidth = Math.abs(currentTransform[0]);
            const imageHeight = Math.abs(currentTransform[3]);

            // Skip very small images (likely icons/bullets)
            if (imageWidth < 50 || imageHeight < 50) {
              continue;
            }

            console.log(`[Gallery Import] Found image '${imageName}' at (${imageX}, ${imageY}), size: ${imageWidth}x${imageHeight}`);

            // Get the image data
            try {
              const image: any = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
                page.objs.get(imageName, (img: any) => {
                  clearTimeout(timeout);
                  resolve(img);
                });
              });

              if (image && image.width > 0 && image.height > 0) {
                // Create canvas and draw image
                const canvas = createCanvas(image.width, image.height);
                const ctx = canvas.getContext('2d');
                
                // Handle different image data formats
                let imageDataArray: Uint8ClampedArray;
                if (image.data && image.data.length > 0) {
                  // Standard format - RGBA data
                  if (image.data.length === image.width * image.height * 4) {
                    imageDataArray = new Uint8ClampedArray(image.data);
                  } else if (image.data.length === image.width * image.height * 3) {
                    // RGB to RGBA conversion
                    imageDataArray = new Uint8ClampedArray(image.width * image.height * 4);
                    for (let j = 0; j < image.width * image.height; j++) {
                      imageDataArray[j * 4] = image.data[j * 3];
                      imageDataArray[j * 4 + 1] = image.data[j * 3 + 1];
                      imageDataArray[j * 4 + 2] = image.data[j * 3 + 2];
                      imageDataArray[j * 4 + 3] = 255;
                    }
                  } else {
                    console.log(`[Gallery Import] Skipping image '${imageName}' - unexpected data format (${image.data.length} bytes for ${image.width}x${image.height})`);
                    continue;
                  }

                  const imgData = ctx.createImageData(image.width, image.height);
                  imgData.data.set(imageDataArray);
                  ctx.putImageData(imgData, 0, 0);

                  const buffer = canvas.toBuffer('image/png');

                  // Find text items near this image (ABOVE the image in the PDF layout)
                  // PDF coordinates: origin at bottom-left, Y increases upward
                  // Text that appears ABOVE the image has a HIGHER Y value
                  // So textY > imageY means text is above the image
                  const nearbyText = textItems.filter((t: any) => {
                    const yDiff = t.y - imageY; // positive if text is ABOVE image
                    const xDiff = Math.abs(t.x - imageX);
                    // Text should be above image (within 150 units) and strictly within the image column
                    // Use tight horizontal tolerance (half the image width) to avoid cross-column matches
                    return yDiff > -30 && yDiff < 150 && xDiff < imageWidth * 0.8;
                  }).sort((a: any, b: any) => {
                    // Sort by proximity: closest to image top edge first
                    const aDiff = Math.abs(a.y - imageY);
                    const bDiff = Math.abs(b.y - imageY);
                    return aDiff - bDiff;
                  });

                  extractedEntries.push({
                    imageData: buffer,
                    imageName,
                    imageY,
                    textItems: nearbyText,
                    matchedName: null,
                    matchedContestant: null,
                    page: pageNum
                  });
                }
              }
            } catch (imgError) {
              console.log(`[Gallery Import] Could not extract image '${imageName}': ${imgError}`);
            }
          }
        }
      }

      console.log(`[Gallery Import] Extracted ${extractedEntries.length} images from PDF`);

      // Match extracted images to contestants
      let matchedCount = 0;
      let unmatchedNames: string[] = [];

      for (const entry of extractedEntries) {
        // Try to find a name in the text items
        for (const textItem of entry.textItems) {
          const text = textItem.text.trim();
          
          // Skip location-only text (single words that look like suburbs)
          if (text.split(/\s+/).length === 1 && !contestantByName.has(text.toLowerCase().replace(/\s+/g, ' '))) {
            continue;
          }

          // Normalize text: lowercase, trim, collapse multiple spaces
          const normalizedText = text.toLowerCase().trim().replace(/\s+/g, ' ');
          let contestant = contestantByName.get(normalizedText);
          
          // Try first-last name match
          if (!contestant) {
            contestant = contestantByFirstLastName.get(normalizedText);
          }

          // Try fuzzy match - check if text contains a contestant name
          if (!contestant) {
            for (const [name, c] of contestantByName) {
              if (normalizedText.includes(name) || name.includes(normalizedText)) {
                contestant = c;
                break;
              }
            }
          }

          // Only use this match if contestant hasn't already been matched to another image
          if (contestant && !matchedContestantIds.has(contestant.id)) {
            entry.matchedName = text;
            entry.matchedContestant = contestant;
            matchedContestantIds.add(contestant.id); // Mark as matched to prevent duplicates
            console.log(`[Gallery Import] Matched "${text}" to contestant: ${contestant.name} (ID: ${contestant.id})`);
            break;
          }
        }

        if (!entry.matchedContestant && entry.textItems.length > 0) {
          unmatchedNames.push(entry.textItems.map(t => t.text).join(' | '));
        }
      }

      // Save photos for matched contestants
      const results: { contestantId: string; contestantName: string; photoUrl: string }[] = [];
      const errors: { name: string; error: string }[] = [];

      for (const entry of extractedEntries) {
        if (entry.matchedContestant) {
          try {
            // Delete old photo if exists
            if (entry.matchedContestant.photoUrl) {
              const oldFilePath = path.join(process.cwd(), entry.matchedContestant.photoUrl.replace(/^\//, ''));
              if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
              }
            }

            // Save new photo
            const filename = `contestant-gallery-${entry.matchedContestant.id}-${Date.now()}.png`;
            const filePath = path.join(uploadPath, filename);
            fs.writeFileSync(filePath, entry.imageData);

            const photoUrl = `/uploads/photos/${filename}`;
            await storage.updateContestantPhoto(entry.matchedContestant.id, photoUrl);

            results.push({
              contestantId: entry.matchedContestant.id,
              contestantName: entry.matchedContestant.name,
              photoUrl
            });
            matchedCount++;
          } catch (saveError: any) {
            console.error(`[Gallery Import] Error saving photo for ${entry.matchedContestant.name}:`, saveError);
            errors.push({
              name: entry.matchedContestant.name,
              error: saveError.message
            });
          }
        }
      }

      console.log(`[Gallery Import] Complete: ${matchedCount} photos imported, ${unmatchedNames.length} unmatched`);

      res.json({
        message: `Successfully imported ${matchedCount} photos from ${extractedEntries.length} images found in PDF`,
        imported: matchedCount,
        totalImages: extractedEntries.length,
        unmatched: unmatchedNames.slice(0, 20), // Limit to first 20
        errors: errors.slice(0, 10),
        results
      });

    } catch (error: any) {
      console.error("[Gallery Import] Error:", error);
      res.status(500).json({ 
        error: "Failed to import gallery PDF",
        details: error.message 
      });
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
        // Read workbook - handle both .xls (binary) and .xlsx formats
        const workbook = xlsx.read(req.file.buffer, { 
          type: "buffer",
          cellFormula: false,
          cellStyles: false 
        });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Get all rows as arrays first to find header row
        const allRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[];
        
        if (!allRows || allRows.length === 0) {
          return res.status(400).json({ error: "The uploaded file is empty or has no data rows." });
        }
        
        // Find first row with actual content (skip completely empty rows)
        let headerRowIndex = 0;
        for (let i = 0; i < allRows.length; i++) {
          const row = allRows[i] as any[];
          const hasContent = row.some(cell => cell && cell.toString().trim() !== "");
          if (hasContent) {
            headerRowIndex = i;
            break;
          }
        }
        
        // Extract headers and data rows
        const headers = (allRows[headerRowIndex] as any[])
          .map((h: any) => h ? h.toString().trim() : "")
          .filter(h => h !== "");
        
        const dataRows = allRows.slice(headerRowIndex + 1);
        
        // Convert to objects
        rawData = dataRows.map((row: any[]) => {
          const obj: any = {};
          headers.forEach((header, index) => {
            if (row[index] !== undefined && row[index] !== null) {
              obj[header] = row[index];
            }
          });
          return obj;
        }).filter(row => Object.keys(row).length > 0 && Object.values(row).some(v => v !== "" && v !== null && v !== undefined));
        
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
        console.log("First data row:", JSON.stringify(rawData[0], null, 2));
        // Log which columns match audition rating patterns
        const auditRatingCandidates = Object.keys(rawData[0]).filter(k => 
          k.toLowerCase().includes('audit') || k.toLowerCase().includes('rating')
        );
        console.log("Audition rating column candidates:", auditRatingCandidates);
        
        // Log which columns match group size patterns
        const groupSizeCandidates = Object.keys(rawData[0]).filter(k => {
          const lk = k.toLowerCase();
          return lk.includes('group') || lk.includes('size') || lk.includes('party');
        });
        console.log("Group size column candidates:", groupSizeCandidates);
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
        
        // Get audition rating - try all possible column variations, then fallback to any column containing "audition" or "rating" or "score"
        let auditionRatingValue = getColumnValue(row,
                                    "Audition Score", "AUDITION SCORE", "audition score",
                                    "Audition Rati", "AUDITION RATI", "Audition Rati",
                                    "Audition Rating", "AUDITION RATING", "audition rating",
                                    "Rating", "RATING", "rating",
                                    "Score", "SCORE", "score");
        
        // If not found, look for any column with audition or rating or score in the name
        if (!auditionRatingValue) {
          const auditionCol = Object.keys(row).find(k => 
            k.toLowerCase().includes('audit') || k.toLowerCase().includes('rating') || k.toLowerCase().includes('score')
          );
          if (auditionCol && row[auditionCol]) {
            auditionRatingValue = row[auditionCol].toString();
          }
        }
        
        if (auditionRatingValue) {
          console.log(`Found audition rating for ${nameValue}: '${auditionRatingValue}'`);
        }
        
        // Get group size from column - try all possible column variations
        let groupSizeValue = getColumnValue(row,
                               "Group Size", "GROUP SIZE", "group size",
                               "GroupSize", "GROUPSIZE", "groupsize",
                               "Size", "SIZE", "size",
                               "Number in Group", "NUMBER IN GROUP", "number in group",
                               "No. in Group", "NO. IN GROUP", "no. in group",
                               "Group #", "GROUP #", "group #",
                               "Party Size", "PARTY SIZE", "party size",
                               "Group Count", "GROUP COUNT", "group count",
                               "Num in Group", "NUM IN GROUP", "num in group",
                               "# in Group", "# IN GROUP", "# in group",
                               "Grp Size", "GRP SIZE", "grp size");
        
        // If not found, look for any column with "group" and ("size" or "number" or "count" or "#") in the name
        if (!groupSizeValue) {
          const groupSizeCol = Object.keys(row).find(k => {
            const lowerKey = k.toLowerCase();
            return (lowerKey.includes('group') && (lowerKey.includes('size') || lowerKey.includes('number') || lowerKey.includes('count') || lowerKey.includes('#') || lowerKey.includes('no'))) ||
                   (lowerKey.includes('party') && lowerKey.includes('size')) ||
                   (lowerKey === 'size' || lowerKey === 'grp size');
          });
          if (groupSizeCol && row[groupSizeCol]) {
            groupSizeValue = row[groupSizeCol].toString();
            console.log(`Found group size for ${nameValue} in column '${groupSizeCol}': '${groupSizeValue}'`);
          }
        }
        
        // Log the raw value found before parsing
        if (groupSizeValue) {
          console.log(`Raw group size value for ${nameValue}: '${groupSizeValue}' (type: ${typeof groupSizeValue})`);
        }
        
        const parsedGroupSize = groupSizeValue ? parseInt(groupSizeValue.toString()) : null;
        
        if (parsedGroupSize && !isNaN(parsedGroupSize)) {
          console.log(`Parsed group size for ${nameValue}: ${parsedGroupSize}`);
        } else if (groupSizeValue) {
          console.log(`Failed to parse group size for ${nameValue} - raw value: '${groupSizeValue}'`);
        }
        
        // Get postcode from column
        const postcodeValue = getColumnValue(row,
                              "Postcode", "POSTCODE", "postcode",
                              "Post Code", "POST CODE", "post code",
                              "Zip", "ZIP", "zip",
                              "Zip Code", "ZIP CODE", "zip code");
        
        // Get state from column (or extract from postcode for Australian postcodes)
        const stateValue = getColumnValue(row,
                           "State", "STATE", "state",
                           "Province", "PROVINCE", "province",
                           "Region", "REGION", "region");
        
        // Get standby indicator from Labels column (marks if available for standby from import)
        // The Labels column can have multiple values, only set standby if it contains "standby"
        const labelsValue = getColumnValue(row,
                             "Labels", "LABELS", "labels",
                             "Label", "LABEL", "label",
                             "Standby", "STANDBY", "standby",
                             "Is Standby", "IS STANDBY", "is standby",
                             "Available for Standby", "AVAILABLE FOR STANDBY", "available for standby",
                             "Backup", "BACKUP", "backup");
        // Check if labels contain "standby" (case-insensitive)
        const standbyValue = labelsValue && labelsValue.toString().toLowerCase().includes('standby') ? 'standby' : null;
        
        // Get podium story indicator from column
        const podiumStoryValue = getColumnValue(row,
                             "Podium Story", "PODIUM STORY", "podium story",
                             "PodiumStory", "PODIUMSTORY", "podiumstory",
                             "PS", "Has Story", "HAS STORY", "has story");
        
        // Get availability notes from column
        const availabilityNotesValue = getColumnValue(row,
                             "Availability", "AVAILABILITY", "availability",
                             "Availability Notes", "AVAILABILITY NOTES", "availability notes",
                             "Available", "AVAILABLE", "available",
                             "Avail", "AVAIL", "avail",
                             "Schedule", "SCHEDULE", "schedule");
        
        return {
          name: nameValue.toString().trim(),
          age: isNaN(parsedAge) ? 0 : parsedAge,
          gender: genderValue,
          auditionRating: auditionRatingValue || undefined,
          groupSize: (parsedGroupSize && !isNaN(parsedGroupSize)) ? parsedGroupSize : undefined,
          postcode: postcodeValue ? postcodeValue.toString().trim() : undefined,
          state: stateValue ? stateValue.toString().trim() : undefined,
          availableForStandby: standbyValue ? standbyValue.toString().trim().toLowerCase() === 'standby' : false,
          podiumStory: (() => {
            if (!podiumStoryValue) return false;
            const val = podiumStoryValue.toString().trim().toLowerCase();
            // Check for "podium story" value or common true values
            if (val === 'podium story' || val === 'podiumstory' || val === 'ps') return true;
            if (['yes', 'y', 'true', '1', 'x'].includes(val)) return true;
            return false;
          })(),
          availabilityNotes: availabilityNotesValue ? availabilityNotesValue.toString().trim() : undefined,
          // Handle GROUP ID column or Attending With column
          groupIdFromFile: row["GROUP ID"] || row["Group ID"] || row["group id"] || row["Group"] || row["GROUP"] || null,
          attendingWith: row["ATTENDING WITH"] || row["Attending With"] || row["attending with"] || 
                         row["Attending with"] || row.attendingWith || row["AttendingWith"] ||
                         row["ATTENDING"] || row["Attending"] || row["attending"] ||
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
          medicalInfo: (() => {
            const val = row["MEDICAL CONDITIONS"] || row["Medical Conditions"] || row["medical conditions"] ||
                       row["Health Conditions"] || row["HEALTH CONDITIONS"] || null;
            if (!val) return null;
            const trimmed = val.toString().trim().toLowerCase();
            return (trimmed === 'n/a' || trimmed === 'na' || trimmed === 'none' || trimmed === '-' || trimmed === 'no' || trimmed === 'n') ? null : val;
          })(),
          mobilityNotes: (() => {
            const val = getColumnValue(row,
                         "Mobility Access/Medical Notes", "MOBILITY ACCESS/MEDICAL NOTES",
                         "Mobility/Access/Medical Notes", "MOBILITY/ACCESS/MEDICAL NOTES",
                         "Mobility/Access/Medical notes", "mobility/access/medical notes",
                         "CO Mobility/Acc", "CO MOBILITY/ACC");
            if (!val) return null;
            const trimmed = val.toString().trim().toLowerCase();
            return (trimmed === 'n/a' || trimmed === 'na' || trimmed === 'none' || trimmed === '-') ? null : val;
          })(),
          criminalRecord: (() => {
            const val = getColumnValue(row,
                          "Criminal Rec", "CRIMINAL REC",
                          "Criminal Record", "CRIMINAL RECORD", "criminal record",
                          "Criminal", "CRIMINAL",
                          "Background", "BACKGROUND",
                          "Background Check", "BACKGROUND CHECK");
            if (!val) return null;
            const trimmed = val.toString().trim().toLowerCase();
            return (trimmed === 'n/a' || trimmed === 'na' || trimmed === 'none' || trimmed === '-') ? null : val;
          })(),
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
        const allGroups = await storage.getGroups();
        const existingGroupsByRef = new Map(allGroups.map((g: any) => [g.referenceNumber, g.id]));
        
        for (const fileGroupId of Array.from(fileGroupIds)) {
          const membersInGroup = data.filter((row: any) => row.groupIdFromFile === fileGroupId);
          if (membersInGroup.length > 1) {
            const refNumber = `GRP${String(fileGroupId)}`;
            let groupId = existingGroupsByRef.get(refNumber);
            
            // Create group only if it doesn't exist
            if (!groupId) {
              const group = await storage.createGroup({
                referenceNumber: refNumber,
              });
              groupId = group.id;
            }
            
            createdGroups.set(String(fileGroupId), groupId);
            membersInGroup.forEach((member: any) => {
              nameToGroupId.set(member.name, groupId);
            });
          }
        }
      } else {
        // Use Attending With column for grouping
        const groupMap = identifyGroups(data);
        const allGroups = await storage.getGroups();
        const existingGroupsByRef = new Map(allGroups.map((g: any) => [g.referenceNumber, g.id]));
        
        // Find the next available group number (start after existing groups)
        let groupCounter = 1;
        while (existingGroupsByRef.has(`GRP${String(groupCounter).padStart(3, "0")}`)) {
          groupCounter++;
        }
        
        for (const [groupId, members] of Array.from(groupMap.entries())) {
          if (members.length > 1) {
            // Always create a new group with a unique reference number
            const refNumber = `GRP${String(groupCounter).padStart(3, "0")}`;
            const group = await storage.createGroup({
              referenceNumber: refNumber,
            });
            const dbGroupId = group.id;
            
            createdGroups.set(groupId, dbGroupId);
            members.forEach((member: string) => {
              // Use case-insensitive matching to set group ID
              const matchedContestant = data.find((d: any) => d.name.toLowerCase().trim() === member.toLowerCase().trim());
              if (matchedContestant) {
                nameToGroupId.set(matchedContestant.name, dbGroupId);
              }
            });
            groupCounter++;
          }
        }
      }

      // Get existing contestants to check for duplicates
      const existingContestants = await storage.getContestants();
      const existingNames = new Set(
        existingContestants.map((c: any) => c.name?.toLowerCase().trim()).filter(Boolean)
      );
      const existingEmails = new Set(
        existingContestants.map((c: any) => c.email?.toLowerCase().trim()).filter(Boolean)
      );
      
      // Create contestants, skipping duplicates and DNU-rated contestants
      const createdContestants = [];
      const skippedDuplicates = [];
      const skippedDNU = [];
      
      for (const row of data as any[]) {
        const normalizedName = row.name?.toLowerCase().trim();
        const normalizedEmail = row.email?.toLowerCase().trim();
        
        // Skip contestants with DNU (Do Not Use) rating
        if (row.auditionRating && row.auditionRating.toString().toUpperCase().trim() === 'DNU') {
          skippedDNU.push({ name: row.name, reason: 'Rated DNU (Do Not Use)' });
          continue;
        }
        
        // Check for duplicate by name (exact match) or email
        const isDuplicateName = normalizedName && existingNames.has(normalizedName);
        const isDuplicateEmail = normalizedEmail && existingEmails.has(normalizedEmail);
        
        if (isDuplicateName || isDuplicateEmail) {
          skippedDuplicates.push({
            name: row.name,
            reason: isDuplicateName ? 'Name already exists' : 'Email already exists'
          });
          continue;
        }
        
        const contestant = await storage.createContestant({
          name: row.name,
          age: row.age,
          gender: row.gender,
          attendingWith: row.attendingWith,
          email: row.email,
          phone: row.phone,
          location: row.location,
          postcode: row.postcode,
          state: row.state,
          medicalInfo: row.medicalInfo,
          mobilityNotes: row.mobilityNotes,
          criminalRecord: row.criminalRecord,
          auditionRating: row.auditionRating,
          groupSize: row.groupSize,
          groupId: nameToGroupId.get(row.name) || null,
          availabilityStatus: "available",
          availableForStandby: row.availableForStandby,
          podiumStory: row.podiumStory,
          availabilityNotes: row.availabilityNotes,
        });
        createdContestants.push(contestant);
        
        // Add to existing sets to prevent duplicates within same import
        if (normalizedName) existingNames.add(normalizedName);
        if (normalizedEmail) existingEmails.add(normalizedEmail);
      }

      let message = `Successfully imported ${createdContestants.length} contestants`;
      if (skippedDuplicates.length > 0 || skippedDNU.length > 0) {
        const parts = [];
        if (skippedDuplicates.length > 0) parts.push(`${skippedDuplicates.length} duplicates`);
        if (skippedDNU.length > 0) parts.push(`${skippedDNU.length} DNU-rated`);
        message = `Imported ${createdContestants.length} contestants, skipped ${parts.join(' and ')}`;
      }

      res.json({
        message,
        contestants: createdContestants,
        contestantsCreated: createdContestants.length,
        groupsCreated: createdGroups.size,
        skippedDuplicates: skippedDuplicates.length,
        skippedDNU: skippedDNU.length,
        duplicates: skippedDuplicates.slice(0, 20), // Show first 20 duplicates
        dnuContestants: skippedDNU.slice(0, 20), // Show first 20 DNU-rated
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
      
      // Convert empty strings to null for enum fields
      const body = { ...req.body };
      if (body.playerType === '') {
        body.playerType = null;
      }
      if (body.auditionRating === '') {
        body.auditionRating = null;
      }
      if (body.gender === '') {
        body.gender = null;
      }
      if (body.availabilityStatus === '') {
        body.availabilityStatus = null;
      }
      
      const updated = await storage.updateContestant(req.params.id, body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manual group linking - Create new group and link selected contestants
  app.post("/api/groups/manual", async (req, res) => {
    try {
      const { contestantIds } = req.body;
      
      if (!contestantIds || !Array.isArray(contestantIds) || contestantIds.length < 2) {
        return res.status(400).json({ error: "At least 2 contestant IDs are required to form a group" });
      }
      
      // Verify all contestants exist
      const contestants = await Promise.all(
        contestantIds.map((id: string) => storage.getContestantById(id))
      );
      
      const invalidIds = contestantIds.filter((id: string, index: number) => !contestants[index]);
      if (invalidIds.length > 0) {
        return res.status(404).json({ error: `Contestants not found: ${invalidIds.join(', ')}` });
      }
      
      // Check if any contestants are already in groups
      const alreadyGrouped = contestants.filter(c => c?.groupId);
      if (alreadyGrouped.length > 0) {
        return res.status(400).json({ 
          error: `Some contestants are already in groups: ${alreadyGrouped.map(c => c?.name).join(', ')}. Please unlink them first.` 
        });
      }
      
      // Create a new group with a unique reference number
      const refNumber = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
      const group = await storage.createGroup({ referenceNumber: refNumber });
      
      // Link all contestants to the new group
      await Promise.all(
        contestantIds.map((id: string) => storage.updateContestant(id, { groupId: group.id }))
      );
      
      // Get updated contestants
      const updatedContestants = await Promise.all(
        contestantIds.map((id: string) => storage.getContestantById(id))
      );
      
      res.json({ 
        success: true, 
        group, 
        contestants: updatedContestants,
        message: `Successfully linked ${contestantIds.length} contestants into group ${refNumber}`
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add contestant to existing group
  app.post("/api/contestants/:id/link-to-group", async (req, res) => {
    try {
      const { groupId } = req.body;
      
      if (!groupId) {
        return res.status(400).json({ error: "groupId is required" });
      }
      
      const contestant = await storage.getContestantById(req.params.id);
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }
      
      if (contestant.groupId) {
        return res.status(400).json({ error: "Contestant is already in a group. Unlink them first." });
      }
      
      const group = await storage.getGroupById(groupId);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      
      const updated = await storage.updateContestant(req.params.id, { groupId });
      res.json({ success: true, contestant: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove contestant from their group
  app.post("/api/contestants/:id/unlink-group", async (req, res) => {
    try {
      const contestant = await storage.getContestantById(req.params.id);
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }
      
      if (!contestant.groupId) {
        return res.status(400).json({ error: "Contestant is not in a group" });
      }
      
      const oldGroupId = contestant.groupId;
      
      // Remove contestant from group
      const updated = await storage.updateContestant(req.params.id, { groupId: null });
      
      // Check if the group is now empty and delete it if so
      const allContestants = await storage.getContestants();
      const remainingMembers = allContestants.filter(c => c.groupId === oldGroupId);
      
      if (remainingMembers.length === 0) {
        // Group is empty, delete it
        await db.delete(groups).where(eq(groups.id, oldGroupId));
      } else if (remainingMembers.length === 1) {
        // Only one member left, unlink them too (a group needs at least 2 members)
        await storage.updateContestant(remainingMembers[0].id, { groupId: null });
        await db.delete(groups).where(eq(groups.id, oldGroupId));
      }
      
      res.json({ 
        success: true, 
        contestant: updated,
        message: `${contestant.name} has been removed from their group.`
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get contestants in a specific group
  app.get("/api/groups/:id/contestants", async (req, res) => {
    try {
      const group = await storage.getGroupById(req.params.id);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      
      const allContestants = await storage.getContestants();
      const groupMembers = allContestants.filter(c => c.groupId === req.params.id);
      
      res.json({ group, contestants: groupMembers });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete ALL contestants (with cascading deletes)
  // NOTE: This route MUST come before /api/contestants/:id to avoid "all" being treated as an ID
  app.delete("/api/contestants/all", async (req, res) => {
    try {
      // Get all contestants first to count them
      const allContestants = await storage.getContestants();
      const count = allContestants.length;
      
      if (count === 0) {
        return res.json({ message: "No contestants to delete", deletedCount: 0 });
      }

      // Use direct database operations for efficient bulk deletes
      // Delete related data first (cascade) in proper order for foreign key constraints
      
      // 1. Delete all booking confirmation tokens (references seat_assignments)
      await db.delete(bookingConfirmationTokens);
      
      // 2. Delete all seat assignments (references contestants, record_days)
      await db.delete(seatAssignments);
      
      // 3. Delete all standby confirmation tokens (references standby_assignments)
      await db.delete(standbyConfirmationTokens);
      
      // 4. Delete all standby assignments (references contestants, record_days)
      await db.delete(standbyAssignments);
      
      // 5. Delete all canceled assignments (references contestants, record_days)
      await db.delete(canceledAssignments);
      
      // 6. Delete all contestant availability (references contestants, record_days)
      await db.delete(contestantAvailability);
      
      // 7. Delete all availability tokens (references contestants, record_days)
      await db.delete(availabilityTokens);
      
      // 8. Delete all contestants (this will also remove group associations)
      await db.delete(contestants);
      
      // 9. Delete all groups (now safe since no contestants reference them)
      await db.delete(groups);
      
      console.log(`[Delete All] Deleted ${count} contestants and all related data`);
      res.json({ 
        message: `Successfully deleted ${count} contestants and all related data`, 
        deletedCount: count 
      });
    } catch (error: any) {
      console.error("[Delete All] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete contestant (individual)
  app.delete("/api/contestants/:id", async (req, res) => {
    try {
      const contestant = await storage.getContestantById(req.params.id);
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }
      
      // Check if contestant has any seat assignments
      const assignments = await storage.getAllSeatAssignments();
      const hasAssignments = assignments.some((a: any) => a.contestantId === req.params.id);
      if (hasAssignments) {
        return res.status(400).json({ error: "Cannot delete contestant with active seat assignments" });
      }

      await storage.deleteContestant(req.params.id);
      res.json({ message: "Contestant deleted successfully" });
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
      const ratings = ["A+", "A", "B+", "B"];
      const ratingWeights = [0.05, 0.15, 0.25, 0.55]; // 5% A+, 15% A, 25% B+, 55% B

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

      // Helper to check if ratings are compatible for grouping
      // PB blocks: A, A+, B+, B only
      // NPB blocks: B, C only
      // So groups with C cannot have A, A+, or B+ (incompatible block types)
      const isPBOnlyRating = (rating: string) => ['A', 'A+', 'B+'].includes(rating);
      const isNPBOnlyRating = (rating: string) => rating === 'C';
      
      // Helper to get a compatible rating for a group
      // If any member has A, A+, or B+ -> all must be PB-compatible (A, A+, B+, B)
      // If any member has C -> all must be NPB-compatible (B, C)
      const getCompatibleRating = (existingRatings: string[]): string => {
        const hasPBOnly = existingRatings.some(isPBOnlyRating);
        const hasNPBOnly = existingRatings.some(isNPBOnlyRating);
        
        if (hasPBOnly) {
          // Must be PB-compatible: A, A+, B+, or B (weighted)
          const pbRatings = ['A', 'B+', 'B'];
          const pbWeights = [0.2, 0.4, 0.4];
          const rand = Math.random();
          let cumulative = 0;
          for (let i = 0; i < pbRatings.length; i++) {
            cumulative += pbWeights[i];
            if (rand < cumulative) return pbRatings[i];
          }
          return 'B';
        } else if (hasNPBOnly) {
          // Must be NPB-compatible: B only (C ratings no longer used in fake data)
          return 'B';
        }
        // No constraints yet, use weighted random
        return getWeightedRating();
      };

      // Create groups for about 80% of contestants (mix of pairs and trios)
      const shuffled = [...fakeContestants].sort(() => Math.random() - 0.5);
      const targetGrouped = Math.floor(totalCount * 0.80); // 80% in groups
      let groupedCount = 0;
      let idx = 0;
      
      while (groupedCount < targetGrouped && idx < shuffled.length - 1) {
        // Randomly decide group size: 70% pairs, 30% trios
        const groupSize = (Math.random() < 0.70 || idx >= shuffled.length - 2) ? 2 : 3;
        
        if (groupSize === 2 && shuffled[idx] && shuffled[idx + 1]) {
          // Create a pair - each person lists the other
          const person1 = shuffled[idx];
          const person2 = shuffled[idx + 1];
          
          // Ensure ratings are compatible - adjust if needed
          const ratings = [person1.auditionRating, person2.auditionRating];
          const hasPBOnly = ratings.some(isPBOnlyRating);
          const hasNPBOnly = ratings.some(isNPBOnlyRating);
          
          if (hasPBOnly && hasNPBOnly) {
            // Incompatible! Adjust the C-rated person to be PB-compatible
            if (isNPBOnlyRating(person1.auditionRating)) {
              person1.auditionRating = getCompatibleRating([person2.auditionRating]);
              const origIdx = fakeContestants.findIndex(c => c.name === person1.name);
              if (origIdx >= 0) fakeContestants[origIdx].auditionRating = person1.auditionRating;
            }
            if (isNPBOnlyRating(person2.auditionRating)) {
              person2.auditionRating = getCompatibleRating([person1.auditionRating]);
              const origIdx = fakeContestants.findIndex(c => c.name === person2.name);
              if (origIdx >= 0) fakeContestants[origIdx].auditionRating = person2.auditionRating;
            }
          }
          
          person1.attendingWith = person2.name;
          person2.attendingWith = person1.name;
          
          // Update in original array
          const idx1 = fakeContestants.findIndex(c => c.name === person1.name);
          const idx2 = fakeContestants.findIndex(c => c.name === person2.name);
          if (idx1 >= 0) fakeContestants[idx1].attendingWith = person2.name;
          if (idx2 >= 0) fakeContestants[idx2].attendingWith = person1.name;
          
          groupedCount += 2;
          idx += 2;
        } else if (groupSize === 3 && shuffled[idx] && shuffled[idx + 1] && shuffled[idx + 2]) {
          // Create a trio - each person lists all others
          const person1 = shuffled[idx];
          const person2 = shuffled[idx + 1];
          const person3 = shuffled[idx + 2];
          
          // Ensure ratings are compatible - adjust if needed
          const ratings = [person1.auditionRating, person2.auditionRating, person3.auditionRating];
          const hasPBOnly = ratings.some(isPBOnlyRating);
          const hasNPBOnly = ratings.some(isNPBOnlyRating);
          
          if (hasPBOnly && hasNPBOnly) {
            // Incompatible! Adjust C-rated persons to be PB-compatible
            const pbRatings = ratings.filter(r => !isNPBOnlyRating(r));
            [person1, person2, person3].forEach(person => {
              if (isNPBOnlyRating(person.auditionRating)) {
                person.auditionRating = getCompatibleRating(pbRatings);
                const origIdx = fakeContestants.findIndex(c => c.name === person.name);
                if (origIdx >= 0) fakeContestants[origIdx].auditionRating = person.auditionRating;
              }
            });
          }
          
          person1.attendingWith = `${person2.name}, ${person3.name}`;
          person2.attendingWith = `${person1.name}, ${person3.name}`;
          person3.attendingWith = `${person1.name}, ${person2.name}`;
          
          // Update in original array
          const idx1 = fakeContestants.findIndex(c => c.name === person1.name);
          const idx2 = fakeContestants.findIndex(c => c.name === person2.name);
          const idx3 = fakeContestants.findIndex(c => c.name === person3.name);
          if (idx1 >= 0) fakeContestants[idx1].attendingWith = `${person2.name}, ${person3.name}`;
          if (idx2 >= 0) fakeContestants[idx2].attendingWith = `${person1.name}, ${person3.name}`;
          if (idx3 >= 0) fakeContestants[idx3].attendingWith = `${person1.name}, ${person2.name}`;
          
          groupedCount += 3;
          idx += 3;
        } else {
          idx++;
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

      // Count grouped contestants
      const groupedContestantCount = fakeContestants.filter(c => c.attendingWith).length;
      const soloCount = fakeContestants.filter(c => !c.attendingWith).length;

      res.json({ 
        message: `Generated ${createdContestants.length} fake contestants (${groupedContestantCount} in groups, ${soloCount} solo)`,
        count: createdContestants.length,
        groupedCount: groupedContestantCount,
        soloCount: soloCount,
        groupedPercentage: Math.round((groupedContestantCount / createdContestants.length) * 100),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Fix contestant status consistency - updates contestants who show 'assigned' but have no seat assignments
  app.post("/api/contestants/fix-status", requireAuth, async (req, res) => {
    try {
      // Get all contestants
      const allContestants = await storage.getContestants();
      
      // Get all seat assignments
      const allSeatAssignments = await storage.getAllSeatAssignments();
      const assignedContestantIds = new Set(allSeatAssignments.map(a => a.contestantId));
      
      // Get all standby assignments
      const allStandbys = await storage.getStandbyAssignments();
      const standbyContestantIds = new Set(allStandbys.map(s => s.contestantId));
      
      // Find contestants with 'assigned' status but no actual assignments
      const orphanedAssigned = allContestants.filter(c => 
        c.availabilityStatus === 'assigned' && 
        !assignedContestantIds.has(c.id) &&
        !standbyContestantIds.has(c.id)
      );
      
      // Update their status to 'available'
      let fixedCount = 0;
      for (const contestant of orphanedAssigned) {
        await storage.updateContestantAvailability(contestant.id, 'available');
        fixedCount++;
      }
      
      console.log(`[Fix Status] Fixed ${fixedCount} contestants with orphaned 'assigned' status`);
      
      res.json({
        message: `Fixed ${fixedCount} contestants`,
        fixedCount,
        fixedContestants: orphanedAssigned.map(c => ({ id: c.id, name: c.name }))
      });
    } catch (error: any) {
      console.error("[Fix Status] Error:", error);
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

  // Update record day
  app.patch("/api/record-days/:id", async (req, res) => {
    try {
      const id = req.params.id;
      
      // Validate using partial schema
      const partialSchema = insertRecordDaySchema.partial();
      const validated = partialSchema.parse(req.body);
      
      const recordDay = await storage.updateRecordDay(id, validated);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      res.json(recordDay);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete record day (with safety checks)
  app.delete("/api/record-days/:id", async (req, res) => {
    try {
      const id = req.params.id;
      
      // Verify record day exists
      const recordDay = await storage.getRecordDayById(id);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      
      const result = await storage.deleteRecordDay(id);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({ success: true, message: "Record day deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      const { recordDayId, contestantId, blockNumber, seatLabel, playerType } = req.body;

      if (!recordDayId || !contestantId || !blockNumber || !seatLabel) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Validate playerType if provided
      if (playerType && !['player', 'backup', 'player_partner'].includes(playerType)) {
        return res.status(400).json({ error: "Invalid player type" });
      }

      // Check if contestant is DNU-rated (Do Not Use)
      const contestant = await storage.getContestantById(contestantId);
      if (contestant?.auditionRating?.toUpperCase().trim() === 'DNU') {
        return res.status(400).json({ error: "Cannot seat a DNU-rated contestant (Do Not Use)" });
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
      const standbyAssignment = existingStandbys.find((s: any) => s.contestantId === contestantId);
      
      // Allow rebooking if they've been moved to reschedule OR status is 'seated' (being seated now)
      // Otherwise, block if they're still an active standby
      if (standbyAssignment && !standbyAssignment.movedToReschedule && standbyAssignment.status !== 'seated') {
        return res.status(409).json({ error: "Contestant is already a standby for this record day. Remove them from standbys first." });
      }
      
      // Check if seat is already occupied
      const isSeatOccupied = existingAssignments.some((a: any) => 
        a.blockNumber === parseInt(blockNumber) && a.seatLabel === seatLabel
      );
      if (isSeatOccupied) {
        return res.status(409).json({ error: "This seat is already occupied" });
      }

      // Check for previous canceled assignments to carry over paperwork status
      const canceledAssignments = await storage.getCanceledAssignments();
      const previousCanceled = canceledAssignments.find(
        (c: any) => c.contestantId === contestantId && (c.paperworkSent || c.paperworkReceived)
      );

      const assignment = await storage.createSeatAssignment({
        recordDayId,
        contestantId,
        blockNumber: parseInt(blockNumber),
        seatLabel,
        playerType,
        // Carry over paperwork status from previous bookings
        paperworkSent: previousCanceled?.paperworkSent || undefined,
        paperworkReceived: previousCanceled?.paperworkReceived || undefined,
      });

      // Update contestant status to assigned
      await storage.updateContestantAvailability(contestantId, 'assigned');

      res.json(assignment);
    } catch (error: any) {
      // Handle conflict errors from database constraints
      if (error.message?.startsWith('SEAT_CONFLICT:')) {
        return res.status(409).json({ error: 'This seat was just taken by another user. Please refresh and try a different seat.' });
      }
      if (error.message?.startsWith('CONTESTANT_CONFLICT:')) {
        return res.status(409).json({ error: 'This contestant was just assigned by another user. Please refresh.' });
      }
      if (error.message?.startsWith('CONFLICT:')) {
        return res.status(409).json({ error: 'A conflict occurred. Another user may have made changes. Please refresh and try again.' });
      }
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

      // Check if any contestant is DNU-rated (Do Not Use)
      for (const contestantId of contestantIds) {
        const contestant = await storage.getContestantById(contestantId);
        if (contestant?.auditionRating?.toUpperCase().trim() === 'DNU') {
          return res.status(400).json({ error: `Cannot seat ${contestant.name} - they are DNU-rated (Do Not Use)` });
        }
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
        
        const standbyAssignment = existingStandbys.find((s: any) => s.contestantId === contestantId);
        // Allow rebooking if they've been moved to reschedule OR status is 'seated', otherwise block if still active standby
        if (standbyAssignment && !standbyAssignment.movedToReschedule && standbyAssignment.status !== 'seated') {
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

      // Get canceled assignments to check for paperwork status to carry over
      const allCanceledAssignments = await storage.getCanceledAssignments();

      // Create all assignments
      const assignments = [];
      for (let i = 0; i < contestantIds.length; i++) {
        const contestantId = contestantIds[i];
        
        // Check for previous canceled assignments to carry over paperwork status
        const previousCanceled = allCanceledAssignments.find(
          (c: any) => c.contestantId === contestantId && (c.paperworkSent || c.paperworkReceived)
        );
        
        const assignment = await storage.createSeatAssignment({
          recordDayId,
          contestantId,
          blockNumber: parseInt(blockNumber),
          seatLabel: seatLabels[i],
          // Carry over paperwork status from previous bookings
          paperworkSent: previousCanceled?.paperworkSent || undefined,
          paperworkReceived: previousCanceled?.paperworkReceived || undefined,
        });
        assignments.push(assignment);
        
        // Update contestant status to assigned
        await storage.updateContestantAvailability(contestantId, 'assigned');
      }

      res.json({
        message: `${contestantIds.length} contestants assigned to consecutive seats`,
        assignments,
        seats: seatLabels.map((seat, i) => ({ seat, block: blockNumber }))
      });
    } catch (error: any) {
      // Handle conflict errors from database constraints
      if (error.message?.startsWith('SEAT_CONFLICT:')) {
        return res.status(409).json({ error: 'A seat was just taken by another user. Please refresh and try again.' });
      }
      if (error.message?.startsWith('CONTESTANT_CONFLICT:')) {
        return res.status(409).json({ error: 'A contestant was just assigned by another user. Please refresh.' });
      }
      if (error.message?.startsWith('CONFLICT:')) {
        return res.status(409).json({ error: 'A conflict occurred. Another user may have made changes. Please refresh and try again.' });
      }
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

  // Get all seat assignments with winning money data (for Winners page)
  // IMPORTANT: This route MUST be before :recordDayId to avoid "with-winning-money" being captured as a param
  app.get("/api/seat-assignments/with-winning-money", async (req, res) => {
    try {
      // Prevent caching so we always get fresh data
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      // Use storage layer like all other routes
      const allAssignments = await storage.getAllSeatAssignments();
      
      // Filter for winners: must have valid role AND positive amount
      const winnersRaw = allAssignments.filter((a) => {
        const hasValidRole = a.winningMoneyRole && typeof a.winningMoneyRole === 'string' && a.winningMoneyRole.trim() !== '';
        const hasValidAmount = typeof a.winningMoneyAmount === 'number' && a.winningMoneyAmount > 0;
        return hasValidRole && hasValidAmount;
      });

      const recordDays = await storage.getRecordDays();
      const recordDaysMap = new Map(recordDays.map(rd => [rd.id, rd]));
      const contestants = await storage.getContestants();
      const contestantsMap = new Map(contestants.map(c => [c.id, c]));

      const winnersData = winnersRaw.map((a) => {
        const contestant = contestantsMap.get(a.contestantId);
        const recordDay = recordDaysMap.get(a.recordDayId);
        return {
          id: a.id,
          recordDayId: a.recordDayId,
          recordDayDate: recordDay?.date ? new Date(recordDay.date).toLocaleDateString() : '',
          contestantId: a.contestantId,
          contestantName: contestant?.name,
          age: contestant?.age,
          gender: contestant?.gender,
          auditionRating: contestant?.auditionRating,
          photoUrl: contestant?.photoUrl,
          phone: contestant?.phone,
          email: contestant?.email,
          blockNumber: a.blockNumber,
          seatLabel: a.seatLabel,
          rxNumber: a.rxNumber || '',
          rxEpNumber: a.rxEpNumber || '',
          caseNumber: a.caseNumber || '',
          winningMoneyRole: a.winningMoneyRole,
          winningMoneyAmount: a.winningMoneyAmount,
          caseAmount: a.caseAmount,
          quickCash: a.quickCash,
          bankOfferTaken: a.bankOfferTaken,
          spinTheWheel: a.spinTheWheel,
          prize: a.prize,
          txNumber: a.txNumber || '',
          txDate: a.txDate || '',
          notifiedOfTx: a.notifiedOfTx,
          photosSent: a.photosSent,
        };
      });

      res.json(winnersData);
    } catch (error: any) {
      console.error("Error fetching winners data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export winners data to Excel file
  // IMPORTANT: This route MUST be before :recordDayId to avoid being captured as a param
  app.get("/api/seat-assignments/with-winning-money/export", async (req, res) => {
    try {
      // Fetch all winners data (same as /with-winning-money endpoint)
      const allAssignments = await storage.getAllSeatAssignments();
      
      const winnersRaw = allAssignments.filter((a) => {
        const hasValidRole = a.winningMoneyRole && typeof a.winningMoneyRole === 'string' && a.winningMoneyRole.trim() !== '';
        const hasValidAmount = typeof a.winningMoneyAmount === 'number' && a.winningMoneyAmount > 0;
        return hasValidRole && hasValidAmount;
      });

      const recordDays = await storage.getRecordDays();
      const recordDaysMap = new Map(recordDays.map(rd => [rd.id, rd]));
      const contestants = await storage.getContestants();
      const contestantsMap = new Map(contestants.map(c => [c.id, c]));

      const winnersData = winnersRaw.map((a) => {
        const contestant = contestantsMap.get(a.contestantId);
        const recordDay = recordDaysMap.get(a.recordDayId);
        return {
          'RX Date': recordDay?.date ? new Date(recordDay.date).toLocaleDateString() : '',
          'RX Day': a.rxNumber || '',
          'RX Ep No.': a.rxEpNumber || '',
          'Contestant Type': a.winningMoneyRole === 'player' ? 'Player' : 'Case Holder',
          'Contestant Name': contestant?.name,
          'Phone': contestant?.phone || '',
          'Email': contestant?.email || '',
          'Age': contestant?.age,
          'Block': a.blockNumber,
          'Seat': a.seatLabel,
          'Case Number': a.caseNumber || '',
          'Case Amount': a.caseAmount || '',
          'Quick Cash': a.quickCash || '',
          'Bank Offer Taken': a.bankOfferTaken ? 'Yes' : 'No',
          'Amount Won': a.winningMoneyAmount || '',
          'Spin the Wheel': a.spinTheWheel ? 'Yes' : 'No',
          'Prize': a.prize || '',
        };
      });

      // Create Excel workbook with winners data
      const ws = xlsx.utils.json_to_sheet(winnersData);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Winners');

      // Send as downloadable file
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="winners.xlsx"');
      res.send(xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' }));
    } catch (error: any) {
      console.error("Error exporting winners data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get seat assignments for a record day
  app.get("/api/seat-assignments/:recordDayId", async (req, res) => {
    try {
      const assignments = await storage.getSeatAssignmentsByRecordDay(req.params.recordDayId);
      
      // Get standby assignments to check who was seated from standby
      const standbys = await storage.getStandbyAssignmentsByRecordDay(req.params.recordDayId);
      const seatedStandbyContestantIds = new Set(
        standbys.filter(s => s.status === 'seated').map(s => s.contestantId)
      );
      
      // Get full contestant data
      const contestantsData = await storage.getContestants();
      const contestantsMap = new Map(contestantsData.map((c) => [c.id, c]));

      // Create a groupId-to-members map for resolving group relationships
      const groupMembersMap = new Map<string, string[]>();
      contestantsData.forEach(c => {
        if (c.groupId) {
          const existing = groupMembersMap.get(c.groupId) || [];
          existing.push(c.id);
          groupMembersMap.set(c.groupId, existing);
        }
      });

      // Create a name-to-ID map ONLY for contestants assigned on THIS record day
      // This avoids false positives from duplicate names across different days
      const assignedContestantIds = new Set(assignments.map(a => a.contestantId));
      const nameToIdMapForThisDay = new Map<string, string[]>();
      contestantsData.forEach(c => {
        if (c.name && assignedContestantIds.has(c.id)) {
          const nameLower = c.name.toLowerCase();
          const existing = nameToIdMapForThisDay.get(nameLower) || [];
          existing.push(c.id);
          nameToIdMapForThisDay.set(nameLower, existing);
        }
      });

      // Flatten the data structure for frontend compatibility
      const enrichedAssignments = assignments.map((assignment) => {
        const contestant = contestantsMap.get(assignment.contestantId);
        
        // Resolve attendingWith - prefer groupId, fall back to name matching
        let attendingWithIds: string[] = [];
        
        if (contestant?.groupId) {
          // Method 1: Use groupId (most reliable)
          const groupMembers = groupMembersMap.get(contestant.groupId) || [];
          attendingWithIds = groupMembers.filter(id => id !== contestant.id);
        } else if (contestant?.attendingWith) {
          // Method 2: Fall back to name matching within this day's assignments only
          // Only match if there's exactly one person with that name on this day
          // Use shared parser for consistent parsing
          const parsedAttending = parseAttendingWith(contestant.attendingWith);
          if (!parsedAttending.isSolo) {
            for (const partnerName of parsedAttending.partnerNames) {
              const normalizedPartnerName = partnerName.toLowerCase().trim();
              const matchingIds = nameToIdMapForThisDay.get(normalizedPartnerName) || [];
              // Only use if exactly one match (avoid ambiguity with duplicate names)
              if (matchingIds.length === 1) {
                attendingWithIds.push(matchingIds[0]);
              }
            }
          }
        }
        const attendingWithId = attendingWithIds.length > 0 ? attendingWithIds.join(',') : undefined;
        
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
          playerType: assignment.playerType,
          originalBlockNumber: assignment.originalBlockNumber,
          originalSeatLabel: assignment.originalSeatLabel,
          swappedAt: assignment.swappedAt,
          rxNumber: assignment.rxNumber,
          rxEpNumber: assignment.rxEpNumber,
          caseNumber: assignment.caseNumber,
          winningMoneyRole: assignment.winningMoneyRole,
          winningMoneyAmount: assignment.winningMoneyAmount,
          caseAmount: assignment.caseAmount,
          quickCash: assignment.quickCash,
          bankOfferTaken: assignment.bankOfferTaken,
          spinTheWheel: assignment.spinTheWheel,
          prize: assignment.prize,
          contestantName: contestant?.name,
          age: contestant?.age,
          gender: contestant?.gender,
          groupId: contestant?.groupId,
          auditionRating: contestant?.auditionRating,
          attendingWith: attendingWithId,
          mobilityNotes: contestant?.mobilityNotes,
          wasStandby: seatedStandbyContestantIds.has(assignment.contestantId),
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
      
      // Get existing seat assignments for this record day to exclude already-assigned contestants
      const currentAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      const alreadyAssignedIds = new Set(currentAssignments.map(a => a.contestantId));
      availableAll = availableAll.filter(c => !alreadyAssignedIds.has(c.id));
      
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
      
      // Exclude A and A+ (must be manually assigned), DNU (Do Not Use), P (pending/special), and podium story contestants
      const aRatedContestants = availableAll.filter(c => c.auditionRating === 'A' || c.auditionRating === 'A+');
      const dnuContestants = availableAll.filter(c => c.auditionRating?.toUpperCase().trim() === 'DNU');
      const pContestants = availableAll.filter(c => c.auditionRating?.toUpperCase().trim() === 'P');
      const podiumStoryContestants = availableAll.filter(c => c.podiumStory === true);
      const available = availableAll.filter(c => 
        c.auditionRating !== 'A' &&
        c.auditionRating !== 'A+' && 
        c.auditionRating?.toUpperCase().trim() !== 'DNU' &&
        c.auditionRating?.toUpperCase().trim() !== 'P' &&
        c.podiumStory !== true
      );

      if (available.length === 0) {
        return res.status(400).json({ 
          error: "No available contestants to assign (A and A+ contestants must be manually assigned)",
          skippedACount: aRatedContestants.length
        });
      }

      // Configuration
      const BLOCKS = 7;
      const SEATS_PER_BLOCK = 22;
      const MAX_PB_SEATS = 18; // PB blocks fill 18 seats
      const MAX_NPB_SEATS = 22; // NPB blocks fill completely
      const MAX_C_PER_NPB = 6; // Maximum 6 C-rated contestants per NPB block
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
      // IMPORTANT: If there are duplicate names, we can't reliably match by name alone
      // Use shared normalizeName for consistent behavior across the system
      const nameToContestant = new Map<string, typeof available[0]>();
      const duplicateNames = new Set<string>();
      available.forEach(c => {
        // Use shared normalizeName for case-insensitive matching
        const key = sharedNormalizeName(c.name);
        if (nameToContestant.has(key)) {
          // Duplicate name detected - mark it so we don't use name-only matching
          duplicateNames.add(key);
          console.log(`[Auto-assign] WARNING: Duplicate name detected: "${c.name}" - will use groupId or bidirectional matching only`);
        }
        nameToContestant.set(key, c);
      });
      
      // Build groupId-based groups first (most reliable)
      const groupIdToContestants = new Map<string, typeof available>();
      available.forEach(c => {
        if (c.groupId) {
          if (!groupIdToContestants.has(c.groupId)) {
            groupIdToContestants.set(c.groupId, []);
          }
          groupIdToContestants.get(c.groupId)!.push(c);
        }
      });
      
      console.log(`[Auto-assign] Building groups from ${available.length} available contestants`);
      console.log(`[Auto-assign] Found ${groupIdToContestants.size} pre-existing groups from groupId field`);
      const contestantsWithAttendingWith = available.filter(c => c.attendingWith?.trim());
      console.log(`[Auto-assign] Contestants with attendingWith: ${contestantsWithAttendingWith.length}`);
      
      // Debug: Show first 5 contestants with attendingWith and if their partner exists
      contestantsWithAttendingWith.slice(0, 10).forEach(c => {
        const partnerName = c.attendingWith?.toLowerCase().trim();
        const partner = nameToContestant.get(partnerName || '');
        console.log(`[Auto-assign] DEBUG: ${c.name} (${c.auditionRating}) -> attendingWith: "${c.attendingWith}" -> partner found: ${partner ? `${partner.name} (${partner.auditionRating})` : 'NOT FOUND'}`);
      });

      // Track which contestants have been grouped
      const groupedContestantIds = new Set<string>();
      const groupMap = new Map<string, typeof available>();
      // Track contestants who have attendingWith but their partner is not available/accessible
      const contestantsWithUnavailablePartners = new Set<string>();

      // Helper: Check if person B lists person A (bidirectional verification)
      // Uses shared parser for consistent partner name extraction
      const listsEachOther = (personA: typeof available[0], personB: typeof available[0]): boolean => {
        // Use shared attendingWithMentionsName for consistent matching
        return attendingWithMentionsName(personB.attendingWith, personA.name);
      };

      // PHASE 1A: First, create groups from existing groupId field (most reliable)
      const groupIdEntries = Array.from(groupIdToContestants.entries());
      for (const [gId, members] of groupIdEntries) {
        // Filter out A+ rated contestants
        const eligibleMembers = members.filter((m: typeof available[0]) => m.auditionRating !== 'A' && m.auditionRating !== 'A+');
        if (eligibleMembers.length > 1) {
          const groupId = `dbgroup-${gId}`;
          groupMap.set(groupId, eligibleMembers);
          eligibleMembers.forEach((member: typeof available[0]) => groupedContestantIds.add(member.id));
          console.log(`[Auto-assign] Created group from groupId: ${eligibleMembers.map((m: typeof available[0]) => `${m.name}(${m.auditionRating})`).join(' + ')}`);
        } else if (eligibleMembers.length === 1 && members.length > 1) {
          // Has a group partner but they're A+ - can't auto-assign
          contestantsWithUnavailablePartners.add(eligibleMembers[0].id);
          console.log(`[Auto-assign] Skipping ${eligibleMembers[0].name} - group partner is A+ rated`);
        }
      }

      // Helper function to check if attendingWith indicates a true solo
      // Uses shared isSoloContestant for consistent solo detection across the system
      const isSoloIndicator = (value: string | null | undefined): boolean => {
        return isSoloContestant(value);
      };

      // PHASE 1B: Find groups based on attendingWith matching (with bidirectional verification for duplicate names)
      // BUT: Don't group anyone with an A+ contestant (A+ must be manually assigned)
      // Track groups to persist after the loop (to avoid async issues)
      const groupsToPersist: { groupMembers: typeof available }[] = [];
      
      for (const contestant of available) {
        if (groupedContestantIds.has(contestant.id)) continue;

        // If their attendingWith indicates solo, skip partner matching entirely - they'll be added as solo later
        if (isSoloIndicator(contestant.attendingWith)) {
          continue;
        }

        // Check if this contestant has an attendingWith value
        // Use shared parser to get partner names consistently
        const parsed = parseAttendingWith(contestant.attendingWith);
        
        if (!parsed.isSolo && parsed.partnerNames.length > 0) {
          // Get normalized partner names, filtering out the contestant's own name
          const contestantNormalizedName = sharedNormalizeName(contestant.name);
          const attendingWithNames = parsed.partnerNames
            .map((name: string) => sharedNormalizeName(name))
            .filter((name: string) => name !== contestantNormalizedName);

          // If all names were filtered out (contestant only listed themselves), skip
          if (attendingWithNames.length === 0) {
            continue;
          }

          // Find all matching people for this contestant
          const groupMembers: typeof available = [contestant];
          let hasNonAPlusPartners = false;
          let allPartnersFound = true;

          for (const name of attendingWithNames) {
            // Name is already normalized by the shared parser
            const normalizedName = name;
            const partner = nameToContestant.get(normalizedName);
            if (partner && partner.id !== contestant.id && !groupedContestantIds.has(partner.id)) {
              // For duplicate names, require bidirectional verification
              if (duplicateNames.has(normalizedName)) {
                // Only match if the partner also lists this contestant
                if (!listsEachOther(contestant, partner)) {
                  console.log(`[Auto-assign] Skipping match ${contestant.name} -> ${partner.name} - duplicate name requires bidirectional verification`);
                  allPartnersFound = false;
                  continue;
                }
              }
              
              // Only add if not A or A+ rated (they must be manually assigned)
              if (partner.auditionRating !== 'A' && partner.auditionRating !== 'A+') {
                groupMembers.push(partner);
                hasNonAPlusPartners = true;
              } else {
                // Partner is A+ and must be manually assigned, so this contestant can't be auto-assign
                allPartnersFound = false;
              }
            } else if (!partner) {
              // Partner not found in available contestants
              allPartnersFound = false;
            }
          }

          // Create a group if we found at least one valid partner
          if (hasNonAPlusPartners && groupMembers.length > 1) {
            const groupId = `group-${contestant.id}`;
            groupMap.set(groupId, groupMembers);
            groupMembers.forEach(member => groupedContestantIds.add(member.id));
            
            // Persist group to database if members don't already share a groupId
            const existingGroupIds = groupMembers.map(m => m.groupId).filter(Boolean);
            const sharedGroupId = existingGroupIds.length > 0 ? existingGroupIds[0] : null;
            
            if (!sharedGroupId) {
              groupsToPersist.push({ groupMembers });
            }
            
            console.log(`[Auto-assign] Created group: ${groupMembers.map(m => `${m.name}(${m.auditionRating})`).join(' + ')}`);
          } else if (!allPartnersFound) {
            // This contestant has an attendingWith but their partner is not available/accessible
            // Mark them so they won't be assigned as a solo either
            contestantsWithUnavailablePartners.add(contestant.id);
            console.log(`[Auto-assign] Skipping ${contestant.name} - partner(s) not available: "${contestant.attendingWith}"`);
          }
        }
      }
      
      // Persist newly discovered groups to database
      for (const { groupMembers } of groupsToPersist) {
        try {
          const refNumber = `AUTO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4)}`;
          const dbGroup = await storage.createGroup({ referenceNumber: refNumber });
          for (const member of groupMembers) {
            await storage.updateContestant(member.id, { groupId: dbGroup.id });
            member.groupId = dbGroup.id; // Update in-memory too
          }
          console.log(`[Auto-assign] Persisted group ${dbGroup.id} for: ${groupMembers.map(m => m.name).join(', ')}`);
        } catch (groupErr) {
          console.log(`[Auto-assign] Warning: Could not persist group: ${groupErr}`);
        }
      }

      // Second pass: add solo contestants (those not in any group AND don't have unavailable partners)
      // If someone has an attendingWith and their partner isn't available, they should NOT be assigned
      available.forEach((contestant) => {
        if (!groupedContestantIds.has(contestant.id) && !contestantsWithUnavailablePartners.has(contestant.id)) {
          // Only add as solo if they don't have an attendingWith requirement
          // OR if their attendingWith field indicates solo (empty, "Solo", "N/A", etc.)
          if (isSoloIndicator(contestant.attendingWith)) {
            const soloId = `solo-${contestant.id}`;
            groupMap.set(soloId, [contestant]);
          } else {
            // They have attendingWith but weren't grouped - means partner not found
            console.log(`[Auto-assign] Skipping ${contestant.name} - has attendingWith but partner not matched: "${contestant.attendingWith}"`);
          }
        }
      });

      // PHASE 1B: Split incompatible groups (A/A+/B+ mixed with C cannot be placed together)
      // PB blocks only accept A, A+, B+, B ratings
      // NPB blocks only accept B and C ratings
      // Therefore groups with both A/A+/B+ AND C members cannot be placed together in ANY block
      const finalGroupMap = new Map<string, typeof available>();
      
      const groupEntries = Array.from(groupMap.entries());
      for (const [groupId, members] of groupEntries) {
        if (members.length <= 1) {
          // Solo - keep as is
          finalGroupMap.set(groupId, members);
          continue;
        }
        
        // Check for rating incompatibility
        const hasAOrBPlus = members.some((m: typeof available[0]) => m.auditionRating === 'A' || m.auditionRating === 'A+' || m.auditionRating === 'B+');
        const hasCRating = members.some((m: typeof available[0]) => m.auditionRating === 'C');
        
        if (hasAOrBPlus && hasCRating) {
          // Incompatible group - split into solos
          console.log(`[Auto-assign] Splitting incompatible group: ${members.map((m: typeof available[0]) => `${m.name}(${m.auditionRating})`).join(' + ')} - A/B+ cannot be in same block as C`);
          members.forEach((member: typeof available[0], idx: number) => {
            finalGroupMap.set(`split-${groupId}-${idx}`, [member]);
          });
        } else {
          // Compatible group - keep together
          finalGroupMap.set(groupId, members);
        }
      }

      const bundles: GroupBundle[] = Array.from(finalGroupMap.entries()).map(([id, contestants]) => {
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
      
      const groupBundles = bundles.filter(b => b.size > 1);
      const soloBundles = bundles.filter(b => b.size === 1);
      console.log(`[Auto-assign] Total bundles: ${bundles.length} (${groupBundles.length} groups, ${soloBundles.length} solos)`);

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
        reservedSeats: Set<string>; // Seats reserved as empty for PB blocks
      };

      // Helper function to generate random consecutive seat pairs for PB blocks
      // Returns 2 pairs of consecutive seats (4 seats total) randomly selected
      const generateReservedPairs = (): Set<string> => {
        const reserved = new Set<string>();
        
        // Generate all possible consecutive pairs within each row
        const allPairs: { row: string; start: number }[] = [];
        for (const row of ROWS) {
          // A row with 5 seats can have pairs: (1,2), (2,3), (3,4), (4,5)
          for (let start = 1; start < row.count; start++) {
            allPairs.push({ row: row.label, start });
          }
        }
        
        // Shuffle the pairs using Fisher-Yates
        for (let i = allPairs.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [allPairs[i], allPairs[j]] = [allPairs[j], allPairs[i]];
        }
        
        // Pick 2 non-overlapping pairs
        const selectedPairs: { row: string; start: number }[] = [];
        for (const pair of allPairs) {
          // Check if this pair overlaps with already selected pairs
          const seat1 = `${pair.row}${pair.start}`;
          const seat2 = `${pair.row}${pair.start + 1}`;
          
          if (!reserved.has(seat1) && !reserved.has(seat2)) {
            reserved.add(seat1);
            reserved.add(seat2);
            selectedPairs.push(pair);
            
            if (selectedPairs.length >= 2) break;
          }
        }
        
        return reserved;
      };

      // Reusable scoring type for both groups and solos
      type BlockScore = {
        block: BlockState;
        score: number;
      };

      // Get existing seat assignments to account for used capacity
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      
      // Count existing assignments per block
      const existingCountByBlock = new Map<number, number>();
      for (const assignment of existingAssignments) {
        const count = existingCountByBlock.get(assignment.blockNumber) || 0;
        existingCountByBlock.set(assignment.blockNumber, count + 1);
      }
      
      // Only initialize blocks that were selected, accounting for existing assignments
      const blocks: BlockState[] = validBlocks.map(blockNum => {
        const existingCount = existingCountByBlock.get(blockNum) || 0;
        const blockType = blockTypeMap[blockNum];
        // PB blocks get 2 random pairs of consecutive empty seats reserved
        const reservedSeats = blockType === 'PB' ? generateReservedPairs() : new Set<string>();
        
        if (blockType === 'PB' && reservedSeats.size > 0) {
          console.log(`[Auto-assign] Block ${blockNum} (PB) reserved empty seats: ${Array.from(reservedSeats).join(', ')}`);
        }
        
        return {
          blockNumber: blockNum,
          blockType,
          seatsUsed: existingCount, // Start with existing assignment count
          femaleCount: 0,
          maleCount: 0,
          totalAge: 0,
          ageCount: 0,
          meanAge: 0,
          ratingCounts: { 'A': 0, 'B+': 0, 'B': 0, 'C': 0 },
          bundles: [],
          reservedSeats,
        };
      });
      
      console.log(`[Auto-assign] Existing assignments per block: ${validBlocks.map(b => `Block ${b}: ${existingCountByBlock.get(b) || 0}`).join(', ')}`);

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
        // PB blocks: max 18 seats, NPB blocks: fill completely (22 seats)
        let feasibleBlocks = blocks.filter((block) => {
          const maxSeats = block.blockType === 'NPB' ? MAX_NPB_SEATS : MAX_PB_SEATS;
          // Check capacity only - demographic balancing is done via scoring, not hard rejection
          if (block.seatsUsed + bundle.size > maxSeats) return false;
          
          // CONSTRAINT: NPB blocks can ONLY have B and C ratings (no A or B+)
          if (block.blockType === 'NPB') {
            const hasAOrBPlus = bundle.ratingCounts['A'] > 0 || bundle.ratingCounts['B+'] > 0;
            if (hasAOrBPlus) return false;
          }
          
          return true;
        });

        // CRITICAL: C-rated contestants can ONLY go to NPB blocks (max MAX_C_PER_NPB per NPB block)
        if (bundle.hasCRating) {
          feasibleBlocks = feasibleBlocks.filter(block => {
            if (block.blockType !== 'NPB') return false;
            // Check if adding this bundle would exceed MAX_C_PER_NPB C-rated contestants
            const cCount = block.ratingCounts['C'] + bundle.ratingCounts['C'];
            return cCount <= MAX_C_PER_NPB;
          });
          
          if (feasibleBlocks.length === 0) {
            console.log(`Warning: Could not place group ${bundle.id} with C-rated contestants - no NPB blocks with capacity`);
            skippedBundles.push({ id: bundle.id, reason: `C-rated contestants require NPB block, none available with capacity (max ${MAX_C_PER_NPB} C-rated per NPB block)` });
            continue;
          }
        }

        if (feasibleBlocks.length === 0) {
          console.log(`Warning: Could not place group ${bundle.id} (size ${bundle.size}) - no block has capacity`);
          skippedBundles.push({ id: bundle.id, reason: 'No block has capacity' });
          continue;
        }

        // Score each feasible block
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
        // All other solos can go to any block with capacity - no demographic rejection
        let eligibleBlocks = blocks.filter(block => {
          const maxSeats = block.blockType === 'NPB' ? MAX_NPB_SEATS : MAX_PB_SEATS;
          if (block.seatsUsed + 1 > maxSeats) return false;
          
          // NPB blocks can ONLY have B and C ratings (no A or B+)
          if (block.blockType === 'NPB') {
            const hasAOrBPlus = solo.ratingCounts['A'] > 0 || solo.ratingCounts['B+'] > 0;
            if (hasAOrBPlus) return false;
          }
          
          if (solo.hasCRating) {
            if (block.blockType !== 'NPB') return false;
            const cCount = block.ratingCounts['C'] + solo.ratingCounts['C'];
            if (cCount > MAX_C_PER_NPB) return false;
          }
          
          return true;
        });
        
        if (eligibleBlocks.length === 0) {
          console.log(`Warning: Could not place solo ${solo.id} (${solo.contestants[0].name}) - no block has capacity`);
          skippedBundles.push({ id: solo.id, reason: 'No block has capacity for solo' });
          continue;
        }
        
        // Score each eligible block using the same criteria as groups (demographic balancing)
        const soloScored: BlockScore[] = eligibleBlocks.map((block) => {
          // Simulate adding solo to block
          const newSeatsUsed = block.seatsUsed + 1;
          const newFemaleCount = block.femaleCount + solo.femaleCount;
          const newMaleCount = block.maleCount + solo.maleCount;
          const newTotal = newFemaleCount + newMaleCount;
          const newFemaleRatio = newTotal > 0 ? newFemaleCount / newTotal : 0;
          const newTotalAge = block.totalAge + solo.totalAge;
          const newAgeCount = block.ageCount + 1;
          const newMeanAge = newAgeCount > 0 ? newTotalAge / newAgeCount : 0;

          // Simulate rating counts
          const newRatingCounts = { ...block.ratingCounts };
          Object.keys(solo.ratingCounts).forEach(rating => {
            newRatingCounts[rating] += solo.ratingCounts[rating];
          });

          // Simulate global state
          const simGlobalFemale = globalFemaleCount + solo.femaleCount;
          const simGlobalMale = globalMaleCount + solo.maleCount;
          const simGlobalTotal = simGlobalFemale + simGlobalMale;
          const simGlobalRatio = simGlobalTotal > 0 ? simGlobalFemale / simGlobalTotal : 0;

          // Calculate global mean age
          const simGlobalTotalAge = globalTotalAge + solo.totalAge;
          const simGlobalAgeCount = globalAgeCount + 1;
          const simGlobalMeanAge = simGlobalAgeCount > 0 ? simGlobalTotalAge / simGlobalAgeCount : 0;

          // Scoring components (lower is better) - same as for groups
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
            const avgRatingCount = totalRatingsInBlock / RATING_ORDER.length;
            let ratingVariance = 0;
            RATING_ORDER.forEach(rating => {
              const deviation = newRatingCounts[rating] - avgRatingCount;
              ratingVariance += deviation * deviation;
            });
            score += ratingVariance * 5;
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
          score -= uniqueRatings * 10;

          return { block, score };
        });

        // Pick best block (lowest score) using the same scoring as groups
        soloScored.sort((a, b) => a.score - b.score);
        const selectedBlock = soloScored[0].block;
        
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
      
      // NOTE: existingAssignments already fetched earlier in PHASE 2 for capacity calculation
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
        
        // Add reserved empty seats for PB blocks (2 random pairs of consecutive seats)
        if (block.reservedSeats) {
          block.reservedSeats.forEach(seat => usedSeats.add(seat));
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
          
          // Log group placements
          if (bundle.size > 1) {
            console.log(`[Auto-assign] Group placed in Block ${block.blockNumber}: ${bundle.contestants.map((c, i) => `${c.name} -> ${result.seatLabels[i]}`).join(', ')}`);
          }
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
        
        // Add reserved empty seats for PB blocks (randomly generated 2 pairs of consecutive seats)
        const block = blocks.find(b => b.blockNumber === blockNumber);
        if (block?.reservedSeats) {
          block.reservedSeats.forEach(seat => occupiedSeats.add(seat));
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

      // PHASE 4C: BACKFILL - Fill ALL remaining empty seats (except reserved gaps) with TRUE SOLO contestants only
      // Groups are preserved - we only backfill individuals who were originally identified as solos in Phase 1
      // This ensures we never break groups by placing members separately
      const placedContestantIdsAfterCleanup = new Set(plan.map(p => p.contestant.id));
      
      // Get IDs of all contestants who were part of any bundle (including groups)
      // We track this to ensure we never backfill a group member individually
      const allBundledContestantIds = new Set<string>();
      bundles.forEach(b => {
        if (b.size > 1) {
          // This is a group - mark all members as bundled
          b.contestants.forEach(c => allBundledContestantIds.add(c.id));
        }
      });
      
      // Get remaining SOLO contestants only - those who:
      // 1. Were originally identified as solo bundles (size 1)
      // 2. Are NOT part of any multi-person group
      // 3. Don't have unavailable partners
      const remainingSolos = available.filter(c => {
        // Already placed
        if (placedContestantIdsAfterCleanup.has(c.id)) return false;
        // Has unavailable partner (they can't be assigned without their partner)
        if (contestantsWithUnavailablePartners.has(c.id)) return false;
        // Was part of a multi-person bundle (group) - skip to preserve group integrity
        if (allBundledContestantIds.has(c.id)) return false;
        return true;
      });
      
      console.log(`[Auto-assign] BACKFILL: ${remainingSolos.length} solo contestants remaining to place`);
      
      // Limit solos per block to 2-4 to fill gaps (not dominate)
      const MAX_SOLOS_PER_BLOCK = 4;
      
      // For each block, find empty non-reserved seats and fill them with solos
      for (const block of blocks) {
        // Track how many solos we place in this block
        let solosPlacedInBlock = 0;
        // Build set of all occupied seats in this block
        const occupiedSeatsInBlock = new Set<string>();
        plan
          .filter(p => p.blockNumber === block.blockNumber)
          .forEach(p => occupiedSeatsInBlock.add(p.seatLabel));
        
        existingAssignments
          .filter(a => a.blockNumber === block.blockNumber)
          .forEach(a => occupiedSeatsInBlock.add(a.seatLabel));
        
        // Add reserved empty seats for PB blocks (these stay empty intentionally)
        if (block.reservedSeats) {
          block.reservedSeats.forEach(seat => occupiedSeatsInBlock.add(seat));
        }
        
        // Determine max seats for this block type
        const maxSeats = block.blockType === 'NPB' ? MAX_NPB_SEATS : MAX_PB_SEATS;
        
        // Find all empty seats in this block
        const emptySeats: string[] = [];
        for (const row of ROWS) {
          for (let i = 1; i <= row.count; i++) {
            const seatLabel = `${row.label}${i}`;
            if (!occupiedSeatsInBlock.has(seatLabel)) {
              emptySeats.push(seatLabel);
            }
          }
        }
        
        // Fill empty seats with remaining solo contestants (respecting rating constraints)
        for (const seatLabel of emptySeats) {
          // Check if we've hit the solo limit for this block
          if (solosPlacedInBlock >= MAX_SOLOS_PER_BLOCK) {
            console.log(`[Auto-assign] Block ${block.blockNumber}: Solo limit reached (${MAX_SOLOS_PER_BLOCK})`);
            break;
          }
          
          // Check block capacity
          const currentInBlock = plan.filter(p => p.blockNumber === block.blockNumber).length + 
                                existingAssignments.filter(a => a.blockNumber === block.blockNumber).length;
          if (currentInBlock >= maxSeats) break;
          
          // Find a suitable solo contestant for this block
          const contestantIdx = remainingSolos.findIndex(c => {
            // Check rating constraints
            const isAOrBPlus = c.auditionRating === 'A' || c.auditionRating === 'B+';
            const isCRated = c.auditionRating === 'C';
            
            // NPB blocks can ONLY have B and C ratings
            if (block.blockType === 'NPB' && isAOrBPlus) return false;
            
            // C-rated can ONLY go to NPB blocks
            if (isCRated && block.blockType !== 'NPB') return false;
            
            // Check C-rated limit per NPB block
            if (isCRated && block.blockType === 'NPB') {
              const currentCCount = block.ratingCounts['C'];
              if (currentCCount >= MAX_C_PER_NPB) return false;
            }
            
            return true;
          });
          
          if (contestantIdx !== -1) {
            const contestant = remainingSolos[contestantIdx];
            plan.push({
              contestant,
              blockNumber: block.blockNumber,
              seatLabel,
            });
            occupiedSeatsInBlock.add(seatLabel);
            
            // Update block state
            block.seatsUsed += 1;
            if (contestant.gender === 'Female') block.femaleCount += 1;
            if (contestant.gender === 'Male') block.maleCount += 1;
            block.totalAge += contestant.age;
            block.ageCount += 1;
            block.meanAge = block.ageCount > 0 ? block.totalAge / block.ageCount : 0;
            if (contestant.auditionRating && block.ratingCounts.hasOwnProperty(contestant.auditionRating)) {
              block.ratingCounts[contestant.auditionRating] += 1;
            }
            
            // Update global state
            globalFemaleCount += contestant.gender === 'Female' ? 1 : 0;
            globalMaleCount += contestant.gender === 'Male' ? 1 : 0;
            globalTotalAge += contestant.age;
            globalAgeCount += 1;
            if (contestant.auditionRating && globalRatingCounts.hasOwnProperty(contestant.auditionRating)) {
              globalRatingCounts[contestant.auditionRating] += 1;
            }
            
            // Remove from remaining solos
            remainingSolos.splice(contestantIdx, 1);
            solosPlacedInBlock++;
            
            console.log(`[Auto-assign] BACKFILL: Placed solo ${contestant.name} in Block ${block.blockNumber} seat ${seatLabel} (${solosPlacedInBlock}/${MAX_SOLOS_PER_BLOCK})`);
          }
        }
      }
      
      console.log(`[Auto-assign] SOLO BACKFILL complete: ${remainingSolos.length} solo contestants still unplaced`);
      
      // PHASE 4B: GROUP BACKFILL - Fill remaining gaps with unplaced groups
      // Get unplaced groups (size 2-4) that weren't assigned in the initial phase
      const placedContestantIdsAfterSoloBackfill = new Set<string>();
      plan.forEach(p => placedContestantIdsAfterSoloBackfill.add(p.contestant.id));
      
      const unplacedGroups = bundles.filter(b => {
        // Only consider groups of size 2-4
        if (b.size < 2 || b.size > 4) return false;
        // Check if ALL members are unplaced
        return b.contestants.every(c => !placedContestantIdsAfterSoloBackfill.has(c.id));
      });
      
      // Sort by size descending (prefer larger groups first to maximize seat fill)
      unplacedGroups.sort((a, b) => b.size - a.size);
      
      console.log(`[Auto-assign] GROUP BACKFILL: ${unplacedGroups.length} unplaced groups available (sizes: ${unplacedGroups.map(g => g.size).join(', ')})`);
      
      // For each block, find contiguous empty seat segments and try to fit groups
      for (const block of blocks) {
        // Rebuild occupied seats set for this block
        const occupiedSeatsInBlock = new Set<string>();
        plan
          .filter(p => p.blockNumber === block.blockNumber)
          .forEach(p => occupiedSeatsInBlock.add(p.seatLabel));
        existingAssignments
          .filter(a => a.blockNumber === block.blockNumber)
          .forEach(a => occupiedSeatsInBlock.add(a.seatLabel));
        
        // Add reserved seats
        if (block.reservedSeats) {
          block.reservedSeats.forEach(seat => occupiedSeatsInBlock.add(seat));
        }
        
        // Find contiguous empty seat segments (groups must sit together)
        const allSeatsInOrder: string[] = [];
        for (const row of ROWS) {
          for (let i = 1; i <= row.count; i++) {
            allSeatsInOrder.push(`${row.label}${i}`);
          }
        }
        
        // Find contiguous runs of empty seats
        const emptySegments: string[][] = [];
        let currentSegment: string[] = [];
        for (const seat of allSeatsInOrder) {
          if (!occupiedSeatsInBlock.has(seat)) {
            currentSegment.push(seat);
          } else {
            if (currentSegment.length > 0) {
              emptySegments.push(currentSegment);
              currentSegment = [];
            }
          }
        }
        if (currentSegment.length > 0) {
          emptySegments.push(currentSegment);
        }
        
        // Try to fit unplaced groups into empty segments
        for (const segment of emptySegments) {
          if (segment.length < 2) continue; // Need at least 2 seats for a group
          
          // Find a group that fits this segment
          const groupIdx = unplacedGroups.findIndex(g => {
            if (g.size > segment.length) return false;
            
            // Check rating constraints for all group members
            const allEligible = g.contestants.every(c => {
              const isAOrBPlus = c.auditionRating === 'A' || c.auditionRating === 'B+';
              const isCRated = c.auditionRating === 'C';
              
              // NPB blocks can ONLY have B and C ratings
              if (block.blockType === 'NPB' && isAOrBPlus) return false;
              
              // C-rated can ONLY go to NPB blocks
              if (isCRated && block.blockType !== 'NPB') return false;
              
              return true;
            });
            
            return allEligible;
          });
          
          if (groupIdx !== -1) {
            const group = unplacedGroups[groupIdx];
            
            // Place all group members in consecutive seats
            for (let i = 0; i < group.size; i++) {
              const contestant = group.contestants[i];
              const seatLabel = segment[i];
              
              plan.push({
                contestant,
                blockNumber: block.blockNumber,
                seatLabel,
              });
              occupiedSeatsInBlock.add(seatLabel);
              
              // Update block state
              block.seatsUsed += 1;
              if (contestant.gender === 'Female') block.femaleCount += 1;
              if (contestant.gender === 'Male') block.maleCount += 1;
              block.totalAge += contestant.age;
              block.ageCount += 1;
              
              // Update global state
              globalFemaleCount += contestant.gender === 'Female' ? 1 : 0;
              globalMaleCount += contestant.gender === 'Male' ? 1 : 0;
              globalTotalAge += contestant.age;
              globalAgeCount += 1;
              if (contestant.auditionRating && globalRatingCounts.hasOwnProperty(contestant.auditionRating)) {
                globalRatingCounts[contestant.auditionRating] += 1;
              }
            }
            
            // Remove the placed seats from segment for next iteration
            segment.splice(0, group.size);
            
            // Remove group from unplaced list
            unplacedGroups.splice(groupIdx, 1);
            
            console.log(`[Auto-assign] GROUP BACKFILL: Placed group of ${group.size} (${group.contestants.map(c => c.name).join(', ')}) in Block ${block.blockNumber}`);
          }
        }
      }
      
      console.log(`[Auto-assign] GROUP BACKFILL complete: ${unplacedGroups.length} groups still unplaced`);
      
      // Update final counts after backfill
      const totalAssignedAfterBackfill = globalFemaleCount + globalMaleCount;
      const finalFemaleRatioAfterBackfill = totalAssignedAfterBackfill > 0 ? globalFemaleCount / totalAssignedAfterBackfill : 0;

      // PHASE 5: Persist the plan to database with transaction-like semantics
      // First, deduplicate the plan by contestantId (keep first occurrence)
      const seenContestantIds = new Set<string>();
      const deduplicatedPlan = plan.filter(item => {
        if (seenContestantIds.has(item.contestant.id)) {
          console.log(`Removing duplicate plan entry for contestant ${item.contestant.id}`);
          return false;
        }
        seenContestantIds.add(item.contestant.id);
        return true;
      });
      
      console.log(`Deduplication: ${plan.length} items in plan, ${deduplicatedPlan.length} after removing duplicates`);
      
      // Get canceled assignments to check for paperwork status to carry over
      const allCanceledAssignments = await storage.getCanceledAssignments();
      
      const createdAssignments: any[] = [];
      const contestantUpdates: string[] = [];
      
      try {
        for (const item of deduplicatedPlan) {
          // Double-check that this contestant isn't already assigned in database (defensive check)
          const existingAssign = await storage.getSeatAssignmentByRecordDayAndContestant(recordDayId, item.contestant.id);
          if (existingAssign) {
            console.log(`Skipping assignment for contestant ${item.contestant.id} - already in database`);
            continue;
          }
          
          // Check for previous canceled assignments to carry over paperwork status
          const previousCanceled = allCanceledAssignments.find(
            (c: any) => c.contestantId === item.contestant.id && (c.paperworkSent || c.paperworkReceived)
          );
          
          const assignment = await storage.createSeatAssignment({
            recordDayId,
            contestantId: item.contestant.id,
            blockNumber: item.blockNumber,
            seatLabel: item.seatLabel,
            // Carry over paperwork status from previous bookings
            paperworkSent: previousCanceled?.paperworkSent || undefined,
            paperworkReceived: previousCanceled?.paperworkReceived || undefined,
          });
          createdAssignments.push(assignment);
          contestantUpdates.push(item.contestant.id);
        }

        for (const contestantId of contestantUpdates) {
          await storage.updateContestantAvailability(contestantId, "assigned");
        }

        res.json({
          message: `Assigned ${createdAssignments.length} contestants to seats`,
          assignments: createdAssignments,
          skippedACount: aRatedContestants.length,
          skippedANames: aRatedContestants.map(c => c.name),
          skippedBundles: skippedBundles.length > 0 ? skippedBundles : undefined,
          demographics: {
            femaleCount: globalFemaleCount,
            maleCount: globalMaleCount,
            femalePercentage: (finalFemaleRatioAfterBackfill * 100).toFixed(1),
            targetRange: "60-70%",
            meetsTarget: finalFemaleRatioAfterBackfill >= TARGET_FEMALE_MIN && finalFemaleRatioAfterBackfill <= TARGET_FEMALE_MAX,
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
        // Handle conflict errors from database constraints
        if (persistError.message?.startsWith('SEAT_CONFLICT:') || persistError.message?.startsWith('CONTESTANT_CONFLICT:') || persistError.message?.startsWith('CONFLICT:')) {
          // Cleanup any created assignments before returning conflict error
          for (const assignment of createdAssignments) {
            try {
              await storage.deleteSeatAssignment(assignment.id);
            } catch (cleanupError) {
              console.error("Cleanup error:", cleanupError);
            }
          }
          return res.status(409).json({ error: 'A conflict occurred during auto-assignment. Another user may have made changes. Please refresh and try again.' });
        }
        
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

  // Lock record day for RX Day Mode
  app.post("/api/record-days/:id/lock", async (req, res) => {
    try {
      const recordDayId = req.params.id;
      
      const recordDay = await storage.getRecordDay(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      
      const updated = await storage.updateRecordDayLock(recordDayId, new Date());
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Unlock record day for RX Day Mode
  app.post("/api/record-days/:id/unlock", async (req, res) => {
    try {
      const recordDayId = req.params.id;
      
      const recordDay = await storage.getRecordDay(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      
      const updated = await storage.updateRecordDayLock(recordDayId, null);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Swap seats in locked (RX Day) mode - swaps two contestants' seats and tracks original positions
  app.post("/api/seat-assignments/swap-tracked", async (req, res) => {
    try {
      const { sourceAssignmentId, targetAssignmentId } = req.body;
      const assignment1Id = sourceAssignmentId;
      const assignment2Id = targetAssignmentId;
      
      if (!assignment1Id || !assignment2Id) {
        return res.status(400).json({ error: "Both assignment IDs are required for swap" });
      }
      
      const assignment1 = await storage.getSeatAssignmentById(assignment1Id);
      const assignment2 = await storage.getSeatAssignmentById(assignment2Id);
      
      if (!assignment1 || !assignment2) {
        return res.status(404).json({ error: "One or both assignments not found" });
      }
      
      if (assignment1.recordDayId !== assignment2.recordDayId) {
        return res.status(400).json({ error: "Assignments must be on the same record day" });
      }
      
      // Perform the swap with original seat tracking
      const swapped = await storage.swapSeatAssignmentsWithTracking(
        assignment1Id, 
        assignment2Id,
        assignment1.blockNumber,
        assignment1.seatLabel,
        assignment2.blockNumber,
        assignment2.seatLabel
      );
      
      res.json(swapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Move seat assignment to empty seat with tracking (RX Day Mode)
  app.post("/api/seat-assignments/move-tracked", async (req, res) => {
    try {
      const { sourceAssignmentId, blockNumber, seatLabel } = req.body;
      
      if (!sourceAssignmentId || blockNumber === undefined || !seatLabel) {
        return res.status(400).json({ error: "sourceAssignmentId, blockNumber, and seatLabel are required" });
      }
      
      const assignment = await storage.getSeatAssignmentById(sourceAssignmentId);
      
      if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      
      // Check for collision at target seat
      const allAssignments = await storage.getSeatAssignmentsByRecordDay(assignment.recordDayId);
      const collision = allAssignments.find(
        (a) => a.id !== sourceAssignmentId && 
               a.blockNumber === blockNumber && 
               a.seatLabel === seatLabel
      );

      if (collision) {
        return res.status(400).json({ 
          error: "Seat already occupied",
          conflictingAssignment: collision
        });
      }
      
      // Perform the move with original seat tracking
      const updated = await storage.moveSeatAssignmentWithTracking(
        sourceAssignmentId, 
        blockNumber,
        seatLabel
      );
      
      res.json({ message: "Seat moved successfully with tracking", assignment: updated });
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
  app.patch("/api/seat-assignments/:id/workflow", requireAuth, async (req, res) => {
    try {
      const allowedFields = [
        'firstNations', 'rating', 'location', 'medicalQuestion', 
        'criminalBankruptcy', 'castingCategory', 'notes', 
        'bookingEmailSent', 'confirmedRsvp', 'paperworkSent', 
        'paperworkReceived', 'signedIn', 'otdNotes', 'standbyReplacementSwaps',
        'rxNumber', 'rxEpNumber', 'caseNumber', 'winningMoneyRole', 'winningMoneyAmount',
        'caseAmount', 'quickCash', 'bankOfferTaken', 'spinTheWheel', 'prize',
        'txNumber', 'txDate', 'notifiedOfTx', 'photosSent'
      ];
      
      const timestampFields = [
        'bookingEmailSent', 'confirmedRsvp', 'paperworkSent', 
        'paperworkReceived', 'signedIn'
      ];
      
      // PROTECTION: Check if bookingEmailSent is being cleared - this is NOT allowed once set
      // Covers all falsy values: false, null, undefined, 0, "0", ""
      if ('bookingEmailSent' in req.body) {
        const bookingEmailValue = req.body.bookingEmailSent;
        const isTryingToClear = !bookingEmailValue || bookingEmailValue === "0" || bookingEmailValue === 0;
        if (isTryingToClear) {
          const existingAssignment = await storage.getSeatAssignmentById(req.params.id);
          if (existingAssignment?.bookingEmailSent) {
            return res.status(400).json({ 
              error: "Cannot clear booking email sent status once set. Booking emails are permanent records." 
            });
          }
        }
      }
      
      const workflowFields: any = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (allowedFields.includes(key)) {
          if (timestampFields.includes(key)) {
            if (typeof value === 'boolean') {
              // Special handling for bookingEmailSent - only allow setting, not clearing
              if (key === 'bookingEmailSent' && !value) {
                continue; // Skip clearing bookingEmailSent
              }
              workflowFields[key] = value ? new Date() : null;
            } else if (value === null || value === undefined) {
              // Skip clearing bookingEmailSent
              if (key === 'bookingEmailSent') {
                continue;
              }
              workflowFields[key] = null;
            } else if (typeof value === 'string') {
              workflowFields[key] = new Date(value);
            } else {
              workflowFields[key] = value;
            }
          } else {
            // Handle empty strings as null for all other fields
            if (value === '' || value === null || value === undefined) {
              workflowFields[key] = null;
            } else {
              workflowFields[key] = value;
            }
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
      
      // Broadcast update to all connected clients watching this record day
      for (const [field, value] of Object.entries(workflowFields)) {
        wsManager.broadcastBookingUpdate({
          type: 'booking-master-update',
          recordDayId: updated.recordDayId,
          assignmentId: req.params.id,
          field,
          value,
        });
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

  // Rebook a contestant from one record day to another (with history logging - atomic transaction)
  app.post("/api/rebook", requireAuth, async (req, res) => {
    try {
      const { 
        oldAssignmentId, 
        contestantId, 
        newRecordDayId, 
        blockNumber, 
        seatLabel,
        reason 
      } = req.body;
      
      // Validate inputs
      if (!oldAssignmentId || !contestantId || !newRecordDayId || !blockNumber || !seatLabel) {
        return res.status(400).json({ error: "Missing required fields: oldAssignmentId, contestantId, newRecordDayId, blockNumber, seatLabel" });
      }
      
      // Use atomic rebooking with transaction to ensure consistency
      const result = await storage.atomicRebook({
        oldAssignmentId,
        contestantId,
        newRecordDayId,
        blockNumber,
        seatLabel,
        reason: reason || undefined,
        rebookedBy: (req as any).user?.username || 'admin',
      });
      
      res.json({ 
        success: true, 
        newAssignment: result.newAssignment,
        history: result.history,
        message: "Contestant rebooked successfully" 
      });
    } catch (error: any) {
      console.error("Rebook error:", error);
      
      // Return appropriate status codes based on error
      if (error.message.includes("not found")) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes("mismatch") || error.message.includes("occupied")) {
        return res.status(409).json({ error: error.message });
      }
      
      res.status(500).json({ error: error.message });
    }
  });

  // Get rebooking history for a contestant
  app.get("/api/rebooking-history/contestant/:contestantId", requireAuth, async (req, res) => {
    try {
      const history = await storage.getRebookingHistoryByContestant(req.params.contestantId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get rebooking history for a record day
  app.get("/api/rebooking-history/record-day/:recordDayId", requireAuth, async (req, res) => {
    try {
      const history = await storage.getRebookingHistoryByRecordDay(req.params.recordDayId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update player type for a seat assignment
  app.patch("/api/seat-assignments/:id/player-type", async (req, res) => {
    try {
      const { playerType } = req.body;
      
      if (!playerType || !['player', 'backup', 'player_partner'].includes(playerType)) {
        return res.status(400).json({ error: "Invalid player type" });
      }
      
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, { playerType });
      
      if (!updated) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update winning money for RX Day Mode
  app.patch("/api/seat-assignments/:id/winning-money", async (req, res) => {
    try {
      const { 
        rxNumber,
        rxEpNumber,
        caseNumber, 
        winningMoneyRole, 
        winningMoneyAmount,
        caseAmount,
        quickCash,
        bankOfferTaken,
        spinTheWheel,
        prize
      } = req.body;
      
      console.log("PATCH winning-money received:", { 
        id: req.params.id, 
        rxNumber,
        rxEpNumber,
        caseNumber, 
        winningMoneyRole, 
        winningMoneyAmount,
        caseAmount,
        quickCash,
        bankOfferTaken,
        spinTheWheel,
        prize,
        typeOfAmount: typeof winningMoneyAmount
      });
      
      if (typeof winningMoneyAmount !== 'number' || winningMoneyAmount < 0) {
        console.log("PATCH winning-money: Invalid amount, returning 400");
        return res.status(400).json({ error: "Invalid amount" });
      }
      
      // If removing (amount is 0), clear all winning money fields including player fields
      if (winningMoneyAmount === 0) {
        const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, { 
          rxNumber: null,
          rxEpNumber: null,
          caseNumber: null,
          winningMoneyRole: null, 
          winningMoneyAmount: 0,
          caseAmount: null,
          quickCash: null,
          bankOfferTaken: null,
          spinTheWheel: null,
          prize: null
        });
        
        if (!updated) {
          return res.status(404).json({ error: "Seat assignment not found" });
        }
        
        // Broadcast update
        wsManager.broadcastBookingUpdate({
          type: 'booking-master-update',
          recordDayId: updated.recordDayId,
          assignmentId: req.params.id,
          field: 'winningMoneyAmount',
          value: 0,
        });
        
        return res.json(updated);
      }
      
      // For adding/updating, require valid role
      if (!winningMoneyRole || !['player', 'case_holder'].includes(winningMoneyRole)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      
      // Build update object with base fields
      const updateData: any = { 
        rxNumber: rxNumber || null,
        rxEpNumber: rxEpNumber || null,
        caseNumber: caseNumber || null,
        winningMoneyRole, 
        winningMoneyAmount 
      };
      
      // Add player-specific fields if role is player
      if (winningMoneyRole === 'player') {
        updateData.caseAmount = caseAmount ?? null;
        updateData.quickCash = quickCash ?? null;
        updateData.bankOfferTaken = bankOfferTaken ?? null;
        updateData.spinTheWheel = spinTheWheel ?? null;
        updateData.prize = spinTheWheel ? (prize || null) : null;
      } else {
        // Clear player-specific fields if role is case_holder
        updateData.caseAmount = null;
        updateData.quickCash = null;
        updateData.bankOfferTaken = null;
        updateData.spinTheWheel = null;
        updateData.prize = null;
      }
      
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, updateData);
      
      if (!updated) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // Broadcast update to all connected clients
      wsManager.broadcastBookingUpdate({
        type: 'booking-master-update',
        recordDayId: updated.recordDayId,
        assignmentId: req.params.id,
        field: 'winningMoneyAmount',
        value: winningMoneyAmount,
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Simple PATCH to update seat assignment fields (for booking responses page)
  app.patch("/api/seat-assignments/:id", async (req, res) => {
    try {
      const { confirmedRsvp, bookingEmailSent, notes } = req.body;
      
      // Check if bookingEmailSent is being cleared - this is NOT allowed once set
      // Covers all falsy values: false, null, undefined, 0, "0", ""
      if (bookingEmailSent !== undefined) {
        const isTryingToClear = !bookingEmailSent || bookingEmailSent === "0" || bookingEmailSent === 0;
        if (isTryingToClear) {
          const existingAssignment = await storage.getSeatAssignmentById(req.params.id);
          if (existingAssignment?.bookingEmailSent) {
            return res.status(400).json({ 
              error: "Cannot clear booking email sent status once set. Booking emails are permanent records." 
            });
          }
        }
      }
      
      const updateData: any = {};
      if (confirmedRsvp !== undefined) {
        updateData.confirmedRsvp = confirmedRsvp ? new Date(confirmedRsvp) : null;
      }
      if (bookingEmailSent !== undefined) {
        // Only allow setting, not clearing (additional guard)
        if (bookingEmailSent) {
          updateData.bookingEmailSent = new Date(bookingEmailSent);
        }
      }
      if (notes !== undefined) {
        updateData.notes = notes;
      }
      
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, updateData);
      
      if (!updated) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // If confirmedRsvp is being set, update contestant status to 'confirmed'
      if (confirmedRsvp && updateData.confirmedRsvp) {
        await storage.updateContestantAvailability(updated.contestantId, 'confirmed');
      }
      
      res.json(updated);
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

  // Decline booking - mark as declined and optionally move to reschedule
  app.post("/api/seat-assignments/:id/decline", async (req, res) => {
    try {
      const { reason, moveToReschedule = true, movedBy } = req.body;
      const declineReason = reason ? `[DECLINED] ${reason}` : "[DECLINED] No reason provided";
      
      if (moveToReschedule) {
        // Move to reschedule list (canceled assignments)
        const canceled = await storage.cancelSeatAssignment(req.params.id, declineReason, movedBy);
        res.json({ moved: true, canceled });
      } else {
        // Just mark as declined but keep in place
        const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, {
          notes: declineReason,
          confirmedRsvp: new Date(),
        });
        res.json({ moved: false, assignment: updated });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Clear confirmed RSVP (undo confirmation)
  app.delete("/api/seat-assignments/:id/confirmed-rsvp", requireAuth, async (req, res) => {
    try {
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // Clear the confirmedRsvp field
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, {
        confirmedRsvp: null as any,
      });
      
      res.json({ success: true, assignment: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Undo decline - restore a declined assignment back to awaiting reply
  app.post("/api/seat-assignments/:id/undo-decline", requireAuth, async (req, res) => {
    try {
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // Check if the assignment is actually declined
      if (!assignment.notes?.startsWith('[DECLINED]')) {
        return res.status(400).json({ error: "Assignment is not in declined state" });
      }
      
      // Clear the declined note prefix (keep any reason as regular note)
      let newNotes = assignment.notes.replace(/^\[DECLINED\]\s*/, '');
      if (newNotes === "No reason provided") {
        newNotes = "";
      }
      
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, {
        notes: newNotes || null,
        confirmedRsvp: null as any,
      });
      
      res.json({ success: true, assignment: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Change record date for a seat assignment (move to different day)
  app.post("/api/seat-assignments/:id/change-date", async (req, res) => {
    try {
      const { newRecordDayId } = req.body;
      
      if (!newRecordDayId) {
        return res.status(400).json({ error: "newRecordDayId is required" });
      }
      
      // Get the current assignment with all its data
      const currentAssignment = await storage.getSeatAssignmentById(req.params.id);
      if (!currentAssignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // Get the new record day
      const newRecordDay = await storage.getRecordDayById(newRecordDayId);
      if (!newRecordDay) {
        return res.status(404).json({ error: "New record day not found" });
      }
      
      // Find an available seat in the new record day
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(newRecordDayId);
      const occupiedSeats = new Set(existingAssignments.map(a => `${a.blockNumber}-${a.seatLabel}`));
      
      // Try to find a seat in the same block/seat first, then any available
      let newBlock = currentAssignment.blockNumber;
      let newSeatLabel = currentAssignment.seatLabel;
      
      // Check if same seat is available
      if (occupiedSeats.has(`${newBlock}-${newSeatLabel}`)) {
        // Get actual seat layout for the seating chart (A1-V1 per block typically)
        // Use a simpler approach: try seats in same block first, then other blocks
        const seatLabels = [];
        for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V']) {
          seatLabels.push(letter);
        }
        
        let foundSeat = false;
        
        // First try same block
        for (const label of seatLabels) {
          if (!occupiedSeats.has(`${newBlock}-${label}`)) {
            newSeatLabel = label;
            foundSeat = true;
            break;
          }
        }
        
        // If not found, try other blocks
        if (!foundSeat) {
          for (let block = 1; block <= 7 && !foundSeat; block++) {
            if (block === newBlock) continue;
            for (const label of seatLabels) {
              if (!occupiedSeats.has(`${block}-${label}`)) {
                newBlock = block;
                newSeatLabel = label;
                foundSeat = true;
                break;
              }
            }
          }
        }
        
        if (!foundSeat) {
          return res.status(400).json({ error: "No available seats in the new record day" });
        }
      }
      
      // Store original assignment info for rebooking history
      const fromRecordDayId = currentAssignment.recordDayId;
      const fromBlockNumber = currentAssignment.blockNumber;
      const fromSeatLabel = currentAssignment.seatLabel;
      
      // Delete the current assignment
      await storage.deleteSeatAssignment(req.params.id);
      
      // Create new assignment in the new record day with ALL original data preserved
      const newAssignment = await storage.createSeatAssignment({
        recordDayId: newRecordDayId,
        contestantId: currentAssignment.contestantId,
        blockNumber: newBlock,
        seatLabel: newSeatLabel,
        playerType: currentAssignment.playerType,
      });
      
      // Preserve workflow data from original assignment
      if (newAssignment) {
        const workflowData: any = {};
        
        // Copy over all workflow fields that had values
        if (currentAssignment.firstNations) workflowData.firstNations = currentAssignment.firstNations;
        if (currentAssignment.rating) workflowData.rating = currentAssignment.rating;
        if (currentAssignment.location) workflowData.location = currentAssignment.location;
        if (currentAssignment.medicalQuestion) workflowData.medicalQuestion = currentAssignment.medicalQuestion;
        if (currentAssignment.criminalBankruptcy) workflowData.criminalBankruptcy = currentAssignment.criminalBankruptcy;
        if (currentAssignment.castingCategory) workflowData.castingCategory = currentAssignment.castingCategory;
        if (currentAssignment.notes) workflowData.notes = currentAssignment.notes;
        if (currentAssignment.otdNotes) workflowData.otdNotes = currentAssignment.otdNotes;
        // Note: Don't copy bookingEmailSent or confirmedRsvp since they were for the old date
        
        if (Object.keys(workflowData).length > 0) {
          await storage.updateSeatAssignmentWorkflow(newAssignment.id, workflowData);
        }
        
        // Log rebooking history for audit trail
        await storage.logRebooking({
          contestantId: currentAssignment.contestantId,
          fromRecordDayId: fromRecordDayId,
          fromBlockNumber: fromBlockNumber,
          fromSeatLabel: fromSeatLabel,
          toRecordDayId: newRecordDayId,
          toBlockNumber: newBlock,
          toSeatLabel: newSeatLabel,
          reason: 'Date change',
          rebookedBy: (req as any).user?.username || 'admin',
        });
      }
      
      res.json({
        message: "Successfully moved to new record day",
        previousRecordDayId: currentAssignment.recordDayId,
        newRecordDayId,
        newBlock,
        newSeatLabel,
        assignment: newAssignment,
      });
    } catch (error: any) {
      // Handle conflict errors from database constraints
      if (error.message?.startsWith('SEAT_CONFLICT:')) {
        return res.status(409).json({ error: 'This seat was just taken by another user. Please refresh and try a different seat.' });
      }
      if (error.message?.startsWith('CONTESTANT_CONFLICT:')) {
        return res.status(409).json({ error: 'This contestant was just assigned by another user. Please refresh.' });
      }
      if (error.message?.startsWith('CONFLICT:')) {
        return res.status(409).json({ error: 'A conflict occurred. Another user may have made changes. Please refresh and try again.' });
      }
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

  // Rebook from reschedule - carries over paperwork status
  app.post("/api/canceled-assignments/:id/rebook", async (req, res) => {
    try {
      const { recordDayId, blockNumber, seatLabel } = req.body;

      if (!recordDayId || !blockNumber || !seatLabel) {
        return res.status(400).json({ error: "recordDayId, blockNumber, and seatLabel are required" });
      }

      // Get the canceled assignment to copy paperwork status
      const canceledAssignments = await storage.getCanceledAssignments();
      const canceled = canceledAssignments.find(c => c.id === req.params.id);

      if (!canceled) {
        return res.status(404).json({ error: "Canceled assignment not found" });
      }

      // Create new seat assignment with paperwork status carried over
      const newAssignment = await storage.createSeatAssignment({
        recordDayId,
        contestantId: canceled.contestantId,
        blockNumber,
        seatLabel,
        // Carry over paperwork status from canceled assignment
        paperworkSent: canceled.paperworkSent || undefined,
        paperworkReceived: canceled.paperworkReceived || undefined,
      });

      // Delete the canceled assignment
      await storage.deleteCanceledAssignment(req.params.id);

      res.json({
        message: "Contestant rebooked with paperwork status preserved",
        assignment: newAssignment,
      });
    } catch (error: any) {
      // Handle conflict errors from database constraints
      if (error.message?.startsWith('SEAT_CONFLICT:')) {
        return res.status(409).json({ error: 'This seat was just taken by another user. Please refresh and try a different seat.' });
      }
      if (error.message?.startsWith('CONTESTANT_CONFLICT:')) {
        return res.status(409).json({ error: 'This contestant was just assigned by another user. Please refresh.' });
      }
      if (error.message?.startsWith('CONFLICT:')) {
        return res.status(409).json({ error: 'A conflict occurred. Another user may have made changes. Please refresh and try again.' });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Availability Management Routes

  // Generate tokens and send availability check emails
  app.post("/api/availability/send", async (req, res) => {
    try {
      // Check if email is configured
      if (!await isEmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Please configure SMTP settings in the Settings page." 
        });
      }

      const { 
        contestantIds, 
        recordDayIds,
        emailSubject,
        emailHeadline,
        emailIntro,
        emailInstructions,
        emailButtonText,
        emailFooter
      } = req.body;

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
      
      // Get banner URL from system config or use default
      let bannerUrlConfig = await storage.getSystemConfig('email_banner_url') || `/uploads/branding/dond_banner.png`;
      
      // Prepare banner image for CID embedding (works offline in all email clients)
      let bannerCid = 'banner-image';
      let bannerUrl = `cid:${bannerCid}`;  // Reference the embedded image
      let bannerImageBuffer: Buffer | null = null;
      let bannerContentType = 'image/png';
      let bannerFilename = 'dond_banner.png';
      
      if (bannerUrlConfig.startsWith('/')) {
        const bannerPath = path.join(process.cwd(), bannerUrlConfig.replace(/^\//, ''));
        try {
          if (fs.existsSync(bannerPath)) {
            bannerImageBuffer = fs.readFileSync(bannerPath);
            const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
            bannerContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            bannerFilename = path.basename(bannerPath);
          }
        } catch (error) {
          console.warn(`Warning: Could not read banner image at ${bannerPath}:`, error);
          bannerUrl = bannerUrlConfig;  // Fallback to URL if file can't be read
        }
      } else {
        // External URL - can't embed, use as-is
        bannerUrl = bannerUrlConfig;
      }
      
      // Get saved email template values from database, with fallback defaults
      const savedAvailSubject = await storage.getSystemConfig('availability_email_subject');
      const savedAvailHeadline = await storage.getSystemConfig('availability_email_headline');
      const savedAvailIntro = await storage.getSystemConfig('availability_email_intro');
      const savedAvailInstructions = await storage.getSystemConfig('availability_email_instructions');
      const savedAvailFooter = await storage.getSystemConfig('availability_email_footer');
      
      // Default email content values - use request values, then saved values, then hardcoded defaults
      const finalEmailSubject = emailSubject || savedAvailSubject || 'Deal or No Deal - Availability Check';
      const finalEmailHeadline = emailHeadline || savedAvailHeadline || 'Availability Check';
      const finalEmailIntro = emailIntro || savedAvailIntro || "Congratulations! Following your successful audition, we'd love to invite you to be part of a Deal or No Deal recording. Please let us know your availability for our upcoming dates.";
      const finalEmailInstructions = emailInstructions || savedAvailInstructions || "Please complete the form as soon as possible so we can allocate recording slots. If you have any questions, please reply to this email.";
      const finalEmailButtonText = emailButtonText || 'Click Here To Respond';
      const finalEmailFooter = emailFooter || savedAvailFooter || 'This is an automated message from the Deal or No Deal production team. Please do not forward this email as it contains a unique response link.';

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
          const baseUrl = getBaseUrl(req);
          if (!contestant.email) {
            throw new Error(`Contestant ${contestant.name} has no email address`);
          }

          const responseUrl = appendNgrokSkip(`${baseUrl}/availability/respond/${tokenRecord.token}`);
          
          // Get reply-to email for mailto buttons
          const smtpConfig = await getSmtpConfig();
          const replyToEmail = smtpConfig.fromEmail || 'noreply@example.com';
          
          // Format record day dates for the email HTML list
          const recordDaysHtml = recordDays
            .filter((rd): rd is NonNullable<typeof recordDays[0]> => rd !== null && rd !== undefined && rd.date !== undefined)
            .map(rd => {
              const dateStr = new Date(rd.date!).toLocaleDateString('en-AU', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
              const rxInfo = rd.rxNumber ? ` <span style="color: #888888;">(${rd.rxNumber})</span>` : '';
              return `<li style="margin-bottom: 6px;">${dateStr}${rxInfo}</li>`;
            })
            .join('');

          // Get Microsoft Form URL from system config
          const msFormUrl = await storage.getSystemConfig('availability_form_url') || 'https://forms.office.com/Pages/ResponsePage.aspx?id=ayXN-4f600uQrCY8eucYVbItEwiVLdlEnys-du5SGAxUMFhPMk9JTUFDUThQWDlLRllCOFhaUk5WVS4u';
          
          // Create professional HTML email template matching booking/standby email aesthetic
          const htmlEmailContent = `<!DOCTYPE html>
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
      <td style="background: linear-gradient(180deg, #4a1a1a 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${finalEmailHeadline}
        </h1>
      </td>
    </tr>
    
    <!-- Content Card -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 35px 30px;">
              <!-- Yellow Warning Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border-radius: 8px; border: 1px solid #ffc107; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 15px;">
                    <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0; line-height: 1.5;">
                      IMPORTANT: This is an availability check only. Please complete the form below to confirm which recording dates suit you. A booking confirmation will be sent separately.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Hi ${contestant.name.split(' ')[0]},
              </p>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${finalEmailIntro}
              </p>
              
              <p style="color: #444444; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
                ${finalEmailInstructions}
              </p>
              
              <!-- ACTION REQUIRED Notice with Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fef3cd; border: 1px solid #d4a937; border-radius: 8px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 25px; text-align: center;">
                    <p style="color: #856404; font-size: 22px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                      ARE YOU AVAILABLE?
                    </p>
                    <p style="color: #664d03; font-size: 15px; margin: 0 0 20px 0;">
                      Please click the button below to complete the availability form for you and your group.
                    </p>
                    <a href="${msFormUrl}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO RESPOND</a>
                  </td>
                </tr>
              </table>
              
              <!-- What to Expect Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f5; border-radius: 8px; border: 1px solid #e0e0e0; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="color: #333333; font-size: 14px; font-weight: bold; margin: 0 0 12px 0;">
                      What happens next?
                    </h3>
                    <ul style="color: #555555; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                      <li>Complete the availability form with your preferred dates</li>
                      <li>Our team will review responses and allocate recording slots</li>
                      <li>You will receive a separate booking confirmation email</li>
                      <li>Final booking details will include arrival time and location</li>
                    </ul>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 15px; margin: 0 0 5px 0;">
                We look forward to hearing from you!
              </p>
              <p style="color: #333333; font-size: 15px; margin: 0;">
                Kind Regards,<br/>
                <strong>The Deal Or No Deal Team</strong>
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
          ${finalEmailFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

          // Plain text fallback
          const recordDaysText = recordDays
            .filter((rd): rd is NonNullable<typeof recordDays[0]> => rd !== null && rd !== undefined && rd.date !== undefined)
            .map(rd => new Date(rd.date!).toLocaleDateString('en-AU', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }))
            .join('\n  - ');
            
          const plainTextContent = `Hi ${contestant.name.split(' ')[0]},

IMPORTANT: This is an availability check only. Please complete the form to confirm which recording dates suit you. A booking confirmation will be sent separately.

${finalEmailIntro}

ARE YOU AVAILABLE?
Please click the link below to complete the availability form for you and your group:
${msFormUrl}

${finalEmailInstructions}

WHAT HAPPENS NEXT?
- Complete the availability form with your preferred dates
- Our team will review responses and allocate recording slots
- You will receive a separate booking confirmation email
- Final booking details will include arrival time and location

We look forward to hearing from you!

Kind Regards,
The Deal Or No Deal Team

${finalEmailFooter}`;

          // Get sender name from settings
          const senderNameConfig = await storage.getSystemConfig('email_sender_name');
          const emailConfig: EmailConfig = {
            senderName: senderNameConfig || 'Deal or No Deal',
          };

          // Prepare embedded images for CID attachment
          const embeddedImages: EmbeddedImage[] = [];
          if (bannerImageBuffer) {
            embeddedImages.push({
              filename: bannerFilename,
              content: bannerImageBuffer,
              contentType: bannerContentType,
              cid: bannerCid,
            });
          }

          // Send email with embedded banner image (works offline)
          if (embeddedImages.length > 0) {
            await sendEmailWithEmbeddedImages(
              contestant.email,
              finalEmailSubject,
              plainTextContent,
              htmlEmailContent,
              embeddedImages,
              emailConfig
            );
          } else {
            // Fallback to regular email if no image to embed
            await sendEmail(
              contestant.email,
              finalEmailSubject,
              plainTextContent,
              htmlEmailContent,
              emailConfig
            );
          }

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
        
        // Simplified stats: available (yes), not available (no), pending
        const stats = {
          recordDayId: recordDay.id,
          date: recordDay.date,
          rxNumber: recordDay.rxNumber,
          available: availability.filter(a => a.responseValue === 'yes').length,
          notAvailable: availability.filter(a => a.responseValue === 'no').length,
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
  // Availability Response Excel Import
  // ========================================

  // Import availability responses from Microsoft Forms Excel export
  app.post("/api/availability/import", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // Parse the Excel file
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows: any[] = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

      if (rows.length === 0) {
        return res.status(400).json({ error: "No data found in Excel file" });
      }

      // Get all contestants and record days for matching
      const allContestants = await storage.getContestants();
      const allRecordDays = await storage.getRecordDays();

      // Create lookup maps
      const contestantsByEmail = new Map<string, typeof allContestants[0]>();
      const contestantsByPhone = new Map<string, typeof allContestants[0]>();
      const contestantsByName = new Map<string, typeof allContestants[0]>();

      for (const c of allContestants) {
        if (c.email) contestantsByEmail.set(c.email.toLowerCase().trim(), c);
        if (c.phone) contestantsByPhone.set(c.phone.replace(/\D/g, ''), c);
        contestantsByName.set(c.name.toLowerCase().trim(), c);
      }

      // Get column headers from the first row
      const headers = Object.keys(rows[0] || {});

      // Detect column mappings
      const findColumn = (patterns: string[]) => {
        return headers.find(h => 
          patterns.some(p => h.toLowerCase().includes(p.toLowerCase()))
        );
      };

      const emailCol = findColumn(['email', 'e-mail', 'email address']);
      const phoneCol = findColumn(['phone', 'mobile', 'telephone', 'contact number']);
      const nameCol = findColumn(['name', 'full name', 'contestant']);

      // Find record day columns - look for date patterns or "RX" columns
      const recordDayColumns: { header: string; recordDay: typeof allRecordDays[0] | null }[] = [];
      
      for (const header of headers) {
        // Skip identifier columns
        if ([emailCol, phoneCol, nameCol].includes(header)) continue;
        
        const headerLower = header.toLowerCase();
        
        // Skip common non-date columns
        if (headerLower.includes('timestamp') || 
            headerLower.includes('submitted') ||
            headerLower === 'id' ||
            headerLower.includes('completion time')) continue;
        
        // Try to match to a record day
        let matchedDay: typeof allRecordDays[0] | null = null;
        
        for (const rd of allRecordDays) {
          const rdDate = new Date(rd.date);
          
          // Generate multiple date format strings to match
          const dateFormats = [
            rdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), // "Jan 15"
            rdDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }), // "January 15"
            rdDate.toISOString().split('T')[0], // "2026-01-15"
            rdDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }), // "1/15"
            rdDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), // "15 Jan"
            rdDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' }), // "15 January"
            `${rdDate.getDate()} ${rdDate.toLocaleDateString('en-US', { month: 'short' })}`, // "15 Jan"
            rdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), // "Jan 15, 2026"
          ];
          
          // Check if header contains any date format (case-insensitive)
          const matchesDate = dateFormats.some(dateStr => 
            headerLower.includes(dateStr.toLowerCase())
          );
          
          // Check for RX number match
          const matchesRx = rd.rxNumber && headerLower.includes(rd.rxNumber.toLowerCase());
          
          if (matchesDate || matchesRx) {
            matchedDay = rd;
            break;
          }
        }
        
        recordDayColumns.push({ header, recordDay: matchedDay });
      }

      // Process each row
      const results = {
        totalRows: rows.length,
        matched: 0,
        unmatched: 0,
        updated: 0,
        skipped: 0,
        errors: [] as { row: number; reason: string; data: any }[],
        columnMappings: {
          email: emailCol || null,
          phone: phoneCol || null,
          name: nameCol || null,
          recordDays: recordDayColumns.filter(rc => rc.recordDay).map(rc => ({
            header: rc.header,
            recordDayId: rc.recordDay!.id,
            date: rc.recordDay!.date,
          })),
          unmatchedColumns: recordDayColumns.filter(rc => !rc.recordDay).map(rc => rc.header),
        },
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // +2 for 1-indexed and header row

        // Try to find the contestant
        let contestant: typeof allContestants[0] | undefined;

        // Priority 1: Email
        if (emailCol && row[emailCol]) {
          const email = String(row[emailCol]).toLowerCase().trim();
          contestant = contestantsByEmail.get(email);
        }

        // Priority 2: Phone
        if (!contestant && phoneCol && row[phoneCol]) {
          const phone = String(row[phoneCol]).replace(/\D/g, '');
          contestant = contestantsByPhone.get(phone);
        }

        // Priority 3: Name
        if (!contestant && nameCol && row[nameCol]) {
          const name = String(row[nameCol]).toLowerCase().trim();
          contestant = contestantsByName.get(name);
        }

        if (!contestant) {
          results.unmatched++;
          results.errors.push({
            row: rowNum,
            reason: 'Could not match to a contestant',
            data: { email: row[emailCol], phone: row[phoneCol], name: row[nameCol] },
          });
          continue;
        }

        results.matched++;

        // Process availability responses for each record day column
        for (const rc of recordDayColumns) {
          if (!rc.recordDay) continue;

          const responseValue = String(row[rc.header]).toLowerCase().trim();
          if (!responseValue) continue;

          // Normalize the response
          let normalizedResponse: 'yes' | 'no' | 'maybe' | 'pending' = 'pending';
          
          if (responseValue === 'yes' || responseValue === 'y' || responseValue.includes('available') || responseValue.includes('can attend')) {
            normalizedResponse = 'yes';
          } else if (responseValue === 'no' || responseValue === 'n' || responseValue.includes('unavailable') || responseValue.includes('cannot')) {
            normalizedResponse = 'no';
          } else if (responseValue === 'maybe' || responseValue.includes('maybe') || responseValue.includes('tentative')) {
            normalizedResponse = 'maybe';
          }

          if (normalizedResponse !== 'pending') {
            try {
              await storage.upsertContestantAvailability(
                contestant.id,
                rc.recordDay.id,
                normalizedResponse
              );
              results.updated++;
            } catch (err: any) {
              results.errors.push({
                row: rowNum,
                reason: `Failed to update availability: ${err.message}`,
                data: { contestantId: contestant.id, recordDayId: rc.recordDay.id },
              });
            }
          } else {
            results.skipped++;
          }
        }
      }

      res.json({
        success: true,
        message: `Processed ${results.totalRows} rows: ${results.matched} matched, ${results.updated} availability responses updated`,
        results,
      });
    } catch (error: any) {
      console.error("Error importing availability responses:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Microsoft Forms / Power Automate Webhook
  // ========================================

  // Webhook endpoint to receive booking confirmation responses from Microsoft Forms via Power Automate
  app.post("/api/webhooks/forms-response", async (req, res) => {
    try {
      console.log("[Forms Webhook] Received response:", JSON.stringify(req.body, null, 2));
      
      // Verify webhook secret (optional but recommended)
      const webhookSecret = await storage.getSystemConfig('forms_webhook_secret');
      const providedSecret = req.headers['x-webhook-secret'] || req.body.webhookSecret;
      
      if (webhookSecret && webhookSecret !== providedSecret) {
        console.warn("[Forms Webhook] Invalid or missing webhook secret");
        return res.status(401).json({ error: "Invalid webhook secret" });
      }
      
      // Extract form response data
      // Flexible field mapping - check for various possible field names
      const responseData = {
        contestantName: req.body.contestantName || req.body.name || req.body.Name || req.body["Contestant Name"] || "",
        contestantEmail: req.body.contestantEmail || req.body.email || req.body.Email || req.body["Email Address"] || "",
        recordDate: req.body.recordDate || req.body.date || req.body.Date || req.body["Recording Date"] || "",
        response: req.body.response || req.body.Response || req.body.confirmation || req.body.Confirmation || "",
        dietaryRequirements: req.body.dietaryRequirements || req.body.dietary || req.body.Dietary || req.body["Dietary Requirements"] || "",
        questions: req.body.questions || req.body.Questions || req.body.notes || req.body.Notes || "",
        attendingWith: req.body.attendingWith || req.body["Attending With"] || "",
      };
      
      console.log("[Forms Webhook] Parsed data:", responseData);
      
      // Normalize response value
      let confirmationStatus: 'confirmed' | 'declined' | 'pending' = 'pending';
      const responseNormalized = responseData.response.toLowerCase().trim();
      
      if (responseNormalized.includes('confirm') || responseNormalized.includes('yes') || responseNormalized === 'attending') {
        confirmationStatus = 'confirmed';
      } else if (responseNormalized.includes('decline') || responseNormalized.includes('no') || responseNormalized.includes('cannot') || responseNormalized.includes("can't")) {
        confirmationStatus = 'declined';
      }
      
      // Find the contestant by email or name
      const allContestants = await storage.getContestants();
      let contestant = null;
      
      // Try email match first (more reliable)
      if (responseData.contestantEmail) {
        contestant = allContestants.find(c => 
          c.email?.toLowerCase() === responseData.contestantEmail.toLowerCase()
        );
      }
      
      // Fall back to name match
      if (!contestant && responseData.contestantName) {
        contestant = allContestants.find(c => 
          c.name.toLowerCase() === responseData.contestantName.toLowerCase()
        );
      }
      
      if (!contestant) {
        console.warn("[Forms Webhook] Could not find contestant:", responseData.contestantName, responseData.contestantEmail);
        return res.status(404).json({ 
          error: "Contestant not found",
          searchedName: responseData.contestantName,
          searchedEmail: responseData.contestantEmail,
        });
      }
      
      console.log("[Forms Webhook] Found contestant:", contestant.name, contestant.id);
      
      // Find the seat assignment for this contestant
      // If recordDate is provided, match to that specific record day
      let seatAssignment = null;
      const allAssignments = await storage.getSeatAssignments();
      const contestantAssignments = allAssignments.filter(a => a.contestantId === contestant!.id);
      
      if (contestantAssignments.length === 0) {
        return res.status(404).json({ 
          error: "No seat assignment found for this contestant",
          contestantId: contestant.id,
          contestantName: contestant.name,
        });
      }
      
      // If only one assignment, use it
      if (contestantAssignments.length === 1) {
        seatAssignment = contestantAssignments[0];
      } else if (responseData.recordDate) {
        // Try to match by date
        const recordDays = await storage.getRecordDays();
        const targetDate = new Date(responseData.recordDate).toDateString();
        
        for (const assignment of contestantAssignments) {
          const recordDay = recordDays.find(rd => rd.id === assignment.recordDayId);
          if (recordDay && new Date(recordDay.date).toDateString() === targetDate) {
            seatAssignment = assignment;
            break;
          }
        }
      }
      
      // Fall back to most recent assignment
      if (!seatAssignment) {
        seatAssignment = contestantAssignments[0];
      }
      
      console.log("[Forms Webhook] Using seat assignment:", seatAssignment.id);
      
      // Find or create booking confirmation token for this assignment
      let tokenRecord = await storage.getBookingConfirmationBySeatAssignment(seatAssignment.id);
      
      if (!tokenRecord) {
        // Create a new token record for tracking
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        
        tokenRecord = await storage.createBookingConfirmationToken({
          seatAssignmentId: seatAssignment.id,
          token,
          expiresAt,
          lastSentAt: new Date(),
          status: 'active',
          confirmationStatus: 'pending',
        });
      }
      
      // Build notes from dietary and questions
      const notesParts = [];
      if (responseData.dietaryRequirements && responseData.dietaryRequirements.toLowerCase() !== 'none') {
        notesParts.push(`Dietary Requirements: ${responseData.dietaryRequirements}`);
      }
      if (responseData.questions) {
        notesParts.push(`Questions/Notes: ${responseData.questions}`);
      }
      notesParts.push(`(Submitted via Microsoft Forms)`);
      const notes = notesParts.join('\n\n');
      
      // Update the booking confirmation status
      await storage.updateBookingConfirmation(tokenRecord.id, {
        confirmationStatus,
        attendingWith: responseData.attendingWith || null,
        notes,
        confirmedAt: new Date(),
      });
      
      console.log("[Forms Webhook] Updated booking confirmation:", {
        tokenId: tokenRecord.id,
        status: confirmationStatus,
        contestant: contestant.name,
      });
      
      // Return success response
      res.json({
        success: true,
        message: `Booking ${confirmationStatus} for ${contestant.name}`,
        contestantId: contestant.id,
        contestantName: contestant.name,
        confirmationStatus,
        seatAssignmentId: seatAssignment.id,
      });
      
    } catch (error: any) {
      console.error("[Forms Webhook] Error processing response:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Webhook endpoint to receive availability responses from Microsoft Forms via Power Automate
  app.post("/api/webhooks/availability-response", async (req, res) => {
    try {
      console.log("[Availability Webhook] Received response:", JSON.stringify(req.body, null, 2));
      
      // Verify webhook secret (optional but recommended)
      const webhookSecret = await storage.getSystemConfig('forms_webhook_secret');
      const providedSecret = req.headers['x-webhook-secret'] || req.body.webhookSecret;
      
      if (webhookSecret && webhookSecret !== providedSecret) {
        console.warn("[Availability Webhook] Invalid or missing webhook secret");
        return res.status(401).json({ error: "Invalid webhook secret" });
      }
      
      // Extract form response data - flexible field mapping
      const responseData = {
        contestantName: req.body.contestantName || req.body.name || req.body.Name || req.body["Contestant Name"] || req.body["Your Name"] || "",
        contestantEmail: req.body.contestantEmail || req.body.email || req.body.Email || req.body["Email Address"] || req.body["Your Email"] || "",
        availableDates: req.body.availableDates || req.body.dates || req.body.Dates || req.body["Available Dates"] || req.body["Which dates are you available?"] || "",
        response: req.body.response || req.body.Response || req.body.availability || req.body.Availability || "",
        notes: req.body.notes || req.body.Notes || req.body.questions || req.body.Questions || "",
      };
      
      console.log("[Availability Webhook] Parsed data:", responseData);
      
      // Normalize response value
      let availabilityStatus: 'yes' | 'no' | 'maybe' | 'pending' = 'pending';
      const responseNormalized = (responseData.response || responseData.availableDates).toLowerCase().trim();
      
      if (responseNormalized.includes('yes') || responseNormalized.includes('available') || responseNormalized.includes('all dates')) {
        availabilityStatus = 'yes';
      } else if (responseNormalized.includes('no') || responseNormalized.includes('not available') || responseNormalized.includes('none') || responseNormalized.includes('unavailable')) {
        availabilityStatus = 'no';
      } else if (responseNormalized.includes('maybe') || responseNormalized.includes('some') || responseNormalized.includes('partial')) {
        availabilityStatus = 'maybe';
      } else if (responseNormalized) {
        // If they provided specific dates, mark as yes
        availabilityStatus = 'yes';
      }
      
      // Find the contestant by email or name
      const allContestants = await storage.getContestants();
      let contestant = null;
      
      // Try email match first (more reliable)
      if (responseData.contestantEmail) {
        contestant = allContestants.find(c => 
          c.email?.toLowerCase() === responseData.contestantEmail.toLowerCase()
        );
      }
      
      // Fall back to name match
      if (!contestant && responseData.contestantName) {
        contestant = allContestants.find(c => 
          c.name.toLowerCase() === responseData.contestantName.toLowerCase()
        );
      }
      
      if (!contestant) {
        console.warn("[Availability Webhook] Could not find contestant:", responseData.contestantName, responseData.contestantEmail);
        return res.status(404).json({ 
          error: "Contestant not found",
          searchedName: responseData.contestantName,
          searchedEmail: responseData.contestantEmail,
        });
      }
      
      console.log("[Availability Webhook] Found contestant:", contestant.name, contestant.id);
      
      // Get all record days and update availability for each
      const recordDays = await storage.getRecordDays();
      const updatedDays: string[] = [];
      
      // Build notes with submission info
      const notesWithSource = responseData.notes 
        ? `${responseData.notes}\n\n(Submitted via Microsoft Forms)`
        : `Available Dates: ${responseData.availableDates || 'Not specified'}\n(Submitted via Microsoft Forms)`;
      
      // If specific dates mentioned, try to match them
      const datesText = responseData.availableDates.toLowerCase();
      
      for (const recordDay of recordDays) {
        const recordDate = new Date(recordDay.date);
        const dateStr = recordDate.toLocaleDateString('en-AU', { 
          weekday: 'long', 
          day: 'numeric', 
          month: 'long' 
        }).toLowerCase();
        const shortDate = recordDate.toLocaleDateString('en-AU').toLowerCase();
        const rxNumber = (recordDay.rxNumber || '').toLowerCase();
        
        // Check if this date is mentioned in the response
        let dayStatus = availabilityStatus;
        
        if (availabilityStatus === 'yes' && datesText) {
          // Check if this specific date is mentioned
          const mentioned = datesText.includes(dateStr) || 
                           datesText.includes(shortDate) ||
                           datesText.includes(rxNumber) ||
                           datesText.includes('all');
          
          if (!mentioned && !datesText.includes('all')) {
            // Date not mentioned, might be a maybe
            dayStatus = 'maybe';
          }
        }
        
        // Update availability for this record day
        await storage.upsertContestantAvailability(
          contestant.id,
          recordDay.id,
          dayStatus,
          notesWithSource
        );
        
        updatedDays.push(`${recordDay.rxNumber || recordDay.date}: ${dayStatus}`);
      }
      
      // Mark any active availability tokens as used
      const tokens = await storage.getAvailabilityTokensByContestant(contestant.id);
      for (const token of tokens) {
        if (token.status === 'active') {
          await storage.updateTokenStatus(token.id, 'used');
        }
      }
      
      console.log("[Availability Webhook] Updated availability:", {
        contestant: contestant.name,
        status: availabilityStatus,
        updatedDays,
      });
      
      // Return success response
      res.json({
        success: true,
        message: `Availability updated for ${contestant.name}`,
        contestantId: contestant.id,
        contestantName: contestant.name,
        availabilityStatus,
        updatedDays,
      });
      
    } catch (error: any) {
      console.error("[Availability Webhook] Error processing response:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get webhook configuration info for Power Automate setup
  app.get("/api/webhooks/forms-config", async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      const webhookSecret = await storage.getSystemConfig('forms_webhook_secret');
      
      res.json({
        webhookUrl: `${baseUrl}/api/webhooks/forms-response`,
        hasSecret: !!webhookSecret,
        expectedFields: {
          required: ["contestantName OR contestantEmail", "response"],
          optional: ["recordDate", "dietaryRequirements", "questions", "attendingWith"],
          responseValues: {
            confirmed: ["confirm", "confirmed", "yes", "attending"],
            declined: ["decline", "declined", "no", "cannot attend", "can't attend"],
          },
        },
      });
    } catch (error: any) {
      console.error("Error getting webhook config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Set webhook secret for security
  app.post("/api/webhooks/set-secret", async (req, res) => {
    try {
      const { secret } = req.body;
      
      if (!secret || typeof secret !== 'string' || secret.length < 16) {
        return res.status(400).json({ error: "Secret must be at least 16 characters" });
      }
      
      await storage.setSystemConfig('forms_webhook_secret', secret);
      
      res.json({ success: true, message: "Webhook secret saved" });
    } catch (error: any) {
      console.error("Error setting webhook secret:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Booking Confirmation Routes
  // ========================================

  // Send booking confirmation emails for selected seat assignments
  app.post("/api/booking-confirmations/send", async (req, res) => {
    try {
      // Check if email is configured
      if (!await isEmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Please configure SMTP settings in the Settings page." 
        });
      }

      const { seatAssignmentIds, emailSubject, emailBody: customEmailBody, attachmentPaths } = req.body;

      if (!seatAssignmentIds || !Array.isArray(seatAssignmentIds)) {
        return res.status(400).json({ error: "seatAssignmentIds array is required" });
      }

      // Get base URL for email links
      const baseUrl = getBaseUrl(req);

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
        const responseUrl = appendNgrokSkip(`${baseUrl}/booking-confirmation/${token}`);

        // Send booking confirmation email via Gmail
        try {
          const confirmationLink = appendNgrokSkip(`${baseUrl}/booking-confirmation/${token}`);
          const recordDate = new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          
          // Prepare banner image for CID embedding (declare outside if/else so available for attachments)
          let bookingBannerCid = 'booking-banner-image';
          let bookingBannerBuffer: Buffer | null = null;
          let bookingBannerContentType = 'image/png';
          let bookingBannerFilename = 'dond_banner.png';
          let bannerUrl = '';
          
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
            const bannerUrlConfig = await storage.getSystemConfig('email_banner_url') || `/uploads/branding/dond_banner.png`;
            
            // Prepare banner for CID embedding
            bannerUrl = `cid:${bookingBannerCid}`;
            
            if (bannerUrlConfig.startsWith('/')) {
              const bannerPath = path.join(process.cwd(), bannerUrlConfig.replace(/^\//, ''));
              try {
                if (fs.existsSync(bannerPath)) {
                  bookingBannerBuffer = fs.readFileSync(bannerPath);
                  const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
                  bookingBannerContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                  bookingBannerFilename = path.basename(bannerPath);
                }
              } catch (error) {
                console.warn(`Warning: Could not read banner image at ${bannerPath}:`, error);
                bannerUrl = bannerUrlConfig;  // Fallback to URL
              }
            } else {
              bannerUrl = bannerUrlConfig;  // External URL
            }
            
            // Get configurable text from system config with defaults
            const emailHeadline = await storage.getSystemConfig('booking_email_headline') || 'Your Booking is Confirmed!';
            const emailIntro = await storage.getSystemConfig('booking_email_intro') || 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.';
            const emailInstructions = await storage.getSystemConfig('booking_email_instructions') || 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.';
            const emailButtonText = await storage.getSystemConfig('booking_email_button_text') || 'Confirm Attendance';
            const emailAdditionalInstructions = await storage.getSystemConfig('booking_email_additional_instructions') || '';
            const emailFooter = await storage.getSystemConfig('booking_email_footer') || 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.';
            
            // Get reply-to email for mailto buttons (use dedicated config, fallback to SMTP from email)
            const bookingReplyToEmail = await storage.getSystemConfig('booking_reply_to_email') || 
              (await getSmtpConfig()).fromEmail || 'noreply@example.com';
            
            // Professional HTML email template with configurable content - styled like old format
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
        <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
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
              <!-- Important Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 12px 15px;">
                    <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0; line-height: 1.5;">
                      You must follow the steps below to confirm your attendance and receive tickets for yourself and the group you auditioned with.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Hi ${contestant.name.split(' ')[0]},
              </p>
              
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${emailIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <!-- Booking Details Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">
                      We look forward to seeing you on:
                    </h2>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                      <strong style="color: #8B0000;">DATE:</strong> ${recordDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> 7:30AM
                    </p>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- ACTION REQUIRED Notice with Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #8B0000; border-radius: 8px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 25px; text-align: center;">
                    <p style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                      CAN YOU ATTEND?
                    </p>
                    <p style="color: #ffffff; font-size: 15px; margin: 0 0 20px 0;">
                      Please respond YES or NO and confirm the members of your auditioned group who will be attending ASAP.
                    </p>
                    <a href="mailto:${bookingReplyToEmail}?subject=${encodeURIComponent(`BOOKING RESPONSE - ${contestant.name} - ${recordDate}`)}&body=${`Hi%20Deal%20or%20No%20Deal%20Team,%0D%0A%0D%0AName%3A%20${encodeURIComponent(contestant.name)}%0D%0ADate%3A%20${encodeURIComponent(recordDate)}%0D%0A%0D%0ACAN%20YOU%20ATTEND%3F%20%28mark%20with%20X%29%0D%0A%5B%20%5D%20YES%20-%20I%20confirm%20my%20attendance%0D%0A%5B%20%5D%20NO%20-%20I%20cannot%20attend%20%28Reason%3A%20%29%0D%0A%0D%0AGroup%20members%20attending%20%28please%20provide%20FULL%20NAMES%29%3A%0D%0A%0D%0A---%20REQUIRED%20INFORMATION%20%28if%20attending%29%20---%0D%0A%0D%0ADo%20you%20have%20any%20medical%20conditions%3F%0D%0AIf%20yes%2C%20please%20describe%3A%0D%0A%0D%0ADo%20you%20have%20any%20mobility%20requirements%3F%20%28i.e.%20issues%20climbing%20stairs%20or%20standing%20for%20extended%20periods%29%0D%0AAnswer%3A%0D%0A%0D%0AEmergency%20contact%20name%20%26%20phone%20number%3A%0D%0AAnswer%3A%0D%0A%0D%0ADietary%20requirements%20%28mark%20with%20X%29%3A%0D%0A%5B%20%5D%20Vegetarian%0D%0A%5B%20%5D%20Vegan%0D%0A%5B%20%5D%20Gluten%20Free%0D%0A%5B%20%5D%20Dairy%20Free%0D%0A%0D%0APlease%20note%20that%20all%20our%20meals%20are%20nut-free.%20If%20your%20dietary%20requirements%20fall%20outside%20the%20options%2C%20we%20won%27t%20be%20able%20to%20cater%20to%20them%2C%20so%20we%20kindly%20ask%20that%20you%20bring%20your%20own%20meals.%0D%0A%0D%0AThank%20you.`}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
                  </td>
                </tr>
              </table>
              
              ${emailAdditionalInstructions ? `
              <!-- Additional Instructions -->
              <div style="margin: 20px 0 25px 0; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                ${emailAdditionalInstructions.split('\n\n').map((paragraph: string) => 
                  `<p style="color: #444444; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              ` : ''}
              
              <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 20px 0;">
                Please ensure you bring your own water bottle.
              </p>
              
              <p style="color: #333333; font-size: 15px; margin: 0;">
                We look forward to seeing you on the day!<br/>
                Kind Regards,<br/>
                <strong>The Deal Or No Deal Team</strong>
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
          ${emailFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
          }
          
          const subject = emailSubject || `Studio Invitation - ${recordDate}`;
          
          // Get sender name from system config
          const senderNameConfig = await storage.getSystemConfig('email_sender_name');
          const emailConfig: EmailConfig = {
            senderName: senderNameConfig || 'Deal or No Deal',
          };
          
          // Prepare attachments including CID-embedded banner image
          const allAttachments: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
          
          // Add CID-embedded banner image if available (for non-custom email bodies)
          if (!customEmailBody && bookingBannerBuffer) {
            allAttachments.push({
              filename: bookingBannerFilename,
              content: bookingBannerBuffer,
              contentType: bookingBannerContentType,
              cid: bookingBannerCid,
            });
          }
          
          // Add PDF attachments if specified
          if (attachmentPaths && Array.isArray(attachmentPaths) && attachmentPaths.length > 0) {
            const objectStorageService = new ObjectStorageService();
            
            for (const attachmentPath of attachmentPaths) {
              try {
                const { buffer, contentType, filename } = await objectStorageService.getObjectAsBuffer(attachmentPath);
                allAttachments.push({ content: buffer, contentType, filename });
              } catch (attachErr: any) {
                console.error(`Failed to load attachment ${attachmentPath}:`, attachErr.message);
              }
            }
          }
          
          // Send email with attachments (CID banner and/or PDFs)
          if (allAttachments.length > 0) {
            await sendEmailWithAttachment(contestant.email, subject, emailBody, allAttachments, emailConfig);
          } else {
            await sendEmail(contestant.email, subject, emailBody, undefined, emailConfig);
          }
        } catch (error: any) {
          console.error(`Failed to send booking confirmation email to ${contestant.email}:`, error.message);
        }

        // Create a booking message record for this initial email
        const recordDateForLog = new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const confirmationLinkForLog = appendNgrokSkip(`${baseUrl}/booking-confirmation/${token}`);
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
          subject: emailSubject || `Studio Invitation - ${recordDateForLog}`,
          body: storedBody,
          sentAt: new Date(),
        });

        // Update bookingEmailSent timestamp
        await storage.updateSeatAssignmentWorkflow(seatAssignmentId, {
          bookingEmailSent: new Date(),
        });

        // Update contestant status to 'invited'
        await storage.updateContestantAvailability(assignment.contestantId, 'invited');

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

  // Send ticket email with PDF after confirmation
  app.post("/api/seat-assignments/:id/send-ticket", requireAuth, async (req, res) => {
    try {
      // Check if email is configured
      if (!await isEmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Please configure SMTP settings in the Settings page." 
        });
      }

      const { id } = req.params;
      
      // Get seat assignment with contestant and record day data
      const assignment = await storage.getSeatAssignmentById(id);
      
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }

      // Require booking to be confirmed before sending ticket
      if (!assignment.confirmedRsvp) {
        return res.status(400).json({ error: "Cannot send ticket before booking is confirmed" });
      }

      const contestant = await storage.getContestantById(assignment.contestantId);
      const recordDay = await storage.getRecordDayById(assignment.recordDayId);

      if (!contestant || !recordDay) {
        return res.status(404).json({ error: "Contestant or record day not found" });
      }

      if (!contestant.email) {
        return res.status(400).json({ error: "Contestant has no email address" });
      }

      // Format date
      const recordDate = new Date(recordDay.date).toLocaleDateString('en-AU', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

      // Read the static PDF file for attachment
      const pdfPath = path.join(process.cwd(), 'server', 'assets', 'Contestant_Information.pdf');
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = fs.readFileSync(pdfPath);
      } catch (error) {
        console.error("Error reading PDF file:", error);
        return res.status(500).json({ error: "Contestant information PDF not found" });
      }

      // Prepare banner image for CID embedding
      const ticketBannerCid = 'ticket-banner-image';
      let ticketBannerBuffer: Buffer | null = null;
      let ticketBannerContentType = 'image/png';
      let ticketBannerFilename = 'dond_banner.png';
      let bannerUrl = '';
      
      // Get banner URL from system config or use default
      const bannerUrlConfig = await storage.getSystemConfig('email_banner_url') || `/uploads/branding/dond_banner.png`;
      
      // Prepare banner for CID embedding
      bannerUrl = `cid:${ticketBannerCid}`;
      
      if (bannerUrlConfig.startsWith('/')) {
        const bannerPath = path.join(process.cwd(), bannerUrlConfig.replace(/^\//, ''));
        try {
          if (fs.existsSync(bannerPath)) {
            ticketBannerBuffer = fs.readFileSync(bannerPath);
            const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
            ticketBannerContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            ticketBannerFilename = path.basename(bannerPath);
          }
        } catch (error) {
          console.warn(`Warning: Could not read banner image at ${bannerPath}:`, error);
          bannerUrl = bannerUrlConfig;  // Fallback to URL
        }
      } else {
        bannerUrl = bannerUrlConfig;  // External URL
      }
      
      // Get configurable text from system config with defaults
      const ticketHeadline = await storage.getSystemConfig('ticket_email_headline') || 'Your Official Ticket';
      const ticketIntro = await storage.getSystemConfig('ticket_email_intro') || 'Thank you for confirming your attendance! This is your official ticket for the Deal or No Deal recording.';
      const ticketImportant = await storage.getSystemConfig('ticket_email_important') || 'IMPORTANT INFORMATION is attached in the PDF. Please read it carefully before your record day.';
      const ticketFooter = await storage.getSystemConfig('ticket_email_footer') || 'This is an automated email from the Deal or No Deal production team.';
      
      // Create email HTML with banner
      const emailHtml = `<!DOCTYPE html>
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
        <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${ticketHeadline}
        </h1>
      </td>
    </tr>
    
    <!-- Content Card -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 15px;">
                    <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0;">
                      ${ticketImportant}
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hi ${contestant.name.split(' ')[0]},
              </p>
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${ticketIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase;">
                      Your Booking Details
                    </h2>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">DATE:</strong> ${recordDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> 7:30 AM
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC 3008
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 15px; margin: 0 0 5px 0;">
                We look forward to seeing you!
              </p>
              <p style="color: #333333; font-size: 15px; margin: 0;">
                Kind Regards,<br/>
                <strong>The Deal Or No Deal Team</strong>
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
          ${ticketFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

      // Get sender name from system config
      const senderNameConfig = await storage.getSystemConfig('email_sender_name');
      const emailConfig: EmailConfig = {
        senderName: senderNameConfig || 'Deal or No Deal',
      };

      // Build attachments array
      const attachments: any[] = [{
        filename: 'Record_Day_Information.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }];
      
      // Add banner as CID attachment if available
      if (ticketBannerBuffer) {
        attachments.push({
          filename: ticketBannerFilename,
          content: ticketBannerBuffer,
          contentType: ticketBannerContentType,
          cid: ticketBannerCid
        });
      }

      // Send email with PDF attachment and banner
      await sendEmailWithAttachment(
        contestant.email,
        'Deal or No Deal - Record Day Information',
        emailHtml,
        attachments,
        emailConfig
      );

      // Update ticketEmailSent timestamp
      await storage.updateSeatAssignmentWorkflow(id, {
        ticketEmailSent: new Date(),
      });

      res.json({
        success: true,
        message: `Ticket email sent to ${contestant.email}`,
        contestantName: contestant.name,
        email: contestant.email,
      });
    } catch (error: any) {
      console.error("Error sending ticket email:", error);
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
      // Check if email is configured
      if (!await isEmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Please configure SMTP settings in the Settings page." 
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

        // Update contestant's availability status to 'confirmed'
        await storage.updateContestantAvailability(assignment.contestantId, 'confirmed');

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
              const confirmEmailBaseUrl = getBaseUrl(req);
              
              // Get email config
              const senderNameConfig = await storage.getSystemConfig('email_sender_name');
              const emailConfig: EmailConfig = {
                senderName: senderNameConfig || 'Deal or No Deal',
              };
              
              // Prepare banner image for CID embedding (works offline in all email clients)
              const confirmBannerUrlConfig = await storage.getSystemConfig('email_banner_url') || `/uploads/branding/dond_banner.png`;
              const confirmBannerCid = 'confirm-banner-image';
              let confirmBannerUrl = `cid:${confirmBannerCid}`;
              let confirmBannerBuffer: Buffer | null = null;
              let confirmBannerContentType = 'image/png';
              let confirmBannerFilename = 'dond_banner.png';
              
              if (confirmBannerUrlConfig.startsWith('/')) {
                const bannerPath = path.join(process.cwd(), confirmBannerUrlConfig.replace(/^\//, ''));
                try {
                  if (fs.existsSync(bannerPath)) {
                    confirmBannerBuffer = fs.readFileSync(bannerPath);
                    const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
                    confirmBannerContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                    confirmBannerFilename = path.basename(bannerPath);
                  }
                } catch (error) {
                  console.warn(`Warning: Could not read banner image at ${bannerPath}:`, error);
                  confirmBannerUrl = confirmBannerUrlConfig;  // Fallback to URL
                }
              } else {
                confirmBannerUrl = confirmBannerUrlConfig;  // External URL
              }
              
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
        <img src="${confirmBannerUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />
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
              
              // Prepare attachments including CID-embedded banner image
              const confirmAttachments: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
              
              // Add CID-embedded banner image if available
              if (confirmBannerBuffer) {
                confirmAttachments.push({
                  filename: confirmBannerFilename,
                  content: confirmBannerBuffer,
                  contentType: confirmBannerContentType,
                  cid: confirmBannerCid,
                });
              }
              
              // Get configured PDF for auto-confirmation emails
              const configuredPdfPath = await storage.getSystemConfig('auto_confirmation_pdf_path');
              
              if (configuredPdfPath && configuredPdfPath !== 'none') {
                try {
                  const objectStorageService = new ObjectStorageService();
                  const { buffer, contentType, filename } = await objectStorageService.getObjectAsBuffer(configuredPdfPath);
                  confirmAttachments.push({ content: buffer, contentType, filename });
                  console.log(`📎 Loaded configured PDF attachment: ${filename}`);
                } catch (attachErr: any) {
                  console.error(`Failed to load configured PDF attachment ${configuredPdfPath}:`, attachErr.message);
                }
              }
              
              // Send the confirmation email with attachments (CID banner and/or PDFs)
              if (confirmAttachments.length > 0) {
                await sendEmailWithAttachment(contestant.email, confirmationEmailSubject, confirmationEmailBody, confirmAttachments, emailConfig);
                console.log(`📧 Auto-confirmation email sent to ${contestant.email} with ${confirmAttachments.length} attachment(s)`);
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

  // Poll inbox for contestant email replies - not available with SMTP
  // Note: This feature requires mail server API access (IMAP/Exchange Web Services)
  // With SMTP-only setup, contestants respond via booking confirmation forms instead
  app.post("/api/booking-confirmations/poll-inbox", async (req, res) => {
    return res.status(503).json({ 
      code: 'FEATURE_NOT_AVAILABLE',
      error: "Inbox polling is not available with SMTP email. Contestants can respond via the booking confirmation forms instead." 
    });
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
      
      // Update contestant status to assigned for new standbys
      for (const contestantId of newContestantIds) {
        await storage.updateContestantAvailability(contestantId, 'assigned');
      }
      
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
      
      // Get the standby to find the contestant
      const allStandbys = await storage.getStandbyAssignments();
      const standby = allStandbys.find(s => s.id === id);
      
      await storage.deleteStandbyAssignment(id);
      
      // Update contestant status back to available if they're not seated/assigned elsewhere
      if (standby) {
        await storage.updateContestantAvailability(standby.contestantId, 'available');
      }
      
      res.json({ message: "Standby assignment deleted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update standby priorities (reorder standbys)
  app.post("/api/standbys/reorder", async (req, res) => {
    try {
      const { recordDayId, orderedIds } = req.body;
      
      if (!recordDayId || !Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "recordDayId and orderedIds array are required" });
      }
      
      // Update each standby with its new priority
      const updates = await Promise.all(
        orderedIds.map((id: string, index: number) => 
          storage.updateStandbyAssignment(id, { priority: index + 1 })
        )
      );
      
      res.json({ message: "Standby priorities updated", updated: updates.length });
    } catch (error: any) {
      console.error("Error updating standby priorities:", error);
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

      // Update contestant status to 'available' so they appear correctly in all tabs
      await storage.updateContestantAvailability(standby.contestantId, 'available');

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

      // Update contestant status to assigned when standby is seated
      if (seatLabel) {
        await storage.updateContestantAvailability(matchingStandby.contestantId, 'assigned');
      }

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
          const baseUrl = getBaseUrl(req);
          const confirmationUrl = appendNgrokSkip(`${baseUrl}/standby-confirmation/${tokenString}`);

          // Prepare banner image for CID embedding (works offline in all email clients)
          const standbyBannerUrlConfig = await storage.getSystemConfig('email_banner_url') || `/uploads/branding/dond_banner.png`;
          const standbyBannerCid = 'standby-banner-image';
          let standbyBannerUrl = `cid:${standbyBannerCid}`;
          let standbyBannerBuffer: Buffer | null = null;
          let standbyBannerContentType = 'image/png';
          let standbyBannerFilename = 'dond_banner.png';
          
          if (standbyBannerUrlConfig.startsWith('/')) {
            const bannerPath = path.join(process.cwd(), standbyBannerUrlConfig.replace(/^\//, ''));
            try {
              if (fs.existsSync(bannerPath)) {
                standbyBannerBuffer = fs.readFileSync(bannerPath);
                const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
                standbyBannerContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                standbyBannerFilename = path.basename(bannerPath);
              }
            } catch (error) {
              console.warn(`Warning: Could not read banner image at ${bannerPath}:`, error);
              standbyBannerUrl = standbyBannerUrlConfig;  // Fallback to URL
            }
          } else {
            standbyBannerUrl = standbyBannerUrlConfig;  // External URL
          }

          // Get reply-to email for mailto buttons
          const smtpConfig = await getSmtpConfig();
          const standbyReplyToEmail = smtpConfig.fromEmail || 'noreply@example.com';
          
          // Get saved standby email template values from database
          const savedStandbyHeadline = await storage.getSystemConfig('standby_email_headline');
          const savedStandbyIntro = await storage.getSystemConfig('standby_email_intro');
          const savedStandbyInstructions = await storage.getSystemConfig('standby_email_instructions');
          const savedStandbyFooter = await storage.getSystemConfig('standby_email_footer');
          
          // Use saved values with fallback defaults
          const standbyHeadline = savedStandbyHeadline || "You've Been Selected to be a Standby Contestant!";
          const standbyIntro = savedStandbyIntro || "We enjoyed meeting you at our auditions and would love to invite you to be a STANDBY CONTESTANT on Deal or No Deal. As a standby contestant, you may be selected to join our live studio recording of the show should any positions become available on the day.";
          const standbyInstructions = savedStandbyInstructions || "If you're selected to participate in studio, you will be required for the full day.\n\nAfter being a Standby Contestant, you are eligible to be FAST-TRACKED into the next available record date to attend a full day in studio. That's double the chances! You must email dond.standby@endemolshine.com.au to be rebooked to return.\n\nPlease find attached important information relating to your attendance at the Deal or No Deal recording. Please read this attachment thoroughly and get in touch ASAP should there be any issues.\n\nYou will receive another email closer to your record date with additional paperwork.";
          const standbyFooterText = savedStandbyFooter || "This is an automated message from the Deal or No Deal production team. If you have questions, please reply to this email.";

          // Build email content matching booking email style with dark maroon/gold theme
          const subject = `Deal or No Deal - Standby Booking for ${formattedDate}`;
          const htmlBody = `<!DOCTYPE html>
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
        <img src="${standbyBannerUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />
      </td>
    </tr>
    
    <!-- Gold Title Bar -->
    <tr>
      <td style="background: linear-gradient(180deg, #4a1a1a 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${standbyHeadline}
        </h1>
      </td>
    </tr>
    
    <!-- Content Card -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 35px 30px;">
              <!-- Yellow Warning Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border-radius: 8px; border: 1px solid #ffc107; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 15px;">
                    <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0; line-height: 1.5;">
                      You must follow the steps below to confirm your attendance and receive tickets for yourself and the group you auditioned with.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Hi ${standby.contestant.name.split(' ')[0]},
              </p>
              
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${standbyIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <!-- Booking Details Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">
                      We look forward to seeing you on:
                    </h2>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                      <strong style="color: #8B0000;">DATE:</strong> ${formattedDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> 8:00AM
                    </p>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- ACTION REQUIRED Notice with Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #8B0000; border-radius: 8px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 25px; text-align: center;">
                    <p style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                      CAN YOU ATTEND?
                    </p>
                    <p style="color: #ffffff; font-size: 15px; margin: 0 0 20px 0;">
                      Please RSVP for you and your AUDITIONED group by replying to this email ASAP.
                    </p>
                    <a href="mailto:${standbyReplyToEmail}?subject=${encodeURIComponent(`STANDBY RESPONSE - ${standby.contestant.name} - ${formattedDate}`)}&body=${`Hi%20Deal%20or%20No%20Deal%20Team,%0D%0A%0D%0AName%3A%20${encodeURIComponent(standby.contestant.name)}%0D%0ADate%3A%20${encodeURIComponent(formattedDate)}%0D%0A%0D%0ACAN%20YOU%20ATTEND%20AS%20STANDBY%3F%20%28mark%20with%20X%29%0D%0A%5B%20%5D%20YES%20-%20I%20confirm%20my%20attendance%0D%0A%5B%20%5D%20NO%20-%20I%20cannot%20attend%20%28Reason%3A%20%29%0D%0A%0D%0AGroup%20members%20attending%20%28please%20provide%20FULL%20NAMES%29%3A%0D%0A%0D%0A---%20REQUIRED%20INFORMATION%20%28if%20attending%29%20---%0D%0A%0D%0ADo%20you%20have%20any%20medical%20conditions%3F%0D%0AIf%20yes%2C%20please%20describe%3A%0D%0A%0D%0ADo%20you%20have%20any%20mobility%20requirements%3F%20%28i.e.%20issues%20climbing%20stairs%20or%20standing%20for%20extended%20periods%29%0D%0AAnswer%3A%0D%0A%0D%0AEmergency%20contact%20name%20%26%20phone%20number%3A%0D%0AAnswer%3A%0D%0A%0D%0ADietary%20requirements%20%28mark%20with%20X%29%3A%0D%0A%5B%20%5D%20Vegetarian%0D%0A%5B%20%5D%20Vegan%0D%0A%5B%20%5D%20Gluten%20Free%0D%0A%5B%20%5D%20Dairy%20Free%0D%0A%0D%0APlease%20note%20that%20all%20our%20meals%20are%20nut-free.%20If%20your%20dietary%20requirements%20fall%20outside%20the%20options%2C%20we%20won%27t%20be%20able%20to%20cater%20to%20them%2C%20so%20we%20kindly%20ask%20that%20you%20bring%20your%20own%20meals.%0D%0A%0D%0AThank%20you.`}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
                  </td>
                </tr>
              </table>
              
              <div style="color: #444444; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                ${standbyInstructions.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <!-- Required Info Reminder -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f5; border-radius: 8px; border: 1px solid #e0e0e0; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h3 style="color: #333333; font-size: 14px; font-weight: bold; margin: 0 0 12px 0;">
                      If you will be attending, please provide:
                    </h3>
                    <ul style="color: #555555; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                      <li>Medical conditions (if any)</li>
                      <li>Mobility requirements (e.g., issues climbing stairs or standing for a considerable amount of time)</li>
                      <li>Emergency contact name & phone number</li>
                      <li>Dietary requirements</li>
                    </ul>
                  </td>
                </tr>
              </table>
              
              <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 20px 0;">
                Please ensure you bring your own water bottle.
              </p>
              
              <p style="color: #333333; font-size: 15px; margin: 0;">
                We look forward to seeing you on the day!<br/>
                Kind Regards,<br/>
                <strong>The Deal Or No Deal Team</strong>
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
          ${standbyFooterText}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

          // Prepare attachments with CID-embedded banner
          const standbyAttachments: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
          
          if (standbyBannerBuffer) {
            standbyAttachments.push({
              filename: standbyBannerFilename,
              content: standbyBannerBuffer,
              contentType: standbyBannerContentType,
              cid: standbyBannerCid,
            });
          }

          // Send email via SMTP
          const senderNameConfig = await storage.getSystemConfig('email_sender_name');
          const emailConfig: EmailConfig = {
            senderName: senderNameConfig || 'Deal or No Deal',
          };

          if (standbyAttachments.length > 0) {
            await sendEmailWithAttachment(
              standby.contestant.email!,
              subject,
              htmlBody,
              standbyAttachments,
              emailConfig
            );
          } else {
            await sendEmail(
              standby.contestant.email!,
              subject,
              htmlBody,
              htmlBody,
              emailConfig
            );
          }

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

  // Get status of all external integrations (Email, Google Sheets, etc.)
  app.get("/api/system/integrations", async (req, res) => {
    try {
      const emailAvailable = await isEmailAvailable();
      const googleSheetsAvailable = isGoogleSheetsAvailable();
      const smtpConfig = await getSmtpConfig();
      
      res.json({
        email: {
          available: emailAvailable,
          message: emailAvailable 
            ? `Email configured (SMTP: ${smtpConfig.host})` 
            : 'Email not configured. Configure SMTP settings in Settings page.',
          host: smtpConfig.host || null,
          fromEmail: smtpConfig.fromEmail || null,
        },
        googleSheets: {
          available: googleSheetsAvailable,
          message: googleSheetsAvailable 
            ? 'Google Sheets integration is connected' 
            : 'Google Sheets integration requires Replit Connectors or local OAuth setup'
        },
        allAvailable: emailAvailable && googleSheetsAvailable
      });
    } catch (error: any) {
      console.error("Error checking integrations:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // SMTP Email Configuration Endpoints
  // ==========================================

  // Get SMTP configuration (excluding password for security)
  app.get("/api/smtp/config", requireAuth, async (req, res) => {
    try {
      const config = await getSmtpConfig();
      res.json({
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        // Don't expose password
        hasPassword: !!config.password,
      });
    } catch (error: any) {
      console.error("Error getting SMTP config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Save SMTP configuration
  app.post("/api/smtp/config", requireAuth, async (req, res) => {
    try {
      const { host, port, secure, username, password, fromEmail, fromName } = req.body;
      
      if (host !== undefined) await storage.setSystemConfig('smtp_host', host);
      if (port !== undefined) await storage.setSystemConfig('smtp_port', String(port));
      if (secure !== undefined) await storage.setSystemConfig('smtp_secure', String(secure));
      if (username !== undefined) await storage.setSystemConfig('smtp_username', username);
      if (password !== undefined) await storage.setSystemConfig('smtp_password', password);
      if (fromEmail !== undefined) await storage.setSystemConfig('smtp_from_email', fromEmail);
      if (fromName !== undefined) await storage.setSystemConfig('smtp_from_name', fromName);
      
      res.json({ success: true, message: "SMTP configuration saved" });
    } catch (error: any) {
      console.error("Error saving SMTP config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Test SMTP connection
  app.post("/api/smtp/test", requireAuth, async (req, res) => {
    try {
      const result = await testSmtpConnection();
      
      if (result.success) {
        res.json({ success: true, message: "SMTP connection successful" });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Error testing SMTP:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send test email
  app.post("/api/smtp/test-email", requireAuth, async (req, res) => {
    try {
      const { toEmail } = req.body;
      
      if (!toEmail) {
        return res.status(400).json({ error: "toEmail is required" });
      }
      
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(toEmail)) {
        return res.status(400).json({ error: "Invalid email address format" });
      }

      const smtpConfig = await getSmtpConfig();
      
      if (!smtpConfig.host || !smtpConfig.fromEmail) {
        return res.status(400).json({ error: "SMTP is not configured. Please configure SMTP settings first." });
      }

      await sendEmail(
        toEmail,
        'Test Email from Deal or No Deal Booking System',
        'This is a test email to verify your SMTP configuration is working correctly.\n\nIf you received this email, your email settings are configured correctly!',
        '<h2>Test Email</h2><p>This is a test email to verify your SMTP configuration is working correctly.</p><p>If you received this email, your email settings are configured correctly!</p>',
        { senderName: smtpConfig.fromName || 'Deal or No Deal' }
      );

      res.json({ success: true, message: `Test email sent to ${toEmail}` });
    } catch (error: any) {
      console.error("Error sending test email:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send test booking confirmation email (for previewing the template)
  app.post("/api/smtp/test-booking-email", requireAuth, async (req, res) => {
    try {
      const { toEmail } = req.body;
      
      if (!toEmail) {
        return res.status(400).json({ error: "toEmail is required" });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(toEmail)) {
        return res.status(400).json({ error: "Invalid email address format" });
      }

      const smtpConfig = await getSmtpConfig();
      
      if (!smtpConfig.host || !smtpConfig.fromEmail) {
        return res.status(400).json({ error: "SMTP is not configured. Please configure SMTP settings first." });
      }

      // Get configurable text from system config with defaults
      const bannerUrlConfig = await storage.getSystemConfig('booking_email_banner') || '/email-assets/dond-banner.png';
      const emailHeadline = await storage.getSystemConfig('booking_email_headline') || 'Your Booking is Confirmed!';
      const emailIntro = await storage.getSystemConfig('booking_email_intro') || 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.';
      const emailInstructions = await storage.getSystemConfig('booking_email_instructions') || 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.';
      const emailButtonText = await storage.getSystemConfig('booking_email_button_text') || 'Confirm Attendance';
      const emailAdditionalInstructions = await storage.getSystemConfig('booking_email_additional_instructions') || '';
      const emailFooter = await storage.getSystemConfig('booking_email_footer') || 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.';
      
      const replyToEmail = smtpConfig.fromEmail || 'noreply@example.com';
      
      // Test data
      const testContestantName = 'Test Contestant';
      const testRecordDate = 'Wednesday, 15 January 2026';
      const testSeatLocation = 'Block 3, Seat 12';
      const testConfirmationLink = '#test-link';
      
      // Prepare banner
      let bannerUrl = bannerUrlConfig;
      let bannerAttachment: any = null;
      const bannerCid = 'booking-banner-image';
      
      if (bannerUrlConfig.startsWith('/')) {
        const bannerPath = path.join(process.cwd(), bannerUrlConfig.replace(/^\//, ''));
        try {
          if (fs.existsSync(bannerPath)) {
            const bannerBuffer = fs.readFileSync(bannerPath);
            const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
            const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            bannerAttachment = {
              filename: path.basename(bannerPath),
              content: bannerBuffer,
              cid: bannerCid,
              contentType,
            };
            bannerUrl = `cid:${bannerCid}`;
          }
        } catch (error) {
          console.warn('Warning: Could not read banner image:', error);
        }
      }

      const emailBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #2a0a0a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
    
    <tr>
      <td style="padding: 0; line-height: 0;">
        <img src="${bannerUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />
      </td>
    </tr>
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${emailHeadline}
        </h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 35px 30px;">
              <!-- Important Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 12px 15px;">
                    <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0; line-height: 1.5;">
                      You must follow the steps below to confirm your attendance and receive tickets for yourself and the group you auditioned with.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Hi ${testContestantName.split(' ')[0]},
              </p>
              
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${emailIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">
                      We look forward to seeing you on:
                    </h2>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                      <strong style="color: #8B0000;">DATE:</strong> ${testRecordDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> 7:30AM
                    </p>
                    <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- ACTION REQUIRED Notice with Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #8B0000; border-radius: 8px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 25px; text-align: center;">
                    <p style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                      CAN YOU ATTEND?
                    </p>
                    <p style="color: #ffffff; font-size: 15px; margin: 0 0 20px 0;">
                      Please respond YES or NO and confirm the members of your auditioned group who will be attending ASAP.
                    </p>
                    <a href="mailto:${replyToEmail}?subject=${encodeURIComponent(`BOOKING RESPONSE - ${testContestantName} - ${testRecordDate}`)}&body=${`Hi%20Deal%20or%20No%20Deal%20Team,%0D%0A%0D%0AName%3A%20${encodeURIComponent(testContestantName)}%0D%0ADate%3A%20${encodeURIComponent(testRecordDate)}%0D%0A%0D%0ACAN%20YOU%20ATTEND%3F%20%28mark%20with%20X%29%0D%0A%5B%20%5D%20YES%20-%20I%20confirm%20my%20attendance%0D%0A%5B%20%5D%20NO%20-%20I%20cannot%20attend%20%28Reason%3A%20%29%0D%0A%0D%0AGroup%20members%20attending%20%28please%20provide%20FULL%20NAMES%29%3A%0D%0A%0D%0A---%20REQUIRED%20INFORMATION%20%28if%20attending%29%20---%0D%0A%0D%0ADo%20you%20have%20any%20medical%20conditions%3F%0D%0AIf%20yes%2C%20please%20describe%3A%0D%0A%0D%0ADo%20you%20have%20any%20mobility%20requirements%3F%20%28i.e.%20issues%20climbing%20stairs%20or%20standing%20for%20extended%20periods%29%0D%0AAnswer%3A%0D%0A%0D%0AEmergency%20contact%20name%20%26%20phone%20number%3A%0D%0AAnswer%3A%0D%0A%0D%0ADietary%20requirements%20%28mark%20with%20X%29%3A%0D%0A%5B%20%5D%20Vegetarian%0D%0A%5B%20%5D%20Vegan%0D%0A%5B%20%5D%20Gluten%20Free%0D%0A%5B%20%5D%20Dairy%20Free%0D%0A%0D%0APlease%20note%20that%20all%20our%20meals%20are%20nut-free.%20If%20your%20dietary%20requirements%20fall%20outside%20the%20options%2C%20we%20won%27t%20be%20able%20to%20cater%20to%20them%2C%20so%20we%20kindly%20ask%20that%20you%20bring%20your%20own%20meals.%0D%0A%0D%0AThank%20you.`}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
                  </td>
                </tr>
              </table>
              
              ${emailAdditionalInstructions ? `
              <div style="margin: 20px 0 25px 0; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                ${emailAdditionalInstructions.split('\n\n').map((paragraph: string) => 
                  `<p style="color: #444444; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              ` : ''}
              
              <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 20px 0;">
                Please ensure you bring your own water bottle.
              </p>
              
              <p style="color: #333333; font-size: 15px; margin: 0;">
                We look forward to seeing you on the day!<br/>
                Kind Regards,<br/>
                <strong>The Deal Or No Deal Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
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

      const attachments = bannerAttachment ? [bannerAttachment] : [];

      await sendEmail(
        toEmail,
        'TEST: Deal or No Deal - Booking Confirmation',
        'This is a test booking confirmation email.',
        emailBody,
        { 
          senderName: smtpConfig.fromName || 'Deal or No Deal',
          attachments 
        }
      );

      res.json({ success: true, message: `Test booking confirmation email sent to ${toEmail}` });
    } catch (error: any) {
      console.error("Error sending test booking email:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==========================================
  // Adobe Sign SMTP Configuration Endpoints
  // ==========================================

  // Get Adobe Sign SMTP configuration
  app.get("/api/adobe-sign-smtp/config", requireAuth, async (req, res) => {
    try {
      const { getAdobeSignSmtpConfig } = await import("./email");
      const config = await getAdobeSignSmtpConfig();
      res.json({
        host: config.host,
        port: config.port,
        secure: config.secure,
        username: config.username,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        hasPassword: !!config.password,
      });
    } catch (error: any) {
      console.error("Error getting Adobe Sign SMTP config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Save Adobe Sign SMTP configuration
  app.post("/api/adobe-sign-smtp/config", requireAuth, async (req, res) => {
    try {
      const { host, port, secure, username, password, fromEmail, fromName } = req.body;
      
      if (host !== undefined) await storage.setSystemConfig('adobe_sign_smtp_host', host);
      if (port !== undefined) await storage.setSystemConfig('adobe_sign_smtp_port', String(port));
      if (secure !== undefined) await storage.setSystemConfig('adobe_sign_smtp_secure', String(secure));
      if (username !== undefined) await storage.setSystemConfig('adobe_sign_smtp_username', username);
      if (password !== undefined) await storage.setSystemConfig('adobe_sign_smtp_password', password);
      if (fromEmail !== undefined) await storage.setSystemConfig('adobe_sign_smtp_from_email', fromEmail);
      if (fromName !== undefined) await storage.setSystemConfig('adobe_sign_smtp_from_name', fromName);
      
      res.json({ success: true, message: "Adobe Sign SMTP configuration saved" });
    } catch (error: any) {
      console.error("Error saving Adobe Sign SMTP config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Test Adobe Sign SMTP connection
  app.post("/api/adobe-sign-smtp/test", requireAuth, async (req, res) => {
    try {
      const { testAdobeSignSmtpConnection } = await import("./email");
      const result = await testAdobeSignSmtpConnection();
      
      if (result.success) {
        res.json({ success: true, message: "Adobe Sign SMTP connection successful" });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Error testing Adobe Sign SMTP:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==========================================
  // Booking Tracker Endpoints (for Booking Responses page)
  // ==========================================
  
  // Get all seat assignments for booking response tracking
  // Similar to paperwork endpoint but shows ALL assigned contestants
  // Can filter by status: "all", "not_sent", "awaiting", "confirmed", "declined"
  // Also returns counts for stats cards (computed from record-day-filtered but not status-filtered data)
  app.get("/api/booking-tracker", requireAuth, async (req, res) => {
    try {
      const { recordDayId, status } = req.query;
      
      // Get all seat assignments
      const assignments = await storage.getAllSeatAssignments();
      const contestants = await storage.getContestants();
      const recordDays = await storage.getRecordDays();
      
      // Get canceled assignments (for declined count)
      const canceledAssignments = await storage.getCanceledAssignments();
      
      // Start with all assignments
      let recordDayFilteredAssignments = [...assignments];
      
      // Filter by record day if specified (for both data and stats)
      if (recordDayId && typeof recordDayId === 'string' && recordDayId !== 'all') {
        recordDayFilteredAssignments = recordDayFilteredAssignments.filter((a: SeatAssignment) => a.recordDayId === recordDayId);
      }
      
      // Filter canceled assignments by record day for declined count
      let recordDayFilteredCanceled = [...canceledAssignments];
      if (recordDayId && typeof recordDayId === 'string' && recordDayId !== 'all') {
        recordDayFilteredCanceled = recordDayFilteredCanceled.filter((a: any) => a.recordDayId === recordDayId);
      }
      
      // Helper to check if assignment is declined (notes/reason start with [DECLINED])
      const isDeclined = (a: SeatAssignment) => a.notes?.startsWith('[DECLINED]');
      const isCanceledDeclined = (a: any) => a.reason?.startsWith('[DECLINED]');
      
      // Count declined from both active assignments and canceled assignments
      const declinedFromActive = recordDayFilteredAssignments.filter((a: SeatAssignment) => isDeclined(a)).length;
      const declinedFromCanceled = recordDayFilteredCanceled.filter((a: any) => isCanceledDeclined(a)).length;
      
      // Calculate stats from record-day-filtered data (before status filtering)
      const stats = {
        total: recordDayFilteredAssignments.length,
        notSent: recordDayFilteredAssignments.filter((a: SeatAssignment) => !a.bookingEmailSent && !isDeclined(a)).length,
        awaiting: recordDayFilteredAssignments.filter((a: SeatAssignment) => 
          a.bookingEmailSent && !a.confirmedRsvp && !isDeclined(a)
        ).length,
        confirmed: recordDayFilteredAssignments.filter((a: SeatAssignment) => 
          a.confirmedRsvp && !isDeclined(a)
        ).length,
        declined: declinedFromActive + declinedFromCanceled,
      };
      
      // Now filter by status for the data results
      let statusFilteredAssignments = [...recordDayFilteredAssignments];
      if (status && typeof status === 'string' && status !== 'all') {
        if (status === 'not_sent') {
          // Booking email not sent (and not declined)
          statusFilteredAssignments = statusFilteredAssignments.filter((a: SeatAssignment) => 
            !a.bookingEmailSent && !isDeclined(a)
          );
        } else if (status === 'awaiting') {
          // Email sent but not confirmed (and not declined)
          statusFilteredAssignments = statusFilteredAssignments.filter((a: SeatAssignment) => 
            a.bookingEmailSent && !a.confirmedRsvp && !isDeclined(a)
          );
        } else if (status === 'confirmed') {
          // Confirmed attendance (and not declined)
          statusFilteredAssignments = statusFilteredAssignments.filter((a: SeatAssignment) => 
            a.confirmedRsvp && !isDeclined(a)
          );
        } else if (status === 'declined') {
          // Declined (moved to reschedule)
          statusFilteredAssignments = statusFilteredAssignments.filter((a: SeatAssignment) => isDeclined(a));
        }
      }
      
      // Enrich with contestant and record day data
      const enrichedAssignments = statusFilteredAssignments.map((a: SeatAssignment) => {
        const contestant = contestants.find(c => c.id === a.contestantId);
        const recordDay = recordDays.find(rd => rd.id === a.recordDayId);
        return {
          ...a,
          contestant: contestant || null,
          recordDay: recordDay || null,
        };
      });
      
      // Sort by record day date, then block, then seat
      enrichedAssignments.sort((a: any, b: any) => {
        const dateA = a.recordDay?.date ? new Date(a.recordDay.date).getTime() : 0;
        const dateB = b.recordDay?.date ? new Date(b.recordDay.date).getTime() : 0;
        if (dateA !== dateB) return dateA - dateB;
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.seatLabel || '').localeCompare(b.seatLabel || '');
      });
      
      res.json({
        assignments: enrichedAssignments,
        stats,
      });
    } catch (error: any) {
      console.error("Error getting booking tracker data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // Paperwork Tracking Endpoints
  // ==========================================

  // Get all invited contestants for paperwork management
  // Returns contestants who have been sent a booking email (invited)
  // Can filter by status: "all", "invited" (not confirmed), "confirmed"
  app.get("/api/paperwork", requireAuth, async (req, res) => {
    try {
      const { recordDayId, status } = req.query;
      
      // Get all seat assignments
      const assignments = await storage.getAllSeatAssignments();
      const contestants = await storage.getContestants();
      const recordDays = await storage.getRecordDays();
      
      // Filter to invited contestants (those who have been sent a booking email)
      let filteredAssignments = assignments.filter((a: SeatAssignment) => a.bookingEmailSent);
      
      // Filter by status if specified
      if (status === 'confirmed') {
        // Only confirmed contestants
        filteredAssignments = filteredAssignments.filter((a: SeatAssignment) => a.confirmedRsvp);
      } else if (status === 'invited') {
        // Only invited but not yet confirmed
        filteredAssignments = filteredAssignments.filter((a: SeatAssignment) => !a.confirmedRsvp);
      }
      // If status is 'all' or not specified, return all invited contestants
      
      // Filter by record day if specified
      if (recordDayId && typeof recordDayId === 'string') {
        filteredAssignments = filteredAssignments.filter((a: SeatAssignment) => a.recordDayId === recordDayId);
      }
      
      // Enrich with contestant and record day data
      const enrichedAssignments = filteredAssignments.map((a: SeatAssignment) => {
        const contestant = contestants.find(c => c.id === a.contestantId);
        const recordDay = recordDays.find(rd => rd.id === a.recordDayId);
        return {
          ...a,
          contestant: contestant || null,
          recordDay: recordDay || null,
        };
      });
      
      res.json(enrichedAssignments);
    } catch (error: any) {
      console.error("Error getting paperwork data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark paperwork as sent
  app.post("/api/paperwork/:assignmentId/sent", requireAuth, async (req, res) => {
    try {
      const { assignmentId } = req.params;
      // Use authenticated user's username from session for audit
      // If session username not set, look up user by session userId
      let sentBy = (req.session as any)?.username;
      if (!sentBy && (req.session as any)?.userId) {
        const user = await storage.getUserById((req.session as any).userId);
        sentBy = user?.username || 'System';
      }
      sentBy = sentBy || 'System';
      
      const assignment = await storage.getSeatAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // Update the seat assignment with paperwork sent timestamp
      const now = new Date();
      await storage.updateSeatAssignmentWorkflow(assignmentId, {
        paperworkSent: now,
        paperworkSentBy: sentBy,
      });
      
      // Broadcast update via WebSocket
      wsManager.broadcastBookingUpdate({
        type: 'booking-master-update',
        recordDayId: assignment.recordDayId,
        assignmentId,
        field: 'paperworkSent',
        value: now,
      });
      
      res.json({ 
        success: true, 
        message: "Paperwork marked as sent",
        paperworkSent: now,
        paperworkSentBy: sentBy || 'Unknown',
      });
    } catch (error: any) {
      console.error("Error marking paperwork as sent:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark paperwork as received and logged
  app.post("/api/paperwork/:assignmentId/received", requireAuth, async (req, res) => {
    try {
      const { assignmentId } = req.params;
      // Use authenticated user's username from session for audit
      // If session username not set, look up user by session userId
      let receivedBy = (req.session as any)?.username;
      if (!receivedBy && (req.session as any)?.userId) {
        const user = await storage.getUserById((req.session as any).userId);
        receivedBy = user?.username || 'System';
      }
      receivedBy = receivedBy || 'System';
      
      const assignment = await storage.getSeatAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // Update the seat assignment with paperwork received timestamp
      const now = new Date();
      await storage.updateSeatAssignmentWorkflow(assignmentId, {
        paperworkReceived: now,
        paperworkReceivedBy: receivedBy,
      });
      
      // Broadcast update via WebSocket
      wsManager.broadcastBookingUpdate({
        type: 'booking-master-update',
        recordDayId: assignment.recordDayId,
        assignmentId,
        field: 'paperworkReceived',
        value: now,
      });
      
      res.json({ 
        success: true, 
        message: "Paperwork marked as received and logged",
        paperworkReceived: now,
        paperworkReceivedBy: receivedBy || 'Unknown',
      });
    } catch (error: any) {
      console.error("Error marking paperwork as received:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear paperwork sent status
  app.delete("/api/paperwork/:assignmentId/sent", requireAuth, async (req, res) => {
    try {
      const { assignmentId } = req.params;
      
      const assignment = await storage.getSeatAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      await storage.updateSeatAssignmentWorkflow(assignmentId, {
        paperworkSent: null,
        paperworkSentBy: null,
      });
      
      wsManager.broadcastBookingUpdate({
        type: 'booking-master-update',
        recordDayId: assignment.recordDayId,
        assignmentId,
        field: 'paperworkSent',
        value: null,
      });
      
      res.json({ success: true, message: "Paperwork sent status cleared" });
    } catch (error: any) {
      console.error("Error clearing paperwork sent status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear paperwork received status
  app.delete("/api/paperwork/:assignmentId/received", requireAuth, async (req, res) => {
    try {
      const { assignmentId } = req.params;
      
      const assignment = await storage.getSeatAssignmentById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      await storage.updateSeatAssignmentWorkflow(assignmentId, {
        paperworkReceived: null,
        paperworkReceivedBy: null,
      });
      
      wsManager.broadcastBookingUpdate({
        type: 'booking-master-update',
        recordDayId: assignment.recordDayId,
        assignmentId,
        field: 'paperworkReceived',
        value: null,
      });
      
      res.json({ success: true, message: "Paperwork received status cleared" });
    } catch (error: any) {
      console.error("Error clearing paperwork received status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk send paperwork emails with Adobe Sign link
  app.post("/api/paperwork/bulk-send", requireAuth, async (req, res) => {
    try {
      const { assignmentIds, adobeSignLink, subject, body } = req.body;
      
      if (!assignmentIds || !Array.isArray(assignmentIds)) {
        return res.status(400).json({ error: "Assignment IDs must be an array" });
      }
      
      if (assignmentIds.length === 0) {
        return res.status(400).json({ error: "No valid recipients provided. Please select contestants with email addresses." });
      }
      
      if (!adobeSignLink) {
        return res.status(400).json({ error: "Adobe Sign link is required" });
      }
      
      // Get user info for audit
      let sentBy = (req.session as any)?.username;
      if (!sentBy && (req.session as any)?.userId) {
        const user = await storage.getUserById((req.session as any).userId);
        sentBy = user?.username || 'System';
      }
      sentBy = sentBy || 'System';
      
      const contestants = await storage.getContestants();
      const { sendPaperworkEmail, getAdobeSignSmtpConfig } = await import("./email");
      
      // Get paperwork email template settings
      const paperworkHeadline = await storage.getSystemConfig('paperwork_email_headline') || 'Important Paperwork Required';
      const paperworkFooter = await storage.getSystemConfig('paperwork_email_footer') || 'This is an automated message from the Deal or No Deal production team.';
      
      // Get banner image configuration
      const bannerUrlConfig = await storage.getSystemConfig('booking_email_banner_url') || '/uploads/banners/dond-banner.png';
      let bannerUrl = bannerUrlConfig;
      let bannerBuffer: Buffer | null = null;
      let bannerContentType = 'image/png';
      let bannerFilename = 'dond-banner.png';
      const bannerCid = 'paperwork-banner-image';
      
      // Try to load banner from local file
      if (bannerUrlConfig.startsWith('/')) {
        const bannerPath = path.join(process.cwd(), bannerUrlConfig.replace(/^\//, ''));
        try {
          if (fs.existsSync(bannerPath)) {
            bannerBuffer = fs.readFileSync(bannerPath);
            const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
            bannerContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            bannerFilename = path.basename(bannerPath);
            bannerUrl = `cid:${bannerCid}`;
          }
        } catch (error) {
          console.warn('Warning: Could not read banner image for paperwork email:', error);
        }
      }
      
      let sent = 0;
      let failed = 0;
      const errors: string[] = [];
      
      for (const assignmentId of assignmentIds) {
        try {
          const assignment = await storage.getSeatAssignmentById(assignmentId);
          if (!assignment) {
            failed++;
            errors.push(`Assignment ${assignmentId} not found`);
            continue;
          }
          
          const contestant = contestants.find(c => c.id === assignment.contestantId);
          if (!contestant?.email) {
            failed++;
            errors.push(`No email for contestant ${contestant?.name || assignmentId}`);
            continue;
          }
          
          // Get record day info for context
          const recordDay = await storage.getRecordDay(assignment.recordDayId);
          const formattedDate = recordDay?.date 
            ? new Date(recordDay.date).toLocaleDateString('en-AU', { 
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
              })
            : 'your upcoming recording';
          
          // Replace placeholders in email body (for plain text version)
          const personalizedBody = body
            .replace(/{name}/g, contestant.name || 'Contestant')
            .replace(/{adobe_sign_link}/g, adobeSignLink);
          
          // Generate styled HTML email matching booking email format
          const firstName = (contestant.name || 'Contestant').split(' ')[0];
          const htmlBody = `<!DOCTYPE html>
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
          ${paperworkHeadline}
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
                Dear ${firstName},
              </p>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                Thank you for confirming your attendance for Deal or No Deal on <strong>${formattedDate}</strong>!
              </p>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                Before the recording, we need you to complete some important paperwork. Please click the button below to access and sign the required documents.
              </p>
              
              <!-- Important Info Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                      Please Complete Before Your Recording
                    </h2>
                    <p style="color: #444444; font-size: 15px; line-height: 1.7; margin: 0;">
                      Your paperwork must be completed and signed before you can participate in the recording. Please complete this as soon as possible.
                    </p>
                  </td>
                </tr>
              </table>
              
              <!-- Adobe Sign Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 25px auto;">
                <tr>
                  <td style="padding: 0;">
                    <a href="${adobeSignLink}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #D4AF37 0%, #B8962E 100%); color: #2a0a0a; text-decoration: none; font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 6px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">COMPLETE PAPERWORK</a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #888888; font-size: 12px; text-align: center; margin: 0 0 20px 0;">
                If the button doesn't work, copy and paste this link into your browser:<br/>
                <a href="${adobeSignLink}" style="color: #8B0000; word-break: break-all;">${adobeSignLink}</a>
              </p>
              
              <p style="color: #555555; font-size: 14px; line-height: 1.6; margin: 0;">
                If you have any questions about the paperwork, please don't hesitate to contact us.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    
    <!-- Footer -->
    <tr>
      <td style="padding: 25px 20px; text-align: center;">
        <p style="color: #D4AF37; font-size: 12px; line-height: 1.5; margin: 0;">
          ${paperworkFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
          
          // Prepare attachments with CID-embedded banner
          const attachments: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
          if (bannerBuffer) {
            attachments.push({
              filename: bannerFilename,
              content: bannerBuffer,
              contentType: bannerContentType,
              cid: bannerCid,
            });
          }
          
          // Send email with HTML styling and banner attachment
          const emailResult: { success: boolean; error?: string } = await sendPaperworkEmail(
            contestant.email,
            subject || "Deal or No Deal - Required Paperwork",
            personalizedBody,
            htmlBody,
            undefined, // config
            attachments.length > 0 ? attachments : undefined
          ).then(() => ({ success: true })).catch((err: any) => ({ success: false, error: err.message }));
          
          if (emailResult.success) {
            // Mark paperwork as sent
            const now = new Date();
            await storage.updateSeatAssignmentWorkflow(assignmentId, {
              paperworkSent: now,
              paperworkSentBy: sentBy,
            });
            
            // Broadcast update via WebSocket
            wsManager.broadcastBookingUpdate({
              type: 'booking-master-update',
              recordDayId: assignment.recordDayId,
              assignmentId,
              field: 'paperworkSent',
              value: now,
            });
            
            sent++;
          } else {
            failed++;
            errors.push(`Failed to send to ${contestant.email}: ${emailResult.error}`);
          }
        } catch (err: any) {
          failed++;
          errors.push(`Error processing ${assignmentId}: ${err.message}`);
        }
      }
      
      res.json({ 
        success: true,
        sent,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error("Error bulk sending paperwork:", error);
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
  // Email Template Preview Endpoints
  // ==========================================

  // Dynamic Booking Email Preview
  app.get("/api/email-preview/booking", async (req, res) => {
    // Allow iframe embedding from same origin
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    
    try {
      // Get saved template values with fallback defaults
      const headline = await storage.getSystemConfig('booking_email_headline') || 'Your Booking is Confirmed!';
      const intro = await storage.getSystemConfig('booking_email_intro') || 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.';
      const instructions = await storage.getSystemConfig('booking_email_instructions') || 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.';
      const additionalInstructions = await storage.getSystemConfig('booking_email_additional_instructions') || 'We will be recording multiple episodes on the day. The recording of these shows will take approximately 10 hours. Please be prepared to make yourself available for the full length of time.';
      const footer = await storage.getSystemConfig('booking_email_footer') || 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.';
      const replyToEmail = await storage.getSystemConfig('booking_reply_to_email') || 'bookings@dealornodeal.example.com';
      
      // Get record day data if provided
      const recordDayId = req.query.recordDayId as string | undefined;
      let sampleName = 'Sample Contestant';
      let sampleDate = 'Wednesday, 15 January 2026';
      let sampleRx = 'RX EP 1';
      
      if (recordDayId) {
        try {
          const recordDay = await storage.getRecordDayById(recordDayId);
          if (recordDay) {
            const date = new Date(recordDay.date);
            const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            sampleDate = date.toLocaleDateString('en-AU', options);
            sampleRx = recordDay.rxNumber || 'RX EP 1';
          }
        } catch (e) {
          // Ignore errors, use defaults
        }
      }
      
      // Build single mailto link like actual emails
      const replyMailto = `mailto:${replyToEmail}?subject=${encodeURIComponent(`BOOKING RESPONSE - ${sampleName} - ${sampleDate}`)}&body=${`Hi%20Deal%20or%20No%20Deal%20Team,%0D%0A%0D%0AName%3A%20${encodeURIComponent(sampleName)}%0D%0ADate%3A%20${encodeURIComponent(sampleDate)}%0D%0A%0D%0ACAN%20YOU%20ATTEND%3F%20%28mark%20with%20X%29%0D%0A%5B%20%5D%20YES%20-%20I%20confirm%20my%20attendance%0D%0A%5B%20%5D%20NO%20-%20I%20cannot%20attend%20%28Reason%3A%20%29%0D%0A%0D%0AGroup%20members%20attending%20%28please%20provide%20FULL%20NAMES%29%3A%0D%0A%0D%0A---%20REQUIRED%20INFORMATION%20%28if%20attending%29%20---%0D%0A%0D%0ADo%20you%20have%20any%20medical%20conditions%3F%0D%0AIf%20yes%2C%20please%20describe%3A%0D%0A%0D%0ADo%20you%20have%20any%20mobility%20requirements%3F%20%28i.e.%20issues%20climbing%20stairs%20or%20standing%20for%20extended%20periods%29%0D%0AAnswer%3A%0D%0A%0D%0AEmergency%20contact%20name%20%26%20phone%20number%3A%0D%0AAnswer%3A%0D%0A%0D%0ADietary%20requirements%20%28mark%20with%20X%29%3A%0D%0A%5B%20%5D%20Vegetarian%0D%0A%5B%20%5D%20Vegan%0D%0A%5B%20%5D%20Gluten%20Free%0D%0A%5B%20%5D%20Dairy%20Free%0D%0A%0D%0APlease%20note%20that%20all%20our%20meals%20are%20nut-free.%20If%20your%20dietary%20requirements%20fall%20outside%20the%20options%2C%20we%20won%27t%20be%20able%20to%20cater%20to%20them%2C%20so%20we%20kindly%20ask%20that%20you%20bring%20your%20own%20meals.%0D%0A%0D%0AThank%20you.`}`;
      
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation Email Preview</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <div style="text-align: center; margin-bottom: 20px;">
    <span style="background: #28a745; color: white; padding: 8px 16px; border-radius: 4px; font-size: 14px;">LIVE PREVIEW - Using Your Saved Template</span>
  </div>
  <div style="max-width: 600px; margin: 0 auto; background-color: #2a0a0a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
      
      <tr>
        <td style="padding: 0; line-height: 0; background: linear-gradient(135deg, #8B0000 0%, #5c0000 100%); text-align: center; padding: 30px;">
          <h2 style="color: #D4AF37; font-size: 28px; margin: 0; letter-spacing: 2px;">DEAL OR NO DEAL</h2>
          <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">BANNER IMAGE APPEARS HERE</p>
        </td>
      </tr>
      <tr>
        <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
          <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
            ${headline}
          </h1>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
            <tr>
              <td style="padding: 35px 30px;">
                <!-- Important Notice -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 12px 15px;">
                      <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0; line-height: 1.5;">
                        You must follow the steps below to confirm your attendance and receive tickets for yourself and the group you auditioned with.
                      </p>
                    </td>
                  </tr>
                </table>
                
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                  Hi ${sampleName},
                </p>
                
                <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  ${intro}
                </div>
                
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">
                        We look forward to seeing you on:
                      </h2>
                      <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                        <strong style="color: #8B0000;">DATE:</strong> ${sampleDate.toUpperCase()}
                      </p>
                      <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                        <strong style="color: #8B0000;">ARRIVAL TIME:</strong> 7:30AM
                      </p>
                      <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0;">
                        <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008
                      </p>
                    </td>
                  </tr>
                </table>
                
                <!-- ACTION REQUIRED Notice with Button -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #8B0000; border-radius: 8px; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 25px; text-align: center;">
                      <p style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                        CAN YOU ATTEND?
                      </p>
                      <p style="color: #ffffff; font-size: 15px; margin: 0 0 20px 0;">
                        Please respond YES or NO and confirm the members of your auditioned group who will be attending ASAP.
                      </p>
                      <a href="${replyMailto}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
                    </td>
                  </tr>
                </table>
                
                ${additionalInstructions ? `
                <div style="margin: 20px 0 25px 0; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                  <p style="color: #444444; font-size: 14px; line-height: 1.6; margin: 0;">${additionalInstructions.replace(/\n/g, '<br/>')}</p>
                </div>
                ` : ''}
                
                <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 20px 0;">
                  Please ensure you bring your own water bottle.
                </p>
                
                <p style="color: #333333; font-size: 15px; margin: 0;">
                  We look forward to seeing you on the day!<br/>
                  Kind Regards,<br/>
                  <strong>The Deal Or No Deal Team</strong>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 15px 30px 30px 30px; text-align: center;">
          <p style="color: #aa8888; font-size: 11px; line-height: 1.6; margin: 0;">
            ${footer}
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error: any) {
      console.error("Error generating booking email preview:", error);
      res.setHeader('Content-Type', 'text/html');
      res.status(500).send(`<!DOCTYPE html><html><head><title>Preview Error</title></head><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #fee2e2;"><h2 style="color: #dc2626;">Preview Error</h2><p style="color: #7f1d1d;">${error.message || 'Failed to load preview'}</p></body></html>`);
    }
  });

  // Dynamic Availability Email Preview
  app.get("/api/email-preview/availability", async (req, res) => {
    // Allow iframe embedding from same origin
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    
    try {
      // Get saved template values with fallback defaults
      const subject = await storage.getSystemConfig('availability_email_subject') || 'Deal or No Deal - Availability Check';
      const headline = await storage.getSystemConfig('availability_email_headline') || 'Availability Check';
      const intro = await storage.getSystemConfig('availability_email_intro') || "Congratulations! Following your successful audition, we'd love to invite you to be part of a Deal or No Deal recording. Please let us know your availability for our upcoming dates.";
      const instructions = await storage.getSystemConfig('availability_email_instructions') || "Please complete the form as soon as possible so we can allocate recording slots. If you have any questions, please reply to this email.";
      const footer = await storage.getSystemConfig('availability_email_footer') || 'This is an automated message from the Deal or No Deal production team. Please do not forward this email as it contains a unique response link.';
      const msFormUrl = await storage.getSystemConfig('availability_form_url') || 'https://forms.office.com/Pages/ResponsePage.aspx?id=ayXN-4f600uQrCY8eucYVbItEwiVLdlEnys-du5SGAxUMFhPMk9JTUFDUThQWDlLRllCOFhaUk5WVS4u';
      
      // Get record day data if provided
      const recordDayId = req.query.recordDayId as string | undefined;
      let sampleDate = '';
      let sampleRx = '';
      
      if (recordDayId) {
        try {
          const recordDay = await storage.getRecordDayById(recordDayId);
          if (recordDay) {
            const date = new Date(recordDay.date);
            const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            sampleDate = date.toLocaleDateString('en-AU', options);
            sampleRx = recordDay.rxNumber || '';
          }
        } catch (e) {
          // Ignore errors, use defaults
        }
      }
      
      // Sample data for preview
      const sampleName = 'Peter';
      
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Availability Email Preview</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <div style="text-align: center; margin-bottom: 20px;">
    <span style="background: #28a745; color: white; padding: 8px 16px; border-radius: 4px; font-size: 14px;">LIVE PREVIEW - Using Your Saved Template</span>
    <p style="color: #666; font-size: 12px; margin: 8px 0 0 0;">Subject: ${subject}</p>
  </div>
  <div style="max-width: 600px; margin: 0 auto; background-color: #2a0a0a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
      <tr>
        <td style="padding: 0; line-height: 0; background: linear-gradient(135deg, #8B0000 0%, #5c0000 100%); text-align: center; padding: 30px;">
          <h2 style="color: #D4AF37; font-size: 28px; margin: 0; letter-spacing: 2px;">DEAL OR NO DEAL</h2>
          <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">BANNER IMAGE APPEARS HERE</p>
        </td>
      </tr>
      <tr>
        <td style="background: linear-gradient(180deg, #4a1a1a 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
          <h1 style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
            ${headline}
          </h1>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
            <tr>
              <td style="padding: 35px 30px;">
                <!-- Yellow Warning Notice -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border-radius: 8px; border: 1px solid #ffc107; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 15px;">
                      <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0; line-height: 1.5;">
                        IMPORTANT: This is an availability check only. Please complete the form below to confirm which recording dates suit you. A booking confirmation will be sent separately.
                      </p>
                    </td>
                  </tr>
                </table>
                
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                  Hi ${sampleName},
                </p>
                
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  ${intro}
                </p>
                
                <p style="color: #444444; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
                  ${instructions}
                </p>
                
                <!-- ACTION REQUIRED Notice with Button -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fef3cd; border: 1px solid #d4a937; border-radius: 8px; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 25px; text-align: center;">
                      <p style="color: #856404; font-size: 22px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                        ARE YOU AVAILABLE?
                      </p>
                      <p style="color: #664d03; font-size: 15px; margin: 0 0 20px 0;">
                        Please click the button below to complete the availability form for you and your group.
                      </p>
                      <a href="${msFormUrl}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO RESPOND</a>
                    </td>
                  </tr>
                </table>
                
                <!-- What to Expect Box -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f5; border-radius: 8px; border: 1px solid #e0e0e0; margin: 0 0 25px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <h3 style="color: #333333; font-size: 14px; font-weight: bold; margin: 0 0 12px 0;">
                        What happens next?
                      </h3>
                      <ul style="color: #555555; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                        <li>Complete the availability form with your preferred dates</li>
                        <li>Our team will review responses and allocate recording slots</li>
                        <li>You will receive a separate booking confirmation email</li>
                        <li>Final booking details will include arrival time and location</li>
                      </ul>
                    </td>
                  </tr>
                </table>
                
                <p style="color: #333333; font-size: 15px; margin: 0 0 5px 0;">
                  We look forward to hearing from you!
                </p>
                <p style="color: #333333; font-size: 15px; margin: 0;">
                  Kind Regards,<br/>
                  <strong>The Deal Or No Deal Team</strong>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 15px 30px 30px 30px; text-align: center;">
          <p style="color: #aa8888; font-size: 11px; line-height: 1.6; margin: 0;">
            ${footer}
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error: any) {
      console.error("Error generating availability email preview:", error);
      res.setHeader('Content-Type', 'text/html');
      res.status(500).send(`<!DOCTYPE html><html><head><title>Preview Error</title></head><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #fee2e2;"><h2 style="color: #dc2626;">Preview Error</h2><p style="color: #7f1d1d;">${error.message || 'Failed to load preview'}</p></body></html>`);
    }
  });

  // Dynamic Standby Email Preview
  app.get("/api/email-preview/standby", async (req, res) => {
    // Allow iframe embedding from same origin
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    
    try {
      // Get saved template values with fallback defaults
      const headline = await storage.getSystemConfig('standby_email_headline') || "You've Been Selected to be a Standby Contestant!";
      const intro = await storage.getSystemConfig('standby_email_intro') || "We enjoyed meeting you at our auditions and would love to invite you to be a STANDBY CONTESTANT on Deal or No Deal. As a standby contestant, you may be selected to join our live studio recording of the show should any positions become available on the day.";
      const instructions = await storage.getSystemConfig('standby_email_instructions') || "If you're selected to participate in studio, you will be required for the full day.\n\nAfter being a Standby Contestant, you are eligible to be FAST-TRACKED into the next available record date to attend a full day in studio. That's double the chances! You must email dond.standby@endemolshine.com.au to be rebooked to return.\n\nPlease find attached important information relating to your attendance at the Deal or No Deal recording. Please read this attachment thoroughly and get in touch ASAP should there be any issues.\n\nYou will receive another email closer to your record date with additional paperwork.";
      const footer = await storage.getSystemConfig('standby_email_footer') || 'This is an automated message from the Deal or No Deal production team. If you have questions, please reply to this email.';
      
      // Get reply-to email
      const smtpConfig = await getSmtpConfig();
      const replyToEmail = smtpConfig.fromEmail || 'noreply@example.com';
      
      // Get record day data if provided
      const recordDayId = req.query.recordDayId as string | undefined;
      let sampleName = 'Sarah Johnson';
      let sampleDate = 'Wednesday, 15 January 2026';
      let sampleRx = 'RX01';
      
      if (recordDayId) {
        try {
          const recordDay = await storage.getRecordDayById(recordDayId);
          if (recordDay) {
            const date = new Date(recordDay.date);
            const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            sampleDate = date.toLocaleDateString('en-AU', options);
            sampleRx = recordDay.rxNumber || 'RX01';
          }
        } catch (e) {
          // Ignore errors, use defaults
        }
      }
      
      // Build mailto link
      const replyMailto = `mailto:${replyToEmail}?subject=${encodeURIComponent(`STANDBY RESPONSE - ${sampleName} - ${sampleDate}`)}&body=${`Hi%20Deal%20or%20No%20Deal%20Team,%0D%0A%0D%0AName%3A%20${encodeURIComponent(sampleName)}%0D%0ADate%3A%20${encodeURIComponent(sampleDate)}%0D%0A%0D%0ACAN%20YOU%20ATTEND%20AS%20STANDBY%3F%20%28mark%20with%20X%29%0D%0A%5B%20%5D%20YES%20-%20I%20confirm%20my%20attendance%0D%0A%5B%20%5D%20NO%20-%20I%20cannot%20attend%20%28Reason%3A%20%29%0D%0A%0D%0AGroup%20members%20attending%20%28please%20provide%20FULL%20NAMES%29%3A%0D%0A%0D%0A---%20REQUIRED%20INFORMATION%20%28if%20attending%29%20---%0D%0A%0D%0ADo%20you%20have%20any%20medical%20conditions%3F%0D%0AIf%20yes%2C%20please%20describe%3A%0D%0A%0D%0ADo%20you%20have%20any%20mobility%20requirements%3F%20%28i.e.%20issues%20climbing%20stairs%20or%20standing%20for%20extended%20periods%29%0D%0AAnswer%3A%0D%0A%0D%0AEmergency%20contact%20name%20%26%20phone%20number%3A%0D%0AAnswer%3A%0D%0A%0D%0ADietary%20requirements%20%28mark%20with%20X%29%3A%0D%0A%5B%20%5D%20Vegetarian%0D%0A%5B%20%5D%20Vegan%0D%0A%5B%20%5D%20Gluten%20Free%0D%0A%5B%20%5D%20Dairy%20Free%0D%0A%0D%0APlease%20note%20that%20all%20our%20meals%20are%20nut-free.%20If%20your%20dietary%20requirements%20fall%20outside%20the%20options%2C%20we%20won%27t%20be%20able%20to%20cater%20to%20them%2C%20so%20we%20kindly%20ask%20that%20you%20bring%20your%20own%20meals.%0D%0A%0D%0AThank%20you.`}`;
      
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Standby Email Preview</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <div style="text-align: center; margin-bottom: 20px;">
    <span style="background: #8B0000; color: white; padding: 8px 16px; border-radius: 4px; font-size: 14px;">LIVE PREVIEW - Standby Email Template</span>
  </div>
  <div style="max-width: 600px; margin: 0 auto; background-color: #2a0a0a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
      <tr>
        <td style="padding: 0; line-height: 0; background: linear-gradient(135deg, #4a1a1a 0%, #2a0a0a 100%); text-align: center; padding: 30px;">
          <h2 style="color: #D4AF37; font-size: 28px; margin: 0; letter-spacing: 2px;">DEAL OR NO DEAL</h2>
          <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">BANNER IMAGE APPEARS HERE</p>
        </td>
      </tr>
      <tr>
        <td style="background: linear-gradient(180deg, #4a1a1a 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
          <h1 style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
            ${headline}
          </h1>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
            <tr>
              <td style="padding: 35px 30px;">
                <!-- Yellow Warning Notice -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border-radius: 8px; border: 1px solid #ffc107; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 15px;">
                      <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0; line-height: 1.5;">
                        You must follow the steps below to confirm your attendance and receive tickets for yourself and the group you auditioned with.
                      </p>
                    </td>
                  </tr>
                </table>
                
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 18px 0;">
                  Hi ${sampleName.split(' ')[0]},
                </p>
                
                <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  ${intro.split('\n\n').map((paragraph: string) => 
                    `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                  ).join('')}
                </div>
                
                <!-- Booking Details Box -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase; letter-spacing: 1px;">
                        We look forward to seeing you on:
                      </h2>
                      <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                        <strong style="color: #8B0000;">DATE:</strong> ${sampleDate.toUpperCase()}
                      </p>
                      <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0 0 8px 0;">
                        <strong style="color: #8B0000;">ARRIVAL TIME:</strong> 8:00AM
                      </p>
                      <p style="color: #333333; font-size: 16px; line-height: 1.8; margin: 0;">
                        <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC, 3008
                      </p>
                    </td>
                  </tr>
                </table>
                
                <!-- ACTION REQUIRED Notice with Button -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #8B0000; border-radius: 8px; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 25px; text-align: center;">
                      <p style="color: #D4AF37; font-size: 24px; font-weight: bold; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
                        CAN YOU ATTEND?
                      </p>
                      <p style="color: #ffffff; font-size: 15px; margin: 0 0 20px 0;">
                        Please RSVP for you and your AUDITIONED group by replying to this email ASAP.
                      </p>
                      <a href="${replyMailto}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
                    </td>
                  </tr>
                </table>
                
                <div style="color: #444444; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                  ${instructions.split('\n\n').map((paragraph: string) => 
                    `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                  ).join('')}
                </div>
                
                <!-- Required Info Reminder -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f5; border-radius: 8px; border: 1px solid #e0e0e0; margin: 0 0 25px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <h3 style="color: #333333; font-size: 14px; font-weight: bold; margin: 0 0 12px 0;">
                        If you will be attending, please provide:
                      </h3>
                      <ul style="color: #555555; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                        <li>Medical conditions (if any)</li>
                        <li>Mobility requirements (e.g., issues climbing stairs or standing for a considerable amount of time)</li>
                        <li>Emergency contact name & phone number</li>
                        <li>Dietary requirements</li>
                      </ul>
                    </td>
                  </tr>
                </table>
                
                <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 20px 0;">
                  Please ensure you bring your own water bottle.
                </p>
                
                <p style="color: #333333; font-size: 15px; margin: 0;">
                  We look forward to seeing you on the day!<br/>
                  Kind Regards,<br/>
                  <strong>The Deal Or No Deal Team</strong>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 15px 30px 30px 30px; text-align: center;">
          <p style="color: #aa8888; font-size: 11px; line-height: 1.6; margin: 0;">
            ${footer}
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error: any) {
      console.error("Error generating standby email preview:", error);
      res.setHeader('Content-Type', 'text/html');
      res.status(500).send(`<!DOCTYPE html><html><head><title>Preview Error</title></head><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #fee2e2;"><h2 style="color: #dc2626;">Preview Error</h2><p style="color: #7f1d1d;">${error.message || 'Failed to load preview'}</p></body></html>`);
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
            availabilityRsvp: contestant.availabilityStatus === 'available' ? 'Yes' : contestant.availabilityStatus === 'assigned' ? 'Assigned' : contestant.availabilityStatus === 'invited' ? 'Invited' : contestant.availabilityStatus === 'confirmed' ? 'Confirmed' : 'No',
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
  // Backup / Export Routes
  // =============================================

  // Export all data as JSON backup
  app.get("/api/backup/export", async (req, res) => {
    try {
      // Gather all data from all tables
      const [
        allRecordDays,
        allContestants,
        allGroups,
        allSeatAssignments,
        allBlockTypes,
        allStandbys,
        allCanceled,
      ] = await Promise.all([
        storage.getRecordDays(),
        storage.getContestants(),
        storage.getGroups(),
        storage.getAllSeatAssignments(),
        Promise.all((await storage.getRecordDays()).map(rd => storage.getBlockTypesByRecordDay(rd.id))),
        storage.getStandbyAssignments(),
        storage.getCanceledAssignments(),
      ]);
      
      // Flatten block types
      const flatBlockTypes = allBlockTypes.flat();
      
      const backupData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        data: {
          recordDays: allRecordDays,
          contestants: allContestants,
          groups: allGroups,
          seatAssignments: allSeatAssignments,
          blockTypes: flatBlockTypes,
          standbys: allStandbys,
          canceledAssignments: allCanceled,
        },
        counts: {
          recordDays: allRecordDays.length,
          contestants: allContestants.length,
          groups: allGroups.length,
          seatAssignments: allSeatAssignments.length,
          blockTypes: flatBlockTypes.length,
          standbys: allStandbys.length,
          canceledAssignments: allCanceled.length,
        },
      };
      
      // Set headers for file download
      const filename = `backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(backupData);
    } catch (error: any) {
      console.error("Error exporting backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get backup summary (counts only, for display)
  app.get("/api/backup/summary", async (req, res) => {
    try {
      const [
        allRecordDays,
        allContestants,
        allGroups,
        allSeatAssignments,
        allStandbys,
        allCanceled,
      ] = await Promise.all([
        storage.getRecordDays(),
        storage.getContestants(),
        storage.getGroups(),
        storage.getAllSeatAssignments(),
        storage.getStandbyAssignments(),
        storage.getCanceledAssignments(),
      ]);
      
      res.json({
        recordDays: allRecordDays.length,
        contestants: allContestants.length,
        groups: allGroups.length,
        seatAssignments: allSeatAssignments.length,
        standbys: allStandbys.length,
        canceledAssignments: allCanceled.length,
        lastBackup: null, // Could store this in system config if needed
      });
    } catch (error: any) {
      console.error("Error getting backup summary:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get automatic backup status
  app.get("/api/backup/status", async (req, res) => {
    try {
      const { getBackupStatus, getBackupFileInfo } = await import('./backup-scheduler');
      const status = getBackupStatus();
      const fileInfo = getBackupFileInfo();
      res.json({ ...status, fileInfo });
    } catch (error: any) {
      console.error("Error getting backup status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger manual backup (overwrites automatic backup file)
  app.post("/api/backup/manual", async (req, res) => {
    try {
      const { performBackup } = await import('./backup-scheduler');
      const result = await performBackup();
      if (result.success) {
        res.json({ success: true, message: result.message, path: result.path });
      } else {
        res.status(500).json({ success: false, error: result.message });
      }
    } catch (error: any) {
      console.error("Error performing manual backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Download the automatic backup file
  app.get("/api/backup/download", async (req, res) => {
    try {
      const { readBackupFile, getBackupFileInfo } = await import('./backup-scheduler');
      const fileInfo = getBackupFileInfo();
      
      if (!fileInfo.exists) {
        return res.status(404).json({ error: "No backup file exists. Run a manual backup first." });
      }
      
      const content = readBackupFile();
      if (!content) {
        return res.status(500).json({ error: "Failed to read backup file" });
      }
      
      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="contestant-backup-${timestamp}.json"`);
      res.send(content);
    } catch (error: any) {
      console.error("Error downloading backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Download the Excel backup file
  app.get("/api/backup/download-excel", async (req, res) => {
    try {
      const { getExcelBackupPath, excelBackupExists } = await import('./backup-scheduler');
      
      if (!excelBackupExists()) {
        return res.status(404).json({ error: "No Excel backup file exists. Run a manual backup first." });
      }
      
      const filePath = getExcelBackupPath();
      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="contestant-backup-${timestamp}.xlsx"`);
      res.sendFile(path.resolve(filePath));
    } catch (error: any) {
      console.error("Error downloading Excel backup:", error);
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

  // =============================================
  // Attendance Issues (No-Shows and Early Leavers)
  // =============================================

  // Get all attendance issues
  app.get("/api/attendance-issues", async (req, res) => {
    try {
      const issues = await storage.getAttendanceIssues();
      res.json(issues);
    } catch (error: any) {
      console.error("Error fetching attendance issues:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get attendance issues for a specific record day
  app.get("/api/attendance-issues/record-day/:recordDayId", async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const issues = await storage.getAttendanceIssuesByRecordDay(recordDayId);
      res.json(issues);
    } catch (error: any) {
      console.error("Error fetching attendance issues for record day:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark a contestant as no-show or early leaver
  app.post("/api/attendance-issues", async (req, res) => {
    try {
      const { contestantId, recordDayId, blockNumber, seatLabel, issueType, notes, markedBy } = req.body;
      
      if (!contestantId || !recordDayId || !blockNumber || !seatLabel || !issueType) {
        return res.status(400).json({ error: "Missing required fields: contestantId, recordDayId, blockNumber, seatLabel, issueType" });
      }
      
      if (!['no_show', 'early_leaver'].includes(issueType)) {
        return res.status(400).json({ error: "issueType must be 'no_show' or 'early_leaver'" });
      }
      
      const issue = await storage.createAttendanceIssue({
        contestantId,
        recordDayId,
        blockNumber,
        seatLabel,
        issueType,
        notes,
        markedBy,
      });
      
      // Broadcast the change for real-time updates
      wsManager.broadcast({
        type: 'attendance-issue',
        recordDayId,
        issueType,
        contestantId,
      });
      
      res.json(issue);
    } catch (error: any) {
      console.error("Error creating attendance issue:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete/undo an attendance issue
  app.delete("/api/attendance-issues/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteAttendanceIssue(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting attendance issue:", error);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  
  // Initialize WebSocket server for real-time updates
  wsManager.initialize(httpServer);
  
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
