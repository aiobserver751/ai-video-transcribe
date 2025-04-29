import { startTranscriptionWorker } from './transcription-queue.js';
import { logger } from '../logger.js';
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
        const concurrency = parseInt(process.env.TRANSCRIPTION_CONCURRENCY || '3', 10);
        logger.info(`Starting transcription worker with concurrency: ${concurrency}`);
        const worker = startTranscriptionWorker(concurrency);
        logger.info('Queue workers initialized successfully');
        workersInitialized = true;
        // Return the worker instance for potential shutdown
        return { transcriptionWorker: worker };
    }
    catch (error) {
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
    }
    else {
        logger.info(`Queue workers not initialized in ${environment} environment. Set ENABLE_QUEUE_WORKERS=true to force enable.`);
        return null;
    }
}
//# sourceMappingURL=server.js.map