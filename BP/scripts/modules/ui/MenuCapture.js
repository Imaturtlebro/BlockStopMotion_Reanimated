import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { recordingEngine } from "../core/RecordingEngine.js";
import { RegionHighlighter } from "../utils/RegionHighlighter.js";
import { menuDirector } from "./MenuDirector.js";
import { menuDebug } from "./MenuDebug.js";
import { ExportManager } from "./ExportManager.js";
import { rigManager } from "./RigManager.js";
import { menuTimeline } from "./MenuTimeline.js";
import { menuMacros } from "./MenuMacros.js";
import { cameraManager } from "./CameraManager.js";
import { NodeDataManager } from "../core/NodeDataManager.js";

export class MenuCapture {

    showRecordMenu(player, targetBlock = null) {
        console.warn(`[BSM][MenuCapture] showRecordMenu called for ${player.name} | block=${!!targetBlock}`);
        const form = new ModalFormData()
            .title("§lStart Recording")
            .textField("Animation Name", "MyAnimation")
            .slider("FPS (Frames Per Second)", 1, 20, 1, 10)
            .toggle("Use Selection Stick Bounds?", true);

        form.show(player).then(res => {
            try {
                if (res.canceled) {
                    console.warn(`[BSM][MenuCapture] Record menu CANCELED`);
                    menuDirector.showMainMenu(player); return;
                }
                const [name, fps, useStick] = res.formValues;
                console.warn(`[BSM][MenuCapture] Starting recording: name=${name}, useStick=${useStick}`);

                let pos1 = null, pos2 = null;
                if (useStick) {
                    const sel = menuDirector.getSelection(player);
                    console.warn(`[BSM][MenuCapture] Persistent Selection: has sel=${!!sel}, pos1=${!!(sel && sel.pos1)}, pos2=${!!(sel && sel.pos2)}`);
                    if (sel && sel.pos1 && sel.pos2) {
                        pos1 = sel.pos1;
                        pos2 = sel.pos2;
                    }
                }

                if (!pos1) {
                    const l = player.location;
                    pos1 = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
                    pos2 = { x: pos1.x + 4, y: pos1.y + 4, z: pos1.z + 4 };
                    console.warn(`[BSM][MenuCapture] No selection, using default 5x5 at player pos: ${pos1.x},${pos1.y},${pos1.z}`);
                }

                console.warn(`[BSM][MenuCapture] Bounds: pos1=(${pos1.x},${pos1.y},${pos1.z}) pos2=(${pos2.x},${pos2.y},${pos2.z})`);
                recordingEngine.startRecording(player, name || "Untitled", pos1, pos2, fps);
                
                if (targetBlock) {
                    const data = { ...NodeDataManager.getBlockData(targetBlock), pos1, pos2, animationId: name || "Untitled" };
                    NodeDataManager.setBlockData(targetBlock, data);
                    Logger.info(player, "Block data synced with new recording.");
                }
                menuDirector.showMainMenu(player, targetBlock);
            } catch (e) { Logger.trace("UI", "MenuCapture.showRecordMenu", null, e); }
        }).catch(e => {
            console.error(`[BSM][MenuCapture] showRecordMenu form.show FAILED: ${e}`);
        });
    }

    showCaptureTools(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) {
            console.warn(`[BSM][MenuCapture] showCaptureTools: NO active recording for ${player.name}`);
            return;
        }
        console.warn(`[BSM][MenuCapture] showCaptureTools: frames=${state.frames.length}, autoCapture=${state.autoCapture.mode}`);

        const auto = state.autoCapture;
        const form = new ActionFormData()
            .title("§l§d🎬 CAPTURE TOOLS")
            .button("§l§a▶️ LIVE PREVIEW\n§r§7Play recording here")
            .button("§l§c⏪ UNDO LAST FRAME\n§r§7Revert recent capture")
            .button("§l§b👯 CLONE LAST FRAME\n§r§7Duplicate current data")
            .button("§l§a⏩ REDO FRAME\n§r§7Restore undone frame")
            .button("§l§d🔧 NUDGE / SHIFT\n§r§7Move blocks 1 unit")
            .button("§l§b📉 TIMELINE EDITOR\n§r§7Manage captured data")
            .button(auto.mode !== "NONE" ? "§l§c⏹️ STOP AUTO-CAPTURE\n§r§7End automation" : "§l§6⏺️ START AUTO-CAPTURE\n§r§7Timed/Live recording")
            .button("§l§e📝 FRAME COMMANDS\n§r§7Attach sound/slash cmd")
            .button("§l§6⏳ ANCHOR FRAME\n§r§7Set frame hold ticks")
            .button("§l§b🧊 PHYSICS BAKE\n§r§7Auto-step tick capture")
            .button("§l§7BACK");

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === 10) { menuDirector.showMainMenu(player); return; }
                switch (res.selection) {
                    case 0: recordingEngine.playLivePreview(player); break;
                    case 1: recordingEngine.undoFrame(player); this.showCaptureTools(player); break;
                    case 2:
                        recordingEngine.duplicateFrame(player, state.frames.length - 1);
                        this.showCaptureTools(player);
                        break;
                    case 3: recordingEngine.redoFrame(player); this.showCaptureTools(player); break;
                    case 4: this.showNudgeMenu(player); break;
                    case 5: menuTimeline.showTimelineEditor(player, (p) => this.showCaptureTools(p)); break;
                    case 6: this.showAutoCaptureMenu(player); break;
                    case 7: this.showCommandMenu(player); break;
                    case 8: menuTimeline.showAnchorFrameMenu(player, (p) => this.showCaptureTools(p)); break;
                    case 9: this.showPhysicsBakeMenu(player); break;
                }
            } catch (e) { Logger.trace("UI", "MenuCapture.showCaptureTools", null, e); }
        });
    }

    showAutoCaptureMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const active = state.autoCapture;
        const modes = ["Timed Interval (Ticks)", "Live (Instant)", "Block Quota (Count)"];
        let defaultMode = 0;
        if (active.mode === "LIVE") defaultMode = 1;
        else if (active.mode === "QUOTA") defaultMode = 2;

        const form = new ModalFormData()
            .title("§lAuto-Capture Settings")
            .dropdown("Capture Mode", modes, defaultMode)
            .slider("Threshold", 1, 100, 1, active.threshold || 20);

        form.show(player).then(res => {
            try {
                if (res.canceled) { this.showCaptureTools(player); return; }
                const [modeIdx, threshold] = res.formValues;
                const modeMap = ["TIME", "LIVE", "QUOTA"];

                recordingEngine.startAutoCapture(player, modeMap[modeIdx], threshold);
                this.showCaptureTools(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.showAutoCaptureMenu", null, e); }
        });
    }

    showVisualAids(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const form = new ActionFormData()
            .title("§l§e✨ VISUAL AIDS")
            .button("§l§f🌟 REVEAL BOUNDS\n§r§7Show selection box")
            .button(`§l§b${state.showTrails ? "DISABLE" : "ENABLE"} TRAILS\n§r§7Show growth path`)
            .button(`§l§e${state.onionskin ? "DISABLE" : "ENABLE"} ONIONSKIN\n§r§7Show previous frame`)
            .button("§l§7BACK");

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === 3) { this.showCaptureTools(player); return; }
                if (res.selection === 0) {
                    Logger.info(player, "§eRevealing bounds... §7(Check for particles)");
                    RegionHighlighter.drawBox(player.dimension, state.pos1, state.pos2, "minecraft:end_rod", 100);
                    this.showVisualAids(player);
                }
                if (res.selection === 1) { state.showTrails = !state.showTrails; this.showVisualAids(player); }
                if (res.selection === 2) { state.onionskin = !state.onionskin; this.showVisualAids(player); }
            } catch (e) { Logger.trace("UI", "MenuCapture.showVisualAids", null, e); }
        });
    }

    showPhysicsBakeMenu(player) {
        const form = new ModalFormData()
            .title("🧊 Physics Bake (Tick Freeze)")
            .textField("Frames to Bake", "30", "30");

        form.show(player).then(res => {
            try {
                if (res.canceled) { this.showCaptureTools(player); return; }
                const frames = parseInt(res.formValues[0]);
                if (isNaN(frames) || frames <= 0) {
                    Logger.error(player, "Invalid frame count.");
                    this.showPhysicsBakeMenu(player);
                    return;
                }
                recordingEngine.startPhysicsBake(player, frames);
            } catch (e) { Logger.trace("UI", "MenuCapture.showPhysicsBakeMenu", null, e); }
        });
    }

    showAdvancedOptions(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) {
            console.warn(`[BSM][MenuCapture] showAdvancedOptions: NO active recording for ${player.name}`);
            return;
        }
        console.warn(`[BSM][MenuCapture] showAdvancedOptions called`);

        const form = new ActionFormData()
            .title("§l§5⚙️ ADVANCED OPTIONS")
            .button("§l§b📐 MOVE AREA\n§r§7Relocate bounds") // 0
            .button("§l§e📦 TEMPLATES\n§r§7Quick size presets") // 1
            .button("§l§a📍 SET PIVOT\n§r§7Rotation center") // 2
            .button("§l§d📏 MASS OFFSET\n§r§7Shift all frames") // 3
            .button("§l§f🎭 ACTIVE ROLE\n§r§7Block metadata") // 4
            .button("§l§5🔍 FILTERS\n§r§7Ignore blocks") // 5
            .button("§l§6🔄 GLOBAL REPLACE\n§r§7Swapping palette") // 6
            .button("§l§d👨‍💻 DEV TOOLS\n§r§7Import/Export") // 7
            .button("§l§e✨ VISUAL AIDS\n§r§7Trails & Onions") // 8
            .button("§l§6🔄 ANCHOR MGMT\n§r§7Clear all locks") // 9
            .button("§l§6🦴 RIGGING STUDIO\n§r§7Parent-Child binding") // 10
            .button("§l§e🎥 CAM-MARKERS\n§r§7Save camera views") // 11
            .button("§l§f👁️ HUD TOGGLE\n§r§7Show/Hide UI") // 12
            .button("§l§7BACK"); // 13

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === 13) { this.showCaptureTools(player); return; }
                switch (res.selection) {
                    case 0: this.moveRecordingArea(player); break;
                    case 1: this.showTemplateMenu(player); break;
                    case 2: this.showPivotMenu(player); break;
                    case 3: this.showMassOffsetMenu(player); break;
                    case 4: this.showRoleMenu(player); break;
                    case 5: this.showFiltersMenu(player); break;
                    case 6: this.showGlobalReplaceMenu(player); break;
                    case 7: menuDebug.showDevToolsMenu(player); break;
                    case 8: this.showVisualAids(player); break;
                    case 9: this.showAnchorManagementMenu(player); break;
                    case 10: this.showRiggingStudio(player); break;
                    case 11: this.showCamMarkersMenu(player); break;
                    case 12: this.showHUDToggle(player); break;
                }
            } catch (e) { Logger.trace("UI", "MenuCapture.showAdvancedOptions", null, e); }
        });
    }

    showRiggingStudio(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const nodes = rigManager.listNodes(player);
        const form = new ActionFormData()
            .title("🦴 Rigging Studio")
            .body(`§7Links: §e${nodes.length} nodes registered.§r\n§7Your current bounds will be used when binding.`)
            .button("§l§a➕ BIND CURRENT BOUNDS\n§r§7Create new rig node");

        nodes.forEach(n => {
            form.button(`§l§e🦴 ${n.id}\n§r§7${n.parentId ? `Child of ${n.parentId}` : "Root Node"}`);
        });

        form.button("§l§7BACK");

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === nodes.length + 1) { this.showAdvancedOptions(player); return; }
                if (res.selection === 0) {
                    this.showCreateRigNodeMenu(player);
                } else {
                    const node = nodes[res.selection - 1];
                    Logger.info(player, `Node: §e${node.id}§f | Parent: §b${node.parentId || "None"}`);
                    this.showRiggingStudio(player);
                }
            } catch (e) { Logger.trace("UI", "MenuCapture.showRiggingStudio", null, e); }
        });
    }

    showCreateRigNodeMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        const nodes = rigManager.listNodes(player);
        const nodeIds = ["None", ...nodes.map(n => n.id)];

        const form = new ModalFormData()
            .title("Create Rig Node")
            .textField("Unique Node Name", "Arm_Left", "Arm_Left")
            .dropdown("Parent Node", nodeIds, 0);

        form.show(player).then(res => {
            try {
                if (res.canceled) { this.showRiggingStudio(player); return; }
                const [id, parentIdx] = res.formValues;
                const parentId = parentIdx === 0 ? null : nodeIds[parentIdx];

                rigManager.createNode(player, id, state.pos1, state.pos2, parentId);
                this.showRiggingStudio(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.showCreateRigNodeMenu", null, e); }
        });
    }

    moveRecordingArea(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const currentSize = {
            x: state.pos2.x - state.pos1.x + 1,
            y: state.pos2.y - state.pos1.y + 1,
            z: state.pos2.z - state.pos1.z + 1
        };

        const form = new ModalFormData()
            .title("📐 Resize/Move Area")
            .textField("Size X", "Width", currentSize.x.toString())
            .textField("Size Y", "Height", currentSize.y.toString())
            .textField("Size Z", "Depth", currentSize.z.toString())
            .toggle("Center on Player?", false);

        form.show(player).then(res => {
            try {
                if (res.canceled) { this.showAdvancedOptions(player); return; }
                const [sx, sy, sz, center] = res.formValues;
                const size = { x: parseInt(sx), y: parseInt(sy), z: parseInt(sz) };

                if (isNaN(size.x) || isNaN(size.y) || isNaN(size.z)) {
                    Logger.error(player, "Invalid dimensions.");
                    this.moveRecordingArea(player);
                    return;
                }

                let p1, p2;
                if (center) {
                    const l = player.location;
                    p1 = { x: Math.floor(l.x - size.x / 2), y: Math.floor(l.y), z: Math.floor(l.z - size.z / 2) };
                } else {
                    p1 = state.pos1;
                }
                p2 = { x: p1.x + size.x - 1, y: p1.y + size.y - 1, z: p1.z + size.z - 1 };

                recordingEngine.updateBounds(player, p1, p2);
                this.showAdvancedOptions(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.moveRecordingArea", null, e); }
        });
    }

    showTemplateMenu(player) {
        const form = new ActionFormData()
            .title("📦 Size Templates")
            .button("§lSmall (5x5x5)")
            .button("§lMedium (10x10x10)")
            .button("§lLarge (16x16x16)")
            .button("§lChunk (16x384x16)")
            .button("§l§7Back");

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === 4) { this.showAdvancedOptions(player); return; }
                const state = recordingEngine.activeCaptures.get(player.id);
                if (!state) return;

                let size = { x: 5, y: 5, z: 5 };
                if (res.selection === 1) size = { x: 10, y: 10, z: 10 };
                if (res.selection === 2) size = { x: 16, y: 16, z: 16 };
                if (res.selection === 3) {
                    const p1 = { x: state.pos1.x, y: -64, z: state.pos1.z };
                    const p2 = { x: p1.x + 15, y: 319, z: p1.z + 15 };
                    recordingEngine.updateBounds(player, p1, p2);
                } else {
                    const p2 = { x: state.pos1.x + size.x - 1, y: state.pos1.y + size.y - 1, z: state.pos1.z + size.z - 1 };
                    recordingEngine.updateBounds(player, state.pos1, p2);
                }
                this.showAdvancedOptions(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.showTemplateMenu", null, e); }
        });
    }

    showPivotMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        // Smart-Pivot Visualizer
        const absPivot = {
            x: state.pos1.x + state.pivot.x,
            y: state.pos1.y + state.pivot.y,
            z: state.pos1.z + state.pivot.z
        };
        
        const l = player.location;
        const dist = Math.sqrt((l.x - absPivot.x)**2 + (l.y - absPivot.y)**2 + (l.z - absPivot.z)**2);
        
        // Draw spinning pivot if within 32 blocks (200 ticks = 10 seconds of menu time)
        if (dist <= 32) {
            RegionHighlighter.drawPivot(player.dimension, absPivot, 200);
        }

        const form = new ModalFormData()
            .title("📍 Set Pivot Point")
            .textField("Pivot X (Offset from Pos1)", "0", state.pivot.x.toString())
            .textField("Pivot Y (Offset from Pos1)", "0", state.pivot.y.toString())
            .textField("Pivot Z (Offset from Pos1)", "0", state.pivot.z.toString());

        form.show(player).then(res => {
            try {
                if (res.canceled) { this.showAdvancedOptions(player); return; }
                const [px, py, pz] = res.formValues;
                const pivot = { x: parseInt(px), y: parseInt(py), z: parseInt(pz) };

                if (isNaN(pivot.x) || isNaN(pivot.y) || isNaN(pivot.z)) {
                    Logger.error(player, "Invalid coordinates.");
                    this.showPivotMenu(player);
                    return;
                }

                recordingEngine.setPivot(player, pivot);
                this.showAdvancedOptions(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.showPivotMenu", null, e); }
        });
    }

    showMassOffsetMenu(player) {
        const form = new ModalFormData()
            .title("📏 Mass Offset (Shifts ALL frames)")
            .textField("Offset X", "0", "0")
            .textField("Offset Y", "0", "0")
            .textField("Offset Z", "0", "0");

        form.show(player).then(res => {
            try {
                if (res.canceled) { this.showAdvancedOptions(player); return; }
                const [ox, oy, oz] = res.formValues;
                const offset = { x: parseInt(ox), y: parseInt(oy), z: parseInt(oz) };

                if (isNaN(offset.x) || isNaN(offset.y) || isNaN(offset.z)) {
                    Logger.error(player, "Invalid offset.");
                    this.showMassOffsetMenu(player);
                    return;
                }

                recordingEngine.batchOffset(player, offset);
                this.showAdvancedOptions(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.showMassOffsetMenu", null, e); }
        });
    }

    showRoleMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const roles = ["normal", "debris", "anchor", "temporary"];
        const form = new ActionFormData()
            .title("🎭 Active Block Role")
            .body(`Current: §d${state.activeRole}\n§7Next captured frame will tag blocks with this role.`);

        roles.forEach(role => form.button(`§l${role.toUpperCase()}`));
        form.button("§l§7Back");

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === 4) { this.showAdvancedOptions(player); return; }
                recordingEngine.setActiveRole(player, roles[res.selection]);
                this.showAdvancedOptions(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.showRoleMenu", null, e); }
        });
    }

    showFiltersMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const filters = [...state.filters];
        const form = new ActionFormData()
            .title("🔍 Capture Filters")
            .body("Blocked blocks won't be recorded.");

        form.button("§l§a➕ ADD HAND ITEM\n§r§7Add held block to filter");
        filters.forEach(f => form.button(`§l§c➖ REMOVE §e${f.split(":")[1] || f}`));
        form.button("§l§7Back");

        form.show(player).then(res => {
            try {
                if (res.canceled || res.selection === filters.length + 1) { this.showAdvancedOptions(player); return; }

                if (res.selection === 0) {
                    const item = player.getComponent("inventory").container.getItem(player.selectedSlotIndex);
                    if (item) {
                        recordingEngine.toggleFilter(player, item.typeId);
                    } else {
                        Logger.warn(player, "Hold a block to add it to filters.");
                    }
                } else {
                    recordingEngine.toggleFilter(player, filters[res.selection - 1]);
                }
                this.showFiltersMenu(player);
            } catch (e) { Logger.trace("UI", "MenuCapture.showFiltersMenu", null, e); }
        });
    }

    showGlobalReplaceMenu(player) {
        const form = new ModalFormData()
            .title("🔄 Global Palette Replace")
            .textField("Original Block ID", "minecraft:stone")
            .textField("Replacement Block ID", "minecraft:dirt")
            .toggle("Update Physical Blocks?", true);

        form.show(player).then(res => {
            if (res.canceled) { this.showAdvancedOptions(player); return; }
            const [orig, rep, physical] = res.formValues;
            if (orig && rep) {
                recordingEngine.globalReplace(player, orig, rep, physical);
            }
            this.showAdvancedOptions(player);
        });
    }

    showAnchorManagementMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const form = new ActionFormData()
            .title("⚓ Anchor Management")
            .body(`§7Current Locks: §e${state.maskedBlocks.size}§r\nLocked blocks are ignored by capture and nudge.`)
            .button("§l§c🗑️ CLEAR ALL ANCHORS\n§r§7Unlock every block")
            .button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 1) { this.showAdvancedOptions(player); return; }
            if (res.selection === 0) {
                state.maskedBlocks.clear();
                Logger.success(player, "All anchors cleared.");
                this.showAnchorManagementMenu(player);
            }
        });
    }


    showNudgeMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const kinetic = state.nudgeKinetic ?? false;
        const kLabel = kinetic ? "\u00a7a\u00a7lON" : "\u00a7c\u00a7lOFF";
        const form = new ActionFormData()
            .title("\u00a7l\u00a7d\ud83d\udd27 NUDGE / SHIFT")
            .body(`\u00a77Move all blocks inside the bounds by 1 unit.\nKinetic Mode: ${kLabel}\u00a7r\u00a77 (bounds follow blocks)`)
            .button("\u00a7l\u00a7a+X \u27a1\n\u00a7r\u00a77Shift East")
            .button("\u00a7l\u00a7c-X \u2b05\n\u00a7r\u00a77Shift West")
            .button("\u00a7l\u00a7a+Y \u2b06\n\u00a7r\u00a77Shift Up")
            .button("\u00a7l\u00a7c-Y \u2b07\n\u00a7r\u00a77Shift Down")
            .button("\u00a7l\u00a7a+Z \u2197\n\u00a7r\u00a77Shift South")
            .button("\u00a7l\u00a7c-Z \u2199\n\u00a7r\u00a77Shift North")
            .button(`\u00a7l\u00a7d\u26a1 KINETIC MODE: ${kLabel}\n\u00a7r\u00a77Toggle bounds movement`)
            .button("\u00a7l\u00a7eTWEEN NUDGE\n\u00a7r\u00a77Create movement")
            .button("\u00a7l\u00a77BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 8) { this.showCaptureTools(player); return; }
            if (res.selection === 6) {
                state.nudgeKinetic = !kinetic;
                this.showNudgeMenu(player);
                return;
            }
            if (res.selection === 7) {
                this.showTweenNudgeMenu(player);
                return;
            }
            switch (res.selection) {
                case 0: recordingEngine.nudgeBlocks(player, 1, 0, 0, kinetic); break;
                case 1: recordingEngine.nudgeBlocks(player, -1, 0, 0, kinetic); break;
                case 2: recordingEngine.nudgeBlocks(player, 0, 1, 0, kinetic); break;
                case 3: recordingEngine.nudgeBlocks(player, 0, -1, 0, kinetic); break;
                case 4: recordingEngine.nudgeBlocks(player, 0, 0, 1, kinetic); break;
                case 5: recordingEngine.nudgeBlocks(player, 0, 0, -1, kinetic); break;
            }
            // Stay in nudge menu for rapid multi-click nudging
            this.showNudgeMenu(player);
        });
    }

    showTweenNudgeMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const easingTypes = ["linear", "easeInQuad", "easeOutQuad", "easeInOutQuad", "easeInCubic", "easeOutCubic", "easeInOutCubic"];
        const form = new ModalFormData()
            .title("📈 Nudge Tweening")
            .textField("Distance X", "0", "0")
            .textField("Distance Y", "0", "0")
            .textField("Distance Z", "0", "0")
            .slider("Total Frames", 2, 60, 1, 10)
            .dropdown("Easing Type", easingTypes, 0)
            .toggle("Kinetic (Bounds follow)", state.nudgeKinetic ?? false);

        form.show(player).then(res => {
            if (res.canceled) { this.showNudgeMenu(player); return; }
            const [dx, dy, dz, frames, easeIdx, kinetic] = res.formValues;
            const dist = { x: parseInt(dx) || 0, y: parseInt(dy) || 0, z: parseInt(dz) || 0 };
            const easing = easingTypes[easeIdx];
            state.nudgeKinetic = kinetic;

            if (dist.x === 0 && dist.y === 0 && dist.z === 0) {
                Logger.error(player, "Distance cannot be 0.");
                return;
            }

            player.sendMessage(`§e🚀 Starting Tween: §f${dist.x},${dist.y},${dist.z} over §b${frames}§f frames...`);
            recordingEngine.applyTweenNudge(player, dist, Math.floor(frames), easing, kinetic);
        });
    }
    showCommandMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const form = new ActionFormData()
            .title("📝 Frame Commands")
            .body(`§7Current Pending Commands: §e${state.pendingCommands.length}`)
            .button("§l§a➕ Add Sound Command\n§r§7Play a sound effect")
            .button("§l§b➕ Add Chat Command\n§r§7Run a slash command")
            .button("§l§c➖ Clear Pending\n§r§7Remove uncommitted")
            .button("§l§7Back");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 3) { this.showCaptureTools(player); return; }
            if (res.selection === 0) this.showAddSoundMenu(player);
            if (res.selection === 1) this.showAddChatMenu(player);
            if (res.selection === 2) {
                state.pendingCommands = [];
                Logger.info(player, "Cleared pending commands.");
                this.showCommandMenu(player);
            }
        });
    }

    showAddSoundMenu(player) {
        const form = new ModalFormData()
            .title("🔊 Add Sound")
            .textField("Sound ID", "random.explode")
            .slider("Volume", 0.1, 2.0, 0.1, 1.0)
            .slider("Pitch", 0.1, 2.0, 0.1, 1.0);

        form.show(player).then(res => {
            if (res.canceled) { this.showCommandMenu(player); return; }
            const [sound, vol, pitch] = res.formValues;
            const cmd = `/playsound ${sound} @a ~ ~ ~ ${vol} ${pitch}`;
            const state = recordingEngine.activeCaptures.get(player.id);
            if (state) {
                state.pendingCommands.push(cmd);
                Logger.success(player, `Added sound: §e${sound}`);
                this.showCommandMenu(player);
            }
        });
    }

    showAddChatMenu(player) {
        const form = new ModalFormData()
            .title("💬 Add Command")
            .textField("Command (no /)", "say Hello");

        form.show(player).then(res => {
            if (res.canceled) { this.showCommandMenu(player); return; }
            const [input] = res.formValues;
            const cmd = input.startsWith("/") ? input : `/${input}`;
            const state = recordingEngine.activeCaptures.get(player.id);
            if (state) {
                state.pendingCommands.push(cmd);
                Logger.success(player, `Added command: §e${cmd}`);
                this.showCommandMenu(player);
            }
        });
    }

    showHUDToggle(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        state.showHUD = !state.showHUD;
        Logger.info(player, `Recording HUD §e${state.showHUD ? "ENABLED" : "DISABLED"}§r.`);
        this.showAdvancedOptions(player);
    }

    showCamMarkersMenu(player) {
        const state = recordingEngine.activeCaptures.get(player.id);
        if (!state) return;

        const form = new ActionFormData()
            .title("🎥 CAM-MARKERS")
            .body(`§7Markers: §e${Object.keys(state.cameraMarkers || {}).length}§r\nDrop markers to save your current view for this frame.`)
            .button("§l§a➕ SET CURRENT VIEW\n§r§7Save eye position")
            .button("§l§c➖ CLEAR MARKER\n§r§7Remove for this frame")
            .button("§l§e🌟 PREVIEW MARKERS\n§r§7Show all view points")
            .button("§l§7BACK");

        form.show(player).then(res => {
            if (res.canceled || res.selection === 3) { this.showAdvancedOptions(player); return; }
            const currentFrame = state.frames.length - 1;

            switch (res.selection) {
                case 0: cameraManager.setMarker(player, state, currentFrame); break;
                case 1: cameraManager.clearMarker(player, state, currentFrame); break;
                case 2: cameraManager.drawMarkers(player.dimension, state); break;
            }
            this.showCamMarkersMenu(player);
        });
    }
}

export const menuCapture = new MenuCapture();
