const express = require('express');
const helmet = require('helmet');
const nocache = require('nocache');
const path = require('path');
const request = require('request');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middlewares
app.use(helmet());
app.use(nocache());
app.disable('x-powered-by');

// Serve index.html directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Proxy your GitHub Page content secretly
app.get('/abwallet', (req, res) => {
  const url = 'https://abcoinseo.github.io/Abwalletmain/';
  req.pipe(request(url)).pipe(res);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
