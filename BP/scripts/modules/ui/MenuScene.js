import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { SequenceVault } from "../core/SequenceVault.js";
import { sceneManager } from "../core/SceneManager.js";

/**
 * MenuScene handles the creation and playback of multi-track scenes.
 */
class MenuScene {
    constructor() { }

    showSceneMenu(player, backCallback) {
        const sceneIds = SequenceVault.getAllSceneIds();

        const form = new ActionFormData()
            .title("🎬 Scene Sequencer")
            .body(`§7Composite multiple animations into one master scene.`)
            .button("§l§a✨ CREATE NEW SCENE\n§r§7Define tracks & delays")
            .button("§l§b📂 MANAGE SCENES\n§r§7Edit existing track data")
            .button("§l§7BACK");

        if (sceneIds.length > 0) {
            form.button("§l§e▶️ PLAY SCENE\n§r§7Trigger a saved sequence");
        }

        form.show(player).then(res => {
            if (res.canceled || res.selection === 2) {
                if (backCallback) backCallback(player);
                return;
            }

            if (res.selection === 0) {
                this.showCreateSceneMenu(player, () => this.showSceneMenu(player, backCallback));
            } else if (res.selection === 1) {
                this.showSceneList(player, (sceneId) => this.showEditSceneMenu(player, sceneId, () => this.showSceneMenu(player, backCallback)), () => this.showSceneMenu(player, backCallback));
            } else if (res.selection === 3) {
                this.showPlaySceneMenu(player, () => this.showSceneMenu(player, backCallback));
            }
        });
    }

    showCreateSceneMenu(player, backCallback) {
        const form = new ModalFormData()
            .title("✨ Create New Scene")
            .textField("Scene ID (unique)", "e.g. Vault_Open")
            .textField("Animation ID (Track 1)", "e.g. Left_Door");

        form.show(player).then(res => {
            if (res.canceled) {
                backCallback();
                return;
            }

            const id = res.formValues[0].trim();
            const animId = res.formValues[1].trim();

            if (!id || !animId) {
                Logger.error(player, "ID and first track required.");
                backCallback();
                return;
            }

            const tracks = [{ animId, offset: [0, 0, 0], delayTicks: 0, mode: "once", easing: "linear" }];
            sceneManager.createScene(id, tracks);
            Logger.success(player, `Scene §e${id}§a created with 1 track.`);
            this.showEditSceneMenu(player, id, backCallback);
        });
    }

    showSceneList(player, onSelect, backCallback) {
        const sceneIds = SequenceVault.getAllSceneIds();
        if (sceneIds.length === 0) {
            Logger.warn(player, "No scenes found.");
            backCallback();
            return;
        }

        const form = new ActionFormData()
            .title("📂 Saved Scenes");
        
        sceneIds.forEach(id => form.button(`§l${id}`));
        form.button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === sceneIds.length) {
                backCallback();
                return;
            }
            onSelect(sceneIds[res.selection]);
        });
    }

    showEditSceneMenu(player, sceneId, backCallback) {
        const scene = SequenceVault.loadScene(sceneId);
        if (!scene) return;

        const form = new ActionFormData()
            .title(`🛠️ Editing: ${sceneId}`)
            .body(`§7Tracks: §e${scene.tracks.length}`)
            .button("§l§a➕ ADD TRACK")
            .button("§l§c🗑️ DELETE SCENE")
            .button("§l§7BACK");

        scene.tracks.forEach((t, i) => {
            form.button(`§lTrack ${i + 1}§r\n§7${t.animId} (T:${t.delayTicks})`);
        });

        form.show(player).then(res => {
            if (res.canceled || res.selection === 2) {
                backCallback();
                return;
            }

            if (res.selection === 0) {
                this.showAddTrackMenu(player, sceneId, () => this.showEditSceneMenu(player, sceneId, backCallback));
            } else if (res.selection === 1) {
                SequenceVault.deleteScene(sceneId);
                Logger.info(player, "Scene deleted.");
                backCallback();
            } else {
                const trackIdx = res.selection - 3;
                this.showEditTrackMenu(player, sceneId, trackIdx, () => this.showEditSceneMenu(player, sceneId, backCallback));
            }
        });
    }

    showAddTrackMenu(player, sceneId, backCallback) {
        const form = new ModalFormData()
            .title("➕ Add Track")
            .textField("Animation ID", "anim_id")
            .textField("Offset X,Y,Z", "0,0,0", "0,0,0")
            .textField("Delay (Ticks)", "0", "0")
            .dropdown("Mode", ["once", "loop", "reverse", "reverse-loop"], 0)
            .dropdown("Easing", ["linear", "ease-in", "ease-out", "ease-in-out", "bounce", "elastic", "back"], 0);

        form.show(player).then(res => {
            if (res.canceled) {
                backCallback();
                return;
            }

            const animId = res.formValues[0].trim();
            const offset = res.formValues[1].split(',').map(n => parseFloat(n) || 0);
            const delay = parseInt(res.formValues[2]) || 0;
            const mode = ["once", "loop", "reverse", "reverse-loop"][res.formValues[3]];
            const easing = ["linear", "ease-in", "ease-out", "ease-in-out", "bounce", "elastic", "back"][res.formValues[4]];

            const scene = SequenceVault.loadScene(sceneId);
            scene.tracks.push({ animId, offset, delayTicks: delay, mode, easing });
            SequenceVault.saveScene(sceneId, scene);

            Logger.success(player, `Track added to ${sceneId}.`);
            backCallback();
        });
    }

    showEditTrackMenu(player, sceneId, trackIdx, backCallback) {
        const scene = SequenceVault.loadScene(sceneId);
        const t = scene.tracks[trackIdx];

        const form = new ModalFormData()
            .title(`Edit Track ${trackIdx + 1}`)
            .textField("Animation ID", t.animId, t.animId)
            .textField("Offset X,Y,Z", t.offset.join(','), t.offset.join(','))
            .textField("Delay (Ticks)", t.delayTicks.toString(), t.delayTicks.toString())
            .dropdown("Mode", ["once", "loop", "reverse", "reverse-loop"], ["once", "loop", "reverse", "reverse-loop"].indexOf(t.mode || "once"))
            .dropdown("Easing", ["linear", "ease-in", "ease-out", "ease-in-out", "bounce", "elastic", "back"], ["linear", "ease-in", "ease-out", "ease-in-out", "bounce", "elastic", "back"].indexOf(t.easing || "linear"))
            .toggle("Remove Track", false);

        form.show(player).then(res => {
            if (res.canceled) {
                backCallback();
                return;
            }

            if (res.formValues[5]) {
                scene.tracks.splice(trackIdx, 1);
            } else {
                scene.tracks[trackIdx] = {
                    animId: res.formValues[0].trim(),
                    offset: res.formValues[1].split(',').map(n => parseFloat(n) || 0),
                    delayTicks: parseInt(res.formValues[2]) || 0,
                    mode: ["once", "loop", "reverse", "reverse-loop"][res.formValues[3]],
                    easing: ["linear", "ease-in", "ease-out", "ease-in-out", "bounce", "elastic", "back"][res.formValues[4]]
                };
            }

            SequenceVault.saveScene(sceneId, scene);
            backCallback();
        });
    }

    showPlaySceneMenu(player, backCallback) {
        const sceneIds = SequenceVault.getAllSceneIds();
        if (sceneIds.length === 0) {
            backCallback();
            return;
        }

        const form = new ActionFormData()
            .title("▶️ Play Scene");

        sceneIds.forEach(id => form.button(id));
        form.button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === sceneIds.length) {
                backCallback();
                return;
            }

            const selection = sceneIds[res.selection];
            sceneManager.playScene(selection, player.location, player);
            backCallback();
        });
    }
}

export const menuScene = new MenuScene();
