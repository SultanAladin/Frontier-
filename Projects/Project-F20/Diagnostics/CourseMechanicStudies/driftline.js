"use strict";

(() => {
    const canvas = document.getElementById("driftline-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("driftline");
    const resetButton = document.getElementById("driftline-reset");
    const overviewButton = document.getElementById("driftline-overview");
    const positionReadout = document.getElementById("driftline-position-readout");
    const supportReadout = document.getElementById("driftline-support-readout");
    const fractureReadout = document.getElementById("driftline-fracture-readout");
    const speedReadout = document.getElementById("driftline-speed-readout");
    const resultReadout = document.getElementById("driftline-result-readout");
    const separationReadout = document.getElementById("driftline-separation-readout");
    const separationBar = document.getElementById("driftline-separation-bar");
    const separationCopy = document.getElementById("driftline-separation-copy");
    const crackStatus = document.getElementById("driftline-crack-status");
    const plateStatus = document.getElementById("driftline-plate-status");
    const rotationStatus = document.getElementById("driftline-rotation-status");
    const leadStatus = document.getElementById("driftline-lead-status");
    const ridgeStatus = document.getElementById("driftline-ridge-status");
    const finishStatus = document.getElementById("driftline-finish-status");
    const buttons = Array.from(document.querySelectorAll("[data-driftline-control]"));

    const FIELD_WIDTH = 1750;
    const FIELD_LENGTH = 8000;
    const STARTERS = 24;
    const CAR_RADIUS = 22;
    const ROWS = 8;
    const COLUMNS = 5;
    const TAU = Math.PI * 2;
    const input = { throttle: false, brake: false, left: false, right: false };
    const colours = ["#79817f", "#886d5b", "#657d7e", "#8b836c", "#989388", "#687374", "#8b6252"];
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
        detail: "Shelf intact",
        finishers: 0,
        eliminated: 0,
        shake: 0,
        particles: [],
        wasVisible: false
    };

    const shelves = [
        { id: "south", x: 0, y: 0, width: 1120, length: 520, label: "South shelf" },
        { id: "north", x: 0, y: FIELD_LENGTH, width: 1120, length: 560, label: "North station" }
    ];
    const player = createCar(42, -80, true, 19);
    let rivals = [];
    let plates = [];
    let fractures = [];

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function lerp(start, end, ratio) {
        return start + (end - start) * ratio;
    }

    function seeded(index, salt = 0) {
        const sample = Math.sin(index * 91.97 + salt * 45.13) * 43758.5453;
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
            colour: isPlayer ? "#c5a64f" : colours[number % colours.length],
            mass: isPlayer ? 1540 : 1250 + seeded(number, 3) * 840,
            aggression: .3 + seeded(number, 7) * .66,
            active: true,
            finished: false,
            eliminated: false,
            finishPosition: 0,
            flash: 0,
            spin: 0,
            flood: 0,
            supportId: "shelf-south",
            targetX: x,
            reason: ""
        };
    }

    function createPlate(row, column) {
        const id = row * COLUMNS + column;
        const x = (column - 2) * 338;
        const y = 650 + row * 900;
        return {
            id,
            row,
            column,
            x, y,
            originX: x,
            originY: y,
            width: 326 - seeded(id, 2) * 18,
            length: 842 - seeded(id, 4) * 35,
            angle: 0,
            vx: 0,
            vy: 0,
            angleVelocity: 0,
            released: false,
            ridge: 19 + seeded(id, 6) * 9,
            notch: seeded(id, 8)
        };
    }

    function allCars() {
        return [player, ...rivals];
    }

    function activeCars() {
        return allCars().filter((car) => car.active && !car.finished && !car.eliminated);
    }

    function reset() {
        Object.assign(player, createCar(42, -80, true, 19));
        rivals = [];
        for (let index = 0; index < STARTERS - 1; index += 1) {
            const lane = index % 8;
            const row = Math.floor(index / 8);
            rivals.push(createCar(-590 + lane * 168 + (seeded(index, 2) - .5) * 20, -row * 74 + (seeded(index, 5) - .5) * 14, false, index + 1));
        }
        plates = [];
        for (let row = 0; row < ROWS; row += 1) {
            for (let column = 0; column < COLUMNS; column += 1) plates.push(createPlate(row, column));
        }
        fractures = Array.from({ length: ROWS }, (_, row) => ({
            number: row + 1,
            row,
            y: 650 + row * 900,
            state: "stable",
            timer: 0,
            progress: 0,
            triggeredAt: 0,
            releasedAt: 0
        }));
        Object.assign(world, {
            time: 0,
            cameraY: 390,
            cameraV: 0,
            overview: false,
            result: "racing",
            detail: "Shelf intact",
            finishers: 0,
            eliminated: 0,
            shake: 0
        });
        world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey shelf";
        updateReadouts();
        render();
    }

    function localCoordinates(x, y, plate) {
        const dx = x - plate.x;
        const dy = y - plate.y;
        const forwardX = Math.sin(plate.angle);
        const forwardY = Math.cos(plate.angle);
        const sideX = Math.cos(plate.angle);
        const sideY = -Math.sin(plate.angle);
        return {
            longitudinal: dx * forwardX + dy * forwardY,
            lateral: dx * sideX + dy * sideY
        };
    }

    function shelfAt(x, y) {
        return shelves.find((shelf) => Math.abs(x - shelf.x) <= shelf.width * .5 && Math.abs(y - shelf.y) <= shelf.length * .5) || null;
    }

    function plateAt(x, y, margin = 0) {
        let best = null;
        plates.forEach((plate) => {
            const local = localCoordinates(x, y, plate);
            if (Math.abs(local.longitudinal) > plate.length * .5 + margin || Math.abs(local.lateral) > plate.width * .5 + margin) return;
            const edge = Math.min(plate.length * .5 - Math.abs(local.longitudinal), plate.width * .5 - Math.abs(local.lateral));
            if (!best || edge > best.edge) best = { plate, local, edge };
        });
        return best;
    }

    function supportAt(x, y) {
        const shelf = shelfAt(x, y);
        if (shelf) return { type: "shelf", shelf, id: `shelf-${shelf.id}`, ridge: false };
        const found = plateAt(x, y, 4);
        if (!found) return null;
        return { type: "plate", plate: found.plate, id: `plate-${found.plate.id}`, ridge: found.edge < found.plate.ridge };
    }

    function fractureForPlate(plate) {
        return fractures[plate.row];
    }

    function triggerFractures(delta) {
        const leaderY = activeCars().reduce((maximum, car) => Math.max(maximum, car.y), -Infinity);
        fractures.forEach((fracture) => {
            if (fracture.state === "stable" && (leaderY > fracture.y - 540 || world.time > 9 + fracture.row * 5.8)) {
                fracture.state = "cracking";
                fracture.timer = 1.75;
                fracture.progress = 0;
                fracture.triggeredAt = world.time;
            } else if (fracture.state === "cracking") {
                fracture.timer -= delta;
                fracture.progress = clamp(1 - fracture.timer / 1.75, 0, 1);
                if (fracture.timer <= 0) releaseFracture(fracture);
            }
        });
    }

    function releaseFracture(fracture) {
        fracture.state = "separated";
        fracture.progress = 1;
        fracture.releasedAt = world.time;
        plates.filter((plate) => plate.row === fracture.row).forEach((plate) => {
            const lateralDirection = plate.column - 2;
            const randomDirection = seeded(plate.id, 11) > .5 ? 1 : -1;
            plate.released = true;
            plate.vx = lateralDirection * (8 + seeded(plate.id, 13) * 4) + randomDirection * (6 + seeded(plate.id, 15) * 8);
            plate.vy = (plate.row % 2 ? 1 : -1) * (5 + seeded(plate.id, 17) * 9) + (plate.column % 2 ? 3 : -3);
            plate.angleVelocity = (lateralDirection * .0045) + randomDirection * (.008 + seeded(plate.id, 19) * .013);
        });
        for (let index = 0; index < 24; index += 1) addParticle(-FIELD_WIDTH * .5 + seeded(index, 21) * FIELD_WIDTH, fracture.y, "ice", 1);
    }

    function updatePlates(delta) {
        plates.forEach((plate) => {
            if (!plate.released) return;
            plate.vx += Math.sin(world.time * .11 + plate.row) * delta * .24;
            plate.vy += Math.cos(world.time * .09 + plate.column) * delta * .12;
            plate.x += plate.vx * delta;
            plate.y += plate.vy * delta;
            plate.angle += plate.angleVelocity * delta;
        });
    }

    function fractureSeparation(fracture) {
        const group = plates.filter((plate) => plate.row === fracture.row);
        if (!group.length) return 0;
        return group.reduce((total, plate) => total + Math.hypot(plate.x - plate.originX, plate.y - plate.originY), 0) / group.length;
    }

    function bestPlateAhead(car) {
        let best = null;
        let score = Infinity;
        plates.forEach((plate) => {
            const dy = plate.y - car.y;
            if (dy < 35 || dy > 620) return;
            const candidate = dy + Math.abs(plate.x - car.x) * .6 + Math.abs(plate.angle) * 60;
            if (candidate < score) {
                score = candidate;
                best = plate;
            }
        });
        return best;
    }

    function artificialDriver(car) {
        const support = supportAt(car.x, car.y);
        const targetPlate = bestPlateAhead(car);
        let targetX = targetPlate ? targetPlate.x : 0;
        if (car.y > FIELD_LENGTH - 650) targetX = 0;
        if (!support && targetPlate) targetX = targetPlate.x;
        targetX = clamp(targetX, -FIELD_WIDTH * .5 + 45, FIELD_WIDTH * .5 - 45);
        car.targetX = targetX;
        const desired = Math.atan2(targetX - car.x, 390);
        const error = wrapAngle(desired - car.heading);
        return {
            throttle: car.flood > 2 ? 1 : .84 + car.aggression * .14,
            brake: support && support.ridge && Math.abs(error) > .5 ? .12 : 0,
            steering: clamp(error * 2.15 - car.spin * .18, -1, 1)
        };
    }

    function addParticle(x, y, type, count = 1) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(index + world.time * 170, x + y) * TAU;
            const speed = 10 + seeded(index, y) * 58;
            world.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 3 + seeded(index, 9) * 8,
                life: .7 + seeded(index, 12) * 1.15,
                maxLife: 1.85,
                type
            });
        }
        if (world.particles.length > 340) world.particles.splice(0, world.particles.length - 340);
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished || car.eliminated) return;
        car.flash = Math.max(0, car.flash - delta * 3.5);
        car.spin *= Math.pow(.06, delta);
        car.heading += car.spin * delta;
        const support = supportAt(car.x, car.y);
        const water = !support;
        const ridge = support && support.ridge;
        const grip = water ? .24 : support.type === "shelf" ? .72 : ridge ? .3 : .43;
        const power = water ? .56 : ridge ? .78 : .95;
        const speed = Math.hypot(car.vx, car.vy);

        if (controls.throttle > 0) {
            const force = 230 / (car.mass / 1540) * controls.throttle * power;
            car.vx += Math.sin(car.heading) * force * delta;
            car.vy += Math.cos(car.heading) * force * delta;
        }
        if (controls.brake > 0 && speed > 1) {
            const next = Math.max(0, speed - 235 * grip * controls.brake * delta);
            car.vx *= next / speed;
            car.vy *= next / speed;
        }

        car.heading += controls.steering * clamp(speed / 68, .14, 1) * (1.05 + grip * .8) * delta;
        const forwardX = Math.sin(car.heading);
        const forwardY = Math.cos(car.heading);
        const longitudinal = car.vx * forwardX + car.vy * forwardY;
        const lateral = (car.vx * forwardY - car.vy * forwardX) * Math.pow(Math.max(.08, 1 - grip * 3.1 * delta), 1);
        car.vx = forwardX * longitudinal + forwardY * lateral;
        car.vy = forwardY * longitudinal - forwardX * lateral;

        if (support && support.plate) {
            const plate = support.plate;
            const dx = car.x - plate.x;
            const dy = car.y - plate.y;
            car.x += plate.vx * delta;
            car.y += plate.vy * delta;
            const turn = plate.angleVelocity * delta;
            const cosine = Math.cos(turn);
            const sine = Math.sin(turn);
            car.x = plate.x + dx * cosine + dy * sine;
            car.y = plate.y - dx * sine + dy * cosine;
            car.heading += turn;
            car.supportId = `plate-${plate.id}`;
            car.flood = Math.max(0, car.flood - delta * 4.5);
        } else if (support && support.shelf) {
            car.supportId = `shelf-${support.shelf.id}`;
            car.flood = Math.max(0, car.flood - delta * 6);
        } else {
            car.supportId = "water";
            car.flood += delta * (.82 + clamp(car.speed / 360, 0, .4));
            car.vx += Math.sin(car.y / 620 + world.time * .2) * 14 * delta;
            car.vy -= 10 * delta;
            if (seeded(car.number + Math.floor(world.time * 12), 23) > .8) addParticle(car.x, car.y, "water", 1);
        }

        const maximum = water ? 220 : ridge ? 315 : 410;
        const driven = Math.hypot(car.vx, car.vy);
        if (driven > maximum) {
            car.vx *= maximum / driven;
            car.vy *= maximum / driven;
        }
        const rolling = water ? .975 : ridge ? .984 : .994;
        car.vx *= Math.pow(rolling, delta * 60);
        car.vy *= Math.pow(rolling, delta * 60);
        car.x += car.vx * delta;
        car.y += car.vy * delta;
        car.speed = Math.hypot(car.vx, car.vy);

        if (Math.abs(car.x) > FIELD_WIDTH * .5 + 240) {
            car.x = Math.sign(car.x) * (FIELD_WIDTH * .5 + 240);
            car.vx *= -.18;
        }
        if (car.flood > 4.6) {
            eliminate(car, "Open lead exceeded recovery window");
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
                    first.vx += relative * nx * .52;
                    first.vy += relative * ny * .52;
                    second.vx -= relative * nx * .52;
                    second.vy -= relative * ny * .52;
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
            world.detail = car.finishPosition === 1 ? "First onto the north station" : `Finished P${car.finishPosition}`;
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
        triggerFractures(delta);
        updatePlates(delta);
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
            ? Math.min((world.width - 80) / (FIELD_WIDTH + 520), (world.height - 70) / (FIELD_LENGTH + 280))
            : world.scale;
    }

    function point(x, y) {
        const scale = activeScale();
        return { x: world.width * .5 + x * scale, y: world.height * .68 - (y - world.cameraY) * scale };
    }

    function plateCorners(plate) {
        const halfWidth = plate.width * .5;
        const halfLength = plate.length * .5;
        const irregular = 14 + plate.notch * 16;
        return [
            [-halfWidth + irregular, -halfLength], [halfWidth - irregular * .4, -halfLength + irregular * .3],
            [halfWidth, -halfLength * .12], [halfWidth - irregular * .2, halfLength - irregular],
            [halfWidth * .2, halfLength], [-halfWidth + irregular * .3, halfLength - irregular * .25],
            [-halfWidth, halfLength * .08]
        ];
    }

    function drawSea() {
        context.fillStyle = "#0c1316";
        context.fillRect(0, 0, world.width, world.height);
        const scale = activeScale();
        const left = world.width * .5 - FIELD_WIDTH * .5 * scale;
        const right = world.width * .5 + FIELD_WIDTH * .5 * scale;
        context.fillStyle = "#17313a";
        context.fillRect(left - 300 * scale, 0, right - left + 600 * scale, world.height);
        context.strokeStyle = "rgba(125,178,190,.14)";
        context.lineWidth = Math.max(1, 2 * scale);
        context.setLineDash([18 * scale, 24 * scale]);
        for (let lane = -6; lane <= 6; lane += 1) {
            const x = lane * 145 + Math.sin(world.time * .08 + lane) * 28;
            const sx = point(x, 0).x;
            context.beginPath();
            context.moveTo(sx, 0);
            context.lineTo(sx + Math.sin(world.time * .1 + lane) * 45, world.height);
            context.stroke();
        }
        context.setLineDash([]);

        shelves.forEach((shelf) => {
            const p = point(shelf.x, shelf.y);
            context.fillStyle = "rgba(0,0,0,.34)";
            context.fillRect(p.x - shelf.width * scale * .5 + 8, p.y - shelf.length * scale * .5 + 9, shelf.width * scale, shelf.length * scale);
            context.fillStyle = "#b8c7c8";
            context.fillRect(p.x - shelf.width * scale * .5, p.y - shelf.length * scale * .5, shelf.width * scale, shelf.length * scale);
            context.strokeStyle = "rgba(237,244,241,.5)";
            context.lineWidth = Math.max(1, 4 * scale);
            context.strokeRect(p.x - shelf.width * scale * .5, p.y - shelf.length * scale * .5, shelf.width * scale, shelf.length * scale);
            context.fillStyle = "#273337";
            context.font = `600 ${Math.max(6, 8 * scale)}px General Sans`;
            context.textAlign = "center";
            context.fillText(shelf.label.toUpperCase(), p.x, p.y + 3);
        });

        const finish = point(0, FIELD_LENGTH);
        context.fillStyle = "#eef2ee";
        context.fillRect(left, finish.y - 8, right - left, 16);
    }

    function drawPlate(plate) {
        const p = point(plate.x, plate.y);
        const scale = activeScale();
        const corners = plateCorners(plate);
        if (p.y < -520 || p.y > world.height + 520) return;
        context.save();
        context.translate(p.x, p.y);
        context.rotate(plate.angle);
        context.fillStyle = "rgba(0,0,0,.35)";
        context.beginPath();
        corners.forEach((corner, index) => {
            const x = corner[0] * scale + 7;
            const y = corner[1] * scale + 9;
            if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.closePath();
        context.fill();
        context.fillStyle = plate.released ? "#9fb5b8" : "#b5c5c6";
        context.beginPath();
        corners.forEach((corner, index) => {
            const x = corner[0] * scale;
            const y = corner[1] * scale;
            if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.closePath();
        context.fill();
        context.strokeStyle = plate.released ? "rgba(212,229,228,.58)" : "rgba(235,243,239,.72)";
        context.lineWidth = Math.max(1, 3 * scale);
        context.stroke();
        context.strokeStyle = "rgba(83,126,134,.25)";
        context.lineWidth = Math.max(1, 2 * scale);
        context.beginPath();
        context.moveTo(-plate.width * scale * .34, -plate.length * scale * .26);
        context.lineTo(plate.width * scale * .2, plate.length * scale * .11);
        context.lineTo(-plate.width * scale * .12, plate.length * scale * .31);
        context.stroke();
        context.restore();
    }

    function drawFractures() {
        const scale = activeScale();
        fractures.forEach((fracture) => {
            if (fracture.state === "stable") return;
            const y = point(0, fracture.y).y;
            if (y < -80 || y > world.height + 80) return;
            const extent = fracture.state === "cracking" ? FIELD_WIDTH * fracture.progress : FIELD_WIDTH;
            const left = world.width * .5 - extent * scale * .5;
            const right = world.width * .5 + extent * scale * .5;
            context.strokeStyle = fracture.state === "cracking" ? "rgba(238,246,242,.95)" : "rgba(45,93,104,.76)";
            context.lineWidth = Math.max(2, (fracture.state === "cracking" ? 7 : 4) * scale);
            context.beginPath();
            context.moveTo(left, y);
            const segments = 14;
            for (let index = 1; index <= segments; index += 1) {
                const x = lerp(left, right, index / segments);
                const offset = (seeded(fracture.row * 20 + index, 5) - .5) * 38 * scale;
                context.lineTo(x, y + offset);
            }
            context.stroke();
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
        context.fillStyle = "rgba(0,0,0,.34)";
        context.fillRect(-16 * scale + 4, -29 * scale + 6, 32 * scale, 58 * scale);
        context.fillStyle = car.flash > 0 ? "#ecede5" : car.colour;
        context.fillRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.fillStyle = "#202729";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 21 * scale);
        context.strokeStyle = car.isPlayer ? "#f0dda0" : "rgba(236,239,233,.56)";
        context.lineWidth = car.isPlayer ? 2 : 1;
        context.strokeRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const p = point(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1) * .6;
            if (particle.type === "ice") {
                context.fillStyle = "#dce7e5";
                context.fillRect(p.x - particle.radius * .5, p.y - particle.radius * .5, particle.radius, particle.radius);
            } else {
                context.strokeStyle = "#8ec0c8";
                context.lineWidth = 1;
                context.beginPath();
                context.arc(p.x, p.y, particle.radius * activeScale(), 0, TAU);
                context.stroke();
            }
        });
        context.globalAlpha = 1;
    }

    function drawWaterWarning() {
        if (player.flood <= 0 || world.overview) return;
        const ratio = clamp(player.flood / 4.6, 0, 1);
        context.strokeStyle = `rgba(137,202,214,${.25 + ratio * .55})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(world.width * .5, world.height * .68, 34 + ratio * 30, 0, TAU);
        context.stroke();
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 4) - .5) * world.shake * 8;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, 0);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawSea();
        plates.slice().sort((first, second) => first.y - second.y).forEach(drawPlate);
        drawFractures();
        allCars().slice().sort((first, second) => second.y - first.y).forEach(drawCar);
        drawParticles();
        drawWaterWarning();
        if (world.result !== "racing") {
            context.fillStyle = "rgba(4,8,10,.73)";
            context.fillRect(0, 0, world.width, world.height);
            context.fillStyle = world.result === "finished" ? "#edf1ed" : "#8dc0c8";
            context.font = "500 40px Clash Display";
            context.textAlign = "center";
            context.fillText(world.result === "finished" ? "NORTH STATION REACHED" : "VEHICLE LOST IN LEAD", world.width * .5, world.height * .5);
        }
    }

    function nearestFracture(car) {
        const ahead = fractures.filter((fracture) => fracture.y >= car.y - 150);
        return ahead.length ? ahead[0] : fractures[fractures.length - 1];
    }

    function updateReadouts() {
        const support = supportAt(player.x, player.y);
        const fracture = nearestFracture(player);
        const separated = fractures.filter((entry) => entry.state === "separated").length;
        const cracking = fractures.filter((entry) => entry.state === "cracking").length;
        const rotating = plates.filter((plate) => plate.released && Math.abs(plate.angle) > .03).length;
        const separation = fractureSeparation(fracture);
        const maxSeparation = fractures.reduce((maximum, entry) => Math.max(maximum, fractureSeparation(entry)), 0);
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        supportReadout.textContent = support ? support.type === "shelf" ? support.shelf.label : `Plate ${String(support.plate.id + 1).padStart(2, "0")}${support.ridge ? " / ridge" : ""}` : `Open lead / ${Math.max(0, 4.6 - player.flood).toFixed(1)} s`;
        fractureReadout.textContent = `Band ${String(fracture.number).padStart(2, "0")} / ${fracture.state}`;
        speedReadout.textContent = `${Math.round(player.speed * .36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? "Shelf active" : world.detail;
        separationReadout.textContent = `${Math.round(separation)} m`;
        separationBar.style.width = `${clamp(separation / 420 * 100, 0, 100)}%`;
        separationCopy.textContent = fracture.state === "stable" ? "Thermal line has not released" : fracture.state === "cracking" ? "Bright crack propagating across shelf" : "Detached plates continue moving apart";
        crackStatus.textContent = cracking ? `${cracking} fracture line${cracking === 1 ? "" : "s"} active` : separated ? `${separated} bands released` : "First band dormant";
        plateStatus.textContent = `${plates.length - separated * COLUMNS} connected / ${separated * COLUMNS} drifting`;
        rotationStatus.textContent = rotating ? `${rotating} plates rotating` : "No rotation detected";
        leadStatus.textContent = separated ? `${Math.round(maxSeparation)} m maximum drift` : "Water gaps closed";
        ridgeStatus.textContent = support && support.ridge ? "Player crossing pressure ridge" : "Seams compressed";
        finishStatus.textContent = world.finishers || world.eliminated ? `${world.finishers} finished / ${world.eliminated} lost` : "North station visible";
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
            if (button.dataset.driftlineControl === name) button.classList.toggle("is-pressed", active);
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
        const name = button.dataset.driftlineControl;
        const down = (event) => { event.preventDefault(); setControl(name, true); };
        const up = (event) => { event.preventDefault(); setControl(name, false); };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
    });
    resetButton.addEventListener("click", reset);
    overviewButton.addEventListener("click", () => {
        world.overview = !world.overview;
        overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey shelf";
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

    window.driftline = {
        resize,
        reset,
        setControl,
        diagnostics: () => {
            const support = supportAt(player.x, player.y);
            const target = bestPlateAhead(player);
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
                    flood: player.flood,
                    support: support ? support.id : "water",
                    ridge: Boolean(support && support.ridge),
                    routeTarget: target ? target.x : 0,
                    routeTargetY: target ? target.y : FIELD_LENGTH
                },
                finishers: world.finishers,
                eliminated: world.eliminated,
                activeRivals: rivals.filter((car) => car.active && !car.finished && !car.eliminated).length,
                stableFractures: fractures.filter((fracture) => fracture.state === "stable").length,
                crackingFractures: fractures.filter((fracture) => fracture.state === "cracking").length,
                separatedFractures: fractures.filter((fracture) => fracture.state === "separated").length,
                movingPlates: plates.filter((plate) => plate.released).length,
                maxSeparation: fractures.reduce((maximum, fracture) => Math.max(maximum, fractureSeparation(fracture)), 0),
                maxRotation: plates.reduce((maximum, plate) => Math.max(maximum, Math.abs(plate.angle)), 0),
                plates: plates.length
            };
        }
    };

    requestAnimationFrame(animate);
})();
