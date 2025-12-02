import { Client } from "@replit/object-storage";
import { Response } from "express";
import { randomUUID } from "crypto";

const client = new Client();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  async uploadFile(buffer: Buffer, originalFilename: string): Promise<{ objectPath: string; url: string }> {
    const objectId = randomUUID();
    const ext = originalFilename.split('.').pop() || '';
    const objectName = ext ? `uploads/${objectId}.${ext}` : `uploads/${objectId}`;

    const { ok, error } = await client.uploadFromBytes(objectName, buffer);
    
    if (!ok) {
      throw new Error(`Failed to upload file: ${error}`);
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
      const result = await client.downloadAsBytes(name);
      
      if (!result.ok || !result.value) {
        throw new ObjectNotFoundError();
      }

      const [buffer] = result.value;

      const ext = name.split('.').pop()?.toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === 'png') contentType = 'image/png';
      else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
      else if (ext === 'gif') contentType = 'image/gif';
      else if (ext === 'webp') contentType = 'image/webp';
      else if (ext === 'pdf') contentType = 'application/pdf';
      else if (ext === 'svg') contentType = 'image/svg+xml';

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
    const result = await client.downloadAsBytes(name);
    
    if (!result.ok || !result.value) {
      throw new ObjectNotFoundError();
    }
    
    const [buffer] = result.value;
    
    const filename = name.split('/').pop() || 'attachment';
    const ext = filename.split('.').pop()?.toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === 'png') contentType = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
    else if (ext === 'gif') contentType = 'image/gif';
    else if (ext === 'webp') contentType = 'image/webp';
    else if (ext === 'pdf') contentType = 'application/pdf';
    else if (ext === 'svg') contentType = 'image/svg+xml';
    
    return { buffer, contentType, filename };
  }

  async listEmailAssets(): Promise<Array<{ path: string; name: string; contentType: string; size: number; url: string }>> {
    try {
      const { ok, error, value: files } = await client.list({ prefix: 'uploads/' });
      
      if (!ok || !files) {
        console.error('Error listing files:', error);
        return [];
      }
      
      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : '';
      
      return files.map(file => {
        const filename = file.name.split('/').pop() || file.name;
        const ext = filename.split('.').pop()?.toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === 'png') contentType = 'image/png';
        else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
        else if (ext === 'gif') contentType = 'image/gif';
        else if (ext === 'webp') contentType = 'image/webp';
        else if (ext === 'pdf') contentType = 'application/pdf';
        else if (ext === 'svg') contentType = 'image/svg+xml';
        
        return {
          path: `/objects/${file.name}`,
          name: filename,
          contentType,
          size: 0,
          url: `${baseUrl}/objects/${file.name}`,
        };
      });
    } catch (error) {
      console.error('Error listing email assets:', error);
      return [];
    }
  }

  async deleteObject(objectPath: string): Promise<void> {
    const name = objectPath.replace('/objects/', '');
    const { ok, error } = await client.delete(name);
    
    if (!ok) {
      throw new Error(`Failed to delete object: ${error}`);
    }
  }
}
