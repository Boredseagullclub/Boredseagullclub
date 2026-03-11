// utils/slackAlert.js (or inline)
async function sendSlackAlert(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return;
  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { text: message });
  } catch (err) {
    logger.error({ module: 'SlackAlert', error: err.message });
  }
}

// In onerror (after reconnectAttempts++)
if (reconnectAttempts > 5) {
  sendSlackAlert(`🚨 Stellar listener repeated reconnects (${reconnectAttempts})! Check Horizon URL or network.`);
}

// In flushDeposits catch
if (depositBuffer.length > 5000) { // Backpressure threshold
  sendSlackAlert(`⚠️ Stellar buffer critically high: ${depositBuffer.length}. Possible overload or DB issue.`);
}
