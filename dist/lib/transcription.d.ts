/**
 * Transcribes audio using the local Whisper CLI.
 * Saves the output to a .txt file in the tmp directory.
 * Returns the full path to the generated .txt file.
 */
export declare function transcribeAudio(audioPath: string): Promise<string>;
