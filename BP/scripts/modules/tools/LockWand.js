import { world, system } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";
import { ParticleSys } from "../utils/ParticleSys.js";

/**
 * LockWand handles the coordinate-locking (Anchor Masking) logic.
 */
export class LockWand {
    constructor(recordingEngine) {
        this.recordingEngine = recordingEngine;
    }

    /**
     * Toggles a block's locked state.
     */
    toggleMask(player, location) {
        const state = this.recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        // Ensure within bounds
        if (location.x < state.pos1.x || location.x > state.pos2.x ||
            location.y < state.pos1.y || location.y > state.pos2.y ||
            location.z < state.pos1.z || location.z > state.pos2.z) {
            Logger.warn(player, "Cannot lock block outside recording bounds.");
            return;
        }

        const absKey = `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
        if (state.maskedBlocks.has(absKey)) {
            state.maskedBlocks.delete(absKey);
            Logger.info(player, "Block unlocked (Anchor removed).");
            ParticleSys.spawnEffect(player.dimension, location, "minecraft:electric_spark", 5, 0.4);
            player.playSound("random.orb");
        } else {
            state.maskedBlocks.add(absKey);
            Logger.success(player, "Block locked! (Anchor set).");
            ParticleSys.spawnEffect(player.dimension, location, "minecraft:villager_angry", 8, 0.5);
            player.playSound("item.shield.block");
        }
    }
}
