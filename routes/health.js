const express = require('express');
const ShopifyService = require('../services/shopifyService');

const router = express.Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  };

  try {
    // Test Shopify connection
    const shopifyService = new ShopifyService();
    await shopifyService.getOrders({ limit: 1 });
    healthCheck.shopify_connection = 'OK';
  } catch (error) {
    healthCheck.shopify_connection = 'ERROR';
    healthCheck.shopify_error = error.message;
    healthCheck.status = 'DEGRADED';
  }

  const statusCode = healthCheck.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(healthCheck);
});

/**
 * GET /api/health/detailed
 * Detailed health check with configuration validation
 */
router.get('/detailed', async (req, res) => {
  const detailedHealth = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    configuration: {
      shopify_store_url: process.env.SHOPIFY_STORE_URL ? 'SET' : 'MISSING',
      shopify_access_token: process.env.SHOPIFY_ACCESS_TOKEN ? 'SET' : 'MISSING',
      api_key: process.env.API_KEY ? 'SET' : 'MISSING',
      port: process.env.PORT || 3000
    },
    services: {}
  };

  let hasErrors = false;

  // Test Shopify connection
  try {
    const shopifyService = new ShopifyService();
    const orders = await shopifyService.getOrders({ limit: 1 });
    detailedHealth.services.shopify = {
      status: 'OK',
      last_test: new Date().toISOString(),
      sample_orders_count: orders.length
    };
  } catch (error) {
    hasErrors = true;
    detailedHealth.services.shopify = {
      status: 'ERROR',
      error: error.message,
      last_test: new Date().toISOString()
    };
  }

  // Check for event orders with Cowlendar metadata
  try {
    const shopifyService = new ShopifyService();
    const eventOrders = await shopifyService.getEventOrders({ limit: 5 });
    detailedHealth.services.cowlendar = {
      status: 'OK',
      event_orders_found: eventOrders.length,
      last_test: new Date().toISOString()
    };
  } catch (error) {
    hasErrors = true;
    detailedHealth.services.cowlendar = {
      status: 'ERROR',
      error: error.message,
      last_test: new Date().toISOString()
    };
  }

  if (hasErrors) {
    detailedHealth.status = 'DEGRADED';
  }

  const statusCode = detailedHealth.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(detailedHealth);
});

module.exports = router;