const express = require('express');
const path = require('path');
const helmet = require('helmet');
const nocache = require('nocache');
const request = require('request');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middlewares
app.use(helmet());
app.use(nocache());
app.disable('x-powered-by');

// Proxy your GitHub Page content
app.get('/', (req, res) => {
  const url = 'https://abcoinseo.github.io/Abwalletmain/';
  req.pipe(request(url)).pipe(res);
});

// Block Inspect (Extra Security Layer if needed)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "script-src 'self'; object-src 'none';");
  next();
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
