# SolidArc native document v1
# Overlapping solids: Union 36 m3, A-B 12 m3, intersection 12 m3.
workplane xy
box (0,0,0) (4,3,2) --name=FirstBody
box (2,0,0) (6,3,2) --name=SecondBody
show cages off
gizmo off
dim off
view iso
view fit
selectmode whole
select FirstBody SecondBody
