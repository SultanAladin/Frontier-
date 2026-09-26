"use strict";

(() => {
    const canvas = document.getElementById("empty-city-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("empty-city");
    const resetButton = document.getElementById("empty-city-reset");
    const overviewButton = document.getElementById("empty-city-overview");
    const positionReadout = document.getElementById("empty-city-position-readout");
    const surfaceReadout = document.getElementById("empty-city-surface-readout");
    const releaseReadout = document.getElementById("empty-city-release-readout");
    const speedReadout = document.getElementById("empty-city-speed-readout");
    const resultReadout = document.getElementById("empty-city-result-readout");
    const depthReadout = document.getElementById("empty-city-depth-readout");
    const depthBar = document.getElementById("empty-city-depth-bar");
    const depthCopy = document.getElementById("empty-city-depth-copy");
    const sluiceStatus = document.getElementById("empty-city-sluice-status");
    const currentStatus = document.getElementById("empty-city-current-status");
    const gateStatus = document.getElementById("empty-city-gate-status");
    const drainStatus = document.getElementById("empty-city-drain-status");
    const siltStatus = document.getElementById("empty-city-silt-status");
    const finishStatus = document.getElementById("empty-city-finish-status");
    const buttons = Array.from(document.querySelectorAll("[data-empty-city-control]"));

    const FIELD_WIDTH = 1800;
    const FIELD_LENGTH = 8000;
    const STARTERS = 24;
    const CAR_RADIUS = 22;
    const CYCLE_LENGTH = 18;
    const TAU = Math.PI * 2;
    const avenueCenters = [-520, 0, 520];
    const avenueNames = ["West", "Central", "East"];
    const releaseOrder = [1, 0, 2, 1, 2, 0];
    const input = { throttle: false, brake: false, left: false, right: false };
    const colours = ["#7b807a", "#8b6c58", "#667a78", "#8a8068", "#969080", "#69726b", "#8b604e"];
    const world = {
        width: 1320,
        height: 940,
        dpr: 1,
        scale: .66,
        time: 0,
        lastTime: performance.now(),
        cameraY: 390,
        cameraV: 0,
        overview: false,
        result: "racing",
        detail: "Reservoir armed",
        finishers: 0,
        eliminated: 0,
        shake: 0,
        silt: [],
        debris: [],
        particles: [],
        depositedCycle: -1,
        wasVisible: false
    };

    const buildings = [];
    for (let row = 0; row < 8; row += 1) {
        const y = 650 + row * 900;
        [
            { x: -760, width: 230 },
            { x: -260, width: 250 },
            { x: 260, width: 250 },
            { x: 760, width: 230 }
        ].forEach((column, columnIndex) => {
            buildings.push({ id: row * 4 + columnIndex, x: column.x, y, width: column.width, length: 560 });
        });
    }

    const gateBlueprints = [
        { lane: 1, y: 1420 }, { lane: 0, y: 2560 }, { lane: 2, y: 3680 },
        { lane: 1, y: 4820 }, { lane: 0, y: 5960 }, { lane: 2, y: 7080 }
    ];

    const drains = [
        { x: -520, y: 1080 }, { x: 0, y: 1980 }, { x: 520, y: 2880 }, { x: -520, y: 3780 },
        { x: 0, y: 4680 }, { x: 520, y: 5580 }, { x: -520, y: 6480 }, { x: 0, y: 7380 }
    ];

    const player = createCar(42, -85, true, 18);
    let rivals = [];
    let gates = [];

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function lerp(start, end, ratio) {
        return start + (end - start) * ratio;
    }

    function seeded(index, salt = 0) {
        const sample = Math.sin(index * 93.07 + salt * 44.83) * 43758.5453;
        return sample - Math.floor(sample);
    }

    function wrapAngle(angle) {
        let wrapped = angle;
        while (wrapped > Math.PI) wrapped -= TAU;
        while (wrapped < -Math.PI) wrapped += TAU;
        return wrapped;
    }

    function createCar(x, y, isPlayer, number) {
        return {
            x, y,
            vx: 0, vy: 0,
            heading: 0,
            speed: 0,
            isPlayer,
            number,
            colour: isPlayer ? "#c5a44d" : colours[number % colours.length],
            mass: isPlayer ? 1560 : 1260 + seeded(number, 4) * 850,
            aggression: .3 + seeded(number, 8) * .66,
            active: true,
            finished: false,
            eliminated: false,
            finishPosition: 0,
            flash: 0,
            spin: 0,
            waterDepth: 0,
            laneIndex: nearestLane(x),
            targetX: x,
            reason: ""
        };
    }

    function allCars() {
        return [player, ...rivals];
    }

    function activeCars() {
        return allCars().filter((car) => car.active && !car.finished && !car.eliminated);
    }

    function nearestLane(x) {
        let lane = 0;
        let distance = Infinity;
        avenueCenters.forEach((center, index) => {
            const candidate = Math.abs(x - center);
            if (candidate < distance) {
                lane = index;
                distance = candidate;
            }
        });
        return lane;
    }

    function reset() {
        Object.assign(player, createCar(42, -85, true, 18));
        rivals = [];
        for (let index = 0; index < STARTERS - 1; index += 1) {
            const lane = index % 8;
            const row = Math.floor(index / 8);
            rivals.push(createCar(-610 + lane * 174 + (seeded(index, 3) - .5) * 20, -row * 76 + (seeded(index, 5) - .5) * 15, false, index + 1));
        }
        gates = gateBlueprints.map((gate, index) => ({
            number: index + 1,
            lane: gate.lane,
            y: gate.y,
            pivotX: avenueCenters[gate.lane] - 128,
            length: 256,
            closure: 0,
            angle: 0,
            angularVelocity: 0,
            jammed: false,
            jamAngle: 0,
            impacts: 0
        }));
        Object.assign(world, {
            time: 0,
            cameraY: 390,
            cameraV: 0,
            overview: false,
            result: "racing",
            detail: "Reservoir armed",
            finishers: 0,
            eliminated: 0,
            shake: 0,
            depositedCycle: -1
        });
        world.silt.length = 0;
        world.debris.length = 0;
        world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey districts";
        updateReadouts();
        render();
    }

    function floodState(time = world.time) {
        const cycle = Math.floor(time / CYCLE_LENGTH);
        const local = time - cycle * CYCLE_LENGTH;
        const lane = releaseOrder[cycle % releaseOrder.length];
        let phase;
        let frontY;
        if (local < 4) {
            phase = "warning";
            frontY = FIELD_LENGTH + 300;
        } else if (local < 16.5) {
            phase = "releasing";
            frontY = FIELD_LENGTH + 120 - (local - 4) * 650;
        } else {
            phase = "draining";
            frontY = -100;
        }
        return { cycle, local, lane, phase, frontY, remaining: CYCLE_LENGTH - local };
    }

    function waterDepthAt(x, y, state = floodState()) {
        const laneDistance = Math.abs(x - avenueCenters[state.lane]);
        if (laneDistance > 190 || state.phase === "warning") return 0;
        if (state.phase === "draining") {
            return clamp((CYCLE_LENGTH - state.local) / 1.5, 0, 1) * clamp(1 - laneDistance / 190, 0, 1) * .45;
        }
        const behindFront = y - state.frontY;
        if (behindFront < -70 || behindFront > 1950) return 0;
        const longitudinal = behindFront < 150 ? clamp((behindFront + 70) / 220, 0, 1) : clamp((1950 - behindFront) / 520, 0, 1);
        const lateral = clamp(1 - laneDistance / 190, 0, 1);
        return clamp(longitudinal * lateral, 0, 1);
    }

    function siltAt(x, y) {
        return world.silt.some((patch) => {
            const dx = (x - patch.x) / patch.rx;
            const dy = (y - patch.y) / patch.ry;
            return dx * dx + dy * dy < 1;
        });
    }

    function inCrossStreet(y) {
        if (y < 320 || y > 7550) return true;
        for (let index = 0; index <= 8; index += 1) {
            const center = 1080 + index * 900;
            if (Math.abs(y - center) < 165) return true;
        }
        return false;
    }

    function updateDeposits(state) {
        if (state.cycle <= world.depositedCycle) return;
        if (state.cycle === 0) {
            world.depositedCycle = 0;
            return;
        }
        const completedCycle = state.cycle - 1;
        const lane = releaseOrder[completedCycle % releaseOrder.length];
        for (let index = 0; index < 8; index += 1) {
            const patch = {
                x: avenueCenters[lane] + (seeded(completedCycle * 11 + index, 3) - .5) * 210,
                y: 600 + index * 930 + seeded(index, completedCycle) * 190,
                rx: 55 + seeded(index, 7 + completedCycle) * 55,
                ry: 85 + seeded(index, 9 + completedCycle) * 80,
                cycle: completedCycle
            };
            world.silt.push(patch);
            if (index % 2 === 0) {
                world.debris.push({
                    x: patch.x + (seeded(index, 13) - .5) * patch.rx,
                    y: patch.y + (seeded(index, 15) - .5) * patch.ry,
                    radius: 15 + seeded(index, 17) * 15
                });
            }
        }
        world.depositedCycle = state.cycle;
    }

    function gateSegment(gate) {
        return {
            ax: gate.pivotX,
            ay: gate.y,
            bx: gate.pivotX + Math.sin(gate.angle) * gate.length,
            by: gate.y + Math.cos(gate.angle) * gate.length
        };
    }

    function distanceToSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        const ratio = lengthSquared ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1) : 0;
        const x = ax + dx * ratio;
        const y = ay + dy * ratio;
        return { distance: Math.hypot(px - x, py - y), x, y, ratio };
    }

    function updateGates(delta, state) {
        gates.forEach((gate) => {
            const localDepth = waterDepthAt(avenueCenters[gate.lane], gate.y, state);
            const targetClosure = gate.jammed ? gate.jamAngle / (Math.PI * .5) : localDepth > .3 ? 1 : 0;
            const previousAngle = gate.angle;
            gate.closure += (targetClosure - gate.closure) * Math.min(1, delta * (localDepth > .3 ? 2.8 : 1.4));
            gate.angle = gate.closure * Math.PI * .5;
            gate.angularVelocity = wrapAngle(gate.angle - previousAngle) / Math.max(.001, delta);
        });
    }

    function addParticle(x, y, type, count = 1) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(index + world.time * 150, x + y) * TAU;
            const speed = 12 + seeded(index, y) * 65;
            world.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - (type === "water" ? 35 : 0),
                radius: 4 + seeded(index, 9) * 9,
                life: .7 + seeded(index, 12) * 1.1,
                maxLife: 1.8,
                type
            });
        }
        if (world.particles.length > 340) world.particles.splice(0, world.particles.length - 340);
    }

    function resolveBuilding(car, building) {
        const halfWidth = building.width * .5 + CAR_RADIUS;
        const halfLength = building.length * .5 + CAR_RADIUS;
        const dx = car.x - building.x;
        const dy = car.y - building.y;
        if (Math.abs(dx) >= halfWidth || Math.abs(dy) >= halfLength) return false;
        const penetrationX = halfWidth - Math.abs(dx);
        const penetrationY = halfLength - Math.abs(dy);
        if (penetrationX < penetrationY) {
            const direction = Math.sign(dx || 1);
            car.x = building.x + direction * halfWidth;
            car.vx *= -.26;
        } else {
            const direction = Math.sign(dy || 1);
            car.y = building.y + direction * halfLength;
            car.vy *= -.26;
        }
        car.flash = 1;
        if (car.isPlayer) world.shake = Math.max(world.shake, .42);
        return true;
    }

    function resolveGate(car, gate) {
        const segment = gateSegment(gate);
        const hit = distanceToSegment(car.x, car.y, segment.ax, segment.ay, segment.bx, segment.by);
        const minimum = CAR_RADIUS + 11;
        if (hit.distance >= minimum) return;
        let nx;
        let ny;
        if (hit.distance < .001) {
            const dx = segment.bx - segment.ax;
            const dy = segment.by - segment.ay;
            const length = Math.max(1, Math.hypot(dx, dy));
            nx = -dy / length;
            ny = dx / length;
        } else {
            nx = (car.x - hit.x) / hit.distance;
            ny = (car.y - hit.y) / hit.distance;
        }
        car.x += nx * (minimum - hit.distance + 1);
        car.y += ny * (minimum - hit.distance + 1);
        const impact = Math.abs(car.vx * nx + car.vy * ny);
        const inward = car.vx * nx + car.vy * ny;
        if (inward < 0) {
            car.vx -= inward * nx * 1.38;
            car.vy -= inward * ny * 1.38;
        }
        const sweep = gate.angularVelocity * gate.length * hit.ratio;
        car.vx += Math.cos(gate.angle) * sweep * .35;
        car.vy -= Math.sin(gate.angle) * sweep * .35;
        car.flash = 1;
        gate.impacts += 1;
        if (!gate.jammed && impact > 42 && gate.closure > .05 && gate.closure < .97) {
            gate.jammed = true;
            gate.jamAngle = gate.angle;
            addParticle(hit.x, hit.y, "spark", 8);
        }
        if (car.isPlayer) world.shake = Math.max(world.shake, .65);
    }

    function resolveDebris(car) {
        world.debris.forEach((debris) => {
            const dx = car.x - debris.x;
            const dy = car.y - debris.y;
            const distance = Math.hypot(dx, dy);
            const minimum = CAR_RADIUS + debris.radius;
            if (distance >= minimum || distance < .001) return;
            car.x += dx / distance * (minimum - distance + 1);
            car.y += dy / distance * (minimum - distance + 1);
            car.vx *= .78;
            car.vy *= .78;
            car.spin += car.number % 2 ? .24 : -.24;
            car.flash = 1;
        });
    }

    function nearestDrainPull(car, depth) {
        if (depth < .15) return null;
        let nearest = null;
        let nearestDistance = Infinity;
        drains.forEach((drain) => {
            const distance = Math.hypot(car.x - drain.x, car.y - drain.y);
            if (distance < 275 && distance < nearestDistance) {
                nearest = drain;
                nearestDistance = distance;
            }
        });
        return nearest ? { drain: nearest, distance: nearestDistance } : null;
    }

    function laneScore(car, lane, state) {
        const x = avenueCenters[lane];
        const depth = waterDepthAt(x, car.y + 520, state);
        const drainPenalty = drains.some((drain) => Math.abs(drain.x - x) < 80 && drain.y > car.y && drain.y - car.y < 1900) ? 260 : 0;
        const gatePenalty = gates.some((gate) => gate.lane === lane && gate.y > car.y && gate.y - car.y < 1900 && (gate.closure > .5 || gate.jammed)) ? 320 : 0;
        return depth * 640 + Math.abs(x - car.x) * .28 + drainPenalty + gatePenalty;
    }

    function recommendedLane(car, state = floodState()) {
        const currentLane = nearestLane(car.x);
        if (!inCrossStreet(car.y)) return currentLane;
        let bestLane = currentLane;
        let bestScore = laneScore(car, bestLane, state);
        for (let lane = 0; lane < avenueCenters.length; lane += 1) {
            const score = laneScore(car, lane, state) + seeded(car.number, lane) * 28;
            if (score < bestScore) {
                bestScore = score;
                bestLane = lane;
            }
        }
        return bestLane;
    }

    function artificialDriver(car) {
        const state = floodState();
        if (inCrossStreet(car.y)) car.laneIndex = recommendedLane(car, state);
        const targetX = avenueCenters[car.laneIndex];
        car.targetX = targetX;
        const desired = Math.atan2(targetX - car.x, 380);
        const error = wrapAngle(desired - car.heading);
        return {
            throttle: car.waterDepth > .78 ? .72 : .84 + car.aggression * .14,
            brake: car.waterDepth > .82 && Math.abs(error) > .45 ? .14 : 0,
            steering: clamp(error * 2.2 - car.spin * .18, -1, 1)
        };
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished || car.eliminated) return;
        car.flash = Math.max(0, car.flash - delta * 3.5);
        car.spin *= Math.pow(.06, delta);
        car.heading += car.spin * delta;
        const state = floodState();
        const depth = waterDepthAt(car.x, car.y, state);
        const silt = siltAt(car.x, car.y);
        car.waterDepth = depth;
        const grip = depth > .05 ? lerp(.82, .3, depth) : silt ? .58 : .9;
        const power = depth > .05 ? lerp(.96, .53, depth) : silt ? .82 : 1;
        const speed = Math.hypot(car.vx, car.vy);

        if (controls.throttle > 0) {
            const force = 232 / (car.mass / 1560) * controls.throttle * power;
            car.vx += Math.sin(car.heading) * force * delta;
            car.vy += Math.cos(car.heading) * force * delta;
        }
        if (controls.brake > 0 && speed > 1) {
            const next = Math.max(0, speed - 255 * grip * controls.brake * delta);
            car.vx *= next / speed;
            car.vy *= next / speed;
        }

        car.heading += controls.steering * clamp(speed / 68, .15, 1) * (1.23 + grip * .68) * delta;
        const forwardX = Math.sin(car.heading);
        const forwardY = Math.cos(car.heading);
        const longitudinal = car.vx * forwardX + car.vy * forwardY;
        const lateral = (car.vx * forwardY - car.vy * forwardX) * Math.pow(Math.max(.04, 1 - grip * 4.15 * delta), 1);
        car.vx = forwardX * longitudinal + forwardY * lateral;
        car.vy = forwardY * longitudinal - forwardX * lateral;

        if (depth > .05) {
            car.vy -= depth * 148 * delta;
            car.vx += Math.sin(car.y / 410 + world.time * .35) * depth * 25 * delta;
            if (seeded(car.number + Math.floor(world.time * 13), 21) > .78) addParticle(car.x, car.y, "water", 1);
        }
        const pull = nearestDrainPull(car, depth);
        if (pull) {
            const dx = pull.drain.x - car.x;
            const dy = pull.drain.y - car.y;
            const distance = Math.max(1, pull.distance);
            const force = (1 - distance / 275) * depth * 250;
            car.vx += dx / distance * force * delta;
            car.vy += dy / distance * force * delta;
            if (distance < 48) {
                eliminate(car, "Pulled beneath an open drain");
                return;
            }
        }

        const maximum = depth > .65 ? 270 : silt ? 315 : 410;
        const driven = Math.hypot(car.vx, car.vy);
        if (driven > maximum) {
            car.vx *= maximum / driven;
            car.vy *= maximum / driven;
        }
        const rolling = depth > .05 ? lerp(.989, .97, depth) : silt ? .977 : .991;
        car.vx *= Math.pow(rolling, delta * 60);
        car.vy *= Math.pow(rolling, delta * 60);
        car.x += car.vx * delta;
        car.y += car.vy * delta;
        car.speed = Math.hypot(car.vx, car.vy);

        buildings.forEach((building) => resolveBuilding(car, building));
        gates.forEach((gate) => resolveGate(car, gate));
        resolveDebris(car);
        if (Math.abs(car.x) > FIELD_WIDTH * .5 - 28) {
            const side = Math.sign(car.x);
            car.x = side * (FIELD_WIDTH * .5 - 28);
            car.vx *= -.24;
            car.flash = 1;
        }
        if (car.y < -350) {
            eliminate(car, "Washed through the south bulkhead");
            return;
        }
        if (car.y >= FIELD_LENGTH) finish(car);
    }

    function collideCars() {
        const cars = activeCars();
        for (let firstIndex = 0; firstIndex < cars.length; firstIndex += 1) {
            for (let secondIndex = firstIndex + 1; secondIndex < cars.length; secondIndex += 1) {
                const first = cars[firstIndex];
                const second = cars[secondIndex];
                const dx = second.x - first.x;
                const dy = second.y - first.y;
                const distance = Math.hypot(dx, dy);
                const minimum = CAR_RADIUS * 2;
                if (distance >= minimum || distance < .001) continue;
                const nx = dx / distance;
                const ny = dy / distance;
                const overlap = minimum - distance;
                first.x -= nx * overlap * .5;
                first.y -= ny * overlap * .5;
                second.x += nx * overlap * .5;
                second.y += ny * overlap * .5;
                const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
                if (relative < 0) {
                    first.vx += relative * nx * .53;
                    first.vy += relative * ny * .53;
                    second.vx -= relative * nx * .53;
                    second.vy -= relative * ny * .53;
                    first.flash = second.flash = 1;
                }
            }
        }
    }

    function eliminate(car, reason) {
        if (car.eliminated || car.finished) return;
        car.eliminated = true;
        car.active = false;
        car.reason = reason;
        world.eliminated += 1;
        addParticle(car.x, car.y, "water", 10);
        if (car.isPlayer) {
            world.result = "eliminated";
            world.detail = reason;
            world.shake = 1;
        }
    }

    function finish(car) {
        if (car.finished || car.eliminated) return;
        car.finished = true;
        car.active = false;
        world.finishers += 1;
        car.finishPosition = world.finishers;
        if (car.isPlayer) {
            world.result = "finished";
            world.detail = car.finishPosition === 1 ? "First through the overflow tunnel" : `Finished P${car.finishPosition}`;
        }
    }

    function updateParticles(delta) {
        world.particles.forEach((particle) => {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(.13, delta);
            particle.vy *= Math.pow(.13, delta);
            particle.radius += delta * (particle.type === "water" ? 5 : 2);
            particle.life -= delta;
        });
        world.particles = world.particles.filter((particle) => particle.life > 0);
    }

    function racePosition() {
        if (player.finished) return player.finishPosition;
        if (player.eliminated) return STARTERS - world.eliminated + 1;
        return clamp(rivals.filter((car) => car.finished || (car.active && car.y > player.y)).length + 1, 1, STARTERS);
    }

    function update(delta) {
        world.time += delta;
        if (world.result !== "racing") {
            updateParticles(delta);
            updateReadouts();
            return;
        }
        const state = floodState();
        updateDeposits(state);
        updateGates(delta, state);
        rivals.forEach((car) => updateCar(car, delta, artificialDriver(car)));
        updateCar(player, delta, {
            throttle: input.throttle ? 1 : 0,
            brake: input.brake ? 1 : 0,
            steering: (input.left ? -1 : 0) + (input.right ? 1 : 0)
        });
        collideCars();
        updateParticles(delta);
        const targetY = world.overview ? FIELD_LENGTH * .5 : player.y + 390;
        world.cameraV += (targetY - world.cameraY) * Math.min(1, delta * 5);
        world.cameraV *= Math.pow(.004, delta);
        world.cameraY += world.cameraV * delta;
        world.shake = Math.max(0, world.shake - delta * 2.2);
        updateReadouts();
    }

    function activeScale() {
        return world.overview
            ? Math.min((world.width - 80) / (FIELD_WIDTH + 190), (world.height - 70) / (FIELD_LENGTH + 260))
            : world.scale;
    }

    function point(x, y) {
        const scale = activeScale();
        return { x: world.width * .5 + x * scale, y: world.height * .68 - (y - world.cameraY) * scale };
    }

    function drawCity() {
        context.fillStyle = "#0c0f0f";
        context.fillRect(0, 0, world.width, world.height);
        const scale = activeScale();
        const left = world.width * .5 - FIELD_WIDTH * .5 * scale;
        const right = world.width * .5 + FIELD_WIDTH * .5 * scale;
        context.fillStyle = "#4c514e";
        context.fillRect(left, 0, right - left, world.height);

        context.strokeStyle = "rgba(221,218,204,.12)";
        context.lineWidth = Math.max(1, 3 * scale);
        avenueCenters.forEach((center) => {
            const x = point(center, 0).x;
            context.setLineDash([22 * scale, 18 * scale]);
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, world.height);
            context.stroke();
        });
        context.setLineDash([]);

        world.silt.forEach((patch) => {
            const p = point(patch.x, patch.y);
            context.fillStyle = "rgba(91,77,57,.72)";
            context.beginPath();
            context.ellipse(p.x, p.y, patch.rx * scale, patch.ry * scale, 0, 0, TAU);
            context.fill();
        });
        world.debris.forEach((debris) => {
            const p = point(debris.x, debris.y);
            context.fillStyle = "#514c42";
            context.beginPath();
            context.arc(p.x, p.y, debris.radius * scale, 0, TAU);
            context.fill();
        });

        buildings.forEach((building) => {
            const p = point(building.x, building.y);
            context.fillStyle = "rgba(0,0,0,.4)";
            context.fillRect(p.x - building.width * scale * .5 + 8, p.y - building.length * scale * .5 + 10, building.width * scale, building.length * scale);
            context.fillStyle = building.id % 3 === 0 ? "#292d2b" : building.id % 3 === 1 ? "#303330" : "#262a28";
            context.fillRect(p.x - building.width * scale * .5, p.y - building.length * scale * .5, building.width * scale, building.length * scale);
            context.strokeStyle = "rgba(184,182,168,.22)";
            context.lineWidth = Math.max(1, 3 * scale);
            context.strokeRect(p.x - building.width * scale * .5, p.y - building.length * scale * .5, building.width * scale, building.length * scale);
            context.fillStyle = "rgba(7,9,8,.75)";
            for (let windowIndex = -2; windowIndex <= 2; windowIndex += 1) {
                context.fillRect(p.x - building.width * scale * .33, p.y + windowIndex * 48 * scale - 7 * scale, building.width * scale * .66, 14 * scale);
            }
        });

        const finish = point(0, FIELD_LENGTH);
        context.fillStyle = "#e1dccd";
        context.fillRect(left, finish.y - 9, right - left, 18);
        context.fillStyle = "rgba(7,8,8,.88)";
        context.fillRect(world.width * .5 - 101, finish.y - 49, 202, 26);
        context.fillStyle = "#eee8db";
        context.font = "600 9px General Sans";
        context.textAlign = "center";
        context.fillText("OVERFLOW TUNNEL", world.width * .5, finish.y - 32);
    }

    function drawFlood() {
        const state = floodState();
        const scale = activeScale();
        const centerX = point(avenueCenters[state.lane], 0).x;
        if (state.phase !== "warning") {
            const front = point(0, state.frontY).y;
            const rear = point(0, state.frontY + 1950).y;
            context.fillStyle = state.phase === "draining" ? "rgba(75,130,137,.13)" : "rgba(61,123,133,.38)";
            context.fillRect(centerX - 190 * scale, rear, 380 * scale, front - rear);
            context.strokeStyle = "rgba(178,213,215,.7)";
            context.lineWidth = Math.max(2, 9 * scale);
            context.beginPath();
            context.moveTo(centerX - 190 * scale, front);
            context.lineTo(centerX + 190 * scale, front);
            context.stroke();
            context.strokeStyle = "rgba(176,209,209,.25)";
            context.lineWidth = Math.max(1, 3 * scale);
            context.setLineDash([18 * scale, 14 * scale]);
            for (let y = state.frontY + 260; y < state.frontY + 1900; y += 290) {
                const sy = point(0, y).y;
                context.beginPath();
                context.moveTo(centerX - 170 * scale, sy);
                context.lineTo(centerX + 170 * scale, sy);
                context.stroke();
            }
            context.setLineDash([]);
        } else {
            const top = point(avenueCenters[state.lane], FIELD_LENGTH).x;
            context.fillStyle = `rgba(188,133,67,${.22 + Math.sin(world.time * 5) ** 2 * .34})`;
            context.fillRect(top - 180 * scale, 0, 360 * scale, 8);
        }
    }

    function drawDrains() {
        const scale = activeScale();
        const state = floodState();
        drains.forEach((drain, index) => {
            const p = point(drain.x, drain.y);
            if (p.y < -80 || p.y > world.height + 80) return;
            const depth = waterDepthAt(drain.x, drain.y, state);
            context.fillStyle = "#111817";
            context.beginPath();
            context.arc(p.x, p.y, 48 * scale, 0, TAU);
            context.fill();
            context.strokeStyle = depth > .15 ? "rgba(153,202,205,.78)" : "rgba(151,151,139,.5)";
            context.lineWidth = Math.max(1, 4 * scale);
            context.beginPath();
            context.arc(p.x, p.y, 48 * scale, world.time * (depth > .15 ? 1.3 : .15) + index, world.time * (depth > .15 ? 1.3 : .15) + index + Math.PI * 1.55);
            context.stroke();
            context.beginPath();
            context.arc(p.x, p.y, 27 * scale, -world.time * (depth > .15 ? 1.7 : .1), -world.time * (depth > .15 ? 1.7 : .1) + Math.PI * 1.35);
            context.stroke();
        });
    }

    function drawGates() {
        const scale = activeScale();
        gates.forEach((gate) => {
            const segment = gateSegment(gate);
            const a = point(segment.ax, segment.ay);
            const b = point(segment.bx, segment.by);
            if ((a.y < -80 && b.y < -80) || (a.y > world.height + 80 && b.y > world.height + 80)) return;
            context.strokeStyle = "rgba(0,0,0,.42)";
            context.lineWidth = Math.max(8, 20 * scale);
            context.beginPath();
            context.moveTo(a.x + 5, a.y + 6);
            context.lineTo(b.x + 5, b.y + 6);
            context.stroke();
            context.strokeStyle = gate.jammed ? "#9a5c42" : "#7a817d";
            context.lineWidth = Math.max(6, 15 * scale);
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.stroke();
            context.fillStyle = "#363b39";
            context.beginPath();
            context.arc(a.x, a.y, 18 * scale, 0, TAU);
            context.fill();
            if (gate.jammed) {
                context.fillStyle = "#c07954";
                context.beginPath();
                context.arc(a.x, a.y, 5 * scale, 0, TAU);
                context.fill();
            }
        });
    }

    function drawCar(car) {
        if ((!car.active && !car.finished) || car.eliminated) return;
        const p = point(car.x, car.y);
        if (p.y < -80 || p.y > world.height + 80) return;
        const scale = activeScale();
        context.save();
        context.translate(p.x, p.y);
        context.rotate(car.heading);
        context.fillStyle = "rgba(0,0,0,.36)";
        context.fillRect(-16 * scale + 4, -29 * scale + 6, 32 * scale, 58 * scale);
        context.fillStyle = car.flash > 0 ? "#e4ded0" : car.colour;
        context.fillRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.fillStyle = "#1e2322";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 21 * scale);
        context.strokeStyle = car.isPlayer ? "#efdc9f" : "rgba(234,232,220,.5)";
        context.lineWidth = car.isPlayer ? 2 : 1;
        context.strokeRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const p = point(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1) * .55;
            if (particle.type === "spark") {
                context.strokeStyle = "#d5a45d";
                context.lineWidth = 2;
                context.beginPath();
                context.moveTo(p.x, p.y);
                context.lineTo(p.x + particle.vx * .08, p.y - particle.vy * .08);
                context.stroke();
            } else {
                context.strokeStyle = "#a8ced1";
                context.lineWidth = 1;
                context.beginPath();
                context.arc(p.x, p.y, particle.radius * activeScale(), 0, TAU);
                context.stroke();
            }
        });
        context.globalAlpha = 1;
    }

    function drawWaterVeil() {
        if (player.waterDepth < .08 || world.overview) return;
        context.fillStyle = `rgba(68,128,137,${player.waterDepth * .1})`;
        context.fillRect(0, 0, world.width, world.height);
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 4) - .5) * world.shake * 8;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, 0);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawCity();
        drawFlood();
        drawDrains();
        drawGates();
        allCars().slice().sort((first, second) => second.y - first.y).forEach(drawCar);
        drawParticles();
        drawWaterVeil();
        if (world.result !== "racing") {
            context.fillStyle = "rgba(5,7,7,.72)";
            context.fillRect(0, 0, world.width, world.height);
            context.fillStyle = world.result === "finished" ? "#eee8db" : "#8fc0c5";
            context.font = "500 40px Clash Display";
            context.textAlign = "center";
            context.fillText(world.result === "finished" ? "OVERFLOW TUNNEL REACHED" : "VEHICLE LOST BELOW STREET", world.width * .5, world.height * .5);
        }
    }

    function updateReadouts() {
        const state = floodState();
        const depth = waterDepthAt(player.x, player.y, state);
        const silt = siltAt(player.x, player.y);
        const nextLane = state.phase === "warning" ? state.lane : releaseOrder[(state.cycle + 1) % releaseOrder.length];
        const untilRelease = state.phase === "warning" ? 4 - state.local : CYCLE_LENGTH - state.local + 4;
        const jammed = gates.filter((gate) => gate.jammed).length;
        const activeDrains = drains.filter((drain) => waterDepthAt(drain.x, drain.y, state) > .15).length;
        const depthPercent = Math.round(depth * 100);
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        surfaceReadout.textContent = depth > .65 ? "Deep spillway" : depth > .08 ? "Flooded street" : silt ? "Deposited silt" : "Dry avenue";
        releaseReadout.textContent = `${avenueNames[nextLane]} / ${Math.max(0, untilRelease).toFixed(1)} s`;
        speedReadout.textContent = `${Math.round(player.speed * .36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? "Reservoir armed" : world.detail;
        depthReadout.textContent = `${depthPercent}%`;
        depthBar.style.width = `${depthPercent}%`;
        depthCopy.textContent = depth > .72 ? "Steering authority critically reduced" : depth > .2 ? "Southbound current loading vehicle" : silt ? "Flood deposit reducing dry grip" : "Dry tyres inside current district";
        sluiceStatus.textContent = state.phase === "warning" ? `${avenueNames[state.lane]} release charging` : state.phase === "releasing" ? `${avenueNames[state.lane]} wave moving south` : `${avenueNames[state.lane]} avenue draining`;
        currentStatus.textContent = depth > .1 ? `Player in ${depthPercent}% water` : "Player district dry";
        gateStatus.textContent = jammed ? `${jammed} of 6 gates jammed` : "Six gates responsive";
        drainStatus.textContent = activeDrains ? `${activeDrains} grates drawing water` : "Eight grates exposed";
        siltStatus.textContent = world.silt.length ? `${world.silt.length} persistent deposits` : "No flood deposits";
        finishStatus.textContent = world.finishers || world.eliminated ? `${world.finishers} finished / ${world.eliminated} drained` : "North portal open";
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth || 1320);
        const height = Math.max(1, canvas.clientHeight || 940);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        world.width = width;
        world.height = height;
        world.scale = clamp(Math.min(width / 1840, height / 1260), .45, .79);
        canvas.width = Math.round(width * world.dpr);
        canvas.height = Math.round(height * world.dpr);
        render();
    }

    const keyMap = { w: "throttle", arrowup: "throttle", s: "brake", arrowdown: "brake", a: "left", arrowleft: "left", d: "right", arrowright: "right" };

    function setControl(name, active) {
        if (!(name in input)) return;
        input[name] = active;
        buttons.forEach((button) => {
            if (button.dataset.emptyCityControl === name) button.classList.toggle("is-pressed", active);
        });
    }

    window.addEventListener("keydown", (event) => {
        const name = keyMap[event.key.toLowerCase()];
        if (!name || page.hidden) return;
        event.preventDefault();
        setControl(name, true);
    });
    window.addEventListener("keyup", (event) => {
        const name = keyMap[event.key.toLowerCase()];
        if (name) setControl(name, false);
    });
    window.addEventListener("blur", () => Object.keys(input).forEach((name) => setControl(name, false)));
    buttons.forEach((button) => {
        const name = button.dataset.emptyCityControl;
        const down = (event) => { event.preventDefault(); setControl(name, true); };
        const up = (event) => { event.preventDefault(); setControl(name, false); };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
    });
    resetButton.addEventListener("click", reset);
    overviewButton.addEventListener("click", () => {
        world.overview = !world.overview;
        overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey districts";
    });

    reset();

    function animate(time) {
        const delta = Math.min(.04, Math.max(0, (time - world.lastTime) / 1000));
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

    if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);

    window.emptyCity = {
        resize,
        reset,
        setControl,
        diagnostics: () => {
            const state = floodState();
            return {
                result: world.result,
                detail: world.detail,
                time: world.time,
                player: {
                    x: player.x,
                    y: player.y,
                    vx: player.vx,
                    vy: player.vy,
                    speed: player.speed,
                    heading: player.heading,
                    active: player.active,
                    position: racePosition(),
                    waterDepth: player.waterDepth,
                    lane: nearestLane(player.x),
                    routeTarget: avenueCenters[recommendedLane(player, state)],
                    inCrossStreet: inCrossStreet(player.y),
                    inSilt: siltAt(player.x, player.y)
                },
                flood: { cycle: state.cycle, lane: state.lane, phase: state.phase, frontY: state.frontY },
                finishers: world.finishers,
                eliminated: world.eliminated,
                activeRivals: rivals.filter((car) => car.active && !car.finished && !car.eliminated).length,
                jammedGates: gates.filter((gate) => gate.jammed).length,
                gateImpacts: gates.reduce((total, gate) => total + gate.impacts, 0),
                siltPatches: world.silt.length,
                debris: world.debris.length
            };
        }
    };

    requestAnimationFrame(animate);
})();
