//============================================================================================================================================
//                                                           COMMANDEXCHANGE.H
//============================================================================================================================================
// 📦 Serializes the existing scene and gizmo vertex streams for a browser graphics device without rasterizing pixels.

#pragma once

#include "RasterExchange.h"
#include <span>
#include <sstream>
#include <iomanip>
#include <vector>
#include <algorithm>

namespace Frontier
{
class CommandExchange final : public RasterExchange
{
public:
    uint32_t ExtentX = 800u;
    uint32_t ExtentY = 600u;
    uint32_t Intersection = 0u;
    uint32_t IntersectionX = 0u;
    uint32_t IntersectionY = 0u;
    uint32_t IntersectionWidth = 0u;
    struct IntersectionRun
    {
        uint32_t Start, Length, Identity;
    };
    std::vector<IntersectionRun> Intersections;
    std::string Packet;

    void Resize(uint32_t Width, uint32_t Height) noexcept override
    {
        ExtentX = Width;
        ExtentY = Height;
    }

    uint32_t Width() const noexcept override { return ExtentX; }
    uint32_t Height() const noexcept override { return ExtentY; }

    template<class Values>
    static void EncodeValues(std::ostream& Stream, const Values& Items)
    {
        Stream << '[';
        bool Separator = false;
        for (auto Value : Items)
        {
            if (Separator) Stream << ',';
            Separator = true;
            Stream << Value;
        }
        Stream << ']';
    }

    void BeginTarget(const float Clear[4]) noexcept override
    {
        Stream.str("");
        Stream.clear();
        Stream << std::setprecision(9) << "{\"width\":" << ExtentX << ",\"height\":" << ExtentY << ",\"clear\":";
        EncodeValues(Stream, std::span(Clear, 4));
        Overlay = false;
        Separator = false;
        Count = {};
    }

    void BindView(const ViewRecord& View) noexcept override
    {
        Stream << ",\"view\":{";
        bool Comma = false;
        auto Field = [&](const char* Name, const auto& Values)
        {
            if (Comma) Stream << ',';
            Comma = true;
            Stream << '"' << Name << "\":";
            EncodeValues(Stream, Values);
        };
        Field("ViewClip", View.ViewClip);
        Field("ClipView", View.ClipView);
        Field("ViewWorld", View.ViewWorld);
        Field("EyePosition", View.EyePosition);
        Field("Viewport", View.Viewport);
        Field("LatticeStyle", View.LatticeStyle);
        Field("LatticeOrigin", View.LatticeOrigin);
        Field("LatticeAxisU", View.LatticeAxisU);
        Field("LatticeAxisV", View.LatticeAxisV);
        Field("Illumination", View.Illumination);
        Field("DepthPolicy", View.DepthPolicy);
        Stream << ",\"PixelAngle\":" << View.PixelAngle << ",\"PixelWorld\":" << View.PixelWorld << "},\"draws\":[";
    }

    void DrawLattice() noexcept override
    {
        Prefix("lattice");
        Stream << '}';
    }

    void DrawSurface(const SurfaceStream& Vertices, const DrawRecord& Style) noexcept override
    {
        Prefix("surface");
        EncodeStyle(Style);
        Stream << ",\"positions\":";
        EncodeValues(Stream, Vertices.Positions);
        Stream << ",\"normals\":";
        EncodeValues(Stream, Vertices.Normals);
        Stream << ",\"parameters\":";
        EncodeValues(Stream, Vertices.Parameters);
        Stream << ",\"indices\":";
        EncodeValues(Stream, Vertices.Triangles);
        Stream << '}';
        Count.Triangles += uint32_t(Vertices.Triangles.size() / 3u);
    }

    void DrawSegments(const SegmentStream& Vertices, const DrawRecord& Style) noexcept override
    {
        Prefix("line");
        EncodeStyle(Style);
        Stream << ",\"positions\":";
        EncodeValues(Stream, Vertices.Endpoints);
        Stream << '}';
        Count.Segments += Vertices.SegmentCount();
    }

    void DrawPoints(const PointStream& Vertices, const DrawRecord& Style) noexcept override
    {
        Prefix("point");
        EncodeStyle(Style);
        Stream << ",\"positions\":";
        EncodeValues(Stream, Vertices.Points);
        Stream << '}';
        Count.Points += Vertices.PointCount();
    }

    void BeginOverlay() noexcept override { Overlay = true; }

    void EndTarget() noexcept override
    {
        Stream << "],\"cpuFragments\":0,\"rgbaUploads\":0}";
        Packet = Stream.str();
    }

    RasterImage Readback() const noexcept override { return {}; }
    uint32_t Pick(uint32_t X, uint32_t Y) const noexcept override
    {
        if (IntersectionWidth)
        {
            const uint32_t Offset = Y * IntersectionWidth + X;
            auto Item = std::upper_bound(Intersections.begin(), Intersections.end(), Offset,
                [](uint32_t Position, const IntersectionRun& Run) { return Position < Run.Start; });
            if (Item == Intersections.begin()) return 0u;
            --Item;
            return Offset - Item->Start < Item->Length ? Item->Identity : 0u;
        }
        return X == IntersectionX && Y == IntersectionY ? Intersection : 0u;
    }
    float Depth(uint32_t, uint32_t) const noexcept override { return 1.0f; }
    Tally QueryTally() const noexcept override { return Count; }

private:
    std::ostringstream Stream;
    bool Overlay = false;
    bool Separator = false;
    Tally Count = {};

    void Prefix(const char* Kind)
    {
        if (Separator) Stream << ',';
        Separator = true;
        Stream << "{\"kind\":\"" << Kind << "\",\"overlay\":" << (Overlay ? "true" : "false");
    }

    void EncodeStyle(const DrawRecord& Style)
    {
        Stream << ",\"local\":";
        EncodeValues(Stream, Style.LocalWorld);
        Stream << ",\"tint\":";
        EncodeValues(Stream, Style.Tint);
        Stream << ",\"selection\":[" << Style.Highlight << ",0," << Style.LineWidth << ',' << Style.PointSize << ']';
        Stream << ",\"surface\":[" << unsigned(Style.Matcap) << ',' << unsigned(Style.Shading) << ',' << Style.Emissive << ",0]";
        Stream << ",\"dashed\":" << (Style.Dashed ? "true" : "false") << ",\"pick\":" << Style.PickIdentity;
    }
};
}
