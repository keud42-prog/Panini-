const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));
app.use(express.json());

// Tes pages
app.get('/', (req,res) => res.sendFile(path.join(__dirname, 'ksa_borne_final.html')));
app.get('/borne', (req,res) => res.sendFile(path.join(__dirname, 'ksa_borne_final.html')));
app.get('/caisse', (req,res) => res.sendFile(path.join(__dirname, 'ksa_caisse.html')));
app.get('/cuisine', (req,res) => res.sendFile(path.join(__dirname, 'ksa_cuisine_final.html')));

let commandes = [];

// TEMPS RÉEL BORNE -> CAISSE -> CUISINE
io.on('connection', (socket) => {
  console.log('Nouveau client');
  socket.emit('commandes_init', commandes);

  socket.on('nouvelle_commande', (cmd) => {
    commandes.push(cmd);
    io.emit('nouvelle_commande', cmd);
    console.log('Nouvelle commande:', cmd.id);
  });

  socket.on('commande_encaissee', (cmd) => {
    io.emit('commande_encaissee', cmd);
    // met à jour le statut
    let c = commandes.find(x => x.id === cmd.id);
    if(c) c.statut = 'payee';
  });

  socket.on('commande_prete', (id) => {
    io.emit('commande_prete', id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('KSA SERVEUR OK port ' + PORT));
