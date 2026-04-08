import { system } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";

/**
 * AutoCaptureEngine handles automated frame recording based on 
 * time, block changes (quota), or instant triggers (live).
 */
class AutoCaptureEngine {
    constructor() { }

    /**
     * Starts the auto-capture process for a player.
     */
    start(player, core, state, mode, threshold) {
        this.stop(player, state); // Clear existing

        state.autoCapture.mode = mode; // "TIME", "LIVE", "QUOTA"
        state.autoCapture.threshold = threshold;
        state.autoCapture.counter = 0;

        if (mode === "TIME") {
            const interval = Math.max(5, threshold);
            state.autoCapture.taskId = system.runInterval(() => {
                if (!state.isRecording) {
                    this.stop(player, state);
                    return;
                }
                core.captureFrame(player);
            }, interval);
            Logger.info(player, `§aAuto-Capture: TIME§f (Every §e${interval}§f ticks)`);
        } else if (mode === "LIVE") {
            state.autoCapture.taskId = system.runInterval(() => {
                if (!state.isRecording) {
                    this.stop(player, state);
                    return;
                }
                core.captureFrame(player);
            }, 1);
            Logger.info(player, "§aAuto-Capture: LIVE§f (Every tick)");
        } else if (mode === "QUOTA") {
            state.autoCapture.taskId = system.runInterval(() => {
                if (!state.isRecording) {
                    this.stop(player, state);
                    return;
                }
                this.processQuota(player, core, state);
            }, 1);
            Logger.info(player, `§aAuto-Capture: QUOTA§f (Every §e${threshold}§f ticks)`);
        }
    }

    /**
     * Stops auto-capture for a player.
     */
    stop(player, state) {
        if (state.autoCapture.taskId !== null) {
            system.clearRun(state.autoCapture.taskId);
            state.autoCapture.taskId = null;
        }
        state.autoCapture.mode = "NONE";
        state.autoCapture.counter = 0;
        Logger.info(player, "§cAuto-Capture OFF§f.");
    }

    /**
     * Increment quota counter and check if capture is needed.
     */
    processQuota(player, core, state) {
        if (state.autoCapture.mode !== "QUOTA") return;

        state.autoCapture.counter++;
        if (state.autoCapture.counter >= state.autoCapture.threshold) {
            state.autoCapture.counter = 0;
            core.captureFrame(player);
        }
    }

    /**
     * Handle instant capture for LIVE mode.
     */
    processLive(player, core, state) {
        if (state.autoCapture.mode !== "LIVE") return;
        core.captureFrame(player);
    }
}

export const autoCaptureEngine = new AutoCaptureEngine();
