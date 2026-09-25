"use strict";

(() => {
    const canvas = document.getElementById("listening-field-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("listening-field");
    const resetButton = document.getElementById("listening-field-reset");
    const overviewButton = document.getElementById("listening-field-overview");
    const positionReadout = document.getElementById("listening-field-position-readout");
    const surfaceReadout = document.getElementById("listening-field-surface-readout");
    const dishReadout = document.getElementById("listening-field-dish-readout");
    const speedReadout = document.getElementById("listening-field-speed-readout");
    const resultReadout = document.getElementById("listening-field-result-readout");
    const cycleReadout = document.getElementById("listening-field-cycle-readout");
    const cycleBar = document.getElementById("listening-field-cycle-bar");
    const cycleCopy = document.getElementById("listening-field-cycle-copy");
    const bearingStatus = document.getElementById("listening-field-bearing-status");
    const bowlStatus = document.getElementById("listening-field-bowl-status");
    const rimStatus = document.getElementById("listening-field-rim-status");
    const boomStatus = document.getElementById("listening-field-boom-status");
    const roadStatus = document.getElementById("listening-field-road-status");
    const finishStatus = document.getElementById("listening-field-finish-status");
    const buttons = Array.from(document.querySelectorAll("[data-listening-field-control]"));

    const FIELD_WIDTH = 1700;
    const FIELD_LENGTH = 7600;
    const STARTERS = 24;
    const CAR_RADIUS = 23;
    const CYCLE_LENGTH = 14;
    const HOLD_END = 8.5;
    const SLEW_START = 10;
    const OPENING_HALF_ANGLE = .24;
    const TAU = Math.PI * 2;
    const bearings = [0, .92, -.78, .48, -.45];
    const colours = ["#797d78", "#8a705d", "#697b7d", "#8a826c", "#969181", "#667069", "#8e6552"];
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
        detail: "Observation live",
        finishers: 0,
        shake: 0,
        particles: [],
        dustClock: 0,
        wasVisible: false
    };
    const dishes = [
        { number: 1, x: -285, y: 1160, radius: 220 },
        { number: 2, x: 315, y: 2240, radius: 245 },
        { number: 3, x: -245, y: 3370, radius: 230 },
        { number: 4, x: 340, y: 4500, radius: 250 },
        { number: 5, x: -320, y: 5640, radius: 225 },
        { number: 6, x: 175, y: 6720, radius: 242 }
    ];
    const player = createCar(0, -90, true, 14);
    let rivals = [];

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function lerp(start, end, ratio) {
        return start + (end - start) * ratio;
    }

    function smooth(ratio) {
        const amount = clamp(ratio, 0, 1);
        return amount * amount * (3 - 2 * amount);
    }

    function wrapAngle(angle) {
        let wrapped = angle;
        while (wrapped > Math.PI) wrapped -= TAU;
        while (wrapped < -Math.PI) wrapped += TAU;
        return wrapped;
    }

    function seeded(index, salt = 0) {
        const sample = Math.sin(index * 91.73 + salt * 43.19) * 43758.5453;
        return sample - Math.floor(sample);
    }

    function createCar(x, y, isPlayer, number) {
        return {
            x,
            y,
            vx: 0,
            vy: 0,
            heading: 0,
            speed: 0,
            isPlayer,
            number,
            colour: isPlayer ? "#c8aa52" : colours[number % colours.length],
            mass: isPlayer ? 1540 : 1270 + seeded(number, 3) * 780,
            aggression: .32 + seeded(number, 7) * .64,
            active: true,
            finished: false,
            finishPosition: 0,
            flash: 0,
            spin: 0,
            targetX: x,
            dishNumber: 0
        };
    }

    function allCars() {
        return [player, ...rivals];
    }

    function activeCars() {
        return allCars().filter((car) => car.active && !car.finished);
    }

    function reset() {
        Object.assign(player, createCar(42, -90, true, 14));
        rivals = [];
        for (let index = 0; index < STARTERS - 1; index += 1) {
            const lane = index % 8;
            const row = Math.floor(index / 8);
            rivals.push(createCar(-560 + lane * 160 + (seeded(index, 2) - .5) * 22, -row * 76 + (seeded(index, 5) - .5) * 16, false, index + 1));
        }
        Object.assign(world, {
            time: 0,
            cameraY: 390,
            cameraV: 0,
            overview: false,
            result: "racing",
            detail: "Observation live",
            finishers: 0,
            shake: 0,
            dustClock: 0
        });
        world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey array";
        updateReadouts();
        render();
    }

    function cycleState(time = world.time) {
        const cycle = Math.floor(time / CYCLE_LENGTH);
        const local = time - cycle * CYCLE_LENGTH;
        const from = bearings[cycle % bearings.length];
        const to = bearings[(cycle + 1) % bearings.length];
        const delta = wrapAngle(to - from);
        const moving = local >= SLEW_START;
        const ratio = moving ? smooth((local - SLEW_START) / (CYCLE_LENGTH - SLEW_START)) : 0;
        const rawRatio = moving ? clamp((local - SLEW_START) / (CYCLE_LENGTH - SLEW_START), 0, 1) : 0;
        return {
            cycle,
            local,
            from,
            to,
            angle: from + delta * ratio,
            angularSpeed: moving ? delta * 6 * rawRatio * (1 - rawRatio) / (CYCLE_LENGTH - SLEW_START) : 0,
            phase: moving ? "slewing" : local >= HOLD_END ? "warning" : "holding",
            remaining: moving ? CYCLE_LENGTH - local : moving ? 0 : (local >= HOLD_END ? SLEW_START - local : HOLD_END - local)
        };
    }

    function axisVector(angle) {
        return { x: Math.sin(angle), y: Math.cos(angle) };
    }

    function roadCenter(y) {
        return Math.sin(y / 820) * 118 + Math.sin(y / 1910 + .8) * 44;
    }

    function onServiceRoad(x, y) {
        return Math.abs(x - roadCenter(y)) < 230;
    }

    function dishContaining(x, y, margin = 0) {
        return dishes.find((dish) => Math.hypot(x - dish.x, y - dish.y) < dish.radius - margin) || null;
    }

    function nextDish(car) {
        return dishes.find((dish) => dish.y + dish.radius > car.y) || dishes[dishes.length - 1];
    }

    function apertureDifference(x, y, dish, angle) {
        const radial = Math.atan2(x - dish.x, y - dish.y);
        const one = Math.abs(wrapAngle(radial - angle));
        const two = Math.abs(wrapAngle(radial - angle - Math.PI));
        return Math.min(one, two);
    }

    function isAperture(x, y, dish, angle) {
        return apertureDifference(x, y, dish, angle) < OPENING_HALF_ANGLE;
    }

    function artificialDriver(car) {
        const state = cycleState();
        const inside = dishContaining(car.x, car.y, CAR_RADIUS * .1);
        let targetX = roadCenter(car.y + 420);
        let throttle = .84 + car.aggression * .14;
        let brake = 0;

        if (inside) {
            const axis = axisVector(state.angle);
            const direction = axis.y >= 0 ? 1 : -1;
            targetX = inside.x + axis.x * inside.radius * direction;
            if (state.phase === "warning" && Math.abs(axis.y) < .42) brake = .18;
        } else {
            const upcoming = nextDish(car);
            const separation = upcoming.y - car.y;
            if (separation > -80 && separation < 680) {
                const axis = axisVector(state.angle);
                const useful = Math.abs(axis.y) > .68;
                if (useful && separation > 40) {
                    targetX = upcoming.x - axis.x * upcoming.radius * Math.sign(axis.y);
                } else {
                    const side = (car.number + upcoming.number) % 2 ? -1 : 1;
                    targetX = upcoming.x + side * (upcoming.radius + 84);
                }
            }
        }

        targetX = clamp(targetX, -FIELD_WIDTH * .5 + 45, FIELD_WIDTH * .5 - 45);
        car.targetX = targetX;
        const steering = clamp((targetX - car.x) / 145 - car.vx / 210 - car.spin * .2, -1, 1);
        return { throttle, brake, steering };
    }

    function addDust(x, y, count = 1) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(index + world.time * 170, x) * TAU;
            const speed = 12 + seeded(index, y) * 42;
            world.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 6 + seeded(index, 11) * 13,
                life: .8 + seeded(index, 13) * 1.1,
                maxLife: 1.9
            });
        }
        if (world.particles.length > 300) world.particles.splice(0, world.particles.length - 300);
    }

    function resolveRim(car, previousX, previousY, dish, angle) {
        const previousDistance = Math.hypot(previousX - dish.x, previousY - dish.y);
        const dx = car.x - dish.x;
        const dy = car.y - dish.y;
        const distance = Math.max(.001, Math.hypot(dx, dy));
        const outer = dish.radius + CAR_RADIUS;
        const inner = dish.radius - CAR_RADIUS;
        const entered = previousDistance >= outer && distance < outer;
        const exited = previousDistance <= inner && distance > inner;
        const crossingRim = previousDistance > inner && previousDistance < outer;
        const aperture = isAperture(car.x, car.y, dish, angle);

        if (aperture) return;
        if (entered || (crossingRim && distance < dish.radius && previousDistance >= dish.radius)) {
            const nx = dx / distance;
            const ny = dy / distance;
            car.x = dish.x + nx * outer;
            car.y = dish.y + ny * outer;
            const inward = car.vx * nx + car.vy * ny;
            if (inward < 0) {
                car.vx -= inward * nx * 1.45;
                car.vy -= inward * ny * 1.45;
            }
            car.flash = 1;
            if (car.isPlayer) world.shake = .45;
        } else if (exited || (crossingRim && distance > dish.radius && previousDistance <= dish.radius)) {
            const nx = dx / distance;
            const ny = dy / distance;
            car.x = dish.x + nx * inner;
            car.y = dish.y + ny * inner;
            const outward = car.vx * nx + car.vy * ny;
            if (outward > 0) {
                car.vx -= outward * nx * 1.4;
                car.vy -= outward * ny * 1.4;
            }
            car.flash = 1;
            if (car.isPlayer) world.shake = .45;
        }
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

    function resolveBoom(car, dish, state) {
        const distance = Math.hypot(car.x - dish.x, car.y - dish.y);
        if (distance > dish.radius - 10) return;
        const boomAngle = state.angle + Math.PI * .5;
        const vector = axisVector(boomAngle);
        const endX = dish.x + vector.x * dish.radius * .74;
        const endY = dish.y + vector.y * dish.radius * .74;
        const hit = distanceToSegment(car.x, car.y, dish.x, dish.y, endX, endY);
        const minimum = CAR_RADIUS + 11;
        if (hit.distance >= minimum || hit.distance < .001) return;
        const nx = (car.x - hit.x) / hit.distance;
        const ny = (car.y - hit.y) / hit.distance;
        car.x += nx * (minimum - hit.distance);
        car.y += ny * (minimum - hit.distance);
        const tangentialSpeed = state.angularSpeed * dish.radius * hit.ratio;
        car.vx += vector.y * tangentialSpeed * .9 + nx * 24;
        car.vy += -vector.x * tangentialSpeed * .9 + ny * 24;
        car.spin += state.angularSpeed * 1.8 + (car.number % 2 ? .35 : -.35);
        car.flash = 1;
        if (car.isPlayer) world.shake = .72;
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished) return;
        car.flash = Math.max(0, car.flash - delta * 3.5);
        car.spin *= Math.pow(.05, delta);
        car.heading += car.spin * delta;
        const state = cycleState();
        const bowl = dishContaining(car.x, car.y, CAR_RADIUS * .15);
        const road = onServiceRoad(car.x, car.y);
        const grip = bowl ? .9 : road ? .83 : .62;
        const power = bowl ? 1.04 : road ? .9 : .64;
        const speed = Math.hypot(car.vx, car.vy);

        if (controls.throttle > 0) {
            const force = 230 / (car.mass / 1540) * controls.throttle * power;
            car.vx += Math.sin(car.heading) * force * delta;
            car.vy += Math.cos(car.heading) * force * delta;
        }
        if (controls.brake > 0 && speed > 1) {
            const nextSpeed = Math.max(0, speed - 255 * grip * controls.brake * delta);
            car.vx *= nextSpeed / speed;
            car.vy *= nextSpeed / speed;
        }

        car.heading += controls.steering * clamp(speed / 70, .14, 1) * (1.22 + grip * .65) * delta;
        const forwardX = Math.sin(car.heading);
        const forwardY = Math.cos(car.heading);
        const longitudinal = car.vx * forwardX + car.vy * forwardY;
        const lateral = (car.vx * forwardY - car.vy * forwardX) * Math.pow(Math.max(.05, 1 - grip * 4.2 * delta), 1);
        car.vx = forwardX * longitudinal + forwardY * lateral;
        car.vy = forwardY * longitudinal - forwardX * lateral;

        if (bowl) {
            const downhill = axisVector(state.angle);
            car.vx += downhill.x * 82 * delta;
            car.vy += downhill.y * 82 * delta;
            if (state.phase === "slewing") {
                const dx = car.x - bowl.x;
                const dy = car.y - bowl.y;
                car.vx += dy * state.angularSpeed * .2 * delta;
                car.vy -= dx * state.angularSpeed * .2 * delta;
            }
            car.dishNumber = bowl.number;
        } else {
            car.dishNumber = 0;
        }

        const maximum = bowl ? 465 : road ? 405 : 300;
        const drivenSpeed = Math.hypot(car.vx, car.vy);
        if (drivenSpeed > maximum) {
            car.vx *= maximum / drivenSpeed;
            car.vy *= maximum / drivenSpeed;
        }
        const rolling = bowl ? .994 : road ? .989 : .975;
        car.vx *= Math.pow(rolling, delta * 60);
        car.vy *= Math.pow(rolling, delta * 60);

        const previousX = car.x;
        const previousY = car.y;
        car.x += car.vx * delta;
        car.y += car.vy * delta;
        car.speed = Math.hypot(car.vx, car.vy);

        dishes.forEach((dish) => resolveRim(car, previousX, previousY, dish, state.angle));
        dishes.forEach((dish) => resolveBoom(car, dish, state));

        if (Math.abs(car.x) > FIELD_WIDTH * .5 - 28) {
            const side = Math.sign(car.x);
            car.x = side * (FIELD_WIDTH * .5 - 28);
            car.vx *= -.25;
            car.flash = 1;
        }
        if (!bowl && car.speed > 80 && seeded(car.number + Math.floor(world.time * 9), 17) > .8) addDust(car.x, car.y, 1);
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
                    first.vx += relative * nx * .52;
                    first.vy += relative * ny * .52;
                    second.vx -= relative * nx * .52;
                    second.vy -= relative * ny * .52;
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
            world.detail = car.finishPosition === 1 ? "First across the control line" : `Finished P${car.finishPosition}`;
        }
    }

    function updateParticles(delta) {
        world.particles.forEach((particle) => {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(.13, delta);
            particle.vy *= Math.pow(.13, delta);
            particle.radius += delta * 4;
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
        rivals.forEach((car) => updateCar(car, delta, artificialDriver(car)));
        updateCar(player, delta, {
            throttle: input.throttle ? 1 : 0,
            brake: input.brake ? 1 : 0,
            steering: (input.left ? -1 : 0) + (input.right ? 1 : 0)
        });
        collideCars();
        updateParticles(delta);
        const targetY = world.overview ? FIELD_LENGTH * .5 : player.y + 380;
        world.cameraV += (targetY - world.cameraY) * Math.min(1, delta * 5);
        world.cameraV *= Math.pow(.004, delta);
        world.cameraY += world.cameraV * delta;
        world.shake = Math.max(0, world.shake - delta * 2.2);
        updateReadouts();
    }

    function activeScale() {
        return world.overview
            ? Math.min((world.width - 80) / (FIELD_WIDTH + 170), (world.height - 70) / (FIELD_LENGTH + 240))
            : world.scale;
    }

    function point(x, y) {
        const scale = activeScale();
        return {
            x: world.width * .5 + x * scale,
            y: world.height * .68 - (y - world.cameraY) * scale
        };
    }

    function drawGround() {
        context.fillStyle = "#171815";
        context.fillRect(0, 0, world.width, world.height);
        const scale = activeScale();
        const left = world.width * .5 - FIELD_WIDTH * .5 * scale;
        const right = world.width * .5 + FIELD_WIDTH * .5 * scale;
        context.fillStyle = "#6c624f";
        context.fillRect(left, 0, right - left, world.height);

        context.strokeStyle = "rgba(188,174,144,.08)";
        context.lineWidth = 1;
        for (let x = -FIELD_WIDTH * .5; x <= FIELD_WIDTH * .5; x += 85) {
            const start = point(x, 0);
            context.beginPath();
            context.moveTo(start.x, 0);
            context.lineTo(start.x, world.height);
            context.stroke();
        }

        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(20,20,17,.35)";
        context.lineWidth = 480 * scale;
        context.beginPath();
        for (let y = -300; y <= FIELD_LENGTH + 300; y += 100) {
            const p = point(roadCenter(y), y);
            if (y === -300) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
        }
        context.stroke();
        context.strokeStyle = "#827764";
        context.lineWidth = 440 * scale;
        context.stroke();
        context.strokeStyle = "rgba(225,214,188,.16)";
        context.lineWidth = 4 * scale;
        context.setLineDash([22 * scale, 25 * scale]);
        context.stroke();
        context.setLineDash([]);
        context.lineCap = "butt";

        const finish = point(0, FIELD_LENGTH);
        context.fillStyle = "#e5dfcf";
        context.fillRect(left, finish.y - 9, right - left, 18);
        context.fillStyle = "rgba(10,11,9,.86)";
        context.fillRect(world.width * .5 - 99, finish.y - 49, 198, 26);
        context.fillStyle = "#eee8db";
        context.font = "600 9px General Sans";
        context.textAlign = "center";
        context.fillText("ARRAY CONTROL LINE", world.width * .5, finish.y - 32);
    }

    function dishScreenAngle(angle) {
        return angle - Math.PI * .5;
    }

    function drawDishBase(dish, state) {
        const p = point(dish.x, dish.y);
        const scale = activeScale();
        const radius = dish.radius * scale;
        if (p.y < -radius - 80 || p.y > world.height + radius + 80) return;
        const screenAngle = dishScreenAngle(state.angle);
        context.save();
        context.translate(p.x, p.y);
        context.fillStyle = "rgba(0,0,0,.34)";
        context.beginPath();
        context.ellipse(10 * scale, 14 * scale, radius * 1.04, radius * .96, 0, 0, TAU);
        context.fill();
        context.fillStyle = "#aaa99d";
        context.beginPath();
        context.arc(0, 0, radius, 0, TAU);
        context.fill();
        context.strokeStyle = "rgba(62,63,58,.4)";
        context.lineWidth = Math.max(1, 2 * scale);
        for (let ring = .22; ring < .92; ring += .18) {
            context.beginPath();
            context.arc(0, 0, radius * ring, 0, TAU);
            context.stroke();
        }
        context.strokeStyle = "rgba(245,241,225,.32)";
        context.lineWidth = Math.max(1, 3 * scale);
        context.beginPath();
        context.moveTo(-Math.cos(screenAngle) * radius * .82, -Math.sin(screenAngle) * radius * .82);
        context.lineTo(Math.cos(screenAngle) * radius * .82, Math.sin(screenAngle) * radius * .82);
        context.stroke();
        context.fillStyle = "rgba(41,43,39,.72)";
        context.font = `600 ${Math.max(6, 8 * scale)}px General Sans`;
        context.textAlign = "center";
        context.fillText(`DISH ${String(dish.number).padStart(2, "0")}`, 0, radius * .48);
        context.restore();
    }

    function drawDishStructure(dish, state) {
        const p = point(dish.x, dish.y);
        const scale = activeScale();
        const radius = dish.radius * scale;
        if (p.y < -radius - 80 || p.y > world.height + radius + 80) return;
        const screenAngle = dishScreenAngle(state.angle);
        const opening = OPENING_HALF_ANGLE * 1.15;
        context.save();
        context.translate(p.x, p.y);
        context.strokeStyle = "#4e514d";
        context.lineWidth = Math.max(5, 14 * scale);
        context.beginPath();
        context.arc(0, 0, radius, screenAngle + opening, screenAngle + Math.PI - opening);
        context.stroke();
        context.beginPath();
        context.arc(0, 0, radius, screenAngle + Math.PI + opening, screenAngle + TAU - opening);
        context.stroke();

        context.strokeStyle = "#d7d1bd";
        context.lineWidth = Math.max(3, 8 * scale);
        [-1, 1].forEach((direction) => {
            const angle = screenAngle + (direction < 0 ? Math.PI : 0);
            context.beginPath();
            context.moveTo(Math.cos(angle) * radius * .84, Math.sin(angle) * radius * .84);
            context.lineTo(Math.cos(angle) * radius * 1.22, Math.sin(angle) * radius * 1.22);
            context.stroke();
        });

        const boomAngle = screenAngle + Math.PI * .5;
        context.strokeStyle = "rgba(25,27,25,.45)";
        context.lineWidth = Math.max(7, 14 * scale);
        context.beginPath();
        context.moveTo(4, 5);
        context.lineTo(Math.cos(boomAngle) * radius * .74 + 4, Math.sin(boomAngle) * radius * .74 + 5);
        context.stroke();
        context.strokeStyle = "#656963";
        context.lineWidth = Math.max(4, 9 * scale);
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(Math.cos(boomAngle) * radius * .74, Math.sin(boomAngle) * radius * .74);
        context.stroke();
        context.fillStyle = "#343835";
        context.beginPath();
        context.arc(Math.cos(boomAngle) * radius * .74, Math.sin(boomAngle) * radius * .74, Math.max(4, 13 * scale), 0, TAU);
        context.fill();
        context.fillStyle = "#555a55";
        context.beginPath();
        context.arc(0, 0, Math.max(7, 21 * scale), 0, TAU);
        context.fill();

        if (state.phase === "warning") {
            const pulse = .35 + .5 * Math.sin(world.time * 9) ** 2;
            context.strokeStyle = `rgba(196,150,75,${pulse})`;
            context.lineWidth = Math.max(2, 4 * scale);
            context.beginPath();
            context.arc(0, 0, radius + 13 * scale, 0, TAU);
            context.stroke();
        }
        context.restore();
    }

    function drawCar(car) {
        if (!car.active && !car.finished) return;
        const p = point(car.x, car.y);
        if (p.y < -80 || p.y > world.height + 80) return;
        const scale = activeScale();
        context.save();
        context.translate(p.x, p.y);
        context.rotate(car.heading);
        context.fillStyle = "rgba(0,0,0,.34)";
        context.fillRect(-16 * scale + 4, -29 * scale + 6, 32 * scale, 58 * scale);
        context.fillStyle = car.flash > 0 ? "#e5dcc5" : car.colour;
        context.fillRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.fillStyle = "#202421";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 21 * scale);
        context.strokeStyle = car.isPlayer ? "#f1dda0" : "rgba(237,234,220,.5)";
        context.lineWidth = car.isPlayer ? 2 : 1;
        context.strokeRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const p = point(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1) * .28;
            context.fillStyle = "#b4a283";
            context.beginPath();
            context.arc(p.x, p.y, particle.radius * activeScale(), 0, TAU);
            context.fill();
        });
        context.globalAlpha = 1;
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 4) - .5) * world.shake * 8;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, 0);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawGround();
        const state = cycleState();
        dishes.forEach((dish) => drawDishBase(dish, state));
        allCars().slice().sort((first, second) => second.y - first.y).forEach(drawCar);
        drawParticles();
        dishes.forEach((dish) => drawDishStructure(dish, state));
        if (world.result !== "racing") {
            context.fillStyle = "rgba(6,7,6,.7)";
            context.fillRect(0, 0, world.width, world.height);
            context.fillStyle = "#eee9dd";
            context.font = "500 40px Clash Display";
            context.textAlign = "center";
            context.fillText("CONTROL LINE REACHED", world.width * .5, world.height * .5);
        }
    }

    function updateReadouts() {
        const state = cycleState();
        const bowl = dishContaining(player.x, player.y, CAR_RADIUS * .15);
        const road = onServiceRoad(player.x, player.y);
        const upcoming = nextDish(player);
        const bearingNumber = state.cycle % bearings.length + 1;
        const phaseLabel = state.phase === "slewing" ? "Slewing" : state.phase === "warning" ? "Warning" : "Holding";
        const remaining = state.phase === "slewing" ? CYCLE_LENGTH - state.local : state.phase === "warning" ? SLEW_START - state.local : HOLD_END - state.local;
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        surfaceReadout.textContent = bowl ? `Dish ${String(bowl.number).padStart(2, "0")} bowl` : road ? "Service gravel" : "Open basin";
        dishReadout.textContent = `Dish ${String(upcoming.number).padStart(2, "0")}`;
        speedReadout.textContent = `${Math.round(player.speed * .36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? "Observation live" : world.detail;
        cycleReadout.textContent = `${phaseLabel} / ${Math.max(0, remaining).toFixed(1)} s`;
        cycleBar.style.width = `${clamp(state.local / CYCLE_LENGTH * 100, 0, 100)}%`;
        cycleCopy.textContent = state.phase === "slewing" ? `All six dishes moving toward bearing ${String((bearingNumber % bearings.length) + 1).padStart(2, "0")}` : state.phase === "warning" ? "Amber rim pulse precedes synchronized motion" : `All six apertures fixed on bearing ${String(bearingNumber).padStart(2, "0")}`;
        bearingStatus.textContent = state.phase === "slewing" ? "Array retargeting" : `Bearing ${String(bearingNumber).padStart(2, "0")} ${state.phase === "warning" ? "releasing" : "held"}`;
        bowlStatus.textContent = bowl ? `Player inside Dish ${String(bowl.number).padStart(2, "0")}` : "Six crossings available";
        rimStatus.textContent = Math.abs(Math.cos(state.angle)) > .68 ? "North apertures aligned" : "Side apertures aligned";
        boomStatus.textContent = state.phase === "slewing" ? "Feeds sweeping bowls" : "Feeds holding position";
        roadStatus.textContent = road ? "Player on gravel bypass" : "Gravel bypass clear";
        finishStatus.textContent = world.finishers ? `${world.finishers} finishers recorded` : "North gate listening";
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth || 1320);
        const height = Math.max(1, canvas.clientHeight || 940);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        world.width = width;
        world.height = height;
        world.scale = clamp(Math.min(width / 1780, height / 1260), .46, .8);
        canvas.width = Math.round(width * world.dpr);
        canvas.height = Math.round(height * world.dpr);
        render();
    }

    const keyMap = { w: "throttle", arrowup: "throttle", s: "brake", arrowdown: "brake", a: "left", arrowleft: "left", d: "right", arrowright: "right" };

    function setControl(name, active) {
        if (!(name in input)) return;
        input[name] = active;
        buttons.forEach((button) => {
            if (button.dataset.listeningFieldControl === name) button.classList.toggle("is-pressed", active);
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
        const name = button.dataset.listeningFieldControl;
        const down = (event) => { event.preventDefault(); setControl(name, true); };
        const up = (event) => { event.preventDefault(); setControl(name, false); };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
    });
    resetButton.addEventListener("click", reset);
    overviewButton.addEventListener("click", () => {
        world.overview = !world.overview;
        overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey array";
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

    window.listeningField = {
        resize,
        reset,
        setControl,
        diagnostics: () => {
            const state = cycleState();
            const bowl = dishContaining(player.x, player.y, CAR_RADIUS * .15);
            return {
                result: world.result,
                detail: world.detail,
                time: world.time,
                cycle: state.cycle,
                phase: state.phase,
                bearing: state.angle,
                player: {
                    x: player.x,
                    y: player.y,
                    vx: player.vx,
                    vy: player.vy,
                    speed: player.speed,
                    heading: player.heading,
                    active: player.active,
                    position: racePosition(),
                    dish: bowl ? bowl.number : 0,
                    onServiceRoad: onServiceRoad(player.x, player.y)
                },
                finishers: world.finishers,
                activeRivals: rivals.filter((car) => car.active && !car.finished).length,
                dishes: dishes.map((dish) => ({ number: dish.number, x: dish.x, y: dish.y, radius: dish.radius }))
            };
        }
    };

    requestAnimationFrame(animate);
})();
