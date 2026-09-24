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
    const speedReadout = document.getElementById("breaker-speed-readout");
    const closureReadout = document.getElementById("breaker-closure-readout");

    const settings = {
        height: 0.78,
        closure: 0.58,
        noise: 0.42,
        grip: 0.75,
        speed: 74
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
            vLight = 0.24 + max(dot(normal, normalize(uLight)), 0.0) * 0.76;
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
            float fog = clamp((vDepth - 5.0) / 23.0, 0.0, 0.82);
            vec3 lit = vColor * vLight;
            vec3 fogColor = vec3(0.025, 0.055, 0.058);
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

    function boxModel(x, y, z, sx, sy, sz, rotationZ = 0) {
        const c = Math.cos(rotationZ);
        const s = Math.sin(rotationZ);
        return new Float32Array([
            c*sx, s*sx, 0, 0,
            -s*sy, c*sy, 0, 0,
            0, 0, sz, 0,
            x, y, z, 1
        ]);
    }

    const ride = {
        phase: "ready",
        time: 0,
        progress: 0,
        closureProgress: 0,
        resultTimer: 0,
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
            startButton.textContent = "Start ride";
            return;
        }
        ride.phase = "riding";
        ride.time = 0;
        ride.progress = 0;
        ride.closureProgress = 0;
        ride.resultTimer = 0;
        startButton.textContent = "Reset ride";
    }

    startButton.addEventListener("click", startRide);

    function updateRide(delta) {
        ride.worldTime += delta;
        if (ride.phase === "riding") {
            ride.time += delta;
            const support = (settings.speed / 74) * (0.52 + settings.grip * 0.62);
            ride.progress += delta * 0.058 * support;
            ride.closureProgress += delta * (0.039 + settings.closure * 0.018);

            if (support < 0.63 && ride.time > 2.2) {
                ride.phase = "failed";
                ride.resultTimer = 0;
                startButton.textContent = "Restart ride";
            } else if (ride.progress >= 1) {
                ride.phase = "clear";
                ride.resultTimer = 0;
                startButton.textContent = "Ride again";
            } else if (ride.closureProgress >= 1) {
                ride.phase = "failed";
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
                : ride.phase === "clear" ? "Clear" : "Reset";
        speedReadout.textContent = String(settings.speed);
        const closure = Math.min(100, Math.round((settings.closure + ride.closureProgress * (1 - settings.closure)) * 100));
        closureReadout.textContent = `${closure}%`;
    }

    function buildWaveGeometry() {
        const radialSegments = 42;
        const lengthSegments = 54;
        const vertices = [];
        const indices = [];
        const foam = [];
        const radius = 2.75 + settings.height * 1.65;
        const dynamicClosure = Math.min(0.98, settings.closure * 0.72 + ride.closureProgress * 0.32);
        const opening = 1.05 - dynamicClosure * 0.7;
        const thetaStart = opening;
        const thetaEnd = Math.PI * 2 - opening;
        const travel = ride.worldTime * (1.25 + settings.speed / 110);

        for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
            const lengthRatio = lengthIndex / lengthSegments;
            const z = 2.6 - lengthRatio * 23;
            const travellingBand = Math.sin(z * 0.64 + travel * 1.8) * 0.1;
            for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
                const radialRatio = radialIndex / radialSegments;
                const theta = thetaStart + (thetaEnd - thetaStart) * radialRatio;
                const noise = settings.noise * (
                    Math.sin(theta * 5 + z * 1.25 - travel * 2.3) * 0.12
                    + Math.sin(theta * 11 - z * 2.7 + travel * 3.1) * 0.045
                );
                const localRadius = radius * (1 + travellingBand * 0.12) + noise;
                const xShift = Math.sin(z * 0.33 - travel * 0.8) * settings.noise * 0.16;
                const x = Math.cos(theta) * localRadius + xShift;
                const y = Math.sin(theta) * localRadius;
                const normalX = -Math.cos(theta);
                const normalY = -Math.sin(theta);
                const depthShade = 0.72 + lengthRatio * 0.18;
                const lipGlow = Math.min(radialRatio, 1 - radialRatio) < 0.055 ? 0.16 : 0;
                vertices.push(
                    x, y, z,
                    normalX, normalY, 0.08 * Math.sin(z - travel),
                    (0.07 + lipGlow) * depthShade,
                    (0.27 + lipGlow) * depthShade,
                    (0.3 + lipGlow * 0.8) * depthShade
                );
            }
        }

        const row = radialSegments + 1;
        for (let lengthIndex = 0; lengthIndex < lengthSegments; lengthIndex += 1) {
            for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
                const current = lengthIndex * row + radialIndex;
                const next = current + row;
                indices.push(current, next, current + 1, current + 1, next, next + 1);
            }
        }

        for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
            const lengthRatio = lengthIndex / lengthSegments;
            const z = 2.6 - lengthRatio * 23;
            for (const theta of [thetaStart, thetaEnd]) {
                for (let particle = 0; particle < 3; particle += 1) {
                    const phase = lengthIndex * 1.73 + particle * 2.11 + ride.worldTime * 4;
                    const jitter = settings.noise * 0.18;
                    const r = radius + 0.05 + Math.sin(phase) * jitter;
                    foam.push(
                        Math.cos(theta) * r + Math.sin(phase * 1.3) * jitter,
                        Math.sin(theta) * r + Math.cos(phase) * jitter,
                        z + Math.sin(phase * 0.7) * 0.14,
                        -Math.cos(theta), -Math.sin(theta), 0,
                        0.82, 0.91, 0.88
                    );
                }
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
        const climbEfficiency = Math.min(1, 0.34 + settings.grip * 0.92);
        const turbulenceSlip = ride.phase === "riding"
            ? Math.sin(ride.time * 1.8) * settings.noise * 0.035
            : 0;
        // The vehicle starts in the trough and follows the inner C toward its
        // opening. Grip controls how much of the intended wall climb it holds.
        const theta = -Math.PI * 0.5 + activeProgress * 1.28 * climbEfficiency + turbulenceSlip;
        const trackRadius = radius - 0.3;
        const x = Math.cos(theta) * trackRadius;
        const y = Math.sin(theta) * trackRadius;
        const z = 0.4 - activeProgress * 3.2;
        const rotation = theta + Math.PI * 0.5;
        const cosine = Math.cos(rotation);
        const sine = Math.sin(rotation);

        function localPoint(localX, localY) {
            return [
                x + localX * cosine - localY * sine,
                y + localX * sine + localY * cosine
            ];
        }

        drawCube(boxModel(x, y, z, 0.58, 0.18, 0.95, rotation), new Float32Array([0.78, 0.8, 0.76]));
        const cabin = localPoint(0, 0.28);
        drawCube(boxModel(cabin[0], cabin[1], z - 0.08, 0.34, 0.13, 0.48, rotation), new Float32Array([0.22, 0.25, 0.24]));
        const wheelTint = new Float32Array([0.08, 0.1, 0.09]);
        const tyreGlow = new Float32Array([0.55, 0.62, 0.18]);
        for (const side of [-1, 1]) {
            const wheel = localPoint(side * 0.64, -0.12);
            for (const end of [-1, 1]) {
                drawCube(boxModel(wheel[0], wheel[1], z + end * 0.62, 0.11, 0.16, 0.22, rotation), wheelTint);
            }
        }
        const marker = localPoint(0, -0.02);
        drawCube(boxModel(marker[0], marker[1], z + 0.93, 0.38, 0.06, 0.08, rotation), tyreGlow);
    }

    function render() {
        const radius = buildWaveGeometry();
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.clearColor(0.018, 0.038, 0.041, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);

        const projection = perspective(Math.PI / 3.15, Math.max(0.2, width / height), 0.1, 80);
        const cameraSway = Math.sin(ride.worldTime * 0.35) * 0.18;
        const view = lookAt([6.2 + cameraSway, 2.7, 9.4], [0, -0.35, -6.5], [0, 1, 0]);
        gl.uniformMatrix4fv(locations.projection, false, projection);
        gl.uniformMatrix4fv(locations.view, false, view);
        gl.uniformMatrix4fv(locations.model, false, identity);
        gl.uniform3fv(locations.light, new Float32Array([-0.35, 0.8, 0.5]));
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
        gl.uniform1f(locations.pointSize, Math.max(2.5, 4.2 * dpr));
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
