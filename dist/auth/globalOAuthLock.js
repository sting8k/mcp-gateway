import { getLogger } from "../logging.js";
const logger = getLogger();
/**
 * Global OAuth lock to prevent multiple OAuth flows from starting simultaneously
 * This is a process-wide singleton that tracks OAuth flows across all connections
 */
export class GlobalOAuthLock {
    static instance;
    activeFlows = new Map();
    // Prevent multiple OAuth attempts for the same package within this window
    static OAUTH_COOLDOWN_MS = 30000; // 30 seconds
    static MAX_WAIT_TIME_MS = 300000; // 5 minutes
    constructor() { }
    static getInstance() {
        if (!GlobalOAuthLock.instance) {
            GlobalOAuthLock.instance = new GlobalOAuthLock();
        }
        return GlobalOAuthLock.instance;
    }
    /**
     * Try to acquire a lock for OAuth flow
     * Returns true if lock acquired, false if should wait
     */
    async acquireLock(packageId) {
        const existing = this.activeFlows.get(packageId);
        if (existing) {
            const elapsed = Date.now() - existing.startTime;
            // If the flow has been running too long, it might be stuck
            if (elapsed > GlobalOAuthLock.MAX_WAIT_TIME_MS) {
                logger.warn("OAuth flow timeout, allowing new attempt", {
                    package_id: packageId,
                    elapsed_ms: elapsed,
                });
                this.activeFlows.delete(packageId);
                return true;
            }
            // If a flow is active, wait for it
            logger.info("OAuth flow already active, waiting", {
                package_id: packageId,
                elapsed_ms: elapsed,
                attempt_count: existing.attemptCount,
            });
            try {
                await existing.promise;
            }
            catch (error) {
                logger.debug("Previous OAuth flow failed", {
                    package_id: packageId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            // After waiting, check if we should start a new flow
            const stillActive = this.activeFlows.get(packageId);
            if (stillActive && Date.now() - stillActive.startTime < GlobalOAuthLock.OAUTH_COOLDOWN_MS) {
                logger.debug("OAuth cooldown active, skipping", {
                    package_id: packageId,
                });
                return false;
            }
            return true;
        }
        // No active flow, we can proceed
        return true;
    }
    /**
     * Register an OAuth flow as active
     */
    registerFlow(packageId, flowPromise) {
        const existing = this.activeFlows.get(packageId);
        const attemptCount = existing ? existing.attemptCount + 1 : 1;
        logger.info("Registering OAuth flow", {
            package_id: packageId,
            attempt_count: attemptCount,
        });
        this.activeFlows.set(packageId, {
            promise: flowPromise,
            startTime: Date.now(),
            attemptCount,
        });
        // Clean up after completion
        flowPromise.finally(() => {
            // Keep the entry for cooldown period
            setTimeout(() => {
                const current = this.activeFlows.get(packageId);
                if (current && current.promise === flowPromise) {
                    this.activeFlows.delete(packageId);
                    logger.debug("OAuth flow cleaned up", {
                        package_id: packageId,
                    });
                }
            }, GlobalOAuthLock.OAUTH_COOLDOWN_MS);
        });
    }
    /**
     * Check if an OAuth flow is currently active
     */
    isFlowActive(packageId) {
        const existing = this.activeFlows.get(packageId);
        if (!existing)
            return false;
        const elapsed = Date.now() - existing.startTime;
        return elapsed < GlobalOAuthLock.MAX_WAIT_TIME_MS;
    }
    /**
     * Wait for any active OAuth flow to complete
     */
    async waitForFlow(packageId) {
        const existing = this.activeFlows.get(packageId);
        if (existing) {
            logger.debug("Waiting for OAuth flow", {
                package_id: packageId,
            });
            try {
                await existing.promise;
            }
            catch (error) {
                // Ignore errors, we just want to wait
            }
        }
    }
    /**
     * Clear all flows (useful for testing)
     */
    clearAll() {
        this.activeFlows.clear();
    }
}
