import * as fs from 'fs';
import * as path from 'path';
import { storage } from './storage';

const BACKUP_DIR = './storage/backups';
const BACKUP_FILE = 'automatic-backup.json';
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

    lastBackupTime = new Date();
    lastBackupStatus = 'success';
    lastBackupError = null;
    consecutiveFailures = 0;

    console.log(`[Backup] Automatic backup completed at ${lastBackupTime.toISOString()}`);
    console.log(`[Backup] Data: ${recordDays.length} record days, ${contestants.length} contestants, ${seatAssignments.length} assignments`);

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
