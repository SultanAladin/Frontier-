// Native transactional bevel features and non-destructive previews, shared by both UIs.
#include "ConsoleHost.h"
#include "Kernel/BlendSolver.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cctype>
#include <iomanip>
#include <limits>
#include <set>
#include <sstream>

namespace Frontier {
namespace {
bool PositiveInteger(const std::string& Text,uint32_t& Out) {
    if(Text.empty()||Text.find_first_not_of("0123456789")!=std::string::npos)return false;
    try {auto N=std::stoull(Text);if(!N||N>std::numeric_limits<uint32_t>::max())return false;Out=uint32_t(N);return true;}catch(...){return false;}
}
std::vector<BevelBinding> Candidates(const SceneFigure& F) {
    std::vector<BevelBinding> Out;
    if(F.Classification==FigureClassification::Curve) {
        for(double T:ProfileSolver::CornerParameters(F.Curve))Out.push_back({{F.Curve.Sample(T)},false});
    }else if(F.Classification==FigureClassification::Body)for(const auto& E:F.Body.Edges){
        BevelBinding B;const double A=E.Curve.DomainStart(),D=E.Curve.DomainEnd()-A;
        for(int I=0;I<5;++I)B.Samples.push_back(E.Curve.Sample(A+D*I/4));
        const Vec3 V=B.Samples.back()-B.Samples.front();B.Straight=V.Length()>1e-8;
        for(const Vec3 P:B.Samples)if(B.Straight&&V.Cross(P-B.Samples.front()).Length()/V.Length()>1e-7)B.Straight=false;
        Out.push_back(std::move(B));
    }
    return Out;
}
bool SameBinding(const BevelBinding& A,const BevelBinding& B) {
    constexpr double Tol=1e-6;
    if(A.Samples.size()!=B.Samples.size()||A.Samples.empty())return false;
    if(A.Straight&&B.Straight){
        const Vec3 O=A.Samples.front(),V=A.Samples.back()-O;const double L=V.Length();const Vec3 U=V/L;
        for(auto P:B.Samples)if(U.Cross(P-O).Length()>Tol)return false;
        double A0=(B.Samples.front()-O).Dot(U),A1=(B.Samples.back()-O).Dot(U);if(A0>A1)std::swap(A0,A1);
        return std::min(L,A1)-std::max(0.0,A0)>Tol;
    }
    bool Forward=true,Reverse=true;
    for(size_t I=0;I<A.Samples.size();++I){Forward&=(A.Samples[I]-B.Samples[I]).Length()<Tol;Reverse&=(A.Samples[I]-B.Samples[B.Samples.size()-1-I]).Length()<Tol;}
    return Forward||Reverse;
}
bool Rebind(const SceneFigure& F,BevelFeature& Step,std::string& Reason) {
    auto All=Candidates(F);std::vector<int> Indices;std::set<int> Used;
    for(const auto& Binding:Step.Bindings){
        int Found=-1;for(size_t I=0;I<All.size();++I)if(SameBinding(Binding,All[I])){if(Found>=0){Reason="Downstream topology is ambiguous; no features changed.";return false;}Found=int(I);}
        if(Found<0||!Used.insert(Found).second){Reason="A downstream edge/corner no longer has a unique geometric match; no features changed.";return false;}
        Indices.push_back(Found);
    }
    Step.Targets=std::move(Indices);Step.Bindings.clear();for(int I:Step.Targets)Step.Bindings.push_back(All[I]);return true;
}
bool SolveStep(SceneFigure& F,BevelFeature& Step,std::string& Reason) {
    if(Step.Targets.empty()){Reason="No edges or corners selected.";return false;}
    Step.BeforeCurve=F.Curve;Step.BeforeBody=F.Body;
    if(F.Classification==FigureClassification::Body){
        auto R=Step.Chamfer?BlendSolver::ChamferEdges(F.Body,Step.Targets,Step.Size):BlendSolver::FilletEdges(F.Body,Step.Targets,Step.Size);
        if(!R){Reason=R.Denial.Detail;return false;}F.Body=std::move(R.Payload);
    }else if(F.Classification==FigureClassification::Curve){
        auto R=Step.Chamfer?ProfileSolver::Chamfered(F.Curve,Step.Size,&Step.Targets):ProfileSolver::Filleted(F.Curve,Step.Size,&Step.Targets);
        if(!R){Reason=R.Denial.Detail;return false;}F.Curve=std::move(R.Payload);
    }else{Reason="Bevel requires a solid edge or planar sketch corner.";return false;}
    Step.AfterFingerprint=F.GeometryFingerprint();return true;
}
}

ConsoleHost::BevelContext ConsoleHost::BevelSelection() const {
    uint64_t H=UndoSequence::Fingerprint(Scene);for(const auto& F:Scene.Figures())H=(H^uint64_t(F.Locked))*1099511628211ull;
    if(H!=BevelContextFingerprint_){BevelContextCache_=ComputeBevelSelection();BevelContextFingerprint_=H;}
    return BevelContextCache_;
}
ConsoleHost::BevelContext ConsoleHost::ComputeBevelSelection() const {
    BevelContext Out;double Reach=std::numeric_limits<double>::max();
    if(Scene.SelectedAreaCount()){Out.Reason="Select sketch curves/corners or solid edges, not filled sketch regions.";return Out;}
    for(const auto& F:Scene.Figures()){
        if(!F.Selected&&F.SelectedPoles.empty()&&F.SelectedEdges.empty()&&F.SelectedFaces.empty())continue;
        if(F.Hidden||F.Locked){Out.Reason="Selected objects must be visible and unlocked.";return Out;}
        if(!F.SelectedFaces.empty()){Out.Reason="Select solid edges (2), not faces.";return Out;}
        auto All=Candidates(F);std::vector<int> Targets;
        if(F.Classification==FigureClassification::Body){
            if(!F.Body.Validate().Solid()||F.SelectedEdges.empty()||!F.SelectedPoles.empty()){Out.Reason="Select one or more edges of a solid body (edge mode · 2).";return Out;}
            Targets=F.SelectedEdges;
        }else if(F.Classification==FigureClassification::Curve){
            Frontier::Plane Work;if(!F.Curve.Planar(Work)||All.empty()){Out.Reason="Select a planar sketch with sharp corners; smooth curves have no bevelable corners.";return Out;}
            if(!F.SelectedPoles.empty())for(int Pole:F.SelectedPoles){
                if(Pole<0||Pole>=int(F.Curve.Poles.size())){Out.Reason="Invalid sketch corner selection.";return Out;}
                const auto P=F.Curve.Poles[Pole];const Vec3 Q{P.X/P.W,P.Y/P.W,P.Z/P.W};
                int Found=-1;for(size_t I=0;I<All.size();++I)if((All[I].Samples[0]-Q).Length()<1e-6)Found=int(I);
                if(Found<0){Out.Reason="Select actual sharp corner vertices, not spline handles or open endpoints.";return Out;}Targets.push_back(Found);
            }else for(size_t I=0;I<All.size();++I)Targets.push_back(int(I));
        }else{Out.Reason="Bevel supports solid edges and planar sketch corners, not surfaces.";return Out;}
        std::sort(Targets.begin(),Targets.end());Targets.erase(std::unique(Targets.begin(),Targets.end()),Targets.end());
        for(int I:Targets){if(I<0||I>=int(All.size())){Out.Reason="Invalid edge/corner selection.";return Out;}
            if(F.Classification==FigureClassification::Body)Reach=std::min(Reach,F.Body.Edges[I].Curve.Length());}
        if(F.Classification==FigureClassification::Curve)Reach=std::min(Reach,F.Curve.Length()/std::max(size_t(1),All.size()));
        Out.Count+=unsigned(Targets.size());Out.Targets.emplace_back(F.Identity,std::move(Targets));
    }
    if(!Out.Count){Out.Reason="Select solid edges (2), sketch curves, or sketch corner vertices (1), then press B.";return Out;}
    Out.Available=true;Out.SuggestedSize=std::max(1e-5,Reach*.05);return Out;
}

bool ConsoleHost::ExecuteBevel(const CommandLine& C,SceneDocument& Work,std::string& Reason) const {
    const bool Edit=C.Verb=="beveledit";
    auto Size=C.Number(Edit?2:0);const auto Mode=C.SwitchText("mode");
    if(!Size||!std::isfinite(*Size)||*Size<=ScalarCriteria::KernelTolerance||!Mode||(*Mode!="fillet"&&*Mode!="chamfer")){Reason="Use a finite positive size and --mode=fillet|chamfer.";return false;}
    const bool Chamfer=*Mode=="chamfer";
    std::vector<std::pair<uint32_t,std::vector<int>>> Targets;uint32_t Feature=0;
    if(Edit){
        uint32_t Owner=0;if(C.Arguments.size()!=3||!PositiveInteger(C.Arguments[0],Owner)||!PositiveInteger(C.Arguments[1],Feature)){Reason="beveledit <object-id> <feature-id> <size> --mode=fillet|chamfer";return false;}
        Targets.push_back({Owner,{}});
    }else{
        auto Text=C.SwitchText("targets");if(C.Arguments.size()!=1||!Text){Reason="beveladd <size> --mode=fillet|chamfer --targets=object:e0,1|object:c0,1";return false;}
        std::istringstream Groups(*Text);std::string Group;std::set<uint32_t> Seen;
        while(std::getline(Groups,Group,'|')){
            auto Colon=Group.find(':');uint32_t Owner=0;
            if(Colon==std::string::npos||!PositiveInteger(Group.substr(0,Colon),Owner)||!Seen.insert(Owner).second||Colon+2>=Group.size()||(Group[Colon+1]!='e'&&Group[Colon+1]!='c')){Reason="Malformed bevel targets.";return false;}
            auto* F=Work.Find(Owner);if(!F||(F->Classification==FigureClassification::Body?'e':'c')!=Group[Colon+1]){Reason="Bevel target type or object no longer matches.";return false;}
            std::istringstream Values(Group.substr(Colon+2));std::string Value;std::vector<int> Indices;std::set<int> Unique;
            while(std::getline(Values,Value,',')){auto N=CommandCodec::ParseNumber(Value);if(!N||!std::isfinite(*N)||*N<0||*N>std::numeric_limits<int>::max()||std::floor(*N)!=*N||!Unique.insert(int(*N)).second){Reason="Invalid or duplicate edge/corner index.";return false;}Indices.push_back(int(*N));}
            Targets.push_back({Owner,std::move(Indices)});
        }
    }
    if(Targets.empty()){Reason="No bevel targets.";return false;}
    for(const auto& [Owner,Indices]:Targets){
        auto* F=Work.Find(Owner);if(!F||F->Locked||F->Hidden){Reason="Bevel target must exist, be visible and unlocked.";return false;}
        if(F->Classification!=FigureClassification::Curve&&F->Classification!=FigureClassification::Body){Reason="Only solid edges and planar sketch corners support bevel.";return false;}
        if(Edit){
            size_t Index=0;while(Index<F->Bevels.size()&&F->Bevels[Index].Identity!=Feature)++Index;
            Reason=F->BevelEditReason(Index);if(!Reason.empty())return false;
            F->Curve=F->Bevels[Index].BeforeCurve;F->Body=F->Bevels[Index].BeforeBody;
            F->Bevels[Index].Size=*Size;F->Bevels[Index].Chamfer=Chamfer;
            for(size_t I=Index;I<F->Bevels.size();++I){auto& Step=F->Bevels[I];if(!Rebind(*F,Step,Reason)||!SolveStep(*F,Step,Reason))return false;}
        }else{
            BevelFeature Step;Step.Identity=F->Bevels.empty()?1:F->Bevels.back().Identity+1;
            Step.Chamfer=Chamfer;Step.Size=*Size;Step.Targets=Indices;Step.Boundary=F->Bevels.empty()||F->GeometryFingerprint()!=F->Bevels.back().AfterFingerprint;
            auto All=Candidates(*F);for(int I:Indices){if(I<0||I>=int(All.size())){Reason="Edge/corner no longer exists.";return false;}Step.Bindings.push_back(All[I]);}
            if(!SolveStep(*F,Step,Reason))return false;F->Bevels.push_back(std::move(Step));
        }
        // Snapshot-derived feature owns its geometry. Never let an old creation
        // recipe/dimension rebuild erase the bevel on the next regeneration.
        if(F->ShapeKind.empty())F->ShapeKind=FigureShapeKind(*F);
        F->Blueprint={};F->Recipe={};F->Selected=true;F->SelectedPoles.clear();F->SelectedEdges.clear();F->SelectedFaces.clear();Work.TouchSelection(*F);
    }
    return true;
}

std::optional<double> ConsoleHost::ParseBevelDistance(const std::string& Text) noexcept {
    char* End=nullptr;double N=std::strtod(Text.c_str(),&End);
    if(End==Text.c_str()||!std::isfinite(N))return {};
    if(Text.substr(0,size_t(End-Text.c_str())).find_first_not_of("0123456789+-.eE \t\r\n")!=std::string::npos)return {};
    std::string Unit(End);auto First=Unit.find_first_not_of(" \t\r\n"),Last=Unit.find_last_not_of(" \t\r\n");
    Unit=First==std::string::npos?"":Unit.substr(First,Last-First+1);for(char& C:Unit)C=char(std::tolower(static_cast<unsigned char>(C)));
    double Scale=1;if(Unit=="mm")Scale=.001;else if(Unit=="cm")Scale=.01;else if(Unit=="in")Scale=.0254;else if(Unit=="ft")Scale=.3048;else if(!Unit.empty()&&Unit!="m")return {};
    N*=Scale;return std::isfinite(N)?std::optional<double>(N):std::nullopt;
}

bool ConsoleHost::BeginBevel(bool Chamfer,uint32_t Owner,uint32_t Feature) noexcept {
    CancelBevel();Bevel_.EditOwner=Owner;Bevel_.EditFeature=Feature;
    if(Owner||Feature){
        auto* F=Scene.Find(Owner);size_t I=0;if(F)while(I<F->Bevels.size()&&F->Bevels[I].Identity!=Feature)++I;
        if(!F||I>=F->Bevels.size()){Bevel_.Status="Feature not found.";return false;}
        auto Why=F->BevelEditReason(I);if(!Why.empty()){Bevel_.Status=Why;return false;}
        Chamfer=F->Bevels[I].Chamfer;Bevel_.Size=F->Bevels[I].Size;
    }else{
        auto Context=BevelSelection();if(!Context.Available){Bevel_.Status=Context.Reason;return false;}
        Bevel_.Targets=std::move(Context.Targets);Bevel_.Size=Context.SuggestedSize;
    }
    if(Tool.Active())Tool.Cancel();
    Bevel_.Active=true;Bevel_.SourceFingerprint=UndoSequence::Fingerprint(Scene);
    PreviewBevel(Bevel_.Size,Chamfer);return true; // initial refusal still permits smaller numeric input
}
bool ConsoleHost::PreviewBevel(double Size,bool Chamfer) noexcept {
    if(!Bevel_.Active)return false;
    ++Bevel_.Revision;Bevel_.Size=Size;Bevel_.Chamfer=Chamfer;Bevel_.Valid=false;
    if(UndoSequence::Fingerprint(Scene)!=Bevel_.SourceFingerprint){Bevel_.Status="Selection/document changed during preview; cancel and restart B.";return false;}
    if(!std::isfinite(Size)||Size<=ScalarCriteria::KernelTolerance){Bevel_.Status="Enter a finite positive size.";return false;}
    std::ostringstream Text;Text<<std::setprecision(17);
    if(Bevel_.EditOwner)Text<<"beveledit "<<Bevel_.EditOwner<<' '<<Bevel_.EditFeature<<' '<<Size;
    else Text<<"beveladd "<<Size;
    Text<<" --mode="<<(Chamfer?"chamfer":"fillet");
    if(!Bevel_.EditOwner){Text<<" --targets=";bool First=true;for(const auto& [Id,Indices]:Bevel_.Targets){if(!First)Text<<'|';First=false;auto* F=Scene.Find(Id);Text<<Id<<':'<<(F&&F->Classification==FigureClassification::Body?'e':'c');for(size_t I=0;I<Indices.size();++I){if(I)Text<<',';Text<<Indices[I];}}}
    Bevel_.Canonical=Text.str();std::vector<CommandLine> Parsed;std::string Error;
    if(!CommandCodec::Decode(Bevel_.Canonical,Parsed,Error)||Parsed.size()!=1){Bevel_.Status=Error;return false;}
    SceneDocument Work=Scene;
    if(!ExecuteBevel(Parsed.front(),Work,Bevel_.Status))return false;
    Work.RebuildAreas(Plane);Bevel_.Preview=std::move(Work);Bevel_.Valid=true;
    Bevel_.Status=Bevel_.EditOwner?"Preview ready · downstream features replayed atomically.":"Preview ready · Enter / click to apply · Esc / right-click to cancel.";return true;
}
bool ConsoleHost::ApplyBevel() noexcept {
    if(!Bevel_.Active||!Bevel_.Valid)return false;
    if(UndoSequence::Fingerprint(Scene)!=Bevel_.SourceFingerprint){Bevel_.Valid=false;Bevel_.Status="Document changed during preview; restart B.";return false;}
    const std::string Command=Bevel_.Canonical;
    // Run the canonical command, not the transient session, through the normal
    // transaction/journal path. Save/open, undo/redo and previews remain independent.
    CancelBevel();return Execute(Command);
}
void ConsoleHost::CancelBevel() noexcept {
    const auto Revision=Bevel_.Revision+1;Bevel_={};Bevel_.Revision=Revision;
}
void ConsoleHost::RegisterBevel() noexcept {
    Commands["bevel-options"]=[this](const CommandLine& C){BevelOptionsRequested_=true;return BeginBevel(C.Switch("chamfer"));};
    Usage["bevel-options"]="Interactive Bevel / Chamfer (B)";
    for(const char* Verb:{"beveladd","beveledit"}){
        Usage[Verb]="Native atomic bevel feature; positive size, --mode=fillet|chamfer.";
        Commands[Verb]=[this](const CommandLine& C){
            SceneDocument Work=Scene;std::string Reason;if(!ExecuteBevel(C,Work,Reason))return Refuse("bevel: %s",Reason.c_str());
            Scene=std::move(Work);
            Dimensions.erase(std::remove_if(Dimensions.begin(),Dimensions.end(),[this](const auto& D){auto* F=Scene.Find(D.Anchor);return D.Auto&&F&&!F->Bevels.empty();}),Dimensions.end());
            Row("%s · %s · exact native geometry; one undo step",C.Verb.c_str(),C.SwitchText("mode")->c_str());return true;
        };
    }
}
} // namespace Frontier
