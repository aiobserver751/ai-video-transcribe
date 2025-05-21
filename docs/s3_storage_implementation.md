# S3 Storage Implementation

This document outlines the implementation of S3 cloud-based storage for transcription files on DigitalOcean Spaces. It explains how the application handles storage in both development and production environments, as well as maintenance and cleanup practices for temporary files.

## Architecture Overview

The storage system is designed with environment-specific behavior:

- **Development Mode**: Files are stored locally in a directory defined by `LOCAL_STORAGE_PATH` environment variable.
- **Production Mode**: Files are stored in DigitalOcean Spaces (S3-compatible) cloud storage.

The implementation follows a seamless integration approach, where the storage mechanism is completely abstracted from the business logic.

## Components

### 1. S3 Client (`lib/s3Client.ts`)

This module handles the configuration and initialization of the AWS S3 client for DigitalOcean Spaces:

- **Environment Validation**: Checks if required environment variables are set.
- **Client Configuration**: Sets up the S3 client with appropriate options for DigitalOcean Spaces.
- **Error Handling**: Throws errors in production if required configuration is missing.

```typescript
// Environment variables required in production
S3_ENDPOINT_URL=https://your-region.digitaloceanspaces.com
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name
S3_REGION=your-region
```

### 2. Storage Service (`lib/storageService.ts`)

This service provides a unified interface for file operations in both environments:

- **Environment Detection**: Uses `NODE_ENV === 'production'` to determine the storage mode.
- **Unified API**: Offers a consistent API regardless of environment, including:
  - `saveFile(content, path)`: Saves content to the specified path
  - `readFile(path)`: Reads file content
  - `deleteFile(path)`: Removes a file
  - `fileExists(path)`: Checks if a file exists
  - `getFileUrl(path)`: Generates URLs for file access
  - `streamFile(path, writeStream)`: Streams file content to a writable stream

### 3. Transcription Queue Integration

The transcription queue (`lib/queue/transcription-queue.ts`) uses the storage service to:

- Save transcription output files (TXT, SRT, VTT)
- Generate public URLs for file access
- Maintain temporary files for processing

## File Organization

### Storage Paths

All files, both user files and temporary files, are stored under the `LOCAL_STORAGE_PATH` directory in development mode and in S3 buckets in production mode. The `LOCAL_STORAGE_PATH` value is always taken from the environment variable in development mode, with a default fallback if not specified.

User files are organized in a structured way:

```
LOCAL_STORAGE_PATH/users/<USER_ID>/jobs/<JOB_ID>/<FILENAME>.<EXTENSION>
```

Where:
- `<USER_ID>`: The ID of the user who initiated the job
- `<JOB_ID>`: The unique job identifier
- `<FILENAME>`: Derived from the original input name with appropriate suffixes
- `<EXTENSION>`: File type (txt, srt, vtt)

### Temporary Files

Temporary files are stored in:

```
LOCAL_STORAGE_PATH/tmp/<JOB_ID>/
```

These files are used during processing (especially for the Whisper CLI) and are cleaned up after the job completes in production mode. Note that both user files and temporary files share the same parent directory specified by `LOCAL_STORAGE_PATH`.

## URL Generation

The system generates different types of URLs based on the environment:

- **Development**: `file://` URLs pointing to local files
- **Production**: Direct HTTP URLs to DigitalOcean Spaces objects:
  - Format: `https://<BUCKET_NAME>.digitaloceanspaces.com/<PATH>`

All URLs are public, allowing direct access without authentication or expiration.

## Environment Setup

### Development Environment

1. Set the `LOCAL_STORAGE_PATH` environment variable to specify where all files (user files and temporary files) should be stored locally.
2. If `LOCAL_STORAGE_PATH` is not set, it defaults to a directory called `tmp` in the project's current working directory.
3. No S3 configuration is required, but can be provided for testing S3 functionality.

```
NODE_ENV=development
LOCAL_STORAGE_PATH=/path/to/storage
```

With this setup, the following directories will be created:
- `/path/to/storage/users/` - For user files
- `/path/to/storage/tmp/` - For temporary files

### Production Environment

All S3 environment variables must be configured:

```
NODE_ENV=production
S3_ENDPOINT_URL=https://your-region.digitaloceanspaces.com
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name
S3_REGION=your-region
```

## Maintenance and Cleanup

### Temporary Files

- **Production**: Temporary files in `tmp/<JOB_ID>/` are automatically deleted after job completion.
- **Development**: Temporary files are preserved for debugging purposes.

### Orphaned Files

To prevent storage leaks, consider implementing:

1. A periodic cleanup job to remove temporary files older than a certain threshold.
2. A garbage collection process for orphaned files in the S3 bucket.

### Monitoring

Monitor S3 usage and implement alerts for:
- Storage capacity thresholds
- Error rates in S3 operations
- Cost anomalies

## Security Considerations

- All URLs generated are public. Ensure no sensitive information is included in file content.
- The S3 bucket should have appropriate CORS settings if files need to be directly accessed from browsers.
- Consider implementing a more secure approach with signed URLs for sensitive content in the future.

## Implementation Notes

- The storage service is implemented as a singleton to ensure consistent configuration.
- All file operations are wrapped in try/catch blocks with appropriate error logging.
- File paths are normalized for both local and S3 storage.
- The system maintains backward compatibility with existing code by preserving local file access patterns. 