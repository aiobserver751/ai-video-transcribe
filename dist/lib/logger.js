/**
 * Logger utility for environment-specific logging
 * Provides different verbosity levels depending on NODE_ENV
 */
class Logger {
    constructor() {
        this.isDevelopment = process.env.NODE_ENV !== 'production';
    }
    /**
     * Debug level logging - only shown in development
     */
    debug(...args) {
        if (this.isDevelopment) {
            console.debug(...args);
        }
    }
    /**
     * Info level logging - reduced in production
     */
    info(...args) {
        if (this.isDevelopment || this.shouldLogInProduction('info', args)) {
            console.log(...args);
        }
    }
    /**
     * Warning level logging - shown in all environments
     */
    warn(...args) {
        console.warn(...args);
    }
    /**
     * Error level logging - shown in all environments
     */
    error(...args) {
        console.error(...args);
    }
    /**
     * Determines if a particular message should be logged in production
     * based on importance
     */
    shouldLogInProduction(level, args) {
        // In production, we only want to log important info messages
        // This could be enhanced with more sophisticated filtering
        if (level === 'info') {
            // Only log important summaries, not detailed progress
            const message = args[0]?.toString() || '';
            return message.includes('===') || // Section headers
                message.includes('completed') || // Completion messages
                message.includes('Starting') || // Start of important processes
                message.includes('Rate limit'); // Rate limit information
        }
        return true;
    }
}
// Export a singleton instance
export const logger = new Logger();
//# sourceMappingURL=logger.js.map