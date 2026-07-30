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
let encaissees = [];      // Historique des commandes encaissées aujourd'hui
let totalEncaisse = 0;    // Somme des montants encaissés aujourd'hui

// --------------------------------------------
// Résolution des fichiers HTML par MOT-CLÉ
// --------------------------------------------
// Au lieu de coder en dur "ksa_caisse.html", on cherche
// dans le dossier n'importe quel fichier .html qui contient
// le mot "caisse". Comme ça, que le fichier s'appelle
// "ksa_caisse.html", "ksa_caisse_final.html" ou "KSA Caisse.html",
// il sera trouvé. Fini les erreurs de nom sur Render.
function findHtml(keyword) {
  const files = fs.readdirSync(__dirname)
    .filter(f => f.toLowerCase().endsWith('.html'));
  return files.find(f => f.toLowerCase().includes(keyword)) || null;
}

// Au démarrage, on résout une fois pour toutes
const PAGES = {
  borne: findHtml('borne'),
  cuisine: findHtml('cuisine'),
  caisse: findHtml('caisse'),
};

// Serveur HTTP (sert les fichiers HTML)
const server = http.createServer((req, res) => {
  let fileName = null;

  if (req.url === '/' || req.url === '/borne') {
    fileName = PAGES.borne;
  } else if (req.url === '/cuisine') {
    fileName = PAGES.cuisine;
  } else if (req.url === '/caisse') {
    fileName = PAGES.caisse;
  } else {
    res.writeHead(404);
    res.end('Page non trouvée');
    return;
  }

  // Aucun fichier trouvé pour cette page -> message clair (pas juste "Erreur serveur")
  if (!fileName) {
    console.error(`⚠️  Aucun fichier HTML trouvé pour la route ${req.url}`);
    res.writeHead(500);
    res.end(`Fichier introuvable pour ${req.url}. Vérifie le nom du fichier .html dans ton repo.`);
    return;
  }

  const filePath = path.join(__dirname, fileName);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // On LOGGUE la vraie erreur pour la voir dans les logs Render
      console.error(`❌ Erreur lecture ${filePath} :`, err.code || err.message);
      res.writeHead(500);
      res.end('Erreur serveur : ' + (err.code || err.message));
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

  // Envoyer l'état actuel au nouveau client (commandes + historique caisse)
  ws.send(JSON.stringify({ type: 'INIT', orders, totalToday, encaissees, totalEncaisse }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // La borne envoie une nouvelle commande
      case 'NEW_ORDER': {
        orderCounter++;
        totalToday++;
        const newOrder = {
          id: Date.now(),
          num: String(orderCounter).padStart(2, '0'),
          items: msg.items,
          total: msg.total,
          status: 'attente',
          paid: false,
          createdAt: Date.now()
        };
        orders.push(newOrder);
        console.log(`🆕 Commande #${newOrder.num} reçue (${msg.items.length} articles)`);
        broadcast({ type: 'NEW_ORDER', order: newOrder, totalToday });
        break;
      }

      // La caisse encaisse une commande
      case 'ENCAISSE': {
        const order = orders.find(o => o.id === msg.id);
        if (order && !order.paid) {
          order.paid = true;
          encaissees.unshift(order);          // ajoute en tête de l'historique
          totalEncaisse += (order.total || 0); // total du jour, gardé côté serveur
          console.log(`💳 Commande #${order.num} encaissée (${(order.total||0).toFixed(2)}€)`);
          broadcast({ type: 'ENCAISSE', id: order.id, order, totalEncaisse });
        }
        break;
      }

      // La cuisine change le statut
      case 'UPDATE_STATUS': {
        const order = orders.find(o => o.id === msg.id);
        if (order) {
          order.status = msg.status;
          console.log(`🔄 Commande #${order.num} → ${msg.status}`);
          broadcast({ type: 'UPDATE_STATUS', id: msg.id, status: msg.status });
        }
        break;
      }

      // La cuisine supprime une commande (servie)
      case 'DELETE_ORDER': {
        const idx = orders.findIndex(o => o.id === msg.id);
        if (idx !== -1) {
          const deleted = orders[idx];
          orders.splice(idx, 1);
          console.log(`✅ Commande #${deleted.num} servie et supprimée`);
          broadcast({ type: 'DELETE_ORDER', id: msg.id });
        }
        break;
      }
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
  // Diagnostic : quels fichiers ont été trouvés pour chaque page
  console.log('📄 Fichiers HTML détectés dans le dossier :');
  fs.readdirSync(__dirname)
    .filter(f => f.toLowerCase().endsWith('.html'))
    .forEach(f => console.log('   - ' + f));
  console.log('');
  console.log('🔗 Correspondances :');
  console.log('   📱 /borne   →', PAGES.borne   || '❌ AUCUN FICHIER "borne" TROUVÉ');
  console.log('   🍳 /cuisine →', PAGES.cuisine || '❌ AUCUN FICHIER "cuisine" TROUVÉ');
  console.log('   💳 /caisse  →', PAGES.caisse  || '❌ AUCUN FICHIER "caisse" TROUVÉ');
  console.log('');
});
