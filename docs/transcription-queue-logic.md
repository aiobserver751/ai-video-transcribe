# Transcription Queue Business Logic Documentation

This document outlines the core business logic flow implemented in `lib/queue/transcription-queue.ts`. Understanding this flow is essential for implementing storage service changes without disrupting the existing functionality.

## 1. Job Data Structures

### TranscriptionJobData

The main input data structure for transcription jobs:

```typescript
interface TranscriptionJobData {
  url: string;                     // URL of the video to transcribe
  quality: 'standard' | 'premium' | 'caption_first'; // Transcription quality
  jobId: string;                   // Unique job identifier
  userId: string;                  // User who initiated the job
  fallbackOnRateLimit?: boolean;   // Whether to fall back to standard if premium hits rate limits
  callback_url?: string;           // Optional URL for job completion callback
  fileName?: string;               // Original file name for saving outputs
  baseFileName?: string;           // Base name for consistency in output files
  apiKey?: string;                 // For API-originated jobs
  response_format?: 'plain_text' | 'url' | 'verbose'; // Callback response format
  summary_type?: 'none' | 'basic' | 'extended'; // Type of summary to generate
}
```

### TranscriptionResult

The output data structure:

```typescript
interface TranscriptionResult {
  transcription: string;           // Transcript/caption content
  quality: string;                 // Quality actually used (may differ due to fallback)
  jobId: string;                   // Job identifier
  filePath?: string;               // URL to final text file (primary transcription_file_url)
  srtFileUrl?: string;             // URL to SRT file
  vttFileUrl?: string;             // URL to VTT file
  srtFileText?: string;            // Content of SRT file
  vttFileText?: string;            // Content of VTT file
  basicSummary?: string;           // Basic summary content
  extendedSummary?: string;        // Extended summary content
  error?: string;                  // Error message if any
  callback_success?: boolean;      // Whether callback was successful
  callback_error?: string;         // Callback error message if any
}
```

## 2. Processing Pipeline

The main worker process follows this general flow:

### 2.1. Initialization
1. Environment detection (`isProduction = process.env.NODE_ENV === 'production'`)
2. Job-specific variables setup (paths, temporary directories, etc.)
3. Video platform detection (YouTube, TikTok, Instagram, etc.)

### 2.2. Processing by Quality Type

#### For 'caption_first' (YouTube only)
1. Verify the platform is YouTube
2. Calculate and deduct credits (fixed cost)
3. Download subtitles using yt-dlp:
   - Attempt to get/convert to SRT format
   - If SRT fails, attempt to get native VTT format
4. Extract plain text from subtitles
5. Save plain text to a file
6. Set URLs for output files

#### For 'standard' or 'premium'
1. Download audio using yt-dlp
2. Determine video length using ffprobe
3. Calculate and deduct credits based on video length
4. Transcribe audio:
   - For 'premium' - use Groq API via `transcribeAudioWithGroq()`
   - For 'standard' - use local Whisper CLI via `transcribeAudio()`
   - If 'premium' fails and fallback is enabled, use 'standard' instead
5. Generate output files (TXT, SRT, VTT)
6. Set URLs for output files

### 2.3. Summary Generation (Optional)
1. If summary requested, deduct additional credits
2. Generate summary using OpenAI
3. Save summary content

### 2.4. Finalization and Cleanup
1. Update database with job results
2. Send callback if requested
3. Clean up temporary files (only in production)

## 3. File Handling

The file handling is a critical aspect of the transcription process:

### 3.1. Temporary Files
- Created in `tmp/<JOB_ID>/` directory
- Include downloaded audio and intermediate transcription outputs
- Currently only cleaned up in production mode

### 3.2. Storage Paths
- Files are stored with structured paths: `users/<USER_ID>/jobs/<JOB_ID>/<FILENAME>.<EXTENSION>`
- URLs are generated differently based on environment:
  - Development: `file://` URLs pointing to local files
  - Production: Currently using placeholder S3 URLs

### 3.3. File Generation
- `saveContentToFile()` function handles saving content to temporary files
- `uploadToS3()` is a placeholder function for S3 uploads in production
- Current workflow creates local files first, then (in production) would upload to S3

## 4. Critical Integration Points

These are key points that will need to be modified for S3 integration:

1. **`saveContentToFile()`** - Currently saves to local filesystem only
2. **`uploadToS3()`** - Currently a placeholder implementation
3. **URL Generation** - Currently uses hardcoded patterns for local (`file://`) and S3 URLs
4. **Cleanup Logic** - Currently only deletes local temporary files in production mode
5. **Path Construction** - Uses `path.join()` for local paths which may need adjustment for S3 keys

## 5. Dependencies

The transcription queue interacts with several other components:

1. **Transcription Services**:
   - `lib/transcription.ts` - Local Whisper transcription
   - `lib/groq-transcription.ts` - Premium Groq API transcription

2. **Database Services**:
   - Updates job status and results in the database

3. **Credit Services**:
   - Calculates and deducts credits for transcription and summaries

4. **External Utilities**:
   - yt-dlp for video/audio downloading
   - ffprobe for media duration analysis
   - Whisper CLI for transcription

Any changes to file storage must ensure these interactions remain functional. 