import { initializeQueueWorkers } from '../lib/queue/server.js';
import { logger } from '../lib/logger.js';

async function main() {
  try {
    logger.info('[WorkerInit] Initializing queue workers...');
    const workers = initializeQueueWorkers();
    logger.info('[WorkerInit] Queue workers initialized successfully');
    
    // Keep the process running
    process.on('SIGINT', async () => {
      logger.info('[WorkerInit] Shutting down workers...');
      if (workers) {
        await workers.transcriptionWorker.close();
      }
      process.exit(0);
    });
  } catch (error) {
    logger.error('[WorkerInit] Failed to initialize workers:', error);
    process.exit(1);
  }
}

main(); 