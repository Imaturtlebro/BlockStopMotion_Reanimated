import { MathOps } from "../utils/MathOps.js";

export class TweenEngine {
    /**
     * Creates intermediate frames between two keyframes.
     * @param {Object} startFrame - The starting frame data
     * @param {Object} endFrame - The ending frame data
     * @param {number} steps - Number of intermediate frames to generate
     * @param {Object} [controlPoint] - Optional Quadratic Bezier control point (relative to start)
     * @param {string} [easingType] - Easing function to apply ("linear", "ease-in", "ease-out", "ease-in-out")
     * @returns {Array} Array of new generated frames
     */
    static generateTween(startFrame, endFrame, steps, controlPoint1 = null, controlPoint2 = null, easingType = "linear") {
        if (steps <= 0) return [];
        const intermediateFrames = [];

        const startOffset = startFrame.offset || { x: 0, y: 0, z: 0 };
        const endOffset = endFrame.offset || { x: 0, y: 0, z: 0 };

        for (let i = 1; i <= steps; i++) {
            let t = i / (steps + 1);
            t = this.applyEasing(t, easingType);

            const newFrame = {};

            // 1. Interpolate Offset (Linear, Quadratic, or Cubic Bezier)
            if (controlPoint1 && controlPoint2) {
                const absC1 = { x: startOffset.x + controlPoint1.x, y: startOffset.y + controlPoint1.y, z: startOffset.z + controlPoint1.z };
                const absC2 = { x: startOffset.x + controlPoint2.x, y: startOffset.y + controlPoint2.y, z: startOffset.z + controlPoint2.z };
                newFrame.offset = this.interpolateCubicBezier(startOffset, absC1, absC2, endOffset, t);
            } else if (controlPoint1) {
                const absC1 = { x: startOffset.x + controlPoint1.x, y: startOffset.y + controlPoint1.y, z: startOffset.z + controlPoint1.z };
                newFrame.offset = this.interpolateBezier(startOffset, absC1, endOffset, t);
            } else {
                newFrame.offset = {
                    x: startOffset.x + (endOffset.x - startOffset.x) * t,
                    y: startOffset.y + (endOffset.y - startOffset.y) * t,
                    z: startOffset.z + (endOffset.z - startOffset.z) * t
                };
            }

            // 2. Preserve Box Size
            if (endFrame.boxSize) newFrame.boxSize = endFrame.boxSize;
            else if (startFrame.boxSize) newFrame.boxSize = startFrame.boxSize;

            // 3. Stochastic Block Morphing (Pixel-Dissolve Transition)
            // Instead of a hard swap at t=0.5, we use t as a probability 
            // to create a dithering dissolve effect.
            for (const [key, val] of Object.entries(startFrame)) {
                if (key === "offset" || key === "boxSize" || key === "commands") continue;
                // If it's only in start or t is low, use start
                if (Math.random() >= t) {
                    newFrame[key] = val;
                }
            }
            for (const [key, val] of Object.entries(endFrame)) {
                if (key === "offset" || key === "boxSize" || key === "commands") continue;
                // If it's only in end or t is high, use end (overwrites start if picked)
                if (Math.random() < t) {
                    newFrame[key] = val;
                }
            }

            intermediateFrames.push(newFrame);
        }

        return intermediateFrames;
    }

    /**
     * Quadratic Bezier Interpolation: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
     */
    static interpolateBezier(p0, p1, p2, t) {
        const invT = 1 - t;
        return {
            x: (invT * invT * p0.x) + (2 * invT * t * p1.x) + (t * t * p2.x),
            y: (invT * invT * p0.y) + (2 * invT * t * p1.y) + (t * t * p2.y),
            z: (invT * invT * p0.z) + (2 * invT * t * p1.z) + (t * t * p2.z)
        };
    }

    /**
     * Cubic Bezier Interpolation: B(t) = (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)t^2*P2 + t^3*P3
     */
    static interpolateCubicBezier(p0, p1, p2, p3, t) {
        const invT = 1 - t;
        const invT2 = invT * invT;
        const invT3 = invT2 * invT;
        const t2 = t * t;
        const t3 = t2 * t;

        return {
            x: (invT3 * p0.x) + (3 * invT2 * t * p1.x) + (3 * invT * t2 * p2.x) + (t3 * p3.x),
            y: (invT3 * p0.y) + (3 * invT2 * t * p1.y) + (3 * invT * t2 * p2.y) + (t3 * p3.y),
            z: (invT3 * p0.z) + (3 * invT2 * t * p1.z) + (3 * invT * t2 * p2.z) + (t3 * p3.z)
        };
    }

    /**
     * Applies easing to the interpolation factor t.
     */
    static applyEasing(t, type) {
        switch (type.toLowerCase()) {
            case "ease-in":
                return t * t;
            case "ease-out":
                return t * (2 - t);
            case "ease-in-out":
                return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            case "bounce":
                return this.easeOutBounce(t);
            case "elastic":
                const n1 = 1.70158;
                const n2 = n1 * 1.525;
                const c4 = (2 * Math.PI) / 3;
                return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
            case "back":
                const s = 1.70158;
                return t * t * ((s + 1) * t - s);
            case "linear":
            default:
                return t;
        }
    }

    static easeOutBounce(x) {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (x < 1 / d1) return n1 * x * x;
        else if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
        else if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
        else return n1 * (x -= 2.625 / d1) * x + 0.984375;
    }

    /**
     * Generates a sequence of frames translating a static asset (first frame of animData)
     * over a distance with easing.
     */
    static generateTranslation(animData, totalDist, totalSteps, easingType = "linear") {
        if (!animData || !animData.frames || animData.frames.length === 0) return animData;
        
        const newFrames = [ ...animData.frames ]; // Keep the initial frame
        const palette = animData.palette || [];
        
        // Find or Create Air in palette
        let airIdx = palette.findIndex(p => p.type === "minecraft:air");
        if (airIdx === -1) {
            airIdx = palette.push({ type: "minecraft:air", states: {}, role: "normal" }) - 1;
        }

        // The 'Source of Truth' is the first frame's blocks
        const sourceFrame = animData.frames[0];
        const sourceBlocks = []; 
        for (const [relPos, pIdx] of Object.entries(sourceFrame)) {
            if (relPos === "offset" || relPos === "boxSize" || relPos === "commands" || relPos === "effects") continue;
            sourceBlocks.push({ relPos, pIdx, ...MathOps.unpack(relPos) });
        }

        let lastFullState = { ...sourceFrame };
        let lastOffset = { x: 0, y: 0, z: 0 };

        for (let i = 1; i <= totalSteps; i++) {
            const t = i / totalSteps;
            const multiplier = this.applyEasing(t, easingType);
            
            const currentOffset = {
                x: Math.round(totalDist.x * multiplier),
                y: Math.round(totalDist.y * multiplier),
                z: Math.round(totalDist.z * multiplier)
            };

            const deltaFrame = { offset: currentOffset, useEntities: true };
            const currentFullState = {};

            const shellBlocks = [];
            // Calculate new positions for all blocks
            for (const b of sourceBlocks) {
                const newRelPos = MathOps.pack(b.x + currentOffset.x, b.y + currentOffset.y, b.z + currentOffset.z);
                currentFullState[newRelPos] = b.pIdx;

                // Shell Culling: Check if block is visible (exposed to air)
                if (this.isShell(currentFullState, b.x + currentOffset.x, b.y + currentOffset.y, b.z + currentOffset.z)) {
                    shellBlocks.push(newRelPos);
                }
            }

            // Trailing Air Rule
            for (const relPos in lastFullState) {
                if (relPos === "offset" || relPos === "boxSize" || relPos === "commands") continue;
                if (currentFullState[relPos] === undefined) {
                    deltaFrame[relPos] = airIdx;
                }
            }

            // Apply all new block positions to the delta
            for (const [relPos, pIdx] of Object.entries(currentFullState)) {
                deltaFrame[relPos] = pIdx;
            }

            deltaFrame.shellBlocks = shellBlocks;
            newFrames.push(deltaFrame);
            lastFullState = currentFullState;
            lastOffset = currentOffset;
        }

        return { ...animData, frames: newFrames, palette };
    }

    static isShell(fullState, x, y, z) {
        const neighbors = [
            [1, 0, 0], [-1, 0, 0],
            [0, 1, 0], [0, -1, 0],
            [0, 0, 1], [0, 0, -1]
        ];
        for (const [dx, dy, dz] of neighbors) {
            const key = MathOps.pack(x + dx, y + dy, z + dz);
            if (!fullState[key]) return true; // Neighbor is air or undefined -> shell
        }
        return false;
    }
}

