import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SubmissionError,
  getCurrentUserId,
  newClientId,
  retrySubmissionOnServer,
  submitRecording,
  submitText,
  waitForSubmission,
} from '../utils/api';
import {
  clearPending,
  loadPending,
  loadRecording,
  savePending,
  saveRecording,
} from '../utils/pendingStore';

const AUTO_RETRIES = 2;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One hook for "submit a recording (or text) and get the grade back".
 *
 *  - No time limit while the server says the job is in line / processing.
 *  - Network drops and server restarts are retried automatically.
 *  - The recording is kept (in memory + IndexedDB) until the result arrives, so
 *    "Retry" never needs a new recording, even after a page refresh.
 *  - `resume()` picks up an unfinished submission after refresh / tab switch.
 *
 * @param {string} apiBase
 * @param {string} storageKey  one pending submission is remembered per key (usually the mode)
 * @param {{persist?: boolean}} options  persist=false for short conversation turns
 */
export function useSubmission(apiBase, storageKey, { persist = true } = {}) {
  const [progress, setProgress] = useState(null);
  const currentRef = useRef(null); // { record, blob }
  const abortRef = useRef(null);

  // Stop polling when the component unmounts (e.g. student switches tab).
  // The submission keeps going on the server and is resumed on return.
  useEffect(() => () => abortRef.current?.abort(), []);

  const update = useCallback((patch) => {
    setProgress((prev) => ({ ...(prev || {}), ...patch }));
  }, []);

  const remember = useCallback((record) => {
    if (persist) savePending(storageKey, record);
  }, [persist, storageKey]);

  const execute = useCallback(async (record, blob, { startWithServerRetry = false } = {}) => {
    let autoRetries = 0;
    let serverRetry = startWithServerRetry;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    while (true) {
      try {
        if (serverRetry && record.subId) {
          serverRetry = false;
          update({ phase: 'queued', message: 'Continuing where it stopped...', error: null });
          await retrySubmissionOnServer(apiBase, record.subId);
        }
        if (!record.subId) {
          if (record.kind === 'audio' && !blob) {
            blob = await loadRecording(record.clientId);
            if (!blob) {
              throw new SubmissionError(
                'Your recording is no longer available on this device. Please record again.',
                { needsRerecord: true },
              );
            }
            if (currentRef.current) currentRef.current.blob = blob;
          }
          record.uploadId = record.uploadId || newClientId();
          update({ phase: 'uploading', message: 'Uploading your answer...', error: null, offline: false });
          const view = record.kind === 'audio'
            ? await submitRecording(apiBase, {
                blob, mode: record.mode, params: record.params, duration: record.duration, clientId: record.uploadId,
              })
            : await submitText(apiBase, { ...record.textBody, mode: record.mode, client_id: record.uploadId });
          record.subId = view.id;
          remember(record);
        }

        const view = await waitForSubmission(apiBase, record.subId, {
          signal,
          onUpdate: (v) => update({
            phase: v.offline ? undefined : v.status,
            stage: v.stage,
            message: v.message,
            position: v.position,
            eta: v.eta_seconds,
            transcript: v.transcript,
            offline: !!v.offline,
          }),
        });
        update({ phase: 'completed', transcript: view.transcript, error: null });
        return view;
      } catch (err) {
        if (signal.aborted) {
          throw new SubmissionError('Cancelled.', { retryable: true, cancelled: true });
        }
        const error = err instanceof SubmissionError
          ? err
          : new SubmissionError(err?.message || 'Network problem.', { retryable: true });

        if (error.lost) {
          // Server lost it (restart / expired): upload the saved recording again.
          record.subId = null;
          record.uploadId = null;
          remember(record);
        }

        const canAuto = (error.retryable || error.lost) && !error.needsRerecord && autoRetries < AUTO_RETRIES;
        if (canAuto) {
          autoRetries += 1;
          update({ phase: 'queued', message: 'Hit a snag - retrying automatically...', offline: false });
          await sleep(4000 * autoRetries);
          serverRetry = !!record.subId;
          continue;
        }

        update({
          phase: 'failed',
          error: error.message,
          retryable: !error.needsRerecord,
          needsRerecord: !!error.needsRerecord,
        });
        if (error.needsRerecord) {
          clearPending(storageKey, record);
        }
        throw error;
      }
    }
  }, [apiBase, remember, storageKey, update]);

  /** Start a new submission. Pass `blob` for audio or `textBody` for text grading. */
  const run = useCallback(async ({ mode, blob = null, textBody = null, params = {}, duration = null, meta = {} }) => {
    const record = {
      clientId: newClientId(),
      subId: null,
      uploadId: null,
      mode,
      kind: blob ? 'audio' : 'text',
      params,
      duration,
      textBody,
      meta,
      userId: await getCurrentUserId(),
    };
    currentRef.current = { record, blob };
    setProgress({ phase: 'uploading', message: 'Uploading your answer...' });
    if (persist) {
      if (blob) await saveRecording(record.clientId, blob);
      savePending(storageKey, record);
    }
    return execute(record, blob);
  }, [execute, persist, storageKey]);

  /** Manual "Retry" button: continue from where it stopped, without re-recording. */
  const retry = useCallback(async () => {
    const current = currentRef.current;
    if (!current) throw new SubmissionError('Nothing to retry. Please record again.', { needsRerecord: true });
    return execute(current.record, current.blob, { startWithServerRetry: true });
  }, [execute]);

  /**
   * Resume a submission left unfinished (refresh, tab switch, closed browser).
   * Returns null if there is none, otherwise { meta, blob, promise }.
   */
  const resume = useCallback(async () => {
    if (!persist) return null;
    const record = loadPending(storageKey);
    if (!record) return null;
    const userId = await getCurrentUserId();
    if (record.userId && userId && record.userId !== userId) return null; // another student's
    const blob = record.kind === 'audio' ? await loadRecording(record.clientId) : null;
    if (record.kind === 'audio' && !blob && !record.subId) {
      clearPending(storageKey, record);
      return null;
    }
    currentRef.current = { record, blob };
    setProgress({ phase: 'queued', message: 'Picking up your previous submission...' });
    return { meta: record.meta || {}, blob, promise: execute(record, blob, { startWithServerRetry: true }) };
  }, [execute, persist, storageKey]);

  /** Forget the pending submission (call once the result has been shown/saved). */
  const clear = useCallback(() => {
    if (persist) clearPending(storageKey, currentRef.current?.record);
    currentRef.current = null;
    setProgress(null);
  }, [persist, storageKey]);

  const hasRecording = useCallback(() => !!currentRef.current, []);

  return { progress, run, retry, resume, clear, hasRecording };
}

export default useSubmission;
