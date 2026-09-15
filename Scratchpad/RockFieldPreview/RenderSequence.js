//============================================================================================================================================
// 📦 Frontier/Scratchpad/RockFieldPreview/RenderSequence.js — WebGL2 Sphere Tracing Preview of the Geologic Rock Field
//============================================================================================================================================
//
// Loads Shaders/RockFieldSpace.glsl verbatim — the same text the C++ proof renderer compiles — and wraps it in a
// fragment shader. Nothing about the geology lives here; this file only supplies a camera, a tracer and shading.
//
//============================================================================================================================================

const LITHOLOGY_NAMES = ["Granite", "Sandstone", "Basalt", "Limestone", "Schist"];

const TRACE_PRELUDE = `#version 300 es
precision highp float;
precision highp int;

out vec4 FragmentColour;

uniform vec2  ViewportExtent;      // [px] render target size
uniform vec3  CameraEye;           // [m] camera position
uniform vec3  CameraFocus;         // [m] look at target
uniform float CameraZoom;          // [-] focal multiplier
uniform int   LithologyIndex;      // [-] active preset
uniform float SeedValue;           // [-] variation selector
uniform float SunAzimuth;          // [rad] sun bearing
uniform float SunElevation;        // [rad] sun altitude
uniform int   ShadingMode;         // [-] 0 shaded, 1 normals, 2 step heat, 3 material fields
uniform int   MaxSteps;            // [count] tracer iteration budget
uniform float DetailScale;         // [-] global relief multiplier
uniform float WeatheringOverride;  // [0..1] negative means use the preset value
uniform float TafoniOverride;      // [0..1] negative means use the preset value
uniform int   EditActiveCount;     // [count] live sculpt strokes
uniform vec4  EditOrigins[24];     // [m] xyz origin, w radius
uniform vec4  EditVectors[24];     // [-] xyz direction, w strength
uniform vec4  EditProperties[24];  // [-] x hardness, y category
`;

const TRACE_BODY = `
//------------------------------------------------------------------------------------------------------------------------
//                                                  CONFIGURATION SETUP
//------------------------------------------------------------------------------------------------------------------------

void ConfigureRock()
{
    RockShape = RockPreset(LithologyIndex, SeedValue);

    if (WeatheringOverride >= 0.0)
    {
        RockShape.WeatheringGrade = WeatheringOverride;
    }
    if (TafoniOverride >= 0.0)
    {
        RockShape.TafoniIntensity = TafoniOverride;
    }

    RockShape.RoughnessAmplitude *= DetailScale;
    RockShape.GrainRelief *= DetailScale;

    RockShape.EditCount = EditActiveCount;
    for (int Index = 0; Index < ROCK_EDIT_CAPACITY; ++Index)
    {
        if (Index >= EditActiveCount)
        {
            break;
        }
        RockEditRecord Edit;
        Edit.Origin = EditOrigins[Index].xyz;
        Edit.Radius = EditOrigins[Index].w;
        Edit.Direction = EditVectors[Index].xyz;
        Edit.Strength = EditVectors[Index].w;
        Edit.Hardness = EditProperties[Index].x;
        Edit.Category = int(EditProperties[Index].y);
        RockShape.Edits[Index] = Edit;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SPHERE TRACER
//------------------------------------------------------------------------------------------------------------------------

float PixelFootprint(float Travel, float ConeAngle)
{
    return max(Travel * ConeAngle, 1e-4);
}

struct TraceRecord
{
    bool  Struck;
    float Travel;
    int   Steps;
    vec3  Location;
};

TraceRecord TraceRock(vec3 Origin, vec3 Direction, float ConeAngle, float FarLimit)
{
    // Mirrors Scratchpad/RockFieldProof exactly: a coarse phase that marches the jointed body minus the outward
    // detail amplitude, then a fine phase that resolves the displaced field with its strict gradient bound.
    TraceRecord Record;
    Record.Struck = false;
    Record.Travel = 0.0;
    Record.Steps = 0;
    Record.Location = Origin;

    float Travel = 0.0;

    for (int Step = 0; Step < 1024; ++Step)
    {
        if (Step >= MaxSteps)
        {
            break;
        }
        Record.Steps = Step;

        vec3 Sample = Origin + Direction * Travel;
        float Footprint = PixelFootprint(Travel, ConeAngle);

        float Coarse = RockCoarseDistance(Sample);
        float Shell = RockDetailAmplitude(Footprint);
        if (Coarse - Shell > Footprint)
        {
            Travel += max((Coarse - Shell) / max(RockCoarseLipschitz, 1.0), 1e-4);
            if (Travel > FarLimit)
            {
                break;
            }
            continue;
        }

        float Field = RockFieldDistance(Sample, Footprint);
        if (Field < Footprint * 0.5)
        {
            Record.Struck = true;
            Record.Travel = Travel;
            Record.Location = Sample;
            return Record;
        }

        // Field is already in hand and RockLipschitz still describes this sample, so normalise it directly rather
        // than paying for a second full evaluation of the same point.
        Travel += max(RockNormaliseStep(Field), Footprint * 0.12);
        if (Travel > FarLimit)
        {
            break;
        }
    }
    Record.Travel = Travel;
    return Record;
}

vec3 RockNormal(vec3 Position, float Footprint)
{
    float Epsilon = max(Footprint * 0.6, 4e-4);
    float Dx = RockFieldDistance(Position + vec3(Epsilon, 0.0, 0.0), Footprint)
             - RockFieldDistance(Position - vec3(Epsilon, 0.0, 0.0), Footprint);
    float Dy = RockFieldDistance(Position + vec3(0.0, Epsilon, 0.0), Footprint)
             - RockFieldDistance(Position - vec3(0.0, Epsilon, 0.0), Footprint);
    float Dz = RockFieldDistance(Position + vec3(0.0, 0.0, Epsilon), Footprint)
             - RockFieldDistance(Position - vec3(0.0, 0.0, Epsilon), Footprint);
    return normalize(vec3(Dx, Dy, Dz));
}

float RockOcclusion(vec3 Position, vec3 Normal, float Footprint)
{
    float Occlusion = 0.0;
    float Weight = 1.0;
    for (int Sample = 1; Sample <= 5; ++Sample)
    {
        float Reach = 0.012 * float(Sample) * float(Sample);
        float Field = RockFieldDistance(Position + Normal * Reach, Footprint);
        Occlusion += Weight * (Reach - Field);
        Weight *= 0.72;
    }
    return clamp(1.0 - 2.6 * Occlusion, 0.0, 1.0);
}

float RockShadow(vec3 Position, vec3 SunDirection)
{
    // Shadow rays march the coarse body. Subtracting the detail amplitude here would report every surface point as
    // buried and shadow the whole rock black — a bug the CPU proof caught before this preview existed.
    float Shadow = 1.0;
    float Travel = 0.03;
    for (int Step = 0; Step < 64; ++Step)
    {
        vec3 Sample = Position + SunDirection * Travel;
        float Field = RockCoarseDistance(Sample) / max(RockCoarseLipschitz, 1.0);
        Shadow = min(Shadow, 10.0 * Field / Travel);
        Travel += clamp(Field, 0.02, 0.30);
        if (Shadow < 0.004 || Travel > 7.0)
        {
            break;
        }
    }
    return clamp(Shadow, 0.0, 1.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   LITHOLOGY SHADING
//------------------------------------------------------------------------------------------------------------------------

// Albedo lives in the shared kernel (RockLithologyAlbedo) so this module and the CPU reference renderer cannot
// drift apart. Kept as a thin wrapper so the call site below is unchanged.
vec3 LithologyAlbedo(vec3 Position, vec3 Normal, float Footprint)
{
    return RockLithologyAlbedo(Position, Normal, Footprint);
}

vec3 ShadeSample(vec3 Position, vec3 Normal, vec3 ViewDirection, float Footprint)
{
    vec3 SunDirection = normalize(vec3(cos(SunAzimuth) * cos(SunElevation),
                                       sin(SunAzimuth) * cos(SunElevation),
                                       sin(SunElevation)));
    vec3 SunColour = vec3(1.28, 1.17, 0.99);
    vec3 SkyColour = vec3(0.34, 0.42, 0.56);
    vec3 BounceColour = vec3(0.25, 0.21, 0.16);

    vec3 Albedo = LithologyAlbedo(Position, Normal, Footprint);
    float Occlusion = RockOcclusion(Position, Normal, Footprint);
    float Shadow = RockShadow(Position, SunDirection);

    float Lambert = max(dot(Normal, SunDirection), 0.0);
    float SkyTerm = clamp(0.5 + 0.5 * Normal.z, 0.0, 1.0);
    float BounceTerm = clamp(0.4 - 0.4 * Normal.z, 0.0, 1.0);

    vec3 Radiance = Albedo * SunColour * (Lambert * Shadow);
    Radiance += Albedo * SkyColour * (SkyTerm * Occlusion * 0.62);
    Radiance += Albedo * BounceColour * (BounceTerm * Occlusion);

    // Specular sheen concentrated on intact rind, suppressed inside friable cavities.
    vec3 Halfway = normalize(ViewDirection + SunDirection);
    float Gloss = mix(12.0, 46.0, clamp(RockSurface.RindIntegrity, 0.0, 1.0));
    float Specular = pow(max(dot(Normal, Halfway), 0.0), Gloss);
    float Reflectance = 0.035 * RockSurface.RindIntegrity * (1.0 - clamp(RockSurface.CavityDepth * 5.0, 0.0, 1.0));
    Radiance += SunColour * (Specular * Reflectance * Shadow * 8.0);

    return Radiance;
}

vec3 HeatRamp(float T)
{
    T = clamp(T, 0.0, 1.0);
    return clamp(vec3(3.0 * T - 0.6, 2.2 * T - 1.1, 1.4 - 2.4 * T), 0.0, 1.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   FRAGMENT ENTRY
//------------------------------------------------------------------------------------------------------------------------

void main()
{
    ConfigureRock();

    vec2 Pixel = gl_FragCoord.xy;
    float Aspect = ViewportExtent.x / ViewportExtent.y;
    float U = (Pixel.x / ViewportExtent.x * 2.0 - 1.0) * Aspect;
    float V = (Pixel.y / ViewportExtent.y * 2.0 - 1.0);

    vec3 Forward = normalize(CameraFocus - CameraEye);
    vec3 Right = normalize(cross(Forward, vec3(0.0, 0.0, 1.0)));
    vec3 Up = cross(Right, Forward);
    vec3 Direction = normalize(Forward * CameraZoom + Right * U + Up * V);

    float ConeAngle = 1.0 / (ViewportExtent.y * CameraZoom);
    TraceRecord Trace = TraceRock(CameraEye, Direction, ConeAngle, 26.0);

    vec3 Colour;
    if (Trace.Struck)
    {
        float Footprint = PixelFootprint(Trace.Travel, ConeAngle);
        vec3 Normal = RockNormal(Trace.Location, Footprint);
        // Re-evaluate last so RockSurface holds this sample's material fields.
        RockFieldDistance(Trace.Location, Footprint);

        if (ShadingMode == 1)
        {
            Colour = Normal * 0.5 + 0.5;
        }
        else if (ShadingMode == 2)
        {
            Colour = HeatRamp(float(Trace.Steps) / float(MaxSteps));
        }
        else if (ShadingMode == 3)
        {
            // Material field inspector: red cavity depth, green septa, blue fresh spall scars.
            Colour = vec3(clamp(RockSurface.CavityDepth * 8.0, 0.0, 1.0),
                          clamp(RockSurface.Septum, 0.0, 1.0),
                          clamp(RockSurface.SpallFreshness, 0.0, 1.0));
        }
        else
        {
            Colour = ShadeSample(Trace.Location, Normal, -Direction, Footprint);
            float Fog = 1.0 - exp(-Trace.Travel * 0.016);
            Colour = mix(Colour, vec3(0.52, 0.60, 0.72), Fog * 0.5);
        }
    }
    else
    {
        if (ShadingMode == 2)
        {
            Colour = HeatRamp(float(Trace.Steps) / float(MaxSteps));
        }
        else
        {
            float Gradient = clamp(Direction.z * 0.5 + 0.5, 0.0, 1.0);
            Colour = mix(vec3(0.40, 0.45, 0.53), vec3(0.20, 0.33, 0.58), Gradient);
        }
    }

    if (ShadingMode == 0)
    {
        Colour = Colour / (Colour + vec3(1.0));
        Colour = pow(clamp(Colour, 0.0, 1.0), vec3(1.0 / 2.2));
    }
    FragmentColour = vec4(Colour, 1.0);
}
`;

const VERTEX_SOURCE = `#version 300 es
precision highp float;
const vec2 Corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main()
{
    gl_Position = vec4(Corners[gl_VertexID], 0.0, 1.0);
}
`;

//------------------------------------------------------------------------------------------------------------------------
//                                                  RENDER SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

class RenderSequence
{
    constructor(canvas, statusElement)
    {
        this.canvas = canvas;
        this.statusElement = statusElement;
        this.gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
        if (!this.gl)
        {
            throw new Error("WebGL2 is unavailable in this browser.");
        }

        this.program = null;
        this.uniforms = {};
        this.edits = [];

        this.settings = {
            lithology: 0,
            seed: 3.0,
            zoom: 1.75,
            shadingMode: 0,
            maxSteps: 220,
            detailScale: 1.0,
            weathering: -1.0,
            tafoni: -1.0,
            resolutionScale: 0.62
        };

        this.orbit = { azimuth: -2.31, elevation: 0.42, radius: 6.2, target: [0.0, 0.0, 0.30] };
        this.sun = { azimuth: -0.87, elevation: 0.62 };

        this.frameTimes = [];
        this.lastFrameStamp = performance.now();
        this.needsRender = true;

        this.#installPointerControls();
    }

    async build()
    {
        const response = await fetch("../../Shaders/RockFieldSpace.glsl");
        if (!response.ok)
        {
            throw new Error(`Unable to load the rock kernel (HTTP ${response.status}).`);
        }
        const kernelSource = await response.text();

        const fragmentSource = TRACE_PRELUDE + "\n" + kernelSource + "\n" + TRACE_BODY;
        this.program = this.#linkProgram(VERTEX_SOURCE, fragmentSource);

        const names = ["ViewportExtent", "CameraEye", "CameraFocus", "CameraZoom", "LithologyIndex", "SeedValue",
                       "SunAzimuth", "SunElevation", "ShadingMode", "MaxSteps", "DetailScale",
                       "WeatheringOverride", "TafoniOverride", "EditActiveCount",
                       "EditOrigins", "EditVectors", "EditProperties"];
        for (const name of names)
        {
            this.uniforms[name] = this.gl.getUniformLocation(this.program, name);
        }

        const vertexArray = this.gl.createVertexArray();
        this.gl.bindVertexArray(vertexArray);
        return this;
    }

    #linkProgram(vertexSource, fragmentSource)
    {
        const gl = this.gl;
        const compile = (type, source, label) =>
        {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            {
                const log = gl.getShaderInfoLog(shader);
                // Surface the offending line with context, otherwise a 1000 line kernel is impossible to debug.
                const lineMatch = /(\d+):(\d+)/.exec(log || "");
                let excerpt = "";
                if (lineMatch)
                {
                    const lineNumber = parseInt(lineMatch[2], 10);
                    const lines = source.split("\n");
                    for (let i = Math.max(0, lineNumber - 4); i < Math.min(lines.length, lineNumber + 3); ++i)
                    {
                        excerpt += `${i + 1 === lineNumber ? ">>" : "  "} ${i + 1}: ${lines[i]}\n`;
                    }
                }
                throw new Error(`${label} compilation failed:\n${log}\n${excerpt}`);
            }
            return shader;
        };

        const program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource, "Vertex shader"));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource, "Rock field shader"));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        {
            throw new Error(`Program link failed:\n${gl.getProgramInfoLog(program)}`);
        }
        return program;
    }

    #installPointerControls()
    {
        const canvas = this.canvas;
        let dragging = false;
        let lastX = 0;
        let lastY = 0;
        let button = 0;

        canvas.addEventListener("pointerdown", (event) =>
        {
            dragging = true;
            button = event.button;
            lastX = event.clientX;
            lastY = event.clientY;
            canvas.setPointerCapture(event.pointerId);
        });

        canvas.addEventListener("pointerup", (event) =>
        {
            dragging = false;
            canvas.releasePointerCapture(event.pointerId);
        });

        canvas.addEventListener("pointermove", (event) =>
        {
            if (!dragging)
            {
                return;
            }
            const deltaX = event.clientX - lastX;
            const deltaY = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;

            if (button === 2 || event.shiftKey)
            {
                this.sun.azimuth -= deltaX * 0.006;
                this.sun.elevation = Math.max(0.05, Math.min(1.45, this.sun.elevation + deltaY * 0.004));
            }
            else
            {
                this.orbit.azimuth -= deltaX * 0.006;
                this.orbit.elevation = Math.max(-0.25, Math.min(1.35, this.orbit.elevation + deltaY * 0.004));
            }
            this.needsRender = true;
        });

        canvas.addEventListener("contextmenu", (event) => event.preventDefault());

        canvas.addEventListener("wheel", (event) =>
        {
            event.preventDefault();
            this.orbit.radius = Math.max(1.05, Math.min(16.0, this.orbit.radius * Math.exp(event.deltaY * 0.0012)));
            this.needsRender = true;
        }, { passive: false });
    }

    applySetting(key, numericValue)
    {
        this.settings[key] = numericValue;
        this.needsRender = true;
    }

    setEdits(edits)
    {
        this.edits = edits;
        this.needsRender = true;
    }

    cameraEye()
    {
        const { azimuth, elevation, radius, target } = this.orbit;
        return [
            target[0] + radius * Math.cos(elevation) * Math.cos(azimuth),
            target[1] + radius * Math.cos(elevation) * Math.sin(azimuth),
            target[2] + radius * Math.sin(elevation)
        ];
    }

    renderFrame()
    {
        const gl = this.gl;
        const scale = this.settings.resolutionScale;
        const width = Math.max(64, Math.floor(this.canvas.clientWidth * scale));
        const height = Math.max(64, Math.floor(this.canvas.clientHeight * scale));

        if (this.canvas.width !== width || this.canvas.height !== height)
        {
            this.canvas.width = width;
            this.canvas.height = height;
            this.needsRender = true;
        }
        if (!this.needsRender)
        {
            return;
        }

        const started = performance.now();
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.program);

        const eye = this.cameraEye();
        gl.uniform2f(this.uniforms.ViewportExtent, width, height);
        gl.uniform3f(this.uniforms.CameraEye, eye[0], eye[1], eye[2]);
        gl.uniform3f(this.uniforms.CameraFocus, this.orbit.target[0], this.orbit.target[1], this.orbit.target[2]);
        gl.uniform1f(this.uniforms.CameraZoom, this.settings.zoom);
        gl.uniform1i(this.uniforms.LithologyIndex, this.settings.lithology);
        gl.uniform1f(this.uniforms.SeedValue, this.settings.seed);
        gl.uniform1f(this.uniforms.SunAzimuth, this.sun.azimuth);
        gl.uniform1f(this.uniforms.SunElevation, this.sun.elevation);
        gl.uniform1i(this.uniforms.ShadingMode, this.settings.shadingMode);
        gl.uniform1i(this.uniforms.MaxSteps, this.settings.maxSteps);
        gl.uniform1f(this.uniforms.DetailScale, this.settings.detailScale);
        gl.uniform1f(this.uniforms.WeatheringOverride, this.settings.weathering);
        gl.uniform1f(this.uniforms.TafoniOverride, this.settings.tafoni);

        const count = Math.min(this.edits.length, 24);
        const origins = new Float32Array(24 * 4);
        const vectors = new Float32Array(24 * 4);
        const properties = new Float32Array(24 * 4);
        for (let index = 0; index < count; ++index)
        {
            const edit = this.edits[index];
            origins.set([edit.origin[0], edit.origin[1], edit.origin[2], edit.radius], index * 4);
            vectors.set([edit.direction[0], edit.direction[1], edit.direction[2], edit.strength], index * 4);
            properties.set([edit.hardness, edit.category, 0.0, 0.0], index * 4);
        }
        gl.uniform1i(this.uniforms.EditActiveCount, count);
        gl.uniform4fv(this.uniforms.EditOrigins, origins);
        gl.uniform4fv(this.uniforms.EditVectors, vectors);
        gl.uniform4fv(this.uniforms.EditProperties, properties);

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.finish();

        const elapsed = performance.now() - started;
        this.frameTimes.push(elapsed);
        if (this.frameTimes.length > 12)
        {
            this.frameTimes.shift();
        }
        const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;

        if (this.statusElement)
        {
            this.statusElement.textContent =
                `${LITHOLOGY_NAMES[this.settings.lithology]} · ${width}×${height} · ${mean.toFixed(1)} ms/frame`;
        }
        this.needsRender = false;
    }

    requestRender()
    {
        this.needsRender = true;
    }
}

export { RenderSequence, LITHOLOGY_NAMES };
