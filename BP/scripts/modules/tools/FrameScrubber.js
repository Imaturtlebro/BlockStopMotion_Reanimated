import { world, system } from "@minecraft/server";
import { SequenceVault } from "../core/SequenceVault.js";
import { phantomRenderer } from "../ui/PhantomRenderer.js";
import { Logger } from "../utils/Logger.js";

import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { NodeDataManager } from "../core/NodeDataManager.js";

export class FrameScrubber {
    constructor() {
        this.activeScrubbers = new Map(); // PlayerId -> { animId, currentFrame, lastSlot }
    }

    handleClockUse(player) {
        if (this.activeScrubbers.has(player.id)) {
            if (player.isSneaking) {
                this.stopScrubbing(player);
            } else {
                this.showFrameSettings(player);
            }
            return;
        }

        const anims = SequenceVault.listAnimations();
        if (anims.length === 0) {
            Logger.warn(player, "No saved animations to scrub!");
            return;
        }

        const form = new ActionFormData()
            .title("\u00a7l\u00a7bTimeline Scrubber")
            .body("\u00a77Select an animation to preview and scrub.");

        anims.forEach(anim => form.button(`\u00a7l\u00a7e${anim}\n\u00a7r\u00a77Click to scrub`));

        form.show(player).then(res => {
            if (res.canceled) return;
            this.startScrubbing(player, anims[res.selection]);
        }).catch(e => console.error(`[BSM][FrameScrubber] UI error: ${e}`));
    }

    handleClockUseOn(player, block) {
        if (this.activeScrubbers.has(player.id)) {
            if (player.isSneaking) {
                this.stopScrubbing(player);
            } else {
                this.showFrameSettings(player);
            }
            return;
        }

        const data = NodeDataManager.getBlockData(block);
        if (data && data.animationId) {
            this.startScrubbing(player, data.animationId);
        } else {
            this.handleClockUse(player);
        }
    }

    startScrubbing(player, animId) {
        console.warn(`[BSM][FrameScrubber] startScrubbing: animId=${animId}, player=${player.name}`);
        const animation = SequenceVault.load(animId);
        if (!animation) {
            console.warn(`[BSM][FrameScrubber] Animation '${animId}' NOT FOUND`);
            return;
        }

        this.activeScrubbers.set(player.id, {
            animId: animId,
            data: animation,
            currentFrame: 0,
            lastSlot: player.selectedSlotIndex
        });

        Logger.info(player, `\u00a7bTimeline Viewer\u00a7f active for \u00a7l${animId}\u00a7r.`);
        Logger.info(player, `\u00a77Hold \u00a7eClock\u00a77 & \u00a7eSneak\u00a77, then scroll hotbar to scrub.`);

        // Show initial frame
        this.preview(player);
    }

    stopScrubbing(player) {
        if (this.activeScrubbers.has(player.id)) {
            this.activeScrubbers.delete(player.id);
            Logger.info(player, "\u00a7bTimeline Viewer\u00a7f disabled.");
        }
    }

    tick() {
        for (const player of world.getAllPlayers()) {
            const scrubber = this.activeScrubbers.get(player.id);
            if (!scrubber) continue;

            // Check if holding tool (Clock)
            const inventory = player.getComponent("inventory").container;
            const item = inventory.getItem(player.selectedSlotIndex);

            if (item?.typeId !== "bsm:scrubber_tool") continue;
            if (!player.isSneaking) {
                scrubber.lastSlot = player.selectedSlotIndex;
                continue;
            }

            // Check for slot change while sneaking
            if (player.selectedSlotIndex !== scrubber.lastSlot) {
                const diff = player.selectedSlotIndex - scrubber.lastSlot;

                let frameShift = diff;
                if (diff === -8) frameShift = 1;
                if (diff === 8) frameShift = -1;

                scrubber.currentFrame = (scrubber.currentFrame + frameShift + scrubber.data.frames.length) % scrubber.data.frames.length;
                scrubber.lastSlot = player.selectedSlotIndex;

                this.preview(player);
            }
        }
    }

    preview(player) {
        const scrubber = this.activeScrubbers.get(player.id);
        if (!scrubber) return;

        const frame = scrubber.data.frames[scrubber.currentFrame];
        const previewPos = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };

        phantomRenderer.previewFrame(player, frame, previewPos, scrubber.data.palette);
        const holdText = frame.holdTicks ? ` \u00a76[HOLD: ${frame.holdTicks}]` : "";
        player.onScreenDisplay.setActionBar(`\u00a7bTimeline\u00a7f: Frame \u00a7e${scrubber.currentFrame + 1}\u00a7f / \u00a77${scrubber.data.frames.length}${holdText}`);
    }

    deleteCurrentFrame(player) {
        const scrubber = this.activeScrubbers.get(player.id);
        if (!scrubber || scrubber.data.frames.length <= 1) {
            Logger.warn(player, "Cannot delete the last remaining frame.");
            return;
        }

        scrubber.data.frames.splice(scrubber.currentFrame, 1);
        scrubber.currentFrame = Math.min(scrubber.currentFrame, scrubber.data.frames.length - 1);
        SequenceVault.save(scrubber.animId, scrubber.data);
        this.preview(player);
        Logger.success(player, "Frame deleted.");
    }

    duplicateCurrentFrame(player) {
        const scrubber = this.activeScrubbers.get(player.id);
        if (!scrubber) return;

        const frameCopy = JSON.parse(JSON.stringify(scrubber.data.frames[scrubber.currentFrame]));
        scrubber.data.frames.splice(scrubber.currentFrame + 1, 0, frameCopy);
        scrubber.currentFrame++;
        SequenceVault.save(scrubber.animId, scrubber.data);
        this.preview(player);
        Logger.success(player, "Frame duplicated.");
    }

    moveFrame(player, direction) {
        const scrubber = this.activeScrubbers.get(player.id);
        if (!scrubber) return;

        const oldIdx = scrubber.currentFrame;
        const newIdx = oldIdx + direction;
        if (newIdx < 0 || newIdx >= scrubber.data.frames.length) return;

        const frame = scrubber.data.frames.splice(oldIdx, 1)[0];
        scrubber.data.frames.splice(newIdx, 0, frame);
        scrubber.currentFrame = newIdx;
        SequenceVault.save(scrubber.animId, scrubber.data);
        this.preview(player);
        Logger.info(player, `Frame moved to position \u00a7e${newIdx + 1}\u00a7f.`);
    }

    getFrameDiff(player) {
        const scrubber = this.activeScrubbers.get(player.id);
        if (!scrubber) return "No active session.";

        const frame = scrubber.data.frames[scrubber.currentFrame];
        const changes = [];
        let total = 0;

        for (const [key, paletteIdx] of Object.entries(frame)) {
            if (key === "commands" || key === "offset" || key === "boxSize" || key === "effects" || key === "holdTicks") continue;
            total++;
            const p = scrubber.data.palette[paletteIdx];
            changes.push(`\u00a77- \u00a7f${p.type}`);
            if (changes.length > 10) {
                changes.push(`\u00a77...and ${Object.keys(frame).length - 10} more`);
                break;
            }
        }

        return `\u00a7bFrame ${scrubber.currentFrame + 1} Diff\u00a7r\n\u00a77Total Changes: \u00a7e${total}\u00a7r\n${changes.join('\n')}`;
    }

    showFrameSettings(player) {
        const scrubber = this.activeScrubbers.get(player.id);
        if (!scrubber) return;

        const frame = scrubber.data.frames[scrubber.currentFrame];
        const form = new ModalFormData()
            .title(`\u00a7lFrame #${scrubber.currentFrame + 1} Settings`)
            .textField("Hold Ticks (Pause on this frame)", "e.g. 20", (frame.holdTicks || 0).toString())
            .toggle("\u00a7cDelete Frame", false);

        form.show(player).then(res => {
            if (res.canceled) return;
            const [holdStr, del] = res.formValues;

            if (del) {
                this.deleteCurrentFrame(player);
                return;
            }

            const hold = parseInt(holdStr);
            if (!isNaN(hold) && hold >= 0) {
                frame.holdTicks = hold;
                SequenceVault.save(scrubber.animId, scrubber.data);
                Logger.success(player, `Frame #${scrubber.currentFrame + 1} hold updated: \u00a7e${hold}\u00a7r ticks.`);
                this.preview(player);
            }
        });
    }
}

export const frameScrubber = new FrameScrubber();

// Run tick
system.runInterval(() => {
    frameScrubber.tick();
}, 2);
