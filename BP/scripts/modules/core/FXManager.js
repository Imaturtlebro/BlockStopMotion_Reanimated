import { world, MolangVariableMap } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";

/**
 * FXManager handles frame-based events such as sounds, particles, and commands.
 * It resolves relative positions to absolute world coordinates.
 */
export class FXManager {
    /**
     * Processes an array of events for a specific frame.
     * @param {Dimension} dimension - The world dimension
     * @param {Object} origin - The absolute world origin of the playback
     * @param {Array} events - The events array from the frame JSON
     * @param {Object} [frameOffset] - Optional [x,y,z] translation for this frame
     */
    static processEvents(dimension, origin, events, frameOffset = { x: 0, y: 0, z: 0 }) {
        if (!events || !Array.isArray(events)) return;

        for (const event of events) {
            try {
                switch (event.type) {
                    case "sound":
                        this.handleSound(dimension, origin, event, frameOffset);
                        break;
                    case "particle":
                        this.handleParticle(dimension, origin, event, frameOffset);
                        break;
                    case "command":
                        this.handleCommand(dimension, origin, event, frameOffset);
                        break;
                }
            } catch (e) {
                console.error(`[BSM][FXManager] Error processing event: ${JSON.stringify(event)} - ${e}`);
            }
        }
    }

    static handleSound(dimension, origin, event, frameOffset) {
        const { id, volume = 1.0, pitch = 1.0, relPos = [0, 0, 0], maxDistance = 64 } = event;
        const absPos = this.toAbsPos(origin, relPos, frameOffset);
        
        // Native API: playSound on all nearby players
        const players = dimension.getPlayers({ location: absPos, maxDistance: maxDistance });
        for (const player of players) {
            player.playSound(id, { location: absPos, volume: volume, pitch: pitch });
        }
    }

    static handleParticle(dimension, origin, event, frameOffset) {
        const { id, relPos = [0, 0, 0] } = event;
        const absPos = this.toAbsPos(origin, relPos, frameOffset);
        
        // Native API: spawnParticle
        dimension.spawnParticle(id, absPos);
    }

    static handleCommand(dimension, origin, event, frameOffset) {
        const { value, relPos = [0, 0, 0] } = event;
        const absPos = this.toAbsPos(origin, relPos, frameOffset);
        
        // Inject absolute coordinates into command if placeholders exist
        // e.g. /summon lightning_bolt <x> <y> <z>
        let command = value
            .replace(/<x>/g, absPos.x.toFixed(2))
            .replace(/<y>/g, absPos.y.toFixed(2))
            .replace(/<z>/g, absPos.z.toFixed(2));

        dimension.runCommandAsync(command);
    }

    /**
     * Converts relative [x,y,z] array to an absolute world position object.
     */
    static toAbsPos(origin, relArray, frameOffset = { x: 0, y: 0, z: 0 }) {
        return {
            x: origin.x + frameOffset.x + (relArray[0] || 0),
            y: origin.y + frameOffset.y + (relArray[1] || 0),
            z: origin.z + frameOffset.z + (relArray[2] || 0)
        };
    }
}
