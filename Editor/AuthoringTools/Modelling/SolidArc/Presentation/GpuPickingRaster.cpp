#include "GpuPickingRaster.h"
#include "SoftwareRaster.h"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <string>
#ifdef _WIN32
#include <windows.h>
#define GPUCALL __stdcall
#else
#include <dlfcn.h>
#define GPUCALL
#endif
namespace Frontier {
namespace {
std::string Driver="CPU reference picking";
void* Library(const std::string& Path){
#ifdef _WIN32
    return reinterpret_cast<void*>(LoadLibraryA(Path.c_str()));
#else
    return dlopen(Path.c_str(),RTLD_NOW|RTLD_LOCAL);
#endif
}
void* Symbol(void* Lib,const char* Name){
#ifdef _WIN32
    return reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(Lib),Name));
#else
    return dlsym(Lib,Name);
#endif
}
void CloseLibrary(void* Lib){if(!Lib)return;
#ifdef _WIN32
    FreeLibrary(static_cast<HMODULE>(Lib));
#else
    dlclose(Lib);
#endif
}
using U=unsigned;using I=int;using B=unsigned char;using Size=std::ptrdiff_t;
class GpuPickingRaster final:public RasterExchange {
    std::unique_ptr<SoftwareRaster> Reference;
    void *Egl=nullptr,*Gl=nullptr,*Display=nullptr,*Context=nullptr,*Surface=nullptr;
    void* (GPUCALL *GetProc)(const char*)=nullptr;
#define E(R,N,A) R (GPUCALL *N) A=nullptr
    E(void*,eglGetDisplay,(void*));E(unsigned,eglInitialize,(void*,int*,int*));E(unsigned,eglBindAPI,(U));
    E(unsigned,eglChooseConfig,(void*,const int*,void**,int,int*));E(void*,eglCreateContext,(void*,void*,void*,const int*));
    E(void*,eglCreatePbufferSurface,(void*,void*,const int*));E(unsigned,eglMakeCurrent,(void*,void*,void*,void*));
    E(unsigned,eglDestroySurface,(void*,void*));E(unsigned,eglDestroyContext,(void*,void*));E(unsigned,eglTerminate,(void*));
    E(void,glGenFramebuffers,(I,U*));E(void,glBindFramebuffer,(U,U));E(void,glDeleteFramebuffers,(I,const U*));
    E(void,glGenTextures,(I,U*));E(void,glBindTexture,(U,U));E(void,glTexImage2D,(U,I,I,I,I,I,U,U,const void*));
    E(void,glTexParameteri,(U,U,I));E(void,glDeleteTextures,(I,const U*));E(void,glFramebufferTexture2D,(U,U,U,U,I));
    E(void,glGenRenderbuffers,(I,U*));E(void,glBindRenderbuffer,(U,U));E(void,glRenderbufferStorage,(U,U,I,I));
    E(void,glFramebufferRenderbuffer,(U,U,U,U));E(void,glDeleteRenderbuffers,(I,const U*));E(U,glCheckFramebufferStatus,(U));
    E(U,glCreateShader,(U));E(void,glShaderSource,(U,I,const char* const*,const I*));E(void,glCompileShader,(U));
    E(void,glGetShaderiv,(U,U,I*));E(void,glGetShaderInfoLog,(U,I,I*,char*));E(U,glCreateProgram,());
    E(void,glAttachShader,(U,U));E(void,glLinkProgram,(U));E(void,glGetProgramiv,(U,U,I*));E(void,glDeleteShader,(U));E(void,glDeleteProgram,(U));
    E(void,glUseProgram,(U));E(I,glGetUniformLocation,(U,const char*));E(void,glUniformMatrix4fv,(I,I,B,const float*));
    E(void,glUniform1ui,(I,U));E(void,glUniform1f,(I,float));E(void,glUniform1i,(I,I));
    E(void,glGenBuffers,(I,U*));E(void,glBindBuffer,(U,U));E(void,glBufferData,(U,Size,const void*,U));E(void,glDeleteBuffers,(I,const U*));
    E(void,glGenVertexArrays,(I,U*));E(void,glBindVertexArray,(U));E(void,glDeleteVertexArrays,(I,const U*));
    E(void,glEnableVertexAttribArray,(U));E(void,glVertexAttribPointer,(U,I,U,B,I,const void*));
    E(void,glViewport,(I,I,I,I));E(void,glEnable,(U));E(void,glDisable,(U));E(void,glDepthFunc,(U));E(void,glDepthMask,(B));
    E(void,glClearBufferuiv,(U,I,const U*));E(void,glClearBufferfv,(U,I,const float*));E(void,glDrawArrays,(U,I,I));
    E(void,glDrawElements,(U,I,U,const void*));E(void,glLineWidth,(float));E(void,glReadPixels,(I,I,I,I,U,U,void*));
    E(const unsigned char*,glGetString,(U));E(U,glGetError,());
#undef E
    U AllocatedW=0,AllocatedH=0;
    U Fbo=0,Ids=0,DepthBuffer=0,Program=0,Vbo=0,Ebo=0,Vao=0;bool Overlay=false;
    ViewRecord View{};
    template<class T>void Load(T& F,const char* Name,bool IsEgl=false){F=reinterpret_cast<T>(Symbol(IsEgl?Egl:Gl,Name));if(!F&&!IsEgl)F=reinterpret_cast<T>(GetProc(Name));if(!F)throw std::runtime_error(std::string("Missing native GPU function: ")+Name);}
    void Current()const noexcept {eglMakeCurrent(Display,Surface,Surface,Context);}
    U Shader(U Type,const char* Source){U S=glCreateShader(Type);glShaderSource(S,1,&Source,nullptr);glCompileShader(S);I Ok=0;glGetShaderiv(S,0x8B81,&Ok);if(!Ok){char Log[2048]{};glGetShaderInfoLog(S,sizeof(Log),nullptr,Log);glDeleteShader(S);throw std::runtime_error(std::string("GPU pick shader: ")+Log);}return S;}
    void Release()noexcept{
        if(Context&&eglMakeCurrent){Current();if(Program)glDeleteProgram(Program);if(Vbo)glDeleteBuffers(1,&Vbo);if(Ebo)glDeleteBuffers(1,&Ebo);if(Vao)glDeleteVertexArrays(1,&Vao);if(Fbo)glDeleteFramebuffers(1,&Fbo);if(Ids)glDeleteTextures(1,&Ids);if(DepthBuffer)glDeleteRenderbuffers(1,&DepthBuffer);eglMakeCurrent(Display,nullptr,nullptr,nullptr);if(eglDestroySurface&&Surface)eglDestroySurface(Display,Surface);if(eglDestroyContext)eglDestroyContext(Display,Context);}
        if(Display&&eglTerminate)eglTerminate(Display);CloseLibrary(Gl);CloseLibrary(Egl);
    }
    void Draw(const std::vector<float>& P,const std::vector<uint32_t>* Indices,const DrawRecord& D,U Mode,int Stride){
        if(P.empty()||!D.PickIdentity)return;Current();glBindFramebuffer(0x8D40,Fbo);glUseProgram(Program);glBindVertexArray(Vao);
        glUniformMatrix4fv(glGetUniformLocation(Program,"viewClip"),1,0,View.ViewClip);glUniformMatrix4fv(glGetUniformLocation(Program,"localWorld"),1,0,D.LocalWorld);
        glUniform1ui(glGetUniformLocation(Program,"identity"),D.PickIdentity);glUniform1f(glGetUniformLocation(Program,"pointSize"),D.PointSize);
        glUniform1i(glGetUniformLocation(Program,"disc"),Mode==0);glUniform1f(glGetUniformLocation(Program,"bias"),Mode==4?0:View.DepthPolicy[0]);
        if(Overlay){glDisable(0x0B71);glDepthMask(0);}else{glEnable(0x0B71);glDepthMask(1);}glDisable(0x0BE2);glDisable(0x0BD0);
        glBindBuffer(0x8892,Vbo);glBufferData(0x8892,Size(P.size()*sizeof(float)),P.data(),0x88E0);glEnableVertexAttribArray(0);glVertexAttribPointer(0,3,0x1406,0,Stride*int(sizeof(float)),nullptr);
        if(Mode==1)glLineWidth(std::max(1.f,D.LineWidth));
        if(Indices){glBindBuffer(0x8893,Ebo);glBufferData(0x8893,Size(Indices->size()*sizeof(U)),Indices->data(),0x88E0);glDrawElements(Mode,I(Indices->size()),0x1405,nullptr);}else glDrawArrays(Mode,0,I(P.size()/Stride));
    }
public:
    GpuPickingRaster(U W,U H,const std::string& Directory):Reference(std::make_unique<SoftwareRaster>(W,H)){
        try{
#ifdef _WIN32
            Egl=Library(Directory+"/libEGL.dll");Gl=Library(Directory+"/libGLESv2.dll");
#else
            Egl=Library(Directory+"/libEGL.so");Gl=Library(Directory+"/libGLESv2.so");
#endif
            if(!Egl||!Gl)throw std::runtime_error("Native GPU picking requested but EGL/GLES libraries could not load");
            GetProc=reinterpret_cast<decltype(GetProc)>(Symbol(Egl,"eglGetProcAddress"));if(!GetProc)throw std::runtime_error("No eglGetProcAddress");
#define L(N) Load(N,#N,true)
            L(eglGetDisplay);L(eglInitialize);L(eglBindAPI);L(eglChooseConfig);L(eglCreateContext);L(eglCreatePbufferSurface);L(eglMakeCurrent);L(eglDestroySurface);L(eglDestroyContext);L(eglTerminate);
#undef L
            using Platform=void* (GPUCALL *)(U,void*,const int*);auto PlatformDisplay=reinterpret_cast<Platform>(GetProc("eglGetPlatformDisplayEXT"));
            const int Angle[]={0x3203,0x3450,0x3209,0x3487,0x3038};
            Display=PlatformDisplay?PlatformDisplay(0x3202,nullptr,Angle):nullptr;int Major,Minor;
            if(!Display||!eglInitialize(Display,&Major,&Minor)){Display=eglGetDisplay(nullptr);if(!Display||!eglInitialize(Display,&Major,&Minor))throw std::runtime_error("Native GPU EGL initialization failed");}
            if(!eglBindAPI(0x30A0))throw std::runtime_error("EGL ES API unavailable");void* Config=nullptr;int Count=0;
            const int Attr[]={0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3038};
            if(!eglChooseConfig(Display,Attr,&Config,1,&Count)||Count!=1)throw std::runtime_error("No native GLES3 config");
            const int Ca[]={0x3098,3,0x3038},Pa[]={0x3057,1,0x3056,1,0x3038};Context=eglCreateContext(Display,Config,nullptr,Ca);Surface=eglCreatePbufferSurface(Display,Config,Pa);
            if(!Context||!Surface||!eglMakeCurrent(Display,Surface,Surface,Context))throw std::runtime_error("Native GLES3 context failed");
#define L(N) Load(N,#N)
            L(glGenFramebuffers);L(glBindFramebuffer);L(glDeleteFramebuffers);L(glGenTextures);L(glBindTexture);L(glTexImage2D);L(glTexParameteri);L(glDeleteTextures);L(glFramebufferTexture2D);L(glGenRenderbuffers);L(glBindRenderbuffer);L(glRenderbufferStorage);L(glFramebufferRenderbuffer);L(glDeleteRenderbuffers);L(glCheckFramebufferStatus);L(glCreateShader);L(glShaderSource);L(glCompileShader);L(glGetShaderiv);L(glGetShaderInfoLog);L(glCreateProgram);L(glAttachShader);L(glLinkProgram);L(glGetProgramiv);L(glDeleteShader);L(glDeleteProgram);L(glUseProgram);L(glGetUniformLocation);L(glUniformMatrix4fv);L(glUniform1ui);L(glUniform1f);L(glUniform1i);L(glGenBuffers);L(glBindBuffer);L(glBufferData);L(glDeleteBuffers);L(glGenVertexArrays);L(glBindVertexArray);L(glDeleteVertexArrays);L(glEnableVertexAttribArray);L(glVertexAttribPointer);L(glViewport);L(glEnable);L(glDisable);L(glDepthFunc);L(glDepthMask);L(glClearBufferuiv);L(glClearBufferfv);L(glDrawArrays);L(glDrawElements);L(glLineWidth);L(glReadPixels);L(glGetString);L(glGetError);
#undef L
            const char* Vs="#version 300 es\nlayout(location=0) in vec3 p;uniform mat4 viewClip,localWorld;uniform float pointSize,bias;void main(){gl_Position=viewClip*localWorld*vec4(p,1);gl_Position.z-=bias;gl_Position.y=-gl_Position.y;gl_Position.z=2.0*gl_Position.z-gl_Position.w;gl_PointSize=pointSize;}";
            const char* Fs="#version 300 es\nprecision highp float;precision highp int;uniform uint identity;uniform bool disc;layout(location=0) out uint id;void main(){if(disc&&dot(gl_PointCoord-vec2(.5),gl_PointCoord-vec2(.5))>.25)discard;id=identity;}";
            U V=Shader(0x8B31,Vs),F=Shader(0x8B30,Fs);Program=glCreateProgram();glAttachShader(Program,V);glAttachShader(Program,F);glLinkProgram(Program);glDeleteShader(V);glDeleteShader(F);I Ok=0;glGetProgramiv(Program,0x8B82,&Ok);if(!Ok)throw std::runtime_error("GPU pick program link failed");
            glGenBuffers(1,&Vbo);glGenBuffers(1,&Ebo);glGenVertexArrays(1,&Vao);glGenFramebuffers(1,&Fbo);glGenTextures(1,&Ids);glGenRenderbuffers(1,&DepthBuffer);Resize(W,H);if(glCheckFramebufferStatus(0x8D40)!=0x8CD5||glGetError())throw std::runtime_error("Native integer picking framebuffer failed");Driver=std::string("native GLES3 integer ID/depth picking: ")+reinterpret_cast<const char*>(glGetString(0x1F01));
        }catch(...){Release();throw;}
    }
    ~GpuPickingRaster()override{Release();}
    void Resize(U W,U H)noexcept override{if(W==AllocatedW&&H==AllocatedH)return;AllocatedW=W;AllocatedH=H;Reference->Resize(W,H);Current();glBindFramebuffer(0x8D40,Fbo);glBindTexture(0x0DE1,Ids);glTexParameteri(0x0DE1,0x2801,0x2600);glTexParameteri(0x0DE1,0x2800,0x2600);glTexImage2D(0x0DE1,0,0x8236,W,H,0,0x8D94,0x1405,nullptr);glFramebufferTexture2D(0x8D40,0x8CE0,0x0DE1,Ids,0);glBindRenderbuffer(0x8D41,DepthBuffer);glRenderbufferStorage(0x8D41,0x81A6,W,H);glFramebufferRenderbuffer(0x8D40,0x8D00,0x8D41,DepthBuffer);}
    U Width()const noexcept override{return Reference->Width();}U Height()const noexcept override{return Reference->Height();}
    void AssignSamples(U N)noexcept override{Reference->AssignSamples(N);}U QuerySamples()const noexcept override{return Reference->QuerySamples();}
    void BeginTarget(const float C[4])noexcept override{Reference->BeginTarget(C);Current();Overlay=false;glBindFramebuffer(0x8D40,Fbo);glViewport(0,0,Width(),Height());U Zero[4]{};float Far=1;glDepthMask(1);glClearBufferuiv(0x1800,0,Zero);glClearBufferfv(0x1801,0,&Far);glDepthFunc(0x0203);}
    void BindView(const ViewRecord& V)noexcept override{View=V;Reference->BindView(V);}
    void DrawLattice()noexcept override{Reference->DrawLattice();} // Grid cannot occlude selectable geometry.
    void DrawSurface(const SurfaceStream& S,const DrawRecord& D)noexcept override{Reference->DrawSurface(S,D);Draw(S.Positions,&S.Triangles,D,4,3);}
    void DrawSegments(const SegmentStream& S,const DrawRecord& D)noexcept override{Reference->DrawSegments(S,D);Draw(S.Endpoints,nullptr,D,1,3);}
    void DrawPoints(const PointStream& S,const DrawRecord& D)noexcept override{Reference->DrawPoints(S,D);Draw(S.Points,nullptr,D,0,4);}
    void BeginOverlay()noexcept override{Reference->BeginOverlay();Overlay=true;}void EndTarget()noexcept override{Reference->EndTarget();}
    RasterImage Readback()const noexcept override{return Reference->Readback();}
    U Pick(U X,U Y)const noexcept override{if(X>=Width()||Y>=Height())return 0;Current();glBindFramebuffer(0x8D40,Fbo);U Id=0;glReadPixels(X,Height()-1-Y,1,1,0x8D94,0x1405,&Id);return Id;}
    float Depth(U X,U Y)const noexcept override{return Reference->Depth(X,Y);}Tally QueryTally()const noexcept override{return Reference->QueryTally();}
};
}
std::unique_ptr<RasterExchange> CreateEditorRaster(uint32_t W,uint32_t H){const char* Directory=std::getenv("SOLIDARC_GPU_PICKING_LIBRARY_DIR");if(Directory&&*Directory)return std::make_unique<GpuPickingRaster>(W,H,Directory);return std::make_unique<SoftwareRaster>(W,H);}
const char* NativePickingDriver()noexcept{return Driver.c_str();}
}
