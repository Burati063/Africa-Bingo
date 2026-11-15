// Regenerates the recorded male Amharic clips in web/public/audio/calls.
//
//   AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=eastus npm run voice:generate
//
// Voice: am-ET-AmehaNeural (native Amharic, male) from Azure Speech, which has
// a free F0 tier that covers 77 short clips many times over. The app falls
// back to browser speech if these files are absent, so the build works without
// ever running this script.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { amharicCall } from '../src/voice.js';

const VOICE = 'am-ET-AmehaNeural';
const CONCURRENCY = 3;
const PHRASES = [
  { file: 'start', text: 'ጨዋታው ተጀመረ' },
  { file: 'bingo', text: 'ቢንጎ' },
];

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'public', 'audio', 'calls');

const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region) {
  console.error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (e.g. eastus) first.');
  process.exit(1);
}

function ssml(text) {
  return `<speak version="1.0" xml:lang="am-ET"><voice name="${VOICE}">${text}</voice></speak>`;
}

async function synthesize(text, file) {
  const body = ssml(text);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ethio-bingo',
      },
      body,
    });
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(outDir, `${file}.mp3`), buffer);
      return;
    }
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      continue;
    }
    throw new Error(`${text}: ${res.status} ${await res.text()}`);
  }
  throw new Error(`${text}: retries exhausted`);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const jobs = [
    ...Array.from({ length: 75 }, (_, i) => ({ file: String(i + 1), text: amharicCall(i + 1) })),
    ...PHRASES,
  ];
  console.log(`Writing ${jobs.length} clips to ${outDir}`);

  let done = 0;
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const job = queue.shift();
        await synthesize(job.text, job.file);
        done += 1;
        if (done % 10 === 0) console.log(`  ${done}/${jobs.length}`);
      }
    }),
  );
  console.log(`Done: ${jobs.length} clips.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
