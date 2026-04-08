import { world, system, MolangVariableMap } from "@minecraft/server";

export class ParticleSys {
    static spawnEffect(dimension, location, particleId, count = 1, spread = 0.2) {
        try {
            const vars = new MolangVariableMap();
            vars.setVector3("variable.direction", { x: 0, y: 1, z: 0 }); // Default upward direction to stop Molang errors

            for (let i = 0; i < count; i++) {
                dimension.spawnParticle(particleId, {
                    x: location.x + (Math.random() - 0.5) * spread,
                    y: location.y + (Math.random() - 0.5) * spread,
                    z: location.z + (Math.random() - 0.5) * spread
                }, vars);
            }
        } catch (e) { }
    }

    static onCapture(dimension, location) {
        this.spawnEffect(dimension, location, "minecraft:end_rod", 5, 0.5);
        this.spawnEffect(dimension, location, "minecraft:basic_crit_particle", 3, 0.3);
    }

    static onPlay(dimension, location) {
        this.spawnEffect(dimension, location, "minecraft:sculk_soul_particle", 2, 0.2);
    }

    static onStop(dimension, location) {
        this.spawnEffect(dimension, location, "minecraft:large_smoke_particle", 3, 0.4);
    }

    static onSelection(dimension, location) {
        this.spawnEffect(dimension, location, "minecraft:villager_happy", 5, 0.1);
        this.spawnEffect(dimension, location, "minecraft:electric_spark", 2, 0.1);
    }

    static processFrameEffects(dimension, origin, frame) {
        if (!frame.effects) return;

        for (const effect of frame.effects) {
            const loc = {
                x: origin.x + (effect.offset?.x || 0),
                y: origin.y + (effect.offset?.y || 0),
                z: origin.z + (effect.offset?.z || 0)
            };
            this.spawnEffect(dimension, loc, effect.type, effect.count || 1);
        }
    }
}
