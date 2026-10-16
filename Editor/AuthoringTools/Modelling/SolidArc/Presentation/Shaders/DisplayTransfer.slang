//============================================================================================================================================
// 📦 Display transfer shared by the CPU proof readback and the browser GPU's final full-screen pass.
//============================================================================================================================================
// Blend and resolve in linear light, then apply the original proof display curve exactly once.
float DisplayTransfer(float LinearValue)
{
    return pow(saturate(LinearValue), 1.0f / 2.2f);
}
