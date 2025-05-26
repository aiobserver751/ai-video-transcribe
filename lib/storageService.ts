import fs from 'fs';
import path from 'path';
import os from 'os';
import { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand,
  HeadObjectCommand 
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { s3, getBucketName } from './s3Client.ts';
import { logger } from './logger.ts';

// Constants
const DEFAULT_LOCAL_STORAGE_PATH = path.join(process.cwd(), 'tmp');
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || DEFAULT_LOCAL_STORAGE_PATH;
const LOCAL_TMP_PATH = path.join(LOCAL_STORAGE_PATH, 'tmp');
const isProduction = process.env.NODE_ENV === 'production';

// Ensure both paths exist
if (!isProduction) {
  if (!fs.existsSync(LOCAL_STORAGE_PATH)) {
    fs.mkdirSync(LOCAL_STORAGE_PATH, { recursive: true });
    logger.info(`Created local storage directory: ${LOCAL_STORAGE_PATH}`);
  }
  
  if (!fs.existsSync(LOCAL_TMP_PATH)) {
    fs.mkdirSync(LOCAL_TMP_PATH, { recursive: true });
    logger.info(`Created local tmp directory: ${LOCAL_TMP_PATH}`);
  }
}

/**
 * Storage service that abstracts file operations for both local and S3 storage
 */
class StorageService {
  private s3Client: S3Client | null;
  private bucketName: string | undefined;
  private localStoragePath: string;
  
  constructor() {
    this.s3Client = s3;
    this.bucketName = getBucketName();
    this.localStoragePath = LOCAL_STORAGE_PATH;
    
    if (isProduction && !this.s3Client) {
      throw new Error('S3 client is required in production mode but is not configured properly');
    }
    
    logger.info(`Storage service initialized: ${isProduction ? 'PRODUCTION (S3)' : 'DEVELOPMENT (local)'}`);
    if (!isProduction) {
      logger.info(`Local storage path: ${this.localStoragePath}`);
    }
  }
  
  /**
   * Save a file to storage (S3 in production, local in development)
   * @param content - The content to save
   * @param filePath - The path within the storage system
   * @param contentType - Optional MIME type
   * @returns The full path to the saved file
   */
  async saveFile(content: string | Buffer, filePath: string, contentType?: string): Promise<string> {
    if (isProduction && this.s3Client) {
      return this.saveToS3(content, filePath, contentType);
    } else {
      return this.saveToLocal(content, filePath);
    }
  }
  
  /**
   * Read a file from storage
   * @param filePath - The path to the file
   * @returns The file content as a string
   */
  async readFile(filePath: string): Promise<string> {
    if (isProduction && this.s3Client) {
      return this.readFromS3(filePath);
    } else {
      return this.readFromLocal(filePath);
    }
  }
  
  /**
   * Delete a file from storage
   * @param filePath - The path to the file
   * @returns A boolean indicating success
   */
  async deleteFile(filePath: string): Promise<boolean> {
    if (isProduction && this.s3Client) {
      return this.deleteFromS3(filePath);
    } else {
      return this.deleteFromLocal(filePath);
    }
  }
  
  /**
   * Check if a file exists in storage
   * @param filePath - The path to the file
   * @returns A boolean indicating if the file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    if (isProduction && this.s3Client) {
      return this.existsInS3(filePath);
    } else {
      return this.existsInLocal(filePath);
    }
  }
  
  /**
   * Get a URL for a file in storage
   * @param filePath - The path to the file
   * @returns The URL to the file
   */
  async getFileUrl(filePath: string): Promise<string> {
    if (isProduction && this.s3Client) {
      return this.getS3Url(filePath);
    } else {
      return this.getLocalUrl(filePath);
    }
  }
  
  /**
   * Stream a file to a writable stream
   * @param filePath - The path to the file
   * @param writeStream - The writable stream to pipe the file to
   * @returns A promise that resolves when streaming is complete
   */
  async streamFile(filePath: string, writeStream: NodeJS.WritableStream): Promise<void> {
    if (isProduction && this.s3Client) {
      return this.streamFromS3(filePath, writeStream);
    } else {
      return this.streamFromLocal(filePath, writeStream);
    }
  }
  
  // Private methods for S3
  private async saveToS3(content: string | Buffer, filePath: string, contentType?: string): Promise<string> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error('S3 client is not configured');
    }
    
    try {
      const params = {
        Bucket: this.bucketName,
        Key: filePath,
        Body: content,
        ContentType: contentType || 'text/plain'
      };
      
      await this.s3Client.send(new PutObjectCommand(params));
      logger.info(`Saved file to S3: ${filePath}`);
      
      return filePath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error saving file to S3: ${filePath} - ${errorMessage}`);
      throw error;
    }
  }
  
  private async readFromS3(filePath: string): Promise<string> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error('S3 client is not configured');
    }
    
    try {
      const params = {
        Bucket: this.bucketName,
        Key: filePath
      };
      
      const response = await this.s3Client.send(new GetObjectCommand(params));
      const body = await response.Body?.transformToString();
      
      if (!body) {
        throw new Error(`Empty response body from S3: ${filePath}`);
      }
      
      return body;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error reading file from S3: ${filePath} - ${errorMessage}`);
      throw error;
    }
  }
  
  private async deleteFromS3(filePath: string): Promise<boolean> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error('S3 client is not configured');
    }
    
    try {
      const params = {
        Bucket: this.bucketName,
        Key: filePath
      };
      
      await this.s3Client.send(new DeleteObjectCommand(params));
      logger.info(`Deleted file from S3: ${filePath}`);
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error deleting file from S3: ${filePath} - ${errorMessage}`);
      return false;
    }
  }
  
  private async existsInS3(filePath: string): Promise<boolean> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error('S3 client is not configured');
    }
    
    try {
      const params = {
        Bucket: this.bucketName,
        Key: filePath
      };
      
      await this.s3Client.send(new HeadObjectCommand(params));
      return true;
    } catch {
      return false;
    }
  }
  
  private async getS3Url(filePath: string): Promise<string> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error('S3 client is not configured');
    }
    
    // For public URLs, we can just construct the URL directly
    const s3Endpoint = process.env.S3_ENDPOINT_URL || '';
    
    // Handle DigitalOcean Spaces URL format
    if (s3Endpoint.includes('digitaloceanspaces.com')) {
      return `${s3Endpoint}/${filePath}`;
    }
    
    // Handle AWS S3 URL format
    if (s3Endpoint.includes('amazonaws.com')) {
      const region = process.env.S3_REGION || 'us-east-1';
      return `https://${this.bucketName}.s3.${region}.amazonaws.com/${filePath}`;
    }
    
    // For other S3-compatible services, use the endpoint as is
    return `${s3Endpoint}/${this.bucketName}/${filePath}`;
  }
  
  private async streamFromS3(filePath: string, writeStream: NodeJS.WritableStream): Promise<void> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error('S3 client is not configured');
    }
    
    try {
      const params = {
        Bucket: this.bucketName,
        Key: filePath
      };
      
      const response = await this.s3Client.send(new GetObjectCommand(params));
      
      if (!response.Body) {
        throw new Error(`Empty response body from S3: ${filePath}`);
      }
      
      // Instead of trying to stream directly, we'll get the whole file as a buffer first
      // and then create a stream from it
      const bodyContents = await response.Body.transformToByteArray();
      const buffer = Buffer.from(bodyContents);
      
      // Create a readable stream from the buffer and pipe it to the writeStream
      const readableStream = Readable.from(buffer);
      await new Promise<void>((resolve, reject) => {
        readableStream
          .pipe(writeStream)
          .on('finish', () => resolve())
          .on('error', (err: Error) => reject(err));
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error streaming file from S3: ${filePath} - ${errorMessage}`);
      throw error;
    }
  }
  
  // Private methods for local storage
  private async saveToLocal(content: string | Buffer, filePath: string): Promise<string> {
    const fullPath = path.join(this.localStoragePath, filePath);
    const dirPath = path.dirname(fullPath);
    
    try {
      // Ensure directory exists
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      await fs.promises.writeFile(fullPath, content);
      logger.info(`Saved file to local storage: ${fullPath}`);
      
      return filePath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error saving file to local storage: ${fullPath} - ${errorMessage}`);
      throw error;
    }
  }
  
  private async readFromLocal(filePath: string): Promise<string> {
    const fullPath = path.join(this.localStoragePath, filePath);
    
    try {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error reading file from local storage: ${fullPath} - ${errorMessage}`);
      throw error;
    }
  }
  
  private async deleteFromLocal(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.localStoragePath, filePath);
    
    try {
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        logger.info(`Deleted file from local storage: ${fullPath}`);
        return true;
      }
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error deleting file from local storage: ${fullPath} - ${errorMessage}`);
      return false;
    }
  }
  
  private async existsInLocal(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.localStoragePath, filePath);
    return fs.existsSync(fullPath);
  }
  
  private getLocalUrl(filePath: string): string {
    const fullPath = path.join(this.localStoragePath, filePath);
    return `file://${fullPath}`;
  }
  
  private async streamFromLocal(filePath: string, writeStream: NodeJS.WritableStream): Promise<void> {
    const fullPath = path.join(this.localStoragePath, filePath);
    
    try {
      const readStream = fs.createReadStream(fullPath);
      await new Promise<void>((resolve, reject) => {
        readStream
          .pipe(writeStream)
          .on('finish', () => resolve())
          .on('error', (err: Error) => reject(err));
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error streaming file from local storage: ${fullPath} - ${errorMessage}`);
      throw error;
    }
  }
}

// Export a singleton instance of the storage service
export const storageService = new StorageService();

// Export the LOCAL_TMP_PATH for use in the transcription queue
export const getTmpPath = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // In production, use the system temp directory which should be writable
    const systemTmpDir = path.join(os.tmpdir(), 'ai-video-transcribe');
    
    // Ensure the directory exists
    if (!fs.existsSync(systemTmpDir)) {
      fs.mkdirSync(systemTmpDir, { recursive: true });
      logger.info(`Created production tmp directory: ${systemTmpDir}`);
    }
    
    return systemTmpDir;
  } else {
    // In development, use the local tmp path as before
    return LOCAL_TMP_PATH;
  }
};

// Enhanced cleanup function for production environments
export const cleanupOldTempFiles = async (maxAgeHours: number = 2): Promise<void> => {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) return; // Only run in production
  
  const tmpDir = getTmpPath();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000; // Convert hours to milliseconds
  const now = Date.now();
  
  try {
    if (!fs.existsSync(tmpDir)) return;
    
    const files = await fs.promises.readdir(tmpDir);
    let cleanedCount = 0;
    let errorCount = 0;
    
    for (const file of files) {
      try {
        const filePath = path.join(tmpDir, file);
        const stats = await fs.promises.stat(filePath);
        const fileAge = now - stats.mtime.getTime();
        
        if (fileAge > maxAgeMs) {
          await fs.promises.unlink(filePath);
          cleanedCount++;
          logger.debug(`Cleaned up old temp file: ${file} (age: ${Math.round(fileAge / 1000 / 60)} minutes)`);
        }
      } catch (error) {
        errorCount++;
        logger.warn(`Error cleaning up temp file ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (cleanedCount > 0 || errorCount > 0) {
      logger.info(`Temp cleanup completed: ${cleanedCount} files cleaned, ${errorCount} errors`);
    }
  } catch (error) {
    logger.error(`Error during temp directory cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Start periodic cleanup in production
if (process.env.NODE_ENV === 'production') {
  // Run cleanup every 30 minutes
  setInterval(() => {
    cleanupOldTempFiles(2); // Clean files older than 2 hours
  }, 30 * 60 * 1000);
  
  logger.info('Started periodic temp file cleanup (every 30 minutes, files older than 2 hours)');
} 