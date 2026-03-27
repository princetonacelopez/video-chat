import { Http3Server } from '@fails-components/webtransport';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const expressApp = express();
expressApp.use(express.static(path.join(__dirname, '../public')));

const httpsServer = https.createServer({
  key: fs.readFileSync(path.join(__dirname, 'cert.key')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
}, expressApp);

async function startServer() {
  const server = new Http3Server({
    host: '127.0.0.1',
    port: PORT,
    secret: 'mysecret123',
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
    privKey: fs.readFileSync(path.join(__dirname, 'cert.key')),
    http3Server: httpsServer
  });

  server.onServerError = (err) => {
    console.error('Server error:', err);
  };

  server.onServerListening = () => {
    console.log(`WebTransport server ready`);
  };

  const sessionStream = server.sessionStream('/wt/:room');
  
  async function processSessions() {
    const reader = sessionStream.getReader();
    while (true) {
      try {
        const { done, value } = await reader.read();
        if (done) break;
        handleSession(value);
      } catch (e) {
        console.error('Error reading session:', e);
      }
    }
  }
  
  processSessions();
  
  server.startServer();
  
  httpsServer.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running at https://localhost:${PORT}`);
    console.log(`Open this URL in Chrome or Edge browser`);
  });
}

function handleSession(session) {
  const roomCode = session.headers?.[':path']?.split('/').pop() || 'default';
  
  console.log(`Client joined room ${roomCode}`);
  
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, { clients: new Set() });
  }
  
  const room = rooms.get(roomCode);
  room.clients.add(session);
  
  if (room.clients.size === 2) {
    const clients = Array.from(room.clients);
    for (const client of clients) {
      try {
        client.send(JSON.stringify({ type: 'peer-ready' }));
      } catch (e) {
        console.error('Error notifying peer:', e);
      }
    }
  }
  
  session.closed.then(() => {
    room.clients.delete(session);
    broadcastToRoom(roomCode, { type: 'peer-disconnected' }, session);
    console.log(`Client left room ${roomCode}`);
    
    if (room.clients.size === 0) {
      rooms.delete(roomCode);
    }
  });
  
  session.datagramsReadable.on('data', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('Received:', message.type);
      broadcastToRoom(roomCode, message, session);
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });
}

function broadcastToRoom(roomCode, message, exclude) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const data = JSON.stringify(message);
  
  room.clients.forEach(client => {
    if (client !== exclude) {
      try {
        client.datagrams.writable.getWriter().write(data);
      } catch (e) {
        console.error('Error broadcasting:', e);
      }
    }
  });
}

startServer().catch(console.error);
