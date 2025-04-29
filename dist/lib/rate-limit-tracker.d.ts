/**
 * Rate Limit Tracker class for managing Groq API rate limits
 */
export declare class GroqRateLimitTracker {
    private config;
    private data;
    constructor();
    /**
     * Track audio seconds usage for Whisper
     */
    trackWhisperUsage(audioSeconds: number): void;
    /**
     * Handle rate limit error by updating our tracking based on the error message
     */
    handleRateLimitError(errorMessage: string): {
        usedSeconds: number;
        resetDelayMs: number;
        estimatedResetTime: Date;
    };
    /**
     * Check if we can process audio of the given duration
     */
    canProcessAudio(audioSeconds: number): {
        canProcess: boolean;
        hourlyRemaining: number;
        dailyRemaining: number;
        estimatedWaitTimeMs?: number;
    };
    /**
     * Get current usage statistics
     */
    getUsageStats(): {
        tier: string;
        hourlyLimit: number;
        hourlyUsed: number;
        hourlyRemaining: number;
        dailyLimit: number;
        dailyUsed: number;
        dailyRemaining: number;
        hourlyResetAt: Date;
        dailyResetAt: Date;
    };
}
export declare const rateLimitTracker: GroqRateLimitTracker;
