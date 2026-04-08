import { world } from "@minecraft/server";

/**
 * Manages block-specific properties by storing them on the world object
 * with keys tied to block coordinates and dimensions.
 */
export class NodeDataManager {
    static getBlockData(block) {
        const blockKey = `bsm_bd:${block.location.x}_${block.location.y}_${block.location.z}_${block.dimension.id}`;
        const data = world.getDynamicProperty(blockKey);
        try {
            const parsed = data ? JSON.parse(data) : {};
            console.warn(`[BSM][NodeDataManager] getBlockData: key=${blockKey}, hasData=${!!data}, animId=${parsed.animationId || 'none'}`);
            return parsed;
        } catch (e) {
            console.warn(`[BSM][NodeDataManager] getBlockData: PARSE ERROR for key=${blockKey}`);
            return {};
        }
    }

    static setBlockData(block, data) {
        const blockKey = `bsm_bd:${block.location.x}_${block.location.y}_${block.location.z}_${block.dimension.id}`;
        world.setDynamicProperty(blockKey, JSON.stringify(data));
    }

    static getProperty(block, key) {
        return this.getBlockData(block)[key];
    }

    static setProperty(block, key, value) {
        const data = this.getBlockData(block);
        data[key] = value;
        this.setBlockData(block, data);
    }
}
