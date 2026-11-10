import { letterFor } from './bingo.js';

// Amharic spoken bingo calls. Admin-uploaded recordings take priority; when a
// number has no recording the browser speaks the call in Amharic (am-ET).
const ONES = [
  '', 'አንድ', 'ሁለት', 'ሶስት', 'አራት', 'አምስት', 'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ',
];
const TEENS = [
  'አስር', 'አስራ አንድ', 'አስራ ሁለት', 'አስራ ሶስት', 'አስራ አራት', 'አስራ አምስት',
  'አስራ ስድስት', 'አስራ ሰባት', 'አስራ ስምንት', 'አስራ ዘጠኝ',
];
const TENS = { 2: 'ሃያ', 3: 'ሰላሳ', 4: 'አርባ', 5: 'ሃምሳ', 6: 'ስልሳ', 7: 'ሰባ' };
const LETTERS = { B: 'ቢ', I: 'አይ', N: 'ኤን', G: 'ጂ', O: 'ኦ' };

export function amharicNumber(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(number ?? '');
  if (n < 10) return ONES[n] || 'ዜሮ';
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

export function amharicCall(number) {
  return `${LETTERS[letterFor(number)] || ''} ${amharicNumber(number)}`.trim();
}

let currentUtterance = null;
let remoteAudio = null;
let primedVoice = null;
let priming = null;

function chooseAmharicVoice(voices) {
  return (
    (voices || []).find((voice) => /^am(-|$)/i.test(voice.lang)) ||
    (voices || []).find((voice) => /amharic|ethiop/i.test(voice.name)) ||
    null
  );
}

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Cached Amharic voice; voices load asynchronously on most mobile browsers. */
export function pickAmharicVoice() {
  if (primedVoice) return primedVoice;
  if (!speechSupported()) return null;
  primedVoice = chooseAmharicVoice(window.speechSynthesis.getVoices());
  return primedVoice;
}

/** Waits briefly for the browser voice list, then caches an Amharic voice. */
export function primeVoices() {
  if (!speechSupported()) return Promise.resolve(null);
  if (primedVoice || priming) return priming || Promise.resolve(primedVoice);
  priming = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const finish = () => {
      primedVoice = chooseAmharicVoice(synth.getVoices());
      resolve(primedVoice);
    };
    if ((synth.getVoices() || []).length) {
      finish();
      return;
    }
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', finish, { once: true });
    }
    setTimeout(finish, 1200);
  });
  return priming;
}

/**
 * Remote Amharic audio for calls, used when the device has no Amharic speech
 * voice installed (common in Telegram's Android WebView).
 */
export function callAudioUrl(number) {
  const q = encodeURIComponent(amharicCall(number));
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=am&q=${q}`;
}

export function playRemoteCall(number, onFail) {
  if (typeof Audio === 'undefined') return false;
  try {
    stopCallAudio();
    remoteAudio = new Audio(callAudioUrl(number));
    remoteAudio.preload = 'auto';
    remoteAudio.onerror = () => {
      remoteAudio = null;
      if (onFail) onFail();
    };
    const played = remoteAudio.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        remoteAudio = null;
        if (onFail) onFail();
      });
    }
    return true;
  } catch {
    remoteAudio = null;
    if (onFail) onFail();
    return false;
  }
}

export function stopCallAudio() {
  if (!remoteAudio) return;
  try {
    remoteAudio.pause();
  } catch {
    /* ignore */
  }
  remoteAudio = null;
}

export function speakCall(number) {
  if (!speechSupported()) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(amharicCall(number));
    utterance.lang = 'am-ET';
    utterance.rate = 0.95;
    const voice = pickAmharicVoice();
    if (voice) utterance.voice = voice;
    currentUtterance = utterance;
    utterance.onend = () => {
      if (currentUtterance === utterance) currentUtterance = null;
    };
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
    currentUtterance = null;
  } catch {
    /* ignore */
  }
}
