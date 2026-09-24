"use strict";

(() => {
    const svg = document.getElementById("tidelock-svg");
    if (!svg) {
        return;
    }

    const page = document.getElementById("tidelock");
    const resetButton = document.getElementById("tide-reset");
    const carrierGraphic = document.getElementById("tide-carrier");
    const wakeGraphic = document.getElementById("tide-wake");
    const impactGraphic = document.getElementById("tide-impact-ring");
    const currentGraphic = document.getElementById("tide-current-arrows");
    const freightLayer = document.getElementById("tide-freight-layer");
    const phaseReadout = document.getElementById("tide-phase-readout");
    const delayReadout = document.getElementById("tide-delay-readout");
    const gateReadout = document.getElementById("tide-gate-readout");
    const waterGraphics = [
        document.getElementById("tide-water-a"),
        document.getElementById("tide-water-b"),
        document.getElementById("tide-water-c")
    ];
    const depthReadouts = [
        document.getElementById("tide-depth-a"),
        document.getElementById("tide-depth-b"),
        document.getElementById("tide-depth-c")
    ];
    const gateGraphics = {
        aNorth: document.getElementById("tide-gate-a-north"),
        aSouth: document.getElementById("tide-gate-a-south"),
        bNorth: document.getElementById("tide-gate-b-north"),
        bSouth: document.getElementById("tide-gate-b-south")
    };

    const settings = {
        gatePeriod: 10,
        gateOffset: 0.2,
        pumpBias: 0.65,
        waterDepth: 1.8,
        ballast: 1.9,
        freightCount: 5
    };

    const detentionTarget = 8;
    const routePoints = [
        { x: 40, y: 566 },
        { x: 120, y: 560 },
        { x: 216, y: 501 },
        { x: 310, y: 430 },
        { x: 392, y: 364 },
        { x: 478, y: 278 },
        { x: 552, y: 254 },
        { x: 635, y: 315 },
        { x: 709, y: 366 },
        { x: 778, y: 458 },
        { x: 850, y: 449 },
        { x: 930, y: 330 },
        { x: 1038, y: 245 }
    ];

    const carrier = {
        progress: 0,
        speed: 0,
        offset: 0,
        offsetVelocity: 0,
        delay: 0,
        passedA: false,
        passedB: false,
        collisionTimer: 0,
        impactFlash: 0,
        result: "running",
        status: "Entering lock",
        x: routePoints[0].x,
        y: routePoints[0].y,
        angle: 0
    };

    const world = {
        time: 0,
        lastTime: performance.now(),
        gateA: 0,
        gateB: 0,
        freight: [],
        randomSeed: 987631,
        wasVisible: false
    };

    const controlDefinitions = [
        {
            input: document.getElementById("tide-gate-period"),
            output: document.getElementById("tide-gate-period-output"),
            apply: (number) => { settings.gatePeriod = number / 10; },
            format: (number) => `${(number / 10).toFixed(1)} s`
        },
        {
            input: document.getElementById("tide-gate-offset"),
            output: document.getElementById("tide-gate-offset-output"),
            apply: (number) => { settings.gateOffset = number / 100; },
            format: (number) => `${(number / 100 * settings.gatePeriod).toFixed(1)} s`
        },
        {
            input: document.getElementById("tide-pump-bias"),
            output: document.getElementById("tide-pump-bias-output"),
            apply: (number) => { settings.pumpBias = number / 100; },
            format: (number) => number < -4 ? `North ${Math.abs(number)}%` : number > 4 ? `South ${number}%` : "Balanced"
        },
        {
            input: document.getElementById("tide-water-depth"),
            output: document.getElementById("tide-water-depth-output"),
            apply: (number) => { settings.waterDepth = number / 10; updateWaterDisplay(); },
            format: (number) => `${(number / 10).toFixed(1)} m`
        },
        {
            input: document.getElementById("tide-ballast"),
            output: document.getElementById("tide-ballast-output"),
            apply: (number) => { settings.ballast = number / 10; },
            format: (number) => `${(number / 10).toFixed(1)} t`
        },
        {
            input: document.getElementById("tide-freight"),
            output: document.getElementById("tide-freight-output"),
            apply: (number) => {
                settings.freightCount = number;
                matchFreightCount();
            },
            format: (number) => `${number} ${number === 1 ? "unit" : "units"}`
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

    function smoothstep(number) {
        const ratio = clamp(number, 0, 1);
        return ratio * ratio * (3 - 2 * ratio);
    }

    function random() {
        world.randomSeed = (world.randomSeed * 1664525 + 1013904223) >>> 0;
        return world.randomSeed / 4294967296;
    }

    function modular(number, divisor) {
        return ((number % divisor) + divisor) % divisor;
    }

    function syncControl(definition) {
        const number = Number(definition.input.value);
        definition.apply(number);
        const label = definition.format(number);
        definition.output.value = label;
        definition.output.textContent = label;
        const minimum = Number(definition.input.min);
        const maximum = Number(definition.input.max);
        const position = ((number - minimum) / Math.max(1, maximum - minimum)) * 100;
        definition.input.style.setProperty("--range-position", `${position}%`);
    }

    controlDefinitions.forEach((definition, index) => {
        definition.update = () => {
            syncControl(definition);
            if (index === 0) {
                syncControl(controlDefinitions[1]);
            }
        };
        definition.input.addEventListener("input", definition.update);
    });

    function updateWaterDisplay() {
        const depths = [settings.waterDepth * 0.78, settings.waterDepth, settings.waterDepth * 0.64];
        depths.forEach((depth, index) => {
            if (depthReadouts[index]) {
                depthReadouts[index].textContent = `${depth.toFixed(1)} M`;
            }
            if (waterGraphics[index]) {
                waterGraphics[index].style.opacity = `${clamp(0.58 + depth * 0.13, 0.62, 0.96)}`;
                waterGraphics[index].style.filter = `saturate(${(0.78 + depth * 0.13).toFixed(2)}) brightness(${(1.08 - depth * 0.08).toFixed(2)})`;
            }
        });
    }

    function freightTemplate(index) {
        const layouts = [
            { chamber: 1, x: 467, y: 386 },
            { chamber: 1, x: 578, y: 331 },
            { chamber: 1, x: 634, y: 455 },
            { chamber: 2, x: 779, y: 338 },
            { chamber: 2, x: 849, y: 291 },
            { chamber: 2, x: 904, y: 472 },
            { chamber: 0, x: 259, y: 218 },
            { chamber: 0, x: 315, y: 548 },
            { chamber: 0, x: 208, y: 440 },
            { chamber: 1, x: 524, y: 476 },
            { chamber: 2, x: 926, y: 354 },
            { chamber: 1, x: 659, y: 237 }
        ];
        const layout = layouts[index % layouts.length];
        const type = index % 3 === 1 ? "drum" : "crate";
        return {
            index,
            type,
            chamber: layout.chamber,
            x: layout.x + (random() - 0.5) * 15,
            y: layout.y + (random() - 0.5) * 15,
            velocityX: (random() - 0.5) * 7,
            velocityY: (random() - 0.5) * 7,
            rotation: random() * 360,
            spin: (random() - 0.5) * 32,
            radius: type === "drum" ? 18 : 25,
            graphic: null,
            hit: 0
        };
    }

    function makeFreightGraphic(piece) {
        const namespace = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(namespace, "g");
        const use = document.createElementNS(namespace, "use");
        group.setAttribute("class", `tide-freight tide-freight-${piece.type}`);
        use.setAttribute("href", piece.type === "drum" ? "#tide-drum-symbol" : "#tide-crate-symbol");
        use.setAttribute("x", piece.type === "drum" ? "-18" : "-22");
        use.setAttribute("y", piece.type === "drum" ? "-18" : "-17");
        use.setAttribute("width", piece.type === "drum" ? "36" : "44");
        use.setAttribute("height", piece.type === "drum" ? "36" : "34");
        group.appendChild(use);
        freightLayer.appendChild(group);
        piece.graphic = group;
    }

    function matchFreightCount() {
        while (world.freight.length < settings.freightCount) {
            const piece = freightTemplate(world.freight.length);
            makeFreightGraphic(piece);
            world.freight.push(piece);
        }
        while (world.freight.length > settings.freightCount) {
            const piece = world.freight.pop();
            piece.graphic?.remove();
        }
    }

    function routePosition(progress) {
        const maximumIndex = routePoints.length - 1;
        const scaled = clamp(progress, 0, 0.999999) * maximumIndex;
        const index = Math.floor(scaled);
        const local = scaled - index;
        const p0 = routePoints[Math.max(0, index - 1)];
        const p1 = routePoints[index];
        const p2 = routePoints[Math.min(maximumIndex, index + 1)];
        const p3 = routePoints[Math.min(maximumIndex, index + 2)];
        const local2 = local * local;
        const local3 = local2 * local;
        return {
            x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * local + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * local2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * local3),
            y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * local + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * local2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * local3)
        };
    }

    function gateOpenness(phase) {
        if (phase < 0.13) {
            return 0;
        }
        if (phase < 0.28) {
            return smoothstep((phase - 0.13) / 0.15);
        }
        if (phase < 0.51) {
            return 1;
        }
        if (phase < 0.7) {
            return 1 - smoothstep((phase - 0.51) / 0.19);
        }
        return 0;
    }

    function updateGates() {
        const phaseA = modular(world.time / settings.gatePeriod, 1);
        const phaseB = modular(phaseA + settings.gateOffset, 1);
        world.gateA = gateOpenness(phaseA);
        world.gateB = gateOpenness(phaseB);

        const aAngle = world.gateA * 77;
        const bAngle = world.gateB * 77;
        gateGraphics.aNorth.setAttribute("transform", `rotate(${-aAngle.toFixed(2)} 392 134)`);
        gateGraphics.aSouth.setAttribute("transform", `rotate(${aAngle.toFixed(2)} 392 614)`);
        gateGraphics.bNorth.setAttribute("transform", `rotate(${-bAngle.toFixed(2)} 709 134)`);
        gateGraphics.bSouth.setAttribute("transform", `rotate(${bAngle.toFixed(2)} 709 614)`);

        const status = (openness) => openness > 0.72 ? "open" : openness > 0.12 ? "moving" : "shut";
        gateReadout.textContent = `A ${status(world.gateA)} · B ${status(world.gateB)}`;
        svg.style.setProperty("--tide-gate-a-open", world.gateA.toFixed(3));
        svg.style.setProperty("--tide-gate-b-open", world.gateB.toFixed(3));
    }

    function freightBounds(piece) {
        if (piece.chamber === 0) {
            return { left: 116, right: 369, top: 155, bottom: 594 };
        }
        if (piece.chamber === 1) {
            return { left: 417, right: 683, top: 155, bottom: 594 };
        }
        return { left: 734, right: 983, top: 155, bottom: 594 };
    }

    function updateFreight(delta) {
        const currentAcceleration = settings.pumpBias * (16 + settings.waterDepth * 9);
        world.freight.forEach((piece, index) => {
            const bounds = freightBounds(piece);
            const eddy = Math.sin(world.time * 0.8 + index * 1.71) * 4.5;
            piece.velocityY += (currentAcceleration + eddy) * delta;
            piece.velocityX += Math.cos(world.time * 0.58 + index * 2.3) * 2.2 * delta;
            piece.velocityX *= Math.pow(0.975, delta * 60);
            piece.velocityY *= Math.pow(0.972, delta * 60);
            piece.x += piece.velocityX * delta;
            piece.y += piece.velocityY * delta;
            piece.rotation += piece.spin * delta;
            piece.hit = Math.max(0, piece.hit - delta * 2.4);

            if (piece.x < bounds.left + piece.radius) {
                piece.x = bounds.left + piece.radius;
                piece.velocityX = Math.abs(piece.velocityX) * 0.64;
                piece.spin += 8;
            } else if (piece.x > bounds.right - piece.radius) {
                piece.x = bounds.right - piece.radius;
                piece.velocityX = -Math.abs(piece.velocityX) * 0.64;
                piece.spin -= 8;
            }
            if (piece.y < bounds.top + piece.radius) {
                piece.y = bounds.top + piece.radius;
                piece.velocityY = Math.abs(piece.velocityY) * 0.58;
            } else if (piece.y > bounds.bottom - piece.radius) {
                piece.y = bounds.bottom - piece.radius;
                piece.velocityY = -Math.abs(piece.velocityY) * 0.58;
            }

            piece.graphic?.setAttribute("transform", `translate(${piece.x.toFixed(1)} ${piece.y.toFixed(1)}) rotate(${piece.rotation.toFixed(1)}) scale(${(1 + piece.hit * 0.13).toFixed(2)})`);
        });

        for (let firstIndex = 0; firstIndex < world.freight.length; firstIndex += 1) {
            const first = world.freight[firstIndex];
            for (let secondIndex = firstIndex + 1; secondIndex < world.freight.length; secondIndex += 1) {
                const second = world.freight[secondIndex];
                if (first.chamber !== second.chamber) {
                    continue;
                }
                const dx = second.x - first.x;
                const dy = second.y - first.y;
                const distance = Math.hypot(dx, dy);
                const separation = first.radius + second.radius;
                if (distance <= 0 || distance >= separation) {
                    continue;
                }
                const normalX = dx / distance;
                const normalY = dy / distance;
                const overlap = separation - distance;
                first.x -= normalX * overlap * 0.5;
                first.y -= normalY * overlap * 0.5;
                second.x += normalX * overlap * 0.5;
                second.y += normalY * overlap * 0.5;
                const impulse = (second.velocityX - first.velocityX) * normalX + (second.velocityY - first.velocityY) * normalY;
                first.velocityX += normalX * impulse * 0.62;
                first.velocityY += normalY * impulse * 0.62;
                second.velocityX -= normalX * impulse * 0.62;
                second.velocityY -= normalY * impulse * 0.62;
                first.spin -= impulse * 0.8;
                second.spin += impulse * 0.8;
            }
        }
    }

    function carrierPhysics() {
        const buoyancy = clamp((settings.waterDepth * 1.25 - settings.ballast * 0.55) / 2.2, 0, 0.88);
        const tyreLoad = clamp(1 - buoyancy, 0.12, 1);
        return { buoyancy, tyreLoad };
    }

    function carrierGateHold(point) {
        if (!carrier.passedA && point.x >= 350) {
            if (world.gateA > 0.72) {
                carrier.passedA = true;
            } else {
                return "Gate A";
            }
        }
        if (carrier.passedA && !carrier.passedB && point.x >= 671) {
            if (world.gateB > 0.72) {
                carrier.passedB = true;
            } else {
                return "Gate B";
            }
        }
        return null;
    }

    function strikeFreight(delta) {
        if (carrier.collisionTimer > 0 || carrier.result !== "running") {
            return false;
        }
        let struck = false;
        world.freight.forEach((piece) => {
            const dx = piece.x - carrier.x;
            const dy = piece.y - carrier.y;
            const distance = Math.hypot(dx, dy);
            const strikeDistance = piece.radius + 29;
            if (distance >= strikeDistance || distance <= 0) {
                return;
            }
            const normalX = dx / distance;
            const normalY = dy / distance;
            const impact = Math.max(24, carrier.speed * 1200);
            const overlap = strikeDistance - distance + 6;
            piece.x += normalX * overlap;
            piece.y += normalY * overlap;
            piece.velocityX += normalX * impact;
            piece.velocityY += normalY * impact;
            piece.spin += (normalX - normalY) * 90;
            piece.hit = 1;
            carrier.offsetVelocity -= normalY * impact * 0.18;
            carrier.collisionTimer = 0.72;
            carrier.impactFlash = 1;
            carrier.status = piece.type === "drum" ? "Drum impact" : "Freight impact";
            carrier.delay = Math.min(detentionTarget, carrier.delay + 0.12);
            struck = true;
        });
        return struck;
    }

    function finishRun(result, status) {
        if (carrier.result !== "running") {
            return;
        }
        carrier.result = result;
        carrier.status = status;
        carrier.speed = 0;
        svg.dataset.result = result;
        phaseReadout.parentElement?.classList.toggle("is-success", result === "detained" || result === "swept");
        phaseReadout.parentElement?.classList.toggle("is-failure", result === "escaped");
        resetButton.textContent = "Run another test";
    }

    function updateCarrier(delta) {
        if (carrier.result !== "running") {
            carrier.impactFlash = Math.max(0, carrier.impactFlash - delta * 1.8);
            return;
        }

        const physics = carrierPhysics();
        const currentForce = settings.pumpBias * 90 * (settings.waterDepth / 2.8) * (1.15 - physics.tyreLoad);
        const correctionForce = carrier.offset * (0.45 + physics.tyreLoad * 2.1);
        carrier.offsetVelocity += (currentForce - correctionForce) * delta;
        carrier.offsetVelocity *= Math.pow(0.94, delta * 60);
        carrier.offset += carrier.offsetVelocity * delta;
        carrier.collisionTimer = Math.max(0, carrier.collisionTimer - delta);
        carrier.impactFlash = Math.max(0, carrier.impactFlash - delta * 2.2);

        let point = routePosition(carrier.progress);
        const heldBy = carrierGateHold(point);
        const flooded = carrier.progress > 0.07 && carrier.progress < 0.93;
        const ballastDrag = clamp((settings.ballast - 0.8) / 5.3, 0, 0.22);
        let targetSpeed = 0.047 * (1 - ballastDrag);
        if (flooded) {
            targetSpeed *= 1 - physics.buoyancy * 0.28;
        }
        if (heldBy) {
            targetSpeed = 0;
            carrier.status = `Held at ${heldBy}`;
        } else if (carrier.collisionTimer > 0) {
            targetSpeed *= 0.32;
        } else if (carrier.progress < 0.07) {
            carrier.status = "Entering lock";
        } else if (!carrier.passedA) {
            carrier.status = "Chamber 01";
        } else if (!carrier.passedB) {
            carrier.status = "Chamber 02";
        } else {
            carrier.status = "Final chamber";
        }

        const acceleration = targetSpeed > carrier.speed ? 0.019 * physics.tyreLoad + 0.004 : 0.08;
        carrier.speed = moveToward(carrier.speed, targetSpeed, acceleration * delta);
        carrier.progress = clamp(carrier.progress + carrier.speed * delta, 0, 1);
        point = routePosition(carrier.progress);
        carrier.x = point.x;
        carrier.y = point.y + carrier.offset;

        const isDelayed = Boolean(heldBy) || carrier.collisionTimer > 0 || (Math.abs(carrier.offset) > 72 && carrier.speed < 0.018);
        if (isDelayed) {
            carrier.delay = Math.min(detentionTarget, carrier.delay + delta);
        }

        strikeFreight(delta);

        if (Math.abs(carrier.offset) > 124 || carrier.y < 145 || carrier.y > 606) {
            finishRun("swept", "Swept into pump cage");
        } else if (carrier.delay >= detentionTarget) {
            finishRun("detained", "Carrier detained");
        } else if (carrier.progress >= 0.999) {
            finishRun("escaped", "Carrier reached finish");
        }
    }

    function updateGraphics() {
        const forward = routePosition(clamp(carrier.progress + 0.002, 0, 1));
        const backward = routePosition(clamp(carrier.progress - 0.002, 0, 1));
        carrier.angle = Math.atan2(forward.y - backward.y, forward.x - backward.x) * 180 / Math.PI;
        const transform = `translate(${carrier.x.toFixed(1)} ${carrier.y.toFixed(1)}) rotate(${carrier.angle.toFixed(1)})`;
        carrierGraphic.setAttribute("transform", transform);
        wakeGraphic.setAttribute("transform", transform);
        wakeGraphic.style.opacity = carrier.progress > 0.06 && carrier.progress < 0.94 ? `${clamp(carrier.speed * 21, 0.1, 0.84)}` : "0";

        impactGraphic.setAttribute("transform", `translate(${carrier.x.toFixed(1)} ${carrier.y.toFixed(1)})`);
        impactGraphic.style.opacity = `${carrier.impactFlash}`;
        impactGraphic.style.transformOrigin = `${carrier.x}px ${carrier.y}px`;

        const pumpStrength = Math.abs(settings.pumpBias);
        currentGraphic.style.opacity = `${0.15 + pumpStrength * 0.78}`;
        currentGraphic.style.strokeWidth = `${2.5 + pumpStrength * 3.5}px`;
        currentGraphic.setAttribute("transform", settings.pumpBias < 0 ? "translate(0 720) scale(1 -1)" : "");
        svg.style.setProperty("--tide-pump-speed", `${Math.max(0.45, 2.8 - pumpStrength * 2.1).toFixed(2)}s`);
        svg.style.setProperty("--tide-current-speed", `${Math.max(0.65, 2.5 - pumpStrength * 1.5).toFixed(2)}s`);

        phaseReadout.textContent = carrier.status;
        delayReadout.textContent = `${carrier.delay.toFixed(1)} / ${detentionTarget} s`;
        delayReadout.parentElement?.style.setProperty("--tide-delay", `${carrier.delay / detentionTarget * 100}%`);
    }

    function resetRun() {
        carrier.progress = 0;
        carrier.speed = 0;
        carrier.offset = 0;
        carrier.offsetVelocity = 0;
        carrier.delay = 0;
        carrier.passedA = false;
        carrier.passedB = false;
        carrier.collisionTimer = 0;
        carrier.impactFlash = 0;
        carrier.result = "running";
        carrier.status = "Entering lock";
        const point = routePosition(0);
        carrier.x = point.x;
        carrier.y = point.y;
        svg.dataset.result = "running";
        phaseReadout.parentElement?.classList.remove("is-success", "is-failure");
        resetButton.textContent = "Reset carrier";
        world.randomSeed = 987631;
        world.freight.forEach((piece, index) => {
            const replacement = freightTemplate(index);
            piece.chamber = replacement.chamber;
            piece.x = replacement.x;
            piece.y = replacement.y;
            piece.velocityX = replacement.velocityX;
            piece.velocityY = replacement.velocityY;
            piece.rotation = replacement.rotation;
            piece.spin = replacement.spin;
            piece.hit = 0;
        });
        updateGraphics();
    }

    function resize() {
        svg.style.setProperty("--tide-aspect", `${svg.clientWidth / Math.max(1, svg.clientHeight)}`);
        updateGraphics();
    }

    controlDefinitions.forEach((definition) => syncControl(definition));
    matchFreightCount();
    updateWaterDisplay();
    resetRun();

    resetButton.addEventListener("click", resetRun);

    function animate(time) {
        const delta = Math.min(0.05, Math.max(0, (time - world.lastTime) / 1000));
        world.lastTime = time;
        const visible = !page.hidden && document.visibilityState !== "hidden";
        if (visible) {
            world.wasVisible = true;
            world.time += delta;
            updateGates();
            updateFreight(delta);
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

    window.tidelock = { resize, reset: resetRun };
    requestAnimationFrame(animate);
})();
