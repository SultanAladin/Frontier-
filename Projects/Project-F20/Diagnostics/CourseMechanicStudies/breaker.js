"use strict";

(() => {
    const canvas = document.getElementById("breaker-canvas");
    if (!canvas) {
        return;
    }

    const page = document.getElementById("breaker-wave");
    const surface = canvas.parentElement;
    const startButton = document.getElementById("breaker-start");
    const phaseReadout = document.getElementById("breaker-phase-readout");
    const angleReadout = document.getElementById("breaker-angle-readout");
    const closureReadout = document.getElementById("breaker-closure-readout");

    const settings = {
        height: 0.78,
        closure: 0.58,
        noise: 0.42,
        grip: 0.75,
        speed: 74,
        angle: 32
    };

    const controls = [
        {
            input: document.getElementById("breaker-height"),
            output: document.getElementById("breaker-height-output"),
            apply: (number) => { settings.height = number / 100; },
            format: (number) => `${(number / 10).toFixed(1)} m`
        },
        {
            input: document.getElementById("breaker-closure"),
            output: document.getElementById("breaker-closure-output"),
            apply: (number) => { settings.closure = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("breaker-noise"),
            output: document.getElementById("breaker-noise-output"),
            apply: (number) => { settings.noise = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("breaker-grip"),
            output: document.getElementById("breaker-grip-output"),
            apply: (number) => { settings.grip = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("breaker-speed"),
            output: document.getElementById("breaker-speed-output"),
            apply: (number) => { settings.speed = number; },
            format: (number) => `${number} km/h`
        },
        {
            input: document.getElementById("breaker-angle"),
            output: document.getElementById("breaker-angle-output"),
            apply: (number) => { settings.angle = number; },
            format: (number) => `${number}°`
        }
    ];

    controls.forEach((control) => {
        function update() {
            const number = Number(control.input.value);
            control.apply(number);
            control.output.value = control.format(number);
            control.output.textContent = control.format(number);
            const minimum = Number(control.input.min);
            const maximum = Number(control.input.max);
            const position = ((number - minimum) / (maximum - minimum)) * 100;
            control.input.style.setProperty("--range-position", `${position}%`);
        }
        control.input.addEventListener("input", update);
        update();
    });

    const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: true,
        depth: true,
        powerPreference: "high-performance"
    });

    if (!gl) {
        const fallback = canvas.getContext("2d");
        fallback.fillStyle = "#071011";
        fallback.fillRect(0, 0, canvas.width, canvas.height);
        fallback.fillStyle = "#d7ddd8";
        fallback.font = "16px sans-serif";
        fallback.fillText("WebGL is required for the three-dimensional wave study.", 28, 52);
        return;
    }

    const vertexShaderSource = `
        attribute vec3 aPosition;
        attribute vec3 aNormal;
        attribute vec3 aColor;
        uniform mat4 uProjection;
        uniform mat4 uView;
        uniform mat4 uModel;
        uniform vec3 uLight;
        uniform vec3 uTint;
        uniform float uPointSize;
        varying vec3 vColor;
        varying float vLight;
        varying float vDepth;
        void main() {
            vec4 world = uModel * vec4(aPosition, 1.0);
            vec3 normal = normalize(mat3(uModel) * aNormal);
            vLight = 0.42 + max(dot(normal, normalize(uLight)), 0.0) * 0.58;
            vColor = aColor * uTint;
            vec4 viewPosition = uView * world;
            vDepth = max(0.0, -viewPosition.z);
            gl_Position = uProjection * viewPosition;
            gl_PointSize = uPointSize;
        }
    `;

    const fragmentShaderSource = `
        precision mediump float;
        uniform float uPointMode;
        varying vec3 vColor;
        varying float vLight;
        varying float vDepth;
        void main() {
            if (uPointMode > 0.5) {
                vec2 p = gl_PointCoord - vec2(0.5);
                if (dot(p, p) > 0.25) discard;
            }
            float fog = clamp((vDepth - 8.0) / 26.0, 0.0, 0.64);
            vec3 lit = vColor * vLight + vec3(0.015, 0.055, 0.06) * vLight * vLight;
            if (uPointMode > 0.5) {
                lit = mix(lit, vColor, 0.72);
            }
            vec3 fogColor = vec3(0.025, 0.09, 0.095);
            gl_FragColor = vec4(mix(lit, fogColor, fog), 1.0);
        }
    `;

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) || "Unable to compile WebGL shader");
        }
        return shader;
    }

    function createProgram() {
        const program = gl.createProgram();
        gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexShaderSource));
        gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || "Unable to link WebGL program");
        }
        return program;
    }

    const program = createProgram();
    gl.useProgram(program);

    const locations = {
        position: gl.getAttribLocation(program, "aPosition"),
        normal: gl.getAttribLocation(program, "aNormal"),
        color: gl.getAttribLocation(program, "aColor"),
        projection: gl.getUniformLocation(program, "uProjection"),
        view: gl.getUniformLocation(program, "uView"),
        model: gl.getUniformLocation(program, "uModel"),
        light: gl.getUniformLocation(program, "uLight"),
        tint: gl.getUniformLocation(program, "uTint"),
        pointSize: gl.getUniformLocation(program, "uPointSize"),
        pointMode: gl.getUniformLocation(program, "uPointMode")
    };

    const waveBuffer = gl.createBuffer();
    const waveIndexBuffer = gl.createBuffer();
    const foamBuffer = gl.createBuffer();
    const cubeBuffer = gl.createBuffer();
    const cubeIndexBuffer = gl.createBuffer();
    let waveIndexCount = 0;
    let foamCount = 0;
    let cubeIndexCount = 0;

    function bindInterleaved(buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const stride = 9 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(locations.position);
        gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(locations.normal);
        gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(locations.color);
        gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
    }

    function createCubeGeometry() {
        const vertices = [];
        const indices = [];
        const faces = [
            { normal: [1, 0, 0], points: [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]] },
            { normal: [-1, 0, 0], points: [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]] },
            { normal: [0, 1, 0], points: [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]] },
            { normal: [0, -1, 0], points: [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]] },
            { normal: [0, 0, 1], points: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
            { normal: [0, 0, -1], points: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] }
        ];
        faces.forEach((face) => {
            const offset = vertices.length / 9;
            face.points.forEach((point) => {
                vertices.push(...point, ...face.normal, 1, 1, 1);
            });
            indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        cubeIndexCount = indices.length;
    }

    createCubeGeometry();

    const identity = new Float32Array([
        1,0,0,0,
        0,1,0,0,
        0,0,1,0,
        0,0,0,1
    ]);

    function perspective(fieldOfView, aspect, near, far) {
        const f = 1 / Math.tan(fieldOfView / 2);
        const range = 1 / (near - far);
        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * range, -1,
            0, 0, far * near * 2 * range, 0
        ]);
    }

    function normalize(vector) {
        const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
        return [vector[0] / length, vector[1] / length, vector[2] / length];
    }

    function cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    function lookAt(eye, target, up) {
        const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
        const x = normalize(cross(up, z));
        const y = cross(z, x);
        return new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -(x[0]*eye[0] + x[1]*eye[1] + x[2]*eye[2]),
            -(y[0]*eye[0] + y[1]*eye[1] + y[2]*eye[2]),
            -(z[0]*eye[0] + z[1]*eye[1] + z[2]*eye[2]),
            1
        ]);
    }

    function boxModel(x, y, z, scaleX, scaleY, scaleZ, rotationZ = 0, rotationY = 0) {
        const cosineZ = Math.cos(rotationZ);
        const sineZ = Math.sin(rotationZ);
        const cosineY = Math.cos(rotationY);
        const sineY = Math.sin(rotationY);
        return new Float32Array([
            cosineZ * cosineY * scaleX, sineZ * cosineY * scaleX, -sineY * scaleX, 0,
            -sineZ * scaleY, cosineZ * scaleY, 0, 0,
            cosineZ * sineY * scaleZ, sineZ * sineY * scaleZ, cosineY * scaleZ, 0,
            x, y, z, 1
        ]);
    }

    const ride = {
        phase: "ready",
        time: 0,
        progress: 0,
        closureProgress: 0,
        resultTimer: 0,
        failureReason: "",
        worldTime: 0
    };

    let width = 1;
    let height = 1;
    let dpr = 1;
    let lastTime = performance.now();
    let audioContext = null;
    let roarGain = null;

    function resize() {
        const bounds = surface.getBoundingClientRect();
        if (bounds.width < 10 || bounds.height < 10) {
            return;
        }
        width = Math.round(bounds.width);
        height = Math.round(bounds.height);
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function ensureAudio() {
        if (audioContext) {
            audioContext.resume();
            return;
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
            return;
        }
        audioContext = new AudioContext();
        const sampleRate = audioContext.sampleRate;
        const noiseBuffer = audioContext.createBuffer(1, sampleRate * 2, sampleRate);
        const channel = noiseBuffer.getChannelData(0);
        let brown = 0;
        for (let index = 0; index < channel.length; index += 1) {
            const white = Math.random() * 2 - 1;
            brown = (brown + 0.018 * white) / 1.018;
            channel[index] = brown * 3.2;
        }
        const source = audioContext.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        const filter = audioContext.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 780;
        roarGain = audioContext.createGain();
        roarGain.gain.value = 0;
        source.connect(filter).connect(roarGain).connect(audioContext.destination);
        source.start();
    }

    function setRoar(level) {
        if (!roarGain || !audioContext) {
            return;
        }
        roarGain.gain.setTargetAtTime(level, audioContext.currentTime, 0.16);
    }

    function startRide() {
        ensureAudio();
        if (ride.phase === "riding") {
            ride.phase = "ready";
            ride.time = 0;
            ride.progress = 0;
            ride.closureProgress = 0;
            ride.failureReason = "";
            startButton.textContent = "Start ride";
            return;
        }
        ride.phase = "riding";
        ride.time = 0;
        ride.progress = 0;
        ride.closureProgress = 0;
        ride.resultTimer = 0;
        ride.failureReason = "";
        startButton.textContent = "Reset ride";
    }

    startButton.addEventListener("click", startRide);

    function requiredTraverseAngle() {
        return 18 + settings.closure * 20 + settings.noise * 5;
    }

    function updateRide(delta) {
        ride.worldTime += delta;
        if (ride.phase === "riding") {
            ride.time += delta;
            const targetAngle = requiredTraverseAngle();
            const angleError = Math.abs(settings.angle - targetAngle);
            const lineEfficiency = Math.max(0.18, 1 - angleError / 28);
            const hydroSupport = (settings.speed / 74) * (0.52 + settings.grip * 0.62);
            const support = hydroSupport * (0.68 + lineEfficiency * 0.32);
            const shallowExposure = Math.max(0, targetAngle - settings.angle) / 38;
            const capture = ride.closureProgress + shallowExposure;

            ride.progress += delta * 0.058 * support * (0.82 + lineEfficiency * 0.18);
            ride.closureProgress += delta * (0.039 + settings.closure * 0.018);

            if ((hydroSupport < 0.63 || (settings.angle > targetAngle + 18 && lineEfficiency < 0.4)) && ride.time > 2.2) {
                ride.phase = "failed";
                ride.failureReason = "No support";
                ride.resultTimer = 0;
                startButton.textContent = "Restart ride";
            } else if (ride.progress >= 1) {
                ride.phase = "clear";
                ride.resultTimer = 0;
                startButton.textContent = "Ride again";
            } else if (capture >= 1 || ride.closureProgress >= 1) {
                ride.phase = "failed";
                ride.failureReason = "Swallowed";
                ride.resultTimer = 0;
                startButton.textContent = "Restart ride";
            }
        } else if (ride.phase === "failed" || ride.phase === "clear") {
            ride.resultTimer += delta;
        }

        const active = !page.hidden && ride.phase === "riding";
        setRoar(active ? 0.045 + settings.height * 0.045 + settings.noise * 0.03 : 0);
        phaseReadout.textContent = ride.phase === "ready"
            ? "Ready"
            : ride.phase === "riding"
                ? "Riding"
                : ride.phase === "clear" ? "Clear" : ride.failureReason;
        angleReadout.textContent = `${settings.angle}°`;
        const closure = Math.min(100, Math.round((settings.closure + ride.closureProgress * (1 - settings.closure)) * 100));
        closureReadout.textContent = `${closure}%`;
    }

    function buildWaveGeometry() {
        const radialSegments = 48;
        const lengthSegments = 58;
        const floorSegments = 12;
        const lipSegments = 7;
        const vertices = [];
        const indices = [];
        const foam = [];
        const radius = 2.75 + settings.height * 1.65;
        const dynamicClosure = Math.min(0.98, settings.closure * 0.72 + ride.closureProgress * 0.32);
        const baseOpening = 1.05 - dynamicClosure * 0.7;
        const travel = ride.worldTime * (1.25 + settings.speed / 110);

        function smoothStep(edge0, edge1, value) {
            const ratio = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
            return ratio * ratio * (3 - 2 * ratio);
        }

        function sectionAt(lengthRatio, z) {
            // The standing wall remains broad while the open shoulder narrows
            // down-course, matching the asymmetric wedge of a breaking wave.
            const taper = 1 - lengthRatio * 0.42;
            const sectionRadius = radius * taper;
            const travellingOffset = Math.sin(travel * 0.7 - lengthRatio * 4.2) * 0.09;
            const centerX = radius * (taper - 1) + travellingOffset;
            const lipSweep = Math.sin(z * 0.48 + travel * 1.25) * (0.035 + settings.noise * 0.045);
            return {
                radius: sectionRadius,
                centerX,
                floorY: -sectionRadius * 0.96 + Math.sin(z * 0.58 - travel * 1.1) * settings.noise * 0.045,
                thetaStart: baseOpening + lipSweep,
                thetaEnd: Math.PI * 2 - baseOpening * 0.72 + lipSweep
            };
        }

        // Main inner face: a tall standing wall and curled roof transition into
        // a nearly horizontal water floor instead of completing a circular tube.
        const faceRow = radialSegments + 1;
        for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
            const lengthRatio = lengthIndex / lengthSegments;
            const z = 2.6 - lengthRatio * 23;
            const section = sectionAt(lengthRatio, z);
            const travellingBand = Math.sin(z * 0.64 + travel * 1.8) * 0.1;
            for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
                const radialRatio = radialIndex / radialSegments;
                const theta = section.thetaStart + (section.thetaEnd - section.thetaStart) * radialRatio;
                const noise = settings.noise * (
                    Math.sin(theta * 5 + z * 1.25 - travel * 2.3) * 0.12
                    + Math.sin(theta * 11 - z * 2.7 + travel * 3.1) * 0.045
                );
                const localRadius = section.radius * (1 + travellingBand * 0.12) + noise;
                const xShift = Math.sin(z * 0.33 - travel * 0.8) * settings.noise * 0.16;
                const x = section.centerX + Math.cos(theta) * localRadius + xShift;
                const circularY = Math.sin(theta) * localRadius;
                const floorBlend = smoothStep(4.18, section.thetaEnd, theta);
                const y = circularY * (1 - floorBlend) + section.floorY * floorBlend;
                const circularNormalX = -Math.cos(theta);
                const circularNormalY = -Math.sin(theta);
                const normalX = circularNormalX * (1 - floorBlend);
                const normalY = circularNormalY * (1 - floorBlend) + floorBlend;
                const depthShade = 0.96 - lengthRatio * 0.18;
                const lipGlow = radialRatio < 0.075 ? 0.2 : 0;
                const movingHighlight = (Math.sin(theta * 7 - z * 1.8 + travel * 2.4) * 0.5 + 0.5) * 0.055;
                vertices.push(
                    x, y, z,
                    normalX, normalY, 0.07 * Math.sin(z - travel),
                    (0.035 + lipGlow * 0.35 + movingHighlight * 0.35) * depthShade,
                    (0.38 + lipGlow + movingHighlight) * depthShade,
                    (0.43 + lipGlow * 0.92 + movingHighlight * 1.2) * depthShade
                );
            }
        }
        for (let lengthIndex = 0; lengthIndex < lengthSegments; lengthIndex += 1) {
            for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
                const current = lengthIndex * faceRow + radialIndex;
                const next = current + faceRow;
                indices.push(current, next, current + 1, current + 1, next, next + 1);
            }
        }

        // A broad ocean plane continues out of the hollow barrel. Its ripples
        // make the wave read as a breaking ocean surface rather than a tunnel.
        const floorOffset = vertices.length / 9;
        const floorRow = floorSegments + 1;
        for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
            const lengthRatio = lengthIndex / lengthSegments;
            const z = 2.6 - lengthRatio * 23;
            const section = sectionAt(lengthRatio, z);
            const edgeX = section.centerX + Math.cos(section.thetaEnd) * section.radius;
            const outerX = edgeX + radius * (1.2 - lengthRatio * 0.34);
            for (let floorIndex = 0; floorIndex <= floorSegments; floorIndex += 1) {
                const floorRatio = floorIndex / floorSegments;
                const x = edgeX + (outerX - edgeX) * floorRatio;
                const ripple = Math.sin(x * 1.8 + z * 0.72 - travel * 2.1) * settings.noise * 0.035
                    + Math.sin(x * 4.1 - z * 0.9 + travel) * 0.012;
                const y = section.floorY + ripple * floorRatio;
                const reflection = Math.pow(Math.max(0, Math.sin(x * 1.3 - z * 0.4 + travel)), 4) * 0.11;
                vertices.push(
                    x, y, z,
                    0, 1, 0.025 * Math.sin(z + travel),
                    0.035 + reflection * 0.25,
                    0.34 + reflection,
                    0.38 + reflection * 1.15
                );
            }
        }
        for (let lengthIndex = 0; lengthIndex < lengthSegments; lengthIndex += 1) {
            for (let floorIndex = 0; floorIndex < floorSegments; floorIndex += 1) {
                const current = floorOffset + lengthIndex * floorRow + floorIndex;
                const next = current + floorRow;
                indices.push(current, next, current + 1, current + 1, next, next + 1);
            }
        }

        // The crest has real thickness and curls down toward the opening. This
        // overhanging sheet creates the hooked lip visible in a barrel wave.
        const lipOffset = vertices.length / 9;
        const lipRow = lipSegments + 1;
        for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
            const lengthRatio = lengthIndex / lengthSegments;
            const z = 2.6 - lengthRatio * 23;
            const section = sectionAt(lengthRatio, z);
            const thickness = 0.62 + settings.height * 0.62 + settings.closure * 0.24;
            for (let lipIndex = 0; lipIndex <= lipSegments; lipIndex += 1) {
                const lipRatio = lipIndex / lipSegments;
                const theta = section.thetaStart - lipRatio * (0.28 + settings.closure * 0.2);
                const lipRadius = section.radius + thickness * lipRatio;
                const chop = Math.sin(z * 1.1 - travel * 2.5 + lipRatio * 4) * settings.noise * 0.075;
                const x = section.centerX + Math.cos(theta) * lipRadius + chop;
                const y = Math.sin(theta) * lipRadius + chop * 0.35;
                const foamMix = Math.pow(lipRatio, 1.7);
                vertices.push(
                    x, y, z,
                    -Math.cos(theta), -Math.sin(theta), -0.06,
                    0.055 + foamMix * 0.62,
                    0.42 + foamMix * 0.48,
                    0.46 + foamMix * 0.45
                );
            }
        }
        for (let lengthIndex = 0; lengthIndex < lengthSegments; lengthIndex += 1) {
            for (let lipIndex = 0; lipIndex < lipSegments; lipIndex += 1) {
                const current = lipOffset + lengthIndex * lipRow + lipIndex;
                const next = current + lipRow;
                indices.push(current, next, current + 1, current + 1, next, next + 1);
            }
        }

        // Dense spray tracks only the breaking crest; the lower opening remains
        // a clean, readable water floor like the supplied barrel-wave reference.
        for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
            const lengthRatio = lengthIndex / lengthSegments;
            const z = 2.6 - lengthRatio * 23;
            const section = sectionAt(lengthRatio, z);
            const thickness = 0.62 + settings.height * 0.62 + settings.closure * 0.24;
            const tipTheta = section.thetaStart - (0.28 + settings.closure * 0.2);
            const tipRadius = section.radius + thickness;
            for (let particle = 0; particle < 7; particle += 1) {
                const phase = lengthIndex * 1.73 + particle * 1.37 + ride.worldTime * 4.4;
                const spray = 0.08 + particle * 0.035 + settings.noise * 0.16;
                foam.push(
                    section.centerX + Math.cos(tipTheta) * tipRadius + Math.sin(phase * 1.3) * spray,
                    Math.sin(tipTheta) * tipRadius + Math.abs(Math.sin(phase * 0.77)) * spray * 1.8,
                    z + Math.cos(phase * 0.91) * spray * 1.35,
                    0, 1, 0,
                    0.82 + particle * 0.018, 0.94, 0.92
                );
            }
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, waveBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, waveIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, foamBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(foam), gl.DYNAMIC_DRAW);
        waveIndexCount = indices.length;
        foamCount = foam.length / 9;
        return radius;
    }

    function drawCube(model, tint) {
        bindInterleaved(cubeBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIndexBuffer);
        gl.uniformMatrix4fv(locations.model, false, model);
        gl.uniform3fv(locations.tint, tint);
        gl.uniform1f(locations.pointMode, 0);
        gl.drawElements(gl.TRIANGLES, cubeIndexCount, gl.UNSIGNED_SHORT, 0);
    }

    function drawCar(radius) {
        const activeProgress = ride.phase === "ready" ? 0 : Math.min(1, ride.progress);
        const gripHold = Math.min(1, 0.34 + settings.grip * 0.92);
        const selectedLine = Math.min(1.35, settings.angle / requiredTraverseAngle());
        const z = 0.4 - activeProgress * 7.2;
        const lengthRatio = Math.max(0, Math.min(1, (2.6 - z) / 23));
        const taper = 1 - lengthRatio * 0.42;
        const sectionRadius = radius * taper;
        const travel = ride.worldTime * (1.25 + settings.speed / 110);
        const centerX = radius * (taper - 1) + Math.sin(travel * 0.7 - lengthRatio * 4.2) * 0.09;
        const floorY = -sectionRadius * 0.96 + Math.sin(z * 0.58 - travel * 1.1) * settings.noise * 0.045;
        const turbulenceSlip = ride.phase === "riding"
            ? Math.sin(ride.time * 1.8) * settings.noise * 0.09
            : 0;
        // The carrier now runs across the flat water floor of the cavity. Its
        // selected traverse angle is visible as yaw in the horizontal x/z
        // plane, while grip decides how closely the path holds that line.
        const x = centerX + sectionRadius * (0.12 + activeProgress * 0.72 * selectedLine * gripHold)
            + turbulenceSlip;
        const y = floorY + 0.3;
        const yaw = -settings.angle * Math.PI / 180;
        const cosine = Math.cos(yaw);
        const sine = Math.sin(yaw);

        function localPoint(localX, localY, localZ) {
            return [
                x + localX * cosine + localZ * sine,
                y + localY,
                z - localX * sine + localZ * cosine
            ];
        }

        drawCube(boxModel(x, y, z, 0.58, 0.18, 0.95, 0, yaw), new Float32Array([0.78, 0.8, 0.76]));
        const cabin = localPoint(0, 0.28, -0.08);
        drawCube(boxModel(cabin[0], cabin[1], cabin[2], 0.34, 0.13, 0.48, 0, yaw), new Float32Array([0.22, 0.25, 0.24]));
        const wheelTint = new Float32Array([0.08, 0.1, 0.09]);
        const tyreGlow = new Float32Array([0.55, 0.62, 0.18]);
        for (const side of [-1, 1]) {
            for (const end of [-1, 1]) {
                const wheel = localPoint(side * 0.64, -0.12, end * 0.62);
                drawCube(boxModel(wheel[0], wheel[1], wheel[2], 0.11, 0.16, 0.22, 0, yaw), wheelTint);
            }
        }
        const marker = localPoint(0, -0.02, 0.93);
        drawCube(boxModel(marker[0], marker[1], marker[2], 0.38, 0.06, 0.08, 0, yaw), tyreGlow);
    }

    function render() {
        const radius = buildWaveGeometry();
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.clearColor(0.018, 0.075, 0.08, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);

        const projection = perspective(Math.PI / 3.28, Math.max(0.2, width / height), 0.1, 80);
        const cameraSway = Math.sin(ride.worldTime * 0.35) * 0.16;
        const view = lookAt([7.1 + cameraSway, 1.8, 9.2], [-0.55, -0.7, -5.8], [0, 1, 0]);
        gl.uniformMatrix4fv(locations.projection, false, projection);
        gl.uniformMatrix4fv(locations.view, false, view);
        gl.uniformMatrix4fv(locations.model, false, identity);
        gl.uniform3fv(locations.light, new Float32Array([0.18, 0.9, 0.55]));
        gl.uniform3fv(locations.tint, new Float32Array([1, 1, 1]));
        gl.uniform1f(locations.pointMode, 0);
        gl.uniform1f(locations.pointSize, 1);

        bindInterleaved(waveBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, waveIndexBuffer);
        gl.drawElements(gl.TRIANGLES, waveIndexCount, gl.UNSIGNED_SHORT, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        bindInterleaved(foamBuffer);
        gl.uniform1f(locations.pointMode, 1);
        gl.uniform1f(locations.pointSize, Math.max(3, 5.2 * dpr));
        gl.drawArrays(gl.POINTS, 0, foamCount);
        gl.disable(gl.BLEND);

        drawCar(radius);
    }

    function loop(timestamp) {
        const delta = Math.min(0.033, Math.max(0.001, (timestamp - lastTime) / 1000));
        lastTime = timestamp;
        if (!page.hidden && document.visibilityState !== "hidden") {
            updateRide(delta);
            render();
        } else {
            setRoar(0);
        }
        requestAnimationFrame(loop);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    window.addEventListener("resize", resize, { passive: true });
    window.breakerWave = { resize, startRide };
    requestAnimationFrame(loop);
})();
