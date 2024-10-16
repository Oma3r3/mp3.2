const express = require('express');
const mongoose = require('mongoose');
const promClient = require('prom-client');
const axios = require('axios');

const app = express();
app.use(express.json());

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

mongoose.connect('mongodb://mongodb-service:27017/paymentdb', { useNewUrlParser: true, useUnifiedTopology: true });

const Payment = mongoose.model('Payment', new mongoose.Schema({
  orderId: String,
  amount: Number,
  status: String,
}));

app.post('/process', async (req, res) => {
  try {
    const { orderId, amount } = req.body;
    
    // Simulate payment processing
    const success = Math.random() < 0.9;  // 90% success rate

    const payment = new Payment({
      orderId,
      amount,
      status: success ? 'completed' : 'failed',
    });

    await payment.save();

    if (success) {
      await axios.put(`http://order-service/orders/${orderId}`, { status: 'paid' });
      res.json({ message: 'Payment processed successfully' });
    } else {
      await axios.put(`http://order-service/orders/${orderId}`, { status: 'payment_failed' });
      res.status(400).json({ error: 'Payment processing failed' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error processing payment' });
  }
});

app.get('/payments/:orderId', async (req, res) => {
  try {
    const payment = await Payment.findOne({ orderId: req.params.orderId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching payment' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const port = 3003;
app.listen(port, () => {
  console.log(`Payment service listening at http://localhost:${port}`);
});