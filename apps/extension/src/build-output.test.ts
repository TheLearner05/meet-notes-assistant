import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension build output', () => {
  it('packages the manifest content script without ES module imports', async () => {
    const output = await readFile(resolve(process.cwd(), 'dist/content-script.js'), 'utf8');

    expect(output).not.toMatch(/^\s*import\s/m);
  });
});
