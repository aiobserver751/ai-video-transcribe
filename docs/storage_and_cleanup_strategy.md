# Storage, Temporary Files, and Security Strategy

This document outlines the storage strategy for transcription outputs, the management of temporary files, and the current file access security policy for the AI Video Transcribe application.

## 1. Environment-Dependent Storage Strategy

The application employs an environment-dependent storage strategy to facilitate local development and robust cloud deployment:

*   **Development Environment (`NODE_ENV !== 'production'`)**:
    *   **Storage Type**: Local file system.
    *   **Configuration**:
        *   Primarily configured via the `LOCAL_STORAGE_PATH` environment variable. If set, this path is used as the root for storing all output files.
        *   If `LOCAL_STORAGE_PATH` is not set, it defaults to a `./local_storage_uploads` directory relative to the project's current working directory.
    *   **Implementation**: The `lib/storageService.ts` handles operations. If S3 is not configured (i.e., necessary S3 environment variables are missing), it falls back to using the local file system. The `lib/s3Client.ts` will log a warning if S3 variables are missing in a non-production environment.

*   **Production Environment (`NODE_ENV === 'production'`)**:
    *   **Storage Type**: S3-compatible object storage.
    *   **Configuration**:
        *   Requires the following environment variables to be set:
            *   `S3_ENDPOINT_URL`: The S3 API endpoint.
            *   `S3_BUCKET_NAME`: The name of the S3 bucket.
            *   `S3_ACCESS_KEY`: The S3 access key ID.
            *   `S3_SECRET_KEY`: The S3 secret access key.
            *   `S3_REGION`: The S3 bucket region.
        *   `forcePathStyle` for the S3 client is automatically determined based on the `S3_ENDPOINT_URL` (enabled for non-AWS/DigitalOcean endpoints).
    *   **Implementation**:
        *   `lib/s3Client.ts`: Initializes the S3 client. If any of the required S3 environment variables are missing in production, this module will log a critical error and **throw an exception, preventing the application from starting**. This ensures the application does not run with a misconfigured production storage backend.
        *   `lib/storageService.ts`: Uses the initialized S3 client for all file operations (save, read, delete, check existence, get URL). It does **not** fall back to local storage in production if S3 is misconfigured; an error will have already been thrown by `s3Client.ts`.

## 2. Temporary File Management and Cleanup

During the transcription process, temporary files are generated. A robust cleanup strategy is in place:

*   **Job-Specific Temporary Directory**:
    *   For each transcription job, a unique temporary directory is created on the local file system where the worker process runs.
    *   Path: `tmp/<JOB_ID>/` (e.g., `tmp/transcription-1678886400000-123/`).

*   **Types of Temporary Files**:
    1.  **Downloaded Audio**: If the input URL is remote (e.g., HTTP/HTTPS), the audio file is first downloaded into this job-specific temporary directory.
    2.  **Local Whisper CLI Outputs**: When using the "standard" quality transcription (which utilizes the local Whisper CLI via `lib/transcription.ts`), the Whisper CLI generates its output files (e.g., `.txt`, `.srt`, `.vtt`) directly into a subdirectory within the job-specific temp directory: `tmp/<JOB_ID>/whisper_output/`.

*   **Cleanup Process**:
    *   Implemented within the `finally` block of the BullMQ worker process in `lib/queue/transcription-queue.ts`. This ensures cleanup attempts occur regardless of job success or failure.
    *   **Individual File Deletion**:
        *   A list (`filesToCleanUp`) tracks all temporary files that need deletion (downloaded audio, original Whisper CLI output files after their content has been processed and saved to permanent storage).
        *   Each file in this list is explicitly deleted using `fs.promises.unlink()`.
    *   **Directory Deletion**:
        *   After individual files are deleted, the job-specific temporary directory (`tmp/<JOB_ID>/`) is removed using `fs.rmdirSync()`.
        *   **Condition**: The directory is only removed if it is empty. This is a safety measure to prevent accidental deletion if any unexpected files remain.

## 3. Transcription File Locations and Flow

The final transcription output files (TXT, SRT, VTT) are stored in a standardized location, regardless of the transcription quality/method used.

*   **Final Storage Location (S3 or Local System)**:
    *   All final output files are stored using the `storageService`.
    *   **Path Convention**: `users/<USER_ID>/jobs/<JOB_ID>/<FILENAME>.<EXTENSION>`
        *   `<USER_ID>`: The ID of the user who initiated the job.
        *   `<JOB_ID>`: The unique ID of the transcription job.
        *   `<FILENAME>`: Derived from the original input file's name (or a default like `transcription_<JOB_ID>`) and further suffixed with `_jobId` to ensure uniqueness and association. For example, `originalVideoName_transcription-123xyz.txt`.
        *   `<EXTENSION>`: `.txt`, `.srt`, or `.vtt`.
    *   The `saveContentToFile` helper function within `lib/queue/transcription-queue.ts` is responsible for constructing this path and using `storageService` to save the content.

*   **File Flow by Quality Setting**:

    *   **Groq Path (e.g., `quality: 'premium'` or `quality: 'caption_first'` without summary)**:
        1.  Audio is downloaded locally to `tmp/<JOB_ID>/` if remote.
        2.  `transcribeAudioWithGroq()` is called with the local audio path. It processes the audio and returns a JSON object containing transcription segments in memory.
        3.  Plain text, SRT, and VTT content are generated from this JSON data.
        4.  This content is directly passed to `saveContentToFile`, which uses `storageService.saveFile()` to write to the final storage path (e.g., `users/.../.../filename.txt`). No intermediate Whisper CLI files are created on disk for this path.

    *   **Standard Whisper Path (e.g., `quality: 'standard'` or fallback from Groq)**:
        1.  Audio is downloaded locally to `tmp/<JOB_ID>/` if remote.
        2.  `lib/transcription.ts` (`transcribeAudio` function) is called.
        3.  This function executes the local Whisper CLI, configured to output its `.txt`, `.srt`, and `.vtt` files into the `tmp/<JOB_ID>/whisper_output/` directory.
        4.  The content of these generated files (e.g., `tmp/<JOB_ID>/whisper_output/audio.txt`) is read into memory.
        5.  This content is then passed to `saveContentToFile`, which uses `storageService.saveFile()` to write to the final storage path (e.g., `users/.../.../filename.txt`).
        6.  The original Whisper output files in `tmp/<JOB_ID>/whisper_output/` are added to the `filesToCleanUp` list and deleted during the cleanup phase.

## 4. Current File Access Security Policy (Public URLs)

The current method for accessing stored transcription files via URLs is as follows:

*   **S3 Storage**:
    *   When a file URL is requested (e.g., for database storage or API responses), the `storageService.getFileUrl()` method constructs a direct HTTP URL to the object in S3.
    *   **This assumes that the S3 bucket and the objects within it are configured to allow public read access.** This could be via public ACLs on objects or a public read bucket policy.
    *   Example URL formats:
        *   `https://<BUCKET_NAME>.<REGION>.digitaloceanspaces.com/<KEY>`
        *   `https://<BUCKET_NAME>.s3.<REGION>.amazonaws.com/<KEY>`
        *   Or a custom format if `S3_ENDPOINT_URL` already includes the bucket (e.g., for MinIO).
    *   **Implication**: If these URLs are known, anyone can access the files directly without authentication to the application, as long as the S3 permissions allow public access.

*   **Local Storage (Development)**:
    *   `storageService.getFileUrl()` returns a `file://` URI (e.g., `file:///path/to/your/project/local_storage_uploads/users/.../file.txt`).
    *   These URIs are generally only accessible on the local machine where the server is running. They are **not directly web-accessible** by a client's browser over HTTP/HTTPS without additional setup (e.g., a dedicated static file serving route in the application).

## 5. Future Security Enhancements: Presigned URLs

For enhanced security, especially for sensitive transcription data, a future update should consider implementing S3 presigned URLs.

*   **Concept**: Presigned URLs grant temporary, time-limited access to specific private objects in S3. The object itself remains private, and access is granted via a unique, signed URL that automatically expires.
*   **Implementation Impact**:
    *   The `storageService.getFileUrl()` method would need to be modified. Instead of constructing a static URL, it would use the AWS SDK's `getSignedUrl` function (from `@aws-sdk/s3-request-presigner`) to generate a presigned URL for the requested S3 object (key).
    *   An expiration time (e.g., 15 minutes, 1 hour, up to a maximum of 7 days for IAM user credentials or up to 12 hours for IAM role temporary credentials) would be specified during generation.
*   **Benefits**:
    *   S3 objects can be kept private by default, significantly improving security.
    *   Access is controlled and time-bound.
*   **Considerations**:
    *   The application (including frontend clients or API consumers) would need to handle the fact that these URLs expire. This might involve requesting fresh URLs when needed.
    *   Callback mechanisms using these URLs must ensure the recipient processes the file before the URL expires.

This approach would align with best practices for securing access to potentially sensitive user-generated content in cloud storage. 