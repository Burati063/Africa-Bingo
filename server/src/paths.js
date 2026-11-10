import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(here, '..');
export const UPLOADS_DIR = path.join(SERVER_ROOT, 'uploads');
export const VOICE_DIR = path.join(UPLOADS_DIR, 'voice');
export const WEB_DIST = path.resolve(SERVER_ROOT, '..', 'web', 'dist');
