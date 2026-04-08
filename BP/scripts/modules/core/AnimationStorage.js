import { SequenceVault } from "./SequenceVault.js";
import { Logger } from "../utils/Logger.js";

/**
 * AnimationStorage handles high-level animation sequence management and data cleanup.
 */
export class AnimationStorage {
    static list() {
        return SequenceVault.listAnimations();
    }

    static save(id, data) {
        const compressed = this.compress(data);
        return SequenceVault.save(id, compressed);
    }

    static load(id) {
        return SequenceVault.load(id);
    }

    static delete(id, player = null) {
        const success = SequenceVault.delete(id);
        if (success && player) Logger.success(player, `Deleted animation: §e${id}`);
        return success;
    }

    static duplicate(id, newId) {
        const data = this.load(id);
        if (data) return this.save(newId, data);
        return false;
    }

    /**
     * Delta-state compression to reduce storage size.
     */
    static compress(data) {
        if (!data || !data.frames) return data;
        const accumulatedState = new Map();
        const newFrames = [];

        for (const frame of data.frames) {
            const newFrame = {};
            // Copy metadata keys
            const metaKeys = ["offset", "boxSize", "commands", "effects", "holdTicks"];
            metaKeys.forEach(k => { if (frame[k] !== undefined) newFrame[k] = frame[k]; });

            for (const [posKey, paletteIdx] of Object.entries(frame)) {
                if (metaKeys.includes(posKey)) continue;
                if (accumulatedState.get(posKey) !== paletteIdx) {
                    newFrame[posKey] = paletteIdx;
                    accumulatedState.set(posKey, paletteIdx);
                }
            }
            newFrames.push(newFrame);
        }
        return { ...data, frames: newFrames };
    }

    /**
     * Garbage collection for orphaned data chunks.
     */
    static cleanup(player) {
        Logger.log("Starting data cleanup...");
        try {
            const validIds = new Set(this.list());
            const allProps = world.getDynamicPropertyIds();
            let count = 0;

            allProps.forEach(propId => {
                if (propId.startsWith("bsm_chunk_") || propId.startsWith("kfa_chunk_")) {
                    const parts = propId.split('_');
                    if (parts.length >= 3 && !validIds.has(parts[2])) {
                        world.setDynamicProperty(propId, undefined);
                        count++;
                    }
                }
            });
            if (player) Logger.success(player, `Cleanup complete. Removed §b${count}§r orphaned keys.`);
        } catch (e) {
            if (player) Logger.error(player, `Cleanup failed: ${e}`);
        }
    }
}
