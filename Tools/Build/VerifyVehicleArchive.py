#!/usr/bin/env python3
"""Verify pinned vehicle source bytes/history without installing or running either app."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'Experimental/VehicleHmiPrototype/UPSTREAM_MANIFEST.json'


def main():
    record = json.loads(MANIFEST.read_text())
    for item in record['files']:
        data = (ROOT / item['path']).read_bytes()
        assert len(data) == item['bytes'], f"Size mismatch: {item['path']}"
        assert hashlib.sha256(data).hexdigest() == item['sha256'], f"SHA-256 mismatch: {item['path']}"
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        assert blob == item['gitBlob'], f"Git blob mismatch: {item['path']}"
    for commit in (record['commit'], record['originalReSTIRCommit']):
        subprocess.run(['git', 'cat-file', '-e', commit + '^{commit}'], cwd=ROOT, check=True)
        subprocess.run(['git', 'merge-base', '--is-ancestor', commit, 'HEAD'], cwd=ROOT, check=True)
    entries = subprocess.check_output(['git', 'ls-tree', '-rz', record['commit'], '--', *record['scope']], cwd=ROOT)
    expected = {item['path']: item['gitBlob'] for item in record['files']}
    actual = {}
    for entry in entries.split(b'\0'):
        if entry:
            metadata, path = entry.split(b'\t', 1)
            actual[path.decode()] = metadata.decode().split()[2]
    assert actual == expected, 'Manifest does not cover the complete pinned application directories'
    print(f"PASS: {len(expected)} unchanged vehicle/configurator files; both upstream histories reachable from HEAD")


if __name__ == '__main__':
    main()
