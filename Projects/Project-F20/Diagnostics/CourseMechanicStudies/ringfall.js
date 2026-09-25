"use strict";

(() => {
    const canvas = document.getElementById("ringfall-canvas");
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("ringfall");
    const resetButton = document.getElementById("ringfall-reset");
    const positionReadout = document.getElementById("ringfall-position-readout");
    const ringReadout = document.getElementById("ringfall-ring-readout");
    const gateReadout = document.getElementById("ringfall-gate-readout");
    const pursuerReadout = document.getElementById("ringfall-pursuer-readout");
    const resultReadout = document.getElementById("ringfall-result-readout");
    const crossingName = document.getElementById("ringfall-crossing-name");
    const loadBar = document.getElementById("ringfall-load-bar");
    const damageBar = document.getElementById("ringfall-damage-bar");
    const controlButtons = Array.from(document.querySelectorAll("[data-ringfall-control]"));

    const TAU = Math.PI * 2;
    const centre = { x: 700, y: 466 };
    const settings = {
        mass: 1650,
        torque: 0.72,
        brakes: 0.76,
        grip: 0.92,
        collapsePace: 1
    };

    const ringSpecifications = [
        { radius: 410, width: 68, start: 2.44, gate: 4.55, collapseStart: 8, duration: 57, name: "Outer" },
        { radius: 310, width: 62, start: 4.55, gate: 0.20, collapseStart: 20, duration: 47, name: "Second" },
        { radius: 218, width: 56, start: 0.20, gate: 2.27, collapseStart: 34, duration: 39, name: "Third" },
        { radius: 138, width: 49, start: 2.27, gate: 4.34, collapseStart: 48, duration: 31, name: "Fourth" },
        { radius: 65, width: 36, start: 4.34, gate: 0.10, collapseStart: 61, duration: 24, name: "Final" }
    ];

    const bridgeNames = [
        "Span A / Outer—Second",
        "Span B / Second—Third",
        "Span C / Third—Fourth",
        "Span D / Fourth—Final",
        "Final span / Core"
    ];

    const world = {
        width: 1400,
        height: 900,
        dpr: 1,
        scaleX: 1,
        scaleY: 1,
        time: 0,
        lastTime: performance.now(),
        wasVisible: false,
        result: "racing",
        resultDetail: "Heat active",
        shake: 0,
        dustPhase: 0,
        finishers: 0
    };

    const input = {
        throttle: false,
        brake: false,
        left: false,
        right: false,
        touched: false
    };

    const player = {
        x: 0,
        y: 0,
        previousX: 0,
        previousY: 0,
        vx: 0,
        vy: 0,
        heading: 0,
        speed: 0,
        ring: 0,
        bridge: -1,
        bridgeProgress: 0,
        support: null,
        fallTime: 0,
        integrity: 1,
        collisionFlash: 0,
        finished: false,
        number: 7
    };

    let rivals = [];
    let bridges = [];

    const controls = [
        {
            input: document.getElementById("ringfall-mass"),
            output: document.getElementById("ringfall-mass-output"),
            apply: (number) => { settings.mass = number; },
            format: (number) => `${number.toLocaleString("en-US")} kg`
        },
        {
            input: document.getElementById("ringfall-torque"),
            output: document.getElementById("ringfall-torque-output"),
            apply: (number) => { settings.torque = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("ringfall-brakes"),
            output: document.getElementById("ringfall-brakes-output"),
            apply: (number) => { settings.brakes = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("ringfall-grip"),
            output: document.getElementById("ringfall-grip-output"),
            apply: (number) => { settings.grip = number / 100; },
            format: (number) => `${(number / 100).toFixed(2)} µ`
        },
        {
            input: document.getElementById("ringfall-collapse"),
            output: document.getElementById("ringfall-collapse-output"),
            apply: (number) => { settings.collapsePace = number / 100; },
            format: (number) => `${number}%`
        }
    ];

    function clamp(number, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, number));
    }

    function modular(number, divisor) {
        return ((number % divisor) + divisor) % divisor;
    }

    function moveToward(number, target, amount) {
        if (number < target) {
            return Math.min(target, number + amount);
        }
        return Math.max(target, number - amount);
    }

    function smoothstep(number) {
        const ratio = clamp(number, 0, 1);
        return ratio * ratio * (3 - 2 * ratio);
    }

    function angularDistance(start, angle) {
        return modular(angle - start, TAU);
    }

    function syncControl(control) {
        const number = Number(control.input.value);
        control.apply(number);
        const text = control.format(number);
        control.output.value = text;
        control.output.textContent = text;
        const minimum = Number(control.input.min);
        const maximum = Number(control.input.max);
        const position = ((number - minimum) / Math.max(1, maximum - minimum)) * 100;
        control.input.style.setProperty("--range-position", `${position}%`);
    }

    controls.forEach((control) => {
        control.update = () => syncControl(control);
        control.input.addEventListener("input", control.update);
        control.update();
    });

    function gateInformation(index) {
        const period = 8.8 - index * 0.55;
        const openDuration = 3.9 - index * 0.28;
        const phase = modular(world.time + index * 1.85, period);
        const openingRamp = 0.5;
        const closingRamp = 0.62;
        let openness;
        let label;
        if (phase < openingRamp) {
            openness = smoothstep(phase / openingRamp);
            label = "Opening";
        } else if (phase < openDuration - closingRamp) {
            openness = 1;
            label = "Open";
        } else if (phase < openDuration) {
            openness = 1 - smoothstep((phase - openDuration + closingRamp) / closingRamp);
            label = "Closing";
        } else {
            openness = 0;
            const wait = period - phase;
            label = `${wait.toFixed(1)} s`;
        }
        return { open: openness > 0.72, openness, label, phase, period };
    }

    function collapseProgress(index) {
        const specification = ringSpecifications[index];
        const elapsed = Math.max(0, world.time - specification.collapseStart);
        return clamp(elapsed / (specification.duration / settings.collapsePace), 0, 1) * TAU;
    }

    function createBridges() {
        bridges = ringSpecifications.map((ring, index) => {
            const innerRadius = index < ringSpecifications.length - 1
                ? ringSpecifications[index + 1].radius + ringSpecifications[index + 1].width * 0.38
                : 48;
            const outerRadius = ring.radius - ring.width * 0.38;
            const segmentCount = index === 4 ? 3 : 4;
            const capacity = [3900, 3550, 3250, 2950, 2650][index];
            return {
                index,
                angle: ring.gate,
                innerRadius,
                outerRadius,
                length: outerRadius - innerRadius,
                width: [53, 49, 45, 41, 37][index],
                capacity,
                segments: Array.from({ length: segmentCount }, () => ({ damage: 0, load: 0, deflection: 0, collapsed: false, impact: 0 }))
            };
        });
    }

    function resetPlayer() {
        const start = ringSpecifications[0].start + 0.06;
        const radius = ringSpecifications[0].radius;
        player.x = centre.x + Math.cos(start) * radius;
        player.y = centre.y + Math.sin(start) * radius;
        player.previousX = player.x;
        player.previousY = player.y;
        player.vx = Math.cos(start + Math.PI / 2) * 8;
        player.vy = Math.sin(start + Math.PI / 2) * 8;
        player.heading = start + Math.PI / 2;
        player.speed = 8;
        player.ring = 0;
        player.bridge = -1;
        player.bridgeProgress = 0;
        player.support = { type: "ring", index: 0 };
        player.fallTime = 0;
        player.integrity = 1;
        player.collisionFlash = 0;
        player.finished = false;
    }

    function createRivals() {
        const palette = ["#8e5d43", "#677d76", "#7d7568", "#53636a", "#8c7848", "#765564", "#68715a", "#846c59"];
        rivals = Array.from({ length: 23 }, (_, index) => {
            const row = Math.floor(index / 6);
            const column = index % 6;
            const massClass = index % 5 === 0 ? "heavy" : index % 3 === 0 ? "light" : "medium";
            const mass = massClass === "heavy" ? 2550 : massClass === "light" ? 1180 : 1740;
            return {
                number: index < 6 ? index + 1 : index + 2,
                ring: 0,
                stage: "ring",
                angle: ringSpecifications[0].start - row * 0.055 - column * 0.013,
                lane: (column % 3 - 1) * 19,
                speed: 18 + column * 1.8,
                targetSpeed: 82,
                bridge: -1,
                bridgeProgress: 0,
                mass,
                massClass,
                aggression: 0.35 + modular(index * 0.27, 0.55),
                pace: 0.86 + modular(index * 0.071, 0.22),
                active: true,
                finished: false,
                fall: 0,
                colour: palette[index % palette.length],
                flash: 0
            };
        });
    }

    function pointSupport(x, y) {
        const dx = x - centre.x;
        const dy = y - centre.y;
        const radius = Math.hypot(dx, dy);
        const angle = modular(Math.atan2(dy, dx), TAU);

        if (radius < 49) {
            return { type: "finish", index: 5, angle, radius };
        }

        for (let index = 0; index < bridges.length; index += 1) {
            const bridge = bridges[index];
            const cosine = Math.cos(bridge.angle);
            const sine = Math.sin(bridge.angle);
            const radial = dx * cosine + dy * sine;
            const tangential = -dx * sine + dy * cosine;
            if (radial >= bridge.innerRadius && radial <= bridge.outerRadius && Math.abs(tangential) <= bridge.width * 0.5) {
                const progress = clamp((bridge.outerRadius - radial) / bridge.length, 0, 1);
                const segmentIndex = Math.min(bridge.segments.length - 1, Math.floor(progress * bridge.segments.length));
                if (!bridge.segments[segmentIndex].collapsed) {
                    return { type: "bridge", index, progress, segmentIndex, radial, tangential, angle, radius };
                }
                return null;
            }
        }

        for (let index = 0; index < ringSpecifications.length; index += 1) {
            const ring = ringSpecifications[index];
            if (Math.abs(radius - ring.radius) <= ring.width * 0.5) {
                const progress = angularDistance(ring.start, angle);
                if (progress + 0.035 >= collapseProgress(index)) {
                    return { type: "ring", index, progress, angle, radius };
                }
                return null;
            }
        }
        return null;
    }

    function rivalPosition(rival) {
        if (rival.stage === "bridge") {
            const bridge = bridges[rival.bridge];
            const radial = bridge.outerRadius - bridge.length * rival.bridgeProgress;
            const lane = (rival.number % 3 - 1) * bridge.width * 0.18;
            return {
                x: centre.x + Math.cos(bridge.angle) * radial - Math.sin(bridge.angle) * lane,
                y: centre.y + Math.sin(bridge.angle) * radial + Math.cos(bridge.angle) * lane,
                heading: bridge.angle + Math.PI,
                radius: radial
            };
        }
        if (rival.finished) {
            const angle = rival.number * 0.73;
            return { x: centre.x + Math.cos(angle) * 25, y: centre.y + Math.sin(angle) * 25, heading: angle + Math.PI, radius: 25 };
        }
        const ring = ringSpecifications[rival.ring];
        const radial = ring.radius + rival.lane;
        return {
            x: centre.x + Math.cos(rival.angle) * radial,
            y: centre.y + Math.sin(rival.angle) * radial,
            heading: rival.angle + Math.PI / 2,
            radius: radial
        };
    }

    function rivalRaceProgress(rival) {
        if (rival.finished) {
            return 6;
        }
        if (!rival.active) {
            return -1;
        }
        if (rival.stage === "bridge") {
            return rival.bridge + 0.75 + rival.bridgeProgress * 0.25;
        }
        const ring = ringSpecifications[rival.ring];
        const distanceToGate = angularDistance(ring.start, ring.gate);
        return rival.ring + clamp(angularDistance(ring.start, rival.angle) / Math.max(0.1, distanceToGate), 0, 0.74);
    }

    function playerRaceProgress() {
        if (player.finished) {
            return 6;
        }
        if (!player.support) {
            return Math.max(0, player.ring - 0.1);
        }
        if (player.support.type === "bridge") {
            return player.support.index + 0.75 + player.support.progress * 0.25;
        }
        if (player.support.type === "finish") {
            return 6;
        }
        const ring = ringSpecifications[player.support.index];
        const distanceToGate = angularDistance(ring.start, ring.gate);
        return player.support.index + clamp(angularDistance(ring.start, player.support.angle) / Math.max(0.1, distanceToGate), 0, 0.74);
    }

    function nextRivalOnRing(rival) {
        let closest = null;
        let gap = Infinity;
        rivals.forEach((other) => {
            if (other === rival || !other.active || other.finished || other.stage !== "ring" || other.ring !== rival.ring) {
                return;
            }
            const distance = angularDistance(rival.angle, other.angle);
            if (distance > 0 && distance < gap) {
                gap = distance;
                closest = other;
            }
        });
        return { rival: closest, gap };
    }

    function updateRivals(delta) {
        rivals.forEach((rival) => {
            rival.flash = Math.max(0, rival.flash - delta * 2);
            if (!rival.active) {
                rival.fall += delta;
                return;
            }
            if (rival.finished) {
                return;
            }

            if (rival.stage === "ring") {
                const ring = ringSpecifications[rival.ring];
                const gate = gateInformation(rival.ring);
                const toGate = angularDistance(rival.angle, ring.gate);
                const ahead = nextRivalOnRing(rival);
                let target = (88 + rival.aggression * 25) * rival.pace * (1 - rival.ring * 0.035);

                if (ahead.gap < 0.11) {
                    target = Math.min(target, ahead.rival.speed * clamp(ahead.gap / 0.11, 0.15, 1));
                }

                if (toGate < 0.2 && !gate.open) {
                    if (rival.aggression < 0.72 || toGate < 0.07) {
                        target = 0;
                    }
                }

                rival.speed = moveToward(rival.speed, target, (target < rival.speed ? 54 : 25) * delta);
                rival.angle = modular(rival.angle + rival.speed / Math.max(1, ring.radius + rival.lane) * delta, TAU);

                const gateDistance = angularDistance(rival.angle, ring.gate);
                const crossedGate = gateDistance < 0.035 || gateDistance > TAU - 0.035;
                if (crossedGate && gate.open && rival.speed < 102) {
                    rival.stage = "bridge";
                    rival.bridge = rival.ring;
                    rival.bridgeProgress = 0;
                    rival.speed = Math.max(35, rival.speed * 0.7);
                    const first = bridges[rival.bridge].segments[0];
                    first.impact += rival.mass * rival.speed * rival.speed / 48000000;
                }

                const collapse = collapseProgress(rival.ring);
                const ringProgress = angularDistance(ring.start, rival.angle);
                if (collapse > ringProgress + 0.07) {
                    rival.active = false;
                    rival.fall = 0;
                }
            } else if (rival.stage === "bridge") {
                const bridge = bridges[rival.bridge];
                const target = 54 + rival.aggression * 19;
                rival.speed = moveToward(rival.speed, target, 32 * delta);
                rival.bridgeProgress += rival.speed / Math.max(1, bridge.length) * delta;
                const segmentIndex = Math.min(bridge.segments.length - 1, Math.floor(clamp(rival.bridgeProgress, 0, 0.999) * bridge.segments.length));
                if (bridge.segments[segmentIndex].collapsed) {
                    rival.active = false;
                    rival.fall = 0;
                    return;
                }
                if (rival.bridgeProgress >= 1) {
                    if (rival.bridge >= ringSpecifications.length - 1) {
                        rival.finished = true;
                        rival.stage = "finish";
                        rival.speed = 0;
                        world.finishers += 1;
                    } else {
                        rival.ring = rival.bridge + 1;
                        rival.stage = "ring";
                        rival.angle = ringSpecifications[rival.ring].start + 0.025;
                        rival.lane = (rival.number % 3 - 1) * Math.max(10, 17 - rival.ring * 2);
                        rival.speed *= 0.9;
                    }
                }
            }
        });
    }

    function updateBridgeLoads(delta) {
        bridges.forEach((bridge) => bridge.segments.forEach((segment) => { segment.load = 0; }));

        rivals.forEach((rival) => {
            if (!rival.active || rival.stage !== "bridge") {
                return;
            }
            const bridge = bridges[rival.bridge];
            const segmentIndex = Math.min(bridge.segments.length - 1, Math.floor(clamp(rival.bridgeProgress, 0, 0.999) * bridge.segments.length));
            bridge.segments[segmentIndex].load += rival.mass;
        });

        if (player.support?.type === "bridge" && world.result === "racing") {
            const bridge = bridges[player.support.index];
            bridge.segments[player.support.segmentIndex].load += settings.mass;
        }

        bridges.forEach((bridge) => {
            bridge.segments.forEach((segment) => {
                const loadRatio = segment.load / bridge.capacity;
                const targetDeflection = clamp(loadRatio * 0.9 + segment.damage * 0.4, 0, 1.4);
                segment.deflection = moveToward(segment.deflection, targetDeflection, delta * 2.4);
                if (loadRatio > 1) {
                    segment.damage += (loadRatio - 1) * delta * 0.34;
                }
                if (segment.impact > 0) {
                    segment.damage += segment.impact;
                    segment.impact = 0;
                }
                segment.damage = clamp(segment.damage, 0, 1.15);
                if (segment.damage >= 1) {
                    segment.collapsed = true;
                    world.shake = Math.max(world.shake, 0.8);
                }
            });
        });
    }

    function fail(result, label, detail) {
        if (world.result !== "racing") {
            return;
        }
        world.result = result;
        world.resultDetail = detail;
        player.vx *= 0.3;
        player.vy *= 0.3;
        player.collisionFlash = 1;
        resultReadout.textContent = label;
        resetButton.textContent = "Restart heat";
        canvas.dataset.result = result;
    }

    function updatePlayer(delta) {
        player.collisionFlash = Math.max(0, player.collisionFlash - delta * 1.8);
        if (world.result !== "racing") {
            return;
        }

        player.previousX = player.x;
        player.previousY = player.y;
        const forwardX = Math.cos(player.heading);
        const forwardY = Math.sin(player.heading);
        const rightX = -forwardY;
        const rightY = forwardX;
        const forwardVelocity = player.vx * forwardX + player.vy * forwardY;
        const lateralVelocity = player.vx * rightX + player.vy * rightY;
        const massFactor = settings.mass / 1650;
        const engineAcceleration = (38 + settings.torque * 48) / Math.sqrt(massFactor);
        const brakingAcceleration = (52 + settings.brakes * 92) / massFactor;

        if (input.throttle) {
            player.vx += forwardX * engineAcceleration * delta;
            player.vy += forwardY * engineAcceleration * delta;
            input.touched = true;
        }
        if (input.brake) {
            if (forwardVelocity > 5) {
                const braking = Math.min(Math.abs(forwardVelocity), brakingAcceleration * delta);
                player.vx -= forwardX * braking;
                player.vy -= forwardY * braking;
            } else {
                player.vx -= forwardX * engineAcceleration * 0.48 * delta;
                player.vy -= forwardY * engineAcceleration * 0.48 * delta;
            }
            input.touched = true;
        }

        const speed = Math.hypot(player.vx, player.vy);
        const steerInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (steerInput !== 0 && speed > 2) {
            const steeringAuthority = settings.grip * clamp(speed / 34, 0.12, 1) * clamp(1.35 - speed / 190, 0.36, 1);
            const ringSteering = 0.33 + player.ring * 0.11;
            player.heading += steerInput * steeringAuthority * ringSteering * delta * Math.sign(forwardVelocity || 1);
            input.touched = true;
        }

        const lateralGrip = clamp(settings.grip * 5.8 * delta, 0, 0.9);
        player.vx -= rightX * lateralVelocity * lateralGrip;
        player.vy -= rightY * lateralVelocity * lateralGrip;
        const drag = Math.max(0, 1 - delta * (0.14 + speed * 0.0015));
        player.vx *= drag;
        player.vy *= drag;
        const maximumSpeed = 104 + settings.torque * 54 / Math.sqrt(massFactor);
        const newSpeed = Math.hypot(player.vx, player.vy);
        if (newSpeed > maximumSpeed) {
            player.vx *= maximumSpeed / newSpeed;
            player.vy *= maximumSpeed / newSpeed;
        }

        player.x += player.vx * delta;
        player.y += player.vy * delta;
        player.speed = Math.hypot(player.vx, player.vy);

        let support = pointSupport(player.x, player.y);
        if (support?.type === "bridge") {
            const bridge = bridges[support.index];
            const gate = gateInformation(support.index);
            if (support.progress < 0.14 && !gate.open) {
                const radialX = Math.cos(bridge.angle);
                const radialY = Math.sin(bridge.angle);
                const radialVelocity = player.vx * radialX + player.vy * radialY;
                if (radialVelocity < 0) {
                    const impactSpeed = Math.abs(radialVelocity);
                    player.vx -= radialX * radialVelocity * 1.72;
                    player.vy -= radialY * radialVelocity * 1.72;
                    player.x += radialX * 8;
                    player.y += radialY * 8;
                    player.integrity -= impactSpeed / 245;
                    player.collisionFlash = 1;
                    world.shake = Math.max(world.shake, clamp(impactSpeed / 120, 0, 0.7));
                    bridge.segments[0].impact += settings.mass * impactSpeed * impactSpeed / 62000000;
                    support = pointSupport(player.x, player.y);
                    if (player.integrity <= 0) {
                        fail("gate-impact", "Gate impact", "The closing transfer gate destroyed the player's steering assembly");
                    }
                }
            }
        }

        player.support = support;
        if (support) {
            player.fallTime = Math.max(0, player.fallTime - delta * 2);
            if (support.type === "ring") {
                player.ring = support.index;
                player.bridge = -1;
            } else if (support.type === "bridge") {
                player.bridge = support.index;
                player.bridgeProgress = support.progress;
                if (support.progress > 0.55) {
                    player.ring = Math.min(4, support.index + 1);
                }
            } else if (support.type === "finish") {
                player.finished = true;
                world.finishers += 1;
                const rank = 1 + rivals.filter((rival) => rival.finished).length;
                fail("finished", `Finished P${rank}`, "The player reached the central finish before the final ring collapsed");
            }
        } else {
            player.fallTime += delta;
            if (player.fallTime > 0.2) {
                fail("fall", "Eliminated", "The vehicle left the remaining load-bearing arena surface");
            }
        }

        if (support?.type === "bridge") {
            const bridge = bridges[support.index];
            const segment = bridge.segments[support.segmentIndex];
            if (segment.collapsed) {
                fail("load-collapse", "Span collapse", "Combined vehicle load fractured the radial crossing");
            }
        }

        if (support?.type === "ring") {
            const ring = ringSpecifications[support.index];
            if (collapseProgress(support.index) > angularDistance(ring.start, support.angle) + 0.05) {
                fail("pursuer", "Caught by collapse", "The advancing structural failure reached the player's sector");
            }
        }
    }

    function resolvePlayerRivalCollisions() {
        if (world.result !== "racing") {
            return;
        }
        rivals.forEach((rival) => {
            if (!rival.active || rival.finished) {
                return;
            }
            const position = rivalPosition(rival);
            const dx = player.x - position.x;
            const dy = player.y - position.y;
            const distance = Math.max(0.001, Math.hypot(dx, dy));
            const collisionDistance = rival.massClass === "heavy" ? 31 : 27;
            if (distance >= collisionDistance) {
                return;
            }
            const normalX = dx / distance;
            const normalY = dy / distance;
            const overlap = collisionDistance - distance;
            player.x += normalX * overlap * 0.72;
            player.y += normalY * overlap * 0.72;
            const rivalVelocityX = Math.cos(position.heading) * rival.speed;
            const rivalVelocityY = Math.sin(position.heading) * rival.speed;
            const relative = (player.vx - rivalVelocityX) * normalX + (player.vy - rivalVelocityY) * normalY;
            if (relative < 0) {
                const rivalShare = rival.mass / (rival.mass + settings.mass);
                const impulse = -relative * 1.35;
                player.vx += normalX * impulse * rivalShare;
                player.vy += normalY * impulse * rivalShare;
                rival.speed = Math.max(0, rival.speed - impulse * (1 - rivalShare) * 0.45);
                rival.flash = 1;
                player.collisionFlash = 0.75;
                world.shake = Math.max(world.shake, clamp(Math.abs(relative) / 130, 0, 0.45));
                if (player.support?.type === "bridge") {
                    bridges[player.support.index].segments[player.support.segmentIndex].impact += Math.abs(relative) * settings.mass / 310000;
                }
            }
        });
    }

    function updateReadouts() {
        const playerProgress = playerRaceProgress();
        const ahead = rivals.filter((rival) => rivalRaceProgress(rival) > playerProgress).length;
        const position = clamp(ahead + 1, 1, 24);
        positionReadout.textContent = `${position} / 24`;
        ringReadout.textContent = player.support?.type === "finish"
            ? "Core"
            : ringSpecifications[clamp(player.ring, 0, 4)].name;
        const nextBridge = clamp(player.ring, 0, 4);
        const gate = gateInformation(nextBridge);
        gateReadout.textContent = gate.label;

        let pursuitDistance = 0;
        if (player.support?.type === "ring") {
            const ring = ringSpecifications[player.support.index];
            const playerArc = angularDistance(ring.start, player.support.angle);
            pursuitDistance = Math.max(0, playerArc - collapseProgress(player.support.index)) * ring.radius * 0.12;
        } else {
            pursuitDistance = 42 + (1 - clamp(player.bridgeProgress, 0, 1)) * 35;
        }
        pursuerReadout.textContent = `${Math.round(pursuitDistance)} m`;
        if (world.result === "racing") {
            resultReadout.textContent = "Racing";
        }

        const bridge = bridges[nextBridge];
        const maximumLoad = Math.max(...bridge.segments.map((segment) => segment.load / bridge.capacity));
        const maximumDamage = Math.max(...bridge.segments.map((segment) => segment.damage));
        crossingName.textContent = bridgeNames[nextBridge];
        loadBar.style.width = `${clamp(maximumLoad, 0, 1) * 100}%`;
        damageBar.style.width = `${clamp(maximumDamage, 0, 1) * 100}%`;
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width * 0.5, height * 0.5);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function drawBackdrop() {
        const gradient = context.createRadialGradient(centre.x, centre.y, 40, centre.x, centre.y, 680);
        gradient.addColorStop(0, "#20241f");
        gradient.addColorStop(0.42, "#121512");
        gradient.addColorStop(0.78, "#090b09");
        gradient.addColorStop(1, "#040605");
        context.fillStyle = gradient;
        context.fillRect(0, 0, world.width, world.height);

        context.strokeStyle = "rgba(135,139,128,0.12)";
        context.lineWidth = 3;
        for (let index = 0; index < 24; index += 1) {
            const angle = index / 24 * TAU + 0.04;
            const inner = 488;
            const outer = 660 + (index % 3) * 18;
            context.beginPath();
            context.moveTo(centre.x + Math.cos(angle) * inner, centre.y + Math.sin(angle) * inner);
            context.lineTo(centre.x + Math.cos(angle) * outer, centre.y + Math.sin(angle) * outer);
            context.stroke();
        }

        context.fillStyle = "rgba(82,78,68,0.22)";
        for (let index = 0; index < 90; index += 1) {
            const angle = modular(index * 2.399 + 0.2, TAU);
            const radius = 475 + modular(index * 73, 205);
            const size = 2 + index % 5;
            context.save();
            context.translate(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius * 0.92);
            context.rotate(index * 0.71);
            context.fillRect(-size, -size * 0.5, size * 2, size);
            context.restore();
        }

        context.strokeStyle = "rgba(89,92,84,0.16)";
        context.lineWidth = 16;
        context.beginPath(); context.arc(centre.x, centre.y, 482, 0, TAU); context.stroke();
        context.strokeStyle = "rgba(174,140,65,0.12)";
        context.lineWidth = 2;
        context.setLineDash([4, 16]);
        context.beginPath(); context.arc(centre.x, centre.y, 493, 0, TAU); context.stroke();
        context.setLineDash([]);
    }

    function drawRing(index) {
        const ring = ringSpecifications[index];
        const collapse = collapseProgress(index);
        const segments = 96;

        context.lineCap = "butt";
        for (let segment = 0; segment < segments; segment += 1) {
            const progressStart = segment / segments * TAU;
            const progressEnd = (segment + 1) / segments * TAU - 0.005;
            if (progressEnd < collapse) {
                continue;
            }
            const start = ring.start + Math.max(progressStart, collapse);
            const end = ring.start + progressEnd;
            context.strokeStyle = "rgba(0,0,0,0.66)";
            context.lineWidth = ring.width + 14;
            context.beginPath(); context.arc(centre.x, centre.y + 6, ring.radius, start, end); context.stroke();
            const shade = 57 + ((segment + index) % 4) * 3;
            context.strokeStyle = `rgb(${shade}, ${shade + 5}, ${shade})`;
            context.lineWidth = ring.width;
            context.beginPath(); context.arc(centre.x, centre.y, ring.radius, start, end); context.stroke();
            context.strokeStyle = "rgba(218,219,208,0.06)";
            context.lineWidth = ring.width - 10;
            context.beginPath(); context.arc(centre.x, centre.y, ring.radius, start, end); context.stroke();
        }

        context.strokeStyle = "rgba(224,225,214,0.18)";
        context.lineWidth = 1.2;
        for (let segment = 0; segment < 32; segment += 1) {
            const progress = segment / 32 * TAU;
            if (progress < collapse) {
                continue;
            }
            const angle = ring.start + progress;
            const inner = ring.radius - ring.width * 0.5 + 5;
            const outer = ring.radius + ring.width * 0.5 - 5;
            context.beginPath();
            context.moveTo(centre.x + Math.cos(angle) * inner, centre.y + Math.sin(angle) * inner);
            context.lineTo(centre.x + Math.cos(angle) * outer, centre.y + Math.sin(angle) * outer);
            context.stroke();
        }

        context.strokeStyle = "rgba(196,163,72,0.34)";
        context.lineWidth = 2;
        context.setLineDash([7, 13]);
        context.beginPath(); context.arc(centre.x, centre.y, ring.radius, ring.start + collapse, ring.start + TAU); context.stroke();
        context.setLineDash([]);
        context.lineCap = "round";
    }

    function drawCollapseFront(index) {
        const ring = ringSpecifications[index];
        const progress = collapseProgress(index);
        if (progress <= 0 || progress >= TAU) {
            return;
        }
        const angle = ring.start + progress;
        const x = centre.x + Math.cos(angle) * ring.radius;
        const y = centre.y + Math.sin(angle) * ring.radius;
        context.save();
        context.translate(x, y);
        context.rotate(angle);
        const dust = context.createRadialGradient(0, 0, 4, 0, 0, ring.width * 1.2);
        dust.addColorStop(0, "rgba(177,111,72,0.42)");
        dust.addColorStop(0.45, "rgba(111,91,72,0.22)");
        dust.addColorStop(1, "rgba(71,61,51,0)");
        context.fillStyle = dust;
        context.beginPath(); context.arc(0, 0, ring.width * 1.2, 0, TAU); context.fill();
        context.fillStyle = "#5e5244";
        context.strokeStyle = "#9b7455";
        context.lineWidth = 2;
        for (let fragment = 0; fragment < 9; fragment += 1) {
            const phase = world.dustPhase * (0.35 + fragment * 0.03) + fragment * 1.7;
            const fx = Math.cos(phase) * (12 + fragment * 4);
            const fy = Math.sin(phase * 1.3) * (ring.width * 0.55);
            context.save(); context.translate(fx, fy); context.rotate(phase);
            context.fillRect(-5, -3, 10 + fragment % 3 * 4, 6); context.strokeRect(-5, -3, 10 + fragment % 3 * 4, 6);
            context.restore();
        }
        context.restore();
    }

    function drawBridge(bridge) {
        context.save();
        context.translate(centre.x, centre.y);
        context.rotate(bridge.angle);
        const segmentLength = bridge.length / bridge.segments.length;
        bridge.segments.forEach((segment, index) => {
            const outer = bridge.outerRadius - index * segmentLength;
            const inner = outer - segmentLength + 2;
            if (segment.collapsed) {
                context.fillStyle = "rgba(0,0,0,0.5)";
                context.fillRect(inner + 5, -bridge.width * 0.5 + 8, segmentLength - 10, bridge.width - 16);
                return;
            }
            const drop = segment.deflection * 4;
            context.save();
            context.translate(0, drop * 0.2);
            context.shadowColor = "rgba(0,0,0,0.72)";
            context.shadowBlur = 8;
            context.shadowOffsetY = 7 + drop;
            const red = 73 + Math.round(segment.damage * 58);
            const green = 78 - Math.round(segment.damage * 18);
            const blue = 71 - Math.round(segment.damage * 18);
            context.fillStyle = `rgb(${red},${green},${blue})`;
            context.strokeStyle = segment.damage > 0.68 ? "#b2674f" : "#8b9188";
            context.lineWidth = 2;
            context.fillRect(inner, -bridge.width * 0.5, segmentLength - 2, bridge.width);
            context.strokeRect(inner, -bridge.width * 0.5, segmentLength - 2, bridge.width);
            context.shadowColor = "transparent";
            context.strokeStyle = "rgba(225,226,216,0.16)";
            context.lineWidth = 1;
            context.beginPath(); context.moveTo(inner + 8, -bridge.width * 0.5 + 7); context.lineTo(outer - 10, -bridge.width * 0.5 + 7); context.moveTo(inner + 8, bridge.width * 0.5 - 7); context.lineTo(outer - 10, bridge.width * 0.5 - 7); context.stroke();
            if (segment.damage > 0.14) {
                context.strokeStyle = `rgba(35,24,20,${0.45 + segment.damage * 0.4})`;
                context.lineWidth = 2;
                const crackX = inner + segmentLength * 0.52;
                context.beginPath();
                context.moveTo(crackX, -bridge.width * 0.46);
                context.lineTo(crackX - 7, -bridge.width * 0.2);
                context.lineTo(crackX + 5, -2);
                context.lineTo(crackX - 4, bridge.width * 0.22);
                context.lineTo(crackX + 8, bridge.width * 0.46);
                context.stroke();
            }
            context.restore();
        });

        const gate = gateInformation(bridge.index);
        const gateX = bridge.outerRadius - 5;
        const retraction = gate.openness * bridge.width * 0.52;
        context.fillStyle = "#252a26";
        context.strokeStyle = "#81877f";
        context.lineWidth = 3;
        context.fillRect(gateX - 12, -bridge.width * 0.5 - 16, 24, 18);
        context.strokeRect(gateX - 12, -bridge.width * 0.5 - 16, 24, 18);
        context.fillRect(gateX - 12, bridge.width * 0.5 - 2, 24, 18);
        context.strokeRect(gateX - 12, bridge.width * 0.5 - 2, 24, 18);
        context.fillStyle = gate.open ? "#6e744f" : gate.openness > 0.15 ? "#9c713c" : "#904a3c";
        context.fillRect(gateX - 5, -bridge.width * 0.5 + retraction, 10, bridge.width * 0.5 - retraction);
        context.fillRect(gateX - 5, 0, 10, bridge.width * 0.5 - retraction);
        context.restore();
    }

    function drawCore() {
        context.save();
        context.translate(centre.x, centre.y);
        context.shadowColor = "rgba(0,0,0,0.78)";
        context.shadowBlur = 20;
        context.shadowOffsetY = 10;
        context.fillStyle = "#282e29";
        context.strokeStyle = "#a78b45";
        context.lineWidth = 7;
        context.beginPath(); context.arc(0, 0, 50, 0, TAU); context.fill(); context.stroke();
        context.shadowColor = "transparent";
        context.strokeStyle = "rgba(222,224,214,0.24)";
        context.lineWidth = 2;
        context.beginPath(); context.arc(0, 0, 36, 0, TAU); context.stroke();
        for (let index = 0; index < 12; index += 1) {
            const angle = index / 12 * TAU;
            context.beginPath(); context.moveTo(Math.cos(angle) * 19, Math.sin(angle) * 19); context.lineTo(Math.cos(angle) * 34, Math.sin(angle) * 34); context.stroke();
        }
        context.fillStyle = "#d0b05b";
        context.font = "500 9px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText("FINISH", 0, -3);
        context.fillStyle = "rgba(226,228,218,0.56)";
        context.font = "500 7px General Sans, sans-serif";
        context.fillText("MERIDIAN 01", 0, 9);
        context.restore();
    }

    function drawVehicle(x, y, heading, colour, number, scale, isPlayer, flash, falling = 0) {
        context.save();
        context.globalAlpha = falling > 0 ? clamp(1 - falling * 0.65, 0.15, 1) : 1;
        context.translate(x, y + falling * 10);
        context.rotate(heading);
        const shrink = falling > 0 ? clamp(1 - falling * 0.18, 0.45, 1) : 1;
        context.scale(scale * shrink, scale * shrink);
        context.shadowColor = "rgba(0,0,0,0.65)";
        context.shadowBlur = 6;
        context.shadowOffsetY = 5;
        context.fillStyle = "#080a08";
        context.fillRect(-17, -13, 9, 4);
        context.fillRect(8, -13, 9, 4);
        context.fillRect(-17, 9, 9, 4);
        context.fillRect(8, 9, 9, 4);
        context.fillStyle = flash > 0.1 ? "#d46a50" : colour;
        context.strokeStyle = isPlayer ? "#f1dea0" : "#c9cec5";
        context.lineWidth = isPlayer ? 2.2 : 1.5;
        context.beginPath();
        context.moveTo(-21, -9); context.lineTo(-13, -13); context.lineTo(10, -13); context.lineTo(21, -7); context.lineTo(21, 7); context.lineTo(10, 13); context.lineTo(-13, 13); context.lineTo(-21, 9); context.closePath();
        context.fill(); context.stroke();
        context.shadowColor = "transparent";
        context.fillStyle = "#1b3132";
        context.strokeStyle = "#829592";
        context.lineWidth = 1.2;
        context.beginPath(); context.moveTo(-3, -9); context.lineTo(10, -8); context.lineTo(14, -3); context.lineTo(-6, -3); context.closePath(); context.fill(); context.stroke();
        context.fillStyle = "rgba(17,20,18,0.72)";
        context.fillRect(-14, -6, 8, 12);
        context.fillStyle = isPlayer ? "#fff0ad" : "#e0e2da";
        context.font = "500 7px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText(String(number).padStart(2, "0"), 6, 7);
        if (isPlayer) {
            context.strokeStyle = "#c6a447";
            context.lineWidth = 2;
            context.beginPath(); context.moveTo(-18, -7); context.lineTo(-18, 7); context.stroke();
        }
        context.restore();
    }

    function drawVehicles() {
        rivals.forEach((rival) => {
            const position = rivalPosition(rival);
            const scale = rival.massClass === "heavy" ? 1.12 : rival.massClass === "light" ? 0.88 : 1;
            drawVehicle(position.x, position.y, position.heading, rival.colour, rival.number, scale, false, rival.flash, rival.active ? 0 : rival.fall);
        });
        drawVehicle(player.x, player.y, player.heading, "#ad8e3d", player.number, 1.12, true, player.collisionFlash, world.result === "fall" || world.result === "pursuer" || world.result === "load-collapse" ? player.fallTime + 0.4 : 0);
    }

    function drawArenaLabels() {
        context.fillStyle = "rgba(223,225,214,0.38)";
        context.font = "500 8px General Sans, sans-serif";
        context.textAlign = "center";
        ringSpecifications.forEach((ring, index) => {
            const angle = ring.gate - 0.22;
            const radius = ring.radius + ring.width * 0.28;
            context.save();
            context.translate(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
            context.rotate(angle + Math.PI / 2);
            context.fillText(`${String(index + 1).padStart(2, "0")} / ${ring.name.toUpperCase()} RING`, 0, 0);
            context.restore();
        });
    }

    function render() {
        const shake = world.shake * 4;
        const offsetX = shake > 0 ? Math.sin(world.time * 47) * shake : 0;
        const offsetY = shake > 0 ? Math.cos(world.time * 39) * shake : 0;
        context.setTransform(world.dpr * world.scaleX, 0, 0, world.dpr * world.scaleY, offsetX, offsetY);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawBackdrop();
        ringSpecifications.forEach((_, index) => drawRing(index));
        bridges.forEach(drawBridge);
        drawCore();
        ringSpecifications.forEach((_, index) => drawCollapseFront(index));
        drawArenaLabels();
        drawVehicles();

        if (world.result !== "racing") {
            context.save();
            context.fillStyle = "rgba(5,7,5,0.36)";
            context.fillRect(0, 0, world.width, world.height);
            context.fillStyle = world.result === "finished" ? "#d6bd6b" : "#d1765b";
            context.font = "500 12px General Sans, sans-serif";
            context.textAlign = "center";
            context.fillText(world.result === "finished" ? "CENTRAL FINISH SECURED" : "HEAT TERMINATED", centre.x, centre.y - 71);
            context.restore();
        }
    }

    function resetHeat() {
        world.time = 0;
        world.result = "racing";
        world.resultDetail = "Heat active";
        world.shake = 0;
        world.dustPhase = 0;
        world.finishers = 0;
        Object.keys(input).forEach((key) => { if (key !== "touched") input[key] = false; });
        input.touched = false;
        createBridges();
        createRivals();
        resetPlayer();
        canvas.dataset.result = "racing";
        resultReadout.textContent = "Racing";
        resetButton.textContent = "Restart heat";
        updateReadouts();
        render();
    }

    function keyControl(code) {
        if (code === "KeyW" || code === "ArrowUp") return "throttle";
        if (code === "KeyS" || code === "ArrowDown") return "brake";
        if (code === "KeyA" || code === "ArrowLeft") return "left";
        if (code === "KeyD" || code === "ArrowRight") return "right";
        return null;
    }

    window.addEventListener("keydown", (event) => {
        const control = keyControl(event.code);
        if (!control || page.hidden) {
            return;
        }
        event.preventDefault();
        input[control] = true;
        input.touched = true;
        controlButtons.find((button) => button.dataset.ringfallControl === control)?.classList.add("is-pressed");
    });

    window.addEventListener("keyup", (event) => {
        const control = keyControl(event.code);
        if (!control) {
            return;
        }
        input[control] = false;
        controlButtons.find((button) => button.dataset.ringfallControl === control)?.classList.remove("is-pressed");
    });

    controlButtons.forEach((button) => {
        const control = button.dataset.ringfallControl;
        const press = (event) => {
            event.preventDefault();
            input[control] = true;
            input.touched = true;
            button.classList.add("is-pressed");
            if (button.setPointerCapture && event.pointerId !== undefined) {
                button.setPointerCapture(event.pointerId);
            }
        };
        const release = (event) => {
            event.preventDefault();
            input[control] = false;
            button.classList.remove("is-pressed");
        };
        button.addEventListener("pointerdown", press);
        button.addEventListener("pointerup", release);
        button.addEventListener("pointercancel", release);
        button.addEventListener("pointerleave", (event) => {
            if (event.buttons === 0) release(event);
        });
    });

    resetButton.addEventListener("click", resetHeat);

    function update(delta) {
        world.time += delta;
        world.dustPhase += delta;
        world.shake = Math.max(0, world.shake - delta * 1.9);
        updateRivals(delta);
        updatePlayer(delta);
        resolvePlayerRivalCollisions();
        player.support = pointSupport(player.x, player.y);
        updateBridgeLoads(delta);
        updateReadouts();
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(width * world.dpr);
        canvas.height = Math.floor(height * world.dpr);
        world.scaleX = width / world.width;
        world.scaleY = height / world.height;
        render();
    }

    resetHeat();

    function animate(time) {
        const delta = Math.min(0.04, Math.max(0, (time - world.lastTime) / 1000));
        world.lastTime = time;
        const visible = !page.hidden && document.visibilityState !== "hidden";
        if (visible) {
            world.wasVisible = true;
            update(delta);
            render();
        } else if (world.wasVisible) {
            world.wasVisible = false;
            world.lastTime = time;
        }
        requestAnimationFrame(animate);
    }

    if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
    } else {
        window.addEventListener("resize", resize);
    }

    window.ringfall = {
        resize,
        reset: resetHeat,
        setControl: (name, active) => {
            if (Object.prototype.hasOwnProperty.call(input, name) && name !== "touched") {
                input[name] = Boolean(active);
                if (active) input.touched = true;
            }
        },
        diagnostics: () => ({
            result: world.result,
            detail: world.resultDetail,
            time: world.time,
            player: {
                x: player.x,
                y: player.y,
                heading: player.heading,
                speed: player.speed,
                ring: player.ring,
                support: player.support,
                progress: playerRaceProgress(),
                integrity: player.integrity
            },
            activeRivals: rivals.filter((rival) => rival.active && !rival.finished).length,
            finishers: rivals.filter((rival) => rival.finished).length,
            bridgeDamage: bridges.map((bridge) => bridge.segments.map((segment) => segment.damage))
        })
    };

    requestAnimationFrame(animate);
})();
