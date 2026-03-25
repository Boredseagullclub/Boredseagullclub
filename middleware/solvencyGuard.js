// middleware/solvencyGuard.js
let lastAuditResult = { overallStatus: 'UNKNOWN' };

// Export this so reconciler can update it after every audit
function updateLastAuditResult(report) {
  lastAuditResult = report;
}

const solvencyGuard = async (req, res, next) => {
  if (lastAuditResult.overallStatus !== 'SOLVENT') {
    return res.status(503).json({ 
      error: 'System Maintenance: Outflows are temporarily paused for security auditing.' 
    });
  }
  next();
};

module.exports = { solvencyGuard, updateLastAuditResult };
