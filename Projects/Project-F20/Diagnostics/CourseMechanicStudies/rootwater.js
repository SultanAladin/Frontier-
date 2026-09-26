"use strict";

(() => {
    const canvas = document.getElementById("rootwater-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("rootwater");
    const resetButton = document.getElementById("rootwater-reset");
    const overviewButton = document.getElementById("rootwater-overview");
    const positionReadout = document.getElementById("rootwater-position-readout");
    const surfaceReadout = document.getElementById("rootwater-surface-readout");
    const gapReadout = document.getElementById("rootwater-gap-readout");
    const speedReadout = document.getElementById("rootwater-speed-readout");
    const resultReadout = document.getElementById("rootwater-result-readout");
    const deadfallReadout = document.getElementById("rootwater-deadfall-readout");
    const deadfallBar = document.getElementById("rootwater-deadfall-bar");
    const deadfallCopy = document.getElementById("rootwater-deadfall-copy");
    const rootStatus = document.getElementById("rootwater-root-status");
    const canopyStatus = document.getElementById("rootwater-canopy-status");
    const fallStatus = document.getElementById("rootwater-fall-status");
    const twigStatus = document.getElementById("rootwater-twig-status");
    const currentStatus = document.getElementById("rootwater-current-status");
    const finishStatus = document.getElementById("rootwater-finish-status");
    const buttons = Array.from(document.querySelectorAll("[data-rootwater-control]"));

    const FIELD_WIDTH = 1700;
    const FIELD_LENGTH = 7800;
    const STARTERS = 24;
    const CAR_RADIUS = 23;
    const TAU = Math.PI * 2;
    const colours = ["#7e837b", "#876b58", "#647a76", "#887d65", "#97917e", "#667069", "#8d5f4d"];
    const input = { throttle: false, brake: false, left: false, right: false };
    const world = {
        width: 1320,
        height: 940,
        dpr: 1,
        scale: .67,
        time: 0,
        lastTime: performance.now(),
        cameraY: 390,
        cameraV: 0,
        overview: false,
        result: "racing",
        detail: "Delta open",
        finishers: 0,
        shake: 0,
        particles: [],
        wasVisible: false
    };

    const waypoints = [
        { y: -200, x: 0 }, { y: 850, x: 285 }, { y: 1650, x: -285 },
        { y: 2500, x: 275 }, { y: 3350, x: -270 }, { y: 4230, x: 285 },
        { y: 5100, x: -275 }, { y: 5980, x: 285 }, { y: 6840, x: -245 },
        { y: FIELD_LENGTH + 100, x: 0 }
    ];

    const trunks = [
        { x: -560, y: 850, radius: 74 }, { x: 545, y: 1610, radius: 78 },
        { x: -535, y: 2460, radius: 81 }, { x: 550, y: 3330, radius: 75 },
        { x: -550, y: 4210, radius: 82 }, { x: 535, y: 5080, radius: 78 },
        { x: -545, y: 5950, radius: 84 }, { x: 525, y: 6800, radius: 80 }
    ];

    const roots = [
        [-560,850,-255,625,38],[-560,850,-72,930,48],[-560,850,-275,1180,35],
        [545,1610,235,1360,40],[545,1610,68,1680,49],[545,1610,265,1950,36],
        [-535,2460,-235,2180,39],[-535,2460,-55,2505,51],[-535,2460,-245,2815,37],
        [550,3330,235,3070,41],[550,3330,68,3375,50],[550,3330,250,3690,35],
        [-550,4210,-245,3940,42],[-550,4210,-62,4265,53],[-550,4210,-250,4570,38],
        [535,5080,230,4810,40],[535,5080,58,5125,50],[535,5080,235,5445,36],
        [-545,5950,-235,5680,43],[-545,5950,-45,5995,54],[-545,5950,-235,6315,37],
        [525,6800,220,6525,42],[525,6800,45,6850,52],[525,6800,225,7160,38]
    ].map((root, index) => ({ index, ax: root[0], ay: root[1], bx: root[2], by: root[3], width: root[4] }));

    const branchBlueprints = [
        { x: -560, y: 1250, angle: 1.23, length: 505 },
        { x: 548, y: 2100, angle: -1.28, length: 500 },
        { x: -540, y: 2925, angle: 1.34, length: 530 },
        { x: 552, y: 3780, angle: -1.2, length: 520 },
        { x: -555, y: 4650, angle: 1.25, length: 525 },
        { x: 540, y: 5515, angle: -1.32, length: 520 },
        { x: -550, y: 6380, angle: 1.18, length: 510 },
        { x: 530, y: 7210, angle: -1.27, length: 500 }
    ];

    const mudPatches = [
        { x: 90, y: 720, rx: 155, ry: 210 }, { x: -160, y: 1880, rx: 185, ry: 170 },
        { x: 185, y: 3040, rx: 165, ry: 215 }, { x: -130, y: 3980, rx: 175, ry: 180 },
        { x: 165, y: 5350, rx: 185, ry: 205 }, { x: -120, y: 6510, rx: 170, ry: 190 }
    ];

    const player = createCar(42, -90, true, 15);
    let rivals = [];
    let branches = [];
    let twigs = [];

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function lerp(start, end, ratio) {
        return start + (end - start) * ratio;
    }

    function seeded(index, salt = 0) {
        const sample = Math.sin(index * 91.31 + salt * 47.17) * 43758.5453;
        return sample - Math.floor(sample);
    }

    function createCar(x, y, isPlayer, number) {
        return {
            x, y,
            vx: 0, vy: 0,
            heading: 0,
            speed: 0,
            isPlayer,
            number,
            colour: isPlayer ? "#c6a64f" : colours[number % colours.length],
            mass: isPlayer ? 1550 : 1260 + seeded(number, 4) * 820,
            aggression: .3 + seeded(number, 8) * .66,
            active: true,
            finished: false,
            finishPosition: 0,
            flash: 0,
            spin: 0,
            stun: 0,
            targetX: x
        };
    }

    function allCars() {
        return [player, ...rivals];
    }

    function activeCars() {
        return allCars().filter((car) => car.active && !car.finished);
    }

    function routeX(y) {
        if (y <= waypoints[0].y) return waypoints[0].x;
        for (let index = 1; index < waypoints.length; index += 1) {
            if (y <= waypoints[index].y) {
                const previous = waypoints[index - 1];
                const next = waypoints[index];
                const ratio = (y - previous.y) / (next.y - previous.y);
                const curved = ratio * ratio * (3 - 2 * ratio);
                return lerp(previous.x, next.x, curved);
            }
        }
        return waypoints[waypoints.length - 1].x;
    }

    function currentVector(x, y) {
        return {
            x: Math.sin(y / 610 + world.time * .33) * 25 + Math.sin(x / 280) * 7,
            y: 10 + Math.cos(y / 970 + world.time * .15) * 4
        };
    }

    function inMud(x, y) {
        return mudPatches.some((patch) => {
            const dx = (x - patch.x) / patch.rx;
            const dy = (y - patch.y) / patch.ry;
            return dx * dx + dy * dy < 1;
        });
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

    function branchEnd(branch) {
        return {
            x: branch.x + Math.sin(branch.angle) * branch.length,
            y: branch.y + Math.cos(branch.angle) * branch.length
        };
    }

    function reset() {
        Object.assign(player, createCar(42, -90, true, 15));
        rivals = [];
        for (let index = 0; index < STARTERS - 1; index += 1) {
            const lane = index % 8;
            const row = Math.floor(index / 8);
            rivals.push(createCar(-560 + lane * 160 + (seeded(index, 3) - .5) * 24, -row * 76 + (seeded(index, 6) - .5) * 16, false, index + 1));
        }
        branches = branchBlueprints.map((branch, index) => ({ ...branch, number: index + 1, state: "stable", stress: 0, timer: 0, progress: 0, struck: false }));
        twigs = Array.from({ length: 42 }, (_, index) => {
            const y = 430 + index * 170 + seeded(index, 2) * 65;
            return {
                x: routeX(y) + (seeded(index, 5) - .5) * 410,
                y,
                angle: seeded(index, 9) * TAU,
                length: 24 + seeded(index, 11) * 38,
                broken: false,
                wasHanging: index % 4 === 0,
                state: index % 4 === 0 ? "hanging" : "landed",
                timer: 0,
                progress: index % 4 === 0 ? 0 : 1
            };
        });
        Object.assign(world, {
            time: 0,
            cameraY: 390,
            cameraV: 0,
            overview: false,
            result: "racing",
            detail: "Delta open",
            finishers: 0,
            shake: 0
        });
        world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey delta";
        updateReadouts();
        render();
    }

    function triggerBranch(branch) {
        if (branch.state !== "stable") return;
        branch.state = "warning";
        branch.timer = 1.55;
        branch.progress = 0;
    }

    function updateBranches(delta) {
        branches.forEach((branch) => {
            if (branch.state === "stable") {
                let vibration = 0;
                activeCars().forEach((car) => {
                    const distance = Math.hypot(car.x - branch.x, car.y - branch.y);
                    if (distance < 590) vibration += (1 - distance / 590) * (.25 + car.speed / 390);
                });
                branch.stress = clamp(branch.stress + vibration * delta, 0, 1);
                if (branch.stress >= 1) triggerBranch(branch);
            } else if (branch.state === "warning") {
                branch.timer -= delta;
                branch.progress = 1 - branch.timer / 1.55;
                if (branch.timer <= 0) {
                    branch.state = "falling";
                    branch.timer = .78;
                    branch.progress = 0;
                }
            } else if (branch.state === "falling") {
                branch.timer -= delta;
                branch.progress = clamp(1 - branch.timer / .78, 0, 1);
                if (branch.timer <= 0) {
                    branch.state = "fallen";
                    branch.progress = 1;
                    strikeBranch(branch);
                }
            }
        });
    }

    function strikeBranch(branch) {
        if (branch.struck) return;
        branch.struck = true;
        const end = branchEnd(branch);
        activeCars().forEach((car) => {
            const hit = distanceToSegment(car.x, car.y, branch.x, branch.y, end.x, end.y);
            if (hit.distance > CAR_RADIUS + 28) return;
            const dx = car.x - hit.x;
            const dy = car.y - hit.y;
            const length = Math.max(1, Math.hypot(dx, dy));
            car.vx += dx / length * 105;
            car.vy += dy / length * 105;
            car.spin += car.number % 2 ? 1.7 : -1.7;
            car.stun = Math.max(car.stun, .75);
            car.flash = 1;
            if (car.isPlayer) world.shake = 1;
        });
        for (let index = 0; index < 18; index += 1) addParticle(lerp(branch.x, end.x, seeded(index, 2)), lerp(branch.y, end.y, seeded(index, 3)), "wood");
    }

    function addParticle(x, y, type) {
        const angle = seeded(world.time * 100 + x, y) * TAU;
        const speed = 12 + seeded(x, world.time + y) * 62;
        world.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: type === "wood" ? 3 + seeded(x, y) * 7 : 5 + seeded(y, x) * 10,
            life: .7 + seeded(x + y, 12) * 1.3,
            maxLife: 2,
            type
        });
        if (world.particles.length > 340) world.particles.splice(0, world.particles.length - 340);
    }

    function resolveCircle(car, x, y, radius, restitution = .38) {
        const dx = car.x - x;
        const dy = car.y - y;
        const distance = Math.hypot(dx, dy);
        const minimum = CAR_RADIUS + radius;
        if (distance >= minimum || distance < .001) return false;
        const nx = dx / distance;
        const ny = dy / distance;
        car.x += nx * (minimum - distance);
        car.y += ny * (minimum - distance);
        const inward = car.vx * nx + car.vy * ny;
        if (inward < 0) {
            car.vx -= inward * nx * (1 + restitution);
            car.vy -= inward * ny * (1 + restitution);
        }
        car.flash = 1;
        if (car.isPlayer) world.shake = Math.max(world.shake, .45);
        return true;
    }

    function resolveSegment(car, ax, ay, bx, by, width, restitution = .32) {
        const hit = distanceToSegment(car.x, car.y, ax, ay, bx, by);
        const minimum = CAR_RADIUS + width * .5;
        if (hit.distance >= minimum) return false;
        let nx;
        let ny;
        if (hit.distance < .001) {
            const dx = bx - ax;
            const dy = by - ay;
            const length = Math.max(1, Math.hypot(dx, dy));
            nx = -dy / length;
            ny = dx / length;
        } else {
            nx = (car.x - hit.x) / hit.distance;
            ny = (car.y - hit.y) / hit.distance;
        }
        car.x += nx * (minimum - hit.distance + 1);
        car.y += ny * (minimum - hit.distance + 1);
        const inward = car.vx * nx + car.vy * ny;
        if (inward < 0) {
            car.vx -= inward * nx * (1 + restitution);
            car.vy -= inward * ny * (1 + restitution);
        }
        car.flash = 1;
        if (car.isPlayer) world.shake = Math.max(world.shake, .42);
        return true;
    }

    function resolveForest(car) {
        trunks.forEach((trunk) => resolveCircle(car, trunk.x, trunk.y, trunk.radius));
        roots.forEach((root) => resolveSegment(car, root.ax, root.ay, root.bx, root.by, root.width));
        branches.forEach((branch) => {
            if (branch.state !== "fallen") return;
            const end = branchEnd(branch);
            resolveSegment(car, branch.x, branch.y, end.x, end.y, 31, .24);
        });
    }

    function updateTwigFalls(delta) {
        twigs.forEach((twig) => {
            if (twig.state === "hanging") {
                const disturbed = activeCars().some((car) => Math.hypot(car.x - twig.x, car.y - twig.y) < 330);
                if (disturbed) {
                    twig.state = "falling";
                    twig.timer = .5 + seeded(twig.x, twig.y) * .32;
                    twig.progress = 0;
                }
            } else if (twig.state === "falling") {
                const duration = .5 + seeded(twig.x, twig.y) * .32;
                twig.timer -= delta;
                twig.progress = clamp(1 - twig.timer / duration, 0, 1);
                if (twig.timer <= 0) {
                    twig.state = "landed";
                    twig.progress = 1;
                    addParticle(twig.x, twig.y, "wood");
                }
            }
        });
    }

    function updateTwigs(car) {
        twigs.forEach((twig) => {
            if (twig.state !== "landed") return;
            if (twig.broken) {
                if (Math.hypot(car.x - twig.x, car.y - twig.y) < 44) {
                    car.vx *= .992;
                    car.vy *= .992;
                }
                return;
            }
            const endX = twig.x + Math.sin(twig.angle) * twig.length;
            const endY = twig.y + Math.cos(twig.angle) * twig.length;
            const hit = distanceToSegment(car.x, car.y, twig.x, twig.y, endX, endY);
            if (hit.distance >= CAR_RADIUS + 4) return;
            if (car.speed > 62) {
                twig.broken = true;
                car.vx *= .9;
                car.vy *= .9;
                for (let index = 0; index < 5; index += 1) addParticle(twig.x, twig.y, "wood");
            } else {
                car.vx *= .82;
                car.vy *= .82;
            }
        });
    }

    function nearestBlockingBranch(car) {
        return branches.find((branch) => {
            if (branch.state !== "fallen") return false;
            const end = branchEnd(branch);
            const middleY = (branch.y + end.y) * .5;
            if (middleY < car.y || middleY - car.y > 440) return false;
            const route = routeX(middleY);
            return distanceToSegment(route, middleY, branch.x, branch.y, end.x, end.y).distance < 90;
        });
    }

    function artificialDriver(car) {
        let targetX = routeX(car.y + 390);
        const blocking = nearestBlockingBranch(car);
        if (blocking) {
            const end = branchEnd(blocking);
            const middleX = (blocking.x + end.x) * .5;
            const side = (car.number + blocking.number) % 2 ? -1 : 1;
            targetX = middleX + side * 210;
        }
        targetX = clamp(targetX, -FIELD_WIDTH * .5 + 48, FIELD_WIDTH * .5 - 48);
        car.targetX = targetX;
        return {
            throttle: .83 + car.aggression * .16,
            brake: car.stun > 0 ? .08 : 0,
            steering: clamp((targetX - car.x) / 135 - car.vx / 205 - car.spin * .18, -1, 1)
        };
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished) return;
        car.flash = Math.max(0, car.flash - delta * 3.6);
        car.stun = Math.max(0, car.stun - delta);
        car.spin *= Math.pow(.055, delta);
        car.heading += car.spin * delta;
        const mud = inMud(car.x, car.y);
        const grip = mud ? .5 : .76;
        const power = (mud ? .57 : .86) * (car.stun > 0 ? .35 : 1);
        const speed = Math.hypot(car.vx, car.vy);

        if (controls.throttle > 0) {
            const force = 224 / (car.mass / 1550) * controls.throttle * power;
            car.vx += Math.sin(car.heading) * force * delta;
            car.vy += Math.cos(car.heading) * force * delta;
        }
        if (controls.brake > 0 && speed > 1) {
            const next = Math.max(0, speed - 240 * grip * controls.brake * delta);
            car.vx *= next / speed;
            car.vy *= next / speed;
        }

        car.heading += controls.steering * clamp(speed / 65, .15, 1) * (1.28 + grip * .65) * delta;
        const forwardX = Math.sin(car.heading);
        const forwardY = Math.cos(car.heading);
        const longitudinal = car.vx * forwardX + car.vy * forwardY;
        const lateral = (car.vx * forwardY - car.vy * forwardX) * Math.pow(Math.max(.05, 1 - grip * 4 * delta), 1);
        car.vx = forwardX * longitudinal + forwardY * lateral;
        car.vy = forwardY * longitudinal - forwardX * lateral;

        const current = currentVector(car.x, car.y);
        car.vx += current.x * delta;
        car.vy += current.y * delta;
        const maximum = mud ? 245 : 370;
        const driven = Math.hypot(car.vx, car.vy);
        if (driven > maximum) {
            car.vx *= maximum / driven;
            car.vy *= maximum / driven;
        }
        const rolling = mud ? .963 : .987;
        car.vx *= Math.pow(rolling, delta * 60);
        car.vy *= Math.pow(rolling, delta * 60);
        car.x += car.vx * delta;
        car.y += car.vy * delta;
        car.speed = Math.hypot(car.vx, car.vy);

        resolveForest(car);
        updateTwigs(car);
        if (Math.abs(car.x) > FIELD_WIDTH * .5 - 28) {
            const side = Math.sign(car.x);
            car.x = side * (FIELD_WIDTH * .5 - 28);
            car.vx *= -.25;
            car.flash = 1;
        }
        if (car.speed > 75 && seeded(car.number + Math.floor(world.time * 9), 18) > .84) addParticle(car.x, car.y, "water");
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
                    first.vx += relative * nx * .54;
                    first.vy += relative * ny * .54;
                    second.vx -= relative * nx * .54;
                    second.vy -= relative * ny * .54;
                    first.flash = second.flash = 1;
                }
            }
        }
    }

    function finish(car) {
        if (car.finished) return;
        car.finished = true;
        car.active = false;
        world.finishers += 1;
        car.finishPosition = world.finishers;
        if (car.isPlayer) {
            world.result = "finished";
            world.detail = car.finishPosition === 1 ? "First onto the dry levee" : `Finished P${car.finishPosition}`;
        }
    }

    function updateParticles(delta) {
        world.particles.forEach((particle) => {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(.12, delta);
            particle.vy *= Math.pow(.12, delta);
            particle.radius += delta * (particle.type === "water" ? 6 : 2);
            particle.life -= delta;
        });
        world.particles = world.particles.filter((particle) => particle.life > 0);
    }

    function racePosition() {
        if (player.finished) return player.finishPosition;
        return clamp(rivals.filter((car) => car.finished || (car.active && car.y > player.y)).length + 1, 1, STARTERS);
    }

    function update(delta) {
        world.time += delta;
        if (world.result !== "racing") {
            updateParticles(delta);
            updateReadouts();
            return;
        }
        updateBranches(delta);
        updateTwigFalls(delta);
        rivals.forEach((car) => updateCar(car, delta, artificialDriver(car)));
        updateCar(player, delta, {
            throttle: input.throttle ? 1 : 0,
            brake: input.brake ? 1 : 0,
            steering: (input.left ? -1 : 0) + (input.right ? 1 : 0)
        });
        collideCars();
        updateParticles(delta);
        const targetY = world.overview ? FIELD_LENGTH * .5 : player.y + 385;
        world.cameraV += (targetY - world.cameraY) * Math.min(1, delta * 5);
        world.cameraV *= Math.pow(.004, delta);
        world.cameraY += world.cameraV * delta;
        world.shake = Math.max(0, world.shake - delta * 2.1);
        updateReadouts();
    }

    function activeScale() {
        return world.overview
            ? Math.min((world.width - 80) / (FIELD_WIDTH + 170), (world.height - 70) / (FIELD_LENGTH + 250))
            : world.scale;
    }

    function point(x, y) {
        const scale = activeScale();
        return { x: world.width * .5 + x * scale, y: world.height * .68 - (y - world.cameraY) * scale };
    }

    function drawWater() {
        context.fillStyle = "#121715";
        context.fillRect(0, 0, world.width, world.height);
        const scale = activeScale();
        const left = world.width * .5 - FIELD_WIDTH * .5 * scale;
        const right = world.width * .5 + FIELD_WIDTH * .5 * scale;
        context.fillStyle = "#344b48";
        context.fillRect(left, 0, right - left, world.height);

        context.strokeStyle = "rgba(151,184,168,.12)";
        context.lineWidth = Math.max(1, 2 * scale);
        for (let lane = -6; lane <= 6; lane += 1) {
            context.beginPath();
            for (let y = -300; y <= FIELD_LENGTH + 300; y += 100) {
                const x = lane * 125 + Math.sin(y / 520 + lane) * 65;
                const p = point(x, y);
                if (y === -300) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
            }
            context.stroke();
        }

        mudPatches.forEach((patch) => {
            const p = point(patch.x, patch.y);
            context.fillStyle = "rgba(63,57,43,.82)";
            context.beginPath();
            context.ellipse(p.x, p.y, patch.rx * scale, patch.ry * scale, 0, 0, TAU);
            context.fill();
            context.strokeStyle = "rgba(127,113,78,.34)";
            context.lineWidth = Math.max(1, 4 * scale);
            context.stroke();
        });

        const finish = point(0, FIELD_LENGTH);
        context.fillStyle = "#d9d2bd";
        context.fillRect(left, finish.y - 9, right - left, 18);
        context.fillStyle = "rgba(8,10,8,.86)";
        context.fillRect(world.width * .5 - 91, finish.y - 49, 182, 26);
        context.fillStyle = "#eee7d7";
        context.font = "600 9px General Sans";
        context.textAlign = "center";
        context.fillText("DRY LEVEE FINISH", world.width * .5, finish.y - 32);
    }

    function drawRoot(root, shadow = false) {
        const a = point(root.ax, root.ay);
        const b = point(root.bx, root.by);
        const scale = activeScale();
        context.strokeStyle = shadow ? "rgba(0,0,0,.34)" : "#66513b";
        context.lineWidth = root.width * scale + (shadow ? 6 : 0);
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(a.x + (shadow ? 6 : 0), a.y + (shadow ? 7 : 0));
        context.lineTo(b.x + (shadow ? 6 : 0), b.y + (shadow ? 7 : 0));
        context.stroke();
        if (!shadow) {
            context.strokeStyle = "rgba(177,143,91,.24)";
            context.lineWidth = Math.max(1, root.width * scale * .14);
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.stroke();
        }
        context.lineCap = "butt";
    }

    function drawTrunk(trunk, shadow = false) {
        const p = point(trunk.x, trunk.y);
        const radius = trunk.radius * activeScale();
        context.fillStyle = shadow ? "rgba(0,0,0,.38)" : "#584735";
        context.beginPath();
        context.arc(p.x + (shadow ? 8 : 0), p.y + (shadow ? 9 : 0), radius, 0, TAU);
        context.fill();
        if (!shadow) {
            context.strokeStyle = "#927452";
            context.lineWidth = Math.max(2, 5 * activeScale());
            context.beginPath();
            context.arc(p.x, p.y, radius * .65, 0, TAU);
            context.stroke();
            context.beginPath();
            context.arc(p.x, p.y, radius * .33, 0, TAU);
            context.stroke();
        }
    }

    function drawBranch(branch) {
        const end = branchEnd(branch);
        const a = point(branch.x, branch.y);
        const b = point(end.x, end.y);
        const scale = activeScale();
        if ((a.y < -180 && b.y < -180) || (a.y > world.height + 180 && b.y > world.height + 180)) return;
        let shake = 0;
        if (branch.state === "warning") shake = Math.sin(world.time * 28 + branch.number) * 7 * scale * branch.progress;
        context.save();
        context.translate(shake, 0);
        if (branch.state === "stable" || branch.state === "warning") {
            context.strokeStyle = branch.state === "warning" ? "rgba(196,143,67,.68)" : "rgba(24,24,20,.47)";
            context.lineWidth = Math.max(3, 15 * scale);
            context.setLineDash([14 * scale, 9 * scale]);
            context.beginPath();
            context.moveTo(a.x + 18 * scale, a.y + 22 * scale);
            context.lineTo(b.x + 18 * scale, b.y + 22 * scale);
            context.stroke();
            context.setLineDash([]);
            context.strokeStyle = branch.state === "warning" ? "#9b7040" : "rgba(94,72,48,.45)";
            context.lineWidth = Math.max(2, 7 * scale);
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.stroke();
        } else {
            const opacity = branch.state === "falling" ? .3 + branch.progress * .7 : 1;
            context.globalAlpha = opacity;
            context.strokeStyle = "rgba(0,0,0,.38)";
            context.lineWidth = Math.max(5, 35 * scale);
            context.beginPath();
            context.moveTo(a.x + 6, a.y + 8);
            context.lineTo(b.x + 6, b.y + 8);
            context.stroke();
            context.strokeStyle = "#6d5035";
            context.lineWidth = Math.max(4, 29 * scale);
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.stroke();
            context.strokeStyle = "rgba(183,139,82,.34)";
            context.lineWidth = Math.max(1, 3 * scale);
            context.stroke();
            context.globalAlpha = 1;
        }
        context.restore();
    }

    function drawTwigs() {
        const scale = activeScale();
        twigs.forEach((twig) => {
            const p = point(twig.x, twig.y);
            if (p.y < -60 || p.y > world.height + 60) return;
            const airborne = twig.state !== "landed";
            context.save();
            context.globalAlpha = airborne ? .32 + twig.progress * .5 : 1;
            context.translate(p.x + (airborne ? (1 - twig.progress) * 12 * scale : 0), p.y + (airborne ? (1 - twig.progress) * 15 * scale : 0));
            context.rotate(twig.angle);
            if (airborne) context.setLineDash([5 * scale, 4 * scale]);
            context.strokeStyle = twig.broken ? "rgba(127,94,56,.65)" : airborne ? "#b08049" : "#947044";
            context.lineWidth = Math.max(1, (twig.broken ? 2 : 4) * scale);
            if (twig.broken) {
                [-1, 0, 1].forEach((offset) => {
                    context.beginPath();
                    context.moveTo(offset * 8 * scale, -twig.length * scale * .22);
                    context.lineTo(offset * 11 * scale + 4 * scale, twig.length * scale * .22);
                    context.stroke();
                });
            } else {
                context.beginPath();
                context.moveTo(0, -twig.length * scale * .5);
                context.lineTo(0, twig.length * scale * .5);
                context.stroke();
                context.beginPath();
                context.moveTo(0, 0);
                context.lineTo(9 * scale, 10 * scale);
                context.stroke();
            }
            context.restore();
        });
    }

    function drawCar(car) {
        if (!car.active && !car.finished) return;
        const p = point(car.x, car.y);
        if (p.y < -80 || p.y > world.height + 80) return;
        const scale = activeScale();
        context.save();
        context.translate(p.x, p.y);
        context.rotate(car.heading);
        context.fillStyle = "rgba(0,0,0,.35)";
        context.fillRect(-16 * scale + 4, -29 * scale + 6, 32 * scale, 58 * scale);
        context.fillStyle = car.flash > 0 ? "#e5dbc1" : car.colour;
        context.fillRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.fillStyle = "#1e2623";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 21 * scale);
        context.strokeStyle = car.isPlayer ? "#f0d99a" : "rgba(235,232,217,.5)";
        context.lineWidth = car.isPlayer ? 2 : 1;
        context.strokeRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const p = point(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1) * (particle.type === "water" ? .28 : .75);
            if (particle.type === "water") {
                context.strokeStyle = "#a0c1b7";
                context.lineWidth = 1;
                context.beginPath();
                context.arc(p.x, p.y, particle.radius * activeScale(), 0, TAU);
                context.stroke();
            } else {
                context.fillStyle = "#9a7141";
                context.fillRect(p.x - particle.radius * .5, p.y - 2, particle.radius, 4);
            }
        });
        context.globalAlpha = 1;
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 3) - .5) * world.shake * 8;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, 0);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawWater();
        roots.forEach((root) => drawRoot(root, true));
        trunks.forEach((trunk) => drawTrunk(trunk, true));
        roots.forEach((root) => drawRoot(root, false));
        trunks.forEach((trunk) => drawTrunk(trunk, false));
        drawTwigs();
        branches.forEach(drawBranch);
        allCars().slice().sort((first, second) => second.y - first.y).forEach(drawCar);
        drawParticles();
        branches.filter((branch) => branch.state === "fallen").forEach(drawBranch);
        if (world.result !== "racing") {
            context.fillStyle = "rgba(5,8,7,.71)";
            context.fillRect(0, 0, world.width, world.height);
            context.fillStyle = "#eee7d8";
            context.font = "500 40px Clash Display";
            context.textAlign = "center";
            context.fillText("DRY LEVEE REACHED", world.width * .5, world.height * .5);
        }
    }

    function nearestBranch(car) {
        return branches.reduce((best, branch) => {
            const distance = Math.abs(branch.y - car.y);
            const bestDistance = Math.abs(best.y - car.y);
            return distance < bestDistance ? branch : best;
        }, branches[0]);
    }

    function updateReadouts() {
        const mud = inMud(player.x, player.y);
        const nextRoute = routeX(player.y + 430);
        const nearest = nearestBranch(player);
        const fallen = branches.filter((branch) => branch.state === "fallen").length;
        const warning = branches.filter((branch) => branch.state === "warning" || branch.state === "falling").length;
        const broken = twigs.filter((twig) => twig.broken).length;
        const droppedTwigs = twigs.filter((twig) => twig.wasHanging && twig.state === "landed").length;
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        surfaceReadout.textContent = mud ? "Deep root mud" : "Shallow water";
        gapReadout.textContent = nextRoute > player.x ? "East root" : "West root";
        speedReadout.textContent = `${Math.round(player.speed * .36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? "Delta open" : world.detail;
        deadfallReadout.textContent = `Branch ${String(nearest.number).padStart(2, "0")} / ${nearest.state}`;
        deadfallBar.style.width = `${nearest.state === "stable" ? nearest.stress * 100 : nearest.state === "warning" ? nearest.progress * 72 : nearest.state === "falling" ? 72 + nearest.progress * 28 : 100}%`;
        deadfallCopy.textContent = nearest.state === "stable" ? "Engine vibration loading dead timber" : nearest.state === "warning" ? "Creaking shadow marks the fall line" : nearest.state === "falling" ? "Branch descending across the channel" : "Persistent timber now blocks the water";
        rootStatus.textContent = "Eight trunks dividing flow";
        canopyStatus.textContent = warning ? `${warning} deadfall warning${warning === 1 ? "" : "s"}` : "Deadwood stable";
        fallStatus.textContent = fallen ? `${fallen} persistent limb${fallen === 1 ? "" : "s"} down` : "No branches down";
        twigStatus.textContent = broken ? `${broken} twigs broken / ${droppedTwigs} fallen` : droppedTwigs ? `${droppedTwigs} twigs fallen` : "Dry scatter intact";
        const current = currentVector(player.x, player.y);
        currentStatus.textContent = `Current drawing ${current.x > 4 ? "east" : current.x < -4 ? "west" : "north"}`;
        finishStatus.textContent = world.finishers ? `${world.finishers} racers on levee` : "North bank visible";
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth || 1320);
        const height = Math.max(1, canvas.clientHeight || 940);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        world.width = width;
        world.height = height;
        world.scale = clamp(Math.min(width / 1790, height / 1260), .46, .8);
        canvas.width = Math.round(width * world.dpr);
        canvas.height = Math.round(height * world.dpr);
        render();
    }

    const keyMap = { w: "throttle", arrowup: "throttle", s: "brake", arrowdown: "brake", a: "left", arrowleft: "left", d: "right", arrowright: "right" };

    function setControl(name, active) {
        if (!(name in input)) return;
        input[name] = active;
        buttons.forEach((button) => {
            if (button.dataset.rootwaterControl === name) button.classList.toggle("is-pressed", active);
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
        const name = button.dataset.rootwaterControl;
        const down = (event) => { event.preventDefault(); setControl(name, true); };
        const up = (event) => { event.preventDefault(); setControl(name, false); };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
    });
    resetButton.addEventListener("click", reset);
    overviewButton.addEventListener("click", () => {
        world.overview = !world.overview;
        overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey delta";
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

    window.rootwater = {
        resize,
        reset,
        setControl,
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
                heading: player.heading,
                active: player.active,
                position: racePosition(),
                inMud: inMud(player.x, player.y),
                routeTarget: routeX(player.y + 390),
                stunned: player.stun > 0
            },
            finishers: world.finishers,
            activeRivals: rivals.filter((car) => car.active && !car.finished).length,
            fallenBranches: branches.filter((branch) => branch.state === "fallen").length,
            warningBranches: branches.filter((branch) => branch.state === "warning" || branch.state === "falling").length,
            brokenTwigs: twigs.filter((twig) => twig.broken).length,
            fallenTwigs: twigs.filter((twig) => twig.wasHanging && twig.state === "landed").length,
            fallingTwigs: twigs.filter((twig) => twig.state === "falling").length,
            branches: branches.map((branch) => ({ number: branch.number, state: branch.state, stress: branch.stress }))
        })
    };

    requestAnimationFrame(animate);
})();
