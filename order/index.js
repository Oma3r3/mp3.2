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

mongoose.connect('mongodb://mongodb-service:27017/orderdb', { useNewUrlParser: true, useUnifiedTopology: true });

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: String,
  products: [{ productId: String, quantity: Number }],
  totalAmount: Number,
  status: String,
}));

app.post('/orders', async (req, res) => {
  try {
    const { userId, products } = req.body;
    let totalAmount = 0;

    for (let item of products) {
      const productResponse = await axios.get(`http://product-service/products/${item.productId}`);
      const product = productResponse.data;
      totalAmount += product.price * item.quantity;

      await axios.put(`http://product-service/products/${item.productId}/stock`, { quantity: item.quantity });
    }

    const order = new Order({
      userId,
      products,
      totalAmount,
      status: 'created',
    });

    await order.save();

    await axios.post('http://payment-service/process', { orderId: order._id, amount: totalAmount });

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ error: 'Error creating order' });
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching order' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const port = 3001;
app.listen(port, () => {
  console.log(`Order service listening at http://localhost:${port}`);
});