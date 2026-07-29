const express = require('express');
const path = require('path');
const app = express();

// Sert tous les fichiers html, css, js
app.use(express.static(__dirname));
app.use(express.json());

// Page d'accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'ksa_borne_final.html'));
});

// Routes claires
app.get('/borne', (req,res) => res.sendFile(path.join(__dirname, 'ksa_borne_final.html')));
app.get('/caisse', (req,res) => res.sendFile(path.join(__dirname, 'ksa_caisse.html')));
app.get('/cuisine', (req,res) => res.sendFile(path.join(__dirname, 'ksa_cuisine_final.html')));

// Pour debug : liste les fichiers
app.get('/debug', (req,res) => {
  const fs = require('fs');
  res.send(fs.readdirSync(__dirname));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('KSA SERVEUR OK sur port ' + PORT));
