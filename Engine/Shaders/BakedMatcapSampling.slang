//============================================================================================================================================
// Shared flat + baked-metal matcap sampling. Included by Frontier's GPU resolve and SolidArc's software raster mirror.
//============================================================================================================================================
#ifndef FRONTIER_BAKED_MATCAP_SAMPLING_SLANG
#define FRONTIER_BAKED_MATCAP_SAMPLING_SLANG

// MatcapTexels is supplied by the caller: a std430 uint SSBO on the GPU, the exact same embedded RGBA8 array on CPU.
// Texels are packed R | G<<8 | B<<16 | A<<24 and stored as sRGB. The return value is linear to match the renderer's
// lighting domain; both paths use the same bilinear footprint and sRGB transfer approximation.
float3 BakedMetalMatcapTexelLinear(int X, int Y)
{
    X = X < 0 ? 0 : (X >= int(kBakedMetalMatcapSize) ? int(kBakedMetalMatcapSize) - 1 : X);
    Y = Y < 0 ? 0 : (Y >= int(kBakedMetalMatcapSize) ? int(kBakedMetalMatcapSize) - 1 : Y);
    uint Packed = MatcapTexels[uint(Y * kBakedMetalMatcapSize + X)];
    float3 Encoded = float3(float(Packed & 255u), float((Packed >> 8u) & 255u), float((Packed >> 16u) & 255u)) / 255.0;
    return float3(pow(Encoded.x, 2.2), pow(Encoded.y, 2.2), pow(Encoded.z, 2.2));
}

float3 BakedMetalMatcapLookup(float3 ViewNormal)
{
    float Fx = (ViewNormal.x * 0.5 + 0.5) * float(kBakedMetalMatcapSize) - 0.5;
    float Fy = (0.5 - ViewNormal.y * 0.5) * float(kBakedMetalMatcapSize) - 0.5;
    int X0 = int(floor(Fx)), Y0 = int(floor(Fy));
    float Tx = Fx - float(X0), Ty = Fy - float(Y0);
    float3 Top = lerp(BakedMetalMatcapTexelLinear(X0,     Y0),
                      BakedMetalMatcapTexelLinear(X0 + 1, Y0), Tx);
    float3 Bottom = lerp(BakedMetalMatcapTexelLinear(X0,     Y0 + 1),
                         BakedMetalMatcapTexelLinear(X0 + 1, Y0 + 1), Tx);
    return lerp(Top, Bottom, Ty);
}

float3 ViewportFlatColour(float3 Albedo)
{
    return Albedo;
}

float3 ViewportMatcapTint(float3 MatcapColour, float3 Albedo)
{
    float Maximum = max(max(Albedo.x, Albedo.y), max(Albedo.z, 1e-3));
    return MatcapColour * lerp(float3(1.0), Albedo / Maximum, 0.20);
}

#endif // FRONTIER_BAKED_MATCAP_SAMPLING_SLANG
