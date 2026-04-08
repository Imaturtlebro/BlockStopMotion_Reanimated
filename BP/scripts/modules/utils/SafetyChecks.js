import { Logger } from "./Logger.js";

/**
 * Utility for centralized error management and safety guards.
 */
export class SafetyChecks {
    /**
     * Safely executes a function, catching any errors and logging them with context.
     * @param {Function} fn The function to execute.
     * @param {string} contextName A string describing the context (e.g., "RenderCore.runPlayback").
     * @param {import("@minecraft/server").Player} player Optional player to notify on error.
     * @param {boolean} notifyPlayer Whether to send a generic error message to the player.
     * @returns {any} The result of the function, or undefined if it failed.
     */
    static safeExecute(fn, contextName, player = null, notifyPlayer = true) {
        try {
            return fn();
        } catch (e) {
            Logger.error(player, `Critical error in ${contextName}`, e);
            if (player && notifyPlayer) {
                player.sendMessage("§c[KFA] An internal error occurred. Logic has been halted to prevent corruption.");
            }
            return undefined;
        }
    }

    /**
     * Validates that an entity is still valid for use.
     * @param {import("@minecraft/server").Entity} entity 
     * @returns {boolean}
     */
    static isValid(entity) {
        if (!entity) return false;
        try {
            return entity.isValid();
        } catch (e) {
            return false;
        }
    }

    /**
     * Checks if coordinates are within reasonable bounds for Minecraft.
     */
    static isReasonableBounds(pos1, pos2, limit = 256) {
        const dx = Math.abs(pos2.x - pos1.x);
        const dy = Math.abs(pos2.y - pos1.y);
        const dz = Math.abs(pos2.z - pos1.z);
        return dx <= limit && dy <= limit && dz <= limit;
    }
}
