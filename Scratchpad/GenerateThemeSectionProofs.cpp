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
<<<<<<< HEAD
=======
#include <cstring>
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)

namespace Frontier {

struct PixelRgb
{
    uint8_t R;
    uint8_t G;
    uint8_t B;
};

<<<<<<< HEAD
=======
//------------------------------------------------------------------------------------------------------------------------
//                                           5x7 / 8x12 PROPORTIONAL BITMAP FONT
//------------------------------------------------------------------------------------------------------------------------

static const uint8_t Font5x7[96][5] = {
    {0x00,0x00,0x00,0x00,0x00}, //   32 ' '
    {0x00,0x00,0x5f,0x00,0x00}, //   33 '!'
    {0x00,0x07,0x00,0x07,0x00}, //   34 '"'
    {0x14,0x7f,0x14,0x7f,0x14}, //   35 '#'
    {0x24,0x2a,0x7f,0x2a,0x12}, //   36 '$'
    {0x23,0x13,0x08,0x64,0x62}, //   37 '%'
    {0x36,0x49,0x55,0x22,0x50}, //   38 '&'
    {0x00,0x05,0x03,0x00,0x00}, //   39 '''
    {0x00,0x1c,0x22,0x41,0x00}, //   40 '('
    {0x00,0x41,0x22,0x1c,0x00}, //   41 ')'
    {0x14,0x08,0x3e,0x08,0x14}, //   42 '*'
    {0x08,0x08,0x3e,0x08,0x08}, //   43 '+'
    {0x00,0x50,0x30,0x00,0x00}, //   44 ','
    {0x08,0x08,0x08,0x08,0x08}, //   45 '-'
    {0x00,0x60,0x60,0x00,0x00}, //   46 '.'
    {0x20,0x10,0x08,0x04,0x02}, //   47 '/'
    {0x3e,0x51,0x49,0x45,0x3e}, //   48 '0'
    {0x00,0x42,0x7f,0x40,0x00}, //   49 '1'
    {0x42,0x61,0x51,0x49,0x46}, //   50 '2'
    {0x21,0x41,0x45,0x4b,0x31}, //   51 '3'
    {0x18,0x14,0x12,0x7f,0x10}, //   52 '4'
    {0x27,0x45,0x45,0x45,0x39}, //   53 '5'
    {0x3c,0x4a,0x49,0x49,0x30}, //   54 '6'
    {0x01,0x71,0x09,0x05,0x03}, //   55 '7'
    {0x36,0x49,0x49,0x49,0x36}, //   56 '8'
    {0x06,0x49,0x49,0x29,0x1e}, //   57 '9'
    {0x00,0x36,0x36,0x00,0x00}, //   58 ':'
    {0x00,0x56,0x36,0x00,0x00}, //   59 ';'
    {0x08,0x14,0x22,0x41,0x00}, //   60 '<'
    {0x14,0x14,0x14,0x14,0x14}, //   61 '='
    {0x00,0x41,0x22,0x14,0x08}, //   62 '>'
    {0x02,0x01,0x51,0x09,0x06}, //   63 '?'
    {0x32,0x49,0x79,0x41,0x3e}, //   64 '@'
    {0x7e,0x11,0x11,0x11,0x7e}, //   65 'A'
    {0x7f,0x49,0x49,0x49,0x36}, //   66 'B'
    {0x3e,0x41,0x41,0x41,0x22}, //   67 'C'
    {0x7f,0x41,0x41,0x22,0x1c}, //   68 'D'
    {0x7f,0x49,0x49,0x49,0x41}, //   69 'E'
    {0x7f,0x09,0x09,0x09,0x01}, //   70 'F'
    {0x3e,0x41,0x49,0x49,0x7a}, //   71 'G'
    {0x7f,0x08,0x08,0x08,0x7f}, //   72 'H'
    {0x00,0x41,0x7f,0x41,0x00}, //   73 'I'
    {0x20,0x40,0x41,0x3f,0x01}, //   74 'J'
    {0x7f,0x08,0x14,0x22,0x41}, //   75 'K'
    {0x7f,0x40,0x40,0x40,0x40}, //   76 'L'
    {0x7f,0x02,0x0c,0x02,0x7f}, //   77 'M'
    {0x7f,0x04,0x08,0x10,0x7f}, //   78 'N'
    {0x3e,0x41,0x41,0x41,0x3e}, //   79 'O'
    {0x7f,0x09,0x09,0x09,0x06}, //   80 'P'
    {0x3e,0x41,0x51,0x21,0x5e}, //   81 'Q'
    {0x7f,0x09,0x19,0x29,0x46}, //   82 'R'
    {0x46,0x49,0x49,0x49,0x31}, //   83 'S'
    {0x01,0x01,0x7f,0x01,0x01}, //   84 'T'
    {0x3f,0x40,0x40,0x40,0x3f}, //   85 'U'
    {0x1f,0x20,0x40,0x20,0x1f}, //   86 'V'
    {0x3f,0x40,0x38,0x40,0x3f}, //   87 'W'
    {0x63,0x14,0x08,0x14,0x63}, //   88 'X'
    {0x07,0x08,0x70,0x08,0x07}, //   89 'Y'
    {0x61,0x51,0x49,0x45,0x43}, //   90 'Z'
    {0x00,0x7f,0x41,0x41,0x00}, //   91 '['
    {0x02,0x04,0x08,0x10,0x20}, //   92 '\'
    {0x00,0x41,0x41,0x7f,0x00}, //   93 ']'
    {0x04,0x02,0x01,0x02,0x04}, //   94 '^'
    {0x40,0x40,0x40,0x40,0x40}, //   95 '_'
    {0x00,0x01,0x02,0x04,0x00}, //   96 '`'
    {0x20,0x54,0x54,0x54,0x78}, //   97 'a'
    {0x7f,0x48,0x44,0x44,0x38}, //   98 'b'
    {0x38,0x44,0x44,0x44,0x20}, //   99 'c'
    {0x38,0x44,0x44,0x48,0x7f}, //  100 'd'
    {0x38,0x54,0x54,0x54,0x18}, //  101 'e'
    {0x08,0x7e,0x09,0x01,0x02}, //  102 'f'
    {0x0c,0x52,0x52,0x52,0x3e}, //  103 'g'
    {0x7f,0x08,0x04,0x04,0x78}, //  104 'h'
    {0x00,0x44,0x7d,0x40,0x00}, //  105 'i'
    {0x20,0x40,0x44,0x3d,0x00}, //  106 'j'
    {0x7f,0x10,0x28,0x44,0x00}, //  107 'k'
    {0x00,0x41,0x7f,0x40,0x00}, //  108 'l'
    {0x7c,0x04,0x18,0x04,0x78}, //  109 'm'
    {0x7c,0x08,0x04,0x04,0x78}, //  110 'n'
    {0x38,0x44,0x44,0x44,0x38}, //  111 'o'
    {0x7c,0x14,0x14,0x14,0x08}, //  112 'p'
    {0x08,0x14,0x14,0x18,0x7c}, //  113 'q'
    {0x7c,0x08,0x04,0x04,0x08}, //  114 'r'
    {0x48,0x54,0x54,0x54,0x20}, //  115 's'
    {0x04,0x3f,0x44,0x40,0x20}, //  116 't'
    {0x3c,0x40,0x40,0x20,0x7c}, //  117 'u'
    {0x1c,0x20,0x40,0x20,0x1c}, //  118 'v'
    {0x3c,0x40,0x30,0x40,0x3c}, //  119 'w'
    {0x44,0x28,0x10,0x28,0x44}, //  120 'x'
    {0x0c,0x50,0x50,0x50,0x3c}, //  121 'y'
    {0x44,0x64,0x54,0x4c,0x44}, //  122 'z'
    {0x00,0x08,0x36,0x41,0x00}, //  123 '{'
    {0x00,0x00,0x7f,0x00,0x00}, //  124 '|'
    {0x00,0x41,0x36,0x08,0x00}, //  125 '}'
    {0x08,0x08,0x2a,0x1c,0x08}, //  126 '~'
    {0x00,0x00,0x00,0x00,0x00}  //  127 ' '
};

>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
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

<<<<<<< HEAD
=======
    void PutPixel(int32_t X, int32_t Y, PixelRgb Color)
    {
        if (X >= 0 && X < static_cast<int32_t>(CanvasWidth) && Y >= 0 && Y < static_cast<int32_t>(CanvasHeight))
        {
            Buffer[Y * CanvasWidth + X] = Color;
        }
    }

    void BlendPixel(int32_t X, int32_t Y, PixelRgb Color, float Alpha)
    {
        if (X >= 0 && X < static_cast<int32_t>(CanvasWidth) && Y >= 0 && Y < static_cast<int32_t>(CanvasHeight))
        {
            PixelRgb& Dst = Buffer[Y * CanvasWidth + X];
            Dst.R = static_cast<uint8_t>(Dst.R * (1.0f - Alpha) + Color.R * Alpha);
            Dst.G = static_cast<uint8_t>(Dst.G * (1.0f - Alpha) + Color.G * Alpha);
            Dst.B = static_cast<uint8_t>(Dst.B * (1.0f - Alpha) + Color.B * Alpha);
        }
    }

>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
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

<<<<<<< HEAD
    void DrawOutlineRectangle(int32_t X0, int32_t Y0, int32_t X1, int32_t Y1, int32_t Radius, int32_t Thickness, PixelRgb Color)
    {
        for (int32_t T = 0; T < Thickness; ++T)
        {
            DrawRoundedRectangle(X0 - T, Y0 - T, X1 + T, Y1 + T, Radius + T, Color);
=======
    void DrawRoundedOutline(int32_t X0, int32_t Y0, int32_t X1, int32_t Y1, int32_t Radius, int32_t Thickness, PixelRgb Color)
    {
        for (int32_t T = 0; T < Thickness; ++T)
        {
            int32_t CurX0 = X0 - T;
            int32_t CurY0 = Y0 - T;
            int32_t CurX1 = X1 + T;
            int32_t CurY1 = Y1 + T;
            int32_t CurR  = Radius + T;

            for (int32_t X = CurX0; X <= CurX1; ++X)
            {
                // Top and bottom borders
                int32_t DX0 = X - (CurX0 + CurR);
                int32_t DX1 = X - (CurX1 - CurR);
                bool CornerT = (X < CurX0 + CurR && DX0 * DX0 > CurR * CurR);
                bool CornerB = (X > CurX1 - CurR && DX1 * DX1 > CurR * CurR);
                if (!CornerT && !CornerB)
                {
                    PutPixel(X, CurY0, Color);
                    PutPixel(X, CurY1, Color);
                }
            }
            for (int32_t Y = CurY0; Y <= CurY1; ++Y)
            {
                PutPixel(CurX0, Y, Color);
                PutPixel(CurX1, Y, Color);
            }
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
        }
    }

    void DrawLine(int32_t X0, int32_t Y0, int32_t X1, int32_t Y1, PixelRgb Color)
    {
        int32_t DX = std::abs(X1 - X0);
        int32_t DY = std::abs(Y1 - Y0);
        int32_t Steps = std::max(DX, DY);
        if (Steps == 0)
        {
<<<<<<< HEAD
            if (X0 >= 0 && X0 < static_cast<int32_t>(CanvasWidth) && Y0 >= 0 && Y0 < static_cast<int32_t>(CanvasHeight))
            {
                Buffer[Y0 * CanvasWidth + X0] = Color;
            }
=======
            PutPixel(X0, Y0, Color);
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
            return;
        }

        float XInc = static_cast<float>(X1 - X0) / static_cast<float>(Steps);
        float YInc = static_cast<float>(Y1 - Y0) / static_cast<float>(Steps);
<<<<<<< HEAD

=======
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
        float CurrX = static_cast<float>(X0);
        float CurrY = static_cast<float>(Y0);

        for (int32_t i = 0; i <= Steps; ++i)
        {
<<<<<<< HEAD
            int32_t PxX = static_cast<int32_t>(std::round(CurrX));
            int32_t PxY = static_cast<int32_t>(std::round(CurrY));
            if (PxX >= 0 && PxX < static_cast<int32_t>(CanvasWidth) && PxY >= 0 && PxY < static_cast<int32_t>(CanvasHeight))
            {
                Buffer[PxY * CanvasWidth + PxX] = Color;
            }
=======
            PutPixel(static_cast<int32_t>(std::round(CurrX)), static_cast<int32_t>(std::round(CurrY)), Color);
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
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
<<<<<<< HEAD
                if (X >= 0 && X < static_cast<int32_t>(CanvasWidth) && Y >= 0 && Y < static_cast<int32_t>(CanvasHeight))
                {
                    int32_t DX = X - CenterX;
                    int32_t DY = Y - CenterY;
                    if (DX * DX + DY * DY <= Radius * Radius)
                    {
                        Buffer[Y * CanvasWidth + X] = Color;
                    }
=======
                int32_t DX = X - CenterX;
                int32_t DY = Y - CenterY;
                if (DX * DX + DY * DY <= Radius * Radius)
                {
                    PutPixel(X, Y, Color);
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
                }
            }
        }
    }

<<<<<<< HEAD
=======
    void DrawText(int32_t StartX, int32_t StartY, const std::string& Text, PixelRgb Color, int32_t Scale = 1)
    {
        int32_t CurX = StartX;
        for (char C : Text)
        {
            if (C < 32 || C > 126) C = ' ';
            uint32_t GlyphIdx = static_cast<uint32_t>(C - 32);

            for (int32_t Col = 0; Col < 5; ++Col)
            {
                uint8_t Bits = Font5x7[GlyphIdx][Col];
                for (int32_t Row = 0; Row < 7; ++Row)
                {
                    if ((Bits >> Row) & 1)
                    {
                        for (int32_t Sy = 0; Sy < Scale; ++Sy)
                        {
                            for (int32_t Sx = 0; Sx < Scale; ++Sx)
                            {
                                PutPixel(CurX + Col * Scale + Sx, StartY + Row * Scale + Sy, Color);
                            }
                        }
                    }
                }
            }
            CurX += (6 * Scale);
        }
    }

    int32_t MeasureTextWidth(const std::string& Text, int32_t Scale = 1)
    {
        return static_cast<int32_t>(Text.length()) * 6 * Scale;
    }

>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
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

<<<<<<< HEAD
    // Single unified Theme Section with 8 theme cards + UIComponents.html rounding slider [ number | unit ] [---O---]
    void DrawUnifiedThemeSectionCard(
=======
    // Single unified Theme Section matching HTML exact layout
    void DrawExactThemeSectionModal(
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
        int32_t X0, int32_t Y0, int32_t W, int32_t H,
        ThemeCategory SelectedTheme, float CornerRadiusPx, PixelRgb AccentRgb)
    {
        int32_t R = static_cast<int32_t>(CornerRadiusPx);

<<<<<<< HEAD
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
=======
        // Modal Full Card Container (dark panel #121212)
        DrawRoundedRectangle(X0, Y0, X0 + W, Y0 + H, R, PixelRgb{ 18, 18, 18 });
        DrawRoundedOutline(X0, Y0, X0 + W, Y0 + H, R, 1, PixelRgb{ 38, 38, 38 });

        // Header Top Bar: Back Button [←] + "Display Settings" + Subtitle
        DrawCircle(X0 + 36, Y0 + 32, 16, PixelRgb{ 32, 32, 36 });
        // Back arrow glyph ←
        DrawLine(X0 + 41, Y0 + 32, X0 + 30, Y0 + 32, PixelRgb{ 255, 255, 255 });
        DrawLine(X0 + 30, Y0 + 32, X0 + 35, Y0 + 27, PixelRgb{ 255, 255, 255 });
        DrawLine(X0 + 30, Y0 + 32, X0 + 35, Y0 + 37, PixelRgb{ 255, 255, 255 });

        // Close X button on the top right
        DrawCircle(X0 + W - 36, Y0 + 32, 16, PixelRgb{ 26, 26, 30 });
        DrawLine(X0 + W - 41, Y0 + 27, X0 + W - 31, Y0 + 37, PixelRgb{ 180, 180, 190 });
        DrawLine(X0 + W - 31, Y0 + 27, X0 + W - 41, Y0 + 37, PixelRgb{ 180, 180, 190 });

        DrawText(X0 + 64, Y0 + 22, "Display Settings", PixelRgb{ 245, 245, 248 }, 2);
        DrawText(X0 + 64, Y0 + 40, "Appearance, typography & hardware preferences", PixelRgb{ 136, 136, 136 }, 1);

        // Tab Strip: [ Theme (Active) | Fonts | Display ]
        int32_t TabY = Y0 + 64;
        DrawText(X0 + 36, TabY, "Theme", PixelRgb{ 255, 255, 255 }, 1);
        DrawLine(X0 + 36, TabY + 14, X0 + 72, TabY + 14, PixelRgb{ 255, 255, 255 }); // Active underline indicator

        DrawText(X0 + 100, TabY, "Fonts", PixelRgb{ 120, 120, 125 }, 1);
        DrawText(X0 + 160, TabY, "Display", PixelRgb{ 120, 120, 125 }, 1);
        DrawLine(X0 + 24, TabY + 15, X0 + W - 24, TabY + 15, PixelRgb{ 32, 32, 36 });
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)

        // ---------------------------------------------------------------------------------------------------------------
        // UNIFIED THEME SECTION (Single Container Card)
        // ---------------------------------------------------------------------------------------------------------------
<<<<<<< HEAD
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
=======
        int32_t SecX0 = X0 + 24;
        int32_t SecY0 = TabY + 28;
        int32_t SecW  = W - 48;
        int32_t SecH  = H - 180;

        DrawRoundedRectangle(SecX0, SecY0, SecX0 + SecW, SecY0 + SecH, R, PixelRgb{ 20, 20, 22 });
        DrawRoundedOutline(SecX0, SecY0, SecX0 + SecW, SecY0 + SecH, R, 1, PixelRgb{ 36, 36, 40 });

        // Section Title: "Color Scheme & Surface Theme"
        DrawText(SecX0 + 20, SecY0 + 16, "Color Scheme & Surface Theme", PixelRgb{ 240, 240, 245 }, 1);
        DrawText(SecX0 + 20, SecY0 + 28, "Select global canvas theme and UI roundness", PixelRgb{ 110, 110, 120 }, 1);

        // 8 Theme Tiles / Cards Grid (4 cols x 2 rows)
        struct ThemeCardDef {
            const char* Name;
            PixelRgb CanvasColor;
            PixelRgb SidebarColor;
            PixelRgb PanelColor;
            PixelRgb StripColor;
        };

        const ThemeCardDef ThemeDefs[8] = {
            { "OLED",    PixelRgb{ 0, 0, 0 },       PixelRgb{ 10, 10, 10 },    PixelRgb{ 20, 20, 21 },    PixelRgb{ 255, 255, 255 } },
            { "Dark",    PixelRgb{ 17, 17, 17 },    PixelRgb{ 26, 26, 26 },    PixelRgb{ 34, 34, 37 },    PixelRgb{ 220, 220, 220 } },
            { "Dim",     PixelRgb{ 15, 23, 42 },    PixelRgb{ 30, 41, 59 },    PixelRgb{ 40, 53, 72 },    PixelRgb{ 148, 163, 184 } },
            { "Light",   PixelRgb{ 241, 245, 249 }, PixelRgb{ 255, 255, 255 }, PixelRgb{ 248, 250, 252 }, PixelRgb{ 30, 30, 35 } },
            { "Sepia",   PixelRgb{ 234, 221, 207 }, PixelRgb{ 244, 235, 225 }, PixelRgb{ 250, 238, 217 }, PixelRgb{ 92, 75, 58 } },
            { "Dracula", PixelRgb{ 40, 42, 54 },    PixelRgb{ 68, 71, 90 },    PixelRgb{ 56, 58, 89 },    PixelRgb{ 248, 248, 242 } },
            { "Nord",    PixelRgb{ 46, 52, 64 },    PixelRgb{ 59, 66, 82 },    PixelRgb{ 67, 76, 94 },    PixelRgb{ 236, 239, 244 } },
            { "GitHub",  PixelRgb{ 13, 17, 23 },    PixelRgb{ 22, 27, 34 },    PixelRgb{ 33, 38, 45 },    PixelRgb{ 201, 209, 217 } }
        };

        int32_t GridX0  = SecX0 + 20;
        int32_t GridY0  = SecY0 + 46;
        int32_t TileGap = 14;
        int32_t TileW   = (SecW - 40 - (TileGap * 3)) / 4;
        int32_t TileH   = 56;
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)

        for (int32_t r = 0; r < 2; ++r)
        {
            for (int32_t c = 0; c < 4; ++c)
            {
                int32_t Idx = r * 4 + c;
                int32_t TX0 = GridX0 + c * (TileW + TileGap);
<<<<<<< HEAD
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
=======
                int32_t TY0 = GridY0 + r * (TileH + TileGap + 14);
                bool IsActive = (static_cast<size_t>(SelectedTheme) == static_cast<size_t>(Idx));

                // Tile Background Container (Outer Canvas color)
                int32_t TileR = 14;
                DrawRoundedRectangle(TX0, TY0, TX0 + TileW, TY0 + TileH, TileR, ThemeDefs[Idx].CanvasColor);

                // Nested Window Mock (Top-left offset mini desktop window)
                int32_t NestedX = TX0 + 10;
                int32_t NestedY = TY0 + 10;
                int32_t NestedW = TileW - 10;
                int32_t NestedH = TileH - 10;
                int32_t SideW   = NestedW * 3 / 10;

                // Sidebar column (30%)
                DrawRoundedRectangle(NestedX, NestedY, NestedX + SideW, NestedY + NestedH, 6, ThemeDefs[Idx].SidebarColor);
                // Tiny item bars inside sidebar
                DrawFilledRectangle(NestedX + 3, NestedY + 4, NestedX + SideW - 3, NestedY + 6, ThemeDefs[Idx].StripColor);
                DrawFilledRectangle(NestedX + 3, NestedY + 9, NestedX + SideW - 5, NestedY + 11, ThemeDefs[Idx].StripColor);

                // Main panel column (70%)
                DrawRoundedRectangle(NestedX + SideW + 1, NestedY, NestedX + NestedW, NestedY + NestedH, 6, ThemeDefs[Idx].PanelColor);
                // Top mock content box
                DrawFilledRectangle(NestedX + SideW + 4, NestedY + 4, NestedX + NestedW - 4, NestedY + 12, ThemeDefs[Idx].StripColor);

                // Subtle inner border
                DrawRoundedOutline(TX0, TY0, TX0 + TileW, TY0 + TileH, TileR, 1, PixelRgb{ 50, 50, 55 });

                // Active selection ring (outline with offset)
                if (IsActive)
                {
                    DrawRoundedOutline(TX0 - 3, TY0 - 3, TX0 + TileW + 3, TY0 + TileH + 3, TileR + 3, 2, AccentRgb);
                }

                // Centered Label text beneath tile
                int32_t LabelW = MeasureTextWidth(ThemeDefs[Idx].Name, 1);
                int32_t LabelX = TX0 + (TileW - LabelW) / 2;
                int32_t LabelY = TY0 + TileH + 4;
                PixelRgb LabelColor = IsActive ? PixelRgb{ 255, 255, 255 } : PixelRgb{ 140, 140, 150 };
                DrawText(LabelX, LabelY, ThemeDefs[Idx].Name, LabelColor, 1);
            }
        }

        // Section Divider Line
        int32_t DivY = SecY0 + 208;
        DrawLine(SecX0 + 20, DivY, SecX0 + SecW - 20, DivY, PixelRgb{ 36, 36, 42 });
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)

        // ---------------------------------------------------------------------------------------------------------------
        // GLOBAL ROUNDING SLIDER ROW (From UIComponents.html: .crow > .clabel + .vpill[.num | .unit] + input.slider)
        // ---------------------------------------------------------------------------------------------------------------
        int32_t CRowY0 = DivY + 16;

        // 1. Control Label (.clabel: "Corner Radius")
<<<<<<< HEAD
        DrawFilledRectangle(SecX0 + 20, CRowY0 + 12, SecX0 + 110, CRowY0 + 22, PixelRgb{ 220, 220, 230 });
=======
        DrawText(SecX0 + 20, CRowY0 + 12, "Corner Radius", PixelRgb{ 230, 230, 235 }, 1);
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)

        // 2. Value Pill (.vpill: [ number | unit ])
        int32_t VPillX0 = SecX0 + 130;
        int32_t VPillW  = 96;
        int32_t VPillH  = 34;
<<<<<<< HEAD
        DrawRoundedRectangle(VPillX0, CRowY0 + 2, VPillX0 + VPillW, CRowY0 + 2 + VPillH, 999, PixelRgb{ 10, 10, 12 });
        // Split border
        DrawLine(VPillX0 + 60, CRowY0 + 2, VPillX0 + 60, CRowY0 + 2 + VPillH, PixelRgb{ 38, 38, 44 });
        // Value "24" representation in .num
        DrawFilledRectangle(VPillX0 + 20, CRowY0 + 12, VPillX0 + 44, CRowY0 + 24, PixelRgb{ 255, 255, 255 });
        // Unit "px" representation in .unit
        DrawFilledRectangle(VPillX0 + 68, CRowY0 + 14, VPillX0 + 86, CRowY0 + 22, PixelRgb{ 140, 140, 155 });
=======

        // Value pill container (black pill #000000)
        DrawRoundedRectangle(VPillX0, CRowY0 + 2, VPillX0 + VPillW, CRowY0 + 2 + VPillH, 999, PixelRgb{ 0, 0, 0 });
        DrawRoundedOutline(VPillX0, CRowY0 + 2, VPillX0 + VPillW, CRowY0 + 2 + VPillH, 999, 1, PixelRgb{ 46, 46, 46 });

        // Split divider line between .num and .unit
        DrawLine(VPillX0 + 58, CRowY0 + 2, VPillX0 + 58, CRowY0 + 2 + VPillH, PixelRgb{ 46, 46, 46 });

        // Right side .unit background inset
        DrawRoundedRectangle(VPillX0 + 59, CRowY0 + 3, VPillX0 + VPillW - 1, CRowY0 + 1 + VPillH, 999, PixelRgb{ 26, 26, 26 });

        // Value text (e.g. "24") in .num
        std::string RadiusStr = std::to_string(static_cast<int>(std::round(CornerRadiusPx)));
        int32_t NumW = MeasureTextWidth(RadiusStr, 1);
        int32_t NumX = VPillX0 + (58 - NumW) / 2;
        DrawText(NumX, CRowY0 + 14, RadiusStr, PixelRgb{ 255, 255, 255 }, 1);

        // Unit text "px" in .unit
        int32_t UnitW = MeasureTextWidth("px", 1);
        int32_t UnitX = VPillX0 + 58 + (38 - UnitW) / 2;
        DrawText(UnitX, CRowY0 + 14, "px", PixelRgb{ 136, 136, 136 }, 1);
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)

        // 3. Chunky Range Slider (input[type=range].slider.hi: [---O---])
        int32_t SliderX0 = VPillX0 + VPillW + 16;
        int32_t SliderX1 = SecX0 + SecW - 20;
<<<<<<< HEAD
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
=======
        int32_t SliderH  = 28;
        int32_t SliderY  = CRowY0 + 5;

        // Base Track (dark surface #222222)
        DrawRoundedRectangle(SliderX0, SliderY, SliderX1, SliderY + SliderH, 999, PixelRgb{ 34, 34, 34 });

        // Accent Fill Track (progress fill up to thumb center)
        float Progress = std::clamp(CornerRadiusPx / 32.0f, 0.0f, 1.0f);
        int32_t ThumbCenterX = static_cast<int32_t>(SliderX0 + 13 + Progress * (SliderX1 - SliderX0 - 26));
        DrawRoundedRectangle(SliderX0, SliderY, ThumbCenterX, SliderY + SliderH, 999, AccentRgb);

        // Circular Slider Thumb (diameter 24px pure white with shadow)
        DrawCircle(ThumbCenterX, SliderY + SliderH / 2 + 1, 13, PixelRgb{ 0, 0, 0 }); // Shadow
        DrawCircle(ThumbCenterX, SliderY + SliderH / 2, 12, PixelRgb{ 245, 245, 245 });
        DrawCircle(ThumbCenterX, SliderY + SliderH / 2, 5, AccentRgb); // Center dot accent

        // ---------------------------------------------------------------------------------------------------------------
        // MODAL FOOTER BOTTOM BAR
        // ---------------------------------------------------------------------------------------------------------------
        int32_t FootY0 = H - 54 + Y0;
        DrawLine(X0 + 20, FootY0, X0 + W - 20, FootY0, PixelRgb{ 32, 32, 36 });
        DrawText(X0 + 28, FootY0 + 18, "Slate Engine . Vulkan 1.3 . Right-Hand Z-Up", PixelRgb{ 100, 100, 110 }, 1);

        // Discard Ghost Button
        DrawText(X0 + W - 230, FootY0 + 18, "Discard", PixelRgb{ 140, 140, 150 }, 1);

        // Apply Preferences Solid White Pill Button
        int32_t BtnX0 = X0 + W - 156;
        int32_t BtnY0 = FootY0 + 8;
        int32_t BtnW  = 136;
        int32_t BtnH  = 32;
        DrawRoundedRectangle(BtnX0, BtnY0, BtnX0 + BtnW, BtnY0 + BtnH, 999, PixelRgb{ 255, 255, 255 });
        int32_t BtnTextW = MeasureTextWidth("Apply Preferences", 1);
        DrawText(BtnX0 + (BtnW - BtnTextW) / 2, BtnY0 + 12, "Apply Preferences", PixelRgb{ 10, 10, 10 }, 1);
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
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
<<<<<<< HEAD
        Canvas.Clear(Frontier::PixelRgb{ 0, 0, 0 });

        float HandleY = Panel.QueryHandleY();
        Canvas.DrawFilledRectangle(0, 0, Width - 1, static_cast<int32_t>(HandleY), Frontier::PixelRgb{ 10, 10, 12 });

        int32_t CardW = 560;
        int32_t CardH = 430;
        int32_t CardX = (Width - CardW) / 2;
        int32_t CardY = 40;

        Canvas.DrawUnifiedThemeSectionCard(
=======
        Canvas.Clear(Frontier::PixelRgb{ 0, 0, 0 }); // Pure black OLED workspace

        float HandleY = Panel.QueryHandleY();
        Canvas.DrawFilledRectangle(0, 0, Width - 1, static_cast<int32_t>(HandleY), Frontier::PixelRgb{ 10, 10, 10 });

        int32_t CardW = 620;
        int32_t CardH = 460;
        int32_t CardX = (Width - CardW) / 2;
        int32_t CardY = 30;

        Canvas.DrawExactThemeSectionModal(
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
            CardX, CardY, CardW, CardH,
            Frontier::ThemeCategory::Oled, 24.0f,
            Frontier::PixelRgb{ 59, 130, 246 }
        );

        const auto& Contour = Panel.QueryHandleContour();
<<<<<<< HEAD
        Canvas.DrawFilledPolygon(Contour, Panel.QueryHandleX(), HandleY, Frontier::PixelRgb{ 10, 10, 12 });

        Canvas.ExportPpm("Diagnostics/ControlCenter_ThemeSection_Proof.ppm");
        (void)std::system("python3 Tools/PpmToPng.py Diagnostics/ControlCenter_ThemeSection_Proof.ppm Diagnostics/ControlCenter_ThemeSection_Proof.png > /dev/null 2>&1");
        std::cout << "[Theme Proof 1] Generated high-res Theme Section proof.\n";
=======
        Canvas.DrawFilledPolygon(Contour, Panel.QueryHandleX(), HandleY, Frontier::PixelRgb{ 10, 10, 10 });

        Canvas.ExportPpm("Diagnostics/ControlCenter_ThemeSection_Proof.ppm");
        (void)std::system("python3 Tools/PpmToPng.py Diagnostics/ControlCenter_ThemeSection_Proof.ppm Diagnostics/ControlCenter_ThemeSection_Proof.png > /dev/null 2>&1");
        std::cout << "[Theme Proof 1] Generated high-res Theme Section proof with exact HTML match.\n";
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
    }

    // ===================================================================================================================
    // 2. TWO-STATE COMPOSITE PROOF (OLED 24px vs Dracula 12px)
    // ===================================================================================================================
    {
<<<<<<< HEAD
        constexpr uint32_t TotalW = 1400;
        constexpr uint32_t TotalH = 580;
        constexpr uint32_t PanelW = 700;
=======
        constexpr uint32_t TotalW = 1440;
        constexpr uint32_t TotalH = 580;
        constexpr uint32_t PanelW = 720;
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)

        Frontier::ProofCanvas Canvas(TotalW, TotalH);
        Canvas.Clear(Frontier::PixelRgb{ 0, 0, 0 });

<<<<<<< HEAD
        int32_t CardW = 580;
        int32_t CardH = 440;
        int32_t CardY = 50;

        // Left Panel: OLED Theme (24px Corner Radius, Blue Accent)
        {
            Canvas.DrawFilledRectangle(0, 0, PanelW - 1, TotalH - 36, Frontier::PixelRgb{ 8, 8, 10 });
            Canvas.DrawUnifiedThemeSectionCard(
=======
        int32_t CardW = 620;
        int32_t CardH = 460;
        int32_t CardY = 30;

        // Left Panel: OLED Theme (24px Corner Radius, Electric Blue Accent)
        {
            Canvas.DrawFilledRectangle(0, 0, PanelW - 1, TotalH - 36, Frontier::PixelRgb{ 6, 6, 8 });
            Canvas.DrawExactThemeSectionModal(
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
                (PanelW - CardW) / 2, CardY, CardW, CardH,
                Frontier::ThemeCategory::Oled, 24.0f,
                Frontier::PixelRgb{ 59, 130, 246 }
            );
        }

<<<<<<< HEAD
        // Right Panel: Dracula Theme (12px Corner Radius, Violet Accent)
        {
            int32_t OffsetX = PanelW;
            Canvas.DrawFilledRectangle(OffsetX, 0, OffsetX + PanelW - 1, TotalH - 36, Frontier::PixelRgb{ 14, 15, 20 });
            Canvas.DrawUnifiedThemeSectionCard(
=======
        // Right Panel: Dracula Theme (12px Corner Radius, Lilac Accent)
        {
            int32_t OffsetX = PanelW;
            Canvas.DrawFilledRectangle(OffsetX, 0, OffsetX + PanelW - 1, TotalH - 36, Frontier::PixelRgb{ 12, 13, 18 });
            Canvas.DrawExactThemeSectionModal(
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
                OffsetX + (PanelW - CardW) / 2, CardY, CardW, CardH,
                Frontier::ThemeCategory::Dracula, 12.0f,
                Frontier::PixelRgb{ 139, 92, 246 }
            );
        }

<<<<<<< HEAD
        Canvas.DrawLine(PanelW, 0, PanelW, TotalH - 1, Frontier::PixelRgb{ 36, 36, 44 });

        Canvas.ExportPpm("Diagnostics/ControlCenter_ThemeSection_Composite.ppm");
        (void)std::system("python3 Tools/PpmToPng.py Diagnostics/ControlCenter_ThemeSection_Composite.ppm Diagnostics/ControlCenter_ThemeSection_Composite.png > /dev/null 2>&1");
        std::cout << "[Theme Proof 2] Generated Composite comparison proof.\n";
    }

    (void)std::system("rm -f Diagnostics/*.ppm");
    std::cout << "[Verification Complete] All theme section proof images generated successfully.\n";
=======
        Canvas.DrawLine(PanelW, 0, PanelW, TotalH - 1, Frontier::PixelRgb{ 32, 32, 38 });

        Canvas.ExportPpm("Diagnostics/ControlCenter_ThemeSection_Composite.ppm");
        (void)std::system("python3 Tools/PpmToPng.py Diagnostics/ControlCenter_ThemeSection_Composite.ppm Diagnostics/ControlCenter_ThemeSection_Composite.png > /dev/null 2>&1");
        std::cout << "[Theme Proof 2] Generated Composite comparison proof with exact HTML match.\n";
    }

    (void)std::system("rm -f Diagnostics/*.ppm");
    std::cout << "[Verification Complete] All exact theme section proof images generated successfully.\n";
>>>>>>> 0a532a9 (fix(ui): match exact Theme Section and UIComponents rounding slider fidelity with typography and theme tiles)
    return 0;
}
