#!/usr/bin/env python3
"""Package existing C++ proof PNGs into one offline HTML file (never browser screenshots)."""
import base64
import html
import json
import struct
import zlib
import sys
import io
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / 'Exhibits/Gallery/Editor'
ITEMS = [
    ('InspectorGeometry', 'Native Inspector · Geometry', 'HTML-matched selection card, counts, Geometry / Transform / Topology tabs, live Dimensions and world Bounds. Native C++ widgets, not HTML pasted over a scene.'),
    ('InspectorTransform', 'Native Inspector · Transform', 'World position, rotation, axis scale and uniform scale. Native mouse-selected X field receives 0.25; Apply changes the real body centre by 0.25 m, then undo restores it. Explicit Apply currently differs from the HTML immediate-change form.'),
    ('InspectorTopology', 'Native Inspector · Topology', 'Native body validation, manifold state, volume and area; curves show their NURBS structure.'),
    ('InspectorOperations', 'Native Inspector · Operations and Presentation', 'Scrollable cards for native solver operations, finish, OBJ export and delete. Operations currently open explicit native-command parameter forms; these are not yet HTML-equivalent tool forms.'),
    ('Empty', 'Empty native workspace', 'No dummy geometry or empty category buckets.'),
    ('Docking', 'Native dockable tabs', 'Inspector undocked by native mouse drag. Panel strips use monochrome trapezoidal ImGui tabs; the redundant document tab is removed.'),
    ('Dropdowns', 'Shared Filter-style dropdowns', 'Camera, projection, filter and property selectors use the shared rounded dropdown shell/menu. Tabs match the panel body and have no overline.'),
    ('Construct', 'Native Construct catalogue', 'Native icon tiles, including Polyline Slot, Point, Spline and Control Curve.'),
    ('Drawing', 'Mouse-driven rectangle preview', 'Native Construct → Rectangle and both corner positions use ImGui mouse events. Live width/height labels use DM Sans.'),
    ('Completed', 'Completed rectangle', 'The final click commits one rectangle; one-step undo is verified.'),
    ('PolylineSlot', 'Polyline Slot preview', 'Mouse-selected tool with three spine centres; a closed analytic outline with round outer joins and end caps. Enter finishes.'),
    ('CadOutliner', 'Real CAD rows', 'PolylineSlot, Spline and ControlCurve were drawn through native mouse inputs. Rows have names, stable document identities, type labels and visibility controls.'),
    ('Scene', 'Scene-only C++ raster', 'Native CPU scene raster without the ImGui workspace composition.'),
    ('', 'Geometry fixture', 'Separate command-created fixture used for camera and gizmo checks.'),
    ('Orbit', 'Native camera orbit check', 'Native camera interaction fixture.'),
    ('Gizmo', 'Native gizmo check', 'Native gizmo interaction and geometry-delta fixture.'),
]
# Repack native PNG scanlines losslessly: the C++ proof writer uses stored deflate
# blocks. Pixel bytes are unchanged; embedded galleries need not be tens of MB.
def chunks(data):
    at=8
    while at<len(data):
        size=struct.unpack_from('>I',data,at)[0]
        kind=data[at+4:at+8]; body=data[at+8:at+8+size]
        yield kind,body
        at+=12+size

def chunk(kind,body):
    return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)

def compressed_native(path):
    raw=path.read_bytes(); records=list(chunks(raw))
    scanlines=zlib.decompress(b''.join(body for kind,body in records if kind==b'IDAT'))
    packed=zlib.compress(scanlines,9)
    assert zlib.decompress(packed)==scanlines
    ihdr=next(body for kind,body in records if kind==b'IHDR')
    return ihdr,packed

def png(ihdr,data):
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',ihdr)+chunk(b'IDAT',data)+chunk(b'IEND',b'')

TOOLS=[('line','Line'),('polyline','Polyline'),('rect','Rectangle'),('centerrect','Centre Rectangle'),
       ('slot2','Slot'),('pslot','Polyline Slot'),('circle','Circle'),('arc','Arc'),('ellipse','Ellipse'),
       ('circle2','Diameter Circle'),('circle3','Three-point Circle'),('arc3','Three-point Arc'),
       ('polygon','Polygon'),('spline','Spline'),('cpcurve','Control Curve'),('sketch-point','Point'),('datum-point','Datum Point')]
for key,label in TOOLS:
    ITEMS.append(('Mouse_'+key,'Mouse construction · '+label,
                  'Selected through native Construct tiles; interpolated native pointer movement, point clicks, live preview, validated completion and one-step undo.'))
parts = []
for suffix, title, caption in ITEMS:
    path = FOLDER / f'EditorProof_SolidArc{"_" + suffix if suffix else ""}.png'
    if not path.exists():
        raise SystemExit(f'Missing {path}; run Tools/Build/RunSolidArcEditorProof.py first')
    data = base64.b64encode(png(*compressed_native(path))).decode('ascii')
    parts.append(f'<section id="{suffix or "Fixture"}"><h2>{html.escape(title)}</h2><p>{html.escape(caption)}</p>'
                 f'<img src="data:image/png;base64,{data}" alt="{html.escape(title)}" loading="lazy">'
                 f'<small>{path.name}</small></section>')

# APNG playback contains only frames rasterized by the native C++ executable.
frames=[compressed_native(FOLDER/f'EditorProof_SolidArc_Motion_{i:02d}.png') for i in range(8)]
ihdr=frames[0][0]; width,height=struct.unpack('>II',ihdr[:8])
animation=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',ihdr)+chunk(b'acTL',struct.pack('>II',len(frames),0))
sequence=0
for i,(header,payload) in enumerate(frames):
    assert header==ihdr
    delay=900 if i in (0,7) else 300
    animation+=chunk(b'fcTL',struct.pack('>IIIIIHHBB',sequence,width,height,0,0,delay,1000,0,0));sequence+=1
    if i==0: animation+=chunk(b'IDAT',payload)
    else:
        animation+=chunk(b'fdAT',struct.pack('>I',sequence)+payload);sequence+=1
animation+=chunk(b'IEND',b'')
(FOLDER/'SolidArcMouseMotion.png').write_bytes(animation)
parts.insert(0,'<section id="MouseMotion"><h2>Native mouse movement · animated rectangle proof</h2>'
    '<p>Looping C++ raster frames: tool selected, first corner placed, pointer moves while dimensions update, then the second click commits. Native ImGui draws the cursor. Playback timing is illustrative, not a performance measurement.</p>'
    '<img src="data:image/png;base64,'+base64.b64encode(animation).decode('ascii')+'" alt="Native C++ rectangle mouse simulation"></section>')
evidence=json.loads((FOLDER/'SolidArcMouseProof.json').read_text())
assert len(evidence['cases'])==17 and all(c['figures']==1 and c['undoPassed'] for c in evidence['cases'])
parts.insert(1,'<section id="Evidence"><h2>Native input results</h2><p>17 Construct tools · '+str(evidence['totalMouseMoves'])+
    ' interpolated pointer moves · each completion validated and undone. No tool or point commands are injected by these catalogue test cases; native UI callbacks dispatch to the C++ kernel.</p><details><summary>Input-path results</summary><pre style="white-space:pre-wrap">'+
    html.escape(json.dumps(evidence,indent=2))+'</pre></details></section>')
# GIF is an encoded playback of ten unmodified native raster frames. Palette
# quantisation is inherent to GIF; the original native PNGs remain the source.
try:
    from PIL import Image
except ImportError:
    sys.path.insert(0,str(ROOT/'.cache/proof-python'))
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit('GIF packaging needs Pillow: python3 -m pip install --target .cache/proof-python Pillow')
orbit=json.loads((FOLDER/'SolidArcOrbitProof.json').read_text())
assert orbit['passed'] and orbit['pointerMoves']==32 and abs(orbit['yawAfter']-orbit['yawBefore'])>.8
orbit_frames=[]
for i in range(10):
    with Image.open(FOLDER/f'EditorProof_SolidArc_OrbitMotion_{i:02d}.png') as im:
        orbit_frames.append(im.convert('RGB').quantize(colors=256))
buffer=io.BytesIO()
orbit_frames[0].save(buffer,format='GIF',save_all=True,append_images=orbit_frames[1:],
    duration=[850]+[160]*8+[850],loop=0,disposal=2,optimize=True)
gif=buffer.getvalue();(FOLDER/'SolidArcOrbit.gif').write_bytes(gif)
parts.insert(0,'<section id="OrbitMotion"><h2>Simulated native mouse orbit · looping GIF</h2>'
    '<p>Right mouse press → 32 interpolated pointer moves → release. The native camera rotates approximately 50° while the C++ scene, grid and gizmo are rasterized again. Cursor and Inspector are native ImGui. Ten native captures, GIF palette quantization; illustrative playback timing, not a frame-rate measurement.</p>'
    '<img src="data:image/gif;base64,'+base64.b64encode(gif).decode('ascii')+'" alt="Looping native C++ right-mouse orbit simulation">'
    '<details><summary>Native orbit assertions</summary><pre>'+html.escape(json.dumps(orbit,indent=2))+'</pre></details></section>')
# Keep browser shader-path evidence explicitly separate from native CPU captures.
gpu_path=FOLDER/'SolidArcGpuDrawing.json'
if gpu_path.exists():
    gpu=json.loads(gpu_path.read_text())
    assert gpu['graphics']['backend']=='WebGL2' and gpu['graphics']['rgbaUploads']==0
    assert gpu['witness']['cpuImages']==0 and gpu['glError']==0 and len(gpu['figures'])==2
    captures=[]
    for frame in gpu['frames']:
        with Image.open(FOLDER/'GpuDrawingFrames'/frame['file']) as image:
            captures.append(image.convert('RGB').quantize(colors=256))
    stream=io.BytesIO()
    captures[0].save(stream,format='GIF',save_all=True,append_images=captures[1:],
        duration=[f['duration'] for f in gpu['frames']],loop=0,disposal=2,optimize=True)
    gpu_gif=stream.getvalue();(FOLDER/'SolidArcGpuDrawing.gif').write_bytes(gpu_gif)
    parts.insert(1,'<section id="GpuDrawing"><h2>Construct menu → rectangle + circle · WebGL2 drawing</h2>'
        '<p>Browser mouse clicks select Construct → Sketch Draw tools and place both shapes. Live previews precede native C++ commits. Grid, preview and shapes use WebGL2 draws, not uploaded C++ CPU scene images. This is the approved HTML editor, separate from the native ImGui CPU mirror.</p>'
        '<p><strong>Capture adapter: '+html.escape(gpu['graphics']['adapter'])+'</strong>. '
        'The sandbox uses a software WebGL driver; this recording is shader-path evidence, not physical GPU or native Vulkan evidence. '
        +str(gpu['witness']['drawCalls'])+' WebGL draw calls, zero CPU scene-image uploads; exact counters below.</p>'
        '<img src="data:image/gif;base64,'+base64.b64encode(gpu_gif).decode('ascii')+'" alt="Construct menu and rectangle/circle WebGL2 drawing animation">'
        '<details><summary>Renderer/input evidence</summary><pre style="white-space:pre-wrap">'+html.escape(json.dumps(gpu,indent=2))+'</pre></details></section>')

# Matching all-view evidence, HTML first and the C++ counterpart second.
view_folder=FOLDER/'ViewGrid'
if (view_folder/'Results.json').exists() and (FOLDER/'SolidArcNativeViewGrid.json').exists():
    html_views=json.loads((view_folder/'Results.json').read_text())
    native_views=json.loads((FOLDER/'SolidArcNativeViewGrid.json').read_text())
    assert len(html_views['cases'])==7 and len(native_views['cases'])==8
    assert all(case['passed'] for case in native_views['cases'])
    images=[]
    for prefix,title,is_native in [('SolidArcHtmlViewGrids','HTML WebGL2',False),('SolidArcNativeViewGrids','Native C++ CPU counterpart',True)]:
        frames=[];durations=[]
        for view in ['top','bottom','front','back','right','left','iso','offset']:
            # HTML offset result is numeric evidence; its six canonical + iso views have captures.
            if view=='offset' and not is_native:continue
            for state,delay in [('grid',550),('drawing',750),('completed',800)]:
                path=(FOLDER/f'EditorProof_SolidArc_ViewGrid_{view}_{state}.png') if is_native else (view_folder/f'{view}-{state}.png')
                with Image.open(path) as image:frames.append(image.convert('RGB').quantize(colors=256))
                durations.append(delay)
        data=io.BytesIO();frames[0].save(data,format='GIF',save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,optimize=True)
        encoded=data.getvalue();(FOLDER/(prefix+'.gif')).write_bytes(encoded)
        images.append('<h3>'+title+'</h3><img src="data:image/gif;base64,'+base64.b64encode(encoded).decode('ascii')+'" alt="'+title+' all-view grids and pointer drawing">')
    parts.insert(0,'<section id="ViewGrids"><h2>All-view grids, axes and mouse drawing — HTML then C++</h2>'
        '<p>Top/Bottom: XY (red X, green Y). Front/Back: XZ (red X, blue Z). Right/Left: YZ (green Y, blue Z). Isometric and orbit retain the active workplane; custom offsets move both grid and drawing plane. Changing to a named view cancels incomplete drawing so coordinate systems cannot mix.</p>'
        '<p>Both loops show grid → native-backed pointer preview → completed geometry. HTML uses WebGL2 (software adapter in the automated capture); native ImGui uses the same shader body through the CPU reference. Native Vulkan/physical-GPU execution is not claimed.</p>'
        +''.join(images)+'<details><summary>HTML test results</summary><pre>'+html.escape(json.dumps(html_views,indent=2))+'</pre></details>'
        '<details><summary>Native input, save/replay and undo results</summary><pre>'+html.escape(json.dumps(native_views,indent=2))+'</pre></details></section>')

# Latest, self-contained mixed-renderer evidence: label each source explicitly.
latest=[]
for name,title in [
    ('SolidArcDrawingDimensions.png','HTML · reference-style live dimensions'),
    ('SolidArcOrientationCube.png','HTML · camera-linked 3D orientation cube'),
    ('SolidArcOrientationOrbit.png','HTML · cube follows mouse orbit'),
    ('EditorProof_SolidArc_OrientationCube.png','C++ · projected cube triangle meshes; six native face clicks verified'),
    ('EditorProof_SolidArc_Drawing.png','C++ · live dimension capsules and GPU-compatible arrow triangles'),
    ('SolidArcCurvePreview_pslot.png','HTML · mouse-drawn Polyline Slot preview'),
    ('SolidArcCurveCommitted_pslot.png','HTML · native-committed Polyline Slot and registered icon'),
    ('SolidArcCurveCommitted_circle3.png','HTML · native-committed three-point circle'),
    ('SolidArcCurveCommitted_arc3.png','HTML · native-committed three-point arc')]:
    path=FOLDER/name
    if path.exists():
        data=base64.b64encode(png(*compressed_native(path))).decode('ascii')
        latest.append('<h3>'+html.escape(title)+'</h3><img src="data:image/png;base64,'+data+'" alt="'+html.escape(title)+'" loading="lazy">')
for name in ['SolidArcCurveCubeProof.json','SolidArcNativeCubeProof.json','SolidArcMouseProof.json']:
    path=FOLDER/name
    if path.exists():latest.append('<details><summary>'+name+'</summary><pre>'+html.escape(path.read_text())+'</pre></details>')
if latest:parts.insert(0,'<section id="CurveCube"><h2>16 October · dimensions, shape registration and 3D cube</h2><p>HTML images use WebGL2 on SwiftShader: real grid, line and triangle draws, zero CPU image uploads. Native images use the C++ CPU proof renderer for shared ImGui triangle meshes and scene shaders; they are not physical-GPU/Vulkan evidence. New menu tools are selected by mouse, previewed and committed to the native document. Native catalogue: 17 tools, 1,008 interpolated moves. Both cubes verify all six face clicks.</p>'+''.join(latest)+'</section>')

nav = '<a href="#CurveCube">Latest cube + curves</a> · <a href="#ViewGrids">View grids + drawing</a> · <a href="#OrbitMotion">Orbit GIF</a> · <a href="#GpuDrawing">Construct + WebGL2 drawing GIF</a> · <a href="#MouseMotion">Animated mouse proof</a> · <a href="#Evidence">Results</a> · '+' · '.join(f'<a href="#{suffix or "Fixture"}">{html.escape(title)}</a>' for suffix, title, _ in ITEMS)
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SolidArc — Native CAD proofs</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0b0d10;color:#e8edf3}body{max-width:1360px;margin:auto;padding:32px 20px}h1{font-size:clamp(28px,4vw,44px)}h2{font-size:23px}p{line-height:1.6;color:#bcc6d2}a{color:#91c6ff}nav{line-height:2;margin:24px 0}.notice,section{border:1px solid #2a323d;background:#12171d;border-radius:18px;padding:20px;margin:24px 0}img{display:block;width:100%;height:auto;border-radius:10px;background:#050505}small{display:block;margin-top:12px;overflow-wrap:anywhere;color:#8997a7}code{color:#c8dfff}section{scroll-margin-top:20px}
</style><h1>SolidArc · Native C++ CAD proofs</h1><p>16 October 2026 · Self-contained offline gallery. Native PNG stills, native mouse animations and an optional browser WebGL2 drawing GIF are embedded. The orbit GIF uses a 256-colour palette. No GitHub, server, external fonts, JavaScript or network is needed.</p>
<div class="notice"><strong>Verified native paths</strong><p>Mouse-selected Rectangle, Polyline Slot, Spline, Control Curve, Datum Point and Point. Rectangle and point undo; live curve previews; analytic slot joins on XY/XZ; deterministic slot-radius save/replay. The CAD outliner uses real document bindings and readable name-first rows.</p>
<strong>Not a claim of completed parity</strong><p>The native shell uses monochrome trapezoidal Outliner / Viewport / Inspector dock tabs, without the redundant Untitled.arc tab. Extra workspace and file buttons are removed. Construct, camera view and projection dropdowns live in the Viewport header; Inspector has its own header. Inspector now follows the HTML selection/counts, tabs, Dimensions, Bounds, Operations and Presentation card layout, with a native world Transform table and topology view. Full parity remains unfinished. Multi-document tabs, identical Inspector operation parameter forms, workplane extent/tilt, and published Sketch Modify, constraint and profile-solid workflows still need native UI work. The current Solid/Surface sections retain the native primitive parameter popup.</p>
<p>Native Inspector/orbit/catalogue images are C++ CPU reference rasters. The separately labelled WebGL2 drawing section contains browser shader-path captures, currently using a software driver. Neither is native Vulkan evidence or a physical-GPU benchmark. Inputs are native ImGui IO in a headless executable; a physical desktop window/input backend is not verified. Camera/gizmo images use separate command-created fixtures.</p>
<p>Reproduce: <code>python3 Tools/Build/RunSolidArcEditorProof.py</code><br>Package: <code>python3 Tools/Build/GenerateSolidArcProofGallery.py</code></p></div><nav>''' + nav + '</nav>' + ''.join(parts) + '</html>'
output = FOLDER / 'SolidArcProofs.html'
output.write_text(page)
print(f'{output}: {len(ITEMS)} proof PNGs + native APNG/orbit GIF' + (' + WebGL2 drawing GIF' if gpu_path.exists() else '') + f', {output.stat().st_size:,} bytes')
