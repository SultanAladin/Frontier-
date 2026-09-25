"use strict";

(() => {
    const canvas = document.getElementById("compression-run-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("compression-run");
    const resetButton = document.getElementById("compression-run-reset");
    const positionReadout = document.getElementById("compression-run-position-readout");
    const lanesReadout = document.getElementById("compression-run-lanes-readout");
    const chamberReadout = document.getElementById("compression-run-chamber-readout");
    const speedReadout = document.getElementById("compression-run-speed-readout");
    const resultReadout = document.getElementById("compression-run-result-readout");
    const selectionReadout = document.getElementById("compression-run-selection-readout");
    const censusCopy = document.getElementById("compression-run-census-copy");
    const censusBars = Array.from(document.querySelectorAll("#compression-run-census-bars i"));
    const clearanceReadout = document.getElementById("compression-run-clearance-readout");
    const clearanceBar = document.getElementById("compression-run-clearance-bar");
    const clearanceCopy = document.getElementById("compression-run-clearance-copy");
    const controlButtons = Array.from(document.querySelectorAll("[data-compression-run-control]"));

    const TRACK_WIDTH = 960;
    const LANE_WIDTH = 120;
    const TRACK_LENGTH = 9400;
    const STARTERS = 24;
    const CAR_RADIUS = 25;
    const TAU = Math.PI * 2;
    const rivalColours = ["#8d9389", "#9c765c", "#657d7a", "#8c846f", "#a39d88", "#6e7570", "#9c6550"];
    const chamberStarts = [1050, 2250, 3450, 4650, 5850, 7050, 8250];

    const settings = {
        mass: 1600,
        torque: 0.76,
        brakes: 0.70,
        grip: 0.90,
        wallSpeed: 1
    };

    const input = { throttle: false, brake: false, left: false, right: false, touched: false };
    const world = {
        width: 1280,
        height: 900,
        dpr: 1,
        scale: 0.72,
        time: 0,
        lastTime: performance.now(),
        cameraY: 370,
        cameraVelocity: 0,
        result: "racing",
        detail: "Heat active",
        shake: 0,
        eliminated: 0,
        finishers: 0,
        particles: [],
        wasVisible: false
    };

    const chambers = chamberStarts.map((start, index) => ({
        index,
        start,
        end: start + 630,
        oldCount: 8 - index,
        newCount: 7 - index,
        triggered: false,
        phase: "waiting",
        timer: 0,
        closure: 0,
        selected: -1,
        counts: new Array(8 - index).fill(0)
    }));

    const player = createVehicle(0, -70, true, 9);
    let rivals = [];

    const parameterControls = [
        {
            input: document.getElementById("compression-run-mass"),
            output: document.getElementById("compression-run-mass-output"),
            apply: (number) => { settings.mass = number; },
            format: (number) => `${number.toLocaleString("en-US")} kg`
        },
        {
            input: document.getElementById("compression-run-torque"),
            output: document.getElementById("compression-run-torque-output"),
            apply: (number) => { settings.torque = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("compression-run-brakes"),
            output: document.getElementById("compression-run-brakes-output"),
            apply: (number) => { settings.brakes = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("compression-run-grip"),
            output: document.getElementById("compression-run-grip-output"),
            apply: (number) => { settings.grip = number / 100; },
            format: (number) => `${(number / 100).toFixed(2)} µ`
        },
        {
            input: document.getElementById("compression-run-wall-speed"),
            output: document.getElementById("compression-run-wall-speed-output"),
            apply: (number) => { settings.wallSpeed = number / 100; },
            format: (number) => `${(number / 100).toFixed(1)}×`
        }
    ];

    function clamp(number, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, number));
    }

    function lerp(start, end, ratio) {
        return start + (end - start) * ratio;
    }

    function smoothstep(number) {
        const ratio = clamp(number, 0, 1);
        return ratio * ratio * (3 - 2 * ratio);
    }

    function seeded(index, salt = 0) {
        const number = Math.sin(index * 93.173 + salt * 51.719) * 43758.5453;
        return number - Math.floor(number);
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
            mass: isPlayer ? settings.mass : 1250 + seeded(number, 2) * 1050,
            number,
            isPlayer,
            colour: isPlayer ? "#c7a64b" : rivalColours[number % rivalColours.length],
            active: true,
            falling: 0,
            fallCause: "",
            finished: false,
            finishPosition: 0,
            collisionFlash: 0,
            impact: 0,
            crush: 0,
            laneBias: 0,
            targetX: x,
            aggression: 0.25 + seeded(number, 6) * 0.7,
            reaction: 0.18 + seeded(number, 8) * 0.7
        };
    }

    function syncParameter(control) {
        const number = Number(control.input.value);
        control.apply(number);
        const text = control.format(number);
        control.output.value = text;
        control.output.textContent = text;
        const ratio = (number - Number(control.input.min)) / Math.max(1, Number(control.input.max) - Number(control.input.min));
        control.input.style.setProperty("--range-position", `${ratio * 100}%`);
    }

    parameterControls.forEach((control) => {
        control.update = () => syncParameter(control);
        control.input.addEventListener("input", control.update);
        control.update();
    });

    function resetVehicle(vehicle, x, y) {
        const fresh = createVehicle(x, y, vehicle.isPlayer, vehicle.number);
        Object.assign(vehicle, fresh);
        if (vehicle.isPlayer) {
            vehicle.mass = settings.mass;
            vehicle.colour = "#c7a64b";
        }
    }

    function resetHeat() {
        resetVehicle(player, 52, -80);
        rivals = [];
        let number = 1;
        for (let row = 0; row < 3; row += 1) {
            for (let lane = 0; lane < 8 && rivals.length < STARTERS - 1; lane += 1) {
                const x = laneCentre(lane, 8) + (seeded(number, 3) - 0.5) * 24;
                const y = -row * 84 + (seeded(number, 4) - 0.5) * 18;
                if (Math.hypot(x - player.x, y - player.y) > 62) {
                    const vehicle = createVehicle(x, y, false, number);
                    vehicle.laneBias = clamp(x / (TRACK_WIDTH * 0.5), -0.92, 0.92);
                    vehicle.targetX = x;
                    rivals.push(vehicle);
                }
                number += 1;
            }
        }
        while (rivals.length < STARTERS - 1) {
            const lane = rivals.length % 8;
            const vehicle = createVehicle(laneCentre(lane, 8), -260 - rivals.length * 5, false, number);
            vehicle.laneBias = clamp(vehicle.x / (TRACK_WIDTH * 0.5), -0.92, 0.92);
            rivals.push(vehicle);
            number += 1;
        }
        chambers.forEach((chamber) => {
            chamber.triggered = false;
            chamber.phase = "waiting";
            chamber.timer = 0;
            chamber.closure = 0;
            chamber.selected = -1;
            chamber.counts = new Array(chamber.oldCount).fill(0);
        });
        world.time = 0;
        world.cameraY = 370;
        world.cameraVelocity = 0;
        world.result = "racing";
        world.detail = "Heat active";
        world.shake = 0;
        world.eliminated = 0;
        world.finishers = 0;
        world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        updateReadouts();
        render();
    }

    function allVehicles() {
        return [player, ...rivals];
    }

    function activeVehicles() {
        return allVehicles().filter((vehicle) => vehicle.active && !vehicle.finished && vehicle.falling === 0);
    }

    function laneCentre(index, count) {
        return (index - (count - 1) * 0.5) * LANE_WIDTH;
    }

    function laneIndexAt(x, count) {
        return clamp(Math.floor((x + count * LANE_WIDTH * 0.5) / LANE_WIDTH), 0, count - 1);
    }

    function roadHalfWidth(y) {
        let half = TRACK_WIDTH * 0.5;
        chambers.forEach((chamber) => {
            if (y <= chamber.start || chamber.closure <= 0) return;
            const longitudinal = smoothstep((y - chamber.start) / (chamber.end - chamber.start));
            half -= LANE_WIDTH * 0.5 * chamber.closure * longitudinal;
        });
        return Math.max(LANE_WIDTH * 0.5, half);
    }

    function lanesAt(y) {
        let count = 8;
        chambers.forEach((chamber) => {
            if (chamber.closure > 0.96 && y >= chamber.end) count = chamber.newCount;
        });
        return count;
    }

    function liveCensus(chamber) {
        const counts = new Array(chamber.oldCount).fill(0);
        activeVehicles().forEach((vehicle) => {
            if (vehicle.y < chamber.start - 920 || vehicle.y > chamber.end + 220) return;
            counts[laneIndexAt(vehicle.x, chamber.oldCount)] += 1;
        });
        return counts;
    }

    function triggerChamber(chamber) {
        if (chamber.triggered) return;
        chamber.triggered = true;
        chamber.phase = "census";
        chamber.timer = 0;
        chamber.counts = liveCensus(chamber);
        const minimum = Math.min(...chamber.counts);
        const candidates = chamber.counts
            .map((count, index) => ({ count, index }))
            .filter((entry) => entry.count === minimum);
        const choice = Math.floor(seeded(chamber.index + world.time, 19) * candidates.length);
        chamber.selected = candidates[choice].index;
        spawnSparks(laneCentre(chamber.selected, chamber.oldCount), chamber.start, "#d19a45", 18);
    }

    function updateChambers(delta) {
        const leaders = activeVehicles();
        const leadY = leaders.length ? Math.max(...leaders.map((vehicle) => vehicle.y)) : player.y;
        chambers.forEach((chamber) => {
            if (!chamber.triggered && leadY >= chamber.start - 300) triggerChamber(chamber);
            if (!chamber.triggered || chamber.phase === "settled") return;
            chamber.timer += delta * settings.wallSpeed;
            if (chamber.phase === "census" && chamber.timer >= 1.45) {
                chamber.phase = "compressing";
                chamber.timer = 0;
            } else if (chamber.phase === "compressing") {
                chamber.closure = smoothstep(chamber.timer / 3.7);
                if (chamber.timer >= 3.7) {
                    chamber.closure = 1;
                    chamber.phase = "settled";
                    chamber.timer = 0;
                }
            }
        });
    }

    function selectedStrip(chamber, y) {
        if (!chamber.triggered || chamber.selected < 0 || y < chamber.start - 40 || y > chamber.end + 40) return null;
        const progress = clamp((y - chamber.start) / (chamber.end - chamber.start), 0, 1);
        const centre = laneCentre(chamber.selected, chamber.oldCount);
        const nearestSide = centre < 0 ? -1 : 1;
        const peel = chamber.closure * Math.sin(progress * Math.PI);
        return {
            centre: centre + nearestSide * peel * 62,
            width: LANE_WIDTH * (0.34 + peel * 0.16),
            peel,
            progress
        };
    }

    function beginFall(vehicle, cause) {
        if (!vehicle.active || vehicle.falling > 0 || vehicle.finished) return;
        vehicle.falling = 0.001;
        vehicle.fallCause = cause;
        vehicle.vx *= 0.45;
        vehicle.vy *= 0.62;
        world.eliminated += 1;
        world.shake = Math.max(world.shake, vehicle.isPlayer ? 1 : 0.35);
        spawnSparks(vehicle.x, vehicle.y, cause === "wall" ? "#c45b42" : "#d29a48", 14);
        if (vehicle.isPlayer) world.detail = cause === "wall" ? "Pinned by the closing wall" : "Selected lane released";
    }

    function checkRoad(vehicle, delta) {
        if (!vehicle.active || vehicle.finished || vehicle.falling > 0) return;
        const half = roadHalfWidth(vehicle.y) - 28;
        const overflow = Math.abs(vehicle.x) - half;
        if (overflow > 0) {
            const side = Math.sign(vehicle.x) || 1;
            vehicle.x -= side * Math.min(overflow, 180 * delta + 7);
            vehicle.vx -= side * (90 + overflow * 4) * delta;
            vehicle.vy *= Math.pow(0.86, delta * 12);
            vehicle.impact = Math.max(vehicle.impact, clamp(overflow / 35, 0.2, 1.5));
            vehicle.collisionFlash = 1;
            vehicle.crush += delta * (0.45 + overflow / 25);
            world.shake = Math.max(world.shake, vehicle.isPlayer ? clamp(overflow / 28, 0.15, 0.8) : 0.15);
            if (vehicle.crush > 2.05) beginFall(vehicle, "wall");
        } else {
            vehicle.crush = Math.max(0, vehicle.crush - delta * 0.48);
        }

        chambers.forEach((chamber) => {
            const strip = selectedStrip(chamber, vehicle.y);
            if (!strip || strip.peel < 0.3) return;
            const distance = Math.abs(vehicle.x - strip.centre);
            if (distance < strip.width && strip.progress > 0.08 && strip.progress < 0.94) {
                vehicle.crush += delta * 1.7;
                vehicle.vx += Math.sign(strip.centre || 1) * strip.peel * 38 * delta;
                if (strip.peel > 0.58 || vehicle.crush > 0.8) beginFall(vehicle, "peel");
            }
        });
    }

    function rivalControls(vehicle) {
        const half = roadHalfWidth(vehicle.y) - 46;
        let target = clamp(vehicle.laneBias * half, -half, half);
        const approaching = chambers.find((chamber) => chamber.triggered && chamber.phase !== "settled" && vehicle.y > chamber.start - 680 && vehicle.y < chamber.end + 80);
        if (approaching && approaching.selected >= 0) {
            const selectedX = laneCentre(approaching.selected, approaching.oldCount);
            if (Math.abs(target - selectedX) < LANE_WIDTH * 0.72 || Math.abs(vehicle.x - selectedX) < LANE_WIDTH * 0.57) {
                const leftRoom = selectedX + half;
                const rightRoom = half - selectedX;
                const direction = leftRoom > rightRoom ? -1 : 1;
                target = clamp(selectedX + direction * LANE_WIDTH * (0.9 + vehicle.reaction * 0.35), -half, half);
            }
        }

        const ahead = activeVehicles().filter((other) => other !== vehicle && other.y > vehicle.y && other.y - vehicle.y < 145 && Math.abs(other.x - vehicle.x) < 62);
        let brake = 0;
        if (ahead.length) {
            const nearest = ahead.reduce((best, other) => other.y < best.y ? other : best, ahead[0]);
            const direction = vehicle.x <= nearest.x ? -1 : 1;
            target = clamp(target + direction * (82 + vehicle.aggression * 54), -half, half);
            if (nearest.y - vehicle.y < 70) brake = 0.25 + (1 - vehicle.aggression) * 0.45;
        }
        vehicle.targetX = target;
        const steering = clamp((target - vehicle.x) / 125 - vehicle.vx / 185, -1, 1);
        const compressionCaution = approaching && approaching.phase === "compressing" ? 0.10 * (1 - vehicle.aggression) : 0;
        return { throttle: 0.82 + vehicle.aggression * 0.18 - compressionCaution, brake, steering };
    }

    function updateVehicle(vehicle, delta, controls) {
        if (!vehicle.active || vehicle.finished) return;
        vehicle.previousX = vehicle.x;
        vehicle.previousY = vehicle.y;
        vehicle.collisionFlash = Math.max(0, vehicle.collisionFlash - delta * 3.7);
        vehicle.impact = Math.max(0, vehicle.impact - delta * 1.9);

        if (vehicle.falling > 0) {
            vehicle.falling += delta;
            vehicle.vx *= Math.pow(0.07, delta);
            vehicle.vy *= Math.pow(0.12, delta);
            vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);
            if (vehicle.falling > 1.12) {
                vehicle.active = false;
                if (vehicle.isPlayer && world.result === "racing") world.result = "eliminated";
            }
            return;
        }

        const speed = Math.hypot(vehicle.vx, vehicle.vy);
        const massRatio = (vehicle.isPlayer ? settings.mass : vehicle.mass) / 1600;
        const torque = vehicle.isPlayer ? settings.torque : 0.65 + vehicle.aggression * 0.28;
        const grip = vehicle.isPlayer ? settings.grip : 0.74 + vehicle.aggression * 0.23;
        const brakes = vehicle.isPlayer ? settings.brakes : 0.66 + (1 - vehicle.aggression) * 0.22;

        if (controls.throttle > 0.01) {
            const drive = (100 + torque * 132) / Math.max(0.68, massRatio) * controls.throttle;
            vehicle.vx += Math.sin(vehicle.heading) * drive * delta;
            vehicle.vy += Math.cos(vehicle.heading) * drive * delta;
        }

        if (controls.brake > 0.01) {
            const force = (115 + brakes * 185) * grip / Math.max(0.7, massRatio);
            if (speed > 2) {
                const next = Math.max(0, speed - force * controls.brake * delta);
                vehicle.vx *= next / speed;
                vehicle.vy *= next / speed;
            } else if (vehicle.isPlayer && controls.brake > 0.6) {
                vehicle.vy -= 42 * delta;
            }
        }

        const maximum = 340 + torque * 150;
        const drivenSpeed = Math.hypot(vehicle.vx, vehicle.vy);
        if (drivenSpeed > maximum) {
            vehicle.vx *= maximum / drivenSpeed;
            vehicle.vy *= maximum / drivenSpeed;
        }

        const steeringAuthority = clamp(speed / 75, 0.13, 1) * (0.74 + grip * 0.32);
        vehicle.heading += controls.steering * steeringAuthority * 1.82 * delta;
        vehicle.heading = clamp(vehicle.heading, -0.76, 0.76);
        const forwardX = Math.sin(vehicle.heading);
        const forwardY = Math.cos(vehicle.heading);
        const longitudinal = vehicle.vx * forwardX + vehicle.vy * forwardY;
        const lateral = vehicle.vx * forwardY - vehicle.vy * forwardX;
        const retainedLateral = lateral * Math.pow(Math.max(0.03, 1 - grip * 4 * delta), 1);
        vehicle.vx = forwardX * longitudinal + forwardY * retainedLateral;
        vehicle.vy = forwardY * longitudinal - forwardX * retainedLateral;
        const drag = Math.pow(0.9915, delta * 60);
        vehicle.vx *= drag;
        vehicle.vy *= drag;
        vehicle.x += vehicle.vx * delta;
        vehicle.y += vehicle.vy * delta;
        vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);

        checkRoad(vehicle, delta);
        if (vehicle.y >= TRACK_LENGTH) finishVehicle(vehicle);
        if (vehicle.y < -650) vehicle.y = -650;
    }

    function finishVehicle(vehicle) {
        if (vehicle.finished) return;
        vehicle.finished = true;
        vehicle.active = false;
        world.finishers += 1;
        vehicle.finishPosition = world.finishers;
        if (vehicle.isPlayer) {
            world.result = "finished";
            world.detail = vehicle.finishPosition === 1 ? "First across" : `Finished P${vehicle.finishPosition}`;
        }
    }

    function updatePlayer(delta) {
        player.mass = settings.mass;
        const steering = (input.left ? -1 : 0) + (input.right ? 1 : 0);
        updateVehicle(player, delta, {
            throttle: input.throttle ? 1 : 0,
            brake: input.brake ? 1 : 0,
            steering
        });
    }

    function updateRivals(delta) {
        rivals.forEach((vehicle) => updateVehicle(vehicle, delta, rivalControls(vehicle)));
    }

    function resolveCollisions() {
        const vehicles = allVehicles().filter((vehicle) => vehicle.active && vehicle.falling === 0 && !vehicle.finished);
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
                const firstInverse = 1 / first.mass;
                const secondInverse = 1 / second.mass;
                const inverseTotal = firstInverse + secondInverse;
                first.x -= nx * overlap * firstInverse / inverseTotal;
                first.y -= ny * overlap * firstInverse / inverseTotal;
                second.x += nx * overlap * secondInverse / inverseTotal;
                second.y += ny * overlap * secondInverse / inverseTotal;
                const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
                if (relative < 0) {
                    const impulse = -(1.13 * relative) / inverseTotal;
                    first.vx -= impulse * nx * firstInverse;
                    first.vy -= impulse * ny * firstInverse;
                    second.vx += impulse * nx * secondInverse;
                    second.vy += impulse * ny * secondInverse;
                    const severity = Math.min(2, Math.abs(relative) / 80);
                    first.impact = Math.max(first.impact, severity);
                    second.impact = Math.max(second.impact, severity);
                    first.collisionFlash = 1;
                    second.collisionFlash = 1;
                    const wallFirst = roadHalfWidth(first.y) - Math.abs(first.x) < 42;
                    const wallSecond = roadHalfWidth(second.y) - Math.abs(second.x) < 42;
                    if (wallFirst) first.crush += severity * 0.16;
                    if (wallSecond) second.crush += severity * 0.16;
                    if (first.isPlayer || second.isPlayer) world.shake = Math.max(world.shake, severity * 0.72);
                    if (Math.abs(relative) > 42) spawnSparks((first.x + second.x) / 2, (first.y + second.y) / 2, "#d5c99f", 6);
                }
            }
        }
    }

    function spawnSparks(x, y, colour, count) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(world.time * 100 + index, index) * TAU;
            const speed = 28 + seeded(index, world.time * 13) * 90;
            world.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.35 + seeded(index, 23) * 0.5,
                maximumLife: 0.85,
                colour
            });
        }
        if (world.particles.length > 190) world.particles.splice(0, world.particles.length - 190);
    }

    function updateParticles(delta) {
        world.particles.forEach((particle) => {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(0.1, delta);
            particle.vy *= Math.pow(0.1, delta);
            particle.life -= delta;
        });
        world.particles = world.particles.filter((particle) => particle.life > 0);
    }

    function racePosition() {
        if (player.finished && player.finishPosition) return player.finishPosition;
        const ahead = rivals.filter((vehicle) => vehicle.finished || (vehicle.active && vehicle.falling === 0 && vehicle.y > player.y)).length;
        return clamp(ahead + 1, 1, STARTERS);
    }

    function updateCamera(delta) {
        const target = clamp(player.y + 410, 380, TRACK_LENGTH - 160);
        const difference = target - world.cameraY;
        world.cameraVelocity += difference * Math.min(1, delta * 5.3);
        world.cameraVelocity *= Math.pow(0.003, delta);
        world.cameraY += world.cameraVelocity * delta;
        world.shake = Math.max(0, world.shake - delta * 2.1);
    }

    function update(delta) {
        world.time += delta;
        if (world.result !== "racing") {
            updateParticles(delta);
            updateReadouts();
            return;
        }
        updateChambers(delta);
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
            y: world.height * 0.69 - (y - world.cameraY) * world.scale
        };
    }

    function visibleBounds() {
        return {
            bottom: world.cameraY - world.height * 0.4 / world.scale,
            top: world.cameraY + world.height * 0.76 / world.scale
        };
    }

    function traceRoadSide(side) {
        const bounds = visibleBounds();
        const steps = 42;
        context.beginPath();
        for (let index = 0; index <= steps; index += 1) {
            const y = lerp(bounds.bottom - 100, bounds.top + 100, index / steps);
            const point = worldToScreen(side * roadHalfWidth(y), y);
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
        }
    }

    function drawBackground() {
        const gradient = context.createLinearGradient(0, 0, world.width, world.height);
        gradient.addColorStop(0, "#181c19");
        gradient.addColorStop(0.5, "#090d0b");
        gradient.addColorStop(1, "#1c1f1a");
        context.fillStyle = gradient;
        context.fillRect(0, 0, world.width, world.height);

        const bounds = visibleBounds();
        const structureStep = 230;
        const first = Math.floor(bounds.bottom / structureStep) * structureStep;
        context.save();
        for (let y = first; y < bounds.top + structureStep; y += structureStep) {
            const screen = worldToScreen(0, y);
            const width = roadHalfWidth(y) * world.scale;
            context.fillStyle = "rgba(79,84,76,0.18)";
            context.fillRect(0, screen.y - 9, world.width * 0.5 - width - 25, 18);
            context.fillRect(world.width * 0.5 + width + 25, screen.y - 9, world.width, 18);
            context.fillStyle = "rgba(165,157,135,0.14)";
            context.fillRect(world.width * 0.5 - width - 67, screen.y - 4, 38, 8);
            context.fillRect(world.width * 0.5 + width + 29, screen.y - 4, 38, 8);
        }
        context.restore();

        const leftPoints = [];
        const rightPoints = [];
        for (let index = 0; index <= 44; index += 1) {
            const y = lerp(bounds.bottom - 120, bounds.top + 120, index / 44);
            leftPoints.push(worldToScreen(-roadHalfWidth(y), y));
            rightPoints.push(worldToScreen(roadHalfWidth(y), y));
        }
        context.beginPath();
        leftPoints.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        rightPoints.reverse().forEach((point) => context.lineTo(point.x, point.y));
        context.closePath();
        const road = context.createLinearGradient(0, 0, world.width, 0);
        road.addColorStop(0, "#585b54");
        road.addColorStop(0.12, "#73746a");
        road.addColorStop(0.5, "#686a62");
        road.addColorStop(0.88, "#74756b");
        road.addColorStop(1, "#545750");
        context.fillStyle = road;
        context.fill();

        drawRoadSeams(bounds);
        drawLaneMarks(bounds);
        drawPeelStrips();
        drawWalls();
        drawChambers();
        drawFinish();
    }

    function drawRoadSeams(bounds) {
        const spacing = 150;
        const start = Math.floor(bounds.bottom / spacing) * spacing;
        for (let y = start; y < bounds.top + spacing; y += spacing) {
            const half = roadHalfWidth(y);
            const left = worldToScreen(-half, y);
            const right = worldToScreen(half, y);
            context.strokeStyle = "rgba(26,28,25,0.35)";
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(left.x, left.y);
            context.lineTo(right.x, right.y);
            context.stroke();
            context.strokeStyle = "rgba(228,222,202,0.06)";
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(left.x, left.y + 2);
            context.lineTo(right.x, right.y + 2);
            context.stroke();
        }
    }

    function drawLaneMarks(bounds) {
        context.save();
        context.setLineDash([15, 17]);
        context.lineWidth = 1.2;
        context.strokeStyle = "rgba(231,225,207,0.2)";
        for (let division = 1; division < 8; division += 1) {
            context.beginPath();
            let drawing = false;
            for (let index = 0; index <= 55; index += 1) {
                const y = lerp(bounds.bottom, bounds.top, index / 55);
                const count = Math.max(1, Math.round(roadHalfWidth(y) * 2 / LANE_WIDTH));
                if (division >= count) {
                    drawing = false;
                    continue;
                }
                const x = -roadHalfWidth(y) + (roadHalfWidth(y) * 2 * division / count);
                const point = worldToScreen(x, y);
                if (!drawing) {
                    context.moveTo(point.x, point.y);
                    drawing = true;
                } else context.lineTo(point.x, point.y);
            }
            context.stroke();
        }
        context.restore();
    }

    function drawPeelStrips() {
        chambers.forEach((chamber) => {
            if (!chamber.triggered || chamber.selected < 0) return;
            const samples = 18;
            const left = [];
            const right = [];
            for (let index = 0; index <= samples; index += 1) {
                const y = lerp(chamber.start, chamber.end, index / samples);
                const strip = selectedStrip(chamber, y);
                if (!strip) continue;
                left.push(worldToScreen(strip.centre - strip.width, y));
                right.push(worldToScreen(strip.centre + strip.width, y));
            }
            if (!left.length) return;
            context.beginPath();
            left.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
            right.reverse().forEach((point) => context.lineTo(point.x, point.y));
            context.closePath();
            const warning = chamber.phase === "census";
            context.fillStyle = warning ? "rgba(201,145,57,0.22)" : "rgba(25,22,18,0.8)";
            context.fill();
            context.strokeStyle = warning ? "#d1a247" : "#b6553f";
            context.lineWidth = warning ? 2 : 3;
            context.setLineDash(warning ? [11, 8] : []);
            context.stroke();
            context.setLineDash([]);
            if (chamber.closure > 0.12) {
                const mid = worldToScreen(laneCentre(chamber.selected, chamber.oldCount), (chamber.start + chamber.end) * 0.5);
                context.fillStyle = "rgba(6,8,7,0.78)";
                const opening = 105 * world.scale * chamber.closure;
                context.fillRect(mid.x - opening * 0.5, mid.y - 95, opening, 190);
            }
        });
    }

    function drawWalls() {
        [-1, 1].forEach((side) => {
            context.save();
            traceRoadSide(side);
            context.strokeStyle = "rgba(0,0,0,0.45)";
            context.lineWidth = 27;
            context.stroke();
            traceRoadSide(side);
            context.strokeStyle = "#353a34";
            context.lineWidth = 19;
            context.stroke();
            traceRoadSide(side);
            context.strokeStyle = "#a19a83";
            context.lineWidth = 3;
            context.stroke();
            context.restore();
        });
    }

    function drawChambers() {
        const bounds = visibleBounds();
        chambers.forEach((chamber) => {
            if (chamber.end < bounds.bottom - 100 || chamber.start > bounds.top + 100) return;
            const entry = worldToScreen(0, chamber.start);
            const half = roadHalfWidth(chamber.start) * world.scale;
            context.save();
            context.translate(0, entry.y);
            context.fillStyle = "rgba(20,22,19,0.92)";
            context.fillRect(world.width * 0.5 - half - 33, -9, half * 2 + 66, 18);
            context.fillStyle = "#9e9781";
            context.fillRect(world.width * 0.5 - half - 30, -6, half * 2 + 60, 3);
            context.fillStyle = "#272b26";
            context.fillRect(world.width * 0.5 - half - 18, -64, 15, 58);
            context.fillRect(world.width * 0.5 + half + 3, -64, 15, 58);
            context.fillRect(world.width * 0.5 - half - 18, -64, half * 2 + 36, 13);
            context.fillStyle = chamber.phase === "census" ? "#d5a245" : chamber.phase === "compressing" ? "#bd533e" : chamber.phase === "settled" ? "#768c78" : "#343a34";
            for (let lamp = 0; lamp < chamber.oldCount; lamp += 1) {
                const x = world.width * 0.5 + laneCentre(lamp, chamber.oldCount) * world.scale;
                context.beginPath();
                context.arc(x, -57, 4.5, 0, TAU);
                context.fill();
            }
            context.fillStyle = "rgba(9,10,9,0.83)";
            context.fillRect(world.width * 0.5 - 67, -87, 134, 23);
            context.fillStyle = "#e4dfce";
            context.font = "600 8px General Sans, sans-serif";
            context.textAlign = "center";
            context.fillText(`COMPRESSION ${String(chamber.index + 1).padStart(2, "0")} / ${chamber.oldCount}→${chamber.newCount}`, world.width * 0.5, -72);
            context.restore();
        });
    }

    function drawFinish() {
        const point = worldToScreen(0, TRACK_LENGTH);
        if (point.y < -90 || point.y > world.height + 90) return;
        const half = roadHalfWidth(TRACK_LENGTH) * world.scale;
        const cell = Math.max(8, half / 5);
        for (let row = 0; row < 2; row += 1) {
            for (let column = 0; column < 10; column += 1) {
                context.fillStyle = (row + column) % 2 ? "#252823" : "#e2ddca";
                context.fillRect(world.width * 0.5 - half + column * cell, point.y - 12 + row * 12, cell, 12);
            }
        }
        context.fillStyle = "rgba(10,11,9,0.88)";
        context.fillRect(world.width * 0.5 - 91, point.y - 57, 182, 28);
        context.fillStyle = "#eee8da";
        context.font = "600 10px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText("ONE LANE / FINAL LIMIT", world.width * 0.5, point.y - 39);
    }

    function drawVehicle(vehicle) {
        if (!vehicle.active && !vehicle.finished) return;
        const point = worldToScreen(vehicle.x, vehicle.y);
        if (point.y < -120 || point.y > world.height + 120) return;
        const fall = vehicle.falling > 0 ? clamp(vehicle.falling / 1.12, 0, 1) : 0;
        context.save();
        context.translate(point.x, point.y + fall * 30);
        context.rotate(vehicle.heading + Math.sign(vehicle.x || 1) * fall * 0.5);
        context.scale(1 - fall * 0.58, 1 - fall * 0.2);
        context.globalAlpha = 1 - fall * 0.74;
        const scale = world.scale;
        context.fillStyle = "rgba(0,0,0,0.36)";
        context.fillRect(-19 * scale + 5, -34 * scale + 8, 38 * scale, 68 * scale);
        context.fillStyle = "#181b18";
        context.fillRect(-23 * scale, -24 * scale, 6 * scale, 16 * scale);
        context.fillRect(17 * scale, -24 * scale, 6 * scale, 16 * scale);
        context.fillRect(-23 * scale, 11 * scale, 6 * scale, 16 * scale);
        context.fillRect(17 * scale, 11 * scale, 6 * scale, 16 * scale);
        context.fillStyle = vehicle.collisionFlash > 0.2 ? "#e2d8b9" : vehicle.colour;
        context.fillRect(-18 * scale, -34 * scale, 36 * scale, 68 * scale);
        context.fillStyle = "rgba(22,27,24,0.82)";
        context.fillRect(-13 * scale, -13 * scale, 26 * scale, 25 * scale);
        context.fillStyle = "rgba(210,220,205,0.28)";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 4 * scale);
        context.strokeStyle = vehicle.isPlayer ? "#f1dda1" : "rgba(234,231,216,0.45)";
        context.lineWidth = vehicle.isPlayer ? 2.2 : 1;
        context.strokeRect(-18 * scale, -34 * scale, 36 * scale, 68 * scale);
        context.fillStyle = vehicle.isPlayer ? "#151713" : "#ece6d5";
        context.font = `600 ${Math.max(7, 10 * scale)}px General Sans, sans-serif`;
        context.textAlign = "center";
        context.fillText(String(vehicle.number).padStart(2, "0"), 0, 28 * scale);
        if (vehicle.crush > 0.55) {
            context.strokeStyle = "#d25e43";
            context.lineWidth = 2;
            context.strokeRect(-24 * scale, -40 * scale, 48 * scale, 80 * scale);
        }
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const point = worldToScreen(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maximumLife, 0, 1);
            context.fillStyle = particle.colour;
            context.fillRect(point.x, point.y, 2.5, 2.5);
        });
        context.globalAlpha = 1;
    }

    function drawDistanceMarkers() {
        const bounds = visibleBounds();
        const start = Math.max(0, Math.floor(bounds.bottom / 500) * 500);
        context.save();
        context.fillStyle = "rgba(230,225,209,0.48)";
        context.font = "500 9px General Sans, sans-serif";
        for (let y = start; y < bounds.top + 500 && y <= TRACK_LENGTH; y += 500) {
            const point = worldToScreen(-roadHalfWidth(y), y);
            context.textAlign = "right";
            context.fillText(`${Math.max(0, TRACK_LENGTH - y)} M`, point.x - 29, point.y + 3);
        }
        context.restore();
    }

    function relevantChamber() {
        return chambers.find((chamber) => player.y < chamber.end + 150 && chamber.phase !== "settled") || chambers.find((chamber) => player.y < chamber.end + 150) || chambers[chambers.length - 1];
    }

    function drawEventBanner() {
        const chamber = relevantChamber();
        if (!chamber) return;
        let title = `APPROACH COMPRESSION ${String(chamber.index + 1).padStart(2, "0")}`;
        let copy = `${chamber.oldCount} lanes remain open`;
        let colour = "#78907b";
        if (chamber.phase === "census") {
            title = `LANE ${chamber.selected + 1} SELECTED`;
            copy = `${Math.max(0, (1.45 - chamber.timer) / settings.wallSpeed).toFixed(1)} seconds before release`;
            colour = "#d5a245";
        } else if (chamber.phase === "compressing") {
            title = "WALLS CLOSING — MERGE";
            copy = `Lane ${chamber.selected + 1} is peeling away`;
            colour = "#c65a42";
        } else if (chamber.phase === "settled") {
            title = `${chamber.newCount} LANES SURVIVE`;
            copy = "Compression locked";
        }
        context.save();
        context.translate(world.width * 0.5, world.width < 700 ? 224 : 154);
        context.fillStyle = "rgba(9,10,9,0.84)";
        context.fillRect(-148, -23, 296, 47);
        context.fillStyle = colour;
        context.fillRect(-148, -23, 3, 47);
        context.textAlign = "center";
        context.font = "600 12px General Sans, sans-serif";
        context.fillText(title, 0, -3);
        context.fillStyle = "rgba(235,231,218,0.58)";
        context.font = "500 8px General Sans, sans-serif";
        context.fillText(copy.toUpperCase(), 0, 13);
        context.restore();
    }

    function drawResultBanner() {
        context.save();
        context.fillStyle = "rgba(5,6,5,0.72)";
        context.fillRect(0, 0, world.width, world.height);
        context.translate(world.width * 0.5, world.height * 0.48);
        context.fillStyle = "#11130f";
        context.fillRect(-215, -92, 430, 184);
        context.strokeStyle = world.result === "finished" ? "#7c9b82" : "#b7523c";
        context.strokeRect(-215, -92, 430, 184);
        context.textAlign = "center";
        context.fillStyle = world.result === "finished" ? "#83aa8b" : "#ce5b42";
        context.font = "600 9px General Sans, sans-serif";
        context.fillText(world.result === "finished" ? "HEAT COMPLETE" : "VEHICLE ELIMINATED", 0, -48);
        context.fillStyle = "#eee8da";
        context.font = "500 37px Clash Display, General Sans, sans-serif";
        context.fillText(world.result === "finished" ? "FINAL LANE SECURED" : "COMPRESSION LOSS", 0, 0);
        context.fillStyle = "rgba(238,232,218,0.58)";
        context.font = "500 10px General Sans, sans-serif";
        context.fillText(`${world.detail.toUpperCase()}  ·  USE RESTART HEAT TO RUN AGAIN`, 0, 34);
        context.restore();
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 79), 31) - 0.5) * world.shake * 7;
        const shakeY = (seeded(Math.floor(world.time * 73), 32) - 0.5) * world.shake * 7;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, shakeY * world.dpr);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawBackground();
        drawDistanceMarkers();
        allVehicles().slice().sort((first, second) => second.y - first.y).forEach(drawVehicle);
        drawParticles();
        drawEventBanner();
        if (world.result !== "racing") drawResultBanner();
    }

    function updateReadouts() {
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        const liveLanes = Math.max(1, 8 - chambers.filter((chamber) => chamber.phase === "settled").length);
        lanesReadout.textContent = String(liveLanes).padStart(2, "0");
        speedReadout.textContent = `${Math.round(player.speed * 0.36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? `${STARTERS - world.eliminated} remain` : world.detail;

        const chamber = relevantChamber();
        let counts = chamber ? (chamber.triggered ? chamber.counts : liveCensus(chamber)) : [];
        if (chamber) {
            chamberReadout.textContent = chamber.phase === "census" ? `Census ${chamber.index + 1}` : chamber.phase === "compressing" ? `Closing ${chamber.index + 1}` : chamber.phase === "settled" ? `${chamber.newCount} lanes` : `Approach ${chamber.index + 1}`;
            if (chamber.selected >= 0) {
                selectionReadout.textContent = `Lane ${chamber.selected + 1} selected`;
                censusCopy.textContent = chamber.phase === "census" ? "Move before the surface locks release." : chamber.phase === "compressing" ? "The selected strip is leaving the causeway." : `${chamber.newCount} lanes continue beyond the chamber.`;
            } else {
                selectionReadout.textContent = "No lane selected";
                censusCopy.textContent = `Checkpoint ${chamber.index + 1} is reading the pack.`;
            }
        }

        const maximum = Math.max(1, ...counts);
        censusBars.forEach((bar, index) => {
            const count = counts[index] || 0;
            const fill = bar.querySelector("b");
            if (fill) fill.style.height = `${Math.max(count ? 16 : 2, count / maximum * 100)}%`;
            bar.classList.toggle("is-selected", Boolean(chamber && index === chamber.selected));
            bar.classList.toggle("is-closed", index >= counts.length);
            const label = bar.querySelector("small");
            if (label) label.textContent = index < counts.length ? `${index + 1}·${count}` : "—";
        });

        const half = roadHalfWidth(player.y) - 28;
        const clearance = Math.max(0, half - Math.abs(player.x));
        clearanceReadout.textContent = `${Math.round(clearance)} cm`;
        clearanceBar.style.width = `${clamp(clearance / Math.max(1, half) * 100, 0, 100)}%`;
        clearanceBar.classList.toggle("is-danger", clearance < 58);
        clearanceCopy.textContent = player.crush > 0.6 ? "Pinned — steer away now" : clearance < 58 ? "Wall contact imminent" : chamber && chamber.phase === "compressing" ? "Both boundaries are moving" : "Maintain merge clearance";
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth || 1280);
        const height = Math.max(1, canvas.clientHeight || 900);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        world.width = width;
        world.height = height;
        world.scale = clamp(Math.min(width / 1280, height / 1080), 0.48, 0.92);
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
            if (button.dataset.compressionRunControl === name) button.classList.toggle("is-pressed", active);
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
        const name = button.dataset.compressionRunControl;
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

    window.compressionRun = {
        resize,
        reset: resetHeat,
        setControl: (name, active) => setInput(name, Boolean(active)),
        diagnostics: () => ({
            result: world.result,
            detail: world.detail,
            time: world.time,
            player: {
                x: player.x,
                y: player.y,
                vx: player.vx,
                vy: player.vy,
                speed: player.speed,
                active: player.active,
                falling: player.falling,
                crush: player.crush,
                position: racePosition(),
                lanes: lanesAt(player.y)
            },
            activeRivals: rivals.filter((vehicle) => vehicle.active && !vehicle.finished && vehicle.falling === 0).length,
            eliminated: world.eliminated,
            finishers: world.finishers,
            chambers: chambers.map((chamber) => ({
                phase: chamber.phase,
                closure: chamber.closure,
                selected: chamber.selected,
                counts: chamber.counts.slice()
            }))
        })
    };

    requestAnimationFrame(animate);
})();
