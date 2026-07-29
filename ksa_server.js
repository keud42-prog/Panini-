const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(__dirname));

app.get('/', (req,res) => {
  res.sendFile(path.join(__dirname, 'ksa_borne_final.html'));
});

app.get('/debug', (req,res) => {
  const fs = require('fs');
  res.json(fs.readdirSync(__dirname));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('KSA OK ' + PORT));
