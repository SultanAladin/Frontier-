// Exact fillet/chamfer of a tangent line/circular-arc rim on a planar cap.
// Unlike independent edge rolls, a shared rim is offset once and rebuilt with
// matching rails. Circular portions produce rational torus/cone patches.
#include "BlendSolver.h"
#include "ProfileSolver.h"
#include <algorithm>
#include <cmath>
#include <map>
#include <optional>
#include <set>


namespace Frontier {
namespace {
constexpr double T=ScalarCriteria::MergeTolerance;
using Result=Deliver<BrepBody>;
Result Refuse(const char* Why){return Result::Reject(RefusalReason::Unsupported,Why);}
bool Straight(const NurbsCurve& C){
    if(C.Poles.size()<2)return false;
    const Vec3 A=C.StartPoint(),D=C.EndPoint()-A;const double L=D.Length();if(L<=T)return false;
    double Previous=-T;
    for(const auto& H:C.Poles){const Vec3 P=H.Divide()-A;const double Along=P.Dot(D)/L;
        if(D.Cross(P).Length()>T*L||Along<Previous-T||Along>L+T)return false;Previous=Along;
    }
    return true;
}
Vec3 NormalAt(const BrepBody& B,int F,Vec3 P,double* Error=nullptr){
    double U=0,V=0,D=0;B.Faces[F].Surface.ClosestParameter(P,U,V,&D);if(Error)*Error=D;return B.FaceNormal(F,U,V).Normalised();
}
struct Segment {
    int Edge=-1,Side=-1;
    bool Circular=false;
    NurbsCurve Inset,Rail,CrossStart,CrossEnd;
    NurbsSurface Surface;
};
}

Deliver<BrepBody> BlendSolver::BlendCapRim(const BrepBody& Body,const std::vector<int>& Seeds,double Size,bool Chamfer) noexcept {
    if(!std::isfinite(Size)||Size<=T)return Result::Reject(RefusalReason::DegenerateInput,"cap rim size must be finite and positive");
    if(Seeds.empty()||!Body.Validate().Solid())return Refuse("cap rim blend requires selected edges of a valid solid");
    std::set<int> Selected;
    for(int E:Seeds){
        if(E<0||E>=int(Body.Edges.size())||Body.Edges[E].Coedges.size()!=2)return Refuse("cap rim target is not a manifold edge");
        Selected.insert(E);
        // Explicitly selecting a circular rim segment requests its tangent
        // continuation. Do not silently grow ordinary single straight-edge edits.
        if(Body.Edges[E].Curve.Classification==CurveClassification::Arc){
            auto Chain=TangentChain(Body,E);if(!Chain)return Refuse(Chain.Denial.Detail);
            Selected.insert(Chain.Payload.begin(),Chain.Payload.end());
        }
    }
    int Cap=-1;
    for(size_t F=0;F<Body.Faces.size();++F){
        if(Body.Faces[F].Surface.Classification!=SurfaceClassification::Plane||Body.Faces[F].Loops.size()!=1)continue;
        bool Common=true;for(int E:Selected){bool Found=false;for(int C:Body.Edges[E].Coedges)Found|=Body.Coedges[C].Face==int(F);Common&=Found;}
        if(Common){if(Cap>=0)return Refuse("cap rim has ambiguous planar supports");Cap=int(F);}
    }
    if(Cap<0)return Refuse("mixed tangent rim needs one shared planar cap");
    const Vec3 N=Body.FaceNormal(Cap,.5,.5).Normalised();
    const Vec3 Origin=Body.Edges[*Selected.begin()].Curve.StartPoint();
    std::map<int,Segment> Segments;
    std::map<int,Vec3> CapPoint,SidePoint;
    std::map<int,NurbsCurve> Cross;
    std::map<int,int> Incidence;
    double ExpectedRemoval=0;
    auto Remember=[&](int Vertex,Vec3 A,Vec3 B,const NurbsCurve& C)->bool {
        if(Vertex<0||Vertex>=int(Body.Vertices.size()))return false;
        if(CapPoint.count(Vertex)&&((CapPoint[Vertex]-A).Length()>T||(SidePoint[Vertex]-B).Length()>T))return false;
        CapPoint[Vertex]=A;SidePoint[Vertex]=B;Cross[Vertex]=C;++Incidence[Vertex];return Incidence[Vertex]<=2;
    };
    for(int E:Selected){
        const auto& Old=Body.Edges[E];const auto& Q=Old.Curve;
        const bool Arc=Q.Classification==CurveClassification::Arc,Line=!Arc&&Straight(Q);
        if(!Line&&!Arc)return Refuse("cap rim supports straight lines and exact circular arcs only");
        Segment S;S.Edge=E;S.Circular=Arc;
        for(int C:Old.Coedges)if(Body.Coedges[C].Face!=Cap)S.Side=Body.Coedges[C].Face;
        if(S.Side<0)return Refuse("cap rim has no side support");
        const double A=Q.DomainStart(),D=Q.DomainEnd()-A;
        auto Point=[&](double V){return Q.Sample(A+D*V);};
        auto M=[&](double V){return NormalAt(Body,S.Side,Point(V));};
        const Vec3 P0=Point(0),PM=Point(.5),P1=Point(1),M0=M(0),MM=M(.5),M1=M(1);
        if(std::fabs(M0.Dot(N))>1e-6||std::fabs(MM.Dot(N))>1e-6||std::fabs(M1.Dot(N))>1e-6)
            return Refuse("cap rim side must be perpendicular to its planar cap");
        double Sign=0,Sweep=0;Vec3 Axis;
        if(Arc){
            const double R=Q.RadiusMajor;
            if(!std::isfinite(R)||R<=T)return Refuse("cap rim circular support has no valid radius");
            const Vec3 R0=(P0-Q.Centre).Normalised(),RM=(PM-Q.Centre).Normalised(),R1=(P1-Q.Centre).Normalised();
            Sign=MM.Dot(RM)>0?1:-1;Axis=R0.Cross(RM).Normalised();
            if(Axis.Length()<.99||std::fabs(Axis.Dot(N))<.999999)return Refuse("rim arc is not in the cap plane");
            Sweep=std::atan2(Axis.Dot(R0.Cross(R1)),R0.Dot(R1));if(Sweep<=0)Sweep+=2*ScalarCriteria::Pi;
            if(Sweep>ScalarCriteria::Pi+1e-6||R-Sign*Size<=T)return Refuse("cap rim size consumes its circular corner; reduce the size");
        }
        for(int I=0;I<=8;++I){
            const double V=I/8.;const Vec3 P=Point(V),SideNormal=M(V);double Error=0;
            NormalAt(Body,S.Side,P-N*Size,&Error);
            if(Error>T*8||std::fabs((P-Origin).Dot(N))>T*8)return Refuse("rim does not have constant prismatic side support at this size");
            if(Line&&(SideNormal-MM).Length()>1e-5)return Refuse("straight rim has changing side normals");
            if(Arc&&(std::fabs((P-Q.Centre).Length()-Q.RadiusMajor)>T*8 || (SideNormal-(P-Q.Centre).Normalised()*Sign).Length()>1e-5))
                return Refuse("curved rim is not an exact circular prismatic support");
        }
        auto Inset=Line?NurbsCurve::Line(P0-M0*Size,P1-M1*Size):NurbsCurve::ArcThreePoints(P0-M0*Size,PM-MM*Size,P1-M1*Size);
        if(!Inset)return Refuse("cap rim offset collapsed");S.Inset=std::move(Inset.Payload);
        S.Rail=Q.Transformed(Mat4::Translation(-N*Size));
        auto Section=[&](Vec3 P,Vec3 M)->Deliver<NurbsCurve>{
            const Vec3 Centre=P-(N+M)*Size;
            return Chamfer?NurbsCurve::Line(P-M*Size,P-N*Size):NurbsCurve::ArcThreePoints(P-M*Size,Centre+(N+M)*(Size/std::sqrt(2.0)),P-N*Size);
        };
        auto C0=Section(P0,M0),C1=Section(P1,M1);if(!C0||!C1)return Refuse("cap rim cross-section collapsed");
        S.CrossStart=std::move(C0.Payload);S.CrossEnd=std::move(C1.Payload);
        if(!Remember(Old.VertexStart,S.Inset.StartPoint(),S.Rail.StartPoint(),S.CrossStart)||!Remember(Old.VertexEnd,S.Inset.EndPoint(),S.Rail.EndPoint(),S.CrossEnd))
            return Refuse("selected rim branches or is not tangent at its shared vertices");
        auto Surface=Line?NurbsSurface::Extrusion(S.CrossStart,(P1-P0).Normalised(),(P1-P0).Length()):NurbsSurface::Revolution(S.CrossStart,Q.Centre,Axis,Sweep);
        if(!Surface)return Refuse("cap rim surface reconstruction failed");S.Surface=std::move(Surface.Payload);
        if(!Chamfer){
            S.Surface.Classification=Line?SurfaceClassification::Cylinder:SurfaceClassification::Torus;
            S.Surface.Origin=Line?P0-(N+M0)*Size:Q.Centre-N*Size;
            S.Surface.Axis=Line?(P1-P0).Normalised():Axis;
            S.Surface.RadiusMajor=Line?Size:Q.RadiusMajor-Sign*Size;S.Surface.RadiusMinor=Size;
        }else if(Line)S.Surface.Classification=SurfaceClassification::Plane;
        const double Area=(Chamfer?.5:1-ScalarCriteria::Pi/4)*Size*Size;
        const double Moment=(Chamfer?1./6:5./6-ScalarCriteria::Pi/4)*Size*Size*Size;
        ExpectedRemoval+=Q.Length()*(Area-(Arc?Sign*Moment/Q.RadiusMajor:0));
        Segments.emplace(E,std::move(S));
    }
    // Every unselected edge incident to the rim must stay on its original
    // support: shorten a cap neighbour or an axial seam, never move unrelated geometry.
    std::map<int,NurbsCurve> Changed;
    for(size_t E=0;E<Body.Edges.size();++E){
        if(Selected.count(int(E)))continue;const auto& Old=Body.Edges[E];
        bool OnCap=false;for(int C:Old.Coedges)OnCap|=Body.Coedges[C].Face==Cap;
        Vec3 A=Old.Curve.StartPoint(),B=Old.Curve.EndPoint();bool Moved=false;
        auto Move=[&](int V,Vec3& P){if(CapPoint.count(V)){P=OnCap?CapPoint[V]:SidePoint[V];Moved=true;}};
        Move(Old.VertexStart,A);Move(Old.VertexEnd,B);
        if(!Moved)continue;
        if(!Straight(Old.Curve))return Refuse("rim endpoint needs a straight cap neighbour / axial seam");
        const Vec3 O=Old.Curve.StartPoint(),V=Old.Curve.EndPoint()-O;const double L=V.Length();const Vec3 U=V/L;
        for(Vec3 P:{A,B})if(U.Cross(P-O).Length()>T*8||(P-O).Dot(U)<-T||(P-O).Dot(U)>L+T)
            return Refuse("cap rim size consumes a neighbouring edge or meets an oblique termination");
        if((B-A).Length()<=T||(B-A).Dot(U)<=T)return Refuse("cap rim size consumes an endpoint clearance");
        Changed[int(E)]=NurbsCurve::Line(A,B).Payload;
    }
    BrepBody Out;
    auto Append=[&](int F,int L,const NurbsCurve& C)->bool{
        if(C.Validate()||C.Length()<=ScalarCriteria::KernelTolerance)return false;
        const int E=Out.AddEdge(C,T);const bool Reverse=Out.Edges[E].Curve.StartPoint().Distance(C.StartPoint())>T;
        Out.AddCoedge(E,Reverse,F,L);return true;
    };
    auto Gap=[&](Vec3 A,Vec3 B)->std::optional<NurbsCurve>{
        for(const auto& [V,C]:Cross){
            if(C.StartPoint().Distance(A)<=T&&C.EndPoint().Distance(B)<=T)return C;
            if(C.EndPoint().Distance(A)<=T&&C.StartPoint().Distance(B)<=T)return C.Reversed();
        }return {};
    };
    for(size_t F=0;F<Body.Faces.size();++F){
        const auto& Old=Body.Faces[F];const int NF=Out.AddFace(Old.Surface);Out.Faces[NF].Natural=false;Out.Faces[NF].Reversed=Old.Reversed;
        for(int Loop:Old.Loops){
            std::vector<NurbsCurve> Curves;
            for(int Ce:Body.Loops[Loop].Coedges){
                const auto& C=Body.Coedges[Ce];const auto& Edge=Body.Edges[C.Edge];
                // A previous local roll can leave a collapsed seam. Compact it
                // only through this complete face-loop rebuild and revalidate below.
                if(Edge.Curve.Length()<=T&&Edge.Curve.StartPoint().Distance(Edge.Curve.EndPoint())<=T)continue;
                NurbsCurve Q;
                if(Segments.count(C.Edge)){const auto& S=Segments.at(C.Edge);Q=int(F)==Cap?S.Inset:S.Rail;}
                else Q=Changed.count(C.Edge)?Changed.at(C.Edge):Edge.Curve;
                Curves.push_back(C.Reversed?Q.Reversed():std::move(Q));
            }
            if(Curves.size()<2)return Refuse("cap rim would collapse an existing face loop");
            if(int(F)==Cap){
                NurbsCurve Ring=Curves.front();
                for(size_t I=1;I<Curves.size();++I){auto Joined=NurbsCurve::Join(Ring,Curves[I]);if(!Joined)return Refuse("cap rim offset cannot join its surviving boundary");Ring=std::move(Joined.Payload);}
                if(!Ring.Closed()||!ProfileSolver::SelfIntersections(Ring).empty())return Refuse("cap rim offset intersects another part of the cap; reduce the size");
            }
            const int L=Out.AddLoop(NF,Body.Loops[Loop].Outer);
            for(size_t I=0;I<Curves.size();++I){
                if(!Append(NF,L,Curves[I]))return Refuse("cap rim has an invalid surviving edge");
                const Vec3 A=Curves[I].EndPoint(),B=Curves[(I+1)%Curves.size()].StartPoint();
                if(A.Distance(B)>T){auto C=Gap(A,B);if(!C||!Append(NF,L,*C))return Refuse("cap rim termination could not close exactly");}
            }
        }
    }
    for(const auto& [E,S]:Segments){
        // These four rails are exactly the complete natural patch boundary.
        // Extrusion is (section,spine), revolution is (spine,section): seed the
        // reversal consistently with the loop before topological Orient().
        const int F=Out.AddFace(S.Surface);Out.Faces[F].Natural=true;Out.Faces[F].Reversed=!S.Circular;const int L=Out.AddLoop(F,true);
        if(!Append(F,L,S.Inset)||!Append(F,L,S.CrossEnd)||!Append(F,L,S.Rail.Reversed())||!Append(F,L,S.CrossStart.Reversed()))
            return Refuse("cap rim patch boundary failed");
    }
    Out.Orient();const auto Report=Out.Validate(),Before=Body.Validate();
    if(!Report.Solid()||Report.Hulls!=Before.Hulls||Report.OpenEdges||Report.NonManifoldEdges||Report.MisorientedEdges||Report.EulerCharacteristic!=2*Report.Hulls-2*Report.Genus)
        return Refuse("cap rim reconstruction did not close as an oriented manifold solid");
    const double Measured=Before.Volume-Report.Volume;
    const double ErrorBudget=std::max(1e-7,std::max(ExpectedRemoval*.03,std::fabs(Before.Volume)*2e-7));
    if(Measured<=0||std::fabs(Measured-ExpectedRemoval)>ErrorBudget)return Refuse("cap rim failed its curvature-aware removal-volume check");
    return Result::Accept(std::move(Out));
}
} // namespace Frontier
