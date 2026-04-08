import { system } from "@minecraft/server";
import { renderCore } from "./RenderCore.js";
import { SequenceVault } from "./SequenceVault.js";
import { Logger } from "../utils/Logger.js";

/**
 * SceneManager handles multi-track animation playback.
 * A Scene is a collection of animation tracks with delays and offsets.
 */
export class SceneManager {
    constructor() {
        this.activeScenes = new Map();
    }

    /**
     * Plays a scene by triggering multiple RenderCore playback instances.
     * @param {string} sceneId - The ID of the scene to play
     * @param {Object} origin - The world location to anchor the scene
     * @param {Player} [player] - Optional player for feedback
     */
    playScene(sceneId, origin, player = null) {
        const sceneData = SequenceVault.loadScene(sceneId);
        if (!sceneData) {
            if (player) Logger.error(player, `Scene not found: ${sceneId}`);
            return;
        }

        if (player) Logger.info(player, `Playing Scene: §e${sceneId}§r (${sceneData.tracks.length} tracks)`);

        for (const track of sceneData.tracks) {
            const { animId, delayTicks, offset, mode, easing } = track;
            
            const trackOrigin = {
                x: origin.x + (offset?.[0] || 0),
                y: origin.y + (offset?.[1] || 0),
                z: origin.z + (offset?.[2] || 0)
            };

            if (delayTicks > 0) {
                system.runTimeout(() => {
                    renderCore.playAtLocation(player?.dimension || world.getDimension("overworld"), trackOrigin, animId, mode || "once", player, easing || "linear");
                }, delayTicks);
            } else {
                renderCore.playAtLocation(player?.dimension || world.getDimension("overworld"), trackOrigin, animId, mode || "once", player, easing || "linear");
            }
        }
    }

    /**
     * Creates a new scene template.
     */
    createScene(sceneId, tracks = []) {
        const scene = {
            id: sceneId,
            tracks: tracks // [{animId, offset: [x,y,z], delayTicks, mode, easing}]
        };
        SequenceVault.saveScene(sceneId, scene);
        return scene;
    }
}

export const sceneManager = new SceneManager();
