"use strict";

(() => {
    const canvas = document.getElementById("beltline-canvas");
    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d", { alpha: false });
    const page = document.getElementById("beltline");
    const surface = canvas.parentElement;
    const startButton = document.getElementById("beltline-start");
    const phaseReadout = document.getElementById("beltline-phase-readout");
    const speedReadout = document.getElementById("beltline-speed-readout");
    const surfaceReadout = document.getElementById("beltline-surface-readout");

    const settings = {
        rubberSpeed: 70,
        steelSpeed: 105,
        rollerSpeed: 35,
        wheelSpeed: 95,
        speedStep: 45,
        steering: 0
    };

    const controls = [
        {
            input: document.getElementById("beltline-rubber-speed"),
            output: document.getElementById("beltline-rubber-speed-output"),
            apply: (number) => { settings.rubberSpeed = number; sections[0].overrideSpeed = null; updateSectionSpeeds(); },
            format: (number) => `${number} km/h`
        },
        {
            input: document.getElementById("beltline-steel-speed"),
            output: document.getElementById("beltline-steel-speed-output"),
            apply: (number) => { settings.steelSpeed = number; sections[1].overrideSpeed = null; updateSectionSpeeds(); },
            format: (number) => `${number} km/h`
        },
        {
            input: document.getElementById("beltline-roller-speed"),
            output: document.getElementById("beltline-roller-speed-output"),
            apply: (number) => { settings.rollerSpeed = number; sections[2].overrideSpeed = null; updateSectionSpeeds(); },
            format: (number) => `${number} km/h`
        },
        {
            input: document.getElementById("beltline-wheel-speed"),
            output: document.getElementById("beltline-wheel-speed-output"),
            apply: (number) => { settings.wheelSpeed = number; },
            format: (number) => `${number} km/h`
        },
        {
            input: document.getElementById("beltline-speed-step"),
            output: document.getElementById("beltline-speed-step-output"),
            apply: (number) => { settings.speedStep = number; updateSectionSpeeds(); },
            format: (number) => `${number} km/h`
        },
        {
            input: document.getElementById("beltline-steering"),
            output: document.getElementById("beltline-steering-output"),
            apply: (number) => { settings.steering = number; },
            format: (number) => number < -4 ? `Upper ${Math.abs(number)}%` : number > 4 ? `Lower ${number}%` : "Centre"
        }
    ];

    function syncControl(control) {
        const number = Number(control.input.value);
        control.apply(number);
        control.output.value = control.format(number);
        control.output.textContent = control.format(number);
        const minimum = Number(control.input.min);
        const maximum = Number(control.input.max);
        const position = ((number - minimum) / (maximum - minimum)) * 100;
        control.input.style.setProperty("--range-position", `${position}%`);
    }

    controls.forEach((control) => {
        control.update = () => syncControl(control);
        control.input.addEventListener("input", control.update);
    });

    const sections = [
        {
            key: "rubber",
            settingKey: "rubberSpeed",
            name: "Ribbed rubber",
            shortName: "Rubber",
            start: 0,
            end: 0.335,
            friction: 0.94,
            beltTransfer: 1,
            wheelTransfer: 1,
            overrideSpeed: null,
            speed: 70,
            travel: 0
        },
        {
            key: "steel",
            settingKey: "steelSpeed",
            name: "Wet steel",
            shortName: "Wet steel",
            start: 0.335,
            end: 0.665,
            friction: 0.24,
            beltTransfer: 1,
            wheelTransfer: 1,
            overrideSpeed: null,
            speed: 105,
            travel: 0
        },
        {
            key: "rollers",
            settingKey: "rollerSpeed",
            name: "Free rollers",
            shortName: "Rollers",
            start: 0.665,
            end: 1,
            friction: 0.08,
            beltTransfer: 0.08,
            wheelTransfer: 0.18,
            overrideSpeed: null,
            speed: 35,
            travel: 0
        }
    ];

    const feeders = [
        { x: 0.19, side: -1, next: 0.35, index: 0 },
        { x: 0.405, side: 1, next: 1.15, index: 1 },
        { x: 0.59, side: -1, next: 1.75, index: 2 },
        { x: 0.805, side: 1, next: 0.8, index: 3 }
    ];

    const vehicle = {
        x: 0.055,
        y: 0,
        vx: 0,
        vy: 0,
        slip: 0,
        phase: "ready",
        status: "Ready",
        eventTimer: 0,
        collisionTimer: 0,
        runTime: 0,
        finishTime: 0
    };

    const world = {
        width: 1000,
        height: 650,
        dpr: 1,
        time: 0,
        sectionTimer: 2.4,
        speedFlash: 0,
        changedSection: 0,
        stepCount: 0,
        objects: [],
        randomState: 4817
    };

    let lastTime = performance.now();
    let pointerActive = false;

    function random() {
        world.randomState = (world.randomState * 1664525 + 1013904223) >>> 0;
        return world.randomState / 4294967296;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function moveToward(value, target, amount) {
        if (value < target) {
            return Math.min(target, value + amount);
        }
        return Math.max(target, value - amount);
    }

    function roundedRectangle(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, Math.abs(width) * 0.5, Math.abs(height) * 0.5);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.arcTo(x + width, y, x + width, y + r, r);
        ctx.lineTo(x + width, y + height - r);
        ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
        ctx.lineTo(x + r, y + height);
        ctx.arcTo(x, y + height, x, y + height - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    function updateSectionSpeeds() {
        sections.forEach((section) => {
            const commandedSpeed = settings[section.settingKey];
            section.speed = section.overrideSpeed === null
                ? commandedSpeed
                : clamp(section.overrideSpeed, -120, 180);
        });
    }

    controls.forEach((control) => control.update());

    function sectionFor(position) {
        return sections.find((section) => position >= section.start && position < section.end) || sections[sections.length - 1];
    }

    function objectTemplate(type) {
        if (type === "drum") {
            return { type, halfX: 0.016, halfY: 0.105, mass: 1.35, color: "#a65e3f" };
        }
        if (type === "beam") {
            return { type, halfX: 0.055, halfY: 0.055, mass: 2.25, color: "#767b76" };
        }
        return { type: "crate", halfX: 0.02, halfY: 0.12, mass: 1, color: "#8a6d43" };
    }

    function createObject(type, x, y, vy, rotation = 0) {
        return {
            ...objectTemplate(type),
            x,
            y,
            vx: sectionFor(x).speed * sectionFor(x).beltTransfer,
            vy,
            rotation,
            spin: (random() - 0.5) * 0.8,
            hitTimer: 0
        };
    }

    function initialObjects() {
        return [
            createObject("crate", 0.27, -0.64, 0.34, 0.08),
            createObject("drum", 0.52, 0.52, -0.3, 0),
            createObject("beam", 0.73, -0.42, 0.26, -0.24)
        ];
    }

    function resetRun(ready = true) {
        vehicle.x = 0.055;
        vehicle.y = 0;
        vehicle.vx = 0;
        vehicle.vy = 0;
        vehicle.slip = 0;
        vehicle.phase = ready ? "ready" : "running";
        vehicle.status = ready ? "Ready" : "Running";
        vehicle.eventTimer = 0;
        vehicle.collisionTimer = 0;
        vehicle.runTime = 0;
        vehicle.finishTime = 0;
        world.sectionTimer = 2.4;
        world.speedFlash = 0;
        world.changedSection = 0;
        world.stepCount = 0;
        world.randomState = 4817;
        sections.forEach((section) => { section.overrideSpeed = null; });
        updateSectionSpeeds();
        world.objects = initialObjects();
        feeders.forEach((feeder, index) => {
            feeder.next = 0.35 + index * 0.48;
            feeder.index = index;
        });
        startButton.textContent = ready ? "Start run" : "Reset run";
    }

    function startRun() {
        if (vehicle.phase === "running") {
            resetRun(true);
            return;
        }
        resetRun(false);
    }

    startButton.addEventListener("click", startRun);
    // Beltline is live on arrival: the carrier and cross-feed freight move
    // immediately, while the same button remains a real reset/checkpoint control.
    resetRun(false);

    function stepSectionSpeeds() {
        sections.forEach((section) => { section.overrideSpeed = null; });
        if (settings.speedStep <= 0) {
            updateSectionSpeeds();
            world.sectionTimer = 2.8;
            return;
        }

        // Cycle through all sections so every zone visibly changes. The active
        // zone reverses against its own command; the other two keep their
        // independent velocities. The first event always reverses green rubber.
        world.changedSection = world.stepCount % sections.length;
        world.stepCount += 1;
        const section = sections[world.changedSection];
        const commandedSpeed = settings[section.settingKey];
        const reversalMagnitude = clamp(
            Math.abs(commandedSpeed) * 0.35 + settings.speedStep * 0.8,
            18,
            120
        );
        section.overrideSpeed = commandedSpeed >= 0 ? -reversalMagnitude : reversalMagnitude;
        updateSectionSpeeds();
        world.speedFlash = 1.35;
        world.sectionTimer = 2.8;
    }

    function spawnFromFeeder(feeder) {
        const types = ["crate", "drum", "beam"];
        const type = types[(feeder.index + Math.floor(random() * 3)) % types.length];
        const speed = 0.3 + random() * 0.19;
        const y = feeder.side * 1.2;
        const vy = -feeder.side * speed;
        world.objects.push(createObject(type, feeder.x, y, vy, (random() - 0.5) * 0.45));
        feeder.next = 2.4 + random() * 2.5;
    }

    function collideWithObjects(delta) {
        if (vehicle.collisionTimer > 0) {
            vehicle.collisionTimer -= delta;
        }

        world.objects.forEach((object) => {
            object.hitTimer = Math.max(0, object.hitTimer - delta);
            const closeX = Math.abs(vehicle.x - object.x) < 0.025 + object.halfX;
            const closeY = Math.abs(vehicle.y - object.y) < 0.105 + object.halfY;
            if (!closeX || !closeY || object.hitTimer > 0 || vehicle.collisionTimer > 0) {
                return;
            }

            const direction = vehicle.y <= object.y ? -1 : 1;
            vehicle.vx -= object.mass * (10 + Math.abs(object.vy) * 18);
            vehicle.vy += object.vy * object.mass * 0.72 + direction * 0.14;
            object.vy = -object.vy * (0.28 + 0.08 / object.mass);
            object.vx += vehicle.vx * 0.18;
            object.spin += direction * 2.3 / object.mass;
            object.hitTimer = 0.8;
            vehicle.collisionTimer = 0.36;
            vehicle.status = "Impact";
            vehicle.eventTimer = 0.8;
        });
    }

    function updateObjects(delta) {
        feeders.forEach((feeder) => {
            feeder.next -= delta;
            if (feeder.next <= 0) {
                spawnFromFeeder(feeder);
            }
        });

        world.objects.forEach((object) => {
            const section = sectionFor(object.x);
            const targetVx = section.speed * section.beltTransfer;
            object.vx = moveToward(object.vx, targetVx, section.friction * 36 * delta);
            object.x += (object.vx / 1500) * delta;
            object.y += object.vy * delta;
            object.rotation += object.spin * delta;
            object.spin *= Math.exp(-delta * 0.45);
        });

        world.objects = world.objects.filter((object) => (
            object.x > -0.1 && object.x < 1.12 && object.y > -1.5 && object.y < 1.5
        ));
    }

    function updateVehicle(delta) {
        const section = sectionFor(vehicle.x);
        const targetGroundSpeed = section.speed * section.beltTransfer
            + settings.wheelSpeed * section.wheelTransfer;
        const difference = targetGroundSpeed - vehicle.vx;
        const tractionRate = section.friction * 138;
        const applied = clamp(difference, -tractionRate * delta, tractionRate * delta);
        vehicle.vx += applied;
        vehicle.x += (vehicle.vx / 1500) * delta;

        const desiredY = settings.steering / 100 * 0.76;
        const desiredVy = (desiredY - vehicle.y) * 2.25;
        const lateralRate = 0.24 + section.friction * 3.1;
        vehicle.vy = moveToward(vehicle.vy, desiredVy, lateralRate * delta);
        vehicle.vy *= Math.exp(-delta * (0.18 + section.friction * 0.42));
        vehicle.y += vehicle.vy * delta;

        vehicle.slip = Math.abs(difference) / Math.max(30, Math.abs(targetGroundSpeed));
        vehicle.runTime += delta;
        vehicle.eventTimer = Math.max(0, vehicle.eventTimer - delta);

        collideWithObjects(delta);

        if (Math.abs(vehicle.y) > 0.96 || vehicle.x < -0.035) {
            vehicle.phase = "failed";
            vehicle.status = "Edge departure";
            vehicle.finishTime = 0;
            startButton.textContent = "Restart run";
            return;
        }
        if (vehicle.x >= 0.975) {
            vehicle.phase = "finished";
            vehicle.status = "Finish";
            vehicle.finishTime = 0;
            startButton.textContent = "Run again";
            return;
        }

        if (vehicle.eventTimer <= 0) {
            if (section.key === "rubber" && difference > 42 && applied > 0) {
                vehicle.status = "Grip launch";
            } else if (vehicle.slip > 0.28) {
                vehicle.status = "Sliding";
            } else {
                vehicle.status = "Running";
            }
        }
    }

    function update(delta) {
        world.time += delta;
        sections.forEach((section) => {
            section.travel += (section.speed / 180) * delta * 95;
        });

        if (vehicle.phase === "running") {
            world.sectionTimer -= delta;
            world.speedFlash = Math.max(0, world.speedFlash - delta);
            if (world.sectionTimer <= 0) {
                stepSectionSpeeds();
            }
            updateObjects(delta);
            updateVehicle(delta);
        } else if (vehicle.phase === "failed" || vehicle.phase === "finished") {
            vehicle.finishTime += delta;
            world.speedFlash = Math.max(0, world.speedFlash - delta);
        }

        const section = sectionFor(vehicle.x);
        phaseReadout.textContent = vehicle.status;
        speedReadout.textContent = `${Math.round(vehicle.vx)} km/h`;
        surfaceReadout.textContent = section.shortName;
    }

    function layout() {
        const width = world.width;
        const height = world.height;
        const left = Math.max(46, width * 0.055);
        const right = width - left;
        const top = Math.max(156, height * 0.285);
        const bottom = Math.min(height - 112, height * 0.73);
        return {
            left,
            right,
            top,
            bottom,
            length: right - left,
            depth: bottom - top,
            centreY: (top + bottom) * 0.5
        };
    }

    function screenX(position, frame) {
        return frame.left + position * frame.length;
    }

    function screenY(position, frame) {
        return frame.centreY + position * frame.depth * 0.5;
    }

    function drawBackground(ctx, frame) {
        const gradient = ctx.createLinearGradient(0, 0, 0, world.height);
        gradient.addColorStop(0, "#111414");
        gradient.addColorStop(1, "#090b0b");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, world.width, world.height);

        ctx.strokeStyle = "rgba(238,239,233,0.035)";
        ctx.lineWidth = 1;
        for (let y = 92; y < world.height; y += 42) {
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(world.width, y + 0.5);
            ctx.stroke();
        }

        ctx.fillStyle = "#171a19";
        roundedRectangle(ctx, frame.left - 20, frame.top - 22, frame.length + 40, frame.depth + 44, 18);
        ctx.fill();
        ctx.strokeStyle = "rgba(235,236,229,0.13)";
        ctx.stroke();
    }

    function drawBeltSection(ctx, section, index, frame) {
        const x0 = screenX(section.start, frame);
        const x1 = screenX(section.end, frame);
        const width = x1 - x0;
        const colors = {
            rubber: "#202922",
            steel: "#293032",
            rollers: "#171b1a"
        };
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, frame.top, width, frame.depth);
        ctx.clip();
        ctx.fillStyle = colors[section.key];
        ctx.fillRect(x0, frame.top, width, frame.depth);

        if (section.key === "rubber") {
            ctx.strokeStyle = "rgba(175,186,173,0.12)";
            ctx.lineWidth = 3;
            const offset = ((section.travel % 26) + 26) % 26;
            for (let x = x0 - 30 + offset; x < x1 + 30; x += 26) {
                ctx.beginPath();
                ctx.moveTo(x, frame.top - 8);
                ctx.lineTo(x - 18, frame.bottom + 8);
                ctx.stroke();
            }
        } else if (section.key === "steel") {
            const sheen = ctx.createLinearGradient(x0, frame.top, x1, frame.bottom);
            sheen.addColorStop(0, "rgba(202,220,219,0.02)");
            sheen.addColorStop(0.48, "rgba(202,220,219,0.15)");
            sheen.addColorStop(0.62, "rgba(202,220,219,0.025)");
            ctx.fillStyle = sheen;
            ctx.fillRect(x0, frame.top, width, frame.depth);
            ctx.strokeStyle = "rgba(188,211,211,0.09)";
            ctx.lineWidth = 1;
            const offset = ((section.travel % 38) + 38) % 38;
            for (let x = x0 - 40 + offset; x < x1 + 40; x += 38) {
                ctx.beginPath();
                ctx.moveTo(x, frame.top);
                ctx.lineTo(x + 14, frame.bottom);
                ctx.stroke();
            }
        } else {
            const spacing = Math.max(18, width / 13);
            const offset = ((section.travel % spacing) + spacing) % spacing;
            for (let x = x0 - spacing + offset; x < x1 + spacing; x += spacing) {
                ctx.fillStyle = "#343937";
                ctx.fillRect(x - 5, frame.top, 10, frame.depth);
                ctx.strokeStyle = "rgba(226,228,220,0.16)";
                ctx.beginPath();
                ctx.moveTo(x - 2, frame.top);
                ctx.lineTo(x - 2, frame.bottom);
                ctx.stroke();
            }
        }

        const direction = Math.sign(section.speed);
        if (direction !== 0) {
            ctx.fillStyle = "rgba(230,232,224,0.2)";
            ctx.font = "500 13px 'General Sans', sans-serif";
            ctx.textAlign = "center";
            const arrow = direction > 0 ? "›" : "‹";
            for (let x = x0 + 28; x < x1 - 18; x += 54) {
                ctx.fillText(arrow, x, frame.centreY + 5);
            }
        }
        ctx.restore();

        const active = sectionFor(vehicle.x) === section;
        ctx.fillStyle = active ? "#d6db8a" : "rgba(238,239,233,0.52)";
        ctx.font = "500 9px 'General Sans', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`0${index + 1}  ${section.name.toUpperCase()}`, x0 + 13, frame.top + 20);
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(section.speed)} KM/H`, x1 - 13, frame.top + 20);

        if (index > 0) {
            ctx.strokeStyle = "rgba(230,232,224,0.34)";
            ctx.setLineDash([4, 5]);
            ctx.beginPath();
            ctx.moveTo(x0, frame.top);
            ctx.lineTo(x0, frame.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    function drawFeeders(ctx, frame) {
        feeders.forEach((feeder) => {
            const x = screenX(feeder.x, frame);
            const upper = feeder.side < 0;
            const edge = upper ? frame.top : frame.bottom;
            const outer = upper ? frame.top - 74 : frame.bottom + 74;
            ctx.fillStyle = "#232725";
            ctx.strokeStyle = "rgba(235,236,229,0.15)";
            roundedRectangle(ctx, x - 25, Math.min(edge, outer), 50, Math.abs(outer - edge), 7);
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle = "rgba(182,189,50,0.5)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, outer + (upper ? -4 : 4));
            ctx.lineTo(x, edge + (upper ? 12 : -12));
            ctx.stroke();
            ctx.fillStyle = "#b6bd32";
            ctx.beginPath();
            ctx.moveTo(x, edge + (upper ? 12 : -12));
            ctx.lineTo(x - 5, edge + (upper ? 3 : -3));
            ctx.lineTo(x + 5, edge + (upper ? 3 : -3));
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = "rgba(238,239,233,0.38)";
            ctx.font = "500 7px 'General Sans', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(upper ? "UPPER FEED" : "LOWER FEED", x, upper ? outer - 9 : outer + 14);
        });
    }

    function drawObject(ctx, object, frame) {
        const x = screenX(object.x, frame);
        const y = screenY(object.y, frame);
        const width = Math.max(18, object.halfX * frame.length * 2);
        const height = Math.max(18, object.halfY * frame.depth);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(object.rotation);
        ctx.fillStyle = "rgba(0,0,0,0.34)";
        if (object.type === "drum") {
            ctx.beginPath();
            ctx.ellipse(3, 4, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = object.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(245,239,224,0.4)";
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-width * 0.42, -2);
            ctx.lineTo(width * 0.42, -2);
            ctx.moveTo(-width * 0.38, 3);
            ctx.lineTo(width * 0.38, 3);
            ctx.stroke();
        } else {
            roundedRectangle(ctx, -width * 0.5 + 3, -height * 0.5 + 4, width, height, object.type === "beam" ? 3 : 5);
            ctx.fill();
            ctx.fillStyle = object.color;
            roundedRectangle(ctx, -width * 0.5, -height * 0.5, width, height, object.type === "beam" ? 3 : 5);
            ctx.fill();
            ctx.strokeStyle = "rgba(244,241,229,0.34)";
            ctx.stroke();
            ctx.strokeStyle = object.type === "beam" ? "rgba(12,13,13,0.4)" : "rgba(34,25,16,0.46)";
            ctx.beginPath();
            ctx.moveTo(-width * 0.38, -height * 0.32);
            ctx.lineTo(width * 0.38, height * 0.32);
            ctx.moveTo(width * 0.38, -height * 0.32);
            ctx.lineTo(-width * 0.38, height * 0.32);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawVehicle(ctx, frame) {
        const x = screenX(vehicle.x, frame);
        const y = screenY(vehicle.y, frame);
        const slipShake = vehicle.status === "Sliding" ? Math.sin(world.time * 25) * 2 : 0;
        const heading = clamp(vehicle.vy * 0.18, -0.16, 0.16);
        ctx.save();
        ctx.translate(x, y + slipShake);
        ctx.rotate(heading);

        if (vehicle.status === "Grip launch") {
            ctx.fillStyle = "rgba(182,189,50,0.13)";
            ctx.beginPath();
            ctx.ellipse(-22, 0, 42, 23, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = "rgba(0,0,0,0.45)";
        roundedRectangle(ctx, -25, -13 + 4, 50, 27, 8);
        ctx.fill();
        ctx.fillStyle = vehicle.collisionTimer > 0 ? "#b66a45" : "#d8dad3";
        roundedRectangle(ctx, -25, -13, 50, 27, 8);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,248,0.46)";
        ctx.stroke();
        ctx.fillStyle = "#343836";
        roundedRectangle(ctx, -8, -9, 19, 18, 5);
        ctx.fill();
        ctx.fillStyle = "#0b0c0c";
        ctx.fillRect(-18, -17, 11, 5);
        ctx.fillRect(8, -17, 11, 5);
        ctx.fillRect(-18, 12, 11, 5);
        ctx.fillRect(8, 12, 11, 5);
        ctx.fillStyle = "#b6bd32";
        ctx.fillRect(19, -7, 4, 5);
        ctx.fillRect(19, 4, 4, 5);
        ctx.restore();

        if (vehicle.status === "Sliding") {
            ctx.strokeStyle = "rgba(205,214,208,0.21)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 44, y - 12);
            ctx.lineTo(x - 78, y - 17 - vehicle.vy * 12);
            ctx.moveTo(x - 44, y + 12);
            ctx.lineTo(x - 78, y + 17 - vehicle.vy * 12);
            ctx.stroke();
        }
    }

    function drawCourseDetails(ctx, frame) {
        const targetY = screenY(settings.steering / 100 * 0.76, frame);
        ctx.strokeStyle = "rgba(182,189,50,0.34)";
        ctx.setLineDash([7, 9]);
        ctx.beginPath();
        ctx.moveTo(frame.left + 8, targetY);
        ctx.lineTo(frame.right - 8, targetY);
        ctx.stroke();
        ctx.setLineDash([]);

        const finishX = screenX(0.975, frame);
        const cells = 8;
        for (let row = 0; row < cells; row += 1) {
            for (let column = 0; column < 2; column += 1) {
                ctx.fillStyle = (row + column) % 2 ? "#e4e5de" : "#232625";
                ctx.fillRect(finishX + column * 7 - 7, frame.top + row * frame.depth / cells, 7, frame.depth / cells + 1);
            }
        }
        ctx.fillStyle = "rgba(238,239,233,0.56)";
        ctx.font = "500 8px 'General Sans', sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("TRANSFER EXIT", finishX - 8, frame.bottom + 18);

        ctx.strokeStyle = "rgba(237,239,231,0.18)";
        ctx.lineWidth = 3;
        ctx.strokeRect(frame.left, frame.top, frame.length, frame.depth);
        ctx.strokeStyle = "rgba(182,189,50,0.42)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(frame.left, frame.top);
        ctx.lineTo(frame.right, frame.top);
        ctx.moveTo(frame.left, frame.bottom);
        ctx.lineTo(frame.right, frame.bottom);
        ctx.stroke();
    }

    function drawStatus(ctx, frame) {
        if (world.speedFlash > 0) {
            const section = sections[world.changedSection];
            const x0 = screenX(section.start, frame);
            const x1 = screenX(section.end, frame);
            ctx.fillStyle = `rgba(226,78,73,${0.05 + world.speedFlash * 0.055})`;
            ctx.fillRect(x0, frame.top, x1 - x0, frame.depth);
            ctx.fillStyle = "#e07870";
            ctx.font = "500 9px 'General Sans', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("SECTION REVERSED", (x0 + x1) * 0.5, frame.bottom - 16);
        }

        if (vehicle.phase === "failed" || vehicle.phase === "finished") {
            ctx.fillStyle = "rgba(8,9,9,0.72)";
            roundedRectangle(ctx, world.width * 0.5 - 118, frame.centreY - 39, 236, 78, 15);
            ctx.fill();
            ctx.strokeStyle = vehicle.phase === "finished" ? "rgba(182,189,50,0.56)" : "rgba(226,120,112,0.52)";
            ctx.stroke();
            ctx.fillStyle = vehicle.phase === "finished" ? "#d6db8a" : "#e08b82";
            ctx.font = "500 10px 'General Sans', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(vehicle.phase === "finished" ? "TRANSFER COMPLETE" : "COURSE DEPARTURE", world.width * 0.5, frame.centreY - 7);
            ctx.fillStyle = "rgba(239,240,234,0.58)";
            ctx.font = "400 9px 'General Sans', sans-serif";
            ctx.fillText("Use Restart run to return to the entry checkpoint", world.width * 0.5, frame.centreY + 13);
        }
    }

    function draw() {
        const ctx = context;
        const frame = layout();
        ctx.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
        ctx.clearRect(0, 0, world.width, world.height);
        drawBackground(ctx, frame);
        sections.forEach((section, index) => drawBeltSection(ctx, section, index, frame));
        drawCourseDetails(ctx, frame);
        drawFeeders(ctx, frame);
        world.objects.forEach((object) => drawObject(ctx, object, frame));
        drawVehicle(ctx, frame);
        drawStatus(ctx, frame);
    }

    function resize() {
        if (page.hidden) {
            return;
        }
        const bounds = surface.getBoundingClientRect();
        if (bounds.width < 10 || bounds.height < 10) {
            return;
        }
        world.width = Math.round(bounds.width);
        world.height = Math.round(bounds.height);
        world.dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(world.width * world.dpr);
        canvas.height = Math.round(world.height * world.dpr);
        canvas.style.width = `${world.width}px`;
        canvas.style.height = `${world.height}px`;
        context.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
    }

    function setSteeringFromPointer(event) {
        const frame = layout();
        const bounds = canvas.getBoundingClientRect();
        const localY = (event.clientY - bounds.top) * (world.height / bounds.height);
        const normalized = clamp((localY - frame.centreY) / (frame.depth * 0.5), -1, 1);
        const control = controls[5];
        control.input.value = String(Math.round(normalized / 0.76 * 100));
        control.update();
    }

    canvas.addEventListener("pointerdown", (event) => {
        pointerActive = true;
        canvas.setPointerCapture?.(event.pointerId);
        setSteeringFromPointer(event);
    });
    canvas.addEventListener("pointermove", (event) => {
        if (pointerActive) {
            setSteeringFromPointer(event);
        }
    });
    canvas.addEventListener("pointerup", () => { pointerActive = false; });
    canvas.addEventListener("pointercancel", () => { pointerActive = false; });

    function loop(timestamp) {
        const delta = Math.min(0.033, Math.max(0.001, (timestamp - lastTime) / 1000));
        lastTime = timestamp;
        if (!page.hidden && document.visibilityState !== "hidden") {
            update(delta);
            draw();
        }
        requestAnimationFrame(loop);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    window.addEventListener("resize", resize, { passive: true });
    window.beltline = { resize, startRun };
    requestAnimationFrame(loop);
})();
