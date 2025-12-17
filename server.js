const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Session middleware for OAuth state management
app.use(session({
  secret: process.env.JWT_SECRET || 'your-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(express.json());

// Import routes
const orderRoutes = require('./routes/orders'); // New simplified routes
const bookingRoutes = require('./routes/bookings'); // Keep for backward compatibility
const bookingkitRoutes = require('./routes/bookingkit'); // BookingKit integration
const healthRoutes = require('./routes/health');

// Routes
app.use('/api/orders', orderRoutes); // New simplified endpoint
app.use('/api/bookings', bookingRoutes); // Backward compatibility
app.use('/api/bookingkit', bookingkitRoutes); // BookingKit integration
app.use('/api/health', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Shopify Booking API for BookingIt, Bokun, BookingKit & other booking systems',
    version: '2.1.1',
    endpoints: {
      orders: '/api/orders', // Primary endpoint for booking apps
      providers: '/api/orders/providers', // Get available providers
      bookings: '/api/bookings', // Legacy endpoint (deprecated)
      bookingkit: '/api/bookingkit', // BookingKit integration
      health: '/api/health'
    },
    usage: {
      'Get orders for provider': 'GET /api/orders?provider=YourProvider',
      'Get specific order': 'GET /api/orders/{order_id}',
      'Get available providers': 'GET /api/orders/providers',
      'Filter by date': 'GET /api/orders?provider=YourProvider&event_date=2025-01-15',
      'Filter by email': 'GET /api/orders?provider=YourProvider&customer_email=test@example.com'
    },
    bookingkit_integration: {
      'OAuth authorization': 'GET /api/bookingkit/auth/authorize',
      'Authorization status': 'GET /api/bookingkit/auth/status',
      'Webhook endpoint': 'POST /api/bookingkit/webhooks',
      'Sync Shopify to BookingKit': 'POST /api/bookingkit/sync',
      'Get BookingKit bookings': 'GET /api/bookingkit/bookings',
      'Health check': 'GET /api/bookingkit/health'
    },
    integration_status: {
      venchi_bookingkit: 'Ready for integration - API keys configured',
      api_access: 'BookingKit can access /api/orders?provider=venchi with X-API-Key header',
      webhook_ready: 'Webhook endpoint available at /api/bookingkit/webhooks'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📚 API documentation: http://localhost:${PORT}`);
});

module.exports = app;