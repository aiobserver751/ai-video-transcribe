import { logger } from './logger.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const statAsync = promisify(fs.stat);

// Defined but flagged as unused by linter previously.
// Keeping it as fs.mkdirSync is used later, indicating intent.
const mkdirAsync = promisify(fs.mkdir);

const MAX_FILE_SIZE_MB = 25; // Example constant, ensure it's used if needed elsewhere or remove.

async function getFileSizeMB(filePath: string): Promise<number> {
  // Ensure statAsync is used if needed, otherwise remove if getFileSizeMB is unused.
  // Currently getFileSizeMB is not called within this file after removing compressAudio/transcribeChunk.
  // Consider removing getFileSizeMB and statAsync if truly unused now.
  const stats = await statAsync(filePath);
  return stats.size / (1024 * 1024);
}

/**
 * Transcribes audio using the local Whisper CLI.
 * Saves the output to a .txt file in the tmp directory.
 * Returns the full path to the generated .txt file.
 */
export async function transcribeAudio(audioPath: string): Promise<string> {
  const totalStartTime = Date.now();
  const outputDir = path.join(process.cwd(), 'tmp');
  // Determine the base output filename from the input audio path
  const inputBasename = path.basename(audioPath, path.extname(audioPath));
  // Whisper CLI creates output based on input name + format extension
  const outputTxtFilename = `${inputBasename}.txt`;
  const outputPath = path.join(outputDir, outputTxtFilename);

  try {
    logger.info(`Starting standard Whisper transcription for ${audioPath}`);
    logger.info(`Output will be saved to: ${outputPath}`);

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      // Using fs.mkdirSync as it was used before.
      fs.mkdirSync(outputDir, { recursive: true });
      logger.info(`Created output directory: ${outputDir}`);
    }

    // Construct the whisper command to only output txt
    // Using --model base. Adjust model as needed (e.g., tiny, small, medium, large).
    // Added --language English for consistency. Remove if language detection is desired.
    const command = `whisper "${audioPath}" --model base --language English --output_dir "${outputDir}" --output_format txt`;
    logger.info(`Executing Whisper command: ${command}`);
    await execAsync(command);

    // Verify the output file was created
    if (!fs.existsSync(outputPath)) {
      logger.error(`Whisper command finished but output file not found: ${outputPath}`);
      // Attempt to list files in outputDir for debugging
      try {
        const files = fs.readdirSync(outputDir);
        logger.debug(`Files in ${outputDir}: ${files.join(', ')}`);
      } catch (readErr) {
        logger.error(`Could not read directory ${outputDir}: ${readErr}`);
      }
      throw new Error(`Whisper transcription failed to produce output file: ${outputTxtFilename}`);
    }

    logger.info(`Transcription file created successfully: ${outputPath}`);
    // Return the path to the created file
    return outputPath;

  } catch (error) {
    logger.error('Standard Whisper transcription error:', error);
    // Attempt to clean up the potentially created (but maybe incomplete) output file if it exists on error
    if (fs.existsSync(outputPath)) {
      try {
        logger.warn(`Cleaning up potentially incomplete file due to error: ${outputPath}`);
        fs.unlinkSync(outputPath);
      } catch (cleanupError) {
        logger.warn(`Failed to clean up transcription file on error: ${cleanupError}`);
      }
    }
    throw error; // Re-throw the original error
  } finally {
    logger.info(`
=== Total Standard Whisper Processing Time ===`);
    logger.info(`Total time: ${(Date.now() - totalStartTime) / 1000}s`);
  }
}
