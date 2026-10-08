import { useState, useRef, useEffect, useCallback } from 'react';
import { stopSpeaking } from '../utils/speech';

const isAppleMobile = () => {
  const ua = navigator.userAgent || '';
  // iPadOS reports itself as a Mac with a touch screen
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
};

const isSafari = () => {
  const ua = navigator.userAgent || '';
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\/|Android/i.test(ua);
};

// Pick a container the browser can really record. Safari records MP4/AAC reliably;
// its WebM support is new and those files do not play back on older iPhones.
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const webmFirst = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  const mp4First = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const candidates = (isAppleMobile() || isSafari()) ? mp4First : webmFirst;
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch { /* keep looking */ }
  }
  return ''; // let the browser decide
}

function friendlyError(err) {
  const name = err?.name || '';
  const apple = isAppleMobile();
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return apple
      ? 'Microphone is blocked. Tap the "aA" (or page settings) icon in the Safari address bar > Website Settings > Microphone > Allow, then try again. Also check Settings > Apps > Safari > Microphone.'
      : 'Microphone is blocked. Allow microphone access for this site in your browser settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The microphone is being used by another app (for example a call). Close it and try again.';
  }
  return err?.message || 'Microphone access denied or audio device not found.';
}

export function useMediaRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const startingRef = useRef(false);     // getUserMedia is still waiting (permission prompt)
  const stopRequestedRef = useRef(false); // stop was asked for before the recorder existed
  const mountedRef = useRef(true);

  const releaseStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = useCallback(async () => {
    // Ignore double taps while the permission prompt is open or a recording is running
    if (startingRef.current) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') return;

    startingRef.current = true;
    stopRequestedRef.current = false;
    try {
      setError(null);
      setAudioBlob(null);
      chunksRef.current = [];

      // The sample voice and the microphone fight over the iPhone audio session
      stopSpeaking();

      if (!window.isSecureContext) {
        throw new Error('Recording only works on a secure (https) page. Please open the app using its https:// link.');
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error(isAppleMobile()
          ? 'This browser cannot record audio. Open this page in Safari itself (not inside WhatsApp, Instagram or another app) and make sure your iPhone is updated.'
          : 'Your browser does not support audio recording. Please use a recent Chrome, Edge, or Safari.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Left the page, or already released the button, while the permission prompt was open
      if (!mountedRef.current || stopRequestedRef.current) {
        releaseStream();
        return;
      }

      const mimeType = pickMimeType();
      let mediaRecorder;
      try {
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch {
        mediaRecorder = new MediaRecorder(stream); // browser default format
      }
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Safari may report "audio/mp4;codecs=mp4a.40.2" - keep only the container type
        const finalMime = (mediaRecorder.mimeType || mimeType || chunksRef.current[0]?.type || 'audio/webm').split(';')[0];
        const blob = new Blob(chunksRef.current, { type: finalMime });
        chunksRef.current = [];
        releaseStream();
        clearTimer();
        if (mountedRef.current) {
          setIsRecording(false);
          setAudioBlob(blob);
        }
      };

      mediaRecorder.onerror = (e) => {
        console.error('MediaRecorder error:', e?.error || e);
        clearTimer();
        releaseStream();
        if (mountedRef.current) {
          setIsRecording(false);
          setError('Recording stopped unexpectedly. Please try again.');
        }
      };

      mediaRecorder.start(); // Start recording as a single continuous file
      setIsRecording(true);
      setRecordingTime(0);

      clearTimer();
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Error starting media recorder:', err);
      releaseStream();
      if (mountedRef.current) {
        setError(friendlyError(err));
        setIsRecording(false);
      }
    } finally {
      startingRef.current = false;
    }
  }, []);

  const stopRecording = useCallback(() => {
    clearTimer();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else if (startingRef.current) {
      // Still waiting for the microphone: cancel as soon as it arrives
      stopRequestedRef.current = true;
    }

    setIsRecording(false);
  }, []);

  const clearAudio = useCallback(() => {
    setAudioBlob(null);
    setRecordingTime(0);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      releaseStream();
    };
  }, []);

  return {
    isRecording,
    recordingTime,
    audioBlob,
    error,
    startRecording,
    stopRecording,
    clearAudio
  };
}
export default useMediaRecorder;
