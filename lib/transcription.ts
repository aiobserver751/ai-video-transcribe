import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);
const statAsync = promisify(fs.stat);
const mkdirAsync = promisify(fs.mkdir);

const MAX_FILE_SIZE_MB = 25;
const COMPRESSION_THRESHOLD_MB = 30;

async function getFileSizeMB(filePath: string): Promise<number> {
  const stats = await statAsync(filePath);
  return stats.size / (1024 * 1024);
}

async function compressAudio(audioPath: string): Promise<boolean> {
  const startTime = Date.now();
  try {
    logger.info('Starting audio compression...');
    const originalSize = await getFileSizeMB(audioPath);
    logger.info(`Original audio size: ${originalSize.toFixed(2)}MB`);
    
    const compressedPath = `${audioPath}_compressed.mp3`;
    // Compress audio while maintaining reasonable quality
    await execAsync(`ffmpeg -i "${audioPath}" -codec:a libmp3lame -qscale:a 4 "${compressedPath}"`);
    
    // Check if compression worked
    const compressedSize = await getFileSizeMB(compressedPath);
    const reductionPercent = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
    logger.info(`Compressed size: ${compressedSize.toFixed(2)}MB (${reductionPercent}% reduction)`);
    
    if (compressedSize <= MAX_FILE_SIZE_MB) {
      // Use compressed file
      await unlinkAsync(audioPath);
      fs.renameSync(compressedPath, audioPath);
      logger.info(`Compression successful. Time taken: ${(Date.now() - startTime) / 1000}s`);
      return true;
    } else {
      // If compression didn't help enough, clean up
      await unlinkAsync(compressedPath);
      logger.info(`Compression not effective. Time taken: ${(Date.now() - startTime) / 1000}s`);
      return false;
    }
  } catch (error) {
    logger.error('Compression error:', error);
    return false;
  }
}

async function transcribeChunk(chunkPath: string): Promise<string> {
  const startTime = Date.now();
  try {
    const chunkSize = await getFileSizeMB(chunkPath);
    logger.info(`Starting transcription for chunk: ${path.basename(chunkPath)} (${chunkSize.toFixed(2)}MB)`);
    const command = `whisper "${chunkPath}" --model base --language English --output_dir "${path.dirname(chunkPath)}"`;
    await execAsync(command);
    
    // Read the transcription file
    const transcriptionPath = chunkPath.replace('.mp3', '.txt');
    const transcription = await readFileAsync(transcriptionPath, 'utf8');
    
    // Clean up all Whisper output files
    const basePath = chunkPath.replace('.mp3', '');
    const filesToClean = [
      `${basePath}.txt`,
      `${basePath}.vtt`,
      `${basePath}.srt`
    ];
    
    for (const file of filesToClean) {
      try {
        await unlinkAsync(file);
      } catch (error) {
        // Ignore errors if file doesn't exist
        logger.debug(`File ${file} not found for cleanup: ${error}`);
      }
    }
    
    logger.info(`Chunk transcription completed. Time taken: ${(Date.now() - startTime) / 1000}s`);
    return transcription;
  } catch (error) {
    logger.error('Chunk transcription error:', error);
    throw new Error('Failed to transcribe chunk');
  }
}

function mergeTranscriptions(transcriptions: string[]): string {
  const startTime = Date.now();
  const result = transcriptions.map((text, index) => {
    if (index === 0) return text;
    
    // Find overlap between chunks
    const previousEnd = transcriptions[index - 1].split(/[.!?]+/).slice(-2).join('. ');
    
    // Remove duplicate content
    if (text.includes(previousEnd)) {
      return text.replace(previousEnd, '');
    }
    return text;
  }).join(' ');
  
  logger.info(`Merged ${transcriptions.length} transcriptions. Time taken: ${(Date.now() - startTime) / 1000}s`);
  return result;
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  const totalStartTime = Date.now();
  try {
    // Check file size
    let fileSizeInMB = await getFileSizeMB(audioPath);
    let wasCompressed = false;
    
    logger.info(`\n=== Processing Audio File ===`);
    logger.info(`Original audio file size: ${fileSizeInMB.toFixed(2)}MB`);

    // Try compression if file is slightly over limit
    if (fileSizeInMB > MAX_FILE_SIZE_MB && fileSizeInMB < COMPRESSION_THRESHOLD_MB) {
      logger.info('\n=== Attempting Compression ===');
      const compressed = await compressAudio(audioPath);
      if (compressed) {
        // Compression was successful, get new file size
        fileSizeInMB = await getFileSizeMB(audioPath);
        wasCompressed = true;
        logger.info(`\n=== Processing Compressed File ===`);
        logger.info(`Compressed file size: ${fileSizeInMB.toFixed(2)}MB`);
      }
    }

    // Check if file is under the limit after possible compression
    if (fileSizeInMB <= MAX_FILE_SIZE_MB) {
      // If file is within size limit, transcribe directly
      logger.info(`\n=== Processing ${wasCompressed ? 'Compressed' : 'Single'} File ===`);
      return await transcribeChunk(audioPath);
    }

    // If file is still too large, proceed with chunking
    logger.info('\n=== Starting Chunking Process ===');
    // Create chunks directory
    const timestamp = Date.now();
    const chunksDir = path.join(process.cwd(), 'tmp', `chunks_${timestamp}`);
    await mkdirAsync(chunksDir);

    // Split on silence, minimum 1 second of silence
    const chunkStartTime = Date.now();
    logger.info('Splitting audio into chunks...');
    // First detect silence points
    const silenceDetectCmd = `ffmpeg -i "${audioPath}" -af silencedetect=noise=-30dB:d=1 -f null - 2>&1`;
    const silenceOutput = await execAsync(silenceDetectCmd);
    
    // Extract silence timestamps
    const silenceMatches = silenceOutput.stdout.match(/silence_start: (\d+\.\d+)/g);
    const silencePoints = silenceMatches ? silenceMatches.map(m => parseFloat(m.split(': ')[1])) : [];
    
    // Create segments based on silence points
    const segmentTimes = [];
    let currentTime = 0;
    for (const silencePoint of silencePoints) {
      if (silencePoint - currentTime >= 300) { // 5 minutes
        segmentTimes.push(silencePoint);
        currentTime = silencePoint;
      }
    }
    
    // Split the audio at silence points
    const segmentStr = segmentTimes.join(',');
    await execAsync(`ffmpeg -i "${audioPath}" -f segment -segment_times "${segmentStr}" -c copy "${chunksDir}/chunk_%03d.mp3"`);
    
    logger.info(`Chunking completed. Time taken: ${(Date.now() - chunkStartTime) / 1000}s`);

    // Process chunks
    const chunks = fs.readdirSync(chunksDir);
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
    
    logger.info('\n=== Starting Transcription ===');
    const transcriptions = [];

    for (const chunk of chunks) {
      const chunkPath = path.join(chunksDir, chunk);
      const transcription = await transcribeChunk(chunkPath);
      transcriptions.push(transcription);
    }

    // Clean up chunks directory
    fs.rmSync(chunksDir, { recursive: true, force: true });

    return mergeTranscriptions(transcriptions);
  } catch (error) {
    logger.error('Transcription error:', error);
    throw new Error('Failed to transcribe audio');
  } finally {
    logger.info(`\n=== Total Processing Time ===`);
    logger.info(`Total time: ${(Date.now() - totalStartTime) / 1000}s`);
  }
} 