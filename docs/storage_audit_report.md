# Storage Service Architecture Audit Report

## Executive Summary

This audit identified several violations of the centralized storage service architecture, where components were bypassing the `storageService` and implementing their own file operations. The main issues were inconsistent usage patterns and missing abstractions for temporary file operations.

## Issues Found

### 🚨 Critical Issues

#### 1. Docker Configuration Conflict
**File**: `docker-compose.yml`
**Issue**: Hardcoded volume mount `- ./tmp:/app/tmp` conflicts with production temp directory strategy
**Impact**: Production containers would try to write to `/app/tmp` but our `getTmpPath()` uses system temp `/tmp`
**Status**: ✅ **FIXED** - Removed conflicting volume mount

#### 2. Inconsistent Temporary File Handling
**Files**: Multiple files doing direct `fs` operations instead of using storage service
**Issue**: No centralized temporary file management
**Impact**: Inconsistent behavior, potential permission issues
**Status**: ✅ **FIXED** - Added temporary file methods to storage service

### ⚠️ Architecture Violations

#### 3. Rate Limit Tracker Direct File Operations
**File**: `lib/rate-limit-tracker.ts`
**Issue**: Direct `fs.writeFileSync()` and `fs.readFileSync()` operations
**Current Code**:
```typescript
fs.writeFileSync(config.trackingFilePath, JSON.stringify(data, null, 2));
const fileData = fs.readFileSync(config.trackingFilePath, 'utf-8');
```
**Status**: 🔄 **NEEDS REFACTORING** - Should use `storageService.saveTempFile()`

#### 4. Transcription Queue Direct File Operations
**File**: `lib/queue/transcription-queue.ts`
**Issue**: Multiple direct `fs` operations for temporary files
**Examples**:
```typescript
await fs.promises.writeFile(localFilePath, content, 'utf-8');
await fs.promises.readFile(whisperResult.txtPath, 'utf-8');
await fs.promises.unlink(file);
```
**Status**: 🔄 **NEEDS REFACTORING** - Should use storage service temp methods

#### 5. API Route Direct File Operations
**File**: `app/api/transcribe/route.ts`
**Issue**: Direct file operations for downloaded audio
**Examples**:
```typescript
fs.mkdirSync(tmpDir, { recursive: true });
fs.readFileSync(standardTranscriptionResult.txtPath, 'utf-8');
fs.unlinkSync(audioPath);
```
**Status**: 🔄 **NEEDS REFACTORING** - Should use storage service temp methods

#### 6. Whisper Transcription Direct File Operations
**File**: `lib/transcription.ts`
**Issue**: Direct file operations for Whisper CLI outputs
**Examples**:
```typescript
fs.mkdirSync(outputDir, { recursive: true });
fs.existsSync(txtOutputPath);
fs.unlinkSync(filePath);
```
**Status**: 🔄 **NEEDS REFACTORING** - Should use storage service temp methods

#### 7. Groq Transcription Direct File Operations
**File**: `lib/groq-transcription.ts`
**Issue**: Direct file operations for chunk processing
**Examples**:
```typescript
fs.createReadStream(chunkPath);
fs.existsSync(audioPath);
fs.rmSync(chunksDir, { recursive: true, force: true });
```
**Status**: 🔄 **NEEDS REFACTORING** - Should use storage service temp methods

### ✅ Acceptable Patterns

#### 8. OpenAI Service Prompt Template Access
**File**: `server/services/openaiService.ts`
**Issue**: Direct `fs.readFile()` for prompt templates
**Assessment**: **ACCEPTABLE** - These are static application assets, not user data
**Reason**: Prompt templates are bundled with the application and don't need environment-aware storage

## Solutions Implemented

### ✅ Extended Storage Service
Added comprehensive temporary file management methods to `lib/storageService.ts`:

- `saveTempFile(content, filePath)` - Save temporary files
- `readTempFile(filePath)` - Read temporary files  
- `deleteTempFile(filePath)` - Delete temporary files
- `tempFileExists(filePath)` - Check temporary file existence
- `getTempFilePath(filePath)` - Get full path to temporary file
- `createTempDir(dirPath)` - Create temporary directories

### ✅ Fixed Docker Configuration
Removed conflicting volume mount from `docker-compose.yml` that was mapping `./tmp:/app/tmp`.

## Recommended Action Plan

### Phase 1: High Priority Refactoring

1. **Rate Limit Tracker** (`lib/rate-limit-tracker.ts`)
   - Replace `fs.writeFileSync()` with `storageService.saveTempFile()`
   - Replace `fs.readFileSync()` with `storageService.readTempFile()`

2. **API Route** (`app/api/transcribe/route.ts`)
   - Replace `fs.mkdirSync()` with `storageService.createTempDir()`
   - Replace `fs.readFileSync()` with `storageService.readTempFile()`
   - Replace `fs.unlinkSync()` with `storageService.deleteTempFile()`

### Phase 2: Medium Priority Refactoring

3. **Transcription Queue** (`lib/queue/transcription-queue.ts`)
   - Replace direct file operations with storage service methods
   - Consolidate temporary file management

4. **Whisper Transcription** (`lib/transcription.ts`)
   - Replace direct file operations with storage service methods
   - Use `storageService.createTempDir()` for output directories

5. **Groq Transcription** (`lib/groq-transcription.ts`)
   - Replace direct file operations with storage service methods
   - Use storage service for chunk management

### Phase 3: Architecture Enforcement

6. **Add Linting Rules**
   - Create ESLint rules to prevent direct `fs` imports outside of storage service
   - Add pre-commit hooks to catch violations

7. **Update Documentation**
   - Update all documentation to reflect centralized storage patterns
   - Create developer guidelines for file operations

## Architecture Guidelines

### ✅ Correct Patterns

```typescript
// For persistent files (user data)
await storageService.saveFile(content, 'users/123/file.txt');
const content = await storageService.readFile('users/123/file.txt');

// For temporary files (processing)
await storageService.saveTempFile(content, 'job123/audio.mp3');
const content = await storageService.readTempFile('job123/audio.mp3');
```

### ❌ Incorrect Patterns

```typescript
// DON'T: Direct fs operations
fs.writeFileSync('/tmp/file.txt', content);
fs.readFileSync('/tmp/file.txt');

// DON'T: Hardcoded paths
const tmpDir = path.join(process.cwd(), 'tmp');
```

## Benefits of Centralized Storage

1. **Environment Consistency**: Same code works in development and production
2. **Permission Handling**: Centralized logic for writable directories
3. **Error Handling**: Consistent error handling and logging
4. **Maintenance**: Single place to update storage logic
5. **Testing**: Easier to mock and test file operations

## Conclusion

The storage service architecture is sound, but adoption was inconsistent across the codebase. With the fixes implemented and the refactoring plan above, the application will have a robust, centralized storage system that works reliably across all environments.

**Priority**: Complete Phase 1 refactoring immediately to prevent production issues.
**Timeline**: Phase 1 (1-2 days), Phase 2 (3-5 days), Phase 3 (1 week) 