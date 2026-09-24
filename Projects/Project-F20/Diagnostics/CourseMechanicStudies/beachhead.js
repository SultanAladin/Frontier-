"use strict";

(() => {
    const canvas = document.getElementById("beachhead-canvas");
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d", { alpha: false });
    const illustratedMap = typeof Image !== "undefined" ? new Image() : null;
    if (illustratedMap) {
        illustratedMap.decoding = "async";
        illustratedMap.src = "assets/beachhead/illustrated-coastal-field.jpg?v=beach-map-r1";
    }
    const page = document.getElementById("beachhead");
    const surface = canvas.parentElement;
    const startButton = document.getElementById("beach-start");
    const smokeButton = document.getElementById("beach-smoke");
    const lightButton = document.getElementById("beach-light");
    const heavyButton = document.getElementById("beach-heavy");
    const phaseReadout = document.getElementById("beach-phase-readout");
    const healthReadout = document.getElementById("beach-health-readout");
    const patternReadout = document.getElementById("beach-pattern-readout");

    const settings = {
        speed: 48,
        lane: 0,
        sweep: 0.6,
        warning: 1.4,
        configuration: "light"
    };

    const configurations = {
        light: {
            name: "Light",
            integrity: 100,
            acceleration: 1,
            turnRate: 3.25,
            damageScale: 1,
            craterDrag: 0.48,
            size: 0.052,
            smokeCharges: 3,
            color: "#d9dad3"
        },
        heavy: {
            name: "Heavy",
            integrity: 165,
            acceleration: 0.76,
            turnRate: 2.15,
            damageScale: 0.5,
            craterDrag: 0.78,
            size: 0.071,
            smokeCharges: 2,
            color: "#aaaFAA"
        }
    };

    const controls = [
        {
            input: document.getElementById("beach-speed"),
            output: document.getElementById("beach-speed-output"),
            apply: (number) => { settings.speed = number; },
            format: (number) => `${number} km/h`
        },
        {
            input: document.getElementById("beach-lane"),
            output: document.getElementById("beach-lane-output"),
            apply: (number) => { settings.lane = number; },
            format: (number) => number < -4 ? `West ${Math.abs(number)}%` : number > 4 ? `East ${number}%` : "Centre"
        },
        {
            input: document.getElementById("beach-sweep"),
            output: document.getElementById("beach-sweep-output"),
            apply: (number) => { settings.sweep = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("beach-warning"),
            output: document.getElementById("beach-warning-output"),
            apply: (number) => { settings.warning = number / 10; },
            format: (number) => `${(number / 10).toFixed(1)} s`
        }
    ];

    controls.forEach((control) => {
        control.update = () => {
            const number = Number(control.input.value);
            control.apply(number);
            control.output.value = control.format(number);
            control.output.textContent = control.format(number);
            const minimum = Number(control.input.min);
            const maximum = Number(control.input.max);
            const position = ((number - minimum) / (maximum - minimum)) * 100;
            control.input.style.setProperty("--range-position", `${position}%`);
        };
        control.input.addEventListener("input", control.update);
        control.update();
    });

    const vehicle = {
        x: 0,
        y: 0.035,
        lateralVelocity: 0,
        forwardVelocity: 0,
        integrity: 100,
        maxIntegrity: 100,
        phase: "ready",
        status: "Ready",
        smokeCharges: 3,
        smokeCooldown: 0,
        hitFlash: 0,
        collisionCooldown: 0,
        statusTimer: 0
    };

    const barricades = [
        { x: -0.66, y: 0.25, width: 0.58, height: 0.035, angle: -0.18 },
        { x: 0.54, y: 0.35, width: 0.55, height: 0.035, angle: 0.19 },
        { x: -0.48, y: 0.49, width: 0.52, height: 0.035, angle: 0.12 },
        { x: 0.62, y: 0.61, width: 0.5, height: 0.035, angle: -0.17 },
        { x: -0.6, y: 0.73, width: 0.48, height: 0.035, angle: -0.08 },
        { x: 0.36, y: 0.82, width: 0.46, height: 0.035, angle: 0.1 }
    ];

    const walls = [
        { x: -0.88, y: 0.39, width: 0.16, height: 0.18, angle: -0.08 },
        { x: 0.86, y: 0.48, width: 0.17, height: 0.2, angle: 0.07 },
        { x: -0.87, y: 0.6, width: 0.18, height: 0.2, angle: 0.05 },
        { x: 0.87, y: 0.72, width: 0.17, height: 0.19, angle: -0.06 },
        { x: -0.84, y: 0.86, width: 0.2, height: 0.14, angle: 0.08 }
    ];

    const routeWaypoints = [
        { x: 0, y: 0.04 },
        { x: 0.18, y: 0.27 },
        { x: -0.24, y: 0.37 },
        { x: 0.24, y: 0.5 },
        { x: -0.24, y: 0.62 },
        { x: 0.24, y: 0.74 },
        { x: -0.24, y: 0.83 },
        { x: 0, y: 0.97 }
    ];

    function routeXAt(progress) {
        for (let index = 0; index < routeWaypoints.length - 1; index += 1) {
            const start = routeWaypoints[index];
            const end = routeWaypoints[index + 1];
            if (progress <= end.y) {
                const ratio = clamp((progress - start.y) / (end.y - start.y), 0, 1);
                const eased = ratio * ratio * (3 - 2 * ratio);
                return start.x + (end.x - start.x) * eased;
            }
        }
        return routeWaypoints[routeWaypoints.length - 1].x;
    }

    function createMinefield() {
        const mines = [];
        const rows = [0.215, 0.315, 0.425, 0.545, 0.665, 0.775, 0.875];
        let seed = 4119;
        const next = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        rows.forEach((y, rowIndex) => {
            const safeX = routeXAt(y);
            for (let column = 0; column < 9; column += 1) {
                const x = -0.86 + column * 0.215 + (next() - 0.5) * 0.035;
                if (Math.abs(x - safeX) < 0.34) {
                    continue;
                }
                mines.push({
                    x,
                    y: y + (next() - 0.5) * 0.035,
                    radius: 0.024 + next() * 0.008,
                    rotation: next() * Math.PI,
                    detonated: false,
                    flash: 0
                });
            }
            // A second offset mine on alternating rows makes the field dense
            // while preserving one readable anti-vehicle corridor.
            if (rowIndex % 2 === 0) {
                const sideX = safeX > 0 ? safeX - 0.44 : safeX + 0.44;
                mines.push({ x: sideX, y: y + 0.028, radius: 0.028, rotation: next() * Math.PI, detonated: false, flash: 0 });
            }
        });
        return mines;
    }

    const antiVehicleMines = createMinefield();

    const fortifiedChannels = [
        [
            [-1.03, 0.78], [-0.82, 0.81], [-0.68, 0.87], [-0.48, 0.85],
            [-0.31, 0.91], [-0.12, 0.88], [0.05, 0.94], [0.24, 0.9],
            [0.43, 0.95], [0.62, 0.9], [0.82, 0.93], [1.03, 0.88]
        ],
        [
            [-1.02, 0.58], [-0.87, 0.61], [-0.76, 0.66], [-0.61, 0.63],
            [-0.49, 0.69], [-0.34, 0.66]
        ],
        [
            [1.02, 0.48], [0.88, 0.51], [0.78, 0.57], [0.64, 0.54],
            [0.55, 0.61], [0.42, 0.59]
        ]
    ];

    function createTerrainDetails() {
        let seed = 73491;
        const next = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        const details = { shrubs: [], stones: [], puddles: [], debris: [], scars: [] };
        for (let index = 0; index < 64; index += 1) {
            const topCluster = index % 4 === 0;
            const side = next() > 0.5 ? 1 : -1;
            details.shrubs.push({
                x: topCluster ? (next() * 1.9 - 0.95) : side * (0.73 + next() * 0.25),
                y: topCluster ? 0.83 + next() * 0.16 : 0.24 + next() * 0.72,
                radius: 0.018 + next() * 0.052,
                tone: next()
            });
        }
        for (let index = 0; index < 115; index += 1) {
            details.stones.push({
                x: next() * 1.9 - 0.95,
                y: 0.19 + next() * 0.76,
                radius: 0.002 + next() * 0.009,
                tone: next()
            });
        }
        for (let index = 0; index < 13; index += 1) {
            details.puddles.push({
                x: next() * 1.7 - 0.85,
                y: 0.28 + next() * 0.58,
                width: 0.035 + next() * 0.095,
                height: 0.012 + next() * 0.032,
                angle: (next() - 0.5) * 1.2
            });
        }
        for (let index = 0; index < 28; index += 1) {
            details.debris.push({
                x: next() * 1.78 - 0.89,
                y: 0.2 + next() * 0.72,
                length: 0.018 + next() * 0.055,
                angle: next() * Math.PI,
                tone: next()
            });
        }
        for (let index = 0; index < 16; index += 1) {
            details.scars.push({
                x: next() * 1.76 - 0.88,
                y: 0.3 + next() * 0.6,
                radius: 0.018 + next() * 0.045,
                seed: next() * 900
            });
        }
        return details;
    }

    const terrainDetails = createTerrainDetails();

    const world = {
        width: 1000,
        height: 650,
        dpr: 1,
        time: 0,
        runTime: 0,
        patternTime: 0,
        pattern: "lane",
        tracerTimer: 0,
        impactTimer: 1.25,
        tracers: [],
        impacts: [],
        craters: [],
        smoke: [],
        randomState: 92317,
        pointerActive: false
    };

    let lastTime = performance.now();

    function random() {
        world.randomState = (world.randomState * 1664525 + 1013904223) >>> 0;
        return world.randomState / 4294967296;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function moveToward(value, target, amount) {
        if (value < target) {
            return Math.min(target, value + amount);
        }
        return Math.max(target, value - amount);
    }

    function roundedRectangle(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, Math.abs(width) * 0.5, Math.abs(height) * 0.5);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.arcTo(x + width, y, x + width, y + r, r);
        ctx.lineTo(x + width, y + height - r);
        ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
        ctx.lineTo(x + r, y + height);
        ctx.arcTo(x, y + height, x, y + height - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    function activeConfiguration() {
        return configurations[settings.configuration];
    }

    function applyConfiguration(name) {
        const previousRatio = vehicle.maxIntegrity > 0 ? vehicle.integrity / vehicle.maxIntegrity : 1;
        settings.configuration = name;
        const configuration = activeConfiguration();
        vehicle.maxIntegrity = configuration.integrity;
        vehicle.integrity = clamp(previousRatio * configuration.integrity, 0, configuration.integrity);
        vehicle.smokeCharges = Math.min(vehicle.smokeCharges, configuration.smokeCharges);
        lightButton.classList.toggle("is-active", name === "light");
        heavyButton.classList.toggle("is-active", name === "heavy");
        smokeButton.textContent = `Deploy smoke · ${vehicle.smokeCharges}`;
    }

    lightButton.addEventListener("click", () => applyConfiguration("light"));
    heavyButton.addEventListener("click", () => applyConfiguration("heavy"));

    function resetRun(ready = true) {
        const configuration = activeConfiguration();
        vehicle.x = 0;
        vehicle.y = 0.035;
        vehicle.lateralVelocity = 0;
        vehicle.forwardVelocity = 0;
        vehicle.maxIntegrity = configuration.integrity;
        vehicle.integrity = configuration.integrity;
        vehicle.phase = ready ? "ready" : "running";
        vehicle.status = ready ? "Ready" : "Advancing";
        vehicle.smokeCharges = configuration.smokeCharges;
        vehicle.smokeCooldown = 0;
        vehicle.hitFlash = 0;
        vehicle.collisionCooldown = 0;
        vehicle.statusTimer = 0;
        world.runTime = 0;
        world.patternTime = 0;
        world.pattern = "lane";
        world.tracerTimer = 0;
        world.impactTimer = 1.25;
        world.tracers = [];
        world.impacts = [];
        world.craters = [];
        world.smoke = [];
        antiVehicleMines.forEach((mine) => {
            mine.detonated = false;
            mine.flash = 0;
        });
        world.randomState = 92317;
        startButton.textContent = ready ? "Start run" : "Reset run";
        smokeButton.textContent = `Deploy smoke · ${vehicle.smokeCharges}`;
    }

    function startRun() {
        if (vehicle.phase === "running") {
            resetRun(true);
            return;
        }
        resetRun(false);
    }

    startButton.addEventListener("click", startRun);

    function smokeCovers(x, y) {
        return world.smoke.some((cloud) => Math.hypot(cloud.x - x, (cloud.y - y) * 1.6) < cloud.radius);
    }

    function deploySmoke() {
        if (vehicle.phase !== "running" || vehicle.smokeCharges <= 0 || vehicle.smokeCooldown > 0) {
            return;
        }
        vehicle.smokeCharges -= 1;
        vehicle.smokeCooldown = 0.9;
        for (let index = 0; index < 7; index += 1) {
            world.smoke.push({
                x: vehicle.x + (random() - 0.5) * 0.12,
                y: vehicle.y + (random() - 0.5) * 0.035,
                radius: 0.035 + random() * 0.025,
                life: 6.5 - index * 0.18,
                drift: (random() - 0.5) * 0.025
            });
        }
        vehicle.status = "Smoke deployed";
        vehicle.statusTimer = 1;
        smokeButton.textContent = `Deploy smoke · ${vehicle.smokeCharges}`;
    }

    smokeButton.addEventListener("click", deploySmoke);

    function spawnTracer() {
        if (world.pattern === "lane") {
            const lanes = [-0.55, 0, 0.55];
            const laneIndex = Math.floor(world.patternTime / 0.72) % lanes.length;
            const sweep = Math.sin(world.time * 1.7) * 0.12;
            world.tracers.push({
                x: lanes[laneIndex] + sweep,
                y: 1.03,
                vx: sweep * 0.1,
                vy: -0.92,
                life: 1.28,
                hit: false
            });
            return;
        }

        const fromLeft = Math.floor(world.patternTime * 3.2) % 2 === 0;
        const targetX = Math.sin(world.time * 1.35) * 0.58;
        const startX = fromLeft ? -1.08 : 1.08;
        const startY = 0.82 + Math.sin(world.time * 0.8) * 0.08;
        const dx = targetX - startX;
        const dy = 0.08 - startY;
        const length = Math.hypot(dx, dy) || 1;
        world.tracers.push({
            x: startX,
            y: startY,
            vx: dx / length * 1.15,
            vy: dy / length * 1.15,
            life: 1.8,
            hit: false
        });
    }

    function spawnImpact() {
        const covered = smokeCovers(vehicle.x, vehicle.y);
        const prediction = clamp(
            routeXAt(Math.min(0.96, vehicle.y + 0.18)) + settings.lane / 100 * 0.3,
            -0.82,
            0.82
        );
        const error = covered ? (random() - 0.5) * 1.1 : (random() - 0.5) * 0.36;
        world.impacts.push({
            x: clamp(prediction + error, -0.86, 0.86),
            y: clamp(vehicle.y + 0.16 + random() * 0.2, 0.18, 0.9),
            radius: 0.105 + random() * 0.035,
            timer: settings.warning,
            initialTimer: settings.warning,
            blast: 0,
            detonated: false
        });
        world.impactTimer = 1.75 + random() * 1.65;
    }

    function damageVehicle(amount, status) {
        if (vehicle.phase !== "running") {
            return;
        }
        vehicle.integrity -= amount * activeConfiguration().damageScale;
        vehicle.hitFlash = 0.28;
        vehicle.status = status;
        vehicle.statusTimer = 0.72;
        if (vehicle.integrity <= 0) {
            vehicle.integrity = 0;
            vehicle.phase = "failed";
            vehicle.status = "Disabled";
            startButton.textContent = "Recover rover";
        }
    }

    function updateTracers(delta) {
        world.tracerTimer -= delta;
        const interval = 0.24 - settings.sweep * 0.145;
        if (world.tracerTimer <= 0) {
            spawnTracer();
            world.tracerTimer = interval;
        }

        world.tracers.forEach((tracer) => {
            tracer.x += tracer.vx * delta;
            tracer.y += tracer.vy * delta;
            tracer.life -= delta;
            if (!tracer.hit && Math.hypot((tracer.x - vehicle.x) * 0.75, tracer.y - vehicle.y) < activeConfiguration().size + 0.025) {
                tracer.hit = true;
                tracer.life = 0;
                if (!smokeCovers(vehicle.x, vehicle.y)) {
                    damageVehicle(3.2, "Tracer contact");
                }
            }
        });
        world.tracers = world.tracers.filter((tracer) => tracer.life > 0 && tracer.y > -0.08 && Math.abs(tracer.x) < 1.25);
    }

    function updateImpacts(delta) {
        world.impactTimer -= delta;
        if (world.impactTimer <= 0) {
            spawnImpact();
        }

        world.impacts.forEach((impact) => {
            if (!impact.detonated) {
                impact.timer -= delta;
                if (impact.timer <= 0) {
                    impact.detonated = true;
                    impact.blast = 0.42;
                    world.craters.push({ x: impact.x, y: impact.y, radius: impact.radius * 0.78, seed: random() * 900 });
                    const distance = Math.hypot((impact.x - vehicle.x) * 0.75, impact.y - vehicle.y);
                    if (distance < impact.radius * 1.28) {
                        damageVehicle(32, "Blast impact");
                        vehicle.lateralVelocity += Math.sign(vehicle.x - impact.x || 1) * 0.34;
                    }
                }
            } else {
                impact.blast -= delta;
            }
        });
        world.impacts = world.impacts.filter((impact) => !impact.detonated || impact.blast > 0);
    }

    function updateSmoke(delta) {
        world.smoke.forEach((cloud) => {
            cloud.life -= delta;
            cloud.radius = Math.min(0.24, cloud.radius + delta * 0.027);
            cloud.x += cloud.drift * delta;
            cloud.y -= delta * 0.006;
        });
        world.smoke = world.smoke.filter((cloud) => cloud.life > 0);
    }

    function updateFieldCollisions(delta) {
        vehicle.collisionCooldown = Math.max(0, vehicle.collisionCooldown - delta);
        if (vehicle.collisionCooldown > 0) {
            return;
        }
        const configuration = activeConfiguration();
        barricades.forEach((barricade) => {
            const dx = vehicle.x - barricade.x;
            const dy = vehicle.y - barricade.y;
            if (Math.abs(dx) < barricade.width * 0.5 + configuration.size && Math.abs(dy) < barricade.height + 0.022) {
                const side = Math.sign(dx || vehicle.lateralVelocity || 1);
                vehicle.x += side * 0.055;
                vehicle.lateralVelocity += side * 0.22;
                vehicle.forwardVelocity *= 0.42;
                vehicle.collisionCooldown = 0.52;
                damageVehicle(9, "Barricade strike");
            }
        });

        walls.forEach((wall) => {
            const dx = vehicle.x - wall.x;
            const dy = vehicle.y - wall.y;
            if (Math.abs(dx) < wall.width * 0.5 + configuration.size && Math.abs(dy) < wall.height * 0.5 + 0.02) {
                const side = Math.sign(dx || vehicle.lateralVelocity || 1);
                vehicle.x += side * 0.07;
                vehicle.lateralVelocity += side * 0.28;
                vehicle.forwardVelocity *= 0.28;
                vehicle.collisionCooldown = 0.62;
                damageVehicle(13, "Wall strike");
            }
        });

        antiVehicleMines.forEach((mine) => {
            if (mine.detonated || vehicle.phase !== "running") {
                return;
            }
            const distance = Math.hypot((mine.x - vehicle.x) * 0.78, mine.y - vehicle.y);
            if (distance < mine.radius + configuration.size * 0.72) {
                mine.detonated = true;
                mine.flash = 0.42;
                world.craters.push({
                    x: mine.x,
                    y: mine.y,
                    radius: mine.radius * 2.35,
                    seed: random() * 900
                });
                const push = Math.sign(vehicle.x - mine.x || 1);
                vehicle.lateralVelocity += push * 0.46;
                vehicle.forwardVelocity *= 0.34;
                vehicle.collisionCooldown = 0.7;
                damageVehicle(68, "Anti-vehicle mine");
            }
        });
    }

    function updateVehicle(delta) {
        const configuration = activeConfiguration();
        const targetForward = settings.speed / 720 * configuration.acceleration;
        let craterMultiplier = 1;
        world.craters.forEach((crater) => {
            if (Math.hypot((crater.x - vehicle.x) * 0.75, crater.y - vehicle.y) < crater.radius) {
                craterMultiplier = configuration.craterDrag;
                vehicle.status = "Crater drag";
                vehicle.statusTimer = Math.max(vehicle.statusTimer, 0.08);
            }
        });
        vehicle.forwardVelocity = moveToward(vehicle.forwardVelocity, targetForward * craterMultiplier, delta * 0.12);
        vehicle.y += vehicle.forwardVelocity * delta;

        // The rover follows the physical gaps between alternating walls and
        // mine rows. The approach-lane input biases that route instead of
        // reducing the run to a straight centre-line drive.
        const routeTarget = routeXAt(Math.min(0.98, vehicle.y + 0.055));
        const laneBias = settings.lane / 100 * 0.3;
        const targetX = clamp(routeTarget + laneBias, -0.84, 0.84);
        const desiredLateralVelocity = (targetX - vehicle.x) * configuration.turnRate;
        vehicle.lateralVelocity = moveToward(vehicle.lateralVelocity, desiredLateralVelocity, delta * configuration.turnRate * 1.55);
        vehicle.lateralVelocity *= Math.exp(-delta * 0.52);
        vehicle.x += vehicle.lateralVelocity * delta;
        vehicle.smokeCooldown = Math.max(0, vehicle.smokeCooldown - delta);
        vehicle.hitFlash = Math.max(0, vehicle.hitFlash - delta);
        vehicle.statusTimer = Math.max(0, vehicle.statusTimer - delta);

        updateFieldCollisions(delta);
        if (vehicle.phase !== "running") {
            return;
        }

        if (Math.abs(vehicle.x) > 0.96) {
            vehicle.phase = "failed";
            vehicle.status = "Channel departure";
            startButton.textContent = "Recover rover";
        } else if (vehicle.y >= 0.955) {
            vehicle.phase = "finished";
            vehicle.status = "Extracted";
            startButton.textContent = "Run again";
        } else if (vehicle.statusTimer <= 0) {
            vehicle.status = smokeCovers(vehicle.x, vehicle.y) ? "Under smoke" : "Advancing";
        }
    }

    function update(delta) {
        world.time += delta;
        if (vehicle.phase === "running") {
            world.runTime += delta;
            world.patternTime += delta;
            if (world.patternTime >= 5.8) {
                world.patternTime = 0;
                world.pattern = world.pattern === "lane" ? "cross" : "lane";
            }
            updateSmoke(delta);
            updateTracers(delta);
            if (vehicle.phase === "running") updateImpacts(delta);
            if (vehicle.phase === "running") updateVehicle(delta);
        } else {
            updateSmoke(delta);
        }

        phaseReadout.textContent = vehicle.status;
        healthReadout.textContent = `${Math.round(vehicle.integrity / vehicle.maxIntegrity * 100)}%`;
        patternReadout.textContent = world.pattern === "lane" ? "Lane burst" : "Crossing fire";
        smokeButton.textContent = `Deploy smoke · ${vehicle.smokeCharges}`;
    }

    function layout() {
        const horizontalMargin = Math.max(52, world.width * 0.08);
        return {
            left: horizontalMargin,
            right: world.width - horizontalMargin,
            top: 88,
            bottom: world.height - 45,
            width: world.width - horizontalMargin * 2,
            height: world.height - 133
        };
    }

    function screenX(value, frame) {
        return (frame.left + frame.right) * 0.5 + value * frame.width * 0.46;
    }

    function screenY(value, frame) {
        return frame.bottom - value * frame.height;
    }

    function shorelineAt(normalizedX) {
        return 0.185
            + Math.sin(normalizedX * 4.2 + 0.7) * 0.014
            + Math.sin(normalizedX * 11.7 - 0.4) * 0.006;
    }

    function organicPath(ctx, x, y, radiusX, radiusY, seed, points = 18) {
        ctx.beginPath();
        for (let index = 0; index <= points; index += 1) {
            const angle = index / points * Math.PI * 2;
            const variation = 0.86
                + Math.sin(seed + index * 2.17) * 0.08
                + Math.sin(seed * 0.37 + index * 5.31) * 0.05;
            const px = x + Math.cos(angle) * radiusX * variation;
            const py = y + Math.sin(angle) * radiusY * variation;
            if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    function drawShrub(ctx, shrub, frame) {
        const x = screenX(shrub.x, frame);
        const y = screenY(shrub.y, frame);
        const radius = shrub.radius * frame.width * 0.46;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "rgba(23,30,19,0.22)";
        ctx.beginPath();
        ctx.ellipse(radius * 0.2, radius * 0.35, radius * 1.08, radius * 0.76, 0.34, 0, Math.PI * 2);
        ctx.fill();
        const lobes = 8;
        for (let index = 0; index < lobes; index += 1) {
            const angle = index / lobes * Math.PI * 2 + shrub.tone;
            const distance = radius * (0.32 + (index % 3) * 0.06);
            const lobeRadius = radius * (0.34 + ((index * 7) % 4) * 0.04);
            ctx.fillStyle = index % 2
                ? `rgba(72,101,49,${0.76 + shrub.tone * 0.14})`
                : `rgba(94,123,64,${0.72 + shrub.tone * 0.12})`;
            ctx.strokeStyle = "rgba(26,43,24,0.7)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, lobeRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.fillStyle = "rgba(32,57,28,0.92)";
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawIllustratedMap(ctx, frame) {
        if (!illustratedMap || !illustratedMap.complete || illustratedMap.naturalWidth < 10) {
            return false;
        }
        const imageRatio = illustratedMap.naturalWidth / illustratedMap.naturalHeight;
        const canvasRatio = world.width / world.height;
        if (canvasRatio < 0.9) {
            // Preserve every obstacle on narrow screens; slight horizontal
            // compression is preferable to cropping away the minefields.
            ctx.drawImage(illustratedMap, 0, 0, world.width, world.height);
        } else if (canvasRatio > imageRatio) {
            const sourceHeight = illustratedMap.naturalWidth / canvasRatio;
            const sourceY = (illustratedMap.naturalHeight - sourceHeight) * 0.5;
            ctx.drawImage(
                illustratedMap,
                0, sourceY, illustratedMap.naturalWidth, sourceHeight,
                0, 0, world.width, world.height
            );
        } else {
            const sourceWidth = illustratedMap.naturalHeight * canvasRatio;
            const sourceX = (illustratedMap.naturalWidth - sourceWidth) * 0.5;
            ctx.drawImage(
                illustratedMap,
                sourceX, 0, sourceWidth, illustratedMap.naturalHeight,
                0, 0, world.width, world.height
            );
        }

        // Integrate the live water with the painted map instead of placing a
        // static photograph under unrelated effects.
        const shorelineY = screenY(0.185, frame);
        const waterSheen = ctx.createLinearGradient(0, shorelineY, 0, world.height);
        waterSheen.addColorStop(0, "rgba(75,174,169,0)");
        waterSheen.addColorStop(1, "rgba(20,92,100,0.18)");
        ctx.fillStyle = waterSheen;
        ctx.fillRect(0, shorelineY, world.width, world.height - shorelineY);
        for (let foamLine = 0; foamLine < 2; foamLine += 1) {
            ctx.strokeStyle = `rgba(238,242,224,${0.4 - foamLine * 0.13})`;
            ctx.lineWidth = 2.4 - foamLine * 0.5;
            ctx.beginPath();
            for (let x = 0; x <= world.width; x += 9) {
                const normalizedX = clamp((x - world.width * 0.5) / (frame.width * 0.46), -1.25, 1.25);
                const y = screenY(
                    shorelineAt(normalizedX) + foamLine * 0.011
                    + Math.sin(x * 0.05 + world.time * 1.6) * 0.004,
                    frame
                );
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        return true;
    }

    function drawTerrain(ctx, frame) {
        if (drawIllustratedMap(ctx, frame)) {
            return;
        }
        const sand = ctx.createLinearGradient(0, frame.top, 0, frame.bottom);
        sand.addColorStop(0, "#4a493a");
        sand.addColorStop(0.24, "#69634d");
        sand.addColorStop(0.72, "#9b8e6e");
        sand.addColorStop(1, "#4c7777");
        ctx.fillStyle = sand;
        ctx.fillRect(0, 0, world.width, world.height);

        // Layered dry-soil washes create the hand-painted contour variation.
        for (let band = 0; band < 9; band += 1) {
            const y = frame.top + 24 + band * frame.height * 0.095;
            ctx.strokeStyle = band % 2 ? "rgba(54,49,37,0.1)" : "rgba(225,214,180,0.055)";
            ctx.lineWidth = 14 + band % 3 * 7;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(
                world.width * 0.24, y + Math.sin(band) * 29,
                world.width * 0.7, y - Math.cos(band * 1.7) * 34,
                world.width, y + Math.sin(band * 0.6) * 21
            );
            ctx.stroke();
        }

        // Wet sand follows an irregular shoreline rather than a straight band.
        ctx.fillStyle = "#b7aa91";
        ctx.beginPath();
        ctx.moveTo(0, world.height);
        for (let x = 0; x <= world.width; x += 14) {
            const normalizedX = clamp((x - world.width * 0.5) / (frame.width * 0.46), -1.25, 1.25);
            ctx.lineTo(x, screenY(shorelineAt(normalizedX) + 0.075, frame));
        }
        ctx.lineTo(world.width, world.height);
        ctx.closePath();
        ctx.fill();

        const water = ctx.createLinearGradient(0, frame.top, 0, frame.bottom);
        water.addColorStop(0, "#58a8a6");
        water.addColorStop(0.52, "#347e82");
        water.addColorStop(1, "#14515a");
        ctx.fillStyle = water;
        ctx.beginPath();
        ctx.moveTo(0, world.height);
        for (let x = 0; x <= world.width; x += 12) {
            const normalizedX = clamp((x - world.width * 0.5) / (frame.width * 0.46), -1.25, 1.25);
            const wave = Math.sin(x * 0.041 + world.time * 1.35) * 0.004;
            ctx.lineTo(x, screenY(shorelineAt(normalizedX) + wave, frame));
        }
        ctx.lineTo(world.width, world.height);
        ctx.closePath();
        ctx.fill();

        // Water caustics and parallel foam traces are animated but subdued.
        ctx.strokeStyle = "rgba(190,230,220,0.16)";
        ctx.lineWidth = 1;
        for (let index = 0; index < 42; index += 1) {
            const x = ((index * 83) % 997) / 997 * world.width;
            const y = screenY(0.025 + ((index * 47) % 140) / 1000, frame);
            const width = 16 + index % 6 * 8;
            ctx.beginPath();
            ctx.ellipse(x, y, width, 4 + index % 3 * 2, (index % 5 - 2) * 0.18, 0, Math.PI * 1.55);
            ctx.stroke();
        }
        for (let foamLine = 0; foamLine < 3; foamLine += 1) {
            ctx.strokeStyle = `rgba(226,235,219,${0.46 - foamLine * 0.12})`;
            ctx.lineWidth = 3 - foamLine * 0.55;
            ctx.beginPath();
            for (let x = 0; x <= world.width; x += 10) {
                const normalizedX = clamp((x - world.width * 0.5) / (frame.width * 0.46), -1.25, 1.25);
                const y = screenY(
                    shorelineAt(normalizedX) + foamLine * 0.012
                    + Math.sin(x * 0.052 + world.time * (1.7 - foamLine * 0.2)) * 0.004,
                    frame
                );
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Faint paired vehicle tracks curve between the physical channels.
        ctx.strokeStyle = "rgba(56,52,39,0.16)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 7]);
        for (const offset of [-8, 8]) {
            ctx.beginPath();
            ctx.moveTo(screenX(0, frame) + offset, screenY(0.18, frame));
            ctx.bezierCurveTo(
                screenX(-0.24, frame) + offset, screenY(0.42, frame),
                screenX(0.3, frame) + offset, screenY(0.65, frame),
                screenX(0.05, frame) + offset, screenY(0.96, frame)
            );
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Puddles, embedded stones, wreckage and old impact scars build a dense map texture.
        terrainDetails.puddles.forEach((puddle) => {
            const x = screenX(puddle.x, frame);
            const y = screenY(puddle.y, frame);
            const width = puddle.width * frame.width * 0.46;
            const height = puddle.height * frame.height;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(puddle.angle);
            ctx.fillStyle = "rgba(39,67,66,0.5)";
            ctx.strokeStyle = "rgba(28,43,40,0.48)";
            ctx.beginPath();
            ctx.ellipse(0, 0, width, height, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = "rgba(191,211,198,0.18)";
            ctx.beginPath();
            ctx.arc(-width * 0.2, -height * 0.14, Math.max(2, height * 0.32), Math.PI, Math.PI * 1.8);
            ctx.stroke();
            ctx.restore();
        });

        terrainDetails.scars.forEach((scar) => {
            const x = screenX(scar.x, frame);
            const y = screenY(scar.y, frame);
            const radius = scar.radius * frame.width * 0.46;
            ctx.fillStyle = "rgba(46,42,31,0.34)";
            organicPath(ctx, x, y, radius, radius * 0.68, scar.seed, 15);
            ctx.fill();
            ctx.strokeStyle = "rgba(28,27,22,0.28)";
            ctx.stroke();
        });

        terrainDetails.stones.forEach((stone) => {
            const x = screenX(stone.x, frame);
            const y = screenY(stone.y, frame);
            const radius = stone.radius * frame.width * 0.46;
            ctx.fillStyle = stone.tone > 0.5 ? "rgba(74,69,54,0.58)" : "rgba(116,106,80,0.5)";
            ctx.beginPath();
            ctx.ellipse(x, y, radius * 1.3, radius, stone.tone * 2.4, 0, Math.PI * 2);
            ctx.fill();
        });

        terrainDetails.debris.forEach((debris) => {
            const x = screenX(debris.x, frame);
            const y = screenY(debris.y, frame);
            const length = debris.length * frame.width * 0.46;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(debris.angle);
            ctx.strokeStyle = debris.tone > 0.55 ? "rgba(42,43,38,0.68)" : "rgba(89,63,42,0.62)";
            ctx.lineWidth = 2 + debris.tone * 2;
            ctx.beginPath();
            ctx.moveTo(-length * 0.5, 0);
            ctx.lineTo(length * 0.5, 0);
            ctx.stroke();
            ctx.restore();
        });

        terrainDetails.shrubs.forEach((shrub) => drawShrub(ctx, shrub, frame));
    }

    function drawFortifiedChannels(ctx, frame) {
        fortifiedChannels.forEach((channel) => {
            const screenPoints = channel.map(([x, y]) => [screenX(x, frame), screenY(y, frame)]);
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "rgba(31,29,23,0.72)";
            ctx.lineWidth = 40;
            ctx.beginPath();
            screenPoints.forEach((point, index) => {
                if (index === 0) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]);
            });
            ctx.stroke();
            ctx.strokeStyle = "rgba(77,66,47,0.92)";
            ctx.lineWidth = 27;
            ctx.stroke();
            ctx.strokeStyle = "rgba(45,39,29,0.88)";
            ctx.lineWidth = 11;
            ctx.stroke();

            for (let segment = 0; segment < screenPoints.length - 1; segment += 1) {
                const start = screenPoints[segment];
                const end = screenPoints[segment + 1];
                const dx = end[0] - start[0];
                const dy = end[1] - start[1];
                const length = Math.hypot(dx, dy) || 1;
                const normalX = -dy / length;
                const normalY = dx / length;
                const bags = Math.max(2, Math.floor(length / 12));
                for (let bag = 0; bag <= bags; bag += 1) {
                    const ratio = bag / bags;
                    const x = start[0] + dx * ratio;
                    const y = start[1] + dy * ratio;
                    for (const side of [-1, 1]) {
                        ctx.save();
                        ctx.translate(x + normalX * 15 * side, y + normalY * 15 * side);
                        ctx.rotate(Math.atan2(dy, dx));
                        ctx.fillStyle = side > 0 ? "#a69a7a" : "#8e846a";
                        ctx.strokeStyle = "rgba(48,43,33,0.72)";
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.ellipse(0, 0, 7, 4.6, 0, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                        ctx.restore();
                    }
                }
            }
        });
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
    }

    function drawMinefields(ctx, frame) {
        // Wire/stake boundaries make the grouped anti-vehicle mine rows read
        // as actual minefields rather than isolated decorative dots.
        const rowValues = [0.215, 0.315, 0.425, 0.545, 0.665, 0.775, 0.875];
        rowValues.forEach((row, index) => {
            const y = screenY(row, frame);
            ctx.strokeStyle = "rgba(60,57,43,0.34)";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 8]);
            ctx.beginPath();
            ctx.moveTo(screenX(-0.94, frame), y);
            ctx.lineTo(screenX(0.94, frame), y);
            ctx.stroke();
            ctx.setLineDash([]);
            if (index === 0 || index === 3 || index === 6) {
                const signX = screenX(index % 2 ? 0.9 : -0.9, frame);
                ctx.save();
                ctx.translate(signX, y - 10);
                ctx.rotate(index % 2 ? 0.08 : -0.08);
                ctx.fillStyle = "#a99463";
                ctx.strokeStyle = "rgba(46,40,29,0.78)";
                ctx.lineWidth = 1;
                ctx.fillRect(-22, -8, 44, 16);
                ctx.strokeRect(-22, -8, 44, 16);
                ctx.fillStyle = "#3b3529";
                ctx.font = "600 6px 'General Sans', sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("A-V MINEFIELD", 0, 2);
                ctx.restore();
            }
        });

        antiVehicleMines.forEach((mine) => {
            if (mine.detonated) {
                return;
            }
            const x = screenX(mine.x, frame);
            const y = screenY(mine.y, frame);
            const radius = Math.max(6, mine.radius * frame.width * 0.46);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(mine.rotation);
            ctx.fillStyle = "rgba(22,22,18,0.32)";
            ctx.beginPath();
            ctx.ellipse(3, 4, radius * 1.08, radius * 0.72, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#4b5142";
            ctx.strokeStyle = "rgba(20,24,20,0.88)";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.ellipse(0, 0, radius, radius * 0.72, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#69705b";
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.43, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(204,197,163,0.34)";
            ctx.lineWidth = 1;
            for (let prong = 0; prong < 3; prong += 1) {
                const angle = prong / 3 * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(Math.cos(angle) * radius * 0.28, Math.sin(angle) * radius * 0.28);
                ctx.lineTo(Math.cos(angle) * radius * 0.78, Math.sin(angle) * radius * 0.56);
                ctx.stroke();
            }
            ctx.restore();
        });
    }

    function drawWalls(ctx, frame) {
        walls.forEach((wall, wallIndex) => {
            const x = screenX(wall.x, frame);
            const y = screenY(wall.y, frame);
            const width = wall.width * frame.width * 0.46;
            const height = wall.height * frame.height;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(wall.angle);
            ctx.fillStyle = "rgba(24,24,21,0.34)";
            roundedRectangle(ctx, -width * 0.5 + 5, -height * 0.5 + 6, width, height, 5);
            ctx.fill();
            ctx.fillStyle = wallIndex % 2 ? "#76766c" : "#858377";
            ctx.strokeStyle = "rgba(43,42,36,0.86)";
            ctx.lineWidth = 2;
            roundedRectangle(ctx, -width * 0.5, -height * 0.5, width, height, 5);
            ctx.fill();
            ctx.stroke();
            const blocks = Math.max(2, Math.floor(height / 18));
            for (let block = 1; block < blocks; block += 1) {
                const blockY = -height * 0.5 + block / blocks * height;
                ctx.strokeStyle = "rgba(42,41,36,0.42)";
                ctx.beginPath();
                ctx.moveTo(-width * 0.5, blockY);
                ctx.lineTo(width * 0.5, blockY);
                ctx.stroke();
            }
            ctx.fillStyle = "rgba(182,106,69,0.58)";
            for (let mark = -height * 0.34; mark < height * 0.38; mark += 23) {
                ctx.fillRect(-width * 0.5 + 3, mark, width - 6, 5);
            }
            ctx.restore();
        });
    }

    function drawBarricades(ctx, frame) {
        barricades.forEach((barricade, barricadeIndex) => {
            const x = screenX(barricade.x, frame);
            const y = screenY(barricade.y, frame);
            const width = barricade.width * frame.width * 0.46;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(barricade.angle);
            ctx.fillStyle = "rgba(34,31,24,0.72)";
            roundedRectangle(ctx, -width * 0.5 - 7, -15, width + 14, 30, 10);
            ctx.fill();
            ctx.fillStyle = "rgba(77,65,47,0.8)";
            roundedRectangle(ctx, -width * 0.5, -10, width, 20, 6);
            ctx.fill();

            // Uneven timber floor and two sandbag lips give each obstacle real construction.
            for (let plank = -width * 0.42; plank < width * 0.44; plank += 14) {
                ctx.fillStyle = plank % 3 ? "#66513b" : "#735c42";
                ctx.fillRect(plank, -7, 10, 14);
                ctx.strokeStyle = "rgba(32,26,20,0.54)";
                ctx.strokeRect(plank, -7, 10, 14);
            }
            const bags = Math.max(4, Math.floor(width / 13));
            for (let bag = 0; bag <= bags; bag += 1) {
                const bagX = -width * 0.5 + bag / bags * width;
                for (const side of [-1, 1]) {
                    ctx.fillStyle = (bag + side + barricadeIndex) % 2 ? "#aaa080" : "#91866b";
                    ctx.strokeStyle = "rgba(45,40,31,0.72)";
                    ctx.beginPath();
                    ctx.ellipse(bagX, side * 10, 7.2, 4.5, bag % 2 ? 0.12 : -0.1, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }
            ctx.restore();
        });
    }

    function drawCraters(ctx, frame) {
        world.craters.forEach((crater) => {
            const x = screenX(crater.x, frame);
            const y = screenY(crater.y, frame);
            const radius = crater.radius * frame.width * 0.46;
            ctx.fillStyle = "rgba(28,27,22,0.42)";
            organicPath(ctx, x + 3, y + 5, radius * 1.18, radius * 0.82, crater.seed + 3, 18);
            ctx.fill();
            const gradient = ctx.createRadialGradient(x, y, 2, x, y, radius);
            gradient.addColorStop(0, "rgba(23,24,21,0.95)");
            gradient.addColorStop(0.58, "rgba(48,43,32,0.88)");
            gradient.addColorStop(0.8, "rgba(117,101,69,0.82)");
            gradient.addColorStop(1, "rgba(164,143,99,0.2)");
            ctx.fillStyle = gradient;
            organicPath(ctx, x, y, radius, radius * 0.7, crater.seed, 20);
            ctx.fill();
            ctx.strokeStyle = "rgba(30,28,22,0.62)";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = "rgba(24,23,20,0.72)";
            organicPath(ctx, x, y + radius * 0.04, radius * 0.52, radius * 0.34, crater.seed + 8, 14);
            ctx.fill();
        });
    }

    function drawImpacts(ctx, frame) {
        world.impacts.forEach((impact) => {
            const x = screenX(impact.x, frame);
            const y = screenY(impact.y, frame);
            const radius = impact.radius * frame.width * 0.46;
            if (!impact.detonated) {
                const ratio = clamp(impact.timer / impact.initialTimer, 0, 1);
                ctx.strokeStyle = `rgba(226,78,73,${0.5 + (1 - ratio) * 0.42})`;
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(x, y, radius * (0.22 + ratio * 0.78), 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = "rgba(226,120,112,0.86)";
                ctx.font = "500 8px 'General Sans', sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(`${impact.timer.toFixed(1)}s`, x, y + 3);
            } else {
                ctx.fillStyle = `rgba(235,149,94,${clamp(impact.blast * 1.8, 0, 0.72)})`;
                ctx.beginPath();
                ctx.arc(x, y, radius * (1.4 - impact.blast), 0, Math.PI * 2);
                ctx.fill();
            }
        });
    }

    function drawSmoke(ctx, frame) {
        ctx.save();
        world.smoke.forEach((cloud) => {
            const x = screenX(cloud.x, frame);
            const y = screenY(cloud.y, frame);
            const radius = cloud.radius * frame.width * 0.46;
            const alpha = clamp(cloud.life / 2.2, 0, 0.66);
            const gradient = ctx.createRadialGradient(x, y, 1, x, y, radius);
            gradient.addColorStop(0, `rgba(199,205,197,${alpha})`);
            gradient.addColorStop(0.62, `rgba(142,151,145,${alpha * 0.62})`);
            gradient.addColorStop(1, "rgba(94,103,100,0)");
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    function drawTracers(ctx, frame) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        world.tracers.forEach((tracer) => {
            const x = screenX(tracer.x, frame);
            const y = screenY(tracer.y, frame);
            const tailX = screenX(tracer.x - tracer.vx * 0.075, frame);
            const tailY = screenY(tracer.y - tracer.vy * 0.075, frame);
            ctx.strokeStyle = "rgba(255,184,92,0.88)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.fillStyle = "#ffd0a0";
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();
    }

    function drawEmplacements(ctx, frame) {
        const units = [
            { x: -0.94, y: 0.88, angle: Math.sin(world.time * 0.82) * 0.7 + 0.55 },
            { x: 0.94, y: 0.88, angle: -Math.sin(world.time * 0.76) * 0.7 - 0.55 },
            { x: 0, y: 1.01, angle: Math.sin(world.time * 1.1) * 0.5 }
        ];
        units.forEach((unit) => {
            const x = screenX(unit.x, frame);
            const y = screenY(unit.y, frame);
            ctx.save();
            ctx.translate(x, y);
            ctx.fillStyle = "#202321";
            ctx.strokeStyle = "rgba(235,236,229,0.24)";
            roundedRectangle(ctx, -18, -14, 36, 28, 7);
            ctx.fill();
            ctx.stroke();
            ctx.rotate(unit.angle);
            ctx.fillStyle = "#666b66";
            roundedRectangle(ctx, -4, -5, 34, 10, 3);
            ctx.fill();
            ctx.fillStyle = "#b6bd32";
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    function drawVehicle(ctx, frame) {
        const x = screenX(vehicle.x, frame);
        const y = screenY(vehicle.y, frame);
        const configuration = activeConfiguration();
        const scale = configuration.size / 0.052;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-vehicle.lateralVelocity * 0.15);
        if (vehicle.hitFlash > 0) {
            ctx.fillStyle = "rgba(226,78,73,0.26)";
            ctx.beginPath();
            ctx.arc(0, 0, 31 * scale, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = "rgba(0,0,0,0.38)";
        roundedRectangle(ctx, -18 * scale + 4, -26 * scale + 5, 36 * scale, 52 * scale, 8 * scale);
        ctx.fill();
        ctx.fillStyle = configuration.color;
        roundedRectangle(ctx, -18 * scale, -26 * scale, 36 * scale, 52 * scale, 8 * scale);
        ctx.fill();
        ctx.strokeStyle = "rgba(247,247,239,0.42)";
        ctx.stroke();
        ctx.fillStyle = "#343735";
        roundedRectangle(ctx, -11 * scale, -12 * scale, 22 * scale, 27 * scale, 5 * scale);
        ctx.fill();
        ctx.fillStyle = "#111312";
        ctx.fillRect(-23 * scale, -18 * scale, 6 * scale, 14 * scale);
        ctx.fillRect(17 * scale, -18 * scale, 6 * scale, 14 * scale);
        ctx.fillRect(-23 * scale, 7 * scale, 6 * scale, 14 * scale);
        ctx.fillRect(17 * scale, 7 * scale, 6 * scale, 14 * scale);
        ctx.fillStyle = "#b6bd32";
        ctx.fillRect(-5 * scale, -23 * scale, 10 * scale, 4 * scale);
        ctx.restore();
    }

    function drawStatus(ctx, frame) {
        if (vehicle.phase !== "failed" && vehicle.phase !== "finished") {
            return;
        }
        ctx.fillStyle = "rgba(9,10,10,0.78)";
        roundedRectangle(ctx, world.width * 0.5 - 126, frame.top + frame.height * 0.43, 252, 78, 15);
        ctx.fill();
        ctx.strokeStyle = vehicle.phase === "finished" ? "rgba(182,189,50,0.58)" : "rgba(226,120,112,0.58)";
        ctx.stroke();
        ctx.fillStyle = vehicle.phase === "finished" ? "#d6db8a" : "#e08b82";
        ctx.font = "500 10px 'General Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(vehicle.phase === "finished" ? "INLAND EXTRACTION REACHED" : "ROVER RECOVERY REQUIRED", world.width * 0.5, frame.top + frame.height * 0.43 + 32);
        ctx.fillStyle = "rgba(239,240,234,0.58)";
        ctx.font = "400 9px 'General Sans', sans-serif";
        ctx.fillText("Restart returns the vehicle and clears the run-specific craters", world.width * 0.5, frame.top + frame.height * 0.43 + 52);
    }

    function draw() {
        const ctx = context;
        const frame = layout();
        ctx.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
        ctx.clearRect(0, 0, world.width, world.height);
        drawTerrain(ctx, frame);
        drawFortifiedChannels(ctx, frame);
        drawCraters(ctx, frame);
        drawMinefields(ctx, frame);
        drawWalls(ctx, frame);
        drawBarricades(ctx, frame);
        drawImpacts(ctx, frame);
        drawEmplacements(ctx, frame);
        drawTracers(ctx, frame);
        drawVehicle(ctx, frame);
        drawSmoke(ctx, frame);
        drawStatus(ctx, frame);
    }

    function resize() {
        if (page.hidden) {
            return;
        }
        const bounds = surface.getBoundingClientRect();
        if (bounds.width < 10 || bounds.height < 10) {
            return;
        }
        world.width = Math.round(bounds.width);
        world.height = Math.round(bounds.height);
        world.dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(world.width * world.dpr);
        canvas.height = Math.round(world.height * world.dpr);
        canvas.style.width = `${world.width}px`;
        canvas.style.height = `${world.height}px`;
        context.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
    }

    function setLaneFromPointer(event) {
        const frame = layout();
        const bounds = canvas.getBoundingClientRect();
        const localX = (event.clientX - bounds.left) * (world.width / bounds.width);
        const normalized = clamp((localX - (frame.left + frame.right) * 0.5) / (frame.width * 0.46), -1, 1);
        controls[1].input.value = String(Math.round(normalized / 0.79 * 100));
        controls[1].update();
    }

    canvas.addEventListener("pointerdown", (event) => {
        world.pointerActive = true;
        canvas.setPointerCapture?.(event.pointerId);
        setLaneFromPointer(event);
    });
    canvas.addEventListener("pointermove", (event) => {
        if (world.pointerActive) {
            setLaneFromPointer(event);
        }
    });
    canvas.addEventListener("pointerup", () => { world.pointerActive = false; });
    canvas.addEventListener("pointercancel", () => { world.pointerActive = false; });

    function loop(timestamp) {
        const delta = Math.min(0.033, Math.max(0.001, (timestamp - lastTime) / 1000));
        lastTime = timestamp;
        if (!page.hidden && document.visibilityState !== "hidden") {
            update(delta);
            draw();
        }
        requestAnimationFrame(loop);
    }

    resetRun(false);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    window.addEventListener("resize", resize, { passive: true });
    window.beachhead = { resize, startRun, deploySmoke };
    requestAnimationFrame(loop);
})();
