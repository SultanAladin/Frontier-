#include "PbfFluid.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>

namespace Frontier::ProjectFluid {
namespace {
constexpr float Pi = 3.14159265358979323846f;
constexpr std::array<FluidMaterial, 4> Materials{{
    {"Water",     {0.36f,0.82f,0.86f}, {0.85f,0.20f,0.12f}, 0.01f,0.09f,1.333f, 0.018f,0.018f,0.45f,0.00f,20.0f},
    {"Milk",      {0.94f,0.90f,0.81f}, {0.20f,0.25f,0.40f}, 0.96f,0.28f,1.350f, 0.090f,0.030f,0.55f,0.08f,20.0f},
    {"Honey",     {0.89f,0.52f,0.07f}, {0.18f,1.60f,5.80f}, 0.08f,0.18f,1.490f, 0.780f,0.080f,0.85f,0.00f,25.0f},
    {"Chocolate", {0.31f,0.12f,0.06f}, {2.10f,4.50f,6.50f}, 0.97f,0.24f,1.460f, 0.580f,0.070f,0.70f,0.80f,40.0f},
}};
float CohesionKernel(float r, float h) noexcept {
    if (r <= 0.0f || r >= h) return 0.0f;
    const float base = 32.0f / (Pi * std::pow(h, 9.0f)) * std::pow(h - r, 3.0f) * std::pow(r, 3.0f);
    return r > h * 0.5f ? base : 2.0f * base - std::pow(h, 6.0f) / 64.0f;
}
}

Vec3 operator+(Vec3 a, Vec3 b) noexcept { return {a.x+b.x,a.y+b.y,a.z+b.z}; }
Vec3 operator-(Vec3 a, Vec3 b) noexcept { return {a.x-b.x,a.y-b.y,a.z-b.z}; }
Vec3 operator*(Vec3 a, float s) noexcept { return {a.x*s,a.y*s,a.z*s}; }
Vec3 operator/(Vec3 a, float s) noexcept { return a * (1.0f/s); }
float Dot(Vec3 a, Vec3 b) noexcept { return a.x*b.x+a.y*b.y+a.z*b.z; }
float Length(Vec3 a) noexcept { return std::sqrt(Dot(a,a)); }
Vec3 Normalized(Vec3 a) noexcept { const float l=Length(a); return l>1e-8f?a/l:Vec3{}; }

PbfFluid::PbfFluid() {
    Positions_.reserve(MaxParticles); Velocities_.reserve(MaxParticles); Previous_.reserve(MaxParticles);
    Corrections_.reserve(MaxParticles); Density_.reserve(MaxParticles); Lambda_.reserve(MaxParticles);
    ApparentViscosity_.reserve(MaxParticles); Neighbours_.reserve(MaxParticles);
    Reset();
}

const FluidMaterial& PbfFluid::ActiveMaterial() const noexcept { return Materials[static_cast<std::size_t>(Material_)]; }
void PbfFluid::SetMaterial(Material material) noexcept { Material_ = material; }

void PbfFluid::Add(Vec3 position, Vec3 velocity) {
    if (Positions_.size() >= MaxParticles) return;
    Collide(position);
    Positions_.push_back(position); Velocities_.push_back(velocity); Previous_.push_back(position);
    Corrections_.push_back({}); Density_.push_back(0.0f); Lambda_.push_back(0.0f);
    ApparentViscosity_.push_back(0.0f); Neighbours_.emplace_back(); Neighbours_.back().reserve(96);
}

void PbfFluid::Reset(Experiment experiment) {
    Experiment_ = experiment; Time_ = 0.0f; Emission_ = 0.0f; Diagnostics_ = {};
    Positions_.clear(); Velocities_.clear(); Previous_.clear(); Corrections_.clear(); Density_.clear();
    Lambda_.clear(); ApparentViscosity_.clear(); Neighbours_.clear();
    if (experiment == Experiment::Basin) {
        Gravity_ = 9.81f;
        for (int y=0;y<4;++y) for (int x=0;x<24;++x) for (int z=0;z<15;++z) {
            const float px=(x-11.5f)*0.157f;
            Add({px,0.22f+y*0.157f+0.07f*std::sin(px*1.8f),(z-7.0f)*0.157f});
        }
    } else {
        Gravity_ = experiment == Experiment::WettingDrop ? 1.0f : 0.0f;
        for (int x=-4;x<=4;++x) for(int y=-3;y<=3;++y) for(int z=-4;z<=4;++z)
            if (std::pow(x*0.157f/0.72f,2)+std::pow(y*0.157f/0.48f,2)+std::pow(z*0.157f/0.63f,2)<1.0f)
                Add({x*0.157f,1.0f+y*0.157f,z*0.157f});
    }
    BuildNeighbours(); ComputeDensity(false);
}

float PbfFluid::Poly6(float r2) const noexcept {
    constexpr float h=SmoothingRadius;
    if (r2>=h*h) return 0.0f;
    const float q=h*h-r2;
    return 315.0f/(64.0f*Pi*std::pow(h,9.0f))*q*q*q;
}

void PbfFluid::BuildNeighbours() {
    const float h2=SmoothingRadius*SmoothingRadius;
    for(auto& list:Neighbours_) list.clear();
    for(std::uint32_t i=0;i<Positions_.size();++i) {
        auto& list=Neighbours_[i];
        for(std::uint32_t j=0;j<Positions_.size();++j) {
            Vec3 d=Positions_[i]-Positions_[j];
            if(Dot(d,d)<h2 && list.size()<128) list.push_back(static_cast<std::uint16_t>(j));
        }
    }
}

void PbfFluid::ComputeDensity(bool computeLambda) {
    const float h=SmoothingRadius,h2=h*h;
    const float poly=315.0f/(64.0f*Pi*std::pow(h,9.0f));
    const float gradFactor=-6.0f*poly/RestDensity;
    float total=0.0f,peak=0.0f;
    for(std::size_t i=0;i<Positions_.size();++i) {
        float density=0.0f,grad2=0.0f; Vec3 grad{};
        for(std::uint16_t ji:Neighbours_[i]) {
            const Vec3 d=Positions_[i]-Positions_[ji]; const float r2=Dot(d,d); if(r2>=h2) continue;
            const float q=h2-r2; density+=poly*q*q*q;
            if(computeLambda) { const Vec3 g=d*(gradFactor*q*q); grad+=g; grad2+=Dot(g,g); }
        }
        // Analytic ghost support approximates the sampled Akinci basin boundary.
        const Vec3 p=Positions_[i], lo=BoundsMin(), hi=BoundsMax();
        const float distances[6]{p.x-lo.x,hi.x-p.x,p.y-lo.y,hi.y-p.y,p.z-lo.z,hi.z-p.z};
        const Vec3 normals[6]{{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
        for(int wall=0;wall<6;++wall) if(distances[wall]<h) {
            const float r2=distances[wall]*distances[wall]; const float q=h2-r2;
            density+=0.72f*poly*q*q*q;
            if(computeLambda) grad+=normals[wall]*(0.72f*gradFactor*q*q*distances[wall]);
        }
        Density_[i]=density;
        const float compression=std::max(0.0f,density/RestDensity-1.0f);
        total+=compression;peak=std::max(peak,compression);
        if(computeLambda) Lambda_[i]=-0.65f*compression/(grad2+Dot(grad,grad)+1e-5f);
    }
    Diagnostics_.MeanCompression=total/std::max<std::size_t>(1,Positions_.size()); Diagnostics_.PeakCompression=peak;
}

void PbfFluid::SolvePressure() {
    BuildNeighbours(); ComputeDensity(false); Diagnostics_.PressureIterations=0;
    const float h=SmoothingRadius,h2=h*h,poly=315.0f/(64.0f*Pi*std::pow(h,9.0f));
    const float g0=-6.0f*poly/RestDensity;
    for(std::uint32_t iteration=0;iteration<6;++iteration) {
        if(iteration>0 && iteration%2==0) BuildNeighbours();
        ComputeDensity(true);
        if(iteration>=2 && Diagnostics_.PeakCompression<=0.03f) break;
        for(std::size_t i=0;i<Positions_.size();++i) {
            Vec3 correction{};
            for(std::uint16_t ji:Neighbours_[i]) if(ji!=i) {
                const Vec3 d=Positions_[i]-Positions_[ji];const float r2=Dot(d,d);if(r2>=h2)continue;
                correction+=d*((Lambda_[i]+Lambda_[ji])*g0*std::pow(h2-r2,2.0f));
            }
            const float length=Length(correction); if(length>0.035f) correction=correction*(0.035f/length);
            Corrections_[i]=correction;
        }
        for(std::size_t i=0;i<Positions_.size();++i){Positions_[i]+=Corrections_[i];Collide(Positions_[i]);}
        ++Diagnostics_.PressureIterations;
    }
    BuildNeighbours();ComputeDensity(false);
}

void PbfFluid::ApplySurfaceTension(float dt) {
    const float tension=ActiveMaterial().SurfaceTension*8.0f,h=SmoothingRadius;
    std::fill(Corrections_.begin(),Corrections_.end(),Vec3{});
    for(std::size_t i=0;i<Positions_.size();++i) for(std::uint16_t ji:Neighbours_[i]) if(ji>i) {
        const Vec3 d=Positions_[i]-Positions_[ji];const float r=Length(d);if(r<1e-6f||r>=h)continue;
        float force=-tension*CohesionKernel(r,h)*0.000012f;
        force=std::clamp(force,-18.0f,18.0f);
        const Vec3 impulse=Normalized(d)*(force*dt);
        Corrections_[i]+=impulse;Corrections_[ji]-=impulse;
    }
    for(std::size_t i=0;i<Velocities_.size();++i) Velocities_[i]+=Corrections_[i];
}

void PbfFluid::ApplyViscosity(float dt) {
    const FluidMaterial& material=ActiveMaterial();
    std::fill(Corrections_.begin(),Corrections_.end(),Vec3{});
    float shearTotal=0.0f,viscosityTotal=0.0f;
    for(std::size_t i=0;i<Positions_.size();++i) {
        Vec3 average{};float weights=0.0f,shear=0.0f;
        for(std::uint16_t ji:Neighbours_[i]) if(ji!=i) {
            const Vec3 d=Positions_[ji]-Positions_[i];const float r=Length(d);if(r>=SmoothingRadius||r<1e-6f)continue;
            const float w=Poly6(r*r)/RestDensity;const Vec3 dv=Velocities_[ji]-Velocities_[i];average+=dv*w;weights+=w;
            shear+=Length(dv)/r*w;
        }
        shear=weights>0?std::min(250.0f,shear/weights):0.0f;
        const float n=1.0f-0.85f*material.ShearThinning;
        const float apparent=0.5f*material.Viscosity*material.Viscosity*(0.12f+0.88f*std::pow(1.0f+std::pow(0.6f*shear,2.0f),(n-1.0f)*0.5f));
        ApparentViscosity_[i]=std::clamp(apparent,0.0f,2.0f);
        Corrections_[i]=average*std::min(0.85f,std::sqrt(2.0f*ApparentViscosity_[i])*dt*60.0f);
        shearTotal+=shear;viscosityTotal+=ApparentViscosity_[i];
    }
    for(std::size_t i=0;i<Velocities_.size();++i) {Velocities_[i]+=Corrections_[i];Velocities_[i].x=std::clamp(Velocities_[i].x,-12.0f,12.0f);Velocities_[i].y=std::clamp(Velocities_[i].y,-12.0f,12.0f);Velocities_[i].z=std::clamp(Velocities_[i].z,-12.0f,12.0f);}
    Diagnostics_.MeanShear=shearTotal/std::max<std::size_t>(1,Positions_.size());
    Diagnostics_.MeanApparentViscosity=viscosityTotal/std::max<std::size_t>(1,Positions_.size());
}

void PbfFluid::Collide(Vec3& p) {
    const Vec3 lo=BoundsMin(),hi=BoundsMax();
    const Vec3 before=p;
    p.x=std::clamp(p.x,lo.x,hi.x);p.y=std::clamp(p.y,lo.y,hi.y);p.z=std::clamp(p.z,lo.z,hi.z);
    if(p.x!=before.x||p.y!=before.y||p.z!=before.z)++Diagnostics_.WallContacts;
    if(ObstacleEnabled_) {
        const Vec3 centre=ObstacleCentre();Vec3 d=p-centre;const float distance=Length(d),radius=ObstacleRadius();
        if(distance<radius) {p=centre+(distance<1e-8f?Vec3{0,1,0}:d/distance)*(radius+1e-5f);++Diagnostics_.SphereContacts;}
    }
}

void PbfFluid::Step(float dt) {
    if(!std::isfinite(dt)||dt<0) throw std::range_error("invalid fluid timestep");
    if(dt==0) return;
    dt=std::min(dt,1.0f/45.0f);Time_+=dt;Diagnostics_.SphereContacts=0;Diagnostics_.WallContacts=0;
    BuildNeighbours();ComputeDensity(false);ApplySurfaceTension(dt);Previous_=Positions_;
    for(std::size_t i=0;i<Positions_.size();++i){Velocities_[i].y-=Gravity_*dt;Positions_[i]+=Velocities_[i]*dt;Collide(Positions_[i]);}
    SolvePressure();
    for(std::size_t i=0;i<Positions_.size();++i)Velocities_[i]=(Positions_[i]-Previous_[i])/dt;
    ApplyViscosity(dt);
}

void PbfFluid::Pour(float dt,float rate) {
    if(Experiment_!=Experiment::Basin) return;
    Emission_+=dt*rate*120.0f;
    while(Emission_>=1.0f&&Positions_.size()<MaxParticles){Emission_-=1.0f;const float a=Time_*23.0f+Positions_.size()*2.39996f;const float r=0.12f*std::sqrt((Positions_.size()%11)/10.0f);Add({-0.65f+std::cos(a)*r,2.55f,-0.15f+std::sin(a)*r},{0.08f,-4.1f,0});}
    Emission_=std::min(Emission_,1.0f);
}

void PbfFluid::Stir(float strength,float cx,float cz) {
    for(std::size_t i=0;i<Positions_.size();++i){const float x=Positions_[i].x-cx,z=Positions_[i].z-cz,f=std::exp(-(x*x+z*z)*0.6f)*strength;Velocities_[i].x-=z*f;Velocities_[i].z+=x*f;Velocities_[i].y+=f*0.38f;}
}

} // namespace Frontier::ProjectFluid
