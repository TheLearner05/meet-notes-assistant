import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/content-script.ts'], outfile: 'dist/content-script.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome109' }),
  build({ entryPoints: ['src/background.ts'], outfile: 'dist/background.js', bundle: true, format: 'esm', platform: 'browser', target: 'chrome109' }),
  build({ entryPoints: ['src/offscreen.ts'], outfile: 'dist/offscreen.js', bundle: true, format: 'esm', platform: 'browser', target: 'chrome109' }),
  build({ entryPoints: ['src/popup.ts'], outfile: 'dist/popup.js', bundle: true, format: 'esm', platform: 'browser', target: 'chrome109' }),
]);
await cp('manifest.json', 'dist/manifest.json');
await cp('offscreen.html', 'dist/offscreen.html');
await cp('popup.html', 'dist/popup.html');
