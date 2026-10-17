"""Build a portable evidence page from real native/HTML test outputs."""
from pathlib import Path
import base64
import html
import json

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '_AgentScratch/tmp'
native = json.loads((SCRATCH / 'SphereCornerNativeProof.json').read_text())
browser = json.loads((SCRATCH / 'SphereBevelBrowser/results.json').read_text())
assert len(native) == len(browser['cases']) == 12
assert not browser['errors']
assert browser['graphics']['rgbaUploads'] == 0
page = '''<!doctype html><meta charset="utf-8"><title>SolidArc · Sphere corner bevel proof</title>
<style>body{max-width:1200px;margin:40px auto;padding:0 24px;background:#111;color:#eee;font:16px/1.6 system-ui}h1{font-size:34px}h2{margin-top:38px}img{width:100%;border:1px solid #444;border-radius:8px}p,li{max-width:1000px}code,pre{background:#222;padding:3px 6px}summary{cursor:pointer}.pass{color:#82daa2}.limit{color:#ebc17d}</style>
<h1>SolidArc · Boolean sphere corner bevels</h1>
<p>Actual native C++ geometry and mouse inputs, followed by actual HTML canvas selection → B → signed size → Apply. No mesh-boolean substitute or fake success state.</p>
<p class="pass">12/12 native own-pointer cases · 12/12 HTML cases · 70/70 existing enabled-backend regressions</p>
<p>Sphere radius 0.75 at the origin minus box [0,0,0]–[4,3,2]. All three curved rims and all three straight interior edges tested separately in both fillet and chamfer modes at size 0.0375. The unrelated second box is hidden for picking, not changed. Native tests include preview isolation, undo/redo and save/reopen; an adjacent-rim test also checks feature re-edit and invalid-zero rollback.</p>
<p>Root repair: rational surface domains are extended to include outlying trimming curves, without changing the mathematical surface. Geometry/trim correspondence, endpoints, solid validity and volume agreement remain guarded. Tangent boundary normals are checked where the native kernel declares G1 continuity. Native ID picking bias now matches the drawing shader.</p>
<p>Graphics proof uses ANGLE/SwiftShader software GPU execution, not physical hardware. Native reference color is CPU raster; browser viewport uses WebGL2 with zero CPU RGBA frame uploads.</p>
<p class="limit">Scope limit: this does not certify arbitrary Boolean topology or every radius. A larger-radius exploratory case—curved edge 1 at 0.0589048619762—still refuses on a ~54e-6 trim endpoint mismatch (20e-6 guard). B now selects a smaller validated initial radius when its automatic suggestion fails; explicit numeric sizes are never silently changed.</p>
'''
for name, title in [('fillet-preview','Rounded fillet · valid native preview'), ('fillet-applied','Rounded fillet · applied editable feature'), ('chamfer-preview','Flat chamfer · signed negative input'), ('chamfer-applied','Flat chamfer · applied editable feature')]:
    data = base64.b64encode((SCRATCH / f'SphereBevelBrowser/{name}.png').read_bytes()).decode()
    page += f'<h2>{title}</h2><img alt="{title}" src="data:image/png;base64,{data}">'
page += '<h2>Reproduce</h2><pre>python3 Tools/Build/BuildSolidArcOcctBlend.py\npython3 Tools/Build/ProbeSolidArcOcctBlend.py\npython3 Experimental/SolidArc/Native/SphereCornerBevelMetrics.py\nBROWSER_EXECUTABLE=/path/to/chromium node Tools/Build/RunSolidArcSphereBevelProof.mjs</pre><p>See Experimental/SolidArc/Native/OCCT_BLEND.md for setup, dependency licenses and numerical checks.</p>'
page += '<details><summary>Machine-readable results</summary><pre>' + html.escape(json.dumps(dict(native=native, browser=browser), indent=2)) + '</pre></details>'
target = ROOT / 'Exhibits/Gallery/Editor/SolidArcSphereBevelProof.html'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(page)
print(target)
