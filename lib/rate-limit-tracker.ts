import fs from 'fs';
import path from 'path';
import { getTmpPath, storageService } from './storageService';

// Rate limit configuration with defaults based on free tier
interface RateLimitConfig {
  tier: 'free' | 'developer';
  whisperASH: number; // Audio seconds per hour
  whisperASD: number; // Audio seconds per day
  trackingFilePath: string;
}

// Usage tracking data structure
interface RateUsageData {
  hourlyUsage: {
    whisper: {
      audioSeconds: number;
      lastReset: string; // ISO date string
    }
  };
  dailyUsage: {
    whisper: {
      audioSeconds: number;
      lastReset: string; // ISO date string
    }
  };
}

// Default configuration for free tier
const DEFAULT_CONFIG: RateLimitConfig = {
  tier: 'free',
  whisperASH: 7200,  // 7,200 audio seconds per hour
  whisperASD: 28800, // 28,800 audio seconds per day
  trackingFilePath: path.join(getTmpPath(), 'groq-rate-limits.json')
};

/**
 * Load configuration from environment variables or use defaults
 */
function loadConfig(): RateLimitConfig {
  return {
    tier: (process.env.GROQ_TIER as 'free' | 'developer') || DEFAULT_CONFIG.tier,
    whisperASH: parseInt(process.env.GROQ_WHISPER_ASH || String(DEFAULT_CONFIG.whisperASH)),
    whisperASD: parseInt(process.env.GROQ_WHISPER_ASD || String(DEFAULT_CONFIG.whisperASD)),
    trackingFilePath: process.env.GROQ_RATE_TRACKING_PATH || DEFAULT_CONFIG.trackingFilePath
  };
}

/**
 * Initialize or load the rate usage tracking data
 */
function initTrackingData(): RateUsageData {
  const config = loadConfig();
  const relativePath = path.relative(getTmpPath(), config.trackingFilePath);
  
  // Load existing data or create new
  if (storageService.tempFileExists(relativePath)) {
    try {
      // Use synchronous approach for initialization
      const fullPath = storageService.getTempFilePath(relativePath);
      const fileData = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(fileData);
    } catch (error) {
      console.warn('Error loading rate limit tracking data, creating new:', error);
    }
  }
  
  // Initialize fresh tracking data
  const now = new Date().toISOString();
  const freshData: RateUsageData = {
    hourlyUsage: {
      whisper: {
        audioSeconds: 0,
        lastReset: now
      }
    },
    dailyUsage: {
      whisper: {
        audioSeconds: 0,
        lastReset: now
      }
    }
  };
  
  // Save the initial data
  saveTrackingData(freshData);
  return freshData;
}

/**
 * Save the tracking data to disk
 */
function saveTrackingData(data: RateUsageData): void {
  const config = loadConfig();
  const relativePath = path.relative(getTmpPath(), config.trackingFilePath);
  const fullPath = storageService.getTempFilePath(relativePath);
  
  // Ensure directory exists
  const dirPath = path.dirname(fullPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
}

/**
 * Check if we need to reset hourly or daily counters
 */
function checkAndResetCounters(data: RateUsageData): RateUsageData {
  const now = new Date();
  const hourlyLastReset = new Date(data.hourlyUsage.whisper.lastReset);
  const dailyLastReset = new Date(data.dailyUsage.whisper.lastReset);
  
  // Reset hourly counter if an hour has passed
  if (now.getTime() - hourlyLastReset.getTime() >= 60 * 60 * 1000) {
    data.hourlyUsage.whisper.audioSeconds = 0;
    data.hourlyUsage.whisper.lastReset = now.toISOString();
  }
  
  // Reset daily counter if a day has passed
  if (now.getTime() - dailyLastReset.getTime() >= 24 * 60 * 60 * 1000) {
    data.dailyUsage.whisper.audioSeconds = 0;
    data.dailyUsage.whisper.lastReset = now.toISOString();
  }
  
  return data;
}

/**
 * Extract the number of used seconds from the error message
 */
function extractUsedSeconds(errorMessage: string): number {
  const match = errorMessage.match(/Used (\d+)/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * Calculate estimated time remaining until reset based on the error message
 */
function calculateTimeUntilReset(errorMessage: string): number {
  const match = errorMessage.match(/Please try again in (\d+)m(\d+\.\d+)s/);
  if (match) {
    const minutes = parseInt(match[1]);
    const seconds = parseFloat(match[2]);
    return (minutes * 60 + seconds) * 1000; // in milliseconds
  }
  return 60 * 60 * 1000; // Default to 1 hour if we can't parse
}

/**
 * Rate Limit Tracker class for managing Groq API rate limits
 */
export class GroqRateLimitTracker {
  private config: RateLimitConfig;
  private data: RateUsageData;
  
  constructor() {
    this.config = loadConfig();
    this.data = initTrackingData();
    this.data = checkAndResetCounters(this.data);
    saveTrackingData(this.data);
  }
  
  /**
   * Track audio seconds usage for Whisper
   */
  trackWhisperUsage(audioSeconds: number): void {
    this.data.hourlyUsage.whisper.audioSeconds += audioSeconds;
    this.data.dailyUsage.whisper.audioSeconds += audioSeconds;
    saveTrackingData(this.data);
  }
  
  /**
   * Handle rate limit error by updating our tracking based on the error message
   */
  handleRateLimitError(errorMessage: string): {
    usedSeconds: number;
    resetDelayMs: number;
    estimatedResetTime: Date;
  } {
    // Extract information from error message
    const usedSeconds = extractUsedSeconds(errorMessage);
    const resetDelayMs = calculateTimeUntilReset(errorMessage);
    const estimatedResetTime = new Date(Date.now() + resetDelayMs);
    
    // Update our tracking with the actual used seconds from Groq
    if (usedSeconds > 0) {
      this.data.hourlyUsage.whisper.audioSeconds = usedSeconds;
      saveTrackingData(this.data);
    }
    
    return {
      usedSeconds,
      resetDelayMs,
      estimatedResetTime
    };
  }
  
  /**
   * Check if we can process audio of the given duration
   */
  canProcessAudio(audioSeconds: number): {
    canProcess: boolean;
    hourlyRemaining: number;
    dailyRemaining: number;
    estimatedWaitTimeMs?: number;
  } {
    // Refresh our counters first
    this.data = checkAndResetCounters(this.data);
    
    // Calculate remaining capacity
    const hourlyRemaining = Math.max(0, this.config.whisperASH - this.data.hourlyUsage.whisper.audioSeconds);
    const dailyRemaining = Math.max(0, this.config.whisperASD - this.data.dailyUsage.whisper.audioSeconds);
    
    // Check if we can process
    const canProcess = audioSeconds <= hourlyRemaining && audioSeconds <= dailyRemaining;
    
    // If we can't process, calculate estimated wait time
    let estimatedWaitTimeMs: number | undefined;
    if (!canProcess) {
      if (hourlyRemaining < audioSeconds) {
        // Calculate time until hourly reset
        const hourlyLastReset = new Date(this.data.hourlyUsage.whisper.lastReset);
        estimatedWaitTimeMs = (60 * 60 * 1000) - (Date.now() - hourlyLastReset.getTime());
      }
    }
    
    return {
      canProcess,
      hourlyRemaining,
      dailyRemaining,
      estimatedWaitTimeMs
    };
  }
  
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
  } {
    // Refresh our counters first
    this.data = checkAndResetCounters(this.data);
    
    const hourlyLastReset = new Date(this.data.hourlyUsage.whisper.lastReset);
    const dailyLastReset = new Date(this.data.dailyUsage.whisper.lastReset);
    
    // Calculate next reset times
    const hourlyResetAt = new Date(hourlyLastReset.getTime() + (60 * 60 * 1000));
    const dailyResetAt = new Date(dailyLastReset.getTime() + (24 * 60 * 60 * 1000));
    
    return {
      tier: this.config.tier,
      hourlyLimit: this.config.whisperASH,
      hourlyUsed: this.data.hourlyUsage.whisper.audioSeconds,
      hourlyRemaining: Math.max(0, this.config.whisperASH - this.data.hourlyUsage.whisper.audioSeconds),
      dailyLimit: this.config.whisperASD,
      dailyUsed: this.data.dailyUsage.whisper.audioSeconds,
      dailyRemaining: Math.max(0, this.config.whisperASD - this.data.dailyUsage.whisper.audioSeconds),
      hourlyResetAt,
      dailyResetAt
    };
  }
}

// Export singleton instance
export const rateLimitTracker = new GroqRateLimitTracker(); 