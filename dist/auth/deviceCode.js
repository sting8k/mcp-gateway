import { getLogger } from "../logging.js";
const logger = getLogger();
export class DeviceCodeAuth {
    baseUrl;
    clientId;
    scopes;
    constructor(baseUrl, config) {
        this.baseUrl = baseUrl;
        this.clientId = config.client_id;
        this.scopes = config.scopes || [];
    }
    async beginDeviceCode() {
        logger.debug("Starting device code flow", {
            base_url: this.baseUrl,
            scopes: this.scopes,
        });
        const deviceCodeEndpoint = `${this.baseUrl}/oauth2/device_code`;
        const body = new URLSearchParams({
            client_id: this.clientId,
            scope: this.scopes.join(" "),
        });
        try {
            const response = await fetch(deviceCodeEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            });
            if (!response.ok) {
                throw new Error(`Device code request failed: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            logger.info("Device code flow initiated", {
                user_code: data.user_code,
                verification_uri: data.verification_uri,
                expires_in: data.expires_in,
            });
            return {
                method: "device_code",
                user_code: data.user_code,
                verification_uri: data.verification_uri,
                expires_in: data.expires_in,
                interval: data.interval,
            };
        }
        catch (error) {
            logger.error("Failed to start device code flow", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async pollForToken(deviceCode, interval) {
        const tokenEndpoint = `${this.baseUrl}/oauth2/token`;
        const body = new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode,
            client_id: this.clientId,
        });
        try {
            const response = await fetch(tokenEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            });
            if (response.status === 400) {
                const errorData = await response.json();
                if (errorData.error === "authorization_pending") {
                    // Still waiting for user authorization
                    return null;
                }
                else if (errorData.error === "slow_down") {
                    // Need to slow down polling
                    logger.debug("Slowing down device code polling");
                    return null;
                }
                else {
                    throw new Error(`Token request failed: ${errorData.error_description || errorData.error}`);
                }
            }
            if (!response.ok) {
                throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
            }
            const tokenData = await response.json();
            logger.info("Device code authentication successful");
            return tokenData;
        }
        catch (error) {
            logger.error("Failed to poll for token", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async waitForAuthorization(deviceCode, interval, expiresIn) {
        const startTime = Date.now();
        const maxWaitTime = expiresIn * 1000;
        logger.debug("Starting device code polling", {
            interval,
            expires_in: expiresIn,
        });
        while (Date.now() - startTime < maxWaitTime) {
            try {
                const token = await this.pollForToken(deviceCode, interval);
                if (token) {
                    return token;
                }
                // Wait for the specified interval before next poll
                await new Promise(resolve => setTimeout(resolve, interval * 1000));
            }
            catch (error) {
                if (error instanceof Error && error.message.includes("authorization_pending")) {
                    continue;
                }
                throw error;
            }
        }
        throw new Error("Device code authentication timed out");
    }
}
