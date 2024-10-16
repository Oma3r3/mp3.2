const express = require('express');
const mongoose = require('mongoose');
const promClient = require('prom-client');
const axios = require('axios');
const cors = require('cors'); 

const app = express();
app.use(express.json());

app.use(cors({
  origin: '*', // Temporarily allow all origins for testing
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  buckets: [0.1, 0.5, 1, 2, 5],
});

register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDurationSeconds);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpRequestsTotal.inc({ method: req.method, route: req.path, status_code: res.statusCode });
    httpRequestDurationSeconds.observe(duration / 1000);
  });
  next();
});

// mongoose.connect('mongodb://localhost:27017/productdb', { useNewUrlParser: true, useUnifiedTopology: true });
// mongoose.connect('mongodb://mongodb-service:27017/productdb', { useNewUrlParser: true, useUnifiedTopology: true });
mongoose.connect('mongodb://mongodb-service:27017/productdb');
const Product = mongoose.model('Product', new mongoose.Schema({
  name: String,
  price: Number,
  stock: Number,
}));

app.get('/products', async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching products' });
  }
});

app.post('/products', async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error creating product' });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching product' });
  }
});

app.put('/products/:id/stock', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.stock < req.body.quantity) return res.status(400).json({ error: 'Insufficient stock' });
    
    product.stock -= req.body.quantity;
    await product.save();
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error updating product stock' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const port = 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Product service listening at http://0.0.0.0:${port}`);
});