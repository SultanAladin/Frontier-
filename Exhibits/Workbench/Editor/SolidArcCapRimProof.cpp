// Kernel proof for the user's mixed rim, not an alternative mesh modeller.
#include "Console/ConsoleHost.h"
#include "Kernel/BlendSolver.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
using namespace Frontier;
namespace {
void Check(bool Value,const char* Why){if(!Value)throw std::runtime_error(Why);}
void Solid(const BrepBody& B){
    const auto R=B.Validate();Check(R.Solid()&&R.Hulls==1&&R.Genus==0&&R.EulerCharacteristic==2,"not a genus-zero manifold solid");
    Check(!R.OpenEdges&&!R.NonManifoldEdges&&!R.MisorientedEdges,"open or misoriented topology");
    for(const auto& E:B.Edges)Check(E.Curve.Length()>ScalarCriteria::MergeTolerance&&E.VertexStart!=E.VertexEnd,"collapsed seam survived");
}
double SupportGap(const BrepBody& B){
    double Gap=0;
    for(const auto& E:B.Edges)for(int C:E.Coedges)for(int I=0;I<=8;++I){double U=0,V=0,D=0;
        B.Faces[B.Coedges[C].Face].Surface.ClosestParameter(E.Curve.Sample(E.Curve.DomainStart()+(E.Curve.DomainEnd()-E.Curve.DomainStart())*I/8.),U,V,&D);Gap=std::max(Gap,D);
    }return Gap;
}
Vec3 Normal(const BrepBody& B,int F,Vec3 P){double U=0,V=0;B.Faces[F].Surface.ClosestParameter(P,U,V);return B.FaceNormal(F,U,V).Normalised();}
double Tangency(const BrepBody& B){
    double Minimum=1;
    for(const auto& E:B.Edges){if(E.Coedges.size()!=2)continue;
        const int A=B.Coedges[E.Coedges[0]].Face,D=B.Coedges[E.Coedges[1]].Face;
        if(A<int(B.Faces.size())-2&&D<int(B.Faces.size())-2)continue;
        // Termination sections on the back/end planes are deliberately sharp.
        if((A==2||A==8)||(D==2||D==8))continue;
        for(int I=0;I<=8;++I){const Vec3 P=E.Curve.Sample(E.Curve.DomainStart()+(E.Curve.DomainEnd()-E.Curve.DomainStart())*I/8.);Minimum=std::min(Minimum,Normal(B,A,P).Dot(Normal(B,D,P)));}
    }return Minimum;
}
}
int main(int Argc,char** Argv){try{
    ConsoleHost Host(".",100,100);
    Check(Host.RunScript(Argc>1?Argv[1]:"Experimental/SolidArc/Native/Fixtures/MixedCapCorner.arc",false),"fixture journal failed");
    const SceneFigure* Model=nullptr;for(const auto& F:Host.Document().Figures())if(!F.Body.Faces.empty())Model=&F;
    Check(Model&&Model->Bevels.size()==2,"fixture does not contain both prior fillets");const BrepBody& Before=Model->Body;Solid(Before);
    const auto Chain=BlendSolver::TangentChain(Before,14);Check(Chain&&Chain.Payload.size()==2,"expected arc/line tangent rim");
    const double R=.0202791507347,L=Before.Edges[15].Curve.Length(),ArcR=Before.Edges[14].Curve.RadiusMajor;
    std::cout<<"{\"fixture\":\""<<(Argc>1?Argv[1]:"minimized user journal")<<"\",\"sourceFaces\":"<<Before.Faces.size()<<",\"sourceEdges\":"<<Before.Edges.size()<<",\"sourceEuler\":"<<Before.Validate().EulerCharacteristic;
    for(bool Chamfer:{false,true}){
        auto Out=Chamfer?BlendSolver::ChamferEdges(Before,{14,15},R):BlendSolver::FilletEdges(Before,{14,15},R);
        if(!Out)throw std::runtime_error(Out.Denial.Detail);Solid(Out.Payload);
        const auto& B=Out.Payload;const auto Report=B.Validate();const double Gap=SupportGap(B);
        Check(Gap<5e-6,"a trim edge left its exact supporting surface");
        Check(B.Faces[B.Faces.size()-2].Surface.Classification==(Chamfer?SurfaceClassification::Revolution:SurfaceClassification::Torus),"arc patch is not exact revolution/torus");
        Check(B.Faces.back().Surface.Classification==(Chamfer?SurfaceClassification::Plane:SurfaceClassification::Cylinder),"line patch is not exact plane/cylinder");
        const double Expected=(L+ArcR*ScalarCriteria::Pi/2)*(Chamfer?.5:1-ScalarCriteria::Pi/4)*R*R-ScalarCriteria::Pi/2*(Chamfer?1./6:5./6-ScalarCriteria::Pi/4)*R*R*R;
        const double Removed=Before.Validate().Volume-Report.Volume;
        Check(std::fabs(Removed-Expected)<Expected*.03,"curvature-aware removed volume differs by over 3 percent at display chord tolerance");
        const double G1=Chamfer?0:Tangency(B);if(!Chamfer)Check(G1>1-1e-6,"round rails or shared roll section are not tangent");
        std::cout<<",\""<<(Chamfer?"chamfer":"fillet")<<"\":{\"faces\":"<<Report.Faces<<",\"edges\":"<<Report.Edges<<",\"vertices\":"<<Report.Vertices<<",\"euler\":"<<Report.EulerCharacteristic<<",\"genus\":"<<Report.Genus<<",\"removedVolume\":"<<Removed<<",\"expectedRemovedVolume\":"<<Expected<<",\"maxSupportGap\":"<<Gap<<",\"minimumRoundNormalDot\":"<<G1<<"}";
        auto Reversed=BlendSolver::BlendCapRim(Before,{15,14,14},R,Chamfer);Check(bool(Reversed),"seed-order/deduplication changed outcome");
        Check(std::fabs(Reversed.Payload.Validate().Volume-Report.Volume)<1e-10,"seed-order geometry differs");
        auto ArcOnly=Chamfer?BlendSolver::ChamferEdges(Before,{14},R):BlendSolver::FilletEdges(Before,{14},R);
        Check(bool(ArcOnly)&&ArcOnly.Payload.Faces.size()==B.Faces.size(),"explicit arc did not carry its tangent line");
        for(double Bad:{0.,-.01,.2,.3,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()})
            Check(!BlendSolver::BlendCapRim(Before,{14,15},Bad,Chamfer),"unsafe size accepted");
        const BrepBody Rotated=Before.Transformed(Mat4::Rotation(Vec3::UnitZ(),.41)*Mat4::Rotation(Vec3::UnitY(),.27));
        auto Turned=BlendSolver::BlendCapRim(Rotated,{14,15},R,Chamfer);Check(bool(Turned),"rigidly rotated rim failed");Solid(Turned.Payload);Check(SupportGap(Turned.Payload)<5e-6,"rotated support gap");
    }
    std::cout<<",\"seedOrderAndDuplicateInvariant\":true,\"arcExpandsMixedTangentChain\":true,\"invalidSizesRefused\":true,\"rigidRotation\":true,\"pass\":true}\n";return 0;
}catch(const std::exception& E){std::cerr<<"CapRimProof: "<<E.what()<<"\n";return 1;}}
