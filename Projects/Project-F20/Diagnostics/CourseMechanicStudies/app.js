"use strict";

(() => {
    const pageNames = ["index", "iron-tide", "dead-weight", "breaker-wave", "beltline", "beachhead", "shunt", "ringfall"];
    const pages = new Map(pageNames.map((name) => [name, document.getElementById(name)]));
    const pageLinks = Array.from(document.querySelectorAll("[data-page]"));
    let currentPage = "index";

    function showPage(name) {
        const nextPage = pageNames.includes(name) ? name : "index";
        currentPage = nextPage;

        pages.forEach((page, pageName) => {
            const active = pageName === nextPage;
            page.hidden = !active;
            page.classList.toggle("is-active", active);
        });

        pageLinks.forEach((link) => {
            const active = link.dataset.page === nextPage;
            link.classList.toggle("is-active", active);
            if (link.closest(".publication-nav")) {
                if (active) {
                    link.setAttribute("aria-current", "page");
                } else {
                    link.removeAttribute("aria-current");
                }
            }
        });

        document.title = nextPage === "iron-tide"
            ? "Iron Tide — Frontier Field Studies"
            : nextPage === "dead-weight"
                ? "Dead Weight — Frontier Field Studies"
                : nextPage === "breaker-wave"
                    ? "Breaker Wave — Frontier Field Studies"
                    : nextPage === "beltline"
                        ? "Beltline — Frontier Field Studies"
                        : nextPage === "beachhead"
                            ? "Beachhead — Frontier Field Studies"
                            : nextPage === "shunt"
                                ? "Shunt — Frontier Field Studies"
                                : nextPage === "ringfall"
                                    ? "Ringfall — Frontier Field Studies"
                                    : "Index — Frontier Field Studies";

        window.scrollTo({ top: 0, behavior: "auto" });
        if (nextPage === "iron-tide") {
            requestAnimationFrame(resizeCanvas);
        } else if (nextPage === "dead-weight") {
            requestAnimationFrame(resizeDeadCanvas);
        } else if (nextPage === "breaker-wave") {
            requestAnimationFrame(() => window.breakerWave?.resize());
        } else if (nextPage === "beltline") {
            requestAnimationFrame(() => window.beltline?.resize());
        } else if (nextPage === "beachhead") {
            requestAnimationFrame(() => window.beachhead?.resize());
        } else if (nextPage === "shunt") {
            requestAnimationFrame(() => window.shunt?.resize());
        } else if (nextPage === "ringfall") {
            requestAnimationFrame(() => window.ringfall?.resize());
        }
    }

    pageLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            const target = link.dataset.page;
            if (!pageNames.includes(target)) {
                return;
            }
            event.preventDefault();
            if (window.location.hash === `#${target}`) {
                showPage(target);
            } else {
                window.location.hash = target;
            }
        });
    });

    window.addEventListener("hashchange", () => {
        showPage(window.location.hash.slice(1));
    });

    const canvas = document.getElementById("iron-canvas");
    const context = canvas.getContext("2d", { alpha: false });
    const surface = canvas.parentElement;
    const readouts = {
        vehicles: document.getElementById("vehicle-readout"),
        scrap: document.getElementById("scrap-readout"),
        field: document.getElementById("field-readout")
    };

    const settings = {
        friction: 0.68,
        vehicleMetal: 0.55,
        scrapAmount: 24,
        magnetPower: 0.68,
        craneCount: 3
    };

    const world = {
        width: 1000,
        height: 650,
        dpr: 1,
        time: 0,
        roadWidth: 300,
        fieldLoad: 0
    };

    let cranes = [];
    let cars = [];
    let scrap = [];
    const feeders = [
        { side: -1, progress: 0.12, pace: 0.16, deliveries: 0 },
        { side: 1, progress: 0.58, pace: 0.13, deliveries: 0 }
    ];
    let lastTime = performance.now();
    let lastReadout = 0;

    const controls = [
        {
            input: document.getElementById("tyre-friction"),
            output: document.getElementById("tyre-friction-output"),
            apply: (number) => { settings.friction = number / 100; },
            format: (number) => `${(number / 100).toFixed(2)} µ`
        },
        {
            input: document.getElementById("vehicle-metal"),
            output: document.getElementById("vehicle-metal-output"),
            apply: (number) => { settings.vehicleMetal = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("scrap-amount"),
            output: document.getElementById("scrap-amount-output"),
            apply: (number) => {
                settings.scrapAmount = number;
                matchScrapAmount();
            },
            format: (number) => `${number}`
        },
        {
            input: document.getElementById("magnet-power"),
            output: document.getElementById("magnet-power-output"),
            apply: (number) => { settings.magnetPower = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("crane-count"),
            output: document.getElementById("crane-count-output"),
            apply: (number) => {
                settings.craneCount = number;
                createCranes();
            },
            format: (number) => `${number}`
        }
    ];

    controls.forEach((control) => {
        function updateControl() {
            const number = Number(control.input.value);
            control.output.value = control.format(number);
            control.output.textContent = control.format(number);
            control.apply(number);
            const minimum = Number(control.input.min);
            const maximum = Number(control.input.max);
            const position = ((number - minimum) / (maximum - minimum)) * 100;
            control.input.style.setProperty("--range-position", `${position}%`);
        }
        control.input.addEventListener("input", updateControl);
        updateControl();
    });

    function createCranes() {
        const previous = cranes;
        previous.slice(settings.craneCount).forEach((crane) => releaseCargo(crane, "CRANE REMOVED"));

        cranes = Array.from({ length: settings.craneCount }, (_, index) => {
            const retained = previous[index];
            return {
                index,
                phase: retained?.phase ?? (index * 2.17 + 0.6),
                pace: 46 + (index % 3) * 7,
                x: retained?.x ?? world.width * (0.28 + (index % 3) * 0.22),
                y: retained?.y ?? world.height * (0.2 + (index % 4) * 0.19),
                targetX: retained?.targetX ?? world.width * 0.5,
                targetY: retained?.targetY ?? world.height * 0.5,
                targetPiece: retained?.targetPiece ?? null,
                cargo: retained?.cargo ?? null,
                mode: retained?.mode ?? "seek",
                fault: retained?.fault ?? null,
                faultTimer: retained?.faultTimer ?? 0,
                faultDuration: retained?.faultDuration ?? 1,
                stress: retained?.stress ?? index * 0.17,
                status: retained?.status ?? "SEEKING STEEL",
                radius: 100,
                decisionTimer: retained?.decisionTimer ?? index * 0.4,
                sensorBlindTimer: retained?.sensorBlindTimer ?? 0,
                travelAxis: retained?.travelAxis ?? (index % 2 === 0 ? "y" : "x")
            };
        });
    }

    function createCars() {
        const colours = ["#dfe0da", "#a9ae94", "#c7c3b5", "#8d918b", "#b87858", "#d4d5cb", "#929b85", "#c5a888"];
        cars = Array.from({ length: 8 }, (_, index) => ({
            progress: (index / 8 + (index % 2) * 0.047) % 1,
            direction: index % 2 === 0 ? -1 : 1,
            lane: index % 2 === 0 ? -1 : 1,
            pace: 0.058 + (index % 3) * 0.0045,
            offset: (Math.random() - 0.5) * 5,
            velocityX: 0,
            x: 0,
            y: 0,
            previousY: 0,
            colour: colours[index],
            carrierType: index % 3,
            hit: 0,
            skid: 0,
            trail: []
        }));
    }

    function randomScrap(index = scrap.length, spawn = null) {
        const onRoad = Math.random() < 0.58;
        const randomY = 55 + Math.random() * Math.max(160, world.height - 110);
        const y = spawn?.y ?? randomY;
        const roadX = roadCentre(y);
        const side = Math.random() < 0.5 ? -1 : 1;
        const randomX = onRoad
            ? roadX + (Math.random() - 0.5) * world.roadWidth * 0.76
            : roadX + side * (world.roadWidth * 0.7 + Math.random() * Math.max(25, world.width * 0.12));
        const x = spawn?.x ?? randomX;

        return {
            index,
            x: clamp(x, 22, world.width - 22),
            y: clamp(y, 22, world.height - 22),
            velocityX: spawn?.velocityX ?? (Math.random() - 0.5) * 5,
            velocityY: spawn?.velocityY ?? (Math.random() - 0.5) * 5,
            rotation: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.45,
            size: 7 + Math.random() * 7,
            shape: index % 5,
            heat: 0,
            carriedBy: null,
            targetedBy: null,
            delivered: false,
            zoneTime: 0,
            dropFlash: spawn ? 1 : 0
        };
    }

    function matchScrapAmount() {
        while (scrap.length < settings.scrapAmount) {
            scrap.push(randomScrap());
        }
        while (scrap.length > settings.scrapAmount) {
            const removableIndex = scrap.findLastIndex((piece) => piece.carriedBy === null);
            if (removableIndex < 0) {
                break;
            }
            const [removed] = scrap.splice(removableIndex, 1);
            cranes.forEach((crane) => {
                if (crane.targetPiece === removed) {
                    crane.targetPiece = null;
                }
            });
        }
    }

    function clamp(number, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, number));
    }

    function roadCentre(y) {
        const ratio = y / Math.max(1, world.height);
        return world.width * 0.5
            + Math.sin(ratio * Math.PI * 1.75 + 0.38) * world.width * 0.052
            + Math.sin(ratio * Math.PI * 3.4 - 0.8) * world.width * 0.018;
    }

    function dropZones() {
        const layouts = [
            { ratio: 0.21, side: -1, label: "DROP A", type: "BEAMS" },
            { ratio: 0.39, side: 1, label: "DROP B", type: "COILS" },
            { ratio: 0.62, side: -1, label: "DROP C", type: "PLATE" },
            { ratio: 0.81, side: 1, label: "DROP D", type: "MACHINE PARTS" }
        ];

        return layouts.map((layout) => {
            const y = world.height * layout.ratio;
            return {
                x: clamp(roadCentre(y) + layout.side * (world.roadWidth * 0.5 + 58), 58, world.width - 58),
                y,
                label: layout.label,
                type: layout.type
            };
        });
    }

    function feederPosition(side) {
        const y = side < 0 ? 42 : world.height - 42;
        const roadEdge = roadCentre(y) + side * world.roadWidth * 0.5;
        return {
            x: clamp(roadEdge + side * 74, 44, world.width - 44),
            y
        };
    }

    function resizeCanvas() {
        if (currentPage !== "iron-tide") {
            return;
        }
        const bounds = surface.getBoundingClientRect();
        if (bounds.width < 10 || bounds.height < 10) {
            return;
        }
        const previousWidth = world.width;
        const previousHeight = world.height;
        world.width = Math.round(bounds.width);
        world.height = Math.round(bounds.height);
        world.dpr = Math.min(2, window.devicePixelRatio || 1);
        world.roadWidth = Math.min(350, Math.max(190, world.width * 0.35));
        canvas.width = Math.round(world.width * world.dpr);
        canvas.height = Math.round(world.height * world.dpr);
        canvas.style.width = `${world.width}px`;
        canvas.style.height = `${world.height}px`;
        context.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);

        const widthRatio = world.width / Math.max(1, previousWidth);
        const heightRatio = world.height / Math.max(1, previousHeight);
        scrap.forEach((piece) => {
            piece.x = clamp(piece.x * widthRatio, 20, world.width - 20);
            piece.y = clamp(piece.y * heightRatio, 20, world.height - 20);
        });
        cranes.forEach((crane) => {
            crane.x = clamp(crane.x * widthRatio, 28, world.width - 28);
            crane.y = clamp(crane.y * heightRatio, 28, world.height - 28);
            crane.targetX = clamp(crane.targetX * widthRatio, 28, world.width - 28);
            crane.targetY = clamp(crane.targetY * heightRatio, 28, world.height - 28);
        });
    }

    function releaseCargo(crane, reason = "LOAD RELEASED", delivered = false) {
        const piece = crane?.cargo;
        if (!piece) {
            return;
        }

        piece.carriedBy = null;
        piece.targetedBy = null;
        piece.delivered = delivered;
        piece.zoneTime = delivered ? 0.01 : 0;
        piece.dropFlash = 1;
        piece.velocityX = (Math.random() - 0.5) * 80;
        piece.velocityY = (Math.random() - 0.5) * 80;
        piece.spin += (Math.random() - 0.5) * 5;
        piece.heat = 1;
        crane.cargo = null;
        crane.status = reason;
    }

    function clearCraneTarget(crane) {
        if (crane.targetPiece && crane.targetPiece.targetedBy === crane.index) {
            crane.targetPiece.targetedBy = null;
        }
        crane.targetPiece = null;
    }

    function triggerCraneFault(crane, fault) {
        releaseCargo(crane, fault, false);
        clearCraneTarget(crane);
        crane.fault = fault;
        crane.faultDuration = fault === "GANTRY COLLISION"
            ? 7.4
            : fault === "GANTRY DROP" ? 6.2 : 4.4;
        crane.faultTimer = crane.faultDuration;
        crane.mode = "failed";
        crane.status = fault;
        crane.stress = 0;
    }

    function chooseCraneTarget(crane) {
        clearCraneTarget(crane);
        let nearest = null;
        let nearestDistance = Infinity;

        scrap.forEach((piece) => {
            if (piece.carriedBy !== null || piece.targetedBy !== null || piece.delivered) {
                return;
            }
            const dx = piece.x - crane.x;
            const dy = piece.y - crane.y;
            const distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = piece;
            }
        });

        if (nearest) {
            nearest.targetedBy = crane.index;
            crane.targetPiece = nearest;
            crane.targetX = nearest.x;
            crane.targetY = nearest.y;
            crane.status = "COLLECTING STEEL";
        } else {
            crane.targetX = world.width * (0.18 + 0.64 * (0.5 + Math.sin(world.time * 0.31 + crane.phase) * 0.5));
            crane.targetY = world.height * (0.14 + 0.72 * (0.5 + Math.cos(world.time * 0.27 + crane.phase) * 0.5));
            crane.status = "PATROLLING";
        }
    }

    function moveCrane(crane, delta) {
        let differenceX = crane.targetX - crane.x;
        let differenceY = crane.targetY - crane.y;
        const speed = crane.pace * (0.76 + settings.magnetPower * 0.42);
        const tolerance = 2.5;

        // Real bridge-crane routing is orthogonal: move the entire bridge forward/back,
        // then move the trolley left/right. Never cut diagonally across the factory.
        if (crane.travelAxis === "y") {
            if (Math.abs(differenceY) > tolerance) {
                crane.y += Math.sign(differenceY) * Math.min(Math.abs(differenceY), speed * delta);
            } else {
                crane.y = crane.targetY;
                crane.travelAxis = "x";
            }
        } else if (Math.abs(differenceX) > tolerance) {
            crane.x += Math.sign(differenceX) * Math.min(Math.abs(differenceX), speed * delta);
        } else {
            crane.x = crane.targetX;
            crane.travelAxis = "y";
        }

        differenceX = crane.targetX - crane.x;
        differenceY = crane.targetY - crane.y;
        return Math.max(0.001, Math.hypot(differenceX, differenceY));
    }

    function updateFeeders(delta) {
        feeders.forEach((feeder) => {
            const previous = feeder.progress;
            feeder.progress = (feeder.progress + feeder.pace * delta) % 1;
            if (feeder.progress >= previous || scrap.length >= settings.scrapAmount) {
                return;
            }

            const inlet = feederPosition(feeder.side);
            const inward = feeder.side < 0 ? 1 : -1;
            const batchSize = Math.min(2, settings.scrapAmount - scrap.length);
            for (let batch = 0; batch < batchSize; batch += 1) {
                scrap.push(randomScrap(scrap.length + feeder.deliveries, {
                    x: inlet.x + inward * batch * 9,
                    y: inlet.y + (batch - 0.5) * 8,
                    velocityX: inward * (18 + Math.random() * 18),
                    velocityY: feeder.side < 0 ? 20 : -20
                }));
                feeder.deliveries += 1;
            }
        });
    }

    function resolveCraneTraffic(delta) {
        for (let firstIndex = 0; firstIndex < cranes.length; firstIndex += 1) {
            const first = cranes[firstIndex];
            if (first.fault) {
                continue;
            }

            for (let secondIndex = firstIndex + 1; secondIndex < cranes.length; secondIndex += 1) {
                const second = cranes[secondIndex];
                if (second.fault) {
                    continue;
                }

                const gap = Math.abs(first.y - second.y);
                if (gap >= 48) {
                    continue;
                }

                const sensorFailure = first.sensorBlindTimer > 0 || second.sensorBlindTimer > 0;
                if (sensorFailure && gap < 17) {
                    triggerCraneFault(first, "GANTRY COLLISION");
                    triggerCraneFault(second, "GANTRY COLLISION");
                    first.y -= 9;
                    second.y += 9;
                    continue;
                }

                if (!sensorFailure) {
                    const direction = first.y <= second.y ? -1 : 1;
                    const separation = Math.min(2.4, (48 - gap) * 0.075 + delta * 5);
                    first.y = clamp(first.y + direction * separation, 28, world.height - 28);
                    second.y = clamp(second.y - direction * separation, 28, world.height - 28);
                    first.targetY = clamp(first.targetY + direction * 12, 28, world.height - 28);
                    second.targetY = clamp(second.targetY - direction * 12, 28, world.height - 28);
                    if (!first.cargo) {
                        first.status = "YIELDING TO GANTRY";
                    }
                    if (!second.cargo) {
                        second.status = "YIELDING TO GANTRY";
                    }
                }
            }
        }
    }

    function updateCranes(delta) {
        const fieldRadius = Math.min(world.width, world.height) * (0.105 + settings.magnetPower * 0.17);
        const zones = dropZones();

        cranes.forEach((crane) => {
            crane.radius = fieldRadius;
            crane.decisionTimer -= delta;

            if (crane.fault) {
                crane.faultTimer -= delta;
                if (crane.faultTimer <= 0) {
                    crane.fault = null;
                    crane.mode = "seek";
                    crane.status = "POWER RESTORED";
                    crane.stress = 0.12;
                    crane.decisionTimer = 0;
                }
                return;
            }

            if (crane.sensorBlindTimer > 0) {
                crane.sensorBlindTimer -= delta;
                crane.status = "PROXIMITY SENSOR LOST";
            } else if (Math.random() < delta * 0.0015) {
                crane.sensorBlindTimer = 2.8;
                crane.status = "PROXIMITY SENSOR LOST";
            }

            const loadRatio = crane.cargo ? crane.cargo.size / 14 : 0;
            const runningStress = 0.008 + Math.pow(settings.magnetPower, 3) * 0.055 + loadRatio * 0.05;
            const cooling = crane.cargo ? 0 : 0.026;
            crane.stress = clamp(crane.stress + (runningStress - cooling) * delta, 0, 1.2);

            if (crane.cargo && settings.magnetPower < 0.24 && Math.random() < delta * (0.2 - settings.magnetPower * 0.55)) {
                triggerCraneFault(crane, "POWER LOSS");
                return;
            }

            const liftCapacity = 5 + settings.magnetPower * 14;
            if (crane.cargo && crane.cargo.size > liftCapacity && Math.random() < delta * 0.18) {
                triggerCraneFault(crane, "CABLE SNAP");
                return;
            }

            if (crane.stress >= 1) {
                triggerCraneFault(crane, settings.magnetPower > 0.78 ? "POWER OVERLOAD" : "GANTRY DROP");
                return;
            }

            if (crane.mode === "deliver" && crane.cargo) {
                const zone = zones[crane.index % zones.length];
                crane.targetX = zone.x;
                crane.targetY = zone.y;
                crane.status = "CARRYING TO ZONE";
                const distance = moveCrane(crane, delta);
                if (distance < 22) {
                    releaseCargo(crane, "SORTED LOAD", true);
                    crane.mode = "seek";
                    crane.stress = clamp(crane.stress + 0.12, 0, 1.2);
                    crane.decisionTimer = 0.35;
                }
                return;
            }

            if (!crane.targetPiece || !scrap.includes(crane.targetPiece) || crane.targetPiece.delivered || crane.targetPiece.carriedBy !== null) {
                if (crane.decisionTimer <= 0) {
                    chooseCraneTarget(crane);
                    crane.decisionTimer = 0.5;
                }
            } else {
                crane.targetX = crane.targetPiece.x;
                crane.targetY = crane.targetPiece.y;
            }

            const distance = moveCrane(crane, delta);
            if (!crane.targetPiece || distance >= 20) {
                return;
            }

            if (settings.magnetPower <= 0.04) {
                crane.status = "NO MAGNET POWER";
                return;
            }

            if (crane.targetPiece.size > liftCapacity * 1.25) {
                crane.status = "LOAD TOO HEAVY";
                clearCraneTarget(crane);
                crane.decisionTimer = 1.2;
                return;
            }

            const overweightLift = crane.targetPiece.size > liftCapacity;
            crane.cargo = crane.targetPiece;
            crane.cargo.carriedBy = crane.index;
            crane.cargo.targetedBy = null;
            crane.targetPiece = null;
            crane.mode = "deliver";
            crane.status = overweightLift ? "CABLE OVERLOAD" : "LIFTING LOAD";
        });

        resolveCraneTraffic(delta);
    }

    function magneticForce(x, y, metalRatio) {
        let forceX = 0;
        let forceY = 0;
        let influence = 0;

        if (settings.magnetPower <= 0.001 || metalRatio <= 0.001) {
            return { x: 0, y: 0, influence: 0 };
        }

        cranes.forEach((crane) => {
            if (crane.fault) {
                return;
            }
            const differenceX = crane.x - x;
            const differenceY = crane.y - y;
            const distanceSquared = differenceX * differenceX + differenceY * differenceY;
            const distance = Math.max(8, Math.sqrt(distanceSquared));
            if (distance >= crane.radius) {
                return;
            }

            const falloff = 1 - distance / crane.radius;
            const pull = falloff * falloff * settings.magnetPower * metalRatio;
            forceX += (differenceX / distance) * pull;
            forceY += (differenceY / distance) * pull;
            influence += pull;
        });

        return { x: forceX, y: forceY, influence };
    }

    function updateScrap(delta) {
        const drag = Math.exp(-2.25 * delta);
        const zones = dropZones();

        scrap.forEach((piece) => {
            piece.dropFlash = Math.max(0, piece.dropFlash - delta * 1.7);

            if (piece.carriedBy !== null) {
                const crane = cranes.find((entry) => entry.index === piece.carriedBy);
                if (!crane || crane.cargo !== piece || crane.fault) {
                    piece.carriedBy = null;
                } else {
                    piece.x += (crane.x - piece.x) * Math.min(1, delta * 12);
                    piece.y += (crane.y - piece.y) * Math.min(1, delta * 12);
                    piece.velocityX = 0;
                    piece.velocityY = 0;
                    piece.rotation += delta * 0.5;
                    piece.zoneTime = 0;
                    return;
                }
            }

            const force = magneticForce(piece.x, piece.y, 1);
            piece.velocityX += force.x * 560 * delta;
            piece.velocityY += force.y * 560 * delta;
            piece.velocityX *= drag;
            piece.velocityY *= drag;
            piece.x += piece.velocityX * delta;
            piece.y += piece.velocityY * delta;
            piece.rotation += (piece.spin + piece.velocityX * 0.003) * delta;
            piece.heat = Math.max(0, piece.heat - delta * 2.2);

            const activeZone = zones.find((zone) => Math.hypot(piece.x - zone.x, piece.y - zone.y) < 40);
            if (piece.delivered && activeZone) {
                piece.zoneTime += delta;
                piece.velocityX *= Math.exp(-5 * delta);
                piece.velocityY *= Math.exp(-5 * delta);
            } else if (!activeZone) {
                piece.delivered = false;
                piece.zoneTime = 0;
            }

            const padding = piece.size + 8;
            if (piece.x < padding || piece.x > world.width - padding) {
                piece.x = clamp(piece.x, padding, world.width - padding);
                piece.velocityX *= -0.58;
            }
            if (piece.y < padding || piece.y > world.height - padding) {
                piece.y = clamp(piece.y, padding, world.height - padding);
                piece.velocityY *= -0.58;
            }
        });

        const processed = scrap.filter((piece) => piece.delivered && piece.zoneTime > 3.2);
        processed.forEach((piece) => {
            cranes.forEach((crane) => {
                if (crane.targetPiece === piece) {
                    clearCraneTarget(crane);
                }
            });
        });
        scrap = scrap.filter((piece) => !processed.includes(piece));
    }

    function updateCars(delta) {
        const routeLength = world.height + 110;
        const laneDistance = world.roadWidth * 0.185;
        const grip = settings.friction;
        let totalInfluence = 0;

        cars.forEach((car) => {
            const speedScale = car.hit > 0 ? 0.48 : 1;
            const previousProgress = car.progress;
            car.progress = (car.progress + car.pace * delta * speedScale) % 1;
            const wrapped = car.progress < previousProgress;
            car.previousY = car.y;
            car.y = car.direction < 0
                ? world.height + 55 - car.progress * routeLength
                : -55 + car.progress * routeLength;

            if (wrapped) {
                car.offset *= 0.35;
                car.velocityX *= 0.25;
                car.trail.length = 0;
            }

            const centre = roadCentre(car.y);
            const laneCentre = centre + car.lane * laneDistance;
            car.x = laneCentre + car.offset;
            const force = magneticForce(car.x, car.y, settings.vehicleMetal);
            totalInfluence += force.influence;

            car.velocityX += force.x * 430 * delta;
            car.velocityX += -car.offset * (2.4 + grip * 6.8) * delta;
            car.velocityX *= Math.exp(-(1.2 + grip * 5.4) * delta);
            car.offset += car.velocityX * delta;

            const safeOffset = world.roadWidth * 0.32;
            if (Math.abs(car.offset) > safeOffset) {
                car.offset = clamp(car.offset, -safeOffset, safeOffset);
                car.velocityX *= -0.34;
                car.hit = Math.max(car.hit, 0.2);
            }

            const slipThreshold = 12 + grip * 32;
            car.skid = Math.max(0, Math.abs(car.velocityX) - slipThreshold) / 55;
            if (car.skid > 0.05 || car.hit > 0.05) {
                car.trail.push({ x: car.x, y: car.y, life: 1 });
            }
            car.trail.forEach((mark) => { mark.life -= delta * 0.9; });
            car.trail = car.trail.filter((mark) => mark.life > 0);
            if (car.trail.length > 34) {
                car.trail.splice(0, car.trail.length - 34);
            }

            scrap.forEach((piece) => {
                if (piece.carriedBy !== null) {
                    return;
                }
                const differenceX = car.x - piece.x;
                const differenceY = car.y - piece.y;
                const collisionDistance = piece.size + 11;
                const distanceSquared = differenceX * differenceX + differenceY * differenceY;
                if (distanceSquared >= collisionDistance * collisionDistance) {
                    return;
                }
                const distance = Math.max(1, Math.sqrt(distanceSquared));
                const normalX = differenceX / distance;
                const normalY = differenceY / distance;
                car.velocityX += normalX * 46;
                car.offset += normalX * 3;
                car.hit = 0.52;
                piece.velocityX -= normalX * 94;
                piece.velocityY -= normalY * 94;
                piece.spin += (Math.random() - 0.5) * 4;
                piece.heat = 1;
            });

            car.hit = Math.max(0, car.hit - delta);
        });

        world.fieldLoad += ((totalInfluence / Math.max(1, cars.length) * 1.9) - world.fieldLoad) * Math.min(1, delta * 2.3);
    }

    function roundedRectangle(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function drawFactoryFloor(ctx) {
        ctx.fillStyle = "#0c0e0e";
        ctx.fillRect(0, 0, world.width, world.height);

        ctx.save();

        // Large concrete slabs keep the floor readable while making the route feel interior.
        const slab = 72;
        for (let y = 0; y < world.height; y += slab) {
            for (let x = 0; x < world.width; x += slab) {
                const alternate = ((x / slab) + (y / slab)) % 2 === 0;
                ctx.fillStyle = alternate ? "rgba(235,236,230,0.012)" : "rgba(0,0,0,0.035)";
                ctx.fillRect(x + 1, y + 1, slab - 2, slab - 2);
            }
        }

        ctx.strokeStyle = "rgba(231,232,226,0.035)";
        ctx.lineWidth = 1;
        for (let x = 0; x <= world.width; x += slab) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, world.height);
            ctx.stroke();
        }
        for (let y = 0; y <= world.height; y += slab) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(world.width, y);
            ctx.stroke();
        }

        const sideSpace = Math.max(74, (world.width - world.roadWidth) * 0.5 - 30);
        const machineWidth = Math.min(150, sideSpace * 0.74);
        const machineHeight = Math.max(42, Math.min(66, world.height * 0.09));
        const bayGap = Math.max(24, (world.height - machineHeight * 5) / 6);

        for (let side = 0; side < 2; side += 1) {
            const leftSide = side === 0;
            const x = leftSide ? 18 : world.width - machineWidth - 18;

            // Production-line pipe run.
            const pipeX = leftSide ? x + machineWidth + 10 : x - 10;
            ctx.strokeStyle = "rgba(168,117,84,0.22)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pipeX, 14);
            ctx.lineTo(pipeX, world.height - 14);
            ctx.stroke();

            for (let index = 0; index < 5; index += 1) {
                const y = bayGap + index * (machineHeight + bayGap);

                ctx.fillStyle = "rgba(0,0,0,0.3)";
                roundedRectangle(ctx, x + 5, y + 7, machineWidth, machineHeight, 8);
                ctx.fill();

                roundedRectangle(ctx, x, y, machineWidth, machineHeight, 8);
                ctx.fillStyle = index % 3 === 0 ? "#171615" : "#151717";
                ctx.fill();
                ctx.strokeStyle = "rgba(230,231,225,0.09)";
                ctx.lineWidth = 1;
                ctx.stroke();

                const panelWidth = Math.max(16, machineWidth * 0.22);
                ctx.fillStyle = "#202222";
                roundedRectangle(ctx, x + 9, y + 9, panelWidth, machineHeight - 18, 4);
                ctx.fill();
                ctx.fillStyle = index % 2 === 0 ? "rgba(182,189,50,0.42)" : "rgba(182,106,69,0.5)";
                ctx.fillRect(x + 14, y + 14, 3, 3);

                ctx.strokeStyle = "rgba(230,231,225,0.1)";
                ctx.beginPath();
                ctx.arc(x + machineWidth * 0.64, y + machineHeight * 0.5, machineHeight * 0.22, 0, Math.PI * 2);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x + machineWidth * 0.64, y + machineHeight * 0.5, machineHeight * 0.08, 0, Math.PI * 2);
                ctx.stroke();

                // Pipe branch from each machine into the factory run.
                ctx.strokeStyle = "rgba(168,117,84,0.18)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(leftSide ? x + machineWidth : x, y + machineHeight * 0.5);
                ctx.lineTo(pipeX, y + machineHeight * 0.5);
                ctx.stroke();
            }
        }

        // A live roller conveyor reads as factory equipment rather than scenery.
        const conveyorWidth = Math.max(28, Math.min(44, sideSpace * 0.24));
        const conveyorX = 30 + machineWidth;
        ctx.fillStyle = "rgba(24,26,25,0.92)";
        ctx.fillRect(conveyorX, 18, conveyorWidth, world.height - 36);
        ctx.strokeStyle = "rgba(230,231,225,0.08)";
        ctx.strokeRect(conveyorX, 18, conveyorWidth, world.height - 36);
        const rollerOffset = (world.time * 28) % 20;
        for (let y = 24 - rollerOffset; y < world.height - 18; y += 20) {
            ctx.strokeStyle = "rgba(230,231,225,0.11)";
            ctx.beginPath();
            ctx.moveTo(conveyorX + 5, y);
            ctx.lineTo(conveyorX + conveyorWidth - 5, y);
            ctx.stroke();
        }

        ctx.restore();
    }

    function traceRoad(ctx, lateralOffset = 0) {
        ctx.beginPath();
        const increment = 18;
        for (let y = -20; y <= world.height + 20; y += increment) {
            const x = roadCentre(y) + lateralOffset;
            if (y === -20) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
    }

    function drawRoad(ctx) {
        const halfWidth = world.roadWidth * 0.5;
        ctx.beginPath();
        for (let y = -22; y <= world.height + 22; y += 16) {
            const x = roadCentre(y) - halfWidth;
            if (y === -22) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        for (let y = world.height + 22; y >= -22; y -= 16) {
            ctx.lineTo(roadCentre(y) + halfWidth, y);
        }
        ctx.closePath();
        ctx.fillStyle = "#151716";
        ctx.fill();

        // This is an unmarked working aisle, not a road. Wear patterns imply traffic while machinery defines its edges.
        ctx.save();
        ctx.strokeStyle = "rgba(224,225,218,0.025)";
        ctx.lineWidth = 13;
        traceRoad(ctx, -world.roadWidth * 0.18);
        ctx.stroke();
        traceRoad(ctx, world.roadWidth * 0.18);
        ctx.stroke();

        const equipmentCount = world.width < 700 ? 4 : 6;
        for (let index = 0; index < equipmentCount; index += 1) {
            const y = 58 + index * ((world.height - 116) / Math.max(1, equipmentCount - 1));
            const side = index % 2 === 0 ? -1 : 1;
            const width = 26 + (index % 3) * 8;
            const height = 38 + (index % 2) * 14;
            const x = roadCentre(y) + side * (halfWidth + width * 0.38);

            ctx.fillStyle = "rgba(0,0,0,0.3)";
            roundedRectangle(ctx, x - width * 0.5 + 4, y - height * 0.5 + 5, width, height, 4);
            ctx.fill();
            ctx.fillStyle = index % 3 === 0 ? "#23201d" : "#202221";
            ctx.strokeStyle = "rgba(230,231,225,0.11)";
            roundedRectangle(ctx, x - width * 0.5, y - height * 0.5, width, height, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = index % 2 === 0 ? "rgba(182,106,69,0.45)" : "rgba(182,189,50,0.32)";
            ctx.fillRect(x - width * 0.5 + 5, y - height * 0.5 + 5, 4, 4);
        }
        ctx.restore();
    }

    function drawOperationalZones(ctx) {
        const zones = dropZones();
        ctx.save();

        zones.forEach((zone, index) => {
            ctx.fillStyle = "rgba(182,106,69,0.075)";
            ctx.strokeStyle = "rgba(182,106,69,0.46)";
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            roundedRectangle(ctx, zone.x - 43, zone.y - 34, 86, 68, 8);
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);

            for (let stripe = -30; stripe <= 26; stripe += 14) {
                ctx.strokeStyle = "rgba(182,189,50,0.12)";
                ctx.beginPath();
                ctx.moveTo(zone.x + stripe - 8, zone.y + 29);
                ctx.lineTo(zone.x + stripe + 4, zone.y + 17);
                ctx.stroke();
            }

            ctx.fillStyle = "rgba(240,240,235,0.58)";
            ctx.font = "500 8px 'General Sans', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(zone.label, zone.x, zone.y - 42);
            ctx.fillStyle = "rgba(240,240,235,0.25)";
            ctx.font = "400 6px 'General Sans', sans-serif";
            ctx.fillText(zone.type, zone.x, zone.y - 32);
        });

        feeders.forEach((feeder, index) => {
            const inlet = feederPosition(feeder.side);
            const travelY = feeder.side < 0
                ? -24 + feeder.progress * 92
                : world.height + 24 - feeder.progress * 92;

            ctx.strokeStyle = "rgba(230,231,225,0.12)";
            ctx.lineWidth = 16;
            ctx.beginPath();
            ctx.moveTo(inlet.x, feeder.side < 0 ? -10 : world.height + 10);
            ctx.lineTo(inlet.x, feeder.side < 0 ? 82 : world.height - 82);
            ctx.stroke();
            ctx.strokeStyle = "rgba(0,0,0,0.4)";
            ctx.lineWidth = 10;
            ctx.stroke();

            ctx.fillStyle = "#76503e";
            roundedRectangle(ctx, inlet.x - 13, travelY - 8, 26, 16, 3);
            ctx.fill();
            ctx.strokeStyle = "rgba(230,231,225,0.28)";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = "rgba(240,240,235,0.55)";
            ctx.font = "500 7px 'General Sans', sans-serif";
            ctx.textAlign = feeder.side < 0 ? "left" : "right";
            ctx.fillText(`INBOUND ${index + 1}`, inlet.x + (feeder.side < 0 ? 17 : -17), feeder.side < 0 ? 18 : world.height - 14);
        });

        const signY = world.height * 0.5;
        const signX = roadCentre(signY) + world.roadWidth * 0.5 - 14;
        ctx.translate(signX, signY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = "rgba(240,240,235,0.2)";
        ctx.font = "500 7px 'General Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("MAGNETIC TRANSFER ROUTE  •  KEEP CLEAR", 0, 0);
        ctx.restore();
    }

    function drawMagneticFields(ctx) {
        cranes.forEach((crane) => {
            if (settings.magnetPower <= 0.01 || crane.fault) {
                return;
            }
            const gradient = ctx.createRadialGradient(crane.x, crane.y, 3, crane.x, crane.y, crane.radius);
            gradient.addColorStop(0, `rgba(182,189,50,${0.095 * settings.magnetPower})`);
            gradient.addColorStop(0.5, `rgba(182,189,50,${0.035 * settings.magnetPower})`);
            gradient.addColorStop(1, "rgba(182,189,50,0)");
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(crane.x, crane.y, crane.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.setLineDash([3, 8]);
            ctx.strokeStyle = `rgba(182,189,50,${0.16 + settings.magnetPower * 0.24})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(crane.x, crane.y, crane.radius * 0.72, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        });

        ctx.save();
        ctx.strokeStyle = `rgba(182,189,50,${0.055 + settings.magnetPower * 0.06})`;
        ctx.lineWidth = 0.75;
        let links = 0;
        for (const crane of cranes) {
            if (crane.fault) {
                continue;
            }
            for (const piece of scrap) {
                if (links >= 28) {
                    break;
                }
                const dx = piece.x - crane.x;
                const dy = piece.y - crane.y;
                if (dx * dx + dy * dy < crane.radius * crane.radius * 0.75) {
                    ctx.beginPath();
                    ctx.moveTo(crane.x, crane.y);
                    ctx.lineTo(piece.x, piece.y);
                    ctx.stroke();
                    links += 1;
                }
            }
        }
        ctx.restore();
    }

    function drawRails(ctx) {
        ctx.save();

        // Fixed north-south runways: each entire bridge now visibly travels up and down.
        ctx.strokeStyle = "rgba(229,230,224,0.13)";
        ctx.lineWidth = 2;
        for (const x of [12, 24, world.width - 24, world.width - 12]) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, world.height);
            ctx.stroke();
        }
        ctx.strokeStyle = "rgba(229,230,224,0.07)";
        ctx.lineWidth = 1;
        for (let y = 12; y < world.height; y += 30) {
            ctx.beginPath();
            ctx.moveTo(12, y);
            ctx.lineTo(24, y);
            ctx.moveTo(world.width - 24, y);
            ctx.lineTo(world.width - 12, y);
            ctx.stroke();
        }
        ctx.restore();

        cranes.forEach((crane) => {
            ctx.save();
            const faultColour = crane.fault ? "rgba(226,78,73,0.45)" : "rgba(229,230,224,0.16)";

            // The horizontal bridge travels north-south; the magnet trolley travels east-west on it.
            ctx.strokeStyle = faultColour;
            ctx.lineWidth = 2;
            for (const offset of [-10, 10]) {
                ctx.beginPath();
                ctx.moveTo(18, crane.y + offset);
                ctx.lineTo(world.width - 18, crane.y + offset);
                ctx.stroke();
            }

            ctx.strokeStyle = crane.fault ? "rgba(226,78,73,0.16)" : "rgba(229,230,224,0.08)";
            ctx.lineWidth = 1;
            for (let x = 28; x < world.width - 20; x += 34) {
                ctx.beginPath();
                ctx.moveTo(x, crane.y - 10);
                ctx.lineTo(x, crane.y + 10);
                ctx.stroke();
            }

            ctx.fillStyle = crane.fault ? "#382120" : "#292a28";
            ctx.strokeStyle = faultColour;
            roundedRectangle(ctx, 4, crane.y - 25, 18, 50, 4);
            ctx.fill();
            ctx.stroke();
            roundedRectangle(ctx, world.width - 22, crane.y - 25, 18, 50, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = crane.fault ? "rgba(226,78,73,0.72)" : "rgba(182,106,69,0.5)";
            for (const x of [8, world.width - 18]) {
                ctx.fillRect(x, crane.y - 18, 10, 3);
                ctx.fillRect(x, crane.y + 15, 10, 3);
            }
            ctx.restore();
        });
    }

    function drawTrails(ctx) {
        cars.forEach((car) => {
            if (car.trail.length < 2) {
                return;
            }
            ctx.save();
            ctx.lineWidth = 1.2;
            for (let index = 1; index < car.trail.length; index += 1) {
                const previous = car.trail[index - 1];
                const current = car.trail[index];
                if (Math.abs(current.y - previous.y) > world.height * 0.3) {
                    continue;
                }
                ctx.strokeStyle = `rgba(210,211,204,${current.life * 0.15})`;
                ctx.beginPath();
                ctx.moveTo(previous.x, previous.y);
                ctx.lineTo(current.x, current.y);
                ctx.stroke();
            }
            ctx.restore();
        });
    }

    function drawScrap(ctx) {
        scrap.forEach((piece) => {
            ctx.save();
            ctx.translate(piece.x, piece.y);
            if (piece.dropFlash > 0) {
                ctx.strokeStyle = `rgba(226,78,73,${piece.dropFlash * 0.7})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, piece.size + (1 - piece.dropFlash) * 28, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (piece.carriedBy !== null) {
                ctx.fillStyle = "rgba(0,0,0,0.38)";
                ctx.beginPath();
                ctx.ellipse(6, 9, piece.size * 1.15, piece.size * 0.7, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.rotate(piece.rotation);
            ctx.fillStyle = piece.heat > 0 ? "#d17a50" : "#8a543e";
            ctx.strokeStyle = piece.heat > 0 ? "#edb08e" : "#bc7959";
            ctx.lineWidth = 1;

            if (piece.shape === 0) {
                // I-beam offcut.
                ctx.fillRect(-piece.size * 1.35, -piece.size * 0.3, piece.size * 2.7, piece.size * 0.6);
                ctx.fillRect(-piece.size * 1.35, -piece.size * 0.62, piece.size * 0.25, piece.size * 1.24);
                ctx.fillRect(piece.size * 1.1, -piece.size * 0.62, piece.size * 0.25, piece.size * 1.24);
                ctx.strokeRect(-piece.size * 1.35, -piece.size * 0.62, piece.size * 2.7, piece.size * 1.24);
            } else if (piece.shape === 1) {
                // Torn sheet steel.
                ctx.beginPath();
                ctx.moveTo(-piece.size, -piece.size * 0.7);
                ctx.lineTo(piece.size * 0.7, -piece.size);
                ctx.lineTo(piece.size, piece.size * 0.65);
                ctx.lineTo(-piece.size * 0.65, piece.size);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(-piece.size * 0.45, -piece.size * 0.2);
                ctx.lineTo(piece.size * 0.5, piece.size * 0.25);
                ctx.stroke();
            } else if (piece.shape === 2) {
                // Factory oil drum.
                ctx.beginPath();
                ctx.ellipse(0, 0, piece.size * 0.7, piece.size, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(-piece.size * 0.55, -piece.size * 0.25);
                ctx.lineTo(piece.size * 0.55, -piece.size * 0.25);
                ctx.moveTo(-piece.size * 0.55, piece.size * 0.25);
                ctx.lineTo(piece.size * 0.55, piece.size * 0.25);
                ctx.stroke();
            } else if (piece.shape === 3) {
                // Bundled steel pipes.
                for (const offset of [-0.55, 0, 0.55]) {
                    ctx.beginPath();
                    ctx.arc(offset * piece.size, 0, piece.size * 0.38, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            } else {
                // Broken machine housing with a visible flywheel.
                roundedRectangle(ctx, -piece.size, -piece.size * 0.72, piece.size * 2, piece.size * 1.44, piece.size * 0.2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = "#2a211e";
                ctx.beginPath();
                ctx.arc(piece.size * 0.2, 0, piece.size * 0.42, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        });
    }

    function drawCars(ctx) {
        cars.forEach((car) => {
            const curveSample = 4;
            const tangent = roadCentre(car.y + curveSample) - roadCentre(car.y - curveSample);
            const roadAngle = Math.atan2(tangent, curveSample * 2);
            const heading = car.direction > 0 ? -roadAngle : Math.PI - roadAngle;
            const slide = clamp(car.velocityX / 150, -0.2, 0.2);

            ctx.save();
            ctx.translate(car.x, car.y);
            ctx.rotate(heading + slide);

            if (car.hit > 0) {
                ctx.fillStyle = `rgba(226,78,73,${car.hit * 0.26})`;
                ctx.beginPath();
                ctx.arc(0, 0, 25 + car.hit * 14, 0, Math.PI * 2);
                ctx.fill();
            }

            // Low autonomous factory carrier / AGV, not a road car.
            ctx.fillStyle = "#080909";
            ctx.fillRect(-12, -14, 4, 8);
            ctx.fillRect(8, -14, 4, 8);
            ctx.fillRect(-12, 7, 4, 8);
            ctx.fillRect(8, 7, 4, 8);

            roundedRectangle(ctx, -11, -18, 22, 36, 4);
            ctx.fillStyle = car.colour;
            ctx.fill();
            ctx.strokeStyle = "rgba(235,236,229,0.28)";
            ctx.lineWidth = 1;
            ctx.stroke();

            if (car.carrierType === 0) {
                // Stacked sheet-metal load.
                ctx.fillStyle = "#454846";
                for (let layer = 0; layer < 3; layer += 1) {
                    ctx.fillRect(-8 + layer, -7 + layer * 2, 16, 4);
                }
            } else if (car.carrierType === 1) {
                // Steel-coil carrier.
                ctx.strokeStyle = "#686b66";
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(0, 1, 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = "#171918";
                ctx.beginPath();
                ctx.arc(0, 1, 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Empty transfer deck with visible magnetic content indicator.
                roundedRectangle(ctx, -8, -7, 16, 15, 2);
                ctx.fillStyle = "#303331";
                ctx.fill();
                ctx.fillStyle = `rgba(182,189,50,${0.18 + settings.vehicleMetal * 0.62})`;
                ctx.fillRect(-6, 3, 12, 3);
            }

            ctx.fillStyle = "rgba(182,189,50,0.72)";
            ctx.fillRect(-7, -15, 3, 2);
            ctx.fillRect(4, -15, 3, 2);
            ctx.restore();
        });
    }

    function drawCranes(ctx) {
        cranes.forEach((crane) => {
            const sway = Math.sin(world.time * 1.25 + crane.phase) * 3;
            const failed = Boolean(crane.fault);
            const failureRatio = failed ? 1 - crane.faultTimer / crane.faultDuration : 0;
            const droppedOffset = failed ? Math.min(18, failureRatio * 32) : 0;
            const failureTilt = failed ? Math.sin(world.time * 13 + crane.phase) * 0.035 + 0.08 : 0;

            ctx.save();
            ctx.translate(crane.x, crane.y + (crane.fault === "GANTRY DROP" ? droppedOffset : 0));
            ctx.rotate(failureTilt);

            if (failed) {
                ctx.fillStyle = `rgba(226,78,73,${0.08 + Math.sin(world.time * 8) * 0.035})`;
                ctx.beginPath();
                ctx.arc(0, 0, 40, 0, Math.PI * 2);
                ctx.fill();
            }

            // Trolley shadow, steel carriage and wheel pairs.
            ctx.fillStyle = "rgba(0,0,0,0.44)";
            roundedRectangle(ctx, -29, -14, 64, 34, 7);
            ctx.fill();

            ctx.fillStyle = failed ? "#372322" : "#292b29";
            ctx.strokeStyle = failed ? "rgba(226,78,73,0.72)" : "rgba(235,236,229,0.38)";
            ctx.lineWidth = 1;
            roundedRectangle(ctx, -32, -17, 64, 34, 7);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#090a0a";
            for (const x of [-24, 19]) {
                ctx.fillRect(x, -21, 8, 5);
                ctx.fillRect(x, 16, 8, 5);
            }

            ctx.fillStyle = failed ? "rgba(226,78,73,0.82)" : "rgba(182,106,69,0.72)";
            ctx.fillRect(-27, -12, 5, 24);
            ctx.fillStyle = failed ? "rgba(226,78,73,0.42)" : "rgba(182,189,50,0.55)";
            ctx.fillRect(22, -12, 5, 24);

            const magnetDrop = failed ? 9 + droppedOffset : 2;
            ctx.strokeStyle = failed ? "rgba(226,78,73,0.48)" : "rgba(229,230,224,0.24)";
            ctx.beginPath();
            ctx.moveTo(0, -8);
            if (crane.fault === "CABLE SNAP") {
                ctx.lineTo(sway * 0.4 - 4, 0);
                ctx.moveTo(sway + 4, magnetDrop - 7);
            }
            ctx.lineTo(sway, magnetDrop);
            ctx.stroke();

            ctx.translate(sway, magnetDrop);
            ctx.fillStyle = "#0c0d0c";
            ctx.beginPath();
            ctx.arc(0, 0, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = failed
                ? "#e24e49"
                : settings.magnetPower > 0.02 ? "#b6bd32" : "#656761";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0.15 * Math.PI, 1.85 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = failed ? "rgba(226,78,73,0.35)" : "rgba(182,189,50,0.3)";
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fill();

            ctx.rotate(-failureTilt);
            ctx.fillStyle = failed ? "#ef7b75" : "rgba(240,240,235,0.58)";
            ctx.font = "500 7px 'General Sans', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(failed ? crane.fault : `GANTRY ${crane.index + 1}`, 0, -29 - magnetDrop);
            if (!failed && crane.cargo) {
                ctx.fillStyle = "rgba(182,189,50,0.72)";
                ctx.font = "500 6px 'General Sans', sans-serif";
                ctx.fillText("LOAD IN TRANSIT", 0, 25 - magnetDrop);
            }
            ctx.restore();
        });
    }

    function drawScene() {
        context.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
        context.clearRect(0, 0, world.width, world.height);
        drawFactoryFloor(context);
        drawRoad(context);
        drawOperationalZones(context);
        drawMagneticFields(context);
        drawRails(context);
        drawTrails(context);
        drawScrap(context);
        drawCars(context);
        drawCranes(context);
    }

    const deadCanvas = document.getElementById("dead-canvas");
    const deadContext = deadCanvas.getContext("2d", { alpha: false });
    const deadSurface = deadCanvas.parentElement;
    const deadReadouts = {
        mass: document.getElementById("dead-mass-readout"),
        bridgeA: document.getElementById("dead-a-readout"),
        bridgeB: document.getElementById("dead-b-readout")
    };
    const deadSettings = {
        mass: 2300,
        counterA: 0.66,
        counterB: 0.42
    };
    const deadWorld = {
        width: 1000,
        height: 650,
        dpr: 1,
        time: 0
    };
    const deadVehicle = {
        bridge: 0,
        progress: 0,
        direction: 1,
        mode: "choose",
        wait: 0.8,
        tilt: 0,
        slip: 0,
        lane: 0,
        laneDepth: 0,
        laneChangeTimer: 0,
        crossings: 0
    };
    const deadBridges = [
        { angle: 0, velocity: 0 },
        { angle: 0, velocity: 0 }
    ];
    const deadBarriers = [
        [
            { position: 0.22, velocity: 0, cooldown: 0, lane: 0 },
            { position: 0.58, velocity: 0, cooldown: 0, lane: 1 },
            { position: 0.86, velocity: 0, cooldown: 0, lane: 0 }
        ],
        [
            { position: 0.16, velocity: 0, cooldown: 0, lane: 1 },
            { position: 0.48, velocity: 0, cooldown: 0, lane: 0 },
            { position: 0.78, velocity: 0, cooldown: 0, lane: 1 }
        ]
    ];

    const deadControls = [
        {
            input: document.getElementById("dead-mass"),
            output: document.getElementById("dead-mass-output"),
            apply: (number) => { deadSettings.mass = number; },
            format: (number) => `${(number / 1000).toFixed(1)} t`
        },
        {
            input: document.getElementById("dead-counter-a"),
            output: document.getElementById("dead-counter-a-output"),
            apply: (number) => { deadSettings.counterA = number / 100; },
            format: (number) => `${number}%`
        },
        {
            input: document.getElementById("dead-counter-b"),
            output: document.getElementById("dead-counter-b-output"),
            apply: (number) => { deadSettings.counterB = number / 100; },
            format: (number) => `${number}%`
        }
    ];

    deadControls.forEach((control) => {
        function updateDeadControl() {
            const number = Number(control.input.value);
            control.output.value = control.format(number);
            control.output.textContent = control.format(number);
            control.apply(number);
            const minimum = Number(control.input.min);
            const maximum = Number(control.input.max);
            const position = ((number - minimum) / (maximum - minimum)) * 100;
            control.input.style.setProperty("--range-position", `${position}%`);
        }
        control.input.addEventListener("input", updateDeadControl);
        updateDeadControl();
    });

    function bridgeCapacity(index) {
        return index === 0
            ? 1400 + deadSettings.counterA * 2600
            : 900 + deadSettings.counterB * 3000;
    }

    function bridgeLevel(index) {
        const ratio = deadSettings.mass / bridgeCapacity(index);
        if (ratio <= 0.82) {
            return 3;
        }
        if (ratio <= 1.12) {
            return 2;
        }
        return 1;
    }

    function bridgeLevelAngle(level) {
        return (2 - level) * 10;
    }

    function deadTravelPosition() {
        return deadVehicle.direction > 0
            ? deadVehicle.progress
            : 1.2 - deadVehicle.progress;
    }

    function bridgeCondition(index) {
        const ratio = deadSettings.mass / bridgeCapacity(index);
        if (ratio <= 0.95) {
            return "Stable";
        }
        if (ratio <= 1.16) {
            return "Caution";
        }
        return "Overload";
    }

    function updateBridgeAngles(delta) {
        deadBridges.forEach((bridge, index) => {
            const level = bridgeLevel(index);
            let targetAngle = bridgeLevelAngle(level);
            const active = deadVehicle.bridge === index && deadVehicle.mode !== "choose";
            if (active) {
                const progress = clamp(deadTravelPosition(), 0, 1);
                const ratio = deadSettings.mass / bridgeCapacity(index);
                const side = progress < 0.5 ? -1 : 1;
                targetAngle += Math.sin(progress * Math.PI) * side * Math.min(2.8, ratio * 2.2);
            }

            bridge.velocity += (targetAngle - bridge.angle) * delta * 13;
            bridge.velocity *= Math.exp(-delta * 5.2);
            bridge.angle += bridge.velocity * delta;
        });

        deadVehicle.tilt = Math.abs(deadBridges[deadVehicle.bridge].angle);
    }

    function updateDeadBarriers(delta) {
        deadVehicle.laneChangeTimer = Math.max(0, deadVehicle.laneChangeTimer - delta);
        deadVehicle.laneDepth += (deadVehicle.lane - deadVehicle.laneDepth) * Math.min(1, delta * 5.5);

        deadBarriers.forEach((barriers, bridgeIndex) => {
            const angle = deadBridges[bridgeIndex].angle * Math.PI / 180;
            barriers.forEach((barrier) => {
                if (barrier.cooldown > 0) {
                    barrier.cooldown -= delta;
                    return;
                }

                barrier.velocity += Math.sin(angle) * 0.42 * delta;
                barrier.velocity *= Math.exp(-delta * 0.32);
                barrier.position += barrier.velocity * delta;

                if (barrier.position < -0.1 || barrier.position > 1.1) {
                    barrier.position = angle >= 0 ? 0.08 : 0.92;
                    barrier.velocity = 0;
                    barrier.cooldown = 1.1 + Math.random() * 1.2;
                }
            });
        });

        if (deadVehicle.mode !== "cross") {
            return;
        }

        const travelPosition = clamp(deadTravelPosition(), 0, 1);
        deadBarriers[deadVehicle.bridge].forEach((barrier) => {
            const closing = barrier.cooldown <= 0
                && barrier.lane === deadVehicle.lane
                && Math.abs(barrier.position - travelPosition) < 0.12;
            if (closing && deadVehicle.laneChangeTimer <= 0.05) {
                deadVehicle.lane = deadVehicle.lane === 0 ? 1 : 0;
                deadVehicle.laneChangeTimer = 0.82;
            }
        });
    }

    function resizeDeadCanvas() {
        if (currentPage !== "dead-weight") {
            return;
        }
        const bounds = deadSurface.getBoundingClientRect();
        if (bounds.width < 10 || bounds.height < 10) {
            return;
        }
        deadWorld.width = Math.round(bounds.width);
        deadWorld.height = Math.round(bounds.height);
        deadWorld.dpr = Math.min(2, window.devicePixelRatio || 1);
        deadCanvas.width = Math.round(deadWorld.width * deadWorld.dpr);
        deadCanvas.height = Math.round(deadWorld.height * deadWorld.dpr);
        deadCanvas.style.width = `${deadWorld.width}px`;
        deadCanvas.style.height = `${deadWorld.height}px`;
        deadContext.setTransform(deadWorld.dpr, 0, 0, deadWorld.dpr, 0, 0);
    }

    function chooseBridge() {
        if (deadVehicle.direction > 0) {
            const ratioA = deadSettings.mass / bridgeCapacity(0);
            const ratioB = deadSettings.mass / bridgeCapacity(1);
            deadVehicle.bridge = ratioA <= ratioB ? 0 : 1;
        }
        deadVehicle.progress = 0;
        deadVehicle.tilt = 0;
        deadVehicle.slip = 0;
        deadVehicle.laneChangeTimer = 0;
        deadVehicle.mode = "cross";
    }

    function updateDeadWeight(delta) {
        deadWorld.time += delta;
        updateBridgeAngles(delta);
        updateDeadBarriers(delta);

        if (deadVehicle.mode === "choose") {
            deadVehicle.wait -= delta;
            if (deadVehicle.wait <= 0) {
                chooseBridge();
            }
            return;
        }

        if (deadVehicle.mode === "cross") {
            const capacity = bridgeCapacity(deadVehicle.bridge);
            const bridgeProgress = clamp(deadTravelPosition(), 0, 1);
            const pivotDistance = Math.abs(bridgeProgress - 0.5) * 2;
            const loadCurve = 0.18 + pivotDistance * 0.82;
            const loadRatio = deadSettings.mass * loadCurve / capacity;
            deadVehicle.progress += delta * Math.max(0.025, 0.105 - deadVehicle.tilt * 0.0032);

            if (loadRatio > 1.2 && deadVehicle.progress > 0.1 && deadVehicle.progress < 0.9) {
                deadVehicle.mode = "slip";
                deadVehicle.slip = 0;
                return;
            }

            if (deadVehicle.progress >= 1.2) {
                deadVehicle.crossings += 1;
                deadVehicle.direction *= -1;
                deadVehicle.mode = "choose";
                deadVehicle.wait = 1.4;
                deadVehicle.progress = 0;
            }
            return;
        }

        if (deadVehicle.mode === "slip") {
            deadVehicle.slip += delta;
            deadBridges[deadVehicle.bridge].velocity += (deadVehicle.bridge === 0 ? -1 : 1) * delta * 8;
            deadVehicle.progress = Math.max(0, deadVehicle.progress - delta * (0.14 + deadVehicle.slip * 0.035));
            if (deadVehicle.progress <= 0) {
                deadVehicle.mode = "choose";
                deadVehicle.wait = 1.3;
                deadVehicle.tilt = 0;
            }
        }
    }

    function drawSideBridge(ctx, index, panel) {
        const condition = bridgeCondition(index);
        const level = bridgeLevel(index);
        const active = deadVehicle.bridge === index && deadVehicle.mode !== "choose";
        const signedTilt = deadBridges[index].angle;
        const angle = signedTilt * Math.PI / 180;
        const pivotX = panel.x + panel.width * 0.5;
        const pivotY = panel.y + panel.height * 0.52;
        const span = panel.width * 0.76;
        const deckThickness = Math.max(9, panel.height * 0.025);
        const groundY = panel.y + panel.height * 0.83;
        const counterPosition = index === 0 ? deadSettings.counterA : deadSettings.counterB;
        const counterDirection = index === 0 ? -1 : 1;

        ctx.save();
        roundedRectangle(ctx, panel.x, panel.y, panel.width, panel.height, 16);
        ctx.fillStyle = active ? "#111311" : "#101111";
        ctx.fill();
        ctx.strokeStyle = active ? "rgba(182,189,50,0.34)" : "rgba(235,236,229,0.07)";
        ctx.lineWidth = active ? 1.5 : 1;
        ctx.stroke();

        // Side elevation background: abutments, void and a fixed horizontal datum.
        ctx.fillStyle = "#080909";
        roundedRectangle(ctx, panel.x + 14, pivotY + 8, panel.width - 28, groundY - pivotY + 8, 10);
        ctx.fill();
        ctx.strokeStyle = "rgba(235,236,229,0.07)";
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.moveTo(pivotX - span * 0.5, pivotY);
        ctx.lineTo(pivotX + span * 0.5, pivotY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Three fixed onward paths. The counterweight selects which landing the moving deck reaches.
        for (const routeLevel of [3, 2, 1]) {
            const routeAngle = bridgeLevelAngle(routeLevel) * Math.PI / 180;
            const routeX = pivotX + Math.cos(routeAngle) * span * 0.5;
            const routeY = pivotY + Math.sin(routeAngle) * span * 0.5;
            const selected = routeLevel === level;
            ctx.strokeStyle = selected ? "rgba(182,189,50,0.72)" : "rgba(235,236,229,0.12)";
            ctx.lineWidth = selected ? 7 : 5;
            ctx.beginPath();
            ctx.moveTo(routeX, routeY);
            ctx.lineTo(panel.x + panel.width - 10, routeY);
            ctx.stroke();
            ctx.fillStyle = selected ? "#c3ca56" : "rgba(240,240,235,0.32)";
            ctx.font = "500 7px 'General Sans', sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(`L${routeLevel}`, panel.x + panel.width - 13, routeY - 7);
        }

        const leftAbutment = pivotX - span * 0.5;
        const rightAbutment = pivotX + span * 0.5;
        ctx.fillStyle = "#222422";
        ctx.strokeStyle = "rgba(235,236,229,0.1)";
        for (const x of [leftAbutment, rightAbutment]) {
            ctx.beginPath();
            ctx.moveTo(x - 21, groundY);
            ctx.lineTo(x - 14, pivotY + 9);
            ctx.lineTo(x + 14, pivotY + 9);
            ctx.lineTo(x + 21, groundY);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        // Counterweight arm and sliding ballast are visible beneath each deck.
        const maximumArm = panel.width * 0.28;
        const armLength = 28 + counterPosition * maximumArm;
        const counterX = pivotX + counterDirection * armLength;
        const counterY = pivotY + panel.height * 0.17;
        ctx.strokeStyle = "rgba(235,236,229,0.28)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY + 5);
        ctx.lineTo(counterX, counterY);
        ctx.stroke();
        ctx.strokeStyle = "rgba(235,236,229,0.11)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pivotX + counterDirection * 22, counterY);
        ctx.lineTo(pivotX + counterDirection * (maximumArm + 34), counterY);
        ctx.stroke();
        ctx.fillStyle = "#80513d";
        roundedRectangle(ctx, counterX - 18, counterY - 14, 36, 28, 5);
        ctx.fill();
        ctx.strokeStyle = "rgba(235,236,229,0.28)";
        ctx.stroke();

        // The deck and vehicle rotate together around the central pivot.
        ctx.save();
        ctx.translate(pivotX, pivotY);
        ctx.rotate(angle);
        ctx.fillStyle = "rgba(0,0,0,0.42)";
        roundedRectangle(ctx, -span * 0.5 + 6, 7, span, deckThickness + 5, 2);
        ctx.fill();
        ctx.fillStyle = condition === "Stable" ? "#303430" : condition === "Caution" ? "#3a352a" : "#422c29";
        roundedRectangle(ctx, -span * 0.5, -deckThickness * 0.5, span, deckThickness, 2);
        ctx.fill();
        ctx.strokeStyle = active ? "rgba(182,189,50,0.68)" : "rgba(235,236,229,0.22)";
        ctx.lineWidth = active ? 2 : 1;
        ctx.stroke();

        ctx.strokeStyle = "rgba(235,236,229,0.12)";
        ctx.lineWidth = 1;
        const trussBottom = deckThickness + 15;
        ctx.beginPath();
        ctx.moveTo(-span * 0.5, deckThickness * 0.5);
        ctx.lineTo(-span * 0.5 + 18, trussBottom);
        for (let x = -span * 0.5 + 18; x < span * 0.5 - 18; x += 28) {
            ctx.lineTo(x + 14, deckThickness * 0.5);
            ctx.lineTo(x + 28, trussBottom);
        }
        ctx.lineTo(span * 0.5, deckThickness * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-span * 0.5 + 18, trussBottom);
        ctx.lineTo(span * 0.5 - 18, trussBottom);
        ctx.stroke();

        deadBarriers[index].forEach((barrier) => {
            if (barrier.cooldown > 0 || barrier.position < -0.04 || barrier.position > 1.04) {
                return;
            }
            const barrierX = -span * 0.5 + barrier.position * span;
            const laneScale = barrier.lane === 0 ? 1 : 0.82;
            ctx.save();
            ctx.translate(barrierX, -deckThickness * 0.5);
            ctx.scale(laneScale, laneScale);
            ctx.globalAlpha = barrier.lane === 0 ? 1 : 0.66;
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(-13, 1, 28, 5);
            ctx.beginPath();
            ctx.moveTo(-13, 0);
            ctx.lineTo(-9, -13);
            ctx.lineTo(9, -13);
            ctx.lineTo(13, 0);
            ctx.closePath();
            ctx.fillStyle = "#777771";
            ctx.fill();
            ctx.strokeStyle = "rgba(238,238,230,0.38)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.strokeStyle = "rgba(182,106,69,0.58)";
            ctx.beginPath();
            ctx.moveTo(-7, -9);
            ctx.lineTo(7, -9);
            ctx.stroke();
            if (Math.abs(barrier.velocity) > 0.015) {
                const direction = Math.sign(barrier.velocity);
                ctx.strokeStyle = "rgba(226,78,73,0.7)";
                ctx.beginPath();
                ctx.moveTo(-direction * 5, -18);
                ctx.lineTo(direction * 7, -18);
                ctx.lineTo(direction * 3, -21);
                ctx.moveTo(direction * 7, -18);
                ctx.lineTo(direction * 3, -15);
                ctx.stroke();
            }
            ctx.restore();
        });

        if (active) {
            const usableSpan = span - 58;
            const travelPosition = deadTravelPosition();
            const vehicleX = -usableSpan * 0.5 + travelPosition * usableSpan;
            const shake = deadVehicle.mode === "slip" ? Math.sin(deadWorld.time * 24) * 2.5 : 0;
            // A side elevation cannot show lateral displacement directly. Depth scaling
            // interpolates between lanes while the tyre baseline stays on the deck.
            const vehicleScale = 1 - deadVehicle.laneDepth * 0.14;
            ctx.save();
            ctx.translate(vehicleX + shake, -deckThickness * 0.5 - 9 * vehicleScale);
            ctx.scale(vehicleScale, vehicleScale);
            ctx.globalAlpha = 1 - deadVehicle.laneDepth * 0.22;
            ctx.fillStyle = deadVehicle.mode === "slip" ? "#b66a45" : "#d9dad3";
            roundedRectangle(ctx, -16, -10, 32, 14, 4);
            ctx.fill();
            ctx.fillStyle = "#343735";
            roundedRectangle(ctx, -8, -17, 15, 8, 3);
            ctx.fill();
            ctx.fillStyle = "#090a0a";
            ctx.beginPath();
            ctx.arc(-10, 5, 4, 0, Math.PI * 2);
            ctx.arc(10, 5, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#b6bd32";
            ctx.fillRect(11, -6, 3, 2);
            if (deadVehicle.laneChangeTimer > 0) {
                ctx.fillStyle = "#d2d77a";
                ctx.font = "500 6px 'General Sans', sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(`LANE ${deadVehicle.lane + 1}`, 0, -23);
            }
            ctx.restore();
        }
        ctx.restore();

        // Pivot, support and angle readout remain fixed in world space.
        ctx.fillStyle = "#242725";
        ctx.strokeStyle = "rgba(235,236,229,0.16)";
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY + 7);
        ctx.lineTo(pivotX - 24, groundY);
        ctx.lineTo(pivotX + 24, groundY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#0b0c0c";
        ctx.strokeStyle = "#b6bd32";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (Math.abs(signedTilt) > 0.2) {
            ctx.strokeStyle = "rgba(182,189,50,0.55)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pivotX, pivotY, 29, 0, angle, angle < 0);
            ctx.stroke();
        }

        ctx.fillStyle = "rgba(240,240,235,0.62)";
        ctx.font = "500 10px 'General Sans', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`BRIDGE ${index === 0 ? "A" : "B"}`, panel.x + 18, panel.y + 24);
        ctx.fillStyle = condition === "Stable" ? "#aeb66b" : condition === "Caution" ? "#c79b65" : "#e07870";
        ctx.font = "500 7px 'General Sans', sans-serif";
        ctx.fillText(`${condition.toUpperCase()}  •  LEVEL ${level} LINKED`, panel.x + 18, panel.y + 38);
        ctx.fillStyle = "rgba(240,240,235,0.34)";
        ctx.textAlign = "right";
        ctx.fillText(`${signedTilt >= 0 ? "+" : ""}${signedTilt.toFixed(1)}° TILT`, panel.x + panel.width - 18, panel.y + 25);
        ctx.fillText(`${(bridgeCapacity(index) / 1000).toFixed(1)} t CAPACITY`, panel.x + panel.width - 18, panel.y + 38);
        ctx.textAlign = "left";
        ctx.fillText("SIDE ELEVATION", panel.x + 18, panel.y + panel.height - 17);
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(counterPosition * 100)}% LEVERAGE`, panel.x + panel.width - 18, panel.y + panel.height - 17);
        ctx.restore();
    }

    function drawDeadWeight() {
        const ctx = deadContext;
        const width = deadWorld.width;
        const height = deadWorld.height;
        ctx.setTransform(deadWorld.dpr, 0, 0, deadWorld.dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#0d0f0f";
        ctx.fillRect(0, 0, width, height);

        const outerMargin = Math.max(14, width * 0.022);
        const panelGap = Math.max(10, width * 0.016);
        const panelTop = 96;
        const panelBottom = height - 57;
        const panelWidth = (width - outerMargin * 2 - panelGap) * 0.5;
        const panelHeight = panelBottom - panelTop;
        drawSideBridge(ctx, 0, {
            x: outerMargin,
            y: panelTop,
            width: panelWidth,
            height: panelHeight
        });
        drawSideBridge(ctx, 1, {
            x: outerMargin + panelWidth + panelGap,
            y: panelTop,
            width: panelWidth,
            height: panelHeight
        });

        ctx.fillStyle = "rgba(240,240,235,0.44)";
        ctx.font = "500 8px 'General Sans', sans-serif";
        ctx.textAlign = "left";
        const message = deadVehicle.mode === "choose"
            ? "CALCULATING TORQUE — VEHICLE HELD AT CHECKPOINT"
            : deadVehicle.mode === "slip"
                ? "DECK OVERLOAD — TYRES SLIPPING BACK TO CHECKPOINT"
                : deadVehicle.laneChangeTimer > 0
                    ? `SLIDING CONCRETE BARRIER — CHANGING TO LANE ${deadVehicle.lane + 1}`
                    : `${deadVehicle.direction > 0 ? "ASCENDING TO" : "DESCENDING FROM"} LEVEL ${bridgeLevel(deadVehicle.bridge)} VIA BRIDGE ${deadVehicle.bridge === 0 ? "A" : "B"}`;
        ctx.fillText(message, outerMargin, height - 25);

        deadReadouts.mass.textContent = `${(deadSettings.mass / 1000).toFixed(1)}t`;
        deadReadouts.bridgeA.textContent = `L${bridgeLevel(0)}`;
        deadReadouts.bridgeB.textContent = `L${bridgeLevel(1)}`;
    }

    function updateReadouts(timestamp) {
        if (timestamp - lastReadout < 120) {
            return;
        }
        lastReadout = timestamp;
        readouts.vehicles.textContent = String(cars.length).padStart(2, "0");
        readouts.scrap.textContent = String(scrap.length).padStart(2, "0");
        const load = clamp(Math.round((world.fieldLoad * 100 + settings.magnetPower * 34)), 0, 100);
        readouts.field.textContent = `${load}%`;
    }

    function animationLoop(timestamp) {
        const delta = Math.min(0.033, Math.max(0.001, (timestamp - lastTime) / 1000));
        lastTime = timestamp;

        if (currentPage === "iron-tide" && !document.hidden) {
            world.time += delta;
            updateFeeders(delta);
            updateCranes(delta);
            updateScrap(delta);
            updateCars(delta);
            drawScene();
            updateReadouts(timestamp);
        } else if (currentPage === "dead-weight" && !document.hidden) {
            updateDeadWeight(delta);
            drawDeadWeight();
        }

        requestAnimationFrame(animationLoop);
    }

    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(surface);
    const deadResizeObserver = new ResizeObserver(() => resizeDeadCanvas());
    deadResizeObserver.observe(deadSurface);
    window.addEventListener("resize", () => {
        resizeCanvas();
        resizeDeadCanvas();
    }, { passive: true });

    createCranes();
    createCars();
    matchScrapAmount();
    showPage(window.location.hash.slice(1));
    requestAnimationFrame(animationLoop);
})();
