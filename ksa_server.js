// ============================================
// KSA Alimentation — Serveur de commandes
// ============================================
// Installation : npm install ws
// Lancement    : node ksa_server.js
// ============================================

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Stockage des commandes en mémoire
let orders = [];
let orderCounter = 0;
let totalToday = 0;

// Serveur HTTP (sert les fichiers HTML)
const server = http.createServer((req, res) => {
  let filePath = '';

  if (req.url === '/' || req.url === '/borne') {
    filePath = path.join(__dirname, 'ksa_borne_final.html');
  } else if (req.url === '/cuisine') {
    filePath = path.join(__dirname, 'ksa_cuisine_final.html');
  } else if (req.url === '/caisse') {
    filePath = path.join(__dirname, 'ksa_caisse.html');
  } else {
    res.writeHead(404);
    res.end('Page non trouvée');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Erreur serveur');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

// Serveur WebSocket
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('✅ Nouveau client connecté');

  // Envoyer l'état actuel au nouveau client
  ws.send(JSON.stringify({ type: 'INIT', orders, totalToday }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // La borne envoie une nouvelle commande
      case 'NEW_ORDER':
        orderCounter++;
        totalToday++;
        const newOrder = {
          id: Date.now(),
          num: String(orderCounter).padStart(2, '0'),
          items: msg.items,
          total: msg.total,
          status: 'attente',
          createdAt: Date.now()
        };
        orders.push(newOrder);
        console.log(`🆕 Commande #${newOrder.num} reçue (${msg.items.length} articles)`);
        broadcast({ type: 'NEW_ORDER', order: newOrder, totalToday });
        break;

      // La cuisine change le statut
      case 'UPDATE_STATUS':
        const order = orders.find(o => o.id === msg.id);
        if (order) {
          order.status = msg.status;
          console.log(`🔄 Commande #${order.num} → ${msg.status}`);
          broadcast({ type: 'UPDATE_STATUS', id: msg.id, status: msg.status });
        }
        break;

      // La cuisine supprime une commande (servie)
      case 'DELETE_ORDER':
        const idx = orders.findIndex(o => o.id === msg.id);
        if (idx !== -1) {
          const deleted = orders[idx];
          orders.splice(idx, 1);
          console.log(`✅ Commande #${deleted.num} servie et supprimée`);
          broadcast({ type: 'DELETE_ORDER', id: msg.id });
        }
        break;
    }
  });

  ws.on('close', () => console.log('❌ Client déconnecté'));
});

server.listen(PORT, () => {
  console.log('');
  console.log('🍔 ================================');
  console.log('   KSA Alimentation — Serveur');
  console.log('🍔 ================================');
  console.log('');
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  console.log('');
  console.log('📱 Borne client  → http://localhost:' + PORT + '/borne');
  console.log('🍳 Écran cuisine → http://localhost:' + PORT + '/cuisine');
  console.log('💳 Caisse        → http://localhost:' + PORT + '/caisse');
  console.log('');
});
