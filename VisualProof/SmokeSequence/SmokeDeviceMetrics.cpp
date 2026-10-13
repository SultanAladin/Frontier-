//============================================================================================================================================
//                                                         SMOKEDEVICEMETRICS.CPP
//============================================================================================================================================
// 📦 Executed production Vulkan transport assertions; synthetic numerical fields are tests, never the actual-car visual deliverable.

#define main ZeroCarExhibitEntry
#include "ZeroViewportMetrics.cpp"
#undef main

namespace
{

void SubmitTransport(VulkanProofSequence& Device, Frontier::SmokeExchange& Fine)
{
    Device.Begin();
    Require(Fine.RecordTransport(Device.Command, 0u), Fine.QueryRefusal());
    Device.Complete();
    Fine.ReadCompleted(0u);
}

std::vector<uint16_t> ReadThermo(VulkanProofSequence& Device, const Frontier::SmokeExchange& Fine, uint32_t Extent)
{
    std::vector<uint16_t> Thermo(Extent * Extent * Extent * 4u);
    Device.ReadImage(Fine.QueryVolumeImage(), {Extent, Extent, Extent}, Thermo.data(), Thermo.size() * sizeof(uint16_t));
    return Thermo;
}

void ConstructReading(FrontierProjectSmokeReading& Scalar, FrontierSmokeTransportReading& Transport,
                      std::vector<float>& Velocity, uint64_t Carrier)
{
    Scalar = {};
    Scalar.StructureSize = sizeof(Scalar);
    Scalar.Extent = 32u;
    Scalar.CarrierIdentifier = Carrier;
    Scalar.Revision = 1u;
    Scalar.Span = 24.0f;
    std::fill_n(Scalar.Origin, 3u, -12.0f);
    Transport = {};
    Transport.StructureSize = sizeof(Transport);
    Transport.InterchangeNumber = FrontierSmokeTransportNumber;
    Transport.Extent = 32u;
    Transport.CarrierIdentifier = Carrier;
    Transport.Revision = 1u;
    Transport.Capacity = 32u * 32u * 32u;
    Transport.VelocityOccupancy = Velocity.data();
    Transport.Span = 24.0f;
    std::fill_n(Transport.Origin, 3u, -12.0f);
    Transport.ChassisPosition[0] = 1000.0f;
    Transport.ChassisInverse[3] = 1.0f;
    std::fill_n(Transport.ChassisMinimum, 3u, -1.0f);
    std::fill_n(Transport.ChassisMaximum, 3u, 1.0f);
    Transport.SmokeLoss = 0.12f;
    Transport.Cooling = 0.35f;
}

FrontierSmokeInjection SourceAt(uint32_t Tick)
{
    FrontierSmokeInjection Source{};
    Source.PositionRadius[0] = 0.25f * Tick;
    Source.PositionRadius[1] = 0.3f;
    Source.PositionRadius[2] = 1.4f;
    Source.PositionRadius[3] = 0.55f;
    Source.VelocityDensity[3] = 36.0f;
    Source.Temperature[0] = 1.0f;
    return Source;
}

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count == 3);
    const std::filesystem::path Output = Arguments[2];
    VulkanProofSequence Device(64u, 64u);
    Frontier::SmokeDeviceSpecification Specification;
    Specification.PhysicalDevice = Device.PhysicalDevice;
    Specification.Device = Device.Device;
    Specification.MemoryProperties = Device.MemoryProperties;
    Specification.FineExtent = 64u;
    Specification.CycleSlotCount = 1u;
    Specification.SpirvLocation = Arguments[1];
    Frontier::SmokeExchange Batched, Stepped;
    Require(Batched.Construct(Specification), Batched.QueryRefusal());
    Require(Stepped.Construct(Specification), Stepped.QueryRefusal());
    assert(!Batched.Resident() && Batched.QueryMetrics().HeldBytes == 0u);
    std::vector<float> Velocity(32u * 32u * 32u * 4u, 0.0f);
    FrontierProjectSmokeReading Scalar, StepScalar;
    FrontierSmokeTransportReading Transport, StepTransport;
    ConstructReading(Scalar, Transport, Velocity, 731u);
    ConstructReading(StepScalar, StepTransport, Velocity, 732u);
    Transport.CompletedTicks = 6u;
    Transport.SourceCount = 6u;
    Scalar.Revision = Transport.Revision = 6u;
    for (uint32_t Tick = 0u; Tick < 6u; ++Tick)
    {
        Transport.Sources[Tick] = SourceAt(Tick);
        Transport.SourceOffsets[Tick + 1u] = Tick + 1u;
    }
    Require(Batched.Capture(Scalar, Transport), Batched.QueryRefusal());
    // The exchange owns its completed copy; no plugin pointer is read after Capture returns.
    std::fill(Velocity.begin(), Velocity.end(), std::numeric_limits<float>::quiet_NaN());
    SubmitTransport(Device, Batched);
    std::fill(Velocity.begin(), Velocity.end(), 0.0f);
    for (uint32_t Tick = 0u; Tick < 6u; ++Tick)
    {
        StepScalar.Revision = StepTransport.Revision = Tick + 1u;
        StepTransport.CompletedTicks = 1u;
        StepTransport.SourceCount = 1u;
        StepTransport.SourceOffsets[1] = 1u;
        StepTransport.Sources[0] = SourceAt(Tick);
        Require(Stepped.Capture(StepScalar, StepTransport), Stepped.QueryRefusal());
        SubmitTransport(Device, Stepped);
    }
    const auto Before = ReadThermo(Device, Batched, 64u);
    assert(Before == ReadThermo(Device, Stepped, 64u));
    assert(std::any_of(Before.begin(), Before.end(), [](uint16_t Sample) { return Sample != 0u; }));
    std::puts("PASS GPU per-completed-tick batching equals six individual advances, including swept source positions");

    const int32_t Shift[3] = {6, -4, 2};
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        Scalar.Origin[Axis] = Transport.Origin[Axis] = -12.0f + Shift[Axis] * 0.375f;
    Scalar.Revision = Transport.Revision = 7u;
    Transport.CompletedTicks = Transport.SourceCount = 0u;
    std::fill_n(Transport.SourceOffsets, 7u, 0u);
    Require(Batched.Capture(Scalar, Transport), Batched.QueryRefusal());
    SubmitTransport(Device, Batched);
    const auto Relocated = ReadThermo(Device, Batched, 64u);
    uint64_t Preserved = 0u, Cleared = 0u;
    for (int32_t Height = 0; Height < 64; ++Height)
        for (int32_t Row = 0; Row < 64; ++Row)
            for (int32_t Column = 0; Column < 64; ++Column)
            {
                const int32_t PreviousColumn = Column + Shift[0], PreviousRow = Row + Shift[1], PreviousHeight = Height + Shift[2];
                const uint32_t Cell = static_cast<uint32_t>(Column + 64 * (Row + 64 * Height));
                const bool Retained = PreviousColumn >= 0 && PreviousColumn < 64 && PreviousRow >= 0 && PreviousRow < 64 &&
                                      PreviousHeight >= 0 && PreviousHeight < 64;
                for (uint32_t Component = 0u; Component < 4u; ++Component)
                {
                    const uint16_t Expected = Retained ? Before[(PreviousColumn + 64 * (PreviousRow + 64 * PreviousHeight)) * 4u + Component] : 0u;
                    assert(Relocated[Cell * 4u + Component] == Expected);
                }
                if (Retained) ++Preserved; else ++Cleared;
            }
    assert(Batched.QueryMetrics().TransportTicks == 6u && Batched.QueryMetrics().Relocations == 1u);
    std::puts("PASS GPU integer scrolling preserves density and temperature bit-exactly; exposed texels are clear and clock is unchanged");

    Scalar.Revision = Transport.Revision = 8u;
    Transport.ChassisInverse[2] = std::sin(0.7f);
    Transport.ChassisInverse[3] = std::cos(0.7f);
    Require(Batched.Capture(Scalar, Transport), Batched.QueryRefusal());
    SubmitTransport(Device, Batched);
    assert(Relocated == ReadThermo(Device, Batched, 64u));
    std::puts("PASS changing rigid vehicle yaw never rotates, translates or relabels retained world gas");

    const uint64_t Acquisition = Batched.QueryMetrics().Acquisitions;
    Transport.CompletedTicks = 1u;
    Transport.SourceCount = 0u;
    Scalar.Revision = Transport.Revision = 9u;
    Require(Batched.Capture(Scalar, Transport), Batched.QueryRefusal()); SubmitTransport(Device, Batched);
    Transport.SourceCount = Transport.SourceOffsets[1] = 1u;
    Transport.Sources[0] = SourceAt(6u);
    Scalar.Revision = Transport.Revision = 10u;
    Require(Batched.Capture(Scalar, Transport), Batched.QueryRefusal()); SubmitTransport(Device, Batched);
    assert(Batched.QueryMetrics().Acquisitions == Acquisition);
    const uint64_t LowBytes = Batched.QueryMetrics().HeldBytes;
    Transport.SourceOffsets[1] = 2u;
    assert(!Batched.Capture(Scalar, Transport) && Batched.QueryMetrics().HeldBytes == LowBytes);
    Transport.SourceOffsets[1] = 1u;
    Transport.ChassisInverse[0] = std::numeric_limits<float>::quiet_NaN();
    assert(!Batched.Capture(Scalar, Transport) && Batched.QueryMetrics().HeldBytes == LowBytes);
    std::puts("PASS quiet transport/rapid restart reuses residency and malformed tick ranges/poses preserve the existing domain");

    Scalar.Extent = StepScalar.Extent = 0u;
    Require(Batched.Capture(Scalar, Transport), Batched.QueryRefusal());
    Require(Stepped.Capture(StepScalar, StepTransport), Stepped.QueryRefusal());
    assert(!Batched.Resident() && Batched.QueryMetrics().HeldBytes == 0u && Stepped.QueryMetrics().HeldBytes == 0u);
    Specification.FineExtent = 128u;
    Specification.CycleSlotCount = 2u;
    Frontier::SmokeExchange High;
    Require(High.Construct(Specification), High.QueryRefusal());
    ConstructReading(Scalar, Transport, Velocity, 733u);
    Transport.CompletedTicks = Transport.SourceCount = Transport.SourceOffsets[1] = 1u;
    Transport.Sources[0] = SourceAt(0u);
    Require(High.Capture(Scalar, Transport), High.QueryRefusal()); SubmitTransport(Device, High);
    const auto HighMetrics = High.QueryMetrics();
    assert(HighMetrics.HeldBytes < Specification.ByteAllowance);
    High.Reclaim(); assert(High.QueryMetrics().HeldBytes == 0u);
    Specification.FineExtent = 64u;
    Specification.ByteAllowance = 1u;
    Frontier::SmokeExchange Refused;
    Require(Refused.Construct(Specification), Refused.QueryRefusal());
    assert(!Refused.Capture(Scalar, Transport) && !Refused.Resident() && Refused.QueryMetrics().HeldBytes == 0u);
    std::puts("PASS measured 64/128 quality storage, no-demand zero allocation, explicit byte-ceiling refusal and completed retirement");

    std::ofstream Report(Output);
    Report << "{\n  \"passed\": true,\n  \"device\": \"" << Device.DeviceName << "\",\n  \"deviceClassification\": " << Device.DeviceClassification
           << ",\n  \"lowFineExtent\": 64,\n  \"highFineExtent\": 128,\n  \"lowHeldBytes\": " << LowBytes << ",\n  \"highHeldBytes\": " << HighMetrics.HeldBytes
           << ",\n  \"highTransportMilliseconds\": " << HighMetrics.TransportMilliseconds << ",\n  \"retainedTexels\": " << Preserved
           << ",\n  \"clearedTexels\": " << Cleared << ",\n  \"deviceAssertions\": 6,\n  \"releasedBytes\": 0\n}\n";
    return 0;
}
