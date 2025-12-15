const express = require('express');
const crypto = require('crypto');
const BookingKitService = require('../services/bookingkitService');
const ShopifyService = require('../services/shopifyService');
const { authenticateApiKey } = require('../middleware/auth');

const router = express.Router();
const bookingKitService = new BookingKitService();
const shopifyService = new ShopifyService();

/**
 * OAuth Authentication Flow for BookingKit
 * This endpoint initiates the OAuth flow with BookingKit
 */
router.get('/auth/authorize', (req, res) => {
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/bookingkit/auth/callback`;
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in session or cache (for production, use Redis)
    req.session = req.session || {};
    req.session.oauth_state = state;

    const authUrl = new URL('https://api.bookingkit.com/v3/oauth/authorize');
    authUrl.searchParams.set('client_id', process.env.BOOKINGKIT_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'bookings:read bookings:write webhooks:manage');
    authUrl.searchParams.set('state', state);

    res.json({
      success: true,
      auth_url: authUrl.toString(),
      redirect_uri: redirectUri,
      message: 'Visit the auth_url to authorize this application with BookingKit'
    });
  } catch (error) {
    console.error('Error generating authorization URL:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate authorization URL',
      message: error.message
    });
  }
});

/**
 * OAuth Callback - BookingKit redirects here after user authorization
 */
router.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Authorization failed',
        message: error
      });
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Missing authorization code',
        message: 'Authorization code not provided'
      });
    }

    // Verify state parameter (CSRF protection)
    const sessionState = req.session?.oauth_state;
    if (!sessionState || sessionState !== state) {
      return res.status(400).json({
        success: false,
        error: 'Invalid state parameter',
        message: 'CSRF protection failed'
      });
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/bookingkit/auth/callback`;
    const tokenData = await bookingKitService.exchangeCodeForToken(code, redirectUri);

    // Clear the state from session
    if (req.session) {
      delete req.session.oauth_state;
    }

    res.json({
      success: true,
      message: 'Authorization successful',
      token_info: {
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope
      }
    });
  } catch (error) {
    console.error('Error handling OAuth callback:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to complete authorization',
      message: error.message
    });
  }
});

/**
 * Get authorization status
 */
router.get('/auth/status', authenticateApiKey, (req, res) => {
  try {
    const hasToken = bookingKitService.accessTokens.has(process.env.BOOKINGKIT_CLIENT_ID);

    if (hasToken) {
      const tokenData = bookingKitService.accessTokens.get(process.env.BOOKINGKIT_CLIENT_ID);
      const isExpired = Date.now() >= tokenData.expires_at;

      res.json({
        success: true,
        authorized: true,
        token_expired: isExpired,
        expires_at: new Date(tokenData.expires_at).toISOString()
      });
    } else {
      res.json({
        success: true,
        authorized: false,
        message: 'No authorization token found'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to check authorization status',
      message: error.message
    });
  }
});

/**
 * Webhook endpoint - BookingKit sends webhook events here
 * This endpoint receives notifications when bookings are created, updated, or cancelled in BookingKit
 */
router.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-bookingkit-signature'] || req.headers['x-webhook-signature'];
    const payload = req.body;

    // Verify webhook signature for security
    if (!bookingKitService.verifyWebhookSignature(payload.toString(), signature)) {
      console.warn('Invalid webhook signature received');
      return res.status(401).json({
        success: false,
        error: 'Invalid signature'
      });
    }

    // Parse the JSON payload
    let webhookData;
    try {
      webhookData = JSON.parse(payload);
    } catch (parseError) {
      console.error('Invalid JSON payload:', parseError.message);
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON payload'
      });
    }

    // Process the webhook
    const result = await bookingKitService.processWebhook(webhookData);

    console.log(`Webhook processed successfully:`, result);

    // Respond with 200 OK to acknowledge receipt
    res.json({
      success: true,
      processed: true,
      result: result
    });

  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process webhook',
      message: error.message
    });
  }
});

/**
 * Sync Shopify orders to BookingKit
 * This endpoint allows manual synchronization of Shopify orders to BookingKit
 */
router.post('/sync', authenticateApiKey, async (req, res) => {
  try {
    const { provider, order_ids, limit = 50 } = req.body;

    let ordersToSync = [];

    if (order_ids && Array.isArray(order_ids)) {
      // Sync specific orders by ID
      for (const orderId of order_ids) {
        try {
          const order = await shopifyService.getOrderById(orderId);
          if (shopifyService.hasCowlendarMetadata(order)) {
            const parsedOrder = await shopifyService.parseOrderWithCowlendar(order);
            ordersToSync.push(parsedOrder);
          }
        } catch (error) {
          console.warn(`Failed to fetch order ${orderId}:`, error.message);
        }
      }
    } else {
      // Sync orders by provider
      const shopifyParams = { limit: Math.min(parseInt(limit), 100) };

      if (provider) {
        ordersToSync = await shopifyService.getOrdersByProvider(provider, shopifyParams);
      } else {
        ordersToSync = await shopifyService.getEventOrders(shopifyParams);
      }
    }

    if (ordersToSync.length === 0) {
      return res.json({
        success: true,
        message: 'No orders found to sync',
        synced: 0
      });
    }

    // Transform and send to BookingKit
    const syncResults = [];
    for (const order of ordersToSync) {
      try {
        const bookingKitData = bookingKitService.transformShopifyOrderToBookingKit(order);
        const result = await bookingKitService.createBooking(bookingKitData);

        syncResults.push({
          shopify_order_id: order.shopifyOrderId,
          bookingkit_id: result.id,
          status: 'synced'
        });
      } catch (error) {
        console.error(`Failed to sync order ${order.shopifyOrderId}:`, error.message);
        syncResults.push({
          shopify_order_id: order.shopifyOrderId,
          status: 'failed',
          error: error.message
        });
      }
    }

    const syncedCount = syncResults.filter(r => r.status === 'synced').length;
    const failedCount = syncResults.filter(r => r.status === 'failed').length;

    res.json({
      success: true,
      message: `Sync completed: ${syncedCount} synced, ${failedCount} failed`,
      synced: syncedCount,
      failed: failedCount,
      results: syncResults
    });

  } catch (error) {
    console.error('Error during sync operation:', error.message);
    res.status(500).json({
      success: false,
      error: 'Sync operation failed',
      message: error.message
    });
  }
});

/**
 * Get BookingKit bookings
 */
router.get('/bookings', authenticateApiKey, async (req, res) => {
  try {
    const filters = {
      ...req.query
    };

    const bookings = await bookingKitService.getBookings(filters);

    res.json({
      success: true,
      data: bookings,
      count: Array.isArray(bookings) ? bookings.length : 0,
      filters
    });
  } catch (error) {
    console.error('Error fetching BookingKit bookings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bookings',
      message: error.message
    });
  }
});

/**
 * Health check for BookingKit integration
 */
router.get('/health', authenticateApiKey, async (req, res) => {
  try {
    const hasCredentials = !!(process.env.BOOKINGKIT_CLIENT_ID && process.env.BOOKINGKIT_CLIENT_SECRET);
    const hasToken = bookingKitService.accessTokens.has(process.env.BOOKINGKIT_CLIENT_ID);

    let tokenStatus = 'no_token';
    if (hasToken) {
      const tokenData = bookingKitService.accessTokens.get(process.env.BOOKINGKIT_CLIENT_ID);
      tokenStatus = Date.now() >= tokenData.expires_at ? 'expired' : 'valid';
    }

    const health = {
      success: true,
      bookingkit_integration: {
        credentials_configured: hasCredentials,
        has_access_token: hasToken,
        token_status: tokenStatus,
        base_url: process.env.BOOKINGKIT_BASE_URL || 'https://api.bookingkit.com/v3'
      }
    };

    // Test API connectivity if we have a valid token
    if (hasToken && tokenStatus === 'valid') {
      try {
        // Try to make a simple API call to verify connectivity
        await bookingKitService.makeAuthenticatedRequest('GET', '/profile');
        health.bookingkit_integration.api_connectivity = 'ok';
      } catch (error) {
        health.bookingkit_integration.api_connectivity = 'failed';
        health.bookingkit_integration.api_error = error.message;
      }
    }

    res.json(health);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      message: error.message
    });
  }
});

module.exports = router;