import { initializeQueueWorkers } from '../lib/queue/server.js';
import { logger } from '../lib/logger.js';

async function main() {
  try {
    logger.info('[WorkerInit] Initializing queue workers...');
    const workerInstances = initializeQueueWorkers();
    logger.info('[WorkerInit] Queue workers initialized successfully');
    
    // Keep the process running
    process.on('SIGINT', async () => {
      logger.info('[WorkerInit] Shutting down workers...');
      if (workerInstances) {
        if (workerInstances.transcriptionWorker) {
          logger.info('[WorkerInit] Closing transcription worker...');
          await workerInstances.transcriptionWorker.close();
        }
        if (workerInstances.contentIdeasWorker) {
          logger.info('[WorkerInit] Closing content ideas worker...');
          await workerInstances.contentIdeasWorker.close();
        }
      }
      process.exit(0);
    });
  } catch (error) {
    logger.error('[WorkerInit] Failed to initialize workers:', error);
    process.exit(1);
  }
}

main(); 