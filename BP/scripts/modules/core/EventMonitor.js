import { world, system } from "@minecraft/server";
import { renderCore } from "./RenderCore.js";
import { Logger } from "../utils/Logger.js";
import { NodeDataManager } from "./NodeDataManager.js";

export class EventMonitor {
    constructor() {
        console.warn(`[BSM][EventMonitor] Initializing with Spatial Hashing...`);
        this.monitoredBlocks = new Set();
        this.spatialGrid = new Map(); // chunkKey -> Set<locKey>
        this.lastTriggerStates = new Map();
        this.triggerDataCache = new Map(); // locKey -> { data, cacheTime }
        this.CACHE_TTL = 200; // Ticks
        this._saveDirty = false;
        
        this.loadTriggers();
        this.runSpatialMonitoring();
        this.runDebouncedSave();
    }

    _getChunkKey(x, z) {
        return `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
    }

    _addToGrid(locKey) {
        const [x, y, z] = locKey.split(',').map(Number);
        const chunkKey = this._getChunkKey(x, z);
        if (!this.spatialGrid.has(chunkKey)) {
            this.spatialGrid.set(chunkKey, new Set());
        }
        this.spatialGrid.get(chunkKey).add(locKey);
    }

    _removeFromGrid(locKey) {
        const [x, y, z] = locKey.split(',').map(Number);
        const chunkKey = this._getChunkKey(x, z);
        if (this.spatialGrid.has(chunkKey)) {
            const set = this.spatialGrid.get(chunkKey);
            set.delete(locKey);
            if (set.size === 0) this.spatialGrid.delete(chunkKey);
        }
    }

    loadTriggers() {
        try {
            let fullList = [];
            const count = world.getDynamicProperty("bsm:trigger_chunk_count") || 0;

            if (count > 0) {
                for (let i = 0; i < count; i++) {
                    const chunk = world.getDynamicProperty(`bsm:trigger_chunk_${i}`);
                    if (chunk) {
                        try {
                            const list = JSON.parse(chunk);
                            fullList = fullList.concat(list);
                        } catch (e) { }
                    }
                }
            } else {
                const legacyData = world.getDynamicProperty("bsm_monitor_config");
                if (legacyData) {
                    try {
                        fullList = JSON.parse(legacyData);
                        this.markDirty();
                    } catch (e) { }
                }
            }

            fullList.forEach(key => {
                this.monitoredBlocks.add(key);
                this._addToGrid(key);
            });
            console.warn(`[BSM][EventMonitor] loadTriggers complete. Loaded ${this.monitoredBlocks.size} triggers across ${this.spatialGrid.size} chunks.`);
        } catch (e) {
            console.warn(`[BSM][EventMonitor] loadTriggers FAILED: ${e}`);
        }
    }

    saveTriggers() {
        try {
            const list = Array.from(this.monitoredBlocks);
            const CHUNK_SIZE = 1500; 
            const chunks = [];

            for (let i = 0; i < list.length; i += CHUNK_SIZE) {
                chunks.push(list.slice(i, i + CHUNK_SIZE));
            }

            world.setDynamicProperty("bsm:trigger_chunk_count", chunks.length);
            chunks.forEach((chunk, i) => {
                world.setDynamicProperty(`bsm:trigger_chunk_${i}`, JSON.stringify(chunk));
            });

            const lastCount = world.getDynamicProperty("bsm:trigger_chunk_count_last") || 0;
            if (lastCount > chunks.length) {
                for (let i = chunks.length; i < lastCount; i++) {
                    world.setDynamicProperty(`bsm:trigger_chunk_${i}`, undefined);
                }
            }
            world.setDynamicProperty("bsm:trigger_chunk_count_last", chunks.length);
            world.setDynamicProperty("bsm_monitor_config", undefined);
        } catch (e) {
            Logger.log(`Failed to save triggers: ${e}`);
        }
    }

    markDirty() {
        this._saveDirty = true;
    }

    runDebouncedSave() {
        system.runInterval(() => {
            if (this._saveDirty) {
                this.saveTriggers();
                this._saveDirty = false;
            }
        }, 100);
    }

    addBlock(block) {
        const key = `${block.location.x},${block.location.y},${block.location.z},${block.dimension.id}`;
        if (this.monitoredBlocks.has(key)) return;
        this.monitoredBlocks.add(key);
        this._addToGrid(key);
        this.triggerDataCache.delete(key);
        this.markDirty();
    }

    getCachedBlockData(block, locKey, currentTick) {
        const cached = this.triggerDataCache.get(locKey);
        if (cached && (currentTick - cached.cacheTime) < this.CACHE_TTL) {
            return cached.data;
        }
        const data = NodeDataManager.getBlockData(block);
        this.triggerDataCache.set(locKey, { data, cacheTime: currentTick });
        return data;
    }

    runSpatialMonitoring() {
        let tickCount = 0;
        system.runInterval(() => {
            tickCount += 5;
            try {
                const players = world.getAllPlayers();
                const checkedThisTick = new Set();

                for (const player of players) {
                    const px = player.location.x;
                    const pz = player.location.z;
                    const dimId = player.dimension.id;

                    // Scan 3x3 chunks around player
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dz = -1; dz <= 1; dz++) {
                            const chunkKey = this._getChunkKey(px + dx * 16, pz + dz * 16);
                            const chunkSet = this.spatialGrid.get(chunkKey);
                            if (!chunkSet) continue;

                            for (const locKey of chunkSet) {
                                if (checkedThisTick.has(locKey)) continue;
                                checkedThisTick.add(locKey);

                                const [x, y, z, blockDimId] = locKey.split(',');
                                if (blockDimId !== dimId) continue;

                                try {
                                    const dimension = player.dimension;
                                    const block = dimension.getBlock({ x: parseInt(x), y: parseInt(y), z: parseInt(z) });

                                    if (!block || block.typeId !== "bsm:sequence_block") {
                                        this.monitoredBlocks.delete(locKey);
                                        this._removeFromGrid(locKey);
                                        this.triggerDataCache.delete(locKey);
                                        this.markDirty();
                                        continue;
                                    }

                                    this.checkTriggers(block, locKey, tickCount);
                                } catch (e) { }
                            }
                        }
                    }
                }
            } catch (e) {
                Logger.log(`Critical error in EventMonitor: ${e}`);
            }
        }, 5);
    }

    checkTriggers(block, locKey, currentTick) {
        const data = this.getCachedBlockData(block, locKey, currentTick);
        const triggerType = data.trigger_type; // "none", "redstone", "proximity"
        const animationId = data.trigger_anim;
        const requiredItem = data.required_item;

        if (!triggerType || triggerType === "none" || !animationId) return;

        // Condition Check helper
        const meetsRequirements = (players) => {
            if (!requiredItem || requiredItem === "") return true;
            return players.some(player => {
                const equippable = player.getComponent("equippable");
                if (equippable) {
                    const mainhand = equippable.getEquipment("Mainhand");
                    if (mainhand && mainhand.typeId === requiredItem) return true;
                }
                return false;
            });
        };

        if (triggerType === "redstone") {
            const isPowered = block.getRedstonePower() > 0;
            const lastState = this.lastTriggerStates.get(locKey) || false;

            if (isPowered && !lastState) {
                const players = block.dimension.getPlayers();
                if (meetsRequirements(players)) {
                    Logger.log(`Redstone trigger for ${animationId} at ${locKey}`);
                    this.triggerAnimation(block, animationId);
                }
            }
            this.lastTriggerStates.set(locKey, isPowered);
        } else if (triggerType === "proximity") {
            const range = data.trigger_range || 5;
            const players = block.dimension.getPlayers({
                location: block.location,
                maxDistance: range
            });

            const hasPlayer = players.length > 0;
            const lastState = this.lastTriggerStates.get(locKey) || false;

            if (hasPlayer && !lastState) {
                if (meetsRequirements(players)) {
                    Logger.log(`Proximity trigger for ${animationId} at ${locKey}`);
                    this.triggerAnimation(block, animationId);
                    console.warn(`[BSM][EventMonitor] FIRING TRIGGER: animId=${animationId}, type=${triggerType} at ${block.location.x},${block.location.y},${block.location.z}`);
                }
            }
            this.lastTriggerStates.set(locKey, hasPlayer);
        } else if (triggerType === "raycast") {
            const range = data.trigger_range || 10;
            const players = block.dimension.getPlayers({
                location: block.location,
                maxDistance: range + 10 // Wide guard for optimization
            });
            let hasLookingPlayer = false;

            for (const player of players) {
                const ray = player.getBlockFromViewDirection({ maxDistance: range });
                if (ray && ray.block.location.x === block.location.x &&
                    ray.block.location.y === block.location.y &&
                    ray.block.location.z === block.location.z) {

                    if (meetsRequirements([player])) {
                        hasLookingPlayer = true;
                        break;
                    }
                }
            }

            const lastState = this.lastTriggerStates.get(locKey) || false;
            if (hasLookingPlayer && !lastState) {
                Logger.log(`Raycast trigger for ${animationId} at ${locKey}`);
                this.triggerAnimation(block, animationId);
            }
            this.lastTriggerStates.set(locKey, hasLookingPlayer);
        }
    }

    triggerAnimation(block, animationId) {
        const data = NodeDataManager.getBlockData(block);
        const mode = data.trigger_mode || "once";
        const speed = data.speed_multiplier || 1;
        const easing = data.easing || "linear";

        renderCore.playAtLocation(block.dimension, block.location, animationId, mode, null, easing, speed);
    }
}

export const eventMonitor = new EventMonitor();

