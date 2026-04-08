import { world, system, MolangVariableMap } from "@minecraft/server";

export class RegionHighlighter {
    static activeTasks = new Map(); // Key: location_hash, Value: intervalId
    static lowPerformance = false;

    /**
     * Draws a particle-based bounding box.
     * @param {import("@minecraft/server").Dimension} dimension 
     * @param {import("@minecraft/server").Vector3} pos1 
     * @param {import("@minecraft/server").Vector3} pos2 
     * @param {string} particleId 
     * @param {number} durationTicks Duration in ticks to keep the box visible (default: 1 for single frame)
     */
    static drawBox(dimension, pos1, pos2, particleId = "minecraft:end_rod", durationTicks = 1) {
        if (!dimension || isNaN(pos1.x) || isNaN(pos2.x)) {
            console.warn(`[BSM][RegionHighlighter] drawBox ABORTED: invalid params (dim=${!!dimension})`);
            return;
        }

        const minX = Math.min(pos1.x, pos2.x);
        const minY = Math.min(pos1.y, pos2.y);
        const minZ = Math.min(pos1.z, pos2.z);
        const maxX = Math.max(pos1.x, pos2.x) + 1;
        const maxY = Math.max(pos1.y, pos2.y) + 1;
        const maxZ = Math.max(pos1.z, pos2.z) + 1;
        
        const vars = new MolangVariableMap();
        vars.setVector3("variable.direction", { x: 0, y: 1, z: 0 });

        const draw = () => {
            const sizeX = maxX - minX;
            const sizeY = maxY - minY;
            const sizeZ = maxZ - minZ;

            // Simple particle budgeting for lines
            const totalEdgeLength = (sizeX + sizeY + sizeZ) * 4;
            let step = 0.5;
            if (totalEdgeLength > 200) step = 1.0;
            if (totalEdgeLength > 500) step = 2.0;
            if (totalEdgeLength > 1000) step = 5.0;

            // Corners (Use primary particleId)
            const corners = [
                { x: minX, y: minY, z: minZ }, { x: minX, y: maxY, z: minZ },
                { x: minX, y: minY, z: maxZ }, { x: minX, y: maxY, z: maxZ },
                { x: maxX, y: minY, z: minZ }, { x: maxX, y: maxY, z: minZ },
                { x: maxX, y: minY, z: maxZ }, { x: maxX, y: maxY, z: maxZ }
            ];

            corners.forEach(c => {
                try { 
                    dimension.spawnParticle(particleId, c, vars);
                } catch (e) { 
                    if (particleId !== "minecraft:end_rod") console.warn(`[BSM][RegionHighlighter] Primary particle FAILED: ${particleId}`);
                }
                // Fallback particles for visibility (Separate try blocks to ensure they run)
                try { dimension.spawnParticle("minecraft:basic_flame_particle", c); } catch (e) {}
                try { dimension.spawnParticle("minecraft:villager_happy", c); } catch (e) {}
            });

            // Bottom square
            this.drawLine(dimension, { x: minX, y: minY, z: minZ }, { x: maxX, y: minY, z: minZ }, particleId, step, vars);
            this.drawLine(dimension, { x: minX, y: minY, z: maxZ }, { x: maxX, y: minY, z: maxZ }, particleId, step, vars);
            this.drawLine(dimension, { x: minX, y: minY, z: minZ }, { x: minX, y: minY, z: maxZ }, particleId, step, vars);
            this.drawLine(dimension, { x: maxX, y: minY, z: minZ }, { x: maxX, y: minY, z: maxZ }, particleId, step, vars);

            // Top square
            this.drawLine(dimension, { x: minX, y: maxY, z: minZ }, { x: maxX, y: maxY, z: minZ }, particleId, step, vars);
            this.drawLine(dimension, { x: minX, y: maxY, z: maxZ }, { x: maxX, y: maxY, z: maxZ }, particleId, step, vars);
            this.drawLine(dimension, { x: minX, y: maxY, z: minZ }, { x: minX, y: maxY, z: maxZ }, particleId, step, vars);
            this.drawLine(dimension, { x: maxX, y: maxY, z: minZ }, { x: maxX, y: maxY, z: maxZ }, particleId, step, vars);

            // Vertical pillars
            this.drawLine(dimension, { x: minX, y: minY, z: minZ }, { x: minX, y: maxY, z: minZ }, particleId, step, vars);
            this.drawLine(dimension, { x: maxX, y: minY, z: minZ }, { x: maxX, y: maxY, z: minZ }, particleId, step, vars);
            this.drawLine(dimension, { x: minX, y: minY, z: maxZ }, { x: minX, y: maxY, z: maxZ }, particleId, step, vars);
            this.drawLine(dimension, { x: maxX, y: minY, z: maxZ }, { x: maxX, y: maxY, z: maxZ }, particleId, step, vars);
        };

        // If duration is essentially instant, just draw once
        if (durationTicks <= 5) {
            draw();
            return;
        }

        // Clean up existing task for this location key (prevents stacking)
        const key = `${minX},${minY},${minZ}`;
        if (RegionHighlighter.activeTasks.has(key)) {
            system.clearRun(RegionHighlighter.activeTasks.get(key));
            RegionHighlighter.activeTasks.delete(key);
        }

        let ticksElapsed = 0;
        // Run every 10 ticks (0.5s) to reduce particle spam, but enough to keep visible
        const intervalId = system.runInterval(() => {
            if (ticksElapsed >= durationTicks) {
                system.clearRun(intervalId);
                RegionHighlighter.activeTasks.delete(key);
                return;
            }
            draw();
            ticksElapsed += 10;
        }, 10);

        RegionHighlighter.activeTasks.set(key, intervalId);
    }

    static drawLine(dimension, start, end, particleId, step = 0.5, vars = null) {
        if (!dimension || isNaN(start.x) || isNaN(end.x)) return;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dz = end.z - start.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance === 0) return;

        // Hard limit on distance/steps to prevent watchdog hang
        if (distance > 256) step = Math.max(step, distance / 50);

        const steps = Math.min(Math.ceil(distance / step), 100);

        for (let i = 0; i <= steps; i++) {
            // Low Perf: Skip every other particle
            if (RegionHighlighter.lowPerformance && i % 2 !== 0) continue;

            const t = i / steps;
            const x = start.x + dx * t;
            const y = start.y + dy * t;
            const z = start.z + dz * t;
            try {
                dimension.spawnParticle(particleId, { x, y, z }, vars);
            } catch (e) { }
            
            // Fallbacks: Very aggressive for visibility
            try {
                if (i % 2 === 0) dimension.spawnParticle("minecraft:basic_flame_particle", { x, y, z });
            } catch (e) {}
            try {
                if (i % 5 === 0) dimension.spawnParticle("minecraft:villager_happy", { x, y, z });
            } catch (e) {}
        }
    }

    /**
     * Draws a particle at the pivot location.
     * @param {import("@minecraft/server").Dimension} dimension
     * @param {import("@minecraft/server").Vector3} pos - Absolute world position
     * @param {number} durationTicks
     */
    static drawPivot(dimension, pos, durationTicks = 100) {
        if (!dimension || isNaN(pos.x)) return;

        let ticksElapsed = 0;
        const intervalId = system.runInterval(() => {
            if (ticksElapsed >= durationTicks) {
                system.clearRun(intervalId);
                return;
            }
            try {
                // Spinning/Sparkling effect for pivot
                dimension.spawnParticle("minecraft:villager_happy", {
                    x: pos.x + 0.5,
                    y: pos.y + 0.5,
                    z: pos.z + 0.5
                });
            } catch (e) { }
            ticksElapsed += 10;
        }, 10);
    }

    /**
     * Draws a Quadratic Bezier path using particles.
     * @param {import("@minecraft/server").Dimension} dimension
     * @param {import("@minecraft/server").Vector3} p0 - Absolute start
     * @param {import("@minecraft/server").Vector3} p1 - Absolute control
     * @param {import("@minecraft/server").Vector3} p2 - Absolute end
     * @param {string} particleId
     */
    static drawBezierPath(dimension, p0, p1, p2, particleId = "minecraft:villager_happy") {
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const invT = 1 - t;
            const x = (invT * invT * p0.x) + (2 * invT * t * p1.x) + (t * t * p2.x);
            const y = (invT * invT * p0.y) + (2 * invT * t * p1.y) + (t * t * p2.y);
            const z = (invT * invT * p0.z) + (2 * invT * t * p1.z) + (t * t * p2.z);
            try {
                dimension.spawnParticle(particleId, { x, y, z });
            } catch (e) { }
        }
    }
}
