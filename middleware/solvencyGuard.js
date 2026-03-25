// middleware/solvencyGuard.js
let lastAuditResult = { overallStatus: 'UNKNOWN' };

function updateLastAuditResult(report) {
  lastAuditResult = report || { overallStatus: 'UNKNOWN' };
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
