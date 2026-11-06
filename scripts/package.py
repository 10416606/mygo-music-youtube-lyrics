#!/usr/bin/env python3
"""Build only distributable plugin files; never bundle local account data."""
import argparse
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--tag', help='Require a matching vX.Y.Z release tag')
args = parser.parse_args()
manifest = json.loads((root / 'plugin.json').read_text())
package = json.loads((root / 'package.json').read_text())
if package['version'] != manifest['version']:
    raise SystemExit('package.json and plugin.json versions differ')
if args.tag and args.tag != 'v' + manifest['version']:
    raise SystemExit('Release tag does not match plugin.json version')
files = ['index.js', 'plugin.json', 'README.md', 'README.upstream.md', 'NOTICE.md', 'CHANGELOG.md']
for name in files:
    if not (root / name).is_file():
        raise SystemExit('Missing distributable file: ' + name)
output = root / 'dist' / 'plugin.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, manifest['id'] + '/' + name)
print('Built', output)
