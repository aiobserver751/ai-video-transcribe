/**
 * Logger utility for environment-specific logging
 * Provides different verbosity levels depending on NODE_ENV
 */
declare class Logger {
    private isDevelopment;
    constructor();
    /**
     * Debug level logging - only shown in development
     */
    debug(...args: unknown[]): void;
    /**
     * Info level logging - reduced in production
     */
    info(...args: unknown[]): void;
    /**
     * Warning level logging - shown in all environments
     */
    warn(...args: unknown[]): void;
    /**
     * Error level logging - shown in all environments
     */
    error(...args: unknown[]): void;
    /**
     * Determines if a particular message should be logged in production
     * based on importance
     */
    private shouldLogInProduction;
}
export declare const logger: Logger;
export {};
