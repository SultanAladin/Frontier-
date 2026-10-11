export const MaxTrafficVehicles = 25;

export function ClampTrafficVehicleCount(Value) {
  const Parsed = Number(Value);
  if (!Number.isFinite(Parsed)) return 0;
  return Math.max(0, Math.min(MaxTrafficVehicles, Math.floor(Parsed)));
}
