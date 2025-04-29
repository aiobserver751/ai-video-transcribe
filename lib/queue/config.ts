import IORedis from 'ioredis';
import { logger } from '../logger.ts';
import { env } from '../env.ts';

// Validate required environment variables
const requiredEnvVars = {
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD
};

// Check for missing environment variables
const missingVars = Object.entries(requiredEnvVars)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

// Redis connection configuration
export const redisConnection = {
  host: env.redis.host,
  port: env.redis.port,
  username: env.redis.username,
  password: env.redis.password,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,    // Recommended for BullMQ
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

// Create Redis connection
export const createRedisConnection = () => {
  logger.info('Creating Redis connection with config:', {
    host: redisConnection.host,
    port: redisConnection.port,
    username: redisConnection.username,
    hasPassword: true
  });
  
  const redis = new IORedis(redisConnection);
  
  redis.on('connect', () => {
    logger.info('Successfully connected to Redis');
  });
  
  redis.on('error', (error) => {
    logger.error('Redis connection error:', error);
  });
  
  return redis;
};

// Queue names
export const QUEUE_NAMES = {
  TRANSCRIPTION: 'transcription',
  AUDIO_CHUNK: 'audio-chunk',
};

// Priority values (higher number = higher priority)
export const PRIORITY = {
  PREMIUM: 2,
  STANDARD: 1,
};

// Job statuses
export const JOB_STATUS = {
  WAITING: 'waiting',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DELAYED: 'delayed',
  PAUSED: 'paused',
};

// Default job options
export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    age: 24 * 3600, // Keep successful jobs for 24 hours
    count: 1000,    // Keep last 1000 successful jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Keep failed jobs for 7 days
  },
}; 