// middleware/solvencyGuard.js
const { getLastAuditResult } = require('../services/reconciler'); 

const solvencyGuard = async (req, res, next) => {
  const audit = getLastAuditResult(); // Should return the cached report from the cron
  
  if (!audit || audit.overallStatus !== 'SOLVENT') {
    return res.status(503).json({ 
      error: 'System Maintenance: Outflows are temporarily paused for security auditing.' 
    });
  }
  next();
};

module.exports = solvencyGuard;
