# SolidArc native document v1
# A solid circular tube follows a spatial cubic Bezier path; radius 0.22 m.
dim off
draw bezier (-3,-1,0) (-1,3,0) (1,-2,2) (3,1,2.5)
rename 1 PipePath
pipe PipePath .22 --name=CurvedPipe
matcap CurvedPipe copper
show cages off
show iso on
gizmo off
dim hide all
view iso
view fit
select CurvedPipe
