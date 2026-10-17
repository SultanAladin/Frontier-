// Regression: cut exits at existing domain knots and closed-coedge seam spans.
// The cone existed already; neither its representation nor Boolean guards are
// weakened here. Fixes belong to the generic split/assemble path.
#include "Kernel/IntersectionSolver.h"
#include "VerificationPanel.h"
#include <array>
#include <string>
using namespace Frontier;

int main()
{
    VerificationPanel Panel("SolidArc · Boolean boundary-knot and closed-span regressions");
    for (double Scale : {1.0, .1, 2.0})
    {
        Panel.Section(("Cone/box ordered operations, uniform scale " + std::to_string(Scale)).c_str());
        const Vec3 Offset = Scale == 1 ? Vec3{} : Vec3{10, -7, 4};
        const BrepBody A = BrepBody::Cone(Offset + Vec3{0,0,-1} * Scale, Vec3::UnitZ(), 1.2 * Scale, .45 * Scale, 2.2 * Scale).Payload;
        const BrepBody B = BrepBody::Box(Offset + Vec3{0,-.8,-.6} * Scale, Offset + Vec3{1.5,.9,1.6} * Scale).Payload;
        std::array<double,6> Volumes{};
        for (int I = 0; I < 6; ++I)
        {
            const BodyOperation Op = I < 2 ? BodyOperation::Union : I < 4 ? BodyOperation::Intersect : BodyOperation::Subtract;
            const char* Names[] = {"A union B", "B union A", "A intersect B", "B intersect A", "A minus B", "B minus A"};
            BooleanReport Report;
            auto R = I % 2 ? IntersectionSolver::Combine(B,A,Op,&Report) : IntersectionSolver::Combine(A,B,Op,&Report);
            Panel.Expect((std::string(Names[I])+": accepted closed manifold solid").c_str(), R && R.Payload.Validate().Solid());
            if (!R) continue;
            const BodyReport V = R.Payload.Validate(); Volumes[I] = V.Volume;
            Panel.Expect("All seven transversal sections retained", Report.Curves == 7);
            bool CutUsesValid = true;
            for (const BrepEdge& E : R.Payload.Edges)
                CutUsesValid = CutUsesValid && E.Coedges.size() == 2;
            Panel.Expect("Each edge has exactly two coedges", CutUsesValid);
            // Source-specific witness independent of the split classifier:
            // this top-cap half lies in the box, not on the complementary arc.
            const Vec3 P = Offset + Vec3{.1,0,1.1} * Scale;
            const bool Expected = Op != BodyOperation::Subtract;
            Panel.Expect("Top-cap material is on correct side of closed arc", IntersectionSolver::Encloses(R.Payload,P) == Expected);
        }
        const double VolumeScale = Scale * Scale * Scale;
        // Validate().Volume is chord-tessellated quadrature, not exact volume.
        // Preserve the existing 1% curved-volume allowance and raw residuals.
        Panel.Equal("Union volume agrees within 1% quadrature", Volumes[0], Volumes[1], .01 * std::max(Volumes[0], Volumes[1]));
        Panel.Equal("Common volume agrees within 1% quadrature", Volumes[2], Volumes[3], .01 * std::max(Volumes[2], Volumes[3]));
        Panel.Equal("Union + common = source volume sum", Volumes[0]+Volumes[2], A.Validate().Volume+B.Validate().Volume, .01 * VolumeScale);
        Panel.Equal("A minus B + common = A volume", Volumes[4]+Volumes[2], A.Validate().Volume, .01 * VolumeScale);
        Panel.Equal("B minus A + common = B volume", Volumes[5]+Volumes[2], B.Validate().Volume, .01 * VolumeScale);
    }
    Panel.Section("Periodic torus/box: never return a closed box after losing torus");
    const BrepBody Torus = BrepBody::Torus({},Vec3::UnitZ(),1.2,.4).Payload;
    const BrepBody Box = BrepBody::Box({0,-1.6,-.7},{1.8,1.6,.7}).Payload;
    auto Union = IntersectionSolver::Combine(Torus,Box,BodyOperation::Union);
    Panel.Expect("Union either retains both witnesses or explicitly refuses", !Union || (Union.Payload.Validate().Solid() && IntersectionSolver::Encloses(Union.Payload,{-1.2,0,0}) && IntersectionSolver::Encloses(Union.Payload,{1.7,0,0})));
    for (BodyOperation Op : {BodyOperation::Intersect,BodyOperation::Subtract})
    {
        auto R = IntersectionSolver::Combine(Torus,Box,Op);
        Panel.Expect("Periodic half-torus operation is closed and manifold", R && R.Payload.Validate().Solid());
        if (R) Panel.Equal("Half-torus volume matches analytic reference", R.Payload.Validate().Volume, ScalarCriteria::Pi * ScalarCriteria::Pi * 1.2 * .4 * .4, .02);
    }
    return Panel.Conclude();
}
