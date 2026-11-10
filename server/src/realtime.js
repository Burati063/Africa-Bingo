let ioRef = null;

export function setIO(io) {
  ioRef = io;
}

export function emitToUser(userId, event, payload) {
  ioRef?.to(`user:${userId}`).emit(event, payload);
}

export function broadcast(event, payload) {
  ioRef?.emit(event, payload);
}

export function broadcastState(state) {
  ioRef?.emit('state', state);
}
