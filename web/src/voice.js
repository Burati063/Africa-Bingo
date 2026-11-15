import { letterFor } from './bingo.js';

// Amharic bingo calls are played from recorded male clips in
// public/audio/calls: one MP3 per number (1..75) plus the announcement
// phrases. A clip needs no speech engine, so every device — including
// Telegram's Android WebView, which ships no Amharic voice — hears the same
// male caller. Speech synthesis and the remote fallback below only run if a
// clip is missing.
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

// Recorded clips live next to the bundle, so the same files are served by
// Vite in development and by the API server in production.
const CLIP_BASE = `${String(import.meta.env?.BASE_URL || '/').replace(/\/$/, '')}/audio/calls`;

// Phrases that are recorded as clips instead of being spoken on the device.
const PHRASE_CLIPS = {
  'ጨዋታው ተጀመረ': 'start',
  'ቢንጎ': 'bingo',
};

// Deeper male tone for the synthesized fallback. The clips need no pitch
// change; this only shapes devices where the clip could not be fetched.
const VOICE_PITCH = 0.45;
const VOICE_RATE = 0.86;
const MALE_VOICE_HINT =
  /(male|man\b|dawit|david|abebe|abel|tesfaye|bereket|daniel|george|girma|haile|kebede|mulugeta|solomon|yohannes|ethan|alex\b|fred|tom\b)/i;
const FEMALE_VOICE_HINT =
  /(female|woman\b|sara|sarah|hanna|hana|selam|zoe|samantha|victoria|karen|moira|tessa|fiona|amira|marta|martha)/i;

let currentUtterance = null;
let currentAudio = null;
let primedVoice = null;
let priming = null;

const clipCache = new Map();
const missingClips = new Set();

function clipUrl(name) {
  return `${CLIP_BASE}/${name}.mp3`;
}

/** Cached <audio> element so a repeated call replays instantly. */
function clip(name) {
  const url = clipUrl(name);
  let audio = clipCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    clipCache.set(url, audio);
  }
  return audio;
}

function stopAudio() {
  if (!currentAudio) return;
  try {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
  currentAudio = null;
}

/**
 * Plays a recorded clip. When the file is missing or blocked, onFail runs so
 * the caller can fall back to another engine.
 */
function playClip(name, onFail) {
  const url = clipUrl(name);
  if (missingClips.has(url) || typeof Audio === 'undefined') {
    if (onFail) onFail();
    return false;
  }
  try {
    stopAudio();
    const audio = clip(name);
    audio.onerror = () => {
      missingClips.add(url);
      if (currentAudio === audio) currentAudio = null;
      if (onFail) onFail();
    };
    currentAudio = audio;
    audio.currentTime = 0;
    const played = audio.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        if (currentAudio === audio) currentAudio = null;
        if (onFail) onFail();
      });
    }
    return true;
  } catch {
    currentAudio = null;
    if (onFail) onFail();
    return false;
  }
}

/** Downloads the round's clips after the first user gesture for instant calls. */
export function preloadCallClips() {
  if (typeof Audio === 'undefined') return;
  for (let n = 1; n <= 75; n += 1) {
    if (missingClips.has(clipUrl(String(n)))) continue;
    try {
      clip(String(n)).load();
    } catch {
      /* ignore */
    }
  }
}

/** Plays the recorded male call for a number. */
export function playCallClip(number, onFail) {
  if (!number) {
    if (onFail) onFail();
    return false;
  }
  return playClip(String(number), onFail);
}

function chooseAmharicVoice(voices) {
  const amharic = (voices || []).filter(
    (voice) => /^am(-|$)/i.test(voice.lang) || /amharic|ethiop/i.test(voice.name),
  );
  if (!amharic.length) return null;
  return (
    amharic.find(
      (voice) => MALE_VOICE_HINT.test(voice.name) && !FEMALE_VOICE_HINT.test(voice.name),
    ) ||
    amharic.find((voice) => !FEMALE_VOICE_HINT.test(voice.name)) ||
    amharic[0]
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
 * Remote Amharic audio, used only when a recorded clip is unavailable and the
 * device has no Amharic speech voice.
 */
export function callAudioUrl(number) {
  const q = encodeURIComponent(amharicCall(number));
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=am&q=${q}`;
}

export function playRemoteCall(number, onFail) {
  if (typeof Audio === 'undefined') return false;
  try {
    stopAudio();
    const audio = new Audio(callAudioUrl(number));
    audio.preload = 'auto';
    // The remote clip is female; slow it down without pitch preservation so
    // the last-resort fallback still sounds male.
    audio.preservesPitch = false;
    audio.webkitPreservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.playbackRate = 0.75;
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      if (onFail) onFail();
    };
    currentAudio = audio;
    const played = audio.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        if (currentAudio === audio) currentAudio = null;
        if (onFail) onFail();
      });
    }
    return true;
  } catch {
    currentAudio = null;
    if (onFail) onFail();
    return false;
  }
}

export function stopCallAudio() {
  stopAudio();
}

/** Device speech synthesis, used only when no recorded clip is available. */
function speakText(text) {
  if (!text || !speechSupported()) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'am-ET';
    utterance.rate = VOICE_RATE;
    utterance.pitch = VOICE_PITCH;
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

/** Speaks any Amharic phrase, preferring its recorded clip when one exists. */
export function speakPhrase(text) {
  if (!text) return false;
  const clipName = PHRASE_CLIPS[text];
  if (clipName && playClip(clipName, () => speakText(text))) return true;
  return speakText(text);
}

export function speakCall(number) {
  return speakPhrase(amharicCall(number));
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
