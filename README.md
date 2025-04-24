# AI Video Transcription Service

This application provides a video transcription service with two quality options:
- **Standard**: Uses open-source Whisper for basic transcription
- **Premium**: Uses Groq API for higher-quality, faster transcription

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env.local` file in the root directory with your Groq API key and rate limit configuration:
   ```
   # API Keys
   GROQ_API_KEY=your_api_key_here
   
   # Rate Limit Configuration (optional - defaults shown below)
   GROQ_TIER=free
   GROQ_WHISPER_ASH=7200  # Audio seconds per hour
   GROQ_WHISPER_ASD=28800  # Audio seconds per day
   ```
4. Make sure you have FFmpeg and yt-dlp installed on your system for video processing.

## Running the Application

1. Start the development server:
   ```
   npm run dev
   ```
2. Access the application at `http://localhost:3000`

## Using the API

The application provides an API endpoint for transcribing YouTube videos:

```
POST /api/transcribe
```

### Required Headers:

```
Content-Type: application/json
API_KEY: your_api_key_here
```

### Request Parameters:

```json
{
  "url": "https://www.youtube.com/watch?v=example",
  "quality": "standard" | "premium",
  "fallbackOnRateLimit": true | false
}
```

- `url`: The YouTube video URL to transcribe (required)
- `quality`: The transcription quality (optional, defaults to "standard")
  - `standard`: Uses open-source Whisper for transcription
  - `premium`: Uses Groq API for higher-quality transcription
- `fallbackOnRateLimit`: Whether to automatically fall back to standard quality if Groq API rate limits are encountered (optional, defaults to true)

### Response:

```json
{
  "transcription": "The transcribed text...",
  "quality": "premium" | "standard",
  "status_code": 200,
  "status_message": "Success"
}
```

The `quality` field in the response indicates which transcription engine was actually used, which may differ from the requested quality if a fallback occurred.

### Error Responses:

All responses include `status_code` and `status_message` fields:

```json
{
  "error": "Error message",
  "details": "More specific error information",
  "status_code": 400,
  "status_message": "Bad Request"
}
```

### Status Codes:

| Status Code | Status Message | Description |
|-------------|----------------|-------------|
| 200 | Success | Request completed successfully |
| 400 | Bad Request | Invalid JSON payload, missing required fields, or invalid media URL |
| 401 | Unauthorized | Invalid or missing API Key |
| 429 | Too Many Requests | Queue is full or rate limits exceeded |
| 500 | Internal Server Error | Processing error or server failure |

Possible error scenarios:
- Missing or invalid Content-Type header (400 Bad Request)
- Missing API_KEY header (401 Unauthorized)
- Missing URL parameter (400 Bad Request)
- Invalid YouTube URL (400 Bad Request)
- Processing failure (500 Internal Server Error)
- Rate limit exceeded (429 Too Many Requests)

## Features

- Dual transcription engine with quality selection
- Automatic fallback to standard quality when Groq API rate limits are encountered
- Rate limit detection and handling for premium transcriptions
- Audio chunking for handling longer videos
- Supports videos from YouTube
- Simple API for integration with other applications
- Basic API authentication with API key validation

## Rate Limit Handling

The Groq API has rate limits on audio transcription (seconds of audio per hour). The service handles these limitations by:

1. Using smaller chunk sizes (2 minutes) to better manage rate limits
2. Implementing an automatic retry mechanism with appropriate delays
3. Providing a fallback option to switch to standard transcription when rate limits are encountered
4. Adding delays between chunk processing to avoid hitting rate limits
5. Local rate limit tracking to predict and avoid rate limit errors proactively

### Rate Limit Configuration

The application includes a sophisticated rate limit tracking system that keeps track of your Groq API usage and helps avoid rate limit errors. The system:

- Tracks audio seconds used per hour and per day
- Auto-resets counters after the appropriate time windows
- Checks if enough capacity remains before making API calls
- Updates tracking data based on rate limit errors from Groq
- Provides detailed usage statistics and warnings

You can configure the rate limits through environment variables:

```
GROQ_TIER=free|developer         # Your Groq tier
GROQ_WHISPER_ASH=7200            # Audio seconds per hour limit
GROQ_WHISPER_ASD=28800           # Audio seconds per day limit
```

The tracking system helps prevent rate limit errors by:
1. Predicting if a transcription would exceed your limits before attempting it
2. Providing estimated wait times when limits would be exceeded
3. Learning from rate limit responses to keep accurate usage tracking

You can disable the automatic fallback by setting `fallbackOnRateLimit: false` in your request.
