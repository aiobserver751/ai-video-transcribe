import { logger } from './logger.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
// const statAsync = promisify(fs.stat); // No longer needed as getFileSizeMB is removed
// const mkdirAsync = promisify(fs.mkdir); // No longer needed as fs.mkdirSync is used

// Removed getFileSizeMB as it was unused.

/**
 * Transcribes audio using the local Whisper CLI.
 * Saves the output to .txt, .srt, and .vtt files in the tmp directory.
 * Returns an object with paths to the generated files.
 */
export async function transcribeAudio(audioPath: string): Promise<{ txtPath: string; srtPath: string; vttPath: string; }> {
  const totalStartTime = Date.now();
  const outputDir = path.join(process.cwd(), 'tmp');
  const inputBasename = path.basename(audioPath, path.extname(audioPath));
  
  const outputTxtFilename = `${inputBasename}.txt`;
  const outputSrtFilename = `${inputBasename}.srt`;
  const outputVttFilename = `${inputBasename}.vtt`;

  const txtOutputPath = path.join(outputDir, outputTxtFilename);
  const srtOutputPath = path.join(outputDir, outputSrtFilename);
  const vttOutputPath = path.join(outputDir, outputVttFilename);

  const filesToCleanOnError = [txtOutputPath, srtOutputPath, vttOutputPath];

  try {
    logger.info(`[Transcription] Starting standard Whisper transcription for ${audioPath}`);
    logger.info(`[Transcription] Output directory: ${outputDir}. Expected files: ${outputTxtFilename}, ${outputSrtFilename}, ${outputVttFilename}`);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      logger.info(`[Transcription] Created output directory: ${outputDir}`);
    }

    // Construct the whisper command to output txt, srt, and vtt
    const command = `whisper "${audioPath}" --model base --language English --output_dir "${outputDir}" --output_format all`;
    logger.info(`[Transcription] Executing Whisper command: ${command}`);
    await execAsync(command);

    // Verify all output files were created
    const allFilesCreated = fs.existsSync(txtOutputPath) && fs.existsSync(srtOutputPath) && fs.existsSync(vttOutputPath);

    if (!allFilesCreated) {
      logger.error(`[Transcription] Whisper command finished but one or more output files not found.`);
      logger.debug(`[Transcription] TXT exists: ${fs.existsSync(txtOutputPath)} at ${txtOutputPath}`);
      logger.debug(`[Transcription] SRT exists: ${fs.existsSync(srtOutputPath)} at ${srtOutputPath}`);
      logger.debug(`[Transcription] VTT exists: ${fs.existsSync(vttOutputPath)} at ${vttOutputPath}`);
      // Attempt to list files in outputDir for debugging
      try {
        const files = fs.readdirSync(outputDir);
        logger.debug(`[Transcription] Files in ${outputDir}: ${files.join(', ')}`);
      } catch (readErr: unknown) {
        logger.error(`[Transcription] Could not read directory ${outputDir}: ${readErr instanceof Error ? readErr.message : String(readErr)}`);
      }
      throw new Error(`Whisper transcription failed to produce one or more output files.`);
    }

    logger.info(`[Transcription] Transcription files created successfully: TXT: ${txtOutputPath}, SRT: ${srtOutputPath}, VTT: ${vttOutputPath}`);
    return {
      txtPath: txtOutputPath,
      srtPath: srtOutputPath,
      vttPath: vttOutputPath,
    };

  } catch (error) {
    logger.error('[Transcription] Standard Whisper transcription error:', error);
    for (const filePath of filesToCleanOnError) {
      if (fs.existsSync(filePath)) {
      try {
          logger.warn(`[Transcription] Cleaning up potentially incomplete file due to error: ${filePath}`);
          fs.unlinkSync(filePath);
        } catch (cleanupError: unknown) {
          logger.warn(`[Transcription] Failed to clean up file ${filePath} on error: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        }
      }
    }
    throw error; // Re-throw the original error
  } finally {
    logger.info(`[Transcription] Total time: ${(Date.now() - totalStartTime) / 1000}s`);
  }
}
