import { Response } from "express";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || "./storage";
const isReplit = !!process.env.REPL_ID;

let replitClient: any = null;

async function getReplitClient() {
  if (!isReplit) return null;
  
  if (replitClient) return replitClient;
  
  try {
    const { Client } = await import("@replit/object-storage");
    replitClient = new Client();
    return replitClient;
  } catch (error) {
    console.log("Replit object storage not available, using local file system");
    return null;
  }
}

function ensureLocalDir(dirPath: string) {
  const fullPath = path.join(LOCAL_STORAGE_DIR, dirPath);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
  return fullPath;
}

function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'pdf': return 'application/pdf';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {
    if (!isReplit) {
      ensureLocalDir("uploads");
    }
  }

  async uploadFile(buffer: Buffer, originalFilename: string): Promise<{ objectPath: string; url: string }> {
    const objectId = randomUUID();
    const ext = originalFilename.split('.').pop() || '';
    const objectName = ext ? `uploads/${objectId}.${ext}` : `uploads/${objectId}`;

    const client = await getReplitClient();
    
    if (client) {
      const { ok, error } = await client.uploadFromBytes(objectName, buffer);
      
      if (!ok) {
        throw new Error(`Failed to upload file: ${error}`);
      }
    } else {
      const fullPath = path.join(LOCAL_STORAGE_DIR, objectName);
      ensureLocalDir("uploads");
      fs.writeFileSync(fullPath, buffer);
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : '';

    return { 
      objectPath: `/objects/${objectName}`,
      url: `${baseUrl}/objects/${objectName}`
    };
  }

  async downloadObject(objectPath: string, res: Response) {
    try {
      const name = objectPath.replace('/objects/', '');
      let buffer: Buffer;

      const client = await getReplitClient();
      
      if (client) {
        const result = await client.downloadAsBytes(name);
        
        if (!result.ok || !result.value) {
          throw new ObjectNotFoundError();
        }

        [buffer] = result.value;
      } else {
        const fullPath = path.join(LOCAL_STORAGE_DIR, name);
        if (!fs.existsSync(fullPath)) {
          throw new ObjectNotFoundError();
        }
        buffer = fs.readFileSync(fullPath);
      }

      const contentType = getContentType(name);

      res.set({
        "Content-Type": contentType,
        "Content-Length": buffer.length,
        "Cache-Control": "public, max-age=3600",
      });

      res.send(buffer);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        if (error instanceof ObjectNotFoundError) {
          res.status(404).json({ error: "File not found" });
        } else {
          res.status(500).json({ error: "Error downloading file" });
        }
      }
    }
  }

  async getObjectAsBuffer(objectPath: string): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const name = objectPath.replace('/objects/', '');
    let buffer: Buffer;

    const client = await getReplitClient();
    
    if (client) {
      const result = await client.downloadAsBytes(name);
      
      if (!result.ok || !result.value) {
        throw new ObjectNotFoundError();
      }
      
      [buffer] = result.value;
    } else {
      const fullPath = path.join(LOCAL_STORAGE_DIR, name);
      if (!fs.existsSync(fullPath)) {
        throw new ObjectNotFoundError();
      }
      buffer = fs.readFileSync(fullPath);
    }
    
    const filename = name.split('/').pop() || 'attachment';
    const contentType = getContentType(filename);
    
    return { buffer, contentType, filename };
  }

  async listEmailAssets(): Promise<Array<{ path: string; name: string; contentType: string; size: number; url: string }>> {
    try {
      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : '';

      const client = await getReplitClient();
      
      if (client) {
        const { ok, error, value: files } = await client.list({ prefix: 'uploads/' });
        
        if (!ok || !files) {
          console.error('Error listing files:', error);
          return [];
        }
        
        return files.map((file: { name: string }) => {
          const filename = file.name.split('/').pop() || file.name;
          const contentType = getContentType(filename);
          
          return {
            path: `/objects/${file.name}`,
            name: filename,
            contentType,
            size: 0,
            url: `${baseUrl}/objects/${file.name}`,
          };
        });
      } else {
        const uploadsDir = path.join(LOCAL_STORAGE_DIR, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          return [];
        }
        
        const files = fs.readdirSync(uploadsDir);
        return files.map(filename => {
          const contentType = getContentType(filename);
          const stats = fs.statSync(path.join(uploadsDir, filename));
          
          return {
            path: `/objects/uploads/${filename}`,
            name: filename,
            contentType,
            size: stats.size,
            url: `${baseUrl}/objects/uploads/${filename}`,
          };
        });
      }
    } catch (error) {
      console.error('Error listing email assets:', error);
      return [];
    }
  }

  async deleteObject(objectPath: string): Promise<void> {
    const name = objectPath.replace('/objects/', '');

    const client = await getReplitClient();
    
    if (client) {
      const { ok, error } = await client.delete(name);
      
      if (!ok) {
        throw new Error(`Failed to delete object: ${error}`);
      }
    } else {
      const fullPath = path.join(LOCAL_STORAGE_DIR, name);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }
  }
}
