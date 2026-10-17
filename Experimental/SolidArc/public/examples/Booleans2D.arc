# SolidArc native document v1
# Two overlapping closed profiles, ready for ordered-selection booleans.
workplane xy
draw rect (0,0) (4,3)
rename #1 FirstProfile
draw rect (2,1) (6,4)
rename #2 SecondProfile
show cages off
gizmo off
dim off
view top
view ortho
view fit
select FirstProfile SecondProfile
