import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../utils/supabaseClient';

const IDLE_THRESHOLD_MS = 120_000;   // 2 minutes without interaction → idle
const FLUSH_INTERVAL_MS = 60_000;    // flush every 60 seconds
const TICK_INTERVAL_MS  = 1_000;     // tick every 1 second

const INTERACTION_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function useActivityTracker({ studentId, classId, activeMode }) {
  // ── Display state (returned to consumer) ──────────────────────────
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [idleSeconds, setIdleSeconds]     = useState(0);
  const [isActive, setIsActive]           = useState(true);

  // ── Mutable refs (no stale-closure issues) ────────────────────────
  const activeSecondsRef    = useRef(0);
  const idleSecondsRef      = useRef(0);
  const isActiveRef         = useRef(true);
  const lastInteractionRef  = useRef(Date.now());
  const segmentStartRef     = useRef(new Date().toISOString());
  const tabVisibleRef       = useRef(!document.hidden);

  // Keep latest props in refs so callbacks never go stale
  const studentIdRef  = useRef(studentId);
  const classIdRef    = useRef(classId);
  const activeModeRef = useRef(activeMode);

  useEffect(() => { studentIdRef.current = studentId; }, [studentId]);
  useEffect(() => { classIdRef.current = classId; },     [classId]);

  // ── Flush helper ──────────────────────────────────────────────────
  const flush = useCallback(async (modeOverride) => {
    const active = activeSecondsRef.current;
    const idle   = idleSecondsRef.current;

    if (active === 0 && idle === 0) return;

    const payload = {
      student_id:     studentIdRef.current,
      class_id:       classIdRef.current,
      mode:           modeOverride ?? activeModeRef.current,
      active_seconds: active,
      idle_seconds:   idle,
      started_at:     segmentStartRef.current,
      ended_at:       new Date().toISOString(),
    };

    // Reset accumulators immediately to avoid double-counting
    activeSecondsRef.current = 0;
    idleSecondsRef.current   = 0;
    segmentStartRef.current  = new Date().toISOString();
    setActiveSeconds(0);
    setIdleSeconds(0);

    try {
      const { error } = await supabase
        .from('activity_logs')
        .insert(payload);
      if (error) console.error('[ActivityTracker] flush error:', error.message);
    } catch (err) {
      console.error('[ActivityTracker] flush exception:', err);
    }
  }, []);

  // Beacon-based flush for beforeunload (synchronous, fire-and-forget)
  const beaconFlush = useCallback((modeOverride) => {
    const active = activeSecondsRef.current;
    const idle   = idleSecondsRef.current;

    if (active === 0 && idle === 0) return;

    const payload = {
      student_id:     studentIdRef.current,
      class_id:       classIdRef.current,
      mode:           modeOverride ?? activeModeRef.current,
      active_seconds: active,
      idle_seconds:   idle,
      started_at:     segmentStartRef.current,
      ended_at:       new Date().toISOString(),
    };

    // Reset so a concurrent async flush doesn't double-count
    activeSecondsRef.current = 0;
    idleSecondsRef.current   = 0;

    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(
        `${supabaseUrl}/rest/v1/activity_logs?apikey=${supabaseAnonKey}`,
        blob,
      );
    } catch (err) {
      console.error('[ActivityTracker] beacon flush failed:', err);
    }
  }, []);

  // ── Mode change → flush old segment, start new one ────────────────
  const prevModeRef = useRef(activeMode);

  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = activeMode;
    activeModeRef.current = activeMode;

    if (prevMode !== activeMode) {
      // Flush accumulated time tagged with the OLD mode
      flush(prevMode);
    }
  }, [activeMode, flush]);

  // ── Core tracking lifecycle ───────────────────────────────────────
  useEffect(() => {
    // Guard: need at least a student to track
    if (!studentId) return;

    // -- Interaction handler ------------------------------------------
    const handleInteraction = () => {
      lastInteractionRef.current = Date.now();

      if (!isActiveRef.current && tabVisibleRef.current) {
        isActiveRef.current = true;
        setIsActive(true);
      }
    };

    // -- Visibility handler -------------------------------------------
    const handleVisibility = () => {
      const visible = !document.hidden;
      tabVisibleRef.current = visible;

      if (visible) {
        lastInteractionRef.current = Date.now();
        isActiveRef.current = true;
        setIsActive(true);
      } else {
        isActiveRef.current = false;
        setIsActive(false);
      }
    };

    // -- Before-unload handler ----------------------------------------
    const handleBeforeUnload = () => {
      beaconFlush();
    };

    // ── Register listeners ──────────────────────────────────────────
    INTERACTION_EVENTS.forEach((evt) =>
      document.addEventListener(evt, handleInteraction, { passive: true }),
    );
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // ── 1-second tick ────────────────────────────────────────────────
    const tickId = setInterval(() => {
      // Determine active/idle state
      const now = Date.now();
      const sinceInteraction = now - lastInteractionRef.current;

      if (tabVisibleRef.current && sinceInteraction < IDLE_THRESHOLD_MS) {
        // Active
        if (!isActiveRef.current) {
          isActiveRef.current = true;
          setIsActive(true);
        }
        activeSecondsRef.current += 1;
        setActiveSeconds((s) => s + 1);
      } else {
        // Idle (tab hidden OR idle timeout)
        if (isActiveRef.current) {
          isActiveRef.current = false;
          setIsActive(false);
        }
        idleSecondsRef.current += 1;
        setIdleSeconds((s) => s + 1);
      }
    }, TICK_INTERVAL_MS);

    // ── Periodic flush ───────────────────────────────────────────────
    const flushId = setInterval(() => {
      flush();
    }, FLUSH_INTERVAL_MS);

    // ── Cleanup ──────────────────────────────────────────────────────
    return () => {
      clearInterval(tickId);
      clearInterval(flushId);

      INTERACTION_EVENTS.forEach((evt) =>
        document.removeEventListener(evt, handleInteraction),
      );
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);

      // Final flush of any remaining time
      flush();
    };
  }, [studentId, flush, beaconFlush]);

  return { activeSeconds, idleSeconds, isActive };
}
