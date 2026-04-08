export class ConsoleOut {
    static PREFIX = "§l§b[BSM]§r ";
    static SUCCESS_ICON = "§a✔ ";
    static INFO_ICON = "§bℹ ";
    static WARN_ICON = "§e⚠ ";
    static ERROR_ICON = "§c✘ ";

    /**
     * Sends a message to the player's action bar.
     */
    static actionBar(player, message) {
        if (player) player.onScreenDisplay.setActionBar(message);
    }

    /**
     * Sends a message to the player's chat.
     */
    static info(player, message) {
        if (player) player.sendMessage(`${this.PREFIX}${this.INFO_ICON}§f${message}`);
    }

    /**
     * Sends a success message to the player's chat.
     */
    static success(player, message) {
        if (player) player.sendMessage(`${this.PREFIX}${this.SUCCESS_ICON}§a${message}`);
    }

    /**
     * Sends a warning message to the player's chat and console.
     */
    static warn(player, message) {
        if (player) player.sendMessage(`${this.PREFIX}${this.WARN_ICON}§eWarning: ${message}`);
        console.warn(`[BSM] Warning: ${message}`);
    }

    /**
     * Sends an error message to the player's chat and creator console.
     */
    static error(player, message, error = null) {
        if (player) player.sendMessage(`${this.PREFIX}${this.ERROR_ICON}§cError: ${message}`);
        console.error(`[BSM] Error: ${message}`, error ? `\nDetails: ${error}` : "");
    }

    /**
     * Log to console only.
     * @param {string} message 
     */
    static log(message) {
        console.log(`[BSM] ${message}`);
    }
}
