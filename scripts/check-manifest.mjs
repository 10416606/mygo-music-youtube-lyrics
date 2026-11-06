import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const plugin = JSON.parse(fs.readFileSync(new URL('plugin.json', root)));
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root)));
assert.equal(plugin.id, 'youtube-music');
assert.equal(plugin.version, pkg.version, 'Keep package.json and plugin.json versions equal');
assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
assert.equal(plugin.main, 'index.js');
assert.ok(fs.existsSync(new URL(plugin.main, root)));
assert.deepEqual([...plugin.permissions.network].sort(), [
  'api.betterlyrics.org', 'lrclib.net', 'music.youtube.com', 's.youtube.com',
].sort());
console.log('Manifest and package version checks passed.');
