# AI Video Transcribe API Documentation 

This document provides instructions and examples for interacting with the AI Video Transcribe API.

## Authentication

All API requests must include an `API_KEY` in the request headers.

-   **Header:** `API_KEY`
-   **Value:** Your unique API key.

Additionally, the `Content-Type` header must be set to `application/json` for POST requests.

-   **Header:** `Content-Type`
-   **Value:** `application/json`

## Create Transcription Job

To submit a new video for transcription, make a POST request to the following endpoint.

-   **Endpoint:** `/api/transcribe/queue`
-   **Method:** `POST`

### Request Headers

| Header        | Value              | Required | Description                   |
| :------------ | :----------------- | :------- | :---------------------------- |
| `API_KEY`     | `your_api_key`     | Yes      | Your unique API key.          |
| `Content-Type`| `application/json` | Yes      | Specifies the request format. |

### Request Body Parameters

| Parameter             | Type    | Required | Default     | Description                                                                                                                               |
| :-------------------- | :------ | :------- | :---------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | string  | Yes      | N/A         | The publicly accessible URL of the video to be transcribed. For `caption_first` quality, this must be a YouTube video URL.                   |
| `quality`             | string  | Yes      | N/A         | Desired transcription quality. Valid values: `"standard"`, `"premium"`, `"caption_first"`.                                               |
| `callback_url`        | string  | No       | N/A         | An optional URL to which a POST request will be sent upon job completion or failure.                                                      |
| `response_format`     | string  | No       | `verbose`   | Determines the content of the `response` object in the callback. Valid values: `"verbose"`, `"url"`, `"plain_text"`.                      |
| `fallbackOnRateLimit` | boolean | No       | `true`      | If `true` and `quality` is `"premium"`, the system will attempt to fall back to `"standard"` quality if the premium service is rate-limited. |

### Example Request

```json
{
  "url": "https://www.youtube.com/watch?v=nCSBuArkqaM",
  "quality": "premium",
  "callback_url": "https://your-webhook-receiver.com/callback",
  "response_format": "verbose",
  "fallbackOnRateLimit": true
}
```

### Immediate Response (Successful Submission)

If the job is successfully submitted to the queue, the API will respond immediately with a `202 Accepted` status.

-   **Status Code:** `202 Accepted`

**Example Immediate Response Body:**

```json
{
    "status_code": "202",
    "status_message": "accepted",
    "job_id": "transcription-1747214370913-744",
    "quality": "premium"
}
```

| Field            | Type   | Description                                       |
| :--------------- | :----- | :------------------------------------------------ |
| `status_code`    | string | HTTP-like status code, "202" for accepted.       |
| `status_message` | string | A message indicating the status, e.g., "accepted". |
| `job_id`         | string | The unique identifier for the submitted job.      |
| `quality`        | string | The quality requested for the transcription job.  |

## Callback / Final Response

If a `callback_url` was provided in the request, a POST request containing the final job status and results will be sent to that URL once the transcription job is completed or if it fails.

Alternatively, you can poll the job status using the GET `/api/transcribe/queue?jobId={your_job_id}` endpoint (see API documentation for `GET /api/transcribe/queue`). The structure of the result object within a successful GET response mirrors the callback payload described below.

### Callback Payload Structure

| Field            | Type   | Description                                                                                                    |
| :--------------- | :----- | :------------------------------------------------------------------------------------------------------------- |
| `job_id`         | string | The unique identifier for the job.                                                                             |
| `status_code`    | number | HTTP status code reflecting the outcome (e.g., `200` for success, `500` for failure).                           |
| `status_message` | string | A message indicating the outcome, e.g., "success" or a description of the error if the job failed.             |
| `quality`        | string | The actual quality used for the transcription (could differ from requested if fallback occurred).              |
| `response`       | object | (Optional) Contains the transcription results. Its content depends on the `response_format` requested.         |
| `error`          | string | (Optional) A detailed error message if the job processing failed. Present if `status_code` indicates failure. |

### `response` Object (within Callback Payload)

The structure of the `response` object depends on the `response_format` parameter specified in the initial job request.

**1. `response_format: "verbose"` (Default)**

Includes all available URLs and text content.

```json
{
  "job_id": "transcription-1747214370913-744",
  "status_code": 200,
  "status_message": "success",
  "quality": "premium",
  "response": {
    "transcription_url": "file:///path/to/your_video_groq_timestamp.txt",
    "srt_url": "file:///path/to/your_video_groq_timestamp.srt",
    "vtt_url": "file:///path/to/your_video_groq_timestamp.vtt",
    "transcription_text": "This is the full plain text transcription...",
    "srt_text": "1\\n00:00:00,123 --> 00:00:02,456\\nHello world.\\n\\n2\\n...",
    "vtt_text": "WEBVTT\\n\\n00:00:00.123 --> 00:00:02.456\\nHello world.\\n\\n..."
  }
}
```

**2. `response_format: "url"`**

Includes only URLs to the transcription files.

```json
{
  "job_id": "transcription-1747214370913-744",
  "status_code": 200,
  "status_message": "success",
  "quality": "premium",
  "response": {
    "transcription_url": "file:///path/to/your_video_groq_timestamp.txt",
    "srt_url": "file:///path/to/your_video_groq_timestamp.srt",
    "vtt_url": "file:///path/to/your_video_groq_timestamp.vtt"
  }
}
```

**3. `response_format: "plain_text"`**

Includes only the text content of the transcriptions.

```json
{
  "job_id": "transcription-1747214370913-744",
  "status_code": 200,
  "status_message": "success",
  "quality": "premium",
  "response": {
    "transcription_text": "This is the full plain text transcription...",
    "srt_text": "1\\n00:00:00,123 --> 00:00:02,456\\nHello world.\\n\\n2\\n...",
    "vtt_text": "WEBVTT\\n\\n00:00:00.123 --> 00:00:02.456\\nHello world.\\n\\n..."
  }
}
```

**Fields within the `response` object:**

| Field                | Type   | Description                                         |
| :------------------- | :----- | :-------------------------------------------------- |
| `transcription_url`  | string | URL to the plain text (.txt) transcription file.    |
| `srt_url`            | string | URL to the SRT (.srt) subtitle file.                |
| `vtt_url`            | string | URL to the VTT (.vtt) subtitle file.                |
| `transcription_text` | string | The full plain text content of the transcription.   |
| `srt_text`           | string | The full text content of the SRT subtitle file.     |
| `vtt_text`           | string | The full text content of the VTT subtitle file.     |

*(Note: `file:///` URLs in examples are placeholders for local development. In production, these will be S3 URLs or other accessible storage URLs.)*

## Error Responses

If an error occurs during the initial job submission (POST request), the API will respond with an appropriate HTTP status code and a JSON body describing the error.

### Common Error Status Codes for POST Request

-   **400 Bad Request:** Invalid parameters in the request body (e.g., missing `url`, invalid `quality` or `response_format`).
-   **401 Unauthorized:** Missing, invalid, or inactive `API_KEY`.
-   **403 Forbidden:** API access attempted by a user on the 'free' tier.
-   **500 Internal Server Error:** An unexpected error occurred on the server.

### Example Error Response Body (POST Request)

```json
{
    "error": "API_KEY header is required",
    "status_code": 401,
    "status_message": "Unauthorized"
}
```

Or for a validation error:

```json
{
    "error": "Invalid quality parameter. Must be one of: standard, premium, caption_first",
    "status_code": 400,
    "status_message": "Bad Request"
}
```

### Failed Job in Callback

If a job fails during processing, the callback payload (or the GET job status response) will indicate this.

**Example Failed Job Callback:**

```json
{
  "job_id": "transcription-1747214370913-744",
  "status_code": 500,
  "status_message": "Transcription failed",
  "quality": "premium",
  "error": "Detailed error message about why the transcription failed, e.g., 'Failed to download audio from URL.' or 'Credit deduction failed: Insufficient credits.'"
}
``` 