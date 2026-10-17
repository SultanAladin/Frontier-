# SolidArc native document v1
# Fender study: longitudinal arc + engine-side rail, shaped start/middle/end stations.
workplane xz
dim off
arc --three (-2.4,0,0) (0,0,2.4) (2.4,0,0) --name=WheelArch
draw bezier (-2.4,1.8,.4) (-1.4,2.1,3.5) (1.1,2,3.2) (2.4,1.5,.5)
rename 2 EngineRail
draw bezier (-2.4,0,0) (-2.7,.5,.1) (-2.5,1.3,.6) (-2.4,1.8,.4)
rename 3 StartProfile
draw bezier (0,0,2.4) (-.05,.4,2.95) (-.1,1.3,2.9) (-.1125,1.95,2.625)
rename 4 CrownProfile
draw bezier (2.4,0,0) (2.6,.4,.2) (2.6,1.1,.7) (2.4,1.5,.5)
rename 5 EndProfile
loft WheelArch EngineRail --profiles=StartProfile,CrownProfile,EndProfile --sheet --name=Fender
matcap Fender steel
show cages off
gizmo off
dim hide all
view iso
view fit
select Fender
