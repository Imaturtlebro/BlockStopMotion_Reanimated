import { Logger } from "../utils/Logger.js";

/**
 * RigManager handles hierarchical selection nodes.
 * Allows binding multiple bounding boxes together so they move as a single unit.
 */
class RigManager {
    constructor() {
        this.playerRigs = new Map(); // PlayerId -> Map(NodeId -> NodeData)
    }

    /**
     * Creates or updates a Rig Node for a player.
     */
    createNode(player, id, pos1, pos2, parentId = null) {
        if (!this.playerRigs.has(player.id)) {
            this.playerRigs.set(player.id, new Map());
        }

        const rig = this.playerRigs.get(player.id);
        const node = {
            id,
            pos1: { ...pos1 },
            pos2: { ...pos2 },
            pivot: { x: (pos1.x + pos2.x) / 2, y: (pos1.y + pos2.y) / 2, z: (pos1.z + pos2.z) / 2 },
            parentId,
            physics: { enabled: false, delay: 0, overshoot: 0.2 } // Default physics
        };

        rig.set(id, node);
        Logger.success(player, `Rig Node '§e${id}§r' created${parentId ? ` (Child of §b${parentId}§r)` : ""}.`);
    }

    /**
     * Gets all nodes that are children of the specified parent.
     */
    getChildren(player, parentId) {
        const rig = this.playerRigs.get(player.id);
        if (!rig) return [];

        const children = [];
        for (const node of rig.values()) {
            if (node.parentId === parentId) {
                children.push(node);
            }
        }
        return children;
    }

    /**
     * Recursively updates the status and positions of a rig hierarchy.
     * This is called when a parent is moved.
     */
    propagateMove(player, nodeId, dx, dy, dz, callback) {
        const rig = this.playerRigs.get(player.id);
        if (!rig) return;

        const children = this.getChildren(player, nodeId);
        for (const child of children) {
            const processMove = (cdx, cdy, cdz) => {
                child.pos1.x += cdx;
                child.pos1.y += cdy;
                child.pos1.z += cdz;
                child.pos2.x += cdx;
                child.pos2.y += cdy;
                child.pos2.z += cdz;
                if (child.pivot) {
                    child.pivot.x += cdx;
                    child.pivot.y += cdy;
                    child.pivot.z += cdz;
                }
                callback(child, cdx, cdy, cdz);
                this.propagateMove(player, child.id, cdx, cdy, cdz, callback);
            };

            if (child.physics && child.physics.enabled) {
                const delay = child.physics.delay || 1;
                const overshoot = child.physics.overshoot || 0.2;

                // 2-Phase Jiggle: Overshoot then Settle
                import("@minecraft/server").then(({ system }) => {
                    system.runTimeout(() => {
                        const odx = dx * (1 + overshoot);
                        const ody = dy * (1 + overshoot);
                        const odz = dz * (1 + overshoot);
                        processMove(odx, ody, odz);

                        system.runTimeout(() => {
                            const sdx = -dx * overshoot;
                            const sdy = -dy * overshoot;
                            const sdz = -dz * overshoot;
                            processMove(sdx, sdy, sdz);
                        }, 2);
                    }, delay);
                });
            } else {
                processMove(dx, dy, dz);
            }
        }
    }

    /**
     * Propagates rotation from a parent node to its children (Forward Kinematics).
     * Children orbit the parent's pivot point.
     */
    propagateRotate(player, parentNode, angleDeg, axis, callback) {
        const rig = this.playerRigs.get(player.id);
        if (!rig) return;

        const children = this.getChildren(player, parentNode.id);
        const angleRad = (angleDeg * Math.PI) / 180;
        const pivot = parentNode.pivot || {
            x: (parentNode.pos1.x + parentNode.pos2.x) / 2,
            y: (parentNode.pos1.y + parentNode.pos2.y) / 2,
            z: (parentNode.pos1.z + parentNode.pos2.z) / 2
        };

        for (const child of children) {
            const processRotate = (cAngleDeg) => {
                const cAngleRad = (cAngleDeg * Math.PI) / 180;
                const oldPos = {
                    x: (child.pos1.x + child.pos2.x) / 2,
                    y: (child.pos1.y + child.pos2.y) / 2,
                    z: (child.pos1.z + child.pos2.z) / 2
                };

                const rotatedPos = this._rotatePoint(oldPos, pivot, cAngleRad, axis);
                const dx = rotatedPos.x - oldPos.x;
                const dy = rotatedPos.y - oldPos.y;
                const dz = rotatedPos.z - oldPos.z;

                child.pos1.x += dx; child.pos1.y += dy; child.pos1.z += dz;
                child.pos2.x += dx; child.pos2.y += dy; child.pos2.z += dz;
                if (child.pivot) {
                    child.pivot.x += dx; child.pivot.y += dy; child.pivot.z += dz;
                }

                callback(child, dx, dy, dz, cAngleDeg, axis);
                this.propagateRotate(player, child, cAngleDeg, axis, callback);
            };

            if (child.physics && child.physics.enabled) {
                const delay = child.physics.delay || 1;
                const overshoot = child.physics.overshoot || 0.2;

                import("@minecraft/server").then(({ system }) => {
                    system.runTimeout(() => {
                        processRotate(angleDeg * (1 + overshoot));
                        system.runTimeout(() => {
                            processRotate(-angleDeg * overshoot);
                        }, 2);
                    }, delay);
                });
            } else {
                processRotate(angleDeg);
            }
        }
    }

    _rotatePoint(point, pivot, angleRad, axis) {
        let x = point.x - pivot.x;
        let y = point.y - pivot.y;
        let z = point.z - pivot.z;

        let nx = x, ny = y, nz = z;

        if (axis === "y") {
            nx = x * Math.cos(angleRad) - z * Math.sin(angleRad);
            nz = x * Math.sin(angleRad) + z * Math.cos(angleRad);
        } else if (axis === "x") {
            ny = y * Math.cos(angleRad) - z * Math.sin(angleRad);
            nz = y * Math.sin(angleRad) + z * Math.cos(angleRad);
        } else if (axis === "z") {
            nx = x * Math.cos(angleRad) - y * Math.sin(angleRad);
            ny = x * Math.sin(angleRad) + y * Math.cos(angleRad);
        }

        return { x: nx + pivot.x, y: ny + pivot.y, z: nz + pivot.z };
    }

    /**
     * Finds which rig node (if any) contains a specific coordinate.
     */
    getNodeAt(player, location) {
        const rig = this.playerRigs.get(player.id);
        if (!rig) return null;

        for (const node of rig.values()) {
            if (location.x >= node.pos1.x && location.x <= node.pos2.x &&
                location.y >= node.pos1.y && location.y <= node.pos2.y &&
                location.z >= node.pos1.z && location.z <= node.pos2.z) {
                return node;
            }
        }
        return null;
    }

    listNodes(player) {
        const rig = this.playerRigs.get(player.id);
        if (!rig) return [];
        return Array.from(rig.values());
    }

    deleteNode(player, id) {
        const rig = this.playerRigs.get(player.id);
        if (rig) rig.delete(id);
    }

    /**
     * Calculates and applies rotation to make a node face a target.
     * @param {Player} player - The player owner of the rig.
     * @param {string} nodeId - The node to rotate.
     * @param {Vector3} targetPos - The position to face.
     * @param {string} axis - The axis to rotate on ('x', 'y', 'z').
     */
    applyLookAt(player, nodeId, targetPos, axis = "y", callback) {
        const rig = this.playerRigs.get(player.id);
        if (!rig) return;
        const node = rig.get(nodeId);
        if (!node) return;

        const pivot = node.pivot;
        const dx = targetPos.x - pivot.x;
        const dy = targetPos.y - pivot.y;
        const dz = targetPos.z - pivot.z;

        let targetAngleDeg = 0;
        if (axis === "y") {
            targetAngleDeg = Math.atan2(dx, dz) * (180 / Math.PI);
        } else if (axis === "x") {
            const dist = Math.sqrt(dx * dx + dz * dz);
            targetAngleDeg = -Math.atan2(dy, dist) * (180 / Math.PI);
        }

        // Logic for tracking current angle to apply deltas would go here.
        // For Phase 2, we provide the math foundation for the callback to handle the physical transform.
        callback(node, targetAngleDeg, axis);
        this.propagateRotate(player, node, targetAngleDeg, axis, callback);
    }

    /**
     * Snaps a node's pivot to the nearest solid surface below it.
     */
    snapToSurface(player, nodeId) {
        const rig = this.playerRigs.get(player.id);
        if (!rig) return 0;
        const node = rig.get(nodeId);
        if (!node) return 0;

        const pivot = node.pivot;
        const dimension = player.dimension;
        
        const rayStart = { x: pivot.x, y: pivot.y + 1, z: pivot.z };
        const rayDir = { x: 0, y: -1, z: 0 };
        const hit = dimension.getBlockFromRay(rayStart, rayDir, { maxDistance: 16 });

        if (hit && hit.block) {
            const targetY = hit.block.y + 1;
            const dy = targetY - pivot.y;
            
            node.pos1.y += dy;
            node.pos2.y += dy;
            node.pivot.y += dy;
            
            Logger.success(player, `Snapped node '§e${nodeId}§r' to surface (ΔY: ${dy.toFixed(2)}).`);
            return dy;
        }
        
        Logger.warn(player, `No surface found below node '§e${nodeId}§r' within 16 blocks.`);
        return 0;
    }
}

export const rigManager = new RigManager();
