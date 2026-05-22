// backend/utils/logger.js
const pino = require('pino');

const transport = process.env.NODE_ENV === 'production'
  ? { 
      target: 'pino/file', 
      options: { 
        destination: './logs/app.log',
        mkdir: true 
      } 
    }
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname'
      }
    };

const logger = pino({
  transport,
  level: process.env.LOG_LEVEL || 'info'   // allows LOG_LEVEL=debug in dev
});

module.exports = logger;
