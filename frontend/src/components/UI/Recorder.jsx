import React from 'react';
import { Mic, Square } from 'lucide-react';

export const formatClock = (secs = 0) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

/**
 * Round microphone button: blue when ready, red with a stop square while recording.
 * Extra props (onPointerDown, aria-label, style...) go straight to the <button>.
 */
export const RecordButton = React.forwardRef(function RecordButton(
  { isRecording, size = 'md', className = '', disabled, ...props },
  ref
) {
  const box = size === 'sm' ? 'w-14 h-14' : 'w-16 h-16 md:w-[72px] md:h-[72px]';
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={props['aria-label'] || (isRecording ? 'Stop recording' : 'Start recording')}
      className={`relative ${box} rounded-full flex items-center justify-center text-white transition-colors select-none shrink-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring disabled:opacity-50 disabled:cursor-not-allowed ${
        isRecording ? 'bg-danger-solid animate-mic-ring' : 'bg-brand hover:bg-brand-hover shadow-mic active:scale-95'
      } ${className}`}
      {...props}
    >
      {isRecording ? <Square className="w-6 h-6 fill-current" aria-hidden="true" /> : <Mic className="w-7 h-7" aria-hidden="true" />}
    </button>
  );
});

/** Four bouncing bars that show the microphone is live. */
export function LevelBars({ className = '' }) {
  return (
    <div className={`flex items-center gap-1 h-7 shrink-0 ${className}`} aria-hidden="true">
      {[0, 0.15, 0.3, 0.45].map((d) => (
        <span key={d} className="w-1 h-[22px] rounded-sm bg-danger animate-level-bar" style={{ animationDelay: `${d}s` }} />
      ))}
    </div>
  );
}

/**
 * Bar with the record button and its status text. Pinned to the bottom of the screen
 * (`sticky`) so it is always in reach while the student reads the card above it.
 *   <RecorderBar isRecording={rec} seconds={t} onToggle={toggle}
 *     idleTitle="Tap the microphone to answer" idleHint="Speak for 1-2 minutes." />
 */
export function RecorderBar({
  isRecording,
  seconds = 0,
  onToggle,
  disabled = false,
  idleTitle = 'Tap the microphone to start',
  idleHint = 'Tap again when you finish.',
  recordingHint = 'Tap the button when you finish.',
  buttonProps = {},
  sticky = true,
  children,
  className = '',
}) {
  return (
    <div
      className={`${sticky ? 'sticky bottom-0 z-20 shadow-[0_-6px_16px_rgb(16_24_40/0.08)]' : ''} flex items-center gap-4 md:gap-5 px-5 md:px-7 pt-3.5 pb-safe md:py-4 bg-surface border-t border-line rounded-b-2xl ${className}`}
    >
      <RecordButton
        isRecording={isRecording}
        onClick={onToggle}
        disabled={disabled}
        aria-label={isRecording ? `Recording, ${seconds} seconds. Tap to stop` : idleTitle}
        {...buttonProps}
      />
      <div className="flex-1 min-w-0" aria-live="polite">
        <span className={`block text-base font-semibold ${isRecording ? 'text-danger' : 'text-ink'}`}>
          {isRecording ? `Recording ${formatClock(seconds)}` : idleTitle}
        </span>
        <span className="block text-[13px] md:text-sm text-ink-muted mt-0.5">{isRecording ? recordingHint : idleHint}</span>
      </div>
      {isRecording && <LevelBars />}
      {children}
    </div>
  );
}

export default RecorderBar;
