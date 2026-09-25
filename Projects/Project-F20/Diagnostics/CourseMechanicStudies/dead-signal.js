"use strict";

(() => {
    const canvas = document.getElementById("dead-signal-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("dead-signal");
    const resetButton = document.getElementById("dead-signal-reset");
    const positionReadout = document.getElementById("dead-signal-position-readout");
    const phaseReadout = document.getElementById("dead-signal-phase-readout");
    const speedReadout = document.getElementById("dead-signal-speed-readout");
    const brakeReadout = document.getElementById("dead-signal-brake-readout");
    const resultReadout = document.getElementById("dead-signal-result-readout");
    const scanArrival = document.getElementById("dead-signal-scan-arrival");
    const stopBar = document.getElementById("dead-signal-stop-bar");
    const judgementCopy = document.getElementById("dead-signal-judgement-copy");
    const controlButtons = Array.from(document.querySelectorAll("[data-dead-signal-control]"));

    const TRACK_WIDTH = 920;
    const TRACK_LENGTH = 7600;
    const CAR_RADIUS = 25;
    const STOP_THRESHOLD = 8;
    const STARTERS = 24;
    const TAU = Math.PI * 2;
    const colours = ["#adb0a6", "#9a765d", "#6f8582", "#81786b", "#a49d87", "#667170", "#9c6a50"];

    const settings = {
        mass: 1550,
        torque: 0.78,
        brakes: 0.72,
        grip: 0.88,
        warning: 1.4
    };

    const input = { throttle: false, brake: false, left: false, right: false, touched: false };
    const world = {
        width: 1280,
        height: 860,
        dpr: 1,
        scale: 0.72,
        time: 0,
        lastTime: performance.now(),
        phase: "open",
        phaseTime: 0,
        phaseDuration: 6.8,
        cycle: 1,
        scanStart: -600,
        scanEnd: 1200,
        scanLine: -600,
        cameraY: 300,
        cameraVelocity: 0,
        shake: 0,
        result: "racing",
        detail: "Heat active",
        wasVisible: false,
        finishers: 0,
        eliminated: 0,
        particles: [],
        holes: []
    };

    const player = createVehicle(0, -70, true, 8);
    let rivals = [];

    const parameterControls = [
        {
            input: document.getElementById("dead-signal-mass"),
            output: document.getElementById("dead-signal-mass-output"),
            apply: (value) => { settings.mass = value; },
            format: (value) => `${value.toLocaleString("en-US")} kg`
        },
        {
            input: document.getElementById("dead-signal-torque"),
            output: document.getElementById("dead-signal-torque-output"),
            apply: (value) => { settings.torque = value / 100; },
            format: (value) => `${value}%`
        },
        {
            input: document.getElementById("dead-signal-brakes"),
            output: document.getElementById("dead-signal-brakes-output"),
            apply: (value) => { settings.brakes = value / 100; },
            format: (value) => `${value}%`
        },
        {
            input: document.getElementById("dead-signal-grip"),
            output: document.getElementById("dead-signal-grip-output"),
            apply: (value) => { settings.grip = value / 100; },
            format: (value) => `${(value / 100).toFixed(2)} µ`
        },
        {
            input: document.getElementById("dead-signal-warning"),
            output: document.getElementById("dead-signal-warning-output"),
            apply: (value) => { settings.warning = value / 10; },
            format: (value) => `${(value / 10).toFixed(1)} s`
        }
    ];

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function lerp(start, end, ratio) {
        return start + (end - start) * ratio;
    }

    function moveToward(value, target, amount) {
        if (value < target) return Math.min(target, value + amount);
        return Math.max(target, value - amount);
    }

    function seeded(index, salt = 0) {
        const value = Math.sin(index * 91.731 + salt * 47.117) * 43758.5453;
        return value - Math.floor(value);
    }

    function createVehicle(x, y, isPlayer, number) {
        return {
            x,
            y,
            previousX: x,
            previousY: y,
            vx: 0,
            vy: 0,
            heading: 0,
            speed: 0,
            radius: CAR_RADIUS,
            mass: isPlayer ? settings.mass : 1250 + seeded(number, 2) * 900,
            number,
            isPlayer,
            colour: isPlayer ? "#c9a94c" : colours[number % colours.length],
            active: true,
            detected: false,
            judged: false,
            falling: 0,
            finished: false,
            finishPosition: 0,
            heat: 0,
            impact: 0,
            collisionFlash: 0,
            laneTarget: x,
            reaction: 0.12 + seeded(number, 5) * 0.95,
            bravery: 0.14 + seeded(number, 7) * 0.72,
            controlError: (seeded(number, 9) - 0.5) * 0.2,
            distanceSinceStop: 0
        };
    }

    function syncParameter(control) {
        const value = Number(control.input.value);
        control.apply(value);
        const label = control.format(value);
        control.output.value = label;
        control.output.textContent = label;
        const ratio = (value - Number(control.input.min)) / Math.max(1, Number(control.input.max) - Number(control.input.min));
        control.input.style.setProperty("--range-position", `${ratio * 100}%`);
    }

    parameterControls.forEach((control) => {
        control.update = () => syncParameter(control);
        control.input.addEventListener("input", control.update);
        control.update();
    });

    function resetVehicle(vehicle, x, y) {
        Object.assign(vehicle, createVehicle(x, y, vehicle.isPlayer, vehicle.number));
        if (vehicle.isPlayer) {
            vehicle.mass = settings.mass;
            vehicle.colour = "#c9a94c";
        }
    }

    function resetHeat() {
        resetVehicle(player, 55, -90);
        rivals = [];
        const laneSpacing = TRACK_WIDTH / 9;
        let slot = 0;
        for (let row = 0; row < 4 && rivals.length < STARTERS - 1; row += 1) {
            for (let column = 0; column < 6 && rivals.length < STARTERS - 1; column += 1) {
                const number = slot + 1;
                const lane = column + (row % 2 ? 0.35 : -0.1);
                const x = -TRACK_WIDTH * 0.34 + lane * laneSpacing + (seeded(number, 1) - 0.5) * 28;
                const y = -row * 83 + (seeded(number, 4) - 0.5) * 22;
                if (Math.hypot(x - player.x, y - player.y) < 75) {
                    slot += 1;
                    continue;
                }
                rivals.push(createVehicle(x, y, false, number));
                slot += 1;
            }
        }
        while (rivals.length < STARTERS - 1) {
            const number = rivals.length + 1;
            rivals.push(createVehicle((seeded(number, 11) - 0.5) * 700, -300 - number * 8, false, number));
        }
        world.time = 0;
        world.phase = "open";
        world.phaseTime = 0;
        world.phaseDuration = 6.8;
        world.cycle = 1;
        world.scanStart = -650;
        world.scanEnd = 1200;
        world.scanLine = -650;
        world.cameraY = 360;
        world.cameraVelocity = 0;
        world.shake = 0;
        world.result = "racing";
        world.detail = "Heat active";
        world.finishers = 0;
        world.eliminated = 0;
        world.particles.length = 0;
        world.holes.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        updateReadouts();
        render();
    }

    function allVehicles() {
        return [player, ...rivals];
    }

    function activeVehicles() {
        return allVehicles().filter((vehicle) => vehicle.active && !vehicle.finished && !vehicle.detected);
    }

    function beginPhase(phase) {
        world.phase = phase;
        world.phaseTime = 0;
        if (phase === "open") {
            world.cycle += 1;
            world.phaseDuration = Math.max(4.7, 7.1 - world.cycle * 0.27 + seeded(world.cycle, 15) * 1.5);
            activeVehicles().forEach((vehicle) => {
                vehicle.judged = false;
                vehicle.impact *= 0.2;
            });
        } else if (phase === "warning") {
            world.phaseDuration = settings.warning;
        } else if (phase === "scan") {
            world.phaseDuration = 1.85;
            const racers = activeVehicles();
            const minimum = Math.min(...racers.map((vehicle) => vehicle.y), player.y);
            const maximum = Math.max(...racers.map((vehicle) => vehicle.y), player.y);
            world.scanStart = minimum - 230;
            world.scanEnd = maximum + 270;
            world.scanLine = world.scanStart;
            racers.forEach((vehicle) => { vehicle.judged = false; });
        } else {
            world.phaseDuration = 1.65;
            allVehicles().forEach((vehicle) => {
                if (vehicle.detected && vehicle.falling === 0) {
                    vehicle.falling = 0.001;
                    world.holes.push({
                        x: Math.round(vehicle.x / 115) * 115,
                        y: Math.round(vehicle.y / 145) * 145,
                        age: 0,
                        source: vehicle.number
                    });
                }
            });
        }
    }

    function updateSignal(delta) {
        if (world.result !== "racing") return;
        world.phaseTime += delta;
        if (world.phase === "scan") {
            const ratio = clamp(world.phaseTime / world.phaseDuration, 0, 1);
            world.scanLine = lerp(world.scanStart, world.scanEnd, ratio);
            activeVehicles().forEach((vehicle) => {
                if (!vehicle.judged && world.scanLine >= vehicle.y) judgeVehicle(vehicle);
            });
        }
        if (world.phaseTime < world.phaseDuration) return;
        if (world.phase === "open") beginPhase("warning");
        else if (world.phase === "warning") beginPhase("scan");
        else if (world.phase === "scan") {
            activeVehicles().forEach((vehicle) => {
                if (!vehicle.judged) judgeVehicle(vehicle);
            });
            beginPhase("release");
        } else beginPhase("open");
    }

    function motionReading(vehicle) {
        return Math.hypot(vehicle.vx, vehicle.vy) + vehicle.impact * 16;
    }

    function judgeVehicle(vehicle) {
        if (!vehicle.active || vehicle.finished || vehicle.detected) return;
        vehicle.judged = true;
        const movement = motionReading(vehicle);
        if (movement > STOP_THRESHOLD) {
            vehicle.detected = true;
            world.eliminated += 1;
            vehicle.vx *= 0.55;
            vehicle.vy *= 0.55;
            spawnSparks(vehicle.x, vehicle.y, "#cf593c", 10);
            if (vehicle.isPlayer) {
                world.detail = movement > 22 ? "Movement detected" : "Residual motion detected";
            }
        } else {
            spawnSparks(vehicle.x, vehicle.y, "#78aa87", 5);
        }
    }

    function aiControls(vehicle) {
        let throttle = 0;
        let brake = 0;
        const elapsed = world.phaseTime;
        if (world.phase === "open") {
            throttle = 0.82 + vehicle.bravery * 0.22;
        } else if (world.phase === "warning") {
            if (elapsed < vehicle.reaction * Math.min(1, settings.warning / 1.4)) {
                throttle = 0.7;
            } else {
                brake = 0.82 + (1 - vehicle.bravery) * 0.22;
            }
        } else if (world.phase === "scan") {
            brake = 1;
        } else {
            brake = 0.78;
        }

        const nearbyHole = world.holes.find((hole) => hole.age < 5 && hole.y > vehicle.y && hole.y - vehicle.y < 380 && Math.abs(hole.x - vehicle.x) < 100);
        let targetX = vehicle.laneTarget;
        if (nearbyHole) targetX += vehicle.x < nearbyHole.x ? -145 : 145;
        const forwardVehicle = activeVehicles().find((other) => other !== vehicle && other.y > vehicle.y && other.y - vehicle.y < 135 && Math.abs(other.x - vehicle.x) < 62);
        if (forwardVehicle && world.phase !== "open") brake = 1;
        else if (forwardVehicle && world.phase === "open") targetX += vehicle.x <= forwardVehicle.x ? -95 : 95;
        targetX = clamp(targetX, -TRACK_WIDTH * 0.43, TRACK_WIDTH * 0.43);
        const steering = clamp((targetX - vehicle.x) / 130 - vehicle.vx / 180, -1, 1);
        return { throttle, brake, steering };
    }

    function updateVehicle(vehicle, delta, controls) {
        if (!vehicle.active || vehicle.finished) return;
        vehicle.previousX = vehicle.x;
        vehicle.previousY = vehicle.y;
        vehicle.collisionFlash = Math.max(0, vehicle.collisionFlash - delta * 3.5);
        vehicle.impact = Math.max(0, vehicle.impact - delta * 1.7);

        if (vehicle.falling > 0) {
            vehicle.falling += delta;
            vehicle.vx *= Math.pow(0.08, delta);
            vehicle.vy *= Math.pow(0.08, delta);
            if (vehicle.falling > 1.05) {
                vehicle.active = false;
                if (vehicle.isPlayer && world.result === "racing") {
                    world.result = "eliminated";
                    world.detail = world.detail === "Heat active" ? "Plate released" : world.detail;
                }
            }
            return;
        }

        const speed = Math.hypot(vehicle.vx, vehicle.vy);
        const massRatio = vehicle.isPlayer ? settings.mass / 1550 : vehicle.mass / 1550;
        const torque = vehicle.isPlayer ? settings.torque : 0.66 + vehicle.bravery * 0.27;
        const grip = vehicle.isPlayer ? settings.grip : 0.72 + vehicle.bravery * 0.23;
        const brakeSetting = vehicle.isPlayer ? settings.brakes : 0.68 + (1 - vehicle.bravery) * 0.2;
        const heatFade = 1 - vehicle.heat * 0.48;
        const accelerating = controls.throttle > 0.01;
        const braking = controls.brake > 0.01;

        if (accelerating && !vehicle.detected) {
            const drive = (95 + torque * 125) / massRatio * controls.throttle;
            vehicle.vx += Math.sin(vehicle.heading) * drive * delta;
            vehicle.vy += Math.cos(vehicle.heading) * drive * delta;
        }

        if (braking) {
            const brakingForce = (110 + brakeSetting * 190) * grip * heatFade / Math.max(0.7, massRatio);
            if (speed > 2) {
                const nextSpeed = Math.max(0, speed - brakingForce * controls.brake * delta);
                const ratio = nextSpeed / speed;
                vehicle.vx *= ratio;
                vehicle.vy *= ratio;
            } else if (vehicle.isPlayer && controls.brake > 0.6 && world.phase === "open") {
                vehicle.vy -= 46 * delta;
            }
            vehicle.heat = clamp(vehicle.heat + delta * (0.105 + speed / 1750) * controls.brake, 0, 1);
        } else {
            vehicle.heat = Math.max(0, vehicle.heat - delta * (0.035 + (speed < 30 ? 0.025 : 0)));
        }

        const maximum = 330 + torque * 155;
        const newSpeed = Math.hypot(vehicle.vx, vehicle.vy);
        if (newSpeed > maximum) {
            vehicle.vx *= maximum / newSpeed;
            vehicle.vy *= maximum / newSpeed;
        }

        const steeringAuthority = clamp(speed / 80, 0.12, 1) * (0.72 + grip * 0.34);
        vehicle.heading += controls.steering * steeringAuthority * 1.85 * delta;
        vehicle.heading = clamp(vehicle.heading, -0.72, 0.72);
        const forwardX = Math.sin(vehicle.heading);
        const forwardY = Math.cos(vehicle.heading);
        const longitudinal = vehicle.vx * forwardX + vehicle.vy * forwardY;
        const lateral = vehicle.vx * forwardY - vehicle.vy * forwardX;
        const lateralRetention = Math.pow(Math.max(0.03, 1 - grip * 4.1 * delta), 1);
        const correctedLateral = lateral * lateralRetention;
        vehicle.vx = forwardX * longitudinal + forwardY * correctedLateral;
        vehicle.vy = forwardY * longitudinal - forwardX * correctedLateral;

        const drag = Math.pow(0.991, delta * 60);
        vehicle.vx *= drag;
        vehicle.vy *= drag;
        vehicle.x += vehicle.vx * delta;
        vehicle.y += vehicle.vy * delta;
        vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);

        const boundary = TRACK_WIDTH * 0.5 - 30;
        if (Math.abs(vehicle.x) > boundary) {
            vehicle.x = clamp(vehicle.x, -boundary, boundary);
            vehicle.vx *= -0.36;
            vehicle.vy *= 0.89;
            vehicle.heading *= 0.55;
            vehicle.impact = Math.max(vehicle.impact, 0.65);
            vehicle.collisionFlash = 1;
            vehicle.heat = Math.min(1, vehicle.heat + 0.03);
            spawnSparks(vehicle.x, vehicle.y, "#d2c494", 4);
            world.shake = Math.max(world.shake, vehicle.isPlayer ? 0.7 : 0.25);
        }

        if (vehicle.y >= TRACK_LENGTH) finishVehicle(vehicle);
        if (vehicle.y < -600) vehicle.y = -600;
        checkHoles(vehicle);
    }

    function finishVehicle(vehicle) {
        vehicle.finished = true;
        vehicle.active = false;
        world.finishers += 1;
        if (vehicle.isPlayer) {
            player.finishPosition = rivals.filter((rival) => rival.finished).length + 1;
            world.result = "finished";
            world.detail = player.finishPosition === 1 ? "First across" : `Finished P${player.finishPosition}`;
        }
    }

    function checkHoles(vehicle) {
        if (!vehicle.active || vehicle.detected || vehicle.falling > 0) return;
        const hole = world.holes.find((item) => item.age < 7.5 && Math.abs(vehicle.x - item.x) < 48 && Math.abs(vehicle.y - item.y) < 58);
        if (!hole) return;
        vehicle.detected = true;
        vehicle.falling = 0.001;
        world.eliminated += 1;
        world.detail = vehicle.isPlayer ? "Open plate impact" : world.detail;
        world.shake = Math.max(world.shake, vehicle.isPlayer ? 1 : 0.3);
    }

    function updatePlayer(delta) {
        if (world.result !== "racing") return;
        player.mass = settings.mass;
        const steering = (input.left ? -1 : 0) + (input.right ? 1 : 0);
        updateVehicle(player, delta, {
            throttle: input.throttle ? 1 : 0,
            brake: input.brake ? 1 : 0,
            steering
        });
    }

    function updateRivals(delta) {
        rivals.forEach((vehicle) => {
            if (!vehicle.active || vehicle.finished) return;
            if (vehicle.detected && vehicle.falling === 0) {
                updateVehicle(vehicle, delta, { throttle: 0, brake: 1, steering: 0 });
            } else {
                updateVehicle(vehicle, delta, aiControls(vehicle));
            }
        });
    }

    function resolveCollisions() {
        const vehicles = allVehicles().filter((vehicle) => vehicle.active && vehicle.falling === 0);
        for (let firstIndex = 0; firstIndex < vehicles.length; firstIndex += 1) {
            const first = vehicles[firstIndex];
            for (let secondIndex = firstIndex + 1; secondIndex < vehicles.length; secondIndex += 1) {
                const second = vehicles[secondIndex];
                const dx = second.x - first.x;
                const dy = second.y - first.y;
                const distanceSquared = dx * dx + dy * dy;
                const minimum = first.radius + second.radius;
                if (distanceSquared >= minimum * minimum || distanceSquared < 0.0001) continue;
                const distance = Math.sqrt(distanceSquared);
                const nx = dx / distance;
                const ny = dy / distance;
                const overlap = minimum - distance;
                const firstInverseMass = 1 / first.mass;
                const secondInverseMass = 1 / second.mass;
                const totalInverse = firstInverseMass + secondInverseMass;
                first.x -= nx * overlap * firstInverseMass / totalInverse;
                first.y -= ny * overlap * firstInverseMass / totalInverse;
                second.x += nx * overlap * secondInverseMass / totalInverse;
                second.y += ny * overlap * secondInverseMass / totalInverse;
                const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
                if (relative < 0) {
                    const impulse = -(1.16 * relative) / totalInverse;
                    first.vx -= impulse * nx * firstInverseMass;
                    first.vy -= impulse * ny * firstInverseMass;
                    second.vx += impulse * nx * secondInverseMass;
                    second.vy += impulse * ny * secondInverseMass;
                    const severity = Math.min(2, Math.abs(relative) / 85);
                    first.impact = Math.max(first.impact, severity);
                    second.impact = Math.max(second.impact, severity);
                    first.collisionFlash = 1;
                    second.collisionFlash = 1;
                    if (first.isPlayer || second.isPlayer) world.shake = Math.max(world.shake, severity * 0.75);
                    if (Math.abs(relative) > 45) spawnSparks((first.x + second.x) / 2, (first.y + second.y) / 2, "#d5c796", 5);
                }
            }
        }
    }

    function spawnSparks(x, y, colour, count) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(world.time * 100 + index, index) * TAU;
            const speed = 25 + seeded(index, world.time * 10) * 90;
            world.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.35 + seeded(index, 21) * 0.45,
                maximumLife: 0.8,
                colour
            });
        }
        if (world.particles.length > 180) world.particles.splice(0, world.particles.length - 180);
    }

    function updateParticles(delta) {
        world.particles.forEach((particle) => {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(0.12, delta);
            particle.vy *= Math.pow(0.12, delta);
            particle.life -= delta;
        });
        world.particles = world.particles.filter((particle) => particle.life > 0);
        world.holes.forEach((hole) => { hole.age += delta; });
        world.holes = world.holes.filter((hole) => hole.age < 10);
    }

    function racePosition() {
        if (player.finished && player.finishPosition) return player.finishPosition;
        const ahead = rivals.filter((vehicle) => vehicle.finished || (vehicle.active && !vehicle.detected && vehicle.y > player.y)).length;
        return clamp(ahead + 1, 1, STARTERS);
    }

    function updateCamera(delta) {
        const target = clamp(player.y + 390, 350, TRACK_LENGTH - 200);
        const difference = target - world.cameraY;
        world.cameraVelocity += difference * Math.min(1, delta * 5.5);
        world.cameraVelocity *= Math.pow(0.003, delta);
        world.cameraY += world.cameraVelocity * delta;
        world.shake = Math.max(0, world.shake - delta * 2.2);
    }

    function update(delta) {
        world.time += delta;
        if (world.result !== "racing") {
            updateParticles(delta);
            updateReadouts();
            return;
        }
        updateSignal(delta);
        updateRivals(delta);
        updatePlayer(delta);
        resolveCollisions();
        updateParticles(delta);
        updateCamera(delta);
        updateReadouts();
    }

    function worldToScreen(x, y) {
        return {
            x: world.width * 0.5 + x * world.scale,
            y: world.height * 0.68 - (y - world.cameraY) * world.scale
        };
    }

    function visibleWorldBounds() {
        return {
            bottom: world.cameraY - world.height * 0.38 / world.scale,
            top: world.cameraY + world.height * 0.76 / world.scale
        };
    }

    function drawBackground() {
        const gradient = context.createLinearGradient(0, 0, world.width, world.height);
        gradient.addColorStop(0, "#151b19");
        gradient.addColorStop(0.45, "#0b100f");
        gradient.addColorStop(1, "#18201d");
        context.fillStyle = gradient;
        context.fillRect(0, 0, world.width, world.height);

        context.save();
        context.globalAlpha = 0.16;
        context.strokeStyle = "#52645e";
        context.lineWidth = 1;
        const phase = (world.cameraY * 0.08) % 56;
        for (let y = -60 + phase; y < world.height + 60; y += 56) {
            context.beginPath();
            for (let x = 0; x <= world.width; x += 32) {
                const ripple = Math.sin(x * 0.021 + y * 0.04 + world.time * 0.25) * 4;
                if (x === 0) context.moveTo(x, y + ripple);
                else context.lineTo(x, y + ripple);
            }
            context.stroke();
        }
        context.restore();

        const left = world.width * 0.5 - TRACK_WIDTH * 0.5 * world.scale;
        const right = world.width * 0.5 + TRACK_WIDTH * 0.5 * world.scale;
        context.fillStyle = "rgba(0,0,0,0.36)";
        context.fillRect(left - 20, 0, right - left + 40, world.height);
        const road = context.createLinearGradient(left, 0, right, 0);
        road.addColorStop(0, "#605f57");
        road.addColorStop(0.025, "#8c8a7e");
        road.addColorStop(0.5, "#74746b");
        road.addColorStop(0.975, "#89877b");
        road.addColorStop(1, "#55564f");
        context.fillStyle = road;
        context.fillRect(left, 0, right - left, world.height);

        context.fillStyle = "rgba(20,20,17,0.34)";
        const seamSpacing = 145 * world.scale;
        const seamOffset = ((world.cameraY - world.height * 0.68 / world.scale) * world.scale) % seamSpacing;
        for (let y = world.height + seamOffset; y > -seamSpacing; y -= seamSpacing) {
            context.fillRect(left, y, right - left, 2);
            context.fillStyle = "rgba(235,228,207,0.07)";
            context.fillRect(left, y + 2, right - left, 1);
            context.fillStyle = "rgba(20,20,17,0.34)";
        }
        const plateWidth = 115 * world.scale;
        context.strokeStyle = "rgba(32,33,29,0.28)";
        context.lineWidth = 1;
        for (let x = left + plateWidth; x < right; x += plateWidth) {
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, world.height);
            context.stroke();
        }

        context.setLineDash([18, 18]);
        context.strokeStyle = "rgba(233,226,204,0.19)";
        for (let lane = -3; lane <= 3; lane += 1) {
            const x = world.width * 0.5 + lane * (TRACK_WIDTH / 8) * world.scale;
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, world.height);
            context.stroke();
        }
        context.setLineDash([]);

        drawBarriers(left, right);
        drawRoadFurniture(left, right);
    }

    function drawBarriers(left, right) {
        context.fillStyle = "#343731";
        context.fillRect(left - 17, 0, 17, world.height);
        context.fillRect(right, 0, 17, world.height);
        context.fillStyle = "#a5a08e";
        context.fillRect(left - 4, 0, 4, world.height);
        context.fillRect(right, 0, 4, world.height);
        const offset = ((world.cameraY * world.scale) % 92);
        for (let y = -100 + offset; y < world.height + 100; y += 92) {
            context.fillStyle = "#1d211e";
            context.fillRect(left - 25, y, 25, 9);
            context.fillRect(right, y, 25, 9);
            context.fillStyle = "#9a8e6d";
            context.fillRect(left - 25, y, 6, 9);
            context.fillRect(right + 19, y, 6, 9);
        }
    }

    function drawRoadFurniture(left, right) {
        const bounds = visibleWorldBounds();
        const start = Math.floor(bounds.bottom / 850) * 850;
        for (let y = start; y < bounds.top + 850; y += 850) {
            if (y < 0 || y > TRACK_LENGTH) continue;
            const screen = worldToScreen(0, y);
            context.save();
            context.translate(0, screen.y);
            context.fillStyle = "rgba(18,20,18,0.86)";
            context.fillRect(left - 32, -8, right - left + 64, 16);
            context.fillStyle = "#a29b86";
            context.fillRect(left - 29, -5, right - left + 58, 3);
            context.fillStyle = "#252924";
            context.fillRect(left - 11, -70, 12, 70);
            context.fillRect(right - 1, -70, 12, 70);
            context.fillRect(left - 11, -70, right - left + 22, 12);
            drawSignalLamp(world.width * 0.5 - 35, -64, "open");
            drawSignalLamp(world.width * 0.5, -64, "warning");
            drawSignalLamp(world.width * 0.5 + 35, -64, "scan");
            context.restore();
        }

        const finish = worldToScreen(0, TRACK_LENGTH);
        if (finish.y > -100 && finish.y < world.height + 100) {
            context.fillStyle = "#e4dfce";
            const cell = 22;
            for (let column = 0; column < 42; column += 1) {
                context.fillStyle = column % 2 ? "#262823" : "#e4dfce";
                context.fillRect(left + column * cell, finish.y - 13, cell, 13);
                context.fillStyle = column % 2 ? "#e4dfce" : "#262823";
                context.fillRect(left + column * cell, finish.y, cell, 13);
            }
            context.fillStyle = "rgba(12,13,11,0.85)";
            context.fillRect(world.width * 0.5 - 92, finish.y - 55, 184, 31);
            context.fillStyle = "#eee8da";
            context.font = "600 11px General Sans, sans-serif";
            context.textAlign = "center";
            context.fillText("FINAL LIMIT / 7.6 KM", world.width * 0.5, finish.y - 35);
        }
    }

    function drawSignalLamp(x, y, phase) {
        const active = world.phase === phase || (phase === "scan" && world.phase === "release");
        const colour = phase === "open" ? "#77a888" : phase === "warning" ? "#d5a43e" : "#ce543c";
        context.beginPath();
        context.arc(x, y, 7, 0, TAU);
        context.fillStyle = active ? colour : "#252925";
        context.fill();
        if (active) {
            context.beginPath();
            context.arc(x, y, 13, 0, TAU);
            context.strokeStyle = `${colour}55`;
            context.lineWidth = 5;
            context.stroke();
        }
    }

    function drawHoles() {
        world.holes.forEach((hole) => {
            const screen = worldToScreen(hole.x, hole.y);
            if (screen.y < -100 || screen.y > world.height + 100) return;
            const openRatio = clamp(hole.age / 0.55, 0, 1);
            const fade = clamp((10 - hole.age) / 2.5, 0, 1);
            context.save();
            context.globalAlpha = fade;
            context.translate(screen.x, screen.y);
            context.fillStyle = "rgba(4,7,6,0.9)";
            context.fillRect(-52 * world.scale, -67 * world.scale, 104 * world.scale, 134 * world.scale * openRatio);
            context.strokeStyle = "rgba(196,91,60,0.85)";
            context.lineWidth = 2;
            context.strokeRect(-53 * world.scale, -68 * world.scale, 106 * world.scale, 136 * world.scale * openRatio);
            context.fillStyle = "rgba(208,194,154,0.38)";
            context.fillRect(-48 * world.scale, -72 * world.scale, 96 * world.scale, 4);
            context.restore();
        });
    }

    function drawScan() {
        if (world.phase !== "scan") return;
        const screen = worldToScreen(0, world.scanLine);
        const width = TRACK_WIDTH * world.scale;
        const gradient = context.createLinearGradient(0, screen.y - 90, 0, screen.y + 28);
        gradient.addColorStop(0, "rgba(200,71,46,0)");
        gradient.addColorStop(0.72, "rgba(211,78,51,0.13)");
        gradient.addColorStop(1, "rgba(232,95,62,0.48)");
        context.fillStyle = gradient;
        context.fillRect(world.width * 0.5 - width / 2, screen.y - 90, width, 118);
        context.shadowColor = "#d75236";
        context.shadowBlur = 18;
        context.fillStyle = "#dc6748";
        context.fillRect(world.width * 0.5 - width / 2, screen.y + 24, width, 3);
        context.shadowBlur = 0;
        context.fillStyle = "rgba(238,232,218,0.8)";
        context.font = "600 9px General Sans, sans-serif";
        context.textAlign = "left";
        context.fillText("MOTION JUDGEMENT", world.width * 0.5 - width / 2 + 12, screen.y + 17);
    }

    function drawVehicle(vehicle) {
        if (!vehicle.active && !vehicle.finished) return;
        const screen = worldToScreen(vehicle.x, vehicle.y);
        if (screen.y < -120 || screen.y > world.height + 120) return;
        const scale = world.scale;
        const fallingRatio = vehicle.falling > 0 ? clamp(vehicle.falling / 1.05, 0, 1) : 0;
        context.save();
        context.translate(screen.x, screen.y + fallingRatio * 25);
        context.rotate(vehicle.heading);
        context.scale(1 - fallingRatio * 0.62, 1 - fallingRatio * 0.22);
        context.globalAlpha = 1 - fallingRatio * 0.72;
        context.fillStyle = `rgba(0,0,0,${0.34 - fallingRatio * 0.2})`;
        context.fillRect(-19 * scale + 5, -34 * scale + 8, 38 * scale, 68 * scale);
        context.fillStyle = "#1a1c19";
        context.fillRect(-23 * scale, -24 * scale, 6 * scale, 16 * scale);
        context.fillRect(17 * scale, -24 * scale, 6 * scale, 16 * scale);
        context.fillRect(-23 * scale, 11 * scale, 6 * scale, 16 * scale);
        context.fillRect(17 * scale, 11 * scale, 6 * scale, 16 * scale);
        context.fillStyle = vehicle.collisionFlash > 0.15 ? "#e2d7b6" : vehicle.detected ? "#b54b34" : vehicle.colour;
        context.fillRect(-18 * scale, -34 * scale, 36 * scale, 68 * scale);
        context.fillStyle = "rgba(22,27,25,0.82)";
        context.fillRect(-13 * scale, -13 * scale, 26 * scale, 25 * scale);
        context.fillStyle = "rgba(210,220,205,0.28)";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 4 * scale);
        context.strokeStyle = vehicle.isPlayer ? "#f2dea0" : "rgba(236,233,218,0.45)";
        context.lineWidth = vehicle.isPlayer ? 2.2 : 1;
        context.strokeRect(-18 * scale, -34 * scale, 36 * scale, 68 * scale);
        context.fillStyle = vehicle.isPlayer ? "#151713" : "#ece6d5";
        context.font = `600 ${Math.max(7, 10 * scale)}px General Sans, sans-serif`;
        context.textAlign = "center";
        context.fillText(String(vehicle.number).padStart(2, "0"), 0, 28 * scale);
        if (vehicle.detected) {
            context.strokeStyle = "#e35e41";
            context.lineWidth = 2;
            const pulse = 28 * scale + Math.sin(world.time * 10) * 4;
            context.strokeRect(-pulse, -pulse, pulse * 2, pulse * 2);
        }
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const screen = worldToScreen(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maximumLife, 0, 1);
            context.fillStyle = particle.colour;
            context.fillRect(screen.x, screen.y, 2.5, 2.5);
        });
        context.globalAlpha = 1;
    }

    function drawDistanceMarkers() {
        const bounds = visibleWorldBounds();
        const start = Math.max(0, Math.floor(bounds.bottom / 500) * 500);
        context.save();
        context.fillStyle = "rgba(231,226,210,0.5)";
        context.font = "500 9px General Sans, sans-serif";
        context.textAlign = "right";
        for (let y = start; y < bounds.top + 500 && y <= TRACK_LENGTH; y += 500) {
            const screen = worldToScreen(0, y);
            context.fillText(`${(TRACK_LENGTH - y).toFixed(0)} M`, world.width * 0.5 - TRACK_WIDTH * 0.5 * world.scale - 31, screen.y + 3);
        }
        context.restore();
    }

    function drawPhaseBanner() {
        context.save();
        context.translate(world.width * 0.5, world.width < 700 ? 224 : 154);
        let colour = "#76a887";
        let title = "OPEN — RACE";
        let copy = `${Math.max(0, world.phaseDuration - world.phaseTime).toFixed(1)} seconds to warning`;
        if (world.phase === "warning") {
            colour = "#d7a63e";
            title = "WARNING — STOP NOW";
            copy = `${Math.max(0, world.phaseDuration - world.phaseTime).toFixed(1)} seconds before scan`;
        } else if (world.phase === "scan") {
            colour = "#d2573b";
            title = "SCAN — REMAIN STATIONARY";
            copy = "Any physical motion triggers plate release";
        } else if (world.phase === "release") {
            colour = "#85a4aa";
            title = "RELEASE — HOLD POSITION";
            copy = `${world.eliminated} vehicle${world.eliminated === 1 ? "" : "s"} removed`;
        }
        context.fillStyle = "rgba(9,10,9,0.83)";
        context.fillRect(-142, -23, 284, 47);
        context.fillStyle = colour;
        context.fillRect(-142, -23, 3, 47);
        context.textAlign = "center";
        context.font = "600 12px General Sans, sans-serif";
        context.fillText(title, 0, -3);
        context.fillStyle = "rgba(235,231,218,0.58)";
        context.font = "500 8px General Sans, sans-serif";
        context.fillText(copy.toUpperCase(), 0, 13);
        context.restore();
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 33) - 0.5) * world.shake * 7;
        const shakeY = (seeded(Math.floor(world.time * 75), 34) - 0.5) * world.shake * 7;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, shakeY * world.dpr);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawBackground();
        drawDistanceMarkers();
        drawHoles();
        const vehicles = allVehicles().slice().sort((first, second) => second.y - first.y);
        vehicles.forEach(drawVehicle);
        drawScan();
        drawParticles();
        drawPhaseBanner();
        if (world.result !== "racing") drawResultBanner();
    }

    function drawResultBanner() {
        context.save();
        context.fillStyle = "rgba(5,6,5,0.72)";
        context.fillRect(0, 0, world.width, world.height);
        context.translate(world.width * 0.5, world.height * 0.48);
        context.fillStyle = "#11130f";
        context.fillRect(-205, -92, 410, 184);
        context.strokeStyle = world.result === "finished" ? "#7ca486" : "#b95036";
        context.strokeRect(-205, -92, 410, 184);
        context.textAlign = "center";
        context.fillStyle = world.result === "finished" ? "#86b191" : "#ce593d";
        context.font = "600 9px General Sans, sans-serif";
        context.fillText(world.result === "finished" ? "HEAT COMPLETE" : "VEHICLE ELIMINATED", 0, -48);
        context.fillStyle = "#eee8da";
        context.font = "500 38px Clash Display, General Sans, sans-serif";
        context.fillText(world.result === "finished" ? "FINISH SECURED" : "DEAD SIGNAL", 0, 0);
        context.fillStyle = "rgba(238,232,218,0.58)";
        context.font = "500 10px General Sans, sans-serif";
        context.fillText(`${world.detail.toUpperCase()}  ·  USE RESTART HEAT TO RUN AGAIN`, 0, 34);
        context.restore();
    }

    function updateReadouts() {
        const position = racePosition();
        positionReadout.textContent = `${position} / ${STARTERS}`;
        phaseReadout.textContent = world.phase === "open" ? "Open" : world.phase === "warning" ? "Warning" : world.phase === "scan" ? "Scanning" : "Release";
        speedReadout.textContent = `${Math.round(player.speed * 0.36)} km/h`;
        const heatPercent = Math.round(player.heat * 100);
        brakeReadout.textContent = heatPercent < 18 ? "Cold" : heatPercent < 48 ? `Warm · ${heatPercent}%` : heatPercent < 78 ? `Hot · ${heatPercent}%` : `Fading · ${heatPercent}%`;
        resultReadout.textContent = world.result === "racing" ? (player.detected ? "Detected" : `${STARTERS - world.eliminated} remain`) : world.detail;

        const movement = motionReading(player);
        const ratio = clamp(movement / 90, 0, 1);
        stopBar.style.width = `${ratio * 100}%`;
        stopBar.classList.toggle("is-danger", movement > STOP_THRESHOLD);
        if (world.phase === "open") {
            scanArrival.textContent = "—";
            judgementCopy.textContent = "Movement permitted";
        } else if (world.phase === "warning") {
            scanArrival.textContent = `${Math.max(0, world.phaseDuration - world.phaseTime).toFixed(1)} s`;
            judgementCopy.textContent = movement <= STOP_THRESHOLD ? "Stationary — hold" : "Brake until all motion clears";
        } else if (world.phase === "scan") {
            const distance = player.y - world.scanLine;
            const velocity = (world.scanEnd - world.scanStart) / world.phaseDuration;
            scanArrival.textContent = player.judged ? "Read" : `${Math.max(0, distance / velocity).toFixed(1)} s`;
            judgementCopy.textContent = player.detected ? "Motion detected" : player.judged ? "Clear — remain still" : movement <= STOP_THRESHOLD ? "Stationary — hold" : "Unsafe residual movement";
        } else {
            scanArrival.textContent = "Hold";
            judgementCopy.textContent = player.detected ? "Support plate unlocked" : "Judgement clear";
        }
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth || 1280);
        const height = Math.max(1, canvas.clientHeight || 860);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        world.width = width;
        world.height = height;
        world.scale = clamp(Math.min(width / 1260, height / 1040), 0.54, 0.92);
        canvas.width = Math.round(width * world.dpr);
        canvas.height = Math.round(height * world.dpr);
        render();
    }

    const keyMap = {
        w: "throttle", arrowup: "throttle",
        s: "brake", arrowdown: "brake",
        a: "left", arrowleft: "left",
        d: "right", arrowright: "right"
    };

    function setInput(name, active) {
        if (!Object.prototype.hasOwnProperty.call(input, name) || name === "touched") return;
        input[name] = active;
        if (active) input.touched = true;
        controlButtons.forEach((button) => {
            if (button.dataset.deadSignalControl === name) button.classList.toggle("is-pressed", active);
        });
    }

    window.addEventListener("keydown", (event) => {
        const name = keyMap[event.key.toLowerCase()];
        if (!name || page.hidden) return;
        event.preventDefault();
        setInput(name, true);
    });

    window.addEventListener("keyup", (event) => {
        const name = keyMap[event.key.toLowerCase()];
        if (!name) return;
        event.preventDefault();
        setInput(name, false);
    });

    window.addEventListener("blur", () => {
        ["throttle", "brake", "left", "right"].forEach((name) => setInput(name, false));
    });

    controlButtons.forEach((button) => {
        const name = button.dataset.deadSignalControl;
        const down = (event) => {
            event.preventDefault();
            if (button.setPointerCapture && event.pointerId !== undefined) button.setPointerCapture(event.pointerId);
            setInput(name, true);
        };
        const up = (event) => {
            event.preventDefault();
            setInput(name, false);
        };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
        button.addEventListener("lostpointercapture", up);
    });

    resetButton.addEventListener("click", resetHeat);

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

    window.deadSignal = {
        resize,
        reset: resetHeat,
        setControl: (name, active) => setInput(name, Boolean(active)),
        diagnostics: () => ({
            result: world.result,
            detail: world.detail,
            time: world.time,
            phase: world.phase,
            phaseTime: world.phaseTime,
            cycle: world.cycle,
            player: {
                x: player.x,
                y: player.y,
                vx: player.vx,
                vy: player.vy,
                speed: player.speed,
                heat: player.heat,
                impact: player.impact,
                detected: player.detected,
                active: player.active,
                judged: player.judged,
                position: racePosition()
            },
            activeRivals: rivals.filter((vehicle) => vehicle.active && !vehicle.finished && !vehicle.detected).length,
            eliminated: world.eliminated,
            finishers: world.finishers,
            holes: world.holes.length
        })
    };

    requestAnimationFrame(animate);
})();
