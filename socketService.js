const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"]
    },
    // Grok's DoS Protection: Limit the max number of concurrent connections if needed
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    }
  });

  // 1. Connection Middleware (The Gatekeeper)
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Auth required"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userData = decoded;
      socket.token = token; // Store for re-verification
      next();
    } catch (err) {
      return next(new Error("Invalid token"));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.userData.userId);
    socket.join(userId);

    // 2. The "Re-Auth" Listener
    // If the frontend sees the token is about to expire, it sends a fresh one
    socket.on('refresh_auth', (newToken) => {
      try {
        const decoded = jwt.verify(newToken, process.env.JWT_SECRET);
        if (String(decoded.userId) === userId) {
          socket.userData = decoded;
          socket.token = newToken;
          logger.debug({ module: 'Socket', event: 'token_refreshed', userId });
        }
      } catch (err) {
        socket.disconnect(true); // Token was fake or expired
      }
    });

    // 3. Packet Middleware (The Guard)
    // Every time the client sends a message, we verify they are still "legal"
    socket.use(([event, ...args], next) => {
      try {
        jwt.verify(socket.token, process.env.JWT_SECRET);
        next();
      } catch (err) {
        logger.warn({ module: 'Socket', event: 'token_expired_mid_session', userId });
        socket.disconnect(true);
      }
    });

    logger.info({ module: 'Socket', event: 'secure_connect', userId });
  });

  return io;
};

/**
 * Optimized Notify: Checks if anyone is actually listening
 */
const notifyUser = (userId, event, data) => {
  if (!io) return;
  
  const room = String(userId);
  const hasClients = io.sockets.adapter.rooms.has(room);
  
  if (hasClients) {
    io.to(room).emit(event, data);
  } else {
    logger.debug({ module: 'Socket', event: 'skip_notify_no_client', userId });
  }
};

module.exports = { initSocket, notifyUser };
