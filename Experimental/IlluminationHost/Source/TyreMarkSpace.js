//============================================================================================================================================
//                                                             TYREMARKSPACE.JS
//============================================================================================================================================
// 🧩 Rubber laid down by sliding tyres: a deposit texel space over the pad, written by capsule strokes and uploaded by dirty rectangle.

// 📝 Each sliding tyre strokes a capsule from where its contact patch was last frame to where it is now, as wide as
//    the tread, into a 2048² r8 texel space over the pad (6.25 cm a texel). Each stroke adds a share of what is left
//    to darken — Strength · (0.25 + 1.8 · Δτ) — so a drifting tyre passing once leaves a grey streak and a burnout
//    standing on one spot lays black rubber in about a second. A burst rim scratches a thin, faint line. Only the
//    rectangle touched since the last upload goes to the device; the surface raster samples it on the asphalt, the
//    apron and the paint and darkens the albedo it writes.

export const MarkLayout = Object.freeze({
    Minimum: -64.0,   // [m]  world x and y of texel (0, 0)
    Extent:  128.0,   // [m]  world span of the texel space
    Texels:  2048     // [-]  per axis
});

const SlidingPowerFloor = 1500.0;    // [W]
const SlipSpeedFloor    = 0.8;       // [m/s]
const StrengthPower     = 55000.0;   // [W]   sliding power that lays full-strength rubber
const TreadWidth        = 0.27;      // [m]
const RimWidth          = 0.08;      // [m]

export class TyreMarkSpace
{
    constructor(Exchange)
    {
        this.Exchange = Exchange;
        const Edge = MarkLayout.Texels;
        this.Texels = new Uint8Array(Edge * Edge);
        this.Prior = [null, null, null, null];
        this.Dirty = null;
        this.Strokes = 0;
        this.Texture = Exchange.ConstructTexture({ label: "Tyre marks", size: [Edge, Edge], format: "r8unorm",
                                                   usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        this.View = this.Texture.createView();
        this.Sampler = Exchange.ConstructSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
        this.Upload(true);
    }

    // 📝 Wheels: the plume telemetry's wheels. Scale: the editor's rubber amount (0 stops marking).
    Deposit(Wheels, Seconds, Scale = 1.0)
    {
        Wheels.forEach((Wheel, Index) =>
        {
            const Sliding = Wheel.InContact && Wheel.SlidingPower > SlidingPowerFloor && Wheel.SlipSpeed > SlipSpeedFloor && Scale > 0.0;
            if (!Sliding)
            {
                this.Prior[Index] = null;
                return;
            }
            const Point = [Wheel.ContactPoint[0], Wheel.ContactPoint[1]];
            const Strength = Math.min(1.0, Wheel.SlidingPower / StrengthPower) * Scale * (Wheel.Burst ? 0.35 : 1.0);
            const From = this.Prior[Index] || Point;
            this.Stroke(From, Point, Wheel.Burst ? RimWidth : TreadWidth, Math.min(0.9, Strength * (0.25 + 1.8 * Seconds)));
            this.Prior[Index] = Point;
        });
    }

    // 📝 A capsule of the given width from From to To: every texel within half a width of the segment gains Amount of
    //    the darkening left, feathered over the outer quarter so the streak has soft edges.
    Stroke(From, To, Width, Amount)
    {
        const Edge = MarkLayout.Texels, Scale = Edge / MarkLayout.Extent;
        const Ax = (From[0] - MarkLayout.Minimum) * Scale, Ay = (From[1] - MarkLayout.Minimum) * Scale;
        const Bx = (To[0] - MarkLayout.Minimum) * Scale, By = (To[1] - MarkLayout.Minimum) * Scale;
        const Half = 0.5 * Width * Scale;
        const MinimumX = Math.max(0, Math.floor(Math.min(Ax, Bx) - Half)), MaximumX = Math.min(Edge - 1, Math.ceil(Math.max(Ax, Bx) + Half));
        const MinimumY = Math.max(0, Math.floor(Math.min(Ay, By) - Half)), MaximumY = Math.min(Edge - 1, Math.ceil(Math.max(Ay, By) + Half));
        if (MinimumX > MaximumX || MinimumY > MaximumY)
            return;
        const Dx = Bx - Ax, Dy = By - Ay, LengthSquared = Dx * Dx + Dy * Dy;
        for (let Y = MinimumY; Y <= MaximumY; ++Y)
        {
            for (let X = MinimumX; X <= MaximumX; ++X)
            {
                const Px = X + 0.5 - Ax, Py = Y + 0.5 - Ay;
                const Along = LengthSquared > 1.0e-9 ? Math.min(1.0, Math.max(0.0, (Px * Dx + Py * Dy) / LengthSquared)) : 0.0;
                const Distance = Math.hypot(Px - Along * Dx, Py - Along * Dy);
                if (Distance > Half)
                    continue;
                const Feather = Math.min(1.0, (Half - Distance) / Math.max(0.25 * Half, 0.5));
                const Offset = Y * Edge + X;
                const Current = this.Texels[Offset];
                this.Texels[Offset] = Math.min(255, Current + Math.round((255 - Current) * Amount * Feather));
            }
        }
        this.Strokes++;
        if (!this.Dirty)
            this.Dirty = { MinimumX, MinimumY, MaximumX, MaximumY };
        else
        {
            this.Dirty.MinimumX = Math.min(this.Dirty.MinimumX, MinimumX);
            this.Dirty.MinimumY = Math.min(this.Dirty.MinimumY, MinimumY);
            this.Dirty.MaximumX = Math.max(this.Dirty.MaximumX, MaximumX);
            this.Dirty.MaximumY = Math.max(this.Dirty.MaximumY, MaximumY);
        }
    }

    // 📝 Sends the touched rectangle (or everything) to the device.
    Upload(Everything = false)
    {
        const Edge = MarkLayout.Texels;
        const Region = Everything ? { MinimumX: 0, MinimumY: 0, MaximumX: Edge - 1, MaximumY: Edge - 1 } : this.Dirty;
        if (!Region)
            return;
        const Width = Region.MaximumX - Region.MinimumX + 1, Height = Region.MaximumY - Region.MinimumY + 1;
        const Rows = new Uint8Array(Width * Height);
        for (let Row = 0; Row < Height; ++Row)
        {
            const Start = (Region.MinimumY + Row) * Edge + Region.MinimumX;
            Rows.set(this.Texels.subarray(Start, Start + Width), Row * Width);
        }
        this.Exchange.Device.queue.writeTexture({ texture: this.Texture, origin: [Region.MinimumX, Region.MinimumY] }, Rows,
                                                { bytesPerRow: Width, rowsPerImage: Height }, [Width, Height]);
        this.Dirty = null;
    }

    Clear()
    {
        this.Texels.fill(0);
        this.Prior = [null, null, null, null];
        this.Strokes = 0;
        this.Upload(true);
    }
}
