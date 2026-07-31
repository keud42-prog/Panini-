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

// --------------------------------------------
// État en mémoire
// --------------------------------------------
let orders = [];        // commandes actives (statut 'attente' ou 'pret')
let history = [];        // commandes servies aujourd'hui (gardées pour l'historique)
let encaissees = [];     // commandes encaissées aujourd'hui (pour le total caisse)
let totalEncaisse = 0;   // somme € encaissée aujourd'hui
let totalToday = 0;      // nombre de commandes passées aujourd'hui
let orderCounter = 0;

// Recalcule un total à partir des articles (sécurité)
function computeTotal(items) {
  return (items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
}

// --------------------------------------------
// Résolution des fichiers HTML par mot-clé
// (tolérant aux noms : _final, majuscules, espaces...)
// --------------------------------------------
function findHtml(keyword) {
  const files = fs.readdirSync(__dirname).filter(f => f.toLowerCase().endsWith('.html'));
  return files.find(f => f.toLowerCase().includes(keyword)) || null;
}
const PAGES = {
  borne: findHtml('borne'),
  cuisine: findHtml('cuisine'),
  caisse: findHtml('caisse'),
};

// --------------------------------------------
// Serveur HTTP (sert les pages)
// --------------------------------------------
const server = http.createServer((req, res) => {
  let fileName = null;
  if (req.url === '/' || req.url === '/borne') fileName = PAGES.borne;
  else if (req.url === '/cuisine') fileName = PAGES.cuisine;
  else if (req.url === '/caisse') fileName = PAGES.caisse;
  else { res.writeHead(404); res.end('Page non trouvée'); return; }

  if (!fileName) {
    console.error(`⚠️  Aucun fichier HTML trouvé pour ${req.url}`);
    res.writeHead(500);
    res.end(`Fichier introuvable pour ${req.url}.`);
    return;
  }

  fs.readFile(path.join(__dirname, fileName), (err, data) => {
    if (err) {
      console.error(`❌ Erreur lecture ${fileName} :`, err.code || err.message);
      res.writeHead(500);
      res.end('Erreur serveur : ' + (err.code || err.message));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

// --------------------------------------------
// Serveur WebSocket
// --------------------------------------------
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// Toutes les 30s : ferme les connexions mortes (ping/pong niveau WebSocket)
const liveness = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);
wss.on('close', () => clearInterval(liveness));

wss.on('connection', (ws) => {
  console.log('✅ Nouveau client connecté');
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // État complet envoyé au nouvel arrivant (survit aux rechargements de page)
  ws.send(JSON.stringify({
    type: 'INIT', orders, history, encaissees, totalEncaisse, totalToday
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ---- Keepalive : garde la connexion vivante et réveille Render ----
      case 'PING': { try { ws.send(JSON.stringify({ type: 'PONG' })); } catch {} break; }

      // ---- Re-synchro : renvoie l'état complet à ce client (rattrape les messages manqués) ----
      case 'RESYNC': {
        try { ws.send(JSON.stringify({ type: 'INIT', orders, history, encaissees, totalEncaisse, totalToday })); } catch {}
        break;
      }

      // ---- Borne : nouvelle commande ----
      case 'NEW_ORDER': {
        orderCounter++;
        totalToday++;
        const items = Array.isArray(msg.items) ? msg.items : [];
        let total = Number(msg.total);
        if (!total || isNaN(total)) total = computeTotal(items);
        const newOrder = {
          id: Date.now(),
          num: String(orderCounter).padStart(2, '0'),
          items, total,
          status: 'attente',   // arrive dans "À accepter"
          paid: false,
          createdAt: Date.now()
        };
        orders.push(newOrder);
        console.log(`🆕 #${newOrder.num} — ${items.length} art. — ${total.toFixed(2)}€`);
        broadcast({ type: 'NEW_ORDER', order: newOrder, totalToday });
        break;
      }

      // ---- Cuisine : changer le statut (Accepter -> 'pret', Retour -> 'attente') ----
      case 'UPDATE_STATUS': {
        const o = orders.find(o => o.id === msg.id);
        if (o) {
          o.status = msg.status;
          console.log(`🔄 #${o.num} → ${msg.status}`);
          broadcast({ type: 'UPDATE_STATUS', id: o.id, status: o.status });
        }
        break;
      }

      // ---- Cuisine : modifier les articles d'une commande ----
      case 'EDIT_ORDER': {
        const o = orders.find(o => o.id === msg.id);
        if (o && Array.isArray(msg.items)) {
          o.items = msg.items;
          o.total = computeTotal(msg.items);
          console.log(`✏️  #${o.num} modifiée → ${o.total.toFixed(2)}€`);
          broadcast({ type: 'EDIT_ORDER', id: o.id, items: o.items, total: o.total });
        }
        break;
      }

      // ---- Cuisine : commande servie -> va dans l'historique ----
      case 'SERVE_ORDER': {
        const idx = orders.findIndex(o => o.id === msg.id);
        if (idx !== -1) {
          const served = orders[idx];
          served.servedAt = Date.now();
          orders.splice(idx, 1);
          history.unshift(served);
          console.log(`🎉 #${served.num} servie`);
          broadcast({ type: 'SERVE_ORDER', id: served.id, order: served });
        }
        break;
      }

      // ---- Cuisine : restaurer une commande de l'historique ----
      case 'RESTORE_ORDER': {
        const idx = history.findIndex(o => o.id === msg.id);
        if (idx !== -1) {
          const restored = history[idx];
          history.splice(idx, 1);
          delete restored.servedAt;
          restored.status = 'attente';
          orders.push(restored);
          console.log(`↩️  #${restored.num} restaurée`);
          broadcast({ type: 'RESTORE_ORDER', order: restored });
        }
        break;
      }

      // ---- Cuisine : annuler/supprimer une commande (sans la servir) ----
      case 'DELETE_ORDER': {
        const idx = orders.findIndex(o => o.id === msg.id);
        if (idx !== -1) {
          const del = orders[idx];
          orders.splice(idx, 1);
          console.log(`🗑️  #${del.num} annulée`);
          broadcast({ type: 'DELETE_ORDER', id: msg.id });
        }
        break;
      }

      // ---- Caisse : vente faite directement à la caisse (épicerie / comptoir) ----
      case 'CAISSE_SALE': {
        orderCounter++;
        totalToday++;
        const items = Array.isArray(msg.items) ? msg.items : [];
        let total = Number(msg.total);
        if (!total || isNaN(total)) total = computeTotal(items);
        const o = {
          id: Date.now(),
          num: String(orderCounter).padStart(2, '0'),
          items, total,
          status: msg.toKitchen ? 'attente' : 'direct',
          paid: true,              // une vente caisse est payée immédiatement
          payment: msg.payment || 'especes',
          source: 'caisse',
          createdAt: Date.now()
        };
        encaissees.unshift(o);
        totalEncaisse += total;
        if (msg.toKitchen) {
          orders.push(o);          // la cuisine doit la voir et la préparer
          console.log(`🛒➡️🍳 Vente caisse #${o.num} envoyée en cuisine — ${total.toFixed(2)}€`);
          broadcast({ type: 'NEW_ORDER', order: o, totalToday });
        } else {
          console.log(`🛒 Vente directe caisse #${o.num} — ${total.toFixed(2)}€`);
        }
        broadcast({ type: 'ENCAISSE', id: o.id, order: o, totalEncaisse });
        break;
      }

      // ---- Clôture de journée : remise à zéro des compteurs ----
      case 'CLOSE_DAY': {
        console.log('🔒 Clôture de la journée — remise à zéro');
        orders = [];
        history = [];
        encaissees = [];
        totalEncaisse = 0;
        totalToday = 0;
        orderCounter = 0;
        broadcast({ type: 'INIT', orders, history, encaissees, totalEncaisse, totalToday });
        break;
      }

      // ---- Caisse : encaisser ----
      case 'ENCAISSE': {
        // On cherche d'abord dans les commandes actives, sinon dans l'historique
        const o = orders.find(o => o.id === msg.id) || history.find(o => o.id === msg.id);
        if (o && !o.paid) {
          o.paid = true;
          o.payment = msg.payment || 'especes';
          encaissees.unshift(o);
          totalEncaisse += (o.total || 0);
          console.log(`💳 #${o.num} encaissée (${o.payment}) — ${(o.total||0).toFixed(2)}€`);
          broadcast({ type: 'ENCAISSE', id: o.id, order: o, totalEncaisse });
        }
        break;
      }
    }
  });

  ws.on('close', () => console.log('❌ Client déconnecté'));
});

server.listen(PORT, () => {
  console.log('\n🍔 KSA Alimentation — Serveur');
  console.log(`✅ Démarré sur le port ${PORT}\n`);
  console.log('📄 Fichiers HTML détectés :');
  fs.readdirSync(__dirname).filter(f => f.toLowerCase().endsWith('.html')).forEach(f => console.log('   - ' + f));
  console.log('\n🔗 Routes :');
  console.log('   📱 /borne   →', PAGES.borne   || '❌ AUCUN');
  console.log('   🍳 /cuisine →', PAGES.cuisine || '❌ AUCUN');
  console.log('   💳 /caisse  →', PAGES.caisse  || '❌ AUCUN');
  console.log('');
});
