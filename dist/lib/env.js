import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.ts';
// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load environment variables from .env file
const result = config({ path: path.resolve(__dirname, '../.env') });
if (result.error) {
    logger.error('Error loading .env file:', result.error);
    throw new Error('Failed to load environment variables');
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
const host = process.env.REDIS_HOST.split(':')[0];
const port = parseInt(process.env.REDIS_PORT, 10);
const password = process.env.REDIS_PASSWORD;
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
//# sourceMappingURL=env.js.map