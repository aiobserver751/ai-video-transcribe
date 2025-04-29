// Simple test script to verify the logger is working
// Run with: npx ts-node test-logger.ts
import { logger } from './lib/logger';
console.log('Direct console.log test');
logger.debug('This is a debug message');
logger.info('This is an info message');
logger.warn('This is a warning message');
logger.error('This is an error message');
console.log('Logger test complete - if you see the messages above, logging is working');
//# sourceMappingURL=test-logger.js.map