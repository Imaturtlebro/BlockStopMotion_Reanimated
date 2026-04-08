import { world, system } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";

/**
 * NudgeHammer handles physical block-shifting tool logic.
 */
export class NudgeHammer {
    constructor(recordingEngine, nudgeEngine) {
        this.recordingEngine = recordingEngine;
        this.nudgeEngine = nudgeEngine;
    }

    /**
     * Nudges the entire animation bounding box.
     */
    async nudge(player, dx, dy, dz, kinetic = false) {
        const state = this.recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        // Delegate to engine
        return await this.nudgeEngine.nudgeBlocks(player.dimension, state, dx, dy, dz, kinetic, player);
    }
}
