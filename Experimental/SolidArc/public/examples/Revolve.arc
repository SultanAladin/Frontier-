# SolidArc native document v1
# A closed XZ section, revolved 360 degrees about Z: stepped collar with a bore.
workplane xz
dim off
draw polyline (.85,0) (2,0) (2,.35) (1.35,.35) (1.35,1.8) (1.6,1.8) (1.6,2.1) (.85,2.1) --closed
rename 1 LatheProfile
revolve LatheProfile 360 --origin=(0,0,0) --axis=(0,0,1) --name=SteppedCollar
matcap SteppedCollar steel
show cages off
show iso on
gizmo off
dim hide all
view iso
view fit
select SteppedCollar
