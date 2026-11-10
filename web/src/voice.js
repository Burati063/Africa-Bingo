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

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function pickAmharicVoice() {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => /^am(-|$)/i.test(voice.lang)) ||
    voices.find((voice) => /amharic|ethiop/i.test(voice.name)) ||
    null
  );
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
