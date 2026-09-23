import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readLicence } from './licence.ts';

const ok = (stated: string, name: string): void => {
  const v = readLicence(stated);
  assert.ok(v.ok, `${stated} should be free: ${v.reason ?? ''}`);
  assert.equal(v.licence?.name, name);
};

const refused = (stated: string): void => {
  assert.equal(readLicence(stated).ok, false, `${stated} should be refused`);
};

test('free licences are accepted and keep the version they were stated in', () => {
  ok('CC0 1.0', 'CC0 1.0');
  ok('CC BY 4.0', 'CC BY 4.0');
  ok('CC BY-SA 3.0', 'CC BY-SA 3.0');
  ok('cc by-sa 4.0 DEED', 'CC BY-SA 4.0');
  ok('CC BY 2.0 FR', 'CC BY 2.0');
  ok('Public domain', 'Public domain');
  ok('No known copyright restrictions', 'Public domain');
});

// The whole reason this module exists: these arrive as typed strings from
// sources with no machine-readable licence, and each one reads plausibly.
test('non-commercial and no-derivatives are refused however they are worded', () => {
  refused('CC BY-NC 4.0');
  refused('CC BY-NC-SA 4.0');
  refused('CC BY-ND 4.0');
  refused('CC BY-NC-ND 3.0');
  refused('Noncommercial use only');
});

test('a non-licence phrase is never mistaken for a grant', () => {
  refused('free to use');
  refused('royalty free');
  refused('fair use');
  refused('educational use only');
  refused('all rights reserved');
  refused('unknown');
  refused('');
  refused('   ');
});

test('platform terms are accepted and marked as weaker than a CC grant', () => {
  const v = readLicence('Unsplash License');
  assert.ok(v.ok);
  assert.equal(v.licence?.platform, true);
  assert.equal(readLicence('Pexels').licence?.platform, true);
  assert.equal(readLicence('Pixabay Content License').licence?.platform, true);
});

test('share-alike is reported, because the derivative inherits it', () => {
  assert.equal(readLicence('CC BY-SA 4.0').licence?.shareAlike, true);
  assert.equal(readLicence('CC BY 4.0').licence?.shareAlike, false);
  assert.equal(readLicence('CC0 1.0').licence?.shareAlike, false);
});

test('an unrecognised name is refused rather than guessed at', () => {
  refused('CC SA 4.0');
  refused('GPL 3.0');
  refused('Creative Commons');
});
