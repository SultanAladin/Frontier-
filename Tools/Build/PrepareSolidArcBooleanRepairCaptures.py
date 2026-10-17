"""Reuse the isolated native/HTML capture harness without overwriting old reports."""
from pathlib import Path
import json
import shutil
ROOT=Path(__file__).resolve().parents[2]
FOLDER=ROOT/'_AgentScratch/tmp/GeometryRepairs'
OUT=FOLDER/'UI'
(OUT/'packets').mkdir(parents=True,exist_ok=True)
broad=json.loads((FOLDER/'Broad/results.json').read_text());fixtures=[];cases=[]
for fixture_id in ['cone-box','torus-box']:
    rows=[r for r in broad['cases'] if r['fixture']==fixture_id]
    fixture=dict(id='repair-'+fixture_id,sourcePacket=rows[0]['stages']['source'],construction=[],cases=[])
    for row in rows:
        for file in row['stages'].values():shutil.copyfile(FOLDER/'Broad/packets'/file,OUT/'packets'/file)
        fixture['cases'].append(dict(id='repair-'+row['id'],accepted=row['accepted'],packet=row['stages'].get('boolean')))
        cases.append(dict(id='repair-'+row['id'],fixture=fixture['id'],commands=row['commands'],sourceReady=True,expectedSetupRefusal=False,booleanCommand=row['command'],accepted=row['accepted'],operation=row['operation'],ui=fixture_id=='cone-box' or row['id']=='torus-box-union',topology=row.get('topology')))
    fixtures.append(fixture)
(OUT/'results.json').write_text(json.dumps(dict(fixtures=fixtures,nativeBinarySha256=broad['nativeBinarySha256'])))
(OUT/'capture-plan.json').write_text(json.dumps(dict(prefix='GeometryRepairs',expectedSources=2,expectedUI=5,cases=cases),indent=2))
print('2 source pairs; 8 final observations; 5 own-mouse checks per UI')
