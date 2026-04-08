import { world, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";

/**
 * ToolHandler manages event routing for BSM tactile tools.
 */
export class ToolHandler {
    constructor(menuDirector, recordingEngine, frameScrubber) {
        this.menuDirector = menuDirector;
        this.recordingEngine = recordingEngine;
        this.frameScrubber = frameScrubber;
        this.nudgeHammerSettings = new Map();
    }

    getNudgeHammerSettings(playerId) {
        if (!this.nudgeHammerSettings.has(playerId)) {
            this.nudgeHammerSettings.set(playerId, {
                east: 1,
                west: 1,
                up: 1,
                down: 1,
                south: 1,
                north: 1
            });
        }

        return this.nudgeHammerSettings.get(playerId);
    }

    showNudgeHammerConfig(player) {
        const settings = this.getNudgeHammerSettings(player.id);
        const form = new ModalFormData()
            .title("Nudge Hammer Config")
            .textField("East (+X)", "1", settings.east.toString())
            .textField("West (-X)", "1", settings.west.toString())
            .textField("Up (+Y)", "1", settings.up.toString())
            .textField("Down (-Y)", "1", settings.down.toString())
            .textField("South (+Z)", "1", settings.south.toString())
            .textField("North (-Z)", "1", settings.north.toString());

        form.show(player).then(res => {
            if (res.canceled) return;

            const [east, west, up, down, south, north] = res.formValues.map(value => parseInt(value, 10));
            const values = { east, west, up, down, south, north };
            const hasInvalid = Object.values(values).some(value => Number.isNaN(value) || value < 0);

            if (hasInvalid) {
                Logger.error(player, "Enter whole numbers 0 or higher for all hammer directions.");
                system.run(() => this.showNudgeHammerConfig(player));
                return;
            }

            this.nudgeHammerSettings.set(player.id, values);
            Logger.success(player, "Nudge Hammer direction values updated for this session.");
        }).catch(e => {
            Logger.trace("Tool", "ToolHandler.showNudgeHammerConfig", null, e);
        });
    }

    getNudgeHammerOffset(player, face) {
        const settings = this.getNudgeHammerSettings(player.id);

        switch (face) {
            case "Up": return { dx: 0, dy: settings.up, dz: 0 };
            case "Down": return { dx: 0, dy: -settings.down, dz: 0 };
            case "North": return { dx: 0, dy: 0, dz: -settings.north };
            case "South": return { dx: 0, dy: 0, dz: settings.south };
            case "East": return { dx: settings.east, dy: 0, dz: 0 };
            case "West": return { dx: -settings.west, dy: 0, dz: 0 };
            default: return { dx: 0, dy: 0, dz: 0 };
        }
    }

    /**
     * Handles world.beforeEvents.itemUse
     */
    handleItemUse(ev) {
        const item = ev.itemStack;
        if (!item) return;
        const player = ev.source;

        // Custom BSM Tool Handling
        switch (item.typeId) {
            case "bsm:wand_tool":
                ev.cancel = true;
                console.warn(`[BSM][ToolHandler] Wand used by ${player.name}`);
                system.run(() => {
                    this.menuDirector.setSelection(player, player.location, player.isSneaking ? 2 : 1);
                    Logger.info(player, `Selection Point ${player.isSneaking ? 2 : 1} Set!`);
                });
                break;

            case "bsm:scrubber_tool":
                ev.cancel = true;
                system.run(() => this.frameScrubber.handleClockUse(player));
                break;

            case "bsm:remote_shutter":
                ev.cancel = true;
                console.warn(`[BSM][ToolHandler] Remote Shutter used by ${player.name}`);
                system.run(() => {
                    const state = this.recordingEngine.activeCaptures.get(player.id);
                    if (state) {
                        this.recordingEngine.captureFrame(player, true);
                    } else {
                        player.sendMessage("Â§cNo active recording. Start one in the menu!");
                    }
                });
                break;

            case "bsm:playback_tool":
                ev.cancel = true;
                system.run(() => {
                    const state = this.recordingEngine.activeCaptures.get(player.id);
                    if (state) {
                        this.recordingEngine.playLivePreview(player);
                    } else {
                        import("../ui/MenuRenderer.js").then(m => m.menuRenderer.showPlayMenu(player));
                    }
                });
                break;

            case "bsm:user_guide":
                ev.cancel = true;
                system.run(() => this.menuDirector.showUserGuide(player));
                break;

            case "bsm:reveal_wand":
                ev.cancel = true;
                console.warn(`[BSM][ToolHandler] Reveal Wand used by ${player.name}`);
                system.run(() => this.menuDirector.revealSelection(player));
                break;

            case "bsm:nudge_hammer":
                ev.cancel = true;
                system.run(() => {
                    if (player.isSneaking) {
                        import("../ui/MenuCapture.js").then(m => m.menuCapture.showNudgeMenu(player));
                    }
                });
                break;

            default:
                // Pass to MenuDirector for generic item handling if needed
                this.menuDirector.handleItemUse(ev);
                break;
        }
    }

    /**
     * Handles world.beforeEvents.itemUseOn
     */
    handleItemUseOn(ev) {
        const { source: player, block, itemStack: item } = ev;
        if (!item) return;

        switch (item.typeId) {
            case "bsm:wand_tool":
                ev.cancel = true;
                const settings = this.menuDirector.getSettings(player);
                if (settings.selectionMode === "block") {
                    const isP2 = settings.p2Keybind === "sneak" ? player.isSneaking : false;
                    system.run(() => this.menuDirector.setSelection(player, block.location, isP2 ? 2 : 1));
                }
                break;

            case "bsm:hub_item":
                ev.cancel = true;
                system.run(() => this.menuDirector.showMainMenu(player, block));
                break;

            case "bsm:scrubber_tool":
                ev.cancel = true;
                system.run(() => this.frameScrubber.handleClockUseOn(player, block));
                break;

            case "bsm:lock_wand":
                ev.cancel = true;
                system.run(() => this.recordingEngine.toggleMask(player, block.location));
                break;

            case "bsm:nudge_hammer":
                ev.cancel = true;
                if (player.isSneaking) {
                    system.run(() => this.showNudgeHammerConfig(player));
                } else {
                    this.handleNudgeHammer(player, ev.blockFace);
                }
                break;
        }
    }

    /**
     * Handles specific nudge hammer logic (itemUseOn)
     */
    handleNudgeHammer(player, face) {
        system.run(() => {
            const state = this.recordingEngine.activeCaptures.get(player.id);
            if (!state) {
                player.sendMessage("Â§cNudge Hammer requires an active recording. Use a stick first to set bounds, then click 'NEW RECORDING' on an Animation Block!");
                return;
            }

            const { dx, dy, dz } = this.getNudgeHammerOffset(player, face);
            if (dx === 0 && dy === 0 && dz === 0) {
                Logger.warn(player, "That hammer direction is currently set to 0.");
                return;
            }

            const kinetic = state.nudgeKinetic ?? false;
            this.recordingEngine.nudgeBlocks(player, dx, dy, dz, kinetic);
        });
    }

    /**
     * Handles world.afterEvents.entitySpawn (Remote Shutter Item Drop)
     */
    handleEntitySpawn(ev) {
        const entity = ev.entity;
        if (entity.typeId !== "minecraft:item") return;

        system.run(() => {
            try {
                if (!entity.isValid()) return;
                const itemStack = entity.getComponent("item")?.itemStack;
                if (itemStack && itemStack.typeId === "bsm:remote_shutter") {
                    const loc = entity.location;
                    const players = entity.dimension.getPlayers({ location: loc, maxDistance: 3 });
                    if (players.length > 0) {
                        const player = players[0];
                        const state = this.recordingEngine.activeCaptures.get(player.id);
                        if (state) this.recordingEngine.captureFrame(player, true);

                        // Clean up
                        const inv = player.getComponent("inventory")?.container;
                        if (inv) inv.addItem(itemStack);
                        entity.kill();
                    }
                }
            } catch (e) {}
        });
    }
}
