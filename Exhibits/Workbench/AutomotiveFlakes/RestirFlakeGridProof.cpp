// ReSTIR direct-light proof for the C++ automotive-flake material.
#include "../../../PhotometricIllumination/AutomotiveFlakeMaterial.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <random>
#include <vector>
using namespace Frontier;
struct Reservoir { int selected = -1; float weightSum = 0.0f; uint32_t count = 0; void Add(int i,float w,float r){weightSum+=w;++count;if(r*weightSum<=w)selected=i;} };
struct Light { Vector3 Direction; Vector3 Radiance; };
float Hash01(uint32_t x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return float(x>>8)*(1.f/16777216.f);}
int main(){
 const int W=1200,H=800,TW=280,TH=230;std::vector<unsigned char> px(W*H*3,5);std::mt19937 rng(19);std::uniform_real_distribution<float> random(0.f,1.f);
 std::vector<Light> lights; for(int i=0;i<32;++i){float a=6.2831853f*i/32.f;float z=.35f+.65f*random(rng);float r=std::sqrt(1-z*z);lights.push_back({Vector3{r*std::cos(a),r*std::sin(a),z}.Normalized(),Vector3{18.f+12.f*random(rng),16.f+10.f*random(rng),14.f+18.f*random(rng)}});}
 for(int row=0;row<3;++row)for(int col=0;col<4;++col){AutomotiveFlakeMaterial mat;auto&p=mat.AccessParameters();p.Density= row==2?8.f:4.f;p.DiameterMillimetres= row==1?.16f:.24f;p.ClearcoatWeight=1.f;p.ClearcoatRoughness=.16f;p.ClearcoatTintStrength=.12f;
  AutomotiveFlakePalette palette{}; palette.Count=1;palette.Weight[0]=1; if(col==0){p.Pigment={.16f,.008f,.012f};palette.Minimum[0]={.62f,.008f,.004f};palette.Maximum[0]={1.f,.08f,.025f};}
  if(col==1){p.Pigment={.008f,.03f,.18f};palette=AutomotiveFlakePalette::RGB();palette.Weight[0]=0;palette.Weight[1]=0;palette.Weight[2]=1;p.PearlWeight=.65f;p.FilmThicknessNanometres=510.f;}
  if(col==2){p.Pigment={.01f,.14f,.025f};palette=AutomotiveFlakePalette::RGB();p.ClearcoatTint={.02f,.12f,1.f};p.ClearcoatTintStrength=.2f;}
  if(col==3){p.Pigment={.20f,.08f,.005f};palette=AutomotiveFlakePalette::RGB();palette.Weight[0]=.35f;palette.Weight[1]=.25f;palette.Weight[2]=.4f;p.PearlWeight=.45f;p.FilmThicknessNanometres=610.f;}
  for(int y=0;y<TH;++y)for(int x=0;x<TW;++x){int ox=20+col*295,oy=25+row*250;float sx=(2.f*(x+.5f)/TW-1.f)*.92f,sy=1.f-2.f*(y+.5f)/TH,r2=sx*sx+sy*sy;Vector3 c{.008f,.01f,.016f};if(r2<.94f){float z=std::sqrt(.94f-r2);Vector3 n{sx,sy,z};n=n.Normalized();auto s=mat.ApplyPalette(mat.Prepare({n.x*.12f,n.y*.12f},{.00012f,0},{0,.00012f}),palette);Vector3 v{0,0,1};Vector3 restirSum{};for(int temporal=0;temporal<8;++temporal){Reservoir reservoir;for(int i=0;i<(int)lights.size();++i){float w=std::max(0.f,n.x*lights[i].Direction.x+n.y*lights[i].Direction.y+n.z*lights[i].Direction.z);reservoir.Add(i,w,Hash01(static_cast<uint32_t>((row*4+col)*1000000+y*TW+x*8+temporal+i)));}if(reservoir.selected>=0){auto&l=lights[reservoir.selected];Vector3 brdf=mat.Evaluate(s,v,l.Direction);restirSum+=brdf*l.Radiance*std::max(0.f,n.x*l.Direction.x+n.y*l.Direction.y+n.z*l.Direction.z)*((float)lights.size()/std::max(.001f,reservoir.weightSum));}}c=restirSum*.125f;c+=Vector3{.018f,.018f,.022f}*std::max(0.f,n.z);c={std::clamp(c.x*2.8f,0.f,1.f),std::clamp(c.y*2.8f,0.f,1.f),std::clamp(c.z*2.8f,0.f,1.f)};c={std::pow(c.x,.4545f),std::pow(c.y,.4545f),std::pow(c.z,.4545f)};}int iy=oy+y,ix=ox+x;if(ix>=0&&ix<W&&iy>=0&&iy<H){auto*d=&px[(iy*W+ix)*3];d[0]=(unsigned char)(c.x*255);d[1]=(unsigned char)(c.y*255);d[2]=(unsigned char)(c.z*255);}}}
 std::ofstream out("Exhibits/Gallery/AutomotiveFlakes/ReSTIR_MetallicFlakeGrid.ppm",std::ios::binary);out<<"P6\n"<<W<<" "<<H<<"\n255\n";out.write((char*)px.data(),px.size());}
