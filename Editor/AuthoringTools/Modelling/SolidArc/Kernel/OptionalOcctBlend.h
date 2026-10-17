#pragma once
// Optional general native C++ OCCT blend worker. Rational surfaces/curves and
// trim loops cross this boundary, never triangle meshes or rasterized pixels.
#include "TopologySpecification.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <optional>
#include <sstream>
#include <stdexcept>

namespace Frontier {
inline std::optional<Deliver<BrepBody>>
OptionalOcctBlend(const BrepBody &Body, const std::vector<int> &Edges,
                  double Size, bool Chamfer) noexcept {
#if defined(__EMSCRIPTEN__) || !defined(__linux__)
  return std::nullopt;
#else
  const char *Executable = std::getenv("SOLIDARC_OCCT_BLEND_HOST");
  if (!Executable || !*Executable)
    return std::nullopt;
  // The new route repairs spherical Boolean supports. Keep established native
  // cylinder/cone/mixed-cap routes (including their corner expansion) intact.
  if (std::none_of(Body.Faces.begin(), Body.Faces.end(), [](const auto &F) {
        return F.Surface.Classification == SurfaceClassification::Sphere;
      }))
    return std::nullopt;
  namespace Fs = std::filesystem;
  static std::atomic<unsigned> Counter{0};
  Fs::path Folder;
  auto Reject = [](const std::string &Reason) {
    static thread_local std::string Message;
    Message = "Native OCCT blend: " + Reason;
    return Deliver<BrepBody>::Reject(RefusalReason::Unsupported,
                                     Message.c_str());
  };
  try {
    Folder = Fs::path("_AgentScratch/tmp") /
             ("OcctBlend-" +
              std::to_string(std::chrono::high_resolution_clock::now()
                                 .time_since_epoch()
                                 .count()) +
              "-" + std::to_string(++Counter));
    Fs::create_directories(Folder);
    const auto Input = Folder / "input.json", Output = Folder / "output.txt";
    std::ofstream O(Input);
    O << std::setprecision(17);
    auto Numbers = [&](const auto &Values) {
      O << '[';
      for (size_t I = 0; I < Values.size(); ++I) {
        if (I)
          O << ',';
        O << Values[I];
      }
      O << ']';
    };
    auto Poles = [&](const auto &Values) {
      O << '[';
      for (size_t I = 0; I < Values.size(); ++I) {
        if (I)
          O << ',';
        auto P = Values[I];
        O << '[' << P.X << ',' << P.Y << ',' << P.Z << ',' << P.W << ']';
      }
      O << ']';
    };
    auto Curve = [&](const auto &C) {
      O << "{\"d\":" << C.Degree << ",\"k\":";
      Numbers(C.Knots);
      O << ",\"p\":";
      Poles(C.Poles);
      O << '}';
    };
    O << "{\"size\":" << Size << ",\"chamfer\":" << (Chamfer ? "true" : "false")
      << ",\"selected\":";
    Numbers(Edges);
    O << ",\"vertices\":[";
    for (size_t I = 0; I < Body.Vertices.size(); ++I) {
      if (I)
        O << ',';
      auto P = Body.Vertices[I].Point;
      O << '[' << P.X << ',' << P.Y << ',' << P.Z << ']';
    }
    O << "],\"edges\":[";
    for (size_t I = 0; I < Body.Edges.size(); ++I) {
      if (I)
        O << ',';
      auto &E = Body.Edges[I];
      O << "{\"a\":" << E.VertexStart << ",\"b\":" << E.VertexEnd
        << ",\"curve\":";
      Curve(E.Curve);
      O << '}';
    }
    O << "],\"faces\":[";
    for (size_t I = 0; I < Body.Faces.size(); ++I) {
      if (I)
        O << ',';
      auto &F = Body.Faces[I];
      auto &S = F.Surface;
      O << "{\"reverse\":" << (F.Reversed ? "true" : "false")
        << ",\"s\":{\"class\":" << int(S.Classification) << ",\"origin\":["
        << S.Origin.X << ',' << S.Origin.Y << ',' << S.Origin.Z
        << "],\"axis\":[" << S.Axis.X << ',' << S.Axis.Y << ',' << S.Axis.Z
        << "],\"radius\":" << S.RadiusMajor << ",\"du\":" << S.DegreeU
        << ",\"dv\":" << S.DegreeV << ",\"nu\":" << S.CountU
        << ",\"nv\":" << S.CountV << ",\"ku\":";
      Numbers(S.KnotsU);
      O << ",\"kv\":";
      Numbers(S.KnotsV);
      O << ",\"p\":";
      Poles(S.Poles);
      O << "},\"loops\":[";
      for (size_t L = 0; L < F.Loops.size(); ++L) {
        if (L)
          O << ',';
        auto &Loop = Body.Loops[F.Loops[L]];
        O << "{\"outer\":" << (Loop.Outer ? "true" : "false") << ",\"ces\":[";
        for (size_t C = 0; C < Loop.Coedges.size(); ++C) {
          if (C)
            O << ',';
          int CI = Loop.Coedges[C];
          auto &Ce = Body.Coedges[CI];
          O << "{\"e\":" << Ce.Edge
            << ",\"r\":" << (Ce.Reversed ? "true" : "false") << ",\"uv\":[";
          auto UV = Body.CoedgeTrace(CI);
          for (size_t U = 0; U < UV.size(); ++U) {
            if (U)
              O << ',';
            O << '[' << UV[U].X << ',' << UV[U].Y << ']';
          }
          O << "]}";
        }
        O << "]}";
      }
      O << "]}";
    }
    O << "]}";
    O.close();
    auto Quote = [](const std::string &S) {
      std::string Q = "'";
      for (char C : S)
        Q += C == '\'' ? "'\\''" : std::string(1, C);
      return Q + "'";
    };
    const int Code = std::system(
        ("timeout --signal=TERM --kill-after=2 30s " + Quote(Executable) + " " +
         Quote(Input.string()) + " " + Quote(Output.string()))
            .c_str());
    std::ifstream In(Output);
    std::string Status;
    In >> Status;
    if (Code || Status != "OK") {
      std::string Reason;
      std::getline(In, Reason);
      Fs::remove_all(Folder);
      return Reject(Reason.empty() ? "worker failed or unavailable" : Reason);
    }
    double SourceVolume = 0, WorkerVolume = 0;
    In >> SourceVolume >> WorkerVolume;
    auto Count = [&]() {
      int N = 0;
      In >> N;
      if (!In || N < 0 || N > 1000000)
        throw std::runtime_error("invalid worker extent");
      return N;
    };
    BrepBody Result;
    int NV = Count();
    for (int I = 0; I < NV; ++I) {
      BrepVertex V;
      In >> V.Point.X >> V.Point.Y >> V.Point.Z;
      Result.Vertices.push_back(V);
    }
    int NE = Count();
    for (int I = 0; I < NE; ++I) {
      BrepEdge E;
      In >> E.VertexStart >> E.VertexEnd >> E.Curve.Degree;
      int NP = Count(), NK = Count();
      E.Curve.Poles.resize(NP);
      E.Curve.Knots.resize(NK);
      for (auto &P : E.Curve.Poles)
        In >> P.X >> P.Y >> P.Z >> P.W;
      for (auto &K : E.Curve.Knots)
        In >> K;
      if (E.Curve.Degree > 15 || E.VertexStart < 0 || E.VertexStart >= NV ||
          E.VertexEnd < 0 || E.VertexEnd >= NV || E.Curve.Validate())
        throw std::runtime_error("invalid worker edge");
      E.Curve.Classification = E.Curve.Degree == 1
                                   ? CurveClassification::Line
                                   : CurveClassification::Freeform;
      Result.Edges.push_back(E);
    }
    int NF = Count();
    for (int I = 0; I < NF; ++I) {
      BrepFace F;
      int Class;
      In >> F.Reversed >> Class >> F.Surface.DegreeU >> F.Surface.DegreeV >>
          F.Surface.CountU >> F.Surface.CountV;
      int KU = Count(), KV = Count();
      if (F.Surface.DegreeU > 15 || F.Surface.DegreeV > 15 ||
          F.Surface.CountU <= 0 || F.Surface.CountV <= 0 ||
          F.Surface.CountU > 10000 || F.Surface.CountV > 10000 ||
          1LL * F.Surface.CountU * F.Surface.CountV > 1000000)
        throw std::runtime_error("invalid worker surface extent");
      F.Natural = false;
      F.Surface.Classification = Class == 1 ? SurfaceClassification::Plane
                                            : SurfaceClassification::Freeform;
      F.Surface.Poles.resize(F.Surface.CountU * F.Surface.CountV);
      F.Surface.KnotsU.resize(KU);
      F.Surface.KnotsV.resize(KV);
      for (auto &P : F.Surface.Poles)
        In >> P.X >> P.Y >> P.Z >> P.W;
      for (auto &K : F.Surface.KnotsU)
        In >> K;
      for (auto &K : F.Surface.KnotsV)
        In >> K;
      if (F.Surface.Validate())
        throw std::runtime_error("invalid worker surface");
      Result.Faces.push_back(F);
      int NL = Count();
      for (int L = 0; L < NL; ++L) {
        bool Outer;
        In >> Outer;
        int NC = Count();
        int Loop = Result.AddLoop(I, Outer);
        for (int C = 0; C < NC; ++C) {
          int E;
          bool Reverse;
          In >> E >> Reverse;
          int NT = Count();
          if (E < 0 || E >= NE)
            throw std::runtime_error("invalid worker coedge");
          int Ce = Result.AddCoedge(E, Reverse, I, Loop);
          auto &Trace = Result.Coedges[Ce].Trace;
          Trace.resize(NT);
          for (auto &P : Trace) {
            Vec3 Reference;
            In >> P.X >> P.Y >> Reference.X >> Reference.Y >> Reference.Z;
            if (Result.Faces[I].Surface.Sample(P.X, P.Y).Distance(Reference) >
                2e-8 * std::max(1., Reference.Length()))
              throw std::runtime_error(
                  "native support evaluation disagrees with OCCT");
          }
        }
      }
    }
    if (!In)
      throw std::runtime_error("truncated worker B-rep");
    double EndpointError = 0;
    std::string EndpointDetail;
    for (const auto &Ce : Result.Coedges) {
      if (Ce.Trace.empty())
        continue;
      const auto &E = Result.Edges[Ce.Edge];
      const auto &S = Result.Faces[Ce.Face].Surface;
      auto A = Ce.Trace.front(), B = Ce.Trace.back();
      double
          EA = S.Sample(A.X, A.Y).Distance(
              Result.Vertices[Ce.Reversed ? E.VertexEnd : E.VertexStart].Point),
          EB = S.Sample(B.X, B.Y).Distance(
              Result.Vertices[Ce.Reversed ? E.VertexStart : E.VertexEnd].Point);
      if (std::max(EA, EB) > EndpointError) {
        EndpointError = std::max(EA, EB);
        EndpointDetail = " face " + std::to_string(Ce.Face) + " edge " +
                         std::to_string(Ce.Edge) + " start " +
                         std::to_string(EA) + " end " + std::to_string(EB);
      }
    }
    if (EndpointError > 2e-5)
      throw std::runtime_error("trim endpoint error " +
                               std::to_string(EndpointError) + EndpointDetail);

    Fs::remove_all(Folder);
    // Retain verified source-sphere hints for downstream native operations and
    // later bevels. The rational representation is unchanged, including UVs.
    for (auto &Face : Result.Faces) {
      if (Face.Surface.Classification != SurfaceClassification::Freeform)
        continue;
      auto &S = Face.Surface;
      for (const auto &Source : Body.Faces) {
        const auto &Original = Source.Surface;
        if (Original.Classification != SurfaceClassification::Sphere)
          continue;
        bool OnSphere = true;
        for (int U = 0; U <= 4 && OnSphere; ++U)
          for (int V = 0; V <= 4; ++V) {
            auto P = S.Sample(S.DomainStartU() +
                                  (S.DomainEndU() - S.DomainStartU()) * U / 4.,
                              S.DomainStartV() +
                                  (S.DomainEndV() - S.DomainStartV()) * V / 4.);
            if (std::abs(P.Distance(Original.Origin) - Original.RadiusMajor) >
                1e-8 * std::max(1., Original.RadiusMajor)) {
              OnSphere = false;
              break;
            }
          }
        if (OnSphere) {
          S.Classification = SurfaceClassification::Sphere;
          S.Origin = Original.Origin;
          S.Axis = Original.Axis;
          S.RadiusMajor = Original.RadiusMajor;
          S.RadiusMinor = Original.RadiusMinor;
          break;
        }
      }
    }
    const double NativeSourceVolume = Body.Validate().Volume;
    if (!std::isfinite(SourceVolume) || !std::isfinite(WorkerVolume) ||
        SourceVolume <= 0 || WorkerVolume <= 0 ||
        std::abs(NativeSourceVolume - SourceVolume) >
            std::max(1e-12, .003 * std::abs(SourceVolume)))
      return Reject("source geometry changed during B-rep import");
    auto Check = Result.Validate();
    if (std::abs(Check.Volume - WorkerVolume) >
        std::max(1e-12, .003 * std::abs(WorkerVolume)))
      return Reject(
          "native trim reconstruction disagrees with worker volume: " +
          std::to_string(Check.Volume) + " vs " + std::to_string(WorkerVolume));
    if (!Check.Solid() || !std::isfinite(Check.Volume) || Check.Volume <= 0)
      return Reject("returned B-rep failed native solid validation");
    return Deliver<BrepBody>::Accept(std::move(Result));
  } catch (const std::exception &E) {
    std::error_code Error;
    if (!Folder.empty())
      Fs::remove_all(Folder, Error);
    return Reject(E.what());
  }
#endif
}
} // namespace Frontier
