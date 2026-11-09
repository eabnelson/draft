import {test,expect} from 'bun:test';
import notes from '../release-notes.json';

// Installed apps reject a signed release whose notes break these limits (desktop/official-release.ts),
// so a release with a 13th note would never reach anyone.
test('release notes fit what installed apps accept',()=>{
  expect(Array.isArray(notes)).toBe(true);
  expect(notes.length).toBeGreaterThan(0);
  expect(notes.length).toBeLessThanOrEqual(12);
  for(const note of notes){expect(typeof note).toBe('string');expect(note.length).toBeLessThanOrEqual(300);}
});
