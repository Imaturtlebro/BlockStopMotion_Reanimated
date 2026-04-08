import { world } from "@minecraft/server";
import { ConsoleOut } from "./ConsoleOut.js";

export class SequenceVault {
    static SAVE_PREFIX = "bsm_anim_"; // Standardized to BSM
    static LEGACY_PREFIX = "kfa_anim_";

    /**
     * Lists all animation IDs saved in the world.
     */
    static listAnimations() {
        console.warn(`[BSM][SequenceVault] listAnimations: Scanning dynamic properties...`);
        try {
            const allProps = world.getDynamicPropertyIds();
            const ids = new Set();

            allProps.forEach(propId => {
                // Check current prefix
                if (propId.startsWith(this.SAVE_PREFIX)) {
                    let name = propId.replace(this.SAVE_PREFIX, "");
                    name = name.replace("_chunks", "");
                    ids.add(name);
                } 
                // Check legacy prefix
                else if (propId.startsWith(this.LEGACY_PREFIX)) {
                    let name = propId.replace(this.LEGACY_PREFIX, "");
                    name = name.replace("_chunks", "");
                    ids.add(name);
                }
                // Check chunk format
                else if (propId.startsWith("bsm_chunk_")) {
                    const parts = propId.split('_');
                    if (parts.length >= 3) ids.add(parts[2]);
                }
                // Check legacy chunk format
                else if (propId.startsWith("kfa_chunk_")) {
                    const parts = propId.split('_');
                    if (parts.length >= 3) ids.add(parts[2]);
                }
            });

            const animList = Array.from(ids);
            console.warn(`[BSM][SequenceVault] listAnimations: Found ${animList.length} animations: [${animList.join(", ")}]`);
            return animList;
        } catch (e) {
            console.error(`[BSM][Error][SequenceVault] listAnimations failed: ${e}\n${e.stack}`);
            return [];
        }
    }

    /**
     * Saves an animation to the world dynamic properties.
     */
    static saveAnimation(id, data) {
        console.warn(`[BSM][SequenceVault] saveAnimation: Saving '${id}'...`);
        try {
            if (!id || !data) throw new Error("Invalid save parameters: id or data missing.");

            const serialized = JSON.stringify(data);
            const CHUNK_SIZE = 30000;
            const TOTAL_LIMIT = 1000000;
            const key = this.SAVE_PREFIX + id;

            console.warn(`[BSM][SequenceVault] '${id}' size: ${serialized.length} bytes.`);

            if (serialized.length > 200000) {
                console.warn(`[BSM][Warning] Animation '${id}' is large (${Math.round(serialized.length / 1024)}KB).`);
            }

            // Clean up old data/chunks (both prefixes)
            this.deleteAnimation(id);

            if (serialized.length <= CHUNK_SIZE) {
                world.setDynamicProperty(key, serialized);
                console.warn(`[BSM][SequenceVault] Saved '${id}' as single property.`);
            } else {
                const chunks = Math.ceil(serialized.length / CHUNK_SIZE);
                console.warn(`[BSM][SequenceVault] Partitioning '${id}' into ${chunks} chunks.`);
                for (let i = 0; i < chunks; i++) {
                    const chunk = serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                    world.setDynamicProperty(`bsm_chunk_${id}_${i}`, chunk);
                }
                world.setDynamicProperty(`${key}_chunks`, chunks);
            }

            ConsoleOut.log(`Saved animation '${id}' (${serialized.length} bytes)`);
            return true;
        } catch (e) {
            console.error(`[BSM][Error][SequenceVault] saveAnimation failed for '${id}': ${e}\n${e.stack}`);
            if (e.toString().includes("size") || e.toString().includes("limit")) {
                ConsoleOut.error(null, `§lSTORAGE FULL!§r Failed to save '${id}'.\nWorld limit reached.`);
            } else {
                ConsoleOut.error(null, `Failed to save animation '${id}'`, e);
            }
            return false;
        }
    }

    /**
     * Loads an animation from the world dynamic properties.
     */
    static loadAnimation(id) {
        console.warn(`[BSM][SequenceVault] loadAnimation: Attempting to load '${id}'...`);
        try {
            // Check BSM prefix first
            let key = this.SAVE_PREFIX + id;
            let data = world.getDynamicProperty(key);

            // Check BSM chunks
            if (!data) {
                const chunks = world.getDynamicProperty(`${key}_chunks`);
                if (chunks !== undefined) {
                    console.warn(`[BSM][SequenceVault] Loading '${id}' from ${chunks} BSM chunks.`);
                    let fullString = "";
                    for (let i = 0; i < chunks; i++) {
                        const chunk = world.getDynamicProperty(`bsm_chunk_${id}_${i}`);
                        if (chunk) fullString += chunk;
                    }
                    return JSON.parse(fullString);
                }
            }

            // Fallback to Legacy (KFA) prefix
            if (!data) {
                console.warn(`[BSM][SequenceVault] '${id}' not found in BSM storage. Checking legacy (KFA) storage...`);
                key = this.LEGACY_PREFIX + id;
                data = world.getDynamicProperty(key);
                
                if (!data) {
                    const chunks = world.getDynamicProperty(`${key}_chunks`);
                    if (chunks !== undefined) {
                        console.warn(`[BSM][SequenceVault] Loading '${id}' from ${chunks} legacy chunks.`);
                        let fullString = "";
                        for (let i = 0; i < chunks; i++) {
                            const chunk = world.getDynamicProperty(`kfa_chunk_${id}_${i}`);
                            if (chunk) fullString += chunk;
                        }
                        return JSON.parse(fullString);
                    }
                }
            }

            if (data) {
                console.warn(`[BSM][SequenceVault] Successfully loaded '${id}'.`);
                return JSON.parse(data);
            }

            console.warn(`[BSM][SequenceVault] No data found for '${id}'.`);
            return null;
        } catch (e) {
            console.error(`[BSM][Error][SequenceVault] loadAnimation failed for '${id}': ${e}\n${e.stack}`);
            return null;
        }
    }

    /**
     * Completely deletes an animation and all its chunks (including legacy).
     */
    static deleteAnimation(id) {
        console.warn(`[BSM][SequenceVault] deleteAnimation: Deleting '${id}' (BSM & Legacy)...`);
        try {
            // Delete BSM
            const bsmKey = this.SAVE_PREFIX + id;
            world.setDynamicProperty(bsmKey, undefined);
            const bsmChunks = world.getDynamicProperty(`${bsmKey}_chunks`);
            if (bsmChunks !== undefined) {
                for (let i = 0; i < bsmChunks; i++) {
                    world.setDynamicProperty(`bsm_chunk_${id}_${i}`, undefined);
                }
                world.setDynamicProperty(`${bsmKey}_chunks`, undefined);
            }

            // Delete Legacy
            const kfaKey = this.LEGACY_PREFIX + id;
            world.setDynamicProperty(kfaKey, undefined);
            const kfaChunks = world.getDynamicProperty(`${kfaKey}_chunks`);
            if (kfaChunks !== undefined) {
                for (let i = 0; i < kfaChunks; i++) {
                    world.setDynamicProperty(`kfa_chunk_${id}_${i}`, undefined);
                }
                world.setDynamicProperty(`${kfaKey}_chunks`, undefined);
            }

            return true;
        } catch (e) {
            console.error(`[BSM][Error][SequenceVault] deleteAnimation failed for '${id}': ${e}\n${e.stack}`);
            return false;
        }
    }

    static duplicateAnimation(id, newId) {
        const data = this.loadAnimation(id);
        if (data) return this.saveAnimation(newId, data);
        return false;
    }

    static renameAnimation(oldId, newId) {
        if (this.duplicateAnimation(oldId, newId)) {
            return this.deleteAnimation(oldId);
        }
        return false;
    }

    /**
     * Scans dynamic properties and deletes orphaned chunks or malformed keys.
     */
    static cleanupCorruptedData(player) {
        console.warn(`[BSM][SequenceVault] cleanupCorruptedData: Scanning for orphans...`);
        try {
            let deletedKeys = 0;
            const validAnimIds = new Set(this.listAnimations());
            const allProps = world.getDynamicPropertyIds();

            allProps.forEach(propId => {
                // Check if it's a chunk
                if (propId.startsWith("bsm_chunk_") || propId.startsWith("kfa_chunk_")) {
                    const parts = propId.split('_');
                    if (parts.length >= 3) {
                        const animId = parts[2];
                        if (!validAnimIds.has(animId)) {
                            world.setDynamicProperty(propId, undefined);
                            deletedKeys++;
                        }
                    }
                }
            });

            if (deletedKeys > 0) {
                ConsoleOut.success(player, `§aCleanup Complete!§r Removed §b${deletedKeys}§r orphaned keys.`);
                console.warn(`[BSM][SequenceVault] Cleanup: Removed ${deletedKeys} orphaned keys.`);
            } else {
                ConsoleOut.success(player, "§aCleanup Complete.§r No orphaned data found.");
            }
        } catch (e) {
            console.error(`[BSM][Error][SequenceVault] cleanupCorruptedData failed: ${e}\n${e.stack}`);
        }
    }

    static compressAnimation(data) {
        if (!data || !data.frames) return data;
        const accumulatedState = new Map();
        const newFrames = [];
        for (const frame of data.frames) {
            const newFrame = {};
            if (frame.offset) newFrame.offset = frame.offset;
            if (frame.boxSize) newFrame.boxSize = frame.boxSize;
            if (frame.commands) newFrame.commands = frame.commands;
            if (frame.effects) newFrame.effects = frame.effects;
            for (const [posKey, paletteIdx] of Object.entries(frame)) {
                if (["offset", "boxSize", "commands", "effects"].includes(posKey)) continue;
                if (accumulatedState.get(posKey) !== paletteIdx) {
                    newFrame[posKey] = paletteIdx;
                    accumulatedState.set(posKey, paletteIdx);
                }
            }
            newFrames.push(newFrame);
        }
        return { ...data, frames: newFrames };
    }
}
