/**
 * Enhanced fetch wrapper with automatic exponential backoff retry for handling rate limits (HTTP 429).
 * 
 * @param {string} url - The target endpoint.
 * @param {RequestInit} options - Standard fetch options.
 * @param {number} retries - Maximum number of retries (default: 5).
 * @param {number} delay - Initial delay in milliseconds (default: 1500ms).
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retries = 5, delay = 1500) {
  try {
    const response = await fetch(url, options);
    
    // Intercept rate limiting (HTTP 429)
    if (response.status === 429 && retries > 0) {
      console.warn(`Rate limit (429) encountered. Retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Retry with double the delay (exponential backoff)
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    
    return response;
  } catch (error) {
    // Intercept connection failure / net errors and retry
    if (retries > 0) {
      console.warn(`Network error encountered: ${error.message}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw error;
  }
}

/**
 * Safely parses API error responses, extracting JSON detail, HTML text, or returning a default fallback.
 * Clones the response stream to prevent "body already read" errors.
 * 
 * @param {Response} response - The fetch response object.
 * @param {string} defaultMsg - The fallback error message.
 * @returns {Promise<string>}
 */
export async function parseError(response, defaultMsg = 'An error occurred.') {
  try {
    // Attempt to parse JSON response details
    const clonedJson = response.clone();
    const data = await clonedJson.json();
    return data.detail || defaultMsg;
  } catch (jsonErr) {
    try {
      // Fallback: read HTML/text (e.g. Hugging Face 503 "Your space is sleeping" pages)
      const clonedText = response.clone();
      const text = await clonedText.text();
      // Keep it under 200 characters and strip HTML tags if present
      const cleanText = text.replace(/<[^>]*>/g, '').trim();
      return cleanText.substring(0, 200) || defaultMsg;
    } catch (textErr) {
      return defaultMsg;
    }
  }
}

export default { fetchWithRetry, parseError };
