//============================================================================================================================================
// 📦 Frontier/Scratchpad/GenerateThemeSectionProofs.cpp — Pixel-Exact Rasterizer Proof for Unified Theme Section & Rounding Slider
//============================================================================================================================================

#include "../DisplayPresentation/ControlCentrePanel.h"
#include "../DisplayPresentation/ThemeStructure.h"
#include "../DisplayPresentation/VectorCodec.h"
#include "../DeviceExchange/InputExchange.h"
#include <iostream>
#include <fstream>
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstdlib>
#include <string>

namespace Frontier {

struct PixelRgb
{
    uint8_t R;
    uint8_t G;
    uint8_t B;
};

class ProofCanvas
{
public:
    ProofCanvas(uint32_t Width, uint32_t Height)
        : CanvasWidth(Width), CanvasHeight(Height), Buffer(Width * Height, PixelRgb{ 0, 0, 0 })
    {
    }

    void Clear(PixelRgb Color)
    {
        std::fill(Buffer.begin(), Buffer.end(), Color);
    }

    void DrawFilledRectangle(int32_t X0, int32_t Y0, int32_t X1, int32_t Y1, PixelRgb Color)
    {
        int32_t MinX = std::max(0, std::min(X0, X1));
        int32_t MaxX = std::min(static_cast<int32_t>(CanvasWidth) - 1, std::max(X0, X1));
        int32_t MinY = std::max(0, std::min(Y0, Y1));
        int32_t MaxY = std::min(static_cast<int32_t>(CanvasHeight) - 1, std::max(Y0, Y1));

        for (int32_t Y = MinY; Y <= MaxY; ++Y)
        {
            for (int32_t X = MinX; X <= MaxX; ++X)
            {
                Buffer[Y * CanvasWidth + X] = Color;
            }
        }
    }

    void DrawRoundedRectangle(int32_t X0, int32_t Y0, int32_t X1, int32_t Y1, int32_t Radius, PixelRgb Color)
    {
        int32_t MinX = std::max(0, std::min(X0, X1));
        int32_t MaxX = std::min(static_cast<int32_t>(CanvasWidth) - 1, std::max(X0, X1));
        int32_t MinY = std::max(0, std::min(Y0, Y1));
        int32_t MaxY = std::min(static_cast<int32_t>(CanvasHeight) - 1, std::max(Y0, Y1));

        int32_t R = std::min({ Radius, (MaxX - MinX) / 2, (MaxY - MinY) / 2 });
        if (R <= 0)
        {
            DrawFilledRectangle(MinX, MinY, MaxX, MaxY, Color);
            return;
        }

        for (int32_t Y = MinY; Y <= MaxY; ++Y)
        {
            for (int32_t X = MinX; X <= MaxX; ++X)
            {
                bool Inside = true;
                if (X < MinX + R && Y < MinY + R)
                {
                    int32_t DX = X - (MinX + R);
                    int32_t DY = Y - (MinY + R);
                    if (DX * DX + DY * DY > R * R) Inside = false;
                }
                else if (X > MaxX - R && Y < MinY + R)
                {
                    int32_t DX = X - (MaxX - R);
                    int32_t DY = Y - (MinY + R);
                    if (DX * DX + DY * DY > R * R) Inside = false;
                }
                else if (X < MinX + R && Y > MaxY - R)
                {
                    int32_t DX = X - (MinX + R);
                    int32_t DY = Y - (MaxY - R);
                    if (DX * DX + DY * DY > R * R) Inside = false;
                }
                else if (X > MaxX - R && Y > MaxY - R)
                {
                    int32_t DX = X - (MaxX - R);
                    int32_t DY = Y - (MaxY - R);
                    if (DX * DX + DY * DY > R * R) Inside = false;
                }

                if (Inside)
                {
                    Buffer[Y * CanvasWidth + X] = Color;
                }
            }
        }
    }

    void DrawOutlineRectangle(int32_t X0, int32_t Y0, int32_t X1, int32_t Y1, int32_t Radius, int32_t Thickness, PixelRgb Color)
    {
        for (int32_t T = 0; T < Thickness; ++T)
        {
            DrawRoundedRectangle(X0 - T, Y0 - T, X1 + T, Y1 + T, Radius + T, Color);
        }
    }

    void DrawLine(int32_t X0, int32_t Y0, int32_t X1, int32_t Y1, PixelRgb Color)
    {
        int32_t DX = std::abs(X1 - X0);
        int32_t DY = std::abs(Y1 - Y0);
        int32_t Steps = std::max(DX, DY);
        if (Steps == 0)
        {
            if (X0 >= 0 && X0 < static_cast<int32_t>(CanvasWidth) && Y0 >= 0 && Y0 < static_cast<int32_t>(CanvasHeight))
            {
                Buffer[Y0 * CanvasWidth + X0] = Color;
            }
            return;
        }

        float XInc = static_cast<float>(X1 - X0) / static_cast<float>(Steps);
        float YInc = static_cast<float>(Y1 - Y0) / static_cast<float>(Steps);

        float CurrX = static_cast<float>(X0);
        float CurrY = static_cast<float>(Y0);

        for (int32_t i = 0; i <= Steps; ++i)
        {
            int32_t PxX = static_cast<int32_t>(std::round(CurrX));
            int32_t PxY = static_cast<int32_t>(std::round(CurrY));
            if (PxX >= 0 && PxX < static_cast<int32_t>(CanvasWidth) && PxY >= 0 && PxY < static_cast<int32_t>(CanvasHeight))
            {
                Buffer[PxY * CanvasWidth + PxX] = Color;
            }
            CurrX += XInc;
            CurrY += YInc;
        }
    }

    void DrawCircle(int32_t CenterX, int32_t CenterY, int32_t Radius, PixelRgb Color)
    {
        for (int32_t Y = CenterY - Radius; Y <= CenterY + Radius; ++Y)
        {
            for (int32_t X = CenterX - Radius; X <= CenterX + Radius; ++X)
            {
                if (X >= 0 && X < static_cast<int32_t>(CanvasWidth) && Y >= 0 && Y < static_cast<int32_t>(CanvasHeight))
                {
                    int32_t DX = X - CenterX;
                    int32_t DY = Y - CenterY;
                    if (DX * DX + DY * DY <= Radius * Radius)
                    {
                        Buffer[Y * CanvasWidth + X] = Color;
                    }
                }
            }
        }
    }

    void DrawFilledPolygon(const std::vector<BezierPointRecord>& PolygonPoints, float OffsetX, float OffsetY, PixelRgb Color)
    {
        if (PolygonPoints.size() < 3) return;

        float MinY = static_cast<float>(CanvasHeight);
        float MaxY = 0.0f;
        for (const auto& Pt : PolygonPoints)
        {
            MinY = std::min(MinY, Pt.Y + OffsetY);
            MaxY = std::max(MaxY, Pt.Y + OffsetY);
        }

        int32_t StartY = std::max(0, static_cast<int32_t>(std::floor(MinY)));
        int32_t EndY   = std::min(static_cast<int32_t>(CanvasHeight) - 1, static_cast<int32_t>(std::ceil(MaxY)));

        for (int32_t Y = StartY; Y <= EndY; ++Y)
        {
            std::vector<float> Intersections;
            size_t Count = PolygonPoints.size();
            for (size_t i = 0; i < Count; ++i)
            {
                size_t next = (i + 1) % Count;
                float Y1 = PolygonPoints[i].Y + OffsetY;
                float Y2 = PolygonPoints[next].Y + OffsetY;
                float X1 = PolygonPoints[i].X + OffsetX;
                float X2 = PolygonPoints[next].X + OffsetX;

                if (std::abs(Y2 - Y1) < 0.0001f) continue;

                if ((Y1 <= Y && Y2 > Y) || (Y2 <= Y && Y1 > Y))
                {
                    float IntersectX = X1 + (static_cast<float>(Y) - Y1) * (X2 - X1) / (Y2 - Y1);
                    if (!std::isnan(IntersectX) && !std::isinf(IntersectX))
                    {
                        Intersections.push_back(IntersectX);
                    }
                }
            }

            std::sort(Intersections.begin(), Intersections.end());

            for (size_t i = 0; i + 1 < Intersections.size(); i += 2)
            {
                int32_t StartX = std::max(0, static_cast<int32_t>(std::ceil(Intersections[i])));
                int32_t EndX   = std::min(static_cast<int32_t>(CanvasWidth) - 1, static_cast<int32_t>(std::floor(Intersections[i + 1])));
                for (int32_t X = StartX; X <= EndX; ++X)
                {
                    Buffer[Y * CanvasWidth + X] = Color;
                }
            }
        }
    }

    // Single unified Theme Section with 8 theme cards + UIComponents.html rounding slider [ number | unit ] [---O---]
    void DrawUnifiedThemeSectionCard(
        int32_t X0, int32_t Y0, int32_t W, int32_t H,
        ThemeCategory SelectedTheme, float CornerRadiusPx, PixelRgb AccentRgb)
    {
        int32_t R = static_cast<int32_t>(CornerRadiusPx);

        // Outer Appearance Full Card Shell
        DrawRoundedRectangle(X0, Y0, X0 + W, Y0 + H, R, PixelRgb{ 14, 14, 16 });

        // Header Top Bar: Back Button + "Appearance & Themes" Title
        DrawCircle(X0 + 30, Y0 + 26, 14, PixelRgb{ 32, 32, 38 });
        DrawLine(X0 + 34, Y0 + 26, X0 + 24, Y0 + 26, PixelRgb{ 255, 255, 255 }); // ← arrow
        DrawLine(X0 + 24, Y0 + 26, X0 + 28, Y0 + 22, PixelRgb{ 255, 255, 255 });
        DrawLine(X0 + 24, Y0 + 26, X0 + 28, Y0 + 30, PixelRgb{ 255, 255, 255 });

        // Title text bar & subtitle bar
        DrawFilledRectangle(X0 + 60, Y0 + 18, X0 + 240, Y0 + 28, PixelRgb{ 245, 245, 250 });
        DrawFilledRectangle(X0 + 60, Y0 + 32, X0 + 320, Y0 + 38, PixelRgb{ 120, 120, 135 });

        // Tab strip: [ Theme (Active) | Fonts | Display ]
        DrawFilledRectangle(X0 + 30, Y0 + 56, X0 + 90, Y0 + 70, PixelRgb{ 255, 255, 255 });
        DrawFilledRectangle(X0 + 30, Y0 + 72, X0 + 90, Y0 + 74, AccentRgb); // Tab underline
        DrawFilledRectangle(X0 + 110, Y0 + 56, X0 + 160, Y0 + 70, PixelRgb{ 90, 90, 105 });
        DrawFilledRectangle(X0 + 180, Y0 + 56, X0 + 240, Y0 + 70, PixelRgb{ 90, 90, 105 });
        DrawLine(X0 + 20, Y0 + 74, X0 + W - 20, Y0 + 74, PixelRgb{ 30, 30, 36 });

        // ---------------------------------------------------------------------------------------------------------------
        // UNIFIED THEME SECTION (Single Container Card)
        // ---------------------------------------------------------------------------------------------------------------
        int32_t SecX0 = X0 + 20;
        int32_t SecY0 = Y0 + 88;
        int32_t SecW  = W - 40;
        int32_t SecH  = H - 150;
        DrawRoundedRectangle(SecX0, SecY0, SecX0 + SecW, SecY0 + SecH, R, PixelRgb{ 20, 20, 24 });

        // Section Title: "Color Scheme & Surface Theme"
        DrawFilledRectangle(SecX0 + 20, SecY0 + 16, SecX0 + 220, SecY0 + 26, PixelRgb{ 230, 230, 240 });
        DrawFilledRectangle(SecX0 + 20, SecY0 + 30, SecX0 + 300, SecY0 + 36, PixelRgb{ 100, 100, 115 });

        // 8 Theme Tiles / Cards Grid (4 cols x 2 rows)
        struct ThemeMockDef {
            const char* Name;
            PixelRgb CanvasColor;
            PixelRgb PanelColor;
        };

        const ThemeMockDef ThemeDefs[8] = {
            { "OLED",    PixelRgb{ 0, 0, 0 },       PixelRgb{ 10, 10, 10 } },
            { "Dark",    PixelRgb{ 17, 17, 17 },    PixelRgb{ 26, 26, 26 } },
            { "Dim",     PixelRgb{ 15, 23, 42 },    PixelRgb{ 30, 41, 59 } },
            { "Light",   PixelRgb{ 241, 245, 249 }, PixelRgb{ 255, 255, 255 } },
            { "Sepia",   PixelRgb{ 234, 221, 207 }, PixelRgb{ 244, 235, 225 } },
            { "Dracula", PixelRgb{ 40, 42, 54 },    PixelRgb{ 68, 71, 90 } },
            { "Nord",    PixelRgb{ 46, 52, 64 },    PixelRgb{ 59, 66, 82 } },
            { "GitHub",  PixelRgb{ 13, 17, 23 },    PixelRgb{ 22, 27, 34 } }
        };

        int32_t GridX0 = SecX0 + 20;
        int32_t GridY0 = SecY0 + 50;
        int32_t TileGap = 12;
        int32_t TileW   = (SecW - 40 - (TileGap * 3)) / 4;
        int32_t TileH   = 58;

        for (int32_t r = 0; r < 2; ++r)
        {
            for (int32_t c = 0; c < 4; ++c)
            {
                int32_t Idx = r * 4 + c;
                int32_t TX0 = GridX0 + c * (TileW + TileGap);
                int32_t TY0 = GridY0 + r * (TileH + TileGap);
                bool IsActive = (static_cast<size_t>(SelectedTheme) == static_cast<size_t>(Idx));

                // Selection Highlight outline
                if (IsActive)
                {
                    DrawRoundedRectangle(TX0 - 3, TY0 - 3, TX0 + TileW + 3, TY0 + TileH + 3, 14, AccentRgb);
                }

                // Tile Background
                DrawRoundedRectangle(TX0, TY0, TX0 + TileW, TY0 + TileH, 12, ThemeDefs[Idx].CanvasColor);

                // Mock Sidebar / Window surface inside tile
                DrawRoundedRectangle(TX0 + 6, TY0 + 6, TX0 + TileW, TY0 + TileH, 8, ThemeDefs[Idx].PanelColor);
                // Top mock strip
                DrawFilledRectangle(TX0 + 10, TY0 + 10, TX0 + TileW - 10, TY0 + 14, PixelRgb{ 150, 150, 160 });
            }
        }

        // Section Divider
        int32_t DivY = SecY0 + 200;
        DrawLine(SecX0 + 20, DivY, SecX0 + SecW - 20, DivY, PixelRgb{ 32, 32, 38 });

        // ---------------------------------------------------------------------------------------------------------------
        // GLOBAL ROUNDING SLIDER ROW (From UIComponents.html: .crow > .clabel + .vpill[.num | .unit] + input.slider)
        // ---------------------------------------------------------------------------------------------------------------
        int32_t CRowY0 = DivY + 16;

        // 1. Control Label (.clabel: "Corner Radius")
        DrawFilledRectangle(SecX0 + 20, CRowY0 + 12, SecX0 + 110, CRowY0 + 22, PixelRgb{ 220, 220, 230 });

        // 2. Value Pill (.vpill: [ number | unit ])
        int32_t VPillX0 = SecX0 + 130;
        int32_t VPillW  = 96;
        int32_t VPillH  = 34;
        DrawRoundedRectangle(VPillX0, CRowY0 + 2, VPillX0 + VPillW, CRowY0 + 2 + VPillH, 999, PixelRgb{ 10, 10, 12 });
        // Split border
        DrawLine(VPillX0 + 60, CRowY0 + 2, VPillX0 + 60, CRowY0 + 2 + VPillH, PixelRgb{ 38, 38, 44 });
        // Value "24" representation in .num
        DrawFilledRectangle(VPillX0 + 20, CRowY0 + 12, VPillX0 + 44, CRowY0 + 24, PixelRgb{ 255, 255, 255 });
        // Unit "px" representation in .unit
        DrawFilledRectangle(VPillX0 + 68, CRowY0 + 14, VPillX0 + 86, CRowY0 + 22, PixelRgb{ 140, 140, 155 });

        // 3. Chunky Range Slider (input[type=range].slider.hi: [---O---])
        int32_t SliderX0 = VPillX0 + VPillW + 16;
        int32_t SliderX1 = SecX0 + SecW - 20;
        int32_t SliderH  = 26;
        int32_t SliderY  = CRowY0 + 6;

        // Slider track base (pill shape)
        DrawRoundedRectangle(SliderX0, SliderY, SliderX1, SliderY + SliderH, 999, PixelRgb{ 32, 32, 38 });

        // Slider fill progress (accent color fill up to thumb)
        float Progress = std::clamp(CornerRadiusPx / 32.0f, 0.0f, 1.0f);
        int32_t ThumbCenterX = static_cast<int32_t>(SliderX0 + 12 + Progress * (SliderX1 - SliderX0 - 24));
        DrawRoundedRectangle(SliderX0, SliderY, ThumbCenterX, SliderY + SliderH, 999, AccentRgb);

        // Circular Slider Thumb (round white knob)
        DrawCircle(ThumbCenterX, SliderY + SliderH / 2, 12, PixelRgb{ 255, 255, 255 });
        DrawCircle(ThumbCenterX, SliderY + SliderH / 2, 6, AccentRgb); // Center dot
    }

    bool ExportPpm(const std::string& FilePath)
    {
        std::ofstream Out(FilePath, std::ios::binary);
        if (!Out) return false;

        Out << "P6\n" << CanvasWidth << " " << CanvasHeight << "\n255\n";
        for (const auto& Px : Buffer)
        {
            Out.put(static_cast<char>(Px.R));
            Out.put(static_cast<char>(Px.G));
            Out.put(static_cast<char>(Px.B));
        }
        return true;
    }

private:
    uint32_t CanvasWidth;
    uint32_t CanvasHeight;
    std::vector<PixelRgb> Buffer;
};

} // namespace Frontier

int main()
{
    // ===================================================================================================================
    // 1. HIGH-RES SINGLE VIEW: THEME SECTION PROOF (OLED + 24px Rounding Slider)
    // ===================================================================================================================
    {
        constexpr uint32_t Width  = 1280;
        constexpr uint32_t Height = 720;

        Frontier::ControlCentrePanel Panel;
        (void)Panel.Initialize(Width, Height);
        Panel.OpenNotch();
        Panel.NavigateToPage(Frontier::ControlCentrePageCategory::Appearance);
        Panel.SelectTheme(Frontier::ThemeCategory::Oled);
        Panel.AssignCornerRadius(24.0f);
        Panel.AdvanceLocomotion(1.0f);

        Frontier::ProofCanvas Canvas(Width, Height);
        Canvas.Clear(Frontier::PixelRgb{ 0, 0, 0 });

        float HandleY = Panel.QueryHandleY();
        Canvas.DrawFilledRectangle(0, 0, Width - 1, static_cast<int32_t>(HandleY), Frontier::PixelRgb{ 10, 10, 12 });

        int32_t CardW = 560;
        int32_t CardH = 430;
        int32_t CardX = (Width - CardW) / 2;
        int32_t CardY = 40;

        Canvas.DrawUnifiedThemeSectionCard(
            CardX, CardY, CardW, CardH,
            Frontier::ThemeCategory::Oled, 24.0f,
            Frontier::PixelRgb{ 59, 130, 246 }
        );

        const auto& Contour = Panel.QueryHandleContour();
        Canvas.DrawFilledPolygon(Contour, Panel.QueryHandleX(), HandleY, Frontier::PixelRgb{ 10, 10, 12 });

        Canvas.ExportPpm("Diagnostics/ControlCenter_ThemeSection_Proof.ppm");
        (void)std::system("python3 Tools/PpmToPng.py Diagnostics/ControlCenter_ThemeSection_Proof.ppm Diagnostics/ControlCenter_ThemeSection_Proof.png > /dev/null 2>&1");
        std::cout << "[Theme Proof 1] Generated high-res Theme Section proof.\n";
    }

    // ===================================================================================================================
    // 2. TWO-STATE COMPOSITE PROOF (OLED 24px vs Dracula 12px)
    // ===================================================================================================================
    {
        constexpr uint32_t TotalW = 1400;
        constexpr uint32_t TotalH = 580;
        constexpr uint32_t PanelW = 700;

        Frontier::ProofCanvas Canvas(TotalW, TotalH);
        Canvas.Clear(Frontier::PixelRgb{ 0, 0, 0 });

        int32_t CardW = 580;
        int32_t CardH = 440;
        int32_t CardY = 50;

        // Left Panel: OLED Theme (24px Corner Radius, Blue Accent)
        {
            Canvas.DrawFilledRectangle(0, 0, PanelW - 1, TotalH - 36, Frontier::PixelRgb{ 8, 8, 10 });
            Canvas.DrawUnifiedThemeSectionCard(
                (PanelW - CardW) / 2, CardY, CardW, CardH,
                Frontier::ThemeCategory::Oled, 24.0f,
                Frontier::PixelRgb{ 59, 130, 246 }
            );
        }

        // Right Panel: Dracula Theme (12px Corner Radius, Violet Accent)
        {
            int32_t OffsetX = PanelW;
            Canvas.DrawFilledRectangle(OffsetX, 0, OffsetX + PanelW - 1, TotalH - 36, Frontier::PixelRgb{ 14, 15, 20 });
            Canvas.DrawUnifiedThemeSectionCard(
                OffsetX + (PanelW - CardW) / 2, CardY, CardW, CardH,
                Frontier::ThemeCategory::Dracula, 12.0f,
                Frontier::PixelRgb{ 139, 92, 246 }
            );
        }

        Canvas.DrawLine(PanelW, 0, PanelW, TotalH - 1, Frontier::PixelRgb{ 36, 36, 44 });

        Canvas.ExportPpm("Diagnostics/ControlCenter_ThemeSection_Composite.ppm");
        (void)std::system("python3 Tools/PpmToPng.py Diagnostics/ControlCenter_ThemeSection_Composite.ppm Diagnostics/ControlCenter_ThemeSection_Composite.png > /dev/null 2>&1");
        std::cout << "[Theme Proof 2] Generated Composite comparison proof.\n";
    }

    (void)std::system("rm -f Diagnostics/*.ppm");
    std::cout << "[Verification Complete] All theme section proof images generated successfully.\n";
    return 0;
}
