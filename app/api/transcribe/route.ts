import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { transcribeAudio } from '@/lib/transcription';

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate YouTube URL
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    // Create unique filename for this request
    const timestamp = Date.now();
    const audioPath = path.join(process.cwd(), 'tmp', `audio_${timestamp}.mp3`);

    // Download audio directly using yt-dlp
    await execAsync(`yt-dlp -x --audio-format mp3 -o "${audioPath}" "${url}"`);

    // Transcribe the audio
    const transcription = await transcribeAudio(audioPath);

    // Clean up temporary files
    fs.unlinkSync(audioPath);

    return NextResponse.json({ transcription });
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to process video' },
      { status: 500 }
    );
  }
} 