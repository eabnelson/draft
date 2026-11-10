import {test,expect} from 'bun:test';
import notes from '../release-notes.json';

// Installed apps show each title as one line of what's new, and reject a signed release with more
// than 12 notes or any over 300 characters (desktop/official-release.ts). Details stay on GitHub.
test('release notes are short titles with optional details',()=>{
  expect(Array.isArray(notes)).toBe(true);
  expect(notes.length).toBeGreaterThan(0);
  expect(notes.length).toBeLessThanOrEqual(12);
  for(const note of notes as {title:unknown;details?:unknown}[]){
    expect(typeof note.title).toBe('string');
    expect((note.title as string).length).toBeLessThanOrEqual(70);
    expect(note.title as string).not.toMatch(/\.$/);
    if(note.details!==undefined)expect(typeof note.details).toBe('string');
  }
});
