"use strict";

(() => {
    const svg = document.getElementById("shunt-svg");
    if (!svg) {
        return;
    }

    const page = document.getElementById("shunt");
    const resetButton = document.getElementById("shunt-reset");
    const platformAGraphic = document.getElementById("shunt-platform-a");
    const platformBGraphic = document.getElementById("shunt-platform-b");
    const turntableGraphic = document.getElementById("shunt-turntable");
    const carrierGraphic = document.getElementById("shunt-carrier");
    const trafficGraphics = [
        document.getElementById("shunt-traffic-one"),
        document.getElementById("shunt-traffic-two"),
        document.getElementById("shunt-traffic-three")
    ];
    const signals = {
        a: document.getElementById("shunt-signal-a"),
        turn: document.getElementById("shunt-signal-turn"),
        b: document.getElementById("shunt-signal-b")
    };
    const skidGraphic = document.getElementById("shunt-skid-trails");
    const impactGraphic = document.getElementById("shunt-impact-ring");
    const phaseReadout = document.getElementById("shunt-phase-readout");
    const platformAReadout = document.getElementById("shunt-a-readout");
    const turnReadout = document.getElementById("shunt-turn-readout");
    const resultReadout = document.getElementById("shunt-result-readout");

    const settings = {
        tableSpeed: 1.1,
        braking: 0.68,
        mass: 5.5,
        torque: 0.64,
        offset: 1.2
    };

    const layout = {
        upperY: 315,
        transferY: 535,
        platformTravel: 220,
        platformA: 350,
        platformB: 1090,
        platformHalf: 100,
        turnX: 730,
        turnY: 315,
        turnHalf: 120,
        entrySeam: 250,
        upperAStart: 450,
        turnEntry: 610,
        turnExit: 850,
        upperBEnd: 990,
        exitStart: 1190,
        finish: 1350
    };

    const world = {
        time: 0,
        lastTime: performance.now(),
        wasVisible: false,
        platformA: { y: layout.transferY, velocity: 0, position: "entry" },
        platformB: { y: layout.upperY, velocity: 0, position: "upper" },
        turnAngle: 0,
        traffic: [
            { x: 110, y: 735, angle: 0 },
            { x: 590, y: 175, angle: 180 },
            { x: 925, y: 557, angle: -129 }
        ]
    };

    const carrier = {
        x: 54,
        y: layout.transferY,
        angle: 0,
        velocity: 0,
        lateralVelocity: 0,
        localX: 0,
        stage: "approach-a",
        status: "Approaching Table A",
        result: "running",
        spurProgress: 0,
        collisionFlash: 0,
        skid: 0,
        trail: []
    };

    const controls = [
        {
            input: document.getElementById("shunt-table-speed"),
            output: document.getElementById("shunt-table-speed-output"),
            apply: (number) => { settings.tableSpeed = number / 10; },
            format: (number) => `${(number / 10).toFixed(1)} m/s`
        },
        {
            input: document.getElementById("shunt-braking"),
            output: document.getElementById("shunt-braking-output"),
            apply: (number) => { settings.braking = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("shunt-mass"),
            output: document.getElementById("shunt-mass-output"),
            apply: (number) => { settings.mass = number / 10; },
            format: (number) => `${(number / 10).toFixed(1)} t`
        },
        {
            input: document.getElementById("shunt-torque"),
            output: document.getElementById("shunt-torque-output"),
            apply: (number) => { settings.torque = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("shunt-offset"),
            output: document.getElementById("shunt-offset-output"),
            apply: (number) => { settings.offset = number / 10; },
            format: (number) => `${number >= 0 ? "+" : ""}${(number / 10).toFixed(1)} s`
        }
    ];

    function clamp(number, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, number));
    }

    function moveToward(number, target, amount) {
        if (number < target) {
            return Math.min(target, number + amount);
        }
        return Math.max(target, number - amount);
    }

    function modular(number, divisor) {
        return ((number % divisor) + divisor) % divisor;
    }

    function smoothstep(number) {
        const ratio = clamp(number, 0, 1);
        return ratio * ratio * (3 - 2 * ratio);
    }

    function syncControl(control) {
        const number = Number(control.input.value);
        control.apply(number);
        const text = control.format(number);
        control.output.value = text;
        control.output.textContent = text;
        const minimum = Number(control.input.min);
        const maximum = Number(control.input.max);
        const position = ((number - minimum) / Math.max(1, maximum - minimum)) * 100;
        control.input.style.setProperty("--range-position", `${position}%`);
    }

    controls.forEach((control) => {
        control.update = () => syncControl(control);
        control.input.addEventListener("input", control.update);
        control.update();
    });

    function drivePhysics() {
        const massFactor = clamp(settings.mass / 5.5, 0.28, 2.2);
        return {
            driveAcceleration: (28 + settings.torque * 74) / massFactor,
            brakingAcceleration: (24 + settings.braking * 176) / massFactor,
            targetSpeed: clamp((42 + settings.torque * 52) / Math.sqrt(massFactor), 28, 112)
        };
    }

    function platformMotion(time, invert = false) {
        const pixelsPerSecond = 28 + settings.tableSpeed * 48;
        const travelTime = layout.platformTravel / pixelsPerSecond;
        const dwell = 2.25;
        const duration = dwell * 2 + travelTime * 2;
        const phase = modular(time, duration);
        let ratio;
        let velocity = 0;
        let label;

        if (phase < dwell) {
            ratio = 0;
            label = invert ? "upper" : "entry";
        } else if (phase < dwell + travelTime) {
            const local = (phase - dwell) / travelTime;
            ratio = smoothstep(local);
            velocity = (invert ? 1 : -1) * pixelsPerSecond * 1.35 * local * (1 - local) * 4;
            label = invert ? "moving to exit" : "moving to upper";
        } else if (phase < dwell * 2 + travelTime) {
            ratio = 1;
            label = invert ? "exit" : "upper";
        } else {
            const local = (phase - dwell * 2 - travelTime) / travelTime;
            ratio = 1 - smoothstep(local);
            velocity = (invert ? -1 : 1) * pixelsPerSecond * 1.35 * local * (1 - local) * 4;
            label = invert ? "moving to upper" : "moving to entry";
        }

        const normalY = layout.transferY - ratio * layout.platformTravel;
        const y = invert ? layout.upperY + ratio * layout.platformTravel : normalY;
        return { y, velocity, label, phase, duration };
    }

    function turntableMotion(time) {
        const phase = modular(time + settings.offset, 13.5);
        if (phase < 3.5) {
            return { angle: 0, label: "Main aligned" };
        }
        if (phase < 5) {
            const ratio = smoothstep((phase - 3.5) / 1.5);
            return { angle: ratio * 42, label: "Rotating" };
        }
        if (phase < 8) {
            return { angle: 42, label: "Spur aligned" };
        }
        if (phase < 9.5) {
            const ratio = smoothstep((phase - 8) / 1.5);
            return { angle: (1 - ratio) * 42, label: "Rotating" };
        }
        return { angle: 0, label: "Main aligned" };
    }

    function updateMachines() {
        world.platformA = platformMotion(world.time, false);
        world.platformB = platformMotion(world.time + 2.2 + settings.offset, true);
        const rotary = turntableMotion(world.time);
        world.turnAngle = rotary.angle;

        platformAGraphic.setAttribute("transform", `translate(${layout.platformA} ${world.platformA.y.toFixed(2)})`);
        platformBGraphic.setAttribute("transform", `translate(${layout.platformB} ${world.platformB.y.toFixed(2)})`);
        turntableGraphic.setAttribute("transform", `translate(${layout.turnX} ${layout.turnY}) rotate(${world.turnAngle.toFixed(2)})`);

        platformAReadout.textContent = world.platformA.label.replace(/^./, (letter) => letter.toUpperCase());
        turnReadout.textContent = `${Math.round(world.turnAngle)}°`;
        svg.style.setProperty("--shunt-table-speed", `${Math.max(0.5, 2.2 - settings.tableSpeed * 0.6).toFixed(2)}s`);
    }

    function pingPong(number) {
        const phase = modular(number, 2);
        return phase <= 1 ? phase : 2 - phase;
    }

    function updateTraffic() {
        const lowerProgress = modular(world.time * 0.045 + 0.08, 1);
        world.traffic[0].x = 48 + lowerProgress * 1110;
        world.traffic[0].y = 735;
        world.traffic[0].angle = 0;

        const storageProgress = modular(world.time * 0.039 + 0.31, 1);
        world.traffic[1].x = 642 - storageProgress * 594;
        world.traffic[1].y = 175;
        world.traffic[1].angle = 180;

        const branchProgress = pingPong(world.time * 0.102 + settings.offset * 0.07 + 0.17);
        world.traffic[2].x = 925 + (750 - 925) * branchProgress;
        world.traffic[2].y = 557 + (338 - 557) * branchProgress;
        world.traffic[2].angle = -129;

        world.traffic.forEach((vehicle, index) => {
            trafficGraphics[index].setAttribute("transform", `translate(${vehicle.x.toFixed(1)} ${vehicle.y.toFixed(1)}) rotate(${vehicle.angle})`);
        });
    }

    function platformAligned(platform, target) {
        const targetY = target === "upper" ? layout.upperY : layout.transferY;
        return Math.abs(platform.y - targetY) < 7 && Math.abs(platform.velocity) < 18;
    }

    function trafficAtTurntable() {
        const traffic = world.traffic[2];
        return Math.hypot(traffic.x - layout.turnX, traffic.y - layout.turnY) < 132;
    }

    function updateVelocity(target, delta) {
        const physics = drivePhysics();
        const amount = target < carrier.velocity
            ? physics.brakingAcceleration * delta
            : physics.driveAcceleration * delta;
        const previous = carrier.velocity;
        carrier.velocity = moveToward(carrier.velocity, target, amount);
        carrier.skid = target < previous - 7
            ? clamp((previous - carrier.velocity) / Math.max(1, previous), 0, 1)
            : Math.max(0, carrier.skid - delta * 2.5);
    }

    function fail(result, status) {
        if (carrier.result !== "running") {
            return;
        }
        carrier.result = result;
        carrier.status = status;
        carrier.velocity = 0;
        carrier.collisionFlash = result === "collision" ? 1 : 0.35;
        if (result === "side-slip") {
            carrier.y += carrier.stage.includes("b") ? 72 : -72;
            carrier.angle = carrier.stage.includes("b") ? 15 : -15;
        }
        svg.dataset.result = result;
        resultReadout.textContent = result === "side-slip"
            ? "Side-slip"
            : result === "wrong-spur"
                ? "Wrong spur"
                : result === "collision"
                    ? "Collision"
                    : "Finished";
        resetButton.textContent = "Run another test";
    }

    function updateApproachA(delta) {
        const physics = drivePhysics();
        const aligned = platformAligned(world.platformA, "entry");
        const distance = layout.entrySeam - carrier.x;
        const stoppingDistance = carrier.velocity * carrier.velocity / Math.max(1, 2 * physics.brakingAcceleration);
        const target = !aligned && distance < stoppingDistance + 36 ? 0 : physics.targetSpeed;
        updateVelocity(target, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = layout.transferY;
        carrier.angle = 0;
        carrier.status = aligned ? "Boarding transfer table A" : "Holding at infeed signal";

        if (carrier.x >= layout.entrySeam) {
            if (!aligned) {
                fail("side-slip", "Wheel flange crossed the open Table A seam");
                return;
            }
            carrier.stage = "table-a";
            carrier.localX = -layout.platformHalf;
            carrier.x = layout.entrySeam;
            carrier.y = world.platformA.y;
            carrier.status = "Loaded on transfer table A";
        }
    }

    function updateOnPlatformA(delta) {
        const physics = drivePhysics();
        const alignedUpper = platformAligned(world.platformA, "upper");
        const target = alignedUpper ? physics.targetSpeed : carrier.localX < -18 ? Math.min(22, physics.targetSpeed) : 0;
        updateVelocity(target, delta);
        carrier.localX += carrier.velocity * delta;
        carrier.x = layout.platformA + carrier.localX;
        carrier.y = world.platformA.y;
        carrier.angle = 0;
        carrier.status = alignedUpper ? "Table A indexed — releasing brakes" : "Longitudinal momentum retained on moving deck";

        if (!alignedUpper && carrier.localX > layout.platformHalf - 7) {
            fail("side-slip", "Retained momentum carried A7 across the Table A seam");
        } else if (alignedUpper && carrier.localX >= layout.platformHalf + 1) {
            carrier.stage = "upper-a";
            carrier.x = layout.upperAStart + 1;
            carrier.y = layout.upperY;
            carrier.localX = 0;
            carrier.status = "Running upper transfer rail";
        }
    }

    function updateUpperA(delta) {
        const physics = drivePhysics();
        const mainAligned = Math.abs(world.turnAngle) < 5;
        const blocked = trafficAtTurntable();
        const distance = layout.turnEntry - carrier.x;
        const stoppingDistance = carrier.velocity * carrier.velocity / Math.max(1, 2 * physics.brakingAcceleration);
        const target = (!mainAligned || blocked) && distance < stoppingDistance + 44 ? 0 : physics.targetSpeed;
        updateVelocity(target, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = layout.upperY;
        carrier.angle = 0;
        carrier.status = blocked ? "Yielding to service traffic" : mainAligned ? "Approaching rotary bridge" : "Holding for 0° bridge index";

        if (carrier.x >= layout.turnEntry) {
            if (blocked) {
                fail("collision", "Platform collision at rotary bridge throat");
            } else if (Math.abs(world.turnAngle) < 7) {
                carrier.stage = "turntable";
                carrier.localX = -layout.turnHalf;
                carrier.x = layout.turnEntry;
                carrier.status = "Crossing indexed rotary bridge";
            } else {
                fail("side-slip", "Rotary bridge rail ends were outside tolerance");
            }
        }
    }

    function beginWrongSpur() {
        carrier.stage = "wrong-spur-run";
        carrier.spurProgress = 0.47;
        carrier.velocity = Math.max(31, carrier.velocity);
        carrier.status = "Committed to maintenance spur M–17";
    }

    function updateWrongSpur(delta) {
        const physics = drivePhysics();
        updateVelocity(Math.min(physics.targetSpeed, 58), delta);
        carrier.spurProgress = Math.min(1, carrier.spurProgress + carrier.velocity * delta / 300);
        const progress = carrier.spurProgress;
        const inverse = 1 - progress;
        const start = { x: layout.turnX, y: layout.turnY };
        const control = { x: 810, y: 372 };
        const end = { x: 925, y: 557 };
        carrier.x = inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x;
        carrier.y = inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y;
        const tangentX = 2 * inverse * (control.x - start.x) + 2 * progress * (end.x - control.x);
        const tangentY = 2 * inverse * (control.y - start.y) + 2 * progress * (end.y - control.y);
        carrier.angle = Math.atan2(tangentY, tangentX) * 180 / Math.PI;
        carrier.status = "Running maintenance spur M–17";
        if (progress >= 0.99) {
            fail("wrong-spur", "A7 reached dead-end maintenance bay M–17");
        }
    }

    function updateTurntable(delta) {
        const physics = drivePhysics();
        const mainAligned = Math.abs(world.turnAngle) < 6;
        const branchAligned = Math.abs(world.turnAngle - 42) < 6;
        const target = mainAligned || branchAligned ? physics.targetSpeed : 0;
        updateVelocity(target, delta);
        carrier.localX += carrier.velocity * delta;
        carrier.x = layout.turnX + carrier.localX * Math.cos(world.turnAngle * Math.PI / 180);
        carrier.y = layout.turnY + carrier.localX * Math.sin(world.turnAngle * Math.PI / 180);
        carrier.angle = world.turnAngle;
        carrier.status = mainAligned
            ? "Crossing rotary bridge at 0°"
            : branchAligned
                ? "Bridge indexed to maintenance spur"
                : "Braking on moving bridge structure";

        if (branchAligned && carrier.localX > layout.turnHalf - 8) {
            beginWrongSpur();
        } else if (!mainAligned && !branchAligned && carrier.localX > layout.turnHalf - 8) {
            fail("side-slip", "A7 departed between rotary bridge index points");
        } else if (mainAligned && carrier.localX >= layout.turnHalf + 1) {
            carrier.stage = "upper-b";
            carrier.x = layout.turnExit + 1;
            carrier.y = layout.upperY;
            carrier.angle = 0;
            carrier.status = "Approaching transfer table B";
        }
    }

    function updateUpperB(delta) {
        const physics = drivePhysics();
        const aligned = platformAligned(world.platformB, "upper");
        const distance = layout.upperBEnd - carrier.x;
        const stoppingDistance = carrier.velocity * carrier.velocity / Math.max(1, 2 * physics.brakingAcceleration);
        const target = !aligned && distance < stoppingDistance + 36 ? 0 : physics.targetSpeed;
        updateVelocity(target, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = layout.upperY;
        carrier.angle = 0;
        carrier.status = aligned ? "Boarding transfer table B" : "Holding at Table B signal";

        if (carrier.x >= layout.upperBEnd) {
            if (!aligned) {
                fail("side-slip", "Wheel flange crossed the open Table B seam");
                return;
            }
            carrier.stage = "table-b";
            carrier.localX = -layout.platformHalf;
            carrier.x = layout.upperBEnd;
            carrier.y = world.platformB.y;
            carrier.status = "Loaded on transfer table B";
        }
    }

    function updateOnPlatformB(delta) {
        const physics = drivePhysics();
        const alignedExit = platformAligned(world.platformB, "exit");
        const target = alignedExit ? physics.targetSpeed : carrier.localX < -18 ? Math.min(22, physics.targetSpeed) : 0;
        updateVelocity(target, delta);
        carrier.localX += carrier.velocity * delta;
        carrier.x = layout.platformB + carrier.localX;
        carrier.y = world.platformB.y;
        carrier.angle = 0;
        carrier.status = alignedExit ? "Table B indexed — releasing brakes" : "Longitudinal momentum retained on moving deck";

        if (!alignedExit && carrier.localX > layout.platformHalf - 7) {
            fail("side-slip", "Retained momentum carried A7 across the Table B seam");
        } else if (alignedExit && carrier.localX >= layout.platformHalf + 1) {
            carrier.stage = "exit";
            carrier.x = layout.exitStart + 1;
            carrier.y = layout.transferY;
            carrier.localX = 0;
            carrier.status = "Outfeed rail aligned";
        }
    }

    function updateExit(delta) {
        const physics = drivePhysics();
        updateVelocity(physics.targetSpeed, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = layout.transferY;
        carrier.angle = 0;
        carrier.status = "Clearing Outfeed Bay 02";
        if (carrier.x >= layout.finish) {
            carrier.x = layout.finish;
            fail("finished", "Dispatch complete — A7 cleared the transfer hall");
        }
    }

    function updateCarrier(delta) {
        carrier.collisionFlash = Math.max(0, carrier.collisionFlash - delta * 1.8);
        if (carrier.result !== "running") {
            return;
        }

        if (carrier.stage === "approach-a") {
            updateApproachA(delta);
        } else if (carrier.stage === "table-a") {
            updateOnPlatformA(delta);
        } else if (carrier.stage === "upper-a") {
            updateUpperA(delta);
        } else if (carrier.stage === "turntable") {
            updateTurntable(delta);
        } else if (carrier.stage === "upper-b") {
            updateUpperB(delta);
        } else if (carrier.stage === "table-b") {
            updateOnPlatformB(delta);
        } else if (carrier.stage === "wrong-spur-run") {
            updateWrongSpur(delta);
        } else if (carrier.stage === "exit") {
            updateExit(delta);
        }

        const crossingTraffic = world.traffic[2];
        if (carrier.result === "running" && carrier.stage !== "wrong-spur-run" && Math.hypot(carrier.x - crossingTraffic.x, carrier.y - crossingTraffic.y) < 61) {
            fail("collision", "A7 collided with the maintenance service carrier");
        }

        carrier.trail.push({ x: carrier.x, y: carrier.y, angle: carrier.angle, skid: carrier.skid });
        if (carrier.trail.length > 30) {
            carrier.trail.shift();
        }
    }

    function trailPath(offset) {
        const points = carrier.trail.filter((point) => point.skid > 0.08);
        if (points.length < 2) {
            return "";
        }
        return points.map((point, index) => {
            const radians = point.angle * Math.PI / 180;
            const x = point.x - Math.sin(radians) * offset;
            const y = point.y + Math.cos(radians) * offset;
            return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join(" ");
    }

    function updateGraphics() {
        carrierGraphic.setAttribute("transform", `translate(${carrier.x.toFixed(1)} ${carrier.y.toFixed(1)}) rotate(${carrier.angle.toFixed(1)})`);
        const skidPaths = skidGraphic.querySelectorAll ? skidGraphic.querySelectorAll("path") : skidGraphic.children;
        if (skidPaths[0]) {
            skidPaths[0].setAttribute("d", trailPath(-24));
        }
        if (skidPaths[1]) {
            skidPaths[1].setAttribute("d", trailPath(24));
        }
        impactGraphic.setAttribute("transform", `translate(${carrier.x.toFixed(1)} ${carrier.y.toFixed(1)})`);
        impactGraphic.style.opacity = `${carrier.collisionFlash}`;

        const aClear = platformAligned(world.platformA, carrier.stage === "approach-a" ? "entry" : "upper");
        const turnClear = Math.abs(world.turnAngle) < 6 && !trafficAtTurntable();
        const bClear = platformAligned(world.platformB, carrier.stage === "upper-b" ? "upper" : "exit");
        signals.a.classList.toggle("is-clear", aClear);
        signals.turn.classList.toggle("is-clear", turnClear);
        signals.b.classList.toggle("is-clear", bClear);

        phaseReadout.textContent = carrier.status;
        if (carrier.result === "running") {
            resultReadout.textContent = "Running";
        }
    }

    function resetRun() {
        carrier.x = 54;
        carrier.y = layout.transferY;
        carrier.angle = 0;
        carrier.velocity = 0;
        carrier.lateralVelocity = 0;
        carrier.localX = 0;
        carrier.stage = "approach-a";
        carrier.status = "Approaching Table A";
        carrier.result = "running";
        carrier.spurProgress = 0;
        carrier.collisionFlash = 0;
        carrier.skid = 0;
        carrier.trail.length = 0;
        svg.dataset.result = "running";
        resultReadout.textContent = "Running";
        resetButton.textContent = "Reset carrier";
        updateGraphics();
    }

    function resize() {
        svg.style.setProperty("--shunt-aspect", `${svg.clientWidth / Math.max(1, svg.clientHeight)}`);
        updateGraphics();
    }

    resetButton.addEventListener("click", resetRun);
    resetRun();

    function animate(time) {
        const delta = Math.min(0.05, Math.max(0, (time - world.lastTime) / 1000));
        world.lastTime = time;
        const visible = !page.hidden && document.visibilityState !== "hidden";
        if (visible) {
            world.wasVisible = true;
            world.time += delta;
            updateMachines();
            updateTraffic();
            updateCarrier(delta);
            updateGraphics();
        } else if (world.wasVisible) {
            world.wasVisible = false;
            world.lastTime = time;
        }
        requestAnimationFrame(animate);
    }

    if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(resize);
        observer.observe(svg);
    } else {
        window.addEventListener("resize", resize);
    }

    window.shunt = { resize, reset: resetRun };
    requestAnimationFrame(animate);
})();
