#!/usr/bin/env python3
"""Build and check exact native mixed-rim geometry; optionally use the full user journal."""
import json
from pathlib import Path
import subprocess
import sys
Root=Path(__file__).resolve().parents[2]
subprocess.run([sys.executable,'Experimental/SolidArc/Native/CompileSequence.py','--native'],cwd=Root,check=True)
Folder=Root/'_AgentScratch/build/SolidArcNative'
Target=Folder/'CapRimProof'
Objects=sorted(str(P) for P in Folder.glob('*.o') if P.name not in ('GeometryHost.o','GeometryExchange.o'))
subprocess.run(['g++','-std=c++20','-O1','-IEditor/AuthoringTools/Modelling/SolidArc','Exhibits/Workbench/Editor/SolidArcCapRimProof.cpp',*Objects,'-o',str(Target)],cwd=Root,check=True)
Result=subprocess.run([str(Target),*sys.argv[1:]],cwd=Root,text=True,capture_output=True,check=True)
Report=json.loads(Result.stdout.splitlines()[-1])
Out=Root/'Exhibits/Gallery/Editor/SolidArcKernelCornerProof.json'
Out.parent.mkdir(parents=True,exist_ok=True);Out.write_text(json.dumps(Report,indent=2))
print(json.dumps(Report,indent=2))
