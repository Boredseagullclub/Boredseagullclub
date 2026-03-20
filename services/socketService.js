// services/socketService.js
const { Server } = require('socket.io');
let io;

const initSocket = (server) => {
  io = new Server(server, { cors: { origin: "*" } });

  io.on('connection', (socket) => {
    socket.on('join', (userId) => {
      socket.join(userId); // Users join a "room" named after their ID
      console.log(`User ${userId} joined their notification room`);
    });
  });
};

const notifyUserOfDeposit = (userId, depositData) => {
  if (io) {
    io.to(userId.toString()).emit('DEPOSIT_CREDITED', depositData);
  }
};

module.exports = { initSocket, notifyUserOfDeposit };
