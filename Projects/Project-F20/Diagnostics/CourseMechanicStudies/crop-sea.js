"use strict";

(() => {
    const canvas = document.getElementById("crop-sea-canvas");
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("crop-sea");
    const resetButton = document.getElementById("crop-sea-reset");
    const overviewButton = document.getElementById("crop-sea-overview");
    const positionReadout = document.getElementById("crop-sea-position-readout");
    const surfaceReadout = document.getElementById("crop-sea-surface-readout");
    const cutReadout = document.getElementById("crop-sea-cut-readout");
    const speedReadout = document.getElementById("crop-sea-speed-readout");
    const airReadout = document.getElementById("crop-sea-air-readout");
    const intakeReadout = document.getElementById("crop-sea-intake-readout");
    const intakeBar = document.getElementById("crop-sea-intake-bar");
    const intakeCopy = document.getElementById("crop-sea-intake-copy");
    const harvesterStatus = document.getElementById("crop-sea-harvester-status");
    const cropStatus = document.getElementById("crop-sea-crop-status");
    const irrigationStatus = document.getElementById("crop-sea-irrigation-status");
    const grainStatus = document.getElementById("crop-sea-grain-status");
    const dustStatus = document.getElementById("crop-sea-dust-status");
    const finishStatus = document.getElementById("crop-sea-finish-status");
    const buttons = Array.from(document.querySelectorAll("[data-crop-sea-control]"));

    const FIELD_WIDTH = 1500;
    const FIELD_LENGTH = 8400;
    const STARTERS = 24;
    const RADIUS = 23;
    const TAU = Math.PI * 2;
    const colours = ["#899087", "#9b7359", "#687e77", "#8a806b", "#a09882", "#6d756d", "#95614d"];
    const input = { throttle: false, brake: false, left: false, right: false };
    const world = { width: 1320, height: 940, dpr: 1, scale: .68, time: 0, lastTime: performance.now(), cameraY: 400, cameraV: 0, overview: false, result: "racing", detail: "Harvest active", finishers: 0, eliminated: 0, shake: 0, cuts: [], mud: [], particles: [], cutClock: 0, mudClock: 0, wasVisible: false };
    const harvesters = [
        { number: 1, x: -510, y: 180, speed: 93, width: 190, length: 138, phase: .2 },
        { number: 2, x: -180, y: -80, speed: 102, width: 205, length: 145, phase: 2.1 },
        { number: 3, x: 180, y: 80, speed: 98, width: 198, length: 142, phase: 4.3 },
        { number: 4, x: 510, y: -180, speed: 108, width: 188, length: 136, phase: 5.6 }
    ];
    const pivots = [
        { x: -150, y: 2850, length: 700, period: 13, phase: 0 },
        { x: 180, y: 5750, length: 730, period: 11.5, phase: 3.2 }
    ];
    const grainDrifts = [
        { x: 260, y: 1880, radius: 125, phase: .5 },
        { x: -310, y: 4380, radius: 145, phase: 2.8 },
        { x: 60, y: 6760, radius: 135, phase: 4.9 }
    ];
    const player = createCar(0, -90, true, 13);
    let rivals = [];

    function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
    function lerp(start, end, ratio) { return start + (end - start) * ratio; }
    function seeded(index, salt = 0) { const value = Math.sin(index * 93.11 + salt * 47.73) * 43758.54; return value - Math.floor(value); }
    function createCar(x, y, isPlayer, number) { return { x, y, vx: 0, vy: 0, heading: 0, speed: 0, isPlayer, number, colour: isPlayer ? "#c7a54a" : colours[number % colours.length], mass: isPlayer ? 1550 : 1250 + seeded(number, 2) * 900, active: true, finished: false, finishPosition: 0, intake: 0, flash: 0, targetX: x, aggression: .28 + seeded(number, 7) * .68 }; }
    function allCars() { return [player, ...rivals]; }
    function activeCars() { return allCars().filter((car) => car.active && !car.finished); }

    function reset() {
        Object.assign(player, createCar(45, -90, true, 13));
        rivals = [];
        for (let index = 0; index < 23; index += 1) {
            const lane = index % 8, row = Math.floor(index / 8);
            rivals.push(createCar(-560 + lane * 160 + (seeded(index, 3) - .5) * 24, -row * 75 + (seeded(index, 4) - .5) * 14, false, index + 1));
        }
        const starts = [180, -80, 80, -180];
        harvesters.forEach((machine, index) => { machine.y = starts[index]; machine.x = [-510, -180, 180, 510][index]; });
        Object.assign(world, { time: 0, cameraY: 400, cameraV: 0, overview: false, result: "racing", detail: "Harvest active", finishers: 0, eliminated: 0, shake: 0, cutClock: 0, mudClock: 0 });
        world.cuts.length = 0; world.mud.length = 0; world.particles.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey field";
        updateReadouts(); render();
    }

    function machineX(machine) {
        const weave = Math.sin(world.time * .12 + machine.phase) * 135;
        const convergence = clamp((machine.y - 6500) / 1800, 0, .82);
        return clamp(machine.x * (1 - convergence) + weave, -FIELD_WIDTH * .5 + machine.width * .55, FIELD_WIDTH * .5 - machine.width * .55);
    }

    function grainGeometry(drift) {
        return { x: drift.x + Math.sin(world.time * .22 + drift.phase) * 72, y: drift.y + Math.sin(world.time * .09 + drift.phase) * 24, radius: drift.radius + Math.sin(world.time * .31 + drift.phase) * 18 };
    }

    function pivotGeometry(pivot) {
        const angle = (world.time + pivot.phase) / pivot.period * TAU;
        return { angle, x2: pivot.x + Math.cos(angle) * pivot.length, y2: pivot.y + Math.sin(angle) * pivot.length, angularSpeed: TAU / pivot.period };
    }

    function inCut(x, y) {
        for (let index = world.cuts.length - 1; index >= 0; index -= 1) {
            const cut = world.cuts[index];
            if (cut.y < y - 130) break;
            if (Math.abs(cut.y - y) < 105 && Math.abs(cut.x - x) < cut.width * .52) return true;
        }
        return y < 80;
    }

    function inMud(x, y) {
        return world.mud.some((spot) => Math.hypot(x - spot.x, y - spot.y) < spot.radius);
    }

    function updateMachines(delta) {
        harvesters.forEach((machine) => {
            machine.y += machine.speed * delta;
            if (machine.y > FIELD_LENGTH + 500) machine.y = FIELD_LENGTH + 500;
        });
        world.cutClock -= delta;
        if (world.cutClock <= 0) {
            world.cutClock = .16;
            harvesters.forEach((machine) => {
                if (machine.y <= FIELD_LENGTH + 180) world.cuts.push({ x: machineX(machine), y: machine.y - machine.length * .5, width: machine.width });
            });
            world.cuts.sort((a, b) => a.y - b.y);
        }
        world.mudClock -= delta;
        if (world.mudClock <= 0) {
            world.mudClock = .22;
            pivots.forEach((pivot) => {
                const geometry = pivotGeometry(pivot);
                const ratio = .28 + seeded(Math.floor(world.time * 5), pivot.y) * .65;
                world.mud.push({ x: lerp(pivot.x, geometry.x2, ratio), y: lerp(pivot.y, geometry.y2, ratio), radius: 36 + seeded(pivot.y, Math.floor(world.time)) * 28, age: 0 });
            });
            if (world.mud.length > 420) world.mud.splice(0, world.mud.length - 420);
        }
        world.mud.forEach((spot) => { spot.age += delta; });
        world.mud = world.mud.filter((spot) => spot.age < 35);
    }

    function nearestMachine(car) {
        return harvesters.reduce((best, machine) => {
            const score = Math.abs(machine.y - car.y - 300) + Math.abs(machineX(machine) - car.x) * .35;
            const bestScore = Math.abs(best.y - car.y - 300) + Math.abs(machineX(best) - car.x) * .35;
            return score < bestScore ? machine : best;
        }, harvesters[0]);
    }

    function ai(car) {
        const machine = nearestMachine(car);
        let target = machineX(machine) + (car.number % 3 - 1) * 48;
        const grain = grainDrifts.map(grainGeometry).find((drift) => drift.y > car.y && drift.y - car.y < 230 && Math.abs(drift.x - car.x) < drift.radius + 55);
        if (grain) target += car.x <= grain.x ? -170 : 170;
        target = clamp(target, -FIELD_WIDTH * .5 + 40, FIELD_WIDTH * .5 - 40);
        car.targetX = target;
        return { throttle: .82 + car.aggression * .17, brake: 0, steering: clamp((target - car.x) / 135 - car.vx / 190, -1, 1) };
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished) return;
        car.flash = Math.max(0, car.flash - delta * 3.5);
        const cut = inCut(car.x, car.y);
        const mud = inMud(car.x, car.y);
        const cropDrag = cut ? 1 : .58;
        if (!cut) car.intake = clamp(car.intake + delta * (controls.throttle > .55 ? .055 : .018), 0, 1);
        else car.intake = Math.max(0, car.intake - delta * .042);
        const power = (1 - car.intake * .5) * cropDrag;
        const grip = mud ? .54 : cut ? .93 : .72;
        const speed = Math.hypot(car.vx, car.vy);
        if (controls.throttle > 0) { const force = 215 / (car.mass / 1550) * controls.throttle * power; car.vx += Math.sin(car.heading) * force * delta; car.vy += Math.cos(car.heading) * force * delta; }
        if (controls.brake > 0 && speed > 1) { const next = Math.max(0, speed - 245 * grip * controls.brake * delta); car.vx *= next / speed; car.vy *= next / speed; }
        car.heading += controls.steering * clamp(speed / 65, .14, 1) * (1.25 + grip * .72) * delta;
        const fx = Math.sin(car.heading), fy = Math.cos(car.heading), longitudinal = car.vx * fx + car.vy * fy, lateral = (car.vx * fy - car.vy * fx) * Math.pow(Math.max(.03, 1 - grip * 4 * delta), 1);
        car.vx = fx * longitudinal + fy * lateral; car.vy = fy * longitudinal - fx * lateral;
        const maximum = 405 * power + 45, driven = Math.hypot(car.vx, car.vy); if (driven > maximum) { car.vx *= maximum / driven; car.vy *= maximum / driven; }
        const rollingDrag = mud ? .965 : .991;
        car.vx *= Math.pow(rollingDrag, delta * 60); car.vy *= Math.pow(rollingDrag, delta * 60); car.x += car.vx * delta; car.y += car.vy * delta; car.speed = Math.hypot(car.vx, car.vy);
        if (Math.abs(car.x) > FIELD_WIDTH * .5 - 30) { const side = Math.sign(car.x); car.x = side * (FIELD_WIDTH * .5 - 30); car.vx *= -.28; car.flash = 1; }
        grainDrifts.forEach((source) => {
            const drift = grainGeometry(source), dx = car.x - drift.x, dy = car.y - drift.y, distance = Math.hypot(dx, dy);
            if (distance < drift.radius) { const depth = 1 - distance / drift.radius; car.vx *= Math.pow(.42, delta * depth); car.vy *= Math.pow(.42, delta * depth); car.x += (dx / Math.max(1, distance)) * depth * 10 * delta; }
        });
        if (!cut && car.speed > 95 && seeded(car.number + Math.floor(world.time * 8), 9) > .78) dust(car.x, car.y, "#baa66b", 1);
        if (car.y >= FIELD_LENGTH) finish(car);
    }

    function collideMachines(car) {
        harvesters.forEach((machine) => {
            const x = machineX(machine), halfW = machine.width * .5, halfL = machine.length * .5;
            const nearestX = clamp(car.x, x - halfW, x + halfW), nearestY = clamp(car.y, machine.y - halfL, machine.y + halfL), dx = car.x - nearestX, dy = car.y - nearestY;
            if (dx * dx + dy * dy >= RADIUS * RADIUS) return;
            const length = Math.max(.01, Math.hypot(dx, dy)); let nx = dx / length, ny = dy / length; if (length < .1) { nx = car.x < x ? -1 : 1; ny = 0; }
            car.x += nx * (RADIUS - length + 1); car.y += ny * (RADIUS - length + 1); car.vx += nx * 32; car.vy = Math.max(car.vy, machine.speed * .68); car.flash = 1; if (car.isPlayer) world.shake = .55;
        });
    }

    function collidePivots(car) {
        pivots.forEach((pivot) => {
            const geometry = pivotGeometry(pivot), dx = geometry.x2 - pivot.x, dy = geometry.y2 - pivot.y, lengthSq = dx * dx + dy * dy, ratio = clamp(((car.x - pivot.x) * dx + (car.y - pivot.y) * dy) / lengthSq, 0, 1), px = pivot.x + dx * ratio, py = pivot.y + dy * ratio, ox = car.x - px, oy = car.y - py, distance = Math.hypot(ox, oy), minimum = RADIUS + 12;
            if (distance >= minimum || distance < .01) return; const nx = ox / distance, ny = oy / distance; car.x += nx * (minimum - distance); car.y += ny * (minimum - distance); const tangential = geometry.angularSpeed * pivot.length * ratio; car.vx += -Math.sin(geometry.angle) * tangential * .32; car.vy += Math.cos(geometry.angle) * tangential * .32; car.flash = 1; if (car.isPlayer) world.shake = .65;
        });
    }

    function collideCars() {
        const cars = activeCars();
        for (let a = 0; a < cars.length; a += 1) for (let b = a + 1; b < cars.length; b += 1) { const first = cars[a], second = cars[b], dx = second.x - first.x, dy = second.y - first.y, distance = Math.hypot(dx, dy), minimum = RADIUS * 2; if (distance >= minimum || distance < .01) continue; const nx = dx / distance, ny = dy / distance, overlap = minimum - distance; first.x -= nx * overlap * .5; first.y -= ny * overlap * .5; second.x += nx * overlap * .5; second.y += ny * overlap * .5; const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny; if (relative < 0) { first.vx += relative * nx * .55; first.vy += relative * ny * .55; second.vx -= relative * nx * .55; second.vy -= relative * ny * .55; first.flash = second.flash = 1; } }
    }

    function finish(car) { if (car.finished) return; car.finished = true; car.active = false; world.finishers += 1; car.finishPosition = world.finishers; if (car.isPlayer) { world.result = "finished"; world.detail = car.finishPosition === 1 ? "First to the loading line" : `Finished P${car.finishPosition}`; } }
    function dust(x, y, colour, count) { for (let index = 0; index < count; index += 1) { const angle = seeded(index + world.time * 100, count) * TAU, speed = 10 + seeded(index, 5) * 48; world.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: 5 + seeded(index, 8) * 13, life: .8 + seeded(index, 10) * 1.1, max: 1.9, colour }); } if (world.particles.length > 280) world.particles.splice(0, world.particles.length - 280); }
    function updateParticles(delta) { world.particles.forEach((particle) => { particle.x += particle.vx * delta; particle.y += particle.vy * delta; particle.vx *= Math.pow(.12, delta); particle.vy *= Math.pow(.12, delta); particle.radius += delta * 4; particle.life -= delta; }); world.particles = world.particles.filter((particle) => particle.life > 0); }
    function racePosition() { if (player.finished) return player.finishPosition; return clamp(rivals.filter((car) => car.finished || (car.active && car.y > player.y)).length + 1, 1, STARTERS); }

    function update(delta) {
        world.time += delta;
        if (world.result !== "racing") { updateParticles(delta); updateReadouts(); return; }
        updateMachines(delta);
        rivals.forEach((car) => updateCar(car, delta, ai(car)));
        updateCar(player, delta, { throttle: input.throttle ? 1 : 0, brake: input.brake ? 1 : 0, steering: (input.left ? -1 : 0) + (input.right ? 1 : 0) });
        activeCars().forEach((car) => { collideMachines(car); collidePivots(car); });
        collideCars(); updateParticles(delta);
        const target = world.overview ? FIELD_LENGTH * .5 : player.y + 390; world.cameraV += (target - world.cameraY) * Math.min(1, delta * 5); world.cameraV *= Math.pow(.004, delta); world.cameraY += world.cameraV * delta; world.shake = Math.max(0, world.shake - delta * 2); updateReadouts();
    }

    function activeScale() { return world.overview ? Math.min((world.width - 80) / (FIELD_WIDTH + 150), (world.height - 70) / (FIELD_LENGTH + 250)) : world.scale; }
    function point(x, y) { const scale = activeScale(); return { x: world.width * .5 + x * scale, y: world.height * .68 - (y - world.cameraY) * scale }; }
    function drawField() {
        context.fillStyle = "#171a12"; context.fillRect(0, 0, world.width, world.height); const scale = activeScale(), left = world.width * .5 - FIELD_WIDTH * .5 * scale, right = world.width * .5 + FIELD_WIDTH * .5 * scale;
        context.fillStyle = "#67642d"; context.fillRect(left, 0, right - left, world.height);
        const firstX = Math.floor(-FIELD_WIDTH * .5 / 34) * 34;
        for (let x = firstX; x < FIELD_WIDTH * .5; x += 34) { const sx = point(x, 0).x; context.strokeStyle = x % 68 === 0 ? "rgba(221,200,92,.25)" : "rgba(74,72,28,.4)"; context.lineWidth = 4 * scale; context.beginPath(); context.moveTo(sx, 0); context.lineTo(sx, world.height); context.stroke(); }
        world.cuts.forEach((cut) => { const p = point(cut.x, cut.y); if (p.y < -80 || p.y > world.height + 80) return; context.fillStyle = "rgba(112,91,47,.82)"; context.fillRect(p.x - cut.width * scale * .5, p.y - 58 * scale, cut.width * scale, 116 * scale); context.strokeStyle = "rgba(221,198,130,.2)"; context.lineWidth = 1; context.beginPath(); context.moveTo(p.x - cut.width * scale * .42, p.y - 58 * scale); context.lineTo(p.x - cut.width * scale * .42, p.y + 58 * scale); context.moveTo(p.x + cut.width * scale * .42, p.y - 58 * scale); context.lineTo(p.x + cut.width * scale * .42, p.y + 58 * scale); context.stroke(); });
        world.mud.forEach((spot) => { const p = point(spot.x, spot.y), r = spot.radius * scale; if (p.y < -80 || p.y > world.height + 80) return; context.globalAlpha = clamp((35 - spot.age) / 8, 0, 1) * .65; context.fillStyle = "#4f4634"; context.beginPath(); context.arc(p.x, p.y, r, 0, TAU); context.fill(); }); context.globalAlpha = 1;
        grainDrifts.forEach((source) => { const drift = grainGeometry(source), p = point(drift.x, drift.y), r = drift.radius * scale; context.fillStyle = "#a78b4d"; context.beginPath(); context.ellipse(p.x, p.y, r, r * .58, 0, 0, TAU); context.fill(); context.strokeStyle = "#d0b66d"; context.lineWidth = 2; context.stroke(); });
        drawPivots(); harvesters.forEach(drawMachine);
        const finish = point(0, FIELD_LENGTH); context.fillStyle = "#e4dfcb"; context.fillRect(left, finish.y - 9, right - left, 18); context.fillStyle = "rgba(11,12,9,.85)"; context.fillRect(world.width*.5-92,finish.y-48,184,25);context.fillStyle="#eee8d8";context.font="600 9px General Sans";context.textAlign="center";context.fillText("NORTH LOADING LINE",world.width*.5,finish.y-31);
    }
    function drawMachine(machine) { const scale = activeScale(), p = point(machineX(machine), machine.y); if (p.y < -140 || p.y > world.height + 140) return; context.save(); context.translate(p.x, p.y); context.fillStyle = "rgba(0,0,0,.38)"; context.fillRect(-machine.width*scale*.5+6,-machine.length*scale*.5+8,machine.width*scale,machine.length*scale); context.fillStyle = "#a4812e"; context.fillRect(-machine.width*scale*.38,-machine.length*scale*.42,machine.width*scale*.76,machine.length*scale*.82); context.fillStyle = "#20251f"; context.fillRect(-machine.width*scale*.26,-machine.length*scale*.18,machine.width*scale*.52,machine.length*scale*.26); context.fillStyle = "#8d712d"; context.fillRect(-machine.width*scale*.55,-machine.length*scale*.58,machine.width*scale*1.1,18*scale); context.strokeStyle = "#d1b55e"; context.lineWidth = 3; for(let tooth=-4;tooth<=4;tooth++){context.beginPath();context.moveTo(tooth*machine.width*scale*.11,-machine.length*scale*.58);context.lineTo(tooth*machine.width*scale*.11,-machine.length*scale*.7);context.stroke();} context.fillStyle="#e6dcb9";context.font="600 9px General Sans";context.textAlign="center";context.fillText(`H${machine.number}`,0,18*scale);context.restore(); }
    function drawPivots(){const scale=activeScale();pivots.forEach((pivot,index)=>{const g=pivotGeometry(pivot),a=point(pivot.x,pivot.y),b=point(g.x2,g.y2);context.strokeStyle="rgba(0,0,0,.35)";context.lineWidth=12*scale;context.beginPath();context.moveTo(a.x+4,a.y+5);context.lineTo(b.x+4,b.y+5);context.stroke();context.strokeStyle="#9d9c8c";context.lineWidth=7*scale;context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();context.fillStyle="#555b50";context.beginPath();context.arc(a.x,a.y,20*scale,0,TAU);context.fill();context.fillStyle="#d7cfad";context.font="600 7px General Sans";context.fillText(`IRRIGATION ${index+1}`,a.x+8,a.y-16);});}
    function drawCar(car){if(!car.active&&!car.finished)return;const p=point(car.x,car.y);if(p.y<-80||p.y>world.height+80)return;const scale=activeScale();context.save();context.translate(p.x,p.y);context.rotate(car.heading);context.fillStyle="rgba(0,0,0,.34)";context.fillRect(-16*scale+4,-29*scale+6,32*scale,58*scale);context.fillStyle=car.flash>0?"#e1d7b7":car.colour;context.fillRect(-16*scale,-29*scale,32*scale,58*scale);context.fillStyle="#1f251f";context.fillRect(-11*scale,-10*scale,22*scale,21*scale);context.strokeStyle=car.isPlayer?"#efdc9e":"rgba(234,231,214,.48)";context.lineWidth=car.isPlayer?2:1;context.strokeRect(-16*scale,-29*scale,32*scale,58*scale);context.restore();if(!inCut(car.x,car.y)){context.strokeStyle="rgba(210,192,80,.72)";context.lineWidth=Math.max(2,5*scale);[-17,0,18].forEach((offset)=>{context.beginPath();context.moveTo(p.x+offset*scale,p.y+32*scale);context.lineTo(p.x+(offset+5)*scale,p.y-31*scale);context.stroke();});}}
    function drawParticles(){world.particles.forEach((particle)=>{const p=point(particle.x,particle.y);context.globalAlpha=clamp(particle.life/particle.max,0,1)*.34;context.fillStyle=particle.colour;context.beginPath();context.arc(p.x,p.y,particle.radius*activeScale(),0,TAU);context.fill();});context.globalAlpha=1;}
    function render(){const shakeX=(seeded(Math.floor(world.time*75),2)-.5)*world.shake*7;context.setTransform(world.dpr,0,0,world.dpr,shakeX*world.dpr,0);context.clearRect(-20,-20,world.width+40,world.height+40);drawField();allCars().slice().sort((a,b)=>b.y-a.y).forEach(drawCar);drawParticles();if(world.result!=="racing"){context.fillStyle="rgba(5,6,4,.7)";context.fillRect(0,0,world.width,world.height);context.fillStyle="#eee8da";context.font="500 40px Clash Display";context.textAlign="center";context.fillText("LOADING LINE SECURED",world.width*.5,world.height*.5);}}

    function updateReadouts(){const cut=inCut(player.x,player.y),mud=inMud(player.x,player.y),machine=nearestMachine(player);positionReadout.textContent=`${racePosition()} / ${STARTERS}`;surfaceReadout.textContent=mud?"Irrigated mud":cut?"Fresh cut":"Standing crop";cutReadout.textContent=`Machine ${String(machine.number).padStart(2,"0")}`;speedReadout.textContent=`${Math.round(player.speed*.36)} km/h`;airReadout.textContent=world.result!=="racing"?world.detail:player.intake>.7?"Severely clogged":player.intake>.35?"Restricted":"Clear";const percent=Math.round(player.intake*100);intakeReadout.textContent=`${percent}%`;intakeBar.style.width=`${percent}%`;intakeCopy.textContent=cut?"Fresh-cut wake clearing intake":player.intake>.55?"Lift throttle or find a machine wake":"Standing crop entering intake";harvesterStatus.textContent=`${harvesters.filter((machine)=>machine.y<FIELD_LENGTH).length} machines cutting`;cropStatus.textContent=cut?"Player inside harvested wake":"Field uncut around player";irrigationStatus.textContent=pivots.some((pivot)=>Math.abs(player.y-pivot.y)<500)?"Pivot crossing nearby":"Two arms rotating";grainStatus.textContent=`${grainDrifts.length} active drifts`;dustStatus.textContent=player.intake>.4?"Intake load increasing":"Wake forming";finishStatus.textContent=world.finishers?`${world.finishers} finishers recorded`:"North gate open";}
    function resize(){const width=Math.max(1,canvas.clientWidth||1320),height=Math.max(1,canvas.clientHeight||940);world.dpr=Math.min(window.devicePixelRatio||1,2);world.width=width;world.height=height;world.scale=clamp(Math.min(width/1700,height/1280),.48,.8);canvas.width=Math.round(width*world.dpr);canvas.height=Math.round(height*world.dpr);render();}
    const keyMap={w:"throttle",arrowup:"throttle",s:"brake",arrowdown:"brake",a:"left",arrowleft:"left",d:"right",arrowright:"right"};function setControl(name,on){if(!(name in input))return;input[name]=on;buttons.forEach((button)=>{if(button.dataset.cropSeaControl===name)button.classList.toggle("is-pressed",on);});}
    window.addEventListener("keydown",(event)=>{const name=keyMap[event.key.toLowerCase()];if(!name||page.hidden)return;event.preventDefault();setControl(name,true);});window.addEventListener("keyup",(event)=>{const name=keyMap[event.key.toLowerCase()];if(name)setControl(name,false);});window.addEventListener("blur",()=>Object.keys(input).forEach((name)=>setControl(name,false)));buttons.forEach((button)=>{const name=button.dataset.cropSeaControl;const down=(event)=>{event.preventDefault();setControl(name,true);};const up=(event)=>{event.preventDefault();setControl(name,false);};button.addEventListener("pointerdown",down);button.addEventListener("pointerup",up);button.addEventListener("pointercancel",up);});
    resetButton.addEventListener("click",reset);overviewButton.addEventListener("click",()=>{world.overview=!world.overview;overviewButton.textContent=world.overview?"Follow vehicle":"Survey field";});
    reset();function animate(time){const delta=Math.min(.04,Math.max(0,(time-world.lastTime)/1000));world.lastTime=time;const visible=!page.hidden&&document.visibilityState!=="hidden";if(visible){world.wasVisible=true;update(delta);render();}else if(world.wasVisible){world.wasVisible=false;world.lastTime=time;}requestAnimationFrame(animate);}if(typeof ResizeObserver!=="undefined")new ResizeObserver(resize).observe(canvas);else window.addEventListener("resize",resize);
    window.cropSea={resize,reset,setControl,diagnostics:()=>({result:world.result,detail:world.detail,time:world.time,player:{x:player.x,y:player.y,vx:player.vx,vy:player.vy,speed:player.speed,heading:player.heading,active:player.active,position:racePosition(),intake:player.intake,inCut:inCut(player.x,player.y),inMud:inMud(player.x,player.y)},finishers:world.finishers,activeRivals:rivals.filter((car)=>car.active&&!car.finished).length,cuts:world.cuts.length,mud:world.mud.length,harvesters:harvesters.map((machine)=>({x:machineX(machine),y:machine.y}))})};requestAnimationFrame(animate);
})();
