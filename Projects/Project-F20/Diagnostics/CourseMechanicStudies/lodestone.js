"use strict";

(() => {
    const canvas = document.getElementById("lodestone-canvas");
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("lodestone");
    const resetButton = document.getElementById("lodestone-reset");
    const phaseReadout = document.getElementById("lodestone-phase-readout");
    const plateReadout = document.getElementById("lodestone-plate-readout");
    const fieldReadout = document.getElementById("lodestone-field-readout");
    const tractionReadout = document.getElementById("lodestone-traction-readout");
    const resultReadout = document.getElementById("lodestone-result-readout");
    const fieldBarA = document.getElementById("lodestone-field-bar-a");
    const fieldBarB = document.getElementById("lodestone-field-bar-b");

    const settings = {
        current: 0.64,
        pulse: 3.8,
        polarity: 0.15,
        gantrySpeed: 1.1,
        friction: 0.42
    };

    const world = {
        width: 1400,
        height: 860,
        dpr: 1,
        scaleX: 1,
        scaleY: 1,
        time: 0,
        lastTime: performance.now(),
        wasVisible: false,
        result: "running",
        resultLabel: "Running",
        resultDetail: "Recovery cycle active",
        collisionFlash: 0,
        filingsPhase: 0,
        bridgeStableTime: 0,
        bridgeLatched: false,
        waitingTime: 0,
        magnetA: { x: 548, y: 382, active: false, field: 0, cable: 0 },
        magnetB: { x: 1080, y: 430, active: false, field: 0, cable: 0 }
    };

    const plate = {
        x: 535,
        y: 382,
        vx: 0,
        vy: 0,
        angle: -0.13,
        omega: 0,
        width: 236,
        height: 76,
        mass: 18,
        susceptibility: 1,
        padOffset: 78,
        heat: 0.22
    };

    const hauler = {
        progress: 0,
        speed: 0,
        lateral: 0,
        lateralVelocity: 0,
        x: 76,
        y: 548,
        angle: 0,
        cargoShift: 0,
        status: "Entering cutting field"
    };

    const traffic = [
        { x: 160, y: 236, angle: 0, type: "crawler", phase: 0.08 },
        { x: 1120, y: 724, angle: Math.PI, type: "slab", phase: 0.52 },
        { x: 1085, y: 322, angle: Math.PI / 2, type: "tractor", phase: 0.19 }
    ];

    const scrapSeed = [
        [360, 344, 44, 19, -0.22, 3.4, 0.86], [426, 358, 62, 16, 0.12, 4.8, 0.95],
        [476, 322, 35, 25, 0.58, 2.9, 0.8], [905, 592, 58, 20, -0.38, 5.2, 0.92],
        [958, 626, 37, 24, 0.22, 3.1, 0.84], [1027, 590, 76, 17, -0.08, 6.5, 1],
        [1190, 507, 43, 28, 0.44, 3.7, 0.87], [1245, 548, 64, 17, -0.28, 5.4, 0.93],
        [278, 688, 49, 18, 0.18, 4.1, 0.88], [342, 706, 73, 21, -0.1, 6.2, 0.96],
        [1150, 196, 39, 22, 0.63, 3.2, 0.82], [1215, 226, 57, 16, -0.31, 4.7, 0.91]
    ];

    let scrap = [];

    const controls = [
        {
            input: document.getElementById("lodestone-current"),
            output: document.getElementById("lodestone-current-output"),
            apply: (number) => { settings.current = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("lodestone-pulse"),
            output: document.getElementById("lodestone-pulse-output"),
            apply: (number) => { settings.pulse = number / 10; },
            format: (number) => `${(number / 10).toFixed(1)} s`
        },
        {
            input: document.getElementById("lodestone-polarity"),
            output: document.getElementById("lodestone-polarity-output"),
            apply: (number) => { settings.polarity = number / 100; },
            format: (number) => `${number >= 0 ? "+" : ""}${number}%`
        },
        {
            input: document.getElementById("lodestone-gantry"),
            output: document.getElementById("lodestone-gantry-output"),
            apply: (number) => { settings.gantrySpeed = number / 10; },
            format: (number) => `${(number / 10).toFixed(1)} m/s`
        },
        {
            input: document.getElementById("lodestone-friction"),
            output: document.getElementById("lodestone-friction-output"),
            apply: (number) => { settings.friction = number / 100; },
            format: (number) => `${(number / 100).toFixed(2)} µ`
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

    function shortestAngle(number) {
        return Math.atan2(Math.sin(number), Math.cos(number));
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

    function createScrap() {
        scrap = scrapSeed.map((record, index) => ({
            x: record[0], y: record[1], width: record[2], height: record[3], angle: record[4],
            mass: record[5], susceptibility: record[6], vx: 0, vy: 0, omega: 0,
            tone: index % 3, serial: `C${String(index + 1).padStart(2, "0")}`
        }));
    }

    function routeSample(progress) {
        const ratio = clamp(progress, 0, 1);
        let local;
        let p0;
        let p1;
        let p2;
        let p3;
        if (ratio < 0.48) {
            local = ratio / 0.48;
            p0 = { x: 76, y: 548 };
            p1 = { x: 290, y: 574 };
            p2 = { x: 510, y: 510 };
            p3 = { x: 682, y: 490 };
        } else if (ratio < 0.82) {
            local = (ratio - 0.48) / 0.34;
            p0 = { x: 682, y: 490 };
            p1 = { x: 810, y: 472 };
            p2 = { x: 965, y: 466 };
            p3 = { x: 1120, y: 408 };
        } else {
            local = (ratio - 0.82) / 0.18;
            p0 = { x: 1120, y: 408 };
            p1 = { x: 1215, y: 374 };
            p2 = { x: 1280, y: 356 };
            p3 = { x: 1350, y: 348 };
        }
        const inverse = 1 - local;
        const x = inverse ** 3 * p0.x + 3 * inverse ** 2 * local * p1.x + 3 * inverse * local ** 2 * p2.x + local ** 3 * p3.x;
        const y = inverse ** 3 * p0.y + 3 * inverse ** 2 * local * p1.y + 3 * inverse * local ** 2 * p2.y + local ** 3 * p3.y;
        const dx = 3 * inverse ** 2 * (p1.x - p0.x) + 6 * inverse * local * (p2.x - p1.x) + 3 * local ** 2 * (p3.x - p2.x);
        const dy = 3 * inverse ** 2 * (p1.y - p0.y) + 6 * inverse * local * (p2.y - p1.y) + 3 * local ** 2 * (p3.y - p2.y);
        const length = Math.max(0.001, Math.hypot(dx, dy));
        return { x, y, tx: dx / length, ty: dy / length, angle: Math.atan2(dy, dx) };
    }

    function updateMagnets() {
        const cycleLength = 18 / settings.gantrySpeed;
        const phaseA = modular(world.time, cycleLength) / cycleLength;
        let travel;
        if (phaseA < 0.42) {
            travel = smoothstep(phaseA / 0.42);
        } else if (phaseA < 0.78) {
            travel = 1;
        } else {
            travel = 1 - smoothstep((phaseA - 0.78) / 0.22);
        }
        world.magnetA.x = 548 + (770 - 548) * travel;
        world.magnetA.y = 382 + (480 - 382) * travel;
        world.magnetA.cable = 0.35 + travel * 0.45;

        const phaseB = modular(world.time * settings.gantrySpeed + 2.4, 13) / 13;
        const sweep = (Math.sin(phaseB * Math.PI * 2 - Math.PI / 2) + 1) * 0.5;
        const cross = (Math.sin(phaseB * Math.PI * 4 + 0.6) + 1) * 0.5;
        world.magnetB.x = 1015 + sweep * 185;
        world.magnetB.y = 355 + cross * 205;
        world.magnetB.cable = 0.45 + cross * 0.35;

        const pulseA = modular(world.time, 8) < settings.pulse;
        const pulseB = modular(world.time + 3.15, 8) < settings.pulse;
        const simultaneous = pulseA && pulseB;
        const capacity = simultaneous ? 0.76 : 1;
        world.magnetA.active = pulseA;
        world.magnetB.active = pulseB;
        world.magnetA.field = pulseA ? settings.current * capacity : 0;
        world.magnetB.field = pulseB ? settings.current * capacity * 0.9 : 0;
    }

    function frictionAt(x, y) {
        let factor = settings.friction;
        const oilOne = Math.hypot(x - 570, (y - 520) * 1.45) < 130;
        const oilTwo = Math.hypot(x - 1050, (y - 472) * 1.7) < 116;
        if (oilOne || oilTwo) {
            factor *= 0.46;
        }
        if (y > 650) {
            factor *= 1.32;
        }
        return factor;
    }

    function applyPlateField(magnet, delta) {
        if (magnet.field <= 0) {
            return;
        }
        const cosine = Math.cos(plate.angle);
        const sine = Math.sin(plate.angle);
        const inertia = plate.mass * (plate.width * plate.width + plate.height * plate.height) / 12;
        [-1, 1].forEach((side) => {
            const rx = cosine * plate.padOffset * side;
            const ry = sine * plate.padOffset * side;
            const padX = plate.x + rx;
            const padY = plate.y + ry;
            const dx = magnet.x - padX;
            const dy = magnet.y - padY;
            const distance = Math.max(20, Math.hypot(dx, dy));
            const falloff = clamp(1 - distance / 470, 0, 1) ** 2;
            const bias = 1 + settings.polarity * side * 0.62;
            const force = magnet.field * 5200 * falloff * bias * (1 - plate.heat * 0.22);
            const forceX = dx / distance * force;
            const forceY = dy / distance * force;
            plate.vx += forceX / plate.mass * delta;
            plate.vy += forceY / plate.mass * delta;
            plate.omega += (rx * forceY - ry * forceX) / inertia * delta * 2.3;
        });
    }

    function applyBodyField(body, magnet, delta) {
        if (magnet.field <= 0) {
            return;
        }
        const dx = magnet.x - body.x;
        const dy = magnet.y - body.y;
        const distance = Math.max(18, Math.hypot(dx, dy));
        const falloff = clamp(1 - distance / 390, 0, 1) ** 2;
        const acceleration = magnet.field * body.susceptibility * 165 / Math.sqrt(body.mass) * falloff;
        body.vx += dx / distance * acceleration * delta;
        body.vy += dy / distance * acceleration * delta;
        const desired = Math.atan2(dy, dx);
        body.omega += shortestAngle(desired - body.angle) * magnet.field * falloff * 0.32 * delta;
    }

    function dampBody(body, delta, scale = 1) {
        const speed = Math.hypot(body.vx, body.vy);
        const deceleration = frictionAt(body.x, body.y) * 78 * scale * delta;
        if (speed > 0) {
            const next = Math.max(0, speed - deceleration);
            body.vx *= next / speed;
            body.vy *= next / speed;
        }
        body.omega = moveToward(body.omega, 0, frictionAt(body.x, body.y) * 0.8 * scale * delta);
    }

    function updateSteel(delta) {
        applyPlateField(world.magnetA, delta);
        applyPlateField(world.magnetB, delta);
        dampBody(plate, delta, world.bridgeLatched && hauler.progress < 0.66 ? 10 : 0.72);
        plate.vx = clamp(plate.vx, -125, 125);
        plate.vy = clamp(plate.vy, -125, 125);
        plate.omega = clamp(plate.omega, -0.65, 0.65);
        plate.x += plate.vx * delta;
        plate.y += plate.vy * delta;
        plate.angle += plate.omega * delta;
        plate.x = clamp(plate.x, 180, 1220);
        plate.y = clamp(plate.y, 270, 680);
        plate.heat = Math.max(0, plate.heat - delta * 0.006);

        scrap.forEach((body) => {
            applyBodyField(body, world.magnetA, delta);
            applyBodyField(body, world.magnetB, delta);
            dampBody(body, delta);
            body.vx = clamp(body.vx, -95, 95);
            body.vy = clamp(body.vy, -95, 95);
            body.x += body.vx * delta;
            body.y += body.vy * delta;
            body.angle += body.omega * delta;
            if (body.x < 42 || body.x > 1358) {
                body.vx *= -0.42;
                body.x = clamp(body.x, 42, 1358);
            }
            if (body.y < 182 || body.y > 810) {
                body.vy *= -0.42;
                body.y = clamp(body.y, 182, 810);
            }
        });
    }

    function bridgeReady() {
        const speed = Math.hypot(plate.vx, plate.vy);
        const alignedAngle = Math.abs(shortestAngle(plate.angle)) < 0.36 || Math.abs(Math.abs(shortestAngle(plate.angle)) - Math.PI) < 0.36;
        return Math.abs(plate.x - 770) < 48 && Math.abs(plate.y - 480) < 62 && alignedAngle && speed < 38;
    }

    function bearingReady() {
        const alignedAngle = Math.abs(shortestAngle(plate.angle)) < 0.42 || Math.abs(Math.abs(shortestAngle(plate.angle)) - Math.PI) < 0.42;
        return bridgeReady() || (world.bridgeLatched && Math.abs(plate.x - 770) < 62 && Math.abs(plate.y - 480) < 70 && alignedAngle);
    }

    function fieldInfluenceAt(x, y) {
        let forceX = 0;
        let forceY = 0;
        [world.magnetA, world.magnetB].forEach((magnet) => {
            if (magnet.field <= 0) {
                return;
            }
            const dx = magnet.x - x;
            const dy = magnet.y - y;
            const distance = Math.max(28, Math.hypot(dx, dy));
            const falloff = clamp(1 - distance / 500, 0, 1) ** 2;
            const force = magnet.field * 88 * falloff;
            forceX += dx / distance * force;
            forceY += dy / distance * force;
        });
        return { x: forceX, y: forceY, magnitude: Math.hypot(forceX, forceY) };
    }

    function updateTraffic() {
        const upper = modular(world.time * 0.025, 1);
        traffic[0].x = 125 + upper * 955;
        traffic[0].y = 238 + Math.sin(upper * Math.PI * 2) * 8;
        traffic[0].angle = 0;

        const lower = modular(world.time * 0.019 + 0.5, 1);
        traffic[1].x = 1190 - lower * 880;
        traffic[1].y = 724;
        traffic[1].angle = Math.PI;

        const crossingPhase = modular(world.time * 0.055 + 0.19, 2);
        const crossing = crossingPhase < 1 ? crossingPhase : 2 - crossingPhase;
        traffic[2].x = 1087;
        traffic[2].y = 280 + crossing * 305;
        traffic[2].angle = crossingPhase < 1 ? Math.PI / 2 : -Math.PI / 2;
    }

    function fail(result, label, detail) {
        if (world.result !== "running") {
            return;
        }
        world.result = result;
        world.resultLabel = label;
        world.resultDetail = detail;
        world.collisionFlash = result === "plate-strike" ? 1 : 0.35;
        hauler.speed = 0;
        resetButton.textContent = "Run another recovery";
        resultReadout.textContent = label;
        canvas.dataset.result = result;
    }

    function updateHauler(delta) {
        if (world.result !== "running") {
            return;
        }

        const route = routeSample(hauler.progress);
        const bridge = bearingReady();
        const approachingTrench = hauler.progress > 0.405 && hauler.progress < 0.49;
        const crossingTraffic = Math.hypot(route.x - traffic[2].x, route.y - traffic[2].y) < 105;
        let targetSpeed = 36;

        if (approachingTrench && !bridge) {
            targetSpeed = 0;
            world.waitingTime += delta;
            hauler.status = "Holding for hull plate H–19";
        } else if (hauler.progress > 0.72 && hauler.progress < 0.86 && crossingTraffic) {
            targetSpeed = 0;
            hauler.status = "Yielding to cutting tractor";
        } else if (hauler.progress < 0.48) {
            hauler.status = "Approaching quench trench";
        } else if (hauler.progress < 0.63) {
            hauler.status = "Crossing hull plate H–19";
        } else if (hauler.progress < 0.86) {
            hauler.status = "Clearing magnetic recovery bay";
        } else {
            hauler.status = "Running to Bay 03";
        }

        hauler.speed = moveToward(hauler.speed, targetSpeed, (targetSpeed < hauler.speed ? 42 : 18) * delta);
        hauler.progress = clamp(hauler.progress + hauler.speed * delta / 1260, 0, 1);

        const nextRoute = routeSample(hauler.progress);
        const influence = fieldInfluenceAt(nextRoute.x, nextRoute.y);
        const lateralForce = influence.x * -nextRoute.ty + influence.y * nextRoute.tx;
        const tractionLimit = frictionAt(nextRoute.x, nextRoute.y) * 74;
        const excess = Math.max(0, Math.abs(lateralForce) - tractionLimit);
        hauler.lateralVelocity += Math.sign(lateralForce || 1) * excess * 0.36 * delta;
        hauler.lateralVelocity = moveToward(hauler.lateralVelocity, 0, frictionAt(nextRoute.x, nextRoute.y) * 18 * delta);
        hauler.lateral += hauler.lateralVelocity * delta;
        hauler.lateral = moveToward(hauler.lateral, 0, frictionAt(nextRoute.x, nextRoute.y) * 1.6 * delta);
        hauler.cargoShift = clamp(hauler.cargoShift + lateralForce * 0.0012 * delta - hauler.cargoShift * delta * 0.6, -1, 1);
        hauler.x = nextRoute.x - nextRoute.ty * hauler.lateral;
        hauler.y = nextRoute.y + nextRoute.tx * hauler.lateral;
        hauler.angle = nextRoute.angle + Math.atan2(hauler.lateralVelocity, Math.max(25, hauler.speed)) * 0.35;

        const localCosine = Math.cos(-plate.angle);
        const localSine = Math.sin(-plate.angle);
        const plateDx = hauler.x - plate.x;
        const plateDy = hauler.y - plate.y;
        const plateLocalX = plateDx * localCosine - plateDy * localSine;
        const plateLocalY = plateDx * localSine + plateDy * localCosine;
        const onPlate = Math.abs(plateLocalX) < plate.width * 0.5 + 34 && Math.abs(plateLocalY) < plate.height * 0.5 + 25;
        const plateMoving = Math.hypot(plate.vx, plate.vy) > 38 || Math.abs(plate.omega) > 0.22;

        if (onPlate && (!bridge || plateMoving) && hauler.progress > 0.32) {
            fail("plate-strike", "Plate strike", "Hull plate H–19 contacted Hauler R4 under load");
        } else if (hauler.x > 720 && hauler.x < 820 && hauler.y > 300 && hauler.y < 645 && !bridge) {
            fail("trench", "Trench fall", "The bearing plate moved before R4 cleared the quench trench");
        } else if (Math.abs(hauler.lateral) > 78) {
            fail("side-slip", "Magnetic side-slip", "Field load exceeded available tyre friction");
        } else if (influence.magnitude > 75 && settings.current > 0.9 && Math.abs(settings.polarity) > 0.72) {
            fail("cargo-loss", "Cargo separation", "The recovery field removed R4's ferrous cargo module");
        } else if (world.waitingTime > 34) {
            fail("yard-lock", "Yard locked", "H–19 never formed a stable bearing surface");
        } else if (hauler.progress >= 0.995) {
            fail("finished", "Recovered", "Hauler R4 cleared Bay 03 with its cargo intact");
        }
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

    function drawConcrete() {
        context.fillStyle = "#222723";
        context.fillRect(0, 0, world.width, world.height);
        context.fillStyle = "#2a2f2b";
        context.fillRect(20, 20, 1360, 820);

        context.strokeStyle = "rgba(217,219,210,0.07)";
        context.lineWidth = 1;
        for (let x = 20; x <= 1380; x += 112) {
            context.beginPath();
            context.moveTo(x, 20);
            context.lineTo(x, 840);
            context.stroke();
        }
        for (let y = 20; y <= 840; y += 104) {
            context.beginPath();
            context.moveTo(20, y);
            context.lineTo(1380, y);
            context.stroke();
        }

        const stains = [
            [565, 516, 146, 61, -0.18], [1048, 472, 124, 52, 0.22], [342, 700, 102, 35, 0.02],
            [822, 648, 88, 29, -0.3], [1240, 320, 76, 34, 0.34]
        ];
        stains.forEach((stain) => {
            context.save();
            context.translate(stain[0], stain[1]);
            context.rotate(stain[4]);
            const gradient = context.createRadialGradient(0, 0, 3, 0, 0, stain[2]);
            gradient.addColorStop(0, "rgba(10,13,10,0.56)");
            gradient.addColorStop(0.55, "rgba(39,32,21,0.25)");
            gradient.addColorStop(1, "rgba(39,32,21,0)");
            context.fillStyle = gradient;
            context.scale(1, stain[3] / stain[2]);
            context.beginPath();
            context.arc(0, 0, stain[2], 0, Math.PI * 2);
            context.fill();
            context.restore();
        });

        context.strokeStyle = "rgba(7,10,8,0.48)";
        context.lineWidth = 2;
        const cracks = [
            [[42, 454], [119, 445], [177, 466], [244, 451], [310, 470]],
            [[887, 668], [921, 648], [964, 658], [998, 631], [1048, 644]],
            [[1160, 275], [1135, 300], [1156, 326], [1127, 354]]
        ];
        cracks.forEach((points) => {
            context.beginPath();
            points.forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
            context.stroke();
        });

        context.fillStyle = "rgba(137,126,106,0.16)";
        for (let index = 0; index < 170; index += 1) {
            const x = 34 + modular(index * 83, 1320);
            const y = 42 + modular(index * 137, 782);
            context.fillRect(x, y, 1 + index % 3, 1 + (index * 2) % 3);
        }
    }

    function drawBuildings() {
        context.save();
        context.shadowColor = "rgba(0,0,0,0.62)";
        context.shadowBlur = 14;
        context.shadowOffsetY = 10;

        context.fillStyle = "#333934";
        context.strokeStyle = "#6b726b";
        context.lineWidth = 2;
        context.fillRect(42, 42, 330, 116);
        context.strokeRect(42, 42, 330, 116);
        context.fillRect(1080, 42, 278, 142);
        context.strokeRect(1080, 42, 278, 142);
        context.restore();

        context.strokeStyle = "rgba(212,216,206,0.16)";
        context.lineWidth = 2;
        for (let x = 54; x < 370; x += 14) {
            context.beginPath(); context.moveTo(x, 46); context.lineTo(x, 154); context.stroke();
        }
        for (let x = 1092; x < 1358; x += 14) {
            context.beginPath(); context.moveTo(x, 46); context.lineTo(x, 180); context.stroke();
        }

        context.fillStyle = "#202622";
        context.strokeStyle = "#778078";
        [[70, 69, 72, 46], [272, 66, 58, 58], [1110, 72, 86, 40], [1244, 75, 76, 52]].forEach((unit) => {
            context.fillRect(unit[0], unit[1], unit[2], unit[3]);
            context.strokeRect(unit[0], unit[1], unit[2], unit[3]);
            context.beginPath();
            for (let y = unit[1] + 8; y < unit[1] + unit[3]; y += 9) {
                context.moveTo(unit[0] + 7, y); context.lineTo(unit[0] + unit[2] - 7, y);
            }
            context.stroke();
        });

        context.fillStyle = "rgba(223,226,216,0.52)";
        context.font = "500 9px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText("CUTTING HALL C / 04", 207, 136);
        context.fillText("FIELD POWER / 4.8 MW", 1219, 159);

        context.strokeStyle = "#715d45";
        context.lineWidth = 8;
        context.beginPath();
        context.moveTo(405, 66); context.lineTo(1018, 66); context.lineTo(1018, 124);
        context.stroke();
        context.strokeStyle = "#737b74";
        context.lineWidth = 7;
        context.beginPath();
        context.moveTo(405, 86); context.lineTo(986, 86); context.lineTo(986, 139);
        context.stroke();
        context.strokeStyle = "#444a45";
        context.lineWidth = 3;
        for (let x = 430; x < 1000; x += 92) {
            context.beginPath(); context.moveTo(x, 54); context.lineTo(x, 105); context.stroke();
        }
    }

    function drawShipSkeleton() {
        context.save();
        context.translate(132, 196);
        context.fillStyle = "rgba(14,18,16,0.72)";
        context.strokeStyle = "#555e57";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(0, 27); context.lineTo(54, 0); context.lineTo(330, 18); context.lineTo(387, 53); context.lineTo(326, 83); context.lineTo(54, 94); context.closePath();
        context.fill(); context.stroke();
        context.strokeStyle = "#7a6d5c";
        context.lineWidth = 3;
        for (let x = 48; x < 355; x += 33) {
            context.beginPath();
            context.moveTo(x, 10 + Math.abs(x - 200) * 0.04);
            context.quadraticCurveTo(x - 12, 49, x, 88 - Math.abs(x - 200) * 0.035);
            context.stroke();
        }
        context.strokeStyle = "#9a7650";
        context.setLineDash([9, 7]);
        context.beginPath(); context.moveTo(35, 49); context.lineTo(363, 49); context.stroke();
        context.setLineDash([]);
        context.fillStyle = "rgba(224,226,217,0.42)";
        context.font = "500 8px General Sans, sans-serif";
        context.fillText("HULL 771 / STRIPPED", 142, 69);
        context.restore();
    }

    function drawQuenchTrench() {
        context.save();
        context.shadowColor = "rgba(0,0,0,0.72)";
        context.shadowBlur = 16;
        context.fillStyle = "#070c0b";
        context.fillRect(716, 286, 110, 378);
        context.restore();

        const coolant = context.createLinearGradient(716, 0, 826, 0);
        coolant.addColorStop(0, "#0c1716");
        coolant.addColorStop(0.5, "#1b3534");
        coolant.addColorStop(1, "#0b1514");
        context.fillStyle = coolant;
        context.fillRect(728, 299, 86, 352);

        context.strokeStyle = "rgba(128,166,163,0.25)";
        context.lineWidth = 2;
        for (let y = 311; y < 650; y += 20) {
            const wave = Math.sin(world.time * 1.4 + y * 0.05) * 5;
            context.beginPath(); context.moveTo(734 + wave, y); context.lineTo(808 - wave, y); context.stroke();
        }

        context.fillStyle = "#9b7e3b";
        for (let y = 286; y < 664; y += 24) {
            context.fillRect(705, y, 11, 12);
            context.fillRect(826, y + 12, 11, 12);
        }
        context.strokeStyle = "#606861";
        context.lineWidth = 5;
        context.strokeRect(716, 286, 110, 378);
        context.strokeStyle = "rgba(226,229,219,0.2)";
        context.lineWidth = 1;
        context.strokeRect(724, 294, 94, 362);

        context.fillStyle = "rgba(188,153,67,0.48)";
        context.font = "500 8px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText("QUENCH TRENCH / 06", 771, 680);
        context.textAlign = "left";
    }

    function drawFloorInfrastructure() {
        context.strokeStyle = "#111613";
        context.lineWidth = 13;
        context.beginPath(); context.moveTo(32, 634); context.lineTo(690, 634); context.moveTo(850, 634); context.lineTo(1368, 634); context.stroke();
        context.strokeStyle = "#687069";
        context.lineWidth = 7;
        context.setLineDash([3, 8]);
        context.beginPath(); context.moveTo(40, 634); context.lineTo(687, 634); context.moveTo(853, 634); context.lineTo(1360, 634); context.stroke();
        context.setLineDash([]);

        context.fillStyle = "#191f1b";
        context.strokeStyle = "#626a63";
        context.lineWidth = 2;
        context.fillRect(1168, 680, 185, 126);
        context.strokeRect(1168, 680, 185, 126);
        for (let row = 0; row < 2; row += 1) {
            for (let column = 0; column < 3; column += 1) {
                const x = 1202 + column * 54;
                const y = 712 + row * 54;
                context.beginPath(); context.arc(x, y, 20, 0, Math.PI * 2); context.fill(); context.stroke();
                context.beginPath(); context.arc(x, y, 8, 0, Math.PI * 2); context.stroke();
            }
        }

        context.fillStyle = "#3f352a";
        context.strokeStyle = "#9b7650";
        [[64, 680], [112, 680], [64, 718], [112, 718], [160, 718]].forEach((position, index) => {
            context.fillRect(position[0], position[1], 40, 30);
            context.strokeRect(position[0], position[1], 40, 30);
            context.beginPath(); context.moveTo(position[0], position[1]); context.lineTo(position[0] + 40, position[1] + 30); context.stroke();
            if (index < 2) { context.fillRect(position[0], position[1] - 34, 40, 30); context.strokeRect(position[0], position[1] - 34, 40, 30); }
        });
    }

    function drawRoute() {
        context.strokeStyle = "rgba(8,11,9,0.38)";
        context.lineWidth = 58;
        context.lineCap = "butt";
        context.beginPath();
        for (let index = 0; index <= 100; index += 1) {
            const point = routeSample(index / 100);
            index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y);
        }
        context.stroke();
        context.strokeStyle = "rgba(177,145,59,0.32)";
        context.lineWidth = 3;
        context.setLineDash([7, 15]);
        context.beginPath();
        for (let index = 0; index <= 100; index += 1) {
            const point = routeSample(index / 100);
            index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y);
        }
        context.stroke();
        context.setLineDash([]);
        context.lineCap = "round";
    }

    function drawCraneRails() {
        context.strokeStyle = "rgba(7,9,8,0.58)";
        context.lineWidth = 12;
        context.beginPath(); context.moveTo(260, 180); context.lineTo(260, 650); context.moveTo(936, 180); context.lineTo(936, 650); context.stroke();
        context.strokeStyle = "#59615a";
        context.lineWidth = 5;
        context.beginPath(); context.moveTo(260, 180); context.lineTo(260, 650); context.moveTo(936, 180); context.lineTo(936, 650); context.stroke();
        context.strokeStyle = "#80877f";
        context.lineWidth = 2;
        context.setLineDash([5, 10]);
        context.beginPath(); context.moveTo(260, 180); context.lineTo(260, 650); context.moveTo(936, 180); context.lineTo(936, 650); context.stroke();
        context.setLineDash([]);

        context.strokeStyle = "rgba(7,9,8,0.58)";
        context.lineWidth = 12;
        context.beginPath(); context.moveTo(934, 212); context.lineTo(1350, 212); context.moveTo(934, 666); context.lineTo(1350, 666); context.stroke();
        context.strokeStyle = "#59615a";
        context.lineWidth = 5;
        context.beginPath(); context.moveTo(934, 212); context.lineTo(1350, 212); context.moveTo(934, 666); context.lineTo(1350, 666); context.stroke();
    }

    function drawField(magnet) {
        if (!magnet.active || magnet.field < 0.04) {
            return;
        }
        context.save();
        context.translate(magnet.x, magnet.y);
        context.rotate(world.filingsPhase * 0.16);
        context.strokeStyle = `rgba(173,137,70,${0.08 + magnet.field * 0.09})`;
        context.lineWidth = 1.4;
        for (let ring = 0; ring < 4; ring += 1) {
            const radius = 66 + ring * 34 + Math.sin(world.time * 2 + ring) * 3;
            context.setLineDash([2 + ring, 11 + ring * 3]);
            context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.stroke();
        }
        context.setLineDash([]);
        context.fillStyle = `rgba(177,148,93,${0.18 + magnet.field * 0.18})`;
        for (let index = 0; index < 34; index += 1) {
            const angle = index * 2.399 + world.filingsPhase * (index % 2 ? 0.02 : -0.015);
            const radius = 56 + modular(index * 31, 145);
            context.save();
            context.translate(Math.cos(angle) * radius, Math.sin(angle) * radius);
            context.rotate(angle + Math.PI / 2);
            context.fillRect(-3, -0.6, 6, 1.2);
            context.restore();
        }
        context.restore();
    }

    function drawMagnetA() {
        const magnet = world.magnetA;
        context.save();
        context.shadowColor = "rgba(0,0,0,0.72)";
        context.shadowBlur = 12;
        context.shadowOffsetY = 8;
        context.fillStyle = "#343b36";
        context.strokeStyle = "#7b837a";
        context.lineWidth = 3;
        context.fillRect(260, magnet.y - 18, 676, 36);
        context.strokeRect(260, magnet.y - 18, 676, 36);
        context.restore();
        context.strokeStyle = "rgba(215,219,208,0.16)";
        context.lineWidth = 2;
        for (let x = 280; x < 930; x += 36) {
            context.beginPath(); context.moveTo(x, magnet.y - 15); context.lineTo(x + 22, magnet.y + 15); context.stroke();
        }
        drawField(magnet);
        drawLiftHead(magnet, "A", 54);
    }

    function drawMagnetB() {
        const magnet = world.magnetB;
        context.save();
        context.shadowColor = "rgba(0,0,0,0.68)";
        context.shadowBlur = 11;
        context.shadowOffsetX = 7;
        context.fillStyle = "#303732";
        context.strokeStyle = "#747c74";
        context.lineWidth = 3;
        context.fillRect(magnet.x - 17, 212, 34, 454);
        context.strokeRect(magnet.x - 17, 212, 34, 454);
        context.restore();
        context.strokeStyle = "rgba(215,219,208,0.15)";
        context.lineWidth = 2;
        for (let y = 230; y < 660; y += 34) {
            context.beginPath(); context.moveTo(magnet.x - 14, y); context.lineTo(magnet.x + 14, y + 19); context.stroke();
        }
        drawField(magnet);
        drawLiftHead(magnet, "B", 47);
    }

    function drawLiftHead(magnet, label, radius) {
        context.save();
        context.translate(magnet.x, magnet.y);
        context.shadowColor = "rgba(0,0,0,0.75)";
        context.shadowBlur = 12;
        context.shadowOffsetY = 7;
        context.fillStyle = "#171d19";
        context.strokeStyle = magnet.active ? "#a88445" : "#656d66";
        context.lineWidth = 9;
        context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.fill(); context.stroke();
        context.shadowColor = "transparent";
        context.strokeStyle = "#555e57";
        context.lineWidth = 3;
        context.beginPath(); context.arc(0, 0, radius - 17, 0, Math.PI * 2); context.stroke();
        context.fillStyle = "#090d0b";
        context.beginPath(); context.arc(0, 0, 13, 0, Math.PI * 2); context.fill();
        context.strokeStyle = "#848b83";
        context.lineWidth = 2;
        for (let index = 0; index < 8; index += 1) {
            const angle = index / 8 * Math.PI * 2;
            context.beginPath();
            context.arc(Math.cos(angle) * (radius - 9), Math.sin(angle) * (radius - 9), 2.5, 0, Math.PI * 2);
            context.stroke();
        }
        context.fillStyle = magnet.active ? "#d2b067" : "#8b918a";
        context.font = "500 10px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText(`MAG ${label}`, 0, 4);
        context.restore();

        context.strokeStyle = "#222824";
        context.lineWidth = 7;
        context.beginPath();
        context.moveTo(magnet.x, magnet.y - radius);
        context.quadraticCurveTo(magnet.x + 16, magnet.y - radius - 24 - magnet.cable * 15, magnet.x + 5, magnet.y - radius - 48);
        context.stroke();
    }

    function drawPlate() {
        context.save();
        context.translate(plate.x + 7, plate.y + 9);
        context.rotate(plate.angle);
        context.fillStyle = "rgba(0,0,0,0.5)";
        context.beginPath();
        context.moveTo(-plate.width * 0.5 + 6, -plate.height * 0.5);
        context.lineTo(plate.width * 0.5 - 8, -plate.height * 0.5 - 4);
        context.lineTo(plate.width * 0.5, plate.height * 0.5 - 6);
        context.lineTo(-plate.width * 0.5 + 12, plate.height * 0.5 + 4);
        context.closePath(); context.fill();
        context.restore();

        context.save();
        context.translate(plate.x, plate.y);
        context.rotate(plate.angle);
        const gradient = context.createLinearGradient(-plate.width * 0.5, -plate.height * 0.5, plate.width * 0.5, plate.height * 0.5);
        gradient.addColorStop(0, "#94897b");
        gradient.addColorStop(0.4, "#6d655b");
        gradient.addColorStop(1, "#3d3b36");
        context.fillStyle = gradient;
        context.strokeStyle = bearingReady() ? "#c5b270" : "#b0a28e";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(-plate.width * 0.5 + 8, -plate.height * 0.5);
        context.lineTo(plate.width * 0.5 - 13, -plate.height * 0.5 - 5);
        context.lineTo(plate.width * 0.5, plate.height * 0.5 - 10);
        context.lineTo(-plate.width * 0.5 + 15, plate.height * 0.5 + 4);
        context.closePath(); context.fill(); context.stroke();
        context.strokeStyle = "rgba(25,24,21,0.66)";
        context.lineWidth = 4;
        context.beginPath(); context.moveTo(-92, -23); context.lineTo(88, -28); context.moveTo(-96, 23); context.lineTo(94, 16); context.stroke();
        context.lineWidth = 2;
        for (let x = -90; x <= 90; x += 30) {
            context.beginPath(); context.moveTo(x, -26); context.lineTo(x + 5, 21); context.stroke();
        }
        [-plate.padOffset, plate.padOffset].forEach((x, index) => {
            context.fillStyle = index ? "#876d3e" : "#685a45";
            context.strokeStyle = "#c2a564";
            context.lineWidth = 3;
            context.beginPath(); context.arc(x, 0, 15, 0, Math.PI * 2); context.fill(); context.stroke();
            context.beginPath(); context.arc(x, 0, 6, 0, Math.PI * 2); context.stroke();
        });
        context.fillStyle = "rgba(229,229,219,0.58)";
        context.font = "500 9px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText("H–19 / 18.0 T", 0, 4);
        context.restore();
    }

    function drawScrapBody(body) {
        context.save();
        context.translate(body.x + 3, body.y + 5);
        context.rotate(body.angle);
        context.fillStyle = "rgba(0,0,0,0.46)";
        context.fillRect(-body.width * 0.5, -body.height * 0.5, body.width, body.height);
        context.restore();
        context.save();
        context.translate(body.x, body.y);
        context.rotate(body.angle);
        context.fillStyle = body.tone === 0 ? "#6b5b4c" : body.tone === 1 ? "#59615c" : "#756b5d";
        context.strokeStyle = body.tone === 1 ? "#939b93" : "#a18b72";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(-body.width * 0.5, -body.height * 0.42);
        context.lineTo(body.width * 0.44, -body.height * 0.5);
        context.lineTo(body.width * 0.5, body.height * 0.37);
        context.lineTo(-body.width * 0.38, body.height * 0.5);
        context.closePath(); context.fill(); context.stroke();
        context.strokeStyle = "rgba(31,30,26,0.55)";
        context.beginPath(); context.moveTo(-body.width * 0.32, 0); context.lineTo(body.width * 0.34, -2); context.stroke();
        context.restore();
    }

    function drawTrafficVehicle(vehicle) {
        context.save();
        context.translate(vehicle.x, vehicle.y);
        context.rotate(vehicle.angle);
        context.shadowColor = "rgba(0,0,0,0.62)";
        context.shadowBlur = 7;
        context.shadowOffsetY = 5;
        const width = vehicle.type === "slab" ? 106 : vehicle.type === "crawler" ? 84 : 70;
        const height = vehicle.type === "slab" ? 38 : 42;
        context.fillStyle = vehicle.type === "tractor" ? "#46504a" : vehicle.type === "slab" ? "#76543e" : "#59635d";
        context.strokeStyle = "#aeb5ad";
        context.lineWidth = 2;
        context.fillRect(-width * 0.5, -height * 0.5, width, height);
        context.strokeRect(-width * 0.5, -height * 0.5, width, height);
        context.shadowColor = "transparent";
        context.fillStyle = "#090c0a";
        context.fillRect(-width * 0.36, -height * 0.5 - 6, 20, 7);
        context.fillRect(width * 0.16, -height * 0.5 - 6, 20, 7);
        context.fillRect(-width * 0.36, height * 0.5 - 1, 20, 7);
        context.fillRect(width * 0.16, height * 0.5 - 1, 20, 7);
        context.strokeStyle = "#252d28";
        context.lineWidth = 3;
        context.strokeRect(-width * 0.34, -height * 0.3, width * 0.68, height * 0.6);
        if (vehicle.type === "slab") {
            context.fillStyle = "#574b3f";
            context.fillRect(-39, -12, 78, 24);
            context.strokeStyle = "#9a8369";
            context.strokeRect(-39, -12, 78, 24);
        }
        context.fillStyle = "#d2a348";
        context.beginPath(); context.arc(width * 0.37, -height * 0.28, 3, 0, Math.PI * 2); context.fill();
        context.restore();
    }

    function drawHauler() {
        context.save();
        context.translate(hauler.x + 6, hauler.y + 8);
        context.rotate(hauler.angle);
        context.fillStyle = "rgba(0,0,0,0.58)";
        context.fillRect(-54, -28, 108, 56);
        context.restore();

        context.save();
        context.translate(hauler.x, hauler.y);
        context.rotate(hauler.angle);
        context.fillStyle = "#080b09";
        [[-47, -37], [22, -37], [-47, 27], [22, 27]].forEach((wheel) => context.fillRect(wheel[0], wheel[1], 25, 11));
        const gradient = context.createLinearGradient(-55, -30, 55, 30);
        gradient.addColorStop(0, "#d8dad3");
        gradient.addColorStop(0.52, "#9ba29b");
        gradient.addColorStop(1, "#4c5751");
        context.fillStyle = gradient;
        context.strokeStyle = world.result === "finished" ? "#c1ad62" : world.result !== "running" ? "#d4614f" : "#edf0e8";
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(-57, -24); context.lineTo(-40, -33); context.lineTo(27, -33); context.lineTo(57, -17); context.lineTo(57, 17); context.lineTo(27, 33); context.lineTo(-40, 33); context.lineTo(-57, 24); context.closePath();
        context.fill(); context.stroke();
        context.strokeStyle = "#252d29";
        context.lineWidth = 3;
        context.strokeRect(-43, -22, 87, 44);
        context.fillStyle = "#1b3637";
        context.strokeStyle = "#91aaa5";
        context.fillRect(-8, -24, 38, 19);
        context.strokeRect(-8, -24, 38, 19);
        context.fillStyle = "#785b42";
        context.strokeStyle = "#b78b5d";
        const shift = hauler.cargoShift * 7;
        context.fillRect(-36, -15 + shift, 21, 30);
        context.strokeRect(-36, -15 + shift, 21, 30);
        context.fillRect(-10, 1 + shift, 19, 19);
        context.strokeRect(-10, 1 + shift, 19, 19);
        context.fillStyle = "#d9a642";
        context.beginPath(); context.arc(40, -18, 4, 0, Math.PI * 2); context.fill();
        context.fillStyle = "#e9ece4";
        context.font = "500 9px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText("R4", 22, 11);
        context.restore();
    }

    function drawImpact() {
        if (world.collisionFlash <= 0) {
            return;
        }
        context.save();
        context.globalAlpha = world.collisionFlash;
        context.strokeStyle = "#dc684e";
        context.lineWidth = 4;
        context.translate(hauler.x, hauler.y);
        context.beginPath(); context.arc(0, 0, 58 + (1 - world.collisionFlash) * 40, 0, Math.PI * 2); context.stroke();
        context.setLineDash([7, 8]);
        context.beginPath(); context.arc(0, 0, 39, 0, Math.PI * 2); context.stroke();
        context.restore();
    }

    function drawLabels() {
        context.fillStyle = "rgba(221,224,214,0.42)";
        context.font = "500 8px General Sans, sans-serif";
        context.textAlign = "left";
        context.fillText("PLATE STOCK / C–12", 326, 304);
        context.fillText("MAGNETIC RECOVERY ENVELOPE", 884, 278);
        context.fillText("ROUGH AGGREGATE APRON", 244, 806);
        context.fillText("BAY 03 / OUTFEED", 1244, 397);
        context.strokeStyle = "rgba(220,223,213,0.2)";
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(326, 312); context.lineTo(492, 312); context.moveTo(884, 286); context.lineTo(1051, 286); context.moveTo(244, 814); context.lineTo(406, 814); context.stroke();
    }

    function render() {
        context.setTransform(world.dpr * world.scaleX, 0, 0, world.dpr * world.scaleY, 0, 0);
        context.clearRect(0, 0, world.width, world.height);
        drawConcrete();
        drawBuildings();
        drawShipSkeleton();
        drawFloorInfrastructure();
        drawRoute();
        drawQuenchTrench();
        drawCraneRails();
        drawLabels();
        scrap.forEach(drawScrapBody);
        traffic.forEach(drawTrafficVehicle);
        drawPlate();
        drawHauler();
        drawMagnetA();
        drawMagnetB();
        drawImpact();
    }

    function updateReadouts() {
        const bridge = bearingReady();
        const plateSpeed = Math.hypot(plate.vx, plate.vy);
        const influence = fieldInfluenceAt(hauler.x, hauler.y);
        const tractionRatio = influence.magnitude / Math.max(1, frictionAt(hauler.x, hauler.y) * 74);
        phaseReadout.textContent = hauler.status;
        plateReadout.textContent = bridge ? "Bearing locked" : plateSpeed > 8 ? `${Math.round(plateSpeed)} px/s` : "Unsecured";
        fieldReadout.textContent = `${Math.round(Math.max(world.magnetA.field, world.magnetB.field) * 100)}%`;
        tractionReadout.textContent = tractionRatio > 1 ? "Sliding" : tractionRatio > 0.72 ? "Near limit" : "Stable";
        if (world.result === "running") {
            resultReadout.textContent = "Running";
        }
        fieldBarA.style.width = `${world.magnetA.field * 100}%`;
        fieldBarB.style.width = `${world.magnetB.field * 100}%`;
    }

    function update(delta) {
        world.time += delta;
        world.filingsPhase += delta;
        world.collisionFlash = Math.max(0, world.collisionFlash - delta * 1.5);
        updateMagnets();
        updateTraffic();
        if (world.result === "running") {
            updateSteel(delta);
            if (bridgeReady()) {
                world.bridgeStableTime += delta;
                if (Math.hypot(plate.vx, plate.vy) < 32) {
                    world.bridgeLatched = true;
                }
            } else if (!world.bridgeLatched) {
                world.bridgeStableTime = 0;
            }
            if (world.bridgeLatched && (Math.abs(plate.x - 770) > 68 || Math.abs(plate.y - 480) > 76 || Math.abs(shortestAngle(plate.angle)) > 0.47)) {
                world.bridgeLatched = false;
                world.bridgeStableTime = 0;
            }
            updateHauler(delta);
        }
        updateReadouts();
    }

    function resetRecovery() {
        world.time = 0;
        world.result = "running";
        world.resultLabel = "Running";
        world.resultDetail = "Recovery cycle active";
        world.collisionFlash = 0;
        world.bridgeStableTime = 0;
        world.bridgeLatched = false;
        world.waitingTime = 0;
        plate.x = 535;
        plate.y = 382;
        plate.vx = 0;
        plate.vy = 0;
        plate.angle = -0.13;
        plate.omega = 0;
        plate.heat = 0.22;
        hauler.progress = 0;
        hauler.speed = 0;
        hauler.lateral = 0;
        hauler.lateralVelocity = 0;
        hauler.x = 76;
        hauler.y = 548;
        hauler.angle = 0;
        hauler.cargoShift = 0;
        hauler.status = "Entering cutting field";
        createScrap();
        canvas.dataset.result = "running";
        resultReadout.textContent = "Running";
        resetButton.textContent = "Reset recovery";
        updateMagnets();
        updateReadouts();
        render();
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

    resetButton.addEventListener("click", resetRecovery);
    resetRecovery();

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

    window.lodestone = {
        resize,
        reset: resetRecovery,
        diagnostics: () => ({
            result: world.result,
            detail: world.resultDetail,
            time: world.time,
            bridge: bearingReady(),
            plate: { x: plate.x, y: plate.y, speed: Math.hypot(plate.vx, plate.vy), angle: plate.angle },
            hauler: { progress: hauler.progress, lateral: hauler.lateral, status: hauler.status }
        })
    };
    requestAnimationFrame(animate);
})();
