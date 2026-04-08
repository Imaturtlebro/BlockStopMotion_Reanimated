import { world, system } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";

/**
 * CameraManager handles the placement and playback of cinematic camera markers.
 * These markers allow animators to define intended viewing angles for their animations.
 */
export class CameraManager {
    constructor() {
        this.activeMarkers = new Map(); // PlayerId -> Map(FrameIndex -> CameraState)
    }

    /**
     * Drops a camera marker at the player's current position/rotation for a specific frame.
     */
    setMarker(player, state, frameIndex) {
        if (!state) return;
        
        const loc = player.location;
        const rot = player.getRotation();

        const marker = {
            pos: { x: loc.x, y: loc.y, z: loc.z },
            rot: { x: rot.x, y: rot.y }
        };

        if (!state.cameraMarkers) state.cameraMarkers = {};
        state.cameraMarkers[frameIndex] = marker;

        Logger.success(player, `§aCamera Marker§r set for §lFrame ${frameIndex + 1}§r.`);
        player.playSound("note.pling");
    }

    /**
     * Clears a marker for a specific frame.
     */
    clearMarker(player, state, frameIndex) {
        if (state.cameraMarkers && state.cameraMarkers[frameIndex]) {
            delete state.cameraMarkers[frameIndex];
            Logger.info(player, `§7Camera Marker§r cleared for §lFrame ${frameIndex + 1}§r.`);
        }
    }

    /**
     * Applies a camera marker to a player using the native Camera API.
     */
    applyMarker(player, marker, duration = 0, easing = "Linear") {
        if (!marker) return;

        try {
            if (duration > 0) {
                player.camera.setCamera("minecraft:free", {
                    location: marker.pos,
                    facingLocation: undefined, // Or facingRotation if using markers
                    easeOptions: {
                        easeTime: duration / 20, // Ticks to seconds
                        easeType: easing
                    }
                });
                // Facing rotation is tricky with facingLocation. 
                // We'll use teleport for rotation alignment if setCamera isn't enough.
            } else {
                player.camera.setCamera("minecraft:free", {
                    location: marker.pos
                });
            }
        } catch (e) {
            console.error(`[BSM][CameraManager] setCamera failed: ${e}`);
            // Fallback to teleport for older versions or blocked states
            player.teleport(marker.pos, { facingRotation: marker.rot, checkForBlocks: false });
        }
    }

    /**
     * Resets the player's camera to default.
     */
    clearCamera(player) {
        try {
            player.camera.clear();
        } catch (e) { }
    }

    /**
     * Visualizes markers as particles.
     */
    drawMarkers(dimension, state) {
        if (!state.cameraMarkers) return;

        for (const [index, marker] of Object.entries(state.cameraMarkers)) {
            dimension.spawnParticle("minecraft:villager_happy", marker.pos);
            // Labeling with floating text would require entities, so we use particles for now.
        }
    }
}

export const cameraManager = new CameraManager();
