import { world, system, MolangVariableMap } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";
import { MathOps } from "../utils/MathOps.js";

export class PhantomRenderer {
    constructor() {
        this.activePreviews = new Map(); // PlayerId -> intervalId
    }

    /**
     * Previews frames using color-coded particles (Onion Skin Pro).
     * @param {import("@minecraft/server").Player} player 
     * @param {object[]} pastFrames - Array of past frames [Newest -> Oldest]
     * @param {object[]} futureFrames - Array of future frames [Next -> Furthest]
     * @param {import("@minecraft/server").Vector3} origin 
     * @param {object[]} palette
     */
    previewFrame(player, pastFrames = [], futureFrames = [], origin, palette = []) {
        this.clearGhosts(player);

        const dimension = player.dimension;
        let ticks = 0;
        const duration = 100; // 5 seconds default

        const pastColor = "minecraft:end_rod"; // §cRed/White (Past)
        const futureColor = "minecraft:soul_particle"; // §bBlue (Future)

        const intervalId = system.runInterval(() => {
            if (ticks >= duration) {
                this.clearGhosts(player);
                return;
            }
            ticks += 10;

            try {
                const drawLayer = (frame, layerIdx, particleId) => {
                    const offset = frame.offset || { x: 0, y: 0, z: 0 };
                    const skipRate = layerIdx > 0 ? layerIdx + 1 : 1;
                    let count = 0;

                    for (const [relPos, data] of Object.entries(frame)) {
                        if (["commands", "offset", "boxSize", "effects", "holdTicks"].includes(relPos)) continue;

                        count++;
                        if (count % skipRate !== 0) continue;

                        const { x: rx, y: ry, z: rz } = MathOps.unpack(relPos);
                        const targetPos = {
                            x: origin.x + rx + offset.x + 0.5,
                            y: origin.y + ry + offset.y + 0.5,
                            z: origin.z + rz + offset.z + 0.5
                        };

                        dimension.spawnParticle(particleId, targetPos);
                    }
                };

                // Render Past (Red-ish/White)
                pastFrames.forEach((f, i) => drawLayer(f, i, pastColor));
                
                // Render Future (Blue-ish)
                futureFrames.forEach((f, i) => drawLayer(f, i, futureColor));

            } catch (e) {
                this.clearGhosts(player);
            }
        }, 10);

        this.activePreviews.set(player.id, intervalId);
    }

    clearGhosts(player) {
        const intervalId = this.activePreviews.get(player.id);
        if (intervalId) {
            system.clearRun(intervalId);
            this.activePreviews.delete(player.id);
        }
    }
}

export const phantomRenderer = new PhantomRenderer();
