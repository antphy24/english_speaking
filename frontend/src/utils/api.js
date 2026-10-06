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
    
    // Intercept rate limiting (HTTP 429) or temporary unavailability (503) — do NOT retry 500 (prevents duplicate jobs)
    if ((response.status === 429 || response.status === 503) && retries > 0) {
      // Check if it's our intentional circuit breaker from the backend
      const clonedResponse = response.clone();
      try {
        const errorData = await clonedResponse.json();
        if (errorData && errorData.detail) {
          // Do not retry blindly; return to let the UI show the error immediately
          return response;
        }
      } catch (e) {
        // ignore parse errors, likely a proxy HTML error, proceed to retry
      }

      console.warn(`Rate limit (429) or Service Unavailable (503) encountered. Retrying in ${delay}ms... (${retries} attempts left)`);
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
    if (onProgress && (data.status === 'queued' || data.status === 'started' || data.status === 'scheduled' || data.status === 'deferred')) {
      if (data.position) {
        onProgress(`${data.status} (Position: ${data.position})`);
      } else {
        onProgress(data.status);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, currentDelay));
    currentDelay = Math.min(currentDelay * 1.5, maxDelay); // Backoff
  }
  
  throw new Error('Evaluation timed out. Please try again.');
}

// ---------------------------------------------------------------------------
// Submission API (v2) - one upload per recording, waits without a time limit,
// survives refreshes and network drops, and retries without re-recording.
// ---------------------------------------------------------------------------

export class SubmissionError extends Error {
  constructor(message, { retryable = false, needsRerecord = false, lost = false, view = null, cancelled = false, accountChanged = false } = {}) {
    super(message);
    this.cancelled = cancelled;
    this.accountChanged = accountChanged;
    this.retryable = retryable;
    this.needsRerecord = needsRerecord;
    this.lost = lost; // server no longer has it -> re-upload the saved recording
    this.view = view;
  }
}

export function newClientId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function getCurrentUserId() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  } catch {
    return null;
  }
}

export function audioExtension(blob) {
  const type = blob?.type || '';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'mp4';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return 'webm';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJsonOrThrow(response, fallbackMsg) {
  if (response.ok) return response.json();
  const msg = await parseError(response, fallbackMsg);
  if (response.status === 404 || response.status === 410) {
    throw new SubmissionError(msg, { lost: true, retryable: true });
  }
  // 4xx other than rate limiting are real problems with the request itself
  const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
  throw new SubmissionError(msg, { retryable });
}

/** Upload a recording. Safe to call again with the same clientId (no duplicates). */
export async function submitRecording(apiBase, { blob, mode, params = {}, duration, clientId }) {
  const form = new FormData();
  form.append('file', blob, `recording.${audioExtension(blob)}`);
  form.append('mode', mode);
  form.append('client_id', clientId);
  if (duration) form.append('duration', String(duration));
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') form.append(k, v);
  });
  const response = await fetchWithRetry(`${apiBase}/submit`, { method: 'POST', body: form }, 6, 2000);
  return readJsonOrThrow(response, 'Could not upload your recording.');
}

/** Submit text for grading (conversation history, or a transcript we already have). */
export async function submitText(apiBase, body) {
  const response = await fetchWithRetry(`${apiBase}/submit-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 6, 2000);
  return readJsonOrThrow(response, 'Could not send your answer for grading.');
}

/**
 * Details for reviewing a saved attempt: its transcript and temporary links to
 * the recording(s). Works for the student who made it and for their teacher.
 */
export async function getAssessmentReview(apiBase, assessmentId, authClient = supabase) {
  // Students, teachers and admins each have their own login session, so the caller
  // says whose to use (fetchWithRetry always sends the student's).
  const { data: { session } } = await authClient.auth.getSession();
  if (!session?.access_token) throw new Error('Your login session has expired. Please sign in again.');
  const request = () => fetch(`${apiBase}/assessment/${assessmentId}/review`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  let response;
  try {
    response = await request();
  } catch (err) {
    await sleep(1500); // one quiet retry for a network blip
    response = await request();
  }
  if (!response.ok) throw new Error(await parseError(response, 'Could not load this attempt.'));
  return response.json();
}

/** Ask the server to save a graded submission's score (idempotent). */
export async function saveSubmissionOnServer(apiBase, subId) {
  const response = await fetchWithRetry(`${apiBase}/submission/${subId}/save`, { method: 'POST' }, 4, 2000);
  return readJsonOrThrow(response, 'Could not save the score.');
}

export async function retrySubmissionOnServer(apiBase, subId) {
  const response = await fetchWithRetry(`${apiBase}/submission/${subId}/retry`, { method: 'POST' }, 6, 2000);
  return readJsonOrThrow(response, 'Could not retry.');
}

/**
 * Wait for a submission to finish. There is NO overall time limit: as long as the
 * server says the submission is queued/processing we keep waiting, and network
 * errors just mean "try again in a moment".
 */
export async function waitForSubmission(apiBase, subId, { onUpdate, signal } = {}) {
  let delay = 2000;
  let networkFailures = 0;
  while (true) {
    if (signal?.aborted) throw new SubmissionError('Cancelled.', { retryable: true, cancelled: true });
    let response;
    try {
      response = await fetchWithRetry(`${apiBase}/submission/${subId}`, {}, 1, 1500);
    } catch (err) {
      networkFailures += 1;
      onUpdate?.({ offline: true });
      await sleep(Math.min(3000 * networkFailures, 15000));
      if (signal?.aborted) throw new SubmissionError('Cancelled.', { retryable: true, cancelled: true });
      continue;
    }
    if (response.status === 401) {
      _cachedToken = null; // session refreshed; fetch a fresh token next time
      networkFailures += 1;
      await sleep(2000);
      continue;
    }
    if (response.status >= 500 || response.status === 429) {
      // Server waking up / restarting / busy: keep waiting.
      networkFailures += 1;
      onUpdate?.({ offline: true });
      await sleep(Math.min(3000 * networkFailures, 15000));
      continue;
    }
    const view = await readJsonOrThrow(response, 'Could not check your submission.');
    networkFailures = 0;
    onUpdate?.({ ...view, offline: false });
    if (view.status === 'completed') return view;
    if (view.status === 'failed') {
      throw new SubmissionError(view.error || 'Processing failed.', {
        retryable: view.retryable, needsRerecord: view.needs_rerecord, view,
      });
    }
    // Poll less often when far back in the line.
    const far = view.position && view.position > 10;
    delay = far ? 8000 : Math.min(delay + 500, 5000);
    await sleep(delay);
  }
}

/** Chat tutor reply, retried automatically while the AI is busy. */
export async function getChatReplyWithRetry(apiBase, messages, { onBusy, maxWaitMs = 240000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (true) {
    attempt += 1;
    let response;
    try {
      response = await fetchWithRetry(`${apiBase}/chat_reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      }, 3, 2000);
    } catch (err) {
      response = null;
    }
    if (response && response.ok) {
      const { reply } = await response.json();
      return reply;
    }
    const retryable = !response || response.status >= 500 || response.status === 429;
    if (!retryable || Date.now() > deadline) {
      const msg = response ? await parseError(response, 'The tutor could not reply.') : 'Network problem - the tutor could not reply.';
      throw new SubmissionError(msg.replace('AI_BUSY: ', ''), { retryable: true });
    }
    onBusy?.(attempt);
    await sleep(Math.min(3000 * attempt, 15000));
  }
}

/** Mattering drill: the opposing argument to rebut, retried automatically while the AI is busy. */
export async function getMatteringOpposition(apiBase, { motion, role, argument }, { onBusy, maxWaitMs = 240000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (true) {
    attempt += 1;
    let response;
    try {
      response = await fetchWithRetry(`${apiBase}/mattering/opposition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motion, role, argument }),
      }, 3, 2000);
    } catch (err) {
      response = null;
    }
    if (response && response.ok) {
      const { opposition } = await response.json();
      return opposition;
    }
    const retryable = !response || response.status >= 500 || response.status === 429;
    if (!retryable || Date.now() > deadline) {
      const msg = response
        ? await parseError(response, 'The opposing argument could not be prepared.')
        : 'Network problem - the opposing argument could not be prepared.';
      throw new SubmissionError(msg.replace('AI_BUSY: ', ''), { retryable: true });
    }
    onBusy?.(attempt);
    await sleep(Math.min(3000 * attempt, 15000));
  }
}

export default { fetchWithRetry, parseError, pollJobStatus };
