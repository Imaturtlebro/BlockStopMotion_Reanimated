import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { recordingEngine } from "../core/RecordingEngine.js";
import { macroManager } from "./MacroManager.js";
import { SequenceVault } from "../core/SequenceVault.js";

/**
 * MenuMacros handles the 'Transform Studio' where users can apply 
 * batch operations like Reverse, Mirror, and Ping-Pong to their animation.
 */
class MenuMacros {
    constructor() { }

    showMacroMenu(player, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        if (state.frames.length === 0) {
            Logger.warn(player, "No frames to transform.");
            if (backCallback) backCallback(player);
            return;
        }

        const form = new ActionFormData()
            .title("🛠️ Transform Studio")
            .body(`§7Apply batch changes to §e${state.name}§7 (${state.frames.length} frames).`)
            .button("§l§c⏪ REVERSE FRAMES\n§r§7Flip animation order")
            .button("§l§b↔️ MIRROR X\n§r§7Flip across X axis")
            .button("§l§b↕️ MIRROR Z\n§r§7Flip across Z axis")
            .button("§l§a🏓 PING-PONG LOOP\n§r§7Add return sequence")
            .button("§l§e🎲 ADD JITTER\n§r§7Organic offset noise")
            .button("§l§6✨ GENERATIVE TWEEN\n§r§7Create movement from Frame 1")
            .button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 6) {
                if (backCallback) backCallback(player);
                return;
            }

            // Create a pseudo-animation object for MacroManager
            const animObj = {
                name: state.name,
                frames: state.frames,
                palette: state.palette
            };

            let result = null;
            switch (res.selection) {
                case 0:
                    result = macroManager.reverse(animObj);
                    Logger.success(player, "Animation reversed.");
                    break;
                case 1:
                    state.frames = [...state.frames].reverse();
                    Logger.success(player, "Swapped frame order (Partial mirror logic).");
                    break;
                case 2:
                    // Placeholder for actual Z-Mirror if needed
                    break;
                case 3:
                    result = macroManager.pingPong(animObj);
                    Logger.success(player, `Ping-pong added! Total frames: §e${result.frames.length}`);
                    break;
                case 4:
                    this.showJitterMenu(player, (magnitude) => {
                        const jittered = macroManager.addJitter(animObj, magnitude);
                        state.frames = jittered.frames;
                        Logger.success(player, "Applied jitter noise.");
                        this.showMacroMenu(player, backCallback);
                    });
                    return;
                case 5:
                    this.showTweenMenu(player, (dist, steps, easing) => {
                        macroManager.createTweenMove(state.name, dist, steps, easing, "_Tween", player);
                        // This creates a NEW animation, so we don't update current state.frames
                        this.showMacroMenu(player, backCallback);
                    });
                    return;
            }

            if (result) {
                state.frames = result.frames;
            }
            this.showMacroMenu(player, backCallback);
        });
    }

    showTweenMenu(player, onConfirm) {
        const sel = recordingEngine.activeCaptures.get(player.id); // Defaulting to capture bounds might be confusing
        // Better: Use MenuDirector's selection points if they exist.
        // But for simplicity in this file, we'll let users input the delta or use a preset.
        
        const form = new ModalFormData()
            .title("✨ Generative Tween")
            .textField("Distance X", "0", "0")
            .textField("Distance Y", "0", "0")
            .textField("Distance Z", "0", "0")
            .slider("Total Frames", 2, 100, 1, 20)
            .dropdown("Easing Curve", ["linear", "ease-in", "ease-out", "ease-in-out", "bounce", "elastic", "back"], 0);

        form.show(player).then(res => {
            if (res.canceled) return;
            const dist = {
                x: parseFloat(res.formValues[0]) || 0,
                y: parseFloat(res.formValues[1]) || 0,
                z: parseFloat(res.formValues[2]) || 0
            };
            const steps = res.formValues[3];
            const easing = ["linear", "ease-in", "ease-out", "ease-in-out", "bounce", "elastic", "back"][res.formValues[4]];
            onConfirm(dist, steps, easing);
        });
    }

    showJitterMenu(player, onConfirm) {
        const form = new ModalFormData()
            .title("🎲 Jitter Settings")
            .slider("Noise Magnitude", 0.1, 1.0, 0.1, 0.2);

        form.show(player).then(res => {
            if (res.canceled) return;
            onConfirm(res.formValues[0]);
        });
    }
}

export const menuMacros = new MenuMacros();
