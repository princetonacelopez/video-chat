import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, '../public')));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ roomCode, isInitiator }) => {
    console.log(`User ${socket.id} joining room ${roomCode} as initiator:`, isInitiator);
    
    const room = rooms.get(roomCode);
    
    if (room && room.expired) {
      socket.emit('room-expired');
      return;
    }
    
    if (room && room.size >= 2) {
      socket.emit('room-full');
      return;
    }
    
    socket.join(roomCode);
    
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, {
        sockets: new Set(),
        initiator: isInitiator,
        expired: false
      });
    }
    
    const roomData = rooms.get(roomCode);
    roomData.sockets.add(socket.id);
    
    const peerCount = roomData.sockets.size;
    socket.emit('peer-count', peerCount);
    
    socket.to(roomCode).emit('peer-joined', { 
      socketId: socket.id,
      isInitiator: isInitiator
    });
    
    console.log(`Room ${roomCode} now has ${peerCount} peer(s)`);
  });

  socket.on('offer', ({ roomCode, offer, to }) => {
    console.log(`Sending offer to ${to}`);
    socket.to(to).emit('offer', { 
      offer, 
      from: socket.id 
    });
  });

  socket.on('answer', ({ roomCode, answer, to }) => {
    console.log(`Sending answer to ${to}`);
    socket.to(to).emit('answer', { 
      answer, 
      from: socket.id 
    });
  });

  socket.on('ice-candidate', ({ roomCode, candidate, to }) => {
    if (to) {
      socket.to(to).emit('ice-candidate', { 
        candidate, 
        from: socket.id 
      });
    } else {
      socket.to(roomCode).emit('ice-candidate', { 
        candidate, 
        from: socket.id 
      });
    }
  });

  socket.on('chat-message', ({ roomCode, text }) => {
    console.log(`Chat message in room ${roomCode}:`, text);
    socket.to(roomCode).emit('chat-message', { 
      text, 
      from: socket.id 
    });
  });

  socket.on('end-call', ({ roomCode }) => {
    console.log(`End call requested in room ${roomCode}`);
    
    const room = rooms.get(roomCode);
    if (room) {
      room.expired = true;
    }
    
    socket.to(roomCode).emit('call-ended');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    rooms.forEach((roomData, roomCode) => {
      if (roomData.sockets.has(socket.id)) {
        roomData.sockets.delete(socket.id);
        socket.to(roomCode).emit('peer-left', { socketId: socket.id });
        
        console.log(`User ${socket.id} left room ${roomCode}`);
        
        if (roomData.sockets.size === 0) {
          rooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted`);
        }
      }
    });
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
