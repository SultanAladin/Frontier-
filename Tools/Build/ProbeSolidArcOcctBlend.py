"""Isolated native command-level investigation, NOT native-mouse / HTML proof.

Known refusals are reported explicitly; exits nonzero until all six are repaired.
No live session is contacted. Build GeometryHost and the optional worker first.
"""
from pathlib import Path
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ['reset', 'box (0,0,0) (4,3,2)', 'box (2,0,0) (6,3,2)',
           'sphere (0,0,0) .75', 'boolean subtract #3 -- #1 --select-result']


def main():
    environment = os.environ.copy()
    worker = ROOT / '.cache/solidarc-occt/BlendHost'
    environment.setdefault('SOLIDARC_OCCT_BLEND_HOST', str(worker))
    process = subprocess.Popen([str(ROOT / '_AgentScratch/build/SolidArcNative/GeometryHost')],
                               cwd=ROOT, env=environment, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, text=True)

    def request(action='command', **values):
        process.stdin.write(json.dumps(dict(action=action, **values)) + '\n')
        process.stdin.flush()
        lines = []
        for line in process.stdout:
            if line.startswith('SOLIDARC_PACKET '):
                response = json.loads(line[len('SOLIDARC_PACKET '):])
                if 'error' in response:
                    raise RuntimeError(response['error'])
                return response, lines
            lines.append(line.strip())
        raise RuntimeError('Native process exited before responding')

    results = []
    try:
        request('create')
        for selection in ['5', '3', '2', '3,2', '5,4', '4,5,6']:
            initial, _ = request(commands=FIXTURE)
            assert initial['success'], 'Fixture construction failed'
            before = initial['description']['figures']
            response, lines = request(commands=[f'beveladd .0375 --mode=fillet --targets=4:e{selection}'])
            accepted = response['success']
            if accepted:
                changed = response['description']['figures']
                assert changed != before, 'Accepted blend did not change geometry'
                undone, _ = request(commands=['undo'])
                assert undone['success'] and undone['description']['figures'] == before, 'Undo mismatch'
                redone, _ = request(commands=['redo'])
                assert redone['success'] and redone['description']['figures'] == changed, 'Redo mismatch'
            else:
                assert response['description']['figures'] == before, 'Refusal mutated geometry'
            result = dict(selection=selection, accepted=accepted, undoRedo=accepted,
                          refusalPreservedGeometry=not accepted, console=lines)
            results.append(result)
            print(selection, 'ACCEPTED + undo/redo' if accepted else 'REFUSED safely', flush=True)
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdout.close()
    destination = ROOT / '_AgentScratch/tmp/OcctBlendProbe.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(dict(scope='native command only; no mouse or UI proof',
                                           cases=results), indent=2) + '\n')
    print(f'{sum(item["accepted"] for item in results)}/{len(results)} accepted; {destination}')
    if not all(item['accepted'] for item in results):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
