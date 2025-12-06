import * as fs from 'fs';
import * as path from 'path';
import xlsx from 'xlsx';
import { storage } from './storage';

const BACKUP_DIR = './storage/backups';
const BACKUP_FILE = 'automatic-backup.json';
const EXCEL_BACKUP_FILE = 'automatic-backup.xlsx';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let backupIntervalId: NodeJS.Timeout | null = null;
let lastBackupTime: Date | null = null;
let lastBackupStatus: 'success' | 'error' | null = null;
let lastBackupError: string | null = null;
let consecutiveFailures = 0;
let schedulerInitialized = false;
const MAX_CONSECUTIVE_FAILURES = 5;

// Ensure backup directory exists
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Export all data to JSON
export async function performBackup(): Promise<{ success: boolean; message: string; path?: string }> {
  try {
    ensureBackupDir();
    
    // Fetch all data
    const [
      recordDays,
      contestants,
      groups,
      seatAssignments,
      standbys,
      canceledAssignments,
    ] = await Promise.all([
      storage.getRecordDays(),
      storage.getContestants(),
      storage.getGroups(),
      storage.getAllSeatAssignments(),
      storage.getStandbyAssignments(),
      storage.getCanceledAssignments(),
    ]);
    
    // Get block types for all record days
    const blockTypesPromises = recordDays.map(rd => storage.getBlockTypesByRecordDay(rd.id));
    const blockTypesArrays = await Promise.all(blockTypesPromises);
    const blockTypes = blockTypesArrays.flat();

    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      automatic: true,
      data: {
        recordDays,
        contestants,
        groups,
        seatAssignments,
        standbys,
        blockTypes,
        canceledAssignments,
      },
      counts: {
        recordDays: recordDays.length,
        contestants: contestants.length,
        groups: groups.length,
        seatAssignments: seatAssignments.length,
        standbys: standbys.length,
        blockTypes: blockTypes.length,
        canceledAssignments: canceledAssignments.length,
      },
    };

    const backupPath = path.join(BACKUP_DIR, BACKUP_FILE);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

    // Also create Excel backup
    const excelPath = path.join(BACKUP_DIR, EXCEL_BACKUP_FILE);
    await createExcelBackup(backupData.data, excelPath);

    lastBackupTime = new Date();
    lastBackupStatus = 'success';
    lastBackupError = null;
    consecutiveFailures = 0;

    console.log(`[Backup] Automatic backup completed at ${lastBackupTime.toISOString()}`);
    console.log(`[Backup] Data: ${recordDays.length} record days, ${contestants.length} contestants, ${seatAssignments.length} assignments`);
    console.log(`[Backup] Excel backup saved to ${excelPath}`);

    return { 
      success: true, 
      message: 'Backup completed successfully',
      path: backupPath 
    };
  } catch (error: any) {
    lastBackupStatus = 'error';
    lastBackupError = error.message;
    consecutiveFailures++;
    
    console.error(`[Backup] Automatic backup failed (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, error.message);
    
    // Stop scheduler after too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && backupIntervalId) {
      console.error('[Backup] Too many consecutive failures - stopping scheduler');
      stopBackupScheduler();
    }
    
    return { 
      success: false, 
      message: `Backup failed: ${error.message}` 
    };
  }
}

// Start the automatic backup scheduler
export function startBackupScheduler() {
  if (backupIntervalId) {
    console.log('[Backup] Scheduler already running');
    return;
  }

  console.log('[Backup] Starting automatic backup scheduler (every 1 hour)');
  schedulerInitialized = true;
  consecutiveFailures = 0;
  
  // Run first backup after 1 minute to let the app settle
  setTimeout(() => {
    performBackup();
  }, 60 * 1000);

  // Then run every hour
  backupIntervalId = setInterval(() => {
    performBackup();
  }, BACKUP_INTERVAL_MS);
}

// Stop the backup scheduler
export function stopBackupScheduler() {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log('[Backup] Scheduler stopped');
  }
}

// Get backup status
export function getBackupStatus() {
  return {
    schedulerRunning: !!backupIntervalId,
    schedulerInitialized,
    lastBackupTime: lastBackupTime?.toISOString() || null,
    lastBackupStatus,
    lastBackupError,
    consecutiveFailures,
    backupInterval: '1 hour',
    backupPath: path.join(BACKUP_DIR, BACKUP_FILE),
  };
}

// Check if backup file exists and get its info
export function getBackupFileInfo(): { exists: boolean; size?: number; modifiedAt?: string } {
  const backupPath = path.join(BACKUP_DIR, BACKUP_FILE);
  try {
    if (fs.existsSync(backupPath)) {
      const stats = fs.statSync(backupPath);
      return {
        exists: true,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    }
  } catch (error) {
    // File doesn't exist or can't be read
  }
  return { exists: false };
}

// Read the backup file content
export function readBackupFile(): string | null {
  const backupPath = path.join(BACKUP_DIR, BACKUP_FILE);
  try {
    if (fs.existsSync(backupPath)) {
      return fs.readFileSync(backupPath, 'utf-8');
    }
  } catch (error) {
    console.error('[Backup] Error reading backup file:', error);
  }
  return null;
}

// Create Excel backup with multiple sheets
async function createExcelBackup(data: any, filePath: string): Promise<void> {
  const workbook = xlsx.utils.book_new();
  
  // Record Days sheet
  if (data.recordDays && data.recordDays.length > 0) {
    const rdSheet = xlsx.utils.json_to_sheet(data.recordDays.map((rd: any) => ({
      ID: rd.id,
      Date: rd.date,
      RxNumber: rd.rxNumber,
      Status: rd.status,
      Notes: rd.notes,
    })));
    xlsx.utils.book_append_sheet(workbook, rdSheet, 'Record Days');
  }
  
  // Contestants sheet
  if (data.contestants && data.contestants.length > 0) {
    const cSheet = xlsx.utils.json_to_sheet(data.contestants.map((c: any) => ({
      ID: c.id,
      Name: c.name,
      Age: c.age,
      Gender: c.gender,
      Email: c.email,
      Phone: c.phone,
      Location: c.location,
      Rating: c.auditionRating,
      Status: c.availabilityStatus,
      AttendingWith: c.attendingWith,
      GroupID: c.groupId,
      MedicalInfo: c.medicalInfo,
      MobilityNotes: c.mobilityNotes,
    })));
    xlsx.utils.book_append_sheet(workbook, cSheet, 'Contestants');
  }
  
  // Seat Assignments sheet
  if (data.seatAssignments && data.seatAssignments.length > 0) {
    const saSheet = xlsx.utils.json_to_sheet(data.seatAssignments.map((sa: any) => ({
      ID: sa.id,
      RecordDayID: sa.recordDayId,
      ContestantID: sa.contestantId,
      Block: sa.blockNumber,
      Seat: sa.seatLabel,
      BookingEmailSent: sa.bookingEmailSent,
      ConfirmedRSVP: sa.confirmedRsvp,
      Notes: sa.notes,
    })));
    xlsx.utils.book_append_sheet(workbook, saSheet, 'Seat Assignments');
  }
  
  // Standbys sheet
  if (data.standbys && data.standbys.length > 0) {
    const stSheet = xlsx.utils.json_to_sheet(data.standbys.map((st: any) => ({
      ID: st.id,
      RecordDayID: st.recordDayId,
      ContestantID: st.contestantId,
      Status: st.status,
      Notes: st.notes,
    })));
    xlsx.utils.book_append_sheet(workbook, stSheet, 'Standbys');
  }
  
  // Groups sheet
  if (data.groups && data.groups.length > 0) {
    const gSheet = xlsx.utils.json_to_sheet(data.groups.map((g: any) => ({
      ID: g.id,
      ReferenceNumber: g.referenceNumber,
    })));
    xlsx.utils.book_append_sheet(workbook, gSheet, 'Groups');
  }
  
  // Block Types sheet
  if (data.blockTypes && data.blockTypes.length > 0) {
    const btSheet = xlsx.utils.json_to_sheet(data.blockTypes.map((bt: any) => ({
      ID: bt.id,
      RecordDayID: bt.recordDayId,
      BlockNumber: bt.blockNumber,
      BlockType: bt.blockType,
    })));
    xlsx.utils.book_append_sheet(workbook, btSheet, 'Block Types');
  }
  
  // Canceled Assignments sheet
  if (data.canceledAssignments && data.canceledAssignments.length > 0) {
    const caSheet = xlsx.utils.json_to_sheet(data.canceledAssignments.map((ca: any) => ({
      ID: ca.id,
      RecordDayID: ca.recordDayId,
      ContestantID: ca.contestantId,
      Reason: ca.reason,
      CanceledAt: ca.canceledAt,
    })));
    xlsx.utils.book_append_sheet(workbook, caSheet, 'Canceled Assignments');
  }
  
  // Write the file
  xlsx.writeFile(workbook, filePath);
}

// Get Excel backup file path
export function getExcelBackupPath(): string {
  return path.join(BACKUP_DIR, EXCEL_BACKUP_FILE);
}

// Check if Excel backup exists
export function excelBackupExists(): boolean {
  return fs.existsSync(getExcelBackupPath());
}
