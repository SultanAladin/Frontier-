"use strict";

(() => {
    const canvas = document.getElementById("paper-coast-canvas");
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("paper-coast");
    const resetButton = document.getElementById("paper-coast-reset");
    const overviewButton = document.getElementById("paper-coast-overview");
    const positionReadout = document.getElementById("paper-coast-position-readout");
    const supportReadout = document.getElementById("paper-coast-support-readout");
    const stateReadout = document.getElementById("paper-coast-state-readout");
    const speedReadout = document.getElementById("paper-coast-speed-readout");
    const resultReadout = document.getElementById("paper-coast-result-readout");
    const transferReadout = document.getElementById("paper-coast-transfer-readout");
    const transferBar = document.getElementById("paper-coast-transfer-bar");
    const transferCopy = document.getElementById("paper-coast-transfer-copy");
    const flowStatus = document.getElementById("paper-coast-flow-status");
    const alignStatus = document.getElementById("paper-coast-align-status");
    const detachStatus = document.getElementById("paper-coast-detach-status");
    const transferStatus = document.getElementById("paper-coast-transfer-status");
    const logStatus = document.getElementById("paper-coast-log-status");
    const finishStatus = document.getElementById("paper-coast-finish-status");
    const buttons = Array.from(document.querySelectorAll("[data-paper-coast-control]"));

    const FIELD_WIDTH = 1700;
    const FIELD_LENGTH = 7600;
    const STARTERS = 24;
    const CAR_RADIUS = 22;
    const CYCLE_LENGTH = 14;
    const TAU = Math.PI * 2;
    const input = { throttle: false, brake: false, left: false, right: false };
    const colours = ["#7c817b", "#896d59", "#667b77", "#8c826a", "#979181", "#68716b", "#8c604e"];
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
        detail: "Release active",
        finishers: 0,
        eliminated: 0,
        wrappedTimber: 0,
        shake: 0,
        particles: [],
        wasVisible: false
    };

    const docks = [
        { number: 0, x: 0, y: 0, width: 720, length: 300, label: "South dock" },
        { number: 1, x: -330, y: 1120, width: 370, length: 230, label: "Dock 01" },
        { number: 2, x: 325, y: 2200, width: 360, length: 230, label: "Dock 02" },
        { number: 3, x: -305, y: 3280, width: 370, length: 230, label: "Dock 03" },
        { number: 4, x: 350, y: 4370, width: 365, length: 230, label: "Dock 04" },
        { number: 5, x: -275, y: 5460, width: 370, length: 230, label: "Dock 05" },
        { number: 6, x: 285, y: 6540, width: 365, length: 230, label: "Dock 06" },
        { number: 7, x: 0, y: FIELD_LENGTH, width: 720, length: 320, label: "Mill gate" }
    ];

    const player = createCar(42, -70, true, 17);
    let rivals = [];
    let timber = [];

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

    function seeded(index, salt = 0) {
        const sample = Math.sin(index * 92.71 + salt * 45.37) * 43758.5453;
        return sample - Math.floor(sample);
    }

    function wrapAngle(angle) {
        let wrapped = angle;
        while (wrapped > Math.PI) wrapped -= TAU;
        while (wrapped < -Math.PI) wrapped += TAU;
        return wrapped;
    }

    function routeX(y) {
        if (y <= docks[0].y) return docks[0].x;
        for (let index = 1; index < docks.length; index += 1) {
            if (y <= docks[index].y) {
                const previous = docks[index - 1];
                const next = docks[index];
                const ratio = (y - previous.y) / (next.y - previous.y);
                return lerp(previous.x, next.x, smooth(ratio));
            }
        }
        return docks[docks.length - 1].x;
    }

    function createCar(x, y, isPlayer, number) {
        return {
            x, y,
            vx: 0, vy: 0,
            heading: 0,
            speed: 0,
            isPlayer,
            number,
            colour: isPlayer ? "#c4a24b" : colours[number % colours.length],
            mass: isPlayer ? 1540 : 1250 + seeded(number, 3) * 840,
            aggression: .3 + seeded(number, 7) * .66,
            active: true,
            finished: false,
            eliminated: false,
            finishPosition: 0,
            flash: 0,
            spin: 0,
            sink: 0,
            supportId: "dock-0",
            targetX: x,
            reason: ""
        };
    }

    function createTimber(index) {
        const type = index % 4 === 0 ? "log" : "plank";
        const y = 245 + index * (FIELD_LENGTH - 300) / 47;
        const group = Math.floor(index / 4);
        const offsetChoice = [-150, 125, -65, 165][group % 4];
        return {
            id: index,
            type,
            group,
            x: routeX(y) + (seeded(index, 4) - .5) * 270,
            y,
            angle: (seeded(index, 6) - .5) * .62,
            length: type === "log" ? 250 + seeded(index, 8) * 55 : 270 + seeded(index, 8) * 65,
            width: type === "log" ? 58 : 96 + seeded(index, 10) * 22,
            flowSpeed: 38 + seeded(index, 12) * 19,
            phase: seeded(group, 14) * CYCLE_LENGTH + (index % 4) * .08,
            chainOffset: offsetChoice,
            freeBias: (seeded(index, 17) - .5) * 360,
            angularVelocity: (seeded(index, 19) - .5) * .22,
            vx: 0,
            vy: 0,
            angleVelocity: 0,
            state: "free",
            local: 0,
            generation: 0
        };
    }

    function allCars() {
        return [player, ...rivals];
    }

    function activeCars() {
        return allCars().filter((car) => car.active && !car.finished && !car.eliminated);
    }

    function reset() {
        Object.assign(player, createCar(42, -70, true, 17));
        rivals = [];
        for (let index = 0; index < STARTERS - 1; index += 1) {
            const lane = index % 8;
            const row = Math.floor(index / 8);
            rivals.push(createCar(-560 + lane * 160 + (seeded(index, 2) - .5) * 20, -row * 73 + (seeded(index, 5) - .5) * 14, false, index + 1));
        }
        timber = Array.from({ length: 48 }, (_, index) => createTimber(index));
        Object.assign(world, {
            time: 0,
            cameraY: 390,
            cameraV: 0,
            overview: false,
            result: "racing",
            detail: "Release active",
            finishers: 0,
            eliminated: 0,
            wrappedTimber: 0,
            shake: 0
        });
        world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey basin";
        updateReadouts();
        render();
    }

    function timberCycle(piece) {
        const local = ((world.time + piece.phase) % CYCLE_LENGTH + CYCLE_LENGTH) % CYCLE_LENGTH;
        let state;
        let progress;
        if (local < 2.5) {
            state = "free";
            progress = local / 2.5;
        } else if (local < 4.2) {
            state = "aligning";
            progress = (local - 2.5) / 1.7;
        } else if (local < 8.2) {
            state = "aligned";
            progress = (local - 4.2) / 4;
        } else if (local < 10.1) {
            state = "detaching";
            progress = (local - 8.2) / 1.9;
        } else {
            state = "free";
            progress = (local - 10.1) / 3.9;
        }
        return { local, state, progress };
    }

    function updateTimber(delta) {
        timber.forEach((piece) => {
            const beforeX = piece.x;
            const beforeAngle = piece.angle;
            const cycle = timberCycle(piece);
            piece.state = cycle.state;
            piece.local = cycle.local;
            piece.y -= piece.flowSpeed * delta;

            if (cycle.state === "aligning" || cycle.state === "aligned") {
                const targetX = routeX(piece.y) + piece.chainOffset;
                const strength = cycle.state === "aligned" ? 4.8 : 2.1 + cycle.progress * 2.2;
                piece.x += (targetX - piece.x) * Math.min(1, delta * strength);
                piece.angle += wrapAngle(0 - piece.angle) * Math.min(1, delta * strength * 1.25);
                piece.angularVelocity *= Math.pow(.04, delta);
            } else if (cycle.state === "detaching") {
                const direction = piece.id % 2 ? 1 : -1;
                piece.angularVelocity += direction * delta * (.17 + cycle.progress * .25);
                piece.angle += piece.angularVelocity * delta;
                piece.x += direction * (18 + cycle.progress * 42) * delta;
            } else {
                const targetX = routeX(piece.y) + piece.freeBias + Math.sin(world.time * .31 + piece.id) * 90;
                piece.x += (targetX - piece.x) * Math.min(1, delta * .38);
                piece.angle += piece.angularVelocity * delta;
                piece.angularVelocity += Math.sin(world.time * .18 + piece.id) * delta * .012;
                piece.angularVelocity = clamp(piece.angularVelocity, -.38, .38);
            }

            const halfWidth = piece.length * .5;
            piece.x = clamp(piece.x, -FIELD_WIDTH * .5 + halfWidth * .25, FIELD_WIDTH * .5 - halfWidth * .25);
            piece.vx = (piece.x - beforeX) / Math.max(.001, delta);
            piece.vy = -piece.flowSpeed;
            piece.angleVelocity = wrapAngle(piece.angle - beforeAngle) / Math.max(.001, delta);

            if (piece.y < -560) {
                piece.y += FIELD_LENGTH + 1180;
                piece.x = routeX(piece.y) + (seeded(piece.id + piece.generation * 11, 23) - .5) * 340;
                piece.angle = (seeded(piece.id + piece.generation * 7, 29) - .5) * .8;
                piece.generation += 1;
                world.wrappedTimber += 1;
            }
        });
    }

    function localCoordinates(x, y, piece) {
        const dx = x - piece.x;
        const dy = y - piece.y;
        const forwardX = Math.sin(piece.angle);
        const forwardY = Math.cos(piece.angle);
        const sideX = Math.cos(piece.angle);
        const sideY = -Math.sin(piece.angle);
        return {
            longitudinal: dx * forwardX + dy * forwardY,
            lateral: dx * sideX + dy * sideY
        };
    }

    function dockAt(x, y) {
        return docks.find((dock) => Math.abs(x - dock.x) <= dock.width * .5 && Math.abs(y - dock.y) <= dock.length * .5) || null;
    }

    function timberAt(x, y, margin = 0) {
        let best = null;
        timber.forEach((piece) => {
            const local = localCoordinates(x, y, piece);
            if (Math.abs(local.longitudinal) > piece.length * .5 + margin || Math.abs(local.lateral) > piece.width * .5 + margin) return;
            if (!best || Math.abs(local.lateral) < best.distance) best = { piece, local, distance: Math.abs(local.lateral) };
        });
        return best ? best.piece : null;
    }

    function supportAt(x, y) {
        const dock = dockAt(x, y);
        if (dock) return { type: "dock", dock, id: `dock-${dock.number}` };
        const piece = timberAt(x, y, 5);
        if (piece) return { type: piece.type, piece, id: `timber-${piece.id}` };
        return null;
    }

    function nextDock(car) {
        return docks.find((dock) => dock.y > car.y + 95) || docks[docks.length - 1];
    }

    function bestTimberAhead(car) {
        let best = null;
        let score = Infinity;
        timber.forEach((piece) => {
            const dy = piece.y - car.y;
            if (dy < 35 || dy > 510) return;
            const stateBonus = piece.state === "aligned" ? -150 : piece.state === "aligning" ? -75 : piece.state === "detaching" ? 90 : 35;
            const candidate = dy + Math.abs(piece.x - car.x) * .62 + stateBonus;
            if (candidate < score) {
                score = candidate;
                best = piece;
            }
        });
        return best;
    }

    function artificialDriver(car) {
        const support = supportAt(car.x, car.y);
        const next = nextDock(car);
        const piece = bestTimberAhead(car);
        let targetX = routeX(car.y + 360);
        if (piece) targetX = piece.x;
        if (next.y - car.y < 430) targetX = next.x;
        if (!support) targetX = piece ? piece.x : next.x;
        targetX = clamp(targetX, -FIELD_WIDTH * .5 + 45, FIELD_WIDTH * .5 - 45);
        car.targetX = targetX;
        const desired = Math.atan2(targetX - car.x, 350);
        const error = wrapAngle(desired - car.heading);
        return {
            throttle: car.sink > 1.4 ? 1 : .84 + car.aggression * .14,
            brake: support && support.type === "log" && Math.abs(error) > .55 ? .12 : 0,
            steering: clamp(error * 2.2 - car.spin * .18, -1, 1)
        };
    }

    function addParticle(x, y, type, count = 1) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(index + world.time * 160, x + y) * TAU;
            const speed = 10 + seeded(index, y) * 48;
            world.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 16,
                radius: 4 + seeded(index, 9) * 10,
                life: .65 + seeded(index, 12) * 1.1,
                maxLife: 1.75,
                type
            });
        }
        if (world.particles.length > 320) world.particles.splice(0, world.particles.length - 320);
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished || car.eliminated) return;
        car.flash = Math.max(0, car.flash - delta * 3.6);
        car.spin *= Math.pow(.06, delta);
        car.heading += car.spin * delta;
        const support = supportAt(car.x, car.y);
        const onWater = !support;
        const onLog = support && support.type === "log";
        const grip = onWater ? .28 : onLog ? .5 : support.type === "dock" ? .95 : .8;
        const power = onWater ? .66 : onLog ? .76 : .96;
        const speed = Math.hypot(car.vx, car.vy);

        if (controls.throttle > 0) {
            const force = 232 / (car.mass / 1540) * controls.throttle * power;
            car.vx += Math.sin(car.heading) * force * delta;
            car.vy += Math.cos(car.heading) * force * delta;
        }
        if (controls.brake > 0 && speed > 1) {
            const next = Math.max(0, speed - 255 * grip * controls.brake * delta);
            car.vx *= next / speed;
            car.vy *= next / speed;
        }

        car.heading += controls.steering * clamp(speed / 65, .15, 1) * (1.22 + grip * .7) * delta;
        const forwardX = Math.sin(car.heading);
        const forwardY = Math.cos(car.heading);
        const longitudinal = car.vx * forwardX + car.vy * forwardY;
        const lateral = (car.vx * forwardY - car.vy * forwardX) * Math.pow(Math.max(.04, 1 - grip * 4.2 * delta), 1);
        car.vx = forwardX * longitudinal + forwardY * lateral;
        car.vy = forwardY * longitudinal - forwardX * lateral;

        if (support && support.piece) {
            const piece = support.piece;
            const dx = car.x - piece.x;
            const dy = car.y - piece.y;
            car.x += piece.vx * delta;
            car.y += piece.vy * delta;
            const turn = piece.angleVelocity * delta * .68;
            const cosine = Math.cos(turn);
            const sine = Math.sin(turn);
            car.x = piece.x + dx * cosine + dy * sine;
            car.y = piece.y - dx * sine + dy * cosine;
            car.heading += turn;
            if (piece.type === "log") {
                const local = localCoordinates(car.x, car.y, piece);
                const roll = clamp(Math.abs(local.lateral) / Math.max(1, piece.width * .5), 0, 1);
                car.vx += Math.sign(local.lateral || 1) * roll * 30 * delta;
                car.spin += Math.sign(local.lateral || 1) * roll * delta * .38;
            }
            car.supportId = `timber-${piece.id}`;
            car.sink = Math.max(0, car.sink - delta * 8.5);
        } else if (support && support.dock) {
            car.supportId = `dock-${support.dock.number}`;
            car.sink = Math.max(0, car.sink - delta * 10);
        } else {
            car.supportId = "water";
            car.sink += delta * (.78 + clamp(car.speed / 340, 0, .45));
            car.vx += Math.sin(car.y / 510 + world.time * .32) * 18 * delta;
            car.vy -= 14 * delta;
            if (seeded(car.number + Math.floor(world.time * 12), 21) > .77) addParticle(car.x, car.y, "water", 1);
        }

        const maximum = onWater ? 205 : onLog ? 330 : 405;
        const driven = Math.hypot(car.vx, car.vy);
        if (driven > maximum) {
            car.vx *= maximum / driven;
            car.vy *= maximum / driven;
        }
        const rolling = onWater ? .979 : onLog ? .982 : .99;
        car.vx *= Math.pow(rolling, delta * 60);
        car.vy *= Math.pow(rolling, delta * 60);
        car.x += car.vx * delta;
        car.y += car.vy * delta;
        car.speed = Math.hypot(car.vx, car.vy);

        if (Math.abs(car.x) > FIELD_WIDTH * .5 - 28) {
            const side = Math.sign(car.x);
            car.x = side * (FIELD_WIDTH * .5 - 28);
            car.vx *= -.2;
            car.flash = 1;
        }
        if (car.sink > 8.6) {
            eliminate(car, "Timber detached before transfer");
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
                    first.vx += relative * nx * .54;
                    first.vy += relative * ny * .54;
                    second.vx -= relative * nx * .54;
                    second.vy -= relative * ny * .54;
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
            world.detail = car.finishPosition === 1 ? "First into the mill gate" : `Finished P${car.finishPosition}`;
        }
    }

    function updateParticles(delta) {
        world.particles.forEach((particle) => {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(.13, delta);
            particle.vy *= Math.pow(.13, delta);
            particle.radius += delta * 5;
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
        updateTimber(delta);
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
            ? Math.min((world.width - 80) / (FIELD_WIDTH + 180), (world.height - 70) / (FIELD_LENGTH + 250))
            : world.scale;
    }

    function point(x, y) {
        const scale = activeScale();
        return { x: world.width * .5 + x * scale, y: world.height * .68 - (y - world.cameraY) * scale };
    }

    function drawBasin() {
        context.fillStyle = "#111514";
        context.fillRect(0, 0, world.width, world.height);
        const scale = activeScale();
        const left = world.width * .5 - FIELD_WIDTH * .5 * scale;
        const right = world.width * .5 + FIELD_WIDTH * .5 * scale;
        context.fillStyle = "#2e4b4d";
        context.fillRect(left, 0, right - left, world.height);
        context.fillStyle = "#4d4a39";
        context.fillRect(left - 80 * scale, 0, 80 * scale, world.height);
        context.fillRect(right, 0, 80 * scale, world.height);

        context.strokeStyle = "rgba(146,184,181,.18)";
        context.lineWidth = Math.max(1, 3 * scale);
        context.setLineDash([24 * scale, 18 * scale]);
        for (let lane = -5; lane <= 5; lane += 1) {
            const x = lane * 145 + Math.sin(world.time * .18 + lane) * 20;
            const screenX = point(x, 0).x;
            context.beginPath();
            context.moveTo(screenX, -40);
            context.lineTo(screenX, world.height + 40);
            context.stroke();
        }
        context.setLineDash([]);

        docks.forEach((dock) => {
            const p = point(dock.x, dock.y);
            context.fillStyle = "rgba(0,0,0,.34)";
            context.fillRect(p.x - dock.width * scale * .5 + 7, p.y - dock.length * scale * .5 + 8, dock.width * scale, dock.length * scale);
            context.fillStyle = dock.number === 0 || dock.number === docks.length - 1 ? "#8a7655" : "#75654b";
            context.fillRect(p.x - dock.width * scale * .5, p.y - dock.length * scale * .5, dock.width * scale, dock.length * scale);
            context.strokeStyle = "rgba(213,191,148,.38)";
            context.lineWidth = Math.max(1, 3 * scale);
            for (let board = -dock.width * .45; board < dock.width * .5; board += 42) {
                context.beginPath();
                context.moveTo(p.x + board * scale, p.y - dock.length * scale * .5);
                context.lineTo(p.x + board * scale, p.y + dock.length * scale * .5);
                context.stroke();
            }
            context.fillStyle = "#e1d7bd";
            context.font = `600 ${Math.max(6, 8 * scale)}px General Sans`;
            context.textAlign = "center";
            context.fillText(dock.label.toUpperCase(), p.x, p.y + 3);
        });

        const finish = point(0, FIELD_LENGTH);
        context.fillStyle = "#e2dccb";
        context.fillRect(left, finish.y - 8, right - left, 16);
    }

    function drawChainConnections() {
        const scale = activeScale();
        const groups = new Map();
        timber.filter((piece) => piece.state === "aligned" || piece.state === "aligning").forEach((piece) => {
            if (!groups.has(piece.group)) groups.set(piece.group, []);
            groups.get(piece.group).push(piece);
        });
        context.strokeStyle = "rgba(213,183,124,.36)";
        context.lineWidth = Math.max(1, 4 * scale);
        context.setLineDash([7 * scale, 5 * scale]);
        groups.forEach((pieces) => {
            pieces.sort((first, second) => first.y - second.y);
            for (let index = 1; index < pieces.length; index += 1) {
                const a = point(pieces[index - 1].x, pieces[index - 1].y);
                const b = point(pieces[index].x, pieces[index].y);
                context.beginPath();
                context.moveTo(a.x, a.y);
                context.lineTo(b.x, b.y);
                context.stroke();
            }
        });
        context.setLineDash([]);
    }

    function drawTimber(piece) {
        const p = point(piece.x, piece.y);
        const scale = activeScale();
        if (p.y < -180 || p.y > world.height + 180) return;
        context.save();
        context.translate(p.x, p.y);
        context.rotate(piece.angle);
        context.fillStyle = "rgba(0,0,0,.34)";
        if (piece.type === "log") {
            context.beginPath();
            context.roundRect(-piece.width * scale * .5 + 5, -piece.length * scale * .5 + 7, piece.width * scale, piece.length * scale, piece.width * scale * .5);
            context.fill();
            context.fillStyle = "#765333";
            context.beginPath();
            context.roundRect(-piece.width * scale * .5, -piece.length * scale * .5, piece.width * scale, piece.length * scale, piece.width * scale * .5);
            context.fill();
            context.strokeStyle = "rgba(210,165,99,.4)";
            context.lineWidth = Math.max(1, 3 * scale);
            [-.22, .22].forEach((offset) => {
                context.beginPath();
                context.moveTo(offset * piece.width * scale, -piece.length * scale * .43);
                context.lineTo(offset * piece.width * scale, piece.length * scale * .43);
                context.stroke();
            });
        } else {
            context.fillRect(-piece.width * scale * .5 + 5, -piece.length * scale * .5 + 7, piece.width * scale, piece.length * scale);
            context.fillStyle = piece.state === "aligned" ? "#9b7749" : "#80613e";
            context.fillRect(-piece.width * scale * .5, -piece.length * scale * .5, piece.width * scale, piece.length * scale);
            context.strokeStyle = piece.state === "detaching" ? "#c17a50" : "rgba(224,190,128,.42)";
            context.lineWidth = Math.max(1, 3 * scale);
            context.strokeRect(-piece.width * scale * .5, -piece.length * scale * .5, piece.width * scale, piece.length * scale);
            context.strokeStyle = "rgba(52,41,29,.5)";
            context.lineWidth = Math.max(1, 2 * scale);
            [-.27, 0, .27].forEach((offset) => {
                context.beginPath();
                context.moveTo(offset * piece.width * scale, -piece.length * scale * .46);
                context.lineTo(offset * piece.width * scale, piece.length * scale * .46);
                context.stroke();
            });
        }
        if (piece.state === "detaching") {
            context.strokeStyle = "rgba(202,115,77,.8)";
            context.lineWidth = Math.max(1, 3 * scale);
            context.setLineDash([6 * scale, 5 * scale]);
            context.strokeRect(-piece.width * scale * .6, -piece.length * scale * .54, piece.width * scale * 1.2, piece.length * scale * 1.08);
            context.setLineDash([]);
        }
        context.restore();
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
        context.fillStyle = car.flash > 0 ? "#e7ddc5" : car.colour;
        context.fillRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.fillStyle = "#202524";
        context.fillRect(-11 * scale, -10 * scale, 22 * scale, 21 * scale);
        context.strokeStyle = car.isPlayer ? "#f0d99a" : "rgba(235,232,217,.5)";
        context.lineWidth = car.isPlayer ? 2 : 1;
        context.strokeRect(-16 * scale, -29 * scale, 32 * scale, 58 * scale);
        context.restore();
    }

    function drawParticles() {
        world.particles.forEach((particle) => {
            const p = point(particle.x, particle.y);
            context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1) * .42;
            context.strokeStyle = "#a7cbc7";
            context.lineWidth = 1;
            context.beginPath();
            context.arc(p.x, p.y, particle.radius * activeScale(), 0, TAU);
            context.stroke();
        });
        context.globalAlpha = 1;
    }

    function drawWaterWarning() {
        if (player.sink <= 0 || world.overview) return;
        const ratio = clamp(player.sink / 8.6, 0, 1);
        context.strokeStyle = `rgba(181,213,210,${.25 + ratio * .45})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(world.width * .5, world.height * .68, 35 + ratio * 28, 0, TAU);
        context.stroke();
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 4) - .5) * world.shake * 8;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, 0);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawBasin();
        drawChainConnections();
        timber.slice().sort((first, second) => first.y - second.y).forEach(drawTimber);
        allCars().slice().sort((first, second) => second.y - first.y).forEach(drawCar);
        drawParticles();
        drawWaterWarning();
        if (world.result !== "racing") {
            context.fillStyle = "rgba(5,8,8,.72)";
            context.fillRect(0, 0, world.width, world.height);
            context.fillStyle = world.result === "finished" ? "#eee7d8" : "#91b5b1";
            context.font = "500 40px Clash Display";
            context.textAlign = "center";
            context.fillText(world.result === "finished" ? "MILL GATE REACHED" : "TIMBER ROAD LOST", world.width * .5, world.height * .5);
        }
    }

    function nearestTimber(car) {
        return timber.reduce((best, piece) => {
            const distance = Math.hypot(car.x - piece.x, car.y - piece.y);
            const bestDistance = Math.hypot(car.x - best.x, car.y - best.y);
            return distance < bestDistance ? piece : best;
        }, timber[0]);
    }

    function updateReadouts() {
        const support = supportAt(player.x, player.y);
        const nearest = nearestTimber(player);
        const cycle = timberCycle(nearest);
        const aligned = timber.filter((piece) => piece.state === "aligned").length;
        const aligning = timber.filter((piece) => piece.state === "aligning").length;
        const detaching = timber.filter((piece) => piece.state === "detaching").length;
        const next = nextDock(player);
        let remaining;
        if (cycle.state === "aligned") remaining = 8.2 - cycle.local;
        else if (cycle.state === "aligning") remaining = 4.2 - cycle.local;
        else if (cycle.state === "detaching") remaining = 10.1 - cycle.local;
        else remaining = cycle.local < 2.5 ? 2.5 - cycle.local : CYCLE_LENGTH - cycle.local + 2.5;
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        supportReadout.textContent = support ? support.type === "dock" ? support.dock.label : `${support.type === "log" ? "Log" : "Plank"} ${String(support.piece.id + 1).padStart(2, "0")}` : `Open water / ${Math.max(0, 8.6 - player.sink).toFixed(1)} s`;
        stateReadout.textContent = support && support.piece ? support.piece.state : nearest.state;
        speedReadout.textContent = `${Math.round(player.speed * .36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? "Release active" : world.detail;
        transferReadout.textContent = `${remaining.toFixed(1)} s ${cycle.state}`;
        transferBar.style.width = `${clamp(cycle.local / CYCLE_LENGTH * 100, 0, 100)}%`;
        transferCopy.textContent = cycle.state === "aligned" ? "Nearest chain is temporarily driveable" : cycle.state === "aligning" ? "Current drawing neighboring timber together" : cycle.state === "detaching" ? "Transfer now — chain rotating apart" : "Detached pieces drifting independently";
        flowStatus.textContent = `${timber.length} pieces moving south`;
        alignStatus.textContent = `${aligned} aligned / ${aligning} forming`;
        detachStatus.textContent = `${detaching} pieces releasing`;
        transferStatus.textContent = `Next support ${next.x > player.x ? "east" : "west"}`;
        logStatus.textContent = `${timber.filter((piece) => piece.type === "log").length} logs in flow`;
        finishStatus.textContent = world.finishers || world.eliminated ? `${world.finishers} finished / ${world.eliminated} sunk` : "North dock receiving";
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
            if (button.dataset.paperCoastControl === name) button.classList.toggle("is-pressed", active);
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
        const name = button.dataset.paperCoastControl;
        const down = (event) => { event.preventDefault(); setControl(name, true); };
        const up = (event) => { event.preventDefault(); setControl(name, false); };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
    });
    resetButton.addEventListener("click", reset);
    overviewButton.addEventListener("click", () => {
        world.overview = !world.overview;
        overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey basin";
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

    window.paperCoast = {
        resize,
        reset,
        setControl,
        diagnostics: () => {
            const support = supportAt(player.x, player.y);
            const targetPiece = bestTimberAhead(player);
            const targetDock = nextDock(player);
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
                    sink: player.sink,
                    support: support ? support.id : "water",
                    routeTarget: routeX(player.y + 380),
                    transferTarget: targetPiece ? targetPiece.x : targetDock.x,
                    transferTargetY: targetPiece ? targetPiece.y : targetDock.y
                },
                finishers: world.finishers,
                eliminated: world.eliminated,
                activeRivals: rivals.filter((car) => car.active && !car.finished && !car.eliminated).length,
                aligned: timber.filter((piece) => piece.state === "aligned").length,
                aligning: timber.filter((piece) => piece.state === "aligning").length,
                detaching: timber.filter((piece) => piece.state === "detaching").length,
                free: timber.filter((piece) => piece.state === "free").length,
                wrappedTimber: world.wrappedTimber,
                planks: timber.filter((piece) => piece.type === "plank").length,
                logs: timber.filter((piece) => piece.type === "log").length
            };
        }
    };

    requestAnimationFrame(animate);
})();
