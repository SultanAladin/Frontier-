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

    const world = {
        time: 0,
        lastTime: performance.now(),
        wasVisible: false,
        platformA: { y: 360, velocity: 0, position: "entry" },
        platformB: { y: 210, velocity: 0, position: "upper" },
        turnAngle: 0,
        traffic: [
            { x: 100, y: 545, angle: 0 },
            { x: 470, y: 115, angle: 180 },
            { x: 798, y: 422, angle: -131 }
        ]
    };

    const carrier = {
        x: 54,
        y: 360,
        angle: 0,
        velocity: 0,
        lateralVelocity: 0,
        localX: 0,
        stage: "approach-a",
        status: "Approaching Table A",
        result: "running",
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
        const travelTime = 150 / pixelsPerSecond;
        const dwell = 1.85;
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

        const normalY = 360 - ratio * 150;
        const y = invert ? 210 + ratio * 150 : normalY;
        return { y, velocity, label, phase, duration };
    }

    function turntableMotion(time) {
        const phase = modular(time + settings.offset, 11.5);
        if (phase < 2.5) {
            return { angle: 0, label: "Main aligned" };
        }
        if (phase < 4) {
            const ratio = smoothstep((phase - 2.5) / 1.5);
            return { angle: ratio * 42, label: "Rotating" };
        }
        if (phase < 7) {
            return { angle: 42, label: "Spur aligned" };
        }
        if (phase < 8.5) {
            const ratio = smoothstep((phase - 7) / 1.5);
            return { angle: (1 - ratio) * 42, label: "Rotating" };
        }
        return { angle: 0, label: "Main aligned" };
    }

    function updateMachines() {
        world.platformA = platformMotion(world.time, false);
        world.platformB = platformMotion(world.time + 2.2 + settings.offset, true);
        const rotary = turntableMotion(world.time);
        world.turnAngle = rotary.angle;

        platformAGraphic.setAttribute("transform", `translate(280 ${world.platformA.y.toFixed(2)})`);
        platformBGraphic.setAttribute("transform", `translate(840 ${world.platformB.y.toFixed(2)})`);
        turntableGraphic.setAttribute("transform", `translate(610 210) rotate(${world.turnAngle.toFixed(2)})`);

        platformAReadout.textContent = world.platformA.label.replace(/^./, (letter) => letter.toUpperCase());
        turnReadout.textContent = `${Math.round(world.turnAngle)}°`;
        svg.style.setProperty("--shunt-table-speed", `${Math.max(0.5, 2.2 - settings.tableSpeed * 0.6).toFixed(2)}s`);
    }

    function pingPong(number) {
        const phase = modular(number, 2);
        return phase <= 1 ? phase : 2 - phase;
    }

    function updateTraffic() {
        const lowerProgress = modular(world.time * 0.055 + 0.08, 1);
        world.traffic[0].x = 45 + lowerProgress * 1010;
        world.traffic[0].y = 545;
        world.traffic[0].angle = 0;

        const storageProgress = modular(world.time * 0.047 + 0.31, 1);
        world.traffic[1].x = 495 - storageProgress * 445;
        world.traffic[1].y = 115;
        world.traffic[1].angle = 180;

        const branchProgress = pingPong(world.time * 0.115 + settings.offset * 0.07 + 0.17);
        world.traffic[2].x = 798 + (626 - 798) * branchProgress;
        world.traffic[2].y = 422 + (228 - 422) * branchProgress;
        world.traffic[2].angle = -131;

        world.traffic.forEach((vehicle, index) => {
            trafficGraphics[index].setAttribute("transform", `translate(${vehicle.x.toFixed(1)} ${vehicle.y.toFixed(1)}) rotate(${vehicle.angle})`);
        });
    }

    function platformAligned(platform, target) {
        const targetY = target === "upper" ? 210 : 360;
        return Math.abs(platform.y - targetY) < 6 && Math.abs(platform.velocity) < 18;
    }

    function trafficAtTurntable() {
        const traffic = world.traffic[2];
        return Math.hypot(traffic.x - 610, traffic.y - 210) < 104;
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
            carrier.y += carrier.stage.includes("b") ? 52 : -52;
            carrier.angle = carrier.stage.includes("b") ? 15 : -15;
        } else if (result === "wrong-spur") {
            carrier.x = 741;
            carrier.y = 356;
            carrier.angle = 49;
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
        const distance = 205 - carrier.x;
        const stoppingDistance = carrier.velocity * carrier.velocity / Math.max(1, 2 * physics.brakingAcceleration);
        const target = !aligned && distance < stoppingDistance + 28 ? 0 : physics.targetSpeed;
        updateVelocity(target, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = 360;
        carrier.angle = 0;
        carrier.status = aligned ? "Boarding Table A" : "Waiting for Table A";

        if (carrier.x >= 205) {
            if (!aligned) {
                fail("side-slip", "Side-slip at Table A seam");
                return;
            }
            carrier.stage = "table-a";
            carrier.localX = -75;
            carrier.x = 205;
            carrier.y = world.platformA.y;
            carrier.status = "Riding Table A";
        }
    }

    function updateOnPlatformA(delta) {
        const physics = drivePhysics();
        const alignedUpper = platformAligned(world.platformA, "upper");
        const target = alignedUpper ? physics.targetSpeed : carrier.localX < -14 ? Math.min(22, physics.targetSpeed) : 0;
        updateVelocity(target, delta);
        carrier.localX += carrier.velocity * delta;
        carrier.x = 280 + carrier.localX;
        carrier.y = world.platformA.y;
        carrier.angle = 0;
        carrier.status = alignedUpper ? "Table A aligned — departing" : "Momentum held on moving deck";

        if (!alignedUpper && carrier.localX > 70) {
            fail("side-slip", "Retained momentum crossed Table A seam");
        } else if (alignedUpper && carrier.localX >= 76) {
            carrier.stage = "upper-a";
            carrier.x = 356;
            carrier.y = 210;
            carrier.localX = 0;
            carrier.status = "Upper transfer rail";
        }
    }

    function updateUpperA(delta) {
        const physics = drivePhysics();
        const mainAligned = Math.abs(world.turnAngle) < 5;
        const blocked = trafficAtTurntable();
        const distance = 522 - carrier.x;
        const stoppingDistance = carrier.velocity * carrier.velocity / Math.max(1, 2 * physics.brakingAcceleration);
        const target = (!mainAligned || blocked) && distance < stoppingDistance + 34 ? 0 : physics.targetSpeed;
        updateVelocity(target, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = 210;
        carrier.angle = 0;
        carrier.status = blocked ? "Yielding to yard traffic" : mainAligned ? "Approaching rotary table" : "Waiting for 0° alignment";

        if (carrier.x >= 522) {
            if (blocked) {
                fail("collision", "Platform collision at rotary table");
            } else if (Math.abs(world.turnAngle) < 7) {
                carrier.stage = "turntable";
                carrier.localX = -88;
                carrier.x = 522;
                carrier.status = "Crossing rotary table";
            } else if (Math.abs(world.turnAngle - 42) < 9) {
                fail("wrong-spur", "Routed into maintenance spur");
            } else {
                fail("side-slip", "Rotary-table seam not aligned");
            }
        }
    }

    function updateTurntable(delta) {
        const physics = drivePhysics();
        const aligned = Math.abs(world.turnAngle) < 6;
        const target = aligned ? physics.targetSpeed * 0.78 : 0;
        updateVelocity(target, delta);
        carrier.localX += carrier.velocity * delta;
        carrier.x = 610 + carrier.localX * Math.cos(world.turnAngle * Math.PI / 180);
        carrier.y = 210 + carrier.localX * Math.sin(world.turnAngle * Math.PI / 180);
        carrier.angle = world.turnAngle;
        carrier.status = aligned ? "Crossing at 0°" : "Braking on rotating bridge";

        if (!aligned && carrier.localX > 72) {
            if (Math.abs(world.turnAngle - 42) < 9) {
                fail("wrong-spur", "Rotary table changed to maintenance spur");
            } else {
                fail("side-slip", "Departed rotating bridge between rails");
            }
        } else if (aligned && carrier.localX >= 89) {
            carrier.stage = "upper-b";
            carrier.x = 699;
            carrier.y = 210;
            carrier.angle = 0;
            carrier.status = "Approaching Table B";
        }
    }

    function updateUpperB(delta) {
        const physics = drivePhysics();
        const aligned = platformAligned(world.platformB, "upper");
        const distance = 765 - carrier.x;
        const stoppingDistance = carrier.velocity * carrier.velocity / Math.max(1, 2 * physics.brakingAcceleration);
        const target = !aligned && distance < stoppingDistance + 28 ? 0 : physics.targetSpeed;
        updateVelocity(target, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = 210;
        carrier.angle = 0;
        carrier.status = aligned ? "Boarding Table B" : "Waiting for Table B";

        if (carrier.x >= 765) {
            if (!aligned) {
                fail("side-slip", "Side-slip at Table B seam");
                return;
            }
            carrier.stage = "table-b";
            carrier.localX = -75;
            carrier.x = 765;
            carrier.y = world.platformB.y;
            carrier.status = "Riding Table B";
        }
    }

    function updateOnPlatformB(delta) {
        const physics = drivePhysics();
        const alignedExit = platformAligned(world.platformB, "exit");
        const target = alignedExit ? physics.targetSpeed : carrier.localX < -14 ? Math.min(22, physics.targetSpeed) : 0;
        updateVelocity(target, delta);
        carrier.localX += carrier.velocity * delta;
        carrier.x = 840 + carrier.localX;
        carrier.y = world.platformB.y;
        carrier.angle = 0;
        carrier.status = alignedExit ? "Table B aligned — departing" : "Momentum held on moving deck";

        if (!alignedExit && carrier.localX > 70) {
            fail("side-slip", "Retained momentum crossed Table B seam");
        } else if (alignedExit && carrier.localX >= 76) {
            carrier.stage = "exit";
            carrier.x = 916;
            carrier.y = 360;
            carrier.localX = 0;
            carrier.status = "Exit rail aligned";
        }
    }

    function updateExit(delta) {
        const physics = drivePhysics();
        updateVelocity(physics.targetSpeed, delta);
        carrier.x += carrier.velocity * delta;
        carrier.y = 360;
        carrier.angle = 0;
        carrier.status = "Running to Exit 02";
        if (carrier.x >= 1045) {
            carrier.x = 1045;
            fail("finished", "Successful yard exit");
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
        } else if (carrier.stage === "exit") {
            updateExit(delta);
        }

        const crossingTraffic = world.traffic[2];
        if (carrier.result === "running" && Math.hypot(carrier.x - crossingTraffic.x, carrier.y - crossingTraffic.y) < 47) {
            fail("collision", "Platform collision with maintenance carrier");
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
            skidPaths[0].setAttribute("d", trailPath(-18));
        }
        if (skidPaths[1]) {
            skidPaths[1].setAttribute("d", trailPath(18));
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
        carrier.y = 360;
        carrier.angle = 0;
        carrier.velocity = 0;
        carrier.lateralVelocity = 0;
        carrier.localX = 0;
        carrier.stage = "approach-a";
        carrier.status = "Approaching Table A";
        carrier.result = "running";
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
