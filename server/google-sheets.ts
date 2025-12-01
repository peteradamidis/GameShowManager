// Google Sheets integration - connects to Replit's Google Sheets connector
// Documentation: https://developers.google.com/sheets/api

import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Sheet not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

// Get existing sheets in a spreadsheet
async function getExistingSheets(spreadsheetId: string): Promise<{ sheetId: number; title: string }[]> {
  const sheets = await getUncachableGoogleSheetClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties'
  });
  
  return (response.data.sheets || []).map(sheet => ({
    sheetId: sheet.properties?.sheetId || 0,
    title: sheet.properties?.title || ''
  }));
}

// Create a new sheet (tab) in the spreadsheet
async function createSheet(spreadsheetId: string, sheetTitle: string): Promise<number> {
  const sheets = await getUncachableGoogleSheetClient();
  
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: sheetTitle
          }
        }
      }]
    }
  });
  
  return response.data.replies?.[0]?.addSheet?.properties?.sheetId || 0;
}

// Clear a sheet's content
async function clearSheet(spreadsheetId: string, sheetTitle: string): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();
  
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${sheetTitle}'!A:Z`
  });
}

// Write data to a specific sheet
async function writeToSheet(spreadsheetId: string, sheetTitle: string, data: string[][]): Promise<void> {
  const sheets = await getUncachableGoogleSheetClient();
  
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: data }
  });
}

// Sync booking data for a specific record day to its own sheet
export async function syncRecordDayToSheet(
  spreadsheetId: string, 
  recordDayDate: string, 
  bookingData: any[]
): Promise<{ success: boolean; sheetTitle: string }> {
  try {
    // Create sheet title from the record day date (e.g., "Dec 15, 2024")
    const sheetTitle = recordDayDate;
    
    // Check if sheet already exists
    const existingSheets = await getExistingSheets(spreadsheetId);
    const sheetExists = existingSheets.some(s => s.title === sheetTitle);
    
    if (!sheetExists) {
      await createSheet(spreadsheetId, sheetTitle);
    } else {
      // Clear existing data
      await clearSheet(spreadsheetId, sheetTitle);
    }
    
    // Create headers
    const headers = [
      'Seat',
      'Contestant Name',
      'Contestant ID',
      'Audition Rating',
      'Gender',
      'Age',
      'Location',
      'Workflow Status',
      'Availability RSVP',
      'Confirmed RSVP',
      'Declined',
      'Notes'
    ];
    
    // Convert booking data to rows
    const rows = bookingData.map(booking => [
      booking.seatLabel || '',
      booking.contestantName || '',
      booking.contestantId || '',
      booking.auditionRating || '',
      booking.gender || '',
      String(booking.age || ''),
      booking.location || '',
      booking.workflow || '',
      booking.availabilityRsvp || '',
      booking.confirmedRsvp || '',
      booking.declined || '',
      booking.notes || ''
    ]);
    
    // Write headers and data
    await writeToSheet(spreadsheetId, sheetTitle, [headers, ...rows]);
    
    return { success: true, sheetTitle };
  } catch (error) {
    console.error('Error syncing record day to Google Sheets:', error);
    throw error;
  }
}

// Legacy functions for backward compatibility
export async function appendBookingDataToSheet(spreadsheetId: string, bookingData: any[]) {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    const rows = bookingData.map(booking => [
      booking.contestantName || '',
      booking.contestantId || '',
      booking.auditionRating || '',
      booking.gender || '',
      booking.age || '',
      booking.location || '',
      booking.recordDayDate || '',
      booking.seatLabel || '',
      booking.workflow || '',
      booking.availabilityRsvp || '',
      booking.confirmedRsvp || '',
      booking.declined || '',
      booking.notes || ''
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:M',
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    return { success: true };
  } catch (error) {
    console.error('Error appending to Google Sheets:', error);
    throw error;
  }
}

export async function updateSheetRow(spreadsheetId: string, rowIndex: number, bookingData: any) {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    const row = [
      bookingData.contestantName || '',
      bookingData.contestantId || '',
      bookingData.auditionRating || '',
      bookingData.gender || '',
      bookingData.age || '',
      bookingData.location || '',
      bookingData.recordDayDate || '',
      bookingData.seatLabel || '',
      bookingData.workflow || '',
      bookingData.availabilityRsvp || '',
      bookingData.confirmedRsvp || '',
      bookingData.declined || '',
      bookingData.notes || ''
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A${rowIndex}:M${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating Google Sheets:', error);
    throw error;
  }
}

export async function createSheetHeader(spreadsheetId: string) {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    const headers = [[
      'Contestant Name',
      'Contestant ID',
      'Audition Rating',
      'Gender',
      'Age',
      'Location',
      'Record Day Date',
      'Seat Label',
      'Workflow',
      'Availability RSVP',
      'Confirmed RSVP',
      'Declined',
      'Notes'
    ]];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Sheet1!A1:M1',
      valueInputOption: 'RAW',
      requestBody: { values: headers },
    });

    return { success: true };
  } catch (error) {
    console.error('Error creating header in Google Sheets:', error);
    throw error;
  }
}

export async function getAllSheetData(spreadsheetId: string) {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:M',
    });

    return result.data.values || [];
  } catch (error) {
    console.error('Error reading from Google Sheets:', error);
    throw error;
  }
}

// Update a specific cell in a record day's sheet tab
export async function updateCellInRecordDaySheet(
  spreadsheetId: string,
  sheetTitle: string,
  rowIndex: number,
  columnIndex: number,
  value: string
): Promise<{ success: boolean }> {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    // Convert column index to letter (0=A, 1=B, etc.)
    const columnLetter = String.fromCharCode(65 + columnIndex);
    const range = `'${sheetTitle}'!${columnLetter}${rowIndex}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error updating cell in Google Sheets:', error);
    throw error;
  }
}

// Update an entire row in a record day's sheet tab
export async function updateRowInRecordDaySheet(
  spreadsheetId: string,
  sheetTitle: string,
  rowIndex: number,
  rowData: string[]
): Promise<{ success: boolean }> {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    // Calculate the end column letter based on data length
    const endColumnLetter = String.fromCharCode(65 + rowData.length - 1);
    const range = `'${sheetTitle}'!A${rowIndex}:${endColumnLetter}${rowIndex}`;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [rowData] }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error updating row in Google Sheets:', error);
    throw error;
  }
}

// Get data from a specific record day sheet tab
export async function getRecordDaySheetData(
  spreadsheetId: string,
  sheetTitle: string
): Promise<string[][]> {
  try {
    const sheets = await getUncachableGoogleSheetClient();
    
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle}'!A:Z`
    });
    
    return result.data.values || [];
  } catch (error) {
    console.error('Error reading record day sheet from Google Sheets:', error);
    throw error;
  }
}
