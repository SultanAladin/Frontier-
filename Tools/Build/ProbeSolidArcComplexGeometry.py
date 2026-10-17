"""Native C++ constructed-solid stress sweep; no geometry repairs or live sessions.

Build each source once, validate its intermediate bodies, then run six final
operations (including reversed union/intersection), transactional checks and a
source save/reopen. Failures and source-construction blockers are retained.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import argparse
import os
import gzip
import hashlib
import json
import queue
import time
from ProbeSolidArcBroadGeometry import Native, topology, geometry_digest, frame_camera

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('SOLIDARC_COMPLEX_OUT',ROOT/'_AgentScratch/tmp/ComplexGeometry'))
MANIFEST=ROOT/'Experimental/SolidArc/Native/Fixtures/ComplexGeometry.json'
OPERATIONS=['union','union-ba','intersect','intersect-ba','subtract-ab','subtract-ba']


def store(key,packet,owner=None):
    if owner is not None:
        packet=dict(packet,frame=dict(packet['frame'],draws=[d for d in packet['frame']['draws'] if d.get('pick',0)&16383==owner]))
    with gzip.open(OUT/'packets'/f'{key}.json.gz','wt') as stream:json.dump(packet,stream)
    return f'{key}.json.gz'


def solid_report(packet):
    report=topology(packet)
    import re
    for name,pattern in [('hulls',r'hulls (\d+)'),('genus',r'genus (-?\d+)'),('faces',r'F(\d+)'),('edges',r'E(\d+)')]:
        found=re.search(pattern,report['summary']);report[name]=int(found[1]) if found else None
    return report


def run(fixture,timeout):
    started=time.monotonic();native=Native(timeout=timeout)
    result=dict(id=fixture['id'],label=fixture['label'],tags=fixture['tags'],commands=fixture['commands'],
                construction=[],cases=[],sourceOracles={'A':fixture['a'],'B':fixture['b']},status='running')
    phase='initialization';current=None
    try:
        native.request('create')
        previous=native.command('gizmo off','dim off','show cages off','select none','view iso')
        for index,step in enumerate(fixture['steps']):
            phase='construction';current=dict(index=index,command=step['command'],body=step['body'],target=step.get('target'))
            before=previous
            reply=native.command(step['command']);current['accepted']=bool(reply['success']);current['lines']=reply.get('lines',[])
            if not reply['success']:
                current['refusalPreserved']=before['description']['figures']==reply['description']['figures'] and geometry_digest(before)==geometry_digest(reply)
                current['packet']=store(fixture['id']+f'-construction-{index}-refused',reply)
                result['construction'].append(current)
                assert current['refusalPreserved'],'Source-construction refusal mutated geometry'
                result['status']='construction-refused';result['blockedAt']=index
                result['sourcePacket']=store(fixture['id']+'-partial-source',native.request('render',camera=frame_camera(reply)))
                break
            if step['body']:
                figure=next(f for f in reply['description']['figures'] if f['name']==step['target'])
                current.update(owner=figure['id'],oracle=step['oracle'])
                report=solid_report(native.command(f'topology #{figure["id"]} --summary'));current['topology']=report
                current['packet']=store(fixture['id']+f'-construction-{index}',reply,figure['id'])
                result['construction'].append(current)
                assert report['solid'] and report['volume']>0,'Source stage accepted invalid body'
            else:result['construction'].append(current)
            previous=reply
        if result['status']=='construction-refused':return result
        phase='source-baseline';current=None
        source=native.command('select none','view fit')
        source=native.request('render',camera=frame_camera(source))
        result['sourcePacket']=store(fixture['id']+'-source',source)
        result['sourceFigures']=source['description']['figures']
        operands={f['name']:f for f in source['description']['figures'] if f['name'] in ('A','B')}
        assert len(operands)==2,'Missing constructed A/B bodies'
        result['sourceOwners']={name:f['id'] for name,f in operands.items()}
        result['sourceTopology']={name:solid_report(native.command(f'topology #{f["id"]} --summary')) for name,f in operands.items()}
        source_digest=geometry_digest(source)
        for op in OPERATIONS:
            phase='final-boolean'
            reverse=op.endswith('-ba');verb='union' if op.startswith('union') else 'intersect' if op.startswith('intersect') else 'subtract'
            a,b=('B','A') if reverse else ('A','B')
            current=dict(id=fixture['id']+'-'+op,operation=op,command=f'boolean {verb} {a} -- {b} --name=Result --select-result',status='running')
            result['inFlight']=current
            reply=native.command(current['command']);current.update(accepted=bool(reply['success']),lines=reply.get('lines',[]))
            current['packet']=store(current['id'],reply)
            if not reply['success']:
                current['refusalPreserved']=reply['description']['figures']==source['description']['figures'] and geometry_digest(reply)==source_digest
                assert current['refusalPreserved'],'Final Boolean refusal mutated source'
                current['status']='refused'
            else:
                figure=next(f for f in reply['description']['figures'] if f['name']=='Result');current['owner']=figure['id']
                current['topology']=solid_report(native.command(f'topology #{figure["id"]} --summary'))
                assert current['topology']['solid'] and current['topology']['volume']>0,'Final Boolean accepted invalid topology'
                after=reply['description']['figures'];after_digest=geometry_digest(reply)
                undo=native.command('undo');assert undo['description']['figures']==source['description']['figures'] and geometry_digest(undo)==source_digest,'Boolean undo mismatch'
                redo=native.command('redo');assert redo['description']['figures']==after and geometry_digest(redo)==after_digest,'Boolean redo mismatch'
                undo=native.command('undo');assert undo['description']['figures']==source['description']['figures'],'Second undo mismatch'
                current.update(status='accepted',undoRedo=True)
            result['cases'].append(current);result.pop('inFlight',None)
        phase='source-save-reopen';current=None
        saved=native.request('save')['file'];opened=native.request('open',text=saved)
        assert opened['success'] and opened['description']['figures']==source['description']['figures'],'Constructed source save/reopen mismatch'
        result['saveReopen']=True;result['status']='completed'
    except queue.Empty:
        result.update(status='timeout',timeoutPhase=phase,reason=f'Native request exceeded {timeout} seconds; no rollback assertion for timed-out work.')
        if current:result['inFlight']=current
    except Exception as error:
        result.update(status='test-failed',phase=phase,reason=str(error))
        if current:result['inFlight']=current
    finally:
        result['seconds']=round(time.monotonic()-started,3);native.close()
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--workers',type=int,default=4);parser.add_argument('--timeout',type=int,default=45);parser.add_argument('--fixtures');parser.add_argument('--resume',action='store_true');args=parser.parse_args()
    manifest=json.loads(MANIFEST.read_text());fixtures=manifest['fixtures']
    if args.fixtures:fixtures=[f for f in fixtures if f['id'] in args.fixtures.split(',')]
    assert fixtures
    (OUT/'packets').mkdir(parents=True,exist_ok=True);results=[]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending=[]
        for fixture in fixtures:
            path=OUT/(fixture['id']+'.json')
            if args.resume and path.exists():results.append(json.loads(path.read_text()))
            else:pending.append(pool.submit(run,fixture,args.timeout))
        for future in as_completed(pending):
            row=future.result();results.append(row);(OUT/(row['id']+'.json')).write_text(json.dumps(row,indent=2))
            print(row['id'],row['status'],sum(c.get('accepted',False) for c in row['cases']),'/',len(row['cases']),row.get('reason',''),flush=True)
    results.sort(key=lambda row:row['id'])
    summary=dict(scope='Isolated native C++ constructed-source Boolean coverage; no solver repair; not mouse-input or universal-geometry proof.',fixtureCount=len(fixtures),plannedFinalBooleans=len(fixtures)*6,
                 attemptedFinalBooleans=sum(len(r['cases'])+(r['status']=='timeout' and r.get('timeoutPhase')=='final-boolean') for r in results),
                 completedFinalBooleans=sum(len(r['cases']) for r in results),engineAccepted=sum(c.get('accepted',False) for r in results for c in r['cases']),
                 constructionCommands=sum(len(r['construction']) for r in results),constructionBodies=sum(s.get('accepted',False) and s['body'] for r in results for s in r['construction']),
                 constructionBlocked=sum(r['status']=='construction-refused' for r in results),timeouts=sum(r['status']=='timeout' for r in results),testFailures=sum(r['status']=='test-failed' for r in results),
                 fixtures=results,manifestSha256=hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),nativeBinarySha256=hashlib.sha256((ROOT/'_AgentScratch/build/SolidArcNative/GeometryHost').read_bytes()).hexdigest())
    (OUT/'results.json').write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k!='fixtures'},indent=2))
    return 1 if summary['testFailures'] or summary['timeouts'] else 0


if __name__=='__main__':raise SystemExit(main())
