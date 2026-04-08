import { world } from "@minecraft/server";

/**
 * Logger utility for standardized BSM console and chat output.
 */
export class Logger {
    static isDebugMode = false;

    static setDebugMode(player, state) {
        this.isDebugMode = state;
        if (state) this.success(player, "Advanced Diagnostics: §lON");
        else this.info(player, "Advanced Diagnostics: §lOFF");
    }

    static info(player, message) {
        if (player) player.sendMessage(`§7[BSM] ${message}`);
        else this.log(message);
    }

    static success(player, message) {
        if (player) player.sendMessage(`§a[BSM] §r${message}`);
        else this.log(message);
    }

    static warn(player, message) {
        if (player) player.sendMessage(`§e[BSM] Warning: ${message}`);
        else this.log(`Warning: ${message}`);
    }

    static error(player, message, e = null) {
        const errorStr = e ? (e.message || e.toString()) : "";
        if (player) player.sendMessage(`§c[BSM] Error: ${message} ${errorStr ? `| ${errorStr}` : ""}`);
        else this.log(`Error: ${message} | ${errorStr}`);
    }

    static log(message) {
        console.warn(`[BSM] ${message}`);
    }

    static actionBar(player, message) {
        if (player) player.onScreenDisplay.setActionBar(message);
    }

    static diagnostic(message) {
        if (this.isDebugMode) {
            console.warn(`[BSM][Diagnostic] ${message}`);
        }
    }

    static telemetry(module, metric, msTime) {
        if (!this.isDebugMode) return;
        console.warn(`[BSM][Telemetry] [${module}] ${metric} in ${msTime.toFixed(2)}ms`);
    }

    static trace(animId, frame, coord, error) {
        const cStr = coord ? `${coord.x},${coord.y},${coord.z}` : "N/A";
        console.error(`\n[BSM] §cCRITICAL TRACE§r\nAnimID: ${animId || "Unknown"}\nFrame: ${frame !== undefined ? frame : "N/A"}\nCoord: ${cStr}\nMessage: ${error.message || error}\nStack: ${error.stack || "No stack trace available"}\n`);
    }

    /**
     * Shows a message in the player's action bar.
     */
    static actionBar(player, message) {
        if (player && player.onScreenDisplay) {
            player.onScreenDisplay.setActionBar(message);
        }
    }
}
