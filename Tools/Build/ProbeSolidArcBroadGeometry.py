"""Broad native C++ Boolean/blend coverage with failures retained, not hidden.

Independent headless native processes only: never contacts a live user session.
Command-level evidence; the separate capture/UI harness labels input provenance.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
import gzip
import hashlib
import json
import math
import os
import queue
import re
import signal
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'Experimental/SolidArc/Native/Fixtures/BroadGeometry.json'
OUT = ROOT / '_AgentScratch/tmp/BroadGeometry'


class Native:
    def __init__(self, timeout=100):
        self.timeout=timeout
        env = os.environ.copy()
        env['SOLIDARC_OCCT_BLEND_HOST'] = str(ROOT / '.cache/solidarc-occt/BlendHost')
        self.process = subprocess.Popen([str(ROOT / '_AgentScratch/build/SolidArcNative/GeometryHost')],
                                       cwd=ROOT, env=env, text=True, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        self.replies = queue.Queue()
        def collect():
            lines=[]
            for line in self.process.stdout:
                if line.startswith('SOLIDARC_PACKET '):
                    reply=json.loads(line[16:]);reply['lines']=reply.get('lines') or lines
                    self.replies.put(reply);lines=[]
                else:lines.append(line.strip())
            self.replies.put(None)
        threading.Thread(target=collect, daemon=True).start()

    def request(self, action='command', **values):
        self.process.stdin.write(json.dumps(dict(action=action, width=1000, height=760, **values))+'\n')
        self.process.stdin.flush()
        reply = self.replies.get(timeout=self.timeout)
        if reply is None: raise RuntimeError(f'native process exited ({self.process.poll()})')
        if 'error' in reply: raise RuntimeError(reply['error'])
        return reply

    def command(self, *commands):
        return self.request(commands=list(commands))

    def close(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait()
        self.process.stdin.close()
        self.process.stdout.close()


def topology(packet):
    lines = packet.get('lines', [])
    summary = next((line for line in lines if 'closed ' in line and 'volume ' in line), '')
    volume = re.search(r'volume ([0-9.eE+-]+)', summary)
    return dict(solid='closed yes manifold yes oriented yes' in summary,
                volume=float(volume[1]) if volume else None, summary=summary)


def geometry_digest(packet):
    return hashlib.sha256(json.dumps(packet['frame']['draws'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def save_packet(key, stage, packet):
    name = f'{key}-{stage}.json.gz'
    with gzip.open(OUT / 'packets' / name, 'wt') as stream: json.dump(packet, stream)
    return name


def frame_camera(packet):
    # Fit actual native draw vertices, not conservative rational control poles.
    lo, hi = [math.inf]*3, [-math.inf]*3
    for draw in packet['frame']['draws']:
        if not (draw.get('pick', 0) & 16383) or draw.get('kind') not in ('mesh', 'line', 'surface'): continue
        positions = draw.get('positions', [])
        for i, value in enumerate(positions):
            k = i % 3; lo[k] = min(lo[k], value); hi[k] = max(hi[k], value)
    camera = dict(packet['description']['camera'])
    if all(math.isfinite(v) for v in lo+hi):
        span = max(hi[i]-lo[i] for i in range(3))
        camera.update(pivot=[(lo[i]+hi[i])*.5 for i in range(3)], distance=max(.01, span*2.6), reach=max(.01, span*1.35), yaw=-.7853981633974483, pitch=.65)
    return camera


def run_case(fixture, operation):
    started = time.monotonic()
    key = fixture['id']+'-'+operation
    result = dict(id=key, fixture=fixture['id'], label=fixture['label'], operation=operation,
                  commands=fixture['commands'], scale=fixture.get('scale', 1), stages={}, blends=[], skippedSeams=[])
    native = Native()
    try:
        native.request('create')
        source = native.command('reset', *fixture['commands'], 'gizmo off', 'dim off', 'show cages off', 'select none', 'view iso', 'view fit')
        if not source['success']:
            result.update(status='setup-failed', reason=source.get('lines', [])); return result
        source = native.request('render', camera=frame_camera(source))
        result['stages']['source'] = save_packet(key, 'source', source)
        operands = {f['name']: f for f in source['description']['figures'] if f['name'] in ('A', 'B')}
        assert len(operands) == 2 and all(f['classification'] == 2 for f in operands.values()), 'A/B must both be solid bodies'
        result['sourceTopology'] = {name: topology(native.command(f'topology #{f["id"]} --summary')) for name, f in operands.items()}
        before_file = native.request('save')['file']
        verb = operation if operation in ('union', 'intersect') else 'subtract'
        a, b = ('B', 'A') if operation == 'subtract-ba' else ('A', 'B')
        command = f'boolean {verb} {a} -- {b} --select-result --name=Result'
        result['booleanCommand'] = command
        changed = native.command(command)
        result['booleanLines'] = changed.get('lines', [])
        if not changed['success']:
            after_file=native.request('save')['file']
            # Execute() re-emits display dimensions even after a refused command.
            # Compare model geometry and journal without that harmless display line.
            journal=lambda text:[line for line in text.splitlines() if line.strip()!='dim auto']
            intact = changed['description']['figures'] == source['description']['figures'] and geometry_digest(changed)==geometry_digest(source) and journal(after_file)==journal(before_file)
            result['displayJournalReemitted'] = after_file != before_file
            result.update(status='boolean-refused', refusalPreserved=intact)
            assert intact, 'Boolean refusal mutated the source'
            result['stages']['boolean-refused'] = save_packet(key, 'boolean-refused', changed)
            return result
        figures = changed['description']['figures']
        body = next(f for f in figures if f['name'] == 'Result')
        owner = body['id']; result['owner'] = owner
        report = topology(native.command(f'topology #{owner} --summary'))
        result['topology'] = report
        assert report['solid'] and report['volume'] > 0, report
        a_volume = result['sourceTopology'][a]['volume']; b_volume = result['sourceTopology'][b]['volume']
        tolerance = .01*(a_volume+b_volume)  # native tessellated volume, explicitly approximate
        low, high = (max(a_volume,b_volume),a_volume+b_volume) if verb=='union' else ((0,min(a_volume,b_volume)) if verb=='intersect' else (0,a_volume))
        result['volumeBounds'] = low-tolerance <= report['volume'] <= high+tolerance
        assert result['volumeBounds'], 'Boolean output violates coarse volume inclusion bounds'
        result['booleanAccepted']=True
        result['stages']['boolean'] = save_packet(key, 'boolean', changed)
        undone = native.command('undo'); assert undone['description']['figures'] == source['description']['figures'], 'Boolean undo mismatch'
        redone = native.command('redo'); assert redone['description']['figures'] == figures, 'Boolean redo mismatch'
        result['booleanUndoRedo'] = True
        edges_packet = native.command(f'topology #{owner}')
        candidates, endpoints = [], {}
        for line in edges_packet.get('lines', []):
            match = re.search(r'\be(\d+)\s+v(\d+)→v(\d+).*coedges\[([^]]*)', line)
            if not match: continue
            edge = int(match[1]); faces = set(re.findall(r'f(\d+)', match[4]))
            endpoints[edge] = {int(match[2]),int(match[3])}
            if len(faces) == 1: result['skippedSeams'].append(edge)
            elif len(faces) == 2: candidates.append(edge)
        result['eligibleEdges'] = candidates
        chosen = [candidates[i] for i in sorted({0,len(candidates)-1})] if candidates else []
        result['sampledEdges'] = chosen
        tests = [(str(edge), mode, .025) for edge in chosen for mode in ('fillet','chamfer')]
        if chosen: tests += [(str(chosen[0]),mode,.01) for mode in ('fillet','chamfer')]
        adjacent = next(((x,y) for i,x in enumerate(candidates) for y in candidates[i+1:] if endpoints[x]&endpoints[y]), None)
        if adjacent: tests += [(f'{adjacent[0]},{adjacent[1]}',mode,.025) for mode in ('fillet','chamfer')]
        for targets, mode, relative in tests:
            size = relative*fixture.get('scale',1)
            before = native.request('render'); before_digest = geometry_digest(before)
            step = dict(targets=targets, mode=mode, size=size, multiple=',' in targets)
            result['inFlightBlend']=dict(step)
            blend = native.command(f'beveladd {size:.12g} --mode={mode} --targets={owner}:e{targets}')
            step['accepted'] = bool(blend['success']); step['lines'] = blend.get('lines', [])
            if blend['success']:
                checked = topology(native.command(f'topology #{owner} --summary'))
                assert checked['solid'] and checked['volume']>0, checked
                step['topology'] = checked
                assert geometry_digest(blend) != before_digest, 'Blend accepted without changed draw geometry'
                if mode not in result['stages']:
                    result['stages'][mode] = save_packet(key, mode, blend)
                    step['visual'] = True
                after = blend['description']['figures']
                undone = native.command('undo'); assert undone['description']['figures']==before['description']['figures'], 'Blend undo mismatch'
                assert geometry_digest(undone)==before_digest, 'Blend undo geometry mismatch'
                redone = native.command('redo'); assert redone['description']['figures']==after, 'Blend redo mismatch'
                assert native.command('undo')['description']['figures']==before['description']['figures']
                step['undoRedo'] = True
            else:
                step['refusalPreserved'] = blend['description']['figures']==before['description']['figures'] and geometry_digest(blend)==before_digest
                assert step['refusalPreserved'], 'Refused blend mutated geometry'
                if mode+'-refused' not in result['stages']:
                    result['stages'][mode+'-refused'] = save_packet(key, mode+'-refused', blend)
            result['blends'].append(step)
            result.pop('inFlightBlend',None)
        saved = native.request('save')['file']
        reopened = native.request('open', text=saved)
        assert reopened['success']
        # Compare to the Boolean baseline, not merely two successive reopen packets.
        assert reopened['description']['figures']==figures, 'Boolean save/reopen changed figures'
        result['saveReopen'] = True
        result['status'] = 'boolean-accepted'
    except queue.Empty:
        result.update(status='timeout', reason='Native request exceeded 100 seconds; no rollback assertion is made for a timed-out process.')
    except Exception as error:
        result.update(status='test-failed', reason=str(error))
    finally:
        result['seconds'] = round(time.monotonic()-started,3)
        native.close()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--resume',action='store_true',help='Reuse completed cases; rerun setup/test failures, retaining timeout evidence')
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--fixtures',help='Comma-separated fixture ids for targeted reproduction')
    args = parser.parse_args()
    manifest = json.loads(FIXTURES.read_text()); fixtures=manifest['fixtures']
    if args.fixtures: fixtures=[f for f in fixtures if f['id'] in args.fixtures.split(',')]
    assert fixtures, 'No matching fixtures'
    (OUT/'packets').mkdir(parents=True,exist_ok=True)
    results=[]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending={}
        for fixture in fixtures:
            for op in manifest['operations']:
                path=OUT/(fixture['id']+'-'+op+'.json')
                existing=json.loads(path.read_text()) if args.resume and path.exists() else None
                if existing and existing['status'] not in ('test-failed','setup-failed'):
                    existing['booleanAccepted']='boolean' in existing['stages']
                    results.append(existing)
                else:pending[pool.submit(run_case,fixture,op)]=(fixture['id'],op)
        for future in as_completed(pending):
            row=future.result(); results.append(row)
            (OUT/(row['id']+'.json')).write_text(json.dumps(row,indent=2))
            print(row['id'],row['status'],sum(b['accepted'] for b in row['blends']), '/',len(row['blends']),row.get('reason',''),flush=True)
    results.sort(key=lambda r:r['id'])
    by_fixture={}
    for row in results: by_fixture.setdefault(row['fixture'],{})[row['operation']]=row
    identities=[]
    for name, group in by_fixture.items():
        if len(group)!=4 or any(r['status']!='boolean-accepted' for r in group.values()): continue
        v={op:r['topology']['volume'] for op,r in group.items()}
        a=group['union']['sourceTopology']['A']['volume'];b=group['union']['sourceTopology']['B']['volume']
        errors=[abs(v['union']+v['intersect']-a-b),abs(v['subtract-ab']+v['intersect']-a),abs(v['subtract-ba']+v['intersect']-b)]
        identities.append(dict(fixture=name,absoluteErrors=errors,tolerance=.01*(a+b),passed=max(errors)<=.01*(a+b)))
    summary=dict(scope='Isolated native C++ command-level coverage; not universal geometry certification or mouse-input proof.',
                 cases=results,volumeIdentities=identities,fixtureCount=len(fixtures),
                 booleanAccepted=sum(bool(r.get('booleanAccepted')) for r in results),booleanTotal=len(results),
                 blendAccepted=sum(b['accepted'] for r in results for b in r['blends']),blendTotal=sum(len(r['blends']) for r in results),
                 failures=sum(r['status'] in ('test-failed','setup-failed','timeout') for r in results))
    (OUT/'results.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps({k:v for k,v in summary.items() if k not in ('cases','volumeIdentities')},indent=2))
    return 1 if summary['failures'] else 0


if __name__=='__main__': raise SystemExit(main())
