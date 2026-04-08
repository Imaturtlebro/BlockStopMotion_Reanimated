import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { Logger } from "../utils/Logger.js";
import { renderCore } from "../core/RenderCore.js";
import { recordingEngine } from "../core/RecordingEngine.js";
import { menuDirector } from "./MenuDirector.js";

// Circular dependency handling:
// MenuDirector is the entry point. Other managers might need to call back to Main.

export class UIManager {
    constructor() {
        // Shared state or utilities could go here
    }

    // Helper to get settings
    getSettings(player) {
        // For now, settings are just stored in a weak map or similar in the main instance.
        // We might want to move settings to a dedicated SettingsManager later.
        // For this refactor, we'll access a global or shared settings object if needed,
        // or just keep passing them around.
        // Actually, main.js had a simple `this.settings` map.
        // Let's rely on `menuDirector` to hold the "Global State" for UI navigation if needed.
        return menuDirector.getSettings(player);
    }
}
