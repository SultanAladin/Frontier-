// Optional native Open CASCADE fillet/chamfer bridge. No tessellated/mesh
// boolean. Reads SolidArc rational B-rep JSON; writes rational B-rep stream for
// native validation.
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_NurbsConvert.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <ChFiDS_ErrorStatus.hxx>
#include <BRepGProp.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepLib.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomConvert.hxx>
#include <GeomProjLib.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <ShapeFix_Face.hxx>
#include <ShapeUpgrade_ShapeDivideClosed.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeFix_Shape.hxx>
#include <Standard_Failure.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <algorithm>
#include <fstream>
#include <gp_Trsf2d.hxx>
#include <iomanip>
#include <iostream>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <sstream>
#include <vector>
using J = nlohmann::json;
constexpr double Tol = 2e-6;
gp_Pnt Point(const J &p) { return {p[0], p[1], p[2]}; }
struct KnotData {
  std::vector<double> k;
  std::vector<int> m;
  KnotData(const J &v) {
    for (double t : v) {
      if (k.empty() || t != k.back()) {
        k.push_back(t);
        m.push_back(1);
      } else
        ++m.back();
    }
  }
};
Handle(Geom_BSplineCurve) Curve(const J &c) {
  auto p = c.at("p");
  TColgp_Array1OfPnt poles(1, p.size());
  TColStd_Array1OfReal weights(1, p.size());
  for (int i = 0; i < int(p.size()); ++i) {
    double w = p[i][3];
    poles.SetValue(i + 1, gp_Pnt(double(p[i][0]) / w, double(p[i][1]) / w,
                                 double(p[i][2]) / w));
    weights.SetValue(i + 1, w);
  }
  KnotData d(c.at("k"));
  TColStd_Array1OfReal k(1, d.k.size());
  TColStd_Array1OfInteger m(1, d.m.size());
  for (int i = 0; i < int(d.k.size()); ++i) {
    k.SetValue(i + 1, d.k[i]);
    m.SetValue(i + 1, d.m[i]);
  }
  return new Geom_BSplineCurve(poles, weights, k, m, c.at("d"), false);
}
Handle(Geom_BSplineSurface) Spline(const J &s) {
  int u = s.at("nu"), v = s.at("nv");
  auto p = s.at("p");
  TColgp_Array2OfPnt poles(1, u, 1, v);
  TColStd_Array2OfReal w(1, u, 1, v);
  for (int i = 0; i < u; ++i)
    for (int j = 0; j < v; ++j) {
      auto q = p[i * v + j];
      double a = q[3];
      poles.SetValue(
          i + 1, j + 1,
          gp_Pnt(double(q[0]) / a, double(q[1]) / a, double(q[2]) / a));
      w.SetValue(i + 1, j + 1, a);
    }
  KnotData a(s.at("ku")), b(s.at("kv"));
  TColStd_Array1OfReal ku(1, a.k.size()), kv(1, b.k.size());
  TColStd_Array1OfInteger mu(1, a.m.size()), mv(1, b.m.size());
  for (int i = 0; i < int(a.k.size()); ++i) {
    ku.SetValue(i + 1, a.k[i]);
    mu.SetValue(i + 1, a.m[i]);
  }
  for (int i = 0; i < int(b.k.size()); ++i) {
    kv.SetValue(i + 1, b.k[i]);
    mv.SetValue(i + 1, b.m[i]);
  }
  return new Geom_BSplineSurface(poles, w, ku, kv, mu, mv, s.at("du"),
                                 s.at("dv"), false, false);
}
Handle(Geom_Surface) Surface(const J &s) {
  auto bs = Spline(s);
  if (int(s.at("class")) == 1) {
    double u0 = bs->FirstUKnotIndex(), a, b, c, d;
    bs->Bounds(a, b, c, d);
    gp_Pnt p;
    gp_Vec u, v;
    bs->D1(a, c, p, u, v);
    return new Geom_Plane(gp_Ax3(p, gp_Dir(u.Crossed(v)), gp_Dir(u)));
  }
  if (int(s.at("class")) == 2) {
    auto o=Point(s.at("origin"));auto ax=s.at("axis");gp_Dir z(ax[0],ax[1],ax[2]);
    double a,b,c,d;bs->Bounds(a,b,c,d);gp_Vec radial(o,bs->Value(a,(c+d)*.5));radial-=gp_Vec(z)*radial.Dot(gp_Vec(z));
    return new Geom_CylindricalSurface(gp_Ax3(o,z,gp_Dir(radial)),s.at("radius"));
  }
  if (int(s.at("class")) == 4) {
    auto o = Point(s.at("origin"));
    auto ax = s.at("axis");
    gp_Dir z(ax[0], ax[1], ax[2]);
    double a, b, c, d;
    bs->Bounds(a, b, c, d);
    gp_Vec x(o, bs->Value(a, (c + d) * .5));
    return new Geom_SphericalSurface(gp_Ax3(o, z, gp_Dir(x)), s.at("radius"));
  }
  return bs;
}
struct Imported {
  TopoDS_Shape shape;
  std::vector<Handle(Geom_BSplineCurve)> curves;
};
Imported Import(const J &j) {
  BRep_Builder bb;
  std::vector<TopoDS_Vertex> vertices;
  for (auto &p : j.at("vertices")) {
    TopoDS_Vertex v = BRepBuilderAPI_MakeVertex(Point(p));
    bb.UpdateVertex(v, Tol);
    vertices.push_back(v);
  }
  std::vector<TopoDS_Edge> edges;
  Imported out;
  for (auto &e : j.at("edges")) {
    auto c = Curve(e.at("curve"));
    out.curves.push_back(c);
    TopoDS_Edge t = BRepBuilderAPI_MakeEdge(
        c, vertices.at(int(e.at("a"))), vertices.at(int(e.at("b"))),
        c->FirstParameter(), c->LastParameter());
    bb.UpdateEdge(t, Tol);
    edges.push_back(t);
  }
  BRepBuilderAPI_Sewing sew(Tol * 5);
  for (auto &f : j.at("faces")) {
    auto s = Surface(f.at("s"));
    TopoDS_Face face;
    bb.MakeFace(face, s, Tol);
    bool flip = f.at("reverse");
    for (auto &l : f.at("loops")) {
      std::vector<TopoDS_Edge> walk;
      std::vector<Handle(Geom2d_Curve)> pcs;
      auto ces = l.at("ces");
      if (flip)
        std::reverse(ces.begin(), ces.end());
      // Install both seam representations together, on this surface.
      std::map<int, std::vector<Handle(Geom2d_Curve)>> perEdge;
      for (auto &ce : ces) {
        int n = ce.at("e");
        auto c = out.curves.at(n);
        double tol = Tol;
        auto pc = GeomProjLib::Curve2d(c, c->FirstParameter(),
                                       c->LastParameter(), s, tol);
        if (pc.IsNull())
          throw std::runtime_error("edge projection onto support failed");
        if (s->IsUClosed() && ce.contains("uv") && !ce.at("uv").empty()) {
          auto uv = ce.at("uv");
          double avg = 0;
          for (auto &q : uv)
            avg += double(q[0]);
          avg /= uv.size();
          double lo = f.at("s").at("ku").front(),
                 hi = f.at("s").at("ku").back();
          double u =
              pc->Value((c->FirstParameter() + c->LastParameter()) * .5).X();
          double a, b, v0, v1;
          s->Bounds(a, b, v0, v1);
          if (int(f.at("s").at("class")) == 4 || int(f.at("s").at("class")) == 2) {
            a = 0;
            b = 2 * M_PI;
          }
          if (avg > lo + (hi - lo) * .9 && u < a + (b - a) * .1) {
            gp_Trsf2d shift;
            shift.SetTranslation(gp_Vec2d(b - a, 0));
            pc = Handle(Geom2d_Curve)::DownCast(pc->Transformed(shift));
          }
        }
        perEdge[n].push_back(pc);
        bool rev = bool(ce.at("r")) != flip;
        walk.push_back(TopoDS::Edge(
            edges[n].Oriented(rev ? TopAbs_REVERSED : TopAbs_FORWARD)));
        pcs.push_back(pc);
      }
      for (auto &[id, ps] : perEdge) {
        if (ps.size() == 2)
          bb.UpdateEdge(edges[id], ps[0], ps[1], s, TopLoc_Location(), Tol);
        else
          bb.UpdateEdge(edges[id], ps[0], s, TopLoc_Location(), Tol);
        bb.Range(edges[id], s, TopLoc_Location(),
                 out.curves[id]->FirstParameter(),
                 out.curves[id]->LastParameter());
      }
      TopoDS_Wire wire;
      bb.MakeWire(wire);
      for (size_t i = 0; i < walk.size(); ++i) {
        bb.Add(wire, walk[i]);
        size_t n = (i + 1) % walk.size();
        double t0, t1;
        auto c0 = out.curves.at(int(ces[i].at("e"))),
             c1 = out.curves.at(int(ces[n].at("e")));
        bool r0 = walk[i].Orientation() == TopAbs_REVERSED,
             r1 = walk[n].Orientation() == TopAbs_REVERSED;
        gp_Pnt2d end = pcs[i]->Value(r0 ? c0->FirstParameter()
                                        : c0->LastParameter()),
                 start = pcs[n]->Value(r1 ? c1->LastParameter()
                                          : c1->FirstParameter());
        if (end.Distance(start) > 1e-4) {
          gp_Pnt a = s->Value(end.X(), end.Y()),
                 b = s->Value(start.X(), start.Y());
          if (a.Distance(b) > Tol * 10)
            continue;
          TopoDS_Edge de;
          bb.MakeEdge(de);
          bb.Degenerated(de, true);
          auto pc = new Geom2d_TrimmedCurve(
              new Geom2d_Line(end, gp_Dir2d(gp_Vec2d(end, start))), 0,
              end.Distance(start));
          bb.UpdateEdge(de, pc, s, TopLoc_Location(), Tol);
          bb.Range(de, s, TopLoc_Location(), 0, end.Distance(start));
          TopoDS_Vertex v = TopExp::LastVertex(walk[i], true);
          bb.Add(de, v.Oriented(TopAbs_FORWARD));
          bb.Add(de, v.Oriented(TopAbs_REVERSED));
          bb.Add(wire, de);
        }
      }
      bb.Add(face, wire);
    }
    if (flip)
      face.Reverse();
    Handle(ShapeFix_Face) fixFace=new ShapeFix_Face(face);
    fixFace->SetPrecision(Tol);fixFace->SetMaxTolerance(Tol*10);fixFace->Perform();
    sew.Add(fixFace->Result());
  }
  sew.Perform();
  TopoDS_Shape sewed = sew.SewedShape();
  TopoDS_Solid solid;
  bb.MakeSolid(solid);
  if (sewed.ShapeType() == TopAbs_SHELL)
    bb.Add(solid, sewed);
  else
    for (TopExp_Explorer e(sewed, TopAbs_SHELL); e.More(); e.Next())
      bb.Add(solid, e.Current());
  BRepLib::OrientClosedSolid(solid);
  Handle(ShapeFix_Shape) fix = new ShapeFix_Shape(solid);
  fix->SetPrecision(Tol);
  fix->SetMaxTolerance(Tol * 10);
  fix->Perform();
  out.shape = fix->Shape();
  if (!BRepCheck_Analyzer(out.shape).IsValid())
    throw std::runtime_error("imported trimmed B-rep did not validate in OCCT");
  return out;
}

// Rebase the end spans onto a larger parameter interval in homogeneous space.
// OCCT pcurves may legitimately extend beyond a support's nominal knot domain;
// SolidArc clamps sampling there, so exporting unchanged knots clips the blend.
std::vector<double> Basis(const std::vector<double> &k, int d, int n,
                          double t) {
  int span = d;
  if (t >= k[n])
    span = n - 1;
  else if (t > k[d]) {
    span =
        int(std::upper_bound(k.begin() + d, k.begin() + n + 1, t) - k.begin()) -
        1;
  }
  std::vector<double> b(d + 1), left(d + 1), right(d + 1), out(n);
  b[0] = 1;
  for (int j = 1; j <= d; ++j) {
    left[j] = t - k[span + 1 - j];
    right[j] = k[span + j] - t;
    double saved = 0;
    for (int r = 0; r < j; ++r) {
      double den = right[r + 1] + left[j - r], v = den ? b[r] / den : 0;
      b[r] = saved + right[r + 1] * v;
      saved = left[j - r] * v;
    }
    b[j] = saved;
  }
  for (int j = 0; j <= d; ++j)
    out[span - d + j] = b[j];
  return out;
}
Handle(Geom_BSplineSurface) ExtendDomain(Handle(Geom_BSplineSurface) s,
                                         bool alongU, double lo, double hi) {
  int n = alongU ? s->NbUPoles() : s->NbVPoles(),
      other = alongU ? s->NbVPoles() : s->NbUPoles(),
      d = alongU ? s->UDegree() : s->VDegree();
  std::vector<double> oldk;
  int nk = alongU ? s->NbUKnots() : s->NbVKnots();
  for (int i = 1; i <= nk; ++i)
    for (int j = 0; j < (alongU ? s->UMultiplicity(i) : s->VMultiplicity(i));
         ++j)
      oldk.push_back(alongU ? s->UKnot(i) : s->VKnot(i));
  if (lo >= oldk[d]-1e-12*std::max(1.,std::abs(oldk[n]-oldk[d])) && hi <= oldk[n]+1e-12*std::max(1.,std::abs(oldk[n]-oldk[d])))
    return s;
  if (n > 512)
    throw std::runtime_error("support domain extension exceeds safe extent");
  auto newk = oldk;
  for (int i = 0; i <= d; ++i) {
    newk[i] = std::min(lo, oldk[d]);
    newk[n + i] = std::max(hi, oldk[n]);
  }
  int cols = 4 * other;
  std::vector<std::vector<double>> a(n, std::vector<double>(n + cols));
  for (int i = 0; i < n; ++i) {
    double t = 0;
    for (int j = 1; j <= d; ++j)
      t += newk[i + j] / d;
    auto b = Basis(newk, d, n, t), old = Basis(oldk, d, n, t);
    for (int j = 0; j < n; ++j)
      a[i][j] = b[j];
    for (int q = 0; q < other; ++q)
      for (int j = 0; j < n; ++j) {
        auto p = alongU ? s->Pole(j + 1, q + 1) : s->Pole(q + 1, j + 1);
        double w = alongU ? s->Weight(j + 1, q + 1) : s->Weight(q + 1, j + 1),
               v = old[j] * w;
        a[i][n + q * 4] += v * p.X();
        a[i][n + q * 4 + 1] += v * p.Y();
        a[i][n + q * 4 + 2] += v * p.Z();
        a[i][n + q * 4 + 3] += v;
      }
  }
  for (int k = 0; k < n; ++k) {
    int pivot = k;
    for (int i = k + 1; i < n; ++i)
      if (std::abs(a[i][k]) > std::abs(a[pivot][k]))
        pivot = i;
    if (std::abs(a[pivot][k]) < 1e-13)
      throw std::runtime_error("singular support extension");
    std::swap(a[k], a[pivot]);
    double den = a[k][k];
    for (int j = k; j < n + cols; ++j)
      a[k][j] /= den;
    for (int i = 0; i < n; ++i)
      if (i != k) {
        double f = a[i][k];
        for (int j = k; j < n + cols; ++j)
          a[i][j] -= f * a[k][j];
      }
  }
  TColgp_Array2OfPnt poles(1, s->NbUPoles(), 1, s->NbVPoles());
  TColStd_Array2OfReal weights(1, s->NbUPoles(), 1, s->NbVPoles());
  for (int i = 0; i < n; ++i)
    for (int q = 0; q < other; ++q) {
      double w = a[i][n + q * 4 + 3];
      if (w <= 0 || !std::isfinite(w))
        throw std::runtime_error("invalid extended support weight");
      int u = alongU ? i + 1 : q + 1, v = alongU ? q + 1 : i + 1;
      poles.SetValue(u, v,
                     gp_Pnt(a[i][n + q * 4] / w, a[i][n + q * 4 + 1] / w,
                            a[i][n + q * 4 + 2] / w));
      weights.SetValue(u, v, w);
    }
  TColStd_Array1OfReal ku(1, s->NbUKnots()), kv(1, s->NbVKnots());
  TColStd_Array1OfInteger mu(1, s->NbUKnots()), mv(1, s->NbVKnots());
  for (int i = 1; i <= s->NbUKnots(); ++i) {
    ku.SetValue(i, i == 1 && alongU               ? newk.front()
                   : i == s->NbUKnots() && alongU ? newk.back()
                                                  : s->UKnot(i));
    mu.SetValue(i, s->UMultiplicity(i));
  }
  for (int i = 1; i <= s->NbVKnots(); ++i) {
    kv.SetValue(i, i == 1 && !alongU               ? newk.front()
                   : i == s->NbVKnots() && !alongU ? newk.back()
                                                   : s->VKnot(i));
    mv.SetValue(i, s->VMultiplicity(i));
  }
  return new Geom_BSplineSurface(poles, weights, ku, kv, mu, mv, s->UDegree(),
                                 s->VDegree());
}

void WriteCurve(std::ostream &o, const Handle(Geom_BSplineCurve) & c) {
  o << c->Degree() << ' ' << c->NbPoles() << ' ';
  int n = 0;
  for (int i = 1; i <= c->NbKnots(); ++i)
    n += c->Multiplicity(i);
  o << n << ' ';
  for (int i = 1; i <= c->NbPoles(); ++i) {
    auto p = c->Pole(i);
    double w = c->Weight(i);
    o << p.X() * w << ' ' << p.Y() * w << ' ' << p.Z() * w << ' ' << w << ' ';
  }
  for (int i = 1; i <= c->NbKnots(); ++i)
    for (int k = 0; k < c->Multiplicity(i); ++k)
      o << c->Knot(i) << ' ';
  o << '\n';
}
void Export(std::ostream &o, const TopoDS_Shape &shape) {
  TopTools_IndexedMapOfShape vs, es, fs;
  TopExp::MapShapes(shape, TopAbs_VERTEX, vs);
  TopExp::MapShapes(shape, TopAbs_EDGE, es);
  TopExp::MapShapes(shape, TopAbs_FACE, fs);
  std::vector<int> em(es.Extent() + 1, -1);
  int count = 0;
  for (int i = 1; i <= es.Extent(); ++i)
    if (!BRep_Tool::Degenerated(TopoDS::Edge(es(i))))
      em[i] = count++;
  o << vs.Extent() << '\n';
  for (int i = 1; i <= vs.Extent(); ++i) {
    auto p = BRep_Tool::Pnt(TopoDS::Vertex(vs(i)));
    o << p.X() << ' ' << p.Y() << ' ' << p.Z() << '\n';
  }
  o << count << '\n';
  for (int i = 1; i <= es.Extent(); ++i)
    if (em[i] >= 0) {
      auto e = TopoDS::Edge(es(i).Oriented(TopAbs_FORWARD));
      double a, b;
      auto c = BRep_Tool::Curve(e, a, b);
      if (c.IsNull())
        throw std::runtime_error("finite edge has no 3D curve");
      auto bs =
          GeomConvert::CurveToBSplineCurve(new Geom_TrimmedCurve(c, a, b));
      if (bs->IsPeriodic())
        bs->SetNotPeriodic();
      o << vs.FindIndex(TopExp::FirstVertex(e)) - 1 << ' '
        << vs.FindIndex(TopExp::LastVertex(e)) - 1 << ' ';
      WriteCurve(o, bs);
    }
  o << fs.Extent() << '\n';
  for (int i = 1; i <= fs.Extent(); ++i) {
    auto raw = TopoDS::Face(fs(i)),
         f = TopoDS::Face(raw.Oriented(TopAbs_FORWARD));
    if (std::getenv("SOLIDARC_OCCT_DEBUG")) {
      GProp_GProps props;
      BRepGProp::VolumeProperties(raw, props);
      std::cerr << "OCCT face " << i - 1 << " volume " << props.Mass() << "\n";
    }
    auto s = BRep_Tool::Surface(f);
    Handle(Geom_BSplineSurface) bs = Handle(Geom_BSplineSurface)::DownCast(s);
    if (bs.IsNull()) {
      double a, b, c, d;
      BRepTools::UVBounds(f, a, b, c, d);
      bs = GeomConvert::SurfaceToBSplineSurface(
          new Geom_RectangularTrimmedSurface(s, a, b, c, d));
    }
    if (bs->IsUPeriodic())
      bs->SetUNotPeriodic();
    if (bs->IsVPeriodic())
      bs->SetVNotPeriodic();
    bs = Handle(Geom_BSplineSurface)::DownCast(bs->Copy());
    double u0, u1, v0, v1, tu0, tu1, tv0, tv1;
    bs->Bounds(u0, u1, v0, v1);
    bs->Segment(u0,u1,v0,v1,1e-12,1e-12);
    BRepTools::UVBounds(f, tu0, tu1, tv0, tv1);
    for (TopExp_Explorer walk(f, TopAbs_WIRE); walk.More(); walk.Next())
      for (BRepTools_WireExplorer we(TopoDS::Wire(walk.Current()), f);
           we.More(); we.Next()) {
        double a, b;
        auto pc = BRep_Tool::CurveOnSurface(we.Current(), f, a, b);
        if (pc.IsNull())
          continue;
        for (int sample = 0; sample <= 256; ++sample) {
          auto p = pc->Value(a + (b - a) * sample / 256.);
          tu0 = std::min(tu0, p.X());
          tu1 = std::max(tu1, p.X());
          tv0 = std::min(tv0, p.Y());
          tv1 = std::max(tv1, p.Y());
        }
      }
    bs = ExtendDomain(bs, true, tu0, tu1);
    bs = ExtendDomain(bs, false, tv0, tv1);
    bool rev = raw.Orientation() == TopAbs_REVERSED;
    int cl = Handle(Geom_Plane)::DownCast(s).IsNull() ? 0 : 1;
    o << rev << ' ' << cl << ' ' << bs->UDegree() << ' ' << bs->VDegree() << ' '
      << bs->NbUPoles() << ' ' << bs->NbVPoles() << ' ';
    int ku = 0, kv = 0;
    for (int k = 1; k <= bs->NbUKnots(); ++k)
      ku += bs->UMultiplicity(k);
    for (int k = 1; k <= bs->NbVKnots(); ++k)
      kv += bs->VMultiplicity(k);
    o << ku << ' ' << kv << '\n';
    for (int u = 1; u <= bs->NbUPoles(); ++u)
      for (int v = 1; v <= bs->NbVPoles(); ++v) {
        auto p = bs->Pole(u, v);
        double w = bs->Weight(u, v);
        o << p.X() * w << ' ' << p.Y() * w << ' ' << p.Z() * w << ' ' << w
          << ' ';
      }
    o << '\n';
    for (int k = 1; k <= bs->NbUKnots(); ++k)
      for (int z = 0; z < bs->UMultiplicity(k); ++z)
        o << bs->UKnot(k) << ' ';
    o << '\n';
    for (int k = 1; k <= bs->NbVKnots(); ++k)
      for (int z = 0; z < bs->VMultiplicity(k); ++z)
        o << bs->VKnot(k) << ' ';
    o << '\n';
    std::vector<TopoDS_Wire> wires;
    auto outer = BRepTools::OuterWire(f);
    if (!outer.IsNull())
      wires.push_back(outer);
    for (TopExp_Explorer w(f, TopAbs_WIRE); w.More(); w.Next())
      if (!w.Current().IsSame(outer))
        wires.push_back(TopoDS::Wire(w.Current()));
    o << wires.size() << '\n';
    for (size_t wi = 0; wi < wires.size(); ++wi) {
      struct Ce {
        int edge;
        bool rev;
        std::vector<gp_Pnt2d> uv;
      };
      std::vector<Ce> ces;
      std::vector<gp_Pnt2d> leadingPole;
      for (BRepTools_WireExplorer e(wires[wi], f); e.More(); e.Next()) {
        auto edge = e.Current();
        int id = em.at(es.FindIndex(edge));
        double a, b;
        auto pc = BRep_Tool::CurveOnSurface(edge, f, a, b);
        if (id < 0) {
          if (pc.IsNull())
            throw std::runtime_error("pole edge has no UV bridge");
          bool backward = edge.Orientation() == TopAbs_REVERSED;
          auto first = pc->Value(backward ? b : a),
               last = pc->Value(backward ? a : b);
          auto &bridge = ces.empty() ? leadingPole : ces.back().uv;
          bridge.push_back(first);
          bridge.push_back(last);
          continue;
        }
        if (pc.IsNull())
          throw std::runtime_error("output edge has no trimming curve");
        Ce ce{id, edge.Orientation() == TopAbs_REVERSED, {}};
        int samples = std::max(
            BRep_Tool::IsClosed(edge) ? 128 : 32, 4 * int(GeomConvert::CurveToBSplineCurve(
                            new Geom_TrimmedCurve(
                                BRep_Tool::Curve(
                                    TopoDS::Edge(edge.Oriented(TopAbs_FORWARD)),
                                    a, b),
                                a, b))
                            ->NbPoles()));
        auto pcb = BRep_Tool::CurveOnSurface(edge, f, a, b);
        for (int z = 0; z <= samples; ++z) {
          auto uv = pcb->Value(a + (b - a) * (ce.rev ? 1. - double(z) / samples
                                                     : double(z) / samples));
          double ca, cb;
          auto ec = BRep_Tool::Curve(
              TopoDS::Edge(edge.Oriented(TopAbs_FORWARD)), ca, cb);
          auto point = bs->Value(uv.X(), uv.Y());
          GeomAPI_ProjectPointOnCurve projection(point, ec, ca, cb);
          if (!projection.NbPoints() || projection.LowerDistance() > 2e-5)
            throw std::runtime_error(
                "export UV mismatch on face " + std::to_string(i) + " edge " +
                std::to_string(id) + " distance " +
                std::to_string(
                    projection.NbPoints() ? projection.LowerDistance() : -1));
          ce.uv.push_back(uv);
        }
        ces.push_back(ce);
      }
      if (!leadingPole.empty() && !ces.empty())
        ces.back().uv.insert(ces.back().uv.end(), leadingPole.begin(),
                             leadingPole.end());
      if (rev) {
        std::reverse(ces.begin(), ces.end());
        for (auto &ce : ces) {
          ce.rev = !ce.rev;
          std::reverse(ce.uv.begin(), ce.uv.end());
        }
      }
      o << (wi == 0) << ' ' << ces.size() << '\n';
      for (auto &ce : ces) {
        o << ce.edge << ' ' << ce.rev << ' ' << ce.uv.size() << ' ';
        for (auto &p : ce.uv) {
          auto xyz = bs->Value(p.X(), p.Y());
          o << p.X() << ' ' << p.Y() << ' ' << xyz.X() << ' ' << xyz.Y() << ' '
            << xyz.Z() << ' ';
        }
        o << '\n';
      }
    }
  }
}
// Preserve the kernel's failure category instead of claiming every refusal is
// an excessive radius. OCCT explicitly distinguishes walking, start-solution,
// twisted-surface and corner failures. Never accept its partial BadShape().
std::string FilletFailure(BRepFilletAPI_MakeFillet &operation) {
  std::ostringstream reason;
  reason << "OCCT fillet construction failed";
  const int count = operation.NbFaultyContours();
  for (int i = 1; i <= count; ++i) {
    const int contour = operation.FaultyContour(i);
    reason << "; contour " << contour << ": ";
    switch (operation.StripeStatus(contour)) {
    case ChFiDS_StartsolFailure:
      reason << "no starting blend solution (radius/geometry compatibility)";
      break;
    case ChFiDS_WalkingFailure:
      reason << "blend-spine tracing failed";
      break;
    case ChFiDS_TwistedSurface:
      reason << "twisted blend surface";
      break;
    case ChFiDS_Ok:
      reason << "surface computed, final topology/corner construction failed";
      break;
    default:
      reason << "kernel construction error";
      break;
    }
  }
  const int vertices = operation.NbFaultyVertices();
  if (vertices) reason << "; failed corner vertices: " << vertices;
  if (operation.HasResult())
    reason << "; incomplete result discarded";
  return reason.str();
}

int main(int argc, char **argv) {
  try {
    if (argc != 3)
      return 2;
    std::ifstream input(argv[1]);
    J j;
    input >> j;
    auto imported = Import(j);
    GProp_GProps before;
    BRepGProp::VolumeProperties(imported.shape, before, 1e-9);
    std::vector<TopoDS_Edge> targets;
    TopTools_IndexedMapOfShape edges;
    TopExp::MapShapes(imported.shape, TopAbs_EDGE, edges);
    auto selected = j.at("selected").get<std::vector<int>>();
    std::sort(selected.rbegin(), selected.rend());
    selected.erase(std::unique(selected.begin(), selected.end()),
                   selected.end());
    for (int idx : selected) {
      auto original = imported.curves.at(idx);
      std::vector<TopoDS_Edge> found;
      for (int k = 1; k <= edges.Extent(); ++k) {
        auto edge = TopoDS::Edge(edges(k));
        if (BRep_Tool::Degenerated(edge))
          continue;
        double a, b;
        auto c = BRep_Tool::Curve(edge, a, b);
        if (c.IsNull())
          continue;
        bool match = true;
        for (double t : {0., .5, 1.}) {
          auto p = original->Value(
              original->FirstParameter() +
              (original->LastParameter() - original->FirstParameter()) * t);
          GeomAPI_ProjectPointOnCurve project(p, c, a, b);
          if (!project.NbPoints() || project.LowerDistance() > Tol * 10)
            match = false;
        }
        if (match)
          found.push_back(edge);
      }
      if (found.size() != 1)
        throw std::runtime_error(
            "selected edge does not have a unique imported match");
      targets.push_back(found[0]);
    }
    TopoDS_Shape result;
    if (j.at("chamfer").get<bool>()) {
      BRepFilletAPI_MakeChamfer op(imported.shape);
      for (auto &e : targets)
        op.Add(double(j.at("size")), e);
      op.Build();
      if (!op.IsDone())
        throw std::runtime_error("OCCT chamfer refused this edge set / size");
      result = op.Shape();
    } else {
      BRepFilletAPI_MakeFillet op(imported.shape, ChFi3d_Rational);
      op.SetParams(1e-3, 1e-7, 1e-9, 1e-8, 1e-9, 1e-7);
      for (auto &e : targets)
        op.Add(double(j.at("size")), e);
      op.Build();
      if (!op.IsDone())
        throw std::runtime_error(FilletFailure(op));
      result = op.Shape();
    }
    if (!BRepCheck_Analyzer(result).IsValid()) {
      Handle(ShapeFix_Shape) repair = new ShapeFix_Shape(result);
      repair->SetPrecision(Tol);
      repair->SetMaxTolerance(Tol * 10);
      repair->Perform();
      result = repair->Shape();
      BRepLib::SameParameter(result, Tol, true);
    }
    if (!BRepCheck_Analyzer(result).IsValid())
      throw std::runtime_error("OCCT output failed B-rep validation");
    const auto analyticResult=result;
    BRepBuilderAPI_NurbsConvert converted(result, true);
    result = converted.Shape();
    BRepLib::SameParameter(result, 1e-7, true);
    if (!BRepCheck_Analyzer(result).IsValid()) {
      Handle(ShapeFix_Shape) repair=new ShapeFix_Shape(result);
      repair->SetPrecision(Tol);repair->SetMaxTolerance(Tol*10);repair->Perform();result=repair->Shape();BRepLib::SameParameter(result,Tol,true);
    }
    // A periodic face with a hole can have intersecting UV wires after analytic
    // -> rational conversion. Split closed supports first, preserving geometry,
    // and retry the conversion rather than accepting an invalid trim chart.
    if (!BRepCheck_Analyzer(result).IsValid()) {
      ShapeUpgrade_ShapeDivideClosed split(analyticResult);split.SetNbSplitPoints(1);split.Perform();
      BRepBuilderAPI_NurbsConvert retry(split.Result(),true);result=retry.Shape();
      Handle(ShapeFix_Shape) repair=new ShapeFix_Shape(result);repair->SetPrecision(Tol);repair->SetMaxTolerance(Tol*10);repair->Perform();result=repair->Shape();BRepLib::SameParameter(result,Tol,true);
    }
    if (!BRepCheck_Analyzer(result).IsValid())
    {std::ostringstream details;details<<"converted rational B-rep failed validation";BRepCheck_Analyzer check(result);for(TopAbs_ShapeEnum type:{TopAbs_FACE,TopAbs_EDGE,TopAbs_VERTEX})for(TopExp_Explorer e(result,type);e.More();e.Next()){auto r=check.Result(e.Current());if(r.IsNull())continue;for(auto st:r->Status())if(st!=BRepCheck_NoError)details<<" type="<<int(type)<<" status="<<int(st);}throw std::runtime_error(details.str());}
    // Check actual support normals on every boundary tagged tangent by OCCT,
    // not just the topological "closed" flag. Sharp chamfer ends remain sharp.
    TopTools_IndexedDataMapOfShapeListOfShape adjacent;
    TopExp::MapShapesAndAncestors(result, TopAbs_EDGE, TopAbs_FACE, adjacent);
    for (int i = 1; i <= adjacent.Extent(); ++i) {
      const auto &faces = adjacent.FindFromIndex(i);
      if (faces.Extent() != 2)
        continue;
      auto first = TopoDS::Face(faces.First()),
           second = TopoDS::Face(faces.Last());
      auto edge = TopoDS::Edge(adjacent.FindKey(i));
      if (first.IsSame(second) || BRep_Tool::Degenerated(edge) ||
          BRep_Tool::Continuity(edge, first, second) < GeomAbs_G1)
        continue;
      BRepAdaptor_Surface a(first), b(second);
      for (double fraction : {.2, .5, .8}) {
        double t0, t1, u0, u1;
        auto pa = BRep_Tool::CurveOnSurface(edge, first, t0, t1),
             pb = BRep_Tool::CurveOnSurface(edge, second, u0, u1);
        auto x = pa->Value(t0 + (t1 - t0) * fraction),
             y = pb->Value(u0 + (u1 - u0) * fraction);
        BRepLProp_SLProps na(a, x.X(), x.Y(), 1, 1e-12),
            nb(b, y.X(), y.Y(), 1, 1e-12);
        if (na.IsNormalDefined() && nb.IsNormalDefined() &&
            std::abs(na.Normal().Dot(nb.Normal())) < std::cos(.01))
          throw std::runtime_error("blend tangent support normals disagree");
      }
    }
    std::ofstream out(argv[2]);
    out << std::setprecision(17);
    GProp_GProps after;
    BRepGProp::VolumeProperties(result, after, 1e-9);
    out << "OK " << before.Mass() << ' ' << after.Mass() << '\n';
    Export(out, result);
  } catch (const Standard_Failure &e) {
    std::ofstream(argv[2]) << "ERR "
                           << (e.GetMessageString() ? e.GetMessageString()
                                                    : "OCCT exception");
    return 1;
  } catch (const std::exception &e) {
    std::ofstream(argv[2]) << "ERR " << e.what();
    return 1;
  }
  return 0;
}
