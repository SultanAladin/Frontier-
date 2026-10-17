"""Flatten construction/results into trusted native capture instructions."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'_AgentScratch/tmp/ComplexGeometry'
results=json.loads((OUT/'results.json').read_text())
ui={'concave-l-notched-union','thin-u-comb-intersect','near-coincident-u-subtract-ab','twin-bore-fork-union'}
rows=[]
for fixture in results['fixtures']:
    if fixture['status']=='construction-refused':
        rows.append(dict(id=fixture['id']+'-construction-refused',fixture=fixture['id'],commands=[s['command'] for s in fixture['construction']],sourceReady=False,expectedSetupRefusal=True,ui=False))
    else:
        assert fixture['status']=='completed',fixture['id']
        for row in fixture['cases']:
            rows.append(dict(id=row['id'],fixture=fixture['id'],commands=fixture['commands'],sourceReady=True,expectedSetupRefusal=False,booleanCommand=row['command'],accepted=row['accepted'],operation=row['operation'],ui=row['id'] in ui,topology=row.get('topology')))
assert sum(r['ui'] for r in rows)==4
(OUT/'capture-plan.json').write_text(json.dumps(dict(cases=rows),indent=2))
print(len(rows),'native rows;',sum(r['sourceReady'] for r in rows),'final Boolean captures; 24 source captures; 4 own-input cases')
