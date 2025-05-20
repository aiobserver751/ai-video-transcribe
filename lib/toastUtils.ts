import { toast } from "sonner";
import messagesConfig from "@/messages.frontend.json"; // Assuming messages.frontend.json is in the root

// Define a type for the parameters that can be passed to a toast message
interface ToastParams {
  [key: string]: string | number;
}

// Define a type for the structure of a single message object in the JSON
export interface MessageObject {
  title: string | null;
  description: string;
}

// More specific type for the structure of the toasts part of the config
interface ToastsConfig {
  [category: string]: {
    [key: string]: MessageObject;
  };
}

// Define a type for the toast type
type ToastType = "success" | "error" | "info" | "warning" | "loading" | "message"; // "message" is sonner's default

interface DefaultMessages {
  title?: string;
  description: string;
}

// Helper function to safely get a nested property from an object
function getNestedProperty(obj: ToastsConfig, path: string): MessageObject | undefined {
  const parts = path.split('.');
  let current: ToastsConfig | { [key: string]: MessageObject } | MessageObject | undefined = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      // Type assertion is needed here as TypeScript cannot guarantee the shape at each step of dynamic traversal
      current = (current as { [key: string]: unknown })[part]; 
    } else {
      current = undefined;
      break;
    }
  }

  // Ensure the final result matches the MessageObject structure
  if (current && typeof (current as MessageObject).description === 'string' && 
      ((current as MessageObject).title === null || typeof (current as MessageObject).title === 'string')) {
    return current as MessageObject;
  }
  return undefined;
}

/**
 * Displays a toast message based on a key from the messages.frontend.json configuration.
 *
 * @param path - The dot-separated path to the message object (e.g., "submitJobForm.jobSubmittedSuccess").
 * @param type - The type of toast to display ('success', 'error', 'info', etc.).
 * @param params - Optional parameters to replace placeholders in the description.
 * @param defaultMessages - Optional default title and description if the path is not found.
 */
export function displayToast(
  path: string,
  type: ToastType = "info",
  params?: ToastParams,
  defaultMessages?: DefaultMessages
) {
  const messageObj = getNestedProperty(messagesConfig.toasts as ToastsConfig, path);

  let title: string | undefined = defaultMessages?.title;
  let description: string = defaultMessages?.description || "An unexpected error occurred."; // Default fallback

  if (messageObj) {
    title = messageObj.title ?? undefined; // Use undefined if null so sonner can handle it
    description = messageObj.description;

    if (params) {
      Object.keys(params).forEach(paramKey => {
        const placeholder = `{${paramKey}}`;
        // Ensure description is a string before calling replaceAll
        if (typeof description === 'string') {
            description = description.replaceAll(placeholder, String(params[paramKey]));
        }
      });
    }
  } else {
    console.warn(`Toast message not found for path: "${path}". Using default or fallback.`);
    // If defaultMessages are provided, they are already set. 
    // If not, the very basic fallback "An unexpected error occurred." is used for description.
    // Title will be undefined if not in defaultMessages.
  }

  const toastFunction = toast[type] || toast; // Fallback to generic toast if type is invalid

  if (title) {
    toastFunction(title, { description });
  } else {
    // If title is null/undefined, pass description as the main argument to sonner
    toastFunction(description);
  }
} 