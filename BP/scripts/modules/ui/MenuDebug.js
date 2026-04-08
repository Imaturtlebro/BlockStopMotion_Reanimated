import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { ExportManager } from "./ExportManager.js";
import { SequenceVault } from "../core/SequenceVault.js";
import { menuDirector } from "./MenuDirector.js";

export class MenuDebug {

    showDevToolsMenu(player) {
        console.warn(`[BSM][MenuDebug] showDevToolsMenu for ${player.name}`);
        const form = new ActionFormData()
            .title("\u00a7l\u00a76\ud83d\udee0\ufe0f DEV TOOLS")
            .body("\u00a77Manage system logic and data.")
            .button("\u00a7l\u00a7e📦 ASSET MANAGER\n\u00a7r\u00a77Manage Production Assets")
            .button("\u00a7l\u00a7a\ud83d\udce4 EXPORT TO DISK\n\u00a7r\u00a77Send animation to content log")
            .button("\u00a7l\u00a77BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 2) { menuDirector.showMainMenu(player); return; }
            if (res.selection === 0) {
                // Must explicitly import menuAssets here or at top
                import("./MenuAssets.js").then(m => m.menuAssets.showAssetManager(player));
            }
            if (res.selection === 1) this.showExportMenu(player);
        });
    }

    showExportMenu(player) {
        const animations = SequenceVault.listAnimations();
        if (animations.length === 0) {
            Logger.warn(player, "No animations to export.");
            this.showDevToolsMenu(player);
            return;
        }

        const form = new ModalFormData()
            .title("\u00a7l\u00a7a\ud83d\udce4 EXPORT PREFAB")
            .dropdown("Select Animation", animations);

        form.show(player).then(res => {
            if (res.canceled) {
                console.warn(`[KFA][MenuDebug] showExportMenu canceled`);
                this.showDevToolsMenu(player); return;
            }
            const animId = animations[res.formValues[0]];
            console.warn(`[KFA][MenuDebug] Starting export process for: ${animId}`);
            ExportManager.exportAnimation(player, animId);
            // Return to dev tools after a short delay
            this.showDevToolsMenu(player);
        });
    }
}

export const menuDebug = new MenuDebug();
