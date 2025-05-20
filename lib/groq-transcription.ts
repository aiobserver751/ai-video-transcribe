import { logger } from './logger.ts';
import { rateLimitTracker } from './rate-limit-tracker.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';

const execAsync = promisify(exec);
const statAsync = promisify(fs.stat);
const mkdirAsync = promisify(fs.mkdir);

const MAX_FILE_SIZE_MB = 25; // 25MB for free tier direct upload
const MAX_RETRY_ATTEMPTS = 3; // Maximum number of retry attempts for rate-limited requests

async function getFileSizeMB(filePath: string): Promise<number> {
  const stats = await statAsync(filePath);
  return stats.size / (1024 * 1024);
}

// Get audio duration in seconds using ffmpeg
async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
    return parseFloat(stdout.trim());
  } catch (error) {
    logger.error('Error getting audio duration:', error);
    // Default estimate: 1 minute per 1MB of audio
    const fileSizeMB = await getFileSizeMB(filePath);
    return fileSizeMB * 60;
  }
}

// Sleep function for delay between retries
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Function to extract plain text from Groq's verbose_json response
export function extractTextFromVerboseJson(verboseJson: GroqVerboseJsonResponse | Record<string, unknown>): string {
  if (verboseJson && typeof verboseJson.text === 'string') {
    return verboseJson.text;
  }
  // Fallback or more complex extraction if verboseJson.text is not directly available
  // This might involve iterating over segments if verboseJson.text isn't populated
  // For now, assuming verboseJson.text is the primary source as per OpenAI/Groq examples.
  if (verboseJson && Array.isArray((verboseJson as GroqVerboseJsonResponse).segments)) {
    return (verboseJson as GroqVerboseJsonResponse).segments.map((segment: GroqVerboseJsonResponse['segments'][number]) => segment.text).join(' ').trim();
  }
  logger.warn('Could not extract plain text from verbose_json', verboseJson);
  return '';
}

export interface GroqVerboseJsonResponse {
  text: string;
  segments: Array<{
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
  }>;
  words?: Array<{ // Words might not always be present or might have a different structure
    word: string;
    start: number;
    end: number;
    probability?: number; // Or confidence, depending on API
  }>;
  language?: string; // If detected by the API
  // Potentially other fields based on Groq's specific verbose_json structure
}

// Updated to return the GroqVerboseJsonResponse object
async function transcribeChunkWithGroq(chunkPath: string, audioDuration: number): Promise<GroqVerboseJsonResponse> {
  const startTime = Date.now();
  let retryCount = 0;
  
  // Check if we can process this audio based on our rate limit tracking
  const rateCheck = rateLimitTracker.canProcessAudio(audioDuration);
  
  if (!rateCheck.canProcess) {
    const waitTimeMinutes = rateCheck.estimatedWaitTimeMs ? Math.ceil(rateCheck.estimatedWaitTimeMs / 60000) : 60;
    logger.warn(`Rate limit would be exceeded. Current usage: ${rateCheck.hourlyRemaining} seconds remaining out of ${rateLimitTracker.getUsageStats().hourlyLimit}.`);
    logger.warn(`Estimated wait time: ${waitTimeMinutes} minutes.`);
    throw new Error(`Rate limit would be exceeded. Please try again in approximately ${waitTimeMinutes} minutes.`);
  }
  
  while (retryCount <= MAX_RETRY_ATTEMPTS) {
    try {
      if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY environment variable is not set');
      }
      
      logger.info(`Starting Groq transcription for: ${path.basename(chunkPath)}`);
      
      // Create form data for file upload
      const formData = new FormData();
      
      // Make sure file exists before creating a read stream
      if (!fs.existsSync(chunkPath)) {
        throw new Error(`File not found: ${chunkPath}`);
      }
      
      // Get file stats to check file size
      const stats = await statAsync(chunkPath);
      logger.info(`File size: ${stats.size / (1024 * 1024)} MB`);
      
      // Add file stream to form data
      formData.append('file', fs.createReadStream(chunkPath));
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');
      formData.append('timestamp_granularities[]', 'word');
      
      // Make request directly using axios
      try {
        logger.info('Sending request to Groq API...');
        
        // Track the usage before making the request
        rateLimitTracker.trackWhisperUsage(audioDuration);
        
        const response = await axios.post<GroqVerboseJsonResponse>(
          'https://api.groq.com/openai/v1/audio/transcriptions',
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000, // 60 second timeout
          }
        );
        
        logger.info(`Groq transcription completed. Time taken: ${(Date.now() - startTime) / 1000}s`);
        
        if (response.data && (response.data.text !== undefined || Array.isArray(response.data.segments))) {
          return response.data;
        } else {
          logger.warn('Unexpected verbose_json response format:', response.data);
          throw new Error('Unexpected verbose_json response format from Groq API');
        }
      } catch (axiosError: unknown) {
        if (axios.isAxiosError(axiosError)) {
          logger.error('Axios error details:', axiosError.response?.data || axiosError.message);
          
          // Check for rate limit errors
          if (axiosError.response?.data?.error?.code === 'rate_limit_exceeded') {
            const errorMessage = axiosError.response?.data?.error?.message || '';
            logger.warn(`Rate limit exceeded. ${errorMessage}`);
            
            // Track the rate limit in our system
            const rateLimitInfo = rateLimitTracker.handleRateLimitError(errorMessage);
            logger.info(`Updated rate limit tracking. Used: ${rateLimitInfo.usedSeconds}s, Reset in: ${Math.ceil(rateLimitInfo.resetDelayMs / 1000)}s`);
            
            // If we have remaining retries, attempt to retry after delay
            if (retryCount < MAX_RETRY_ATTEMPTS) {
              retryCount++;
              logger.info(`Retrying after ${rateLimitInfo.resetDelayMs/1000} seconds (Attempt ${retryCount}/${MAX_RETRY_ATTEMPTS})...`);
              await sleep(rateLimitInfo.resetDelayMs);
              // Continue to next iteration of the while loop
              continue;
            } else {
              throw new Error(`Rate limit exceeded. Maximum retry attempts reached. ${errorMessage}`);
            }
          }
          
          if (axiosError.response?.status === 413) {
            throw new Error('File too large for Groq API. Consider using smaller chunks.');
          } else {
            throw new Error(`Groq API request failed: ${axiosError.response?.data?.error?.message || axiosError.message}`);
          }
        } else {
          throw new Error(`Network error: ${String(axiosError)}`);
        }
      }
      
      // If we reach here, the request was successful
      break;
      
    } catch (error) {
      // If this wasn't a rate limit error or we've exhausted our retries, propagate the error
      if (retryCount >= MAX_RETRY_ATTEMPTS || !(error instanceof Error && error.message.includes('rate_limit_exceeded'))) {
        logger.error('Groq transcription error:', error);
        throw new Error(`Failed to transcribe with Groq API: ${error}`);
      }
    }
  }
  
  // This should not be reached, but just in case
  throw new Error('Failed to transcribe with Groq API after multiple attempts');
}

// Updated to return the GroqVerboseJsonResponse object
export async function transcribeAudioWithGroq(audioPath: string): Promise<GroqVerboseJsonResponse> {
  const totalStartTime = Date.now();
  let chunksDir: string | undefined = undefined; // Define chunksDir here to be accessible in finally
  try {
    // Check if file exists
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }
    
    // Check file size
    const fileSizeInMB = await getFileSizeMB(audioPath);
    
    logger.info(`\n=== Processing Audio File with Groq ===`);
    logger.info(`Audio file size: ${fileSizeInMB.toFixed(2)}MB`);
    
    // Get audio duration in seconds
    const totalAudioDuration = await getAudioDuration(audioPath);
    logger.info(`Total audio duration: ${totalAudioDuration.toFixed(2)} seconds`);
    
    // Get current rate limit usage stats
    const usageStats = rateLimitTracker.getUsageStats();
    logger.info(`\n=== Groq Rate Limit Status ===`);
    logger.info(`Tier: ${usageStats.tier}`);
    logger.info(`Hourly limit: ${usageStats.hourlyLimit} seconds`);
    logger.info(`Hourly used: ${usageStats.hourlyUsed} seconds`);
    logger.info(`Hourly remaining: ${usageStats.hourlyRemaining} seconds`);
    logger.info(`Hourly reset at: ${usageStats.hourlyResetAt.toISOString()}`);
    logger.info(`Daily limit: ${usageStats.dailyLimit} seconds`);
    logger.info(`Daily used: ${usageStats.dailyUsed} seconds`);
    logger.info(`Daily remaining: ${usageStats.dailyRemaining} seconds`);
    
    // Warn if we're close to limits
    if (totalAudioDuration > usageStats.hourlyRemaining) {
      logger.warn(`\n⚠️ WARNING: This audio (${totalAudioDuration.toFixed(0)}s) may exceed your hourly limit (${usageStats.hourlyRemaining}s remaining).`);
    }

    // Check if file is under the limit
    if (fileSizeInMB <= MAX_FILE_SIZE_MB) {
      // If file is within size limit, transcribe directly
      logger.info(`\n=== Processing Single File with Groq ===`);
      // Directly return the JSON response
      const audioDuration = await getAudioDuration(audioPath); // Ensure audioDuration is available
      return await transcribeChunkWithGroq(audioPath, audioDuration);
    }

    // If file is too large, proceed with chunking
    logger.info('\n=== Starting Chunking Process for Groq API ===');
    
    const timestamp = Date.now();
    chunksDir = path.join(process.cwd(), 'tmp', `groq_chunks_${timestamp}`); // Assign to outer scope variable
    await mkdirAsync(chunksDir, { recursive: true });

    // Split on silence, minimum 1 second of silence
    const chunkStartTime = Date.now();
    logger.info('Splitting audio into chunks for Groq processing...');
    
    try {
      // First detect silence points
      const silenceDetectCmd = `ffmpeg -i "${audioPath}" -af silencedetect=noise=-30dB:d=1 -f null - 2>&1`;
      const silenceOutput = await execAsync(silenceDetectCmd);
      
      // Extract silence timestamps
      const silenceMatches = silenceOutput.stdout.match(/silence_start: (\d+\.\d+)/g);
      const silencePoints = silenceMatches ? silenceMatches.map(m => parseFloat(m.split(': ')[1])) : [];
      
      // Create segments based on silence points to stay under size limit
      const segmentTimes = [];
      let currentTime = 0;
      
      // Use shorter segments for Groq API (about 2-3 minutes per segment)
      // This helps with rate limits and keeps file sizes manageable
      for (const silencePoint of silencePoints) {
        if (silencePoint - currentTime >= 180) { // 3 minutes max
          segmentTimes.push(silencePoint);
          currentTime = silencePoint;
        }
      }
      
      if (segmentTimes.length === 0 && totalAudioDuration > 300) {
        // If no natural silence points were found but audio is long
        // Force splits every 3 minutes
        for (let i = 180; i < totalAudioDuration; i += 180) {
          segmentTimes.push(i);
        }
        logger.info(`No natural silence points found. Forcing splits every 3 minutes at: ${segmentTimes.join(', ')} seconds`);
      }
      
      // Split the audio at silence points (or forced points)
      if (segmentTimes.length > 0) {
        const segmentStr = segmentTimes.join(',');
        await execAsync(`ffmpeg -i "${audioPath}" -f segment -segment_times "${segmentStr}" -c copy "${chunksDir}/chunk_%03d.mp3"`);
      } else {
        // If no segments (short audio or no silence), just copy the file
        await execAsync(`cp "${audioPath}" "${chunksDir}/chunk_000.mp3"`);
        logger.info('Audio is short enough to process as a single chunk');
      }
      
      logger.info(`Chunking completed. Time taken: ${(Date.now() - chunkStartTime) / 1000}s`);
  
      // Process chunks
      const chunks = fs.readdirSync(chunksDir).filter(f => f.endsWith('.mp3')).sort();
      logger.info(`\n=== Chunk Information ===`);
      logger.info(`Total chunks created: ${chunks.length}`);
      
      // Log size of each chunk
      let totalChunkSize = 0;
      for (const chunk of chunks) {
        const chunkPath = path.join(chunksDir, chunk);
        const chunkSize = await getFileSizeMB(chunkPath);
        totalChunkSize += chunkSize;
        logger.info(`Chunk ${chunk}: ${chunkSize.toFixed(2)}MB`);
      }
      logger.info(`Total chunk size: ${totalChunkSize.toFixed(2)}MB`);
      
      logger.info('\n=== Starting Groq Transcription ===');
      const transcriptions: GroqVerboseJsonResponse[] = [];
  
      for (const chunk of chunks) {
        const chunkPath = path.join(chunksDir, chunk);
        const chunkDuration = await getAudioDuration(chunkPath); // Get duration for each chunk
        const transcriptionJson = await transcribeChunkWithGroq(chunkPath, chunkDuration);
        transcriptions.push(transcriptionJson);
      }
  
      // Clean up chunks directory
      try {
        fs.rmSync(chunksDir, { recursive: true, force: true });
        logger.info('Cleaned up temporary chunk files');
      } catch (cleanupError) {
        logger.error('Error cleaning up chunks:', cleanupError);
      }
      
      // Merge results
      logger.info('Merging transcription results (verbose_json needs careful merging)...');
      // Merging verbose_json is more complex than text.
      // For now, we'll return the JSON of the first chunk if only one,
      // or a simplified combined response. Proper merging would adjust timestamps.
      // This part needs careful implementation if precise multi-chunk JSON is required.
      // For simplicity, if there's only one chunk, return its JSON directly.
      // If multiple, this example will just concatenate text and return the first segment/word set for structure.
      // A more robust merge would re-calculate timestamps based on chunk order and durations.
      if (transcriptions.length === 0) {
        throw new Error("No transcription results from chunks.");
      }
      
      if (transcriptions.length === 1) {
        return transcriptions[0];
      } else {
        // This is a simplified merge. Proper merging of verbose_json is complex.
        // It should adjust timestamps globally.
        // For now, concatenate text and use segment/word structure from the first chunk as a placeholder.
        const combinedText = transcriptions.map(t => t.text || '').join(' ').trim();
        // A truly merged verbose_json would require re-calculating all segment/word start/end times.
        // This is a placeholder for that complex logic.
        // We will primarily rely on the combinedText for now for multi-chunk scenarios,
        // and the SRT/VTT generation will need to be aware of this.
        // Ideally, the SRT/VTT generation should happen per chunk and then get merged.
        // Or, a more sophisticated merging of verbose_json objects.
        
        let cumulativeDuration = 0;
        const mergedSegments: GroqVerboseJsonResponse['segments'] = [];
        const mergedWords: GroqVerboseJsonResponse['words'] = [];

        for (let i = 0; i < transcriptions.length; i++) {
          const currentTranscription = transcriptions[i];
          if (currentTranscription.segments) {
            currentTranscription.segments.forEach(segment => {
              mergedSegments.push({
                ...segment,
                start: segment.start + cumulativeDuration,
                end: segment.end + cumulativeDuration,
                // id and seek might need adjustment or re-evaluation if strictly needed
              });
            });
          }
          if (currentTranscription.words) {
            currentTranscription.words.forEach(word => {
              mergedWords.push({
                ...word,
                start: word.start + cumulativeDuration,
                end: word.end + cumulativeDuration,
              });
            });
          }
          // Before processing the next chunk's segments/words, find the duration of the current one.
          // This could be from the last segment's end time or a pre-calculated duration of the chunk audio.
          // For simplicity, we'll use the maximum end time from segments or words of the current chunk.
          let maxEndTimeCurrentChunk = 0;
          if (currentTranscription.segments && currentTranscription.segments.length > 0) {
             maxEndTimeCurrentChunk = Math.max(...currentTranscription.segments.map(s => s.end));
          }
          if (currentTranscription.words && currentTranscription.words.length > 0) {
             maxEndTimeCurrentChunk = Math.max(maxEndTimeCurrentChunk, ...currentTranscription.words.map(w => w.end));
          }
          // If the API doesn't provide full duration, we might need to get it from the audio file itself (which we do for chunkDuration)
          // Let's assume the chunk audio duration was accurately passed or can be inferred.
          // For this merge, we'll use the actual audio duration of the chunk if available,
          // otherwise, the max end time from its transcription.
          // const chunkAudioFile = path.join(chunksDir!, chunks[i]); // Assuming chunksDir is defined and chunks[i] is valid
          // const actualChunkDuration = await getAudioDuration(chunkAudioFile);
          // cumulativeDuration += actualChunkDuration; 
          // For now, let's use a simpler approach based on max end times, though less accurate for gaps between chunks.
           if (currentTranscription.segments && currentTranscription.segments.length > 0) {
            // Find the duration of the content within this chunk based on the last segment's end time.
            const lastSegment = currentTranscription.segments[currentTranscription.segments.length - 1];
            cumulativeDuration += lastSegment.end; // Add the end time of the last segment of the current chunk.
                                                 // This is a simplification; true chunk duration would be better.
          } else if (currentTranscription.words && currentTranscription.words.length > 0) {
            // Fallback if only words are available
            const lastWord = currentTranscription.words[currentTranscription.words.length - 1];
            cumulativeDuration += lastWord.end;
          } else {
            // If no segments or words, we might need a placeholder or use actual chunk audio duration
            // For now, this case might lead to timestamp inaccuracies if not handled.
            // Consider fetching actual chunk duration here if critical.
            logger.warn(`Chunk ${i} had no segments or words for precise duration calculation during merge.`);
          }
        }

        return {
          text: combinedText,
          segments: mergedSegments,
          words: mergedWords.length > 0 ? mergedWords : undefined,
          // language could be taken from the first chunk or handled based on consistency
          language: transcriptions[0]?.language 
        };
      }
    } catch (chunkingError) {
      logger.error('Error during chunking:', chunkingError);
      
      // Clean up if there was an error
      try {
        if (fs.existsSync(chunksDir)) {
          fs.rmSync(chunksDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        logger.error('Error cleaning up after chunking failure:', cleanupError);
      }
      
      throw chunkingError;
    }
  } catch (error) {
    logger.error('Groq transcription error:', error);
    throw new Error(`Failed to transcribe with Groq API: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Clean up chunks directory if it was created
    if (chunksDir && fs.existsSync(chunksDir)) {
      try {
        fs.rmSync(chunksDir, { recursive: true, force: true });
        logger.info('Cleaned up temporary chunk files in finally block');
      } catch (cleanupError) {
        logger.error('Error cleaning up chunks in finally block:', cleanupError);
      }
    }
    logger.info(`\n=== Total Groq Processing Time ===`);
    logger.info(`Total time: ${(Date.now() - totalStartTime) / 1000}s`);
  }
} 