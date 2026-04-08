import { world, system } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";

/**
 * SequenceVault handles the low-level data persistence to Dynamic Properties.
 */
export class SequenceVault {
    static SAVE_PREFIX = "bsm_anim_";
    static LEGACY_PREFIX = "kfa_anim_";

    /**
     * Lists all animation IDs saved in the world.
     */
    static listAnimations() {
        try {
            const allProps = world.getDynamicPropertyIds();
            const ids = new Set();
            allProps.forEach(propId => {
                if (propId.startsWith(this.SAVE_PREFIX)) {
                    ids.add(propId.replace(this.SAVE_PREFIX, "").replace("_chunks", ""));
                } else if (propId.startsWith(this.LEGACY_PREFIX)) {
                    ids.add(propId.replace(this.LEGACY_PREFIX, "").replace("_chunks", ""));
                } else if (propId.startsWith("bsm_chunk_") || propId.startsWith("kfa_chunk_")) {
                    const parts = propId.split('_');
                    if (parts.length >= 3) ids.add(parts[2]);
                }
            });
            return Array.from(ids);
        } catch (e) {
            console.error(`[BSM][SequenceVault] listAnimations failed: ${e}`);
            return [];
        }
    }

    /**
     * Saves an animation to the world dynamic properties asynchronously.
     * Prevents watchdog timeouts by yielding the stringification process.
     */
    static save(id, data, player = null) {
        return new Promise((resolve) => {
            if (player) {
                // HUD state is now managed directly in RecordingEngine.stopRecording()
            }

            // We use a custom async stringifier for the frames array (the heavy part)
            // The rest of the metadata is small and can be stringified normally
            const metadata = { ...data };
            delete metadata.frames;
            
            let jsonString = JSON.stringify(metadata);
            jsonString = jsonString.slice(0, -1); // Remove closing brace
            jsonString += ',"frames":[';

            const frames = data.frames || [];
            let frameIdx = 0;
            const KEYFRAME_INTERVAL = 50;
            let currentFullState = {}; 

            const processFrames = () => {
                const startTime = Date.now();
                // Process for up to 2ms per tick to be safe
                while (frameIdx < frames.length && (Date.now() - startTime) < 2) {
                    const frame = frames[frameIdx];
                    
                    // Maintain current full state to enable keyframe snapshots
                    for (const [relPos, pIdx] of Object.entries(frame)) {
                        if (relPos === "commands" || relPos === "offset" || relPos === "boxSize" || relPos === "effects" || relPos === "holdTicks") continue;
                        currentFullState[relPos] = pIdx;
                    }

                    let frameToSave = frame;
                    if (frameIdx > 0 && frameIdx % KEYFRAME_INTERVAL === 0) {
                        // Inject full snapshot
                        frameToSave = { ...frame, ...currentFullState, isKeyframe: true };
                    }

                    const frameStr = JSON.stringify(frameToSave);
                    jsonString += (frameIdx === 0 ? '' : ',') + frameStr;
                    frameIdx++;
                }

                if (frameIdx < frames.length) {
                    system.run(processFrames); // Yield to next tick
                } else {
                    jsonString += ']}'; // Close frames array and root object
                    this._finalizeSave(id, jsonString, player, resolve);
                }
            };

            if (frames.length > 0) {
                system.run(processFrames);
            } else {
                jsonString += ']}';
                this._finalizeSave(id, jsonString, player, resolve);
            }
        });
    }

    static _finalizeSave(id, serialized, player, resolve) {
        try {
            const CHUNK_SIZE = 30000;
            const tempKey = `bsm_temp_${id}`;

            // Phase 1: Write to Temporary Namespace
            let chunks = 1;
            if (serialized.length <= CHUNK_SIZE) {
                world.setDynamicProperty(tempKey, serialized);
            } else {
                chunks = Math.ceil(serialized.length / CHUNK_SIZE);
                for (let i = 0; i < chunks; i++) {
                    const chunk = serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                    world.setDynamicProperty(`bsm_temp_chunk_${id}_${i}`, chunk);
                }
                world.setDynamicProperty(`${tempKey}_chunks`, chunks);
            }

            // Phase 1.5: Verification (Read-Back)
            let verifiedSize = 0;
            if (chunks === 1) {
                const check = world.getDynamicProperty(tempKey);
                if (check) verifiedSize = check.length;
            } else {
                for (let i = 0; i < chunks; i++) {
                    const check = world.getDynamicProperty(`bsm_temp_chunk_${id}_${i}`);
                    if (check) verifiedSize += check.length;
                    else { verifiedSize = -1; break; }
                }
            }

            if (verifiedSize !== serialized.length) {
                Logger.error(player, `Save verification FAILED (Size mismatch: ${verifiedSize} vs ${serialized.length}). Aborting pointer swap.`);
                return resolve(false);
            }

            // Phase 2: Atomic Commit (Update main pointer and cleanup old)
            this.delete(id); // Clean up current live data

            const key = this.SAVE_PREFIX + id;
            if (chunks === 1) {
                world.setDynamicProperty(key, serialized);
                world.setDynamicProperty(tempKey, undefined);
            } else {
                for (let i = 0; i < chunks; i++) {
                    const chunk = world.getDynamicProperty(`bsm_temp_chunk_${id}_${i}`);
                    world.setDynamicProperty(`bsm_chunk_${id}_${i}`, chunk);
                    world.setDynamicProperty(`bsm_temp_chunk_${id}_${i}`, undefined);
                }
                world.setDynamicProperty(`${key}_chunks`, chunks);
                world.setDynamicProperty(`${tempKey}_chunks`, undefined);
            }
            
            Logger.log(`[BSM][SequenceVault] Async save complete for '${id}'. Total Bytes: ${serialized.length}`);
            
            if (player) {
                // HUD state cleared in RecordingEngine.stopRecording()
            }
            resolve(true);
        } catch (e) {
            console.error(`[BSM][SequenceVault] save failed for '${id}': ${e}`);
            if (player) {
                // HUD state cleared in RecordingEngine.stopRecording()
            }
            resolve(false);
        }
    }

    /**
     * Loads an animation from the world dynamic properties.
     */
    static load(id) {
        try {
            let key = this.SAVE_PREFIX + id;
            let data = world.getDynamicProperty(key);

            if (!data) {
                const chunks = world.getDynamicProperty(`${key}_chunks`);
                if (chunks !== undefined) {
                    let fullString = "";
                    for (let i = 0; i < chunks; i++) {
                        const chunk = world.getDynamicProperty(`bsm_chunk_${id}_${i}`);
                        if (chunk) fullString += chunk;
                    }
                    return JSON.parse(fullString);
                }
            }

            // Legacy Fallback
            if (!data) {
                key = this.LEGACY_PREFIX + id;
                data = world.getDynamicProperty(key);
                if (!data) {
                    const chunks = world.getDynamicProperty(`${key}_chunks`);
                    if (chunks !== undefined) {
                        let fullString = "";
                        for (let i = 0; i < chunks; i++) {
                            const chunk = world.getDynamicProperty(`kfa_chunk_${id}_${i}`);
                            if (chunk) fullString += chunk;
                        }
                        return JSON.parse(fullString);
                    }
                }
            }

            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error(`[BSM][SequenceVault] load failed for '${id}': ${e}`);
            return null;
        }
    }

    /**
     * Deletes an animation and all its chunks.
     */
    static delete(id) {
        try {
            const bsmKey = this.SAVE_PREFIX + id;
            world.setDynamicProperty(bsmKey, undefined);
            const bsmChunks = world.getDynamicProperty(`${bsmKey}_chunks`);
            if (bsmChunks !== undefined) {
                for (let i = 0; i < bsmChunks; i++) world.setDynamicProperty(`bsm_chunk_${id}_${i}`, undefined);
                world.setDynamicProperty(`${bsmKey}_chunks`, undefined);
            }

            const kfaKey = this.LEGACY_PREFIX + id;
            world.setDynamicProperty(kfaKey, undefined);
            const kfaChunks = world.getDynamicProperty(`${kfaKey}_chunks`);
            if (kfaChunks !== undefined) {
                for (let i = 0; i < kfaChunks; i++) world.setDynamicProperty(`kfa_chunk_${id}_${i}`, undefined);
                world.setDynamicProperty(`${kfaKey}_chunks`, undefined);
            }
            return true;
        } catch (e) { return false; }
    }

    // --- Scene Storage ---

    static saveScene(id, data) {
        const key = `bsm_scene:${id}`;
        world.setDynamicProperty(key, JSON.stringify(data));
    }

    static loadScene(id) {
        const key = `bsm_scene:${id}`;
        const raw = world.getDynamicProperty(key);
        if (!raw) return null;
        return JSON.parse(raw);
    }

    static deleteScene(id) {
        const key = `bsm_scene:${id}`;
        world.setDynamicProperty(key, undefined);
    }

    static getAllSceneIds() {
        return world.getDynamicPropertyIds()
            .filter(id => id.startsWith("bsm_scene:"))
            .map(id => id.replace("bsm_scene:", ""));
    }
}
