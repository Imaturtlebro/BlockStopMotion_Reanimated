import { world, system, BlockPermutation } from "@minecraft/server";
import { MathOps } from "../utils/MathOps.js";
import { Logger } from "../utils/Logger.js";
import { RegionHighlighter } from "../utils/RegionHighlighter.js";
import { rigManager } from "../ui/RigManager.js";

/**
 * NudgeEngine handles physical block shifting, tweening trajectories,
 * and physics-step baking.
 */
class NudgeEngine {
    constructor() { }

    static MIN_WORLD_Y = -64;
    static MAX_WORLD_Y = 319;

    isValidWorldY(y) {
        return y >= NudgeEngine.MIN_WORLD_Y && y <= NudgeEngine.MAX_WORLD_Y;
    }

    clampWorldY(y) {
        return Math.max(NudgeEngine.MIN_WORLD_Y, Math.min(NudgeEngine.MAX_WORLD_Y, y));
    }

    tryGetBlock(dimension, location) {
        try {
            return dimension.getBlock(location);
        } catch (e) {
            return null;
        }
    }

    /**
     * Shifts all blocks within the state's bounds.
     * @param {Object} state - Active recording state
     * @param {number} dx, dy, dz - Offset
     * @param {boolean} kinetic - Whether bounds follow blocks
     */
    async nudgeBlocks(dimension, state, dx, dy, dz, kinetic = false, player = null) {
        const { pos1, pos2 } = state;
        const blocks = [];

        const totalArea = (pos2.x - pos1.x + 1) * (pos2.y - pos1.y + 1) * (pos2.z - pos1.z + 1);
        const isLarge = totalArea > 4000;

        // 1. Collect
        let count = 0;
        for (let x = pos1.x; x <= pos2.x; x++) {
            for (let y = pos1.y; y <= pos2.y; y++) {
                for (let z = pos1.z; z <= pos2.z; z++) {
                    const absKey = `${x},${y},${z}`;
                    if (state.maskedBlocks.has(absKey)) continue;
                    if (!this.isValidWorldY(y)) continue;

                    const block = this.tryGetBlock(dimension, { x, y, z });
                    if (block && block.typeId !== "minecraft:air") {
                        blocks.push({ x, y, z, perm: block.permutation });
                    }
                    count++;
                    if (isLarge && count % 1000 === 0) await system.waitTicks(1);
                }
            }
        }

        // 2. Clear
        count = 0;
        for (let x = pos1.x; x <= pos2.x; x++) {
            for (let y = pos1.y; y <= pos2.y; y++) {
                for (let z = pos1.z; z <= pos2.z; z++) {
                    const absKey = `${x},${y},${z}`;
                    if (state.maskedBlocks.has(absKey)) continue;
                    if (!this.isValidWorldY(y)) continue;

                    const block = this.tryGetBlock(dimension, { x, y, z });
                    if (block) block.setPermutation(BlockPermutation.resolve("minecraft:air"));
                    count++;
                    if (isLarge && count % 1000 === 0) await system.waitTicks(1);
                }
            }
        }

        // 3. Update Bounds if kinetic
        if (kinetic) {
            state.pos1 = { x: pos1.x + dx, y: this.clampWorldY(pos1.y + dy), z: pos1.z + dz };
            state.pos2 = { x: pos2.x + dx, y: this.clampWorldY(pos2.y + dy), z: pos2.z + dz };

            // Persist the bounds update so the selection wand doesn't snap it back.
            if (player) {
                try {
                    const propKey = `bsm_sel:${player.id}`;
                    world.setDynamicProperty(propKey, JSON.stringify({ pos1: state.pos1, pos2: state.pos2 }));
                } catch (e) {}
            }
        }

        const checkPos1 = kinetic ? state.pos1 : pos1;
        const checkPos2 = kinetic ? state.pos2 : pos2;

        // 4. Place
        let placed = 0;
        count = 0;
        for (const b of blocks) {
            const nx = b.x + dx;
            const ny = b.y + dy;
            const nz = b.z + dz;
            const targetKey = `${nx},${ny},${nz}`;
            if (state.maskedBlocks.has(targetKey)) continue;

            if (nx >= checkPos1.x && nx <= checkPos2.x && ny >= checkPos1.y && ny <= checkPos2.y && nz >= checkPos1.z && nz <= checkPos2.z) {
                if (this.isValidWorldY(ny)) {
                    const target = this.tryGetBlock(dimension, { x: nx, y: ny, z: nz });
                    if (target) {
                        target.setPermutation(b.perm);
                        placed++;
                    }
                }
            }
            count++;
            if (isLarge && count % 1000 === 0) await system.waitTicks(1);
        }

        if (player) {
            player.playSound("mob.endermen.portal");
            const modeLabel = kinetic ? " Â§d[KINETIC]" : "";
            Logger.actionBar(player, `Â§bNudgedÂ§f Â§e${placed}Â§f blocks.${modeLabel}`);
            if (kinetic) RegionHighlighter.drawBox(dimension, state.pos1, state.pos2, "minecraft:end_rod", 40);
        }

        // 5. Rigging Propagation
        if (kinetic && player) {
            const rootNode = rigManager.getNodeAt(player, pos1);
            if (rootNode) {
                rigManager.propagateMove(player, rootNode.id, dx, dy, dz, async (child, cdx, cdy, cdz) => {
                    await this._nudgeBlocksSimple(dimension, child.pos1, child.pos2, cdx, cdy, cdz);
                });
            }
        }

        return placed;
    }

    /**
     * Smoothly generates sequence of frames based on easing trajectory.
     */
    async applyTweenNudge(player, core, state, totalDist, totalFrames, easingType, kinetic = true) {
        state.isProcessingCapture = true;
        let lastX = 0, lastY = 0, lastZ = 0;

        for (let i = 1; i <= totalFrames; i++) {
            const t = i / totalFrames;
            const multiplier = MathOps.ease(t, easingType);

            const targetX = Math.round(totalDist.x * multiplier);
            const targetY = Math.round(totalDist.y * multiplier);
            const targetZ = Math.round(totalDist.z * multiplier);

            const dx = targetX - lastX;
            const dy = targetY - lastY;
            const dz = targetZ - lastZ;

            if (dx !== 0 || dy !== 0 || dz !== 0) {
                await this.nudgeBlocks(player.dimension, state, dx, dy, dz, kinetic, player);
            }

            core.captureFrame(player);

            lastX = targetX;
            lastY = targetY;
            lastZ = targetZ;
            await system.waitTicks(1);
        }

        state.isProcessingCapture = false;
        Logger.success(player, `Tween complete! Generated Â§e${totalFrames}Â§r frames.`);
    }

    /**
     * Stepped physics capture.
     */
    async startPhysicsBake(player, core, state, totalFrames) {
        state.isProcessingCapture = true;
        player.sendMessage(`Â§eStarting Physics Bake: Â§b${totalFrames}Â§f frames...`);

        for (let i = 1; i <= totalFrames; i++) {
            player.dimension.runCommandAsync("tick step 1").catch(() => { });
            await system.waitTicks(2);
            core.captureFrame(player);
            if (i % 5 === 0) player.onScreenDisplay.setActionBar(`Â§bBaking Physics: Â§e${i}/${totalFrames}`);
            await system.waitTicks(1);
        }

        state.isProcessingCapture = false;
        Logger.success(player, `Physics Bake Complete! Â§e${totalFrames}Â§r frames captured.`);
    }

    async _nudgeBlocksSimple(dimension, p1, p2, dx, dy, dz) {
        const blocks = [];
        const isLarge = (p2.x - p1.x + 1) * (p2.y - p1.y + 1) * (p2.z - p1.z + 1) > 4000;
        let count = 0;

        for (let x = p1.x; x <= p2.x; x++) {
            for (let y = p1.y; y <= p2.y; y++) {
                for (let z = p1.z; z <= p2.z; z++) {
                    if (!this.isValidWorldY(y)) continue;

                    const block = this.tryGetBlock(dimension, { x, y, z });
                    if (block && block.typeId !== "minecraft:air") {
                        blocks.push({ x, y, z, perm: block.permutation });
                    }
                    count++;
                    if (isLarge && count % 1000 === 0) await system.waitTicks(1);
                }
            }
        }

        count = 0;
        for (let x = p1.x; x <= p2.x; x++) {
            for (let y = p1.y; y <= p2.y; y++) {
                for (let z = p1.z; z <= p2.z; z++) {
                    if (!this.isValidWorldY(y)) continue;

                    const block = this.tryGetBlock(dimension, { x, y, z });
                    if (block) block.setPermutation(BlockPermutation.resolve("minecraft:air"));
                    count++;
                    if (isLarge && count % 1000 === 0) await system.waitTicks(1);
                }
            }
        }

        count = 0;
        for (const b of blocks) {
            const ny = b.y + dy;
            if (!this.isValidWorldY(ny)) continue;

            const target = this.tryGetBlock(dimension, { x: b.x + dx, y: ny, z: b.z + dz });
            if (target) target.setPermutation(b.perm);
            count++;
            if (isLarge && count % 1000 === 0) await system.waitTicks(1);
        }
    }
}

export const nudgeEngine = new NudgeEngine();
