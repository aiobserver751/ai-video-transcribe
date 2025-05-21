import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.ts';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Conditionally load .env file
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  const result = dotenv.config({ path: path.resolve(__dirname, '../.env') });
  if (result.error) {
    logger.error('Error loading .env file during development:', result.error);
    // Optionally, decide if this should throw or just warn during development
  }
} else {
  // In production, variables are expected to be set in the environment
  // Optional: Log that we are in production and relying on system env vars
  logger.info('Running in production mode, relying on system environment variables.');
}

// Validate required environment variables
const requiredEnvVars = [
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  logger.error('Missing required environment variables:', missingVars);
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Clean up host format (remove port if included)
const host = process.env.REDIS_HOST!.split(':')[0];
const port = parseInt(process.env.REDIS_PORT!, 10);
const password = process.env.REDIS_PASSWORD!;

// Log the Redis configuration (without password)
logger.info('Redis configuration loaded:', {
  host,
  port,
  hasPassword: true
});

export const env = {
  redis: {
    host,
    port,
    password,
    username: 'default'
  }
}; 