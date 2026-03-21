const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

let io;

/**
 * Initialize secure Socket.IO server with JWT auth, auto-join, token refresh & recovery
 * @param {http.Server} server - The HTTP/HTTPS server to attach Socket.IO to
 * @returns {Server} The initialized io instance
 */
const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes - good for mobile/WiFi drops
    },
  });

  // ────────────────────────────────────────────────
  // 1. Connection Middleware - The Gatekeeper
  // ────────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userData = decoded;
      socket.token = token; // Store original for re-verification
      next();
    } catch (err) {
      logger.warn({ module: 'Socket', event: 'handshake_failed', reason: err.message });
      return next(new Error('Invalid or expired token'));
    }
  });

  // ────────────────────────────────────────────────
  // 2. On connection: auto-join user's private room
  // ────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = String(socket.userData.userId);
    socket.join(userId);

    logger.info({
      module: 'Socket',
      event: 'secure_connect',
      userId,
      socketId: socket.id,
    });

    // ────────────────────────────────────────────────
    // Refresh auth handler (hardened against replay & mismatch)
    // ────────────────────────────────────────────────
    socket.on('refresh_auth', (newToken) => {
      try {
        if (!newToken) throw new Error('no token provided');

        const decoded = jwt.verify(newToken, process.env.JWT_SECRET);

        if (String(decoded.userId) !== userId) {
          throw new Error('user mismatch');
        }

        if (decoded.iat <= socket.userData.iat) {
          throw new Error('replayed or older token');
        }

        // Optional: extra check (jwt.verify already enforces exp, but explicit is nice)
        if (decoded.exp * 1000 < Date.now()) {
          throw new Error('token already expired');
        }

        socket.userData = decoded;
        socket.token = newToken;

        logger.debug({
          module: 'Socket',
          event: 'token_refreshed',
          userId,
          newIat: decoded.iat,
        });
      } catch (err) {
        logger.warn({
          module: 'Socket',
          event: 'refresh_failed',
          userId,
          reason: err.message.includes('jwt') ? 'invalid token' : err.message,
        });
        socket.disconnect(true);
      }
    });

    // ────────────────────────────────────────────────
    // 3. Packet-level middleware - Re-verify on every incoming packet
    // ────────────────────────────────────────────────
    socket.use(([event, ...args], next) => {
      try {
        jwt.verify(socket.token, process.env.JWT_SECRET);
        next();
      } catch (err) {
        logger.warn({
          module: 'Socket',
          event: 'token_expired_mid_session',
          userId,
          eventName: event,
        });
        socket.disconnect(true);
      }
    });

    // Optional: basic disconnect logging
    socket.on('disconnect', (reason) => {
      logger.debug({
        module: 'Socket',
        event: 'disconnect',
        userId,
        reason,
      });
    });
  });

  return io;
};

/**
 * Notify a specific user (private room) only if they're currently connected
 * @param {string|number} userId
 * @param {string} event
 * @param {any} data
 */
const notifyUser = (userId, event, data) => {
  if (!io) {
    logger.warn({ module: 'Socket', event: 'notify_failed_io_not_ready' });
    return;
  }

  const room = String(userId);
  const hasClients = io.sockets.adapter.rooms.has(room);

  if (hasClients) {
    io.to(room).emit(event, data);
    logger.debug({ module: 'Socket', event: 'notify_sent', userId, eventName: event });
  } else {
    logger.debug({ module: 'Socket', event: 'skip_notify_no_client', userId, eventName: event });
  }
};

module.exports = { initSocket, notifyUser };
