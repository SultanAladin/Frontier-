//============================================================================================================================================
//                                                              SMOKEMETRICS.CPP
//============================================================================================================================================
// 📦 Executed thermal-balance, pressure, exact-world relocation and on-demand smoke lifetime measurements.

#include "../../Engine/PhysicalDynamics/Vehicle/ThermalIntegrator.h"
#include "../../Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.h"
#include "../../Engine/VolumetricDynamics/SmokeSequence.h"
#include "../../Engine/VolumetricDynamics/GasVehicleIntake.h"
#include "../../Engine/VolumetricDynamics/SmokeOnsetClassifier.h"
#include "../../Engine/Host/SmokeSequence.h"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <limits>

using namespace Frontier;
using namespace Frontier::Vehicle;

int main()
{
    SmokeSpecification OnsetTuning;
    SmokeOnsetMetrics Onset;
    for (uint32_t Tick = 0u; Tick < 11u; ++Tick)
        assert(!AdvanceSmokeOnset(Onset, 1000.0, 3.0, true, 1.0f / 240.0f, OnsetTuning));
    assert(AdvanceSmokeOnset(Onset, 1000.0, 3.0, true, 1.0f / 240.0f, OnsetTuning));
    assert(AdvanceSmokeOnset(Onset, 160.0, 3.0, true, 1.0f / 240.0f, OnsetTuning));
    assert(!AdvanceSmokeOnset(Onset, 1000.0, 3.0, false, 1.0f / 240.0f, OnsetTuning));
    for (uint32_t Tick = 0u; Tick < 64u; ++Tick)
        assert(!AdvanceSmokeOnset(Onset, 0.0, 0.0, true, 1.0f / 240.0f, OnsetTuning));
    std::puts("PASS sustained sliding onset, lower release threshold, immediate airborne exclusion and no-slip quiet gating");

    ThermalSpecification Tuning;
    Tuning.Enabled = true;
    ThermalMetrics Heated, Cold;
    assert(ConstructThermal(Heated, Tuning, 0.08, 240000.0, 101325.0));
    assert(ConstructThermal(Cold, Tuning, 0.08, 240000.0, 101325.0));
    ThermalContact Contact;
    Contact.Volume = 0.08;
    Contact.InContact = true;
    Contact.SlidingPower = 30000.0;
    for (uint32_t Tick = 0u; Tick < 2400u; ++Tick)
    {
        assert(IntegrateThermal(Heated, Tuning, Contact, 1.0 / 240.0));
        ThermalContact Holding; Holding.Volume = 0.08; Holding.InContact = true;
        assert(IntegrateThermal(Cold, Tuning, Holding, 1.0 / 240.0));
    }
    assert(Heated.SurfaceTemperature > Heated.CarcassTemperature && Heated.CarcassTemperature > Heated.GasTemperature);
    assert(Heated.SurfaceTemperature > Tuning.AmbientTemperature + 50.0);
    assert(std::abs(Cold.SurfaceTemperature - Tuning.AmbientTemperature) < 1.0e-8);
    assert(std::abs(Heated.EnergyResidualJoules) < 0.0001);
    assert(Heated.GaugePressure > Cold.GaugePressure);
    std::printf("PASS sliding heat, three thermal lags, independent wheels and thermal balance: tread %.2f C, carcass %.2f C, gas %.2f C, residual %.9f J\n",
        Heated.SurfaceTemperature - 273.15, Heated.CarcassTemperature - 273.15, Heated.GasTemperature - 273.15, Heated.EnergyResidualJoules);

    const auto Previous = Heated;
    Contact.Volume = std::numeric_limits<double>::quiet_NaN();
    assert(!IntegrateThermal(Heated, Tuning, Contact, 1.0 / 240.0));
    assert(Heated.SurfaceTemperature == Previous.SurfaceTemperature && Heated.GasTemperature == Previous.GasTemperature);
    Contact.Volume = 0.04;
    Contact.InContact = false;
    Contact.SlidingPower = 100000.0;
    assert(IntegrateThermal(Heated, Tuning, Contact, 1.0 / 240.0));
    assert(Heated.SlidingPower == 0.0);
    assert(Heated.GasTemperature > Previous.GasTemperature);
    assert(Heated.GaugePressure > Previous.GaugePressure * 2.0);
    assert(std::abs(Heated.EnergyResidualJoules) < 0.0001);
    std::puts("PASS adiabatic gas work, pressure response, airborne friction exclusion and transactional input refusal");

    SoftTyreParameters Parameters;
    Parameters.RingCount = 3u; Parameters.SegmentCount = 24u;
    XPBDSoftTyre Tyre;
    Tyre.Build(Parameters, {}, {});
    const auto* Particles = Tyre.Nodes().data();
    const float RestVolume = Tyre.RestVolume();
    assert(Tyre.ResolveGasTemperature(350.0f, 293.15f));
    assert(!Tyre.ResolveGasTemperature(std::numeric_limits<float>::quiet_NaN(), 293.15f));
    Tyre.Step(1.0f / 240.0f, 8u, Vec3{}, Quat{}, {}, {});
    assert(Tyre.Nodes().data() == Particles && Tyre.RestVolume() == RestVolume);
    assert(Tyre.Reaction().GaugePressure > Parameters.InflationPressure);
    std::puts("PASS hot gas feeds actual XPBD pressure without rebuilding particles or rest geometry");

    ThermalSpecification ProductionFire = Tuning;
    ProductionFire.IgnitionEnabled = true;
    ThermalMetrics ProductionBurning;
    assert(ConstructThermal(ProductionBurning, ProductionFire, 0.08, 240000.0, 101325.0));
    ThermalContact SustainedOverheat;
    SustainedOverheat.Volume = 0.08;
    SustainedOverheat.InContact = true;
    SustainedOverheat.SlidingPower = 300000.0;
    for (uint32_t Tick = 0u; Tick < 4800u; ++Tick)
        assert(IntegrateThermal(ProductionBurning, ProductionFire, SustainedOverheat, 1.0 / 240.0));
    assert(ProductionFire.IgnitionTemperature == 623.15 && ProductionFire.IgnitionExposureSeconds == 4.0);
    assert(ProductionBurning.Ignited && ProductionBurning.RemainingRubber < ProductionFire.CombustibleMass);
    std::puts("PASS untouched production ignition threshold/exposure under sustained sliding heat, with finite fuel consumption");

    ThermalSpecification Fire = Tuning;
    Fire.SurfaceHeatCapacity = 100.0;
    Fire.SurfaceAirConductance = Fire.CarcassAirConductance = Fire.RoadConductance = 0.0;
    Fire.SurfaceCarcassConductance = Fire.CarcassGasConductance = 0.0;
    Fire.IgnitionEnabled = true;
    Fire.IgnitionTemperature = 320.0; Fire.IgnitionExposureSeconds = 0.2; Fire.ExtinctionTemperature = 310.0;
    ThermalMetrics Burning;
    assert(ConstructThermal(Burning, Fire, 0.08, 240000.0, 101325.0));
    ThermalContact BurnContact; BurnContact.Volume = 0.08; BurnContact.InContact = true; BurnContact.SlidingPower = 16000.0;
    for (uint32_t Tick = 0u; Tick < 120u; ++Tick) assert(IntegrateThermal(Burning, Fire, BurnContact, 1.0 / 240.0));
    assert(Burning.Ignited && Burning.RemainingRubber < Fire.CombustibleMass);
    BurnContact.InContact = false;
    assert(IntegrateThermal(Burning, Fire, BurnContact, 1.0 / 240.0));
    assert(Burning.Ignited && Burning.CombustionPower > 0.0 && Burning.SlidingPower == 0.0);
    std::puts("PASS sustained-overheat ignition and fuel consumption; ignited airborne tyre can keep burning (low-threshold diagnostic fixture)");

    CoarseGasField Field;
    const float Origin[3] = {-8.0f, -8.0f, -8.0f};
    ResetField(Field, Origin, 16.0f);
    const uint32_t Original = VoxelIndex(13u, 18u, 15u);
    Field.Smoke[Original] = 0.7f; Field.Temperature[Original] = 2.5f;
    Field.VelocityX[Original] = 1.25f; Field.VelocityY[Original] = -2.0f; Field.VelocityZ[Original] = 0.5f;
    Field.Occupancy[Original] = 1.0f; Field.AdvanceNumber = 99u;
    const float World[3] = {Origin[0] + 13.5f * 0.5f, Origin[1] + 18.5f * 0.5f, Origin[2] + 15.5f * 0.5f};
    const int32_t Shift[3] = {3, -2, 1};
    SmokeRelocationMetrics Relocation;
    assert(RelocateSmoke(Field, Shift, Relocation));
    const uint32_t Moved = VoxelIndex(10u, 20u, 14u);
    assert(Field.Smoke[Moved] == 0.7f && Field.Temperature[Moved] == 2.5f);
    assert(Field.VelocityX[Moved] == 1.25f && Field.VelocityY[Moved] == -2.0f && Field.VelocityZ[Moved] == 0.5f);
    assert(Field.Occupancy[Moved] == 0.0f && Field.AdvanceNumber == 99u);
    assert(Field.Origin[0] + 10.5f * 0.5f == World[0]);
    assert(Field.Origin[1] + 20.5f * 0.5f == World[1]);
    assert(Field.Origin[2] + 14.5f * 0.5f == World[2]);
    assert(Relocation.RetainedVoxels == 29u * 30u * 31u);
    assert(Relocation.ExposedVoxels + Relocation.RetainedVoxels == CoarseVoxelCount);
    assert(Field.Smoke[VoxelIndex(31u, 0u, 31u)] == 0.0f);
    const float Placement[3] = {0.0f, 0.0f, 0.0f};
    int32_t Interior[3];
    assert(ResolveSmokeShift(Field, Placement, 4u, Interior));
    assert(Interior[0] == 0 && Interior[1] == 0 && Interior[2] == 0);
    std::puts("PASS exact density, temperature and WORLD velocity preservation over three-axis integer shifts; obstruction invalidated, noise clock retained");

    Frontier::SmokeSequence Cloud;
    SmokeSpecification Smoke;
    Smoke.Span = 16.0f;
    assert(Cloud.Integrate(Smoke, nullptr, 0u, Placement));
    assert(!Cloud.QueryField() && Cloud.QueryMetrics().Acquisitions == 0u);
    GasEmission Emission;
    Emission.Position[2] = 0.5f; Emission.Radius = 0.5f; Emission.SmokeRate = 40.0f;
    assert(Cloud.Integrate(Smoke, &Emission, 1u, Placement));
    assert(Cloud.QueryField() && Cloud.QueryMetrics().Acquisitions == 1u);
    const auto* Resident = Cloud.QueryField();
    assert(Cloud.QueryMetrics().PeakDensity > 0.0f);
    assert(Cloud.Integrate(Smoke, nullptr, 0u, Placement));
    assert(Cloud.QueryField() == Resident && Cloud.QueryMetrics().ActiveSources == 0u);
    assert(Cloud.Integrate(Smoke, &Emission, 1u, Placement));
    assert(Cloud.QueryMetrics().Acquisitions == 1u);
    SmokeSpecification Changed = Smoke; Changed.Span *= 2.0f;
    assert(!Cloud.Integrate(Changed, nullptr, 0u, Placement));
    assert(Cloud.QueryField() == Resident && Cloud.QueryMetrics().Refused);
    Cloud.Reclaim();
    assert(!Cloud.QueryField() && Cloud.QueryMetrics().Retirements == 1u);
    std::puts("PASS on-demand acquisition, lingering plume, stop/start reuse, refused live resize and explicit release");
    SmokeSpecification InvalidSmoke = Smoke;
    InvalidSmoke.FadeCeiling = std::numeric_limits<float>::quiet_NaN();
    assert(!Cloud.Integrate(InvalidSmoke, &Emission, 1u, Placement));
    assert(!Cloud.QueryField());
    ThermalSpecification InvalidThermal = Tuning;
    InvalidThermal.SurfaceHeatCapacity = std::numeric_limits<double>::quiet_NaN();
    assert(!ConstructThermal(Heated, InvalidThermal, 0.08, 240000.0, 101325.0));
    assert(Heated.SurfaceTemperature > 0.0);
    assert(Cloud.Integrate(Smoke, &Emission, 1u, Placement));
    const float SavedOrigin[3] = {Cloud.QueryField()->Origin[0], Cloud.QueryField()->Origin[1], Cloud.QueryField()->Origin[2]};
    const float FarAway[3] = {1000.0f, -1000.0f, 1000.0f};
    assert(Cloud.Integrate(Smoke, nullptr, 0u, FarAway));
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis) assert(Cloud.QueryField()->Origin[Axis] == SavedOrigin[Axis]);
    for (uint32_t Tick = 0u; Tick < 750u && Cloud.QueryField(); ++Tick)
        assert(Cloud.Integrate(Smoke, nullptr, 0u, FarAway));
    assert(!Cloud.QueryField());
    GasEmission Heat;
    Heat.SmokeRate = 0.0f; Heat.TemperatureRate = 200.0f; Heat.Position[2] = 0.5f;
    assert(Cloud.Integrate(Smoke, &Heat, 1u, Placement));
    assert(Cloud.QueryMetrics().PeakDensity == 0.0f && Cloud.QueryMetrics().PeakTemperature > 0.05f);
    assert(Cloud.Integrate(Smoke, nullptr, 0u, FarAway));
    assert(Cloud.QueryField());
    std::puts("PASS quiet plume freezes world bounds, fades before release, retains heat-only volume and refuses nonfinite tuning");

    VehicleTelemetry Telemetry;
    Telemetry.WheelCount = 1u;
    auto& Wheel = Telemetry.Wheels[0];
    Wheel.Thermal.Valid = true;
    Wheel.InContact = true;
    Wheel.SlipVelocity = {0.0f, 3.0f, 0.0f};
    Wheel.Thermal.SlidingPower = 6000.0;
    auto Drift = ResolveWheelSmoke(Telemetry, 0u, Smoke);
    assert(Drift.SmokeRate > 0.0f && Drift.IncandescenceRate == 0.0f);
    Wheel.InContact = false;
    Drift = ResolveWheelSmoke(Telemetry, 0u, Smoke);
    assert(Drift.SmokeRate == 0.0f);
    Wheel.Thermal.Ignited = true; Wheel.Thermal.CombustionPower = 10000.0;
    Drift = ResolveWheelSmoke(Telemetry, 0u, Smoke);
    assert(Drift.SmokeRate > 0.0f && Drift.TemperatureRate > 0.0f && Drift.IncandescenceRate > 0.0f);
    Wheel.InContact = true; Wheel.Thermal.Ignited = false; Wheel.Thermal.CombustionPower = 0.0;
    Wheel.SlipVelocity = {};
    assert(ResolveWheelSmoke(Telemetry, 0u, Smoke).SmokeRate == 0.0f);
    std::puts("PASS lateral-only wheel source, airborne friction exclusion, airborne combustion and no-slip support exclusion");

    Frontier::HostRuntime::SmokeSequence Publication;
    std::string Refusal;
    uint32_t Copies = 0u;
    bool Corrupt = false;
    const auto Publish = [&](FrontierProjectSmokeReading& Reading)
    {
        Reading.Extent = 32u; Reading.CarrierIdentifier = 1u; Reading.Revision = Corrupt ? 2u : 1u;
        Reading.Span = 16.0f;
        if (Reading.Capacity)
        {
            ++Copies;
            std::fill_n(Reading.Density, Reading.Capacity, 0.25f);
            std::fill_n(Reading.Temperature, Reading.Capacity, 1.0f);
            if (Corrupt) Reading.Density[0] = std::numeric_limits<float>::quiet_NaN();
        }
        return 1u;
    };
    assert(Publication.QueryDensity().empty());
    assert(Publication.Capture(Publish, Refusal));
    assert(Copies == 1u && Publication.QueryDensity()[0] == 0.25f);
    assert(Publication.QueryReading().Density == nullptr && Publication.QueryReading().Temperature == nullptr);
    assert(Publication.Capture(Publish, Refusal) && Copies == 1u);
    Corrupt = true;
    assert(!Publication.Capture(Publish, Refusal) && !Refusal.empty());
    assert(Publication.QueryReading().Revision == 1u && Publication.QueryDensity()[0] == 0.25f);
    Publication.Reclaim();
    assert(Publication.QueryDensity().empty() && Publication.QueryReading().Extent == 0u);
    std::puts("PASS host-owned on-demand C snapshot copying, paused revision reuse and transactional malformed-payload refusal");

}
