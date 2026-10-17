"""Deterministic engineered/concave fixtures and independent analytic CSG oracles.

The oracle AST describes intended geometry, not the native construction result;
therefore an incorrect intermediate Boolean cannot silently become reference truth.
"""
from pathlib import Path
import copy
import json
import math

ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'Experimental/SolidArc/Native/Fixtures/ComplexGeometry.json'


def box(lo,hi):return dict(type='box',low=list(lo),high=list(hi))
def cylinder(foot,radius,height,axis=(0,0,1)):return dict(type='cylinder',foot=list(foot),radius=radius,height=height,axis=list(axis))
def sphere(center,radius):return dict(type='sphere',center=list(center),radius=radius)
def cone(foot,r0,r1,height):return dict(type='cone',foot=list(foot),r0=r0,r1=r1,height=height,axis=[0,0,1])
def csg(op,a,b):return dict(type=op,a=a,b=b)
def union(*nodes):
    out=nodes[0]
    for node in nodes[1:]:out=csg('union',out,node)
    return out
def cut(a,*nodes):
    for node in nodes:a=csg('subtract',a,node)
    return a
def profile(points,z=0,height=1.6):
    area=sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))
    return dict(type='profile',points=points if area>0 else list(reversed(points)),z=z,height=height)
def move(node,xyz):return dict(type='transform',child=node,move=list(xyz),scale=1,angle=0)
def transform(node,scale=1,angle=0,offset=(0,0,0)):return dict(type='transform',child=node,move=list(offset),scale=scale,angle=angle)
def ring(outer=1.5,inner=1.0,z=0,height=1.3):return cut(cylinder((0,0,z),outer,height),cylinder((0,0,z-.2),inner,height+.4))
def radial(n,outer=2,inner=1):return [[(outer if i%2==0 else inner)*math.cos(i*math.pi/n),(outer if i%2==0 else inner)*math.sin(i*math.pi/n)] for i in range(2*n)]
L=[[-2,-2],[2,-2],[2,-.8],[-.7,-.8],[-.7,2],[-2,2]]
U=[[-2,-2],[2,-2],[2,2],[.9,2],[.9,-.8],[-.9,-.8],[-.9,2],[-2,2]]
C=[[-2,-2],[2,-2],[2,-.9],[-.8,-.9],[-.8,.9],[2,.9],[2,2],[-2,2]]
T=[[-2,-.5],[-.5,-.5],[-.5,-2],[.5,-2],[.5,-.5],[2,-.5],[2,.5],[-2,.5]]
Z=[[-2,-2],[2,-2],[2,-.9],[-.3,.9],[2,.9],[2,2],[-2,2],[-2,.9],[.3,-.9],[-2,-.9]]

def comb(teeth=7):
    points=[[-2,-1],[2,-1],[2,1.4]]
    step=4/teeth
    for i in range(teeth):
        right=2-i*step;left=right-step*.5;end=right-step
        points.extend([[left,1.4],[left,-.2],[end,-.2]])
        if i<teeth-1:points.append([end,1.4])
    points.append([-2,-1])
    return profile(points[:-1],height=1.3)

def stairs():return union(*(box((-2+i*.7,-1,0),(-1.1+i*.7,1,.6+i*.35)) for i in range(5)))
def window():return cut(box((-2,-2,0),(2,2,1.5)),box((-1.15,-1.15,-.2),(1.15,1.15,1.8)))
def dogbone():return union(box((-1.5,-.5,.2),(1.5,.5,1.4)),cylinder((-1.5,0,.2),.8,1.2),cylinder((1.5,0,.2),.8,1.2))
def holeplate(holes):return cut(box((-2,-2,0),(2,2,1.2)),*(cylinder((x,y,-.2),r,1.6) for x,y,r in holes))
def loft(points):
    top=[[.72*x-.15*y+.3,.15*x+.72*y+.2] for x,y in points]
    return dict(type='ruled-profile',points=profile(points)['points'],topPoints=profile(top)['points'],z=0,height=2.2)


def fixtures():
    rows=[]
    def add(id,label,a,b,tags,**extra):rows.append(dict(id=id,label=label,a=a,b=b,tags=tags,**extra))
    add('concave-l-notched','L bracket / notched Z prism',profile(L,height=2),move(profile(Z,height=1.4),(.45,.35,.3)),['concave','reentrant','both-constructed'])
    add('u-channel-l','U channel / rotated L bracket',profile(U,height=2),transform(profile(L,height=1.4),angle=27,offset=(.3,.15,.3)),['concave','rotation','both-constructed'])
    add('c-frame-staircase','C frame / five-step terrace',profile(C,height=1.8),move(stairs(),(.1,.4,.25)),['concave','multi-stage-union','coplanar'])
    add('star-hex-ring','12-point star / hollow hexagonal prism',profile(radial(6),height=1.7),move(cut(profile([[1.5*math.cos(i*math.pi/3),1.5*math.sin(i*math.pi/3)] for i in range(6)],height=2),profile([[.8*math.cos(i*math.pi/3),.8*math.sin(i*math.pi/3)] for i in range(6)],z=-.2,height=2.4)),(.35,.15,-.1)),['concave','through-hole','many-faces'])
    add('comb-staircase','Seven-tooth comb / five-step terrace',comb(),move(stairs(),(.1,.1,.25)),['many-reentrant-corners','multi-stage-union'])
    add('twin-bore-fork','Twin-bore plate / U fork',holeplate([(-.9,0,.55),(.9,0,.55)]),move(profile(U,height=1.8),(.25,.4,-.2)),['two-through-holes','concave'])
    add('window-dogbone','Rectangular window / dog-bone union',window(),move(dogbone(),(.2,.2,.1)),['through-hole','multi-stage-union','curved-planar'])
    add('cross-drilled-t','Cross-drilled block / T-slot prism',cut(box((-1.6,-1.6,0),(1.6,1.6,2)),cylinder((-2,0,1),.55,4,(1,0,0)),cylinder((0,-2,1),.45,4,(0,1,0))),move(profile(T,height=1.5),(.2,.25,.25)),['cross-bore','concave','internal-intersections'])
    add('blind-pocket-dogbone','Blind rectangular pocket / dog-bone',cut(box((-2,-2,0),(2,2,1.6)),box((-1.3,-1.3,.4),(1.3,1.3,2))),move(dogbone(),(.3,.3,.4)),['blind-pocket','curved-planar'])
    add('four-hole-z','Four-hole flange / Z prism',holeplate([(-1,-1,.4),(-1,1,.4),(1,-1,.4),(1,1,.4)]),move(profile(Z,height=1.4),(.1,.15,.2)),['four-through-holes','concave','many-loops'])
    add('pocket-island-comb','Pocket with raised island / comb',union(cut(box((-2,-2,0),(2,2,1.3)),box((-1.5,-1.5,.3),(1.5,1.5,1.8))),cylinder((0,0,.2),.55,1.7)),move(comb(5),(.15,.3,.4)),['blind-pocket','island','connected-floor','multi-stage'])
    ribs=union(box((-2,-1.5,0),(2,1.5,.4)),*(box((x,-1.5,.3),(x+.2,1.5,1.8)) for x in [-1.6,-.6,.4,1.4]))
    add('ribbed-annular','Four-rib bracket / annular boss',ribs,move(ring(1.4,.85,height=1.7),(.15,.15,.15)),['ribs','through-hole','thin-walls'])
    add('concave-l-ruled','Tapered/skewed L loft / C frame',loft(L),move(profile(C,height=1.4),(.3,.25,.5)),['concave-loft','non-axis-side-faces','both-constructed'])
    add('concave-u-ruled','Tapered/skewed U loft / stepped terrace',loft(U),move(stairs(),(.1,.2,.4)),['concave-loft','multi-stage','non-planar-sides'])
    elbow=union(cut(cylinder((-1.8,0,0),.95,3.6,(1,0,0)),cylinder((-2,0,0),.62,4,(1,0,0))),ring(.95,.62,z=-1.8,height=3.6))
    add('hollow-cross-elbow','Hollow crossing pipes / window frame',elbow,move(window(),(.2,.15,-.6)),['hollow','crossing-tunnels','multi-stage'])
    flange=union(ring(1.6,.8,height=.55),cut(box((-2.3,-.45,.2),(2.3,.45,1.3)),cylinder((-1.7,0,.1),.28,1.5),cylinder((1.7,0,.1),.28,1.5)))
    add('slotted-flange-cone','Slotted annular flange / hollow taper',flange,move(cut(cone((0,0,-.2),1.3,.9,2),cone((0,0,-.3),.9,.5,2.2)),(.2,.15,.1)),['slots','annular','conical','multi-stage'])
    thin=[[-2,-2],[2,-2],[2,2],[1.94,2],[1.94,-1.94],[-1.94,-1.94],[-1.94,2],[-2,2]]
    add('thin-u-comb','0.06-wall U channel / comb',profile(thin,height=2),move(comb(),(.03,.01,.2)),['thin-wall','reentrant','small-features'],minimumFeature=.06)
    terraces=union(*(box((-2+i*.3,-1.8+i*.25,i*.45),(2-i*.25,1.8-i*.2,(i+1)*.5)) for i in range(4)))
    add('terrace-double-window','Four-level terraces / double window',terraces,cut(box((-1.8,-2,.2),(1.8,2,1.7)),box((-1.3,-1.5,0),(-.2,1.5,2)),box((.2,-1.5,0),(1.3,1.5,2))),['multi-level','two-through-windows','both-constructed'])
    add('disconnected-l-parts','Two separated L parts / C frame',union(move(profile(L),(-3,0,0)),move(profile(L),(3,0,0))),profile(C,height=2),['disconnected-source','multiple-hulls','concave'])
    cup=csg('intersect',cut(sphere((0,0,0),1.8),sphere((0,0,0),1.4)),box((-2,-2,-.1),(2,2,2)))
    add('hollow-cup-star','Hollow open cup / ten-point star',cup,move(profile(radial(5,1.7,.8),height=1.3),(.2,.1,.2)),['hollow','curved-concave','multi-stage'])
    add('scaled-l-notch','Concave pair · scale .1, rotated + translated',transform(profile(L,height=2),scale=.1,angle=19,offset=(5,-3,2)),transform(move(profile(Z,height=1.4),(.45,.35,.3)),scale=.1,angle=19,offset=(5,-3,2)),['metamorphic','small-scale','translated','concave'],scale=.1)
    add('near-coincident-u','Nearly coincident U channels · .004/.002 offset',profile(U,height=1.6),move(profile(U,height=1.6),(.004,.003,.002)),['near-coincident','thin-sliver','concave'],minimumFeature=.002)
    add('coplanar-t-c','Coplanar-ended T / C prisms',profile(T,height=1.6),profile(C,height=1.6),['coplanar','reentrant','both-constructed'])
    bar=profile([[-2.2,.8],[-.2,.8],[-.2,.25],[.2,.25],[.2,.8],[2.2,.8],[2.2,1.25],[-2.2,1.25]],height=1.4)
    add('split-intersection','U fork / T bar · disconnected intersection',profile(U,height=1.8),bar,['disconnected-result','concave','multiple-hulls'],expectedComponents={'intersect':2,'intersect-ba':2})
    return rows


def compile_fixture(row):
    steps=[];counter=0
    def point(p):return '('+','.join(format(x,'.12g') for x in p)+')'
    def emit(node,name):
        nonlocal counter
        t=node['type']
        def body(command):steps.append(dict(command=command,target=name,oracle=copy.deepcopy(node),body=True))
        if t=='box':body(f'box {point(node["low"])} {point(node["high"])} --name={name}')
        elif t=='sphere':body(f'sphere {point(node["center"])} {node["radius"]} --name={name}')
        elif t in ('cylinder','cone'):
            radius=str(node['radius']) if t=='cylinder' else f'{node["r0"]} {node["r1"]}'
            body(f'{t} {point(node["foot"])} {radius} {node["height"]} --axis={point(node["axis"])} --name={name}')
        elif t in ('union','intersect','subtract'):
            counter+=1;a=f'N{counter}';counter+=1;b=f'N{counter}';emit(node['a'],a);emit(node['b'],b);body(f'boolean {t} {a} -- {b} --name={name}')
        elif t in ('profile','ruled-profile'):
            counter+=1;lo=f'P{counter}';pts=[point([*p,node['z']]) for p in node['points']]
            steps.append(dict(command='polyline '+' '.join(pts)+f' --closed --name={lo}',body=False))
            if t=='profile':body(f'extrude {lo} {node["height"]} --name={name}');steps.append(dict(command=f'hide {lo}',body=False))
            else:
                counter+=1;hi=f'P{counter}';pts=[point([*p,node['z']+node['height']]) for p in node['topPoints']]
                steps.append(dict(command='polyline '+' '.join(pts)+f' --closed --name={hi}',body=False))
                body(f'loft {lo} {hi} --degree=1 --no-align --name={name}');steps.append(dict(command=f'hide {lo} {hi}',body=False))
        elif t=='transform':
            emit(node['child'],name)
            if node['scale']!=1:steps.append(dict(command=f'transform {name} --scale={point([node["scale"]]*3)} --pivot=(0,0,0)',target=name,oracle=dict(type='transform',child=node['child'],scale=node['scale'],angle=0,move=[0,0,0]),body=True))
            if node['angle']:
                child=dict(type='transform',child=node['child'],scale=node['scale'],angle=0,move=[0,0,0])
                steps.append(dict(command=f'transform {name} --rotate=(0,0,{node["angle"]}) --pivot=(0,0,0)',target=name,oracle=dict(type='transform',child=child,scale=1,angle=node['angle'],move=[0,0,0]),body=True))
            if any(node['move']):steps.append(dict(command=f'move {name} {point(node["move"])}',target=name,oracle=copy.deepcopy(node),body=True))
        else:raise ValueError(t)
    emit(row['a'],'A');emit(row['b'],'B')
    row['steps']=steps;row['commands']=[step['command'] for step in steps]
    return row


def main():
    rows=[compile_fixture(row) for row in fixtures()]
    manifest=dict(description='Constructed, concave, holed and multi-stage CSG sources; exact intended-geometry oracle AST, independent of native intermediate results.',operations=['union','union-ba','intersect','intersect-ba','subtract-ab','subtract-ba'],fixtures=rows)
    DEST.write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'{DEST}: {len(rows)} engineered pairings, {len(rows)*6} planned final Booleans, {sum(len(r["steps"]) for r in rows)} construction commands')


if __name__=='__main__':main()
