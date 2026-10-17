"""Build/run focused native Boolean regressions without touching live sessions."""
from pathlib import Path
import json
import subprocess
import sys
from ProofPng import compressed_png
ROOT=Path(__file__).resolve().parents[2]
subprocess.run([sys.executable,'Experimental/SolidArc/Native/CompileSequence.py','--native'],cwd=ROOT,check=True)
source=ROOT/'Editor/AuthoringTools/Modelling/SolidArc'
work=ROOT/'_AgentScratch/tmp/GeometryRepairs'
out=work/'legacy';out.mkdir(parents=True,exist_ok=True)
objects=[str(p) for p in (ROOT/'_AgentScratch/build/SolidArcNative').glob('*.o') if p.stem not in ('GeometryHost','GeometryExchange')]
names=['IntersectionVerification','BooleanCylinderSeamVerification','BooleanIdentityVerification','BooleanEquivalenceVerification','BooleanContactVerification','BodyOpsVerification','BooleanBoundaryKnotVerification']
results=[]
for name in names:
    target=out/name
    subprocess.run(['g++','-std=c++20','-O2','-I'+str(source),'-DSOLIDARC_PROOF_FOLDER="'+str(out)+'"',str(source/'Verification'/(name+'.cpp')),*objects,'-o',str(target)],cwd=ROOT,check=True)
    log=work/'native-regression.log' if name==names[-1] else out/(name+'.log')
    with log.open('w') as f:result=subprocess.run([str(target)],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,timeout=100)
    summary=log.read_text().splitlines()[-2]
    row=dict(name=name,exitCode=result.returncode,summary=summary);print(row,flush=True)
    if name!=names[-1]:results.append(row)
    if result.returncode:raise RuntimeError(f'Native regression failed: {log}')
(work/'legacy.json').write_text(json.dumps(results,indent=2)+'\n')
for path in out.glob('*.png'):
    packed=compressed_png(path.read_bytes())
    if len(packed)<path.stat().st_size:path.write_bytes(packed)
