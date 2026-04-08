export class MathOps {
    /**
     * Rotates an animation 90 degrees clockwise.
     */
    static rotate90(animationData) {
        const newFrames = [];
        const palette = animationData.palette || [];
        const newPalette = [];
        const newPaletteHashes = [];

        // Determine bounds to keep rotation centered or relative to 0,0
        // For simplicity, we'll rotate around the Y axis
        for (const frame of animationData.frames) {
            const newFrame = {};
            for (const [relPos, data] of Object.entries(frame)) {
                if (relPos === "offset" || relPos === "boxSize" || relPos === "commands" || relPos === "effects") {
                    newFrame[relPos] = data;
                    continue;
                }

                const { x: rx, y: ry, z: rz } = this.unpack(relPos);
                const blockData = typeof data === 'number' ? palette[data] : data;

                // Clockwise 90: (x, z) -> (z, -x)
                // We shift to avoid negative coordinates if necessary, 
                // but let's just do the math and let playAtLocation handle it.
                const newRx = rz;
                const newRy = ry;
                const newRz = -rx;

                const newRelPos = this.pack(newRx, newRy, newRz);

                // Smart Rotation for Block States
                const newBlockData = { ...blockData };
                newBlockData.states = this.rotateBlockStates(blockData.type, blockData.states, 90);

                // Re-palette
                let stateStr = "";
                const keys = Object.keys(newBlockData.states);
                if (keys.length > 0) {
                    for (const k of keys) stateStr += `${k}=${newBlockData.states[k]},`;
                }
                const hash = `${newBlockData.type}|${stateStr}|${newBlockData.role}`;
                let idx = newPaletteHashes.indexOf(hash);
                if (idx === -1) {
                    newPaletteHashes.push(hash);
                    idx = newPalette.push(newBlockData) - 1;
                }
                newFrame[newRelPos] = idx;
            }
            newFrames.push(newFrame);
        }

        return {
            ...animationData,
            palette: newPalette,
            frames: newFrames
        };
    }

    /**
     * Handles block-specific state rotation (Stairs, Logs, etc.)
     */
    static rotateBlockStates(type, states, angle) {
        const newStates = { ...states };
        const steps = Math.floor(angle / 90);

        // Standard Facing Direction (0-5: Down, Up, North, South, West, East)
        if (states["minecraft:facing_direction"] !== undefined) {
            const current = states["minecraft:facing_direction"];
            if (current >= 2) {
                const horizontalOrder = [2, 5, 3, 4]; // N, E, S, W
                const idx = horizontalOrder.indexOf(current);
                if (idx !== -1) newStates["minecraft:facing_direction"] = horizontalOrder[(idx + steps) % 4];
            }
        }

        // Direction (0-3, used by Stairs, Doors, Trapdoors, etc.)
        if (states["direction"] !== undefined) {
            const current = states["direction"];
            const order = [0, 1, 2, 3]; // S, W, N, E
            const idx = order.indexOf(current);
            if (idx !== -1) newStates["direction"] = order[(idx + steps) % 4];
        }

        // String-based Facing (north, south, east, west)
        if (states["facing"] !== undefined) {
            const current = states["facing"];
            const order = ["north", "east", "south", "west"];
            const idx = order.indexOf(current);
            if (idx !== -1) newStates["facing"] = order[(idx + steps) % 4];
        }

        // Pillar Axis (Logs, Quartz, etc.)
        if (states["pillar_axis"] !== undefined && steps % 2 !== 0) {
            const current = states["pillar_axis"];
            if (current === "x") newStates["pillar_axis"] = "z";
            else if (current === "z") newStates["pillar_axis"] = "x";
        }

        // Weirdo Direction (Chest, Furnace in some older versions)
        if (states["weirdo_direction"] !== undefined) {
            const current = states["weirdo_direction"];
            const order = [2, 5, 3, 4];
            const idx = order.indexOf(current);
            if (idx !== -1) newStates["weirdo_direction"] = order[(idx + steps) % 4];
        }

        return newStates;
    }

    /**
     * Mirrors an animation along an axis.
     */
    static mirror(animationData, axis = "x") {
        const newFrames = [];
        const palette = animationData.palette || [];
        const newPalette = [];
        const newPaletteHashes = [];

        for (const frame of animationData.frames) {
            const newFrame = {};
            for (const [relPos, data] of Object.entries(frame)) {
                if (relPos === "offset" || relPos === "boxSize" || relPos === "commands" || relPos === "effects") {
                    newFrame[relPos] = data;
                    continue;
                }

                const { x: rx, y: ry, z: rz } = this.unpack(relPos);
                const blockData = typeof data === 'number' ? palette[data] : data;

                let newRx = rx, newRy = ry, newRz = rz;
                if (axis === "x") newRx = -rx;
                if (axis === "y") newRy = -ry;
                if (axis === "z") newRz = -rz;

                const newRelPos = this.pack(newRx, newRy, newRz);

                const newBlockData = { ...blockData };
                newBlockData.states = this.mirrorBlockStates(blockData.type, blockData.states, axis);

                let stateStr = "";
                const keys = Object.keys(newBlockData.states);
                if (keys.length > 0) {
                    for (const k of keys) stateStr += `${k}=${newBlockData.states[k]},`;
                }
                const hash = `${newBlockData.type}|${stateStr}|${newBlockData.role}`;
                let idx = newPaletteHashes.indexOf(hash);
                if (idx === -1) {
                    newPaletteHashes.push(hash);
                    idx = newPalette.push(newBlockData) - 1;
                }
                newFrame[newRelPos] = idx;
            }
            newFrames.push(newFrame);
        }
        return { ...animationData, palette: newPalette, frames: newFrames };
    }

    static mirrorBlockStates(type, states, axis) {
        const newStates = { ...states };

        // Horizontal Flip (East <-> West)
        if (axis === "x") {
            if (states["minecraft:facing_direction"] === 4) newStates["minecraft:facing_direction"] = 5;
            else if (states["minecraft:facing_direction"] === 5) newStates["minecraft:facing_direction"] = 4;

            if (states["direction"] === 4) newStates["direction"] = 5;
            else if (states["direction"] === 5) newStates["direction"] = 4;

            if (states["facing"] === "west") newStates["facing"] = "east";
            else if (states["facing"] === "east") newStates["facing"] = "west";
        }

        // Depth Flip (North <-> South)
        if (axis === "z") {
            if (states["minecraft:facing_direction"] === 2) newStates["minecraft:facing_direction"] = 3;
            else if (states["minecraft:facing_direction"] === 3) newStates["minecraft:facing_direction"] = 2;

            if (states["direction"] === 2) newStates["direction"] = 3;
            else if (states["direction"] === 3) newStates["direction"] = 2;

            if (states["facing"] === "north") newStates["facing"] = "south";
            else if (states["facing"] === "south") newStates["facing"] = "north";
        }

        return newStates;
    }

    static pack(x, y, z) {
        // Use 10 bits per component (Signed range: -512 to 511)
        // Total 30 bits, fits in a positive JS integer.
        // We add 512 to make them unsigned (0-1023) for simple bitwise storage.
        const px = (Math.floor(x) + 512) & 0x3FF;
        const py = (Math.floor(y) + 512) & 0x3FF;
        const pz = (Math.floor(z) + 512) & 0x3FF;
        return (px << 20 | py << 10 | pz).toString(36);
    }

    static unpack(relPos) {
        const packed = parseInt(relPos, 36);
        // Extract 10-bit chunks and subtract 512 to restore signed values
        return {
            x: ((packed >> 20) & 0x3FF) - 512,
            y: ((packed >> 10) & 0x3FF) - 512,
            z: (packed & 0x3FF) - 512
        };
    }

    /**
     * Calculates the average position of all blocks in the first frame.
     */
    static calculateCentroid(animationData) {
        if (!animationData.frames || animationData.frames.length === 0) return { x: 0, y: 0, z: 0 };
        const firstFrame = animationData.frames[0];
        let totalX = 0, totalY = 0, totalZ = 0, count = 0;

        for (const posKey in firstFrame) {
            if (posKey === "offset" || posKey === "boxSize" || posKey === "commands" || posKey === "effects") continue;
            const { x, y, z } = this.unpack(posKey);
            totalX += x;
            totalY += y;
            totalZ += z;
            count++;
        }

        if (count === 0) return { x: 0, y: 0, z: 0 };
        return {
            x: Math.round(totalX / count),
            y: Math.round(totalY / count),
            z: Math.round(totalZ / count)
        };
    }

    /**
     * Easing Functions for Tweening.
     * Maps time t (0 to 1) to a distance multiplier.
     */
    static ease(t, type = "linear") {
        t = Math.max(0, Math.min(1, t)); // Clamp between 0 and 1
        switch (type) {
            case "easeInQuad":
                return t * t;
            case "easeOutQuad":
                return t * (2 - t);
            case "easeInOutQuad":
                return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            case "easeInCubic":
                return t * t * t;
            case "easeOutCubic":
                return (--t) * t * t + 1;
            case "easeInOutCubic":
                return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
            case "linear":
            default:
                return t;
        }
    }
}
