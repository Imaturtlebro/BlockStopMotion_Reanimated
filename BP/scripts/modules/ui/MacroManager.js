import { MathOps } from "../utils/MathOps.js";
import { SequenceVault } from "../core/SequenceVault.js";
import { Logger } from "../utils/Logger.js";
import { TweenEngine } from "../core/TweenEngine.js";

export class MacroManager {
    constructor() {
        this.playerStates = new Map(); // PlayerId -> { isRecording, steps }
    }

    _getState(player) {
        if (!this.playerStates.has(player.id)) {
            this.playerStates.set(player.id, { isRecording: false, steps: [] });
        }
        return this.playerStates.get(player.id);
    }

    startRecording(player) {
        const state = this._getState(player);
        state.isRecording = true;
        state.steps = [];
    }

    addStep(player, type) {
        const state = this._getState(player);
        if (!state.isRecording) return false;
        state.steps.push({ type });
        return true;
    }

    stopRecording(player) {
        const state = this._getState(player);
        state.isRecording = false;
        return state.steps.length;
    }

    getSteps(player) {
        return [...this._getState(player).steps];
    }

    /**
     * Apply the recorded macro to an animation and save the result.
     * @param {string} animId - Source animation ID
     * @param {string} suffix - Suffix for the new animation name
     * @param {import("@minecraft/server").Player} player - Player for feedback
     * @returns {string|null} New animation ID or null on failure
     */
    apply(animId, suffix = "_Macro", player = null) {
        let animation = SequenceVault.load(animId);
        if (!animation) {
            if (player) Logger.warn(player, `Animation not found: ${animId}`);
            return null;
        }

        const state = player ? this._getState(player) : { steps: [] };
        const steps = state.steps;

        for (const step of steps) {
            switch (step.type) {
                case "rotate90":
                    animation = MathOps.rotate90(animation);
                    break;
                case "mirrorX":
                    animation = MathOps.mirror(animation, "x");
                    break;
                case "mirrorZ":
                    animation = MathOps.mirror(animation, "z");
                    break;
            }
        }

        const newId = animId + suffix;
        SequenceVault.save(newId, animation);
        if (player) Logger.success(player, `Macro applied! Created §e${newId}§a (${steps.length} transforms).`);
        return newId;
    }

    /**
     * Reverses the frames of an animation.
     */
    reverse(data) {
        if (!data || !data.frames) return data;
        const frames = [...data.frames].reverse();
        return { ...data, frames };
    }

    /**
     * Loops an animation (A -> B -> A).
     */
    pingPong(data) {
        if (!data || !data.frames || data.frames.length < 2) return data;
        const forward = data.frames;
        const backward = [...forward].reverse().slice(1, -1); // Remove extremes to avoid double frames
        return { ...data, frames: [...forward, ...backward] };
    }

    /**
     * Automatically sets the pivot to the center of the first frame's blocks.
     */
    autoPivot(data) {
        const centroid = MathOps.calculateCentroid(data);
        return { ...data, pivot: centroid };
    }

    /**
     * Adds organic jitter to frame offsets.
     */
    addJitter(data, magnitude = 0.2) {
        if (!data || !data.frames) return data;
        const newFrames = data.frames.map(f => {
            const jitter = {
                x: (Math.random() - 0.5) * magnitude,
                y: (Math.random() - 0.5) * magnitude,
                z: (Math.random() - 0.5) * magnitude
            };
            const currentOffset = f.offset || { x: 0, y: 0, z: 0 };
            return {
                ...f,
                offset: {
                    x: currentOffset.x + jitter.x,
                    y: currentOffset.y + jitter.y,
                    z: currentOffset.z + jitter.z
                }
            };
        });
        return { ...data, frames: newFrames };
    }

    /**
     * Generates a new animation by translating the first frame of a source animation.
     */
    createTweenMove(animId, dist, steps, easing, suffix = "_Tween", player = null) {
        const data = SequenceVault.load(animId);
        if (!data) {
            if (player) Logger.error(player, `Source animation not found: ${animId}`);
            return null;
        }

        const newId = animId + suffix;
        const fromFrame = { ...data };
        fromFrame.frames = [ data.frames[0] ]; // Only take first frame as template

        try {
            const result = TweenEngine.generateTranslation(fromFrame, dist, steps, easing);
            SequenceVault.save(newId, result);
            
            if (player) Logger.success(player, `Generative Tween Complete! Created §e${newId}§a (${steps} frames).`);
            return newId;
        } catch (e) {
            if (player) Logger.error(player, "Failed to generate tween move", e);
            console.error(`[BSM][MacroManager] Tween generation error: ${e}`);
            return null;
        }
    }

    /**
     * Swaps one block type for another across the entire animation palette.
     */
    globalReplace(data, oldTypeId, newTypeId) {
        if (!data || !data.palette || !oldTypeId || !newTypeId) return data;

        let found = false;
        const newPalette = data.palette.map(p => {
            if (p.type === oldTypeId) {
                found = true;
                return { ...p, type: newTypeId };
            }
            return p;
        });

        if (!found) return null;
        return { ...data, palette: newPalette };
    }
}

export const macroManager = new MacroManager();
