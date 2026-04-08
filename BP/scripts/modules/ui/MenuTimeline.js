import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { recordingEngine } from "../core/RecordingEngine.js";
import { menuMacros } from "./MenuMacros.js";
import { TweenEngine } from "../core/TweenEngine.js";
import { menuFX } from "./MenuFX.js";

/**
 * MenuTimeline handles the frame-by-frame editing, reordering, 
 * and sequence management.
 */
class MenuTimeline {
    constructor() { }

    showTimelineEditor(player, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        if (state.frames.length === 0) {
            Logger.warn(player, "No frames to edit.");
            if (backCallback) backCallback(player);
            return;
        }

        const form = new ActionFormData()
            .title("📉 Timeline Explorer")
            .body(`§7Scrubbing §e${state.name}§7 | §b${state.frames.length}§7 frames`)
            .button("§l§d🛠️ TRANSFORM STUDIO\n§r§7Reverse, Mirror, Jitter");

        state.frames.forEach((f, i) => {
            const changes = Object.keys(f).length - 5;
            form.button(`§lFrame ${i + 1}\n§r§7${changes} updates ${f.holdTicks ? `| ⏳${f.holdTicks}` : ""}`);
        });
        form.button("§l§7Back");

        form.show(player).then(res => {
            if (res.canceled || res.selection === state.frames.length + 1) {
                if (backCallback) backCallback(player);
                return;
            }
            if (res.selection === 0) {
                menuMacros.showMacroMenu(player, (p) => this.showTimelineEditor(p, backCallback));
                return;
            }
            this.showFrameActions(player, res.selection - 1, backCallback);
        });
    }

    showFrameActions(player, index, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const frame = state.frames[index];
        const holdInfo = frame.holdTicks ? ` | Hold: ${frame.holdTicks}t` : "";

        const form = new ActionFormData()
            .title(`Frame #${index + 1} of ${state.frames.length}${holdInfo}`)
            .button("§l§a▶ STEP FORWARD\n§r§7Preview next frame")
            .button("§l§e◀ STEP BACK\n§r§7Preview previous frame")
            .button("§l§d🔄 OVERWRITE\n§r§7Re-capture slot")
            .button("§l§b✨ MORPH TWEEN\n§r§7Transition to next")
            .button("§l§6⏳ SET DELAY\n§r§7Hold ticks")
            .button("§l§c🗑️ DELETE")
            .button("§l§b👯 DUPLICATE")
            .button("§l§e⬆️ MOVE UP")
            .button("§l§e⬇️ MOVE DOWN")
            .button("§l§6✨ CINEMATIC FX\n§r§7Add sound, particles, cmds")
            .button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 10) { this.showTimelineEditor(player, backCallback); return; }
            switch (res.selection) {
                case 0: // Step Forward
                    if (index + 1 < state.frames.length) {
                        recordingEngine.previewFrame(player, index + 1);
                        this.showFrameActions(player, index + 1, backCallback);
                    } else {
                        Logger.warn(player, "Already at the last frame.");
                        this.showFrameActions(player, index, backCallback);
                    }
                    break;
                case 1: // Step Back
                    if (index - 1 >= 0) {
                        recordingEngine.previewFrame(player, index - 1);
                        this.showFrameActions(player, index - 1, backCallback);
                    } else {
                        Logger.warn(player, "Already at the first frame.");
                        this.showFrameActions(player, index, backCallback);
                    }
                    break;
                case 2: // Overwrite
                    recordingEngine.overwriteFrame(player, index);
                    this.showFrameActions(player, index, backCallback);
                    break;
                case 3: // Morph Tween
                    this.showMorphTweenMenu(player, index, backCallback);
                    break;
                case 4: // Set Frame Delay
                    this.showFrameDelayMenu(player, index, backCallback);
                    break;
                case 5: recordingEngine.deleteFrame(player, index); this.showTimelineEditor(player, backCallback); break;
                case 6: recordingEngine.duplicateFrame(player, index); this.showTimelineEditor(player, backCallback); break;
                case 7: recordingEngine.reorderFrame(player, index, index - 1); this.showTimelineEditor(player, backCallback); break;
                case 8: recordingEngine.reorderFrame(player, index, index + 1); this.showTimelineEditor(player, backCallback); break;
                case 9: menuFX.showFXMenu(player, index, (p) => this.showFrameActions(p, index, backCallback)); break;
            }
        });
    }

    showMorphTweenMenu(player, index, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (index >= state.frames.length - 1) {
            Logger.error(player, "Need a NEXT frame to morph target.");
            this.showFrameActions(player, index, backCallback);
            return;
        }

        const form = new ModalFormData()
            .title("✨ Morph Tween")
            .slider("Intermediate Frames", 2, 20, 1, 5);

        form.show(player).then(res => {
            if (res.canceled) { this.showFrameActions(player, index, backCallback); return; }
            const count = res.formValues[0];

            const frameA = state.frames[index];
            const frameB = state.frames[index + 1];

            const intermediate = TweenEngine.generateMorphFrames(frameA, frameB, count);

            // Insert into sequence
            state.frames.splice(index + 1, 0, ...intermediate);
            Logger.success(player, `Inserted §e${count}§a morph frames between §e${index + 1}§a and §e${index + 2}§a.`);
            this.showTimelineEditor(player, backCallback);
        });
    }

    showFrameDelayMenu(player, index, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;
        const currentHold = state.frames[index]?.holdTicks || 0;

        const form = new ModalFormData()
            .title(`Frame #${index + 1} Delay`)
            .slider("Hold Ticks (0 = default)", 0, 200, 1, currentHold);

        form.show(player).then(res => {
            if (res.canceled) { this.showFrameActions(player, index, backCallback); return; }
            const ticks = res.formValues[0];
            recordingEngine.setFrameDelay(player, index, ticks);
            this.showFrameActions(player, index, backCallback);
        });
    }

    showAnchorFrameMenu(player, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state || state.frames.length === 0) {
            Logger.error(player, "No frames to anchor.");
            if (backCallback) backCallback(player);
            return;
        }

        const lastFrame = state.frames[state.frames.length - 1];
        const currentHold = lastFrame.holdTicks || 0;

        const form = new ModalFormData()
            .title("⏳ Anchor / Hold Frame")
            .textField(`Frame #${state.frames.length} Hold Ticks`, "Ticks to pause", currentHold.toString());

        form.show(player).then(res => {
            if (res.canceled) { if (backCallback) backCallback(player); return; }
            const ticks = parseInt(res.formValues[0]);

            if (isNaN(ticks) || ticks < 0) {
                Logger.error(player, "Invalid tick count.");
                this.showAnchorFrameMenu(player, backCallback);
                return;
            }

            lastFrame.holdTicks = ticks;
            Logger.success(player, `Frame #${state.frames.length} will hold for §e${ticks}§r ticks.`);
            if (backCallback) backCallback(player);
        });
    }
}

export const menuTimeline = new MenuTimeline();
