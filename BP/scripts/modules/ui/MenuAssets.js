import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { SequenceVault } from "../core/SequenceVault.js";
import { ExportManager } from "./ExportManager.js";
import { renderCore } from "../core/RenderCore.js";
import { menuDirector } from "./MenuDirector.js";

export class MenuAssets {

    showAssetManager(player) {
        const animations = SequenceVault.listAnimations();
        const form = new ActionFormData()
            .title("§l§6📦 ASSET REGISTRY")
            .body(`Manage your Production Assets.\nTotal Saved: §e${animations.length}`);

        if (animations.length === 0) {
            form.button("§l§7(No Assets Found)");
        } else {
            animations.forEach(anim => {
                form.button(`§l§e📦 ${anim}`);
            });
        }
        form.button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === animations.length || animations.length === 0) {
                menuDirector.showMainMenu(player); // or Dev Tools
                return;
            }
            const selectedAnim = animations[res.selection];
            this.showAssetActions(player, selectedAnim);
        });
    }

    showAssetActions(player, animId) {
        const form = new ActionFormData()
            .title(`Asset: ${animId}`)
            .button("§l§a✨ INSTANTIATE PREFAB\n§r§7Spawn in world")
            .button("§l§b✏️ RENAME\n§r§7Change asset name")
            .button("§l§d📤 EXPORT TO DISK\n§r§7Send to content log")
            .button("§l§c🗑️ DELETE\n§r§7Remove from database")
            .button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 4) {
                this.showAssetManager(player);
                return;
            }
            switch (res.selection) {
                case 0: this.showInstantiateMenu(player, animId); break;
                case 1: this.showRenameMenu(player, animId); break;
                case 2: ExportManager.exportAnimation(player, animId); this.showAssetManager(player); break;
                case 3: this.showDeleteConfirm(player, animId); break;
            }
        });
    }

    showInstantiateMenu(player, animId) {
        const sel = menuDirector.getSelection(player);
        const l = player.location;
        const defaultPos = (sel && sel.pos1) ? `${sel.pos1.x} ${sel.pos1.y} ${sel.pos1.z}` : `${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)}`;
        
        const form = new ModalFormData()
            .title("Spawn Prefab")
            .textField("Target Coordinates (X Y Z)", defaultPos, defaultPos)
            .dropdown("Rotation", ["0°", "90°", "180°", "270°"], 0);

        form.show(player).then(res => {
            if (res.canceled) {
                this.showAssetActions(player, animId);
                return;
            }
            const [posStr, rotIdx] = res.formValues;
            const parts = posStr.trim().split(" ");
            if (parts.length < 3) {
                Logger.error(player, "Invalid coordinates.");
                return;
            }
            const loc = { x: parseInt(parts[0]), y: parseInt(parts[1]), z: parseInt(parts[2]) };
            const rotation = rotIdx * 90;

            renderCore.instantiatePrefab(player, animId, loc, rotation);
        });
    }

    showRenameMenu(player, animId) {
        const form = new ModalFormData()
            .title("Rename Asset")
            .textField("New Name", animId, animId);

        form.show(player).then(res => {
            if (res.canceled) {
                this.showAssetActions(player, animId);
                return;
            }
            const newName = res.formValues[0].trim();
            if (newName && newName !== animId) {
                const data = SequenceVault.load(animId);
                if (data) {
                    SequenceVault.save(newName, data);
                    SequenceVault.delete(animId);
                    Logger.success(player, `Renamed '§e${animId}§f' to '§a${newName}§f'`);
                }
            }
            this.showAssetManager(player);
        });
    }

    showDeleteConfirm(player, animId) {
        const form = new ActionFormData()
            .title(`Delete ${animId}?`)
            .body(`§cWARNING:§r This will permanently delete the asset '§e${animId}§r' from the database.`)
            .button("§l§cYES, DELETE")
            .button("§l§aCANCEL");

        form.show(player).then(res => {
            if (res.selection === 0) {
                SequenceVault.delete(animId);
                Logger.success(player, `Deleted asset: §e${animId}`);
            }
            this.showAssetManager(player);
        });
    }
}

export const menuAssets = new MenuAssets();
