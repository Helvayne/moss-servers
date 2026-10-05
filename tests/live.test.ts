import { describe, expect, it } from 'vitest';
import { checkAll } from '../src/lib/status';

// Pings the real servers. Run with: LIVE=1 npx vitest run tests/live.test.ts
describe.skipIf(!process.env.LIVE)('live servers', () => {
  it('answers for the public addresses without player names', async () => {
    const out = await checkAll(
      [
        { id: 'cogsandcurses', address: 'cogsandcurses.justinhere.net' },
        { id: 'vanilla', address: 'mc.justinhere.net' },
      ],
      3000,
    );
    console.log(out);
    expect(Object.keys(out)).toEqual(['cogsandcurses', 'vanilla']);
    expect(JSON.stringify(out)).not.toMatch(/sample|"name"/);
  }, 15000);
});
