"use strict";

(() => {
    const canvas = document.getElementById("eye-of-plain-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("eye-of-plain");
    const resetButton = document.getElementById("eye-of-plain-reset");
    const overviewButton = document.getElementById("eye-of-plain-overview");
    const positionReadout = document.getElementById("eye-of-plain-position-readout");
    const weatherReadout = document.getElementById("eye-of-plain-weather-readout");
    const windReadout = document.getElementById("eye-of-plain-wind-readout");
    const speedReadout = document.getElementById("eye-of-plain-speed-readout");
    const resultReadout = document.getElementById("eye-of-plain-result-readout");
    const stabilityReadout = document.getElementById("eye-of-plain-stability-readout");
    const stabilityBar = document.getElementById("eye-of-plain-stability-bar");
    const stabilityCopy = document.getElementById("eye-of-plain-stability-copy");
    const stormStatus = document.getElementById("eye-of-plain-storm-status");
    const gustStatus = document.getElementById("eye-of-plain-gust-status");
    const tornadoStatus = document.getElementById("eye-of-plain-tornado-status");
    const hailStatus = document.getElementById("eye-of-plain-hail-status");
    const ditchStatus = document.getElementById("eye-of-plain-ditch-status");
    const finishStatus = document.getElementById("eye-of-plain-finish-status");
    const buttons = Array.from(document.querySelectorAll("[data-eye-of-plain-control]"));

    const FIELD_WIDTH = 1900;
    const FIELD_LENGTH = 8200;
    const STARTERS = 24;
    const CAR_RADIUS = 23;
    const TAU = Math.PI * 2;
    const input = { throttle: false, brake: false, left: false, right: false };
    const colours = ["#7c817b", "#8b6d59", "#657a77", "#8d8269", "#969080", "#67716b", "#8b604f"];
    const world = {
        width: 1320,
        height: 940,
        dpr: 1,
        scale: .65,
        time: 0,
        lastTime: performance.now(),
        cameraY: 390,
        cameraV: 0,
        overview: false,
        result: "racing",
        detail: "Warning active",
        finishers: 0,
        eliminated: 0,
        shake: 0,
        scar: [],
        debris: [],
        particles: [],
        scarClock: 0,
        wasVisible: false
    };
    const player = createCar(42, -90, true, 16);
    let rivals = [];

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function lerp(start, end, ratio) {
        return start + (end - start) * ratio;
    }

    function seeded(index, salt = 0) {
        const sample = Math.sin(index * 92.17 + salt * 46.73) * 43758.5453;
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
            colour: isPlayer ? "#c5a34d" : colours[number % colours.length],
            mass: isPlayer ? 1560 : 1260 + seeded(number, 4) * 850,
            aggression: .31 + seeded(number, 8) * .65,
            active: true,
            finished: false,
            eliminated: false,
            finishPosition: 0,
            flash: 0,
            spin: 0,
            stun: 0,
            rollLoad: 0,
            hailLoad: 0,
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

    function reset() {
        Object.assign(player, createCar(42, -90, true, 16));
        rivals = [];
        for (let index = 0; index < STARTERS - 1; index += 1) {
            const lane = index % 8;
            const row = Math.floor(index / 8);
            rivals.push(createCar(-590 + lane * 168 + (seeded(index, 3) - .5) * 22, -row * 77 + (seeded(index, 6) - .5) * 16, false, index + 1));
        }
        Object.assign(world, {
            time: 0,
            cameraY: 390,
            cameraV: 0,
            overview: false,
            result: "racing",
            detail: "Warning active",
            finishers: 0,
            eliminated: 0,
            shake: 0,
            scarClock: 0
        });
        world.scar.length = 0;
        world.debris.length = 0;
        world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey storm";
        updateReadouts();
        render();
    }

    function stormCenter(time = world.time) {
        return {
            x: -120 + Math.sin(time * .067) * 330,
            y: Math.min(FIELD_LENGTH + 700, 2100 + time * 91)
        };
    }

    function tornadoCenter(time = world.time) {
        const storm = stormCenter(time);
        const angle = time * .13 + 2.35;
        return {
            x: storm.x + Math.cos(angle) * 430,
            y: storm.y + Math.sin(angle) * 310 - 110
        };
    }

    function ditchX(index, y) {
        if (index === 0) return -520 + Math.sin(y / 760 + .7) * 115;
        if (index === 1) return Math.sin(y / 680 + 2.1) * 145;
        return 520 + Math.sin(y / 820 + 4.2) * 120;
    }

    function ditchAt(x, y) {
        let nearest = null;
        for (let index = 0; index < 3; index += 1) {
            const center = ditchX(index, y);
            const distance = Math.abs(x - center);
            if (distance < 72 && (!nearest || distance < nearest.distance)) nearest = { index, center, distance };
        }
        return nearest;
    }

    function hailCells(time = world.time) {
        const storm = stormCenter(time);
        const definitions = [
            { radius: 430, angle: .55 + time * .09, size: 245 },
            { radius: 710, angle: 2.4 - time * .055, size: 285 },
            { radius: 930, angle: 4.45 + time * .045, size: 260 }
        ];
        return definitions.map((cell, index) => ({
            index,
            x: storm.x + Math.cos(cell.angle) * cell.radius,
            y: storm.y + Math.sin(cell.angle) * cell.radius,
            rx: cell.size,
            ry: cell.size * .72
        }));
    }

    function hailAt(x, y) {
        return hailCells().find((cell) => {
            const dx = (x - cell.x) / cell.rx;
            const dy = (y - cell.y) / cell.ry;
            return dx * dx + dy * dy < 1;
        }) || null;
    }

    function scarAt(x, y) {
        for (let index = world.scar.length - 1; index >= 0; index -= 1) {
            const scar = world.scar[index];
            if (Math.abs(y - scar.y) > 115) continue;
            if (Math.hypot(x - scar.x, y - scar.y) < scar.radius) return scar;
        }
        return null;
    }

    function gustDistance(radius) {
        const spacing = 430;
        const phase = ((radius - world.time * 118) % spacing + spacing) % spacing;
        return Math.min(phase, spacing - phase);
    }

    function windAt(x, y) {
        const storm = stormCenter();
        const dx = x - storm.x;
        const dy = y - storm.y;
        const radius = Math.max(1, Math.hypot(dx, dy));
        const influence = clamp(1 - radius / 1550, 0, 1);
        const tangentX = -dy / radius;
        const tangentY = dx / radius;
        const inwardX = -dx / radius;
        const inwardY = -dy / radius;
        const gust = gustDistance(radius) < 48 ? 1.62 : gustDistance(radius) < 85 ? 1.28 : 1;
        let xForce = 11 + (tangentX * 174 + inwardX * 48) * influence * gust;
        let yForce = 4 + (tangentY * 174 + inwardY * 48) * influence * gust;
        const ditch = ditchAt(x, y);
        if (ditch) {
            xForce *= .48;
            yForce *= .48;
        }
        return {
            x: xForce,
            y: yForce,
            speed: Math.hypot(xForce, yForce),
            influence,
            gust: gust > 1.5 ? "front" : gust > 1 ? "edge" : "steady",
            radius
        };
    }

    function updateStorm(delta) {
        world.scarClock -= delta;
        if (world.scarClock <= 0) {
            world.scarClock = .16;
            const tornado = tornadoCenter();
            if (tornado.y > -200 && tornado.y < FIELD_LENGTH + 250) {
                const scar = { x: tornado.x, y: tornado.y, radius: 68 + seeded(world.time * 10, 3) * 34 };
                world.scar.push(scar);
                if (world.scar.length % 4 === 0) {
                    world.debris.push({
                        x: scar.x + (seeded(world.scar.length, 4) - .5) * scar.radius,
                        y: scar.y + (seeded(world.scar.length, 7) - .5) * scar.radius,
                        angle: seeded(world.scar.length, 9) * TAU,
                        size: 12 + seeded(world.scar.length, 11) * 22
                    });
                }
            }
        }
        if (world.scar.length > 900) world.scar.splice(0, world.scar.length - 900);
        if (world.debris.length > 220) world.debris.splice(0, world.debris.length - 220);
    }

    function addParticle(x, y, type, count = 1) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(index + world.time * 150, x + y) * TAU;
            const speed = 15 + seeded(index, y) * 75;
            world.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: type === "hail" ? 2 + seeded(index, 5) * 3 : 4 + seeded(index, 8) * 9,
                life: .7 + seeded(index, 12) * 1.2,
                maxLife: 1.9,
                type
            });
        }
        if (world.particles.length > 380) world.particles.splice(0, world.particles.length - 380);
    }

    function nearestDitchIndex(x, y) {
        let nearest = 0;
        let distance = Infinity;
        for (let index = 0; index < 3; index += 1) {
            const sample = Math.abs(x - ditchX(index, y));
            if (sample < distance) {
                distance = sample;
                nearest = index;
            }
        }
        return nearest;
    }

    function artificialDriver(car) {
        const tornado = tornadoCenter();
        const wind = windAt(car.x, car.y);
        let targetX = Math.sin((car.y + 300) / 1200 + car.number) * 90;
        const tornadoAhead = tornado.y - car.y;
        if (tornadoAhead > -120 && tornadoAhead < 760 && Math.abs(tornado.x - car.x) < 620) {
            targetX = tornado.x + (car.x <= tornado.x ? -1 : 1) * 560;
        } else if (wind.speed > 92) {
            const ditchIndex = (nearestDitchIndex(car.x, car.y) + (car.number % 3 === 0 ? 1 : 0)) % 3;
            targetX = ditchX(ditchIndex, car.y + 360);
        }
        targetX = clamp(targetX, -FIELD_WIDTH * .5 + 48, FIELD_WIDTH * .5 - 48);
        car.targetX = targetX;
        let desired = Math.atan2(targetX - car.x, 360);
        if (wind.speed > 105) {
            let align = Math.atan2(wind.x, wind.y);
            if (Math.cos(align) < 0) align = wrapAngle(align + Math.PI);
            desired += wrapAngle(align - desired) * .48;
        }
        const steeringError = wrapAngle(desired - car.heading);
        return {
            throttle: car.rollLoad > .82 ? .62 : .84 + car.aggression * .14,
            brake: car.rollLoad > 1 ? .28 : 0,
            steering: clamp(steeringError * 2.1 - car.spin * .18, -1, 1)
        };
    }

    function resolveDebris(car) {
        world.debris.forEach((debris) => {
            const distance = Math.hypot(car.x - debris.x, car.y - debris.y);
            if (distance >= CAR_RADIUS + debris.size) return;
            const dx = car.x - debris.x;
            const dy = car.y - debris.y;
            const length = Math.max(1, distance);
            car.x += dx / length * (CAR_RADIUS + debris.size - distance + 1);
            car.y += dy / length * (CAR_RADIUS + debris.size - distance + 1);
            car.vx *= .83;
            car.vy *= .83;
            car.spin += car.number % 2 ? .28 : -.28;
            car.flash = 1;
        });
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished || car.eliminated) return;
        car.flash = Math.max(0, car.flash - delta * 3.5);
        car.stun = Math.max(0, car.stun - delta);
        car.spin *= Math.pow(.06, delta);
        car.heading += car.spin * delta;

        const ditch = ditchAt(car.x, car.y);
        const hail = hailAt(car.x, car.y);
        const scar = scarAt(car.x, car.y);
        const wind = windAt(car.x, car.y);
        const grip = hail ? .48 : scar ? .54 : ditch ? .65 : .84;
        const power = (hail ? .76 : ditch ? .78 : .94) * (car.stun > 0 ? .38 : 1);
        const speed = Math.hypot(car.vx, car.vy);

        if (controls.throttle > 0) {
            const force = 230 / (car.mass / 1560) * controls.throttle * power;
            car.vx += Math.sin(car.heading) * force * delta;
            car.vy += Math.cos(car.heading) * force * delta;
        }
        if (controls.brake > 0 && speed > 1) {
            const next = Math.max(0, speed - 250 * grip * controls.brake * delta);
            car.vx *= next / speed;
            car.vy *= next / speed;
        }

        car.heading += controls.steering * clamp(speed / 68, .15, 1) * (1.27 + grip * .62) * delta;
        const forwardX = Math.sin(car.heading);
        const forwardY = Math.cos(car.heading);
        const longitudinal = car.vx * forwardX + car.vy * forwardY;
        const lateral = (car.vx * forwardY - car.vy * forwardX) * Math.pow(Math.max(.04, 1 - grip * 4.1 * delta), 1);
        car.vx = forwardX * longitudinal + forwardY * lateral;
        car.vy = forwardY * longitudinal - forwardX * lateral;

        car.vx += wind.x * delta * .78;
        car.vy += wind.y * delta * .78;
        const sideX = Math.cos(car.heading);
        const sideY = -Math.sin(car.heading);
        const crosswind = Math.abs(wind.x * sideX + wind.y * sideY);
        const exposure = clamp((crosswind - 55) / 105, 0, 1);
        car.rollLoad = clamp(car.rollLoad + exposure * delta * 1.15 - delta * (ditch ? .42 : .27), 0, 1.5);

        if (car.rollLoad > .72) {
            car.spin += (wind.x * sideX + wind.y * sideY >= 0 ? 1 : -1) * delta * (car.rollLoad - .62) * 2.4;
        }
        if (car.rollLoad > 1.28) {
            eliminate(car, "Rolled by the gust front");
            return;
        }

        if (hail) {
            car.hailLoad = clamp(car.hailLoad + delta * .15, 0, 1);
            if (seeded(car.number + Math.floor(world.time * 18), 19) > .7) addParticle(car.x, car.y, "hail", 1);
            if (car.hailLoad >= 1) {
                car.stun = Math.max(car.stun, .45);
                car.hailLoad = .58;
            }
        } else {
            car.hailLoad = Math.max(0, car.hailLoad - delta * .06);
        }

        const maximum = ditch ? 295 : scar ? 285 : 410;
        const driven = Math.hypot(car.vx, car.vy);
        if (driven > maximum) {
            car.vx *= maximum / driven;
            car.vy *= maximum / driven;
        }
        const rolling = ditch ? .974 : scar ? .969 : .989;
        car.vx *= Math.pow(rolling, delta * 60);
        car.vy *= Math.pow(rolling, delta * 60);
        car.x += car.vx * delta;
        car.y += car.vy * delta;
        car.speed = Math.hypot(car.vx, car.vy);

        resolveDebris(car);
        const tornado = tornadoCenter();
        const tornadoDistance = Math.hypot(car.x - tornado.x, car.y - tornado.y);
        if (tornadoDistance < 125) {
            eliminate(car, "Entered the tornado core");
            return;
        }
        if (tornadoDistance < 350) {
            const dx = car.x - tornado.x;
            const dy = car.y - tornado.y;
            const distance = Math.max(1, tornadoDistance);
            const pull = (1 - distance / 350) * 230;
            car.vx += (-dy / distance * 1.2 - dx / distance * .5) * pull * delta;
            car.vy += (dx / distance * 1.2 - dy / distance * .5) * pull * delta;
            car.rollLoad = clamp(car.rollLoad + delta * .28, 0, 1.5);
            if (seeded(car.number + Math.floor(world.time * 12), 23) > .75) addParticle(car.x, car.y, "debris", 1);
        }

        if (Math.abs(car.x) > FIELD_WIDTH * .5 - 28) {
            const side = Math.sign(car.x);
            car.x = side * (FIELD_WIDTH * .5 - 28);
            car.vx *= -.22;
            car.flash = 1;
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
        addParticle(car.x, car.y, "debris", 10);
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
            world.detail = car.finishPosition === 1 ? "First beyond the warning line" : `Finished P${car.finishPosition}`;
        }
    }

    function updateParticles(delta) {
        const localStorm = stormCenter();
        world.particles.forEach((particle) => {
            const wind = windAt(particle.x, particle.y);
            particle.vx += wind.x * delta * .45;
            particle.vy += wind.y * delta * .45;
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(.16, delta);
            particle.vy *= Math.pow(.16, delta);
            if (particle.type !== "hail") particle.radius += delta * 3;
            particle.life -= delta;
            particle.stormDistance = Math.hypot(particle.x - localStorm.x, particle.y - localStorm.y);
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
        updateStorm(delta);
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

    function drawGround() {
        context.fillStyle = "#141615";
        context.fillRect(0, 0, world.width, world.height);
        const scale = activeScale();
        const left = world.width * .5 - FIELD_WIDTH * .5 * scale;
        const right = world.width * .5 + FIELD_WIDTH * .5 * scale;
        context.fillStyle = "#66634e";
        context.fillRect(left, 0, right - left, world.height);

        context.strokeStyle = "rgba(205,197,151,.1)";
        context.lineWidth = Math.max(1, 2 * scale);
        for (let x = -FIELD_WIDTH * .5 + 55; x < FIELD_WIDTH * .5; x += 95) {
            const screenX = point(x, 0).x;
            context.beginPath();
            context.moveTo(screenX, 0);
            context.lineTo(screenX, world.height);
            context.stroke();
        }

        for (let index = 0; index < 3; index += 1) {
            context.strokeStyle = "rgba(24,31,28,.48)";
            context.lineWidth = 148 * scale;
            context.lineCap = "round";
            context.beginPath();
            for (let y = -300; y <= FIELD_LENGTH + 300; y += 80) {
                const p = point(ditchX(index, y), y);
                if (y === -300) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y);
            }
            context.stroke();
            context.strokeStyle = "rgba(91,85,59,.72)";
            context.lineWidth = 112 * scale;
            context.stroke();
            context.strokeStyle = "rgba(171,156,104,.2)";
            context.lineWidth = 3 * scale;
            context.stroke();
            context.lineCap = "butt";
        }

        world.scar.forEach((scar) => {
            const p = point(scar.x, scar.y);
            if (p.y < -100 || p.y > world.height + 100) return;
            context.fillStyle = "rgba(61,51,39,.78)";
            context.beginPath();
            context.arc(p.x, p.y, scar.radius * scale, 0, TAU);
            context.fill();
        });
        world.debris.forEach((debris) => {
            const p = point(debris.x, debris.y);
            context.save();
            context.translate(p.x, p.y);
            context.rotate(debris.angle);
            context.fillStyle = "#3f3b32";
            context.fillRect(-debris.size * scale, -4 * scale, debris.size * scale * 2, 8 * scale);
            context.restore();
        });

        const finish = point(0, FIELD_LENGTH);
        context.fillStyle = "#ded8c8";
        context.fillRect(left, finish.y - 9, right - left, 18);
        context.fillStyle = "rgba(8,9,8,.87)";
        context.fillRect(world.width * .5 - 100, finish.y - 49, 200, 26);
        context.fillStyle = "#eee8da";
        context.font = "600 9px General Sans";
        context.textAlign = "center";
        context.fillText("WEATHER WARNING LINE", world.width * .5, finish.y - 32);
    }

    function drawStorm() {
        const storm = stormCenter();
        const center = point(storm.x, storm.y);
        const scale = activeScale();
        const radius = 1550 * scale;
        context.globalAlpha = .2;
        context.fillStyle = "#202827";
        context.beginPath();
        context.arc(center.x, center.y, radius, 0, TAU);
        context.fill();
        context.globalAlpha = 1;

        for (let ring = 220; ring < 1550; ring += 215) {
            const distance = gustDistance(ring);
            context.strokeStyle = distance < 60 ? "rgba(208,200,174,.44)" : "rgba(81,101,97,.22)";
            context.lineWidth = Math.max(1, (distance < 60 ? 13 : 5) * scale);
            context.setLineDash(distance < 60 ? [32 * scale, 15 * scale] : [18 * scale, 28 * scale]);
            context.beginPath();
            context.arc(center.x, center.y, ring * scale, world.time * .07 + ring * .001, world.time * .07 + ring * .001 + Math.PI * 1.62);
            context.stroke();
        }
        context.setLineDash([]);

        context.strokeStyle = "rgba(198,207,198,.28)";
        context.lineWidth = Math.max(1, 3 * scale);
        for (let angle = 0; angle < TAU; angle += Math.PI / 6) {
            const sampleRadius = 350 + (angle % 1) * 500;
            const x = storm.x + Math.cos(angle + world.time * .11) * sampleRadius;
            const y = storm.y + Math.sin(angle + world.time * .11) * sampleRadius;
            const wind = windAt(x, y);
            const p = point(x, y);
            context.beginPath();
            context.moveTo(p.x, p.y);
            context.lineTo(p.x + wind.x * scale * .42, p.y - wind.y * scale * .42);
            context.stroke();
        }

        hailCells().forEach((cell) => {
            const p = point(cell.x, cell.y);
            context.fillStyle = "rgba(175,188,184,.2)";
            context.beginPath();
            context.ellipse(p.x, p.y, cell.rx * scale, cell.ry * scale, 0, 0, TAU);
            context.fill();
            context.strokeStyle = "rgba(215,220,212,.38)";
            context.lineWidth = Math.max(1, 3 * scale);
            context.setLineDash([7 * scale, 9 * scale]);
            context.stroke();
            context.setLineDash([]);
        });

        const tornado = tornadoCenter();
        const funnel = point(tornado.x, tornado.y);
        context.fillStyle = "rgba(20,22,21,.68)";
        context.beginPath();
        context.arc(funnel.x, funnel.y, 132 * scale, 0, TAU);
        context.fill();
        context.strokeStyle = "rgba(205,199,181,.55)";
        context.lineWidth = Math.max(2, 7 * scale);
        for (let ring = 34; ring <= 120; ring += 28) {
            context.beginPath();
            context.arc(funnel.x, funnel.y, ring * scale, world.time * .9 + ring * .02, world.time * .9 + ring * .02 + Math.PI * 1.45);
            context.stroke();
        }
    }

    function drawCar(car) {
        if ((!car.active && !car.finished) || car.eliminated) return;
        const p = point(car.x, car.y);
        if (p.y < -80 || p.y > world.height + 80) return;
        const scale = activeScale();
        context.save();
        context.translate(p.x, p.y);
        context.rotate(car.heading);
        context.fillStyle = "rgba(0,0,0,.35)";
        context.fillRect(-16 * scale + 4, -29 * scale + 6, 32 * scale, 58 * scale);
        context.fillStyle = car.flash > 0 ? "#e5dfcc" : car.colour;
        context.fillRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.fillStyle = "#202523";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 21 * scale);
        context.strokeStyle = car.isPlayer ? "#f0dc9e" : "rgba(235,233,219,.5)";
        context.lineWidth = car.isPlayer ? 2 : 1;
        context.strokeRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const p = point(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1) * (particle.type === "hail" ? .75 : .5);
            if (particle.type === "hail") {
                context.fillStyle = "#d7ddd7";
                context.beginPath();
                context.arc(p.x, p.y, particle.radius * activeScale(), 0, TAU);
                context.fill();
            } else {
                context.fillStyle = "#49463c";
                context.fillRect(p.x - particle.radius, p.y - 2, particle.radius * 2, 4);
            }
        });
        context.globalAlpha = 1;
    }

    function drawHailVeil() {
        const hail = hailAt(player.x, player.y);
        if (!hail || world.overview) return;
        context.fillStyle = `rgba(190,201,198,${.08 + player.hailLoad * .13})`;
        context.fillRect(0, 0, world.width, world.height);
        context.strokeStyle = "rgba(229,233,226,.35)";
        context.lineWidth = 1;
        for (let index = 0; index < 70; index += 1) {
            const x = seeded(index, Math.floor(world.time * 3)) * world.width;
            const y = seeded(index, 17 + Math.floor(world.time * 5)) * world.height;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x - 7, y + 14);
            context.stroke();
        }
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 4) - .5) * world.shake * 9;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, 0);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawGround();
        drawStorm();
        allCars().slice().sort((first, second) => second.y - first.y).forEach(drawCar);
        drawParticles();
        drawHailVeil();
        if (world.result !== "racing") {
            context.fillStyle = "rgba(6,7,7,.71)";
            context.fillRect(0, 0, world.width, world.height);
            context.fillStyle = world.result === "finished" ? "#eee8da" : "#d8a08a";
            context.font = "500 40px Clash Display";
            context.textAlign = "center";
            context.fillText(world.result === "finished" ? "WARNING LINE CLEARED" : "VEHICLE LOST TO STORM", world.width * .5, world.height * .5);
        }
    }

    function compassDirection(x, y) {
        const angle = Math.atan2(x, y);
        const directions = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
        const index = Math.round(((angle + TAU) % TAU) / (TAU / 8)) % 8;
        return directions[index];
    }

    function updateReadouts() {
        const wind = windAt(player.x, player.y);
        const hail = hailAt(player.x, player.y);
        const ditch = ditchAt(player.x, player.y);
        const scar = scarAt(player.x, player.y);
        const tornado = tornadoCenter();
        const tornadoDistance = Math.hypot(player.x - tornado.x, player.y - tornado.y);
        const load = Math.round(clamp(player.rollLoad / 1.28, 0, 1) * 100);
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        weatherReadout.textContent = hail ? "Hail curtain" : wind.gust === "front" ? "Gust front" : ditch ? "Drainage shelter" : scar ? "Tornado scar" : wind.influence > .1 ? "Rotating inflow" : "Outer wind";
        windReadout.textContent = `${Math.round(wind.speed * 3.6)} km/h ${compassDirection(wind.x, wind.y)}`;
        speedReadout.textContent = `${Math.round(player.speed * .36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? "Warning active" : world.detail;
        stabilityReadout.textContent = `${load}%`;
        stabilityBar.style.width = `${load}%`;
        stabilityCopy.textContent = load > 78 ? "Critical broadside load — turn into wind" : load > 40 ? "Crosswind lifting outside wheels" : ditch ? "Drainage cut reducing exposure" : "Vehicle aligned with local wind";
        stormStatus.textContent = `Core ${Math.max(0, Math.round((stormCenter().y - player.y) / 10) * 10)} m ${stormCenter().y >= player.y ? "ahead" : "behind"}`;
        gustStatus.textContent = wind.gust === "front" ? "Pressure band crossing" : wind.gust === "edge" ? "Gust edge approaching" : "Wind field rotating";
        tornadoStatus.textContent = tornadoDistance < 500 ? `Core ${Math.round(tornadoDistance)} m away` : `${world.scar.length} scar marks persistent`;
        hailStatus.textContent = hail ? "Player inside hail core" : "Three cores rotating";
        ditchStatus.textContent = ditch ? `Sheltered in cut ${ditch.index + 1}` : "Low cuts available";
        finishStatus.textContent = world.finishers || world.eliminated ? `${world.finishers} finished / ${world.eliminated} lost` : "North markers visible";
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth || 1320);
        const height = Math.max(1, canvas.clientHeight || 940);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        world.width = width;
        world.height = height;
        world.scale = clamp(Math.min(width / 1880, height / 1270), .44, .78);
        canvas.width = Math.round(width * world.dpr);
        canvas.height = Math.round(height * world.dpr);
        render();
    }

    const keyMap = { w: "throttle", arrowup: "throttle", s: "brake", arrowdown: "brake", a: "left", arrowleft: "left", d: "right", arrowright: "right" };

    function setControl(name, active) {
        if (!(name in input)) return;
        input[name] = active;
        buttons.forEach((button) => {
            if (button.dataset.eyeOfPlainControl === name) button.classList.toggle("is-pressed", active);
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
        const name = button.dataset.eyeOfPlainControl;
        const down = (event) => { event.preventDefault(); setControl(name, true); };
        const up = (event) => { event.preventDefault(); setControl(name, false); };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
    });
    resetButton.addEventListener("click", reset);
    overviewButton.addEventListener("click", () => {
        world.overview = !world.overview;
        overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey storm";
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

    window.eyeOfPlain = {
        resize,
        reset,
        setControl,
        diagnostics: () => {
            const wind = windAt(player.x, player.y);
            const tornado = tornadoCenter();
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
                    rollLoad: player.rollLoad,
                    hailLoad: player.hailLoad,
                    inDitch: Boolean(ditchAt(player.x, player.y)),
                    inHail: Boolean(hailAt(player.x, player.y)),
                    inScar: Boolean(scarAt(player.x, player.y)),
                    wind: { x: wind.x, y: wind.y, speed: wind.speed, gust: wind.gust },
                    targetX: player.x
                },
                storm: stormCenter(),
                tornado,
                tornadoDistance: Math.hypot(player.x - tornado.x, player.y - tornado.y),
                scarMarks: world.scar.length,
                debris: world.debris.length,
                finishers: world.finishers,
                eliminated: world.eliminated,
                activeRivals: rivals.filter((car) => car.active && !car.finished && !car.eliminated).length
            };
        }
    };

    requestAnimationFrame(animate);
})();
