# SolidArc native document v1
# A planar sheet becomes a 0.45 m thick plate, centered about the original plane.
workplane xy
dim off
plane (-5,-1.5,0) 4 3 --name=SheetBefore
plane (1,-1.5,0) 4 3 --name=PlateSheet
solidify PlateSheet .45 --name=SolidPlate
matcap SolidPlate steel
show cages off
show iso on
gizmo off
dim hide all
view iso
view fit
select SolidPlate
