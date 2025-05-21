import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import { logger } from './logger.ts';

// Function to validate S3 environment variables
function validateS3EnvironmentVariables(): boolean {
  const requiredVars = [
    'S3_ENDPOINT_URL',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET_NAME',
    'S3_REGION'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      const errorMessage = `Missing required S3 environment variables in production: ${missingVars.join(', ')}`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    } else {
      logger.warn(`Missing S3 environment variables in development: ${missingVars.join(', ')}`);
      return false;
    }
  }
  return true;
}

// Function to create S3 client configuration
function createS3ClientConfig(): S3ClientConfig | null {
  if (!validateS3EnvironmentVariables()) {
    return null;
  }

  const endpoint = process.env.S3_ENDPOINT_URL;
  const credentials = {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!
  };

  // Determine if we need forcePathStyle
  // DigitalOcean Spaces and AWS S3 standard endpoints don't require forcePathStyle
  const isDigitalOceanOrAWS = endpoint?.includes('digitaloceanspaces.com') || endpoint?.includes('amazonaws.com');
  
  const config: S3ClientConfig = {
    region: process.env.S3_REGION,
    endpoint,
    credentials,
    forcePathStyle: !isDigitalOceanOrAWS // Use path style for non-AWS/DO endpoints (like MinIO)
  };

  return config;
}

// Initialize S3 client if environment variables are present
const s3ClientConfig = createS3ClientConfig();
let s3Client: S3Client | null = null;

if (s3ClientConfig) {
  try {
    s3Client = new S3Client(s3ClientConfig);
    logger.info('S3 client initialized successfully');
  } catch (error) {
    const errorMessage = `Error initializing S3 client: ${error instanceof Error ? error.message : String(error)}`;
    if (process.env.NODE_ENV === 'production') {
      logger.error(errorMessage);
      throw new Error(errorMessage);
    } else {
      logger.warn(errorMessage);
    }
  }
}

// Export the S3 client, bucket name, and validation function
export const s3 = s3Client;
export const isS3Configured = () => !!s3Client;
export const getBucketName = () => process.env.S3_BUCKET_NAME; 