// Proof of the VK_NOT_READY logic bug, no Vulkan needed.
#include <cstdio>
#include <cstdint>
enum VkResult { VK_SUCCESS=0, VK_NOT_READY=1 };
static constexpr uint32_t kTimestampCount = 20u;

// Emulates the driver: queries 16..19 are NEVER written by any call site,
// so they are permanently "unavailable". Spec: without WAIT_BIT the call
// returns VK_NOT_READY when ANY query in the range is unavailable.
VkResult FakeGetQueryPoolResults(uint64_t* Stamps)
{
    bool AnyUnavailable = false;
    for (uint32_t I = 0; I < kTimestampCount; ++I)
    {
        const bool Written = !(I >= 16u && I <= 19u);   // sky/volume never written
        Stamps[I*2u+0u] = Written ? (uint64_t)(1000u + I*100u) : 0u;
        Stamps[I*2u+1u] = Written ? 1u : 0u;            // availability word
        if (!Written) AnyUnavailable = true;
    }
    return AnyUnavailable ? VK_NOT_READY : VK_SUCCESS;
}

int main()
{
    uint64_t Stamps[kTimestampCount*2u]{};
    float Cull = -1.0f;

    // ---- CURRENT CODE: `== VK_SUCCESS` ----
    if (FakeGetQueryPoolResults(Stamps) == VK_SUCCESS) { Cull = 1.0f; }
    printf("current  : result=%d -> block %s, cull reported = %.2f ms\n",
           FakeGetQueryPoolResults(Stamps), Cull < 0 ? "SKIPPED" : "ran", Cull < 0 ? 0.0f : Cull);

    // ---- FIXED: accept NOT_READY, trust the availability words ----
    const VkResult R = FakeGetQueryPoolResults(Stamps);
    if (R == VK_SUCCESS || R == VK_NOT_READY)
    {
        auto Have=[&](uint32_t I){return Stamps[I*2u+1u]!=0u;};
        auto Val =[&](uint32_t I){return Stamps[I*2u];};
        auto Ms=[&](uint32_t A,uint32_t B){ if(!Have(A)||!Have(B)||Val(B)<=Val(A)) return 0.0; return (double)(Val(B)-Val(A))*1.0*1e-3; };
        printf("fixed    : result=%d -> block ran,  cull reported = %.2f ms, sky = %.2f ms (correctly 0, never written)\n",
               R, Ms(0,1), Ms(16,17));
    }
    return 0;
}
