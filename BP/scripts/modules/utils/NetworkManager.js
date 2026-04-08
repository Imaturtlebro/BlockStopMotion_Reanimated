// import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";
import { Logger } from "./Logger.js";

/**
 * NetworkManager handles external communication via HTTP requests.
 * Used for exporting animation data directly to a local server.
 */
export class NetworkManager {
    /**
     * Sends animation data to a specified endpoint.
     * @param {string} url - The destination URL (e.g., http://localhost:3000/export)
     * @param {Object} data - The animation JSON data
     */
    static async exportData(url, data) {
        return { success: false, message: "Network export temporarily disabled for testing." };
    }
}
