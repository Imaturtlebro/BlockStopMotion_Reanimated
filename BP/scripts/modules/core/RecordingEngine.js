import { world, system, BlockPermutation } from "@minecraft/server";
import { rigManager } from "../ui/RigManager.js";
import { renderCore } from "./RenderCore.js";
import { SequenceVault } from "./SequenceVault.js";
import { RegionHighlighter } from "../utils/RegionHighlighter.js";
import { Logger } from "../utils/Logger.js";
import { phantomRenderer } from "../ui/PhantomRenderer.js";
import { MathOps } from "../utils/MathOps.js";
import { actionLog } from "../utils/ActionLog.js";
import { SafetyChecks } from "../utils/SafetyChecks.js";
import { ParticleSys } from "../utils/ParticleSys.js";
import { nudgeEngine } from "./NudgeEngine.js";
import { autoCaptureEngine } from "./AutoCaptureEngine.js";
import { NetworkManager } from "../utils/NetworkManager.js";

/**
 * RecordingEngine handles the core logic for capturing and managing stop-motion sequences.
 */
export class RecordingEngine {
    constructor() {
        this.activeCaptures = new Map(); // PlayerId -> RecordingState
    }

    startRecording(player, name, pos1, pos2, fps = 5) {
        if (!SafetyChecks.isReasonableBounds(pos1, pos2, 256)) {
            Logger.error(player, "Recording area too large! Maximum 256 blocks on any axis.");
            return;
        }

        try {
            const state = {
                name: name,
                pos1: { x: Math.floor(Math.min(pos1.x, pos2.x)), y: Math.floor(Math.min(pos1.y, pos2.y)), z: Math.floor(Math.min(pos1.z, pos2.z)) },
                pos2: { x: Math.floor(Math.max(pos1.x, pos2.x)), y: Math.floor(Math.max(pos1.y, pos2.y)), z: Math.floor(Math.max(pos1.z, pos2.z)) },
                initialOrigin: null,
                initialSize: null,
                frames: [],
                palette: [],
                paletteMap: new Map(),
                frameHistory: [],
                lastFrame: null,
                isRecording: true,
                activeRole: "normal",
                onionskin: false,
                pivot: { x: 0, y: 0, z: 0 },
                pendingCommands: [],
                filters: new Set(["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"]),
                redoStack: [],
                showTrails: false,
                trailParticles: [],
                maskedBlocks: new Set(),
                fps: fps,
                autoCapture: { mode: "NONE", threshold: 0, counter: 0, taskId: null },
                showHUD: true,
                nudgeKinetic: false
            };

            state.initialOrigin = { ...state.pos1 };
            state.initialSize = {
                x: state.pos2.x - state.pos1.x + 1,
                y: state.pos2.y - state.pos1.y + 1,
                z: state.pos2.z - state.pos1.z + 1
            };

            this.activeCaptures.set(player.id, state);
            Logger.info(player, `Started recording ${"\u00a7l"}${name}${"\u00a7r"}`);
            console.warn(`[BSM][RecordingEngine] startRecording: name=${name}, p1=${state.pos1.x},${state.pos1.y},${state.pos1.z}, pivot=${state.pivot.x},${state.pivot.y},${state.pivot.z}`);
            
            // Critical: Ensure initial frame (Keyframe) is captured immediately
            this.captureFrame(player, true);
        } catch (e) {
            Logger.error(player, "Failed to start recording", e);
        }
    }

    captureFrame(player, force = false) {
        const state = this.activeCaptures.get(player.id);
        if (!state || !state.isRecording) return;

        try {
            const dimension = player.dimension;
            const size = {
                x: state.pos2.x - state.pos1.x + 1,
                y: state.pos2.y - state.pos1.y + 1,
                z: state.pos2.z - state.pos1.z + 1
            };
            const volume = size.x * size.y * size.z;
            const MAX_BATCH_VOLUME = 4096;

            if (volume <= MAX_BATCH_VOLUME) {
                this._processFrameCapture(player, state, dimension, state.pos1, state.pos2, force);
            } else {
                this._processStaggeredCapture(player, state, dimension, force);
            }
        } catch (e) {
            Logger.error(player, "Error during capture", e);
            console.error(`[BSM][RecordingEngine] Error in captureFrame for ${player.name}: ${e}, ${e.stack}`);
        }
    }

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
                        if (lastPaletteIdx !== undefined) currentFrame[relPosKey] = lastPaletteIdx;
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
            }
        }
        this._finalizeFrame(player, state, currentFrame, deltaFrame, changedCount, force);
    }

    _processStaggeredCapture(player, state, dimension, force) {
        if (state.isProcessingCapture) return;
        state.isProcessingCapture = true;

        const currentFrame = {};
        const deltaFrame = {};
        let changedCount = 0;
        const min = state.pos1;
        const max = state.pos2;
        const size = { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 };
        const totalVolume = size.x * size.y * size.z;
        let currentIndex = 0;
        const BATCH_SIZE = 8000;

        const runSlice = () => {
            const tStart = Date.now();
            const batchLimit = Math.min(currentIndex + BATCH_SIZE, totalVolume);
            for (let i = currentIndex; i < batchLimit; i++) {
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
                    if (lastPaletteIdx !== undefined) currentFrame[relPosKey] = lastPaletteIdx;
                    continue;
                }

                const block = dimension.getBlock({ x, y, z });
                let typeId = block ? block.typeId : "minecraft:air";
                let states = block ? block.permutation.getAllStates() : {};
                if (state.filters.has(typeId)) { typeId = "minecraft:air"; states = {}; }

                let stateStr = "";
                const keys = Object.keys(states);
                if (keys.length > 0) for (const k of keys) stateStr += `${k}=${states[k]},`;
                const blockHash = `${typeId}|${stateStr}|${state.activeRole}`;
                let paletteIdx = state.paletteMap.get(blockHash);
                if (paletteIdx === undefined) {
                    paletteIdx = state.palette.push({ type: typeId, states, role: state.activeRole }) - 1;
                    state.paletteMap.set(blockHash, paletteIdx);
                }
                
                const lastPaletteIdx = state.lastFrame ? state.lastFrame[relPosKey] : undefined;

                // --- Transparency Mask Logic ---
                if (typeId === "minecraft:air") {
                    let wasSolid = false;
                    if (lastPaletteIdx !== undefined) {
                        const lastPData = state.palette[lastPaletteIdx];
                        if (lastPData && lastPData.type !== "minecraft:air") {
                            wasSolid = true;
                        }
                    }
                    if (!wasSolid) {
                        // Inherit from last frame if needed, but don't track as a delta change
                        if (lastPaletteIdx !== undefined) currentFrame[relPosKey] = lastPaletteIdx;
                        continue;
                    }
                }

                currentFrame[relPosKey] = paletteIdx;
                if (lastPaletteIdx !== paletteIdx) { deltaFrame[relPosKey] = paletteIdx; changedCount++; }
            }
            
            Logger.telemetry("RecordingEngine", `Captured batch [${currentIndex} -> ${batchLimit}]`, Date.now() - tStart);
            currentIndex = batchLimit;
            if (currentIndex < totalVolume) {
                if (!SafetyChecks.isValid(player)) { state.isProcessingCapture = false; return; }
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
        const offset = { x: state.pos1.x - state.initialOrigin.x, y: state.pos1.y - state.initialOrigin.y, z: state.pos1.z - state.initialOrigin.z };
        if (offset.x !== 0 || offset.y !== 0 || offset.z !== 0) deltaFrame.offset = offset;

        const currentSize = { x: state.pos2.x - state.pos1.x + 1, y: state.pos2.y - state.pos1.y + 1, z: state.pos2.z - state.pos1.z + 1 };
        if (state.initialSize && (currentSize.x !== state.initialSize.x || currentSize.y !== state.initialSize.y || currentSize.z !== state.initialSize.z)) {
            deltaFrame.boxSize = currentSize;
        }

        const hasBlockChanges = changedCount > 0;
        const hasCommands = state.pendingCommands && state.pendingCommands.length > 0;

        if (hasBlockChanges || deltaFrame.offset || deltaFrame.boxSize || hasCommands || force) {
            if (hasCommands) { deltaFrame.commands = [...state.pendingCommands]; state.pendingCommands = []; }
            state.frames.push(deltaFrame);
            state.lastFrame = currentFrame;
            state.redoStack = [];
            
            player.playSound("camera.take_picture", { pitch: 1.0, volume: 1.0 });
            player.playSound("random.orb", { pitch: 2.0, volume: 0.5 });
            player.onScreenDisplay.setTitle(" ", { subtitle: "§b📸 Frame Captured!", fadeInDuration: 0, stayDuration: 10, fadeOutDuration: 10 });
            
            ParticleSys.onCapture(player.dimension, player.location);
            Logger.actionBar(player, `§bCaptured Frame §e${state.frames.length}§r | Changes: §b${changedCount}`);
            
            if (state.onionskin) {
                const past = state.frames.slice(-3).reverse();
                phantomRenderer.previewFrame(player, past, [], state.pos1, state.palette);
            }
        }
    }

    updateBounds(player, pos1, pos2) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;

        const newPos1 = { x: Math.floor(Math.min(pos1.x, pos2.x)), y: Math.floor(Math.min(pos1.y, pos2.y)), z: Math.floor(Math.min(pos1.z, pos2.z)) };
        const newPos2 = { x: Math.floor(Math.max(pos1.x, pos2.x)), y: Math.floor(Math.max(pos1.y, pos2.y)), z: Math.floor(Math.max(pos1.z, pos2.z)) };

        if (!SafetyChecks.isReasonableBounds(newPos1, newPos2, 256)) {
            Logger.error(player, "New bounds are too large! Move cancelled.");
            return;
        }

        state.pos1 = newPos1;
        state.pos2 = newPos2;
        Logger.info(player, `Recording bounds moved to: §e${state.pos1.x},${state.pos1.y},${state.pos1.z}§r`);
        RegionHighlighter.drawBox(player.dimension, state.pos1, state.pos2, "minecraft:end_rod", 100);
    }

    undoFrame(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state || !state.isRecording || state.frames.length <= 1) return;
        
        const frame = state.frames.pop();
        state.redoStack.push({ frame, history: state.lastFrame });
        state.lastFrame = state.frameHistory.pop();
        player.playSound("random.pop");
        Logger.actionBar(player, `§cUndo: Frame ${state.frames.length + 1} removed`);
    }

    redoFrame(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state || !state.isRecording || state.redoStack.length === 0) return;

        const { frame, history } = state.redoStack.pop();
        state.frameHistory.push(state.lastFrame);
        state.frames.push(frame);
        state.lastFrame = history;
        Logger.actionBar(player, `§aRedo§f: Restored §lFrame ${state.frames.length}§r`);
    }

    nudgeBlocks(player, dx, dy, dz, kinetic = false) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        return nudgeEngine.nudgeBlocks(player.dimension, state, dx, dy, dz, kinetic, player);
    }

    toggleMask(player, location) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        const absKey = `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
        if (state.maskedBlocks.has(absKey)) {
            state.maskedBlocks.delete(absKey);
            Logger.actionBar(player, "§aBlock unlocked.");
        } else {
            state.maskedBlocks.add(absKey);
            Logger.actionBar(player, "§cBlock locked!");
        }
    }

    async stopRecording(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        state.isRecording = false;
        const animData = {
            pos1: state.pos1,
            pos2: state.pos2,
            initialOrigin: state.initialOrigin,
            pivot: state.pivot,
            fps: state.fps,
            palette: state.palette,
            frames: state.frames,
            initialSize: state.initialSize,
            cameraMarkers: state.cameraMarkers
        };
        
        // Yielding async save
        state.isProcessingCapture = true;
        player.onScreenDisplay.setTitle(" ", { subtitle: "§c[SAVING DATA - DO NOT EXIT]", fadeInDuration: 0, stayDuration: 60, fadeOutDuration: 10 });
        
        const success = await SequenceVault.save(state.name, animData, player);
        
        if (success) {
            player.playSound("random.levelup");
            Logger.success(player, `Animation §l${state.name}§r saved!`);
        } else {
            Logger.error(player, `Failed to save ${state.name}. Check Content Log.`);
        }

        this.activeCaptures.delete(player.id);
    }

    /**
     * Plays a live preview of the current recording using RenderCore.
     * Uses the in-memory frames without saving first.
     */
    playLivePreview(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state || state.frames.length === 0) {
            Logger.warn(player, "No frames to preview.");
            return;
        }

        const animData = {
            pos1: state.pos1,
            pos2: state.pos2,
            initialOrigin: state.initialOrigin,
            pivot: state.pivot,
            fps: state.fps,
            palette: state.palette,
            frames: state.frames,
            initialSize: state.initialSize
        };

        renderCore.playRawData(
            player.dimension,
            null, // NULL means "play at recorded location"
            animData,
            "once",
            player
        );
        Logger.info(player, "Playing live preview... §7(Syncing to recorded origin)");
        // Draw the capture origin as a visual reference
        RegionHighlighter.drawPivot(player.dimension, state.pos1, 100);
    }

    /**
     * Duplicates an existing frame at the given index.
     */
    duplicateFrame(player, index) {
        const state = this.activeCaptures.get(player.id);
        if (!state || index < 0 || index >= state.frames.length) return;

        const copy = JSON.parse(JSON.stringify(state.frames[index]));
        state.frames.splice(index + 1, 0, copy);
        Logger.actionBar(player, `§bDuplicated frame ${index + 1}. Total: ${state.frames.length}`);
    }

    /**
     * Starts auto-capture via the AutoCaptureEngine.
     */
    startAutoCapture(player, mode, threshold) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        autoCaptureEngine.start(player, this, state, mode, threshold);
    }

    /**
     * Stops auto-capture via the AutoCaptureEngine.
     */
    stopAutoCapture(player) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        autoCaptureEngine.stop(player, state);
    }

    /**
     * Performs a global block type replacement across the active recording's palette
     * and physically updates the blocks in-world.
     */
    globalReplace(player, oldTypeId, newTypeId) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;

        let replaced = 0;
        for (const entry of state.palette) {
            if (entry.type.includes(oldTypeId)) {
                entry.type = newTypeId;
                replaced++;
            }
        }

        if (replaced > 0) {
            // Update physical blocks in-world
            const dim = player.dimension;
            for (let x = state.pos1.x; x <= state.pos2.x; x++) {
                for (let y = state.pos1.y; y <= state.pos2.y; y++) {
                    for (let z = state.pos1.z; z <= state.pos2.z; z++) {
                        try {
                            const block = dim.getBlock({ x, y, z });
                            if (block && block.typeId.includes(oldTypeId)) {
                                block.setPermutation(BlockPermutation.resolve(newTypeId));
                            }
                        } catch (e) {
                            console.warn(`[BSM][RecordingEngine] Failed to replace block at ${x},${y},${z}: ${e}`);
                        }
                    }
                }
            }
            Logger.success(player, `Replaced ${replaced} palette entries matching "${oldTypeId}" with "${newTypeId}".`);
        } else {
            Logger.warn(player, `No palette entries found matching "${oldTypeId}".`);
        }
    }

    /**
     * Sets the active role tag for future captures.
     */
    setActiveRole(player, role) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        state.activeRole = role;
        Logger.info(player, `Active role set to: §d${role}`);
    }

    /**
     * Sets the pivot offset for the active recording.
     */
    setPivot(player, pivot) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        state.pivot = pivot;
        Logger.info(player, `Pivot set to: §e${pivot.x}, ${pivot.y}, ${pivot.z}`);
    }

    /**
     * Toggles a block type in the capture filter set.
     */
    toggleFilter(player, typeId) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        if (state.filters.has(typeId)) {
            state.filters.delete(typeId);
            Logger.info(player, `Removed filter: §e${typeId}`);
        } else {
            state.filters.add(typeId);
            Logger.info(player, `Added filter: §e${typeId}`);
        }
    }

    /**
     * Applies a positional offset to ALL previously captured frames.
     */
    batchOffset(player, offset) {
        const state = this.activeCaptures.get(player.id);
        if (!state || state.frames.length === 0) {
            Logger.warn(player, "No frames to offset.");
            return;
        }
        for (const frame of state.frames) {
            const existing = frame.offset || { x: 0, y: 0, z: 0 };
            frame.offset = {
                x: existing.x + offset.x,
                y: existing.y + offset.y,
                z: existing.z + offset.z
            };
        }
        Logger.success(player, `Applied offset (${offset.x}, ${offset.y}, ${offset.z}) to §e${state.frames.length}§f frames.`);
    }

    /**
     * Delegates tween nudge to NudgeEngine.
     */
    applyTweenNudge(player, dist, frames, easing, kinetic) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        nudgeEngine.applyTweenNudge(player, this, state, dist, frames, easing, kinetic);
    }

    /**
     * Delegates physics bake to NudgeEngine.
     */
    startPhysicsBake(player, totalFrames) {
        const state = this.activeCaptures.get(player.id);
        if (!state) return;
        nudgeEngine.startPhysicsBake(player, this, state, totalFrames);
    }

    /**
     * Exports the current recording data to a local web server via HTTP.
     */
    async exportToNetwork(player, url = "http://localhost:3000/export") {
        const state = this.activeCaptures.get(player.id);
        if (!state) {
            Logger.warn(player, "No active recording to export.");
            return;
        }

        const animData = {
            name: state.name,
            pos1: state.pos1,
            pos2: state.pos2,
            initialOrigin: state.initialOrigin,
            pivot: state.pivot,
            fps: state.fps,
            palette: state.palette,
            frames: state.frames,
            initialSize: state.initialSize
        };

        Logger.info(player, `Exporting to §e${url}§f...`);
        const result = await NetworkManager.exportData(url, animData);

        if (result.success) {
            Logger.success(player, result.message);
        } else {
            Logger.error(player, result.message);
        }
    }
}

export const recordingEngine = new RecordingEngine();
