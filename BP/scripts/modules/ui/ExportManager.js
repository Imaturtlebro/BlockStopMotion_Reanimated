import { system } from "@minecraft/server";
import { Logger } from "../utils/Logger.js";
import { SequenceVault } from "../core/SequenceVault.js";
import { AnimationStorage } from "../core/AnimationStorage.js";

/**
 * ExportManager - Log Harvester Strategy
 * 
 * Exports animation data by printing it to the content log in clearly marked,
 * sequenced chunks. A companion Python script (ScalarLabs_Exporter.py) watches
 * the log file and automatically reassembles + saves the JSON to /prefabs/.
 * 
 * This approach requires ZERO extra Minecraft permissions or modules.
 */
export class ExportManager {
    static CHUNK_SIZE = 4000; // Safe limit per console.warn line
    static MARKER_START = "[BSM-EXPORT-START]";
    static MARKER_CHUNK = "[BSM-CHUNK]";
    static MARKER_END = "[BSM-EXPORT-END]";

    static exportAnimation(player, animId) {
        console.warn(`[BSM][ExportManager] exportAnimation called by ${player.name} for animId=${animId}`);
        try {
            const rawData = SequenceVault.load(animId);
            if (!rawData) {
                console.warn(`[BSM][ExportManager] FAILED: Animation '${animId}' not found in storage.`);
                Logger.error(player, `Animation '${animId}' not found.`);
                return;
            }

            // Compress the data
            const compressed = AnimationStorage.compress(rawData);

            // Strip any environment metadata here if they existed 
            // (e.g., delete compressed.player_id if present)
            delete compressed.player_id;
            delete compressed.dimension_id;
            delete compressed.last_session_timestamp;

            // Strict Schema Implementation
            const finalPayload = {
                metadata: {
                    version: "2.8.0",
                    origin: "BSM",
                    rig_type: compressed.rig_type || "generic"
                },
                spatial: {
                    dimensions: compressed.initialSize || { x: 0, y: 0, z: 0 },
                    origin: compressed.initialOrigin || compressed.pos1 || { x: 0, y: 0, z: 0 }
                },
                palette: compressed.palette,
                frames: compressed.frames
            };

            const jsonString = JSON.stringify(finalPayload);
            const totalChunks = Math.ceil(jsonString.length / this.CHUNK_SIZE);
            console.warn(`[BSM][ExportManager] Payload compressed: size=${jsonString.length} chars, totalChunks=${totalChunks}`);

            Logger.info(player, `§eStarting export of '${animId}'... Please wait...`);

            // Emit start marker
            console.warn(`${this.MARKER_START}:${animId}:${totalChunks}`);

            let currentIndex = 0;
            const CHUNKS_PER_TICK = 5; // Safe amount of strings to emit per tick

            const intervalId = system.runInterval(() => {
                if (!player.isValid()) {
                    system.clearRun(intervalId);
                    return;
                }

                const limit = Math.min(currentIndex + CHUNKS_PER_TICK, totalChunks);
                for (let i = currentIndex; i < limit; i++) {
                    const chunk = jsonString.slice(i * this.CHUNK_SIZE, (i + 1) * this.CHUNK_SIZE);
                    console.warn(`${this.MARKER_CHUNK}${i}:${chunk}`);
                }

                currentIndex = limit;

                if (currentIndex >= totalChunks) {
                    system.clearRun(intervalId);
                    // Emit end marker
                    console.warn(this.MARKER_END);
                    Logger.actionBar(player, `§l§a✔ EXPORTED: ${animId} (${totalChunks} chunks sent to log)`);
                    Logger.success(player, `Exported '§e${animId}§f' to console log. Ready for extraction.`);
                }
            }, 1);

        } catch (e) {
            Logger.error(player, `§lExport failed: ${e}`);
        }
    }
}
