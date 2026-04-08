import { Logger } from "./Logger.js";

export class ActionLog {
    constructor() {
        this.history = new Map(); // PlayerId -> Stack of Actions
        this.future = new Map();  // PlayerId -> Stack of Actions (for Redo)
        this.MAX_HISTORY = 50;
    }

    // Action Interface: { type: string, undo: () => void, redo: () => void, description: string }

    pushAction(player, action) {
        if (!this.history.has(player.id)) this.history.set(player.id, []);
        if (!this.future.has(player.id)) this.future.set(player.id, []);

        const stack = this.history.get(player.id);
        stack.push(action);
        if (stack.length > this.MAX_HISTORY) stack.shift(); // Limit size

        // Clear future on new action
        this.future.set(player.id, []);

        // Logger.info(player, `§7Action recorded: ${action.description}`);
    }

    undo(player) {
        const stack = this.history.get(player.id);
        if (!stack || stack.length === 0) {
            Logger.warn(player, "Nothing to undo.");
            return;
        }

        const action = stack.pop();
        try {
            action.undo();
            this.future.get(player.id).push(action);
            Logger.success(player, `Undid: §e${action.description}`);
        } catch (e) {
            Logger.error(player, `Undo failed: ${e.message}`);
        }
    }

    redo(player) {
        const stack = this.future.get(player.id);
        if (!stack || stack.length === 0) {
            Logger.warn(player, "Nothing to redo.");
            return;
        }

        const action = stack.pop();
        try {
            action.redo();
            this.history.get(player.id).push(action);
            Logger.success(player, `Redid: §e${action.description}`);
        } catch (e) {
            Logger.error(player, `Redo failed: ${e.message}`);
        }
    }
}

export const actionLog = new ActionLog();
