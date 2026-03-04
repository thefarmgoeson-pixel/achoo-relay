const WebSocket = require('ws');
const http      = require('http');

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    const status = {
      status:  'ok',
      devices: [...rooms.entries()].map(([id, r]) => ({
        id,
        deviceConnected: !!r.device,
        appsConnected:   r.apps.size
      }))
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Achoo Relay Server running');
  }
});

const wss = new WebSocket.Server({ 
  server: httpServer,
  perMessageDeflate: false
});

wss.on('connection', (ws, req) => {
  console.log('New connection:', req.url);
  const url    = new URL(req.url, 'http://localhost');
  const role   = url.searchParams.get('role');
  const roomId = url.searchParams.get('room');

  if (!role || !roomId) {
    ws.close(1008, 'Missing role or room');
    return;
  }

  if (!rooms.has(roomId)) {
    rooms.set(roomId, { device: null, apps: new Set() });
  }
  const room = rooms.get(roomId);

  if (role === 'device') {
    room.device = ws;
    console.log(`[${roomId}] Device connected`);

    room.apps.forEach(app => {
      safeSend(app, JSON.stringify({ type: 'device_online' }));
    });

    ws.on('message', (data) => {
      console.log(`[${roomId}] Device → Apps: ${data}`);
      room.apps.forEach(app => safeSend(app, data));
    });

    ws.on('close', () => {
      console.log(`[${roomId}] Device disconnected`);
      room.device = null;
      room.apps.forEach(app => {
        safeSend(app, JSON.stringify({ type: 'device_offline' }));
      });
    });

    ws.on('error', (err) => console.error(`[${roomId}] Device error:`, err.message));

  } else if (role === 'app') {
    room.apps.add(ws);
    console.log(`[${roomId}] App connected (${room.apps.size} total)`);

    safeSend(ws, JSON.stringify({
      type: room.device ? 'device_online' : 'device_offline'
    }));

    ws.on('message', (data) => {
      console.log(`[${roomId}] App → Device: ${data}`);
      if (room.device) {
        safeSend(room.device, data);
      } else {
        safeSend(ws, JSON.stringify({ type: 'error', message: 'Device not connected' }));
      }
    });

    ws.on('close', () => {
      room.apps.delete(ws);
      console.log(`[${roomId}] App disconnected (${room.apps.size} remaining)`);
    });

    ws.on('error', (err) => console.error(`[${roomId}] App error:`, err.message));
  }
});

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
}

httpServer.listen(PORT, '0.0.0.0', () => {

  console.log(`
  Achoo Relay Server
  ─────────────────────────────
  Local:   ws://localhost:${PORT}
  Health:  http://localhost:${PORT}/health
  ─────────────────────────────
  `);
});
