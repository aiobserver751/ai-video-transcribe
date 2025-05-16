export type VideoPlatform = "youtube" | "tiktok" | "instagram" | "other" | null;

/**
 * Determines the video platform from a given URL.
 * @param url The URL to parse.
 * @returns The identified platform or null if not recognized.
 */
export function getVideoPlatform(url: string): VideoPlatform {
  if (!url) return null;
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    // YouTube
    if (
      (hostname === "youtube.com" || hostname === "www.youtube.com") &&
      parsedUrl.searchParams.has("v")
    ) {
      return "youtube";
    }
    if (hostname === "youtu.be" && parsedUrl.pathname.length > 1) {
      return "youtube";
    }

    // TikTok
    // Covers URLs like:
    // https://www.tiktok.com/@username/video/1234567890123456789
    // https://m.tiktok.com/v/1234567890123456789.html
    // https://vm.tiktok.com/ZSJabcdef/ (shortened) - yt-dlp handles these
    if (hostname.includes("tiktok.com")) {
      if (parsedUrl.pathname.includes("/video/") || parsedUrl.pathname.startsWith("/v/") || parsedUrl.pathname.length > 3) { // Basic check for common TikTok patterns + shortlinks
        return "tiktok";
      }
    }

    // Instagram Reels
    // Covers URLs like:
    // https://www.instagram.com/reel/Cabcdefghij/
    // https://instagram.com/reel/Cabcdefghij/
    if (hostname.includes("instagram.com") && parsedUrl.pathname.startsWith("/reel/")) {
      return "instagram";
    }
    
    // Add more specific checks for other platforms if needed in the future

    // Basic check for common video file extensions if it's a direct link
    const commonVideoExtensions = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".flv"];
    if (commonVideoExtensions.some(ext => parsedUrl.pathname.toLowerCase().endsWith(ext))) {
        return "other"; // Could be a direct video link
    }

    return null; // Default if no specific platform is identified
  } catch {
    // Invalid URL
    return null;
  }
}

/**
 * Checks if the URL is from a supported video platform (YouTube, TikTok, Instagram).
 * @param url The URL to check.
 * @returns True if the URL is from a supported platform, false otherwise.
 */
export function isValidPlatformUrl(url: string): boolean {
  const platform = getVideoPlatform(url);
  return platform === "youtube" || platform === "tiktok" || platform === "instagram";
}

/**
 * Checks if the URL is specifically a YouTube URL.
 * Needed to keep existing logic separate until full migration.
 * @param url The URL to check.
 * @returns True if the URL is a YouTube URL, false otherwise.
 */
export function isYouTubeUrl(url: string): boolean {
    return getVideoPlatform(url) === "youtube";
}

/**
 * Checks if the URL is specifically a TikTok URL.
 * @param url The URL to check.
 * @returns True if the URL is a TikTok URL, false otherwise.
 */
export function isTikTokUrl(url: string): boolean {
    return getVideoPlatform(url) === "tiktok";
}

/**
 * Checks if the URL is specifically an Instagram Reel URL.
 * @param url The URL to check.
 * @returns True if the URL is an Instagram Reel URL, false otherwise.
 */
export function isInstagramUrl(url: string): boolean {
    return getVideoPlatform(url) === "instagram";
} 