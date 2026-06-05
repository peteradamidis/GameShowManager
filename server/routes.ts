import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, db, runWithWorkspace, pool, workspaceStorage } from "./storage";
import { 
  insertContestantSchema, 
  insertRecordDaySchema, 
  insertSeatAssignmentSchema, 
  seatAssignments, 
  SeatAssignment,
  RecordDay,
  contestants,
  groups,
  standbyAssignments,
  standbyConfirmationTokens,
  canceledAssignments,
  contestantAvailability,
  availabilityTokens,
  bookingConfirmationTokens,
  postRecordTracking,
  insertPostRecordTrackingSchema,
  prizeWinners as prizeWinnersTable,
  castingCardVersions as castingCardVersionsTable,
  systemConfig as systemConfigTable,
  noticeboardComments as noticeboardCommentsTable,
  systemSettings as systemSettingsTable,
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
import sharp from "sharp";
import { parsePptxFile, matchContestantByName, ExtractedCard } from "./pptx-parser";

// Google Sheets config keys for database storage
const SHEETS_SPREADSHEET_ID_KEY = 'google_sheets_spreadsheet_id';
const SHEETS_LAST_SYNC_KEY = 'google_sheets_last_sync';
const SHEETS_AUTO_SYNC_KEY = 'google_sheets_auto_sync';

// Helper function to append bypass parameters to URLs (deprecated, kept for compatibility)
function appendNgrokSkip(url: string): string {
  return url;
}

// Helper function to convert markdown-style links [text](url) to HTML <a> tags
// Also handles plain URLs and makes them clickable
function convertLinksToHtml(text: string): string {
  // First, convert markdown-style links: [link text](url)
  let result = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #0055A4; text-decoration: underline;">$1</a>');
  
  // Then, convert standalone URLs that aren't already in href attributes
  // Match URLs that start with http:// or https:// and aren't preceded by href=" or >
  result = result.replace(/(?<!href="|>)(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color: #0055A4; text-decoration: underline;">$1</a>');
  
  return result;
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

// PPTX upload configuration with size limit and file type validation
const pptxUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB limit for PowerPoint files (can contain many photos)
  fileFilter: (req, file, cb) => {
    const validMimeTypes = [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/pptx'
    ];
    if (validMimeTypes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.pptx')) {
      cb(null, true);
    } else {
      cb(new Error('Only PowerPoint (.pptx) files are allowed'));
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

// Casting card PDF upload configuration - store on disk
const castingCardStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), 'uploads', 'casting-cards');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `casting-card-${uniqueSuffix}.pdf`);
  }
});

const castingCardUpload = multer({
  storage: castingCardStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for casting card PDFs
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed for casting cards'));
    }
  }
});

// Helper to normalize a name for matching
function normalizeNameForMatching(name: string): string {
  return name.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// Check if contestant A's attendingWith mentions contestant B's name
function mentionsName(contestantAttendingWith: string | null, targetName: string): boolean {
  if (!contestantAttendingWith || !targetName) return false;
  
  const attendingWith = contestantAttendingWith.toLowerCase();
  const normalizedTarget = normalizeNameForMatching(targetName);
  const targetParts = normalizedTarget.split(' ').filter(p => p.length > 2);
  
  // Check if any significant part of target name is mentioned
  // Require at least first name OR last name match (not just any 3-char substring)
  return targetParts.some(part => {
    // Ensure it's a word boundary match, not substring
    const regex = new RegExp(`\\b${part}\\b`, 'i');
    return regex.test(attendingWith);
  });
}

// Check for reciprocal mention - A mentions B AND B mentions A
function hasReciprocalMention(contestantA: any, contestantB: any): boolean {
  const aMentionsB = mentionsName(contestantA.attendingWith, contestantB.name);
  const bMentionsA = mentionsName(contestantB.attendingWith, contestantA.name);
  return aMentionsB && bMentionsA;
}

// Score disambiguation factors (used only when multiple candidates have same name)
function getDisambiguationScore(candidate: any, sourceContestant: any): number {
  let score = 0;
  
  // PHONE PREFIX MATCH - Same household indicator (+30 points)
  if (sourceContestant.phone && candidate.phone) {
    const sourcePhone = sourceContestant.phone.replace(/\D/g, '');
    const candidatePhone = candidate.phone.replace(/\D/g, '');
    if (sourcePhone.length >= 6 && candidatePhone.length >= 6) {
      if (sourcePhone.substring(0, 6) === candidatePhone.substring(0, 6)) {
        score += 30;
      }
    }
  }
  
  // LOCATION MATCH - Same suburb strongly suggests correct match (+25 points)
  if (sourceContestant.suburb && candidate.suburb) {
    if (sourceContestant.suburb.toLowerCase().trim() === candidate.suburb.toLowerCase().trim()) {
      score += 25;
    }
  }
  
  // Same state is weaker (+5 points)
  if (sourceContestant.state && candidate.state) {
    if (sourceContestant.state.toLowerCase().trim() === candidate.state.toLowerCase().trim()) {
      score += 5;
    }
  }
  
  // AGE PROXIMITY - Family members typically have related ages (+10-15 points)
  if (sourceContestant.age && candidate.age) {
    const ageDiff = Math.abs(sourceContestant.age - candidate.age);
    if (ageDiff <= 5) {
      score += 15; // Very close ages (siblings, partners, friends)
    } else if (ageDiff >= 15 && ageDiff <= 35) {
      score += 10; // Parent-child typical range
    }
  }
  
  return score;
}

// Helper function to identify groups from "Attending With" column
// Uses RECIPROCAL MENTIONS as the primary grouping signal
// Falls back to disambiguation scoring when there are duplicate names
function identifyGroups(contestants: any[]): Map<string, string[]> {
  const groupMap = new Map<string, string[]>();
  const contestantIdToGroup = new Map<number, string>();
  const ambiguousMatches: { source: string; targetName: string; candidates: string[]; reason: string }[] = [];
  
  // Create lookup: normalized name -> all contestants with that name
  const normalizedNameToContestants = new Map<string, any[]>();
  contestants.forEach((c) => {
    const normalized = normalizeNameForMatching(c.name);
    if (!normalizedNameToContestants.has(normalized)) {
      normalizedNameToContestants.set(normalized, []);
    }
    normalizedNameToContestants.get(normalized)!.push(c);
  });
  
  // Create lookup by ID for fast access
  const contestantById = new Map<number, any>();
  contestants.forEach(c => contestantById.set(c.id, c));

  // Phase 1: Build confirmed groups using RECIPROCAL MENTIONS only
  // This is the most reliable signal - both parties list each other
  contestants.forEach((contestant) => {
    if (!contestant.attendingWith) return;
    
    // Parse attending with names (skip solo indicators)
    const attendingWithNames = contestant.attendingWith
      .split(/[,&/\n]+/)
      .map((name: string) => name.trim())
      .filter((name: string) => name.length > 0 && 
        !['na', 'n/a', 'none', 'solo', 'alone', '-', '', 'myself', 'me', 'just me'].includes(name.toLowerCase()));

    if (attendingWithNames.length === 0) return;

    const confirmedGroupMembers = new Set<number>([contestant.id]);
    
    attendingWithNames.forEach((targetName: string) => {
      const normalizedTarget = normalizeNameForMatching(targetName);
      
      // Find candidates with matching name
      let candidates = normalizedNameToContestants.get(normalizedTarget) || [];
      candidates = candidates.filter(c => c.id !== contestant.id);
      
      if (candidates.length === 0) {
        // No exact match - try matching first name + last name separately
        // STRICTER MATCHING: Require BOTH first AND last name to match when target has both
        // This prevents "Gianni" matching both "Gianni De Pasquale" AND "Gianni Pitruzzello"
        const targetParts = normalizedTarget.split(' ').filter(p => p.length >= 3);
        
        if (targetParts.length >= 2) {
          // Target has first AND last name - require BOTH to match
          // e.g., "Carmela De Pasquale" should only match contestants with BOTH "Carmela" and some form of surname
          normalizedNameToContestants.forEach((contestantList, normalizedName) => {
            const nameParts = normalizedName.split(' ').filter(p => p.length >= 3);
            // Count how many target parts match the candidate's name parts
            const matchCount = targetParts.filter(tp => nameParts.includes(tp)).length;
            // Require at least 2 matches (first + last name) to reduce false positives
            if (matchCount >= 2) {
              contestantList.forEach(c => {
                if (c.id !== contestant.id && !candidates.some(existing => existing.id === c.id)) {
                  candidates.push(c);
                }
              });
            }
          });
        } else if (targetParts.length === 1 && targetParts[0].length >= 6) {
          // Only first name provided (e.g., "Gianni") - this is RISKY for common names
          // Only add candidates if there's exactly ONE person with that first name
          // This prevents ambiguous first-name-only matches
          const potentialMatches: any[] = [];
          normalizedNameToContestants.forEach((contestantList, normalizedName) => {
            const nameParts = normalizedName.split(' ').filter(p => p.length >= 3);
            if (nameParts.includes(targetParts[0])) {
              contestantList.forEach(c => {
                if (c.id !== contestant.id) {
                  potentialMatches.push(c);
                }
              });
            }
          });
          
          // Only use first-name-only matching if there's exactly 1 candidate
          // If there are multiple "Gianni"s, require manual disambiguation
          if (potentialMatches.length === 1) {
            candidates.push(potentialMatches[0]);
          } else if (potentialMatches.length > 1) {
            // Log ambiguity - don't auto-link with first-name-only when ambiguous
            ambiguousMatches.push({
              source: contestant.name,
              targetName,
              candidates: potentialMatches.map(c => `${c.name} (id:${c.id})`),
              reason: `First-name-only match "${targetParts[0]}" is ambiguous - ${potentialMatches.length} people share this first name`
            });
          }
        }
        // If targetParts is empty or single short word, don't attempt partial matching
      }
      
      if (candidates.length === 0) return;
      
      if (candidates.length === 1) {
        // Single candidate - check for reciprocal mention first (most reliable)
        const candidate = candidates[0];
        if (hasReciprocalMention(contestant, candidate)) {
          // Confirmed match - both parties list each other
          confirmedGroupMembers.add(candidate.id);
        } else {
          // One-way mention - need additional evidence to confirm
          // Check disambiguation score for supporting signals (phone, location, age)
          const score = getDisambiguationScore(candidate, contestant);
          
          // Require at least SOME supporting evidence for single-candidate one-way matches
          // Phone prefix (30 pts) or suburb match (25 pts) are strong indicators
          if (score >= 25) {
            // Strong supporting evidence (same household phone prefix, or same suburb)
            confirmedGroupMembers.add(candidate.id);
          } else if (score >= 10) {
            // Moderate evidence (same state + age proximity) - log for manual review
            ambiguousMatches.push({
              source: contestant.name,
              targetName,
              candidates: [`${candidate.name} (id:${candidate.id}, score:${score})`],
              reason: 'One-way mention with moderate disambiguation score - needs manual confirmation'
            });
          } else {
            // No supporting evidence - flag for manual review, don't auto-link
            ambiguousMatches.push({
              source: contestant.name,
              targetName,
              candidates: [`${candidate.name} (id:${candidate.id}, score:${score})`],
              reason: 'One-way mention only - no reciprocal mention or supporting signals'
            });
          }
        }
      } else {
        // Multiple candidates with same/similar name - need disambiguation
        // First, check for reciprocal mentions (strongest signal)
        const reciprocalMatches = candidates.filter(c => hasReciprocalMention(contestant, c));
        
        if (reciprocalMatches.length === 1) {
          // Exactly one has reciprocal mention - use that one
          confirmedGroupMembers.add(reciprocalMatches[0].id);
        } else if (reciprocalMatches.length > 1) {
          // Multiple reciprocal matches (rare edge case) - use disambiguation score
          const scored = reciprocalMatches.map(c => ({
            contestant: c,
            score: getDisambiguationScore(c, contestant)
          })).sort((a, b) => b.score - a.score);
          
          if (scored[0].score > scored[1].score) {
            confirmedGroupMembers.add(scored[0].contestant.id);
          } else {
            // Can't disambiguate - flag for manual review, don't auto-link
            ambiguousMatches.push({
              source: contestant.name,
              targetName,
              candidates: scored.map(s => `${s.contestant.name} (id:${s.contestant.id}, score:${s.score})`),
              reason: 'Multiple reciprocal matches with same score'
            });
          }
        } else {
          // No reciprocal mentions - use disambiguation scoring only if confident
          const scored = candidates.map(c => ({
            contestant: c,
            score: getDisambiguationScore(c, contestant)
          })).sort((a, b) => b.score - a.score);
          
          const topScore = scored[0].score;
          const secondScore = scored.length > 1 ? scored[1].score : 0;
          
          // Require significant score difference (25+ points lead) for auto-linking without reciprocal
          if (topScore >= 25 && topScore > secondScore + 20) {
            confirmedGroupMembers.add(scored[0].contestant.id);
          } else {
            // Not confident enough - flag for manual review, DON'T auto-link
            ambiguousMatches.push({
              source: contestant.name,
              targetName,
              candidates: scored.slice(0, 3).map(s => `${s.contestant.name} (id:${s.contestant.id}, score:${s.score})`),
              reason: 'No reciprocal mention and scores too close'
            });
            // Skip adding to group - let manual linking handle it
          }
        }
      }
    });

    // Assign group if we have confirmed members
    if (confirmedGroupMembers.size > 1) {
      // Check if any member already has a group
      let existingGroupId: string | null = null;
      for (const memberId of Array.from(confirmedGroupMembers)) {
        if (contestantIdToGroup.has(memberId)) {
          existingGroupId = contestantIdToGroup.get(memberId)!;
          break;
        }
      }

      const groupId = existingGroupId || `GROUP-${Math.random().toString(36).substr(2, 9)}`;
      
      Array.from(confirmedGroupMembers).forEach((memberId) => {
        contestantIdToGroup.set(memberId, groupId);
        if (!groupMap.has(groupId)) {
          groupMap.set(groupId, []);
        }
        const memberContestant = contestantById.get(memberId);
        if (memberContestant && !groupMap.get(groupId)!.includes(memberContestant.name)) {
          groupMap.get(groupId)!.push(memberContestant.name);
        }
      });
    }
  });

  // Log ambiguous matches that need manual review
  if (ambiguousMatches.length > 0) {
    console.log(`[Group Linking] ${ambiguousMatches.length} ambiguous name matches need manual review:`);
    ambiguousMatches.forEach(match => {
      console.log(`  - "${match.source}" mentioned "${match.targetName}"`);
      console.log(`    Candidates: ${match.candidates.join(' | ')}`);
      console.log(`    Reason: ${match.reason}`);
    });
    console.log('  Use manual group linking on the Contestants page to resolve these.');
  }

  return groupMap;
}

// CELEB workspace uses weekday-specific arrival/finish times in contestant-facing
// emails: Tuesday and Thursday record days have different call times. All other
// workspaces (and any other weekday) fall back to the standard arrival time.
// The weekday is derived the same way as the displayed "DATE:" line (no timeZone
// option) so the time always matches the weekday shown in the email.
function getArrivalTimeText(
  rawDate: string | Date | null | undefined,
  fallback: string,
  opts?: { ifCalled?: boolean },
): string {
  const workspace = workspaceStorage.getStore() || 'dond';
  if (workspace === 'celeb' && rawDate) {
    const weekday = new Date(rawDate).toLocaleDateString('en-AU', { weekday: 'long' });
    const suffix = opts?.ifCalled ? ' (if called)' : '';
    if (weekday === 'Tuesday') return `7:45AM - 5:00PM${suffix}`;
    if (weekday === 'Thursday') return `8:30AM - 5:45PM${suffix}`;
  }
  return fallback;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Middleware to handle ngrok skip browser warning via query parameter
  // This ensures that even if the header isn't sent by the browser, 
  // we handle the bypass logic server-side.
  app.use((req, res, next) => {
    next();
  });

  // Serve uploaded photos as static files with proper headers for remote access
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
    maxAge: '1d', // Cache for 1 day
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      // Set proper content type for images and PDFs
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
      };
      if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
      }
      // Allow cross-origin access
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }));

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

      // Set session and explicitly save before responding to avoid race condition
      // where the browser's next request arrives before the async DB write completes
      req.session.userId = user.id;
      req.session.username = user.username;

      req.session.save((err) => {
        if (err) {
          console.error("Session save error on login:", err);
          return res.status(500).json({ error: "Login failed - could not persist session" });
        }
        res.json({ 
          success: true, 
          user: { id: user.id, username: user.username } 
        });
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

  // ── WORKSPACE ROUTES ──────────────────────────────────────────────────────
  // Get the currently active workspace for this session
  app.get("/api/workspace", (req: any, res) => {
    res.json({ workspace: req.session?.activeWorkspace || 'dond' });
  });

  // Switch the active workspace — resets nothing, just changes the DB schema lens
  app.post("/api/workspace/switch", requireAuth, (req: any, res) => {
    const { workspace } = req.body;
    if (!['dond', 'celeb'].includes(workspace)) {
      return res.status(400).json({ error: 'Invalid workspace. Must be "dond" or "celeb".' });
    }
    req.session.activeWorkspace = workspace;
    req.session.save((err: any) => {
      if (err) return res.status(500).json({ error: 'Failed to save session' });
      res.json({ workspace });
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

  // Get all users (admin only)
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      // Don't send passwords to client
      const safeUsers = allUsers.map(u => ({ id: u.id, username: u.username }));
      res.json(safeUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Create new user (admin only)
  app.post("/api/users", requireAuth, async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      if (username.length < 3) {
        return res.status(400).json({ error: "Username must be at least 3 characters" });
      }

      if (password.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters" });
      }

      // Check if username already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Hash password
      const hashedPassword = await hashPassword(password);
      
      const newUser = await storage.createUser({
        username,
        password: hashedPassword,
      });

      res.json({ id: newUser.id, username: newUser.username });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get all users to check count
      const allUsers = await storage.getAllUsers();
      
      if (allUsers.length <= 1) {
        return res.status(400).json({ error: "Cannot delete the last user" });
      }

      // Prevent deleting your own account
      if (id === req.session.userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      await storage.deleteUser(id);
      res.json({ success: true, message: "User deleted" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
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

      // Process and sharpen the uploaded image
      const originalPath = req.file.path;
      const processedFilename = `processed-${req.file.filename}`;
      const processedPath = path.join(path.dirname(originalPath), processedFilename);
      
      try {
        // Apply strong sharpening to improve clarity for casting cards
        // sigma: 1.0-2.0 controls radius, higher = more aggressive
        // flat: reduces noise sharpening, thresholds: minimum difference for edge detection
        await sharp(originalPath)
          .sharpen({
            sigma: 1.5,  // Strong sharpening radius
            m1: 1.5,     // Flat area sharpening (more aggressive)
            m2: 1.0,     // Jagged area sharpening
            x1: 2,       // Threshold flat/jagged
            y2: 10,      // Maximum darkening
            y3: 20,      // Maximum brightening
          })
          .modulate({
            brightness: 1.02, // Slight brightness boost
            saturation: 1.05, // Slight saturation boost for vibrancy
          })
          .jpeg({ quality: 95 }) // High quality output
          .toFile(processedPath);
        
        // Remove original and rename processed file
        fs.unlinkSync(originalPath);
        const finalPath = originalPath; // Use original filename
        fs.renameSync(processedPath, finalPath);
        
        console.log(`Photo sharpened and processed for contestant ${id}`);
      } catch (sharpError) {
        console.error("Sharp processing error, using original:", sharpError);
        // If sharp fails, just use the original unprocessed image
      }

      const photoUrl = `/uploads/photos/${req.file.filename}`;
      
      // Update contestant with photo URL
      const updated = await storage.updateContestantPhoto(id, photoUrl);

      res.json({ photoUrl, message: "Photo uploaded and sharpened successfully" });
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

  // Upload casting card PDF for a seat assignment (player)
  app.post("/api/seat-assignments/:id/casting-card", (req, res, next) => {
    castingCardUpload.single("castingCard")(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: "File too large. Maximum size is 10MB." });
        }
        if (err.message?.includes('Only PDF files are allowed')) {
          return res.status(400).json({ error: "Only PDF files are allowed for casting cards." });
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
        return res.status(400).json({ error: "No casting card file uploaded" });
      }

      // Get existing assignment
      const assignments = await storage.getAllSeatAssignments();
      const existingAssignment = assignments.find((a: any) => a.id === id);
      
      if (!existingAssignment) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: "Seat assignment not found" });
      }

      // Delete old casting card if it exists
      if (existingAssignment.castingCardUrl) {
        const oldFilePath = path.join(process.cwd(), existingAssignment.castingCardUrl.replace(/^\//, ''));
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      const castingCardUrl = `/uploads/casting-cards/${req.file.filename}`;
      
      // Update assignment with casting card URL
      await storage.updateSeatAssignmentCastingCard(id, castingCardUrl);

      res.json({ castingCardUrl, message: "Casting card uploaded successfully" });
    } catch (error) {
      console.error("Casting card upload error:", error);
      res.status(500).json({ error: "Failed to upload casting card" });
    }
  });

  // Delete casting card for a seat assignment
  app.delete("/api/seat-assignments/:id/casting-card", async (req, res) => {
    try {
      const { id } = req.params;
      
      const assignments = await storage.getAllSeatAssignments();
      const assignment = assignments.find((a: any) => a.id === id);
      
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }

      // Delete the file if it exists
      if (assignment.castingCardUrl) {
        const filePath = path.join(process.cwd(), assignment.castingCardUrl.replace(/^\//, ''));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Clear casting card URL in database
      await storage.updateSeatAssignmentCastingCard(id, null);
      
      res.json({ message: "Casting card deleted successfully" });
    } catch (error) {
      console.error("Casting card delete error:", error);
      res.status(500).json({ error: "Failed to delete casting card" });
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

            // Save new photo with sharpening
            const filename = `contestant-gallery-${entry.matchedContestant.id}-${Date.now()}.jpg`;
            const filePath = path.join(uploadPath, filename);
            
            try {
              // Apply strong sharpening to improve clarity for casting cards
              await sharp(entry.imageData)
                .sharpen({
                  sigma: 1.5,  // Strong sharpening radius
                  m1: 1.5,     // Flat area sharpening (more aggressive)
                  m2: 1.0,     // Jagged area sharpening
                  x1: 2,       // Threshold flat/jagged
                  y2: 10,      // Maximum darkening
                  y3: 20,      // Maximum brightening
                })
                .modulate({
                  brightness: 1.02, // Slight brightness boost
                  saturation: 1.05, // Slight saturation boost for vibrancy
                })
                .jpeg({ quality: 95 }) // High quality output
                .toFile(filePath);
              
              console.log(`[Gallery Import] Photo sharpened for ${entry.matchedContestant.name}`);
            } catch (sharpError) {
              console.error(`[Gallery Import] Sharp processing error, saving original:`, sharpError);
              // If sharp fails, save the original unprocessed image
              fs.writeFileSync(filePath, entry.imageData);
            }

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

  // Preview import - check for duplicates before actually importing
  app.post("/api/contestants/import-preview", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let rawData: any[];
      
      try {
        const workbook = xlsx.read(req.file.buffer, { 
          type: "buffer",
          cellFormula: false,
          cellStyles: false 
        });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        const allRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[];
        
        if (!allRows || allRows.length === 0) {
          return res.status(400).json({ error: "The uploaded file is empty or has no data rows." });
        }
        
        let headerRowIndex = 0;
        for (let i = 0; i < allRows.length; i++) {
          const row = allRows[i] as any[];
          const hasContent = row.some(cell => cell && cell.toString().trim() !== "");
          if (hasContent) {
            headerRowIndex = i;
            break;
          }
        }
        
        const headers = (allRows[headerRowIndex] as any[])
          .map((h: any) => h ? h.toString().trim() : "")
          .filter(h => h !== "");
        
        const dataRows = allRows.slice(headerRowIndex + 1);
        
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

      // Extract basic info from each row for duplicate checking
      const importedContestants = rawData.map((row: any) => {
        const nameValue = row.NAME || row.Name || row.name || row["Full Name"] || row["FULL NAME"] || null;
        if (!nameValue || nameValue.toString().trim() === '') return null;
        
        const emailValue = row.EMAIL || row.Email || row.email || row["E-mail"] || row["E-MAIL"] || 
                 row["Email Address"] || row["EMAIL ADDRESS"] || null;
        
        const rawPhone = row.PHONE || row.Phone || row.phone || 
               row.MOBILE || row.Mobile || row.mobile ||
               row["Phone Number"] || row["PHONE NUMBER"] ||
               row["Mobile Number"] || row["MOBILE NUMBER"] ||
               row["Contact"] || row["CONTACT"] || null;
        const phoneValue = rawPhone ? (rawPhone.toString().trim().startsWith('4') ? '0' + rawPhone.toString().trim() : rawPhone.toString().trim()) : null;
        
        return {
          name: nameValue.toString().trim(),
          email: emailValue ? emailValue.toString().trim().toLowerCase() : null,
          phone: phoneValue,
        };
      }).filter((row): row is NonNullable<typeof row> => row !== null);

      // Get existing contestants
      const existingContestants = await storage.getContestants();
      
      // Normalize function for phone comparison
      const normalizePhone = (phone: string | null): string | null => {
        if (!phone) return null;
        // Remove all non-digits
        return phone.replace(/\D/g, '');
      };
      
      // Build lookup maps for existing contestants
      const existingByName = new Map<string, any>();
      const existingByEmail = new Map<string, any>();
      const existingByPhone = new Map<string, any>();
      
      existingContestants.forEach((c: any) => {
        if (c.name) {
          const nameKey = c.name.toLowerCase().trim();
          // ALWAYS prefer non-temporary contestants in the map if there's a conflict
          if (!existingByName.has(nameKey) || !c.isTemporary) {
            existingByName.set(nameKey, c);
          }
        }
        if (c.email) {
          const emailKey = c.email.toLowerCase().trim();
          if (!existingByEmail.has(emailKey) || !c.isTemporary) {
            existingByEmail.set(emailKey, c);
          }
        }
        const normalizedPhone = normalizePhone(c.phone);
        if (normalizedPhone && normalizedPhone.length >= 8) {
          if (!existingByPhone.has(normalizedPhone) || !c.isTemporary) {
            existingByPhone.set(normalizedPhone, c);
          }
        }
      });

      // Check for duplicates
      interface DuplicateInfo {
        importName: string;
        importEmail: string | null;
        importPhone: string | null;
        matchType: 'exact_name' | 'email' | 'phone';
        existingContestant: {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          isTemporary: boolean;
        };
      }
      
      const duplicates: DuplicateInfo[] = [];
      const uniqueContestants: typeof importedContestants = [];
      const temporaryContestantsToUpdate: Array<{ existingId: string; importName: string }> = [];
      const seenInImport = new Set<string>();
      
      for (const contestant of importedContestants) {
        const normalizedName = contestant.name.toLowerCase().trim();
        const normalizedPhone = normalizePhone(contestant.phone);
        
        // Check for match with existing contestant
        const nameMatch = existingByName.get(normalizedName);
        const emailMatch = contestant.email ? existingByEmail.get(contestant.email) : null;
        const phoneMatch = normalizedPhone ? existingByPhone.get(normalizedPhone) : null;

        // Phone matches alone are NOT duplicates if name and email are different
        // (people can share phone numbers, e.g., family members)
        let match = nameMatch || emailMatch;
        
        // Only consider phone match a duplicate if name OR email also matches the phone match record
        if (!match && phoneMatch) {
          const phoneMatchName = phoneMatch.name.toLowerCase().trim();
          const phoneMatchEmail = phoneMatch.email?.toLowerCase().trim();
          const importEmail = contestant.email?.toLowerCase().trim();
          
          // Check if this is truly the same person (name or email matches too)
          if (phoneMatchName === normalizedName || (importEmail && phoneMatchEmail === importEmail)) {
            match = phoneMatch;
          } else {
            // Different name AND different email - this is a shared phone, not a duplicate
            console.log(`[Import Preview] Phone match for ${contestant.name} but different name/email - allowing as separate person (shared phone)`);
          }
        }
        
        if (match) {
          // If the existing contestant is temporary, allow import to update them
          if (match.isTemporary) {
            console.log(`[Import Preview] Found temporary match for ${contestant.name} (ID: ${match.id}). Redirecting to temporaryUpdates.`);
            temporaryContestantsToUpdate.push({ existingId: match.id.toString(), importName: contestant.name });
            continue;
          }
          
          console.log(`[Import Preview] Found REAL duplicate for ${contestant.name} (ID: ${match.id})`);
          duplicates.push({
            importName: contestant.name,
            importEmail: contestant.email,
            importPhone: contestant.phone,
            matchType: nameMatch ? 'exact_name' : (emailMatch ? 'email' : 'phone'),
            existingContestant: {
              id: match.id.toString(),
              name: match.name,
              email: match.email,
              phone: match.phone,
              isTemporary: !!match.isTemporary
            }
          });
          continue;
        }
        
        // Check for duplicates within the import file itself
        if (seenInImport.has(normalizedName)) {
          continue; // Skip duplicate within same file
        }
        seenInImport.add(normalizedName);
        
        uniqueContestants.push(contestant);
      }

      res.json({
        totalInFile: importedContestants.length,
        uniqueCount: uniqueContestants.length,
        duplicateCount: duplicates.length,
        duplicates: duplicates,
        temporaryUpdatesCount: temporaryContestantsToUpdate.length,
        temporaryUpdates: temporaryContestantsToUpdate,
      });
    } catch (error: any) {
      console.error("Import preview error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import contestants from Excel
  app.post("/api/contestants/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log(`[Import] Starting import for file: ${req.file.originalname}`);

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
          phone: (() => {
            const rawPhone = row.PHONE || row.Phone || row.phone || 
                   row.MOBILE || row.Mobile || row.mobile ||
                   row["Phone Number"] || row["PHONE NUMBER"] ||
                   row["Mobile Number"] || row["MOBILE NUMBER"] ||
                   row["Contact"] || row["CONTACT"] || null;
            if (!rawPhone) return null;
            // Normalize phone number: add leading 0 if starts with 4 (Australian mobile)
            const phoneStr = rawPhone.toString().trim();
            return phoneStr.startsWith('4') ? '0' + phoneStr : phoneStr;
          })(),
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
      
      // Normalize phone function - remove all non-digits
      const normalizePhone = (phone: string | null | undefined): string | null => {
        if (!phone) return null;
        const normalized = phone.toString().replace(/\D/g, '');
        return normalized.length >= 8 ? normalized : null;
      };
      
      // Build lookup maps for existing contestants - include isTemporary flag
      const existingByNameMap = new Map<string, { id: string; isTemporary: boolean }>();
      const existingByEmailMap = new Map<string, { id: string; isTemporary: boolean }>();
      const existingByPhoneMap = new Map<string, { id: string; isTemporary: boolean; name: string; email: string | null }>();
      
      existingContestants.forEach((c: any) => {
        if (c.name) {
          const nameKey = c.name.toLowerCase().trim();
          if (!existingByNameMap.has(nameKey) || !c.isTemporary) {
            existingByNameMap.set(nameKey, { id: c.id, isTemporary: !!c.isTemporary });
          }
        }
        if (c.email) {
          const emailKey = c.email.toLowerCase().trim();
          if (!existingByEmailMap.has(emailKey) || !c.isTemporary) {
            existingByEmailMap.set(emailKey, { id: c.id, isTemporary: !!c.isTemporary });
          }
        }
        const normalizedPhone = normalizePhone(c.phone);
        if (normalizedPhone) {
          if (!existingByPhoneMap.has(normalizedPhone) || !c.isTemporary) {
            existingByPhoneMap.set(normalizedPhone, { 
              id: c.id, 
              isTemporary: !!c.isTemporary,
              name: c.name?.toLowerCase().trim() || '',
              email: c.email?.toLowerCase().trim() || null
            });
          }
        }
      });
      
      // Track which names/emails/phones we've processed in this import
      const processedNames = new Set<string>();
      const processedEmails = new Set<string>();
      const processedPhones = new Set<string>();
      
      // Create contestants, skipping duplicates and DNU-rated contestants
      const createdContestants = [];
      const updatedTemporaryContestants: any[] = [];
      const skippedDuplicates = [];
      const skippedDNU = [];
      
      for (const row of data as any[]) {
        const normalizedName = row.name?.toLowerCase().trim();
        const normalizedEmail = row.email?.toLowerCase().trim();
        const normalizedPhone = normalizePhone(row.phone);
        
        // Skip contestants with DNU (Do Not Use) rating
        if (row.auditionRating && row.auditionRating.toString().toUpperCase().trim() === 'DNU') {
          skippedDNU.push({ name: row.name, reason: 'Rated DNU (Do Not Use)' });
          continue;
        }
        
        // Check for match with existing contestant
        const nameMatch = normalizedName ? existingByNameMap.get(normalizedName) : null;
        const emailMatch = normalizedEmail ? existingByEmailMap.get(normalizedEmail) : null;
        const phoneMatch = normalizedPhone ? existingByPhoneMap.get(normalizedPhone) : null;
        
        // If match is a temporary contestant, update it instead of skipping
        // Prioritize name match for temp contestants since that's what producers usually enter
        const tempMatch = (nameMatch?.isTemporary ? nameMatch : null) || 
                          (emailMatch?.isTemporary ? emailMatch : null) || 
                          (phoneMatch?.isTemporary ? phoneMatch : null);
        
        if (tempMatch) {
          console.log(`[Import] Found temporary match for ${row.name} (ID: ${tempMatch.id}). Updating record while preserving existing data.`);
          
          // Build update object - only include fields that have actual values from import
          // This preserves any existing data (notes, status, etc.) that was already on the temp contestant
          const updateData: Record<string, any> = {
            isTemporary: false, // Always mark as no longer temporary
          };
          
          // Core fields - always update from import
          if (row.name) updateData.name = row.name;
          if (row.age !== undefined && row.age !== null) updateData.age = row.age;
          if (row.gender) updateData.gender = row.gender;
          
          // Contact fields - only update if import has value
          if (row.email) updateData.email = row.email;
          if (row.phone) updateData.phone = row.phone;
          
          // Optional fields - only update if import has value (preserves existing if import is empty)
          if (row.attendingWith) updateData.attendingWith = row.attendingWith;
          if (row.location) updateData.location = row.location;
          if (row.postcode) updateData.postcode = row.postcode;
          if (row.state) updateData.state = row.state;
          if (row.medicalInfo) updateData.medicalInfo = row.medicalInfo;
          if (row.mobilityNotes) updateData.mobilityNotes = row.mobilityNotes;
          if (row.criminalRecord) updateData.criminalRecord = row.criminalRecord;
          if (row.auditionRating) updateData.auditionRating = row.auditionRating;
          if (row.groupSize !== undefined && row.groupSize !== null) updateData.groupSize = row.groupSize;
          if (row.availabilityNotes) updateData.availabilityNotes = row.availabilityNotes;
          if ((row as any).audienceAvailableDates) updateData.audienceAvailableDates = (row as any).audienceAvailableDates;
          if (row.podiumStory !== undefined) updateData.podiumStory = row.podiumStory;
          if (row.availableForStandby !== undefined) updateData.availableForStandby = row.availableForStandby;
          
          // Group ID from the import's group detection
          const detectedGroupId = nameToGroupId.get(row.name);
          if (detectedGroupId) updateData.groupId = detectedGroupId;
          
          const updatedContestant = await storage.updateContestant(tempMatch.id, updateData);
          updatedTemporaryContestants.push(updatedContestant);
          
          // CRITICAL: Update the lookup maps so later rows in the same file don't treat this as a duplicate
          if (normalizedName) {
            existingByNameMap.set(normalizedName, { id: tempMatch.id, isTemporary: false });
            processedNames.add(normalizedName);
          }
          if (normalizedEmail) {
            existingByEmailMap.set(normalizedEmail, { id: tempMatch.id, isTemporary: false });
            processedEmails.add(normalizedEmail);
          }
          if (normalizedPhone) {
            existingByPhoneMap.set(normalizedPhone, { 
              id: tempMatch.id, 
              isTemporary: false,
              name: normalizedName || '',
              email: normalizedEmail || null
            });
            processedPhones.add(normalizedPhone);
          }
          continue;
        }
        
        // Check for duplicate (non-temporary) by name (exact match), email, or phone
        // Only flag as duplicate if the match is NOT a temporary contestant
        const nameMapEntry = normalizedName ? existingByNameMap.get(normalizedName) : null;
        const emailMapEntry = normalizedEmail ? existingByEmailMap.get(normalizedEmail) : null;
        const phoneMapEntry = normalizedPhone ? existingByPhoneMap.get(normalizedPhone) : null;
        
        const isDuplicateName = normalizedName && ((nameMapEntry && !nameMapEntry.isTemporary) || processedNames.has(normalizedName));
        const isDuplicateEmail = normalizedEmail && ((emailMapEntry && !emailMapEntry.isTemporary) || processedEmails.has(normalizedEmail));
        
        // Phone duplicates only count if the name OR email also matches
        // (people can share phone numbers, e.g., family members)
        let isDuplicatePhone = false;
        if (normalizedPhone && !isDuplicateName && !isDuplicateEmail) {
          if (processedPhones.has(normalizedPhone)) {
            // Check if this is truly a duplicate within the same import file
            // For now, allow shared phones within same import since we can't easily check name/email
            isDuplicatePhone = false;
          } else if (phoneMapEntry && !phoneMapEntry.isTemporary) {
            // Check if the phone match also has matching name or email
            const phoneMatchName = phoneMapEntry.name;
            const phoneMatchEmail = phoneMapEntry.email;
            if (phoneMatchName === normalizedName || (normalizedEmail && phoneMatchEmail === normalizedEmail)) {
              isDuplicatePhone = true;
            } else {
              // Different name AND different email - this is a shared phone, not a duplicate
              console.log(`[Import] Phone match for ${row.name} but different name/email - allowing as separate person (shared phone)`);
            }
          }
        }
        
        if (isDuplicateName || isDuplicateEmail || isDuplicatePhone) {
          skippedDuplicates.push({
            name: row.name,
            reason: isDuplicateName ? 'Name already exists' : (isDuplicateEmail ? 'Email already exists' : 'Phone already exists')
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
          audienceAvailableDates: (row as any).audienceAvailableDates ?? null,
        });
        createdContestants.push(contestant);
        
        // Add to existing sets to prevent duplicates within same import
        if (normalizedName) processedNames.add(normalizedName);
        if (normalizedEmail) processedEmails.add(normalizedEmail);
        if (normalizedPhone) processedPhones.add(normalizedPhone);
      }

      let message = `Successfully imported ${createdContestants.length} contestants`;
      const messageParts = [];
      if (updatedTemporaryContestants.length > 0) {
        messageParts.push(`updated ${updatedTemporaryContestants.length} temporary contestants`);
      }
      if (skippedDuplicates.length > 0) messageParts.push(`skipped ${skippedDuplicates.length} duplicates`);
      if (skippedDNU.length > 0) messageParts.push(`skipped ${skippedDNU.length} DNU-rated`);
      
      if (messageParts.length > 0) {
        message = `Imported ${createdContestants.length} contestants, ${messageParts.join(', ')}`;
      }

      res.json({
        message,
        contestants: createdContestants,
        contestantsCreated: createdContestants.length,
        temporaryContestantsUpdated: updatedTemporaryContestants.length,
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

  // ─── Survey Format Import (Microsoft Forms export) ─────────────────────────

  // Helper: parse a survey-format workbook buffer into raw row objects
  const parseSurveyWorkbook = (buffer: Buffer): any[] | null => {
    try {
      const workbook = xlsx.read(buffer, { type: "buffer", cellFormula: false, cellStyles: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const allRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][];
      if (!allRows || allRows.length === 0) return null;

      // Find first non-empty row as header
      let headerRowIndex = 0;
      for (let i = 0; i < allRows.length; i++) {
        if (allRows[i].some((cell: any) => cell && cell.toString().trim() !== "")) {
          headerRowIndex = i;
          break;
        }
      }
      const headers = (allRows[headerRowIndex] as any[]).map((h: any) => h ? h.toString().trim() : "");
      const dataRows = allRows.slice(headerRowIndex + 1);
      return dataRows
        .map((row: any[]) => {
          const obj: any = {};
          headers.forEach((header, index) => {
            if (row[index] !== undefined && row[index] !== null) obj[header] = row[index];
          });
          return obj;
        })
        .filter(row => Object.keys(row).length > 0 && Object.values(row).some(v => v !== "" && v !== null && v !== undefined));
    } catch {
      return null;
    }
  };

  // Parse a "23 June;25 June;" style dates list into ISO date strings (YYYY-MM-DD).
  // The audience form does not include a year, so we use the current year and
  // bump dates that have already passed by >30 days into next year.
  const MONTHS: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const parseAudienceDateList = (raw: any): string[] | null => {
    if (raw == null) return null;
    const text = raw.toString().trim();
    if (!text) return null;
    const now = new Date();
    const nowYear = now.getFullYear();
    const out: string[] = [];
    text.split(/[;,\n]+/).map(s => s.trim()).filter(Boolean).forEach(token => {
      // accept "23 June", "June 23", "23/06", "2026-06-23"
      let y: number | null = null, m: number | null = null, d: number | null = null;
      let match = token.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (match) { y = +match[1]; m = +match[2] - 1; d = +match[3]; }
      if (m == null) {
        match = token.match(/^(\d{1,2})\s+([A-Za-z]+)$/);
        if (match) { d = +match[1]; m = MONTHS[match[2].toLowerCase()] ?? null; }
      }
      if (m == null) {
        match = token.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
        if (match) { m = MONTHS[match[1].toLowerCase()] ?? null; d = +match[2]; }
      }
      if (m == null) {
        match = token.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
        if (match) { d = +match[1]; m = +match[2] - 1; if (match[3]) y = +match[3] < 100 ? 2000 + +match[3] : +match[3]; }
      }
      if (m == null || d == null) return;
      if (y == null) {
        y = nowYear;
        const candidate = new Date(y, m, d);
        if ((now.getTime() - candidate.getTime()) > 30 * 24 * 60 * 60 * 1000) y += 1;
      }
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!out.includes(iso)) out.push(iso);
    });
    return out.length > 0 ? out : null;
  };

  // Helper: map a raw survey row to a normalised contestant-shaped object
  const mapSurveyRow = (row: any): {
    name: string; email: string | null; phone: string | null; location: string | null;
    groupSize: number | null; attendingWith: string | null; availabilityNotes: string | null;
    audienceAvailableDates: string[] | null;
    auditionRating: string;
  } | null => {
    // Prefer "Full name", then "Name"
    const nameRaw = row["Full name"] ?? row["Full Name"] ?? row["FULL NAME"] ?? row["Name"] ?? row["NAME"] ?? row["name"] ?? null;
    if (!nameRaw || nameRaw.toString().trim() === "") return null;

    // Microsoft Forms exports include TWO email-related columns:
    //   1. "Email" — the respondent's Microsoft account email, shown as "anonymous" for non-MS users
    //   2. The actual survey question response (e.g. "Email address", "Your email", etc.)
    // We scan ALL columns whose header contains "email", skip blanks and "anonymous",
    // and require an "@" so we only pick real email addresses. The first valid hit wins.
    const emailNormalized = Object.keys(row)
      .filter(k => k.toLowerCase().includes("email"))
      .map(k => (row[k] ?? "").toString().trim().toLowerCase())
      .find(v => v && v !== "anonymous" && v.includes("@")) ?? null;

    const phoneRaw = row["Phone number"] ?? row["Phone Number"] ?? row["PHONE NUMBER"] ?? row["Phone"] ?? row["PHONE"] ?? row["phone"] ?? null;
    let phone: string | null = null;
    if (phoneRaw) {
      const phoneStr = phoneRaw.toString().trim();
      phone = phoneStr.startsWith("4") ? "0" + phoneStr : phoneStr;
    }

    const locationRaw = row["Suburb"] ?? row["suburb"] ?? row["SUBURB"] ?? row["City"] ?? row["city"] ?? row["Location"] ?? null;

    // Group size: audience form returns "Solo" / "With a group" (text), survey may return an integer.
    // Solo → 1, With a group → derive from comma/semicolon-separated member names, fallback to 2.
    const groupSizeRaw = row["Group size"] ?? row["Group Size"] ?? row["GROUP SIZE"] ?? null;
    const attendingWithRaw = row["Group Members Names"] ?? row["Group members names"] ?? row["Group Member Names"] ?? row["Group Members"] ?? null;
    let groupSize: number | null = null;
    if (groupSizeRaw != null) {
      const s = groupSizeRaw.toString().trim();
      const asNum = parseInt(s);
      if (!isNaN(asNum) && asNum > 0) {
        groupSize = asNum;
      } else if (/solo/i.test(s)) {
        groupSize = 1;
      } else if (/group/i.test(s)) {
        const members = attendingWithRaw ? attendingWithRaw.toString().split(/[,;\n]+/).map((p: string) => p.trim()).filter(Boolean) : [];
        groupSize = members.length > 0 ? members.length + 1 : 2;
      }
    }

    // Find the availability/dates column by scanning keys
    const datesKey = Object.keys(row).find(k => {
      const lk = k.toLowerCase();
      return lk.includes("available to attend") || lk.includes("studio recording") || lk.includes("filming date") || (lk.includes("date") && lk.includes("available"));
    });
    const datesRaw = datesKey ? row[datesKey] : null;
    const audienceAvailableDates = parseAudienceDateList(datesRaw);

    // Collect optional free-form audience fields into combined availabilityNotes
    // (Filming dates kept verbatim, plus Superfan interest, Tell us more, Radio hosts.)
    const notesParts: string[] = [];
    if (datesRaw && datesRaw.toString().trim()) notesParts.push(`Available: ${datesRaw.toString().trim()}`);
    const findCol = (predicate: (k: string) => boolean) => {
      const k = Object.keys(row).find(predicate);
      return k ? (row[k] ?? "").toString().trim() : "";
    };
    const superfan = findCol(k => k.toLowerCase().includes("superfan"));
    if (superfan) notesParts.push(`Superfan: ${superfan}`);
    const tellMore = findCol(k => k.toLowerCase().includes("tell us more"));
    if (tellMore) notesParts.push(`Tell us more: ${tellMore}`);
    const radio = findCol(k => k.toLowerCase().includes("radio host"));
    if (radio) notesParts.push(`Radio hosts: ${radio}`);
    const availabilityNotes = notesParts.length > 0 ? notesParts.join("\n") : null;

    return {
      name: nameRaw.toString().trim(),
      email: emailNormalized,
      phone,
      location: locationRaw ? locationRaw.toString().trim() : null,
      groupSize,
      attendingWith: attendingWithRaw ? attendingWithRaw.toString().trim() : null,
      availabilityNotes,
      audienceAvailableDates,
      auditionRating: "R",
    };
  };

  // Preview survey import - duplicate check step
  app.post("/api/contestants/import-survey-preview", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const rawData = parseSurveyWorkbook(req.file.buffer);
      if (!rawData || rawData.length === 0) {
        return res.status(400).json({ error: "The uploaded file is empty or has no data rows." });
      }

      const importedContestants = rawData
        .map(mapSurveyRow)
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (importedContestants.length === 0) {
        return res.status(400).json({ error: "No valid contestant rows found. Make sure the file has a 'Full name' or 'Name' column." });
      }

      const existingContestants = await storage.getContestants();

      const normalizePhone = (phone: string | null): string | null => {
        if (!phone) return null;
        return phone.replace(/\D/g, "");
      };

      const existingByName = new Map<string, any>();
      const existingByEmail = new Map<string, any>();
      const existingByPhone = new Map<string, any>();
      existingContestants.forEach((c: any) => {
        if (c.name) {
          const k = c.name.toLowerCase().trim();
          if (!existingByName.has(k) || !c.isTemporary) existingByName.set(k, c);
        }
        if (c.email) {
          const k = c.email.toLowerCase().trim();
          if (!existingByEmail.has(k) || !c.isTemporary) existingByEmail.set(k, c);
        }
        const np = normalizePhone(c.phone);
        if (np && np.length >= 8) {
          if (!existingByPhone.has(np) || !c.isTemporary) existingByPhone.set(np, c);
        }
      });

      interface DupInfo {
        importName: string; importEmail: string | null; importPhone: string | null;
        matchType: "exact_name" | "email" | "phone";
        existingContestant: { id: string; name: string; email: string | null; phone: string | null; isTemporary: boolean };
      }
      const duplicates: DupInfo[] = [];
      const uniqueContestants: typeof importedContestants = [];
      const temporaryContestantsToUpdate: Array<{ existingId: string; importName: string }> = [];
      const emailPatches: Array<{ importName: string; email: string }> = [];
      const seenInImport = new Set<string>();

      for (const contestant of importedContestants) {
        const normalizedName = contestant.name.toLowerCase().trim();
        const normalizedPhone = normalizePhone(contestant.phone);
        const nameMatch = existingByName.get(normalizedName);
        const emailMatch = contestant.email ? existingByEmail.get(contestant.email) : null;
        const phoneMatch = normalizedPhone ? existingByPhone.get(normalizedPhone) : null;

        let match = nameMatch || emailMatch;
        if (!match && phoneMatch) {
          const pmName = phoneMatch.name?.toLowerCase().trim();
          const pmEmail = phoneMatch.email?.toLowerCase().trim();
          if (pmName === normalizedName || (contestant.email && pmEmail === contestant.email)) match = phoneMatch;
        }

        if (match) {
          if (match.isTemporary) {
            temporaryContestantsToUpdate.push({ existingId: match.id.toString(), importName: contestant.name });
            continue;
          }
          // Email patch: name matched, existing has no email, import has one
          if (nameMatch && !nameMatch.isTemporary && !match.email && contestant.email) {
            emailPatches.push({ importName: contestant.name, email: contestant.email });
            continue;
          }
          duplicates.push({
            importName: contestant.name,
            importEmail: contestant.email,
            importPhone: contestant.phone,
            matchType: nameMatch ? "exact_name" : emailMatch ? "email" : "phone",
            existingContestant: { id: match.id.toString(), name: match.name, email: match.email, phone: match.phone, isTemporary: !!match.isTemporary },
          });
          continue;
        }

        if (seenInImport.has(normalizedName)) continue;
        seenInImport.add(normalizedName);
        uniqueContestants.push(contestant);
      }

      res.json({
        totalInFile: importedContestants.length,
        uniqueCount: uniqueContestants.length,
        duplicateCount: duplicates.length,
        duplicates,
        temporaryUpdatesCount: temporaryContestantsToUpdate.length,
        temporaryUpdates: temporaryContestantsToUpdate,
        emailPatchCount: emailPatches.length,
        emailPatches,
      });
    } catch (error: any) {
      console.error("Survey import preview error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import contestants from survey-format Excel
  app.post("/api/contestants/import-survey", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      console.log(`[Survey Import] Starting import for file: ${req.file.originalname}`);

      const rawData = parseSurveyWorkbook(req.file.buffer);
      if (!rawData || rawData.length === 0) {
        return res.status(400).json({ error: "The uploaded file is empty or has no data rows." });
      }

      const data = rawData.map(mapSurveyRow).filter((r): r is NonNullable<typeof r> => r !== null);
      if (data.length === 0) {
        return res.status(400).json({ error: "No valid contestant rows found. Make sure the file has a 'Full name' or 'Name' column." });
      }

      console.log(`[Survey Import] Found ${data.length} valid rows`);

      const existingContestants = await storage.getContestants();
      const normalizePhone = (phone: string | null | undefined): string | null => {
        if (!phone) return null;
        const n = phone.toString().replace(/\D/g, "");
        return n.length >= 8 ? n : null;
      };

      const existingByNameMap = new Map<string, { id: string; isTemporary: boolean; email: string | null }>();
      const existingByEmailMap = new Map<string, { id: string; isTemporary: boolean; email: string | null }>();
      const existingByPhoneMap = new Map<string, { id: string; isTemporary: boolean; name: string; email: string | null }>();

      existingContestants.forEach((c: any) => {
        if (c.name) {
          const k = c.name.toLowerCase().trim();
          if (!existingByNameMap.has(k) || !c.isTemporary) existingByNameMap.set(k, { id: c.id, isTemporary: !!c.isTemporary, email: c.email?.toLowerCase().trim() || null });
        }
        if (c.email) {
          const k = c.email.toLowerCase().trim();
          if (!existingByEmailMap.has(k) || !c.isTemporary) existingByEmailMap.set(k, { id: c.id, isTemporary: !!c.isTemporary, email: c.email?.toLowerCase().trim() || null });
        }
        const np = normalizePhone(c.phone);
        if (np) {
          if (!existingByPhoneMap.has(np) || !c.isTemporary)
            existingByPhoneMap.set(np, { id: c.id, isTemporary: !!c.isTemporary, name: c.name?.toLowerCase().trim() || "", email: c.email?.toLowerCase().trim() || null });
        }
      });

      const processedNames = new Set<string>();
      const processedEmails = new Set<string>();
      const processedPhones = new Set<string>();

      const createdContestants: any[] = [];
      const updatedTemporaryContestants: any[] = [];
      const skippedDuplicates: any[] = [];

      for (const row of data) {
        const normalizedName = row.name.toLowerCase().trim();
        const normalizedEmail = row.email?.toLowerCase().trim() ?? null;
        const normalizedPhone = normalizePhone(row.phone);

        const nameMatch = existingByNameMap.get(normalizedName);
        const emailMatch = normalizedEmail ? existingByEmailMap.get(normalizedEmail) : null;
        const phoneMatch = normalizedPhone ? existingByPhoneMap.get(normalizedPhone) : null;

        const tempMatch =
          (nameMatch?.isTemporary ? nameMatch : null) ||
          (emailMatch?.isTemporary ? emailMatch : null) ||
          (phoneMatch?.isTemporary ? phoneMatch : null);

        if (tempMatch) {
          const updateData: Record<string, any> = { isTemporary: false, auditionRating: "R" };
          if (row.name) updateData.name = row.name;
          if (row.email) updateData.email = row.email;
          if (row.phone) updateData.phone = row.phone;
          if (row.location) updateData.location = row.location;
          if (row.groupSize != null) updateData.groupSize = row.groupSize;
          if (row.attendingWith) updateData.attendingWith = row.attendingWith;
          if (row.availabilityNotes) updateData.availabilityNotes = row.availabilityNotes;
          if (row.audienceAvailableDates) updateData.audienceAvailableDates = row.audienceAvailableDates;

          const updated = await storage.updateContestant(tempMatch.id, updateData);
          updatedTemporaryContestants.push(updated);

          if (normalizedName) { existingByNameMap.set(normalizedName, { id: tempMatch.id, isTemporary: false }); processedNames.add(normalizedName); }
          if (normalizedEmail) { existingByEmailMap.set(normalizedEmail, { id: tempMatch.id, isTemporary: false }); processedEmails.add(normalizedEmail); }
          if (normalizedPhone) { existingByPhoneMap.set(normalizedPhone, { id: tempMatch.id, isTemporary: false, name: normalizedName, email: normalizedEmail }); processedPhones.add(normalizedPhone); }
          continue;
        }

        const isDuplicateName = normalizedName && ((nameMatch && !nameMatch.isTemporary) || processedNames.has(normalizedName));
        const isDuplicateEmail = normalizedEmail && ((emailMatch && !emailMatch.isTemporary) || processedEmails.has(normalizedEmail));
        let isDuplicatePhone = false;
        if (normalizedPhone && !isDuplicateName && !isDuplicateEmail && phoneMatch && !phoneMatch.isTemporary) {
          if (phoneMatch.name === normalizedName || (normalizedEmail && phoneMatch.email === normalizedEmail)) isDuplicatePhone = true;
        }

        // Email-patch: if we matched by name and the existing contestant has no email
        // but the import row does, update just the email (supports re-import after bug fix)
        if (isDuplicateName && !isDuplicateEmail && normalizedEmail && nameMatch && !nameMatch.isTemporary && !nameMatch.email) {
          await storage.updateContestant(nameMatch.id, { email: row.email });
          processedNames.add(normalizedName);
          processedEmails.add(normalizedEmail);
          existingByEmailMap.set(normalizedEmail, { id: nameMatch.id, isTemporary: false, email: normalizedEmail });
          updatedTemporaryContestants.push({ id: nameMatch.id, name: row.name, emailPatched: true });
          continue;
        }

        if (isDuplicateName || isDuplicateEmail || isDuplicatePhone) {
          skippedDuplicates.push({ name: row.name, reason: isDuplicateName ? "Name already exists" : isDuplicateEmail ? "Email already exists" : "Phone already exists" });
          continue;
        }

        const contestant = await storage.createContestant({
          name: row.name,
          age: 0,
          gender: "Not Specified",
          auditionRating: "R",
          email: row.email,
          phone: row.phone,
          location: row.location,
          groupSize: row.groupSize,
          attendingWith: row.attendingWith,
          availabilityNotes: row.availabilityNotes,
          availabilityStatus: "available",
          availableForStandby: false,
          podiumStory: false,
        });
        createdContestants.push(contestant);

        if (normalizedName) processedNames.add(normalizedName);
        if (normalizedEmail) processedEmails.add(normalizedEmail);
        if (normalizedPhone) processedPhones.add(normalizedPhone);
      }

      const emailPatched = updatedTemporaryContestants.filter((c: any) => c.emailPatched).length;
      const tempUpdated = updatedTemporaryContestants.filter((c: any) => !c.emailPatched).length;
      let message = `Successfully imported ${createdContestants.length} contestants (all rated R)`;
      const parts: string[] = [];
      if (tempUpdated > 0) parts.push(`updated ${tempUpdated} temporary contestants`);
      if (emailPatched > 0) parts.push(`added email to ${emailPatched} existing contestants`);
      if (skippedDuplicates.length > 0) parts.push(`skipped ${skippedDuplicates.length} duplicates`);
      if (parts.length > 0) message = `Imported ${createdContestants.length} contestants (rated R), ${parts.join(", ")}`;

      console.log(`[Survey Import] ${message}`);
      res.json({
        message,
        contestants: createdContestants,
        contestantsCreated: createdContestants.length,
        temporaryContestantsUpdated: updatedTemporaryContestants.length,
        groupsCreated: 0,
        skippedDuplicates: skippedDuplicates.length,
        skippedDNU: 0,
        duplicates: skippedDuplicates.slice(0, 20),
        dnuContestants: [],
      });
    } catch (error: any) {
      console.error("Survey import error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Audience Import (Celeb workspace) — same parser as Survey, sets rating "V" ───
  // Helper: look up a contestant's history in the DOND (public) schema by email or phone.
  // Returns a one-line summary string suitable for appending to availability notes,
  // or null if no match / no meaningful history exists.
  async function lookupDondHistorySummary(email: string | null | undefined, phone: string | null | undefined): Promise<string | null> {
    if (!pool) return null;
    const normalizedEmail = (email || '').toString().trim();
    const normalizedPhone = (phone || '').toString().replace(/\D/g, '');
    if (!normalizedEmail && !normalizedPhone) return null;
    try {
      const result = await pool.query(
        `SELECT c.id, c.name, c.no_show_count, c.early_leaver_count,
                (SELECT COUNT(*) FROM public.seat_assignments sa WHERE sa.contestant_id = c.id) AS sa_count,
                (SELECT COALESCE(SUM(winning_money_amount),0) FROM public.seat_assignments WHERE contestant_id = c.id) AS money,
                (SELECT MAX(rd.date)
                   FROM public.seat_assignments sa
                   JOIN public.record_days rd ON rd.id = sa.record_day_id
                  WHERE sa.contestant_id = c.id) AS latest_date
           FROM public.contestants c
          WHERE (NULLIF($1,'') IS NOT NULL AND LOWER(TRIM(c.email)) = LOWER($1))
             OR (NULLIF($2,'') IS NOT NULL AND REGEXP_REPLACE(COALESCE(c.phone,''),'\\D','','g') = $2)
          LIMIT 1`,
        [normalizedEmail, normalizedPhone]
      );
      if (result.rows.length === 0) return null;
      const r: any = result.rows[0];
      const parts: string[] = [];
      const saCount = Number(r.sa_count) || 0;
      const money = Number(r.money) || 0;
      const noShow = Number(r.no_show_count) || 0;
      const earlyLeaver = Number(r.early_leaver_count) || 0;
      if (saCount > 0) parts.push(`${saCount} DOND record day${saCount !== 1 ? 's' : ''}`);
      if (r.latest_date) {
        const d = new Date(r.latest_date);
        if (!isNaN(d.getTime())) {
          parts.push(`latest ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`);
        }
      }
      if (money > 0) parts.push(`won $${money.toLocaleString('en-AU')}`);
      if (noShow > 0) parts.push(`${noShow} no-show${noShow !== 1 ? 's' : ''}`);
      if (earlyLeaver > 0) parts.push(`${earlyLeaver} early leaver${earlyLeaver !== 1 ? 's' : ''}`);
      if (parts.length === 0) return null;
      return `Previously in DOND: ${parts.join(', ')}`;
    } catch (err) {
      console.warn('[lookupDondHistorySummary] failed:', (err as any)?.message);
      return null;
    }
  }

  app.post("/api/contestants/import-audience-preview", upload.single("file"), async (req, res) => {
   const workspace = (req as any).session?.activeWorkspace || 'dond';
   return runWithWorkspace(workspace, async () => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const rawData = parseSurveyWorkbook(req.file.buffer);
      if (!rawData || rawData.length === 0) {
        return res.status(400).json({ error: "The uploaded file is empty or has no data rows." });
      }

      const importedContestants = rawData
        .map(mapSurveyRow)
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (importedContestants.length === 0) {
        return res.status(400).json({ error: "No valid contestant rows found. Make sure the file has a 'Full name' or 'Name' column." });
      }

      const existingContestants = await storage.getContestants();

      const normalizePhone = (phone: string | null): string | null => {
        if (!phone) return null;
        return phone.replace(/\D/g, "");
      };

      const existingByName = new Map<string, any>();
      const existingByEmail = new Map<string, any>();
      const existingByPhone = new Map<string, any>();
      existingContestants.forEach((c: any) => {
        if (c.name) {
          const k = c.name.toLowerCase().trim();
          if (!existingByName.has(k) || !c.isTemporary) existingByName.set(k, c);
        }
        if (c.email) {
          const k = c.email.toLowerCase().trim();
          if (!existingByEmail.has(k) || !c.isTemporary) existingByEmail.set(k, c);
        }
        const np = normalizePhone(c.phone);
        if (np && np.length >= 8) {
          if (!existingByPhone.has(np) || !c.isTemporary) existingByPhone.set(np, c);
        }
      });

      interface DupInfo {
        importName: string; importEmail: string | null; importPhone: string | null;
        matchType: "exact_name" | "email" | "phone";
        existingContestant: { id: string; name: string; email: string | null; phone: string | null; isTemporary: boolean };
      }
      const duplicates: DupInfo[] = [];
      const uniqueContestants: typeof importedContestants = [];
      const temporaryContestantsToUpdate: Array<{ existingId: string; importName: string }> = [];
      const emailPatches: Array<{ importName: string; email: string }> = [];
      const seenInImport = new Set<string>();

      for (const contestant of importedContestants) {
        const normalizedName = contestant.name.toLowerCase().trim();
        const normalizedPhone = normalizePhone(contestant.phone);
        const nameMatch = existingByName.get(normalizedName);
        const emailMatch = contestant.email ? existingByEmail.get(contestant.email) : null;
        const phoneMatch = normalizedPhone ? existingByPhone.get(normalizedPhone) : null;

        let match = nameMatch || emailMatch;
        if (!match && phoneMatch) {
          const pmName = phoneMatch.name?.toLowerCase().trim();
          const pmEmail = phoneMatch.email?.toLowerCase().trim();
          if (pmName === normalizedName || (contestant.email && pmEmail === contestant.email)) match = phoneMatch;
        }

        if (match) {
          if (match.isTemporary) {
            temporaryContestantsToUpdate.push({ existingId: match.id.toString(), importName: contestant.name });
            continue;
          }
          if (nameMatch && !nameMatch.isTemporary && !match.email && contestant.email) {
            emailPatches.push({ importName: contestant.name, email: contestant.email });
            continue;
          }
          duplicates.push({
            importName: contestant.name,
            importEmail: contestant.email,
            importPhone: contestant.phone,
            matchType: nameMatch ? "exact_name" : emailMatch ? "email" : "phone",
            existingContestant: { id: match.id.toString(), name: match.name, email: match.email, phone: match.phone, isTemporary: !!match.isTemporary },
          });
          continue;
        }

        if (seenInImport.has(normalizedName)) continue;
        seenInImport.add(normalizedName);
        uniqueContestants.push(contestant);
      }

      let dondHistoryMatchCount = 0;
      if (workspace === 'celeb') {
        const candidates = [
          ...uniqueContestants.map((c) => ({ email: c.email, phone: c.phone })),
          ...temporaryContestantsToUpdate.map((t) => {
            const src = importedContestants.find((ic) => ic.name === t.importName);
            return { email: src?.email || null, phone: src?.phone || null };
          }),
        ];
        const lookups = await Promise.all(
          candidates.map((c) => lookupDondHistorySummary(c.email, c.phone))
        );
        dondHistoryMatchCount = lookups.filter((s) => s !== null).length;
      }

      res.json({
        totalInFile: importedContestants.length,
        uniqueCount: uniqueContestants.length,
        duplicateCount: duplicates.length,
        duplicates,
        temporaryUpdatesCount: temporaryContestantsToUpdate.length,
        temporaryUpdates: temporaryContestantsToUpdate,
        emailPatchCount: emailPatches.length,
        emailPatches,
        dondHistoryMatchCount,
      });
    } catch (error: any) {
      console.error("Audience import preview error:", error);
      res.status(500).json({ error: error.message });
    }
   });
  });

  app.post("/api/contestants/import-audience", upload.single("file"), async (req, res) => {
   const workspace = (req as any).session?.activeWorkspace || 'dond';
   return runWithWorkspace(workspace, async () => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      console.log(`[Audience Import] Starting import for file: ${req.file.originalname}`);
      console.log(`[Audience Import] Workspace context: ${workspace}`);

      const rawData = parseSurveyWorkbook(req.file.buffer);
      if (!rawData || rawData.length === 0) {
        return res.status(400).json({ error: "The uploaded file is empty or has no data rows." });
      }

      const data = rawData.map(mapSurveyRow).filter((r): r is NonNullable<typeof r> => r !== null);
      if (data.length === 0) {
        return res.status(400).json({ error: "No valid contestant rows found. Make sure the file has a 'Full name' or 'Name' column." });
      }

      console.log(`[Audience Import] Found ${data.length} valid rows`);

      const existingContestants = await storage.getContestants();
      const normalizePhone = (phone: string | null | undefined): string | null => {
        if (!phone) return null;
        const n = phone.toString().replace(/\D/g, "");
        return n.length >= 8 ? n : null;
      };

      const existingByNameMap = new Map<string, { id: string; isTemporary: boolean; email: string | null }>();
      const existingByEmailMap = new Map<string, { id: string; isTemporary: boolean; email: string | null }>();
      const existingByPhoneMap = new Map<string, { id: string; isTemporary: boolean; name: string; email: string | null }>();

      existingContestants.forEach((c: any) => {
        if (c.name) {
          const k = c.name.toLowerCase().trim();
          if (!existingByNameMap.has(k) || !c.isTemporary) existingByNameMap.set(k, { id: c.id, isTemporary: !!c.isTemporary, email: c.email?.toLowerCase().trim() || null });
        }
        if (c.email) {
          const k = c.email.toLowerCase().trim();
          if (!existingByEmailMap.has(k) || !c.isTemporary) existingByEmailMap.set(k, { id: c.id, isTemporary: !!c.isTemporary, email: c.email?.toLowerCase().trim() || null });
        }
        const np = normalizePhone(c.phone);
        if (np) {
          if (!existingByPhoneMap.has(np) || !c.isTemporary)
            existingByPhoneMap.set(np, { id: c.id, isTemporary: !!c.isTemporary, name: c.name?.toLowerCase().trim() || "", email: c.email?.toLowerCase().trim() || null });
        }
      });

      const processedNames = new Set<string>();
      const processedEmails = new Set<string>();
      const processedPhones = new Set<string>();

      const createdContestants: any[] = [];
      const updatedTemporaryContestants: any[] = [];
      const skippedDuplicates: any[] = [];

      for (const row of data) {
        const normalizedName = row.name.toLowerCase().trim();
        const normalizedEmail = row.email?.toLowerCase().trim() ?? null;
        const normalizedPhone = normalizePhone(row.phone);

        const nameMatch = existingByNameMap.get(normalizedName);
        const emailMatch = normalizedEmail ? existingByEmailMap.get(normalizedEmail) : null;
        const phoneMatch = normalizedPhone ? existingByPhoneMap.get(normalizedPhone) : null;

        const tempMatch =
          (nameMatch?.isTemporary ? nameMatch : null) ||
          (emailMatch?.isTemporary ? emailMatch : null) ||
          (phoneMatch?.isTemporary ? phoneMatch : null);

        // Cross-workspace enrichment: for celeb imports, look up DOND history by email/phone
        // and prepare a summary line to append to availability notes.
        const dondSummary = workspace === 'celeb'
          ? await lookupDondHistorySummary(row.email, row.phone)
          : null;
        const mergedNotes = [row.availabilityNotes, dondSummary].filter(Boolean).join('\n\n') || null;

        if (tempMatch) {
          const updateData: Record<string, any> = { isTemporary: false, auditionRating: "V" };
          if (row.name) updateData.name = row.name;
          if (row.email) updateData.email = row.email;
          if (row.phone) updateData.phone = row.phone;
          if (row.location) updateData.location = row.location;
          if (row.groupSize != null) updateData.groupSize = row.groupSize;
          if (row.attendingWith) updateData.attendingWith = row.attendingWith;
          if (mergedNotes) updateData.availabilityNotes = mergedNotes;
          else if (row.availabilityNotes) updateData.availabilityNotes = row.availabilityNotes;
          if (row.audienceAvailableDates) updateData.audienceAvailableDates = row.audienceAvailableDates;

          const updated = await storage.updateContestant(tempMatch.id, updateData);
          updatedTemporaryContestants.push(updated);

          if (normalizedName) { existingByNameMap.set(normalizedName, { id: tempMatch.id, isTemporary: false, email: normalizedEmail }); processedNames.add(normalizedName); }
          if (normalizedEmail) { existingByEmailMap.set(normalizedEmail, { id: tempMatch.id, isTemporary: false, email: normalizedEmail }); processedEmails.add(normalizedEmail); }
          if (normalizedPhone) { existingByPhoneMap.set(normalizedPhone, { id: tempMatch.id, isTemporary: false, name: normalizedName, email: normalizedEmail }); processedPhones.add(normalizedPhone); }
          continue;
        }

        const isDuplicateName = normalizedName && ((nameMatch && !nameMatch.isTemporary) || processedNames.has(normalizedName));
        const isDuplicateEmail = normalizedEmail && ((emailMatch && !emailMatch.isTemporary) || processedEmails.has(normalizedEmail));
        let isDuplicatePhone = false;
        if (normalizedPhone && !isDuplicateName && !isDuplicateEmail && phoneMatch && !phoneMatch.isTemporary) {
          if (phoneMatch.name === normalizedName || (normalizedEmail && phoneMatch.email === normalizedEmail)) isDuplicatePhone = true;
        }

        if (isDuplicateName && !isDuplicateEmail && normalizedEmail && nameMatch && !nameMatch.isTemporary && !nameMatch.email) {
          await storage.updateContestant(nameMatch.id, { email: row.email });
          processedNames.add(normalizedName);
          processedEmails.add(normalizedEmail);
          existingByEmailMap.set(normalizedEmail, { id: nameMatch.id, isTemporary: false, email: normalizedEmail });
          updatedTemporaryContestants.push({ id: nameMatch.id, name: row.name, emailPatched: true });
          continue;
        }

        if (isDuplicateName || isDuplicateEmail || isDuplicatePhone) {
          skippedDuplicates.push({ name: row.name, reason: isDuplicateName ? "Name already exists" : isDuplicateEmail ? "Email already exists" : "Phone already exists" });
          continue;
        }

        const contestant = await storage.createContestant({
          name: row.name,
          age: 0,
          gender: "Not Specified",
          auditionRating: "V",
          email: row.email,
          phone: row.phone,
          location: row.location,
          groupSize: row.groupSize,
          attendingWith: row.attendingWith,
          availabilityNotes: mergedNotes ?? row.availabilityNotes,
          audienceAvailableDates: row.audienceAvailableDates ?? null,
          availabilityStatus: "available",
          availableForStandby: false,
          podiumStory: false,
        });
        createdContestants.push(contestant);

        if (normalizedName) processedNames.add(normalizedName);
        if (normalizedEmail) processedEmails.add(normalizedEmail);
        if (normalizedPhone) processedPhones.add(normalizedPhone);
      }

      const emailPatched = updatedTemporaryContestants.filter((c: any) => c.emailPatched).length;
      const tempUpdated = updatedTemporaryContestants.filter((c: any) => !c.emailPatched).length;
      let message = `Successfully imported ${createdContestants.length} audience contestants (all rated V)`;
      const parts: string[] = [];
      if (tempUpdated > 0) parts.push(`updated ${tempUpdated} temporary contestants`);
      if (emailPatched > 0) parts.push(`added email to ${emailPatched} existing contestants`);
      if (skippedDuplicates.length > 0) parts.push(`skipped ${skippedDuplicates.length} duplicates`);
      if (parts.length > 0) message = `Imported ${createdContestants.length} audience contestants (rated V), ${parts.join(", ")}`;

      console.log(`[Audience Import] ${message}`);
      res.json({
        message,
        contestants: createdContestants,
        contestantsCreated: createdContestants.length,
        temporaryContestantsUpdated: updatedTemporaryContestants.length,
        groupsCreated: 0,
        skippedDuplicates: skippedDuplicates.length,
        skippedDNU: 0,
        duplicates: skippedDuplicates.slice(0, 20),
        dnuContestants: [],
      });
    } catch (error: any) {
      console.error("Audience import error:", error);
      res.status(500).json({ error: error.message });
    }
   });
  });

  // ─────────────────────────────────────────────────────────────────────────────

  // PowerPoint Casting Card Import - Parse and preview
  app.post("/api/casting-cards/import-preview", requireAuth, pptxUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBuffer = req.file.buffer;
      const parseResult = await parsePptxFile(fileBuffer);

      if (!parseResult.success && parseResult.cards.length === 0) {
        return res.status(400).json({ 
          error: "Failed to parse PowerPoint file", 
          details: parseResult.errors 
        });
      }

      // Get all contestants for matching
      const allContestants = await storage.getContestants();
      const contestantList = allContestants.map(c => ({
        id: c.id,  // Keep as string - database uses UUID strings
        name: c.name || ''
      }));

      // Match each extracted card to a contestant
      const matchedCards = parseResult.cards.map(card => {
        const matchResult = matchContestantByName(card.name, contestantList);
        return {
          slideNumber: card.slideNumber,
          extractedName: card.name,
          ageState: card.ageState,
          occupation: card.occupation,
          sponsorCategory: card.sponsorCategory,
          tagline: card.tagline,
          bodyText: card.bodyText,
          producerName: card.producerName,
          hasMainPhoto: !!card.photos.main,
          companionPhotoCount: card.photos.companions.length,
          match: matchResult.match ? {
            id: matchResult.match.id,
            name: matchResult.match.name
          } : null,
          confidence: matchResult.confidence,
          candidates: matchResult.candidates.slice(0, 5).map(c => ({
            id: c.id,
            name: c.name
          }))
        };
      });

      res.json({
        success: true,
        cardsFound: parseResult.cards.length,
        cards: matchedCards,
        errors: parseResult.errors
      });

    } catch (error: any) {
      console.error("PowerPoint import preview error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // PowerPoint Casting Card Import - Execute import with confirmed matches
  app.post("/api/casting-cards/import", requireAuth, pptxUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { matches } = req.body;
      if (!matches) {
        return res.status(400).json({ error: "No matches provided" });
      }

      // Parse and validate the matches from JSON string
      let matchesArray: Array<{ slideNumber: number; contestantId: string }>;
      try {
        matchesArray = typeof matches === 'string' ? JSON.parse(matches) : matches;
        // Validate structure
        if (!Array.isArray(matchesArray)) {
          return res.status(400).json({ error: "Matches must be an array" });
        }
        console.log('[PPTX Import] Matches received:', JSON.stringify(matchesArray.slice(0, 3)));
        for (const match of matchesArray) {
          const slideNumType = typeof match.slideNumber;
          const contestantIdType = typeof match.contestantId;
          // Accept both string UUIDs and numeric IDs for contestantId
          if (slideNumType !== 'number' || (contestantIdType !== 'string' && contestantIdType !== 'number')) {
            console.log(`[PPTX Import] Invalid match: slideNumber type=${slideNumType} (${match.slideNumber}), contestantId type=${contestantIdType} (${match.contestantId})`);
            return res.status(400).json({ 
              error: `Invalid match entry - slideNumber type is ${slideNumType} (expected number), contestantId type is ${contestantIdType} (expected string or number)` 
            });
          }
          // Convert numeric IDs to strings for consistent handling
          if (typeof match.contestantId === 'number') {
            match.contestantId = String(match.contestantId);
          }
        }
      } catch (parseError) {
        return res.status(400).json({ error: "Invalid matches JSON format" });
      }

      const fileBuffer = req.file.buffer;
      const parseResult = await parsePptxFile(fileBuffer);

      if (!parseResult.success && parseResult.cards.length === 0) {
        return res.status(400).json({ 
          error: "Failed to parse PowerPoint file", 
          details: parseResult.errors 
        });
      }

      const imported: Array<{ contestantId: string; name: string }> = [];
      const errors: string[] = [];

      for (const matchInfo of matchesArray) {
        const { slideNumber, contestantId } = matchInfo;
        if (!contestantId) continue;

        const card = parseResult.cards.find(c => c.slideNumber === slideNumber);
        if (!card) {
          errors.push(`Card for slide ${slideNumber} not found`);
          continue;
        }

        try {
          // Get or create casting card for this contestant
          let existingCard = await storage.getCastingCardByContestantId(contestantId);
          
          // Build card fields - only include non-empty values to avoid overwriting good data with blanks
          const cardFields: Record<string, any> = {};
          
          // Always update these core fields from PowerPoint
          if (card.name) cardFields.fullName = card.name;
          if (card.ageState) cardFields.ageState = card.ageState;
          if (card.occupation) cardFields.occupation = card.occupation;
          if (card.bodyText) cardFields.bodyText = card.bodyText;
          
          // Optional fields - only update if present in PowerPoint
          if (card.sponsorCategory) {
            cardFields.sponsorCategory = card.sponsorCategory;
            cardFields.showSponsorCategory = true;
          }
          if (card.tagline) {
            cardFields.tagline = card.tagline;
            cardFields.showTagline = true;
          }
          if (card.producerName) {
            cardFields.producerName = card.producerName;
            cardFields.showProducer = true;
          }

          if (existingCard) {
            // Update existing card - REPLACE with PowerPoint data
            console.log(`[PPTX Import] Updating existing card for ${card.name}, contestantId: ${contestantId}, fields:`, Object.keys(cardFields));
            await storage.updateCastingCard(contestantId, cardFields);
          } else {
            // Create new casting card
            console.log(`[PPTX Import] Creating new card for ${card.name}`);
            await storage.createCastingCard({
              contestantId,
              ...cardFields
            });
          }

          // Skip photo import from PowerPoint - not reliable
          // Photos should be imported separately via Gallery PDF import

          const contestant = await storage.getContestantById(contestantId);
          imported.push({
            contestantId,
            name: contestant?.name || card.name
          });

        } catch (cardError: any) {
          errors.push(`Error importing card for slide ${slideNumber}: ${cardError.message}`);
        }
      }

      res.json({
        success: true,
        imported: imported.length,
        importedCards: imported,
        errors
      });

    } catch (error: any) {
      console.error("PowerPoint import error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Podium Stories — all contestants tagged with podiumStory, with their episode history
  app.get("/api/podium-stories", requireAuth, async (req, res) => {
    try {
      const data = await storage.getPodiumStoryContestants();
      res.json(data);
    } catch (error: any) {
      console.error("Get podium stories error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Search contestants for PPTX import matching
  app.get("/api/contestants/search", async (req, res) => {
    try {
      const query = (req.query.q as string || '').toLowerCase().trim();
      if (!query) {
        return res.json([]);
      }

      const allContestants = await storage.getContestants();
      const matches = allContestants
        .filter(c => {
          const name = (c.name || '').toLowerCase();
          return name.includes(query);
        })
        .slice(0, 20)
        .map(c => ({
          id: c.id,
          name: c.name || '',
          age: c.age,
          gender: c.gender
        }));

      res.json(matches);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all contestants
  app.get("/api/contestants", async (req, res) => {
    try {
      const allContestants = await storage.getContestants();
      // Debug: log sample of contestants with groupIds
      const withGroups = allContestants.filter(c => c.groupId);
      console.log(`[GET /api/contestants] Total: ${allContestants.length}, with groupId: ${withGroups.length}`);
      if (withGroups.length > 0) {
        console.log('[GET /api/contestants] Sample:', withGroups.slice(0, 2).map(c => ({ name: c.name, groupId: c.groupId })));
      }
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

  // Cross-workspace: DOND episode history for a CELEB contestant
  // Returns all DOND seat assignments for the contestant (matched by same ID).
  // Only meaningful when called from the CELEB workspace; returns [] in DOND.
  app.get("/api/contestants/:id/dond-history", requireAuth, async (req, res) => {
    try {
      const history = await storage.getDondHistoryForContestant(req.params.id);
      res.json(history);
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
      
      // Handle podiumStoryCaseNumber - convert to integer or null
      if ('podiumStoryCaseNumber' in body) {
        const caseNum = body.podiumStoryCaseNumber;
        body.podiumStoryCaseNumber = caseNum === null || caseNum === '' ? null : parseInt(caseNum, 10);
      }
      
      const updated = await storage.updateContestant(req.params.id, body);
      res.json(updated);
    } catch (error: any) {
      console.error('Error updating contestant:', error);
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

  // Create test contestant
  app.post("/api/contestants/test-subject", async (req, res) => {
    try {
      const { name, gender, age, phone, email } = req.body;
      
      if (!name || !gender) {
        return res.status(400).json({ error: "Name and gender are required" });
      }

      const newContestant = await storage.createContestant({
        name: name.trim(),
        gender,
        age: age ? parseInt(age) : null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        availabilityStatus: 'available',
        isTestSubject: true,
      });

      console.log(`[Test Subject] Created test contestant: ${newContestant.name} (ID: ${newContestant.id})`);
      res.json(newContestant);
    } catch (error: any) {
      console.error("[Test Subject] Error creating test contestant:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete contestant (individual)
  app.delete("/api/contestants/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const contestant = await storage.getContestantById(id);
      if (!contestant) {
        return res.status(404).json({ error: "Contestant not found" });
      }

      const isTestSubject = contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(contestant.name);

      if (isTestSubject) {
        // For test subjects, we want a clean wipe of all related data before deleting the contestant
        // This handles foreign key constraints like standby_confirmation_tokens -> standby_assignments
        
        const database = db;
        if (!database) {
          throw new Error("Database connection not available");
        }

        // 1. Delete standby confirmation tokens
        // Must delete tokens FIRST because they reference standby_assignments
        await database.execute(sql`
          DELETE FROM standby_confirmation_tokens 
          WHERE standby_assignment_id IN (
            SELECT id FROM standby_assignments WHERE contestant_id = ${id}
          )
        `);

        // 2. Delete standby assignments
        await database.execute(sql`DELETE FROM standby_assignments WHERE contestant_id = ${id}`);
        
        // 3. Delete booking confirmation tokens and messages
        // Must delete messages FIRST because they reference booking_confirmation_tokens
        await database.execute(sql`
          DELETE FROM booking_messages 
          WHERE confirmation_id IN (
            SELECT id FROM booking_confirmation_tokens 
            WHERE seat_assignment_id IN (
              SELECT id FROM seat_assignments WHERE contestant_id = ${id}
            )
          )
        `);
        // Then delete tokens because they reference seat_assignments
        await database.execute(sql`
          DELETE FROM booking_confirmation_tokens 
          WHERE seat_assignment_id IN (
            SELECT id FROM seat_assignments WHERE contestant_id = ${id}
          )
        `);

        // 4. Delete seat assignments
        await database.execute(sql`DELETE FROM seat_assignments WHERE contestant_id = ${id}`);

        // 5. Delete canceled assignments
        await database.execute(sql`DELETE FROM canceled_assignments WHERE contestant_id = ${id}`);

        // 6. Delete availability tokens
        await database.execute(sql`DELETE FROM availability_tokens WHERE contestant_id = ${id}`);

        // 7. Delete contestant availability
        await database.execute(sql`DELETE FROM contestant_availability WHERE contestant_id = ${id}`);

        // 8. Delete prize winners
        await database.execute(sql`DELETE FROM prize_winners WHERE contestant_id = ${id}`);

        // 9. Delete standby attendance history
        await database.execute(sql`DELETE FROM standby_attendance_history WHERE contestant_id = ${id}`);

        // 10. Delete rebooking history
        await database.execute(sql`DELETE FROM rebooking_history WHERE contestant_id = ${id}`);
        
        // 11. Delete movement history
        await database.execute(sql`DELETE FROM movement_history WHERE contestant_id = ${id}`);
        
        // 12. Remove any group associations
        // We do this by setting group_id to null on the contestant record itself before storage.deleteContestant
        await database.execute(sql`UPDATE contestants SET group_id = NULL WHERE id = ${id}`);
      } else {
        // Check if regular contestant has any seat assignments
        const assignments = await storage.getAllSeatAssignments();
        const hasAssignments = assignments.some((a: any) => a.contestantId === id);
        if (hasAssignments) {
          return res.status(400).json({ error: "Cannot delete contestant with active seat assignments" });
        }
      }

      // Delete movement history for all contestants (not just test subjects)
      const database = db;
      if (database) {
        await database.execute(sql`DELETE FROM movement_history WHERE contestant_id = ${id}`);
      }

      await storage.deleteContestant(id);
      res.json({ message: "Contestant deleted successfully" });
    } catch (error: any) {
      console.error("Delete contestant error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Transfer contestant (and their group + casting card) from DOND into CELEB workspace
  app.post("/api/contestants/:id/transfer-to-celeb", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const workspace = (req as any).session?.activeWorkspace || 'dond';
      if (workspace !== 'dond') {
        return res.status(400).json({ error: "Transfer to CELEB is only available from the DOND workspace" });
      }
      await storage.transferContestantToCeleb(id);
      res.json({ message: "Contestant copied to CELEB workspace successfully" });
    } catch (error: any) {
      console.error("Transfer to CELEB error:", error);
      if (error.message === 'Contestant not found') {
        return res.status(404).json({ error: "Contestant not found" });
      }
      if (error.message?.startsWith('ALREADY_IN_CELEB:')) {
        return res.status(409).json({ error: error.message.split(': ').slice(1).join(': ') });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Create temporary contestant (on-the-fly booking before proper audition/import)
  app.post("/api/contestants/temporary", requireAuth, async (req, res) => {
    try {
      const { name, gender, age, phone, email, notes } = req.body;
      
      if (!name || !gender) {
        return res.status(400).json({ error: "Name and gender are required" });
      }
      
      // Validate gender
      if (!["Male", "Female"].includes(gender)) {
        return res.status(400).json({ error: "Gender must be 'Male' or 'Female'" });
      }
      
      // Normalize phone number (Australian format)
      let normalizedPhone = phone;
      if (phone) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.startsWith('4') && cleaned.length >= 9) {
          normalizedPhone = '0' + cleaned;
        }
      }
      
      const contestantData = {
        name: name.trim(),
        gender,
        age: age ? parseInt(age, 10) : 0,
        phone: normalizedPhone || null,
        email: email?.trim() || null,
        availabilityNotes: notes?.trim() || null,
        isTemporary: true,
        availabilityStatus: 'available' as const,
        groupSize: 1,
      };
      
      const newContestant = await storage.createContestant(contestantData);
      console.log(`[Temporary Contestant] Created: ${name} (ID: ${newContestant.id})`);
      
      res.status(201).json(newContestant);
    } catch (error: any) {
      console.error("[Temporary Contestant] Error:", error);
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

  // Fix legacy declined records - marks canceled assignments with DECLINED reason as wasDeclined=true
  app.post("/api/canceled-assignments/fix-declined", requireAuth, async (req, res) => {
    try {
      // Get all canceled assignments
      const allCanceled = await storage.getCanceledAssignments();
      
      // Find canceled assignments that have DECLINED in reason but wasDeclined is false
      const legacyDeclined = allCanceled.filter(c => 
        c.reason && 
        c.reason.toUpperCase().includes('DECLINED') && 
        !c.wasDeclined
      );
      
      // Update each to have wasDeclined = true
      let fixedCount = 0;
      const fixedRecords: Array<{ id: string; contestantId: string; reason: string }> = [];
      
      for (const canceled of legacyDeclined) {
        await storage.updateCanceledAssignment(canceled.id, { 
          wasDeclined: true,
          declinedAt: canceled.declinedAt || canceled.canceledAt || new Date(),
        });
        fixedCount++;
        fixedRecords.push({
          id: canceled.id,
          contestantId: canceled.contestantId,
          reason: canceled.reason || '',
        });
      }
      
      console.log(`[Fix Declined] Fixed ${fixedCount} legacy declined records`);
      
      res.json({
        message: `Fixed ${fixedCount} legacy declined records`,
        fixedCount,
        totalCanceled: allCanceled.length,
        fixedRecords,
      });
    } catch (error: any) {
      console.error("[Fix Declined] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fix legacy reschedule status - updates contestants in canceled_assignments to have 'rescheduled' status
  app.post("/api/contestants/fix-reschedule-status", requireAuth, async (req, res) => {
    try {
      // Get all canceled assignments
      const allCanceled = await storage.getCanceledAssignments();
      
      // Only get contestant IDs from UNREBOOKED canceled assignments (rebookedToRecordDayId is null)
      const unrebookedContestantIds = [...new Set(
        allCanceled
          .filter((c: any) => !c.rebookedToRecordDayId)
          .map(c => c.contestantId)
      )];
      
      // Get all contestants to check their current status
      const allContestants = await storage.getContestants();
      
      // Find contestants who are in UNREBOOKED canceled_assignments but don't have 'rescheduled' status
      const contestantsToFix = allContestants.filter(c => 
        unrebookedContestantIds.includes(c.id) && 
        c.availabilityStatus !== 'rescheduled'
      );
      
      // Update each contestant's status to 'rescheduled'
      let fixedCount = 0;
      const fixedRecords: Array<{ id: string; name: string; previousStatus: string }> = [];
      
      for (const contestant of contestantsToFix) {
        await storage.updateContestant(contestant.id, { availabilityStatus: 'rescheduled' });
        fixedCount++;
        fixedRecords.push({
          id: contestant.id,
          name: contestant.name,
          previousStatus: contestant.availabilityStatus || 'unknown',
        });
      }
      
      console.log(`[Fix Reschedule Status] Fixed ${fixedCount} contestants`);
      
      res.json({
        message: `Fixed ${fixedCount} contestants to 'rescheduled' status`,
        fixedCount,
        totalInReschedule: unrebookedContestantIds.length,
        fixedRecords,
      });
    } catch (error: any) {
      console.error("[Fix Reschedule Status] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fix rebooked contestants - updates contestants who were rebooked to have 'assigned' status instead of 'rescheduled'
  app.post("/api/contestants/fix-rebooked-status", requireAuth, async (req, res) => {
    try {
      // Get all canceled assignments that have been rebooked
      const allCanceled = await storage.getCanceledAssignments();
      const rebookedContestantIds = [...new Set(
        allCanceled
          .filter((c: any) => c.rebookedToRecordDayId)
          .map(c => c.contestantId)
      )];
      
      // Also get all seat assignments to check who is currently seated
      const allSeatAssignments = await storage.getAllSeatAssignments();
      const seatedContestantIds = new Set(allSeatAssignments.map((a: any) => a.contestantId));
      
      // Get all contestants to check their current status
      const allContestants = await storage.getContestants();
      
      // Find contestants who are rebooked or currently seated but have 'rescheduled' status
      const contestantsToFix = allContestants.filter(c => 
        (rebookedContestantIds.includes(c.id) || seatedContestantIds.has(c.id)) && 
        c.availabilityStatus === 'rescheduled'
      );
      
      // Update each contestant's status to 'assigned'
      let fixedCount = 0;
      const fixedRecords: Array<{ id: string; name: string; previousStatus: string }> = [];
      
      for (const contestant of contestantsToFix) {
        await storage.updateContestant(contestant.id, { availabilityStatus: 'assigned' });
        fixedCount++;
        fixedRecords.push({
          id: contestant.id,
          name: contestant.name,
          previousStatus: contestant.availabilityStatus || 'unknown',
        });
      }
      
      console.log(`[Fix Rebooked Status] Fixed ${fixedCount} contestants from 'rescheduled' to 'assigned'`);
      
      res.json({
        message: `Fixed ${fixedCount} rebooked contestants to 'assigned' status`,
        fixedCount,
        totalRebooked: rebookedContestantIds.length,
        totalSeated: seatedContestantIds.size,
        fixedRecords,
      });
    } catch (error: any) {
      console.error("[Fix Rebooked Status] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fix phone numbers - adds 0 prefix to Australian mobile numbers starting with 4
  app.post("/api/contestants/fix-phone-numbers", requireAuth, async (req, res) => {
    try {
      // Get all contestants
      const allContestants = await storage.getContestants();
      
      // Find contestants with phone numbers starting with "4" (missing the 0 prefix)
      const contestantsToFix = allContestants.filter(c => 
        c.phone && c.phone.trim().startsWith('4')
      );
      
      // Update their phone numbers to have 0 prefix
      let fixedCount = 0;
      const fixedContestants: { id: string; name: string; oldPhone: string; newPhone: string }[] = [];
      
      for (const contestant of contestantsToFix) {
        const oldPhone = contestant.phone!;
        const newPhone = '0' + oldPhone.trim();
        await storage.updateContestant(contestant.id, { phone: newPhone });
        fixedCount++;
        fixedContestants.push({ 
          id: contestant.id, 
          name: contestant.name, 
          oldPhone, 
          newPhone 
        });
      }
      
      console.log(`[Fix Phone Numbers] Fixed ${fixedCount} phone numbers with missing 0 prefix`);
      
      res.json({
        message: `Fixed ${fixedCount} phone numbers`,
        fixedCount,
        fixedContestants
      });
    } catch (error: any) {
      console.error("[Fix Phone Numbers] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fix standbys that were marked as rescheduled but don't have canceled assignment entries
  app.post("/api/standbys/fix-reschedule-entries", requireAuth, async (req, res) => {
    try {
      // Get all standbys
      const allStandbys = await storage.getStandbyAssignments();
      
      // Find standbys that are marked as rescheduled (either via status or movedToReschedule flag)
      const rescheduledStandbys = allStandbys.filter(s => 
        s.status === 'rescheduled' || s.movedToReschedule === true
      );
      
      if (rescheduledStandbys.length === 0) {
        return res.json({
          message: "No rescheduled standbys found",
          fixedCount: 0,
          fixedRecords: [],
        });
      }
      
      // Get all canceled assignments to check which standbys already have entries
      const allCanceled = await storage.getCanceledAssignments();
      const existingContestantIds = new Set(allCanceled.map(c => c.contestantId));
      
      // Find standbys that don't have a canceled assignment entry
      const standbysNeedingFix = rescheduledStandbys.filter(s => 
        !existingContestantIds.has(s.contestantId)
      );
      
      // Create canceled assignment entries for each
      let fixedCount = 0;
      const fixedRecords: Array<{ standbyId: string; contestantId: string; contestantName: string }> = [];
      
      for (const standby of standbysNeedingFix) {
        const wasConfirmedOrCheckedIn = standby.confirmedAt || standby.signedIn || standby.status === 'confirmed';
        const retroFixData: any = {
          contestantId: standby.contestantId,
          recordDayId: standby.recordDayId,
          blockNumber: null,
          seatLabel: standby.assignedToSeat || null,
          reason: standby.notes || 'STANDBY - Moved to reschedule (retroactive fix)',
          isFromStandby: wasConfirmedOrCheckedIn ? true : false,
          originalAttendanceDate: standby.recordDay?.date ? new Date(standby.recordDay.date) : new Date(),
        };
        // Carry over workflow fields from standby
        if (standby.bookingEmailSent) retroFixData.bookingEmailSent = standby.bookingEmailSent;
        if (standby.confirmedRsvp) retroFixData.confirmedRsvp = standby.confirmedRsvp;
        if (standby.paperworkSent) retroFixData.paperworkSent = standby.paperworkSent;
        if (standby.paperworkSentBy) retroFixData.paperworkSentBy = standby.paperworkSentBy;
        if (standby.paperworkReceived) retroFixData.paperworkReceived = standby.paperworkReceived;
        if (standby.paperworkReceivedBy) retroFixData.paperworkReceivedBy = standby.paperworkReceivedBy;
        if (standby.paperworkOnDay) retroFixData.paperworkOnDay = standby.paperworkOnDay;
        
        await storage.createOrUpdateCanceledAssignment(retroFixData);
        
        fixedCount++;
        fixedRecords.push({
          standbyId: standby.id,
          contestantId: standby.contestantId,
          contestantName: standby.contestant?.name || 'Unknown',
        });
      }
      
      console.log(`[Fix Standby Reschedule Entries] Created ${fixedCount} missing canceled assignment entries`);
      
      res.json({
        message: `Created ${fixedCount} missing reschedule entries for standbys`,
        fixedCount,
        totalRescheduledStandbys: rescheduledStandbys.length,
        alreadyHadEntries: rescheduledStandbys.length - standbysNeedingFix.length,
        fixedRecords,
      });
    } catch (error: any) {
      console.error("[Fix Standby Reschedule Entries] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Fix missing movement history entries for standbys moved to reschedule
  app.post("/api/standbys/fix-movement-history", requireAuth, async (req, res) => {
    try {
      // Get all standbys that were moved to reschedule
      const allStandbys = await storage.getStandbyAssignments();
      const rescheduledStandbys = allStandbys.filter(s => 
        s.movedToReschedule === true
      );
      
      if (rescheduledStandbys.length === 0) {
        return res.json({
          message: "No rescheduled standbys found",
          fixedCount: 0,
        });
      }
      
      // Get existing movement history to avoid duplicates
      const existingMovements = await storage.getMovementHistory();
      const existingSet = new Set(
        existingMovements
          .filter(m => m.movementType === 'standby_to_reschedule')
          .map(m => `${m.contestantId}-${m.recordDayId}`)
      );
      
      // Find standbys that don't have movement history entries
      const standbysNeedingFix = rescheduledStandbys.filter(s => 
        !existingSet.has(`${s.contestantId}-${s.recordDayId}`)
      );
      
      let fixedCount = 0;
      const fixedRecords: Array<{ contestantName: string; recordDayDate: string }> = [];
      
      for (const standby of standbysNeedingFix) {
        await storage.logMovement({
          contestantId: standby.contestantId,
          movementType: 'standby_to_reschedule',
          recordDayId: standby.recordDayId,
          notes: 'Standby moved to reschedule list (backfilled)',
          movedBy: 'System (backfill)',
        });
        
        fixedCount++;
        fixedRecords.push({
          contestantName: standby.contestant?.name || 'Unknown',
          recordDayDate: standby.recordDay?.date ? new Date(standby.recordDay.date).toISOString().split('T')[0] : 'Unknown',
        });
      }
      
      console.log(`[Fix Movement History] Created ${fixedCount} missing movement history entries for standbys`);
      
      res.json({
        message: `Created ${fixedCount} missing movement history entries`,
        fixedCount,
        totalRescheduledStandbys: rescheduledStandbys.length,
        alreadyHadEntries: rescheduledStandbys.length - standbysNeedingFix.length,
        fixedRecords,
      });
    } catch (error: any) {
      console.error("[Fix Movement History] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Dashboard seating stats
  app.get("/api/dashboard/seating-stats", async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [allRecordDays, allAssignments, allContestants, allStandbys, allCanceled] = await Promise.all([
        storage.getRecordDays(),
        storage.getAllSeatAssignments(),
        storage.getContestants(),
        storage.getStandbyAssignments(),
        storage.getCanceledAssignments(),
      ]);

      // Unlocked record days = days with no lockedAt (upcoming/in-progress)
      const unlockedDays = allRecordDays.filter(rd => !rd.lockedAt);

      // --- Stat 1: Empty seats for rest of series ---
      const unlockedDayIds = new Set(unlockedDays.map(rd => rd.id));
      const assignmentsOnUnlocked = allAssignments.filter(a => unlockedDayIds.has(a.recordDayId));
      const assignedPerDay = assignmentsOnUnlocked.reduce((acc, a) => {
        acc[a.recordDayId] = (acc[a.recordDayId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const emptySeats = unlockedDays.reduce((sum, rd) => {
        const totalSeats = (rd as any).totalSeats || 154;
        const filled = assignedPerDay[rd.id] || 0;
        return sum + Math.max(0, totalSeats - filled);
      }, 0);

      // --- Stat 2: Available + reschedule pool, not yet assigned to any unlocked day ---
      const contestantIdsOnUnlockedDay = new Set(assignmentsOnUnlocked.map(a => a.contestantId));

      // Reschedule pool: split by R-rated vs non-R
      const rescheduleContestantIdsNonR = new Set(
        allCanceled
          .filter(ca => !ca.rebookedToRecordDayId && (ca as any).contestant?.auditionRating?.toUpperCase().trim() !== 'R')
          .map(ca => ca.contestantId)
      );
      const rescheduleContestantIdsR = new Set(
        allCanceled
          .filter(ca => !ca.rebookedToRecordDayId && (ca as any).contestant?.auditionRating?.toUpperCase().trim() === 'R')
          .map(ca => ca.contestantId)
      );
      const reschedulePool = rescheduleContestantIdsNonR.size;

      // Available non-R contestants not yet on any unlocked day
      const availableUnassignedIdsNonR = new Set(
        allContestants
          .filter(c =>
            c.availabilityStatus === 'available' &&
            !contestantIdsOnUnlockedDay.has(c.id) &&
            c.auditionRating?.toUpperCase().trim() !== 'R'
          )
          .map(c => c.id)
      );

      // Available R-rated contestants not yet on any unlocked day
      const availableUnassignedIdsR = new Set(
        allContestants
          .filter(c =>
            c.availabilityStatus === 'available' &&
            !contestantIdsOnUnlockedDay.has(c.id) &&
            c.auditionRating?.toUpperCase().trim() === 'R'
          )
          .map(c => c.id)
      );

      // Non-R total (available + reschedule, deduped)
      const unassignedContestantIds = new Set([...availableUnassignedIdsNonR, ...rescheduleContestantIdsNonR]);
      const unassignedTotal = unassignedContestantIds.size;

      // R-rated total (available + reschedule, deduped)
      const unassignedRContestantIds = new Set([...availableUnassignedIdsR, ...rescheduleContestantIdsR]);
      const unassignedRTotal = unassignedRContestantIds.size;

      // --- Stat 3: People who have come into studio ONCE (signed in exactly once) ---
      const signedInAssignments = allAssignments.filter(a => (a as any).signedIn != null);
      const signedInCount: Record<string, number> = {};
      for (const a of signedInAssignments) {
        signedInCount[a.contestantId] = (signedInCount[a.contestantId] || 0) + 1;
      }
      // Also include standbys who signed in
      const signedInStandbys = allStandbys.filter(s => (s as any).signedIn != null);
      for (const s of signedInStandbys) {
        signedInCount[s.contestantId] = (signedInCount[s.contestantId] || 0) + 1;
      }
      const studioOnce = Object.values(signedInCount).filter(count => count === 1).length;
      const studioTotal = Object.keys(signedInCount).length;

      // --- Stat 4: Standbys who came in (checked in) but haven't been rebooked ---
      const checkedInStandbyContestantIds = new Set(
        allStandbys.filter(s => (s as any).signedIn != null).map(s => s.contestantId)
      );
      const standbysCameInNotRebooked = [...checkedInStandbyContestantIds].filter(
        cId => !contestantIdsOnUnlockedDay.has(cId)
      ).length;

      // --- Stat 5: Standbys still needed until end of series (10 per unlocked day) ---
      const activeStandbysPerDay = allStandbys
        .filter(s => !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled')
        .reduce((acc, s) => {
          if (unlockedDayIds.has(s.recordDayId)) {
            acc[s.recordDayId] = (acc[s.recordDayId] || 0) + 1;
          }
          return acc;
        }, {} as Record<string, number>);

      const STANDBYS_PER_DAY = 10;
      let standbysStillNeeded = 0;
      for (const rd of unlockedDays) {
        const have = activeStandbysPerDay[rd.id] || 0;
        standbysStillNeeded += Math.max(0, STANDBYS_PER_DAY - have);
      }

      // Total standbys still to attend (those on the list but not yet signed in)
      const totalActiveStandbys = allStandbys.filter(
        s => !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && unlockedDayIds.has(s.recordDayId)
      ).length;

      // --- Stat 6: Returned after attending (attended as regular contestant on 2+ days) ---
      const seatSignInCount: Record<string, number> = {};
      for (const a of allAssignments) {
        if (a.signedIn != null) {
          seatSignInCount[a.contestantId] = (seatSignInCount[a.contestantId] || 0) + 1;
        }
      }
      const returnedAfterAttending = Object.values(seatSignInCount).filter(count => count >= 2).length;

      // --- Stat 7: Returned after attending as standby (signed in as standby, then booked as contestant) ---
      const standbySignedInIds = new Set(
        allStandbys.filter(s => s.signedIn != null).map(s => s.contestantId)
      );
      const contestantIdsWithAnyAssignment = new Set(allAssignments.map(a => a.contestantId));
      const returnedAfterStandby = [...standbySignedInIds].filter(
        id => contestantIdsWithAnyAssignment.has(id)
      ).length;

      res.json({
        emptySeats,
        unlockedDaysCount: unlockedDays.length,
        unassignedTotal,
        unassignedRTotal,
        reschedulePool,
        studioOnce,
        studioTotal,
        standbysCameInNotRebooked,
        standbysStillNeeded,
        totalActiveStandbys,
        standbysPerDay: STANDBYS_PER_DAY,
        returnedAfterAttending,
        returnedAfterStandby,
      });
    } catch (error: any) {
      console.error("Error computing seating stats:", error);
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

  // Get record days that need reminder emails (within 48 hours)
  app.get("/api/record-days/upcoming-reminders", async (req, res) => {
    try {
      const allRecordDays = await storage.getRecordDays();
      const now = new Date();
      const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      
      // Filter record days within the next 48 hours
      // Only show days where at least one reminder type hasn't been sent yet
      const upcomingDays = allRecordDays
        .filter(day => {
          const dayDate = new Date(day.date);
          // Set to 7:30 AM AEDT for the record day
          dayDate.setHours(7, 30, 0, 0);
          const inWindow = dayDate >= now && dayDate <= in48Hours;
          // Exclude days where BOTH contestant AND standby reminders have been sent
          const needsAnyReminder = !day.contestantReminderSentAt || !day.standbyReminderSentAt;
          return inWindow && needsAnyReminder;
        })
        .map(day => ({
          ...day,
          contestantReminderSent: !!day.contestantReminderSentAt,
          standbyReminderSent: !!day.standbyReminderSentAt,
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      res.json(upcomingDays);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Preview reminder email for a record day
  app.get("/api/record-days/:id/preview-reminder", requireAuth, async (req, res) => {
    try {
      const recordDayId = req.params.id;
      const type = req.query.type as string || 'contestant';
      
      // Get record day
      const recordDay = await storage.getRecordDayById(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      
      // Format record date
      const recordDate = new Date(recordDay.date);
      const formattedDate = recordDate.toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      
      // Get email banner as data URL for preview
      let bannerDataUrl = '';
      try {
        const ticketBanner = await storage.getSystemConfig('ticket_email_banner');
        if (ticketBanner) {
          bannerDataUrl = ticketBanner;
        }
      } catch (e) {
        console.log('No banner configured');
      }
      
      if (type === 'standby') {
        // Standby reminder preview
        const reminderHeadline = await storage.getSystemConfig('standby_reminder_headline') || 'Standby Reminder: Be Ready!';
        const reminderIntro = await storage.getSystemConfig('standby_reminder_intro') || 
          'This is a friendly reminder that you are on standby for an upcoming Deal or No Deal recording. Please be prepared to attend if called upon!';
        const reminderFooter = await storage.getSystemConfig('standby_reminder_footer') || 'This is an automated reminder from the Deal or No Deal production team.';
        
        const emailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #2a0a0a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
    <tr>
      <td style="padding: 0; line-height: 0;">
        ${bannerDataUrl ? `<img src="${bannerDataUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />` : ''}
      </td>
    </tr>
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${reminderHeadline}
        </h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 15px;">
                    <p style="color: #856404; font-size: 14px; font-weight: bold; margin: 0;">
                      You are on STANDBY for this record day. We may contact you on the day if a seat becomes available.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hi [Standby Name],
              </p>
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${reminderIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase;">
                      Record Day Details
                    </h2>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">DATE:</strong> ${formattedDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> ${getArrivalTimeText(recordDay.date, '7:30 AM (if called)', { ifCalled: true })}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC 3008
                    </p>
                  </td>
                </tr>
              </table>
              <p style="color: #333333; font-size: 15px; margin: 0 0 5px 0;">
                Please ensure your phone is on and you are available if we need to call you.
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
          ${reminderFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
        
        res.json({ html: emailHtml, type: 'standby' });
      } else {
        // Contestant reminder preview
        const reminderHeadline = await storage.getSystemConfig('contestant_reminder_headline') || 'Reminder: Your Record Day Is Coming Up!';
        const reminderIntro = await storage.getSystemConfig('contestant_reminder_intro') || 
          'This is a friendly reminder that your Deal or No Deal recording is coming up! Please ensure you have all necessary documents ready and arrive on time.';
        const reminderFooter = await storage.getSystemConfig('contestant_reminder_footer') || 'This is an automated reminder from the Deal or No Deal production team.';
        
        const emailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #2a0a0a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto;">
    <tr>
      <td style="padding: 0; line-height: 0;">
        ${bannerDataUrl ? `<img src="${bannerDataUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />` : ''}
      </td>
    </tr>
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${reminderHeadline}
        </h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hi [Contestant Name],
              </p>
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${reminderIntro.split('\n\n').map((paragraph: string) => 
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
                      <strong style="color: #8B0000;">DATE:</strong> ${formattedDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> ${getArrivalTimeText(recordDay.date, '7:30 AM')}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC 3008
                    </p>
                  </td>
                </tr>
              </table>
              <p style="color: #333333; font-size: 15px; margin: 0 0 5px 0;">
                We look forward to seeing you there!
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
          ${reminderFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
        
        res.json({ html: emailHtml, type: 'contestant' });
      }
    } catch (error: any) {
      console.error("Error generating reminder preview:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Send reminder emails to contestants for a record day
  app.post("/api/record-days/:id/send-contestant-reminder", requireAuth, async (req, res) => {
    try {
      const recordDayId = req.params.id;
      
      // Get record day
      const recordDay = await storage.getRecordDayById(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      
      // Validate 48-hour window - can only send reminders within 48 hours of record day
      const now = new Date();
      const recordDate = new Date(recordDay.date);
      recordDate.setHours(7, 30, 0, 0); // 7:30 AM on record day
      const hoursUntilRecordDay = (recordDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilRecordDay > 48) {
        return res.status(400).json({ 
          error: `Reminder emails can only be sent within 48 hours of the record day. This record day is ${Math.round(hoursUntilRecordDay)} hours away.` 
        });
      }
      
      if (hoursUntilRecordDay < 0) {
        return res.status(400).json({ error: "Cannot send reminders for past record days" });
      }
      
      // Get all confirmed seat assignments for this day
      const allAssignments = await storage.getAllSeatAssignments();
      const dayAssignments = allAssignments.filter(a => 
        a.recordDayId === recordDayId && 
        a.confirmedRsvp && 
        a.contestant?.email
      );
      
      if (dayAssignments.length === 0) {
        return res.status(400).json({ error: "No confirmed contestants with email addresses found for this record day" });
      }
      
      // Format record date (reuse recordDate from validation above)
      const formattedDate = recordDate.toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      
      // Get email banner
      let bannerUrl = '';
      let ticketBannerBuffer: Buffer | null = null;
      let ticketBannerFilename = '';
      let ticketBannerContentType = 'image/png';
      let ticketBannerCid = 'ticket-banner';
      
      try {
        const ticketBanner = await storage.getSystemConfig('ticket_email_banner');
        if (ticketBanner && ticketBanner.startsWith('data:')) {
          const match = ticketBanner.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            ticketBannerContentType = match[1];
            ticketBannerBuffer = Buffer.from(match[2], 'base64');
            const ext = ticketBannerContentType.split('/')[1] || 'png';
            ticketBannerFilename = `banner.${ext}`;
            bannerUrl = `cid:${ticketBannerCid}`;
          }
        }
      } catch (e) {
        console.log('No banner configured');
      }
      
      // Get reminder email template settings
      const reminderHeadline = await storage.getSystemConfig('contestant_reminder_headline') || 'Reminder: Your Record Day Is Coming Up!';
      const reminderIntro = await storage.getSystemConfig('contestant_reminder_intro') || 
        'This is a friendly reminder that your Deal or No Deal recording is coming up! Please ensure you have all necessary documents ready and arrive on time.';
      const reminderFooter = await storage.getSystemConfig('contestant_reminder_footer') || 'This is an automated reminder from the Deal or No Deal production team.';
      
      let emailsSent = 0;
      const emailErrors: string[] = [];
      
      for (const assignment of dayAssignments) {
        if (!assignment.contestant?.email) continue;
        
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
        ${bannerUrl ? `<img src="${bannerUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />` : ''}
      </td>
    </tr>
    
    <!-- Gold Title Bar -->
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${reminderHeadline}
        </h1>
      </td>
    </tr>
    
    <!-- Content Card -->
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hi ${assignment.contestant.name.split(' ')[0]},
              </p>
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${reminderIntro.split('\n\n').map((paragraph: string) => 
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
                      <strong style="color: #8B0000;">DATE:</strong> ${formattedDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> ${getArrivalTimeText(recordDay.date, '7:30 AM')}
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
          ${reminderFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

        try {
          const attachments: any[] = [];
          if (ticketBannerBuffer) {
            attachments.push({
              filename: ticketBannerFilename,
              content: ticketBannerBuffer,
              contentType: ticketBannerContentType,
              cid: ticketBannerCid
            });
          }
          
          const senderNameConfig = await storage.getSystemConfig('email_sender_name');
          await sendEmailWithAttachment(
            assignment.contestant.email,
            `Deal or No Deal - Reminder: ${formattedDate}`,
            emailHtml,
            attachments,
            { senderName: senderNameConfig || 'Deal or No Deal' }
          );
          emailsSent++;
        } catch (err: any) {
          emailErrors.push(`${assignment.contestant.name}: ${err.message}`);
        }
      }
      
      // Update record day to mark reminder as sent
      await storage.updateRecordDay(recordDayId, {
        contestantReminderSentAt: new Date(),
      });
      
      res.json({
        success: true,
        message: `Reminder emails sent to ${emailsSent} contestants`,
        emailsSent,
        errors: emailErrors.length > 0 ? emailErrors : undefined
      });
    } catch (error: any) {
      console.error("Error sending contestant reminders:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Send reminder emails to standbys for a record day
  app.post("/api/record-days/:id/send-standby-reminder", requireAuth, async (req, res) => {
    try {
      const recordDayId = req.params.id;
      
      // Get record day
      const recordDay = await storage.getRecordDayById(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      
      // Validate 48-hour window - can only send reminders within 48 hours of record day
      const now = new Date();
      const recordDate = new Date(recordDay.date);
      recordDate.setHours(7, 30, 0, 0); // 7:30 AM on record day
      const hoursUntilRecordDay = (recordDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilRecordDay > 48) {
        return res.status(400).json({ 
          error: `Reminder emails can only be sent within 48 hours of the record day. This record day is ${Math.round(hoursUntilRecordDay)} hours away.` 
        });
      }
      
      if (hoursUntilRecordDay < 0) {
        return res.status(400).json({ error: "Cannot send reminders for past record days" });
      }
      
      // Get all standbys for this day
      const standbys = await storage.getStandbyAssignmentsByRecordDay(recordDayId);
      const confirmedStandbys = standbys.filter(s => 
        (s.status === 'confirmed' || s.status === 'pending' || s.status === 'email_sent') && 
        s.contestant?.email
      );
      
      if (confirmedStandbys.length === 0) {
        return res.status(400).json({ error: "No standbys with email addresses found for this record day" });
      }
      
      // Format record date (reuse recordDate from validation above)
      const formattedDate = recordDate.toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      
      // Get email banner
      let bannerUrl = '';
      let ticketBannerBuffer: Buffer | null = null;
      let ticketBannerFilename = '';
      let ticketBannerContentType = 'image/png';
      let ticketBannerCid = 'ticket-banner';
      
      try {
        const ticketBanner = await storage.getSystemConfig('ticket_email_banner');
        if (ticketBanner && ticketBanner.startsWith('data:')) {
          const match = ticketBanner.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            ticketBannerContentType = match[1];
            ticketBannerBuffer = Buffer.from(match[2], 'base64');
            const ext = ticketBannerContentType.split('/')[1] || 'png';
            ticketBannerFilename = `banner.${ext}`;
            bannerUrl = `cid:${ticketBannerCid}`;
          }
        }
      } catch (e) {
        console.log('No banner configured');
      }
      
      // Get standby reminder email template settings
      const reminderHeadline = await storage.getSystemConfig('standby_reminder_headline') || 'Standby Reminder: Be Ready!';
      const reminderIntro = await storage.getSystemConfig('standby_reminder_intro') || 
        'This is a friendly reminder that you are on standby for an upcoming Deal or No Deal recording. Please be prepared to attend if called upon!';
      const reminderFooter = await storage.getSystemConfig('standby_reminder_footer') || 'This is an automated reminder from the Deal or No Deal production team.';
      
      let emailsSent = 0;
      const emailErrors: string[] = [];
      
      for (const standby of confirmedStandbys) {
        if (!standby.contestant?.email) continue;
        
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
        ${bannerUrl ? `<img src="${bannerUrl}" alt="Deal or No Deal" style="width: 100%; height: auto; display: block;" />` : ''}
      </td>
    </tr>
    
    <!-- Gold Title Bar -->
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 25px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 28px; font-weight: bold; margin: 0; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${reminderHeadline}
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
                      You are on STANDBY for this record day. We may contact you on the day if a seat becomes available.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hi ${standby.contestant.name.split(' ')[0]},
              </p>
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${reminderIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase;">
                      Record Day Details
                    </h2>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">DATE:</strong> ${formattedDate.toUpperCase()}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> ${getArrivalTimeText(recordDay.date, '7:30 AM (if called)', { ifCalled: true })}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC 3008
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #333333; font-size: 15px; margin: 0 0 5px 0;">
                Please ensure your phone is on and you are available if we need to call you.
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
          ${reminderFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

        try {
          const attachments: any[] = [];
          if (ticketBannerBuffer) {
            attachments.push({
              filename: ticketBannerFilename,
              content: ticketBannerBuffer,
              contentType: ticketBannerContentType,
              cid: ticketBannerCid
            });
          }
          
          const senderNameConfig = await storage.getSystemConfig('email_sender_name');
          await sendEmailWithAttachment(
            standby.contestant.email,
            `Deal or No Deal Standby - Reminder: ${formattedDate}`,
            emailHtml,
            attachments,
            { senderName: senderNameConfig || 'Deal or No Deal' }
          );
          emailsSent++;
        } catch (err: any) {
          emailErrors.push(`${standby.contestant.name}: ${err.message}`);
        }
      }
      
      // Update record day to mark standby reminder as sent
      await storage.updateRecordDay(recordDayId, {
        standbyReminderSentAt: new Date(),
      });
      
      res.json({
        success: true,
        message: `Reminder emails sent to ${emailsSent} standbys`,
        emailsSent,
        errors: emailErrors.length > 0 ? emailErrors : undefined
      });
    } catch (error: any) {
      console.error("Error sending standby reminders:", error);
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

  // Helper: Check if a postcode is within Victoria, Australia
  // Victoria postcodes: 3000-3999 (main), 8000-8999 (PO boxes/delivery areas)
  const isVictorianPostcode = (postcode: string | null | undefined): boolean => {
    if (!postcode) return true; // No postcode = allow (unknown location)
    const pc = parseInt(postcode.trim(), 10);
    if (isNaN(pc)) return true; // Invalid postcode = allow
    return (pc >= 3000 && pc <= 3999) || (pc >= 8000 && pc <= 8999);
  };

  // Helper: Check if location string indicates interstate (not Victoria)
  const detectInterstateFromLocation = (location: string | null | undefined): { isInterstate: boolean; state?: string } => {
    if (!location) return { isInterstate: false };
    
    // Check for explicit state indicators (standalone abbreviations only - e.g., ", NSW" or "NSW ")
    // Use stricter patterns to avoid false positives (e.g., matching "sa" in "Horsham")
    if (/\bNSW\b/.test(location) || /\bnew south wales\b/i.test(location)) {
      return { isInterstate: true, state: 'NSW' };
    }
    if (/\bQLD\b/.test(location) || /\bqueensland\b/i.test(location)) {
      return { isInterstate: true, state: 'QLD' };
    }
    // SA/WA/NT require comma or space before to avoid false positives
    if (/[,\s]SA\b/.test(location) || /\bsouth australia\b/i.test(location)) {
      return { isInterstate: true, state: 'SA' };
    }
    if (/[,\s]WA\b/.test(location) || /\bwestern australia\b/i.test(location)) {
      return { isInterstate: true, state: 'WA' };
    }
    if (/\bTAS\b/.test(location) || /\btasmania\b/i.test(location)) {
      return { isInterstate: true, state: 'TAS' };
    }
    if (/[,\s]NT\b/.test(location) || /\bnorthern territory\b/i.test(location)) {
      return { isInterstate: true, state: 'NT' };
    }
    if (/\bACT\b/.test(location) || /\bcanberra\b/i.test(location)) {
      return { isInterstate: true, state: 'ACT' };
    }
    
    // Check for known interstate cities
    const interstateCities = [
      { pattern: /\bsydney\b/i, state: 'NSW' },
      { pattern: /\bbrisbane\b/i, state: 'QLD' },
      { pattern: /\badelaide\b/i, state: 'SA' },
      { pattern: /\bperth\b/i, state: 'WA' },
      { pattern: /\bhobart\b/i, state: 'TAS' },
      { pattern: /\bdarwin\b/i, state: 'NT' },
      { pattern: /\bgold coast\b/i, state: 'QLD' },
      { pattern: /\bnewcastle\b/i, state: 'NSW' },
      { pattern: /\bwollongong\b/i, state: 'NSW' },
      { pattern: /\bcairns\b/i, state: 'QLD' },
      { pattern: /\btownsville\b/i, state: 'QLD' },
      { pattern: /\blaunceston\b/i, state: 'TAS' },
      { pattern: /\balice springs\b/i, state: 'NT' },
    ];
    
    for (const { pattern, state } of interstateCities) {
      if (pattern.test(location)) {
        return { isInterstate: true, state };
      }
    }
    
    return { isInterstate: false };
  };

  // Combined check for whether a contestant is from outside Victoria
  const isContestantInterstate = (contestant: { postcode?: string | null; location?: string | null }): { isInterstate: boolean; state?: string } => {
    // First check postcode
    if (contestant.postcode) {
      const pc = parseInt(contestant.postcode.trim(), 10);
      if (!isNaN(pc)) {
        // Not Victorian postcode
        if (!((pc >= 3000 && pc <= 3999) || (pc >= 8000 && pc <= 8999))) {
          let state = 'Interstate';
          if (pc >= 1000 && pc <= 2999) state = 'NSW';
          else if (pc >= 4000 && pc <= 4999) state = 'QLD';
          else if (pc >= 5000 && pc <= 5999) state = 'SA';
          else if (pc >= 6000 && pc <= 6999) state = 'WA';
          else if (pc >= 7000 && pc <= 7999) state = 'TAS';
          else if (pc >= 800 && pc <= 899) state = 'NT';
          else if ((pc >= 200 && pc <= 299) || (pc >= 2600 && pc <= 2618)) state = 'ACT';
          return { isInterstate: true, state };
        }
      }
    }
    
    // Then check location string
    return detectInterstateFromLocation(contestant.location);
  };

  const DOCKLANDS_COORDS = { lat: -37.8150, lng: 144.9460 };

  const POSTCODE_COORDINATES: Record<string, { lat: number; lng: number }> = {
    "3000": { lat: -37.8128, lng: 144.9633 }, "3001": { lat: -37.8308, lng: 144.9692 },
    "3002": { lat: -37.8397, lng: 144.9557 }, "3003": { lat: -37.8235, lng: 144.9872 },
    "3004": { lat: -37.8435, lng: 144.9892 }, "3006": { lat: -37.8000, lng: 144.9500 },
    "3011": { lat: -37.7800, lng: 144.8500 }, "3008": { lat: -37.7867, lng: 144.8633 },
    "3181": { lat: -37.8600, lng: 145.0067 }, "3182": { lat: -37.8750, lng: 145.0233 },
    "3183": { lat: -37.8933, lng: 145.0400 }, "3142": { lat: -37.8533, lng: 145.0100 },
    "3141": { lat: -37.8667, lng: 145.0167 }, "3144": { lat: -37.8600, lng: 145.0500 },
    "3187": { lat: -37.8867, lng: 144.9467 }, "3205": { lat: -37.8533, lng: 144.9200 },
    "3207": { lat: -37.8000, lng: 144.8800 }, "3012": { lat: -37.8267, lng: 144.8600 },
    "3014": { lat: -37.8667, lng: 144.7867 }, "3013": { lat: -37.8433, lng: 144.8067 },
    "3051": { lat: -37.7667, lng: 144.9667 }, "3053": { lat: -37.7533, lng: 145.0167 },
    "3054": { lat: -37.7667, lng: 145.0533 }, "3068": { lat: -37.7333, lng: 145.0500 },
    "3031": { lat: -37.7300, lng: 144.9200 }, "3056": { lat: -37.7067, lng: 144.9833 },
    "3070": { lat: -37.6867, lng: 145.0333 }, "3165": { lat: -37.9200, lng: 145.2300 },
    "3174": { lat: -37.9500, lng: 145.3800 }, "3168": { lat: -38.0200, lng: 145.0800 },
    "3175": { lat: -38.1200, lng: 145.2700 }, "3170": { lat: -38.1500, lng: 145.3500 },
    "3806": { lat: -38.0167, lng: 145.3833 }, "3805": { lat: -38.0333, lng: 145.3000 },
    "3804": { lat: -38.0500, lng: 145.2500 }, "3910": { lat: -38.3000, lng: 145.1500 },
    "3912": { lat: -38.3500, lng: 145.1800 }, "3915": { lat: -38.3800, lng: 145.2000 },
    "3783": { lat: -37.8700, lng: 145.5500 }, "3810": { lat: -38.0200, lng: 145.4200 },
    "3978": { lat: -37.9000, lng: 145.5200 }, "3821": { lat: -38.1000, lng: 145.6000 },
    "3981": { lat: -38.2500, lng: 145.6500 }, "3813": { lat: -37.9800, lng: 145.5500 },
    "3754": { lat: -38.1500, lng: 145.1200 }, "3803": { lat: -38.3000, lng: 145.0500 },
    "3015": { lat: -37.9000, lng: 144.6600 }, "3030": { lat: -37.9200, lng: 144.7500 },
    "3026": { lat: -37.8700, lng: 144.6300 }, "3032": { lat: -37.7800, lng: 144.6500 },
    "3064": { lat: -37.6800, lng: 144.5800 }, "3038": { lat: -37.7300, lng: 144.3300 },
    "3342": { lat: -37.8200, lng: 144.1500 }, "3370": { lat: -37.7800, lng: 143.9500 },
    "3097": { lat: -37.6500, lng: 144.4000 }, "3350": { lat: -37.5500, lng: 143.8000 },
    "3341": { lat: -37.4800, lng: 144.8000 }, "3024": { lat: -37.6000, lng: 144.9000 },
    "3022": { lat: -37.5800, lng: 144.8500 }, "3040": { lat: -37.6700, lng: 145.3500 },
    "3037": { lat: -37.6200, lng: 145.2000 }, "3134": { lat: -37.7500, lng: 145.4800 },
    "3161": { lat: -37.9200, lng: 145.0900 }, "3077": { lat: -37.7000, lng: 145.2500 },
    "3088": { lat: -37.6500, lng: 145.3000 }, "3149": { lat: -37.7800, lng: 145.2000 },
    "3124": { lat: -37.8100, lng: 145.3200 }, "3135": { lat: -37.8000, lng: 145.4000 },
    "3957": { lat: -37.6000, lng: 144.3000 },
  };

  const MELBOURNE_METRO_POSTCODES = new Set([
    ...Array.from({ length: 11 }, (_, i) => String(3000 + i)),
    ...Array.from({ length: 90 }, (_, i) => String(3011 + i)),
    ...Array.from({ length: 100 }, (_, i) => String(3100 + i)),
    ...Array.from({ length: 15 }, (_, i) => String(3800 + i)),
  ]);

  const calculateDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const isContestantOver60km = (contestant: { postcode?: string | null; location?: string | null }): boolean => {
    const location = contestant.location;
    const postcode = contestant.postcode;
    
    const checkPostcode = (pc: string): boolean | null => {
      const coords = POSTCODE_COORDINATES[pc];
      if (coords) {
        return calculateDistanceKm(DOCKLANDS_COORDS.lat, DOCKLANDS_COORDS.lng, coords.lat, coords.lng) > 60;
      }
      const code = parseInt(pc, 10);
      if (code >= 3000 && code <= 3999) {
        return !MELBOURNE_METRO_POSTCODES.has(pc);
      }
      return null;
    };

    if (postcode) {
      const result = checkPostcode(postcode.trim());
      if (result !== null) return result;
    }

    if (location) {
      const postcodeMatch = location.match(/\b(\d{4})\b/);
      if (postcodeMatch) {
        const result = checkPostcode(postcodeMatch[1]);
        if (result !== null) return result;
      }
    }

    return false;
  };

  // Create a seat assignment
  app.post("/api/seat-assignments", async (req, res) => {
    try {
      const { recordDayId, contestantId, blockNumber, seatLabel, playerType, seatedAsBlockType, seatedFromStandby, standbyMovementNotes, skipPostcodeWarning, allowReturning, allowWinner } = req.body;

      if (!recordDayId || !contestantId || !blockNumber || !seatLabel) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Check block configuration is complete
      //   DOND:  5 PB + 2 NPB
      //   CELEB: all 7 AUDIENCE (Playing is tracked on the Podium tab)
      const blockConfig = await storage.isBlockConfigurationComplete(recordDayId);
      if (!blockConfig.complete) {
        const ws = (req as any).session?.activeWorkspace || 'dond';
        return res.status(400).json({
          error: ws === 'celeb'
            ? "Block configuration incomplete. All 7 CELEB blocks should be Audience — try reloading the page so it auto-repairs."
            : "Block configuration incomplete. You must select 5 Playing Blocks (PB) and 2 Non-Playing Blocks (NPB) before booking seats.",
          code: "BLOCK_CONFIG_INCOMPLETE",
          current: { pbCount: blockConfig.pbCount, npbCount: blockConfig.npbCount, audienceCount: blockConfig.audienceCount }
        });
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

      // Check if contestant is from interstate (checks both postcode and location string)
      // This requires confirmation from the user (skipPostcodeWarning must be true)
      if (contestant && !skipPostcodeWarning) {
        const interstateCheck = isContestantInterstate({ postcode: contestant.postcode, location: contestant.location });
        if (interstateCheck.isInterstate) {
          return res.status(422).json({ 
            error: `${contestant.name} is from ${interstateCheck.state || 'outside Victoria'}. Interstate contestants require confirmation. Are you sure you want to book them?`,
            code: "OUTSIDE_VICTORIA",
            requiresConfirmation: true,
            contestantName: contestant.name,
            postcode: contestant.postcode,
            state: interstateCheck.state
          });
        }
      }

      // Check for duplicate assignments - contestant should not be seated in ANY record day
      // Allow returning contestants (those only assigned on locked/completed record days)
      const allAssignments = await storage.getAllSeatAssignments();
      const existingAssignment = allAssignments.find((a: any) => a.contestantId === contestantId);
      if (existingAssignment) {
        const existingRecordDay = await storage.getRecordDayById(existingAssignment.recordDayId);
        const isOnLockedDay = existingRecordDay?.lockedAt != null;
        const dayName = existingRecordDay?.date 
          ? new Date(existingRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
          : 'another day';
        
        if (isOnLockedDay && allowReturning) {
          // Warn (but don't hard-block) if the contestant has prize case winnings on their previous appearance.
          // Prize column (spin-the-wheel prizes) does NOT count — only cash winnings.
          if (!allowWinner) {
            const sa = existingAssignment;
            const hasCashWinnings =
              (sa.winningMoneyAmount != null && sa.winningMoneyAmount > 0) ||
              (sa.winningMoneyText && sa.winningMoneyText.trim());
            if (hasCashWinnings) {
              const amountStr = sa.winningMoneyAmount != null && sa.winningMoneyAmount > 0
                ? `$${sa.winningMoneyAmount.toLocaleString()}`
                : sa.winningMoneyText || 'an amount';
              return res.status(409).json({
                error: `${contestant?.name || 'Contestant'} previously won ${amountStr} in prize case winnings.`,
                isWinner: true,
                contestantName: contestant?.name,
                winnerAmount: sa.winningMoneyAmount ?? null,
                winnerText: sa.winningMoneyText ?? null,
              });
            }
          }
          // Allowed - returning contestant (no cash winnings, or winner override accepted)
        } else if (isOnLockedDay && !allowReturning) {
          const label = existingRecordDay?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${contestant?.name || 'Contestant'} previously appeared on ${label} (${dayName}). Rebook as returning contestant?`,
            isReturning: true,
            contestantName: contestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        } else {
          return res.status(409).json({ error: `Contestant is already seated in ${dayName} (Block ${existingAssignment.blockNumber}, Seat ${existingAssignment.seatLabel})` });
        }
      }
      
      // Also get assignments for this record day to check seat occupancy
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      
      // Check if contestant is a standby for ANY record day (not just this one)
      const allStandbys = await storage.getStandbyAssignments();
      // Only consider ACTIVE standbys (not already seated, rescheduled, or moved to reschedule)
      // so stale records from past episodes don't shadow current active ones
      const standbyAssignment = allStandbys.find((s: any) =>
        s.contestantId === contestantId && !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && s.status !== 'attended'
      );
      
      // Allow seating if they're being seated from standby (status 'seated') or moved to reschedule
      // Otherwise, block if they have an active standby assignment anywhere
      if (standbyAssignment && !standbyAssignment.movedToReschedule && standbyAssignment.status !== 'seated' && standbyAssignment.status !== 'attended') {
        const standbyRecordDay = await storage.getRecordDayById(standbyAssignment.recordDayId);
        const isStandbyOnLockedDay = standbyRecordDay?.lockedAt != null;
        const dayName = standbyRecordDay?.date 
          ? new Date(standbyRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
          : 'another day';
        
        if (isStandbyOnLockedDay && allowReturning) {
          // Allowed - returning contestant who was a standby on a completed episode
        } else if (isStandbyOnLockedDay && !allowReturning) {
          const label = standbyRecordDay?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${contestant?.name || 'Contestant'} previously attended ${label} (${dayName}) as standby. Rebook as returning contestant?`,
            isReturning: true,
            contestantName: contestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        } else {
          return res.status(409).json({ error: `Contestant is already a standby for ${dayName}. Remove them from standbys first.` });
        }
      }
      
      // Check if seat is already occupied
      const isSeatOccupied = existingAssignments.some((a: any) => 
        a.blockNumber === parseInt(blockNumber) && a.seatLabel === seatLabel
      );
      if (isSeatOccupied) {
        return res.status(409).json({ error: "This seat is already occupied" });
      }

      // Check for previous canceled assignments to carry over workflow status
      const canceledAssignments = await storage.getCanceledAssignments();
      // Find any reschedule entry for this contestant (for workflow field carryover)
      const previousCanceledWithWorkflow = canceledAssignments.find(
        (c: any) => c.contestantId === contestantId && (c.paperworkSent || c.paperworkReceived || c.bookingEmailSent || c.confirmedRsvp || c.paperworkOnDay)
      );
      // Find any reschedule entry for this contestant (to remove them from reschedule)
      const anyPreviousCanceled = canceledAssignments.find(
        (c: any) => c.contestantId === contestantId
      );

      // Build the assignment data
      const assignmentData: any = {
        recordDayId,
        contestantId,
        blockNumber: parseInt(blockNumber),
        seatLabel,
        playerType,
        seatedAsBlockType: seatedAsBlockType || undefined,
        seatedFromStandby: seatedFromStandby === true,
        standbyMovementNotes: standbyMovementNotes || undefined,
      };

      // When seating from standby, carry over paperwork fields only (not email/confirmation state)
      if (standbyAssignment && seatedFromStandby) {
        if (standbyAssignment.paperworkSent) assignmentData.paperworkSent = standbyAssignment.paperworkSent;
        if (standbyAssignment.paperworkReceived) assignmentData.paperworkReceived = standbyAssignment.paperworkReceived;
        if (standbyAssignment.paperworkOnDay) assignmentData.paperworkOnDay = standbyAssignment.paperworkOnDay;
        if (standbyAssignment.signedIn) assignmentData.signedIn = standbyAssignment.signedIn;
        if (standbyAssignment.otdNotes) assignmentData.otdNotes = standbyAssignment.otdNotes;
        if (standbyAssignment.attendingWithOverride) assignmentData.attendingWithOverride = standbyAssignment.attendingWithOverride;
        if (standbyAssignment.mobilityNotesOverride) assignmentData.mobilityNotesOverride = standbyAssignment.mobilityNotesOverride;
      }
      // When rebooking from reschedule, carry over paperwork fields only (not email/confirmation state)
      else if (previousCanceledWithWorkflow) {
        if (previousCanceledWithWorkflow.paperworkSent) assignmentData.paperworkSent = previousCanceledWithWorkflow.paperworkSent;
        if (previousCanceledWithWorkflow.paperworkSentBy) assignmentData.paperworkSentBy = previousCanceledWithWorkflow.paperworkSentBy;
        if (previousCanceledWithWorkflow.paperworkReceived) assignmentData.paperworkReceived = previousCanceledWithWorkflow.paperworkReceived;
        if (previousCanceledWithWorkflow.paperworkReceivedBy) assignmentData.paperworkReceivedBy = previousCanceledWithWorkflow.paperworkReceivedBy;
        if (previousCanceledWithWorkflow.paperworkOnDay) assignmentData.paperworkOnDay = previousCanceledWithWorkflow.paperworkOnDay;
      }

      const assignment = await storage.createSeatAssignment(assignmentData);

      // Update contestant status to assigned
      await storage.updateContestantAvailability(contestantId, 'assigned');

      // Update reschedule entry if contestant was on reschedule list
      if (anyPreviousCanceled) {
        const rebookedBy = (req as any).session?.username || 'system';
        await storage.updateCanceledAssignment(anyPreviousCanceled.id, {
          rebookedToRecordDayId: recordDayId,
          rebookedAt: new Date(),
          rebookedBy: rebookedBy,
        });

        // Also update any partners who were rebooked together with this contestant
        if (anyPreviousCanceled.groupId) {
          const groupMembers = canceledAssignments.filter(
            (c: any) => c.groupId === anyPreviousCanceled.groupId && c.id !== anyPreviousCanceled.id && !c.rebookedToRecordDayId
          );
          
          for (const member of groupMembers) {
            // Check if this member was also just seated in the same record day
            const isSeatedInSameDay = existingAssignments.some((a: any) => a.contestantId === member.contestantId);
            if (isSeatedInSameDay) {
              await storage.updateCanceledAssignment(member.id, {
                rebookedToRecordDayId: recordDayId,
                rebookedAt: new Date(),
                rebookedBy: rebookedBy,
              });
            }
          }
        }
      }

      // CLEANUP: Mark stale active standbys for this contestant as 'seated'
      // Excludes terminal states ('seated', 'attended', 'rescheduled') to preserve audit history
      const staleStandbys = allStandbys.filter(
        (s: any) => s.contestantId === contestantId
          && s.status !== 'seated'
          && s.status !== 'attended'
          && s.status !== 'rescheduled'
      );
      for (const sb of staleStandbys) {
        await storage.updateStandbyAssignment(sb.id, { status: 'seated' });
      }

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
      if (error.message?.startsWith('CONTESTANT_ALREADY_ACTIVE:')) {
        return res.status(409).json({ error: error.message.split(': ')[1] });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Create overflow seat assignment ("To Seat on Day" - not assigned to a physical seat)
  app.post("/api/seat-assignments/overflow", async (req, res) => {
    try {
      const { recordDayId, contestantId, skipPostcodeWarning, allowReturning, allowWinner } = req.body;

      if (!recordDayId || !contestantId) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Check if contestant is DNU-rated
      const contestant = await storage.getContestantById(contestantId);
      if (contestant?.auditionRating?.toUpperCase().trim() === 'DNU') {
        return res.status(400).json({ error: "Cannot add a DNU-rated contestant (Do Not Use)" });
      }

      // Interstate check
      if (contestant && !skipPostcodeWarning) {
        const interstateCheck = isContestantInterstate({ postcode: contestant.postcode, location: contestant.location });
        if (interstateCheck.isInterstate) {
          return res.status(422).json({ 
            error: `${contestant.name} is from ${interstateCheck.state || 'outside Victoria'}. Interstate contestants require confirmation.`,
            code: "OUTSIDE_VICTORIA",
            requiresConfirmation: true,
            contestantName: contestant.name,
            postcode: contestant.postcode,
            state: interstateCheck.state
          });
        }
      }

      // Check for duplicate assignments - contestant should not be seated in ANY record day
      // Allow returning contestants (those only assigned on locked/completed record days)
      const allAssignments = await storage.getAllSeatAssignments();
      const existingAssignment = allAssignments.find((a: any) => a.contestantId === contestantId);
      if (existingAssignment) {
        const existingRecordDay = await storage.getRecordDayById(existingAssignment.recordDayId);
        const isOnLockedDay = existingRecordDay?.lockedAt != null;
        const dayName = existingRecordDay?.date 
          ? new Date(existingRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
          : 'another day';
        
        if (isOnLockedDay && allowReturning) {
          // Warn (but don't hard-block) if the contestant has prize case winnings.
          // Prize column (spin-the-wheel prizes) does NOT count — only cash winnings.
          if (!allowWinner) {
            const sa = existingAssignment;
            const hasCashWinnings =
              (sa.winningMoneyAmount != null && sa.winningMoneyAmount > 0) ||
              (sa.winningMoneyText && sa.winningMoneyText.trim());
            if (hasCashWinnings) {
              const amountStr = sa.winningMoneyAmount != null && sa.winningMoneyAmount > 0
                ? `$${sa.winningMoneyAmount.toLocaleString()}`
                : sa.winningMoneyText || 'an amount';
              return res.status(409).json({
                error: `${contestant?.name || 'Contestant'} previously won ${amountStr} in prize case winnings.`,
                isWinner: true,
                contestantName: contestant?.name,
                winnerAmount: sa.winningMoneyAmount ?? null,
                winnerText: sa.winningMoneyText ?? null,
              });
            }
          }
          // Allowed - returning contestant (no cash winnings, or winner override accepted)
        } else if (isOnLockedDay && !allowReturning) {
          const label = existingRecordDay?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${contestant?.name || 'Contestant'} previously appeared on ${label} (${dayName}). Add as returning overflow?`,
            isReturning: true,
            contestantName: contestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        } else {
          return res.status(409).json({ error: `Contestant is already seated/assigned in ${dayName}` });
        }
      }
      
      // Check if contestant is a standby for ANY record day
      const allStandbys = await storage.getStandbyAssignments();
      // Only consider ACTIVE standbys so stale past-episode records don't shadow current ones
      const standbyAssignment = allStandbys.find((s: any) =>
        s.contestantId === contestantId && !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && s.status !== 'attended'
      );
      if (standbyAssignment && !standbyAssignment.movedToReschedule && standbyAssignment.status !== 'seated' && standbyAssignment.status !== 'attended') {
        const standbyRecordDay = await storage.getRecordDayById(standbyAssignment.recordDayId);
        const isStandbyOnLockedDay = standbyRecordDay?.lockedAt != null;
        const dayName = standbyRecordDay?.date 
          ? new Date(standbyRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
          : 'another day';
        
        if (isStandbyOnLockedDay && allowReturning) {
          // Allowed - returning contestant who was a standby on a completed episode
        } else if (isStandbyOnLockedDay && !allowReturning) {
          const label = standbyRecordDay?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${contestant?.name || 'Contestant'} previously attended ${label} (${dayName}) as standby. Add as returning overflow?`,
            isReturning: true,
            contestantName: contestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        } else {
          return res.status(409).json({ error: `Contestant is already a standby for ${dayName}. Remove them from standbys first.` });
        }
      }

      // Generate the next OS# seat label for this record day
      const existingAssignmentsForDay = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      const overflowAssignments = existingAssignmentsForDay.filter((a: any) => a.blockNumber === 0);
      let maxOsNum = 0;
      overflowAssignments.forEach((a: any) => {
        const match = a.seatLabel?.match(/^OS(\d+)$/);
        if (match) {
          maxOsNum = Math.max(maxOsNum, parseInt(match[1]));
        }
      });
      const seatLabel = `OS${maxOsNum + 1}`;

      // Check for previous canceled assignments to carry over workflow status
      const canceledAssignments = await storage.getCanceledAssignments();
      const previousCanceledWithWorkflow = canceledAssignments.find(
        (c: any) => c.contestantId === contestantId && (c.paperworkSent || c.paperworkReceived || c.bookingEmailSent || c.confirmedRsvp || c.paperworkOnDay)
      );
      const anyPreviousCanceled = canceledAssignments.find(
        (c: any) => c.contestantId === contestantId
      );

      const assignmentData: any = {
        recordDayId,
        contestantId,
        blockNumber: 0,
        seatLabel,
      };

      // Carry over paperwork fields from reschedule only (not email/confirmation state)
      if (previousCanceledWithWorkflow) {
        if (previousCanceledWithWorkflow.paperworkSent) assignmentData.paperworkSent = previousCanceledWithWorkflow.paperworkSent;
        if (previousCanceledWithWorkflow.paperworkSentBy) assignmentData.paperworkSentBy = previousCanceledWithWorkflow.paperworkSentBy;
        if (previousCanceledWithWorkflow.paperworkReceived) assignmentData.paperworkReceived = previousCanceledWithWorkflow.paperworkReceived;
        if (previousCanceledWithWorkflow.paperworkReceivedBy) assignmentData.paperworkReceivedBy = previousCanceledWithWorkflow.paperworkReceivedBy;
        if (previousCanceledWithWorkflow.paperworkOnDay) assignmentData.paperworkOnDay = previousCanceledWithWorkflow.paperworkOnDay;
      }

      const assignment = await storage.createSeatAssignment(assignmentData);

      // Update contestant status to assigned
      await storage.updateContestantAvailability(contestantId, 'assigned');

      // Update reschedule entry if contestant was on reschedule list
      if (anyPreviousCanceled) {
        const rebookedBy = (req as any).session?.username || 'system';
        await storage.updateCanceledAssignment(anyPreviousCanceled.id, {
          rebookedToRecordDayId: recordDayId,
          rebookedAt: new Date(),
          rebookedBy: rebookedBy,
        });

        // Also update any partners who were rebooked together with this contestant
        // This handles cases where a group rebook was performed but the other members' 
        // reschedule entries weren't updated yet.
        if (anyPreviousCanceled.groupId) {
          const groupMembers = canceledAssignments.filter(
            (c: any) => c.groupId === anyPreviousCanceled.groupId && c.id !== anyPreviousCanceled.id && !c.rebookedToRecordDayId
          );
          
          for (const member of groupMembers) {
            // Check if this member was also just seated in the same record day
            const isSeatedInSameDay = existingAssignments.some((a: any) => a.contestantId === member.contestantId);
            if (isSeatedInSameDay) {
              await storage.updateCanceledAssignment(member.id, {
                rebookedToRecordDayId: recordDayId,
                rebookedAt: new Date(),
                rebookedBy: rebookedBy,
              });
            }
          }
        }
      }

      // CLEANUP: Mark stale active standbys for this contestant as 'seated'
      // Excludes terminal states ('seated', 'attended', 'rescheduled') to preserve audit history
      const staleStandbysOverflow = allStandbys.filter(
        (s: any) => s.contestantId === contestantId
          && s.status !== 'seated'
          && s.status !== 'attended'
          && s.status !== 'rescheduled'
      );
      for (const sb of staleStandbysOverflow) {
        await storage.updateStandbyAssignment(sb.id, { status: 'seated' });
      }

      res.json(assignment);
    } catch (error: any) {
      if (error.message?.startsWith('CONTESTANT_ALREADY_ACTIVE:')) {
        return res.status(409).json({ error: error.message.split(': ')[1] });
      }
      if (error.message?.startsWith('CONTESTANT_CONFLICT:')) {
        return res.status(409).json({ error: 'This contestant was just assigned by another user. Please refresh.' });
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

      // Check block configuration is complete (DOND: 5 PB + 2 NPB, CELEB: 7 AUDIENCE)
      const blockConfig = await storage.isBlockConfigurationComplete(recordDayId);
      if (!blockConfig.complete) {
        const ws = (req as any).session?.activeWorkspace || 'dond';
        return res.status(400).json({
          error: ws === 'celeb'
            ? "Block configuration incomplete. All 7 CELEB blocks should be Audience — try reloading the page so it auto-repairs."
            : "Block configuration incomplete. You must select 5 Playing Blocks (PB) and 2 Non-Playing Blocks (NPB) before booking seats.",
          code: "BLOCK_CONFIG_INCOMPLETE",
          current: { pbCount: blockConfig.pbCount, npbCount: blockConfig.npbCount, audienceCount: blockConfig.audienceCount }
        });
      }

      if (!Array.isArray(contestantIds) || contestantIds.length < 2 || contestantIds.length > 4) {
        return res.status(400).json({ error: "Must provide 2-4 contestants for group seating" });
      }

      // Check if any contestant is DNU-rated (Do Not Use) or from interstate
      const { skipPostcodeWarning } = req.body;
      for (const contestantId of contestantIds) {
        const contestant = await storage.getContestantById(contestantId);
        if (contestant?.auditionRating?.toUpperCase().trim() === 'DNU') {
          return res.status(400).json({ error: `Cannot seat ${contestant.name} - they are DNU-rated (Do Not Use)` });
        }
        // Check if contestant is from interstate - require confirmation
        if (contestant && !skipPostcodeWarning) {
          const interstateCheck = isContestantInterstate({ postcode: contestant.postcode, location: contestant.location });
          if (interstateCheck.isInterstate) {
            return res.status(422).json({ 
              error: `${contestant.name} is from ${interstateCheck.state || 'outside Victoria'}. Interstate contestants require confirmation. Are you sure you want to book them?`,
              code: "OUTSIDE_VICTORIA",
              requiresConfirmation: true,
              contestantName: contestant.name,
              postcode: contestant.postcode,
              state: interstateCheck.state
            });
          }
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

      // Check for duplicate assignments - contestant should not be seated or standby in ANY record day
      const allAssignments = await storage.getAllSeatAssignments();
      const existingAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      const allStandbys = await storage.getStandbyAssignments();
      
      // Check if any contestant is already seated in ANY record day or a standby in ANY record day
      // Allow returning contestants (those only assigned on locked/completed record days)
      const allowReturning = req.body.allowReturning === true;
      const recordDaysCache = new Map<string, RecordDay>();
      
      for (const contestantId of contestantIds) {
        const existingAssignment = allAssignments.find((a: any) => a.contestantId === contestantId);
        if (existingAssignment) {
          // Check if existing assignment is on a locked (completed) record day
          let existingRecordDay = recordDaysCache.get(existingAssignment.recordDayId);
          if (!existingRecordDay) {
            const rd = await storage.getRecordDayById(existingAssignment.recordDayId);
            if (rd) {
              existingRecordDay = rd;
              recordDaysCache.set(rd.id, rd);
            }
          }
          
          const isOnLockedDay = existingRecordDay?.lockedAt != null;
          
          if (isOnLockedDay && allowReturning) {
            // Allowed - this is a returning contestant being rebooked
          } else if (isOnLockedDay && !allowReturning) {
            // On a locked day but not explicitly allowed - return special status so frontend can show confirmation
            const contestant = await storage.getContestantById(contestantId);
            const dayName = existingRecordDay?.date 
              ? new Date(existingRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
              : 'another day';
            const label = existingRecordDay?.rxNumber || dayName;
            return res.status(409).json({ 
              error: `${contestant?.name || 'Contestant'} previously appeared on ${label} (${dayName}). Rebook as returning contestant?`,
              isReturning: true,
              contestantName: contestant?.name,
              previousDay: dayName,
              previousLabel: label,
            });
          } else {
            // On an unlocked day - regular block
            const contestant = await storage.getContestantById(contestantId);
            const dayName = existingRecordDay?.date 
              ? new Date(existingRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
              : 'another day';
            return res.status(409).json({ error: `${contestant?.name || 'Contestant'} is already seated in ${dayName} (Block ${existingAssignment.blockNumber}, Seat ${existingAssignment.seatLabel})` });
          }
        }
        
        // Only consider ACTIVE standbys so stale past-episode records don't shadow current ones
        const standbyAssignment = allStandbys.find((s: any) =>
          s.contestantId === contestantId && !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && s.status !== 'attended'
        );
        if (standbyAssignment && !standbyAssignment.movedToReschedule && standbyAssignment.status !== 'seated' && standbyAssignment.status !== 'attended') {
          const standbyRecordDay = await storage.getRecordDayById(standbyAssignment.recordDayId);
          const isStandbyOnLockedDay = standbyRecordDay?.lockedAt != null;
          
          if (isStandbyOnLockedDay && allowReturning) {
            // Allowed - returning contestant who was a standby on a completed episode
          } else if (isStandbyOnLockedDay && !allowReturning) {
            const contestant = await storage.getContestantById(contestantId);
            const dayName = standbyRecordDay?.date 
              ? new Date(standbyRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
              : 'another day';
            const label = standbyRecordDay?.rxNumber || dayName;
            return res.status(409).json({ 
              error: `${contestant?.name || 'Contestant'} previously attended ${label} (${dayName}) as standby. Rebook as returning contestant?`,
              isReturning: true,
              contestantName: contestant?.name,
              previousDay: dayName,
              previousLabel: label,
            });
          } else {
            const contestant = await storage.getContestantById(contestantId);
            const dayName = standbyRecordDay?.date 
              ? new Date(standbyRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
              : 'another day';
            return res.status(409).json({ error: `${contestant?.name || 'A contestant'} is already a standby for ${dayName}. Remove them from standbys first.` });
          }
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
        
        // Check for previous canceled assignments to carry over workflow status
        const previousCanceled = allCanceledAssignments.find(
          (c: any) => c.contestantId === contestantId && (c.paperworkSent || c.paperworkReceived || c.bookingEmailSent || c.confirmedRsvp || c.paperworkOnDay)
        );
        // Also find any canceled assignment for this contestant (to update rebook status)
        const anyCanceled = allCanceledAssignments.find(
          (c: any) => c.contestantId === contestantId
        );
        
        const bulkAssignData: any = {
          recordDayId,
          contestantId,
          blockNumber: parseInt(blockNumber),
          seatLabel: seatLabels[i],
        };
        if (previousCanceled) {
          if (previousCanceled.paperworkSent) bulkAssignData.paperworkSent = previousCanceled.paperworkSent;
          if (previousCanceled.paperworkSentBy) bulkAssignData.paperworkSentBy = previousCanceled.paperworkSentBy;
          if (previousCanceled.paperworkReceived) bulkAssignData.paperworkReceived = previousCanceled.paperworkReceived;
          if (previousCanceled.paperworkReceivedBy) bulkAssignData.paperworkReceivedBy = previousCanceled.paperworkReceivedBy;
          if (previousCanceled.paperworkOnDay) bulkAssignData.paperworkOnDay = previousCanceled.paperworkOnDay;
        }
        
        const assignment = await storage.createSeatAssignment(bulkAssignData);
        assignments.push(assignment);
        
        // Update contestant status to assigned
        await storage.updateContestantAvailability(contestantId, 'assigned');
        
        // Update reschedule entry if contestant was on reschedule list
        if (anyCanceled) {
          const rebookedBy = (req as any).session?.username || 'system';
          await storage.updateCanceledAssignment(anyCanceled.id, {
            rebookedToRecordDayId: recordDayId,
            rebookedAt: new Date(),
            rebookedBy: rebookedBy,
          });
        }

        // CLEANUP: Mark stale active standbys for this contestant as 'seated'
        // Excludes terminal states ('seated', 'attended', 'rescheduled') to preserve audit history
        const staleStandbysBulk = allStandbys.filter(
          (s: any) => s.contestantId === contestantId
            && s.status !== 'seated'
            && s.status !== 'attended'
            && s.status !== 'rescheduled'
        );
        for (const sb of staleStandbysBulk) {
          await storage.updateStandbyAssignment(sb.id, { status: 'seated' });
        }
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
      if (error.message?.startsWith('CONTESTANT_ALREADY_ACTIVE:')) {
        return res.status(409).json({ error: error.message.split(': ')[1] });
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

  // Get all availability responses (for dashboard deadlines)
  app.get("/api/availability-responses", async (req, res) => {
    try {
      const responses = await storage.getAllAvailabilityResponses();
      res.json(responses);
    } catch (error: any) {
      console.error("Error fetching availability responses:", error);
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

      const isWinner = (a: any) => {
        const hasValidRole = a.winningMoneyRole && typeof a.winningMoneyRole === 'string' && a.winningMoneyRole.trim() !== '';
        const hasValidAmount = typeof a.winningMoneyAmount === 'number' && a.winningMoneyAmount >= 0;
        return hasValidRole && hasValidAmount;
      };

      // Fetch all three sources in parallel
      const [allAssignments, allCanceled, allIssues] = await Promise.all([
        storage.getAllSeatAssignments(),
        storage.getCanceledAssignments(),
        storage.getAttendanceIssues(),
      ]);

      const recordDays = await storage.getRecordDays();
      const recordDaysMap = new Map(recordDays.map(rd => [rd.id, rd]));
      const contestants = await storage.getContestants();
      const contestantsMap = new Map(contestants.map(c => [c.id, c]));

      const mapToWinner = (a: any, source: 'seat' | 'canceled' | 'issue') => {
        const contestant = contestantsMap.get(a.contestantId);
        const recordDay = recordDaysMap.get(a.recordDayId);
        return {
          id: `${source}:${a.id}`,
          source,
          recordDayId: a.recordDayId,
          recordDayDate: recordDay?.date ? new Date(recordDay.date).toLocaleDateString() : '',
          recordDayDateISO: recordDay?.date ? new Date(recordDay.date).toISOString() : '',
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
          winningMoneyText: a.winningMoneyText,
          caseAmount: a.caseAmount,
          quickCash: a.quickCash ?? null,
          bankOfferTaken: a.bankOfferTaken,
          spinTheWheel: a.spinTheWheel,
          prize: a.prize,
          txNumber: a.txNumber || '',
          txDate: a.txDate || '',
          notifiedOfTx: a.notifiedOfTx,
          photosSent: a.photosSent,
        };
      };

      // Seat assignments with winning money (contestants still in their seats)
      const fromSeats = allAssignments.filter(isWinner).map(a => mapToWinner(a, 'seat'));

      // Canceled assignments with winning money (rescheduled/rebooked contestants)
      const fromCanceled = allCanceled.filter(isWinner).map(a => mapToWinner(a, 'canceled'));

      // Attendance issues with winning money (no-shows / early leavers who won)
      const fromIssues = allIssues.filter(isWinner).map(a => mapToWinner(a, 'issue'));

      // Merge — deduplicate by contestantId + recordDayId, preferring 'seat' over 'canceled' over 'issue'
      const seen = new Map<string, any>();
      const priority: Record<string, number> = { seat: 0, canceled: 1, issue: 2 };
      for (const w of [...fromSeats, ...fromCanceled, ...fromIssues]) {
        const key = `${w.contestantId}:${w.recordDayId}`;
        const existing = seen.get(key);
        if (!existing || priority[w.source] < priority[existing.source]) {
          seen.set(key, w);
        }
      }

      res.json(Array.from(seen.values()));
    } catch (error: any) {
      console.error("Error fetching winners data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export winners data to Excel file
  // IMPORTANT: This route MUST be before :recordDayId to avoid being captured as a param
  app.get("/api/seat-assignments/with-winning-money/export", async (req, res) => {
    try {
      const isWinner = (a: any) => {
        const hasValidRole = a.winningMoneyRole && typeof a.winningMoneyRole === 'string' && a.winningMoneyRole.trim() !== '';
        const hasValidAmount = typeof a.winningMoneyAmount === 'number' && a.winningMoneyAmount >= 0;
        return hasValidRole && hasValidAmount;
      };

      // Fetch all three sources in parallel (same logic as /with-winning-money route)
      const [allAssignments, allCanceled, allIssues] = await Promise.all([
        storage.getAllSeatAssignments(),
        storage.getCanceledAssignments(),
        storage.getAttendanceIssues(),
      ]);

      const recordDays = await storage.getRecordDays();
      const recordDaysMap = new Map(recordDays.map(rd => [rd.id, rd]));
      const contestants = await storage.getContestants();
      const contestantsMap = new Map(contestants.map(c => [c.id, c]));

      // Merge all sources, deduplicate by contestantId + recordDayId (seat takes priority)
      const allWinnersRaw: any[] = [
        ...allAssignments.filter(isWinner).map(a => ({ ...a, _source: 'seat' })),
        ...allCanceled.filter(isWinner).map(a => ({ ...a, _source: 'canceled' })),
        ...allIssues.filter(isWinner).map(a => ({ ...a, _source: 'issue' })),
      ];
      const seen = new Map<string, any>();
      const priority: Record<string, number> = { seat: 0, canceled: 1, issue: 2 };
      for (const w of allWinnersRaw) {
        const key = `${w.contestantId}:${w.recordDayId}`;
        const existing = seen.get(key);
        if (!existing || priority[w._source] < priority[existing._source]) {
          seen.set(key, w);
        }
      }
      const winnersRaw = Array.from(seen.values());

      const winnersData = winnersRaw.map((a) => {
        const contestant = contestantsMap.get(a.contestantId);
        const recordDay = recordDaysMap.get(a.recordDayId);
        return {
          'RX Date': recordDay?.date ? new Date(recordDay.date).toLocaleDateString() : '',
          'RX Day': a.rxNumber || '',
          'RX Ep No.': a.rxEpNumber || '',
          'Contestant Type': a.winningMoneyRole === 'player' ? 'Player' : 'Case',
          'Contestant Name': contestant?.name,
          'Phone': contestant?.phone || '',
          'Email': contestant?.email || '',
          'Case Number': a.caseNumber || '',
          'Case Amount': a.caseAmount || '',
          'Bank Offer Taken': a.bankOfferTaken ? 'Yes' : 'No',
          'Spin the Wheel': a.spinTheWheel ? 'Yes' : 'No',
          'Wheel Prize': a.prize || '',
          'Amount Won': a.winningMoneyAmount || '',
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
      // Fetch assignments and standbys in parallel (both filtered to this record day)
      const [assignments, standbys] = await Promise.all([
        storage.getSeatAssignmentsByRecordDay(req.params.recordDayId),
        storage.getStandbyAssignmentsByRecordDay(req.params.recordDayId),
      ]);

      const seatedStandbyContestantIds = new Set(
        standbys.filter(s => s.status === 'seated').map(s => s.contestantId)
      );
      
      // Load only the contestants that appear in these assignments (+ their group members).
      // Avoids fetching all 692 contestants when only a few dozen are assigned to this day.
      const assignedContestantIds = assignments.map(a => a.contestantId);
      const contestantsData = await storage.getContestantsForAssignments(assignedContestantIds);
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
      const assignedIdSet = new Set(assignedContestantIds);
      const nameToIdMapForThisDay = new Map<string, string[]>();
      contestantsData.forEach(c => {
        if (c.name && assignedIdSet.has(c.id)) {
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
          paperworkOnDay: assignment.paperworkOnDay,
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
          medicalInfo: contestant?.medicalInfo,
          wasStandby: seatedStandbyContestantIds.has(assignment.contestantId),
          isFromReschedule: contestant?.availabilityStatus === 'rescheduled',
          photoUrl: contestant?.photoUrl,
          contestantLocation: contestant?.location,
          criminalRecord: contestant?.criminalRecord,
          isTemporary: contestant?.isTemporary || false,
          isTestSubject: contestant?.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(contestant?.name || ''),
          podiumStory: contestant?.podiumStory,
          podiumStoryNote: contestant?.podiumStoryNote,
          podiumStoryCaseNumber: contestant?.podiumStoryCaseNumber,
          attendingWithOverride: assignment.attendingWithOverride,
          mobilityNotesOverride: assignment.mobilityNotesOverride,
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

      console.log(`[Auto-assign] Request body:`, JSON.stringify(req.body));
      console.log(`[Auto-assign] selectedBlocks:`, selectedBlocks);

      if (!recordDayId) {
        return res.status(400).json({ error: "recordDayId is required" });
      }

      // Check block configuration is complete (DOND: 5 PB + 2 NPB, CELEB: 7 AUDIENCE)
      const blockConfig = await storage.isBlockConfigurationComplete(recordDayId);
      if (!blockConfig.complete) {
        const ws = (req as any).session?.activeWorkspace || 'dond';
        return res.status(400).json({
          error: ws === 'celeb'
            ? "Block configuration incomplete. All 7 CELEB blocks should be Audience — try reloading the page so it auto-repairs."
            : "Block configuration incomplete. You must select 5 Playing Blocks (PB) and 2 Non-Playing Blocks (NPB) before auto-assigning seats.",
          code: "BLOCK_CONFIG_INCOMPLETE",
          current: { pbCount: blockConfig.pbCount, npbCount: blockConfig.npbCount, audienceCount: blockConfig.audienceCount }
        });
      }

      // Validate selected blocks if provided
      const validBlocks = selectedBlocks && Array.isArray(selectedBlocks) && selectedBlocks.length > 0
        ? selectedBlocks.filter(b => b >= 1 && b <= 7)
        : [1, 2, 3, 4, 5, 6, 7]; // Default to all blocks
      
      console.log(`[Auto-assign] validBlocks after filtering:`, validBlocks);

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
      
      // Filter: include ONLY contestants with "available" status
      // IMPORTANT: "rescheduled" contestants are EXCLUDED from auto-assign - they must be manually booked
      // via the Contestants page or Reschedule page to ensure proper tracking and control
      let availableAll = allContestants.filter((c) => c.availabilityStatus === "available");
      
      // ROBUST CHECK: Also exclude any contestant in the canceled_assignments table (reschedule list)
      // This catches cases where a contestant was moved to reschedule but their status wasn't updated
      const canceledForRescheduleCheck = await storage.getCanceledAssignments();
      const rescheduledContestantIds = new Set(canceledForRescheduleCheck.map(ca => ca.contestantId));
      availableAll = availableAll.filter(c => !rescheduledContestantIds.has(c.id));
      
      // Get existing seat assignments for this record day to exclude already-assigned contestants
      const currentAssignments = await storage.getSeatAssignmentsByRecordDay(recordDayId);
      const alreadyAssignedIds = new Set(currentAssignments.map(a => a.contestantId));
      availableAll = availableAll.filter(c => !alreadyAssignedIds.has(c.id));
      
      // Exclude contestants who are standbys for ANY record day (not just this one)
      // This ensures standby-tagged contestants are never auto-assigned
      const allStandbyAssignments = await storage.getStandbyAssignments();
      const allStandbyContestantIds = new Set(
        allStandbyAssignments
          .filter((s: any) => !s.movedToReschedule && s.status !== 'seated')
          .map(s => s.contestantId)
      );
      availableAll = availableAll.filter(c => !allStandbyContestantIds.has(c.id));
      
      // Exclude contestants marked as "available for standby" from import
      // These contestants should only be manually assigned as standbys, not auto-assigned to seats
      availableAll = availableAll.filter(c => !c.availableForStandby);
      
      // Exclude temporary contestants - they should only be manually assigned
      const tempContestantsBefore = availableAll.filter(c => c.isTemporary === true);
      availableAll = availableAll.filter(c => c.isTemporary !== true);
      if (tempContestantsBefore.length > 0) {
        console.log(`[Auto-assign] Excluded ${tempContestantsBefore.length} temporary contestants`);
      }

      // Exclude R-rated contestants - they must be manually assigned
      const rRatedBefore = availableAll.filter(c => c.auditionRating?.toUpperCase().trim() === 'R');
      availableAll = availableAll.filter(c => c.auditionRating?.toUpperCase().trim() !== 'R');
      if (rRatedBefore.length > 0) {
        console.log(`[Auto-assign] Excluded ${rRatedBefore.length} R-rated contestants`);
      }
      
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
      
      // Helper to generate seat labels - blocks 4, 5, 6 have reversed numbering (1-5 from right to left)
      const getSeatLabel = (rowLabel: string, visualPosition: number, rowCount: number, blockNumber: number): string => {
        // For blocks 4, 5, 6 (1-indexed), reverse the numbering
        // Visual position 1 (leftmost) gets the highest number
        const isReversedBlock = blockNumber >= 4 && blockNumber <= 6;
        const seatNumber = isReversedBlock ? (rowCount - visualPosition + 1) : visualPosition;
        return `${rowLabel}${seatNumber}`;
      };

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

      // Helper: Check if a contestant has blocking conditions that prevent auto-assignment
      const hasBlockingCondition = (c: typeof allContestants[0]): { blocked: boolean; reason: string } => {
        // Block temporary contestants - they should only be manually assigned
        if (c.isTemporary === true) {
          return { blocked: true, reason: 'temporary contestant' };
        }
        if (c.auditionRating === 'A' || c.auditionRating === 'A+') {
          return { blocked: true, reason: 'A/A+ rated' };
        }
        if (c.auditionRating?.toUpperCase().trim() === 'DNU') {
          return { blocked: true, reason: 'DNU rated' };
        }
        if (c.auditionRating?.toUpperCase().trim() === 'P') {
          return { blocked: true, reason: 'P rated' };
        }
        if (c.podiumStory === true) {
          return { blocked: true, reason: 'has podium story' };
        }
        // Block interstate contestants using the shared helper (checks both postcode and location)
        const interstateCheck = isContestantInterstate({ postcode: c.postcode, location: c.location });
        if (interstateCheck.isInterstate) {
          console.log(`[Auto-assign] Blocking interstate contestant: ${c.name} (Postcode: ${c.postcode}, Location: ${c.location}, State: ${interstateCheck.state})`);
          return { blocked: true, reason: `interstate (${interstateCheck.state || 'outside Victoria'})` };
        }
        return { blocked: false, reason: '' };
      };

      // Build a map of groupId -> ALL contestants in that group (from full list, not just available)
      const fullGroupIdToContestants = new Map<string, typeof allContestants>();
      allContestants.forEach(c => {
        if (c.groupId) {
          if (!fullGroupIdToContestants.has(c.groupId)) {
            fullGroupIdToContestants.set(c.groupId, []);
          }
          fullGroupIdToContestants.get(c.groupId)!.push(c);
        }
      });

      // PHASE 1A: First, create groups from existing groupId field (most reliable)
      // CRITICAL: If ANY member of the group has blocking conditions, skip the ENTIRE group
      const groupIdEntries = Array.from(groupIdToContestants.entries());
      for (const [gId, members] of groupIdEntries) {
        // Check ALL members of this group (from full contestant list) for blocking conditions
        const fullGroupMembers = fullGroupIdToContestants.get(gId) || members;
        const blockedMember = fullGroupMembers.find(m => hasBlockingCondition(m).blocked);
        
        if (blockedMember) {
          // Entire group is blocked - mark all available members as having unavailable partners
          const blockReason = hasBlockingCondition(blockedMember);
          members.forEach((member: typeof available[0]) => {
            contestantsWithUnavailablePartners.add(member.id);
          });
          console.log(`[Auto-assign] Skipping entire group (${members.map((m: typeof available[0]) => m.name).join(', ')}) - member ${blockedMember.name} ${blockReason.reason}`);
          continue;
        }
        
        // No blocking conditions - check eligibility for auto-assign (already filtered from available)
        const eligibleMembers = members.filter((m: typeof available[0]) => m.auditionRating !== 'A' && m.auditionRating !== 'A+');
        if (eligibleMembers.length > 1) {
          const groupId = `dbgroup-${gId}`;
          groupMap.set(groupId, eligibleMembers);
          eligibleMembers.forEach((member: typeof available[0]) => groupedContestantIds.add(member.id));
          console.log(`[Auto-assign] Created group from groupId: ${eligibleMembers.map((m: typeof available[0]) => `${m.name}(${m.auditionRating})`).join(' + ')}`);
        } else if (eligibleMembers.length === 1 && members.length > 1) {
          // Has a group partner but they're not eligible - can't auto-assign
          contestantsWithUnavailablePartners.add(eligibleMembers[0].id);
          console.log(`[Auto-assign] Skipping ${eligibleMembers[0].name} - group partner not eligible`);
        }
      }

      // Helper function to check if attendingWith indicates a true solo
      // Uses shared isSoloContestant for consistent solo detection across the system
      const isSoloIndicator = (value: string | null | undefined): boolean => {
        return isSoloContestant(value);
      };

      // Build a full name lookup for ALL contestants (to check blocking conditions on partners)
      const fullNameToContestant = new Map<string, typeof allContestants[0]>();
      allContestants.forEach(c => {
        const key = sharedNormalizeName(c.name);
        fullNameToContestant.set(key, c);
      });

      // PHASE 1B: Find groups based on attendingWith matching (with bidirectional verification for duplicate names)
      // CRITICAL: If any partner has blocking conditions, the whole group is blocked
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

          // First, check if ANY partner in the full contestant list has blocking conditions
          let hasBlockedPartner = false;
          let blockedPartnerInfo = '';
          for (const name of attendingWithNames) {
            const fullPartner = fullNameToContestant.get(name);
            if (fullPartner) {
              const blockCheck = hasBlockingCondition(fullPartner);
              if (blockCheck.blocked) {
                hasBlockedPartner = true;
                blockedPartnerInfo = `${fullPartner.name} ${blockCheck.reason}`;
                break;
              }
            }
          }

          if (hasBlockedPartner) {
            // Partner has blocking condition - skip this contestant
            contestantsWithUnavailablePartners.add(contestant.id);
            console.log(`[Auto-assign] Skipping ${contestant.name} - partner ${blockedPartnerInfo}`);
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
          // Incompatible group - EXCLUDE ENTIRELY (don't split, don't place)
          // A/A+/B+ can only go to PB blocks, C can only go to NPB blocks
          // These ratings are fundamentally incompatible, so the whole group must be skipped
          console.log(`[Auto-assign] EXCLUDING incompatible group: ${members.map((m: typeof available[0]) => `${m.name}(${m.auditionRating})`).join(' + ')} - A/B+ and C members cannot be placed together in any block type`);
          // Don't add to finalGroupMap - effectively excludes the entire group
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
      
      // Log all group bundles for debugging
      if (groupBundles.length > 0) {
        console.log(`[Auto-assign] Group bundles:`);
        groupBundles.forEach(g => {
          console.log(`  - ${g.id}: ${g.contestants.map(c => `${c.name}(${c.auditionRating})`).join(' + ')} [hasCRating=${g.hasCRating}]`);
        });
      }

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
            
            // CONSTRAINT: NPB blocks cannot have contestants over 60km from Docklands
            const hasOver60km = bundle.contestants.some(c => isContestantOver60km({ postcode: c.postcode, location: c.location }));
            if (hasOver60km) return false;
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
            
            // CONSTRAINT: NPB blocks cannot have contestants over 60km from Docklands
            const hasOver60km = solo.contestants.some(c => isContestantOver60km({ postcode: c.postcode, location: c.location }));
            if (hasOver60km) return false;
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
      // allowedRowIndices: if provided, only search in those rows (e.g., [3, 4] for rows D and E)
      const assignSeatsToBundle = (
        bundle: GroupBundle,
        blockNumber: number,
        rowState: { currentRow: number; positionInRow: number },
        usedSeats: Set<string>,
        allowedRowIndices?: number[]
      ): { seatLabels: string[]; newRowState: { currentRow: number; positionInRow: number }; success: boolean } => {
        const seatLabels: string[] = [];
        const bundleSize = bundle.size;
        let { currentRow, positionInRow } = rowState;
        
        // Helper to check if a row is allowed
        const isRowAllowed = (rowIdx: number) => {
          if (!allowedRowIndices || allowedRowIndices.length === 0) return true;
          return allowedRowIndices.includes(rowIdx);
        };
        
        // If current row is not allowed, skip to first allowed row
        if (!isRowAllowed(currentRow)) {
          const firstAllowed = allowedRowIndices?.find(idx => idx >= currentRow);
          if (firstAllowed !== undefined) {
            currentRow = firstAllowed;
            positionInRow = 0;
          } else {
            // No allowed rows available
            return { seatLabels: [], newRowState: rowState, success: false };
          }
        }
        
        // Try to fit group in current row first (in remaining space)
        if (currentRow < ROWS.length && isRowAllowed(currentRow)) {
          const row = ROWS[currentRow];
          
          // Find consecutive empty seats in current row starting from positionInRow
          let consecutiveEmpty = 0;
          let startPos = -1;
          
          for (let pos = positionInRow; pos < row.count; pos++) {
            const checkLabel = getSeatLabel(row.label, pos + 1, row.count, blockNumber);
            if (usedSeats.has(checkLabel)) {
              // Hit an occupied seat, reset count
              consecutiveEmpty = 0;
              startPos = -1;
            } else {
              if (startPos === -1) startPos = pos;
              consecutiveEmpty++;
              if (consecutiveEmpty >= bundleSize) {
                // Found enough consecutive empty seats!
                for (let i = 0; i < bundleSize; i++) {
                  const assignedLabel = getSeatLabel(row.label, startPos + i + 1, row.count, blockNumber);
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
        
        // Doesn't fit in current row - find next allowed row with enough consecutive empty seats
        currentRow++;
        
        while (currentRow < ROWS.length) {
          // Skip rows that are not allowed
          if (!isRowAllowed(currentRow)) {
            currentRow++;
            continue;
          }
          
          const row = ROWS[currentRow];
          let consecutiveEmpty = 0;
          let firstEmptyPos = -1;
          
          // Count consecutive empty seats in this row from the start
          for (let pos = 0; pos < row.count; pos++) {
            const checkSeat = getSeatLabel(row.label, pos + 1, row.count, blockNumber);
            if (usedSeats.has(checkSeat)) {
              consecutiveEmpty = 0;
              firstEmptyPos = -1;
            } else {
              if (firstEmptyPos === -1) firstEmptyPos = pos;
              consecutiveEmpty++;
              if (consecutiveEmpty >= bundleSize) {
                // Found enough consecutive empty seats!
                positionInRow = firstEmptyPos;
                for (let i = 0; i < bundleSize; i++) {
                  const seatLabel = getSeatLabel(row.label, positionInRow + 1, row.count, blockNumber);
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
          // C-rated contestants can ONLY be placed in rows D and E (indices 3 and 4)
          const allowedRows = bundle.hasCRating ? [3, 4] : undefined;
          const result = assignSeatsToBundle(bundle, block.blockNumber, rowState, usedSeats, allowedRows);
          
          if (!result.success) {
            // Skip this bundle - no capacity left in block (or no allowed rows available)
            console.log(`Skipping bundle in block ${block.blockNumber} - no seat capacity${bundle.hasCRating ? ' (C-rated, restricted to rows D/E)' : ''}`);
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
          
          // Log group placements with row info
          if (bundle.size > 1) {
            console.log(`[Auto-assign] Group placed in Block ${block.blockNumber}: ${bundle.contestants.map((c, i) => `${c.name}(${c.auditionRating}) -> ${result.seatLabels[i]}`).join(', ')} [hasCRating=${bundle.hasCRating}, allowedRows=${allowedRows ? allowedRows.map(i => ROWS[i]?.label).join(',') : 'any'}]`);
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
            const seatLabel = getSeatLabel(row.label, i, row.count, blockNumber);
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
        
        // Find all empty seats in this block, separated by row position
        // Front rows (A, B) for B+ contestants, back rows (D, E) for B contestants
        const frontRowSeats: string[] = []; // Rows A, B
        const middleRowSeats: string[] = []; // Row C
        const backRowSeats: string[] = []; // Rows D, E
        
        for (const row of ROWS) {
          for (let i = 1; i <= row.count; i++) {
            const seatLabel = getSeatLabel(row.label, i, row.count, block.blockNumber);
            if (!occupiedSeatsInBlock.has(seatLabel)) {
              if (row.label === 'A' || row.label === 'B') {
                frontRowSeats.push(seatLabel);
              } else if (row.label === 'C') {
                middleRowSeats.push(seatLabel);
              } else {
                backRowSeats.push(seatLabel);
              }
            }
          }
        }
        
        // Helper function to place a solo contestant in a specific seat
        const placeSoloInSeat = (contestant: typeof remainingSolos[0], seatLabel: string) => {
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
          
          solosPlacedInBlock++;
          console.log(`[Auto-assign] BACKFILL: Placed solo ${contestant.name} (${contestant.auditionRating}) in Block ${block.blockNumber} seat ${seatLabel} (${solosPlacedInBlock}/${MAX_SOLOS_PER_BLOCK})`);
        };
        
        // Helper to check if contestant is eligible for this block
        const isEligibleForBlock = (c: typeof remainingSolos[0]) => {
          const isAOrBPlus = c.auditionRating === 'A' || c.auditionRating === 'B+';
          const isCRated = c.auditionRating === 'C';
          
          // NPB blocks can ONLY have B and C ratings
          if (block.blockType === 'NPB' && isAOrBPlus) return false;
          
          // NPB blocks cannot have contestants over 60km from Docklands
          if (block.blockType === 'NPB' && isContestantOver60km({ postcode: c.postcode, location: c.location })) return false;
          
          // C-rated can ONLY go to NPB blocks
          if (isCRated && block.blockType !== 'NPB') return false;
          
          // Check C-rated limit per NPB block
          if (isCRated && block.blockType === 'NPB') {
            const currentCCount = block.ratingCounts['C'];
            if (currentCCount >= MAX_C_PER_NPB) return false;
          }
          
          return true;
        };
        
        // Different placement logic for PB vs NPB blocks
        if (block.blockType === 'NPB') {
          // NPB: B → front rows, C → back rows
          
          // PHASE 1: Place B contestants in front rows (A, B)
          while (frontRowSeats.length > 0 && solosPlacedInBlock < MAX_SOLOS_PER_BLOCK) {
            const currentInBlock = plan.filter(p => p.blockNumber === block.blockNumber).length + 
                                  existingAssignments.filter(a => a.blockNumber === block.blockNumber).length;
            if (currentInBlock >= maxSeats) break;
            
            const bIdx = remainingSolos.findIndex(c => c.auditionRating === 'B' && isEligibleForBlock(c));
            if (bIdx !== -1) {
              const contestant = remainingSolos[bIdx];
              const seatLabel = frontRowSeats.shift()!;
              placeSoloInSeat(contestant, seatLabel);
              remainingSolos.splice(bIdx, 1);
            } else {
              break;
            }
          }
          
          // PHASE 2: Place C contestants in back rows (D, E)
          while (backRowSeats.length > 0 && solosPlacedInBlock < MAX_SOLOS_PER_BLOCK) {
            const currentInBlock = plan.filter(p => p.blockNumber === block.blockNumber).length + 
                                  existingAssignments.filter(a => a.blockNumber === block.blockNumber).length;
            if (currentInBlock >= maxSeats) break;
            
            const cIdx = remainingSolos.findIndex(c => c.auditionRating === 'C' && isEligibleForBlock(c));
            if (cIdx !== -1) {
              const contestant = remainingSolos[cIdx];
              const seatLabel = backRowSeats.shift()!;
              placeSoloInSeat(contestant, seatLabel);
              remainingSolos.splice(cIdx, 1);
            } else {
              break;
            }
          }
        } else {
          // PB: B+ → front rows, B → back rows
          
          // PHASE 1: Place B+ contestants in front rows (A, B)
          while (frontRowSeats.length > 0 && solosPlacedInBlock < MAX_SOLOS_PER_BLOCK) {
            const currentInBlock = plan.filter(p => p.blockNumber === block.blockNumber).length + 
                                  existingAssignments.filter(a => a.blockNumber === block.blockNumber).length;
            if (currentInBlock >= maxSeats) break;
            
            const bPlusIdx = remainingSolos.findIndex(c => c.auditionRating === 'B+' && isEligibleForBlock(c));
            if (bPlusIdx !== -1) {
              const contestant = remainingSolos[bPlusIdx];
              const seatLabel = frontRowSeats.shift()!;
              placeSoloInSeat(contestant, seatLabel);
              remainingSolos.splice(bPlusIdx, 1);
            } else {
              break;
            }
          }
          
          // PHASE 2: Place B contestants in back rows (D, E)
          while (backRowSeats.length > 0 && solosPlacedInBlock < MAX_SOLOS_PER_BLOCK) {
            const currentInBlock = plan.filter(p => p.blockNumber === block.blockNumber).length + 
                                  existingAssignments.filter(a => a.blockNumber === block.blockNumber).length;
            if (currentInBlock >= maxSeats) break;
            
            const bIdx = remainingSolos.findIndex(c => c.auditionRating === 'B' && isEligibleForBlock(c));
            if (bIdx !== -1) {
              const contestant = remainingSolos[bIdx];
              const seatLabel = backRowSeats.shift()!;
              placeSoloInSeat(contestant, seatLabel);
              remainingSolos.splice(bIdx, 1);
            } else {
              break;
            }
          }
        }
        
        // PHASE 3: Fill remaining seats with any eligible contestants (middle rows and leftovers)
        // IMPORTANT: C-rated contestants can ONLY go in back rows (D, E)
        const remainingSeats = [...middleRowSeats, ...frontRowSeats, ...backRowSeats];
        for (const seatLabel of remainingSeats) {
          if (solosPlacedInBlock >= MAX_SOLOS_PER_BLOCK) {
            console.log(`[Auto-assign] Block ${block.blockNumber}: Solo limit reached (${MAX_SOLOS_PER_BLOCK})`);
            break;
          }
          
          const currentInBlock = plan.filter(p => p.blockNumber === block.blockNumber).length + 
                                existingAssignments.filter(a => a.blockNumber === block.blockNumber).length;
          if (currentInBlock >= maxSeats) break;
          
          // Check if this seat is in a back row (D or E) - only back rows can have C-rated
          const isBackRowSeat = seatLabel.startsWith('D') || seatLabel.startsWith('E');
          
          // Find eligible contestant - exclude C-rated unless it's a back row seat
          const contestantIdx = remainingSolos.findIndex(c => {
            if (!isEligibleForBlock(c)) return false;
            // C-rated can ONLY go in back rows
            if (c.auditionRating === 'C' && !isBackRowSeat) return false;
            return true;
          });
          
          if (contestantIdx !== -1) {
            const contestant = remainingSolos[contestantIdx];
            placeSoloInSeat(contestant, seatLabel);
            remainingSolos.splice(contestantIdx, 1);
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
          
          // Check if this segment is in back rows (D or E) - required for C-rated groups
          const allSeatsInBackRow = segment.every(seat => seat.startsWith('D') || seat.startsWith('E'));
          
          // Find a group that fits this segment
          const groupIdx = unplacedGroups.findIndex(g => {
            if (g.size > segment.length) return false;
            
            // Check rating constraints for all group members
            const allEligible = g.contestants.every(c => {
              const isAOrBPlus = c.auditionRating === 'A' || c.auditionRating === 'B+';
              const isCRated = c.auditionRating === 'C';
              
              // NPB blocks can ONLY have B and C ratings
              if (block.blockType === 'NPB' && isAOrBPlus) return false;
              
              // NPB blocks cannot have contestants over 60km from Docklands
              if (block.blockType === 'NPB' && isContestantOver60km({ postcode: c.postcode, location: c.location })) return false;
              
              // C-rated can ONLY go to NPB blocks
              if (isCRated && block.blockType !== 'NPB') return false;
              
              // C-rated groups can ONLY be placed in back rows (D, E)
              if (isCRated && !allSeatsInBackRow) return false;
              
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
      
      // Get all assignments and standbys for duplicate checking
      const allSeatAssignments = await storage.getAllSeatAssignments();
      const allStandbys = await storage.getStandbyAssignments();
      
      try {
        for (const item of deduplicatedPlan) {
          // Double-check that this contestant isn't already assigned in ANY record day (defensive check)
          const existingAssign = allSeatAssignments.find((a: any) => a.contestantId === item.contestant.id);
          if (existingAssign) {
            console.log(`Skipping assignment for contestant ${item.contestant.id} - already seated in record day ${existingAssign.recordDayId}`);
            continue;
          }
          
          // Check if contestant is already a standby in ANY record day
          const existingStandby = allStandbys.find((s: any) => s.contestantId === item.contestant.id && !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && s.status !== 'attended');
          if (existingStandby) {
            console.log(`Skipping assignment for contestant ${item.contestant.id} - already a standby in record day ${existingStandby.recordDayId}`);
            continue;
          }
          
          // Check for previous canceled assignments to carry over workflow status
          const previousCanceled = allCanceledAssignments.find(
            (c: any) => c.contestantId === item.contestant.id && (c.paperworkSent || c.paperworkReceived || c.bookingEmailSent || c.confirmedRsvp || c.paperworkOnDay)
          );
          // Also find any canceled assignment for this contestant (to update rebook status)
          const anyCanceled = allCanceledAssignments.find(
            (c: any) => c.contestantId === item.contestant.id
          );
          
          const autoAssignData: any = {
            recordDayId,
            contestantId: item.contestant.id,
            blockNumber: item.blockNumber,
            seatLabel: item.seatLabel,
          };
          if (previousCanceled) {
            if (previousCanceled.paperworkSent) autoAssignData.paperworkSent = previousCanceled.paperworkSent;
            if (previousCanceled.paperworkSentBy) autoAssignData.paperworkSentBy = previousCanceled.paperworkSentBy;
            if (previousCanceled.paperworkReceived) autoAssignData.paperworkReceived = previousCanceled.paperworkReceived;
            if (previousCanceled.paperworkReceivedBy) autoAssignData.paperworkReceivedBy = previousCanceled.paperworkReceivedBy;
            if (previousCanceled.paperworkOnDay) autoAssignData.paperworkOnDay = previousCanceled.paperworkOnDay;
          }
          
          const assignment = await storage.createSeatAssignment(autoAssignData);
          createdAssignments.push(assignment);
          contestantUpdates.push(item.contestant.id);
          
          // Update reschedule entry if contestant was on reschedule list
          if (anyCanceled) {
            await storage.updateCanceledAssignment(anyCanceled.id, {
              rebookedToRecordDayId: recordDayId,
              rebookedAt: new Date(),
              rebookedBy: 'auto-assign',
            });
          }
        }

        for (const contestantId of contestantUpdates) {
          await storage.updateContestantAvailability(contestantId, "assigned");
        }

        res.json({
          message: `Assigned ${createdAssignments.length} contestants to seats`,
          assignments: createdAssignments,
          skippedACount: aRatedContestants.length,
          skippedANames: aRatedContestants.map(c => c.name),
          skippedRCount: rRatedBefore.length,
          skippedRNames: rRatedBefore.map(c => c.name),
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
        if (persistError.message?.startsWith('SEAT_CONFLICT:') || persistError.message?.startsWith('CONTESTANT_CONFLICT:') || persistError.message?.startsWith('CONFLICT:') || persistError.message?.startsWith('CONTESTANT_ALREADY_ACTIVE:')) {
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

      // Get source assignment before swap to know original position
      const sourceAssignment = await storage.getSeatAssignmentById(sourceAssignmentId);
      let targetAssignment = targetAssignmentId ? await storage.getSeatAssignmentById(targetAssignmentId) : null;
      
      if (!sourceAssignment) {
        return res.status(404).json({ error: "Source assignment not found" });
      }

      // Use atomic storage method with database transaction and row locking
      const result = await storage.atomicSwapSeats(
        sourceAssignmentId,
        targetAssignmentId || null,
        blockNumber,
        seatLabel
      );

      // Log movements to history
      const movedBy = (req as any).session?.username || 'system';
      
      if (targetAssignmentId && targetAssignment) {
        // Both contestants swapped seats - log both movements
        await storage.logMovement({
          contestantId: sourceAssignment.contestantId,
          movementType: 'seat_change',
          recordDayId: sourceAssignment.recordDayId,
          fromBlockNumber: sourceAssignment.blockNumber,
          fromSeatLabel: sourceAssignment.seatLabel,
          toBlockNumber: targetAssignment.blockNumber,
          toSeatLabel: targetAssignment.seatLabel,
          notes: `Swapped seats with ${targetAssignment.contestantId}`,
          movedBy,
        });
        await storage.logMovement({
          contestantId: targetAssignment.contestantId,
          movementType: 'seat_change',
          recordDayId: targetAssignment.recordDayId,
          fromBlockNumber: targetAssignment.blockNumber,
          fromSeatLabel: targetAssignment.seatLabel,
          toBlockNumber: sourceAssignment.blockNumber,
          toSeatLabel: sourceAssignment.seatLabel,
          notes: `Swapped seats with ${sourceAssignment.contestantId}`,
          movedBy,
        });
      } else {
        // Single move to empty seat
        await storage.logMovement({
          contestantId: sourceAssignment.contestantId,
          movementType: 'seat_change',
          recordDayId: sourceAssignment.recordDayId,
          fromBlockNumber: sourceAssignment.blockNumber,
          fromSeatLabel: sourceAssignment.seatLabel,
          toBlockNumber: blockNumber,
          toSeatLabel: seatLabel,
          notes: 'Moved to empty seat',
          movedBy,
        });
        
        // Move any cancelled assignment from the target position to the source position
        // This keeps the "declined/cancelled" indicator following the empty seat
        const canceledAtTarget = await storage.getCanceledAssignmentByPosition(
          sourceAssignment.recordDayId,
          blockNumber,
          seatLabel
        );
        if (canceledAtTarget) {
          await storage.updateCanceledAssignmentPosition(
            canceledAtTarget.id,
            sourceAssignment.blockNumber,
            sourceAssignment.seatLabel
          );
        }
      }

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

  // Get all block types across all record days
  app.get("/api/block-types", async (req, res) => {
    try {
      const allBlockTypes = await storage.getAllBlockTypes();
      res.json(allBlockTypes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      
      if (!['PB', 'NPB', 'AUDIENCE'].includes(blockType)) {
        return res.status(400).json({ error: "Block type must be 'PB', 'NPB', or 'AUDIENCE'" });
      }

      // In CELEB the seating chart is purely audience — Playing is tracked on
      // the Podium tab. Reject any attempt to set a CELEB block to PB/NPB.
      const workspace = (req as any).session?.activeWorkspace || 'dond';
      if (workspace === 'celeb' && blockType !== 'AUDIENCE') {
        return res.status(400).json({
          error: "DOND CELEB blocks must be AUDIENCE (Playing is tracked on the Podium tab)"
        });
      }

      const updated = await storage.upsertBlockType(recordDayId, blockNum, blockType);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Batch update all block types for a record day
  app.put("/api/record-days/:id/block-types", async (req, res) => {
    try {
      const recordDayId = req.params.id;
      const { blocks } = req.body;
      
      // Validate input
      if (!Array.isArray(blocks) || blocks.length !== 7) {
        return res.status(400).json({ error: "Must provide exactly 7 block configurations" });
      }
      
      // Validate each block
      for (const block of blocks) {
        if (!block.blockNumber || block.blockNumber < 1 || block.blockNumber > 7) {
          return res.status(400).json({ error: "Each block must have a valid blockNumber (1-7)" });
        }
        if (!['PB', 'NPB', 'AUDIENCE'].includes(block.blockType)) {
          return res.status(400).json({ error: "Each block must have blockType 'PB', 'NPB', or 'AUDIENCE'" });
        }
      }
      
      const pbCount = blocks.filter((b: any) => b.blockType === 'PB').length;
      const npbCount = blocks.filter((b: any) => b.blockType === 'NPB').length;
      const audienceCount = blocks.filter((b: any) => b.blockType === 'AUDIENCE').length;
      const workspace = (req as any).session?.activeWorkspace || 'dond';
      
      if (workspace === 'celeb') {
        if (audienceCount !== 7) {
          return res.status(400).json({
            error: "DOND CELEB requires all 7 blocks to be AUDIENCE (Playing is tracked on the Podium tab)",
            current: { pbCount, audienceCount }
          });
        }
      } else {
        if (pbCount !== 5 || npbCount !== 2) {
          return res.status(400).json({ 
            error: "Must have exactly 5 Playing Blocks (PB) and 2 Non-Playing Blocks (NPB)",
            current: { pbCount, npbCount }
          });
        }
      }
      
      const updated = await storage.upsertBlockTypes(recordDayId, blocks);
      res.json({ message: "Block configuration saved", blocks: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Check if block configuration is complete for a record day
  app.get("/api/record-days/:id/block-config-status", async (req, res) => {
    try {
      const recordDayId = req.params.id;
      const status = await storage.isBlockConfigurationComplete(recordDayId);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Swap all contestants between two blocks
  app.post("/api/record-days/:id/blocks/swap", async (req, res) => {
    try {
      const recordDayId = req.params.id;
      const { sourceBlock, targetBlock } = req.body;
      
      // Validate block numbers
      const sourceNum = parseInt(sourceBlock);
      const targetNum = parseInt(targetBlock);
      
      if (isNaN(sourceNum) || sourceNum < 1 || sourceNum > 7) {
        return res.status(400).json({ error: "Source block number must be between 1 and 7" });
      }
      
      if (isNaN(targetNum) || targetNum < 1 || targetNum > 7) {
        return res.status(400).json({ error: "Target block number must be between 1 and 7" });
      }
      
      if (sourceNum === targetNum) {
        return res.status(400).json({ error: "Source and target blocks must be different" });
      }
      
      // Check record day exists
      const recordDay = await storage.getRecordDay(recordDayId);
      if (!recordDay) {
        return res.status(404).json({ error: "Record day not found" });
      }
      
      const result = await storage.swapBlocks(recordDayId, sourceNum, targetNum);
      
      res.json({
        message: `Swapped ${result.swappedCount} contestants between Block ${sourceNum} and Block ${targetNum}`,
        ...result
      });
    } catch (error: any) {
      console.error("Block swap error:", error);
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
      
      // Log movements to history
      const movedBy = (req as any).session?.username || 'system';
      await storage.logMovement({
        contestantId: assignment1.contestantId,
        movementType: 'seat_change',
        recordDayId: assignment1.recordDayId,
        fromBlockNumber: assignment1.blockNumber,
        fromSeatLabel: assignment1.seatLabel,
        toBlockNumber: assignment2.blockNumber,
        toSeatLabel: assignment2.seatLabel,
        notes: `Swapped seats (RX Day Mode)`,
        movedBy,
      });
      await storage.logMovement({
        contestantId: assignment2.contestantId,
        movementType: 'seat_change',
        recordDayId: assignment2.recordDayId,
        fromBlockNumber: assignment2.blockNumber,
        fromSeatLabel: assignment2.seatLabel,
        toBlockNumber: assignment1.blockNumber,
        toSeatLabel: assignment1.seatLabel,
        notes: `Swapped seats (RX Day Mode)`,
        movedBy,
      });
      
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
      
      // Store original position before the move
      const originalBlockNumber = assignment.blockNumber;
      const originalSeatLabel = assignment.seatLabel;
      
      // Perform the move with original seat tracking
      const updated = await storage.moveSeatAssignmentWithTracking(
        sourceAssignmentId, 
        blockNumber,
        seatLabel
      );
      
      // Log movement to history
      const movedBy = (req as any).session?.username || 'system';
      await storage.logMovement({
        contestantId: assignment.contestantId,
        movementType: 'seat_change',
        recordDayId: assignment.recordDayId,
        fromBlockNumber: originalBlockNumber,
        fromSeatLabel: originalSeatLabel,
        toBlockNumber: blockNumber,
        toSeatLabel: seatLabel,
        notes: 'Moved to empty seat (RX Day Mode)',
        movedBy,
      });
      
      // Move any cancelled assignment from the target position to the source position
      // This keeps the "declined/cancelled" indicator following the empty seat
      const canceledAtTarget = await storage.getCanceledAssignmentByPosition(
        assignment.recordDayId,
        blockNumber,
        seatLabel
      );
      if (canceledAtTarget) {
        await storage.updateCanceledAssignmentPosition(
          canceledAtTarget.id,
          originalBlockNumber,
          originalSeatLabel
        );
      }
      
      res.json({ message: "Seat moved successfully with tracking", assignment: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Move seat assignment to overflow ("To Seat on Day" - block 0 with OS# label)
  app.post("/api/seat-assignments/:id/move-to-overflow", async (req, res) => {
    try {
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
      }

      if (assignment.blockNumber === 0) {
        return res.status(400).json({ error: "Assignment is already in overflow" });
      }

      const allAssignments = await storage.getSeatAssignmentsByRecordDay(assignment.recordDayId);
      const overflowAssignments = allAssignments.filter((a: any) => a.blockNumber === 0);
      let maxOsNum = 0;
      overflowAssignments.forEach((a: any) => {
        const match = a.seatLabel?.match(/^OS(\d+)$/);
        if (match) {
          maxOsNum = Math.max(maxOsNum, parseInt(match[1]));
        }
      });
      const newSeatLabel = `OS${maxOsNum + 1}`;

      const updated = await storage.moveSeatAssignmentWithTracking(
        req.params.id,
        0,
        newSeatLabel
      );

      const movedBy = (req as any).session?.username || 'system';
      await storage.logMovement({
        contestantId: assignment.contestantId,
        movementType: 'seat_change',
        recordDayId: assignment.recordDayId,
        fromBlockNumber: assignment.blockNumber,
        fromSeatLabel: assignment.seatLabel,
        toBlockNumber: 0,
        toSeatLabel: newSeatLabel,
        notes: `Moved to overflow (To Seat on Day)`,
        movedBy,
      });

      res.json({ message: "Moved to overflow", assignment: updated, seatLabel: newSeatLabel });
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
        'paperworkReceived', 'paperworkOnDay', 'disclosureSent', 'disclosureReceived', 'signedIn', 'otdNotes', 'standbyReplacementSwaps',
        'rxNumber', 'rxEpNumber', 'caseNumber', 'winningMoneyRole', 'winningMoneyAmount',
        'caseAmount', 'quickCash', 'bankOfferTaken', 'spinTheWheel', 'prize',
        'txNumber', 'txDate', 'notifiedOfTx', 'photosSent',
        'attendingWithOverride', // For editing attending with after invitations are sent
        'mobilityNotesOverride', // For editing mobility/medical notes after invitations are sent
        'emailsCopiedAt', // Track when emails were copied for external paperwork sending
        'called', 'calledAt' // Call tracking for players
      ];
      
      const timestampFields = [
        'bookingEmailSent', 'confirmedRsvp', 'paperworkSent', 
        'paperworkReceived', 'paperworkOnDay', 'disclosureSent', 'disclosureReceived', 'signedIn', 'emailsCopiedAt', 'calledAt'
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
            } else if (['caseAmount', 'quickCash', 'winningMoneyAmount'].includes(key)) {
              // Ensure real/numeric columns get proper number values
              const numVal = Number(value);
              workflowFields[key] = (!isNaN(numVal) && typeof value !== 'boolean') ? numVal : null;
            } else if (['bankOfferTaken', 'spinTheWheel', 'hnGiftcard', 'called'].includes(key)) {
              // Ensure boolean columns get proper boolean values
              workflowFields[key] = value === true || value === 'true';
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

      // Check if the record day is locked - prevent removal on locked days
      const recordDay = await storage.getRecordDay(assignment.recordDayId);
      if (recordDay?.lockedAt) {
        return res.status(403).json({ 
          error: "Cannot remove seat assignment on a locked record day. Unlock the day first or use the seating chart to make changes." 
        });
      }

      // Log the return to pool movement before deletion
      const movedBy = (req as any).session?.username || 'system';
      await storage.logMovement({
        contestantId: assignment.contestantId,
        movementType: 'returned_to_pool',
        recordDayId: assignment.recordDayId,
        fromBlockNumber: assignment.blockNumber,
        fromSeatLabel: assignment.seatLabel,
        notes: 'Returned to available pool',
        movedBy,
      });

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
      
      // Fetch old assignment BEFORE atomicRebook so we can preserve winning money data
      const oldAssignment = await storage.getSeatAssignmentById(oldAssignmentId);

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

      // If the old assignment had winning money data, preserve it in canceled_assignments
      // so it remains visible on the Winners page even after being rebooked
      if (oldAssignment?.winningMoneyRole) {
        const rebookedBy = (req as any).user?.username || 'admin';
        try {
          await storage.createOrUpdateCanceledAssignment({
            contestantId,
            recordDayId: oldAssignment.recordDayId,
            blockNumber: oldAssignment.blockNumber,
            seatLabel: oldAssignment.seatLabel,
            reason: `Rebooked to new date — winning money preserved`,
            movedBy: rebookedBy,
            // Mark as rebooked so it is excluded from the reschedule pool
            rebookedToRecordDayId: newRecordDayId,
            rebookedAt: new Date(),
            rebookedBy,
            // Winning money fields
            rxNumber: oldAssignment.rxNumber,
            rxEpNumber: oldAssignment.rxEpNumber,
            caseNumber: oldAssignment.caseNumber,
            winningMoneyRole: oldAssignment.winningMoneyRole,
            winningMoneyAmount: oldAssignment.winningMoneyAmount,
            winningMoneyText: oldAssignment.winningMoneyText,
            caseAmount: oldAssignment.caseAmount,
            bankOfferTaken: oldAssignment.bankOfferTaken,
            spinTheWheel: oldAssignment.spinTheWheel,
            prize: oldAssignment.prize,
            txNumber: oldAssignment.txNumber,
            txDate: oldAssignment.txDate,
            notifiedOfTx: oldAssignment.notifiedOfTx,
            photosSent: oldAssignment.photosSent,
          } as any);
        } catch (preserveError) {
          console.error("Warning: failed to preserve winning money during rebook:", preserveError);
        }
      }

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
      
      // Allow null/undefined to clear player type, or valid enum values
      if (playerType !== null && playerType !== undefined && !['player', 'backup', 'player_partner'].includes(playerType)) {
        return res.status(400).json({ error: "Invalid player type" });
      }
      
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, { playerType: playerType || null });
      
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
        hnGiftcard,
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
        hnGiftcard,
        bankOfferTaken,
        spinTheWheel,
        prize,
        typeOfAmount: typeof winningMoneyAmount
      });
      
      if (typeof winningMoneyAmount !== 'number' || winningMoneyAmount < 0) {
        console.log("PATCH winning-money: Invalid amount, returning 400");
        return res.status(400).json({ error: "Invalid amount" });
      }
      
      // If removing (amount is 0 AND no giftcard), clear winning money fields
      // NOTE: If hnGiftcard is true, we keep the record even if amount is 0
      if (winningMoneyAmount === 0 && !hnGiftcard) {
        const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, { 
          // NOTE: rxNumber is NOT cleared - it may have been set independently and clearing causes revert issues
          // NOTE: rxEpNumber is NOT cleared - it's set independently in Players tab
          caseNumber: null,
          winningMoneyRole: null, 
          winningMoneyAmount: 0,
          caseAmount: null,
          hnGiftcard: false,
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
      
      // Read current assignment to preserve episode number set by Players tab
      const currentAssignment = await storage.getSeatAssignmentById(req.params.id);
      
      // Build update object with base fields
      const updateData: any = { 
        rxNumber: rxNumber || currentAssignment?.rxNumber || null,
        rxEpNumber: rxEpNumber || currentAssignment?.rxEpNumber || null,
        caseNumber: caseNumber || null,
        winningMoneyRole, 
        winningMoneyAmount: (winningMoneyAmount !== null && !isNaN(Number(winningMoneyAmount))) ? Number(winningMoneyAmount) : 0,
        winningMoneyText: winningMoneyRole === 'case_holder' ? (req.body.winningMoneyText || null) : null,
        hnGiftcard: hnGiftcard === true || hnGiftcard === "true",
      };
      
      // Add player-specific fields if role is player
      if (winningMoneyRole === 'player') {
        updateData.caseAmount = (caseAmount !== null && caseAmount !== undefined && caseAmount !== '' && !isNaN(Number(caseAmount))) ? Number(caseAmount) : null;
        updateData.bankOfferTaken = bankOfferTaken === true || bankOfferTaken === 'true' ? true : false;
        updateData.spinTheWheel = spinTheWheel === true || spinTheWheel === 'true' ? true : false;
        updateData.prize = (spinTheWheel === true || spinTheWheel === 'true') ? (prize || null) : null;
      } else {
        // Clear player-specific fields if role is case_holder
        updateData.caseAmount = null;
        updateData.bankOfferTaken = null;
        updateData.spinTheWheel = null;
        updateData.prize = null;
      }
      
      console.log("PATCH winning-money updateData to DB:", JSON.stringify(updateData));
      
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
      const { confirmedRsvp, bookingEmailSent, notes, seatNotes, attendingWithOverride, mobilityNotesOverride } = req.body;
      
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
      // Seat-level notes and attending with override (for changes after invitations)
      if (seatNotes !== undefined) {
        updateData.seatNotes = seatNotes;
      }
      if (attendingWithOverride !== undefined) {
        updateData.attendingWithOverride = attendingWithOverride;
      }
      if (mobilityNotesOverride !== undefined) {
        updateData.mobilityNotesOverride = mobilityNotesOverride;
      }
      
      const updated = await storage.updateSeatAssignmentWorkflow(req.params.id, updateData);
      
      if (!updated) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // If confirmedRsvp is being set, update contestant status to 'confirmed'
      if (confirmedRsvp && updateData.confirmedRsvp) {
        await storage.updateContestantAvailability(updated.contestantId, 'confirmed');
      }
      
      // Broadcast updates for seatNotes, attendingWithOverride, and mobilityNotesOverride to sync with Booking Master
      if (seatNotes !== undefined || attendingWithOverride !== undefined || mobilityNotesOverride !== undefined) {
        wsManager.broadcastBookingUpdate({
          type: 'booking-master-update',
          recordDayId: updated.recordDayId,
          assignmentId: req.params.id,
          field: seatNotes !== undefined ? 'seatNotes' : (attendingWithOverride !== undefined ? 'attendingWithOverride' : 'mobilityNotesOverride'),
          value: seatNotes !== undefined ? seatNotes : (attendingWithOverride !== undefined ? attendingWithOverride : mobilityNotesOverride),
        });
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel seat assignment (move to reschedule)
  // If contestant was confirmed, set their status to 'invited' (not 'available')
  app.post("/api/seat-assignments/:id/cancel", async (req, res) => {
    try {
      const { reason } = req.body;
      
      // Get the assignment first to check if contestant was confirmed
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }
      
      // Check if the contestant was confirmed (has confirmedRsvp set)
      const wasConfirmed = !!assignment.confirmedRsvp;
      
      const canceled = await storage.cancelSeatAssignment(req.params.id, reason);
      
      // Log movement to reschedule
      const movedBy = (req as any).session?.username || 'system';
      await storage.logMovement({
        contestantId: assignment.contestantId,
        movementType: 'added_to_reschedule',
        recordDayId: assignment.recordDayId,
        fromBlockNumber: assignment.blockNumber,
        fromSeatLabel: assignment.seatLabel,
        notes: reason || 'Moved to reschedule list',
        movedBy,
      });
      
      // If they were confirmed, override status to 'invited' instead of 'available'
      if (wasConfirmed) {
        await storage.updateContestantAvailability(canceled.contestantId, 'invited');
      }
      
      res.json(canceled);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Decline booking - mark as declined and optionally move to reschedule
  app.post("/api/seat-assignments/:id/decline", async (req, res) => {
    try {
      const { reason, moveToReschedule = true, movedBy, moveToAttendanceIssues = false } = req.body;
      const declineReason = reason ? `[DECLINED] ${reason}` : "[DECLINED] No reason provided";
      
      // Get the assignment details before canceling for movement logging
      const assignment = await storage.getSeatAssignmentById(req.params.id);
      
      if (!assignment) {
        return res.status(404).json({ error: "Seat assignment not found" });
      }

      if (moveToAttendanceIssues) {
        await storage.createAttendanceIssue({
          contestantId: assignment.contestantId,
          recordDayId: assignment.recordDayId,
          blockNumber: assignment.blockNumber,
          seatLabel: assignment.seatLabel,
          issueType: 'no_longer_want_to_attend',
          notes: reason || 'Declined and marked as no longer wanting to attend',
          markedBy: movedBy || 'system'
        });
        
        return res.json({ moved: true, attendanceIssue: true });
      }

      if (moveToReschedule) {
        // Move to reschedule list (canceled assignments) with isDecline=true
        const canceled = await storage.cancelSeatAssignment(req.params.id, declineReason, movedBy, true);
        
        // Log the decline/reschedule to movement history
        await storage.logMovement({
          contestantId: assignment.contestantId,
          movementType: 'added_to_reschedule',
          recordDayId: assignment.recordDayId,
          fromBlockNumber: assignment.blockNumber,
          fromSeatLabel: assignment.seatLabel,
          notes: `Contestant declined and moved to reschedule`,
          movedBy: movedBy || 'system',
        });
        
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
        if (currentAssignment.bookingEmailSent) workflowData.bookingEmailSent = currentAssignment.bookingEmailSent;
        if (currentAssignment.confirmedRsvp) workflowData.confirmedRsvp = currentAssignment.confirmedRsvp;
        if (currentAssignment.paperworkSent) workflowData.paperworkSent = currentAssignment.paperworkSent;
        if (currentAssignment.paperworkSentBy) workflowData.paperworkSentBy = currentAssignment.paperworkSentBy;
        if (currentAssignment.paperworkReceived) workflowData.paperworkReceived = currentAssignment.paperworkReceived;
        if (currentAssignment.paperworkReceivedBy) workflowData.paperworkReceivedBy = currentAssignment.paperworkReceivedBy;
        if (currentAssignment.paperworkOnDay) workflowData.paperworkOnDay = currentAssignment.paperworkOnDay;
        if (currentAssignment.signedIn) workflowData.signedIn = currentAssignment.signedIn;
        if (currentAssignment.attendingWithOverride) workflowData.attendingWithOverride = currentAssignment.attendingWithOverride;
        if (currentAssignment.mobilityNotesOverride) workflowData.mobilityNotesOverride = currentAssignment.mobilityNotesOverride;
        if (currentAssignment.emailsCopiedAt) workflowData.emailsCopiedAt = currentAssignment.emailsCopiedAt;
        if (currentAssignment.ticketEmailSent) workflowData.ticketEmailSent = currentAssignment.ticketEmailSent;
        
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
      if (error.message?.startsWith('CONTESTANT_ALREADY_ACTIVE:')) {
        return res.status(409).json({ error: 'This contestant is already assigned to another record day. Please refresh.' });
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

  // Create a new canceled assignment (for attended standbys being moved to reschedule)
  // Uses createOrUpdateCanceledAssignment to update existing entries instead of creating duplicates
  app.post("/api/canceled-assignments", requireAuth, async (req, res) => {
    try {
      const { contestantId, recordDayId, blockNumber, seatLabel, reason, movedBy, isFromStandby, originalAttendanceDate } = req.body;
      
      if (!contestantId || !recordDayId) {
        return res.status(400).json({ error: "contestantId and recordDayId are required" });
      }
      
      // Use createOrUpdateCanceledAssignment which handles duplicates internally
      // If contestant already in reschedule, updates their record and increments count
      const directCanceledData: any = {
        contestantId,
        recordDayId,
        blockNumber: blockNumber || null,
        seatLabel: seatLabel || null,
        reason: reason || 'Moved to reschedule',
        movedBy: movedBy || 'SYSTEM',
        isFromStandby: isFromStandby || false,
        originalAttendanceDate: originalAttendanceDate ? new Date(originalAttendanceDate) : null,
      };
      
      // If this is from a standby, look up the standby to carry over workflow fields
      if (isFromStandby && contestantId && recordDayId) {
        const allStandbys = await storage.getStandbyAssignments();
        const sourceStandby = allStandbys.find((s: any) => s.contestantId === contestantId && s.recordDayId === recordDayId);
        if (sourceStandby) {
          if (sourceStandby.bookingEmailSent) directCanceledData.bookingEmailSent = sourceStandby.bookingEmailSent;
          if (sourceStandby.confirmedRsvp) directCanceledData.confirmedRsvp = sourceStandby.confirmedRsvp;
          if (sourceStandby.paperworkSent) directCanceledData.paperworkSent = sourceStandby.paperworkSent;
          if (sourceStandby.paperworkSentBy) directCanceledData.paperworkSentBy = sourceStandby.paperworkSentBy;
          if (sourceStandby.paperworkReceived) directCanceledData.paperworkReceived = sourceStandby.paperworkReceived;
          if (sourceStandby.paperworkReceivedBy) directCanceledData.paperworkReceivedBy = sourceStandby.paperworkReceivedBy;
          if (sourceStandby.paperworkOnDay) directCanceledData.paperworkOnDay = sourceStandby.paperworkOnDay;
        }
      }
      
      const canceledAssignment = await storage.createOrUpdateCanceledAssignment(directCanceledData);
      
      // Update contestant status to 'rescheduled'
      await storage.updateContestantAvailability(contestantId, 'rescheduled');
      
      res.json(canceledAssignment);
    } catch (error: any) {
      console.error("Error creating canceled assignment:", error);
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

  // Remove reschedule entries for contestants who are already assigned to seats
  app.post("/api/canceled-assignments/cleanup-seated", requireAuth, async (req, res) => {
    try {
      const canceledAssignments = await storage.getCanceledAssignments();
      const seatAssignments = await storage.getAllSeatAssignments();
      
      // Build map of contestantId -> their current unlocked (active) seat assignment
      const recordDaysList = await storage.getRecordDays();
      const lockedDayIds = new Set(
        recordDaysList.filter((rd: any) => rd.lockedAt != null).map((rd: any) => rd.id)
      );
      const activeSeats: { [contestantId: string]: any } = {};
      for (const sa of seatAssignments as any[]) {
        if (!lockedDayIds.has(sa.recordDayId)) {
          activeSeats[sa.contestantId] = sa;
        }
      }
      
      let deletedCount = 0;
      const removedEntries: string[] = [];
      
      for (const canceled of canceledAssignments) {
        const activeSeat = activeSeats[canceled.contestantId];
        if (activeSeat && !canceled.rebookedToRecordDayId) {
          // Mark as rebooked (preserves history) instead of deleting
          await storage.updateCanceledAssignment(canceled.id, {
            rebookedToRecordDayId: activeSeat.recordDayId,
            rebookedAt: new Date(),
            rebookedBy: 'cleanup',
          });
          deletedCount++;
          removedEntries.push(canceled.contestant?.name || canceled.contestantId);
        }
      }

      // Also mark stale standby entries as 'seated' for contestants who are now seated
      const allStandbys = await storage.getStandbyAssignments();
      for (const standby of allStandbys as any[]) {
        if (standby.status !== 'seated' && activeSeats[standby.contestantId]) {
          await storage.updateStandbyAssignment(standby.id, { status: 'seated' });
        }
      }
      
      console.log(`[Cleanup Seated] Fixed ${deletedCount} reschedule entries for contestants already seated`);
      
      res.json({
        message: `Fixed ${deletedCount} reschedule entries for contestants who are now seated`,
        deletedCount,
        removedNames: removedEntries,
      });
    } catch (error: any) {
      console.error("Error cleaning up seated reschedule entries:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cleanup duplicate reschedule entries
  app.post("/api/canceled-assignments/cleanup-duplicates", requireAuth, async (req, res) => {
    try {
      const canceledAssignments = await storage.getCanceledAssignments();
      
      // Group by contestantId to find duplicates
      const byContestant: { [key: string]: any[] } = {};
      canceledAssignments.forEach((c: any) => {
        if (!byContestant[c.contestantId]) {
          byContestant[c.contestantId] = [];
        }
        byContestant[c.contestantId].push(c);
      });
      
      // Find duplicates (more than 1 entry per contestant)
      let deletedCount = 0;
      const duplicatesFound: string[] = [];
      
      for (const [contestantId, entries] of Object.entries(byContestant)) {
        if (entries.length > 1) {
          // Keep the most recent entry (highest id or most recent date), delete others
          const sorted = entries.sort((a, b) => {
            // Sort by canceledAt date if available, otherwise by id
            const dateA = a.canceledAt ? new Date(a.canceledAt).getTime() : 0;
            const dateB = b.canceledAt ? new Date(b.canceledAt).getTime() : 0;
            if (dateA !== dateB) return dateB - dateA; // Most recent first
            return b.id.localeCompare(a.id); // Fall back to id comparison
          });
          
          // Keep first (most recent), delete rest
          const toDelete = sorted.slice(1);
          for (const entry of toDelete) {
            await storage.deleteCanceledAssignment(entry.id);
            deletedCount++;
          }
          duplicatesFound.push(`${entries[0].contestant?.name || contestantId}: ${entries.length} entries (kept 1, deleted ${entries.length - 1})`);
        }
      }
      
      console.log(`[Cleanup Duplicates] Removed ${deletedCount} duplicate reschedule entries`);
      
      res.json({
        message: `Removed ${deletedCount} duplicate reschedule entries`,
        deletedCount,
        details: duplicatesFound,
      });
    } catch (error: any) {
      console.error("Error cleaning up duplicate reschedule entries:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update canceled assignment (paperwork fields, etc.)
  app.patch("/api/canceled-assignments/:id", async (req, res) => {
    try {
      const allowedFields = [
        'paperworkSent', 'paperworkSentBy', 'paperworkReceived', 'paperworkReceivedBy', 'paperworkOnDay',
        'disclosureSent', 'disclosureReceived',
        'bookingEmailSent', 'confirmedRsvp', 'wasDeclined', 'declinedAt', 'declinedBy', 'reason'
      ];
      
      // Date fields that need conversion from ISO strings to Date objects
      const dateFields = ['paperworkSent', 'paperworkReceived', 'paperworkOnDay', 'disclosureSent', 'disclosureReceived', 'bookingEmailSent', 'confirmedRsvp', 'declinedAt'];
      
      const updateData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          let value = req.body[field];
          // Convert date strings to Date objects for timestamp fields
          if (dateFields.includes(field) && value !== null && typeof value === 'string') {
            value = new Date(value);
          }
          updateData[field] = value;
        }
      }
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      
      const updated = await storage.updateCanceledAssignment(req.params.id, updateData);
      if (!updated) {
        return res.status(404).json({ error: "Canceled assignment not found" });
      }
      
      res.json(updated);
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

      // Check if contestant is DNU-rated (Do Not Use) - block rebooking
      const contestant = await storage.getContestantById(canceled.contestantId);
      if (contestant?.auditionRating?.toUpperCase().trim() === 'DNU') {
        return res.status(400).json({ error: "Cannot rebook a DNU-rated contestant (Do Not Use)" });
      }

      // Check if contestant is already seated in ANY record day
      // Allow returning contestants (those only assigned on locked/completed record days)
      const allowReturning = req.body.allowReturning === true;
      const allowWinner = req.body.allowWinner === true;
      const allSeatAssignments = await storage.getAllSeatAssignments();
      const existingSeat = allSeatAssignments.find((a: any) => a.contestantId === canceled.contestantId);
      if (existingSeat) {
        const existingRecordDay = await storage.getRecordDayById(existingSeat.recordDayId);
        const isOnLockedDay = existingRecordDay?.lockedAt != null;
        const dayName = existingRecordDay?.date 
          ? new Date(existingRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
          : 'another day';
        
        if (isOnLockedDay && allowReturning) {
          // Warn (but don't hard-block) if the contestant has prize case winnings.
          // Prize column (spin-the-wheel prizes) does NOT count — only cash winnings.
          if (!allowWinner) {
            const sa = existingSeat;
            const hasCashWinnings =
              (sa.winningMoneyAmount != null && sa.winningMoneyAmount > 0) ||
              (sa.winningMoneyText && sa.winningMoneyText.trim());
            if (hasCashWinnings) {
              const amountStr = sa.winningMoneyAmount != null && sa.winningMoneyAmount > 0
                ? `$${sa.winningMoneyAmount.toLocaleString()}`
                : sa.winningMoneyText || 'an amount';
              return res.status(409).json({
                error: `${contestant?.name || 'Contestant'} previously won ${amountStr} in prize case winnings.`,
                isWinner: true,
                contestantName: contestant?.name,
                winnerAmount: sa.winningMoneyAmount ?? null,
                winnerText: sa.winningMoneyText ?? null,
              });
            }
          }
          // Allowed - returning contestant (no cash winnings, or winner override accepted)
        } else if (isOnLockedDay && !allowReturning) {
          const label = existingRecordDay?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${contestant?.name || 'Contestant'} previously appeared on ${label} (${dayName}). Rebook as returning contestant?`,
            isReturning: true,
            contestantName: contestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        } else {
          return res.status(409).json({ error: `${contestant?.name || 'Contestant'} is already seated in ${dayName} (Block ${existingSeat.blockNumber}, Seat ${existingSeat.seatLabel})` });
        }
      }

      // Check if contestant is already a standby in ANY record day
      const allStandbys = await storage.getStandbyAssignments();
      const existingStandby = allStandbys.find((s: any) => s.contestantId === canceled.contestantId && !s.movedToReschedule && s.status !== 'seated' && s.status !== 'rescheduled' && s.status !== 'attended');
      if (existingStandby) {
        const standbyRecordDay = await storage.getRecordDayById(existingStandby.recordDayId);
        const isStandbyOnLockedDay = standbyRecordDay?.lockedAt != null;
        const dayName = standbyRecordDay?.date 
          ? new Date(standbyRecordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
          : 'another day';
        
        if (isStandbyOnLockedDay && allowReturning) {
          // Allowed - returning contestant who was a standby on a completed episode
        } else if (isStandbyOnLockedDay && !allowReturning) {
          const label = standbyRecordDay?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${contestant?.name || 'Contestant'} previously attended ${label} (${dayName}) as standby. Rebook as returning contestant?`,
            isReturning: true,
            contestantName: contestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        } else {
          return res.status(409).json({ error: `${contestant?.name || 'Contestant'} is already a standby for ${dayName}. Remove them from standbys first.` });
        }
      }

      // Create new seat assignment with all workflow status carried over
      const rebookData: any = {
        recordDayId,
        contestantId: canceled.contestantId,
        blockNumber,
        seatLabel,
      };
      if (canceled.bookingEmailSent) rebookData.bookingEmailSent = canceled.bookingEmailSent;
      if (canceled.confirmedRsvp) rebookData.confirmedRsvp = canceled.confirmedRsvp;
      if (canceled.paperworkSent) rebookData.paperworkSent = canceled.paperworkSent;
      if (canceled.paperworkSentBy) rebookData.paperworkSentBy = canceled.paperworkSentBy;
      if (canceled.paperworkReceived) rebookData.paperworkReceived = canceled.paperworkReceived;
      if (canceled.paperworkReceivedBy) rebookData.paperworkReceivedBy = canceled.paperworkReceivedBy;
      if (canceled.paperworkOnDay) rebookData.paperworkOnDay = canceled.paperworkOnDay;

      const newAssignment = await storage.createSeatAssignment(rebookData);

      // Log movement from reschedule to seat
      const movedBy = (req as any).session?.username || 'system';
      await storage.logMovement({
        contestantId: canceled.contestantId,
        movementType: 'removed_from_reschedule',
        recordDayId: recordDayId,
        fromBlockNumber: canceled.blockNumber || undefined,
        fromSeatLabel: canceled.seatLabel || undefined,
        toBlockNumber: blockNumber,
        toSeatLabel: seatLabel,
        notes: 'Rebooked from reschedule list',
        movedBy,
      });

      // Update contestant status to 'assigned'
      await storage.updateContestant(canceled.contestantId, { availabilityStatus: 'assigned' });

      // Update the canceled assignment with rebooked info (instead of deleting)
      const rebookedBy = (req as any).session?.username || 'system';
      await storage.updateCanceledAssignment(canceled.id, {
        rebookedToRecordDayId: recordDayId,
        rebookedAt: new Date(),
        rebookedBy: rebookedBy,
      });

      // CLEANUP: Mark stale active standbys for this contestant as 'seated'
      // Excludes terminal states ('seated', 'attended', 'rescheduled') to preserve audit history
      const allStaleStandbys = allStandbys.filter(
        (s: any) => s.contestantId === canceled.contestantId
          && s.status !== 'seated'
          && s.status !== 'attended'
          && s.status !== 'rescheduled'
      );
      for (const sb of allStaleStandbys) {
        await storage.updateStandbyAssignment(sb.id, { status: 'seated' });
      }

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
      if (error.message?.startsWith('CONTESTANT_ALREADY_ACTIVE:')) {
        return res.status(409).json({ error: error.message.split(': ')[1] });
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

      // Return immediately - emails will be sent in background
      const totalToSend = contestantIds.length;
      res.json({
        message: `Processing ${totalToSend} availability check emails in background`,
        emailsSent: totalToSend, // Optimistic count
        emailsFailed: 0,
        processing: true,
      });

      // Process emails in background (after response is sent)
      setImmediate(async () => {
        console.log(`📧 Starting background availability email send for ${totalToSend} recipients...`);
        
        // Rate limiting for bulk emails to avoid triggering spam filters (e.g., BigPond)
        const DELAY_BETWEEN_EMAILS_MS = 1500; // 1.5 second delay between emails
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let emailCount = 0;

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
          
            // Add delay between emails to avoid triggering spam filters
            emailCount++;
            if (emailCount < contestantIds.length) {
              console.log(`📧 Availability email: Sent ${emailCount}/${contestantIds.length}, waiting ${DELAY_BETWEEN_EMAILS_MS}ms...`);
              await delay(DELAY_BETWEEN_EMAILS_MS);
            }
          } catch (emailError: any) {
            console.error(`Failed to send email to ${contestant.email}:`, emailError);
            emailsFailed.push({
              contestantId,
              email: contestant.email,
              error: emailError.message,
            });
          }
        }

        console.log(`📧 Background availability email send complete: ${emailsSent.length} sent, ${emailsFailed.length} failed`);
        if (emailsFailed.length > 0) {
          console.error(`📧 Availability email errors:`, emailsFailed);
        }
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
      const allAssignments = await storage.getAllSeatAssignments();
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
      await storage.updateBookingConfirmationResponse(
        tokenRecord.id,
        confirmationStatus,
        responseData.attendingWith || undefined,
        notes
      );
      
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
  // Uses parallel batch processing to avoid gateway timeout on large sends
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

      // Pre-load shared data once (banner, config, attachments) to avoid repeated I/O
      const [
        bannerUrlConfig,
        emailHeadline,
        emailIntro,
        emailInstructions,
        emailButtonText,
        emailAdditionalInstructions,
        emailFooter,
        bookingReplyToEmail,
        senderNameConfig,
        bookingMailtoBodyConfig,
        emailReminderMessage,
        smtpConfig,
      ] = await Promise.all([
        storage.getSystemConfig('email_banner_url'),
        storage.getSystemConfig('booking_email_headline'),
        storage.getSystemConfig('booking_email_intro'),
        storage.getSystemConfig('booking_email_instructions'),
        storage.getSystemConfig('booking_email_button_text'),
        storage.getSystemConfig('booking_email_additional_instructions'),
        storage.getSystemConfig('booking_email_footer'),
        storage.getSystemConfig('booking_reply_to_email'),
        storage.getSystemConfig('email_sender_name'),
        storage.getSystemConfig('booking_mailto_body'),
        storage.getSystemConfig('email_reminder_message'),
        getSmtpConfig(),
      ]);

      // Default mailto body template
      const defaultBookingMailtoBody = `Hi Deal or No Deal Team,

Name: {{name}}
Date: {{date}}

CAN YOU ATTEND? (mark with X)
[ ] YES - I confirm my attendance
[ ] NO - I cannot attend (Reason: )

Group members attending (please provide FULL NAMES):
Note - group members must have attended an audition.

--- REQUIRED INFORMATION (if attending) ---

Do you have any medical conditions?
If yes, please describe:

Do you have any mobility requirements? (i.e. issues climbing stairs or standing for extended periods)
Answer:

Emergency contact name & phone number:
Answer:

Dietary requirements (mark with X):
[ ] Vegetarian
[ ] Vegan
[ ] Gluten Free
[ ] Dairy Free

Please note that all our meals are nut-free. If your dietary requirements fall outside the options, we won't be able to cater to them, so we kindly ask that you bring your own meals.

Thank you.`;

      // Prepare shared config values
      const sharedConfig = {
        bannerUrlConfig: bannerUrlConfig || `/uploads/branding/dond_banner.png`,
        emailHeadline: emailHeadline || 'Your Booking is Confirmed!',
        emailIntro: emailIntro || 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.',
        emailInstructions: emailInstructions || 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.',
        emailButtonText: emailButtonText || 'Confirm Attendance',
        emailAdditionalInstructions: emailAdditionalInstructions || '',
        emailFooter: emailFooter || 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.',
        bookingReplyToEmail: bookingReplyToEmail || smtpConfig.fromEmail || 'noreply@example.com',
        senderName: senderNameConfig || 'Deal or No Deal',
        bookingMailtoBody: bookingMailtoBodyConfig || defaultBookingMailtoBody,
        emailReminderMessage: emailReminderMessage || 'Please ensure you bring your own water bottle.',
      };

      // Pre-load banner image once
      let sharedBannerBuffer: Buffer | null = null;
      let sharedBannerContentType = 'image/png';
      let sharedBannerFilename = 'dond_banner.png';
      if (sharedConfig.bannerUrlConfig.startsWith('/')) {
        const bannerPath = path.join(process.cwd(), sharedConfig.bannerUrlConfig.replace(/^\//, ''));
        try {
          if (fs.existsSync(bannerPath)) {
            sharedBannerBuffer = fs.readFileSync(bannerPath);
            const ext = path.extname(bannerPath).toLowerCase().replace('.', '');
            sharedBannerContentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            sharedBannerFilename = path.basename(bannerPath);
          }
        } catch (error) {
          console.warn(`Warning: Could not read banner image at ${bannerPath}:`, error);
        }
      }

      // Pre-load PDF attachments once
      const sharedAttachments: { content: Buffer; contentType: string; filename: string }[] = [];
      if (attachmentPaths && Array.isArray(attachmentPaths) && attachmentPaths.length > 0) {
        const objectStorageService = new ObjectStorageService();
        for (const attachmentPath of attachmentPaths) {
          try {
            const { buffer, contentType, filename } = await objectStorageService.getObjectAsBuffer(attachmentPath);
            sharedAttachments.push({ content: buffer, contentType, filename });
          } catch (attachErr: any) {
            console.error(`Failed to load attachment ${attachmentPath}:`, attachErr.message);
          }
        }
      }

      // Helper function to process a single seat assignment
      const processAssignment = async (seatAssignmentId: string): Promise<{
        seatAssignmentId: string;
        success: boolean;
        contestantName?: string;
        email?: string;
        responseUrl?: string;
        error?: string;
      }> => {
        try {
          // Get seat assignment with contestant and record day data
          const assignment = await storage.getSeatAssignmentById(seatAssignmentId);
          
          if (!assignment) {
            return { seatAssignmentId, success: false, error: "Seat assignment not found" };
          }

          const contestant = await storage.getContestantById(assignment.contestantId);
          const recordDay = await storage.getRecordDayById(assignment.recordDayId);

          if (!contestant || !recordDay) {
            return { seatAssignmentId, success: false, error: "Contestant or record day not found" };
          }

          if (!contestant.email) {
            return { seatAssignmentId, success: false, error: "Contestant has no email address" };
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

          // Send booking confirmation email
          try {
            const confirmationLink = appendNgrokSkip(`${baseUrl}/booking-confirmation/${token}`);
            const recordDate = new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            
            // Prepare banner for CID embedding - use pre-loaded shared data
            const bookingBannerCid = 'booking-banner-image';
            let bannerUrl = sharedBannerBuffer ? `cid:${bookingBannerCid}` : sharedConfig.bannerUrlConfig;
            
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
              // Professional HTML email template with pre-loaded config values
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
          ${sharedConfig.emailHeadline}
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
                ${sharedConfig.emailIntro.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${convertLinksToHtml(paragraph.replace(/\n/g, '<br/>'))}</p>`
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
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> ${getArrivalTimeText(recordDay.date, '7:30AM')}
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
                    <a href="mailto:${sharedConfig.bookingReplyToEmail}?subject=${encodeURIComponent(`BOOKING RESPONSE - ${contestant.name} - ${recordDate}`)}&body=${encodeURIComponent(sharedConfig.bookingMailtoBody.replace(/\{\{name\}\}/g, contestant.name).replace(/\{\{date\}\}/g, recordDate))}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
                  </td>
                </tr>
              </table>
              
              ${sharedConfig.emailAdditionalInstructions ? `
              <!-- Additional Instructions -->
              <div style="margin: 20px 0 25px 0; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                ${sharedConfig.emailAdditionalInstructions.split('\n\n').map((paragraph: string) => 
                  `<p style="color: #444444; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">${convertLinksToHtml(paragraph.replace(/\n/g, '<br/>'))}</p>`
                ).join('')}
              </div>
              ` : ''}
              
              <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 20px 0;">
                ${convertLinksToHtml(sharedConfig.emailReminderMessage)}
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
          ${sharedConfig.emailFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
            }
            
            const subject = emailSubject || `Studio Invitation - ${recordDate}`;
            
            const emailConfig: EmailConfig = {
              senderName: sharedConfig.senderName,
            };
            
            // Prepare attachments - use pre-loaded shared data
            const allAttachments: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
            
            // Add CID-embedded banner image if available (for non-custom email bodies)
            if (!customEmailBody && sharedBannerBuffer) {
              allAttachments.push({
                filename: sharedBannerFilename,
                content: sharedBannerBuffer,
                contentType: sharedBannerContentType,
                cid: bookingBannerCid,
              });
            }
            
            // Add pre-loaded PDF attachments
            for (const att of sharedAttachments) {
              allAttachments.push({ content: att.content, contentType: att.contentType, filename: att.filename });
            }
            
            // Send email with attachments (CID banner and/or PDFs)
            if (allAttachments.length > 0) {
              await sendEmailWithAttachment(contestant.email, subject, emailBody, allAttachments, emailConfig);
            } else {
              await sendEmail(contestant.email, subject, emailBody, undefined, emailConfig);
            }

            // Create a booking message record for this initial email
            const recordDateForLog = recordDate;
            const storedBody = customEmailBody
              ? customEmailBody
                  .replace(/\{\{name\}\}/g, contestant.name)
                  .replace(/\{\{date\}\}/g, recordDateForLog)
                  .replace(/\{\{block\}\}/g, String(assignment.blockNumber))
                  .replace(/\{\{seat\}\}/g, assignment.seatLabel)
                  .replace(/\{\{confirmationLink\}\}/g, confirmationLink)
              : `Hi ${contestant.name},\n\nYou have been booked for Deal or No Deal on ${recordDateForLog}.\nSeat: Block ${assignment.blockNumber}, ${assignment.seatLabel}\n\nPlease confirm your attendance using the link provided.`;
            
            await storage.createBookingMessage({
              confirmationId: tokenRecord.id,
              direction: 'outbound',
              messageType: 'booking_email',
              subject: subject, // Use the actual subject sent (includes UPDATED prefix for resends)
              body: storedBody,
              sentAt: new Date(),
            });

            // Update bookingEmailSent timestamp and clear any previous error
            await storage.updateSeatAssignmentWorkflow(seatAssignmentId, {
              bookingEmailSent: new Date(),
              bookingEmailError: null, // Clear any previous error on successful send
            });

            // Update contestant status to 'invited'
            await storage.updateContestantAvailability(assignment.contestantId, 'invited');

            return {
              seatAssignmentId,
              success: true,
              contestantName: contestant.name,
              email: contestant.email,
              responseUrl,
            };
          } catch (emailError: any) {
            console.error(`Failed to send booking confirmation email to ${contestant.email}:`, emailError.message);
            // Store the error in the database for tracking
            await storage.updateSeatAssignmentWorkflow(seatAssignmentId, {
              bookingEmailError: emailError.message || 'Unknown email send error',
            });
            return { seatAssignmentId, success: false, error: `Email send failed: ${emailError.message}`, contestantName: contestant.name, email: contestant.email };
          }
        } catch (error: any) {
          console.error(`Error processing assignment ${seatAssignmentId}:`, error.message);
          return { seatAssignmentId, success: false, error: error.message };
        }
      };

      // Process emails in parallel batches of 5 to avoid SMTP overload while staying under timeout
      const BATCH_SIZE = 5;
      const results: {
        seatAssignmentId: string;
        success: boolean;
        contestantName?: string;
        email?: string;
        responseUrl?: string;
        error?: string;
      }[] = [];

      for (let i = 0; i < seatAssignmentIds.length; i += BATCH_SIZE) {
        const batch = seatAssignmentIds.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(processAssignment));
        results.push(...batchResults);
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
      const ticketAdditional = (await storage.getSystemConfig('ticket_email_additional')) || '';
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
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> ${getArrivalTimeText(recordDay.date, '7:30 AM')}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC 3008
                    </p>
                  </td>
                </tr>
              </table>
              ${ticketAdditional.trim() ? `
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${ticketAdditional.split('\n\n').map((paragraph: string) =>
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              ` : ''}
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

      // Build attachments array (PDF removed — was Record_Day_Information.pdf)
      const attachments: any[] = [];
      
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

  // Bulk send ticket emails for multiple confirmed seat assignments
  app.post("/api/seat-assignments/bulk-send-ticket", requireAuth, async (req, res) => {
    try {
      // Check if email is configured
      if (!await isEmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Please configure SMTP settings in the Settings page." 
        });
      }

      const { seatAssignmentIds } = req.body;
      
      if (!Array.isArray(seatAssignmentIds) || seatAssignmentIds.length === 0) {
        return res.status(400).json({ error: "Must provide at least one seat assignment ID" });
      }

      // Prepare banner image buffer once
      const ticketBannerCid = 'ticket-banner-image';
      let ticketBannerBuffer: Buffer | null = null;
      let ticketBannerContentType = 'image/png';
      let ticketBannerFilename = 'dond_banner.png';
      
      const bannerUrlConfig = await storage.getSystemConfig('email_banner_url') || `/uploads/branding/dond_banner.png`;
      
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
          console.warn(`Warning: Could not read banner image:`, error);
        }
      }

      // Get configurable text from system config with defaults (load once)
      const ticketHeadline = await storage.getSystemConfig('ticket_email_headline') || 'Your Official Ticket';
      const ticketIntro = await storage.getSystemConfig('ticket_email_intro') || 'Thank you for confirming your attendance! This is your official ticket for the Deal or No Deal recording.';
      const ticketImportant = await storage.getSystemConfig('ticket_email_important') || 'IMPORTANT INFORMATION is attached in the PDF. Please read it carefully before your record day.';
      const ticketAdditional = (await storage.getSystemConfig('ticket_email_additional')) || '';
      const ticketFooter = await storage.getSystemConfig('ticket_email_footer') || 'This is an automated email from the Deal or No Deal production team.';
      const senderNameConfig = await storage.getSystemConfig('email_sender_name');
      
      const emailConfig: EmailConfig = {
        senderName: senderNameConfig || 'Deal or No Deal',
      };

      // Process a single assignment
      const processAssignment = async (assignmentId: string) => {
        try {
          const assignment = await storage.getSeatAssignmentById(assignmentId);
          
          if (!assignment) {
            return { seatAssignmentId: assignmentId, success: false, error: "Assignment not found" };
          }

          if (!assignment.confirmedRsvp) {
            return { seatAssignmentId: assignmentId, success: false, error: "Booking not confirmed" };
          }

          const contestant = await storage.getContestantById(assignment.contestantId);
          const recordDay = await storage.getRecordDayById(assignment.recordDayId);

          if (!contestant || !recordDay) {
            return { seatAssignmentId: assignmentId, success: false, error: "Contestant or record day not found" };
          }

          if (!contestant.email) {
            return { seatAssignmentId: assignmentId, success: false, error: "No email address", contestantName: contestant.name };
          }

          // Format date
          const recordDate = new Date(recordDay.date).toLocaleDateString('en-AU', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });

          // Determine banner URL
          let bannerUrl = ticketBannerBuffer ? `cid:${ticketBannerCid}` : bannerUrlConfig;

          // Create email HTML
          const emailHtml = `<!DOCTYPE html>
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
          ${ticketHeadline}
        </h1>
      </td>
    </tr>
    
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
                      <strong style="color: #8B0000;">ARRIVAL TIME:</strong> ${getArrivalTimeText(recordDay.date, '7:30 AM')}
                    </p>
                    <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0;">
                      <strong style="color: #8B0000;">LOCATION:</strong> Docklands Studios Melbourne, 476 Docklands Drive, Docklands, VIC 3008
                    </p>
                  </td>
                </tr>
              </table>
              ${ticketAdditional.trim() ? `
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${ticketAdditional.split('\n\n').map((paragraph: string) =>
                  `<p style="margin: 0 0 12px 0;">${paragraph.replace(/\n/g, '<br/>')}</p>`
                ).join('')}
              </div>
              ` : ''}
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

          // Build attachments array (PDF removed — was Record_Day_Information.pdf)
          const attachments: any[] = [];

          if (ticketBannerBuffer) {
            attachments.push({
              filename: ticketBannerFilename,
              content: ticketBannerBuffer,
              contentType: ticketBannerContentType,
              cid: ticketBannerCid
            });
          }

          // Send email
          await sendEmailWithAttachment(
            contestant.email,
            'Deal or No Deal - Record Day Information',
            emailHtml,
            attachments,
            emailConfig
          );

          // Update ticketEmailSent timestamp
          await storage.updateSeatAssignmentWorkflow(assignmentId, {
            ticketEmailSent: new Date(),
          });

          return {
            seatAssignmentId: assignmentId,
            success: true,
            contestantName: contestant.name,
            email: contestant.email,
          };
        } catch (error: any) {
          return {
            seatAssignmentId: assignmentId,
            success: false,
            error: error.message,
          };
        }
      };

      // Return immediately - emails will be sent in background
      const totalToSend = seatAssignmentIds.length;
      res.json({
        message: `Processing ${totalToSend} ticket email(s) in background`,
        successCount: totalToSend, // Optimistic count
        failCount: 0,
        processing: true,
      });

      // Process in background (after response is sent)
      setImmediate(async () => {
        console.log(`📧 Starting background ticket email send for ${totalToSend} recipients...`);
        
        const BATCH_SIZE = 3; // Reduced batch size
        const DELAY_BETWEEN_BATCHES_MS = 2000; // 2 second delay between batches
        const results: {
          seatAssignmentId: string;
          success: boolean;
          contestantName?: string;
          email?: string;
          error?: string;
        }[] = [];

        // Helper to delay execution
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < seatAssignmentIds.length; i += BATCH_SIZE) {
          const batch = seatAssignmentIds.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(batch.map(processAssignment));
          results.push(...batchResults);
          
          // Add delay between batches to avoid overwhelming the mail server
          if (i + BATCH_SIZE < seatAssignmentIds.length) {
            console.log(`📧 Bulk ticket email: Sent batch ${Math.floor(i / BATCH_SIZE) + 1}, waiting ${DELAY_BETWEEN_BATCHES_MS}ms before next batch...`);
            await delay(DELAY_BETWEEN_BATCHES_MS);
          }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        console.log(`📧 Background ticket email send complete: ${successCount} sent, ${failCount} failed`);
        if (failCount > 0) {
          console.error(`📧 Ticket email errors:`, results.filter(r => !r.success));
        }
      });

    } catch (error: any) {
      console.error("Error sending bulk ticket emails:", error);
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
          arrivalTime: getArrivalTimeText(recordDay.date, '7:30AM'),
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
                      <strong>Time:</strong> ${getArrivalTimeText(recordDay.date, '7:30AM')}
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
              
              // Get configured PDF for auto-confirmation emails.
              // Prefer the durable copy stored directly in the database (base64) so the
              // attachment is guaranteed to be available even if the uploaded file was
              // lost from the (ephemeral) local object store after a redeploy/restart.
              const [pdfDataBase64, pdfFileName, configuredPdfPath] = await Promise.all([
                storage.getSystemConfig('auto_confirmation_pdf_data'),
                storage.getSystemConfig('auto_confirmation_pdf_name'),
                storage.getSystemConfig('auto_confirmation_pdf_path'),
              ]);

              let pdfAttached = false;
              if (pdfDataBase64) {
                try {
                  const buffer = Buffer.from(pdfDataBase64, 'base64');
                  if (buffer.length > 0) {
                    const filename = pdfFileName || 'Record-Day-Information.pdf';
                    confirmAttachments.push({ content: buffer, contentType: 'application/pdf', filename });
                    console.log(`📎 Attached stored auto-confirmation PDF: ${filename} (${buffer.length} bytes)`);
                    pdfAttached = true;
                  } else {
                    console.error(`Stored auto-confirmation PDF decoded to an empty buffer; falling back to file store.`);
                  }
                } catch (attachErr: any) {
                  console.error(`Failed to decode stored auto-confirmation PDF:`, attachErr.message);
                }
              }
              // Back-compat / safety net: if no durable bytes were attached, fall back to
              // the configured path in the file store.
              if (!pdfAttached && configuredPdfPath && configuredPdfPath !== 'none') {
                try {
                  const objectStorageService = new ObjectStorageService();
                  const { buffer, contentType, filename } = await objectStorageService.getObjectAsBuffer(configuredPdfPath);
                  confirmAttachments.push({ content: buffer, contentType, filename });
                  console.log(`📎 Loaded configured PDF attachment from storage: ${filename}`);
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
        // Cancel the booking and move to reschedule list with isDecline=true
        await storage.cancelSeatAssignment(
          tokenRecord.seatAssignmentId,
          `Declined confirmation: ${notes || 'No reason provided'}`,
          'Contestant', // movedBy - marked by the contestant themselves
          true // isDecline = true so wasDeclined flag is set
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

  // Get standbys for a specific record day (only confirmed standbys for seating chart)
  app.get("/api/standbys/record-day/:recordDayId", async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const { all } = req.query; // Use ?all=true to get all standbys (for other pages)
      const standbys = await storage.getStandbyAssignmentsByRecordDay(recordDayId);
      
      // By default, only return confirmed standbys (for seating chart use)
      // Use ?all=true query param to get all standbys (for booking master, etc.)
      if (all === 'true') {
        res.json(standbys);
      } else {
        const confirmedStandbys = standbys.filter(s => s.status === 'confirmed');
        res.json(confirmedStandbys);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create standby assignments (bulk)
  app.post("/api/standbys", async (req, res) => {
    try {
      const { contestantIds, recordDayId, allowReturning: allowReturningParam } = req.body;
      const allowReturning = allowReturningParam === true;

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

      // Get ALL standbys across ALL record days to prevent duplicate bookings
      const allStandbys = await storage.getStandbyAssignments();
      const activeStandbys = allStandbys.filter(s => !s.movedToReschedule && s.status !== 'rescheduled' && s.status !== 'seated');
      const allStandbyContestantIds = new Map(activeStandbys.map(s => [s.contestantId, s]));
      
      // Get ALL seat assignments across ALL record days
      const allSeatAssignments = await storage.getAllSeatAssignments();
      const allSeatedContestantIds = new Map(allSeatAssignments.map((a: any) => [a.contestantId, a]));
      
      // Check if any contestant is already an active standby for ANY record day
      const alreadyStandbyIds = contestantIds.filter((id: string) => allStandbyContestantIds.has(id));
      if (alreadyStandbyIds.length > 0) {
        // Check if all existing standby assignments are on locked (completed) days
        const standbyOnLocked: string[] = [];
        const standbyOnUnlocked: string[] = [];
        for (const id of alreadyStandbyIds) {
          const standby = allStandbyContestantIds.get(id);
          if (standby) {
            const standbyRd = await storage.getRecordDayById(standby.recordDayId);
            if (standbyRd?.lockedAt != null) {
              standbyOnLocked.push(id);
            } else {
              standbyOnUnlocked.push(id);
            }
          }
        }
        
        if (standbyOnUnlocked.length > 0) {
          const standbyContestants = await Promise.all(
            standbyOnUnlocked.slice(0, 3).map(async (id: string) => {
              const contestant = await storage.getContestantById(id);
              const standby = allStandbyContestantIds.get(id);
              const standbyRecordDay = standby ? await storage.getRecordDayById(standby.recordDayId) : null;
              return { name: contestant?.name, date: standbyRecordDay?.date };
            })
          );
          const details = standbyContestants.map(c => {
            const dateStr = c.date ? new Date(c.date).toLocaleDateString('en-AU') : 'unknown';
            return `${c.name} (${dateStr})`;
          }).filter(Boolean).join(', ');
          const moreCount = standbyOnUnlocked.length > 3 ? ` and ${standbyOnUnlocked.length - 3} more` : '';
          return res.status(409).json({ 
            error: `Cannot add as standby - already on standby list: ${details}${moreCount}` 
          });
        } else if (standbyOnLocked.length > 0 && !allowReturning) {
          const firstContestant = await storage.getContestantById(standbyOnLocked[0]);
          const firstStandby = allStandbyContestantIds.get(standbyOnLocked[0]);
          const firstRd = firstStandby ? await storage.getRecordDayById(firstStandby.recordDayId) : null;
          const dayName = firstRd?.date ? new Date(firstRd.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : 'a previous day';
          const label = firstRd?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${firstContestant?.name || 'Contestant'} previously attended ${label} (${dayName}) as standby. Add as returning standby?`,
            isReturning: true,
            contestantName: firstContestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        }
        // If allowReturning is true and all are on locked days, proceed
      }
      
      // Check if any contestant is already seated for ANY record day
      // Allow returning contestants (those only seated on locked/completed record days)
      const alreadySeatedIds = contestantIds.filter((id: string) => allSeatedContestantIds.has(id));
      if (alreadySeatedIds.length > 0) {
        // Check if all seated contestants are only on locked days
        const seatedOnLockedOnly: string[] = [];
        const seatedOnUnlocked: string[] = [];
        for (const id of alreadySeatedIds) {
          const assignment = allSeatedContestantIds.get(id);
          if (assignment) {
            const seatRecordDay = await storage.getRecordDayById(assignment.recordDayId);
            if (seatRecordDay?.lockedAt != null) {
              seatedOnLockedOnly.push(id);
            } else {
              seatedOnUnlocked.push(id);
            }
          }
        }
        
        if (seatedOnUnlocked.length > 0) {
          // Regular block - some contestants are on unlocked days
          const seatedContestants = await Promise.all(
            seatedOnUnlocked.slice(0, 3).map(async (id: string) => {
              const contestant = await storage.getContestantById(id);
              const assignment = allSeatedContestantIds.get(id);
              const seatRecordDay = assignment ? await storage.getRecordDayById(assignment.recordDayId) : null;
              return { name: contestant?.name, date: seatRecordDay?.date };
            })
          );
          const details = seatedContestants.map(c => {
            const dateStr = c.date ? new Date(c.date).toLocaleDateString('en-AU') : 'unknown';
            return `${c.name} (${dateStr})`;
          }).filter(Boolean).join(', ');
          const moreCount = seatedOnUnlocked.length > 3 ? ` and ${seatedOnUnlocked.length - 3} more` : '';
          return res.status(409).json({ 
            error: `Cannot add as standby - already seated: ${details}${moreCount}` 
          });
        } else if (seatedOnLockedOnly.length > 0 && !allowReturning) {
          // All seated on locked days - returning contestant prompt
          const firstContestant = await storage.getContestantById(seatedOnLockedOnly[0]);
          const firstAssignment = allSeatedContestantIds.get(seatedOnLockedOnly[0]);
          const firstRd = firstAssignment ? await storage.getRecordDayById(firstAssignment.recordDayId) : null;
          const dayName = firstRd?.date ? new Date(firstRd.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : 'a previous day';
          const label = firstRd?.rxNumber || dayName;
          return res.status(409).json({ 
            error: `${firstContestant?.name || 'Contestant'} previously appeared on ${label} (${dayName}). Add as returning standby?`,
            isReturning: true,
            contestantName: firstContestant?.name,
            previousDay: dayName,
            previousLabel: label,
          });
        }
        // If allowReturning is true and all are on locked days, proceed
      }
      
      // Check if any contestant is DNU-rated (Do Not Use) - block them from being added as standby
      const dnuContestants: string[] = [];
      for (const contestantId of contestantIds) {
        const contestant = await storage.getContestantById(contestantId);
        if (contestant?.auditionRating?.toUpperCase().trim() === 'DNU') {
          dnuContestants.push(contestant.name);
        }
      }
      if (dnuContestants.length > 0) {
        return res.status(400).json({ 
          error: `Cannot add DNU-rated contestants as standbys: ${dnuContestants.join(', ')}` 
        });
      }
      
      // All checks passed - create standby assignments
      const assignments = contestantIds.map((contestantId: string) => ({
        contestantId,
        recordDayId,
        status: 'pending' as const,
      }));

      const created = await storage.createStandbyAssignments(assignments);
      
      // Update contestant status to assigned for new standbys
      for (const contestantId of contestantIds) {
        await storage.updateContestantAvailability(contestantId, 'assigned');
      }
      
      // Log standby additions to movement history
      const movedBy = (req as any).session?.username || 'system';
      for (const contestantId of contestantIds) {
        await storage.logMovement({
          contestantId,
          movementType: 'standby_added',
          recordDayId,
          notes: 'Added to standby list',
          movedBy,
        });
      }
      
      res.json({
        message: `Created ${created.length} standby assignments`,
        count: created.length,
        standbys: created,
      });
    } catch (error: any) {
      console.error("Error creating standby assignments:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Batch update standby priorities
  app.post("/api/standbys/batch-update-priorities", async (req, res) => {
    try {
      const { updates } = req.body;
      
      if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: "updates array is required" });
      }
      
      // Update all priorities in parallel
      await Promise.all(
        updates.map((update: { id: string; priority: number }) =>
          storage.updateStandbyAssignment(update.id, { priority: update.priority })
        )
      );
      
      res.json({ success: true, updated: updates.length });
    } catch (error: any) {
      console.error("Error batch updating standby priorities:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update standby assignment
  app.patch("/api/standbys/:id", async (req, res) => {
    const { id } = req.params;
    try {
      console.log(`[Standby Update] ID: ${id}, Body:`, req.body);
      const updateData = { ...req.body };
      
      // Filter out fields that shouldn't be updated directly on standbyAssignment table
      // or that cause issues if passed incorrectly
      const { contestant, recordDay, originalAttendanceDate, ...filteredUpdateData } = updateData;
      
      // Convert string dates to Date objects for timestamp columns
      const timestampFields = [
        'confirmedAt', 'standbyEmailSent', 'standbyTicketSent', 
        'assignedAt', 'movedToRescheduleAt', 'bookingEmailSent', 
        'confirmedRsvp', 'paperworkSent', 'paperworkReceived', 
        'paperworkOnDay', 'disclosureSent', 'disclosureReceived', 'signedIn'
      ];

      for (const field of timestampFields) {
        if (filteredUpdateData[field] && typeof filteredUpdateData[field] === 'string') {
          filteredUpdateData[field] = new Date(filteredUpdateData[field]);
        }
      }

      // Get the standby first to have access to contestant/recordDay data
      const standby = await storage.getStandbyAssignmentById(id);
      
      if (!standby) {
        console.error(`[Standby Update] Standby ${id} not found`);
        return res.status(404).json({ error: "Standby assignment not found" });
      }

      const updated = await storage.updateStandbyAssignment(id, filteredUpdateData);
      
      if (!updated) {
        console.error(`[Standby Update] Update failed for ${id}`);
        return res.status(404).json({ error: "Standby assignment not found" });
      }

      // If the standby is being rescheduled, create a canceled assignment
      if (filteredUpdateData.status === 'rescheduled' && filteredUpdateData.movedToReschedule) {
        const movedBy = filteredUpdateData.notes?.match(/\[([^\]]+)\]/)?.[1] || 'SYSTEM';
        
        // Use createOrUpdateCanceledAssignment to handle duplicates automatically
        // If contestant already in reschedule, updates their record and increments count
        const recordDayForDate = standby.recordDayId ? await storage.getRecordDayById(standby.recordDayId) : null;
        // If standby was checked in (signedIn) or confirmed, they physically attended - mark as from standby
        const wasCheckedIn = standby.signedIn || standby.confirmedAt || standby.status === 'confirmed';
        const canceledData: any = {
          contestantId: standby.contestantId,
          recordDayId: standby.recordDayId,
          blockNumber: null,
          seatLabel: standby.assignedToSeat || null,
          reason: filteredUpdateData.notes || 'DECLINED STANDBY INVITATION',
          movedBy,
          isFromStandby: wasCheckedIn ? true : false,
          wasDeclined: true,
          declinedAt: new Date(),
          originalAttendanceDate: recordDayForDate?.date ? new Date(recordDayForDate.date) : null,
        };
        // Carry over workflow fields from standby
        if (standby.bookingEmailSent) canceledData.bookingEmailSent = standby.bookingEmailSent;
        if (standby.confirmedRsvp) canceledData.confirmedRsvp = standby.confirmedRsvp;
        if (standby.paperworkSent) canceledData.paperworkSent = standby.paperworkSent;
        if (standby.paperworkSentBy) canceledData.paperworkSentBy = standby.paperworkSentBy;
        if (standby.paperworkReceived) canceledData.paperworkReceived = standby.paperworkReceived;
        if (standby.paperworkReceivedBy) canceledData.paperworkReceivedBy = standby.paperworkReceivedBy;
        if (standby.paperworkOnDay) canceledData.paperworkOnDay = standby.paperworkOnDay;
        
        await storage.createOrUpdateCanceledAssignment(canceledData);

        // Log the standby decline/reschedule to movement history
        await storage.logMovement({
          contestantId: standby.contestantId,
          movementType: 'added_to_reschedule',
          recordDayId: standby.recordDayId,
          notes: `Standby declined and moved to reschedule`,
          movedBy,
        });

        // Update contestant status to 'rescheduled'
        await storage.updateContestantAvailability(standby.contestantId, 'rescheduled');
      }

      res.json(updated);
    } catch (error: any) {
      console.error(`[Standby Update] Catch error for ${id}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update standby workflow fields (for Booking Master standby section)
  app.patch("/api/standbys/:id/workflow", async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = { ...req.body };
      
      // Convert string dates to Date objects for workflow timestamp columns
      const timestampFields = ['bookingEmailSent', 'confirmedRsvp', 'paperworkSent', 'paperworkReceived', 'paperworkOnDay', 'disclosureSent', 'disclosureReceived', 'signedIn'];
      for (const field of timestampFields) {
        if (updateData[field] && typeof updateData[field] === 'string') {
          updateData[field] = new Date(updateData[field]);
        }
      }

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
      const standby = await storage.getStandbyAssignmentById(id);
      
      if (standby) {
        // Log standby removal to movement history before deletion
        const movedBy = (req as any).session?.username || 'system';
        await storage.logMovement({
          contestantId: standby.contestantId,
          movementType: 'standby_removed',
          recordDayId: standby.recordDayId,
          notes: 'Removed from standby list',
          movedBy,
        });
      }
      
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

      // Use createOrUpdateCanceledAssignment to handle duplicates automatically
      // If contestant already in reschedule, updates their record and increments count
      // Standbys who were never confirmed and never checked in get "Canceled" type,
      // only standbys who were confirmed or checked in get "Standby" type
      const wasConfirmedOrCheckedIn = standby.confirmedAt || standby.signedIn || standby.status === 'confirmed';
      const standbyRescheduleData: any = {
        contestantId: standby.contestantId,
        recordDayId: standby.recordDayId,
        blockNumber: null,
        seatLabel: standby.assignedToSeat || null,
        reason: wasConfirmedOrCheckedIn ? 'Standby - eligible for reschedule' : 'Standby declined before confirmation',
        isFromStandby: wasConfirmedOrCheckedIn ? true : false,
        originalAttendanceDate: standby.recordDay?.date ? new Date(standby.recordDay.date) : null,
      };
      // Carry over workflow fields from standby
      if (standby.bookingEmailSent) standbyRescheduleData.bookingEmailSent = standby.bookingEmailSent;
      if (standby.confirmedRsvp) standbyRescheduleData.confirmedRsvp = standby.confirmedRsvp;
      if (standby.paperworkSent) standbyRescheduleData.paperworkSent = standby.paperworkSent;
      if (standby.paperworkSentBy) standbyRescheduleData.paperworkSentBy = standby.paperworkSentBy;
      if (standby.paperworkReceived) standbyRescheduleData.paperworkReceived = standby.paperworkReceived;
      if (standby.paperworkReceivedBy) standbyRescheduleData.paperworkReceivedBy = standby.paperworkReceivedBy;
      if (standby.paperworkOnDay) standbyRescheduleData.paperworkOnDay = standby.paperworkOnDay;
      
      const canceledAssignment = await storage.createOrUpdateCanceledAssignment(standbyRescheduleData);

      // Update the standby to mark it as moved to reschedule
      const updatedStandby = await storage.updateStandbyAssignment(id, {
        movedToReschedule: true,
        movedToRescheduleAt: new Date(),
      });

      // Update contestant status to 'rescheduled' so they are identifiable across all tabs
      await storage.updateContestantAvailability(standby.contestantId, 'rescheduled');

      // Log movement to history
      const movedBy = (req as any).session?.username || 'system';
      await storage.logMovement({
        contestantId: standby.contestantId,
        movementType: 'standby_to_reschedule',
        recordDayId: standby.recordDayId,
        notes: 'Standby moved to reschedule list',
        movedBy,
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
      // When clearing (seatLabel is null/empty), reset status to 'pending' and clear block type
      const updated = await storage.updateStandbyAssignment(matchingStandby.id, {
        assignedToSeat: seatLabel || null,
        assignedAt: seatLabel ? new Date() : null,
        status: seatLabel ? 'seated' : 'pending',
        seatedAsBlockType: seatLabel ? matchingStandby.seatedAsBlockType : null,
      });

      // Update contestant status to assigned when standby is seated
      if (seatLabel) {
        await storage.updateContestantAvailability(matchingStandby.contestantId, 'assigned');
        
        // Log standby seating to movement history
        const movedBy = (req as any).session?.username || 'system';
        await storage.logMovement({
          contestantId: matchingStandby.contestantId,
          movementType: 'standby_seated',
          recordDayId,
          toSeatLabel: seatLabel,
          notes: 'Standby seated in audience',
          movedBy,
        });
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

  // Send standby booking emails - runs in background to avoid gateway timeouts
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

      // Return immediately - emails will be sent in background
      const totalToSend = standbysWithEmail.length;
      res.json({
        message: `Processing ${totalToSend} standby booking emails in background`,
        sent: totalToSend, // Optimistic count
        failed: 0,
        processing: true,
      });

      // Process emails in background (after response is sent)
      setImmediate(async () => {
        console.log(`📧 Starting background standby email send for ${totalToSend} recipients...`);
        
        const results = {
          sent: 0,
          failed: 0,
          errors: [] as string[],
        };

        // Rate limiting for bulk emails to avoid triggering spam filters (e.g., BigPond)
        const DELAY_BETWEEN_EMAILS_MS = 1500; // 1.5 second delay between emails
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let emailCount = 0;

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

          // Get reply-to email for mailto buttons (from system config or fallback)
          const savedStandbyReplyTo = await storage.getSystemConfig('standby_reply_to_email');
          const smtpConfig = await getSmtpConfig();
          const standbyReplyToEmail = savedStandbyReplyTo || smtpConfig.fromEmail || 'noreply@example.com';
          
          // Get saved standby email template values from database
          const savedStandbyHeadline = await storage.getSystemConfig('standby_email_headline');
          const savedStandbyIntro = await storage.getSystemConfig('standby_email_intro');
          const savedStandbyInstructions = await storage.getSystemConfig('standby_email_instructions');
          const savedStandbyFooter = await storage.getSystemConfig('standby_email_footer');
          const savedStandbyMailtoBody = await storage.getSystemConfig('standby_mailto_body');
          const savedReminderMessage = await storage.getSystemConfig('email_reminder_message');
          const standbyReminderMessage = savedReminderMessage || 'Please ensure you bring your own water bottle.';
          
          // Default standby mailto body template
          const defaultStandbyMailtoBody = `Hi Deal or No Deal Team,

Name: {{name}}
Date: {{date}}

CAN YOU ATTEND AS STANDBY? (mark with X)
[ ] YES - I confirm my attendance
[ ] NO - I cannot attend (Reason: )

Group members attending (please provide FULL NAMES):
Note - group members must have attended an audition.

--- REQUIRED INFORMATION (if attending) ---

Do you have any medical conditions?
If yes, please describe:

Do you have any mobility requirements? (i.e. issues climbing stairs or standing for extended periods)
Answer:

Emergency contact name & phone number:
Answer:

Dietary requirements (mark with X):
[ ] Vegetarian
[ ] Vegan
[ ] Gluten Free
[ ] Dairy Free

Please note that all our meals are nut-free. If your dietary requirements fall outside the options, we won't be able to cater to them, so we kindly ask that you bring your own meals.

Thank you.`;
          
          const standbyMailtoBody = savedStandbyMailtoBody || defaultStandbyMailtoBody;
          
          // Use saved values with fallback defaults
          const standbyHeadline = savedStandbyHeadline || "You've Been Selected to be a Standby Contestant!";
          const standbyIntro = savedStandbyIntro || "We enjoyed meeting you at our auditions and would love to invite you to be a <strong>STANDBY CONTESTANT</strong> on Deal or No Deal. <strong><u>As a standby contestant, you may be selected to join our studio recording should any positions become available on the day.</u></strong>";
          const standbyInstructions = savedStandbyInstructions || "If you're selected to participate in studio, you will be required for the full day.\n\nAfter being a Standby Contestant, you are eligible to be FAST-TRACKED into the next available record date to attend a full day in studio. That's double the chances! You must email dond.standby@endemolshine.com.au to be rebooked to return.\n\nPlease find attached important information relating to your attendance at the Deal or No Deal recording. Please read this attachment thoroughly and get in touch ASAP should there be any issues.\n\nYou will receive another email closer to your record date with additional paperwork.";
          const standbyFooterText = savedStandbyFooter || "This is an automated message from the Deal or No Deal production team. If you have questions, please reply to this email.";

          // Build email content matching booking email style with dark maroon/gold theme
          const subject = `Standby Invitation - ${formattedDate}`;
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
                  `<p style="margin: 0 0 12px 0;">${convertLinksToHtml(paragraph.replace(/\n/g, '<br/>'))}</p>`
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
                    <a href="mailto:${standbyReplyToEmail}?subject=${encodeURIComponent(`STANDBY RESPONSE - ${standby.contestant.name} - ${formattedDate}`)}&body=${encodeURIComponent(standbyMailtoBody.replace(/\{\{name\}\}/g, standby.contestant.name).replace(/\{\{date\}\}/g, formattedDate))}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
                  </td>
                </tr>
              </table>
              
              <div style="color: #444444; font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                ${standbyInstructions.split('\n\n').map((paragraph: string) => 
                  `<p style="margin: 0 0 12px 0;">${convertLinksToHtml(paragraph.replace(/\n/g, '<br/>'))}</p>`
                ).join('')}
              </div>
              
              <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 20px 0;">
                ${convertLinksToHtml(standbyReminderMessage)}
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
            
            // Add delay between emails to avoid triggering spam filters
            emailCount++;
            if (emailCount < standbysWithEmail.length) {
              console.log(`📧 Standby booking email: Sent ${emailCount}/${standbysWithEmail.length}, waiting ${DELAY_BETWEEN_EMAILS_MS}ms...`);
              await delay(DELAY_BETWEEN_EMAILS_MS);
            }
          } catch (error: any) {
            results.failed++;
            results.errors.push(`${standby.contestant.name}: ${error.message}`);
            console.error(`📧 Standby email failed for ${standby.contestant.name}:`, error.message);
          }
        }

        console.log(`📧 Background standby email send complete: ${results.sent} sent, ${results.failed} failed`);
        if (results.errors.length > 0) {
          console.error(`📧 Email errors:`, results.errors);
        }
      });

    } catch (error: any) {
      console.error("Error sending standby emails:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export selected standbys to Excel
  app.post("/api/standbys/export", requireAuth, async (req, res) => {
    try {
      const { standbyIds } = req.body;
      
      if (!standbyIds || !Array.isArray(standbyIds) || standbyIds.length === 0) {
        return res.status(400).json({ error: "Standby IDs array is required" });
      }
      
      // Get all standbys with contestant and record day data
      const allStandbys = await storage.getStandbyAssignments();
      
      // Filter to only the requested standbys
      const filteredStandbys = allStandbys.filter(s => standbyIds.includes(s.id));
      
      // Helper to get status label
      const getStatus = (s: any) => {
        if (s.confirmedAt) return 'Confirmed';
        if (s.status === 'pending') return 'Pending';
        return s.status || 'Unknown';
      };
      
      // Build export data
      const exportData = filteredStandbys.map(s => {
        const contestant = s.contestant;
        const recordDay = s.recordDay;
        
        // Format mobile number with comma suffix for mail merge
        const mobileWithComma = contestant?.phone ? `${contestant.phone},` : '';
        
        return {
          'Priority': s.priority || '-',
          'Name': contestant?.name || '',
          'Gender': contestant?.gender || '',
          'Age': contestant?.age || '',
          'RX Date': recordDay?.date ? new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '',
          'RX Number': recordDay?.rxNumber || '',
          'Email': contestant?.email || '',
          'Mobile,': mobileWithComma,
          'Email Sent': s.standbyEmailSent ? 'Yes' : 'No',
          'Status': getStatus(s),
          'Notes': s.notes || '',
        };
      });
      
      // Sort by priority
      exportData.sort((a: any, b: any) => {
        const priorityA = typeof a['Priority'] === 'number' ? a['Priority'] : 999;
        const priorityB = typeof b['Priority'] === 'number' ? b['Priority'] : 999;
        return priorityA - priorityB;
      });
      
      // Create Excel workbook
      const ws = xlsx.utils.json_to_sheet(exportData);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Standbys');
      
      // Send as downloadable file
      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="standbys-${timestamp}.xlsx"`);
      res.send(xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' }));
    } catch (error: any) {
      console.error("Error exporting standbys data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Returning Contestants - Get map of contestant IDs to their previous episode appearances
  // A contestant is "returning" if they had an assignment on a locked record day or have standby attendance history
  app.get("/api/returning-contestants", requireAuth, async (req, res) => {
    try {
      // Run all queries in parallel — previously sequential + N+1 (one per locked day for block types)
      const [allAssignments, recordDays, standbyAttendanceRecords, canceledAssignments, allStandbys, allBlockTypes] =
        await Promise.all([
          storage.getAllSeatAssignments(),
          storage.getRecordDays(),
          storage.getStandbyAttendanceHistory(),
          storage.getCanceledAssignments(),
          storage.getStandbyAssignments(),
          storage.getAllBlockTypes(),
        ]);
      
      // Build map of locked record days only - RTN status requires a completed (locked) episode
      const lockedRecordDays = new Map<string, RecordDay>();
      for (const rd of recordDays) {
        if (rd.lockedAt) {
          lockedRecordDays.set(rd.id, rd);
        }
      }
      
      // Build block type map from the single bulk fetch (eliminates N+1 per locked day)
      const blockTypesByDay = new Map<string, Record<number, string>>();
      for (const bt of allBlockTypes) {
        if (!blockTypesByDay.has(bt.recordDayId)) {
          blockTypesByDay.set(bt.recordDayId, {});
        }
        blockTypesByDay.get(bt.recordDayId)![bt.blockNumber] = bt.blockType;
      }
      
      // Build returning contestants map: contestantId -> array of previous appearances on LOCKED days only
      const returningMap: Record<string, Array<{ recordDayId: string; date: string; label: string; type: string; blockType?: string }>> = {};
      
      // Helper to add an entry to the returning map without duplicates
      const addReturningEntry = (contestantId: string, recordDayId: string, rd: RecordDay, type: string, blockNumber?: number) => {
        if (!returningMap[contestantId]) {
          returningMap[contestantId] = [];
        }
        if (!returningMap[contestantId].some(a => a.recordDayId === recordDayId)) {
          const dateStr = rd.date ? new Date(rd.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : 'Unknown';
          const label = rd.rxNumber || dateStr;
          const dayBlockTypes = blockTypesByDay.get(recordDayId);
          const blockType = (blockNumber !== undefined && blockNumber !== null && dayBlockTypes) ? dayBlockTypes[blockNumber] : undefined;
          returningMap[contestantId].push({ recordDayId, date: dateStr, label, type, blockType });
        }
      };
      
      // 1. Seat assignments on locked record days
      for (const assignment of allAssignments) {
        const lockedRd = lockedRecordDays.get(assignment.recordDayId);
        if (lockedRd) {
          // If they were seated FROM standby (moved from standby tab to a seat on the day),
          // treat them as 'standby' type so the RTN-S badge shows correctly
          const entryType = (assignment as any).seatedFromStandby ? 'standby' : 'seated';
          addReturningEntry(assignment.contestantId, assignment.recordDayId, lockedRd, entryType, assignment.blockNumber);
        }
      }
      
      // 2. Standby attendance history - only on locked record days
      for (const record of standbyAttendanceRecords) {
        const lockedRd = lockedRecordDays.get(record.recordDayId);
        if (lockedRd) {
          addReturningEntry(record.contestantId, record.recordDayId, lockedRd, 'standby');
        }
      }
      
      // 3. Canceled assignments from checked-in standbys - only on locked record days
      for (const ca of canceledAssignments) {
        if (ca.isFromStandby) {
          const lockedRd = lockedRecordDays.get(ca.recordDayId);
          if (lockedRd) {
            addReturningEntry(ca.contestantId, ca.recordDayId, lockedRd, 'standby');
          }
        }
      }
      
      // 4. Active standbys who were checked in (signedIn set) on locked record days
      for (const standby of allStandbys) {
        if (standby.signedIn) {
          const lockedRd = lockedRecordDays.get(standby.recordDayId);
          if (lockedRd) {
            addReturningEntry(standby.contestantId, standby.recordDayId, lockedRd, 'standby');
          }
        }
      }
      
      res.json(returningMap);
    } catch (error: any) {
      console.error("Error fetching returning contestants:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Standby Attendance History - Get all returning standbys
  app.get("/api/returning-standbys", async (req, res) => {
    try {
      const returningStandbys = await storage.getReturningStandbys();
      res.json(returningStandbys);
    } catch (error: any) {
      console.error("Error fetching returning standbys:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get standby attendance history for a specific record day
  app.get("/api/standby-attendance/:recordDayId", async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const history = await storage.getStandbyAttendanceHistoryByRecordDay(recordDayId);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching standby attendance history:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark standbys as attended - move them to returning standbys list
  app.post("/api/standbys/mark-attended", async (req, res) => {
    try {
      const { standbyIds, confirmedAttendance } = req.body;

      if (!standbyIds || !Array.isArray(standbyIds) || standbyIds.length === 0) {
        return res.status(400).json({ error: "standbyIds array is required" });
      }

      // Get all standbys with their details
      const allStandbys = await storage.getStandbyAssignments();
      const selectedStandbys = allStandbys.filter(s => standbyIds.includes(s.id));

      if (selectedStandbys.length === 0) {
        return res.status(404).json({ error: "No standbys found" });
      }

      const results = {
        processed: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const standby of selectedStandbys) {
        try {
          // Get block type for the assigned seat
          const blockTypes = await storage.getBlockTypesByRecordDay(standby.recordDayId);
          const seatBlockNumber = standby.assignedToSeat ? parseInt(standby.assignedToSeat.charAt(0)) : null;
          const blockTypeConfig = seatBlockNumber ? blockTypes.find(bt => bt.blockNumber === seatBlockNumber) : null;
          const blockType = blockTypeConfig?.blockType || 'PB';

          // Create attendance history record
          await storage.createStandbyAttendanceHistory({
            contestantId: standby.contestantId,
            recordDayId: standby.recordDayId,
            blockNumber: seatBlockNumber || 1,
            seatLabel: standby.assignedToSeat?.substring(1) || null,
            blockType: blockType as 'PB' | 'NPB',
            confirmedAttendance: confirmedAttendance === true,
          });

          // Update contestant status to 'returning_standby'
          await storage.updateContestant(standby.contestantId, {
            availabilityStatus: 'returning_standby',
          });

          results.processed++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${standby.contestant?.name || 'Unknown'}: ${error.message}`);
        }
      }

      // Broadcast update via WebSocket
      if (selectedStandbys.length > 0) {
        wsManager.broadcastBookingUpdate({
          recordDayId: selectedStandbys[0].recordDayId,
        });
      }

      res.json({
        message: `Marked ${results.processed} standbys as attended`,
        ...results,
      });
    } catch (error: any) {
      console.error("Error marking standbys as attended:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Send standby ticket email with PDF attachment
  app.post("/api/standbys/:id/send-ticket", async (req, res) => {
    try {
      // Check if email is configured
      if (!await isEmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Please configure SMTP settings in the Settings page." 
        });
      }

      const { id } = req.params;
      
      // Get standby assignment with contestant and record day data
      const allStandbys = await storage.getStandbyAssignments();
      const standby = allStandbys.find(s => s.id === id);
      
      if (!standby) {
        return res.status(404).json({ error: "Standby assignment not found" });
      }

      // Require standby to be confirmed before sending ticket
      if (standby.status !== 'confirmed') {
        return res.status(400).json({ error: "Cannot send ticket before standby booking is confirmed" });
      }

      const contestant = standby.contestant;
      const recordDay = await storage.getRecordDayById(standby.recordDayId);

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
      
      // Get configurable text from system config with defaults - STANDBY specific
      const ticketHeadline = await storage.getSystemConfig('standby_ticket_headline') || 'Your STANDBY Ticket';
      const ticketIntro = await storage.getSystemConfig('standby_ticket_intro') || 'Thank you for confirming your attendance as a <strong>STANDBY CONTESTANT</strong>! This is your official standby ticket for the Deal or No Deal recording.';
      const ticketImportant = await storage.getSystemConfig('standby_ticket_important') || 'IMPORTANT: As a standby contestant, you may be selected to join our studio recording should any positions become available on the day. Please read the attached PDF carefully.';
      const ticketFooter = await storage.getSystemConfig('standby_ticket_footer') || 'This is an automated email from the Deal or No Deal production team.';
      const ticketReminderMessage = await storage.getSystemConfig('email_reminder_message') || 'Please ensure you bring your own water bottle.';
      
      // Create email HTML with banner - STANDBY version
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
    
    <!-- STANDBY Badge -->
    <tr>
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 15px 30px; text-align: center;">
        <span style="display: inline-block; background: #D97706; color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;">
          STANDBY TICKET
        </span>
      </td>
    </tr>
    
    <!-- Gold Title Bar -->
    <tr>
      <td style="background: linear-gradient(180deg, #2a0a0a 0%, #3d0c0c 100%); padding: 20px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 26px; font-weight: bold; margin: 0; letter-spacing: 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
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
              <!-- Standby Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #FEF3C7; border: 2px solid #D97706; border-radius: 6px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 15px;">
                    <p style="color: #92400E; font-size: 14px; font-weight: bold; margin: 0;">
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
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 8px; border-left: 5px solid #D97706; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #92400E; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase;">
                      Your Standby Booking Details
                    </h2>
                    <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
                      <tr>
                        <td style="padding: 8px 0;">
                          <div style="color: #666; font-size: 12px; margin-bottom: 2px;">DATE</div>
                          <div style="color: #333; font-size: 15px; font-weight: bold;">${recordDate.toUpperCase()}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <div style="color: #666; font-size: 12px; margin-bottom: 2px;">TIME</div>
                          <div style="color: #333; font-size: 15px; font-weight: bold;">8:00 AM</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <div style="color: #666; font-size: 12px; margin-bottom: 2px;">LOCATION</div>
                          <div style="color: #333; font-size: 15px; font-weight: bold;">Docklands Studios Melbourne</div>
                          <div style="color: #666; font-size: 13px; margin-top: 2px;">476 Docklands Drive, Docklands, VIC 3008</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 20px 0;">
                ${convertLinksToHtml(ticketReminderMessage)}
              </p>
              
              <p style="color: #333333; font-size: 15px; margin: 0 0 10px 0;">
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
      <td style="background-color: #2a0a0a; padding: 25px; text-align: center;">
        <p style="color: #999999; font-size: 12px; line-height: 1.5; margin: 0;">
          ${ticketFooter}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

      // Prepare attachments array (PDF removed — was Record_Day_Information.pdf)
      const attachments: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
        cid?: string;
      }> = [];
      
      // Add banner image as CID attachment if available
      if (ticketBannerBuffer) {
        attachments.push({
          filename: ticketBannerFilename,
          content: ticketBannerBuffer,
          contentType: ticketBannerContentType,
          cid: ticketBannerCid,
        });
      }

      const senderNameConfig = await storage.getSystemConfig('email_sender_name');
      const emailConfig: EmailConfig = {
        senderName: senderNameConfig || 'Deal or No Deal',
      };
      
      // Send the standby ticket email using correct function signature
      await sendEmailWithAttachment(
        contestant.email,
        `STANDBY TICKET - Deal or No Deal - ${recordDate}`,
        emailHtml,
        attachments,
        emailConfig
      );

      // Update standbyTicketSent timestamp
      await storage.updateStandbyAssignment(id, {
        standbyTicketSent: new Date(),
      });

      res.json({
        success: true,
        message: `Standby ticket email sent to ${contestant.email}`,
        contestantName: contestant.name,
        email: contestant.email,
      });
    } catch (error: any) {
      console.error("Error sending standby ticket email:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk send standby ticket emails
  app.post("/api/standbys/bulk-send-ticket", async (req, res) => {
    try {
      // Check if email is configured
      if (!await isEmailAvailable()) {
        return res.status(503).json({ 
          code: 'INTEGRATION_DISABLED',
          error: "Email sending is not available. Please configure SMTP settings in the Settings page." 
        });
      }

      const { standbyIds } = req.body;
      
      if (!standbyIds || !Array.isArray(standbyIds) || standbyIds.length === 0) {
        return res.status(400).json({ error: "standbyIds array is required" });
      }

      // Get all standbys
      const allStandbys = await storage.getStandbyAssignments();
      const selectedStandbys = allStandbys.filter(s => standbyIds.includes(s.id));

      if (selectedStandbys.length === 0) {
        return res.status(404).json({ error: "No standbys found" });
      }

      // Filter to only confirmed standbys with emails that haven't received tickets yet
      const eligibleStandbys = selectedStandbys.filter(s => 
        s.status === 'confirmed' && 
        s.contestant.email && 
        !s.standbyTicketSent
      );

      if (eligibleStandbys.length === 0) {
        return res.status(400).json({ 
          error: "No eligible standbys found. Standbys must be confirmed and have email addresses." 
        });
      }

      // Return immediately - emails will be sent in background
      const totalToSend = eligibleStandbys.length;
      res.json({
        success: true,
        message: `Processing ${totalToSend} standby ticket email(s) in background`,
        successCount: totalToSend, // Optimistic count
        failCount: 0,
        processing: true,
      });

      // Process in background (after response is sent)
      setImmediate(async () => {
        console.log(`📧 Starting background standby ticket email send for ${totalToSend} recipients...`);
        
        let successCount = 0;
        let failCount = 0;
        const results: Array<{ standbyId: string; success: boolean; error?: string }> = [];

        // Rate limiting for bulk emails to avoid triggering spam filters (e.g., BigPond)
        const DELAY_BETWEEN_EMAILS_MS = 1500; // 1.5 second delay between emails
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let emailCount = 0;

        for (const standby of eligibleStandbys) {
          try {
            // Call the single send endpoint internally
            const recordDay = await storage.getRecordDayById(standby.recordDayId);
          if (!recordDay) {
            throw new Error("Record day not found");
          }

          const recordDate = new Date(recordDay.date).toLocaleDateString('en-AU', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });

          // Get banner
          const ticketBannerCid = 'ticket-banner-image';
          let ticketBannerBuffer: Buffer | null = null;
          let ticketBannerContentType = 'image/png';
          let ticketBannerFilename = 'dond_banner.png';
          let bannerUrl = '';
          
          const bannerUrlConfig = await storage.getSystemConfig('email_banner_url') || `/uploads/branding/dond_banner.png`;
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
              bannerUrl = bannerUrlConfig;
            }
          } else {
            bannerUrl = bannerUrlConfig;
          }
          
          const ticketHeadline = await storage.getSystemConfig('standby_ticket_headline') || 'Your STANDBY Ticket';
          const ticketIntro = await storage.getSystemConfig('standby_ticket_intro') || 'Thank you for confirming your attendance as a <strong>STANDBY CONTESTANT</strong>! This is your official standby ticket for the Deal or No Deal recording.';
          const ticketImportant = await storage.getSystemConfig('standby_ticket_important') || 'IMPORTANT: As a standby contestant, you may be selected to join our studio recording should any positions become available on the day. Please read the attached PDF carefully.';
          const ticketFooter = await storage.getSystemConfig('standby_ticket_footer') || 'This is an automated email from the Deal or No Deal production team.';
          const ticketReminderMessage = await storage.getSystemConfig('email_reminder_message') || 'Please ensure you bring your own water bottle.';
          
          const emailHtml = `<!DOCTYPE html>
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
      <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 15px 30px; text-align: center;">
        <span style="display: inline-block; background: #D97706; color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;">
          STANDBY TICKET
        </span>
      </td>
    </tr>
    <tr>
      <td style="background: linear-gradient(180deg, #2a0a0a 0%, #3d0c0c 100%); padding: 20px 30px; text-align: center;">
        <h1 style="color: #D4AF37; font-size: 26px; font-weight: bold; margin: 0; letter-spacing: 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${ticketHeadline}
        </h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
          <tr>
            <td style="padding: 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #FEF3C7; border: 2px solid #D97706; border-radius: 6px; margin: 0 0 20px 0;">
                <tr>
                  <td style="padding: 15px;">
                    <p style="color: #92400E; font-size: 14px; font-weight: bold; margin: 0;">
                      ${ticketImportant}
                    </p>
                  </td>
                </tr>
              </table>
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hi ${standby.contestant.name.split(' ')[0]},
              </p>
              <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${ticketIntro}
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 8px; border-left: 5px solid #D97706; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="color: #92400E; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase;">
                      Your Standby Booking Details
                    </h2>
                    <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
                      <tr><td style="padding: 8px 0;"><div style="color: #666; font-size: 12px; margin-bottom: 2px;">DATE</div><div style="color: #333; font-size: 15px; font-weight: bold;">${recordDate.toUpperCase()}</div></td></tr>
                      <tr><td style="padding: 8px 0;"><div style="color: #666; font-size: 12px; margin-bottom: 2px;">TIME</div><div style="color: #333; font-size: 15px; font-weight: bold;">8:00 AM</div></td></tr>
                      <tr><td style="padding: 8px 0;"><div style="color: #666; font-size: 12px; margin-bottom: 2px;">LOCATION</div><div style="color: #333; font-size: 15px; font-weight: bold;">Docklands Studios Melbourne</div><div style="color: #666; font-size: 13px; margin-top: 2px;">476 Docklands Drive, Docklands, VIC 3008</div></td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 20px 0;">${convertLinksToHtml(ticketReminderMessage)}</p>
              <p style="color: #333333; font-size: 15px; margin: 0 0 10px 0;">We look forward to seeing you on the day!<br/>Kind Regards,<br/><strong>The Deal Or No Deal Team</strong></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background-color: #2a0a0a; padding: 25px; text-align: center;">
        <p style="color: #999999; font-size: 12px; line-height: 1.5; margin: 0;">${ticketFooter}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

          // PDF removed — was Record_Day_Information.pdf
          const attachments: Array<{ filename: string; content: Buffer; contentType?: string; cid?: string; }> = [];
          
          if (ticketBannerBuffer) {
            attachments.push({
              filename: ticketBannerFilename,
              content: ticketBannerBuffer,
              contentType: ticketBannerContentType,
              cid: ticketBannerCid,
            });
          }

          const senderNameConfig = await storage.getSystemConfig('email_sender_name');
          const emailConfig: EmailConfig = { senderName: senderNameConfig || 'Deal or No Deal' };
          
          // Send using correct function signature
          await sendEmailWithAttachment(
            standby.contestant.email!,
            `STANDBY TICKET - Deal or No Deal - ${recordDate}`,
            emailHtml,
            attachments,
            emailConfig
          );

          await storage.updateStandbyAssignment(standby.id, {
            standbyTicketSent: new Date(),
          });

            successCount++;
            results.push({ standbyId: standby.id, success: true });
            
            // Add delay between emails to avoid triggering spam filters
            emailCount++;
            if (emailCount < eligibleStandbys.length) {
              console.log(`📧 Standby ticket email: Sent ${emailCount}/${eligibleStandbys.length}, waiting ${DELAY_BETWEEN_EMAILS_MS}ms...`);
              await delay(DELAY_BETWEEN_EMAILS_MS);
            }
          } catch (error: any) {
            failCount++;
            results.push({ standbyId: standby.id, success: false, error: error.message });
            console.error(`📧 Standby ticket email failed for standby ${standby.id}:`, error.message);
          }
        }

        console.log(`📧 Background standby ticket email send complete: ${successCount} sent, ${failCount} failed`);
        if (failCount > 0) {
          console.error(`📧 Standby ticket email errors:`, results.filter(r => !r.success));
        }
      });

    } catch (error: any) {
      console.error("Error sending bulk standby ticket emails:", error);
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
      const emailReminderMessage = await storage.getSystemConfig('email_reminder_message') || 'Please ensure you bring your own water bottle.';
      const mailtoBodyConfig = await storage.getSystemConfig('booking_mailto_body');
      const defaultMailtoBody = `Hi Deal or No Deal Team,

Name: {{name}}
Date: {{date}}

CAN YOU ATTEND? (mark with X)
[ ] YES - I confirm my attendance
[ ] NO - I cannot attend (Reason: )

Group members attending (please provide FULL NAMES):
Note - group members must have attended an audition.

--- REQUIRED INFORMATION (if attending) ---

Do you have any medical conditions?
If yes, please describe:

Do you have any mobility requirements? (i.e. issues climbing stairs or standing for extended periods)
Answer:

Emergency contact name & phone number:
Answer:

Dietary requirements (mark with X):
[ ] Vegetarian
[ ] Vegan
[ ] Gluten Free
[ ] Dairy Free

Please note that all our meals are nut-free. If your dietary requirements fall outside the options, we won't be able to cater to them, so we kindly ask that you bring your own meals.

Thank you.`;
      const mailtoBody = mailtoBodyConfig || defaultMailtoBody;
      
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
                    <a href="mailto:${replyToEmail}?subject=${encodeURIComponent(`BOOKING RESPONSE - ${testContestantName} - ${testRecordDate}`)}&body=${encodeURIComponent(mailtoBody.replace(/\{\{name\}\}/g, testContestantName).replace(/\{\{date\}\}/g, testRecordDate))}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #D4AF37 0%, #b8962e 100%); color: #2a0a0a; text-decoration: none; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-radius: 8px; box-shadow: 0 4px 12px rgba(212,175,55,0.4);">CLICK HERE TO REPLY</a>
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
                ${convertLinksToHtml(emailReminderMessage)}
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
      if (recordDayId && typeof recordDayId === 'string' && recordDayId !== 'all' && recordDayId !== '') {
        recordDayFilteredAssignments = recordDayFilteredAssignments.filter((a: SeatAssignment) => a.recordDayId === recordDayId);
      }
      
      // Filter canceled assignments by record day for declined count
      let recordDayFilteredCanceled = [...canceledAssignments];
      if (recordDayId && typeof recordDayId === 'string' && recordDayId !== 'all' && recordDayId !== '') {
        recordDayFilteredCanceled = recordDayFilteredCanceled.filter((a: any) => a.recordDayId === recordDayId);
      }
      
      // Helper to check if assignment is declined (notes/reason contain [DECLINED] or wasDeclined flag is set)
      const isDeclined = (a: SeatAssignment) => a.notes?.toUpperCase().includes('DECLINED');
      const isCanceledDeclined = (a: any) => a.wasDeclined || a.reason?.toUpperCase().includes('DECLINED');
      
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
      
      // Enrich with contestant and record day data.
      // Drop any orphaned seat assignments whose recordDay no longer exists —
      // these are stale rows left over from old deletes and would otherwise
      // show up in the tracker as ghost duplicates with no date.
      const enrichedAssignments = statusFilteredAssignments
        .map((a: SeatAssignment) => {
          const contestant = contestants.find(c => c.id === a.contestantId);
          const recordDay = recordDays.find(rd => rd.id === a.recordDayId);
          return {
            ...a,
            contestant: contestant || null,
            recordDay: recordDay || null,
          };
        })
        .filter((a: any) => a.recordDay !== null);
      
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

  // Export booking tracker data to Excel (filtered by assignment IDs)
  app.post("/api/booking-tracker/export", requireAuth, async (req, res) => {
    try {
      const { assignmentIds } = req.body;
      
      if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
        return res.status(400).json({ error: "Assignment IDs array is required" });
      }
      
      // Get all necessary data
      const allAssignments = await storage.getAllSeatAssignments();
      const contestants = await storage.getContestants();
      const recordDays = await storage.getRecordDays();
      
      // Filter to only the requested assignments
      const filteredAssignments = allAssignments.filter(a => assignmentIds.includes(a.id));
      
      // Helper to check if assignment is declined
      const isDeclined = (a: SeatAssignment) => a.notes?.toUpperCase().includes('DECLINED');
      
      // Helper to get status label
      const getStatus = (a: SeatAssignment) => {
        if (isDeclined(a)) return 'Declined';
        if (a.confirmedRsvp) return 'Confirmed';
        if (a.bookingEmailSent) return 'Awaiting Reply';
        return 'Not Sent';
      };
      
      // Build export data (export all filtered assignments, not just confirmed)
      const exportData = filteredAssignments.map(a => {
        const contestant = contestants.find(c => c.id === a.contestantId);
        const recordDay = recordDays.find(rd => rd.id === a.recordDayId);
        
        // Format mobile number with comma suffix for mail merge
        const mobileWithComma = contestant?.phone ? `${contestant.phone},` : '';
        
        return {
          'Name': contestant?.name || '',
          'Rating': a.rating || contestant?.auditionRating || '',
          'Gender': contestant?.gender || '',
          'Age': contestant?.age || '',
          'Attending With': a.attendingWithOverride || contestant?.attendingWith || '',
          'RX Date': recordDay?.date ? new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '',
          'RX Number': recordDay?.rxNumber || '',
          'Block': a.blockNumber || '',
          'Seat': a.seatLabel || '',
          'Email': contestant?.email || '',
          'Mobile,': mobileWithComma,
          'Email Sent': a.bookingEmailSent ? 'Yes' : 'No',
          'Status': getStatus(a),
          'Ticket Sent': a.ticketEmailSent ? 'Yes' : 'No',
          'Notes': a.notes || '',
        };
      });
      
      // Sort by RX date, then block, then seat
      exportData.sort((a: any, b: any) => {
        const dateA = a['RX Date'] ? new Date(a['RX Date']).getTime() : 0;
        const dateB = b['RX Date'] ? new Date(b['RX Date']).getTime() : 0;
        if (dateA !== dateB) return dateA - dateB;
        if (a['Block'] !== b['Block']) return Number(a['Block']) - Number(b['Block']);
        return String(a['Seat'] || '').localeCompare(String(b['Seat'] || ''));
      });
      
      // Create Excel workbook
      const ws = xlsx.utils.json_to_sheet(exportData);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Booking Tracker');
      
      // Send as downloadable file
      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="booking-tracker-${timestamp}.xlsx"`);
      res.send(xlsx.write(wb, { bookType: 'xlsx', type: 'buffer' }));
    } catch (error: any) {
      console.error("Error exporting booking tracker data:", error);
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
      // Also include temporary contestants who were added directly to the seating chart
      let filteredAssignments = assignments.filter((a: SeatAssignment) => {
        if (a.bookingEmailSent) return true;
        if (a.confirmedRsvp || a.status === 'confirmed') return true;
        const contestant = contestants.find(c => c.id === a.contestantId);
        return contestant?.isTemporary === true;
      });
      
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
      
      // Return immediately - emails will be sent in background
      const totalToSend = assignmentIds.length;
      res.json({ 
        success: true,
        sent: totalToSend, // Optimistic count
        failed: 0,
        processing: true,
      });

      // Process in background (after response is sent)
      setImmediate(async () => {
        console.log(`📧 Starting background paperwork email send for ${totalToSend} recipients...`);
        
        let sent = 0;
        let failed = 0;
        const errors: string[] = [];
        
        // Rate limiting for bulk emails
        const DELAY_BETWEEN_EMAILS_MS = 1500; // 1.5 second delay between emails
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let emailCount = 0;
        
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
                <a href="${adobeSignLink}" style="color: #0055A4; word-break: break-all;">${adobeSignLink}</a>
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
              emailCount++;
              
              // Add delay after sending to avoid overwhelming mail server
              if (emailCount < assignmentIds.length) {
                console.log(`📧 Paperwork bulk email: Sent ${emailCount}/${assignmentIds.length}, waiting ${DELAY_BETWEEN_EMAILS_MS}ms before next...`);
                await delay(DELAY_BETWEEN_EMAILS_MS);
              }
            } else {
              failed++;
              errors.push(`Failed to send to ${contestant.email}: ${emailResult.error}`);
            }
          } catch (err: any) {
            failed++;
            errors.push(`Error processing ${assignmentId}: ${err.message}`);
          }
        }
        
        console.log(`📧 Background paperwork email send complete: ${sent} sent, ${failed} failed`);
        if (failed > 0) {
          console.error(`📧 Paperwork email errors:`, errors);
        }
      });

    } catch (error: any) {
      console.error("Error bulk sending paperwork:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk mark emails as copied (for tracking when emails are copied to external sending)
  app.post("/api/paperwork/bulk-mark-copied", requireAuth, async (req, res) => {
    try {
      const { assignmentIds } = req.body;
      
      if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
        return res.status(400).json({ error: "Assignment IDs must be a non-empty array" });
      }
      
      const now = new Date();
      let marked = 0;
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
          
          await storage.updateSeatAssignmentWorkflow(assignmentId, {
            emailsCopiedAt: now,
          });
          
          // Broadcast update via WebSocket
          wsManager.broadcastBookingUpdate({
            type: 'booking-master-update',
            recordDayId: assignment.recordDayId,
            assignmentId,
            field: 'emailsCopiedAt',
            value: now,
          });
          
          marked++;
        } catch (err: any) {
          failed++;
          errors.push(`Error processing ${assignmentId}: ${err.message}`);
        }
      }
      
      res.json({ 
        success: true,
        marked,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error("Error bulk marking emails as copied:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear emails copied status (for resetting tracking)
  app.delete("/api/paperwork/clear-copied", requireAuth, async (req, res) => {
    try {
      const { assignmentIds } = req.body;
      
      if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
        return res.status(400).json({ error: "Assignment IDs must be a non-empty array" });
      }
      
      let cleared = 0;
      let failed = 0;
      
      for (const assignmentId of assignmentIds) {
        try {
          const assignment = await storage.getSeatAssignmentById(assignmentId);
          if (!assignment) {
            failed++;
            continue;
          }
          
          await storage.updateSeatAssignmentWorkflow(assignmentId, {
            emailsCopiedAt: null,
          });
          
          // Broadcast update via WebSocket
          wsManager.broadcastBookingUpdate({
            type: 'booking-master-update',
            recordDayId: assignment.recordDayId,
            assignmentId,
            field: 'emailsCopiedAt',
            value: null,
          });
          
          cleared++;
        } catch {
          failed++;
        }
      }
      
      res.json({ success: true, cleared, failed });
    } catch (error: any) {
      console.error("Error clearing copied status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================
  // System Config Endpoints
  // ==========================================

  // Keys holding large/sensitive blobs that must only be accessed through their
  // own dedicated, authenticated endpoints — never the generic config routes.
  const PROTECTED_CONFIG_KEYS = new Set<string>(['auto_confirmation_pdf_data', 'auto_confirmation_pdf_name']);

  // Get a system config value
  app.get("/api/system-config/:key", async (req, res) => {
    try {
      const { key } = req.params;
      if (PROTECTED_CONFIG_KEYS.has(key)) {
        return res.status(403).json({ error: "This config key is not accessible here." });
      }
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

      if (PROTECTED_CONFIG_KEYS.has(key)) {
        return res.status(403).json({ error: "This config key is not writable here." });
      }
      
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
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.replit.dev https://*.janeway.replit.dev https://*.replit.com https://replit.com");
    // Prevent caching to ensure latest template is always shown
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      // Get saved template values with fallback defaults
      const headline = await storage.getSystemConfig('booking_email_headline') || 'Your Booking is Confirmed!';
      const intro = await storage.getSystemConfig('booking_email_intro') || 'Congratulations! You\'ve secured your spot in the <strong style="color: #8B0000;">Deal or No Deal</strong> studio audience.';
      const instructions = await storage.getSystemConfig('booking_email_instructions') || 'Please confirm your attendance by clicking the button below. You can also let us know about dietary requirements or ask any questions.';
      const additionalInstructions = await storage.getSystemConfig('booking_email_additional_instructions') || 'We will be recording multiple episodes on the day. The recording of these shows will take approximately 10 hours. Please be prepared to make yourself available for the full length of time.';
      const footer = await storage.getSystemConfig('booking_email_footer') || 'This is an automated message from the Deal or No Deal production team.<br/>If you have questions, please use the confirmation form to submit them.';
      const reminderMessage = await storage.getSystemConfig('email_reminder_message') || 'Please ensure you bring your own water bottle.';
      const replyToEmail = await storage.getSystemConfig('booking_reply_to_email') || 'bookings@dealornodeal.example.com';
      const mailtoBodyConfig = await storage.getSystemConfig('booking_mailto_body');
      const defaultMailtoBody = `Hi Deal or No Deal Team,

Name: {{name}}
Date: {{date}}

CAN YOU ATTEND? (mark with X)
[ ] YES - I confirm my attendance
[ ] NO - I cannot attend (Reason: )

Group members attending (please provide FULL NAMES):
Note - group members must have attended an audition.

--- REQUIRED INFORMATION (if attending) ---

Do you have any medical conditions?
If yes, please describe:

Do you have any mobility requirements? (i.e. issues climbing stairs or standing for extended periods)
Answer:

Emergency contact name & phone number:
Answer:

Dietary requirements (mark with X):
[ ] Vegetarian
[ ] Vegan
[ ] Gluten Free
[ ] Dairy Free

Please note that all our meals are nut-free. If your dietary requirements fall outside the options, we won't be able to cater to them, so we kindly ask that you bring your own meals.

Thank you.`;
      const mailtoBody = mailtoBodyConfig || defaultMailtoBody;
      
      // Get record day data if provided
      const recordDayId = req.query.recordDayId as string | undefined;
      let sampleName = 'Sample Contestant';
      // Use dynamic sample date (2 weeks from now) to avoid caching confusion
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);
      let sampleDate = futureDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
      const replyMailto = `mailto:${replyToEmail}?subject=${encodeURIComponent(`BOOKING RESPONSE - ${sampleName} - ${sampleDate}`)}&body=${encodeURIComponent(mailtoBody.replace(/\{\{name\}\}/g, sampleName).replace(/\{\{date\}\}/g, sampleDate))}`;
      
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
                  ${convertLinksToHtml(reminderMessage)}
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

  // Dynamic Ticket Email Preview
  app.get("/api/email-preview/ticket", async (req, res) => {
    // Allow iframe embedding from same origin
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.replit.dev https://*.janeway.replit.dev https://*.replit.com https://replit.com");
    // Prevent caching to ensure latest template is always shown
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      // Get configurable text from system config with defaults
      const ticketHeadline = await storage.getSystemConfig('ticket_email_headline') || 'Your Official Ticket';
      const ticketIntro = await storage.getSystemConfig('ticket_email_intro') || 'Thank you for confirming your attendance! This is your official ticket for the Deal or No Deal recording.';
      const ticketImportant = await storage.getSystemConfig('ticket_email_important') || 'IMPORTANT INFORMATION is attached in the PDF. Please read it carefully before your record day.';
      const ticketFooter = await storage.getSystemConfig('ticket_email_footer') || 'This is an automated email from the Deal or No Deal production team.';
      
      // Get record day data if provided
      const recordDayId = req.query.recordDayId as string | undefined;
      // Use dynamic sample date (2 weeks from now) to avoid caching confusion
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);
      let sampleDate = futureDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      
      if (recordDayId) {
        try {
          const recordDay = await storage.getRecordDayById(recordDayId);
          if (recordDay) {
            const date = new Date(recordDay.date);
            sampleDate = date.toLocaleDateString('en-AU', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          }
        } catch (e) {
          // Ignore errors, use defaults
        }
      }
      
      const sampleName = 'Sample Contestant';
      
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ticket Email Preview</title>
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
            ${ticketHeadline}
          </h1>
        </td>
      </tr>
      
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
                  Hi ${sampleName.split(' ')[0]},
                </p>
                <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  ${ticketIntro}
                </div>
                
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #fff9e6 0%, #fff5d6 100%); border-radius: 8px; border-left: 5px solid #D4AF37; margin: 0 0 25px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <h2 style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase;">
                        Your Booking Details
                      </h2>
                      <p style="color: #333333; font-size: 15px; line-height: 1.8; margin: 0 0 5px 0;">
                        <strong style="color: #8B0000;">DATE:</strong> ${sampleDate.toUpperCase()}
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
      
      <tr>
        <td style="background-color: #2a0a0a; padding: 15px 30px 30px 30px; text-align: center;">
          <p style="color: #aa8888; font-size: 11px; line-height: 1.6; margin: 0;">
            ${ticketFooter}
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
      console.error("Error generating ticket email preview:", error);
      res.setHeader('Content-Type', 'text/html');
      res.status(500).send(`<!DOCTYPE html><html><head><title>Preview Error</title></head><body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background: #fee2e2;"><h2 style="color: #dc2626;">Preview Error</h2><p style="color: #7f1d1d;">${error.message || 'Failed to load preview'}</p></body></html>`);
    }
  });

  // Dynamic Availability Email Preview
  app.get("/api/email-preview/availability", async (req, res) => {
    // Allow iframe embedding from same origin
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.replit.dev https://*.janeway.replit.dev https://*.replit.com https://replit.com");
    // Prevent caching to ensure latest template is always shown
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      // Query overrides allow a live (unsaved) preview from the Settings form.
      // Priority: query override -> saved system_config -> hardcoded default.
      const q = req.query as Record<string, string | undefined>;
      const isLiveEdit = q.subject !== undefined || q.headline !== undefined || q.intro !== undefined || q.instructions !== undefined || q.footer !== undefined;
      const subject = q.subject || await storage.getSystemConfig('availability_email_subject') || 'Deal or No Deal - Availability Check';
      const headline = q.headline || await storage.getSystemConfig('availability_email_headline') || 'Availability Check';
      const intro = q.intro || await storage.getSystemConfig('availability_email_intro') || "Congratulations! Following your successful audition, we'd love to invite you to be part of a Deal or No Deal recording. Please let us know your availability for our upcoming dates.";
      const instructions = q.instructions || await storage.getSystemConfig('availability_email_instructions') || "Please complete the form as soon as possible so we can allocate recording slots. If you have any questions, please reply to this email.";
      const footer = q.footer || await storage.getSystemConfig('availability_email_footer') || 'This is an automated message from the Deal or No Deal production team. Please do not forward this email as it contains a unique response link.';
      const msFormUrl = q.formUrl || await storage.getSystemConfig('availability_form_url') || 'https://forms.office.com/Pages/ResponsePage.aspx?id=ayXN-4f600uQrCY8eucYVbItEwiVLdlEnys-du5SGAxUMFhPMk9JTUFDUThQWDlLRllCOFhaUk5WVS4u';
      
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
    <span style="background: ${isLiveEdit ? '#d97706' : '#28a745'}; color: white; padding: 8px 16px; border-radius: 4px; font-size: 14px;">${isLiveEdit ? 'LIVE PREVIEW - Showing Your Current (Unsaved) Edits' : 'LIVE PREVIEW - Using Your Saved Template'}</span>
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
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.replit.dev https://*.janeway.replit.dev https://*.replit.com https://replit.com");
    // Prevent caching to ensure latest template is always shown
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      // Get saved template values with fallback defaults
      const headline = await storage.getSystemConfig('standby_email_headline') || "You've Been Selected to be a Standby Contestant!";
      const intro = await storage.getSystemConfig('standby_email_intro') || "We enjoyed meeting you at our auditions and would love to invite you to be a <strong>STANDBY CONTESTANT</strong> on Deal or No Deal. <strong><u>As a standby contestant, you may be selected to join our studio recording should any positions become available on the day.</u></strong>";
      const instructions = await storage.getSystemConfig('standby_email_instructions') || "If you're selected to participate in studio, you will be required for the full day.\n\nAfter being a Standby Contestant, you are eligible to be FAST-TRACKED into the next available record date to attend a full day in studio. That's double the chances! You must email dond.standby@endemolshine.com.au to be rebooked to return.\n\nPlease find attached important information relating to your attendance at the Deal or No Deal recording. Please read this attachment thoroughly and get in touch ASAP should there be any issues.\n\nYou will receive another email closer to your record date with additional paperwork.";
      const footer = await storage.getSystemConfig('standby_email_footer') || 'This is an automated message from the Deal or No Deal production team. If you have questions, please reply to this email.';
      const reminderMessage = await storage.getSystemConfig('email_reminder_message') || 'Please ensure you bring your own water bottle.';
      const mailtoBodyConfig = await storage.getSystemConfig('standby_mailto_body');
      const defaultMailtoBody = `Hi Deal or No Deal Team,

Name: {{name}}
Date: {{date}}

CAN YOU ATTEND AS STANDBY? (mark with X)
[ ] YES - I confirm my attendance
[ ] NO - I cannot attend (Reason: )

Group members attending (please provide FULL NAMES):
Note - group members must have attended an audition.

--- REQUIRED INFORMATION (if attending) ---

Do you have any medical conditions?
If yes, please describe:

Do you have any mobility requirements? (i.e. issues climbing stairs or standing for extended periods)
Answer:

Emergency contact name & phone number:
Answer:

Dietary requirements (mark with X):
[ ] Vegetarian
[ ] Vegan
[ ] Gluten Free
[ ] Dairy Free

Please note that all our meals are nut-free. If your dietary requirements fall outside the options, we won't be able to cater to them, so we kindly ask that you bring your own meals.

Thank you.`;
      const mailtoBody = mailtoBodyConfig || defaultMailtoBody;
      
      // Get reply-to email (from system config or fallback to SMTP)
      const savedReplyTo = await storage.getSystemConfig('standby_reply_to_email');
      const smtpConfig = await getSmtpConfig();
      const replyToEmail = savedReplyTo || smtpConfig.fromEmail || 'noreply@example.com';
      
      // Get record day data if provided
      const recordDayId = req.query.recordDayId as string | undefined;
      let sampleName = 'Sarah Johnson';
      // Use a dynamic sample date (2 weeks from now) to avoid caching confusion
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 14);
      const sampleDateOptions: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      let sampleDate = futureDate.toLocaleDateString('en-AU', sampleDateOptions).toUpperCase();
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
      const replyMailto = `mailto:${replyToEmail}?subject=${encodeURIComponent(`STANDBY RESPONSE - ${sampleName} - ${sampleDate}`)}&body=${encodeURIComponent(mailtoBody.replace(/\{\{name\}\}/g, sampleName).replace(/\{\{date\}\}/g, sampleDate))}`;
      
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
                
                <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 20px 0;">
                  ${convertLinksToHtml(reminderMessage)}
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

  // Standby Ticket Email Preview endpoint
  app.get("/api/email-preview/standby-ticket", async (req, res) => {
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.replit.dev https://*.janeway.replit.dev https://*.replit.com https://replit.com");
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      const ticketHeadline = await storage.getSystemConfig('standby_ticket_headline') || 'Your STANDBY Ticket';
      const ticketIntro = await storage.getSystemConfig('standby_ticket_intro') || 'Thank you for confirming your attendance as a <strong>STANDBY CONTESTANT</strong>! This is your official standby ticket for the Deal or No Deal recording.';
      const ticketImportant = await storage.getSystemConfig('standby_ticket_important') || 'IMPORTANT: As a standby contestant, you may be selected to join our studio recording should any positions become available on the day. Please read the attached PDF carefully.';
      const ticketFooter = await storage.getSystemConfig('standby_ticket_footer') || 'This is an automated email from the Deal or No Deal production team.';
      const reminderMessage = await storage.getSystemConfig('email_reminder_message') || 'Please ensure you bring your own water bottle.';
      
      // Use actual record day date if provided, otherwise fallback to sample date
      let sampleDate: string;
      let rxNumber = 'RX01';
      const recordDayId = req.query.recordDayId as string | undefined;
      
      if (recordDayId) {
        const recordDay = await storage.getRecordDayById(recordDayId);
        if (recordDay) {
          sampleDate = new Date(recordDay.date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
          rxNumber = recordDay.name || 'RX01';
        } else {
          const futureDate = new Date();
          futureDate.setDate(futureDate.getDate() + 14);
          sampleDate = futureDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
        }
      } else {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 14);
        sampleDate = futureDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
      }
      
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Standby Ticket Email Preview</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <div style="text-align: center; margin-bottom: 20px;">
    <span style="background: #D97706; color: white; padding: 8px 16px; border-radius: 4px; font-size: 14px;">LIVE PREVIEW - Standby Ticket Template</span>
  </div>
  <div style="max-width: 600px; margin: 0 auto; background-color: #2a0a0a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td style="padding: 0; line-height: 0; background: linear-gradient(135deg, #4a1a1a 0%, #2a0a0a 100%); text-align: center; padding: 30px;">
          <h2 style="color: #D4AF37; font-size: 28px; margin: 0; letter-spacing: 2px;">DEAL OR NO DEAL</h2>
          <p style="color: #ffffff; margin: 10px 0 0 0; font-size: 14px;">BANNER IMAGE APPEARS HERE</p>
        </td>
      </tr>
      <tr>
        <td style="background: linear-gradient(180deg, #3d0c0c 0%, #2a0a0a 100%); padding: 15px 30px; text-align: center;">
          <span style="display: inline-block; background: #D97706; color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase;">
            STANDBY TICKET
          </span>
        </td>
      </tr>
      <tr>
        <td style="background: linear-gradient(180deg, #2a0a0a 0%, #3d0c0c 100%); padding: 20px 30px; text-align: center;">
          <h1 style="color: #D4AF37; font-size: 26px; font-weight: bold; margin: 0; letter-spacing: 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">
            ${ticketHeadline}
          </h1>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 0 20px 25px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);">
            <tr>
              <td style="padding: 30px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #FEF3C7; border: 2px solid #D97706; border-radius: 6px; margin: 0 0 20px 0;">
                  <tr>
                    <td style="padding: 15px;">
                      <p style="color: #92400E; font-size: 14px; font-weight: bold; margin: 0;">
                        ${ticketImportant}
                      </p>
                    </td>
                  </tr>
                </table>
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  Hi Sarah,
                </p>
                <div style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  ${ticketIntro}
                </div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-radius: 8px; border-left: 5px solid #D97706; margin: 0 0 25px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <h2 style="color: #92400E; font-size: 14px; font-weight: bold; margin: 0 0 15px 0; text-transform: uppercase;">
                        Your Standby Booking Details
                      </h2>
                      <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
                        <tr><td style="padding: 8px 0;"><div style="color: #666; font-size: 12px; margin-bottom: 2px;">DATE</div><div style="color: #333; font-size: 15px; font-weight: bold;">${sampleDate}</div></td></tr>
                        <tr><td style="padding: 8px 0;"><div style="color: #666; font-size: 12px; margin-bottom: 2px;">TIME</div><div style="color: #333; font-size: 15px; font-weight: bold;">8:00 AM</div></td></tr>
                        <tr><td style="padding: 8px 0;"><div style="color: #666; font-size: 12px; margin-bottom: 2px;">LOCATION</div><div style="color: #333; font-size: 15px; font-weight: bold;">Docklands Studios Melbourne</div><div style="color: #666; font-size: 13px; margin-top: 2px;">476 Docklands Drive, Docklands, VIC 3008</div></td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <p style="color: #8B0000; font-size: 14px; font-weight: bold; margin: 0 0 20px 0;">${convertLinksToHtml(reminderMessage)}</p>
                <p style="color: #333333; font-size: 15px; margin: 0 0 10px 0;">We look forward to seeing you on the day!<br/>Kind Regards,<br/><strong>The Deal Or No Deal Team</strong></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background-color: #2a0a0a; padding: 25px; text-align: center;">
          <p style="color: #999999; font-size: 12px; line-height: 1.5; margin: 0;">${ticketFooter}</p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error: any) {
      console.error("Error generating standby ticket email preview:", error);
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
          const tabName = new Date(recordDay.date).toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'short',
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
  // Auto-Confirmation PDF (durable attachment for confirmation emails)
  // =============================================
  // The PDF bytes are stored directly in system_config (base64) so the
  // confirmation email reliably includes the attachment regardless of the
  // (ephemeral) local file store. These keys are shared across DOND and CELEB.

  app.get("/api/auto-confirmation-pdf", requireAuth, async (req, res) => {
    try {
      const [pdfPath, name, data] = await Promise.all([
        storage.getSystemConfig('auto_confirmation_pdf_path'),
        storage.getSystemConfig('auto_confirmation_pdf_name'),
        storage.getSystemConfig('auto_confirmation_pdf_data'),
      ]);
      const hasData = !!data;
      const sizeBytes = data ? Math.floor((data.length * 3) / 4) : 0;
      res.json({ path: pdfPath || 'none', name: name || null, hasData, sizeBytes });
    } catch (error: any) {
      console.error("Error reading auto-confirmation PDF config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/auto-confirmation-pdf", requireAuth, async (req, res) => {
    try {
      const { path: assetPath } = req.body as { path?: string };

      // Clearing the attachment.
      if (!assetPath || assetPath === 'none') {
        await storage.setSystemConfig('auto_confirmation_pdf_path', 'none');
        await storage.setSystemConfig('auto_confirmation_pdf_name', '');
        await storage.setSystemConfig('auto_confirmation_pdf_data', '');
        return res.json({ cleared: true, hasData: false });
      }

      // Read the just-selected PDF now (while it still exists in the file store)
      // and persist its bytes durably so the confirmation email always has them.
      const objectStorageService = new ObjectStorageService();
      let buffer: Buffer;
      let filename: string;
      let contentType: string;
      try {
        const result = await objectStorageService.getObjectAsBuffer(assetPath);
        buffer = result.buffer;
        filename = result.filename;
        contentType = result.contentType;
      } catch (readErr: any) {
        return res.status(400).json({
          error: "Could not read the selected PDF. Please click 'Upload PDF', wait for it to appear in Uploaded Files, then select it and save again.",
        });
      }

      // Only PDFs may be configured here.
      if (contentType !== 'application/pdf' && !filename.toLowerCase().endsWith('.pdf')) {
        return res.status(400).json({ error: "The selected file is not a PDF." });
      }

      await storage.setSystemConfig('auto_confirmation_pdf_path', assetPath);
      await storage.setSystemConfig('auto_confirmation_pdf_name', filename);
      await storage.setSystemConfig('auto_confirmation_pdf_data', buffer.toString('base64'));

      res.json({ saved: true, hasData: true, name: filename, sizeBytes: buffer.length });
    } catch (error: any) {
      console.error("Error saving auto-confirmation PDF:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // =============================================
  // Popup Settings (Customizable Announcements)
  // =============================================

  app.get("/api/popup/config", requireAuth, async (req, res) => {
    try {
      const [enabled, title, description, mediaType, mediaUrl] = await Promise.all([
        storage.getSystemConfig("popup_enabled"),
        storage.getSystemConfig("popup_title"),
        storage.getSystemConfig("popup_description"),
        storage.getSystemConfig("popup_media_type"),
        storage.getSystemConfig("popup_media_url"),
      ]);
      res.json({
        enabled: enabled === "true",
        title: title || "Announcement",
        description: description || "",
        mediaType: mediaType || "none",
        mediaUrl: mediaUrl || "",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/popup/config", requireAuth, async (req, res) => {
    try {
      const { enabled, title, description, mediaType, mediaUrl } = req.body;
      
      if (enabled !== undefined) await storage.setSystemConfig("popup_enabled", String(enabled));
      if (title !== undefined) await storage.setSystemConfig("popup_title", title);
      if (description !== undefined) await storage.setSystemConfig("popup_description", description);
      if (mediaType !== undefined) await storage.setSystemConfig("popup_media_type", mediaType);
      if (mediaUrl !== undefined) await storage.setSystemConfig("popup_media_url", mediaUrl);
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/popup/upload", requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const file = req.file;
      const ext = path.extname(file.originalname).toLowerCase();
      const isVideo = ['.mp4', '.webm', '.mov', '.avi'].includes(ext);
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);

      if (!isVideo && !isImage) {
        return res.status(400).json({ error: "Only image or video files are allowed" });
      }

      const fileName = `popup-media${ext}`;
      const filePath = path.join('client/public', fileName);
      
      await fs.promises.writeFile(filePath, file.buffer);
      
      const mediaType = isVideo ? 'video' : 'image';
      await storage.setSystemConfig("popup_media_type", mediaType);
      await storage.setSystemConfig("popup_media_url", `/${fileName}`);

      res.json({ 
        success: true, 
        mediaType,
        mediaUrl: `/${fileName}`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =============================================
  // Backup / Export Routes
  // =============================================

  // Export all data as JSON backup
  app.get("/api/backup/export", async (req, res) => {
    try {
      // Gather all data via storage interface
      const allRecordDays = await storage.getRecordDays();

      const [
        allContestants,
        allGroups,
        allSeatAssignments,
        allBlockTypesArrays,
        allBlockNotesArrays,
        allStandbys,
        allCanceled,
        allAttendanceIssues,
        allRebookingHistory,
        allStandbyAttendanceHistory,
        allCastingCards,
        allRxPlanningEntries,
        allPostRecordTracking,
        allNoticeboardPosts,
        allMovementHistory,
        allContestantAvailability,
        allBirthdayEntries,
      ] = await Promise.all([
        storage.getContestants(),
        storage.getGroups(),
        storage.getAllSeatAssignments(),
        Promise.all(allRecordDays.map(rd => storage.getBlockTypesByRecordDay(rd.id))),
        Promise.all(allRecordDays.map(rd => storage.getBlockNotes(rd.id))),
        storage.getStandbyAssignments(),
        storage.getCanceledAssignments(),
        storage.getAttendanceIssues(),
        storage.getAllRebookingHistory(),
        storage.getStandbyAttendanceHistory(),
        storage.getCastingCards(),
        storage.getAllRxPlanningData(),
        storage.getPostRecordEntries(),
        storage.getNoticeboardPosts(),
        storage.getMovementHistory(),
        storage.getAllAvailabilityResponses(),
        storage.getBirthdayEntries(),
      ]);

      const flatBlockTypes = allBlockTypesArrays.flat();
      const flatBlockNotes = allBlockNotesArrays.flat();

      // Direct DB queries for tables without bulk storage methods
      let prizeWinnersData: any[] = [];
      let castingCardVersionsData: any[] = [];
      let systemConfigData: any[] = [];
      let noticeboardCommentsData: any[] = [];
      let systemSettingsData: any[] = [];

      if (db) {
        [
          prizeWinnersData,
          castingCardVersionsData,
          systemConfigData,
          noticeboardCommentsData,
          systemSettingsData,
        ] = await Promise.all([
          db.select().from(prizeWinnersTable),
          db.select().from(castingCardVersionsTable),
          db.select().from(systemConfigTable),
          db.select().from(noticeboardCommentsTable),
          db.select().from(systemSettingsTable),
        ]);
      }
      
      const backupData = {
        version: "2.0",
        exportedAt: new Date().toISOString(),
        data: {
          // Core seating data
          recordDays: allRecordDays,
          contestants: allContestants,
          groups: allGroups,
          seatAssignments: allSeatAssignments,
          blockTypes: flatBlockTypes,
          standbys: allStandbys,
          canceledAssignments: allCanceled,
          // History & audit trails
          attendanceIssues: allAttendanceIssues,
          rebookingHistory: allRebookingHistory,
          standbyAttendanceHistory: allStandbyAttendanceHistory,
          movementHistory: allMovementHistory,
          // Booking workflow
          contestantAvailability: allContestantAvailability,
          // Content & config
          castingCards: allCastingCards,
          castingCardVersions: castingCardVersionsData,
          rxPlanningEntries: allRxPlanningEntries,
          blockNotes: flatBlockNotes,
          postRecordTracking: allPostRecordTracking,
          prizeWinners: prizeWinnersData,
          birthdayEntries: allBirthdayEntries,
          // Noticeboard
          noticeboardPosts: allNoticeboardPosts,
          noticeboardComments: noticeboardCommentsData,
          // System
          systemConfig: systemConfigData,
          systemSettings: systemSettingsData,
        },
        counts: {
          recordDays: allRecordDays.length,
          contestants: allContestants.length,
          groups: allGroups.length,
          seatAssignments: allSeatAssignments.length,
          blockTypes: flatBlockTypes.length,
          standbys: allStandbys.length,
          canceledAssignments: allCanceled.length,
          attendanceIssues: allAttendanceIssues.length,
          rebookingHistory: allRebookingHistory.length,
          standbyAttendanceHistory: allStandbyAttendanceHistory.length,
          movementHistory: allMovementHistory.length,
          contestantAvailability: allContestantAvailability.length,
          castingCards: allCastingCards.length,
          castingCardVersions: castingCardVersionsData.length,
          rxPlanningEntries: allRxPlanningEntries.length,
          blockNotes: flatBlockNotes.length,
          postRecordTracking: allPostRecordTracking.length,
          prizeWinners: prizeWinnersData.length,
          birthdayEntries: allBirthdayEntries.length,
          noticeboardPosts: allNoticeboardPosts.length,
          noticeboardComments: noticeboardCommentsData.length,
          systemConfig: systemConfigData.length,
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
        allAttendanceIssues,
        allRebookingHistory,
        allCastingCards,
        allRxPlanning,
      ] = await Promise.all([
        storage.getRecordDays(),
        storage.getContestants(),
        storage.getGroups(),
        storage.getAllSeatAssignments(),
        storage.getStandbyAssignments(),
        storage.getCanceledAssignments(),
        storage.getAttendanceIssues(),
        storage.getAllRebookingHistory(),
        storage.getCastingCards(),
        storage.getAllRxPlanningData(),
      ]);
      
      res.json({
        recordDays: allRecordDays.length,
        contestants: allContestants.length,
        groups: allGroups.length,
        seatAssignments: allSeatAssignments.length,
        standbys: allStandbys.length,
        canceledAssignments: allCanceled.length,
        attendanceIssues: allAttendanceIssues.length,
        rebookingHistory: allRebookingHistory.length,
        castingCards: allCastingCards.length,
        rxPlanningEntries: allRxPlanning.length,
        lastBackup: null,
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
      const workspace = ((req as any).session?.activeWorkspace || 'dond') as 'dond' | 'celeb';
      const status = getBackupStatus();
      const fileInfo = getBackupFileInfo(workspace);
      res.json({ ...status, fileInfo });
    } catch (error: any) {
      console.error("Error getting backup status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger manual backup for the active workspace
  app.post("/api/backup/manual", async (req, res) => {
    try {
      const { performBackupForWorkspace } = await import('./backup-scheduler');
      const workspace = ((req as any).session?.activeWorkspace || 'dond') as 'dond' | 'celeb';
      const result = await performBackupForWorkspace(workspace);
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

  // Download the automatic backup file for the active workspace
  app.get("/api/backup/download", async (req, res) => {
    try {
      const { readBackupFile, getBackupFileInfo } = await import('./backup-scheduler');
      const workspace = ((req as any).session?.activeWorkspace || 'dond') as 'dond' | 'celeb';
      const fileInfo = getBackupFileInfo(workspace);
      
      if (!fileInfo.exists) {
        return res.status(404).json({ error: "No backup file exists. Run a manual backup first." });
      }
      
      const content = readBackupFile(workspace);
      if (!content) {
        return res.status(500).json({ error: "Failed to read backup file" });
      }
      
      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="contestant-backup-${workspace}-${timestamp}.json"`);
      res.send(content);
    } catch (error: any) {
      console.error("Error downloading backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Download the Excel backup file for the active workspace
  app.get("/api/backup/download-excel", async (req, res) => {
    try {
      const { getExcelBackupPath, excelBackupExists } = await import('./backup-scheduler');
      const workspace = ((req as any).session?.activeWorkspace || 'dond') as 'dond' | 'celeb';
      
      if (!excelBackupExists(workspace)) {
        return res.status(404).json({ error: "No Excel backup file exists. Run a manual backup first." });
      }
      
      const filePath = getExcelBackupPath(workspace);
      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="contestant-backup-${workspace}-${timestamp}.xlsx"`);
      res.sendFile(path.resolve(filePath!));
    } catch (error: any) {
      console.error("Error downloading Excel backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // =============================================
  // System Guide Download
  // =============================================
  app.get("/api/guide/download", async (req, res) => {
    try {
      const { generateGuide } = await import('./guide');
      generateGuide(res);
    } catch (error: any) {
      console.error("Error generating guide:", error);
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
  // History - Combined audit trail
  // =============================================

  app.get("/api/history", requireAuth, async (req, res) => {
    try {
      const [rebookings, attendanceIssues, standbyAttendance, movements] = await Promise.all([
        storage.getAllRebookingHistory(),
        storage.getAttendanceIssues(),
        storage.getStandbyAttendanceHistory(),
        storage.getMovementHistory(),
      ]);
      res.json({
        rebookings,
        attendanceIssues,
        standbyAttendance,
        movements,
      });
    } catch (error: any) {
      console.error("Error fetching history:", error);
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
      
      if (!['no_show', 'early_leaver', 'no_longer_want_to_attend'].includes(issueType)) {
        return res.status(400).json({ error: "issueType must be 'no_show', 'early_leaver', or 'no_longer_want_to_attend'" });
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
      wsManager.broadcastBookingUpdate({
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

  // Move attendance issue to reschedule list
  app.post("/api/attendance-issues/:id/move-to-reschedule", async (req, res) => {
    try {
      const { id } = req.params;
      const { movedBy, reason } = req.body;
      
      const result = await storage.moveAttendanceIssueToReschedule(id, { movedBy, reason });
      res.json(result);
    } catch (error: any) {
      console.error("Error moving attendance issue to reschedule:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore attendance issue back to seat
  app.post("/api/attendance-issues/:id/restore", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await storage.restoreAttendanceIssue(id);
      res.json(result);
    } catch (error: any) {
      console.error("Error restoring attendance issue:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk mark no-shows from Booking Master (atomic transaction)
  app.post("/api/attendance-issues/bulk-no-show", async (req, res) => {
    try {
      const { assignmentIds, recordDayId, markedBy } = req.body;
      
      if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
        return res.status(400).json({ error: "assignmentIds array is required" });
      }
      
      if (!recordDayId) {
        return res.status(400).json({ error: "recordDayId is required" });
      }
      
      // Collect assignment details for all IDs
      const issuesData: Array<{ contestantId: string; recordDayId: string; blockNumber: number; seatLabel: string; notes?: string; markedBy?: string }> = [];
      const notFound: string[] = [];
      
      for (const assignmentId of assignmentIds) {
        const assignment = await storage.getSeatAssignmentById(assignmentId);
        if (!assignment) {
          notFound.push(assignmentId);
          continue;
        }
        
        issuesData.push({
          contestantId: assignment.contestantId,
          recordDayId,
          blockNumber: assignment.blockNumber,
          seatLabel: assignment.seatLabel,
          notes: 'Marked via Booking Master bulk action',
          markedBy: markedBy || 'System',
        });
      }
      
      if (issuesData.length === 0) {
        return res.status(400).json({ error: "No valid assignments found", notFound });
      }
      
      // Execute all no-shows in a single atomic transaction
      const result = await storage.createBulkNoShows(issuesData);
      
      // Broadcast the change for real-time updates
      wsManager.broadcastBookingUpdate({
        type: 'bulk-no-show',
        recordDayId,
        count: result.count,
      });
      
      res.json({ 
        success: true, 
        count: result.count,
        notFound: notFound.length,
        issues: result.issues 
      });
    } catch (error: any) {
      console.error("Error processing bulk no-shows:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============== PRIZE WINNERS ==============
  
  // Get prize winners for a record day
  app.get("/api/record-days/:recordDayId/prize-winners", async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const winners = await storage.getPrizeWinnersByRecordDay(recordDayId);
      res.json(winners);
    } catch (error: any) {
      console.error("Error fetching prize winners:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add a contestant to prize winners list
  app.post("/api/record-days/:recordDayId/prize-winners", async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const { contestantId, contestantName, blockNumber, seatLabel } = req.body;
      
      console.log("[Prize Draw] Adding prize winner:", { recordDayId, contestantId, contestantName, blockNumber, seatLabel });
      
      if (!contestantId || !contestantName || blockNumber == null || !seatLabel) {
        console.log("[Prize Draw] Validation failed - missing fields");
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      const winner = await storage.addPrizeWinner({
        recordDayId,
        contestantId,
        contestantName,
        blockNumber,
        seatLabel,
      });
      
      console.log("[Prize Draw] Prize winner saved:", winner?.id);
      
      // Broadcast update
      wsManager.broadcastBookingUpdate({
        type: 'prize-winner-added',
        recordDayId,
        contestantId,
      });
      
      res.json(winner);
    } catch (error: any) {
      console.error("[Prize Draw] Error adding prize winner:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Remove a contestant from prize winners list by ID
  app.delete("/api/prize-winners/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.removePrizeWinner(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing prize winner:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update prize winner toggle states (present/briefcase icons)
  app.patch("/api/prize-winners/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { hasPresent, hasBriefcase } = req.body;
      const updated = await storage.updatePrizeWinner(id, { hasPresent, hasBriefcase });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating prize winner:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Remove a contestant from prize winners list by contestant ID
  app.delete("/api/record-days/:recordDayId/prize-winners/:contestantId", async (req, res) => {
    try {
      const { recordDayId, contestantId } = req.params;
      await storage.removePrizeWinnerByContestant(recordDayId, contestantId);
      
      // Broadcast update
      wsManager.broadcastBookingUpdate({
        type: 'prize-winner-removed',
        recordDayId,
        contestantId,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing prize winner:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== NOTICEBOARD ENDPOINTS =====
  
  // Get recent noticeboard posts (for dashboard preview)
  app.get("/api/noticeboard/posts/recent", requireAuth, async (req, res) => {
    try {
      const posts = await storage.getNoticeboardPosts();
      // Return only basic info for up to 5 most recent posts (pinned first)
      const recentPosts = posts.slice(0, 5).map(p => ({
        id: p.id,
        authorName: p.authorName,
        content: p.content,
        createdAt: p.createdAt,
        isPinned: p.isPinned,
      }));
      res.json(recentPosts);
    } catch (error: any) {
      console.error("Error getting recent noticeboard posts:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get all noticeboard posts
  app.get("/api/noticeboard/posts", requireAuth, async (req, res) => {
    try {
      const posts = await storage.getNoticeboardPosts();
      const browserId = req.query.browserId as string | undefined;
      
      // Add likedByCurrentUser flag for each post based on browser ID
      const postsWithLikeStatus = await Promise.all(posts.map(async (post) => {
        const liked = browserId ? await storage.hasBrowserLikedPost(post.id, browserId) : false;
        return { ...post, likedByCurrentUser: liked };
      }));
      
      res.json(postsWithLikeStatus);
    } catch (error: any) {
      console.error("Error getting noticeboard posts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new post
  app.post("/api/noticeboard/posts", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const user = await storage.getUserById(userId);
      
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      const { content, imageUrl, videoUrl, authorName } = req.body;
      
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: "Post content is required" });
      }
      
      // Use provided authorName or fall back to username
      const displayName = authorName?.trim() || user.username;
      
      const post = await storage.createNoticeboardPost({
        authorId: userId,
        authorName: displayName,
        content: content.trim(),
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
      });
      
      res.json({ ...post, likeCount: 0, commentCount: 0, likedByCurrentUser: false });
    } catch (error: any) {
      console.error("Error creating noticeboard post:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update a post
  app.patch("/api/noticeboard/posts/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { content } = req.body;
      const userId = (req.session as any)?.userId;
      
      const post = await storage.getNoticeboardPostById(id);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }
      
      // Only author can edit
      if (post.authorId !== userId) {
        return res.status(403).json({ error: "Not authorized to edit this post" });
      }
      
      const updated = await storage.updateNoticeboardPost(id, { content });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating noticeboard post:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a post
  app.delete("/api/noticeboard/posts/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req.session as any)?.userId;
      
      const post = await storage.getNoticeboardPostById(id);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }
      
      // Only author can delete (or could add admin check here)
      if (post.authorId !== userId) {
        return res.status(403).json({ error: "Not authorized to delete this post" });
      }
      
      await storage.deleteNoticeboardPost(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting noticeboard post:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Toggle pin on a post (admin only in future, for now any user)
  app.post("/api/noticeboard/posts/:id/pin", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await storage.togglePinPost(id);
      
      if (!updated) {
        return res.status(404).json({ error: "Post not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error toggling pin:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Like/unlike a post
  app.post("/api/noticeboard/posts/:id/like", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { browserId } = req.body;
      
      if (!browserId) {
        return res.status(400).json({ error: "Browser ID is required" });
      }
      
      const result = await storage.toggleLike(id, browserId);
      res.json(result);
    } catch (error: any) {
      console.error("Error toggling like:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get comments for a post
  app.get("/api/noticeboard/posts/:id/comments", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const comments = await storage.getCommentsByPost(id);
      res.json(comments);
    } catch (error: any) {
      console.error("Error getting comments:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Add a comment to a post
  app.post("/api/noticeboard/posts/:id/comments", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { content, authorName } = req.body;
      const userId = (req.session as any)?.userId;
      const user = await storage.getUserById(userId);
      
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: "Comment content is required" });
      }
      
      // Use provided authorName or fall back to username
      const displayName = authorName?.trim() || user.username;
      
      const comment = await storage.createNoticeboardComment({
        postId: id,
        authorId: userId,
        authorName: displayName,
        content: content.trim(),
      });
      
      res.json(comment);
    } catch (error: any) {
      console.error("Error creating comment:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a comment
  app.delete("/api/noticeboard/comments/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteNoticeboardComment(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Upload image for noticeboard post
  app.post("/api/noticeboard/upload-image", requireAuth, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }
      
      const filename = `noticeboard_${Date.now()}_${req.file.originalname}`;
      const uploadDir = path.join(process.cwd(), 'uploads', 'noticeboard');
      
      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      
      const imageUrl = `/uploads/noticeboard/${filename}`;
      res.json({ imageUrl });
    } catch (error: any) {
      console.error("Error uploading noticeboard image:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Upload video for noticeboard post
  app.post("/api/noticeboard/upload-video", requireAuth, upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No video file provided" });
      }
      
      // Check file size (100MB limit for videos)
      if (req.file.size > 100 * 1024 * 1024) {
        return res.status(400).json({ error: "Video must be less than 100MB" });
      }
      
      const filename = `noticeboard_video_${Date.now()}_${req.file.originalname}`;
      const uploadDir = path.join(process.cwd(), 'uploads', 'noticeboard');
      
      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      
      const videoUrl = `/uploads/noticeboard/${filename}`;
      res.json({ videoUrl });
    } catch (error: any) {
      console.error("Error uploading noticeboard video:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Post-Record Tracking API endpoints
  // ============================================

  // Whitelist of updatable fields for post-record entries
  const postRecordUpdatableFields = [
    'rxEpNo', 'txEpNumber', 'txEpDate', 'notifiedOfTx', 'photoSent',
    'isPlayer', 'caseNumber', 'caseAmount', 'prizeWon', 'bankOfferTaken', 'amountWon', 'notes',
    'appearanceReleaseSigned', 'nedSigned', 'disclosureDocumentReceived',
    'returnedEntryBySupplier', 'entrySentByContestant', 'statementBySupplier', 'paramountEntryContestant',
    'afpConfirmation', 'afpFyiCheck', 'afpCheckReturned', 'afpNo', 'afpBatchNo',
    'idiwriterCheck', 'socialMediaBrief', 'bankruptcyCheck',
    // Override fields for Post Record editing
    'nameOverride', 'phoneOverride', 'emailOverride', 'contestantTypeOverride', 'rxNumberOverride', 'spinTheWheelOverride'
  ];

  // Get all post-record tracking entries with details
  app.get("/api/post-record", requireAuth, async (req, res) => {
    try {
      const { recordDayId } = req.query;
      const entries = await storage.getPostRecordEntriesWithDetails(recordDayId as string | undefined);
      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching post-record data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create new post-record entry
  app.post("/api/post-record", requireAuth, async (req, res) => {
    try {
      const { contestantId, recordDayId } = req.body;
      
      // Validate required fields
      if (!contestantId || typeof contestantId !== 'string') {
        return res.status(400).json({ error: "Contestant ID is required and must be a string" });
      }
      
      // Check if contestant exists
      const contestant = await storage.getContestantById(contestantId);
      if (!contestant) {
        return res.status(400).json({ error: "Contestant not found" });
      }
      
      // Check if record day exists (if provided)
      let recordDay = null;
      if (recordDayId) {
        recordDay = await storage.getRecordDayById(recordDayId);
        if (!recordDay) {
          return res.status(400).json({ error: "Record day not found" });
        }
      }
      
      // Check if entry already exists
      const existingEntry = await storage.getPostRecordEntryByContestant(contestantId, recordDayId);
      if (existingEntry) {
        return res.status(400).json({ error: "Entry already exists for this contestant" });
      }
      
      const newEntry = await storage.createPostRecordEntry({
        contestantId,
        recordDayId: recordDayId || null,
      });
      
      res.json({ ...newEntry, contestant, recordDay });
    } catch (error: any) {
      console.error("Error creating post-record entry:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update post-record entry
  app.patch("/api/post-record/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if entry exists
      const existing = await storage.getPostRecordEntryById(id);
      if (!existing) {
        return res.status(404).json({ error: "Entry not found" });
      }
      
      // Filter to only allowed fields
      const updateData: Record<string, any> = {};
      for (const field of postRecordUpdatableFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      
      const updated = await storage.updatePostRecordEntry(id, updateData);
      if (!updated) {
        return res.status(404).json({ error: "Entry not found" });
      }
      
      // Fetch related data
      const contestant = await storage.getContestantById(updated.contestantId);
      const recordDay = updated.recordDayId ? await storage.getRecordDayById(updated.recordDayId) : null;
      
      res.json({ ...updated, contestant, recordDay });
    } catch (error: any) {
      console.error("Error updating post-record entry:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Import all winners into post-record tracking
  app.post("/api/post-record/import-winners", requireAuth, async (req, res) => {
    try {
      // Get all seat assignments with winning money
      const allAssignments = await storage.getAllSeatAssignments();
      
      // Filter for winners: must have valid role AND positive amount
      const winners = allAssignments.filter((a) => {
        const hasValidRole = a.winningMoneyRole && typeof a.winningMoneyRole === 'string' && a.winningMoneyRole.trim() !== '';
        const hasValidAmount = typeof a.winningMoneyAmount === 'number' && a.winningMoneyAmount >= 0;
        return hasValidRole && hasValidAmount;
      });

      if (winners.length === 0) {
        return res.json({ 
          message: "No winners found to import",
          imported: 0,
          skipped: 0,
          total: 0
        });
      }

      // Get existing post-record entries to avoid duplicates
      const existingEntries = await storage.getPostRecordEntriesWithDetails();
      const existingMap = new Map<string, boolean>();
      existingEntries.forEach((e: any) => {
        // Use contestantId + recordDayId as unique key
        const key = `${e.contestantId}_${e.recordDayId || 'null'}`;
        existingMap.set(key, true);
      });

      let imported = 0;
      let skipped = 0;

      for (const winner of winners) {
        const key = `${winner.contestantId}_${winner.recordDayId || 'null'}`;
        
        // Skip if entry already exists
        if (existingMap.has(key)) {
          skipped++;
          continue;
        }
        
        // Create post-record entry with pre-populated fields from winner data
        await storage.createPostRecordEntry({
          contestantId: winner.contestantId,
          recordDayId: winner.recordDayId,
          seatAssignmentId: winner.id,
          // RECORD section
          rxEpNo: winner.rxEpNumber || null,
          // Contestant info from seat assignment
          isPlayer: winner.winningMoneyRole === 'player',
          caseNumber: winner.caseNumber || null,
          caseAmount: winner.caseAmount || null,
          prizeWon: winner.winningMoneyText || (winner.winningMoneyAmount ? `$${winner.winningMoneyAmount.toLocaleString()}` : null),
          bankOfferTaken: winner.bankOfferTaken || false,
          amountWon: winner.winningMoneyAmount || null,
          // TX section - from seat assignment if available
          txEpNumber: winner.txNumber || null,
          txEpDate: winner.txDate || null,
          notifiedOfTx: winner.notifiedOfTx || false,
          photoSent: winner.photosSent || false,
        });
        
        imported++;
        existingMap.set(key, true); // Mark as added to avoid duplicates in same batch
      }

      res.json({
        message: `Imported ${imported} winners into Post Record`,
        imported,
        skipped,
        total: winners.length
      });
    } catch (error: any) {
      console.error("Error importing winners to post-record:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete post-record entry
  app.delete("/api/post-record/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if entry exists
      const existing = await storage.getPostRecordEntryById(id);
      if (!existing) {
        return res.status(404).json({ error: "Entry not found" });
      }
      
      await storage.deletePostRecordEntry(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting post-record entry:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============ CASTING CARDS API ============

  // Get all casting cards
  app.get("/api/casting-cards", requireAuth, async (req, res) => {
    try {
      const cards = await storage.getCastingCards();
      res.json(cards);
    } catch (error: any) {
      console.error("Error fetching casting cards:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get casting card for a specific contestant
  app.get("/api/casting-cards/:contestantId", requireAuth, async (req, res) => {
    try {
      const { contestantId } = req.params;
      const card = await storage.getCastingCardByContestantId(contestantId);
      if (!card) {
        return res.status(404).json({ error: "Casting card not found" });
      }
      res.json(card);
    } catch (error: any) {
      console.error("Error fetching casting card:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create or update casting card (upsert)
  app.post("/api/casting-cards", requireAuth, async (req, res) => {
    try {
      // Remove fields that shouldn't be set directly (id, timestamps)
      const { id, createdAt, updatedAt, ...data } = req.body;
      if (!data.contestantId) {
        return res.status(400).json({ error: "contestantId is required" });
      }
      const card = await storage.upsertCastingCard(data);
      res.json(card);
    } catch (error: any) {
      console.error("Error saving casting card:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update casting card with conflict detection
  app.patch("/api/casting-cards/:contestantId", requireAuth, async (req, res) => {
    try {
      const { contestantId } = req.params;
      // Extract lastKnownUpdatedAt for conflict detection, and remove fields that shouldn't be updated
      const { id, createdAt, updatedAt, contestantId: _, lastKnownUpdatedAt, forceOverwrite, ...data } = req.body;
      
      // Get existing card for conflict detection and version saving
      const existingCard = await storage.getCastingCardByContestantId(contestantId);
      
      // Check for conflicts if lastKnownUpdatedAt is provided
      if (lastKnownUpdatedAt && !forceOverwrite) {
        if (existingCard && existingCard.updatedAt) {
          const serverTime = new Date(existingCard.updatedAt).getTime();
          const clientTime = new Date(lastKnownUpdatedAt).getTime();
          // Allow 5 second buffer to account for auto-save timing and network latency
          if (serverTime > clientTime + 5000) {
            return res.status(409).json({ 
              error: "Conflict detected",
              message: "This card was modified by another user since you opened it",
              serverUpdatedAt: existingCard.updatedAt,
              currentData: existingCard
            });
          }
        }
      }
      
      // Time-throttled version saving: only save if 10+ minutes since last version
      if (existingCard) {
        const TEN_MINUTES_MS = 10 * 60 * 1000;
        const latestVersion = await storage.getLatestCastingCardVersion(existingCard.id);
        const now = Date.now();
        const lastVersionTime = latestVersion ? new Date(latestVersion.createdAt).getTime() : 0;
        
        if (now - lastVersionTime >= TEN_MINUTES_MS) {
          // Save current state as a version before updating
          await storage.createCastingCardVersion({
            castingCardId: existingCard.id,
            cardData: JSON.stringify(existingCard),
            createdBy: (req.user as any)?.username || 'system',
          });
        }
      }
      
      const card = await storage.updateCastingCard(contestantId, data);
      if (!card) {
        return res.status(404).json({ error: "Casting card not found" });
      }
      res.json(card);
    } catch (error: any) {
      console.error("Error updating casting card:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Print casting card - returns HTML page optimized for A4 landscape printing
  // Matches the visual design of the card editor exactly
  app.get("/api/casting-cards/:contestantId/print", requireAuth, async (req, res) => {
    try {
      const { contestantId } = req.params;
      const card = await storage.getCastingCardByContestantId(contestantId);
      if (!card) {
        return res.status(404).send("<html><body><h1>Casting card not found</h1></body></html>");
      }
      
      const contestant = await storage.getContestantById(contestantId);
      if (!contestant) {
        return res.status(404).send("<html><body><h1>Contestant not found</h1></body></html>");
      }

      // Parse manual companions
      let manualCompanions: { id?: string; name: string; relationship: string; photo?: string; photoUrl?: string }[] = [];
      try {
        if (card.manualCompanions) {
          manualCompanions = JSON.parse(card.manualCompanions);
        }
      } catch (e) {
        console.error("Error parsing manualCompanions:", e);
      }

      // Get contestant photo URL - use full /uploads/photos/ path
      const photoUrl = contestant.photoUrl || (contestant.photoPath ? `/uploads/photos/${contestant.photoPath.split('/').pop()}` : '');

      // Build companions HTML
      const companionCount = manualCompanions.length;
      let companionsHtml = '';
      if (companionCount > 0) {
        companionsHtml = manualCompanions.map(comp => {
          const compPhoto = comp.photoUrl || comp.photo || '';
          return `
          <div style="text-align: center; width: 80px;">
            <div style="position: relative; width: 70px; height: 70px; border-radius: 4px; overflow: hidden; background: #e5e5e5; margin: 0 auto; border: 1px solid #ccc;">
              ${compPhoto ? `<img src="${compPhoto}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top;" />` : '<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;"><span style="color: #999; font-size: 24px;">?</span></div>'}
            </div>
            <div style="font-size: 10px; font-weight: bold; margin-top: 4px;">${comp.name || ''}</div>
            <div style="font-size: 9px; color: #666;">(${comp.relationship || ''})</div>
          </div>
        `;}).join('');
      }

      // Parse bullet points from JSON or use defaults
      let bulletPoints: string[] = [];
      try {
        if (card.bulletPoints) {
          bulletPoints = JSON.parse(card.bulletPoints);
        }
      } catch (e) {
        console.error("Error parsing bulletPoints:", e);
      }
      
      // Default bullet points if none saved
      if (bulletPoints.length === 0) {
        bulletPoints = [
          'Energy Level – 3 out of 5 – this helps us when booking players for later in the day',
          'Top line character points – we don\'t need to know if they are "bubbly/energetic/likable" as it doesn\'t really help. But if they have traits like – they just don\'t stop talking / they argue with their podium partner as they\'re bossy etc / infectious or funny laugh. That is stuff we can work with in an episode.',
          'Meet story (if applicable)',
          '3 key stories/facts/interesting points',
          'How much they want to win - $XX,XXX',
          'What they\'d do with prize money (high and low) - 100K and if they win only $1000',
          'How they might play game / Risk taker?',
          'Other game shows / prize money won / previously on DOND'
        ];
      }

      // Build bullet points HTML (last one in red/italic to match editor)
      const bulletPointsHtml = bulletPoints.map((point, index) => {
        const isLast = index === bulletPoints.length - 1;
        const circleColor = isLast ? '#ef4444' : '#9ca3af';
        const textStyle = isLast ? 'color: #dc2626; font-style: italic;' : '';
        return `
          <li style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${circleColor}; flex-shrink: 0; margin-top: 5px;"></span>
            <span style="${textStyle}">${point}</span>
          </li>
        `;
      }).join('');

      // Get display values (use card overrides or fall back to contestant data)
      const displayName = card.fullName || contestant.name || '';
      const displayAgeState = card.ageState || `${contestant.age || ''} (${contestant.state || contestant.suburb || ''})`;

      // Build companions HTML for print
      const companionsHtmlForPrint = manualCompanions.map(comp => {
        const compPhoto = comp.photoUrl || comp.photo || '';
        return `
          <div style="text-align: center;">
            <div style="position: relative; width: 112px; height: 112px; border: 4px solid #f59e0b; border-radius: 8px; overflow: hidden; background: #e5e7eb; margin: 0 auto;">
              ${compPhoto ? `<img src="${compPhoto}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top;" />` : '<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;"><span style="color: #9ca3af; font-size: 24px;">?</span></div>'}
            </div>
            <div style="font-size: 14px; font-weight: 600; margin-top: 4px;">${comp.name || ''}</div>
            <div style="font-size: 12px; color: #6b7280;">(${comp.relationship || ''})</div>
          </div>
        `;
      }).join('');

      // Build bullet points HTML for print
      const bulletPointsHtmlForPrint = bulletPoints.map((point, index) => {
        const isLast = index === bulletPoints.length - 1;
        const circleColor = isLast ? '#ef4444' : '#9ca3af';
        const textStyle = isLast ? 'color: #dc2626; font-style: italic;' : '';
        return `
          <li style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
            <span style="width: 12px; height: 12px; border-radius: 50%; background: ${circleColor}; flex-shrink: 0; margin-top: 6px;"></span>
            <span style="${textStyle}">${point}</span>
          </li>
        `;
      }).join('');

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Casting Card - ${displayName}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 0;
    }
    @media print {
      html, body {
        width: 297mm;
        height: 210mm;
        margin: 0;
        padding: 0;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 297mm;
      height: 210mm;
      margin: 0;
      padding: 0;
    }
    body { 
      font-family: Arial, sans-serif; 
      background: white;
    }
    .page-container {
      width: 297mm;
      height: 210mm;
      padding: 24px;
      background: white;
      display: flex;
      gap: 24px;
    }
    .left-column {
      width: 208px;
      flex-shrink: 0;
    }
    .right-column {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
  </style>
</head>
<body>
  <div class="page-container">
    <!-- Left Column: Photo + Companions -->
    <div class="left-column">
      <!-- Main Photo -->
      <div style="position: relative; border: 4px solid #f59e0b; border-radius: 8px; overflow: hidden; background: #f3f4f6; height: 224px;">
        ${photoUrl
          ? `<img src="${photoUrl}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center top;" />`
          : `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;"><span style="color: #9ca3af; font-size: 64px;">?</span></div>`
        }
      </div>
      
      ${companionCount > 0 ? `
      <!-- Attending With Section -->
      <div style="margin-top: 24px; text-align: center;">
        <p style="font-size: 14px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">ATTENDING WITH ...</p>
        <div style="color: #3b82f6; font-size: 20px; margin-bottom: 8px;">&#8595;</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
          ${companionsHtmlForPrint}
        </div>
      </div>
      ` : ''}
    </div>
    
    <!-- Right Column: Details -->
    <div class="right-column">
      <!-- Header Banner -->
      <div style="background: linear-gradient(90deg, #b45309 0%, #d97706 50%, #f59e0b 100%); padding: 8px 16px; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <h2 style="font-size: 24px; font-weight: bold; font-style: italic; letter-spacing: 0.05em; background: linear-gradient(180deg, #fef08a 0%, #fbbf24 50%, #d97706 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.4));">${displayName.toUpperCase()}</h2>
        <img src="/attached_assets/dond-logo.png" alt="Deal or No Deal" style="height: 48px;" onerror="this.style.display='none'" />
      </div>
      
      <!-- Info Section -->
      <div style="margin-bottom: 16px;">
        <div style="font-size: 24px; font-weight: bold; color: #111827;">${displayAgeState}</div>
        <div style="font-size: 20px; font-weight: bold; color: #1f2937;">${card.occupation || 'OCCUPATION'}</div>
        <div style="font-size: 14px; font-weight: 600; color: #16a34a;">${card.sponsorCategory || 'SPONSOR CATEGORY: X'}</div>
      </div>
      
      <!-- Tagline -->
      <h3 style="font-size: 24px; font-weight: bold; color: #16a34a; margin-bottom: 16px;">${card.tagline || 'SHORT TAG'}</h3>
      
      <!-- Bullet Points -->
      <ul style="list-style: none; padding: 0; font-size: 14px; line-height: 1.5; flex: 1;">
        ${bulletPointsHtmlForPrint}
      </ul>
      
      <!-- Producer Section -->
      <div style="display: flex; border: 1px solid #d1d5db; margin-top: auto;">
        <span style="background: #e5e7eb; padding: 8px 16px; font-weight: 600; font-size: 14px; border-right: 1px solid #d1d5db;">PRODUCER:</span>
        <span style="background: #fbbf24; padding: 8px 16px; font-weight: bold; font-size: 14px; flex: 1;">${card.producerName || 'INSERT NAME'}</span>
      </div>
    </div>
  </div>
  ${req.query.preview !== 'true' ? `<script>
    window.onload = function() { window.print(); };
  </script>` : ''}
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error: any) {
      console.error("Error generating print view:", error);
      console.error("Error stack:", error.stack);
      res.status(500).send(`<html><body><h1>Error generating print view</h1><p>${error.message || 'Unknown error'}</p></body></html>`);
    }
  });

  // Delete casting card
  app.delete("/api/casting-cards/:contestantId", requireAuth, async (req, res) => {
    try {
      const { contestantId } = req.params;
      await storage.deleteCastingCard(contestantId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting casting card:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete ALL casting cards
  app.delete("/api/casting-cards", requireAuth, async (req, res) => {
    try {
      await storage.deleteAllCastingCards();
      res.json({ success: true, message: "All casting cards deleted" });
    } catch (error: any) {
      console.error("Error deleting all casting cards:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === Casting Card Version History API ===
  
  // Get version history for a casting card
  app.get("/api/casting-cards/:cardId/versions", requireAuth, async (req, res) => {
    try {
      const { cardId } = req.params;
      const versions = await storage.getCastingCardVersions(cardId);
      res.json(versions);
    } catch (error: any) {
      console.error("Error fetching casting card versions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore a casting card to a previous version
  app.post("/api/casting-cards/:cardId/versions/:versionId/restore", requireAuth, async (req, res) => {
    try {
      const { cardId, versionId } = req.params;
      
      // Get the version to restore
      const versions = await storage.getCastingCardVersions(cardId);
      const versionToRestore = versions.find(v => v.id === versionId);
      
      if (!versionToRestore) {
        return res.status(404).json({ error: "Version not found" });
      }
      
      // Parse the stored card data
      const cardData = JSON.parse(versionToRestore.cardData);
      
      // Get the current card to find contestantId
      // The cardId is the casting_cards.id, need to find the card first
      const allCards = await storage.getCastingCards();
      const currentCard = allCards.find(c => c.id === cardId);
      
      if (!currentCard) {
        return res.status(404).json({ error: "Casting card not found" });
      }
      
      // Save the current state as a new version before restoring (so restore can be undone)
      await storage.createCastingCardVersion({
        castingCardId: cardId,
        cardData: JSON.stringify(currentCard),
        createdBy: (req.user as any)?.username || 'system',
      });
      
      // Update the card with the restored data (excluding id, contestantId, createdAt, updatedAt)
      const { id: _id, contestantId: _cId, createdAt: _cAt, updatedAt: _uAt, ...restoreData } = cardData;
      
      const updated = await storage.updateCastingCard(currentCard.contestantId, restoreData);
      res.json(updated);
    } catch (error: any) {
      console.error("Error restoring casting card version:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === System Settings API ===
  
  // Get system setting by key
  app.get("/api/settings/:key", requireAuth, async (req, res) => {
    try {
      const { key } = req.params;
      const setting = await storage.getSystemSetting(key);
      res.json(setting || { key, value: "" });
    } catch (error: any) {
      console.error(`Error fetching setting ${req.params.key}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update system setting
  app.post("/api/settings/:key", requireAuth, async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      const updated = await storage.setSystemSetting(key, value);
      res.json(updated);
    } catch (error: any) {
      console.error(`Error updating setting ${req.params.key}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  // === Birthday Entries API ===
  
  // Get all birthday entries
  app.get("/api/birthdays", requireAuth, async (req, res) => {
    try {
      const entries = await storage.getBirthdayEntries();
      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching birthday entries:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get today's birthdays (for banner display)
  app.get("/api/birthdays/today", async (req, res) => {
    try {
      const entries = await storage.getTodayBirthdays();
      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching today's birthdays:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create a birthday entry
  app.post("/api/birthdays", requireAuth, async (req, res) => {
    try {
      const { name, birthdate } = req.body;
      if (!name || !birthdate) {
        return res.status(400).json({ error: "Name and birthdate are required" });
      }
      const entry = await storage.createBirthdayEntry({ name, birthdate });
      res.json(entry);
    } catch (error: any) {
      console.error("Error creating birthday entry:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update a birthday entry
  app.patch("/api/birthdays/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, birthdate } = req.body;
      const entry = await storage.updateBirthdayEntry(id, { name, birthdate });
      if (!entry) {
        return res.status(404).json({ error: "Birthday entry not found" });
      }
      res.json(entry);
    } catch (error: any) {
      console.error("Error updating birthday entry:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a birthday entry
  app.delete("/api/birthdays/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteBirthdayEntry(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting birthday entry:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // === Block Notes API ===
  
  // Get block notes for a record day
  app.get("/api/block-notes/:recordDayId", requireAuth, async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const notes = await storage.getBlockNotes(recordDayId);
      res.json(notes);
    } catch (error: any) {
      console.error("Error getting block notes:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update block note
  app.put("/api/block-notes/:recordDayId/:blockNumber", requireAuth, async (req, res) => {
    try {
      const { recordDayId, blockNumber } = req.params;
      const { notes } = req.body;
      
      const blockNum = parseInt(blockNumber);
      if (isNaN(blockNum) || blockNum < 1 || blockNum > 7) {
        return res.status(400).json({ error: "Invalid block number (must be 1-7)" });
      }
      
      const result = await storage.upsertBlockNote(recordDayId, blockNum, notes || "");
      res.json(result);
    } catch (error: any) {
      console.error("Error updating block note:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============ RX Planning Data (shared across all users) ============

  app.get("/api/rx-planning", requireAuth, async (req, res) => {
    try {
      const entries = await storage.getAllRxPlanningData();
      const data: Record<string, { blocks: Record<string, any[]> }> = {};
      for (const entry of entries) {
        if (!data[entry.recordDayId]) {
          data[entry.recordDayId] = { blocks: {} };
        }
        try {
          data[entry.recordDayId].blocks[String(entry.blockNumber)] = JSON.parse(entry.contestantData);
        } catch {
          data[entry.recordDayId].blocks[String(entry.blockNumber)] = [];
        }
      }
      res.json(data);
    } catch (error: any) {
      console.error("Error getting RX planning data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/rx-planning/:recordDayId", requireAuth, async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const entries = await storage.getRxPlanningData(recordDayId);
      const blocks: Record<string, any[]> = {};
      for (const entry of entries) {
        try {
          blocks[String(entry.blockNumber)] = JSON.parse(entry.contestantData);
        } catch {
          blocks[String(entry.blockNumber)] = [];
        }
      }
      res.json({ blocks });
    } catch (error: any) {
      console.error("Error getting RX planning data for day:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/rx-planning/:recordDayId/:blockNumber", requireAuth, async (req, res) => {
    try {
      const { recordDayId, blockNumber } = req.params;
      const { contestants } = req.body;
      const blockNum = parseInt(blockNumber);
      if (isNaN(blockNum) || blockNum < 1 || blockNum > 7) {
        return res.status(400).json({ error: "Invalid block number (must be 1-7)" });
      }
      const contestantData = JSON.stringify(contestants || []);
      if (!contestants || contestants.length === 0) {
        await storage.deleteRxPlanningBlock(recordDayId, blockNum);
        res.json({ success: true });
      } else {
        const result = await storage.saveRxPlanningBlock(recordDayId, blockNum, contestantData);
        res.json(result);
      }
    } catch (error: any) {
      console.error("Error saving RX planning block:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/rx-planning/:recordDayId", requireAuth, async (req, res) => {
    try {
      const { recordDayId } = req.params;
      await storage.clearRxPlanningDay(recordDayId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error clearing RX planning day:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Podium Positions (CELEB only) ──────────────────────────────────────────

  app.get("/api/record-days/:recordDayId/podium-positions", requireAuth, async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const positions = await storage.getPodiumPositions(recordDayId);
      res.json(positions);
    } catch (error: any) {
      console.error("Get podium positions error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/record-days/:recordDayId/podium-positions/:position", requireAuth, async (req, res) => {
    try {
      const { recordDayId, position } = req.params;
      const { contestantId } = req.body;
      if (!contestantId) return res.status(400).json({ error: "contestantId is required" });
      // Before upserting, find any contestant currently at this position so we can revert their status
      const existingPositions = await storage.getPodiumPositions(recordDayId);
      const displaced = existingPositions.find(p => p.position === parseInt(position));
      const result = await storage.upsertPodiumPosition(recordDayId, parseInt(position), contestantId);
      await storage.upsertPodiumSeatAssignment(recordDayId, parseInt(position), contestantId);
      // Mark the newly placed contestant as assigned
      await storage.updateContestantAvailability(contestantId, 'assigned');
      // If someone else was bumped from this position, revert their status to available
      if (displaced && displaced.contestantId !== contestantId) {
        await storage.updateContestantAvailability(displaced.contestantId, 'available');
      }
      res.json(result);
    } catch (error: any) {
      console.error("Upsert podium position error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/record-days/:recordDayId/podium-positions/swap", requireAuth, async (req, res) => {
    try {
      const { recordDayId } = req.params;
      const { sourcePosition, targetPosition } = req.body;
      const isValidPos = (v: any) => Number.isInteger(v) && v >= 1 && v <= 26;
      if (!isValidPos(sourcePosition) || !isValidPos(targetPosition)) {
        return res.status(400).json({ error: "sourcePosition and targetPosition must be integers in 1..26" });
      }
      if (sourcePosition === targetPosition) {
        return res.status(400).json({ error: "sourcePosition and targetPosition must differ" });
      }
      await storage.swapPodiumPositions(recordDayId, sourcePosition, targetPosition);
      res.json({ success: true });
    } catch (error: any) {
      if (error?.message?.startsWith?.('PODIUM_SOURCE_EMPTY')) {
        return res.status(404).json({ error: error.message });
      }
      console.error("Swap podium positions error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/record-days/:recordDayId/podium-positions/:position", requireAuth, async (req, res) => {
    try {
      const { recordDayId, position } = req.params;
      // Capture which contestant is there before deleting so we can revert their status
      const existingPositions = await storage.getPodiumPositions(recordDayId);
      const toRemove = existingPositions.find(p => p.position === parseInt(position));
      await storage.deletePodiumPosition(recordDayId, parseInt(position));
      await storage.deletePodiumSeatAssignment(recordDayId, parseInt(position));
      if (toRemove) {
        await storage.updateContestantAvailability(toRemove.contestantId, 'available');
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete podium position error:", error);
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
