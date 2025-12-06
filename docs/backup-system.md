# Backup System Documentation

## Overview

The contestant management system includes an automatic backup feature that saves all data to a JSON file every hour. This provides protection against data loss and allows you to restore the system if needed.

## What Gets Backed Up

The backup includes ALL data:
- Record days
- Contestants
- Groups
- Seat assignments
- Standby assignments
- Block types
- Canceled assignments

## File Locations

### Key Source Files

| File | Purpose |
|------|---------|
| `server/backup-scheduler.ts` | Main backup scheduler logic |
| `server/index.ts` | Starts the scheduler on server boot |
| `server/routes.ts` | API endpoints for backup operations |
| `client/src/pages/settings.tsx` | UI for manual backup and download |

### Backup Storage

- **Location:** `storage/backups/automatic-backup.json`
- **Format:** JSON file with timestamped data
- **Behavior:** Overwrites the same file each hour (not versioned)

## How It Works

### Automatic Backups

1. When the server starts, it initializes the database
2. After database warmup completes, the backup scheduler starts
3. First backup runs 1 minute after server startup
4. Subsequent backups run every hour
5. Each backup overwrites the previous file

### Error Handling

- Failed backups increment a consecutive failure counter
- After 5 consecutive failures, the scheduler automatically stops
- This prevents log saturation from repeated failures
- Manual backups can still be triggered from the Settings page

## API Endpoints

### Get Backup Status
```
GET /api/backup/status
```
Returns:
```json
{
  "schedulerRunning": true,
  "schedulerInitialized": true,
  "lastBackupTime": "2025-12-06T11:58:56.296Z",
  "lastBackupStatus": "success",
  "lastBackupError": null,
  "consecutiveFailures": 0,
  "backupInterval": "1 hour",
  "backupPath": "storage/backups/automatic-backup.json",
  "fileInfo": {
    "exists": true,
    "size": 15271,
    "modifiedAt": "2025-12-06T11:58:56.295Z"
  }
}
```

### Get Data Summary
```
GET /api/backup/summary
```
Returns counts of all data types.

### Trigger Manual Backup
```
POST /api/backup/manual
```
Immediately creates a backup (overwrites existing file).

### Download Backup File
```
GET /api/backup/download
```
Downloads the backup JSON file.

### Export All Data (Legacy)
```
GET /api/backup/export
```
Directly exports all data as JSON (doesn't save to file).

## Using the Settings Page

1. Navigate to **Settings** in the sidebar
2. Scroll to the **Data Backup** section
3. You'll see:
   - Auto-backup status (Running/Stopped)
   - Last backup timestamp
   - Summary of data counts
   - Error messages if backups are failing

### Buttons

- **Run Backup Now** - Triggers an immediate backup
- **Download Backup** - Downloads the backup file to your local computer

## Running Locally / On Your Own Server

### Storage Location

When running locally or on Digital Ocean, backups are saved to:
```
./storage/backups/automatic-backup.json
```

Make sure this directory is writable by the application.

### Accessing Backups

**Option 1: Use the UI**
- Go to Settings > Data Backup > Download Backup

**Option 2: Direct file access**
- On your server, navigate to `storage/backups/`
- Copy `automatic-backup.json` to your desired location

**Option 3: API endpoint**
```bash
curl http://your-server:8080/api/backup/download -o backup.json
```

### Recommended Backup Strategy

1. **Automatic hourly backups** run on the server (safety net)
2. **Manual downloads** at the end of each production day
3. **Store local copies** with dated filenames on your computer

Example naming convention:
```
contestant-backup-2025-12-06.json
contestant-backup-2025-12-07.json
```

## Configuration Options

### Changing Backup Interval

Edit `server/backup-scheduler.ts`:
```typescript
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour (in milliseconds)
```

Options:
- 30 minutes: `30 * 60 * 1000`
- 2 hours: `2 * 60 * 60 * 1000`
- 4 hours: `4 * 60 * 60 * 1000`

### Changing Backup Location

Edit `server/backup-scheduler.ts`:
```typescript
const BACKUP_DIR = './storage/backups';
const BACKUP_FILE = 'automatic-backup.json';
```

### Keeping Multiple Versions

To keep versioned backups instead of overwriting, modify the `performBackup()` function to include a timestamp in the filename:

```typescript
const timestamp = new Date().toISOString().split('T')[0];
const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.json`);
```

## Restoring from Backup

The backup file is a complete JSON export of all data. To restore:

1. Stop the application
2. Use the backup JSON to repopulate the database
3. Restart the application

**Note:** A restore script is not currently included. Contact your developer to implement database restoration from backup if needed.

## Troubleshooting

### Backups Not Running

Check the server logs for:
```
[Backup] Starting automatic backup scheduler (every 1 hour)
Step 6: Backup scheduler started (runs every hour)
```

### Backups Failing

1. Check Settings page for error messages
2. Check server logs for `[Backup]` entries
3. Common issues:
   - Database connection problems
   - Disk space full
   - Write permissions on storage directory

### Scheduler Stopped

If you see "Stopped (too many failures)" in Settings:
1. Check the error message displayed
2. Fix the underlying issue
3. Restart the server to reset the scheduler

## Security Considerations

- Backup files contain sensitive contestant information
- Store local copies securely
- Do not share backup files publicly
- Consider encrypting backups for long-term storage
