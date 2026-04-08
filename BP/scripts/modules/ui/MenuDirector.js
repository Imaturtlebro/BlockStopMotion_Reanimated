import { system, ItemStack, world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { renderCore } from "../core/RenderCore.js";
import { recordingEngine } from "../core/RecordingEngine.js";
import { NodeDataManager } from "../core/NodeDataManager.js";
import { RegionHighlighter } from "../utils/RegionHighlighter.js";
import { SequenceVault } from "../core/SequenceVault.js";

// Imported managers (assigned later to avoid circular issues)
let menuRenderer, menuCapture, menuDebug, menuScene;

export class MenuDirector {
    constructor() {
        this.playerSettings = new Map(); // PlayerId -> Settings Object
        // playerSelections is now persistent via world.getDynamicProperty
    }

    injectManagers(playback, recording, devtools, scenes) {
        menuRenderer = playback;
        menuCapture = recording;
        menuDebug = devtools;
        menuScene = scenes;
    }

    getSettings(player) {
        if (!this.playerSettings.has(player.id)) {
            this.playerSettings.set(player.id, {
                selectionMode: "block",
                p2Keybind: "sneak",
                revealDuration: 5,
                lowPerformance: false,
                showHUD: true
            });
        }
        return this.playerSettings.get(player.id);
    }

    setSelection(player, pos, point = 1) {
        const propKey = `bsm_sel:${player.id}`;
        let sel = {};
        try {
            const current = world.getDynamicProperty(propKey);
            if (current) sel = JSON.parse(current);
        } catch (e) { sel = {}; }

        const snappedPos = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
        if (point === 1) sel.pos1 = snappedPos;
        else sel.pos2 = snappedPos;

        world.setDynamicProperty(propKey, JSON.stringify(sel));
        Logger.info(player, `Point ${point} set to ${snappedPos.x}, ${snappedPos.y}, ${snappedPos.z}`);

        const active = recordingEngine.activeCaptures.get(player.id);
        if (active && sel.pos1 && sel.pos2) {
            recordingEngine.updateBounds(player, sel.pos1, sel.pos2);
        }
    }

    getSelection(player) {
         const propKey = `bsm_sel:${player.id}`;
         try {
             const current = world.getDynamicProperty(propKey);
             if (current) return JSON.parse(current);
         } catch (e) {}
         return { pos1: null, pos2: null };
    }

    handleItemUse(ev) {
        const { source: player, itemStack: item } = ev;
        if (!item) return;

        if (item.typeId === "bsm:hub_item") {
            ev.cancel = true;
            system.run(() => {
                try { this.showMainMenu(player); }
                catch (e) { Logger.trace("UI", "MenuDirector.showMainMenu", null, e); }
            });
        }
        else if (item.typeId === "minecraft:spyglass" && player.isSneaking) {
            system.run(() => {
                try { this.handleSpyglass(player); }
                catch (e) { Logger.trace("UI", "MenuDirector.handleSpyglass", null, e); }
            });
        }
    }

    handleSpyglass(player) {
        let found = 0;
        recordingEngine.activeCaptures.forEach((state, pid) => {
            const dist = Math.abs(player.location.x - state.pos1.x) + Math.abs(player.location.z - state.pos1.z);
            if (dist < 64) {
                RegionHighlighter.drawBox(player.dimension, state.pos1, state.pos2, "minecraft:end_rod", 100);
                Logger.info(player, `Found: ${state.name} (${state.frames.length} frames)`);
                found++;
            }
        });
        if (found === 0) {
            player.onScreenDisplay.setActionBar("No active recordings found nearby.");
        }
    }

    showMainMenu(player, targetBlock = null) {
        const activeRecording = recordingEngine.activeCaptures.has(player.id);
        const title = activeRecording ? "§l§c🔴 RECORDING IN PROGRESS" : "§l§9BLOCKSTOP MOTION";
        const form = new ActionFormData().title(title);

        if (activeRecording) {
            const state = recordingEngine.activeCaptures.get(player.id);
            form.body(`§7Project: §e${state.name}\n§7Frames: §b${state.frames.length}\n§7Role: §d${state.activeRole}`);
            form.button("§l§c⏹ STOP & SAVE\n§r§7Finish the animation");      // 0
            form.button("§l§b📸 CAPTURE FRAME\n§r§7Save current state");    // 1
            form.button("§l§d🎞️ CAPTURE TOOLS\n§r§7Undo, Redo, Auto-Cap");     // 2
            form.button("§l§e✨ VISUAL AIDS\n§r§7Trails, Bounds, Ghost");       // 3
            form.button("§l§5⚙️ ADVANCED\n§r§7Pivot, Filters, Mass Edit"); // 4
            form.button("§l§7EXIT MENU");         // 5
        } else {
            if (targetBlock) {
                const data = NodeDataManager.getBlockData(targetBlock);
                if (data && data.animationId) {
                    form.body(`§7Animation: §e${data.animationId}\n§7Status: §aAssigned to Block`);
                    form.button("§l§a▶ PLAY ANIMATION");    // 0
                    form.button("§l§c⏹ STOP ALL");          // 1
                    form.button("§l§b📦 EDIT BOUNDS");       // 2
                    form.button("§l§e❌ CLEAR DATA");        // 3
                    form.button("§l§d⚡ TRIGGERS");          // 4
                    form.button("§l§c🔴 NEW RECORDING");    // 5
                    form.button("§l§9📂 PLAY MENU");         // 6
                    form.button("§l§6🛠️ SETTINGS");        // 7
                    form.button("§l§c🛡️ ADMIN");           // 8
                    form.button("§l§4☢️ KILL ALL");       // 9
                    form.button("§l§7CLOSE");             // 10
                } else {
                    form.body("§7Target: Block\n§7Status: §7No Animation Data");
                    form.button("§l§6📦 SETUP BOUNDS");      // 0
                    form.button("§l§a🔗 ATTACH ANIM");       // 1
                    form.button("§l§d⚡ TRIGGERS");          // 2
                    form.button("§l§c🔴 NEW RECORDING");    // 3
                    form.button("§l§9📂 PLAY MENU");         // 4
                    form.button("§l§6🛠️ SETTINGS");        // 5
                    form.button("§l§c🛡️ ADMIN");           // 6
                    form.button("§l§4☢️ KILL ALL");       // 7
                    form.button("§l§7CLOSE");             // 8
                }
            } else {
                form.body("§7Welcome to the Motion Studio.");
                form.button("§l§c🔴 NEW RECORDING"); // 0
                form.button("§l§f🌟 REVEAL SELECTION"); // 1
                form.button("§l§a▶ PLAY MENU");        // 2
                form.button("§l§9❓ HELP & GUIDE");      // 3
                form.button("§l§6🛠️ SETTINGS");        // 4
                form.button("§l§c🛡️ ADMIN");           // 5
                form.button("§l§4☢️ KILL ALL");       // 6
                form.button("§l§b📂 SELECTION LIBRARY"); // 7
                form.button("§l§d🎬 SCENE SEQUENCER");   // 8
                form.button("§l§7CLOSE");             // 9
            }
        }

        form.show(player).then(res => system.run(() => {
            try {
                if (res.canceled) return;
                const data = targetBlock ? NodeDataManager.getBlockData(targetBlock) : null;
                const hasData = (data && data.animationId);
                const backIdx = activeRecording ? 5 : (targetBlock ? (hasData ? 10 : 8) : 9);
                if (res.selection === backIdx) return;

                if (activeRecording) {
                    switch (res.selection) {
                        case 0: recordingEngine.stopRecording(player); break;
                        case 1: recordingEngine.captureFrame(player); this.showMainMenu(player); break;
                        case 2: menuCapture.showCaptureTools(player); break;
                        case 3: menuCapture.showVisualAids(player); break;
                        case 4: menuCapture.showAdvancedOptions(player); break;
                    }
                } else if (targetBlock) {
                    this.handleBlockContext(player, targetBlock, res.selection);
                } else {
                    switch (res.selection) {
                        case 0: menuCapture.showRecordMenu(player, targetBlock); break;
                        case 1: this.revealSelection(player); break;
                        case 2: menuRenderer.showPlayMenu(player); break;
                        case 3: this.showHelpMenu(player); break;
                        case 4: this.showSettingsMenu(player); break;
                        case 5: this.showAdminMenu(player); break;
                        case 6: renderCore.stopAll(); this.showMainMenu(player); break;
                        case 7: this.showSelectionLibrary(player); break;
                        case 8: menuScene.showSceneMenu(player, () => this.showMainMenu(player)); break;
                    }
                }
            } catch (e) {
                Logger.trace("UI", "MenuDirector.showMainMenu", null, e);
            }
        }));
    }

    handleBlockContext(player, block, selection) {
        const data = NodeDataManager.getBlockData(block);
        const hasData = data && data.animationId;

        if (hasData) {
            switch (selection) {
                case 0: renderCore.playAtLocation(player.dimension, block.location, data.animationId, "once", player); this.showMainMenu(player, block); break;
                case 1: renderCore.stopAll(); this.showMainMenu(player, block); break;
                case 2: this.showBoundsMenu(player, block); break;
                case 3: this.clearBoundary(player, block); break;
                case 4: this.showTriggerSettings(player, block); break;
                case 5: menuCapture.showRecordMenu(player, block); break;
                case 6: menuRenderer.showPlayMenu(player); break;
                case 7: this.showSettingsMenu(player); break;
                case 8: this.showAdminMenu(player); break;
                case 9: renderCore.stopAll(); this.showMainMenu(player); break;
            }
        } else {
            switch (selection) {
                case 0: this.showBoundsMenu(player, block); break;
                case 1: this.showAttachAnimMenu(player, block); break;
                case 2: this.showTriggerSettings(player, block); break;
                case 3: menuCapture.showRecordMenu(player, block); break;
                case 4: menuRenderer.showPlayMenu(player); break;
                case 5: this.showSettingsMenu(player); break;
                case 6: this.showAdminMenu(player); break;
                case 7: renderCore.stopAll(); this.showMainMenu(player); break;
            }
        }
    }
    showAttachAnimMenu(player, block) {
        const animations = SequenceVault.listAnimations();
        if (animations.length === 0) {
            Logger.warn(player, "No saved animations found to attach.");
            this.showMainMenu(player, block);
            return;
        }

        const form = new ActionFormData()
            .title("🔗 Attach Animation")
            .body("Select an animation to attach or preview:");

        for (const anim of animations) {
            form.button(`§l${anim}\n§r§7Select Animation`);
        }
        form.button("§l§7BACK");

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === animations.length) {
                    this.showMainMenu(player, block);
                    return;
                }
                const selectedAnim = animations[res.selection];
                this.showAttachActionMenu(player, block, selectedAnim);
            } catch (e) {
                Logger.trace("UI", "MenuDirector.showAttachAnimMenu", null, e);
            }
        });
    }

    showAttachActionMenu(player, block, animId) {
        const form = new ActionFormData()
            .title(`Attach: ${animId}`)
            .button("§l§a🔗 ATTACH NOW\n§r§7Save to this block")
            .button("§l§e👁️ PREVIEW BOUNDS\n§r§7Show wireframe here")
            .button("§l§7BACK");

        form.show(player).then(res => system.run(() => {
            try {
                if (res.canceled || res.selection === 2) {
                    this.showAttachAnimMenu(player, block);
                    return;
                }

                if (res.selection === 0) {
                    const data = NodeDataManager.getBlockData(block) || {};
                    data.animationId = animId;
                    NodeDataManager.setBlockData(block, data);
                    Logger.success(player, `Attached animation: §e${animId}`);
                    this.showMainMenu(player, block);
                } else if (res.selection === 1) {
                    // Preview Logic
                    const animData = SequenceVault.load(animId);
                    if (animData && animData.frames && animData.frames.length > 0) {
                        const firstFrame = animData.frames[0];
                        const size = firstFrame.boxSize || { x: 5, y: 5, z: 5 }; // Fallback
                        const p1 = block.location;
                        const p2 = { x: p1.x + size.x - 1, y: p1.y + size.y - 1, z: p1.z + size.z - 1 };
                        
                        Logger.info(player, `§ePreviewing bounds for ${animId} (Size: ${size.x}x${size.y}x${size.z})`);
                        RegionHighlighter.drawBox(player.dimension, p1, p2, "minecraft:end_rod", 60); // 3 seconds
                    } else {
                        Logger.warn(player, "Could not load animation preview data.");
                    }
                    // Return to action menu after previewing
                    this.showAttachActionMenu(player, block, animId);
                }
            } catch (e) {
                Logger.trace("UI", "MenuDirector.showAttachActionMenu", null, e);
            }
        }));
    }

    revealSelection(player) {
        const sel = this.getSelection(player);
        if (sel && sel.pos1 && sel.pos2) {
            RegionHighlighter.drawBox(player.dimension, sel.pos1, sel.pos2, "minecraft:end_rod", 100);
        } else {
            Logger.warn(player, "No selection active to reveal.");
        }
        this.showMainMenu(player);
    }

    showAdminMenu(player) {
        const isPaused = renderCore.isGloballyPaused;
        const form = new ActionFormData()
            .title("§l§c🛡️ ADMINISTRATIVE CONTROL")
            .button("§l§e🎒 GET STUDIO TOOLS\n§r§7Instant kit grant")
            .button(isPaused ? "§l§a▶ RESUME ALL\n§r§7Unpause all animations" : "§l§e⏸ PAUSE ALL\n§r§7Freeze all animations")
            .button("§l§c⏹ STOP ALL\n§r§7Clear all active playback")
            .button("§l§b🔄 REFRESH SYSTEM\n§r§7Reload managers")
            .button("§l§7BACK");

        form.show(player).then(res => system.run(() => {
            try {
                if (res.canceled || res.selection === 4) { this.showMainMenu(player); return; }
                if (res.selection === 0) { this.giveTools(player); this.showAdminMenu(player); }
                if (res.selection === 1) { renderCore.setGlobalPause(!isPaused); this.showAdminMenu(player); }
                if (res.selection === 2) { renderCore.stopAll(); this.showAdminMenu(player); }
                if (res.selection === 3) { this.showAdminMenu(player); }
            } catch (e) {
                Logger.trace("UI", "MenuDirector.showAdminMenu", null, e);
            }
        }));
    }

    giveTools(player) {
        const inv = player.getComponent("inventory").container;
        const tools = ["bsm:hub_item","bsm:wand_tool","bsm:reveal_wand","bsm:scrubber_tool","bsm:nudge_hammer","bsm:remote_shutter","bsm:lock_wand","bsm:playback_tool","bsm:user_guide","bsm:sequence_block"];
        tools.forEach(id => { try { inv.addItem(new ItemStack(id, 1)); } catch (e) {} });
        Logger.success(player, "Granted Studio Tools!");
    }

    showSettingsMenu(player) {
        const settings = this.getSettings(player);
        const form = new ModalFormData()
            .title("⚙️ System Settings")
            .toggle("Low Performance Mode (Less Particles)", settings.lowPerformance)
            .slider("Reveal Duration (Seconds)", 1, 10, 1, settings.revealDuration)
            .dropdown("Selection Color", ["End Rod (White)", "Flame (Red)", "Happy (Green)"], 0)
            .toggle("Show HUD during recording?", settings.showHUD);

        form.show(player).then(res => system.run(() => {
            try {
                if (res.canceled) { this.showMainMenu(player); return; }
                const [lowPerf, dur, colorIdx, showHUD] = res.formValues;
                settings.lowPerformance = lowPerf;
                settings.revealDuration = dur;
                settings.showHUD = showHUD;
                RegionHighlighter.lowPerformance = lowPerf;
                Logger.info(player, `Settings Updated: §eHUD=${showHUD ? "ON" : "OFF"}§r`);
                this.showMainMenu(player);
            } catch (e) {
                Logger.trace("UI", "MenuDirector.showSettingsMenu", null, e);
            }
        }));
    }

    showHelpMenu(player) {
        const form = new ActionFormData()
            .title("📖 Studio Guide")
            .body("Learn basics and advanced tools.")
            .button("§l§b1. BASICS")
            .button("§l§e2. TRIGGERS")
            .button("§l§7BACK");
        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === 2) { this.showMainMenu(player); return; }
                if (res.selection === 0) this.showUserGuide(player);
                if (res.selection === 1) this.showTriggerHelp(player);
            } catch (e) {
                Logger.trace("UI", "MenuDirector.showHelpMenu", null, e);
            }
        });
    }

    showTriggerHelp(player) {
        const form = new ActionFormData().title("⚡ Triggers").body("Interact, Proximity, Redstone").button("§l§7BACK");
        form.show(player).then(() => {
            try { this.showHelpMenu(player); } catch (e) { Logger.trace("UI", "MenuDirector.showTriggerHelp", null, e); }
        });
    }

    showBoundsMenu(player, block) {
        const data = NodeDataManager.getBlockData(block) || {};
        const p1 = data.pos1 || { x: block.location.x, y: block.location.y, z: block.location.z };
        const p2 = data.pos2 || { x: block.location.x + 4, y: block.location.y + 4, z: block.location.z + 4 };
        const form = new ModalFormData()
            .title("📦 Boundary Setup")
            .textField("P1 X", "", p1.x.toString())
            .textField("P1 Y", "", p1.y.toString())
            .textField("P1 Z", "", p1.z.toString())
            .textField("P2 X", "", p2.x.toString())
            .textField("P2 Y", "", p2.y.toString())
            .textField("P2 Z", "", p2.z.toString())
            .toggle("§l§a🔄 SYNC FROM STICK?§r", false);

        form.show(player).then(res => system.run(() => {
            try {
                if (res.canceled) return;
                const [x1,y1,z1,x2,y2,z2, sync] = res.formValues;

                if (sync) {
                    this.syncSelectionToBlock(player, block);
                    return;
                }

                const np1 = {x:parseInt(x1),y:parseInt(y1),z:parseInt(z1)};
                const np2 = {x:parseInt(x2),y:parseInt(y2),z:parseInt(z2)};
                NodeDataManager.setBlockData(block, { ...data, pos1: np1, pos2: np2 });
                Logger.success(player, "Bounds updated manually.");
                this.showMainMenu(player, block);
            } catch (e) {
                Logger.trace("UI", "MenuDirector.showBoundsMenu", null, e);
            }
        }));
    }

    syncSelectionToBlock(player, block) {
        const sel = this.getSelection(player);
        if (!sel || !sel.pos1 || !sel.pos2) {
            Logger.error(player, "No stick selection found! Use Selection Wand first.");
            this.showBoundsMenu(player, block);
            return;
        }

        const data = NodeDataManager.getBlockData(block) || {};
        NodeDataManager.setBlockData(block, { ...data, pos1: sel.pos1, pos2: sel.pos2 });
        Logger.success(player, "Synced selection from tool to block!");
        this.showMainMenu(player, block);
    }

    showTriggerSettings(player, block) {
        const data = NodeDataManager.getBlockData(block) || {};
        const triggers = ["None", "Proximity", "Interact", "Redstone"];
        const form = new ModalFormData()
            .title("⚡ Trigger Settings")
            .dropdown("Type", triggers, triggers.indexOf(data.triggerType || "None"))
            .textField("Range", "", (data.triggerRange || 5).toString());
        form.show(player).then(res => system.run(() => {
            try {
                if (res.canceled) return;
                const [t, r] = res.formValues;
                NodeDataManager.setBlockData(block, { ...data, triggerType: triggers[t], triggerRange: parseInt(r) });
                Logger.success(player, "Trigger updated!");
                this.showMainMenu(player, block);
            } catch (e) { Logger.trace("UI", "MenuDirector.showTriggerSettings", null, e); }
        }));
    }

    clearBoundary(player, block) {
        NodeDataManager.setBlockData(block, {});
        Logger.success(player, "Data cleared.");
        this.showMainMenu(player, block);
    }

    showUserGuide(player) {
        const form = new ActionFormData()
            .title("§l§6BSM: GUIDE")
            .button("§l§b1. BASICS")
            .button("§l§c2. RECORDING")
            .button("§l§d3. TOOLS")
            .button("§l§e4. TRIGGERS")
            .button("§l§7BACK");
        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === 4) return;
                switch(res.selection) {
                    case 0: this.showGuideBasics(player); break;
                    case 1: this.showGuideRecording(player); break;
                    case 2: this.showGuideTools(player); break;
                    case 3: this.showGuideTriggers(player); break;
                }
            } catch (e) { Logger.trace("UI", "MenuDirector.showUserGuide", null, e); }
        });
    }

    showGuideBasics(player) {
        const form = new ActionFormData().title("Basics").body("Use the Selection Stick to mark corners.").button("§l§7BACK");
        form.show(player).then(() => { try { this.showUserGuide(player); } catch (e) { Logger.trace("UI", "MenuDirector.showGuideBasics", null, e); } });
    }

    showGuideRecording(player) {
        const form = new ActionFormData().title("Recording").body("Open Hub, select New Recording, and Capture Frames.").button("§l§7BACK");
        form.show(player).then(() => { try { this.showUserGuide(player); } catch (e) { Logger.trace("UI", "MenuDirector.showGuideRecording", null, e); } });
    }

    showGuideTools(player) {
        const form = new ActionFormData().title("Tools").body("Stick, Hub, Scrubber, Hammer, Shutter, Wand, Preview.").button("§l§7BACK");
        form.show(player).then(() => { try { this.showUserGuide(player); } catch (e) { Logger.trace("UI", "MenuDirector.showGuideTools", null, e); } });
    }

    showGuideTriggers(player) {
        const form = new ActionFormData().title("Triggers").body("Interact, Proximity, Redstone.").button("§l§7BACK");
        form.show(player).then(() => { try { this.showUserGuide(player); } catch (e) { Logger.trace("UI", "MenuDirector.showGuideTriggers", null, e); } });
    }

    showSelectionLibrary(player) {
        const savedBounds = world.getDynamicProperty(`${player.id}_saved_bounds`) || "[]";
        const boundsList = JSON.parse(savedBounds);
        const form = new ActionFormData().title("📂 SELECTION LIBRARY").button("§l§a➕ SAVE CURRENT BOUNDS");
        boundsList.forEach(b => form.button(`§l§e${b.name}`));
        form.button("§l§7BACK");
        form.show(player).then(res => system.run(() => {
            if (res.canceled || res.selection === boundsList.length + 1) { this.showMainMenu(player); return; }
            if (res.selection === 0) this.showSaveBoundsMenu(player, boundsList);
            else {
                const b = boundsList[res.selection - 1];
                world.setDynamicProperty(`bsm_sel:${player.id}`, JSON.stringify({ pos1: b.p1, pos2: b.p2 }));
                Logger.success(player, `Loaded: ${b.name}`);
                this.showSelectionLibrary(player);
            }
        }));
    }

    showSaveBoundsMenu(player, list) {
        const sel = this.getSelection(player);
        if (!sel || !sel.pos1 || !sel.pos2) { Logger.error(player, "No selection!"); return; }
        const form = new ModalFormData().title("Save Bounds").textField("Name", "Name", "Selection");
        form.show(player).then(res => system.run(() => {
            if (res.canceled) return;
            list.push({ name: res.formValues[0] || "Untitled", p1: sel.pos1, p2: sel.pos2 });
            world.setDynamicProperty(`${player.id}_saved_bounds`, JSON.stringify(list));
            this.showSelectionLibrary(player);
        }));
    }
}

export const menuDirector = new MenuDirector();
