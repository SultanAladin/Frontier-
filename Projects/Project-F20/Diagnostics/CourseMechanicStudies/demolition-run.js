"use strict";

(() => {
    const canvas = document.getElementById("demolition-canvas");
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("demolition-run");
    const resetButton = document.getElementById("demolition-reset");
    const overviewButton = document.getElementById("demolition-overview");
    const positionReadout = document.getElementById("demolition-position-readout");
    const levelReadout = document.getElementById("demolition-level-readout");
    const frontReadout = document.getElementById("demolition-front-readout");
    const speedReadout = document.getElementById("demolition-speed-readout");
    const resultReadout = document.getElementById("demolition-result-readout");
    const windowReadout = document.getElementById("demolition-window-readout");
    const windowBar = document.getElementById("demolition-window-bar");
    const windowCopy = document.getElementById("demolition-window-copy");
    const spineStatus = document.getElementById("demolition-spine-status");
    const floorStatus = document.getElementById("demolition-floor-status");
    const facadeStatus = document.getElementById("demolition-facade-status");
    const rubbleStatus = document.getElementById("demolition-rubble-status");
    const dustStatus = document.getElementById("demolition-dust-status");
    const exitStatus = document.getElementById("demolition-exit-status");
    const buttons = Array.from(document.querySelectorAll("[data-demolition-control]"));

    const WIDTH = 960;
    const LENGTH = 7800;
    const STARTERS = 24;
    const RADIUS = 23;
    const TAU = Math.PI * 2;
    const colours = ["#8d9389", "#9e765d", "#687f7a", "#89816e", "#a19a85", "#6e7770", "#99634f"];
    const input = { throttle: false, brake: false, left: false, right: false };
    const world = { width: 1300, height: 920, dpr: 1, scale: 0.72, time: 0, lastTime: performance.now(), cameraY: 380, cameraV: 0, overview: false, result: "racing", detail: "Structure active", front: -700, shake: 0, finishers: 0, eliminated: 0, particles: [], rubble: [], wasVisible: false };
    const levels = Array.from({ length: 6 }, (_, index) => ({ index, start: 850 + index * 1120, state: "armed", timer: 0, duration: 5.2, side: index % 2 ? 1 : -1 }));
    const player = vehicle(0, -80, true, 11);
    let rivals = [];

    function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smooth(value) { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
    function seeded(index, salt = 0) { const value = Math.sin(index * 91.17 + salt * 47.31) * 43758.54; return value - Math.floor(value); }
    function vehicle(x, y, isPlayer, number) { return { x, y, vx: 0, vy: 0, heading: 0, speed: 0, isPlayer, number, colour: isPlayer ? "#c7a54a" : colours[number % colours.length], mass: isPlayer ? 1580 : 1250 + seeded(number, 2) * 900, active: true, finished: false, finishPosition: 0, falling: 0, fallCause: "", grip: 1, dust: 0, acid: 0, air: 1, impact: 0, flash: 0, targetX: x, aggression: 0.3 + seeded(number, 7) * 0.65 }; }
    function all() { return [player, ...rivals]; }
    function active() { return all().filter((car) => car.active && !car.finished && car.falling === 0); }

    function reset() {
        Object.assign(player, vehicle(45, -90, true, 11));
        rivals = [];
        for (let index = 0; index < 23; index += 1) {
            const lane = index % 8;
            const row = Math.floor(index / 8);
            rivals.push(vehicle(-350 + lane * 100 + (seeded(index, 3) - 0.5) * 22, -row * 76 + (seeded(index, 4) - 0.5) * 14, false, index + 1));
        }
        levels.forEach((level) => { level.state = "armed"; level.timer = 0; });
        Object.assign(world, { time: 0, cameraY: 380, cameraV: 0, overview: false, result: "racing", detail: "Structure active", front: -700, shake: 0, finishers: 0, eliminated: 0 });
        world.particles.length = 0; world.rubble.length = 0;
        Object.keys(input).forEach((key) => { input[key] = false; });
        overviewButton.textContent = "Survey structure";
        updateReadouts(); render();
    }

    function triggerLevel(level) {
        if (level.state !== "armed") return;
        level.state = "firing"; level.timer = 0;
        dustBurst(0, level.start, 12, "#d0a24f");
    }

    function updateLevels(delta) {
        const lead = Math.max(...active().map((car) => car.y), player.y);
        levels.forEach((level) => {
            if (level.state === "armed" && lead > level.start - 460) triggerLevel(level);
            if (level.state === "armed" || level.state === "settled") return;
            level.timer += delta;
            if (level.state === "firing" && level.timer > 2.0) { level.state = "falling"; level.timer = 0; dustBurst(level.side * 170, level.start + 260, 38, "#a79b82"); world.shake = 0.8; }
            else if (level.state === "falling" && level.timer > level.duration) {
                level.state = "settled"; level.timer = 0;
                for (let index = 0; index < 5; index += 1) world.rubble.push({ x: (seeded(index, level.index) - 0.5) * 680, y: level.start + 80 + seeded(index, 9) * 560, radius: 24 + seeded(index, 11) * 34 });
            }
        });
        world.front = Math.max(-700, world.time > 8 ? (world.time - 8) * 57 : -700);
    }

    function slabDanger(car) {
        return levels.find((level) => level.state === "falling" && car.y > level.start && car.y < level.start + 650 && Math.sign(car.x || 1) === level.side && Math.abs(car.x) > 75);
    }

    function beginFall(car, cause) {
        if (!car.active || car.finished || car.falling > 0) return;
        car.falling = 0.001; car.fallCause = cause; world.eliminated += 1;
        if (car.isPlayer) world.detail = cause === "front" ? "Caught by the rubble front" : "Floor released beneath vehicle";
        dustBurst(car.x, car.y, 16, "#aa9e85"); world.shake = Math.max(world.shake, car.isPlayer ? 1 : 0.3);
    }

    function ai(car) {
        let target = car.targetX;
        const next = levels.find((level) => car.y < level.start + 700 && level.state !== "settled");
        if (next && next.state === "falling" && Math.sign(target || 1) === next.side) target = -next.side * 210;
        else if (Math.abs(target) > 370) target *= 0.98;
        const rubble = world.rubble.find((rock) => rock.y > car.y && rock.y - car.y < 180 && Math.abs(rock.x - car.x) < rock.radius + 36);
        if (rubble) target += car.x <= rubble.x ? -120 : 120;
        target = clamp(target, -415, 415); car.targetX = target;
        return { throttle: 0.82 + car.aggression * 0.17, brake: 0, steering: clamp((target - car.x) / 125 - car.vx / 190, -1, 1) };
    }

    function updateCar(car, delta, controls) {
        if (!car.active || car.finished) return;
        car.flash = Math.max(0, car.flash - delta * 3.5); car.impact = Math.max(0, car.impact - delta * 1.8);
        if (car.falling > 0) { car.falling += delta; car.vx *= Math.pow(0.08, delta); car.vy *= Math.pow(0.08, delta); if (car.falling > 1.1) { car.active = false; if (car.isPlayer && world.result === "racing") world.result = "eliminated"; } return; }
        const exterior = Math.abs(car.x) > 315;
        if (exterior) car.acid = clamp(car.acid + delta * 0.045, 0, 1); else car.acid = Math.max(0, car.acid - delta * 0.01);
        const localLevel = levels.find((level) => car.y > level.start && car.y < level.start + 650 && (level.state === "falling" || level.state === "settled"));
        if (localLevel && Math.abs(car.x) < 290) car.dust = clamp(car.dust + delta * (controls.throttle > 0.5 ? 0.075 : 0.025), 0, 1); else car.dust = Math.max(0, car.dust - delta * 0.035);
        car.air = Math.abs(car.x) < 145 && localLevel ? 0.58 : 1;
        const grip = 0.94 - car.acid * 0.38;
        const power = (1 - car.dust * 0.52) * car.air;
        const speed = Math.hypot(car.vx, car.vy);
        if (controls.throttle > 0) { const force = (205 / (car.mass / 1580)) * controls.throttle * power; car.vx += Math.sin(car.heading) * force * delta; car.vy += Math.cos(car.heading) * force * delta; }
        if (controls.brake > 0 && speed > 1) { const next = Math.max(0, speed - 245 * grip * controls.brake * delta); car.vx *= next / speed; car.vy *= next / speed; }
        car.heading += controls.steering * clamp(speed / 65, 0.14, 1) * (1.25 + grip * 0.7) * delta;
        const fx = Math.sin(car.heading), fy = Math.cos(car.heading); const longitudinal = car.vx * fx + car.vy * fy; const lateral = (car.vx * fy - car.vy * fx) * Math.pow(Math.max(0.03, 1 - grip * 4 * delta), 1); car.vx = fx * longitudinal + fy * lateral; car.vy = fy * longitudinal - fx * lateral;
        const maximum = 390 * power + 55; const driven = Math.hypot(car.vx, car.vy); if (driven > maximum) { car.vx *= maximum / driven; car.vy *= maximum / driven; }
        car.vx *= Math.pow(0.991, delta * 60); car.vy *= Math.pow(0.991, delta * 60); car.x += car.vx * delta; car.y += car.vy * delta; car.speed = Math.hypot(car.vx, car.vy);
        if (Math.abs(car.x) > WIDTH * 0.5 - 28) { const side = Math.sign(car.x); car.x = side * (WIDTH * 0.5 - 28); car.vx *= -0.3; car.flash = 1; }
        if (slabDanger(car)) beginFall(car, "slab");
        if (car.y < world.front - 80) beginFall(car, "front");
        world.rubble.forEach((rock) => { const dx = car.x - rock.x, dy = car.y - rock.y, distance = Math.hypot(dx, dy), minimum = rock.radius + RADIUS; if (distance < minimum && distance > 0.01) { const nx = dx / distance, ny = dy / distance; car.x += nx * (minimum - distance); car.y += ny * (minimum - distance); car.vx += nx * 28; car.vy += ny * 28; car.flash = 1; } });
        if (car.y >= LENGTH) finish(car);
    }

    function collideCars() {
        const cars = active();
        for (let a = 0; a < cars.length; a += 1) for (let b = a + 1; b < cars.length; b += 1) { const first = cars[a], second = cars[b], dx = second.x - first.x, dy = second.y - first.y, distance = Math.hypot(dx, dy), minimum = RADIUS * 2; if (distance >= minimum || distance < 0.01) continue; const nx = dx / distance, ny = dy / distance, overlap = minimum - distance; first.x -= nx * overlap * 0.5; first.y -= ny * overlap * 0.5; second.x += nx * overlap * 0.5; second.y += ny * overlap * 0.5; const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny; if (relative < 0) { first.vx += relative * nx * 0.55; first.vy += relative * ny * 0.55; second.vx -= relative * nx * 0.55; second.vy -= relative * ny * 0.55; first.flash = second.flash = 1; } }
    }

    function finish(car) { if (car.finished) return; car.finished = true; car.active = false; world.finishers += 1; car.finishPosition = world.finishers; if (car.isPlayer) { world.result = "finished"; world.detail = car.finishPosition === 1 ? "First clear of Floor Zero" : `Finished P${car.finishPosition}`; } }
    function dustBurst(x, y, count, colour) { for (let index = 0; index < count; index += 1) { const angle = seeded(index + world.time * 100, count) * TAU, speed = 15 + seeded(index, 6) * 90; world.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: 5 + seeded(index, 8) * 16, life: 1 + seeded(index, 10), max: 2, colour }); } if (world.particles.length > 260) world.particles.splice(0, world.particles.length - 260); }
    function updateParticles(delta) { world.particles.forEach((particle) => { particle.x += particle.vx * delta; particle.y += particle.vy * delta; particle.vx *= Math.pow(0.1, delta); particle.vy *= Math.pow(0.1, delta); particle.radius += delta * 5; particle.life -= delta; }); world.particles = world.particles.filter((particle) => particle.life > 0); }
    function position() { if (player.finished) return player.finishPosition; return clamp(rivals.filter((car) => car.finished || (car.active && car.y > player.y)).length + 1, 1, STARTERS); }

    function update(delta) {
        world.time += delta; if (world.result !== "racing") { updateParticles(delta); updateReadouts(); return; }
        updateLevels(delta); rivals.forEach((car) => updateCar(car, delta, ai(car))); updateCar(player, delta, { throttle: input.throttle ? 1 : 0, brake: input.brake ? 1 : 0, steering: (input.left ? -1 : 0) + (input.right ? 1 : 0) }); collideCars(); updateParticles(delta);
        const target = world.overview ? LENGTH * 0.5 : player.y + 380; world.cameraV += (target - world.cameraY) * Math.min(1, delta * 5); world.cameraV *= Math.pow(0.004, delta); world.cameraY += world.cameraV * delta; world.shake = Math.max(0, world.shake - delta * 2); updateReadouts();
    }

    function scale() { return world.overview ? Math.min((world.width - 90) / (WIDTH + 160), (world.height - 70) / (LENGTH + 300)) : world.scale; }
    function point(x, y) { const s = scale(); return { x: world.width * 0.5 + x * s, y: world.height * 0.68 - (y - world.cameraY) * s }; }
    function drawWorld() {
        context.fillStyle = "#171a17"; context.fillRect(0, 0, world.width, world.height); const s = scale(); const left = world.width * 0.5 - WIDTH * 0.5 * s, right = world.width * 0.5 + WIDTH * 0.5 * s;
        context.fillStyle = "#64655e"; context.fillRect(left, 0, right - left, world.height);
        const first = Math.floor((world.cameraY - world.height / s) / 180) * 180; for (let y = first; y < world.cameraY + world.height / s; y += 180) { const p = point(0, y); context.fillStyle = "rgba(18,20,17,.28)"; context.fillRect(left, p.y, right - left, 2); }
        for (let column = -2; column <= 2; column += 1) { context.setLineDash([13, 15]); context.strokeStyle = "rgba(232,225,205,.16)"; context.beginPath(); context.moveTo(point(column * 160, 0).x, 0); context.lineTo(point(column * 160, 0).x, world.height); context.stroke(); } context.setLineDash([]);
        levels.forEach((level) => drawLevel(level, left, right));
        world.rubble.forEach((rock) => { const p = point(rock.x, rock.y), r = rock.radius * s; context.fillStyle = "#4b4c46"; context.beginPath(); context.moveTo(p.x-r,p.y+r*.3); context.lineTo(p.x-r*.2,p.y-r); context.lineTo(p.x+r,p.y-r*.1); context.lineTo(p.x+r*.5,p.y+r); context.closePath(); context.fill(); context.strokeStyle="#8b8575";context.stroke(); });
        const front = point(0, world.front); context.fillStyle = "rgba(87,75,62,.8)"; context.fillRect(left, front.y, right-left, world.height-front.y); context.strokeStyle="#bb5943";context.lineWidth=3;context.beginPath();context.moveTo(left,front.y);context.lineTo(right,front.y);context.stroke();
        const finish = point(0,LENGTH); context.fillStyle="#e7e1cf";context.fillRect(left,finish.y-8,right-left,16);
    }
    function drawLevel(level,left,right) { const s=scale(), start=point(0,level.start), end=point(0,level.start+650), progress=level.state==="falling"?smooth(level.timer/level.duration):level.state==="settled"?1:0; context.fillStyle="rgba(10,11,9,.75)";context.fillRect(left,start.y-25,150,22);context.fillStyle="#e8e1cf";context.font="600 8px General Sans";context.fillText(`LEVEL ${6-level.index} / ${level.state.toUpperCase()}`,left+10,start.y-11); if(level.state!=="armed"){const x=world.width*.5+level.side*WIDTH*.25*s;context.fillStyle=level.state==="firing"?"rgba(207,159,70,.22)":"rgba(21,16,14,.74)";context.fillRect(level.side<0?left:x, end.y, WIDTH*.5*s, start.y-end.y);context.strokeStyle=level.state==="firing"?"#d2a04b":"#ba543f";context.lineWidth=2;context.strokeRect(level.side<0?left:x,end.y,WIDTH*.5*s,start.y-end.y);}
        if(level.state==="firing"){const pulse=clamp(level.timer/2,0,1);context.strokeStyle="#d4a24d";context.lineWidth=4;context.beginPath();context.moveTo(left,start.y);context.lineTo(lerp(left,right,pulse),start.y);context.stroke();} if(progress>0){context.fillStyle=`rgba(177,166,141,${.18*progress})`;context.fillRect(left,end.y,right-left,start.y-end.y);} }
    function drawCar(car) { if(!car.active&&!car.finished)return; const p=point(car.x,car.y);if(p.y<-80||p.y>world.height+80)return;const s=scale(),fall=car.falling?clamp(car.falling/1.1,0,1):0;context.save();context.translate(p.x,p.y+fall*24);context.rotate(car.heading);context.globalAlpha=1-fall*.75;context.fillStyle="rgba(0,0,0,.35)";context.fillRect(-16*s+4,-29*s+6,32*s,58*s);context.fillStyle=car.flash>0?"#e3d9b9":car.colour;context.fillRect(-16*s,-29*s,32*s,58*s);context.fillStyle="#202520";context.fillRect(-11*s,-10*s,22*s,21*s);context.strokeStyle=car.isPlayer?"#f1dda2":"rgba(235,231,216,.5)";context.lineWidth=car.isPlayer?2:1;context.strokeRect(-16*s,-29*s,32*s,58*s);context.restore(); }
    function drawParticles(){world.particles.forEach((particle)=>{const p=point(particle.x,particle.y);context.globalAlpha=clamp(particle.life/particle.max,0,1)*.35;context.fillStyle=particle.colour;context.beginPath();context.arc(p.x,p.y,particle.radius*scale(),0,TAU);context.fill();});context.globalAlpha=1;}
    function render(){const sx=(seeded(Math.floor(world.time*70),1)-.5)*world.shake*7;context.setTransform(world.dpr,0,0,world.dpr,sx*world.dpr,0);context.clearRect(-20,-20,world.width+40,world.height+40);drawWorld();all().slice().sort((a,b)=>b.y-a.y).forEach(drawCar);drawParticles();if(world.result!=="racing"){context.fillStyle="rgba(5,6,5,.72)";context.fillRect(0,0,world.width,world.height);context.fillStyle="#eee8da";context.font="500 40px Clash Display";context.textAlign="center";context.fillText(world.result==="finished"?"FLOOR ZERO CLEARED":"STRUCTURE CLAIMED THE VEHICLE",world.width/2,world.height/2);}}

    function currentLevel(){return levels.find((level)=>player.y<level.start+650&&level.state!=="settled")||levels[levels.length-1];}
    function updateReadouts(){const level=currentLevel();positionReadout.textContent=`${position()} / ${STARTERS}`;levelReadout.textContent=`Level ${String(Math.max(0,6-level.index)).padStart(2,"0")}`;frontReadout.textContent=level.state==="armed"?"Armed":level.state==="firing"?"Pulse live":level.state==="falling"?"Floor falling":"Settled";speedReadout.textContent=`${Math.round(player.speed*.36)} km/h`;resultReadout.textContent=world.result==="racing"?(player.dust>.55?"Intake choking":player.acid>.55?"Coating stripped":"Intact"):world.detail;let remaining=level.state==="firing"?Math.max(0,2-level.timer):level.state==="falling"?Math.max(0,level.duration-level.timer):8;windowReadout.textContent=`${remaining.toFixed(1)} s`;windowBar.style.width=`${clamp(remaining/8*100,0,100)}%`;windowCopy.textContent=level.state==="falling"?`Level ${6-level.index} slab descending`:`Firing pulse approaching Level ${6-level.index}`;spineStatus.textContent=level.state==="firing"?"Pulse descending":"Next branch armed";floorStatus.textContent=`${levels.filter((item)=>item.state!=="settled").length} slabs suspended`;facadeStatus.textContent=player.acid>.2?"Acid exposure active":"Exterior route exposed";rubbleStatus.textContent=`Front at ${Math.max(0,Math.round(world.front))} m`;dustStatus.textContent=player.dust>.55?"Intake restriction severe":player.dust>.2?"Dust entering intake":"Air clear";exitStatus.textContent=`${Math.max(1,4-world.finishers)} bays available`;}
    function resize(){const width=Math.max(1,canvas.clientWidth||1300),height=Math.max(1,canvas.clientHeight||920);world.dpr=Math.min(window.devicePixelRatio||1,2);world.width=width;world.height=height;world.scale=clamp(Math.min(width/1550,height/1200),.5,.84);canvas.width=Math.round(width*world.dpr);canvas.height=Math.round(height*world.dpr);render();}
    const keyMap={w:"throttle",arrowup:"throttle",s:"brake",arrowdown:"brake",a:"left",arrowleft:"left",d:"right",arrowright:"right"};function setControl(name,on){if(!(name in input))return;input[name]=on;buttons.forEach((button)=>{if(button.dataset.demolitionControl===name)button.classList.toggle("is-pressed",on);});}
    window.addEventListener("keydown",(event)=>{const name=keyMap[event.key.toLowerCase()];if(!name||page.hidden)return;event.preventDefault();setControl(name,true);});window.addEventListener("keyup",(event)=>{const name=keyMap[event.key.toLowerCase()];if(!name)return;setControl(name,false);});window.addEventListener("blur",()=>Object.keys(input).forEach((name)=>setControl(name,false)));buttons.forEach((button)=>{const name=button.dataset.demolitionControl;const down=(event)=>{event.preventDefault();setControl(name,true);};const up=(event)=>{event.preventDefault();setControl(name,false);};button.addEventListener("pointerdown",down);button.addEventListener("pointerup",up);button.addEventListener("pointercancel",up);});
    resetButton.addEventListener("click",reset);overviewButton.addEventListener("click",()=>{world.overview=!world.overview;overviewButton.textContent=world.overview?"Follow vehicle":"Survey structure";});
    reset();function animate(time){const delta=Math.min(.04,Math.max(0,(time-world.lastTime)/1000));world.lastTime=time;const visible=!page.hidden&&document.visibilityState!=="hidden";if(visible){world.wasVisible=true;update(delta);render();}else if(world.wasVisible){world.wasVisible=false;world.lastTime=time;}requestAnimationFrame(animate);}if(typeof ResizeObserver!=="undefined")new ResizeObserver(resize).observe(canvas);else window.addEventListener("resize",resize);
    window.demolitionRun={resize,reset,setControl,diagnostics:()=>({result:world.result,detail:world.detail,time:world.time,front:world.front,player:{x:player.x,y:player.y,vx:player.vx,vy:player.vy,speed:player.speed,heading:player.heading,active:player.active,falling:player.falling,position:position(),acid:player.acid,dust:player.dust},finishers:world.finishers,eliminated:world.eliminated,levels:levels.map((level)=>({state:level.state,timer:level.timer}))})};requestAnimationFrame(animate);
})();
