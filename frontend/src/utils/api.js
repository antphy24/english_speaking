import { supabase } from './supabaseClient';

let _cachedToken = null;
let _tokenExpiry = 0;

async function getToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiry) return _cachedToken;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    _cachedToken = session.access_token;
    _tokenExpiry = now + 4 * 60 * 1000; // Cache for 4 minutes
  }
  return _cachedToken;
}

/**
 * Enhanced fetch wrapper with automatic exponential backoff retry for handling rate limits (HTTP 429).
 * Automatically injects the Supabase JWT token into the request headers.
 * 
 * @param {string} url - The target endpoint.
 * @param {RequestInit} options - Standard fetch options.
 * @param {number} retries - Maximum number of retries (default: 5).
 * @param {number} delay - Initial delay in milliseconds (default: 1500ms).
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retries = 5, delay = 1500) {
  try {
    // Automatically inject JWT token using cache
    const token = await getToken();
    if (token) {
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
      };
    }

    const response = await fetch(url, options);
    
    // Intercept rate limiting (HTTP 429) or Server Errors (5xx)
    if ((response.status === 429 || response.status >= 500) && retries > 0) {
      console.warn(`Rate limit (429) or Server Error (5xx) encountered. Retrying in ${delay}ms... (${retries} attempts left)`);
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

export async function pollJobStatus(apiBase, jobId, options = {}, initialDelayMs = 1500, maxWaitMs = 120000, onProgress = null) {
  const url = `${apiBase}/job/${jobId}`;
  const deadline = Date.now() + maxWaitMs;
  let currentDelay = initialDelayMs;
  const maxDelay = 10000; // Cap at 10s

  while (Date.now() < deadline) {
    if (options.signal && options.signal.aborted) {
      throw new Error('Evaluation aborted by user.');
    }
    
    const response = await fetchWithRetry(url, options);
    if (!response.ok) {
      const errorMsg = await parseError(response, 'Failed to fetch job status');
      throw new Error(errorMsg);
    }
    const data = await response.json();
    if (data.status === 'completed') {
      return data.result;
    }
    if (data.status === 'failed') {
      throw new Error(data.error || 'Background job failed');
    }
    
    // Pass queue status back to the caller for UI updates
    if (onProgress && (data.status === 'queued' || data.status === 'started')) {
      onProgress(data.status);
    }

    await new Promise((resolve) => setTimeout(resolve, currentDelay));
    currentDelay = Math.min(currentDelay * 1.5, maxDelay); // Backoff
  }
  
  throw new Error('Evaluation timed out. Please try again.');
}

export default { fetchWithRetry, parseError, pollJobStatus };
