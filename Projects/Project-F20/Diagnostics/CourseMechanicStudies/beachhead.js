"use strict";

(() => {
    const canvas = document.getElementById("beachhead-canvas");
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d", { alpha: false });
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
            turnRate: 1.72,
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
        const prediction = settings.lane / 100 * 0.78;
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
                    world.craters.push({ x: impact.x, y: impact.y, radius: impact.radius * 0.78 });
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

    function updateBarricadeCollisions(delta) {
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

        const targetX = settings.lane / 100 * 0.79;
        const desiredLateralVelocity = (targetX - vehicle.x) * configuration.turnRate;
        vehicle.lateralVelocity = moveToward(vehicle.lateralVelocity, desiredLateralVelocity, delta * configuration.turnRate * 1.55);
        vehicle.lateralVelocity *= Math.exp(-delta * 0.52);
        vehicle.x += vehicle.lateralVelocity * delta;
        vehicle.smokeCooldown = Math.max(0, vehicle.smokeCooldown - delta);
        vehicle.hitFlash = Math.max(0, vehicle.hitFlash - delta);
        vehicle.statusTimer = Math.max(0, vehicle.statusTimer - delta);

        updateBarricadeCollisions(delta);
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

    function drawTerrain(ctx, frame) {
        const sand = ctx.createLinearGradient(0, frame.top, 0, frame.bottom);
        sand.addColorStop(0, "#393a32");
        sand.addColorStop(0.72, "#6a6652");
        sand.addColorStop(1, "#31565a");
        ctx.fillStyle = sand;
        ctx.fillRect(0, 0, world.width, world.height);

        ctx.fillStyle = "#1c2929";
        ctx.fillRect(0, frame.top - 26, world.width, 72);
        ctx.fillStyle = "rgba(207,209,194,0.1)";
        for (let index = 0; index < 34; index += 1) {
            const x = ((index * 137) % 997) / 997 * world.width;
            const y = frame.top + ((index * 71) % 430) / 430 * frame.height;
            ctx.fillRect(x, y, 2 + index % 4, 1);
        }

        const shorelineY = screenY(0.14, frame);
        const water = ctx.createLinearGradient(0, shorelineY, 0, frame.bottom);
        water.addColorStop(0, "rgba(48,98,101,0.74)");
        water.addColorStop(1, "#193c41");
        ctx.fillStyle = water;
        ctx.fillRect(0, shorelineY, world.width, frame.bottom - shorelineY + 46);
        ctx.strokeStyle = "rgba(208,224,215,0.34)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 0; x <= world.width; x += 18) {
            const y = shorelineY + Math.sin(x * 0.031 + world.time * 1.7) * 5;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.strokeStyle = "rgba(232,232,220,0.12)";
        ctx.setLineDash([8, 11]);
        for (const lane of [-0.55, 0, 0.55]) {
            ctx.beginPath();
            ctx.moveTo(screenX(lane, frame), frame.bottom);
            ctx.lineTo(screenX(lane, frame), frame.top);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    function drawBarricades(ctx, frame) {
        barricades.forEach((barricade) => {
            const x = screenX(barricade.x, frame);
            const y = screenY(barricade.y, frame);
            const width = barricade.width * frame.width * 0.46;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(barricade.angle);
            ctx.fillStyle = "rgba(0,0,0,0.28)";
            roundedRectangle(ctx, -width * 0.5 + 4, -9 + 4, width, 18, 4);
            ctx.fill();
            ctx.fillStyle = "#77756a";
            roundedRectangle(ctx, -width * 0.5, -9, width, 18, 4);
            ctx.fill();
            ctx.strokeStyle = "rgba(237,236,225,0.29)";
            ctx.stroke();
            ctx.fillStyle = "rgba(182,106,69,0.62)";
            for (let mark = -width * 0.36; mark < width * 0.42; mark += 24) {
                ctx.fillRect(mark, -2, 13, 4);
            }
            ctx.restore();
        });
    }

    function drawCraters(ctx, frame) {
        world.craters.forEach((crater) => {
            const x = screenX(crater.x, frame);
            const y = screenY(crater.y, frame);
            const radius = crater.radius * frame.width * 0.46;
            const gradient = ctx.createRadialGradient(x, y, 2, x, y, radius);
            gradient.addColorStop(0, "rgba(20,20,18,0.85)");
            gradient.addColorStop(0.68, "rgba(39,36,29,0.72)");
            gradient.addColorStop(1, "rgba(91,83,62,0.18)");
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.ellipse(x, y, radius, radius * 0.62, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(18,18,16,0.44)";
            ctx.stroke();
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
        drawCraters(ctx, frame);
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
