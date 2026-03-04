/**
 * Achoo Relay Server
 * 
 * Sits between the M5StickC device and the app.
 * Device connects outbound → relay holds connection open
 * App connects → relay routes messages both ways
 * 
 * Run locally:  node server.js
 * Public URL:   ngrok http 3000  (in a separate terminal)
 */

const WebSocket = require('ws');
const http      = require('http');

const PORT = process.env.PORT || 3000;

// Track connected devices and apps
// Key = deviceId (e.g. "achoo-1"), Value = { device: ws, apps: Set<ws> }
const rooms = new Map();

// Create HTTP server — also used as health check
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

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
console.log('New connection:', req.url);
  const url    = new URL(req.url, 'http://localhost');
  const role   = url.searchParams.get('role');    // 'device' or 'app'
  const roomId = url.searchParams.get('room');    // device ID e.g. 'achoo-1'

  if (!role || !roomId) {
    ws.close(1008, 'Missing role or room');
    return;
  }

  // Ensure room exists
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { device: null, apps: new Set() });
  }
  const room = rooms.get(roomId);

  if (role === 'device') {
    // ---- DEVICE CONNECTED ----
    room.device = ws;
    console.log(`[${roomId}] Device connected`);

    // Tell all waiting apps the device is online
    room.apps.forEach(app => {
      safeSend(app, JSON.stringify({ type: 'device_online' }));
    });

    ws.on('message', (data) => {
      // Device sent sensor data → forward to all connected apps
      console.log(`[${roomId}] Device → Apps: ${data}`);
      room.apps.forEach(app => safeSend(app, data));
    });

    ws.on('close', () => {
      console.log(`[${roomId}] Device disconnected`);
      room.device = null;
      // Tell apps device went offline
      room.apps.forEach(app => {
        safeSend(app, JSON.stringify({ type: 'device_offline' }));
      });
    });

    ws.on('error', (err) => console.error(`[${roomId}] Device error:`, err.message));

  } else if (role === 'app') {
    // ---- APP CONNECTED ----
    room.apps.add(ws);
    console.log(`[${roomId}] App connected (${room.apps.size} total)`);

    // Tell app immediately whether device is online
    safeSend(ws, JSON.stringify({
      type:   room.device ? 'device_online' : 'device_offline'
    }));

    ws.on('message', (data) => {
      // App sent command (e.g. IR code) → forward to device
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

httpServer.listen(PORT, () => {
  console.log(`
  Achoo Relay Server
  ─────────────────────────────
  Local:   ws://localhost:${PORT}
  Health:  http://localhost:${PORT}/health
  
  To expose publicly:
    ngrok http ${PORT}
  
  Then update firmware RELAY_URL to your ngrok URL
  ─────────────────────────────
  `);
});