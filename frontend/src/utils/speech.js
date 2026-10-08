// One place for every "read this out loud" feature (sample reading, tutor voice,
// word pronunciation). Always speaks General American English (en-US), whatever
// language the phone itself is set to.

const LANG = 'en-US';

// Best-known clear, neutral American voices, in order of preference.
const PREFERRED_VOICES = [
  /^Google US English/i,                       // Chrome (desktop)
  /Microsoft (Aria|Jenny|Ava|Emma|Guy|Andrew).*(Natural|Online)/i, // Edge
  /^Samantha/i,                                // iPhone / iPad / Mac
  /^(Ava|Allison|Evan|Nathan|Tom|Susan|Zoe|Joelle|Noelle|Aaron|Nicky)\b/i, // Apple
  /^Alex$/i,
  /Microsoft (Zira|David|Mark)/i,              // Windows offline voices
  /English.*(United States|US)/i,              // Android system voice
];

// Apple ships joke/character voices tagged as en-US. Never use them.
const NOVELTY_VOICES = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Princess|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;

export const speechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';

// Android reports "en_US", others "en-US".
const normLang = (voice) => String(voice?.lang || '').replace('_', '-').toLowerCase();

let cachedVoice = null;

/** Pick the clearest American English voice this device has (null = let the device choose). */
export function pickEnglishVoice() {
  if (!speechSupported()) return null;
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null; // not loaded yet; utterance.lang still forces English

  const american = voices.filter((v) => normLang(v) === 'en-us' && !NOVELTY_VOICES.test(v.name));
  let chosen = null;
  for (const pattern of PREFERRED_VOICES) {
    chosen = american.find((v) => pattern.test(v.name));
    if (chosen) break;
  }
  chosen = chosen
    || american.find((v) => v.default)
    || american[0]
    // No American voice installed: any other English voice is still better than Indonesian.
    || voices.find((v) => normLang(v).startsWith('en') && !NOVELTY_VOICES.test(v.name))
    || null;
  cachedVoice = chosen;
  return chosen;
}

// Voices load asynchronously on most browsers: warm the list up early so the
// first tap already has the right voice.
if (speechSupported()) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      cachedVoice = null;
      pickEnglishVoice();
    });
  } catch { /* ignore */ }
}

// Some browsers cut off a long utterance after ~15 seconds, so speak sentence by sentence.
function splitSentences(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= 180) return [clean];
  return clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g).map((s) => s.trim()).filter(Boolean);
}

export function stopSpeaking() {
  if (!speechSupported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

/**
 * Speak English text. Must be called directly from a tap/click (iPhone requirement).
 * Returns false when the browser cannot speak at all.
 */
export function speakEnglish(text, { rate = 0.9, onEnd } = {}) {
  if (!speechSupported()) return false;
  const parts = splitSentences(text);
  if (!parts.length) return false;

  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickEnglishVoice();

  parts.forEach((part, idx) => {
    const utterance = new window.SpeechSynthesisUtterance(part);
    utterance.lang = LANG;            // the important line: never fall back to the phone language
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 1;
    if (idx === parts.length - 1 && onEnd) {
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
    }
    synth.speak(utterance);
  });
  return true;
}

/** Pronounce a single word slowly and clearly. */
export function speakWord(word, options = {}) {
  return speakEnglish(String(word || '').trim(), { rate: 0.8, ...options });
}
