"""Portable evidence for Union/Subtract after the HTML Z-gizmo drag."""
from pathlib import Path
import base64
import html
import json

root = Path(__file__).resolve().parents[2]
folder = root / 'Exhibits/Gallery/Editor'
report = json.loads((folder / 'SolidArcZDraggedBooleansProof.json').read_text())
assert len(report['cases']) == 9 and not report['errors']
assert all(c['allThreeEnabled'] and c['mouseApply'] and c['undoRedo'] for c in report['cases'])
content = '''<!doctype html><meta charset="utf-8"><title>SolidArc · Z-dragged box booleans repaired</title>
<style>body{background:#202124;color:#ddd;font:16px system-ui;max-width:1400px;margin:40px auto;padding:0 20px}h1,h2{color:white}p,li{line-height:1.6}figure{margin:30px 0}img{width:100%;border:1px solid #555}figcaption{padding:12px;background:#292a2d}pre{white-space:pre-wrap;padding:16px;background:#292a2d}</style>
<h1>Z-dragged box Union & Subtract · fixed</h1>
<p>The user's live HTML document reproduced the failure: move SecondBody upward, select SecondBody then FirstBody; Union and Subtract were disabled with <b>“tangent or coincident faces (not transversal)”</b>, while Intersect worked. The previous integer-coordinate proofs missed this coplanar-side overlap.</p>
<p><b>Kernel repair:</b> use the exact coordinate arrangement of analytic axis-aligned boxes for non-rectangular unions and non-enclosed subtraction. Retain only exterior NURBS planar patches and sew a validated B-rep. No UI enablement override, triangle-mesh approximation or voxel approximation.</p>
<ul><li>49 C++ geometry tests pass, including both recorded drag matrices (Z=0.88750930276237883 and 1.2890083800837226), authored versus transformed boxes, both operand orders, all three operations, validation/volume/hulls, Undo/Redo and journal reopen.</li><li>9 HTML cases pass: actual mouse Z-gizmo drags plus both recorded matrices; actual Shift-Outliner selection and Inspector Apply for Union/Subtract/Intersect.</li><li>Native own-mouse Boolean proof passes Union42 / Subtract18 / Intersect6 / reverse Subtract18 with GPU ID picking.</li><li>Live backend upgraded with checkpoints: existing figure data, ordered selection and complete camera state preserved; the affected live session now reports all three operations enabled. Recovered journals do not preserve the previous in-memory undo/redo stack.</li></ul>'''
for name, caption in [('EditorProof_SolidArc_ZDraggedEnabled.png','Actual HTML mouse Z-drag, SecondBody → FirstBody selection: all three operation buttons enabled.'),('EditorProof_SolidArc_ZDraggedunion.png','Union applied through the HTML Inspector after actual gizmo dragging.'),('EditorProof_SolidArc_ZDraggedsubtract.png','Subtract applied through the HTML Inspector: SecondBody minus FirstBody.'),('EditorProof_SolidArc_ZDraggedintersect.png','Intersect applied through the HTML Inspector after the same Z drag.')]:
    content += '<figure><img src="data:image/png;base64,'+base64.b64encode((folder/name).read_bytes()).decode()+'" alt="'+html.escape(caption)+'"><figcaption>'+html.escape(caption)+'</figcaption></figure>'
content += '<h2>Browser measurements</h2><pre>'+html.escape(json.dumps(report,indent=2))+'</pre>'
output=folder/'SolidArcZDraggedBooleansProof.html'
output.write_text(content)
print(output,output.stat().st_size)
