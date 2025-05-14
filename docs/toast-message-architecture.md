# Toast Message Management Architecture

## 1. Overview

This document outlines the architecture for managing and displaying toast messages (pop-up notifications) within the frontend application. The primary goal is to centralize toast message strings, making them easier to maintain, update, and potentially prepare for future internationalization (i18n) without requiring direct code changes in multiple components for simple text modifications.

## 2. Solution Components

The system consists of three main parts:

### 2.1. Message Configuration File (`messages.frontend.json`)

*   **Purpose**: Acts as a central repository for all frontend toast message strings.
*   **Location**: Root of the project (`/messages.frontend.json`).
*   **Structure**:
    *   A single JSON object.
    *   A top-level key `"toasts"`.
    *   Under `"toasts"`, messages are grouped by the page or component they primarily relate to (e.g., `"submitJobForm"`, `"settingsPage"`). This is for organizational purposes.
    *   Each specific message has a descriptive key (e.g., `"jobSubmittedSuccess"`, `"apiKeyNameEmptyError"`).
    *   Each message key maps to an object containing:
        *   `title`: (string | null) The title of the toast. Can be `null` if no title is desired.
        *   `description`: (string) The main content of the toast. Can include placeholders in the format `{placeholderName}` (e.g., `Job {jobId} submitted successfully!`).

**Example Snippet from `messages.frontend.json`:**
```json
{
  "toasts": {
    "submitJobForm": {
      "jobSubmittedSuccess": {
        "title": null,
        "description": "Job {jobId} submitted successfully!"
      }
    },
    "settingsPage": {
      "apiKeyGeneratedSuccess": {
        "title": "API Key Generated",
        "description": "Your new API key has been generated. Copy it now, it won't be shown again!"
      }
    }
  }
}
```

### 2.2. Toast Utility Module (`lib/toastUtils.ts`)

*   **Purpose**: Provides a reusable function to display toasts using the centralized messages and `sonner` library.
*   **Key Export**: `displayToast` function.

*   **`displayToast(path, type, params, defaultMessages)` function**:
    *   `path` (string, required): A dot-separated string representing the path to the desired message object within `messagesConfig.toasts` (e.g., `"submitJobForm.jobSubmittedSuccess"`).
    *   `type` (ToastType, optional, defaults to `"info"`): The type of toast to display (e.g., `"success"`, `"error"`, `"info"`, `"warning"`). This maps to `sonner`'s toast types.
    *   `params` (object, optional): An object where keys correspond to placeholders in the message's `description` string. The values will replace these placeholders (e.g., `{ jobId: "123" }`).
    *   `defaultMessages` (object, optional): An object with `title` (optional) and `description` (required) to be used as a fallback if the specified `path` is not found in the configuration. If not provided, a generic "An unexpected error occurred." message is used as a last resort for the description.

*   **Functionality**:
    1.  Imports the `toast` object from `sonner`.
    2.  Imports the `messagesConfig` from `@/messages.frontend.json`.
    3.  The `getNestedProperty` helper function safely retrieves the message object (title and description) from `messagesConfig.toasts` based on the provided `path`.
    4.  If the message object is found:
        *   It uses the `title` and `description` from the JSON.
        *   If `params` are provided, it replaces placeholders in the `description` string.
    5.  If the message object is *not* found:
        *   It logs a warning to the console.
        *   It uses the `title` and `description` from the `defaultMessages` parameter, if provided.
        *   If `defaultMessages` are not provided, it uses a hardcoded generic fallback description ("An unexpected error occurred.") and no title.
    6.  It calls the appropriate `sonner` toast function (e.g., `toast.success()`, `toast.error()`) based on the `type` parameter.
        *   If a `title` is present, it calls `toast[type](title, { description })`.
        *   If `title` is `null` or `undefined`, it calls `toast[type](description)`.

### 2.3. Refactored Frontend Components

*   **Purpose**: To utilize the `displayToast` utility instead of directly calling `sonner`'s `toast` functions with hardcoded strings.
*   **Changes**:
    *   Import `displayToast` from `"@/lib/toastUtils"`.
    *   Replace direct calls like `toast.success("Job submitted!")` or `toast.error("Error", { description: "Details" })` with calls to `displayToast("category.messageKey", "success", { params_if_any })`.
    *   For specific cases where a dynamic error message comes directly from the server and is intended for user display, components might still use `toast.error("Generic Title", { description: serverErrorString })` to preserve that dynamic server message, while using `displayToast` for standardized fallbacks or other messages.

## 3. Workflow: Displaying a Toast

1.  A user action or system event occurs in a frontend component that needs to trigger a toast notification.
2.  The component calls the `displayToast()` function from `lib/toastUtils.ts`.
3.  The component provides:
    *   The path to the message key in `messages.frontend.json` (e.g., `"settingsPage.copyApiKeySuccess"`).
    *   The type of toast (e.g., `"success"`).
    *   (Optionally) Any parameters needed to fill placeholders in the message.
    *   (Optionally) Default messages in case the key is not found (though the utility has its own ultimate fallback).
4.  `displayToast()` looks up the message string in `messages.frontend.json`.
5.  It processes any placeholders using the provided parameters.
6.  It calls the underlying `sonner` library to render the toast with the retrieved (or fallback) title and description.

## 4. Benefits

*   **Centralization**: All user-facing toast text is in one place (`messages.frontend.json`), making it easy to find, review, and modify.
*   **Maintainability**: Changes to message wording do not require hunting through component code. Only the JSON file needs to be updated (unless new placeholders or logic are involved).
*   **Consistency**: Promotes consistent phrasing and tone for similar types of notifications across the application.
*   **Reduced Code Duplication**: Eliminates repeated hardcoded strings in multiple components.
*   **Foundation for i18n**: While not a full i18n solution, this structure makes it significantly easier to adapt to a multi-language setup in the future (e.g., by having locale-specific JSON files).
*   **Developer Experience**: Simplifies the process of adding or modifying toasts by providing a clear, standardized utility.
*   **Safe Fallbacks**: The `displayToast` utility includes fallbacks to ensure that some message is always shown, even if a message key is incorrect or missing, and logs a warning for developers.

## 5. Considerations and Future Improvements

*   **API Error Messages**: This system currently focuses on frontend-initiated toasts. A similar strategy could be adopted for standardizing API error messages that are then displayed on the frontend, possibly by having API routes return error *keys* rather than full strings, which the frontend then maps using a similar JSON structure.
*   **Full i18n Library**: For comprehensive internationalization (pluralization, gender, complex formatting, locale negotiation), integrating a dedicated i18n library (e.g., `next-intl`, `react-i18next`) would be the next step. The current `messages.frontend.json` could serve as the default language (e.g., English) file for such a library.
*   **Typed Keys**: To prevent typos when providing the `path` to `displayToast`, type generation from `messages.frontend.json` could be explored to provide IntelliSense and compile-time checks for message keys.
*   **Dynamic Content in Titles**: The current `MessageObject` allows `null` for titles. If dynamic content were needed in titles, the `params` handling could be extended to support it.

This architecture provides a robust and maintainable way to manage toast notifications in the application. 