//============================================================================================================================================
//                                                         TYRETHERMALINTEGRATOR.JS
//============================================================================================================================================
// 🧩 Per-tyre tread, carcass and enclosed-gas heat, abrasion, sustained-overheat ignition and burst — a port of Frontier's ThermalIntegrator.h.

// 📝 Three heat capacities coupled by conductances and solved implicitly each advance: sliding work heats the tread,
//    the tread conducts into the carcass and on into the enclosed air, air and road carry heat away. Burning rubber
//    releases BurnRate·HeatOfCombustion, a share of it back into the tread, until the tread falls below
//    ExtinctionTemperature or the rubber is spent. The ThermalSpecification constants are Frontier's verbatim. The
//    enclosed volume is constant here — the point contact has no carcass deflection to drive the adiabatic gas work —
//    so the gas reading follows conduction only.
//
//    Three additions sit outside Frontier's specification, in AbrasionSpecification, and they are what make fire a
//    consequence of a long burnout rather than of a drift:
//
//    | Mechanism        | What it does                                                                               |
//    |------------------|--------------------------------------------------------------------------------------------|
//    | abrasion         | sliding work wears tread mass off, faster when the rubber is hot; the share that leaves as  |
//    |                  | smoke carries its pyrolysis heat away from the tread                                       |
//    | exhibit ignition | the exhibit passes 450 °C (723 K) as the ignition temperature — inside the 400–500 °C       |
//    |                  | autoignition range quoted for tyre rubber — where Frontier's specification says 350 °C      |
//    | burst            | a tread worn to nothing exposes the cords and the tyre lets go: a blowout leak empties it   |
//    |                  | in a fraction of a second; a puncture leaks slowly; the carcass sags with the pressure     |
//
//    Measured with a constant sliding power per tyre (Node, 60 Hz, 450 °C ignition): drifts of 40 kW on / 5 kW off
//    and 70 kW on / 10 kW off never ignite; a 100 kW burnout ignites after ~24 s and bursts at ~37 s; 150 kW ignites
//    at ~14 s and bursts at ~23 s. Before these additions a 30 kW slide caught fire in 19 s.

export const ThermalSpecification = Object.freeze({
    AmbientTemperature:        293.15,      // [K]
    RoadTemperature:           293.15,      // [K]
    SurfaceHeatCapacity:       1800.0,      // [J/K]    fast tread
    CarcassHeatCapacity:       14400.0,     // [J/K]    bulk rubber
    SurfaceCarcassConductance: 28.0,        // [W/K]
    CarcassGasConductance:     3.0,         // [W/K]
    SurfaceAirConductance:     12.0,        // [W/K]    stationary air
    CarcassAirConductance:     3.0,         // [W/K]
    RoadConductance:           18.0,        // [W/K]    contact cooling
    SlidingHeatShare:          0.75,        // [-]      sliding work entering rubber, the rest enters the road
    AirSpecificGasConstant:    287.05,      // [J/kg/K]
    AirSpecificHeat:           718.0,       // [J/kg/K] constant volume
    OptimumTemperature:        353.15,      // [K]
    GripFadeTemperature:       473.15,      // [K]
    MinimumGripFactor:         0.60,        // [-]
    IgnitionTemperature:       623.15,      // [K]
    IgnitionExposureSeconds:   4.0,         // [s]
    ExtinctionTemperature:     473.15,      // [K]
    CombustibleMass:           2.0,         // [kg]
    BurnRate:                  0.002,       // [kg/s]
    HeatOfCombustion:          30000000.0,  // [J/kg]
    CombustionHeatShare:       0.10,        // [-]      burn heat entering the tyre; the rest enters the plume
    EnclosedVolume:            0.045,       // [m³]     cold enclosed air
    GaugePressure:             220000.0,    // [Pa]
    AtmosphericPressure:       101325.0     // [Pa]
});

export const AbrasionSpecification = Object.freeze({
    TreadMass:          1.1,        // [kg]    wearable tread rubber per tyre
    WearCoefficient:    6.0e-8,     // [kg/J]  tread worn per joule of sliding work at the optimum temperature
    WearHeatSpan:       80.0,       // [K]     each span above the optimum adds the cold wear rate again
    VapourShare:        0.55,       // [-]     worn rubber that leaves as smoke rather than as crumbs
    PyrolysisHeat:      1.6e6,      // [J/kg]  carried away by the vapourised share
    BlowoutRate:        30.0,       // [1/s]   the air's escape when the tread lets go
    PunctureRate:       0.035,      // [1/s]   a nail: half the pressure in about twenty seconds
});

// 📝 A fresh tyre at ambient temperature, inflated cold to ColdPressure [Pa gauge].
export function ConstructThermal(Specification = ThermalSpecification, ColdPressure = Specification.GaugePressure)
{
    const Temperature = Specification.AmbientTemperature;
    const AirMass = (ColdPressure + Specification.AtmosphericPressure) * Specification.EnclosedVolume
                  / (Specification.AirSpecificGasConstant * Temperature);
    return {
        SurfaceTemperature: Temperature, CarcassTemperature: Temperature, GasTemperature: Temperature,
        ReferenceTemperature: Temperature, AirMass, GaugePressure: ColdPressure, LeakRate: 0.0,
        GripFactor: 1.0, SlidingPower: 0.0, CombustionPower: 0.0, RemainingRubber: Specification.CombustibleMass,
        OverheatExposure: 0.0, Ignited: false,
        TreadMass: AbrasionSpecification.TreadMass, WearRate: 0.0, VapourRate: 0.0, Burst: false, BurstPending: false
    };
}

// 📐 Backward-Euler over the three capacities: (C/Δτ + ΣG)·T⁺ − ΣG·T⁺_n = C/Δτ·T + Q, a 3×3 system solved by
//    Gauss–Jordan exactly as IntegrateThermal() does.
//    Options: { HeatGain, ExposureSeconds, IgnitionEnabled, IgnitionTemperature, WearEnabled, WearScale }.
export function IntegrateThermal(Reading, Contact, Seconds, Options = {}, Specification = ThermalSpecification)
{
    if (!(Seconds > 0.0) || !Number.isFinite(Contact.SlidingPower))
        return Reading;
    const HeatGain        = Options.HeatGain ?? 1.0;
    const Exposure        = Options.ExposureSeconds ?? Specification.IgnitionExposureSeconds;
    const IgnitionEnabled = Options.IgnitionEnabled ?? true;
    const Ignition        = Options.IgnitionTemperature ?? Specification.IgnitionTemperature;
    const WearEnabled     = Options.WearEnabled ?? true;
    const WearScale       = Options.WearScale ?? 1.0;
    Reading.SlidingPower = Contact.InContact ? Math.max(0.0, Contact.SlidingPower) : 0.0;
    Reading.CombustionPower = 0.0;
    const GasCapacity = Reading.AirMass * Specification.AirSpecificHeat;
    const Capacity = [Specification.SurfaceHeatCapacity, Specification.CarcassHeatCapacity, GasCapacity];
    const Temperatures = [Reading.SurfaceTemperature, Reading.CarcassTemperature, Reading.GasTemperature];

    // ① abrasion: hot rubber wears faster; the vapourised share is the smoke, and it takes its pyrolysis heat along
    const Abrasion = AbrasionSpecification;
    const HeatFactor = 1.0 + Math.max(0.0, Temperatures[0] - Specification.OptimumTemperature) / Abrasion.WearHeatSpan;
    Reading.WearRate = WearEnabled && !Reading.Burst && Reading.TreadMass > 0.0 ? Abrasion.WearCoefficient * WearScale * Reading.SlidingPower * HeatFactor : 0.0;
    const Worn = Math.min(Reading.TreadMass, Reading.WearRate * Seconds);
    Reading.TreadMass -= Worn;
    Reading.VapourRate = Worn * Abrasion.VapourShare / Seconds;
    const VapourHeat = Worn * Abrasion.VapourShare * Abrasion.PyrolysisHeat;
    if (WearEnabled && !Reading.Burst && Reading.TreadMass <= 0.0)
    {
        Reading.Burst = true;
        Reading.BurstPending = true;
        Reading.LeakRate = Abrasion.BlowoutRate;
    }

    // ② ignition: the tread held past the ignition temperature for the exposure
    if (IgnitionEnabled && Temperatures[0] >= Ignition)
        Reading.OverheatExposure += Seconds;
    else
        Reading.OverheatExposure = 0.0;
    if (IgnitionEnabled && Reading.RemainingRubber > 0.0 && Reading.OverheatExposure >= Exposure)
        Reading.Ignited = true;
    if (!IgnitionEnabled || Reading.RemainingRubber <= 0.0 || Temperatures[0] < Specification.ExtinctionTemperature)
        Reading.Ignited = false;
    if (Reading.Ignited)
    {
        const Burned = Math.min(Reading.RemainingRubber, Specification.BurnRate * Seconds);
        Reading.RemainingRubber -= Burned;
        Reading.CombustionPower = Burned * Specification.HeatOfCombustion / Seconds;
    }

    // ③ the three-capacity heat balance
    // 📝 A burst tyre slides on its rim: the rim and the road take the sliding work, the rubber only a little of it.
    const RubberShare = Reading.Burst ? 0.15 : 1.0;
    const SlidingHeat = Math.max(0.0, Reading.SlidingPower * Specification.SlidingHeatShare * HeatGain * RubberShare * Seconds - VapourHeat);
    const BurnHeat = Reading.CombustionPower * Specification.CombustionHeatShare * Seconds;
    const AirFactor = 1.0 + 0.35 * Math.sqrt(Math.max(0.0, Contact.Airspeed));
    const AirSurface = Specification.SurfaceAirConductance * AirFactor;
    const AirCarcass = Specification.CarcassAirConductance * AirFactor;
    const Road = Contact.InContact ? Specification.RoadConductance : 0.0;
    const SurfaceCarcass = Specification.SurfaceCarcassConductance;
    const CarcassGas = Specification.CarcassGasConductance;
    const Equations = [
        [Capacity[0] / Seconds + AirSurface + Road + SurfaceCarcass, -SurfaceCarcass, 0.0,
         Capacity[0] * Temperatures[0] / Seconds + (SlidingHeat + BurnHeat) / Seconds
         + AirSurface * Specification.AmbientTemperature + Road * Specification.RoadTemperature],
        [-SurfaceCarcass, Capacity[1] / Seconds + AirCarcass + SurfaceCarcass + CarcassGas, -CarcassGas,
         Capacity[1] * Temperatures[1] / Seconds + AirCarcass * Specification.AmbientTemperature],
        [0.0, -CarcassGas, Capacity[2] / Seconds + CarcassGas, Capacity[2] * Temperatures[2] / Seconds]
    ];
    for (let Pivot = 0; Pivot < 3; ++Pivot)
    {
        const Diagonal = Equations[Pivot][Pivot];
        for (let Column = Pivot; Column < 4; ++Column)
            Equations[Pivot][Column] /= Diagonal;
        for (let Row = 0; Row < 3; ++Row)
        {
            if (Row === Pivot)
                continue;
            const Factor = Equations[Row][Pivot];
            for (let Column = Pivot; Column < 4; ++Column)
                Equations[Row][Column] -= Factor * Equations[Pivot][Column];
        }
    }
    Reading.SurfaceTemperature = Equations[0][3];
    Reading.CarcassTemperature = Equations[1][3];
    Reading.GasTemperature     = Equations[2][3];
    // 📝 A leak bleeds the air toward the mass that would sit at atmospheric pressure at this gas temperature, so
    //    the gauge pressure decays to nothing and stays there.
    if (Reading.LeakRate > 0.0)
    {
        const Settled = Specification.AtmosphericPressure * Specification.EnclosedVolume / (Specification.AirSpecificGasConstant * Reading.GasTemperature);
        Reading.AirMass = Settled + (Reading.AirMass - Settled) * Math.exp(-Reading.LeakRate * Seconds);
    }
    Reading.GaugePressure = Math.max(0.0, Reading.AirMass * Specification.AirSpecificGasConstant * Reading.GasTemperature
                                                                   / Specification.EnclosedVolume - Specification.AtmosphericPressure);
    const Hot = Math.min(1.0, Math.max(0.0, (Reading.SurfaceTemperature - Specification.OptimumTemperature)
                                          / (Specification.GripFadeTemperature - Specification.OptimumTemperature)));
    const PressureDeviation = Math.abs(Reading.GaugePressure - Specification.GaugePressure) / Math.max(1000.0, Specification.GaugePressure);
    Reading.GripFactor = (1.0 - Hot * (1.0 - Specification.MinimumGripFactor)) * Math.max(0.25, 1.0 - 0.30 * Math.min(PressureDeviation, 1.0));
    return Reading;
}

// 🔍 The panel's "heat rear tyres to ignition": a tread past the given ignition temperature, exposure met.
export function ForceIgnition(Reading, IgnitionTemperature = ThermalSpecification.IgnitionTemperature, Specification = ThermalSpecification)
{
    Reading.SurfaceTemperature = IgnitionTemperature + 60.0;
    Reading.CarcassTemperature = Math.max(Reading.CarcassTemperature, 420.0);
    Reading.OverheatExposure   = 1.0e3;
    Reading.RemainingRubber    = Math.max(Reading.RemainingRubber, 0.5 * Specification.CombustibleMass);
    return Reading;
}

// 📝 Tread remaining as a fraction of a new tyre, for the readouts.
export function ResolveTreadFraction(Reading)
{
    return Math.max(0.0, Reading.TreadMass / AbrasionSpecification.TreadMass);
}
