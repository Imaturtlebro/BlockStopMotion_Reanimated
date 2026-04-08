import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { recordingEngine } from "../core/RecordingEngine.js";

/**
 * MenuFX handles the "FX Studio" where users can inject sounds, particles, and commands into frames.
 */
class MenuFX {
    constructor() { }

    showFXMenu(player, frameIndex, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;
        const frame = state.frames[frameIndex];
        if (!frame) return;

        if (!frame.events) frame.events = [];

        const form = new ActionFormData()
            .title(`✨ FX Studio: Frame #${frameIndex + 1}`)
            .body(`§7Inject cinematic triggers into this frame.\n§8Events: §e${frame.events.length}`)
            .button("§l§a➕ ADD SOUND\n§r§7Trigger audio clip")
            .button("§l§b➕ ADD PARTICLE\n§r§7Spawn VFX emitter")
            .button("§l§d➕ ADD COMMAND\n§r§7Run custom scriptevent/cmd")
            .button("§l§e📋 SPREAD FX\n§r§7Sync to all/range")
            .button("§l§c🗑️ CLEAR ALL FX")
            .button("§l§7BACK");

        // List existing events as buttons for editing/removal
        frame.events.forEach((ev, i) => {
            let label = `[${ev.type.toUpperCase()}] ${ev.id || ev.value || "Unknown"}`;
            if (label.length > 25) label = label.substring(0, 22) + "...";
            form.button(`§8${i + 1}. §f${label}`);
        });

        form.show(player).then(res => {
            if (res.canceled || res.selection === 4) {
                backCallback(player);
                return;
            }

            switch (res.selection) {
                case 0: this.showAddSoundMenu(player, frame, () => this.showFXMenu(player, frameIndex, backCallback)); break;
                case 1: this.showAddParticleMenu(player, frame, () => this.showFXMenu(player, frameIndex, backCallback)); break;
                case 2: this.showAddCommandMenu(player, frame, () => this.showFXMenu(player, frameIndex, backCallback)); break;
                case 3: this.showSpreadMenu(player, frameIndex, () => this.showFXMenu(player, frameIndex, backCallback)); break;
                case 4: frame.events = []; Logger.info(player, "Cleared all FX from frame."); this.showFXMenu(player, frameIndex, backCallback); break;
                default:
                    const eventIdx = res.selection - 6;
                    this.showEditEventMenu(player, frame, eventIdx, () => this.showFXMenu(player, frameIndex, backCallback));
                    break;
            }
        });
    }

    showSpreadMenu(player, frameIndex, backCallback) {
        const state = recordingEngine.activeCaptures.get(player.id);
        const frame = state.frames[frameIndex];
        if (!frame.events || frame.events.length === 0) {
            Logger.error(player, "No events on this frame to spread.");
            backCallback();
            return;
        }

        const form = new ModalFormData()
            .title("📋 Spread FX to Range")
            .textField("Start Frame", "1", "1")
            .textField("End Frame", state.frames.length.toString(), state.frames.length.toString())
            .toggle("Overwrite existing events?", false);

        form.show(player).then(res => {
            if (res.canceled) { backCallback(); return; }
            const start = Math.max(0, parseInt(res.formValues[0]) - 1);
            const end = Math.min(state.frames.length - 1, parseInt(res.formValues[1]) - 1);
            const overwrite = res.formValues[2];

            for (let i = start; i <= end; i++) {
                if (i === frameIndex) continue;
                const targetFrame = state.frames[i];
                if (overwrite) targetFrame.events = JSON.parse(JSON.stringify(frame.events));
                else {
                    if (!targetFrame.events) targetFrame.events = [];
                    targetFrame.events.push(...JSON.parse(JSON.stringify(frame.events)));
                }
            }

            Logger.success(player, `Spread FX across §e${end - start + 1}§a frames.`);
            backCallback();
        });
    }

    showAddSoundMenu(player, frame, backCallback) {
        const form = new ModalFormData()
            .title("➕ Add Sound Event")
            .textField("Sound ID", "e.g. random.explode")
            .textField("Volume", "1.0", "1.0")
            .textField("Pitch", "1.0", "1.0")
            .textField("Offset X,Y,Z", "0,2,0", "0,0,0");

        form.show(player).then(res => {
            if (res.canceled) { backCallback(); return; }
            const [id, vol, pitch, offset] = res.formValues;
            const relPos = offset.split(',').map(n => parseFloat(n) || 0);

            frame.events.push({
                type: "sound",
                id: id.trim(),
                volume: parseFloat(vol) || 1.0,
                pitch: parseFloat(pitch) || 1.0,
                relPos
            });

            Logger.success(player, `Sound §e${id}§a added.`);
            backCallback();
        });
    }

    showAddParticleMenu(player, frame, backCallback) {
        const form = new ModalFormData()
            .title("➕ Add Particle Event")
            .textField("Particle ID", "e.g. minecraft:large_flame")
            .textField("Count", "1", "1")
            .textField("Offset X,Y,Z", "0,0,0", "0,0,0");

        form.show(player).then(res => {
            if (res.canceled) { backCallback(); return; }
            const [id, count, offset] = res.formValues;
            const relPos = offset.split(',').map(n => parseFloat(n) || 0);

            frame.events.push({
                type: "particle",
                id: id.trim(),
                count: parseInt(count) || 1,
                relPos
            });

            Logger.success(player, `Particle §e${id}§a added.`);
            backCallback();
        });
    }

    showAddCommandMenu(player, frame, backCallback) {
        const form = new ModalFormData()
            .title("➕ Add Command Event")
            .textField("Command", "/summon lightning_bolt <x> <y> <z>")
            .textField("Offset X,Y,Z", "0,0,0", "0,0,0")
            .body("§8Use <x>, <y>, <z> as placeholders for the calculated world position.");

        form.show(player).then(res => {
            if (res.canceled) { backCallback(); return; }
            const [cmd, offset] = res.formValues;
            const relPos = offset.split(',').map(n => parseFloat(n) || 0);

            frame.events.push({
                type: "command",
                value: cmd.trim(),
                relPos
            });

            Logger.success(player, "Command event added.");
            backCallback();
        });
    }

    showEditEventMenu(player, frame, index, backCallback) {
        const ev = frame.events[index];
        if (!ev) return;

        const form = new ActionFormData()
            .title(`Edit Event #${index + 1}`)
            .body(`Type: §e${ev.type.toUpperCase()}\n§rID/Value: §7${ev.id || ev.value}`)
            .button("§l§c🗑️ REMOVE EVENT")
            .button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 1) { backCallback(); return; }
            if (res.selection === 0) {
                frame.events.splice(index, 1);
                Logger.info(player, "Event removed.");
                backCallback();
            }
        });
    }
}

export const menuFX = new MenuFX();
