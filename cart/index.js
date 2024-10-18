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

mongoose.connect('mongodb://mongodb-service:27017/cartdb', { useNewUrlParser: true, useUnifiedTopology: true });

const CartItem = new mongoose.Schema({
  productId: String,
  quantity: Number
});

const Cart = mongoose.model('Cart', new mongoose.Schema({
  userId: String,
  items: [CartItem]
}));

app.post('/cart', async (req, res) => {
  try {
    const { userId, productId, quantity } = req.body;
    
    let cart = await Cart.findOne({ userId });
    
    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }
    
    const itemIndex = cart.items.findIndex(item => item.productId === productId);
    
    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += quantity;
    } else {
      cart.items.push({ productId, quantity });
    }
    
    await cart.save();
    res.status(201).json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Error adding item to cart' });
    console.log("error in here")
  }
});

app.get('/cart/:userId', async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.params.userId });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching cart' });
  }
});

app.delete('/cart/:userId/:productId', async (req, res) => {
  try {
    const { userId, productId } = req.params;
    const cart = await Cart.findOne({ userId });
    
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    
    cart.items = cart.items.filter(item => item.productId !== productId);
    await cart.save();
    
    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: 'Error removing item from cart' });
  }
});

app.post('/cart/:userId/checkout', async (req, res) => {
  try {
    const { userId } = req.params;
    const cart = await Cart.findOne({ userId });
    
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    // Create order
    const orderResponse = await axios.post('http://order-service/orders', {
      userId,
      products: cart.items
    });
    
    // Clear the cart after successful order creation
    cart.items = [];
    await cart.save();
    
    res.json({ message: 'Checkout successful', order: orderResponse.data });
  } catch (error) {
    res.status(500).json({ error: 'Error during checkout' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const port = 3004;
app.listen(port, () => {
  console.log(`Cart service listening at http://localhost:${port}`);
});