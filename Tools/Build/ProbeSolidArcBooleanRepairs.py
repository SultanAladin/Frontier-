"""Boolean-only repair regression: leaves earlier broad report/packets untouched.

C++ kernel packets and transaction checks, not own-mouse or physical GPU proof.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import gzip
import hashlib
import json
import time
from ProbeSolidArcBroadGeometry import Native, topology, geometry_digest, frame_camera
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'_AgentScratch/tmp/GeometryRepairs/Broad'

def store(name,packet):
    with gzip.open(OUT/'packets'/name,'wt') as f:json.dump(packet,f)
    return name

def run(pair):
    fixture,op=pair;n=Native(timeout=45);key=fixture['id']+'-'+op
    row=dict(id=key,fixture=fixture['id'],operation=op,commands=fixture['commands'],stages={})
    try:
        n.request('create');source=n.command('reset',*fixture['commands'],'gizmo off','dim off','show cages off','select none','view iso','view fit')
        assert source['success'],source['lines']
        source=n.request('render',camera=frame_camera(source));row['stages']['source']=store(key+'-source.json.gz',source)
        sources={f['name']:f for f in source['description']['figures'] if f['name'] in ('A','B')};assert len(sources)==2
        verb=op if op in ('union','intersect') else 'subtract';a,b=('B','A') if op=='subtract-ba' else ('A','B')
        row['command']=f'boolean {verb} {a} -- {b} --select-result --name=Result'
        changed=n.command(row['command']);row['lines']=changed['lines'];row['accepted']=changed['success']
        if changed['success']:
            figure=next(f for f in changed['description']['figures'] if f['name']=='Result');row['owner']=figure['id']
            row['topology']=topology(n.command(f'topology #{figure["id"]} --summary'));assert row['topology']['solid']
            row['stages']['boolean']=store(key+'-boolean.json.gz',changed)
            assert n.command('undo')['description']['figures']==source['description']['figures']
            assert n.command('redo')['description']['figures']==changed['description']['figures'];row['undoRedo']=True
            saved=n.request('save')['file'];reopened=n.request('open',text=saved);assert reopened['success'] and reopened['description']['figures']==changed['description']['figures'];row['saveReopen']=True
        else:
            assert changed['description']['figures']==source['description']['figures'] and geometry_digest(changed)==geometry_digest(source)
            row['refusalPreserved']=True;row['stages']['boolean-refused']=store(key+'-refused.json.gz',changed)
        return row
    finally:n.close()

def main():
    (OUT/'packets').mkdir(parents=True,exist_ok=True)
    manifest=json.loads((ROOT/'Experimental/SolidArc/Native/Fixtures/BroadGeometry.json').read_text())
    pairs=[(f,op) for f in manifest['fixtures'] for op in manifest['operations']]
    started=time.monotonic()
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows=list(pool.map(run,pairs))
    original=json.loads((ROOT/'_AgentScratch/tmp/BroadGeometry/results.json').read_text())
    previously_accepted={r['id'] for r in original['cases'] if r.get('booleanAccepted')}
    accepted={r['id'] for r in rows if r['accepted']}
    result=dict(cases=rows,accepted=len(accepted),executed=len(rows),newAcceptances=sorted(accepted-previously_accepted),newRefusals=sorted(previously_accepted-accepted),nativeBinarySha256=hashlib.sha256((ROOT/'_AgentScratch/build/SolidArcNative/GeometryHost').read_bytes()).hexdigest(),seconds=round(time.monotonic()-started,2))
    (OUT/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='cases'},indent=2))

if __name__=='__main__':main()
