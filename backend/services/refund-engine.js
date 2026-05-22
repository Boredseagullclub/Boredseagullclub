// Mock Refund Engine for boot validation
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

logger.info("🎰 Mock Refund Engine loaded successfully");

module.exports = {
    processRefunds: async () => {
        // Placeholder for slot mechanics
        return true;
    }
};
