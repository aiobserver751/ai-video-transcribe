import { startTranscriptionWorker } from './transcription-queue';
import { startContentIdeasWorker } from './content-ideas-queue';
import { logger } from '../logger';

// Flag to track whether workers have been initialized
let workersInitialized = false;

// Function to initialize all workers
export function initializeQueueWorkers() {
  if (workersInitialized) {
    logger.info('Queue workers already initialized');
    return;
  }

  try {
    // Start transcription worker with desired concurrency
    const transcriptionConcurrency = parseInt(process.env.TRANSCRIPTION_CONCURRENCY || '3', 10);
    logger.info(`Starting transcription worker with concurrency: ${transcriptionConcurrency}`);
    const transcriptionWorker = startTranscriptionWorker(transcriptionConcurrency);

    // Start content ideas worker with desired concurrency
    const contentIdeasConcurrency = parseInt(process.env.CONTENT_IDEAS_CONCURRENCY || '2', 10);
    logger.info(`Starting content ideas worker with concurrency: ${contentIdeasConcurrency}`);
    const contentIdeasWorker = startContentIdeasWorker(contentIdeasConcurrency);
    
    logger.info('Queue workers initialized successfully');
    workersInitialized = true;
    
    // Return the worker instances for potential shutdown
    return { transcriptionWorker, contentIdeasWorker };
  } catch (error) {
    logger.error('Failed to initialize queue workers:', error);
    throw error;
  }
}

// Only initialize in production or when explicitly enabled
export function initializeQueueWorkersIfEnabled() {
  const environment = process.env.NODE_ENV || 'development';
  const forceEnable = process.env.ENABLE_QUEUE_WORKERS === 'true';
  
  if (environment === 'production' || forceEnable) {
    logger.info(`Initializing queue workers in ${environment} environment`);
    return initializeQueueWorkers();
  } else {
    logger.info(`Queue workers not initialized in ${environment} environment. Set ENABLE_QUEUE_WORKERS=true to force enable.`);
    return null;
  }
} 