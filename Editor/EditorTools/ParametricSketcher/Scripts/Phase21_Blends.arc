echo Phase 21 — edge blends on solids: chamfer, fillet, and face push
echo -- 1. the spanner: hexagonal prism, one side face pushed out, the resulting tip edge blended --
polygon (0,0) 20 6 --name=Hex
extrude Hex 10 --name=Body
push Body 26 --face=1 --name=Spanner
echo    e26 joins the arm's side wall to its flat end cap - neither is an upward-facing face
chamfer Spanner 5 --edges=26 --name=SpannerChamfer
matcap SpannerChamfer steel
view iso
view orbit 160 28
view fit
render Spanner_Chamfer --size=1100x850
topology SpannerChamfer
undo
fillet Spanner 5 --edges=26 --name=SpannerFillet
matcap SpannerFillet steel
render Spanner_Fillet --size=1100x850
topology SpannerFillet
echo -- 2. a pentagonal prism with ONE top edge blended --
reset
polygon (0,0) 20 5 --name=Pent
extrude Pent 12 --name=PentBody
chamfer PentBody 4 --edges=2 --name=PentChamfer
matcap PentChamfer steel
view iso
view fit
render Pentagon_Chamfer --size=1100x850
topology PentChamfer
undo
fillet PentBody 4 --edges=2 --name=PentFillet
matcap PentFillet steel
render Pentagon_Fillet --size=1100x850
topology PentFillet
echo -- 3. the two edges picked out in the UI screenshots, each blended on its own --
reset
polygon (0,0) 20 6 --name=Hex
extrude Hex 10 --name=Body
push Body 26 --face=1 --name=Spanner
echo    e2  = a TOP edge (side wall meets the top cap)
chamfer Spanner 4 --edges=2 --name=TopChamfer
matcap TopChamfer steel
view iso
view orbit 150 26
view fit
render Edge_Top_Chamfer --size=1100x850
undo
fillet Spanner 4 --edges=2 --name=TopFillet
matcap TopFillet steel
render Edge_Top_Fillet --size=1100x850
undo
echo    e26 = a VERTICAL edge at the arm's tip
chamfer Spanner 4 --edges=26 --name=VertChamfer
matcap VertChamfer steel
render Edge_Vert_Chamfer --size=1100x850
undo
fillet Spanner 4 --edges=26 --name=VertFillet
matcap VertFillet steel
render Edge_Vert_Fillet --size=1100x850
