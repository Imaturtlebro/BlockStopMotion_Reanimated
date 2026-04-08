import { world, system, BlockPermutation } from "@minecraft/server";
import { SequenceVault } from "./SequenceVault.js";
import { Logger } from "../utils/Logger.js";
import { SafetyChecks } from "../utils/SafetyChecks.js";
import { MathOps } from "../utils/MathOps.js";
import { ParticleSys } from "../utils/ParticleSys.js";
import { cameraManager } from "../ui/CameraManager.js";
import { FXManager } from "./FXManager.js";

export class RenderCore {
    constructor() {
        this.activeRenders = new Map(); // ControllerId -> PlaybackState
        this.isGloballyPaused = false;
        this.entityPool = [];
        this.lastTickTime = Date.now();
        this.adaptiveMaxUpdates = 512;
    }

    static MAX_UPDATES_PER_TICK = 512;
    static MAX_POOL_SIZE = 256;
    static TARGET_TICK_MS = 30;
    static HOLDING_PEN = { x: 0, y: -100, z: 0 };

    /**
     * Reconstructs a full frame from delta-state compressed animation data.
     * @param {object} animationData The raw animation data.
     * @param {number} targetIndex The frame index to reconstruct.
     * @returns {object} A full block-state map for the frame.
     */
    static rebuildFrame(animationData, targetIndex) {
        if (!animationData || !animationData.frames || targetIndex < 0) return {};
        const fullState = {};

        // Optimization: Find nearest absolute keyframe to avoid full reconstruction
        let startIdx = 0;
        for (let i = targetIndex; i >= 0; i--) {
            if (animationData.frames[i].isKeyframe) {
                startIdx = i;
                break;
            }
        }

        for (let i = startIdx; i <= targetIndex; i++) {
            const frame = animationData.frames[i];
            if (!frame) continue;

            for (const [relPos, paletteIdx] of Object.entries(frame)) {
                if (relPos === "commands" || relPos === "isKeyframe" || relPos === "offset" || relPos === "boxSize" || relPos === "effects" || relPos === "holdTicks") continue;
                fullState[relPos] = paletteIdx;
            }
        }
        return fullState;
    }

    play(player, animationId, mode = "once", easing = "linear", cinematic = false) {
        this.playAtLocation(player.dimension, player.location, animationId, mode, player, easing, 1, null, false, null, cinematic);
    }

    playAtLocation(dimension, location, animationId, mode = "once", player = null, easing = "linear", speedMultiplier = 1, nextAnimation = null, keepLoaded = false, onFinish = null, cinematic = false) {
        console.warn(`[KFA][RenderCore] playAtLocation: animId=${animationId}, mode=${mode}, easing=${easing}, speed=${speedMultiplier}`);
        try {
            const animation = SequenceVault.load(animationId);
            if (!animation) {
                if (player) Logger.error(player, `Animation not found: ${animationId}`);
                else Logger.log(`Animation not found during trigger: ${animationId}`);
                return;
            }
            this.playRawData(dimension, location, animation, mode, player, easing, speedMultiplier, nextAnimation, keepLoaded, onFinish, animationId, cinematic);
        } catch (e) {
            if (player) Logger.error(player, "Failed to play animation", e);
            else Logger.log(`Failed to play animation during trigger: ${e}`);
        }
    }

    playRawData(dimension, location, animationData, mode = "once", player = null, easing = "linear", speedMultiplier = 1, nextAnimation = null, keepLoaded = false, onFinish = null, overrideAnimId = null, cinematic = false) {
        console.warn(`[KFA][RenderCore] playRawData: mode=${mode}, easing=${easing}, speed=${speedMultiplier}`);
        try {
            // Fallback to recorded location if no location provided or requested
            const rawOrigin = location || animationData.initialOrigin || animationData.pos1 || { x: 0, y: 0, z: 0 };
            const finalOrigin = { x: Math.floor(rawOrigin.x), y: Math.floor(rawOrigin.y), z: Math.floor(rawOrigin.z) };

            const playbackId = `${player ? player.id : 'trigger'}_${Date.now()}`;

            // Ticking Area Management
            let tickingAreaName = null;
            if (keepLoaded) {
                tickingAreaName = `kfa_ticking_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                // Create a 2-chunk radius ticking area around origin. 
                // Note: 'circle' with radius 2 is ~4 chunks wide. Safe enough for most animations.
                // We run it async and catch failures (e.g. limit of 10 reached)
                dimension.runCommandAsync(`tickingarea add circle ${finalOrigin.x} ${finalOrigin.y} ${finalOrigin.z} 2 ${tickingAreaName}`)
                    .then(() => {
                        if (player) Logger.info(player, "§ePersist enabled: Ticking area created.");
                    })
                    .catch(e => {
                        if (player) Logger.warn(player, `§cCould not enable persistence: ${e.message || "Ticking area limit reached (Max 10)."}`);
                    });
            }

            const state = {
                animationId: overrideAnimId || "LIVE_PREVIEW",
                data: animationData,
                currentFrame: mode === "reverse" ? animationData.frames.length - 1 : 0,
                pendingBlocks: null,
                cleanupLocations: new Set(),
                mode: mode,
                direction: (mode === "reverse" || mode === "reverse-loop") ? -1 : 1,
                easing: easing,
                speedMultiplier: speedMultiplier,
                nextAnimation: nextAnimation,
                dimension: dimension,
                origin: finalOrigin,
                // If no location was passed, we use the recorded location exactly (ignore pivot)
                pivot: location ? (animationData.pivot || { x: 0, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 },
                taskId: null,
                tickCounter: 1,
                swaps: new Map(),
                cullingRange: keepLoaded ? 0 : 64,
                budgetFactor: 1.0,

                chainTo: nextAnimation || null,
                player: player || null,
                tickingAreaName: tickingAreaName,
                onFinish: onFinish,
                cinematicMode: cinematic,
                cinematicShellBlocks: null
            };

            this.activeRenders.set(playbackId, state);
            if (player) Logger.info(player, `Starting playback of §l${state.animationId}§r (§e${mode}§f)`);
            
            // Phase 10: Camera API Syncing
            if (player && state.data.cameraMarkers) {
                const markers = state.data.cameraMarkers;
                const lastIdx = state.data.frames.length - 1;
                if (markers[0] && markers[lastIdx]) {
                    const totalTicks = state.data.frames.length * (1 / (state.speedMultiplier || 1));
                    cameraManager.applyMarker(player, markers[0]); // Snap to start
                    system.runTimeout(() => {
                        cameraManager.applyMarker(player, markers[lastIdx], totalTicks, "Linear");
                    }, 1);
                }
            }

            Logger.log(`Playback started: ${overrideAnimId || "LIVE_PREVIEW"} at ${finalOrigin.x}, ${finalOrigin.y}, ${finalOrigin.z}`);
            this.runPlayback(playbackId);
        } catch (e) {
            if (player) Logger.error(player, "Failed to play raw animation", e);
            else Logger.log(`Failed to play raw animation during trigger: ${e}`);
        }
    }



    instantiatePrefab(player, animId, location, rotation = 0) {
        if (!player || !animId || !location) return;
        
        const rawData = SequenceVault.load(animId);
        if (!rawData || !rawData.frames || rawData.frames.length === 0) {
            Logger.error(player, "Failed to load animation or it has no frames.");
            return;
        }

        // Apply Rotations
        let animData = rawData;
        const rotSteps = Math.floor((Math.abs(rotation) % 360) / 90);
        for (let i = 0; i < rotSteps; i++) {
            animData = MathOps.rotate90(animData);
        }

        const dimension = player.dimension;
        const frame = RenderCore.rebuildFrame(animData, 0);
        const palette = animData.palette;
        
        let blockCount = 0;
        
        const runPaste = () => {
            for (const [relPos, paletteIdx] of Object.entries(frame)) {
                if (relPos === "offset" || relPos === "boxSize" || relPos === "commands" || relPos === "effects") continue;

                const { x, y, z } = MathOps.unpack(relPos);
                const targetLoc = {
                    x: location.x + x,
                    y: location.y + y,
                    z: location.z + z
                };

                const pData = palette[paletteIdx];
                if (!pData) continue;

                try {
                    const block = dimension.getBlock(targetLoc);
                    if (block && pData.type && pData.type !== "minecraft:air") {
                        const perm = BlockPermutation.resolve(pData.type, pData.states || {});
                        block.setPermutation(perm);
                        blockCount++;
                    }
                } catch (e) { }
            }
            Logger.success(player, `Spawned prefab '§e${animId}§f' with ${blockCount} blocks.`);
        };

        system.run(runPaste);
    }

    stop(playbackId) {
        const state = this.activeRenders.get(playbackId);
        if (!state) return;

        if (state.taskId) system.clearRun(state.taskId);

        // Cleanup entities by recycling them to the holding pen
        if (state.interpolationEntities && state.interpolationEntities.size > 0) {
            for (const entity of state.interpolationEntities.values()) {
                if (entity.isValid()) {
                    // Reset velocity to prevent inertia drift
                    entity.setProperty("bsm:vel_x", 0);
                    entity.setProperty("bsm:vel_y", 0);
                    entity.setProperty("bsm:vel_z", 0);

                    if (this.entityPool.length < RenderCore.MAX_POOL_SIZE) {
                        entity.teleport(RenderCore.HOLDING_PEN, { dimension: state.dimension });
                        this.entityPool.push(entity);
                    } else {
                        entity.remove();
                    }
                }
            }
            state.interpolationEntities.clear();
        }

        // Cleanup Ticking Area (if any)
        if (state.tickingAreaName) {
            state.dimension.runCommandAsync(`tickingarea remove ${state.tickingAreaName}`).catch(() => { });
        }

        // Cleanup Helper Blocks (Temporary)
        if (state.cleanupLocations && state.cleanupLocations.size > 0) {
            const dimension = state.dimension;
            for (const locStr of state.cleanupLocations) {
                const [x, y, z] = locStr.split(',').map(Number);
                try {
                    const block = dimension.getBlock({ x, y, z });
                    if (block) {
                        block.setPermutation(BlockPermutation.resolve("minecraft:air"));
                    }
                } catch (e) { }
            }
        }

        // Solidify Hybrid Shadow System barriers if stopped manually mid-playback
        if (state.cinematicMode && state.data && state.data.frames) {
            try {
                state.cinematicMode = false; // Turn off entity mode
                const rebuilt = RenderCore.rebuildFrame(state.data, state.currentFrame);
                this.applyBlocks(state, Object.entries(rebuilt), true); // Force solid draw
            } catch (e) {
                console.error(`[BSM] Failed to solidify stopped animation: ${e}`);
            }
        }

        this.activeRenders.delete(playbackId);
        if (state.player) {
            Logger.info(state.player, `Stopped playback: ${state.animationId}`);
            cameraManager.clearCamera(state.player);
        }

        if (state.onFinish) {
            try { state.onFinish(); } catch (e) { console.error(`[KFA][RenderCore] onFinish error: ${e}`); }
        }
    }

    runPlayback(playbackId) {
        const state = this.activeRenders.get(playbackId);
        if (!state) return;

        state.taskId = system.runInterval(() => {
            try {
                if (this.isGloballyPaused) return;

                // Safety Throttle
                if (this.activeRenders.size > 3 && state.speedMultiplier > 0.5) {
                    state.speedMultiplier = 0.5;
                }

                // Robustness: Stop if player is invalid/disconnected (if attached to a player)
                if (state.player && !SafetyChecks.isValid(state.player)) {
                    this.stop(playbackId);
                    return;
                }

                // Smart Culling: Skip rendering if no viewers are nearby
                if (state.cullingRange > 0 && !state.keepLoaded) {
                    const nearbyPlayers = state.dimension.getPlayers({ location: state.origin, maxDistance: state.cullingRange });
                    if (nearbyPlayers.length === 0) {
                        state.currentFrame += state.direction;
                        const isFinished = (state.currentFrame >= state.data.frames.length || state.currentFrame < 0);
                        if (isFinished) {
                            if (state.mode === "loop") state.currentFrame = 0;
                            else if (state.mode === "reverse-loop") state.currentFrame = state.data.frames.length - 1;
                            else {
                                this.handleCompletion(playbackId, state);
                                return;
                            }
                        }
                        return; // Skip this tick's rendering
                    }
                }

                if (state.tickCounter > 0) {
                    state.tickCounter -= state.speedMultiplier;
                    if (state.tickCounter > 0) return;
                }

                if (!state.pendingBlocks) {
                    const frame = state.data.frames[state.currentFrame];

                    // Persistent Metadata Handling (Delta Frames)
                    const prevOffset = state.frameOffset ? { ...state.frameOffset } : { x: 0, y: 0, z: 0 };
                    if (frame.offset) {
                        state.frameOffset = frame.offset;
                    } else if (state.frameOffset === undefined) {
                        state.frameOffset = { x: 0, y: 0, z: 0 };
                    }

                    const prevBoxSize = state.currentBoxSize;
                    if (frame.boxSize) {
                        state.currentBoxSize = frame.boxSize;
                    } else if (state.currentBoxSize === undefined) {
                        state.currentBoxSize = state.data.initialSize || null;
                    }

                    // Filter out non-block entries
                    state.pendingBlocks = Object.entries(frame).filter(([k]) => k !== "commands" && k !== "offset" && k !== "boxSize" && k !== "effects" && k !== "holdTicks");

                    // Process Particles
                    ParticleSys.processFrameEffects(state.dimension, state.origin, frame);

                    // Phase 11: FX & Audio Integration
                    if (frame.events) {
                        FXManager.processEvents(state.dimension, state.origin, frame.events, state.frameOffset);
                    }

                    const offsetChanged = (prevOffset.x !== state.frameOffset.x || prevOffset.y !== state.frameOffset.y || prevOffset.z !== state.frameOffset.z);
                    const shrunk = (prevBoxSize && state.currentBoxSize &&
                        (prevBoxSize.x > state.currentBoxSize.x || prevBoxSize.y > state.currentBoxSize.y || prevBoxSize.z > state.currentBoxSize.z));

                    if (offsetChanged) {
                        // Rebuild the full frame so translated playback redraws the whole structure.
                        const rebuilt = RenderCore.rebuildFrame(state.data, state.currentFrame);
                        state.pendingBlocks = Object.entries(rebuilt);
                    }

                    if (offsetChanged || shrunk) {
                        this.queueBoxDifferenceCleanup(
                            state,
                            prevOffset,
                            prevBoxSize || state.data.initialSize,
                            state.frameOffset,
                            state.currentBoxSize || state.data.initialSize
                        );
                    }

                    if (state.cinematicMode) {
                        state.cinematicShellBlocks = this.buildShellBlockSet(state.data, state.currentFrame);
                    } else {
                        state.cinematicShellBlocks = null;
                    }
                }

                const maxUpdates = Math.floor(this.adaptiveMaxUpdates * state.budgetFactor);
                const updatesThisTick = state.pendingBlocks.splice(0, maxUpdates);
                
                const isFinalFrame = (state.currentFrame === state.data.frames.length - 1 && state.direction === 1) || 
                                     (state.currentFrame === 0 && state.direction === -1);

                const tStart = Date.now();
                this.applyBlocks(state, updatesThisTick, isFinalFrame);
                const tEnd = Date.now();
                
                // --- Task 4: Adaptive Health Check ---
                // Adjust MAX_UPDATES based on tick duration. 
                // If duration is extremely high, drop limit significantly to allow recovery.
                const duration = tEnd - tStart;
                if (duration > RenderCore.TARGET_TICK_MS * 1.5) {
                    this.adaptiveMaxUpdates = Math.max(16, Math.floor(this.adaptiveMaxUpdates / 2));
                } else if (duration > RenderCore.TARGET_TICK_MS) {
                    this.adaptiveMaxUpdates = Math.max(16, this.adaptiveMaxUpdates - 32);
                } else if (duration < RenderCore.TARGET_TICK_MS / 2) {
                    this.adaptiveMaxUpdates = Math.min(RenderCore.MAX_UPDATES_PER_TICK, this.adaptiveMaxUpdates + 16);
                }

                if (state.pendingBlocks.length === 0) {
                    state.pendingBlocks = null;
                    this.executeFrameCommands(state);

                    const prevFrame = state.currentFrame;
                    const isFinished = !this.advanceFrame(state);

                    if (isFinished) {
                        this.handleCompletion(playbackId, state);
                        return;
                    }

                    // DELTA FIX: If currentFrame is not (prevFrame + 1), we MUST rebuild.
                    // This covers reverse, ping-pong, and manual scrubs.
                    if (state.currentFrame !== prevFrame + 1) {
                        const rebuilt = RenderCore.rebuildFrame(state.data, state.currentFrame);
                        state.pendingBlocks = Object.entries(rebuilt);
                        state.cinematicShellBlocks = state.cinematicMode ? this.buildShellBlockSet(state.data, state.currentFrame) : null;
                    }

                    state.tickCounter = this.calculateEasingDelay(state);
                }
            } catch (e) {
                Logger.log(`Error in playback loop for ${state.animationId}: ${e}`);
                this.stop(playbackId);
            }
        }, 1);
    }

    advanceFrame(state) {
        state.currentFrame += state.direction;

        if (state.currentFrame >= state.data.frames.length || state.currentFrame < 0) {
            if (state.mode === "loop") {
                state.currentFrame = 0;
            } else if (state.mode === "reverse-loop") {
                state.currentFrame = state.data.frames.length - 1;
            } else if (state.mode === "ping-pong") {
                state.direction *= -1;
                state.currentFrame += state.direction * 2;
                // Boundary clamp for ping-pong
                state.currentFrame = Math.max(0, Math.min(state.data.frames.length - 1, state.currentFrame));
            } else {
                return false; // Done
            }
        }
        return true;
    }

    handleCompletion(playbackId, state) {
        this.stop(playbackId);
        if (state.chainTo) {
            system.run(() => {
                const animation = SequenceVault.load(state.chainTo);
                if (animation) {
                    this.playAtLocation(state.dimension, state.origin, state.chainTo, "once", state.player, state.easing, state.speedMultiplier, null, false, null, state.cinematicMode);
                }
            });
        }
    }

    applyBlocks(state, updates, forceAll = false) {
        const dimension = state.dimension;
        const pivot = state.pivot || { x: 0, y: 0, z: 0 };
        const palette = state.data.palette || [];

        const currentFrameData = state.data.frames[state.currentFrame] || {};
        const useEntities = currentFrameData.useEntities || state.cinematicMode || false;

        // --- Entity Cleanup (End of Interpolation) ---
        if (!useEntities && state.interpolationEntities && state.interpolationEntities.size > 0) {
            for (const entity of state.interpolationEntities.values()) {
                if (entity.isValid()) {
                    if (this.entityPool.length < RenderCore.MAX_POOL_SIZE) {
                        entity.teleport(RenderCore.HOLDING_PEN, { dimension: state.dimension });
                        this.entityPool.push(entity);
                    } else {
                        entity.remove();
                    }
                }
            }
            state.interpolationEntities.clear();
        }

        const updatesThisTick = updates;
        const groupIndex = (system.currentTick || 0) % 4;
        const shellBlocks = state.cinematicMode
            ? state.cinematicShellBlocks
            : (currentFrameData.shellBlocks ? new Set(currentFrameData.shellBlocks) : null);

        const distanceLOD = dimension.getPlayers({ location: state.origin, maxDistance: 30 }).length > 0;

        for (const [relPos, data] of updatesThisTick) {
            const { x: rx, y: ry, z: rz } = MathOps.unpack(relPos);
            
            let pIdx = data;
            if (state.swaps.has(data)) {
                pIdx = state.swaps.get(data);
            }

            const blockData = palette[pIdx];
            if (!blockData) continue;

            const frameOffset = state.frameOffset || { x: 0, y: 0, z: 0 };
            const targetPos = {
                x: state.origin.x + frameOffset.x + (rx - pivot.x),
                y: state.origin.y + frameOffset.y + (ry - pivot.y),
                z: state.origin.z + frameOffset.z + (rz - pivot.z)
            };

            // Selective Entity Rendering (Shell Culling & LOD)
            // If shellBlocks is defined, only those blocks use entities.
            // distanceLOD: If player is > 30 blocks away, force voxel mode for performance.
            let shouldBeEntity = (shellBlocks ? shellBlocks.has(relPos) : useEntities) && distanceLOD;
            
            // Solidify back to real blocks on the final frame if playback stops here
            if (forceAll && state.mode === "once") {
                shouldBeEntity = false;
            }

            if (shouldBeEntity) {
                if (blockData.type === "minecraft:air") continue;
                if (!state.interpolationEntities) state.interpolationEntities = new Map();
                
                // --- Task 1: High-Speed Group Cycling (O(1)) ---
                // Using bits from the packed relPos to ensure deterministic tick assignment without list searching.
                const bitIdx = parseInt(relPos, 36);
                if (!forceAll && (bitIdx % 4) !== groupIndex) continue;

                let entity = state.interpolationEntities.get(relPos);
                const spawnPos = { x: targetPos.x + 0.5, y: targetPos.y, z: targetPos.z + 0.5 };

                // GHOST FRAME PREDICTION: Calculate velocity for next update
                let vel = { x: 0, y: 0, z: 0 };
                
                // Task 3: Inertia Kill (Force zero velocity on final frame to prevent drift)
                if (!forceAll) {
                    const nextFrameIdx = state.currentFrame + state.direction;
                    if (nextFrameIdx >= 0 && nextFrameIdx < state.data.frames.length) {
                        const nextFrame = state.data.frames[nextFrameIdx];
                        if (nextFrame[relPos] !== undefined) {
                            const nextOffset = nextFrame.offset || state.frameOffset || { x: 0, y: 0, z: 0 };
                            const nextPos = {
                                x: state.origin.x + nextOffset.x + (rx - pivot.x) + 0.5,
                                y: state.origin.y + nextOffset.y + (ry - pivot.y),
                                z: state.origin.z + nextOffset.z + (rz - pivot.z) + 0.5
                            };
                            vel = {
                                x: (nextPos.x - spawnPos.x) / 4,
                                y: (nextPos.y - spawnPos.y) / 4,
                                z: (nextPos.z - spawnPos.z) / 4
                            };
                        }
                    }
                }

                if (!entity || !entity.isValid()) {
                    try {
                        // ENTITY POOLING: Try to grab from pool first
                        if (this.entityPool && this.entityPool.length > 0) {
                            entity = this.entityPool.pop();
                            if (entity.isValid()) {
                                entity.teleport(spawnPos, { dimension });
                            } else {
                                entity = dimension.spawnEntity("bsm:entity_block", spawnPos);
                            }
                        } else {
                            entity = dimension.spawnEntity("bsm:entity_block", spawnPos);
                        }

                        const itemId = blockData.type.replace("minecraft:", "");
                        entity.runCommandAsync(`replaceitem entity @s slot.weapon.mainhand 0 ${itemId}`);
                        state.interpolationEntities.set(relPos, entity);
                    } catch (e) {}
                } else {
                    try {
                        entity.teleport(spawnPos, { dimension });
                    } catch (e) {}
                }

                if (entity && entity.isValid()) {
                    entity.setProperty("bsm:vel_x", vel.x);
                    entity.setProperty("bsm:vel_y", vel.y);
                    entity.setProperty("bsm:vel_z", vel.z);
                }
                // HYBRID SHADOW SYSTEM: Do NOT continue. Fall through to place a physical barrier.
            } else if (state.interpolationEntities && state.interpolationEntities.has(relPos)) {
                // LOD Transition: Kill entity if we switched to voxel mode
                const entity = state.interpolationEntities.get(relPos);
                if (entity && entity.isValid()) {
                    if (this.entityPool.length < RenderCore.MAX_POOL_SIZE) {
                        entity.teleport(RenderCore.HOLDING_PEN, { dimension: state.dimension });
                        this.entityPool.push(entity);
                    } else {
                        entity.remove();
                    }
                }
                state.interpolationEntities.delete(relPos);
            }

            try {
                const block = dimension.getBlock(targetPos);
                if (!block) continue;

                let typeToPlace = blockData.type;
                let statesToPlace = blockData.states;

                // Replace visuals with invisible collision if the entity is handling visuals
                if (shouldBeEntity) {
                    typeToPlace = "minecraft:barrier";
                    statesToPlace = {};
                } else if (blockData.role === "collision-only") {
                    typeToPlace = "minecraft:barrier";
                    statesToPlace = {};
                }

                if (blockData.role === "temporary") {
                    const locKey = `${targetPos.x},${targetPos.y},${targetPos.z}`;
                    state.cleanupLocations.add(locKey);
                }

                const permutation = BlockPermutation.resolve(typeToPlace, statesToPlace);
                if (permutation) {
                    block.setPermutation(permutation);
                }

                if (blockData.role === "debris" && !useEntities) {
                    try {
                        const spawnPos = { x: targetPos.x + 0.5, y: targetPos.y, z: targetPos.z + 0.5 };
                        dimension.spawnEntity("minecraft:falling_block", spawnPos);
                    } catch (e) { }
                }
            } catch (e) {
                if (!e.message || !e.message.includes("outside of the world")) {
                    Logger.trace(state.animationId, state.currentFrame, targetPos, e);
                }
            }
        }
    }

    queueBoxDifferenceCleanup(state, oldOffset, oldSize, newOffset, newSize) {
        let airIdx = state.data.palette.findIndex(p => p.type === "minecraft:air");
        if (airIdx === -1) {
            airIdx = state.data.palette.length;
            state.data.palette.push({ type: "minecraft:air", states: {}, role: "normal" });
        }

        const cleanupBlocks = [];
        for (let x = 0; x < oldSize.x; x++) {
            for (let y = 0; y < oldSize.y; y++) {
                for (let z = 0; z < oldSize.z; z++) {
                    const absX = oldOffset.x + x;
                    const absY = oldOffset.y + y;
                    const absZ = oldOffset.z + z;

                    if (absX < newOffset.x || absX >= newOffset.x + newSize.x ||
                        absY < newOffset.y || absY >= newOffset.y + newSize.y ||
                        absZ < newOffset.z || absZ >= newOffset.z + newSize.z) {
                        const relX = absX - newOffset.x;
                        const relY = absY - newOffset.y;
                        const relZ = absZ - newOffset.z;
                        cleanupBlocks.push([MathOps.pack(relX, relY, relZ), airIdx]);
                    }
                }
            }
        }

        if (cleanupBlocks.length > 0) {
            // Prepend cleanup to ensure it happens BEFORE the new frame blocks appear
            state.pendingBlocks = [...cleanupBlocks, ...(state.pendingBlocks || [])];
        }
    }

    buildShellBlockSet(animationData, frameIndex) {
        const fullState = RenderCore.rebuildFrame(animationData, frameIndex);
        const palette = animationData.palette || [];
        const shellBlocks = new Set();

        for (const [relPos, paletteIdx] of Object.entries(fullState)) {
            const blockData = palette[paletteIdx];
            if (!blockData || blockData.type === "minecraft:air") continue;

            if (this.isShellBlock(fullState, palette, relPos)) {
                shellBlocks.add(relPos);
            }
        }

        return shellBlocks;
    }

    isShellBlock(fullState, palette, relPos) {
        const { x, y, z } = MathOps.unpack(relPos);
        const neighbors = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1]
        ];

        for (const [dx, dy, dz] of neighbors) {
            const neighborKey = MathOps.pack(x + dx, y + dy, z + dz);
            const neighborIdx = fullState[neighborKey];
            if (neighborIdx === undefined) return true;

            const neighborData = palette[neighborIdx];
            if (!neighborData || neighborData.type === "minecraft:air") return true;
        }

        return false;
    }



    setGlobalPause(paused) {
        this.isGloballyPaused = paused;
        Logger.log(`Global playback §e${paused ? "PAUSED" : "RESUMED"}§f.`);
    }

    setSwap(playbackId, originalTypeId, replacementTypeId) {
        const state = this.activeRenders.get(playbackId);
        if (!state) return;

        const origIdx = state.data.palette.findIndex(p => p.type === originalTypeId);
        if (origIdx === -1) {
            Logger.info(null, `Swap failed: §e${originalTypeId}§f not found in palette.`);
            return;
        }

        let repIdx = state.data.palette.findIndex(p => p.type === replacementTypeId);
        if (repIdx === -1) {
            // Add the replacement type to the palette so the swap can work
            repIdx = state.data.palette.length;
            state.data.palette.push({ type: replacementTypeId, states: {}, role: "normal" });
        }

        state.swaps.set(origIdx, repIdx);
        Logger.info(null, `Swapped §e${originalTypeId}§f with §b${replacementTypeId}§f in playback.`);
    }

    executeFrameCommands(state) {
        const frame = state.data.frames[state.currentFrame];
        if (!frame) return;

        // Phase 12: Standard Commands
        if (frame.commands) {
            for (const cmd of frame.commands) {
                try {
                    world.getDimension(state.dimension.id).runCommandAsync(cmd);
                } catch (e) { }
            }
        }

        // Phase 13: Logic-Link (ScriptEvents)
        // Allows BSM to communicate with other mods (e.g. Block Physics)
        if (frame.scriptEvents) {
            for (const event of frame.scriptEvents) {
                try {
                    world.getDimension(state.dimension.id).runCommandAsync(`scriptevent bsm:event ${event}`);
                } catch (e) { }
            }
        }
    }

    stopAll() {
        const count = this.activeRenders.size;
        const ids = [...this.activeRenders.keys()];
        for (const playbackId of ids) {
            this.stop(playbackId);
        }
        Logger.log(`Stopped all §e${count}§f active playbacks.`);
    }

    calculateEasingDelay(state) {
        let baseDelay = 1;
        const currentFrameIdx = state.currentFrame;
        const frameData = state.data.frames[currentFrameIdx] || {};
        const holdTicks = frameData.holdTicks || 0;

        if (state.easing === "linear") {
            return Math.max(0, Math.floor((baseDelay + holdTicks) / state.speedMultiplier));
        }

        const total = state.data.frames.length;
        const progress = total > 1 ? currentFrameIdx / (total - 1) : 1;

        let delay = baseDelay;
        if (state.easing === "ease-in") {
            delay = baseDelay + Math.floor((1 - progress) * 10);
        } else if (state.easing === "ease-out") {
            delay = baseDelay + Math.floor(progress * 10);
        } else if (state.easing === "ease-in-out") {
            // Simple sigmoid-ish delay: slower at start and end
            const easeInOutProgress = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            const speedFactor = Math.abs(easeInOutProgress - 0.5) * 2; // 1 at extremes, 0 at middle
            delay = baseDelay + Math.floor(speedFactor * 8);
        }

        return Math.max(0, Math.floor((delay + holdTicks) / state.speedMultiplier));
    }
}

export const renderCore = new RenderCore();
