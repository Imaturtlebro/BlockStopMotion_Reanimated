import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { renderCore } from "../core/RenderCore.js";
import { menuDirector } from "./MenuDirector.js";
import { SequenceVault } from "../core/SequenceVault.js";

export class MenuRenderer {

    showPlayMenu(player, block = null) {
        const animations = SequenceVault.listAnimations();

        const form = new ActionFormData()
            .title("Â§lÂ§aâ–¶ PLAYBACK BROWSER")
            .body(`Â§7Found Â§e${animations.length}Â§7 saved animations.`);

        form.button("Â§lÂ§9âž• EXTERNAL IMPORT\nÂ§rÂ§7Load from DevTools");

        animations.forEach(id => {
            form.button(`Â§l${id.toUpperCase()}\nÂ§rÂ§7Recorded Project`);
        });

        form.button("Â§lÂ§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === animations.length + 1) {
                menuDirector.showMainMenu(player, block);
                return;
            }

            if (res.selection === 0) {
                Logger.info(player, "Use DevTools to import JSON files.");
                this.showPlayMenu(player, block);
                return;
            }

            const selectedId = animations[res.selection - 1];
            this.showAnimationActions(player, selectedId, block);
        });
    }

    showAnimationActions(player, animId, block = null) {
        const form = new ActionFormData()
            .title(`Â§l${animId.toUpperCase()}`)
            .button("Â§lÂ§aâ–¶ QUICK PLAY\nÂ§rÂ§7Instantly play animation") // 0
            .button("Â§lÂ§eâš™ï¸ PLAY OPTIONS\nÂ§rÂ§7Speed, Loop, Cinematic") // 1
            .button("Â§lÂ§bðŸ“ RENAME\nÂ§rÂ§7Change ID") // 2
            .button("Â§lÂ§dðŸ‘¯ DUPLICATE\nÂ§rÂ§7Create copy") // 3
            .button("Â§lÂ§cðŸ—‘ï¸ DELETE\nÂ§rÂ§7Permanently remove") // 4
            .button("Â§lÂ§7BACK"); // 5

        form.show(player).then(res => {
            if (res.canceled || res.selection === 5) {
                this.showPlayMenu(player, block);
                return;
            }

            switch (res.selection) {
                case 0:
                    renderCore.playAtLocation(player.dimension, player.location, animId, "once", player);
                    break;
                case 1:
                    this.showSpeedPlayMenu(player, animId, block);
                    break;
                case 2:
                    this.showRenameMenu(player, animId, block);
                    break;
                case 3:
                    this.showDuplicateMenu(player, animId, block);
                    break;
                case 4:
                    this.confirmDelete(player, animId, block);
                    break;
            }
        });
    }

    showSpeedPlayMenu(player, animId, block = null) {
        const easingTypes = ["linear", "ease-in", "ease-out", "ease-in-out"];
        const modes = ["once", "loop", "ping-pong", "reverse"];
        const form = new ModalFormData()
            .title(`Speed Play: ${animId}`)
            .dropdown("Mode", modes, 0)
            .slider("Speed Multiplier", 0.25, 5, 0.25, 1)
            .dropdown("Easing", easingTypes, 0)
            .toggle("Cinematic Mode (Entity Shells)", false);

        form.show(player).then(res => {
            if (res.canceled) { this.showAnimationActions(player, animId, block); return; }
            const [modeIdx, speed, easeIdx, cinematic] = res.formValues;
            renderCore.playAtLocation(
                player.dimension, player.location, animId,
                modes[modeIdx], player, easingTypes[easeIdx], speed, null, false, null, cinematic
            );
        });
    }


    showRenameMenu(player, animId, block = null) {
        const form = new ModalFormData()
            .title(`Rename: ${animId}`)
            .textField("New Name", "MyNewName", animId);

        form.show(player).then(res => {
            if (res.canceled) { this.showAnimationActions(player, animId, block); return; }
            const newName = res.formValues[0]?.trim();
            if (!newName || newName === animId) { this.showAnimationActions(player, animId, block); return; }

            if (SequenceVault.rename(animId, newName)) {
                Logger.success(player, `Renamed Â§e${animId}Â§f to Â§e${newName}Â§f.`);
                this.showPlayMenu(player, block);
            } else {
                Logger.error(player, "Rename failed.");
                this.showAnimationActions(player, animId, block);
            }
        });
    }

    showDuplicateMenu(player, animId, block = null) {
        const form = new ModalFormData()
            .title(`Duplicate: ${animId}`)
            .textField("Copy Name", "MyAnimation_Copy", `${animId}_copy`);

        form.show(player).then(res => {
            if (res.canceled) { this.showAnimationActions(player, animId, block); return; }
            const newName = res.formValues[0]?.trim();
            if (!newName) { this.showAnimationActions(player, animId, block); return; }

            if (SequenceVault.duplicate(animId, newName)) {
                Logger.success(player, `Duplicated Â§e${animId}Â§f as Â§e${newName}Â§f.`);
                this.showPlayMenu(player, block);
            } else {
                Logger.error(player, "Duplication failed.");
                this.showAnimationActions(player, animId, block);
            }
        });
    }

    confirmDelete(player, animId, block = null) {
        const form = new ModalFormData()
            .title("Confirm Deletion")
            .body(`Are you sure you want to delete Â§l${animId}Â§r? This cannot be undone.`)
            .toggle("I understand", false);

        form.show(player).then(res => {
            if (!res.canceled && res.formValues[0]) {
                SequenceVault.delete(animId);
                Logger.success(player, `Deleted Â§e${animId}Â§f.`);
            }
            this.showPlayMenu(player, block);
        });
    }

}
export const menuRenderer = new MenuRenderer();
