import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('manifest.json', 'dist/manifest.json');
await cp('offscreen.html', 'dist/offscreen.html');
