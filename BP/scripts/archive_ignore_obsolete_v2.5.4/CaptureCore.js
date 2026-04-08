import { world, system, BlockPermutation } from "@minecraft/server";
import { rigManager } from "./RigManager.js";
import { renderCore } from "./RenderCore.js";
import { SequenceVault } from "./SequenceVault.js";
import { RegionHighlighter } from "./RegionHighlighter.js";
import { ConsoleOut } from "./ConsoleOut.js";
import { phantomRenderer } from "./PhantomRenderer.js";
import { MathOps } from "./MathOps.js";
import { actionLog } from "./ActionLog.js";
import { SafetyChecks } from "./SafetyChecks.js";
import { ParticleSys } from "./ParticleSys.js";
import { nudgeEngine } from "./NudgeEngine.js";
import { autoCaptureEngine } from "./AutoCaptureEngine.js";

export class CaptureCore {
    constructor() {
        this.activeCaptures = new Map(); // PlayerId -> RecordingState
    }

    startRecording(player, name, pos1, pos2, fps = 5) {
        console.warn(`[KFA][CaptureCore] startRecording: name=${name}, pos1=(${pos1.x},${pos1.y},${pos1.z}), pos2=(${pos2.x},${pos2.y},${pos2.z})`);
        if (!SafetyChecks.isReasonableBounds(pos1, pos2, 256)) {
            ConsoleOut.error(player, "Recording area too large! Maximum 256 blocks on any axis.");
            return;
        }

        try {
            const state = {
                name: name,
                pos1: { x: Math.floor(Math.min(pos1.x, pos2.x)), y: Math.floor(Math.min(pos1.y, pos2.y)), z: Math.floor(Math.min(pos1.z, pos2.z)) },
                pos2: { x: Math.floor(Math.max(pos1.x, pos2.x)), y: Math.floor(Math.max(pos1.y, pos2.y)), z: Math.floor(Math.max(pos1.z, pos2.z)) },
                initialOrigin: null, // Set on first frame capture
                initialSize: null, // Set on first frame capture (for kinetic frames)
                frames: [],
                palette: [], // Store unique block data objects: { type, states, role }
                paletteMap: new Map(), // Quick lookup: hash -> palette index
                frameHistory: [], // Stores previous lastFrame states for undo
                lastFrame: null,
                isRecording: true,
                activeRole: "normal",
                onionskin: false,
                pivot: { x: 0, y: 0, z: 0 }, // Offset from pos1
                pendingCommands: [], // Commands to attach to the NEXT frame
                filters: new Set(["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"]), // Default filters
                redoStack: [], // Frame redo stack
                showTrails: false, // Ghost trails toggle
                trailParticles: [], // History of block positions for trails
                maskedBlocks: new Set(), // Set of absolute "x,y,z" strings for Anchor Masking
                fps: fps,
                // Auto-Capture
                autoCapture: { mode: "NONE", threshold: 0, counter: 0, taskId: null }, // modes: NONE, TIME, LIVE, QUOTA
                // HUD
                showHUD: true, // HUD Visibility
                hudTaskId: null
            };

            // Set initial origin to current pos1
            state.initialOrigin = { ...state.pos1 };
            state.initialSize = {
                x: state.pos2.x - state.pos1.x + 1,
                y: state.pos2.y - state.pos1.y + 1,
                z: state.pos2.z - state.pos1.z + 1
            };
            // HUD
            state.hudTaskId = system.runInterval(() => {
                this._updateHUD(player, state);
            }, 20);

            this.activeCaptures.set(player.id, state);

            ConsoleOut.info(player, `Started recording §l${name}§r`);
            ConsoleOut.info(player, `Bounds: §e${state.pos1.x},${state.pos1.y},${state.pos1.z}§r to §e${state.pos2.x},${state.pos2.y},${state.pos2.z}§r`);

            // Warn if any axis exceeds the 255-block packing limit
            const sizeX = state.pos2.x - state.pos1.x + 1;
            const sizeY = state.pos2.y - state.pos1.y + 1;
            const sizeZ = state.pos2.z - state.pos1.z + 1;
            if (sizeX > 255 || sizeY > 255 || sizeZ > 255) {
                ConsoleOut.warn(player, `§cWarning: Recording area exceeds 255 blocks on an axis (${sizeX}x${sizeY}x${sizeZ}). Data may be corrupted!`);
            }

            ConsoleOut.log(`Player ${player.name} started recording: ${name}`);

            // Capture initial frame (Keyframe)
            this.captureFrame(player);
        } catch (e) {
            ConsoleOut.error(player, "Failed to start recording", e);
        }
    }

    captureFrame(player, force = false) {
        const state = this.activeCaptures.get(player.id);
        if (!state || !state.isRecording) {
            ConsoleOut.warn(player, "No active recording found to capture frame.");
            return;
        }

        try {
            const dimension = player.dimension;
            const size = {
                x: state.pos2.x - state.pos1.x + 1,
                y: state.pos2.y - state.pos1.y + 1,
                z: state.pos2.z - state.pos1.z + 1
            };
            const volume = size.x * size.y * size.z;
            const MAX_BATCH_VOLUME = 4096; // Max blocks to scan per tick (16x16x16)

            if (volume <= MAX_BATCH_VOLUME) {
                // Synchronous capture for small areas
                this._processFrameCapture(player, state, dimension, state.pos1, state.pos2, force);
            } else {
                // Staggered capture for large areas
                this._processStaggeredCapture(player, state, dimension, force);
            }
        } catch (e) {
            ConsoleOut.error(player, "Error while initiating frame capture", e);
        }
    }

    /**
     * Internal processor for frame capture logic.
     * @private
     */
    _processFrameCapture(player, state, dimension, pos1, pos2, force) {
        const currentFrame = {};
        const deltaFrame = {};
        let changedCount = 0;

        for (let x = pos1.x; x <= pos2.x; x++) {
            for (let y = pos1.y; y <= pos2.y; y++) {
                for (let z = pos1.z; z <= pos2.z; z++) {
                    const absKey = `${x},${y},${z}`;
                    const relPosKey = MathOps.pack(x - pos1.x, y - pos1.y, z - pos1.z);

                    if (state.maskedBlocks.has(absKey)) {
                        const lastPaletteIdx = state.lastFrame ? state.lastFrame[relPosKey] : undefined;
                        if (lastPaletteIdx !== undefined) {
                            currentFrame[relPosKey] = lastPaletteIdx;
                        }
                        continue;
                    }

                    const block = dimension.getBlock({ x, y, z });
                    let typeId = block ? block.typeId : "minecraft:air";
                    let states = block ? block.permutation.getAllStates() : {};

                    // Apply Filters (Treat filtered blocks as Air)
                    if (state.filters.has(typeId)) {
                        typeId = "minecraft:air";
                        states = {};
                    }

                    let stateStr = "";
                    const keys = Object.keys(states);
                    if (keys.length > 0) {
                        for (const k of keys) stateStr += `${k}=${states[k]},`;
                    }
                    const blockHash = `${typeId}|${stateStr}|${state.activeRole}`;
                    let paletteIdx = state.paletteMap.get(blockHash);
                    if (paletteIdx === undefined) {
                        paletteIdx = state.palette.push({ type: typeId, states, role: state.activeRole }) - 1;
                        state.paletteMap.set(blockHash, paletteIdx);
                    }

                    currentFrame[relPosKey] = paletteIdx;

                    const lastPaletteIdx = state.lastFrame ? state.lastFrame[relPosKey] : undefined;
                    if (lastPaletteIdx !== paletteIdx) {
                        deltaFrame[relPosKey] = paletteIdx;
                        changedCount++;
                    }
                }
            }
        }

        this._finalizeFrame(player, state, currentFrame, deltaFrame, changedCount, force);
    }

    /**
     * Staggered capture logic for large volumes.
     * @private
     */
    _processStaggeredCapture(player, state, dimension, force) {
        if (state.isProcessingCapture) {
            ConsoleOut.warn(player, "A capture is already in progress!");
            return;
        }
        state.isProcessingCapture = true;

        const currentFrame = {};
        const deltaFrame = {};
        let changedCount = 0;

        const min = state.pos1;
        const max = state.pos2;
        const size = { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 };
        const totalVolume = size.x * size.y * size.z;

        let currentIndex = 0;
        const BATCH_SIZE = 8000; // 8k blocks per tick is safe for most Bedrock servers

        player.onScreenDisplay.setActionBar("§eScanning large area... §fPlease wait.");

        const runSlice = () => {
            const batchLimit = Math.min(currentIndex + BATCH_SIZE, totalVolume);

            for (let i = currentIndex; i < batchLimit; i++) {
                // De-index into 3D relative coords
                const rX = Math.floor(i / (size.y * size.z));
                const rem = i % (size.y * size.z);
                const rY = Math.floor(rem / size.z);
                const rZ = rem % size.z;

                const x = min.x + rX;
                const y = min.y + rY;
                const z = min.z + rZ;

                const absKey = `${x},${y},${z}`;
                const relPosKey = MathOps.pack(rX, rY, rZ);

                if (state.maskedBlocks.has(absKey)) {
                    const lastPaletteIdx = state.lastFrame ? state.lastFrame[relPosKey] : undefined;
                    if (lastPaletteIdx !== undefined) {
                        currentFrame[relPosKey] = lastPaletteIdx;
                    }
                    continue;
                }

                const block = dimension.getBlock({ x, y, z });
                let typeId = block ? block.typeId : "minecraft:air";
                let states = block ? block.permutation.getAllStates() : {};

                if (state.filters.has(typeId)) { typeId = "minecraft:air"; states = {}; }

                let stateStr = "";
                const keys = Object.keys(states);
                if (keys.length > 0) {
                    for (const k of keys) stateStr += `${k}=${states[k]},`;
                }
                const blockHash = `${typeId}|${stateStr}|${state.activeRole}`;
                let paletteIdx = state.paletteMap.get(blockHash);
                if (paletteIdx === undefined) {
                    paletteIdx = state.palette.push({ type: typeId, states, role: state.activeRole }) - 1;
                    state.paletteMap.set(blockHash, paletteIdx);
                }

                currentFrame[relPosKey] = paletteIdx;

                const lastPaletteIdx = state.lastFrame ? state.lastFrame[relPosKey] : undefined;
                if (lastPaletteIdx !== paletteIdx) {
                    deltaFrame[relPosKey] = paletteIdx;
                    changedCount++;
                }
            }

            currentIndex = batchLimit;
            if (currentIndex < totalVolume) {
                const progress = Math.floor((currentIndex / totalVolume) * 100);
                player.onScreenDisplay.setActionBar(`§eScanning large area... §b${progress}%`);

                if (!SafetyChecks.isValid(player)) {
                    state.isProcessingCapture = false;
                    return;
                }
                system.run(runSlice);
            } else {
                state.isProcessingCapture = false;
                this._finalizeFrame(player, state, currentFrame, deltaFrame, changedCount, force);
            }
        };

        system.run(runSlice);
    }

    _finalizeFrame(player, state, currentFrame, deltaFrame, changedCount, force) {
        state.frameHistory.push(state.lastFrame);

        // Offset Logic
        const offset = {
            x: state.pos1.x - state.initialOrigin.x,
            y: state.pos1.y - state.initialOrigin.y,
            z: state.pos1.z - state.initialOrigin.z
        };
        if (offset.x !== 0 || offset.y !== 0 || offset.z !== 0) {
            deltaFrame.offset = offset;
        }

        // Kinetic Logic
        const currentSize = { x: state.pos2.x - state.pos1.x + 1, y: state.pos2.y - state.pos1.y + 1, z: state.pos2.z - state.pos1.z + 1 };
        if (state.initialSize && (currentSize.x !== state.initialSize.x || currentSize.y !== state.initialSize.y || currentSize.z !== state.initialSize.z)) {
            deltaFrame.boxSize = currentSize;
        }

        // Determine if this frame should be saved (Kinetic changes or Block changes)
        const hasOffset = deltaFrame.offset !== undefined;
        const hasSizeChange = deltaFrame.boxSize !== undefined;
        const hasBlockChanges = changedCount > 0;
        const hasCommands = state.pendingCommands && state.pendingCommands.length > 0;

        if (hasBlockChanges || hasOffset || hasSizeChange || hasCommands || force) {
            if (hasCommands) {
                deltaFrame.commands = [...state.pendingCommands];
                state.pendingCommands = []; // Clear after attaching
            }
            state.frames.push(deltaFrame);
            state.lastFrame = currentFrame;
            state.redoStack = [];
            player.playSound("random.click");
            ParticleSys.onCapture(player.dimension, player.location);
            console.warn(`[BSM][CaptureCore] Frame ${state.frames.length} captured: ${changedCount} changes, offset=${hasOffset}, sizeChange=${hasSizeChange}, commands=${hasCommands}`);
            ConsoleOut.actionBar(player, `§bCaptured Frame §e${state.frames.length}§r | Changes: §b${changedCount}`);
            ConsoleOut.info(player, `Captured §lFrame ${state.frames.length}§r: §e${changedCount}§f changes${hasOffset ? " + Movement" : ""}.`);

            if (state.onionskin) {
                // Pass last 3 frames for multi-layer ghosting
                const past = state.frames.slice(-3).reverse();
                phantomRenderer.previewFrame(player, past, [], state.pos1, state.palette);
            }

            if (state.showTrails) {
                this.updateTrails(player, state, deltaFrame);
            }
        }
    }

    moveToPlayer(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;

        const pPos = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
        const pivot = state.pivot || { x: 0, y: 0, z: 0 };

        // We want: pPos = state.pos1 + pivot
        // Therefore: state.pos1 = pPos - pivot
        const currentSize = {
            x: state.pos2.x - state.pos1.x,
            y: state.pos2.y - state.pos1.y,
            z: state.pos2.z - state.pos1.z
        };

        const newPos1 = {
            x: pPos.x - pivot.x,
            y: pPos.y - pivot.y,
            z: pPos.z - pivot.z
        };

        const newPos2 = {
            x: newPos1.x + currentSize.x,
            y: newPos1.y + currentSize.y,
            z: newPos1.z + currentSize.z
        };

        this.updateBounds(player, newPos1, newPos2);
    }

    revealBounds(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;

        const duration = 100; // 5 seconds
        RegionHighlighter.drawBox(player.dimension, state.pos1, state.pos2, "minecraft:end_rod", duration);

        const pivotPos = {
            x: state.pos1.x + state.pivot.x,
            y: state.pos1.y + state.pivot.y,
            z: state.pos1.z + state.pivot.z
        };
        RegionHighlighter.drawPivot(player.dimension, pivotPos, duration);

        ConsoleOut.info(player, "§fRecording bounds revealed.");
    }

    undoFrame(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state || !state.isRecording) return;

        if (state.frames.length <= 1) { // Can't undo the initial frame
            ConsoleOut.warn(player, "Cannot undo the first frame!");
            return;
        }

        const frame = state.frames.pop();
        state.redoStack.push({ frame, history: state.lastFrame });
        state.lastFrame = state.frameHistory.pop();

        player.playSound("random.pop");
        ParticleSys.onStop(player.dimension, player.location);
        ConsoleOut.actionBar(player, `§cUndo: Frame ${state.frames.length + 1} removed`);
        ConsoleOut.info(player, `§cUndo§f: Reverted to §lFrame ${state.frames.length}§r`);
    }

    redoFrame(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state || !state.isRecording || state.redoStack.length === 0) return;

        const { frame, history } = state.redoStack.pop();
        state.frameHistory.push(state.lastFrame);
        state.frames.push(frame);
        state.lastFrame = history; // Restore the full-frame snapshot saved during undo

        ParticleSys.onCapture(player.dimension, player.location);
        ConsoleOut.info(player, `§aRedo§f: Restored §lFrame ${state.frames.length}§r`);
    }

    updateTrails(player, state, deltaFrame) {
        // Simple trail logic: track center of mass or all changed blocks
        const offset = deltaFrame.offset || { x: 0, y: 0, z: 0 };
        for (const [key, paletteIdx] of Object.entries(deltaFrame)) {
            if (key === "commands" || key === "offset" || key === "boxSize" || key === "effects") continue;
            const pos = MathOps.unpack(key);
            // GlobalPos = InitialOrigin + FrameOffset + RelPos
            // wait, state.pos1 IS (InitialOrigin + FrameOffset)
            const globalPos = {
                x: state.pos1.x + pos.x,
                y: state.pos1.y + pos.y,
                z: state.pos1.z + pos.z
            };

            player.dimension.spawnParticle("minecraft:villager_happy", globalPos);
        }
    }

    addFrameCommand(player, command) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        state.pendingCommands.push(command);
        ConsoleOut.info(player, `Command queued for next frame: §7/${command}§f`);
    }

    setActiveRole(player, role) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        state.activeRole = role;
        ConsoleOut.info(player, `Active capture role set to: §d${role}§f`);
    }

    setPivot(player, offset) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        state.pivot = offset;
        ConsoleOut.info(player, `Pivot set to offset: §e${offset.x}, ${offset.y}, ${offset.z}§f`);
    }

    updateBounds(player, pos1, pos2) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;

        const newPos1 = { x: Math.floor(Math.min(pos1.x, pos2.x)), y: Math.floor(Math.min(pos1.y, pos2.y)), z: Math.floor(Math.min(pos1.z, pos2.z)) };
        const newPos2 = { x: Math.floor(Math.max(pos1.x, pos2.x)), y: Math.floor(Math.max(pos1.y, pos2.y)), z: Math.floor(Math.max(pos1.z, pos2.z)) };

        if (!SafetyChecks.isReasonableBounds(newPos1, newPos2, 256)) {
            ConsoleOut.error(player, "New bounds are too large! Move cancelled.");
            return;
        }

        state.pos1 = newPos1;
        state.pos2 = newPos2;

        ConsoleOut.info(player, `Recording bounds moved to: §e${state.pos1.x},${state.pos1.y},${state.pos1.z}§r`);

        // Show new bounds for 5 seconds
        RegionHighlighter.drawBox(player.dimension, state.pos1, state.pos2, "minecraft:end_rod", 100);
    }

    // --- Frame Manipulation ---

    deleteFrame(player, index) {
        const state = this.activeCaptures.get(player.id);
        if (!state || index < 0 || index >= state.frames.length) return;
        state.frames.splice(index, 1);
        ConsoleOut.info(player, `§cDeleted§f frame §e${index + 1}§f.`);
    }

    duplicateFrame(player, index) {
        const state = this.activeCaptures.get(player.id);
        if (!state || index < 0 || index >= state.frames.length) return;
        const orig = state.frames[index];
        const frameCopy = { ...orig };
        if (orig.offset) frameCopy.offset = { ...orig.offset };
        if (orig.boxSize) frameCopy.boxSize = { ...orig.boxSize };
        if (orig.commands) frameCopy.commands = [...orig.commands];
        state.frames.splice(index + 1, 0, frameCopy);
        ConsoleOut.info(player, `§aDuplicated§f frame §e${index + 1}§f.`);
    }

    batchOffset(player, offsetVector) {
        const state = this.activeCaptures.get(player.id);
        if (!state || state.frames.length === 0) return;

        state.frames.forEach(frame => {
            const current = frame.offset || { x: 0, y: 0, z: 0 };
            frame.offset = {
                x: current.x + offsetVector.x,
                y: current.y + offsetVector.y,
                z: current.z + offsetVector.z
            };
        });
        ConsoleOut.success(player, `Applied offset §e${offsetVector.x}, ${offsetVector.y}, ${offsetVector.z}§a to ALL frames.`);
    }

    reorderFrame(player, from, to) {
        const state = this.activeCaptures.get(player.id);
        if (!state || from < 0 || from >= state.frames.length || to < 0 || to >= state.frames.length) return;
        const [frame] = state.frames.splice(from, 1);
        state.frames.splice(to, 0, frame);
        player.playSound("random.orb");
        ConsoleOut.info(player, `§bMoved§f frame §e${from + 1}§f to position §e${to + 1}§f.`);
    }

    insertFrames(player, index, newFrames) {
        const state = this.activeCaptures.get(player.id);
        if (!state || index < 0 || index > state.frames.length) return;
        state.frames.splice(index, 0, ...newFrames);
        ConsoleOut.info(player, `§aInterpolated§f: Inserted §e${newFrames.length}§f new frames.`);
    }

    // --- Anchor Masking ---

    toggleMask(player, location) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;

        // Ensure within bounds
        if (location.x < state.pos1.x || location.x > state.pos2.x ||
            location.y < state.pos1.y || location.y > state.pos2.y ||
            location.z < state.pos1.z || location.z > state.pos2.z) {
            ConsoleOut.warn(player, "Cannot lock block outside recording bounds.");
            return;
        }

        const absKey = `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
        if (state.maskedBlocks.has(absKey)) {
            state.maskedBlocks.delete(absKey);
            ConsoleOut.info(player, "Block unlocked (Anchor removed).");
            // Unlocking: Blue sparks
            ParticleSys.spawnEffect(player.dimension, location, "minecraft:electric_spark", 5, 0.4);
            player.playSound("random.orb");
        } else {
            state.maskedBlocks.add(absKey);
            ConsoleOut.success(player, "Block locked! (Anchor set).");
            // Locking: Red/Angry particles + shield block sound
            ParticleSys.spawnEffect(player.dimension, location, "minecraft:villager_angry", 8, 0.5);
            player.playSound("item.shield.block");
        }
    }

    async applyTweenNudge(player, totalDist, totalFrames, easingType, kinetic = true) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        return await nudgeEngine.applyTweenNudge(player, this, state, totalDist, totalFrames, easingType, kinetic);
    }

    // --- Nudge / Shift Tool ---

    async nudgeBlocks(player, dx, dy, dz, kinetic = false) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        return await nudgeEngine.nudgeBlocks(player.dimension, state, dx, dy, dz, kinetic, player);
    }

    /**
     * Internal simplified nudge for rigged child nodes.
     */
    _nudgeBlocksSimple(dimension, p1, p2, dx, dy, dz) {
        nudgeEngine._nudgeBlocksSimple(dimension, p1, p2, dx, dy, dz);
    }

    // --- Frame Editor ---

    playLivePreview(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state || state.frames.length === 0) {
            ConsoleOut.warn(player, "No frames recorded to preview.");
            return;
        }

        if (state.isProcessingCapture) {
            ConsoleOut.warn(player, "Cannot preview while capturing.");
            return;
        }

        const snapshot = [];
        const dim = player.dimension;
        const minX = Math.min(state.pos1.x, state.pos2.x);
        const minY = Math.min(state.pos1.y, state.pos2.y);
        const minZ = Math.min(state.pos1.z, state.pos2.z);
        const maxX = Math.max(state.pos1.x, state.pos2.x);
        const maxY = Math.max(state.pos1.y, state.pos2.y);
        const maxZ = Math.max(state.pos1.z, state.pos2.z);

        // 1. Snapshot current unsaved physical bounding box
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    try {
                        const block = dim.getBlock({ x, y, z });
                        if (block && block.typeId !== "minecraft:air") {
                            snapshot.push({ x, y, z, perm: block.permutation });
                        }
                    } catch (e) { }
                }
            }
        }

        // 2. Prepare mock animation data for RenderCore
        const animData = {
            frames: state.frames,
            initialOrigin: state.initialOrigin,
            palette: state.palette
        };

        const onFinish = () => {
            // First clear bounds to air
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        try {
                            const block = dim.getBlock({ x, y, z });
                            if (block) block.setPermutation(BlockPermutation.resolve("minecraft:air"));
                        } catch (e) { }
                    }
                }
            }
            // Then restore the saved blocks
            let restored = 0;
            for (const b of snapshot) {
                try {
                    const block = dim.getBlock({ x: b.x, y: b.y, z: b.z });
                    if (block) {
                        block.setPermutation(b.perm);
                        restored++;
                    }
                } catch (e) { }
            }
            ConsoleOut.info(player, `§aLive Preview finished. Restored §b${restored}§a blocks. (Unsaved work preserved!)`);
        };

        player.sendMessage("§e▶️ Playing Live Preview...");
        const speedMult = state.fps / 20;
        renderCore.playRawData(dim, state.pos1, animData, "once", player, "linear", speedMult, null, false, onFinish, "LIVE_PREVIEW");
    }

    overwriteFrame(player, index) {
        const state = this.activeCaptures.get(player.id);
        if (!state || index < 0 || index >= state.frames.length) return;

        const dimension = player.dimension;
        const deltaFrame = {};
        let changedCount = 0;

        // Build a full snapshot of the current world state in the bounds
        const currentFrame = {};
        for (let x = state.pos1.x; x <= state.pos2.x; x++) {
            for (let y = state.pos1.y; y <= state.pos2.y; y++) {
                for (let z = state.pos1.z; z <= state.pos2.z; z++) {
                    const block = dimension.getBlock({ x, y, z });
                    let typeId = block ? block.typeId : "minecraft:air";
                    let states = block ? block.permutation.getAllStates() : {};

                    if (state.filters.has(typeId)) { typeId = "minecraft:air"; states = {}; }

                    let stateStr = "";
                    const keys = Object.keys(states);
                    if (keys.length > 0) {
                        for (const k of keys) stateStr += `${k}=${states[k]},`;
                    }
                    const blockHash = `${typeId}|${stateStr}|${state.activeRole}`;
                    let paletteIdx = state.paletteMap.get(blockHash);
                    if (paletteIdx === undefined) {
                        paletteIdx = state.palette.push({ type: typeId, states, role: state.activeRole }) - 1;
                        state.paletteMap.set(blockHash, paletteIdx);
                    }

                    const relPosKey = MathOps.pack(x - state.pos1.x, y - state.pos1.y, z - state.pos1.z);
                    currentFrame[relPosKey] = paletteIdx;
                }
            }
        }

        // Compute delta against the frame BEFORE the target index
        // For index 0, delta is against empty. For index N, against accumulated state up to N-1.
        // Simplified: store as a full delta from scratch for overwritten frames.
        for (const [key, val] of Object.entries(currentFrame)) {
            deltaFrame[key] = val;
            changedCount++;
        }

        // Preserve metadata from the original frame
        const oldFrame = state.frames[index];
        if (oldFrame.holdTicks) deltaFrame.holdTicks = oldFrame.holdTicks;
        if (oldFrame.commands) deltaFrame.commands = oldFrame.commands;

        state.frames[index] = deltaFrame;
        player.playSound("random.click");
        ConsoleOut.success(player, `§aOverwrote§f frame §e${index + 1}§f with §b${changedCount}§f blocks.`);
    }

    previewFrame(player, index) {
        const state = this.activeCaptures.get(player.id);
        if (!state || index < 0 || index >= state.frames.length) return;

        const dimension = player.dimension;

        // Accumulate the full world state up to the target frame
        const accumulated = {};
        for (let i = 0; i <= index; i++) {
            const frame = state.frames[i];
            for (const [key, val] of Object.entries(frame)) {
                if (key === "offset" || key === "boxSize" || key === "commands" || key === "effects" || key === "holdTicks") continue;
                accumulated[key] = val;
            }
        }

        // Place blocks in-world
        let placed = 0;
        for (const [relPosKey, paletteIdx] of Object.entries(accumulated)) {
            const pos = MathOps.unpack(relPosKey);
            const worldPos = {
                x: state.pos1.x + pos.x,
                y: state.pos1.y + pos.y,
                z: state.pos1.z + pos.z
            };
            const entry = state.palette[paletteIdx];
            if (!entry) continue;
            try {
                const block = dimension.getBlock(worldPos);
                if (block) {
                    block.setPermutation(BlockPermutation.resolve(entry.type, entry.states));
                    placed++;
                }
            } catch (e) {
                // Skip blocks that can't be resolved
            }
        }

        player.playSound("random.orb");
        ConsoleOut.info(player, `§dPreviewing§f frame §e${index + 1}§f (§b${placed}§f blocks placed).`);
    }

    setFrameDelay(player, index, ticks) {
        const state = this.activeCaptures.get(player.id);
        if (!state || index < 0 || index >= state.frames.length) return;
        state.frames[index].holdTicks = ticks;
        ConsoleOut.info(player, `Frame §e${index + 1}§f hold set to §b${ticks}§f ticks.`);
    }

    toggleFilter(player, typeId) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        if (state.filters.has(typeId)) {
            state.filters.delete(typeId);
            ConsoleOut.info(player, `Filter §cremoved§f for §e${typeId}§f.`);
        } else {
            state.filters.add(typeId);
            ConsoleOut.info(player, `Filter §aadded§f for §e${typeId}§f.`);
        }
    }

    // --- Auto-Capture ---

    startAutoCapture(player, mode, threshold) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        autoCaptureEngine.start(player, this, state, mode, threshold);
    }

    async startPhysicsBake(player, totalFrames) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        return await nudgeEngine.startPhysicsBake(player, this, state, totalFrames);
    }

    stopAutoCapture(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        autoCaptureEngine.stop(player, state);
    }

    // --- Global Search & Replace ---

    async globalReplace(player, originalTypeId, replacementTypeId, physicalUpdate = true) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;

        let newPerm;
        if (physicalUpdate) {
            try {
                newPerm = BlockPermutation.resolve(replacementTypeId);
            } catch (e) {
                ConsoleOut.error(player, `Invalid replacement block type: §c${replacementTypeId}§f.`);
                return;
            }

            if (!newPerm) {
                ConsoleOut.error(player, `Invalid replacement block type: §c${replacementTypeId}§f.`);
                return;
            }
        }

        let replacedPalette = 0;
        const searchStr = originalTypeId.replace("minecraft:", "").toLowerCase();

        // 1. Update Internal Historical Palette
        for (const entry of state.palette) {
            if (entry.type.toLowerCase().includes(searchStr)) {
                entry.type = replacementTypeId;
                replacedPalette++;
            }
        }

        if (replacedPalette > 0) {
            state.paletteMap.clear();
            state.palette.forEach((entry, i) => {
                let stateStr = "";
                const keys = Object.keys(entry.states);
                if (keys.length > 0) {
                    for (const k of keys) stateStr += `${k}=${entry.states[k]},`;
                }
                const hash = `${entry.type}|${stateStr}|${entry.role}`;
                state.paletteMap.set(hash, i);
            });
            ConsoleOut.success(player, `Historical palette updated (§e${replacedPalette}§a entries).`);
        }

        // 2. Update Physical World (Staggered) - Only if physicalUpdate is true
        if (physicalUpdate) {
            const dimension = player.dimension;
            const min = {
                x: Math.min(state.pos1.x, state.pos2.x),
                y: Math.min(state.pos1.y, state.pos2.y),
                z: Math.min(state.pos1.z, state.pos2.z)
            };
            const max = {
                x: Math.max(state.pos1.x, state.pos2.x),
                y: Math.max(state.pos1.y, state.pos2.y),
                z: Math.max(state.pos1.z, state.pos2.z)
            };

            const totalBlocks = (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
            if (totalBlocks > 2000) {
                ConsoleOut.info(player, "§eReplacing large area... §7(Staggered processing enabled)");
            }

            let replacedWorld = 0;
            let count = 0;

            for (let x = min.x; x <= max.x; x++) {
                for (let y = min.y; y <= max.y; y++) {
                    for (let z = min.z; z <= max.z; z++) {
                        try {
                            const block = dimension.getBlock({ x, y, z });
                            if (block && block.typeId.toLowerCase().includes(searchStr)) {
                                block.setPermutation(newPerm);
                                replacedWorld++;
                            }
                        } catch (e) { }

                        count++;
                        if (count % 500 === 0) await system.waitTicks(1);
                    }
                }
            }

            if (replacedWorld > 0) {
                ConsoleOut.success(player, `Physically replaced §e${replacedWorld}§a blocks.`);
                this.captureFrame(player, true);
            } else if (replacedPalette === 0) {
                ConsoleOut.warn(player, `No blocks found containing §e${searchStr}§f.`);
            }
        } else if (replacedPalette > 0) {
            // If palette updated but not physical, we should still capture a frame to reflect the palette change
            // and warn the user that the world won't change but the animation will.
            ConsoleOut.info(player, "§7[Sprint 3] Palette update only. Use §bLive Preview§7 to see changes.");
            this.captureFrame(player, true);
        }
    }

    stopRecording(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        console.warn(`[BSM][CaptureCore] stopRecording: name=${state.name}, frames=${state.frames.length}, palette=${state.palette.length}`);

        try {
            state.isRecording = false;
            this.stopAutoCapture(player);
            this.stopHUD(player);

            const animData = SequenceVault.compressAnimation({
                pos1: state.pos1,
                pos2: state.pos2,
                initialOrigin: state.initialOrigin,
                pivot: state.pivot,
                fps: state.fps,
                palette: state.palette,
                frames: state.frames,
                initialSize: state.initialSize
            });

            SequenceVault.saveAnimation(state.name, animData);

            this.activeCaptures.delete(player.id);
            player.playSound("random.levelup");
            player.onScreenDisplay.setActionBar(`Saved Animation: ${state.name}`);
            ConsoleOut.success(player, `Animation §l${state.name}§r saved with §e${state.frames.length}§a frames!`);
            ConsoleOut.log(`Recording stopped and saved: ${state.name}`);
        } catch (e) {
            ConsoleOut.error(player, "Failed to manage animation storage during stop", e);
        }
    }
}

export const captureCore = new CaptureCore();

// --- Event Subscriptions for Live/Quota ---
const handleBlockChange = (player, block) => {
    const state = captureCore.activeCaptures.get(player.id);
    if (!state || !state.isRecording) return;

    const loc = block.location;
    if (loc.x >= state.pos1.x && loc.x <= state.pos2.x &&
        loc.y >= state.pos1.y && loc.y <= state.pos2.y &&
        loc.z >= state.pos1.z && loc.z <= state.pos2.z) {

        autoCaptureEngine.processLive(player, captureCore, state);
        autoCaptureEngine.processQuota(player, captureCore, state);
    }
};

world.afterEvents.playerPlaceBlock.subscribe((ev) => handleBlockChange(ev.player, ev.block));
world.afterEvents.playerBreakBlock.subscribe((ev) => handleBlockChange(ev.player, ev.block));
