"use strict";

(() => {
    const canvas = document.getElementById("blind-monument-canvas");
    const mapCanvas = document.getElementById("blind-monument-map-canvas");
    if (!canvas || !mapCanvas) return;

    const context = canvas.getContext("2d", { alpha: false });
    const mapContext = mapCanvas.getContext("2d", { alpha: false });
    const page = document.getElementById("blind-monument");
    const resetButton = document.getElementById("blind-monument-reset");
    const overviewButton = document.getElementById("blind-monument-overview");
    const positionReadout = document.getElementById("blind-monument-position-readout");
    const exitReadout = document.getElementById("blind-monument-exit-readout");
    const systemReadout = document.getElementById("blind-monument-system-readout");
    const speedReadout = document.getElementById("blind-monument-speed-readout");
    const resultReadout = document.getElementById("blind-monument-result-readout");
    const openExitsReadout = document.getElementById("blind-monument-open-exits");
    const mapCopy = document.getElementById("blind-monument-map-copy");
    const shearStatus = document.getElementById("blind-monument-shear-status");
    const deadEndStatus = document.getElementById("blind-monument-dead-end-status");
    const exchangeStatus = document.getElementById("blind-monument-exchange-status");
    const rollerStatus = document.getElementById("blind-monument-roller-status");
    const compactorStatus = document.getElementById("blind-monument-compactor-status");
    const dustStatus = document.getElementById("blind-monument-dust-status");
    const exitStatus = document.getElementById("blind-monument-exit-status");
    const terrainStatus = document.getElementById("blind-monument-terrain-status");
    const controlButtons = Array.from(document.querySelectorAll("[data-blind-monument-control]"));

    const COLS = 16;
    const ROWS = 13;
    const CELL = 200;
    const ORIGIN_X = -COLS * CELL * 0.5;
    const ORIGIN_Y = -100;
    const TOP = ORIGIN_Y + ROWS * CELL;
    const STARTERS = 24;
    const CAR_RADIUS = 21;
    const WALL_HALF = 19;
    const TAU = Math.PI * 2;
    const exitColumns = [1, 5, 10, 14];
    const rivalColours = ["#8c9288", "#9a745b", "#687f7b", "#89816e", "#a09a86", "#6d7670", "#996650"];

    const input = { throttle: false, brake: false, left: false, right: false, touched: false };
    const world = {
        width: 1320,
        height: 940,
        dpr: 1,
        scale: 0.74,
        time: 0,
        lastTime: performance.now(),
        cameraX: 0,
        cameraY: 350,
        cameraVX: 0,
        cameraVY: 0,
        overview: false,
        result: "racing",
        detail: "Heat active",
        finishers: 0,
        eliminated: 0,
        shake: 0,
        particles: [],
        tracks: [],
        trackTimer: 0,
        mapTimer: 0,
        wasVisible: false
    };

    const openEdges = new Set();
    const tunnelEdges = new Set();
    const shortcutEdges = new Set();
    let staticWalls = [];
    let rivals = [];

    function cell(column, row) {
        return { column, row };
    }

    function cellKey(entry) {
        return `${entry.column},${entry.row}`;
    }

    function edgeKey(first, second) {
        const a = cellKey(first);
        const b = cellKey(second);
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    function cellCentre(entry) {
        return {
            x: ORIGIN_X + (entry.column + 0.5) * CELL,
            y: ORIGIN_Y + (entry.row + 0.5) * CELL
        };
    }

    function worldCell(x, y) {
        return {
            column: clamp(Math.floor((x - ORIGIN_X) / CELL), 0, COLS - 1),
            row: clamp(Math.floor((y - ORIGIN_Y) / CELL), 0, ROWS - 1)
        };
    }

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
        const number = Math.sin(index * 97.113 + salt * 41.731) * 43758.5453;
        return number - Math.floor(number);
    }

    function adjacent(entry) {
        return [
            cell(entry.column + 1, entry.row),
            cell(entry.column - 1, entry.row),
            cell(entry.column, entry.row + 1),
            cell(entry.column, entry.row - 1)
        ].filter((candidate) => candidate.column >= 0 && candidate.column < COLS && candidate.row >= 0 && candidate.row < ROWS);
    }

    function open(first, second) {
        openEdges.add(edgeKey(first, second));
    }

    function forcePath(points) {
        for (let index = 1; index < points.length; index += 1) open(points[index - 1], points[index]);
    }

    function constructMaze() {
        openEdges.clear();
        tunnelEdges.clear();
        shortcutEdges.clear();
        const visited = new Set();
        const stack = [cell(7, 0)];
        visited.add(cellKey(stack[0]));
        let step = 0;
        while (stack.length) {
            const current = stack[stack.length - 1];
            const choices = adjacent(current).filter((candidate) => !visited.has(cellKey(candidate)));
            if (!choices.length) {
                stack.pop();
                continue;
            }
            choices.sort((first, second) => seeded(step + first.column * 17 + first.row * 31, 2) - seeded(step + second.column * 17 + second.row * 31, 2));
            const next = choices[0];
            open(current, next);
            visited.add(cellKey(next));
            stack.push(next);
            step += 1;
        }

        const possible = [];
        for (let row = 0; row < ROWS; row += 1) {
            for (let column = 0; column < COLS; column += 1) {
                const here = cell(column, row);
                if (column + 1 < COLS) possible.push([here, cell(column + 1, row)]);
                if (row + 1 < ROWS) possible.push([here, cell(column, row + 1)]);
            }
        }
        possible.sort((first, second) => seeded(first[0].column * 13 + first[0].row * 29, 5) - seeded(second[0].column * 13 + second[0].row * 29, 5));
        possible.slice(0, 48).forEach(([first, second]) => open(first, second));

        forcePath(Array.from({ length: 8 }, (_, index) => cell(4 + index, 0)));
        for (let column = 5; column <= 10; column += 1) open(cell(column, 0), cell(column, 1));
        forcePath(Array.from({ length: 5 }, (_, index) => cell(3 + index, 3)));
        for (let column = 3; column <= 7; column += 1) open(cell(column, 3), cell(column, 4));
        forcePath(Array.from({ length: 5 }, (_, index) => cell(9 + index, 8)));
        for (let column = 9; column <= 13; column += 1) open(cell(column, 8), cell(column, 9));
        forcePath(Array.from({ length: 5 }, (_, index) => cell(2, 2 + index)));
        forcePath(Array.from({ length: 5 }, (_, index) => cell(12, 2 + index)));
        forcePath(Array.from({ length: 5 }, (_, index) => cell(9 + index, 9)));
        forcePath([cell(4, 7), cell(4, 8), cell(4, 9)]);
        forcePath([cell(11, 4), cell(11, 5), cell(11, 6)]);
        open(cell(7, 6), cell(8, 6));
        open(cell(7, 7), cell(8, 7));
        open(cell(7, 6), cell(7, 7));
        open(cell(8, 6), cell(8, 7));
        open(cell(6, 6), cell(7, 6));
        open(cell(6, 7), cell(7, 7));
        open(cell(8, 6), cell(9, 6));
        open(cell(8, 7), cell(9, 7));

        const tunnels = [
            [cell(2, 5), cell(3, 5)],
            [cell(12, 3), cell(13, 3)],
            [cell(6, 8), cell(6, 9)],
            [cell(9, 10), cell(10, 10)],
            [cell(4, 8), cell(5, 8)],
            [cell(11, 5), cell(12, 5)]
        ];
        tunnels.forEach(([first, second]) => {
            openEdges.delete(edgeKey(first, second));
            tunnelEdges.add(edgeKey(first, second));
        });

        const shortcuts = [
            [cell(4, 4), cell(5, 4)],
            [cell(11, 6), cell(11, 7)],
            [cell(7, 10), cell(8, 10)]
        ];
        shortcuts.forEach(([first, second]) => {
            openEdges.delete(edgeKey(first, second));
            shortcutEdges.add(edgeKey(first, second));
        });
        buildStaticWalls();
    }

    const shearDoors = [
        { x: cellCentre(cell(5, 3)).x, y: ORIGIN_Y + 4 * CELL, width: 5 * CELL, gaps: [-150, 150], gapWidth: 78, amplitude: 112, period: 7.6, phase: 0.2 },
        { x: cellCentre(cell(11, 8)).x, y: ORIGIN_Y + 9 * CELL, width: 5 * CELL, gaps: [0], gapWidth: 82, amplitude: 170, period: 6.8, phase: 2.1 }
    ];

    const retractors = [
        { first: cell(4, 4), second: cell(5, 4), period: 8.4, phase: 0.4, openStart: 0.48, label: "West shortcut" },
        { first: cell(11, 6), second: cell(11, 7), period: 9.6, phase: 3.2, openStart: 0.54, label: "East shortcut" },
        { first: cell(7, 10), second: cell(8, 10), period: 7.8, phase: 5.1, openStart: 0.44, label: "North shortcut" }
    ];

    const exchange = {
        x: (cellCentre(cell(7, 6)).x + cellCentre(cell(8, 6)).x) * 0.5,
        y: (cellCentre(cell(7, 6)).y + cellCentre(cell(7, 7)).y) * 0.5,
        period: 8.8
    };

    const rollers = [
        { from: cellCentre(cell(2, 2)), to: cellCentre(cell(2, 6)), radius: 46, period: 8.2, phase: 0.3 },
        { from: cellCentre(cell(9, 9)), to: cellCentre(cell(13, 9)), radius: 49, period: 7.4, phase: 2.8 },
        { from: cellCentre(cell(12, 2)), to: cellCentre(cell(12, 6)), radius: 44, period: 9.1, phase: 5.2 }
    ];

    const compactors = [
        { x: cellCentre(cell(4, 7)).x, y: cellCentre(cell(4, 8)).y, length: 520, period: 7.2, phase: 0, orientation: "vertical" },
        { x: cellCentre(cell(11, 4)).x, y: cellCentre(cell(11, 5)).y, length: 520, period: 8.1, phase: 3.5, orientation: "vertical" }
    ];

    const mudZones = [
        { x: cellCentre(cell(1, 7)).x, y: cellCentre(cell(1, 7)).y, width: 150, height: 150 },
        { x: cellCentre(cell(13, 10)).x, y: cellCentre(cell(13, 10)).y, width: 160, height: 145 }
    ];

    const pits = [
        { x: cellCentre(cell(5, 6)).x + 48, y: cellCentre(cell(5, 6)).y - 38, radius: 43 },
        { x: cellCentre(cell(10, 3)).x - 46, y: cellCentre(cell(10, 3)).y + 42, radius: 46 }
    ];

    const exits = exitColumns.map((column, index) => ({
        index,
        column,
        x: cellCentre(cell(column, ROWS - 1)).x,
        status: "open",
        timer: 0,
        duration: 4.8,
        progress: 0,
        finishers: 0
    }));

    function retractorOpenness(retractor) {
        const phase = ((world.time + retractor.phase) % retractor.period) / retractor.period;
        if (phase < retractor.openStart) return 0;
        const local = (phase - retractor.openStart) / (1 - retractor.openStart);
        if (local < 0.2) return smoothstep(local / 0.2);
        if (local > 0.8) return smoothstep((1 - local) / 0.2);
        return 1;
    }

    function edgeAvailable(first, second) {
        const key = edgeKey(first, second);
        if (openEdges.has(key) || tunnelEdges.has(key)) return true;
        const retractor = retractors.find((candidate) => edgeKey(candidate.first, candidate.second) === key);
        return Boolean(retractor && retractorOpenness(retractor) > 0.64);
    }

    function mazeNeighbours(entry) {
        return adjacent(entry).filter((candidate) => edgeAvailable(entry, candidate));
    }

    function buildStaticWalls() {
        staticWalls = [];
        function addWall(x1, y1, x2, y2, kind = "wall") {
            staticWalls.push({ x1, y1, x2, y2, kind });
        }
        function addBoundary(first, second, x1, y1, x2, y2) {
            const key = edgeKey(first, second);
            if (openEdges.has(key) || shortcutEdges.has(key)) return;
            if (tunnelEdges.has(key)) {
                const middleX = (x1 + x2) * 0.5;
                const middleY = (y1 + y2) * 0.5;
                const gap = 43;
                if (Math.abs(x2 - x1) > Math.abs(y2 - y1)) {
                    addWall(x1, y1, middleX - gap, middleY, "tunnel");
                    addWall(middleX + gap, middleY, x2, y2, "tunnel");
                } else {
                    addWall(x1, y1, middleX, middleY - gap, "tunnel");
                    addWall(middleX, middleY + gap, x2, y2, "tunnel");
                }
                return;
            }
            addWall(x1, y1, x2, y2);
        }

        for (let row = 0; row < ROWS; row += 1) {
            for (let column = 0; column < COLS; column += 1) {
                const current = cell(column, row);
                const left = ORIGIN_X + column * CELL;
                const right = left + CELL;
                const bottom = ORIGIN_Y + row * CELL;
                const top = bottom + CELL;
                if (column === 0) addWall(left, bottom, left, top);
                if (row === 0) addWall(left, bottom, right, bottom);
                if (column + 1 < COLS) addBoundary(current, cell(column + 1, row), right, bottom, right, top);
                else addWall(right, bottom, right, top);
                if (row + 1 < ROWS) addBoundary(current, cell(column, row + 1), left, top, right, top);
            }
        }

        let cursor = ORIGIN_X;
        exits.forEach((exit) => {
            const left = exit.x - 52;
            if (left > cursor) addWall(cursor, TOP, left, TOP);
            cursor = exit.x + 52;
        });
        if (cursor < ORIGIN_X + COLS * CELL) addWall(cursor, TOP, ORIGIN_X + COLS * CELL, TOP);
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
            number,
            isPlayer,
            colour: isPlayer ? "#c7a64a" : rivalColours[number % rivalColours.length],
            mass: isPlayer ? 1580 : 1250 + seeded(number, 4) * 950,
            active: true,
            finished: false,
            finishPosition: 0,
            falling: 0,
            fallCause: "",
            impact: 0,
            pin: 0,
            collisionFlash: 0,
            path: [],
            pathTimer: 0,
            targetExit: -1,
            aggression: 0.25 + seeded(number, 7) * 0.7,
            trackClock: seeded(number, 13) * 0.12
        };
    }

    const player = createVehicle(0, 0, true, 10);

    function resetHeat() {
        const start = cellCentre(cell(7, 0));
        Object.assign(player, createVehicle(start.x + 22, start.y - 28, true, 10));
        rivals = [];
        let number = 1;
        for (let row = 0; row < 4 && rivals.length < STARTERS - 1; row += 1) {
            for (let column = 0; column < 6 && rivals.length < STARTERS - 1; column += 1) {
                const source = cellCentre(cell(5 + column, 0));
                const x = source.x + (seeded(number, 1) - 0.5) * 42;
                const y = source.y - 8 - row * 43 + (seeded(number, 2) - 0.5) * 12;
                if (Math.hypot(x - player.x, y - player.y) < 48) {
                    number += 1;
                    continue;
                }
                rivals.push(createVehicle(x, y, false, number));
                number += 1;
            }
        }
        while (rivals.length < STARTERS - 1) {
            const source = cellCentre(cell(6 + rivals.length % 4, 0));
            rivals.push(createVehicle(source.x, source.y - 130 - rivals.length * 3, false, number));
            number += 1;
        }
        exits.forEach((exit) => {
            exit.status = "open";
            exit.timer = 0;
            exit.progress = 0;
            exit.finishers = 0;
        });
        world.time = 0;
        world.cameraX = player.x;
        world.cameraY = player.y + 280;
        world.cameraVX = 0;
        world.cameraVY = 0;
        world.overview = false;
        world.result = "racing";
        world.detail = "Heat active";
        world.finishers = 0;
        world.eliminated = 0;
        world.shake = 0;
        world.particles.length = 0;
        world.tracks.length = 0;
        world.trackTimer = 0;
        world.mapTimer = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey maze";
        updateReadouts();
        render();
    }

    function allVehicles() {
        return [player, ...rivals];
    }

    function activeVehicles() {
        return allVehicles().filter((vehicle) => vehicle.active && !vehicle.finished && vehicle.falling === 0);
    }

    function shortestPath(start, goals) {
        const goalKeys = new Set(goals.map(cellKey));
        const queue = [start];
        const previous = new Map([[cellKey(start), null]]);
        let found = null;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const current = queue[cursor];
            if (goalKeys.has(cellKey(current))) {
                found = current;
                break;
            }
            mazeNeighbours(current).forEach((next) => {
                const key = cellKey(next);
                if (previous.has(key)) return;
                previous.set(key, current);
                queue.push(next);
            });
        }
        if (!found) return [];
        const path = [];
        let current = found;
        while (current) {
            path.unshift(current);
            current = previous.get(cellKey(current));
        }
        return path;
    }

    function openExitGoals() {
        return exits.filter((exit) => exit.status !== "closed").map((exit) => cell(exit.column, ROWS - 1));
    }

    function refreshRivalPath(vehicle) {
        const start = worldCell(vehicle.x, vehicle.y);
        const goals = openExitGoals();
        vehicle.path = shortestPath(start, goals);
        const final = vehicle.path[vehicle.path.length - 1];
        vehicle.targetExit = final ? exits.findIndex((exit) => exit.column === final.column) : -1;
        vehicle.pathTimer = 0.55 + seeded(vehicle.number, Math.floor(world.time)) * 0.65;
    }

    function shearGeometry(door) {
        const phase = (world.time + door.phase) / door.period * TAU;
        const offset = Math.sin(phase) * door.amplitude;
        const velocity = Math.cos(phase) * door.amplitude * TAU / door.period;
        const gaps = door.gaps.map((gap) => door.x + gap + offset).sort((a, b) => a - b);
        return { offset, velocity, gaps };
    }

    function nearestShearTarget(vehicle, target) {
        shearDoors.forEach((door) => {
            if (Math.abs(vehicle.y - door.y) > 210 || Math.abs(vehicle.x - door.x) > door.width * 0.62) return;
            const geometry = shearGeometry(door);
            const gap = geometry.gaps.reduce((best, candidate) => Math.abs(candidate - vehicle.x) < Math.abs(best - vehicle.x) ? candidate : best, geometry.gaps[0]);
            target.x = gap;
        });
        return target;
    }

    function rivalControls(vehicle, delta) {
        vehicle.pathTimer -= delta;
        const currentCell = worldCell(vehicle.x, vehicle.y);
        if (vehicle.pathTimer <= 0 || !vehicle.path.length || exits[vehicle.targetExit]?.status === "closed") refreshRivalPath(vehicle);
        while (vehicle.path.length > 1 && cellKey(vehicle.path[0]) === cellKey(currentCell)) vehicle.path.shift();
        let target;
        if (vehicle.path.length) target = cellCentre(vehicle.path[Math.min(1, vehicle.path.length - 1)]);
        else target = { x: 0, y: vehicle.y + 200 };
        if (currentCell.row === ROWS - 1 && vehicle.targetExit >= 0) {
            target = { x: exits[vehicle.targetExit].x, y: TOP + 130 };
        }
        target = nearestShearTarget(vehicle, target);
        const desired = Math.atan2(target.x - vehicle.x, target.y - vehicle.y);
        let difference = desired - vehicle.heading;
        while (difference > Math.PI) difference -= TAU;
        while (difference < -Math.PI) difference += TAU;
        const steering = clamp(difference * 1.9 - vehicle.vx * 0.002, -1, 1);
        const distance = Math.hypot(target.x - vehicle.x, target.y - vehicle.y);
        const brake = Math.abs(difference) > 1.15 && vehicle.speed > 105 ? 0.35 : distance < 42 ? 0.22 : 0;
        return { throttle: 0.77 + vehicle.aggression * 0.22, brake, steering };
    }

    function updateVehicle(vehicle, delta, controls) {
        if (!vehicle.active || vehicle.finished) return;
        vehicle.previousX = vehicle.x;
        vehicle.previousY = vehicle.y;
        vehicle.collisionFlash = Math.max(0, vehicle.collisionFlash - delta * 3.6);
        vehicle.impact = Math.max(0, vehicle.impact - delta * 1.8);
        if (vehicle.falling > 0) {
            vehicle.falling += delta;
            vehicle.vx *= Math.pow(0.06, delta);
            vehicle.vy *= Math.pow(0.06, delta);
            if (vehicle.falling > 1.15) {
                vehicle.active = false;
                if (vehicle.isPlayer && world.result === "racing") world.result = "eliminated";
            }
            return;
        }

        const speed = Math.hypot(vehicle.vx, vehicle.vy);
        const massRatio = vehicle.mass / 1580;
        const torque = vehicle.isPlayer ? 0.82 : 0.67 + vehicle.aggression * 0.24;
        const grip = vehicle.isPlayer ? 0.93 : 0.76 + vehicle.aggression * 0.18;
        if (controls.throttle > 0.01) {
            const drive = (105 + torque * 130) / Math.max(0.72, massRatio) * controls.throttle;
            vehicle.vx += Math.sin(vehicle.heading) * drive * delta;
            vehicle.vy += Math.cos(vehicle.heading) * drive * delta;
        }
        if (controls.brake > 0.01) {
            const force = 250 * grip / Math.max(0.72, massRatio);
            if (speed > 2) {
                const next = Math.max(0, speed - force * controls.brake * delta);
                vehicle.vx *= next / speed;
                vehicle.vy *= next / speed;
            } else if (vehicle.isPlayer && controls.brake > 0.6) {
                vehicle.vx -= Math.sin(vehicle.heading) * 46 * delta;
                vehicle.vy -= Math.cos(vehicle.heading) * 46 * delta;
            }
        }
        const maximum = 285 + torque * 100;
        const driven = Math.hypot(vehicle.vx, vehicle.vy);
        if (driven > maximum) {
            vehicle.vx *= maximum / driven;
            vehicle.vy *= maximum / driven;
        }
        const authority = clamp(speed / 66, 0.14, 1) * (0.8 + grip * 0.25);
        vehicle.heading += controls.steering * authority * 2.05 * delta;
        const forwardX = Math.sin(vehicle.heading);
        const forwardY = Math.cos(vehicle.heading);
        const longitudinal = vehicle.vx * forwardX + vehicle.vy * forwardY;
        const lateral = vehicle.vx * forwardY - vehicle.vy * forwardX;
        const retainedLateral = lateral * Math.pow(Math.max(0.03, 1 - grip * 4.3 * delta), 1);
        vehicle.vx = forwardX * longitudinal + forwardY * retainedLateral;
        vehicle.vy = forwardY * longitudinal - forwardX * retainedLateral;
        const drag = Math.pow(0.989, delta * 60);
        vehicle.vx *= drag;
        vehicle.vy *= drag;
        vehicle.x += vehicle.vx * delta;
        vehicle.y += vehicle.vy * delta;
        vehicle.speed = Math.hypot(vehicle.vx, vehicle.vy);

        mudZones.forEach((zone) => {
            if (Math.abs(vehicle.x - zone.x) < zone.width * 0.5 && Math.abs(vehicle.y - zone.y) < zone.height * 0.5) {
                vehicle.vx *= Math.pow(0.36, delta);
                vehicle.vy *= Math.pow(0.36, delta);
                vehicle.heading += Math.sin(world.time * 2 + vehicle.number) * delta * 0.16;
                spawnDust(vehicle.x, vehicle.y, "#75644f", 1);
            }
        });
        pits.forEach((pit) => {
            if (Math.hypot(vehicle.x - pit.x, vehicle.y - pit.y) < pit.radius - 5) beginFall(vehicle, "pit");
        });
    }

    function beginFall(vehicle, cause) {
        if (!vehicle.active || vehicle.finished || vehicle.falling > 0) return;
        vehicle.falling = 0.001;
        vehicle.fallCause = cause;
        world.eliminated += 1;
        world.shake = Math.max(world.shake, vehicle.isPlayer ? 1 : 0.3);
        spawnDust(vehicle.x, vehicle.y, "#968a72", 18);
        if (vehicle.isPlayer) world.detail = cause === "pit" ? "Lost to an open floor" : "Pinned inside the monument";
    }

    function collideSegment(vehicle, segment, thickness = WALL_HALF, movingX = 0, movingY = 0, pinning = false) {
        if (!vehicle.active || vehicle.falling > 0 || vehicle.finished) return false;
        const dx = segment.x2 - segment.x1;
        const dy = segment.y2 - segment.y1;
        const lengthSquared = dx * dx + dy * dy;
        const ratio = lengthSquared ? clamp(((vehicle.x - segment.x1) * dx + (vehicle.y - segment.y1) * dy) / lengthSquared, 0, 1) : 0;
        const nearestX = segment.x1 + dx * ratio;
        const nearestY = segment.y1 + dy * ratio;
        const offsetX = vehicle.x - nearestX;
        const offsetY = vehicle.y - nearestY;
        const distanceSquared = offsetX * offsetX + offsetY * offsetY;
        const minimum = CAR_RADIUS + thickness;
        if (distanceSquared >= minimum * minimum) return false;
        const distance = Math.max(0.001, Math.sqrt(distanceSquared));
        const nx = offsetX / distance;
        const ny = offsetY / distance;
        const overlap = minimum - distance;
        vehicle.x += nx * overlap;
        vehicle.y += ny * overlap;
        const normalSpeed = (vehicle.vx - movingX) * nx + (vehicle.vy - movingY) * ny;
        if (normalSpeed < 0) {
            vehicle.vx -= normalSpeed * nx * 1.25;
            vehicle.vy -= normalSpeed * ny * 1.25;
        }
        vehicle.vx += movingX * 0.18;
        vehicle.vy += movingY * 0.18;
        vehicle.collisionFlash = 1;
        vehicle.impact = Math.max(vehicle.impact, clamp(Math.abs(normalSpeed) / 70, 0.18, 1.8));
        if (pinning) vehicle.pin += 0.018 + Math.abs(normalSpeed) * 0.00035;
        if (vehicle.isPlayer) world.shake = Math.max(world.shake, clamp(Math.abs(normalSpeed) / 110, 0.12, 0.8));
        return true;
    }

    function collideAABB(vehicle, rectangle, movingX = 0, movingY = 0, pinning = false) {
        const nearestX = clamp(vehicle.x, rectangle.x - rectangle.width * 0.5, rectangle.x + rectangle.width * 0.5);
        const nearestY = clamp(vehicle.y, rectangle.y - rectangle.height * 0.5, rectangle.y + rectangle.height * 0.5);
        let dx = vehicle.x - nearestX;
        let dy = vehicle.y - nearestY;
        if (dx * dx + dy * dy >= CAR_RADIUS * CAR_RADIUS) return false;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
            const left = Math.abs(vehicle.x - (rectangle.x - rectangle.width * 0.5));
            const right = Math.abs(vehicle.x - (rectangle.x + rectangle.width * 0.5));
            const bottom = Math.abs(vehicle.y - (rectangle.y - rectangle.height * 0.5));
            const top = Math.abs(vehicle.y - (rectangle.y + rectangle.height * 0.5));
            const minimum = Math.min(left, right, bottom, top);
            if (minimum === left) dx = -1;
            else if (minimum === right) dx = 1;
            else if (minimum === bottom) dy = -1;
            else dy = 1;
        }
        const length = Math.max(0.001, Math.hypot(dx, dy));
        const nx = dx / length;
        const ny = dy / length;
        vehicle.x += nx * (CAR_RADIUS - length + 1);
        vehicle.y += ny * (CAR_RADIUS - length + 1);
        const normal = (vehicle.vx - movingX) * nx + (vehicle.vy - movingY) * ny;
        if (normal < 0) {
            vehicle.vx -= normal * nx * 1.2;
            vehicle.vy -= normal * ny * 1.2;
        }
        vehicle.vx += movingX * 0.2;
        vehicle.vy += movingY * 0.2;
        vehicle.collisionFlash = 1;
        if (pinning) vehicle.pin += 0.025;
        return true;
    }

    function collideStaticWalls(vehicle) {
        staticWalls.forEach((wall) => {
            if (vehicle.x < Math.min(wall.x1, wall.x2) - 80 || vehicle.x > Math.max(wall.x1, wall.x2) + 80 || vehicle.y < Math.min(wall.y1, wall.y2) - 80 || vehicle.y > Math.max(wall.y1, wall.y2) + 80) return;
            collideSegment(vehicle, wall, WALL_HALF);
        });
    }

    function collideShearDoors(vehicle) {
        shearDoors.forEach((door) => {
            if (Math.abs(vehicle.y - door.y) > 75 || Math.abs(vehicle.x - door.x) > door.width * 0.6) return;
            const geometry = shearGeometry(door);
            const left = door.x - door.width * 0.5;
            const right = door.x + door.width * 0.5;
            const intervals = [];
            let cursor = left;
            geometry.gaps.forEach((gap) => {
                const gapLeft = clamp(gap - door.gapWidth * 0.5, left, right);
                const gapRight = clamp(gap + door.gapWidth * 0.5, left, right);
                if (gapLeft > cursor) intervals.push([cursor, gapLeft]);
                cursor = Math.max(cursor, gapRight);
            });
            if (cursor < right) intervals.push([cursor, right]);
            intervals.forEach(([start, end]) => {
                collideSegment(vehicle, { x1: start, y1: door.y, x2: end, y2: door.y }, 24, geometry.velocity, 0, true);
            });
        });
    }

    function collideRetractors(vehicle) {
        retractors.forEach((retractor) => {
            const openness = retractorOpenness(retractor);
            if (openness > 0.94) return;
            const first = cellCentre(retractor.first);
            const second = cellCentre(retractor.second);
            const middleX = (first.x + second.x) * 0.5;
            const middleY = (first.y + second.y) * 0.5;
            if (first.column !== second.column) {
                const height = CELL * (1 - openness);
                collideSegment(vehicle, { x1: middleX, y1: middleY - height * 0.5, x2: middleX, y2: middleY + height * 0.5 }, 22, 0, 0, true);
            } else {
                const width = CELL * (1 - openness);
                collideSegment(vehicle, { x1: middleX - width * 0.5, y1: middleY, x2: middleX + width * 0.5, y2: middleY }, 22, 0, 0, true);
            }
        });
    }

    function exchangeBlocks() {
        const phase = world.time / exchange.period * TAU;
        const slide = Math.sin(phase) * 68;
        const velocity = Math.cos(phase) * 68 * TAU / exchange.period;
        return [
            { x: exchange.x - 55 + slide, y: exchange.y, width: 54, height: 300, angle: 0.52, vx: velocity },
            { x: exchange.x + 55 - slide, y: exchange.y, width: 54, height: 300, angle: -0.52, vx: -velocity }
        ];
    }

    function collideOriented(vehicle, rectangle) {
        const cosine = Math.cos(-rectangle.angle);
        const sine = Math.sin(-rectangle.angle);
        const dx = vehicle.x - rectangle.x;
        const dy = vehicle.y - rectangle.y;
        const localX = dx * cosine - dy * sine;
        const localY = dx * sine + dy * cosine;
        const nearestX = clamp(localX, -rectangle.width * 0.5, rectangle.width * 0.5);
        const nearestY = clamp(localY, -rectangle.height * 0.5, rectangle.height * 0.5);
        let offsetX = localX - nearestX;
        let offsetY = localY - nearestY;
        if (offsetX * offsetX + offsetY * offsetY >= CAR_RADIUS * CAR_RADIUS) return;
        if (Math.abs(offsetX) + Math.abs(offsetY) < 0.001) offsetX = localX < 0 ? -1 : 1;
        const length = Math.max(0.001, Math.hypot(offsetX, offsetY));
        const localNX = offsetX / length;
        const localNY = offsetY / length;
        const worldNX = localNX * Math.cos(rectangle.angle) - localNY * Math.sin(rectangle.angle);
        const worldNY = localNX * Math.sin(rectangle.angle) + localNY * Math.cos(rectangle.angle);
        vehicle.x += worldNX * (CAR_RADIUS - length + 1);
        vehicle.y += worldNY * (CAR_RADIUS - length + 1);
        vehicle.vx += rectangle.vx * 0.24;
        vehicle.vy *= 0.88;
        vehicle.pin += 0.016;
        vehicle.collisionFlash = 1;
    }

    function rollerGeometry(roller) {
        const phase = (world.time + roller.phase) / roller.period * TAU;
        const ratio = 0.5 - Math.cos(phase) * 0.5;
        const derivative = Math.sin(phase) * 0.5 * TAU / roller.period;
        return {
            x: lerp(roller.from.x, roller.to.x, ratio),
            y: lerp(roller.from.y, roller.to.y, ratio),
            vx: (roller.to.x - roller.from.x) * derivative,
            vy: (roller.to.y - roller.from.y) * derivative
        };
    }

    function collideRollers(vehicle) {
        rollers.forEach((roller) => {
            const moving = rollerGeometry(roller);
            const dx = vehicle.x - moving.x;
            const dy = vehicle.y - moving.y;
            const minimum = CAR_RADIUS + roller.radius;
            const distance = Math.hypot(dx, dy);
            if (distance >= minimum || distance < 0.001) return;
            const nx = dx / distance;
            const ny = dy / distance;
            vehicle.x += nx * (minimum - distance);
            vehicle.y += ny * (minimum - distance);
            vehicle.vx += moving.vx * 0.52 + nx * 36;
            vehicle.vy += moving.vy * 0.52 + ny * 36;
            vehicle.pin += 0.035;
            vehicle.collisionFlash = 1;
            if (vehicle.isPlayer) world.shake = Math.max(world.shake, 0.65);
            spawnDust(vehicle.x, vehicle.y, "#a0957d", 2);
        });
    }

    function compactorGeometry(compactor) {
        const phase = (world.time + compactor.phase) / compactor.period * TAU;
        const compression = smoothstep(0.5 - Math.cos(phase) * 0.5);
        const gap = lerp(142, 60, compression);
        const velocity = Math.sin(phase) * (82 * 0.5 * TAU / compactor.period);
        return { gap, velocity, compression };
    }

    function collideCompactors(vehicle) {
        compactors.forEach((compactor) => {
            const geometry = compactorGeometry(compactor);
            if (Math.abs(vehicle.y - compactor.y) > compactor.length * 0.6 || Math.abs(vehicle.x - compactor.x) > 150) return;
            const sideWidth = 62;
            const left = { x: compactor.x - geometry.gap * 0.5 - sideWidth * 0.5, y: compactor.y, width: sideWidth, height: compactor.length };
            const right = { x: compactor.x + geometry.gap * 0.5 + sideWidth * 0.5, y: compactor.y, width: sideWidth, height: compactor.length };
            collideAABB(vehicle, left, geometry.velocity, 0, true);
            collideAABB(vehicle, right, -geometry.velocity, 0, true);
        });
    }

    function collideExitDoors(vehicle) {
        exits.forEach((exit) => {
            if (exit.progress < 0.58) return;
            collideSegment(vehicle, { x1: exit.x - 55, y1: TOP, x2: exit.x + 55, y2: TOP }, 22, 0, -22 * exit.progress, true);
        });
    }

    function resolveVehicleCollisions() {
        const vehicles = activeVehicles();
        for (let firstIndex = 0; firstIndex < vehicles.length; firstIndex += 1) {
            const first = vehicles[firstIndex];
            for (let secondIndex = firstIndex + 1; secondIndex < vehicles.length; secondIndex += 1) {
                const second = vehicles[secondIndex];
                const dx = second.x - first.x;
                const dy = second.y - first.y;
                const distance = Math.hypot(dx, dy);
                const minimum = CAR_RADIUS * 2;
                if (distance >= minimum || distance < 0.001) continue;
                const nx = dx / distance;
                const ny = dy / distance;
                const overlap = minimum - distance;
                const inverseFirst = 1 / first.mass;
                const inverseSecond = 1 / second.mass;
                const total = inverseFirst + inverseSecond;
                first.x -= nx * overlap * inverseFirst / total;
                first.y -= ny * overlap * inverseFirst / total;
                second.x += nx * overlap * inverseSecond / total;
                second.y += ny * overlap * inverseSecond / total;
                const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
                if (relative < 0) {
                    const impulse = -(1.12 * relative) / total;
                    first.vx -= impulse * nx * inverseFirst;
                    first.vy -= impulse * ny * inverseFirst;
                    second.vx += impulse * nx * inverseSecond;
                    second.vy += impulse * ny * inverseSecond;
                    first.collisionFlash = 1;
                    second.collisionFlash = 1;
                    if (first.isPlayer || second.isPlayer) world.shake = Math.max(world.shake, Math.min(0.7, Math.abs(relative) / 120));
                }
            }
        }
    }

    function resolveArchitecture(vehicle, delta) {
        if (!vehicle.active || vehicle.falling > 0 || vehicle.finished) return;
        const pinBefore = vehicle.pin;
        collideStaticWalls(vehicle);
        collideShearDoors(vehicle);
        collideRetractors(vehicle);
        exchangeBlocks().forEach((rectangle) => collideOriented(vehicle, rectangle));
        collideRollers(vehicle);
        collideCompactors(vehicle);
        collideExitDoors(vehicle);
        vehicle.pin = Math.max(0, vehicle.pin - delta * (vehicle.pin === pinBefore ? 0.5 : 0.08));
        if (vehicle.pin > 2.15) beginFall(vehicle, "pin");
    }

    function updateExits(delta) {
        exits.forEach((exit) => {
            if (exit.status !== "closing") return;
            exit.timer += delta;
            exit.progress = smoothstep(exit.timer / exit.duration);
            if (exit.timer >= exit.duration) {
                exit.status = "closed";
                exit.progress = 1;
                spawnDust(exit.x, TOP, "#a69b82", 24);
            }
        });
        activeVehicles().forEach((vehicle) => {
            if (vehicle.y < TOP + 26) return;
            const exit = exits.find((candidate) => candidate.status !== "closed" && Math.abs(vehicle.x - candidate.x) < 57);
            if (exit) finishVehicle(vehicle, exit);
            else {
                vehicle.y = TOP + 22;
                vehicle.vy *= -0.28;
            }
        });
        if (world.result === "racing" && exits.every((exit) => exit.status === "closed") && player.active && !player.finished) {
            world.result = "sealed";
            world.detail = "All four outlets closed";
        }
    }

    function finishVehicle(vehicle, exit) {
        if (vehicle.finished) return;
        vehicle.finished = true;
        vehicle.active = false;
        world.finishers += 1;
        vehicle.finishPosition = world.finishers;
        exit.finishers += 1;
        if (exit.status === "open") {
            exit.status = "closing";
            exit.timer = 0;
            exit.progress = 0;
        }
        if (vehicle.isPlayer) {
            world.result = "finished";
            world.detail = vehicle.finishPosition === 1 ? `First through exit ${exit.index + 1}` : `Finished P${vehicle.finishPosition} · Exit ${exit.index + 1}`;
        }
    }

    function spawnDust(x, y, colour, count) {
        for (let index = 0; index < count; index += 1) {
            const angle = seeded(index + world.time * 100, count) * TAU;
            const speed = 8 + seeded(index, world.time * 11) * 55;
            world.particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: 4 + seeded(index, 29) * 13,
                life: 0.7 + seeded(index, 31) * 1.5,
                maximumLife: 2.2,
                colour
            });
        }
        if (world.particles.length > 300) world.particles.splice(0, world.particles.length - 300);
    }

    function updateMemory(delta) {
        world.trackTimer -= delta;
        if (world.trackTimer <= 0) {
            world.trackTimer = 0.11;
            allVehicles().forEach((vehicle) => {
                if (!vehicle.active || vehicle.falling > 0 || vehicle.speed < 38) return;
                world.tracks.push({ x: vehicle.x, y: vehicle.y, heading: vehicle.heading, age: 0, player: vehicle.isPlayer });
                if (vehicle.speed > 150 && seeded(vehicle.number + world.time, 17) > 0.73) spawnDust(vehicle.x, vehicle.y, "#9d957f", 1);
            });
            if (world.tracks.length > 1500) world.tracks.splice(0, world.tracks.length - 1500);
        }
        world.tracks.forEach((track) => { track.age += delta; });
        world.tracks = world.tracks.filter((track) => track.age < 95);
        world.particles.forEach((particle) => {
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            particle.vx *= Math.pow(0.12, delta);
            particle.vy *= Math.pow(0.12, delta);
            particle.radius += delta * 5;
            particle.life -= delta;
        });
        world.particles = world.particles.filter((particle) => particle.life > 0);
    }

    function racePosition() {
        if (player.finished && player.finishPosition) return player.finishPosition;
        const playerDistance = nearestExitDistance(player);
        const ahead = rivals.filter((vehicle) => vehicle.finished || (vehicle.active && nearestExitDistance(vehicle) < playerDistance)).length;
        return clamp(ahead + 1, 1, STARTERS);
    }

    function nearestExitDistance(vehicle) {
        const goals = exits.filter((exit) => exit.status !== "closed");
        if (!goals.length) return Infinity;
        return Math.min(...goals.map((exit) => Math.hypot(vehicle.x - exit.x, vehicle.y - TOP)));
    }

    function updateCamera(delta) {
        let targetX = player.x;
        let targetY = player.y + 220;
        if (world.overview) {
            targetX = 0;
            targetY = (ORIGIN_Y + TOP) * 0.5;
        }
        world.cameraVX += (targetX - world.cameraX) * Math.min(1, delta * 5);
        world.cameraVY += (targetY - world.cameraY) * Math.min(1, delta * 5);
        world.cameraVX *= Math.pow(0.004, delta);
        world.cameraVY *= Math.pow(0.004, delta);
        world.cameraX += world.cameraVX * delta;
        world.cameraY += world.cameraVY * delta;
        world.shake = Math.max(0, world.shake - delta * 2.2);
    }

    function update(delta) {
        world.time += delta;
        if (world.result !== "racing") {
            updateMemory(delta);
            updateReadouts();
            return;
        }
        rivals.forEach((vehicle) => updateVehicle(vehicle, delta, rivalControls(vehicle, delta)));
        const steering = (input.left ? -1 : 0) + (input.right ? 1 : 0);
        updateVehicle(player, delta, { throttle: input.throttle ? 1 : 0, brake: input.brake ? 1 : 0, steering });
        activeVehicles().forEach((vehicle) => resolveArchitecture(vehicle, delta));
        resolveVehicleCollisions();
        updateExits(delta);
        updateMemory(delta);
        updateCamera(delta);
        updateReadouts();
    }

    function activeScale() {
        if (!world.overview) return world.scale;
        return Math.min((world.width - 90) / (COLS * CELL + 120), (world.height - 80) / (ROWS * CELL + 180));
    }

    function worldToScreen(x, y) {
        const scale = activeScale();
        return {
            x: world.width * 0.5 + (x - world.cameraX) * scale,
            y: world.height * 0.55 - (y - world.cameraY) * scale
        };
    }

    function drawGround() {
        const gradient = context.createRadialGradient(world.width * 0.5, world.height * 0.5, 20, world.width * 0.5, world.height * 0.5, world.width * 0.8);
        gradient.addColorStop(0, "#55574f");
        gradient.addColorStop(0.65, "#353a35");
        gradient.addColorStop(1, "#151a17");
        context.fillStyle = gradient;
        context.fillRect(0, 0, world.width, world.height);
        const scale = activeScale();
        const startX = Math.floor((world.cameraX - world.width / scale) / 100) * 100;
        const endX = world.cameraX + world.width / scale;
        const startY = Math.floor((world.cameraY - world.height / scale) / 100) * 100;
        const endY = world.cameraY + world.height / scale;
        context.strokeStyle = "rgba(229,224,208,0.035)";
        context.lineWidth = 1;
        for (let x = startX; x < endX; x += 100) {
            const first = worldToScreen(x, startY);
            const second = worldToScreen(x, endY);
            context.beginPath();
            context.moveTo(first.x, first.y);
            context.lineTo(second.x, second.y);
            context.stroke();
        }
        for (let y = startY; y < endY; y += 100) {
            const first = worldToScreen(startX, y);
            const second = worldToScreen(endX, y);
            context.beginPath();
            context.moveTo(first.x, first.y);
            context.lineTo(second.x, second.y);
            context.stroke();
        }
    }

    function drawMudAndPits() {
        mudZones.forEach((zone) => {
            const centre = worldToScreen(zone.x, zone.y);
            const scale = activeScale();
            context.fillStyle = "rgba(80,65,48,0.86)";
            context.fillRect(centre.x - zone.width * scale * 0.5, centre.y - zone.height * scale * 0.5, zone.width * scale, zone.height * scale);
            context.strokeStyle = "rgba(151,126,90,0.48)";
            context.lineWidth = 2;
            for (let stripe = -2; stripe <= 2; stripe += 1) {
                context.beginPath();
                context.moveTo(centre.x + stripe * 22 * scale, centre.y - zone.height * scale * 0.43);
                context.bezierCurveTo(centre.x + (stripe + 1) * 18 * scale, centre.y - 15, centre.x + (stripe - 1) * 21 * scale, centre.y + 15, centre.x + stripe * 22 * scale, centre.y + zone.height * scale * 0.43);
                context.stroke();
            }
        });
        pits.forEach((pit) => {
            const centre = worldToScreen(pit.x, pit.y);
            const radius = pit.radius * activeScale();
            const gradient = context.createRadialGradient(centre.x, centre.y, 2, centre.x, centre.y, radius);
            gradient.addColorStop(0, "#050706");
            gradient.addColorStop(0.72, "#0b0e0c");
            gradient.addColorStop(1, "#685e4c");
            context.fillStyle = gradient;
            context.beginPath();
            context.arc(centre.x, centre.y, radius, 0, TAU);
            context.fill();
            context.strokeStyle = "rgba(194,177,136,0.5)";
            context.lineWidth = 2;
            context.stroke();
        });
    }

    function drawTracks() {
        const scale = activeScale();
        world.tracks.forEach((track) => {
            const point = worldToScreen(track.x, track.y);
            if (point.x < -20 || point.x > world.width + 20 || point.y < -20 || point.y > world.height + 20) return;
            context.save();
            context.translate(point.x, point.y);
            context.rotate(track.heading);
            context.globalAlpha = clamp((95 - track.age) / 95, 0, 1) * (track.player ? 0.42 : 0.22);
            context.fillStyle = track.player ? "#332d21" : "#292b26";
            context.fillRect(-12 * scale, -5 * scale, 4 * scale, 10 * scale);
            context.fillRect(8 * scale, -5 * scale, 4 * scale, 10 * scale);
            context.restore();
        });
        context.globalAlpha = 1;
    }

    function drawStaticWalls() {
        const scale = activeScale();
        staticWalls.forEach((wall) => {
            const first = worldToScreen(wall.x1, wall.y1);
            const second = worldToScreen(wall.x2, wall.y2);
            if (Math.max(first.x, second.x) < -80 || Math.min(first.x, second.x) > world.width + 80 || Math.max(first.y, second.y) < -80 || Math.min(first.y, second.y) > world.height + 80) return;
            context.strokeStyle = "rgba(0,0,0,0.48)";
            context.lineWidth = 54 * scale;
            context.lineCap = "square";
            context.beginPath();
            context.moveTo(first.x + 5, first.y + 7);
            context.lineTo(second.x + 5, second.y + 7);
            context.stroke();
            context.strokeStyle = wall.kind === "tunnel" ? "#706b5d" : "#77766d";
            context.lineWidth = 42 * scale;
            context.beginPath();
            context.moveTo(first.x, first.y);
            context.lineTo(second.x, second.y);
            context.stroke();
            context.strokeStyle = "rgba(224,217,197,0.22)";
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(first.x - 2, first.y - 2);
            context.lineTo(second.x - 2, second.y - 2);
            context.stroke();
            context.lineCap = "butt";
        });
        tunnelEdges.forEach((key) => {
            const [firstText, secondText] = key.split("|");
            const [firstColumn, firstRow] = firstText.split(",").map(Number);
            const [secondColumn, secondRow] = secondText.split(",").map(Number);
            const first = cellCentre(cell(firstColumn, firstRow));
            const second = cellCentre(cell(secondColumn, secondRow));
            const point = worldToScreen((first.x + second.x) * 0.5, (first.y + second.y) * 0.5);
            context.fillStyle = "#090c0a";
            context.beginPath();
            context.arc(point.x, point.y, 27 * scale, 0, TAU);
            context.fill();
            context.strokeStyle = "#aaa18a";
            context.lineWidth = 3;
            context.beginPath();
            context.arc(point.x, point.y, 29 * scale, Math.PI, TAU);
            context.stroke();
        });
    }

    function drawShearDoors() {
        const scale = activeScale();
        shearDoors.forEach((door, doorIndex) => {
            const geometry = shearGeometry(door);
            const left = door.x - door.width * 0.5;
            const right = door.x + door.width * 0.5;
            let cursor = left;
            const intervals = [];
            geometry.gaps.forEach((gap) => {
                const gapLeft = clamp(gap - door.gapWidth * 0.5, left, right);
                const gapRight = clamp(gap + door.gapWidth * 0.5, left, right);
                if (gapLeft > cursor) intervals.push([cursor, gapLeft]);
                cursor = Math.max(cursor, gapRight);
            });
            if (cursor < right) intervals.push([cursor, right]);
            intervals.forEach(([start, end]) => {
                const first = worldToScreen(start, door.y);
                const second = worldToScreen(end, door.y);
                context.strokeStyle = "rgba(0,0,0,0.55)";
                context.lineWidth = 61 * scale;
                context.beginPath();
                context.moveTo(first.x + 5, first.y + 6);
                context.lineTo(second.x + 5, second.y + 6);
                context.stroke();
                context.strokeStyle = "#8a8679";
                context.lineWidth = 48 * scale;
                context.beginPath();
                context.moveTo(first.x, first.y);
                context.lineTo(second.x, second.y);
                context.stroke();
                context.strokeStyle = "#b85842";
                context.lineWidth = 3;
                context.stroke();
            });
            geometry.gaps.forEach((gap) => {
                const point = worldToScreen(gap, door.y);
                context.fillStyle = "rgba(197,165,83,0.85)";
                context.fillRect(point.x - 3, point.y - 29 * scale, 6, 58 * scale);
            });
            const label = worldToScreen(door.x, door.y - 42);
            context.fillStyle = "rgba(10,11,9,0.8)";
            context.fillRect(label.x - 51, label.y - 10, 102, 18);
            context.fillStyle = "#ddd6c2";
            context.font = "600 7px General Sans, sans-serif";
            context.textAlign = "center";
            context.fillText(`SHEAR DOOR ${doorIndex + 1}`, label.x, label.y + 2);
        });
    }

    function drawRetractors() {
        const scale = activeScale();
        retractors.forEach((retractor) => {
            const openness = retractorOpenness(retractor);
            const first = cellCentre(retractor.first);
            const second = cellCentre(retractor.second);
            const x = (first.x + second.x) * 0.5;
            const y = (first.y + second.y) * 0.5;
            const point = worldToScreen(x, y);
            context.save();
            context.translate(point.x, point.y);
            context.fillStyle = openness > 0.7 ? "rgba(112,143,120,0.26)" : "#716f65";
            context.strokeStyle = openness > 0.7 ? "#7d9b82" : "#c09a49";
            context.lineWidth = 2;
            if (first.column !== second.column) {
                const height = CELL * scale * (1 - openness);
                context.fillRect(-22 * scale, -height * 0.5, 44 * scale, height);
                context.strokeRect(-22 * scale, -height * 0.5, 44 * scale, height);
            } else {
                const width = CELL * scale * (1 - openness);
                context.fillRect(-width * 0.5, -22 * scale, width, 44 * scale);
                context.strokeRect(-width * 0.5, -22 * scale, width, 44 * scale);
            }
            context.restore();
        });
    }

    function drawExchange() {
        const scale = activeScale();
        exchangeBlocks().forEach((rectangle) => {
            const point = worldToScreen(rectangle.x, rectangle.y);
            context.save();
            context.translate(point.x, point.y);
            context.rotate(-rectangle.angle);
            context.fillStyle = "rgba(0,0,0,0.42)";
            context.fillRect(-rectangle.width * scale * 0.5 + 5, -rectangle.height * scale * 0.5 + 7, rectangle.width * scale, rectangle.height * scale);
            context.fillStyle = "#7a786e";
            context.fillRect(-rectangle.width * scale * 0.5, -rectangle.height * scale * 0.5, rectangle.width * scale, rectangle.height * scale);
            context.strokeStyle = "#aaa28b";
            context.lineWidth = 2;
            context.strokeRect(-rectangle.width * scale * 0.5, -rectangle.height * scale * 0.5, rectangle.width * scale, rectangle.height * scale);
            context.restore();
        });
        const label = worldToScreen(exchange.x, exchange.y);
        context.fillStyle = "rgba(9,10,9,0.72)";
        context.fillRect(label.x - 58, label.y - 10, 116, 19);
        context.fillStyle = "#ddd7c5";
        context.font = "600 7px General Sans, sans-serif";
        context.textAlign = "center";
        context.fillText("CORRIDOR EXCHANGE", label.x, label.y + 3);
    }

    function drawRollers() {
        const scale = activeScale();
        rollers.forEach((roller, index) => {
            const moving = rollerGeometry(roller);
            const point = worldToScreen(moving.x, moving.y);
            const radius = roller.radius * scale;
            context.fillStyle = "rgba(0,0,0,0.46)";
            context.beginPath();
            context.arc(point.x + 5, point.y + 7, radius, 0, TAU);
            context.fill();
            const gradient = context.createRadialGradient(point.x - radius * 0.35, point.y - radius * 0.35, 2, point.x, point.y, radius);
            gradient.addColorStop(0, "#a59f8d");
            gradient.addColorStop(0.55, "#6d6e66");
            gradient.addColorStop(1, "#3c403a");
            context.fillStyle = gradient;
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, TAU);
            context.fill();
            context.strokeStyle = "#b8ae94";
            context.lineWidth = 2;
            context.stroke();
            context.strokeStyle = "rgba(31,34,30,0.7)";
            context.lineWidth = 2;
            for (let ridge = -2; ridge <= 2; ridge += 1) {
                context.beginPath();
                context.moveTo(point.x - radius * 0.68, point.y + ridge * radius * 0.28);
                context.lineTo(point.x + radius * 0.68, point.y + ridge * radius * 0.28);
                context.stroke();
            }
            context.fillStyle = "#e4decb";
            context.font = "600 7px General Sans, sans-serif";
            context.textAlign = "center";
            context.fillText(`R${index + 1}`, point.x, point.y + 3);
        });
    }

    function drawCompactors() {
        const scale = activeScale();
        compactors.forEach((compactor, index) => {
            const geometry = compactorGeometry(compactor);
            const centre = worldToScreen(compactor.x, compactor.y);
            const sideWidth = 62 * scale;
            const height = compactor.length * scale;
            const gap = geometry.gap * scale;
            context.fillStyle = "rgba(0,0,0,0.43)";
            context.fillRect(centre.x - gap * 0.5 - sideWidth + 5, centre.y - height * 0.5 + 7, sideWidth, height);
            context.fillRect(centre.x + gap * 0.5 + 5, centre.y - height * 0.5 + 7, sideWidth, height);
            context.fillStyle = "#686b63";
            context.fillRect(centre.x - gap * 0.5 - sideWidth, centre.y - height * 0.5, sideWidth, height);
            context.fillRect(centre.x + gap * 0.5, centre.y - height * 0.5, sideWidth, height);
            context.strokeStyle = geometry.compression > 0.65 ? "#bd5842" : "#9f9882";
            context.lineWidth = 3;
            context.strokeRect(centre.x - gap * 0.5 - sideWidth, centre.y - height * 0.5, sideWidth, height);
            context.strokeRect(centre.x + gap * 0.5, centre.y - height * 0.5, sideWidth, height);
            context.fillStyle = "rgba(10,11,9,0.82)";
            context.fillRect(centre.x - 54, centre.y - 9, 108, 18);
            context.fillStyle = "#ddd6c3";
            context.font = "600 7px General Sans, sans-serif";
            context.textAlign = "center";
            context.fillText(`COMPACTOR ${index + 1} / TUNNEL BYPASS`, centre.x, centre.y + 3);
        });
    }

    function drawExits() {
        const scale = activeScale();
        exits.forEach((exit) => {
            const point = worldToScreen(exit.x, TOP);
            context.fillStyle = exit.status === "open" ? "#70957a" : exit.status === "closing" ? "#c39848" : "#a64e3c";
            context.fillRect(point.x - 50 * scale, point.y - 8 * scale, 100 * scale, 16 * scale);
            context.fillStyle = "rgba(9,10,9,0.88)";
            context.fillRect(point.x - 54, point.y - 50, 108, 27);
            context.strokeStyle = exit.status === "closed" ? "#b9523e" : "rgba(229,223,206,0.42)";
            context.strokeRect(point.x - 54, point.y - 50, 108, 27);
            context.fillStyle = "#eee8d8";
            context.font = "600 8px General Sans, sans-serif";
            context.textAlign = "center";
            const text = exit.status === "open" ? `EXIT ${exit.index + 1} / OPEN` : exit.status === "closing" ? `EXIT ${exit.index + 1} / ${(exit.duration - exit.timer).toFixed(1)} S` : `EXIT ${exit.index + 1} / SEALED`;
            context.fillText(text, point.x, point.y - 33);
            if (exit.progress > 0) {
                context.fillStyle = "#77756b";
                context.fillRect(point.x - 52 * scale, point.y - 22 * scale, 104 * scale, 44 * scale * exit.progress);
                context.strokeStyle = "#b8533e";
                context.lineWidth = 2;
                context.strokeRect(point.x - 52 * scale, point.y - 22 * scale, 104 * scale, 44 * scale * exit.progress);
            }
        });
    }

    function drawVehicle(vehicle) {
        if (!vehicle.active && !vehicle.finished) return;
        const point = worldToScreen(vehicle.x, vehicle.y);
        if (point.x < -100 || point.x > world.width + 100 || point.y < -100 || point.y > world.height + 100) return;
        const scale = activeScale();
        const fall = vehicle.falling > 0 ? clamp(vehicle.falling / 1.15, 0, 1) : 0;
        context.save();
        context.translate(point.x, point.y + fall * 24);
        context.rotate(vehicle.heading);
        context.scale(1 - fall * 0.6, 1 - fall * 0.2);
        context.globalAlpha = 1 - fall * 0.75;
        context.fillStyle = "rgba(0,0,0,0.36)";
        context.fillRect(-15 * scale + 4, -28 * scale + 6, 30 * scale, 56 * scale);
        context.fillStyle = "#181a17";
        context.fillRect(-19 * scale, -20 * scale, 5 * scale, 13 * scale);
        context.fillRect(14 * scale, -20 * scale, 5 * scale, 13 * scale);
        context.fillRect(-19 * scale, 9 * scale, 5 * scale, 13 * scale);
        context.fillRect(14 * scale, 9 * scale, 5 * scale, 13 * scale);
        context.fillStyle = vehicle.collisionFlash > 0.2 ? "#e1d8bb" : vehicle.colour;
        context.fillRect(-15 * scale, -28 * scale, 30 * scale, 56 * scale);
        context.fillStyle = "rgba(21,26,23,0.82)";
        context.fillRect(-11 * scale, -11 * scale, 22 * scale, 20 * scale);
        context.strokeStyle = vehicle.isPlayer ? "#f0dca1" : "rgba(233,230,216,0.45)";
        context.lineWidth = vehicle.isPlayer ? 2.2 : 1;
        context.strokeRect(-15 * scale, -28 * scale, 30 * scale, 56 * scale);
        context.fillStyle = vehicle.isPlayer ? "#151713" : "#ece6d5";
        context.font = `600 ${Math.max(6, 8 * scale)}px General Sans, sans-serif`;
        context.textAlign = "center";
        context.fillText(String(vehicle.number).padStart(2, "0"), 0, 23 * scale);
        if (vehicle.pin > 0.8) {
            context.strokeStyle = "#c75a43";
            context.lineWidth = 2;
            context.strokeRect(-21 * scale, -35 * scale, 42 * scale, 70 * scale);
        }
        context.restore();
    }

    function drawDust() {
        world.particles.forEach((particle) => {
            const point = worldToScreen(particle.x, particle.y);
            const alpha = clamp(particle.life / particle.maximumLife, 0, 1) * 0.32;
            context.globalAlpha = alpha;
            context.fillStyle = particle.colour;
            context.beginPath();
            context.arc(point.x, point.y, particle.radius * activeScale(), 0, TAU);
            context.fill();
        });
        context.globalAlpha = 1;
    }

    function drawResult() {
        context.save();
        context.fillStyle = "rgba(5,6,5,0.72)";
        context.fillRect(0, 0, world.width, world.height);
        context.translate(world.width * 0.5, world.height * 0.48);
        context.fillStyle = "#11130f";
        context.fillRect(-220, -94, 440, 188);
        context.strokeStyle = world.result === "finished" ? "#789d81" : "#b6503d";
        context.strokeRect(-220, -94, 440, 188);
        context.textAlign = "center";
        context.fillStyle = world.result === "finished" ? "#85ab8d" : "#ca5942";
        context.font = "600 9px General Sans, sans-serif";
        context.fillText(world.result === "finished" ? "OUTLET SECURED" : world.result === "sealed" ? "MONUMENT SEALED" : "VEHICLE LOST", 0, -49);
        context.fillStyle = "#eee8da";
        context.font = "500 37px Clash Display, General Sans, sans-serif";
        context.fillText(world.result === "finished" ? "MAZE CLEARED" : "NO ROUTE REMAINS", 0, 0);
        context.fillStyle = "rgba(238,232,218,0.58)";
        context.font = "500 10px General Sans, sans-serif";
        context.fillText(`${world.detail.toUpperCase()}  ·  USE RESTART HEAT TO RUN AGAIN`, 0, 35);
        context.restore();
    }

    function render() {
        const shakeX = (seeded(Math.floor(world.time * 80), 35) - 0.5) * world.shake * 7;
        const shakeY = (seeded(Math.floor(world.time * 76), 37) - 0.5) * world.shake * 7;
        context.setTransform(world.dpr, 0, 0, world.dpr, shakeX * world.dpr, shakeY * world.dpr);
        context.clearRect(-20, -20, world.width + 40, world.height + 40);
        drawGround();
        drawMudAndPits();
        drawTracks();
        drawStaticWalls();
        drawRetractors();
        drawShearDoors();
        drawExchange();
        drawCompactors();
        drawRollers();
        drawExits();
        allVehicles().slice().sort((first, second) => second.y - first.y).forEach(drawVehicle);
        drawDust();
        if (world.overview) {
            context.fillStyle = "rgba(9,10,9,0.76)";
            context.fillRect(world.width * 0.5 - 106, 21, 212, 28);
            context.fillStyle = "#e9e3d2";
            context.font = "600 9px General Sans, sans-serif";
            context.textAlign = "center";
            context.fillText("STRUCTURAL SURVEY / DRIVE CONTINUES", world.width * 0.5, 39);
        }
        if (world.result !== "racing") drawResult();
    }

    function renderMap() {
        const width = mapCanvas.width;
        const height = mapCanvas.height;
        mapContext.setTransform(1, 0, 0, 1, 0, 0);
        mapContext.fillStyle = "#10130f";
        mapContext.fillRect(0, 0, width, height);
        const scaleX = (width - 18) / (COLS * CELL);
        const scaleY = (height - 24) / (ROWS * CELL);
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (width - COLS * CELL * scale) * 0.5;
        const offsetY = height - 9;
        const project = (x, y) => ({ x: offsetX + (x - ORIGIN_X) * scale, y: offsetY - (y - ORIGIN_Y) * scale });
        mapContext.strokeStyle = "rgba(218,213,198,0.24)";
        mapContext.lineWidth = 2;
        staticWalls.forEach((wall) => {
            const first = project(wall.x1, wall.y1);
            const second = project(wall.x2, wall.y2);
            mapContext.beginPath();
            mapContext.moveTo(first.x, first.y);
            mapContext.lineTo(second.x, second.y);
            mapContext.stroke();
        });
        exits.forEach((exit) => {
            const point = project(exit.x, TOP);
            mapContext.fillStyle = exit.status === "open" ? "#71997c" : exit.status === "closing" ? "#c29a49" : "#9a4434";
            mapContext.fillRect(point.x - 3, point.y - 3, 6, 6);
        });
        rivals.filter((vehicle) => vehicle.active).forEach((vehicle) => {
            const point = project(vehicle.x, vehicle.y);
            mapContext.fillStyle = "rgba(190,193,181,0.58)";
            mapContext.fillRect(point.x - 1, point.y - 1, 2, 2);
        });
        const playerPoint = project(player.x, player.y);
        mapContext.fillStyle = "#d1ad4f";
        mapContext.beginPath();
        mapContext.arc(playerPoint.x, playerPoint.y, 3.4, 0, TAU);
        mapContext.fill();
        const viewHalfWidth = world.width / Math.max(0.01, activeScale()) * 0.5;
        const viewHalfHeight = world.height / Math.max(0.01, activeScale()) * 0.5;
        const topLeft = project(world.cameraX - viewHalfWidth, world.cameraY + viewHalfHeight);
        const bottomRight = project(world.cameraX + viewHalfWidth, world.cameraY - viewHalfHeight);
        mapContext.strokeStyle = "rgba(214,176,82,0.5)";
        mapContext.lineWidth = 1;
        mapContext.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    }

    function localSystem(vehicle) {
        for (let index = 0; index < shearDoors.length; index += 1) {
            const door = shearDoors[index];
            if (Math.abs(vehicle.y - door.y) < 220 && Math.abs(vehicle.x - door.x) < door.width * 0.6) return `Shear door ${index + 1}`;
        }
        if (Math.hypot(vehicle.x - exchange.x, vehicle.y - exchange.y) < 310) return "Corridor exchange";
        for (let index = 0; index < compactors.length; index += 1) {
            if (Math.hypot(vehicle.x - compactors[index].x, vehicle.y - compactors[index].y) < 340) return `Compactor ${index + 1}`;
        }
        for (let index = 0; index < rollers.length; index += 1) {
            const point = rollerGeometry(rollers[index]);
            if (Math.hypot(vehicle.x - point.x, vehicle.y - point.y) < 260) return `Roller corridor ${index + 1}`;
        }
        return worldCell(vehicle.x, vehicle.y).row < 2 ? "Launch court" : "Concrete maze";
    }

    function updateReadouts() {
        positionReadout.textContent = `${racePosition()} / ${STARTERS}`;
        const available = exits.filter((exit) => exit.status !== "closed");
        const nearest = available.length ? available.reduce((best, exit) => Math.abs(exit.x - player.x) < Math.abs(best.x - player.x) ? exit : best, available[0]) : null;
        exitReadout.textContent = nearest ? `North ${String(nearest.index + 1).padStart(2, "0")}` : "All sealed";
        systemReadout.textContent = localSystem(player);
        speedReadout.textContent = `${Math.round(player.speed * 0.36)} km/h`;
        resultReadout.textContent = world.result === "racing" ? `${STARTERS - world.eliminated} remain` : world.detail;
        const openCount = exits.filter((exit) => exit.status !== "closed").length;
        openExitsReadout.textContent = `${String(openCount).padStart(2, "0")} exit${openCount === 1 ? "" : "s"} open`;
        const closing = exits.find((exit) => exit.status === "closing");
        mapCopy.textContent = closing ? `Exit ${closing.index + 1} seals in ${Math.max(0, closing.duration - closing.timer).toFixed(1)} seconds.` : "Finish outlets are marked above the north wall.";
        const geometry = shearGeometry(shearDoors[0]);
        shearStatus.textContent = Math.abs(geometry.velocity) > 35 ? "Apertures translating" : "Direction reversing";
        const openShortcuts = retractors.filter((retractor) => retractorOpenness(retractor) > 0.7).length;
        deadEndStatus.textContent = `${String(openShortcuts).padStart(2, "0")} / 03 shortcuts open`;
        exchangeStatus.textContent = Math.sin(world.time / exchange.period * TAU) >= 0 ? "West feeding east" : "East feeding west";
        rollerStatus.textContent = "03 rollers moving";
        const compacting = compactors.filter((compactor) => compactorGeometry(compactor).compression > 0.6).length;
        compactorStatus.textContent = compacting ? `${String(compacting).padStart(2, "0")} chamber${compacting === 1 ? "" : "s"} closing` : "Tunnel bypasses open";
        dustStatus.textContent = `${Math.min(999, world.tracks.length)} track marks stored`;
        if (exitStatus) exitStatus.textContent = `${openCount} outlets available`;
        if (terrainStatus) terrainStatus.textContent = "Mud + floor breaks live";
        world.mapTimer -= 1 / 60;
        if (world.mapTimer <= 0) {
            world.mapTimer = 0.12;
            renderMap();
        }
    }

    function resize() {
        const width = Math.max(1, canvas.clientWidth || 1320);
        const height = Math.max(1, canvas.clientHeight || 940);
        world.dpr = Math.min(window.devicePixelRatio || 1, 2);
        world.width = width;
        world.height = height;
        world.scale = clamp(Math.min(width / 1650, height / 1250), 0.5, 0.84);
        canvas.width = Math.round(width * world.dpr);
        canvas.height = Math.round(height * world.dpr);
        render();
        renderMap();
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
            if (button.dataset.blindMonumentControl === name) button.classList.toggle("is-pressed", active);
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
    window.addEventListener("blur", () => ["throttle", "brake", "left", "right"].forEach((name) => setInput(name, false)));

    controlButtons.forEach((button) => {
        const name = button.dataset.blindMonumentControl;
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

    overviewButton.addEventListener("click", () => {
        world.overview = !world.overview;
        overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey maze";
    });
    resetButton.addEventListener("click", resetHeat);

    constructMaze();
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

    window.blindMonument = {
        resize,
        reset: resetHeat,
        setControl: (name, active) => setInput(name, Boolean(active)),
        setOverview: (active) => {
            world.overview = Boolean(active);
            overviewButton.textContent = world.overview ? "Follow vehicle" : "Survey maze";
        },
        diagnostics: () => ({
            result: world.result,
            detail: world.detail,
            time: world.time,
            player: {
                x: player.x,
                y: player.y,
                vx: player.vx,
                vy: player.vy,
                heading: player.heading,
                speed: player.speed,
                active: player.active,
                falling: player.falling,
                pin: player.pin,
                position: racePosition(),
                cell: worldCell(player.x, player.y)
            },
            activeRivals: rivals.filter((vehicle) => vehicle.active && !vehicle.finished).length,
            finishers: world.finishers,
            eliminated: world.eliminated,
            exits: exits.map((exit) => ({ status: exit.status, progress: exit.progress, finishers: exit.finishers })),
            tracks: world.tracks.length,
            shortcutsOpen: retractors.filter((retractor) => retractorOpenness(retractor) > 0.7).length,
            suggestedRoute: shortestPath(worldCell(player.x, player.y), openExitGoals()).map((entry) => ({ column: entry.column, row: entry.row }))
        })
    };

    requestAnimationFrame(animate);
})();
