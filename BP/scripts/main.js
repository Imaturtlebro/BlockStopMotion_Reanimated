import { world, system } from "@minecraft/server";

// Core Engines
import { renderCore } from "./modules/core/RenderCore.js";
import { recordingEngine } from "./modules/core/RecordingEngine.js";
import { SequenceVault } from "./modules/core/SequenceVault.js";
import { eventMonitor } from "./modules/core/EventMonitor.js";

// UI Managers
import { menuDirector } from "./modules/ui/MenuDirector.js";
import { menuRenderer } from "./modules/ui/MenuRenderer.js";
import { menuCapture } from "./modules/ui/MenuCapture.js";
import { menuDebug } from "./modules/ui/MenuDebug.js";
import { menuTimeline } from "./modules/ui/MenuTimeline.js";
import { menuMacros } from "./modules/ui/MenuMacros.js";
import { menuScene } from "./modules/ui/MenuScene.js";

// Tools
import { ToolHandler } from "./modules/tools/ToolHandler.js";
import { frameScrubber } from "./modules/tools/FrameScrubber.js";

// Utils
import { Logger } from "./modules/utils/Logger.js";
import { RegionHighlighter } from "./modules/utils/RegionHighlighter.js";

/**
 * BlockStop Motion: Reanimated (BSM)
 * Modular Bootstrap Entry Point
 */

// 1. Dependency Injection & Wire-up
menuDirector.injectManagers(menuRenderer, menuCapture, menuDebug);
const toolHandler = new ToolHandler(menuDirector, recordingEngine, frameScrubber);

/**
 * initMod()
 * Deferred initialization of all event listeners.
 */
import { sceneManager } from "./modules/core/SceneManager.js";

function initMod() {
    Logger.log("§6[BSM] Initializing Modular Framework...");

    // --- 1. Script Event Subscriptions ---
    system.afterEvents.scriptEventReceive.subscribe((ev) => {
        try {
            if (ev.id === "bsm:play_scene") {
                const player = ev.sourceEntity;
                if (player?.typeId === "minecraft:player") {
                    sceneManager.playScene(ev.message, player.location, player);
                }
            }
            else if (ev.id === "bsm:cleanup_corrupt_data") {
                const player = ev.sourceEntity;
                if (player?.typeId === "minecraft:player" && (player.hasTag("bp_admin") || player.isOp())) {
                    system.run(() => SequenceVault.cleanupCorruptedData(player));
                }
            } else if (ev.id === "bsm:debug") {
                const player = ev.sourceEntity;
                if (player?.typeId === "minecraft:player" && (player.hasTag("bp_admin") || player.isOp())) {
                    const state = ev.message.trim().toLowerCase() === "true";
                    Logger.setDebugMode(player, state);
                }
            }
        } catch (e) {
            console.error(`[BSM] scriptEvent Error: ${e}`);
        }
    });

    // --- 2. World Event Listeners (Routed to ToolHandler) ---
    world.beforeEvents.itemUse.subscribe((ev) => {
        try { toolHandler.handleItemUse(ev); } catch (e) { console.error(`[BSM] itemUse Error: ${e}`); }
    });

    world.beforeEvents.itemUseOn.subscribe((ev) => {
        try { toolHandler.handleItemUseOn(ev); } catch (e) { console.error(`[BSM] itemUseOn Error: ${e}`); }
    });

    world.afterEvents.entitySpawn.subscribe((ev) => {
        try { toolHandler.handleEntitySpawn(ev); } catch (e) { console.error(`[BSM] entitySpawn Error: ${e}`); }
    });

    system.afterEvents.scriptEventReceive.subscribe((ev) => {
        if (ev.id === "bsm:export") {
            const player = ev.sourceEntity;
            const animId = ev.message.trim();
            if (player && animId) {
                // We use dynamic import to avoid circular dependencies if ExportManager is isolated
                import("./modules/ui/ExportManager.js").then(module => {
                    module.ExportManager.exportAnimation(player, animId);
                });
            }
        }
    });

    // --- 3. Studio Mode HUD ---
    system.runInterval(() => {
        const players = world.getAllPlayers();
        const totalBytes = world.getDynamicPropertyTotalByteCount();
        const memPercent = Math.min(100, Math.round((totalBytes / 1000000) * 100));
        let memColor = memPercent > 90 ? "§c" : (memPercent > 70 ? "§e" : "§a");

        for (const player of players) {
            const held = player.getComponent("inventory")?.container.getItem(player.selectedSlotIndex);
            if (held && held.typeId.startsWith("bsm:")) {
                const state = recordingEngine.activeCaptures.get(player.id);
                let stateStr = "§l§aBSM Studio§r"; // Green by default
                if (state && state.isProcessingCapture) stateStr = "§l§c[SAVING - DO NOT EXIT]§r"; // Red when busy
                else if (renderCore.activeRenders.size > 0) stateStr = "§l§eBSM Studio§r"; // Yellow when playing

                let hudText = `${stateStr} §8|§r `;
                if (state && state.showHUD) {
                    hudText += `Project: §e${state.name}§r §8|§r Frame: §b${state.frames.length}§r §8|§r Mem: ${memColor}${memPercent}%§r`;
                    if (state.autoCapture.mode !== "NONE") {
                        let acStatus = state.autoCapture.mode === "TIME" ? "§c⏺ TIME" : (state.autoCapture.mode === "LIVE" ? "§b⏺ LIVE" : `§d⏺ ${state.autoCapture.counter}/${state.autoCapture.threshold}`);
                        hudText += ` §8|§r ${acStatus}`;
                    }
                } else {
                    hudText += `Project: §7None§r §8|§r Mem: ${memColor}${memPercent}%§r`;
                }

                if (held.typeId === "bsm:reveal_wand") {
                    const sel = menuDirector.getSelection(player);
                    if (sel && sel.pos1 && sel.pos2) {
                        const l = player.location;
                        const c = sel.pos1;
                        const dist = Math.sqrt((l.x-c.x)**2 + (l.y-c.y)**2 + (l.z-c.z)**2);
                        if (dist <= 32) {
                            RegionHighlighter.drawBox(player.dimension, sel.pos1, sel.pos2, "minecraft:villager_happy", 11);
                        }
                    }
                }

                player.onScreenDisplay.setActionBar(hudText);
            }
        }
    }, 10);

    // --- 4. Diagnostics ---
    system.runTimeout(() => {
        const savedAnims = SequenceVault.listAnimations();
        const totalBytes = world.getDynamicPropertyTotalByteCount();
        Logger.log("§a--- BSM v2.9.0 BOOTSTRAP COMPLETE ---");
        Logger.log(`§7Animations: §e${savedAnims.length} §7| Memory: §e${totalBytes}§7/1000000`);
    }, 40);

    // Health Monitor
    system.runInterval(() => {
        if (world.getAllPlayers().length === 0) return;
        const recordings = recordingEngine.activeCaptures.size;
        const playbacks = renderCore.activeRenders.size;
        console.warn(`[BSM][Diagnostic] Health: Players=${world.getAllPlayers().length}, Recording=${recordings}, Playing=${playbacks}`);
    }, 1200);
}

// --- Lifecycle & Registration ---
class AnimationBlockInteract {
    onPlayerInteract(e) {
        if (e.player && e.block) system.run(() => menuDirector.showMainMenu(e.player, e.block));
    }
}

world.beforeEvents.worldInitialize.subscribe((initEvent) => {
    try {
        initEvent.blockComponentRegistry.registerCustomComponent("bsm:sequence_block_interact", new AnimationBlockInteract());
        console.warn("[BSM] Block Component Registered.");
        system.run(initMod);
    } catch (e) {
        console.error(`[BSM] Initialization FAILED: ${e}`);
    }
});
