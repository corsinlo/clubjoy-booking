const express = require('express');
const ShopifyService = require('../services/shopifyService');
const { authenticateApiKey, validateHostAccess } = require('../middleware/auth');

const router = express.Router();
const shopifyService = new ShopifyService();

/**
 * GET /api/orders?provider={provider_name}
 * Primary endpoint for booking apps (BookingIt, Bokun, etc.)
 * Get all orders for a specific provider (host or vendor)
 *
 * Query parameters:
 * - provider: Host or vendor name (required for filtered results)
 * - customer_email: Filter by customer email
 * - event_date: Filter by event date (YYYY-MM-DD)
 * - date_from: Filter from date (YYYY-MM-DD)
 * - date_to: Filter to date (YYYY-MM-DD)
 * - limit: Number of results (default: 50, max: 250)
 * - status: Order status filter ('paid', 'pending', 'any')
 */
router.get('/', authenticateApiKey, async (req, res) => {
  try {
    const {
      provider,
      customer_email,
      event_date,
      date_from,
      date_to,
      limit = 50,
      status = 'any'
    } = req.query;

    // Validate limit
    const limitNum = Math.min(parseInt(limit), 250);

    let shopifyParams = {
      limit: limitNum,
      status: status
    };

    // Add email filter if provided
    if (customer_email) {
      shopifyParams.email = customer_email;
    }

    // Get orders
    let orders;
    if (provider) {
      // Get orders for specific provider
      orders = await shopifyService.getOrdersByProvider(provider, shopifyParams);
    } else {
      // Get all orders (admin use case)
      orders = await shopifyService.getEventOrders(shopifyParams);
    }

    // Apply date filters
    let filteredOrders = orders;

    if (event_date) {
      filteredOrders = filteredOrders.filter(order =>
        order.eventDate === event_date
      );
    }

    if (date_from) {
      filteredOrders = filteredOrders.filter(order =>
        order.eventDate >= date_from
      );
    }

    if (date_to) {
      filteredOrders = filteredOrders.filter(order =>
        order.eventDate <= date_to
      );
    }

    // Transform to booking app compatible format
    const bookings = filteredOrders.map(transformForBookingApp);

    res.json({
      success: true,
      data: bookings,
      count: bookings.length,
      provider: provider || 'all',
      filters: {
        provider,
        customer_email,
        event_date,
        date_from,
        date_to,
        status,
        limit: limitNum
      }
    });

  } catch (error) {
    console.error('Error fetching orders:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders',
      message: error.message
    });
  }
});

/**
 * GET /api/orders/{order_id}
 * Get specific order by Shopify order ID
 */
router.get('/:orderId', authenticateApiKey, async (req, res) => {
  try {
    const { orderId } = req.params;

    // Get order by ID
    const order = await shopifyService.getOrderById(orderId);

    if (!shopifyService.hasCowlendarMetadata(order)) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: `Order ${orderId} is not a bookable event order`
      });
    }

    const parsedOrder = await shopifyService.parseOrderWithCowlendar(order);
    const booking = transformForBookingApp(parsedOrder);

    res.json({
      success: true,
      data: booking
    });

  } catch (error) {
    console.error(`Error fetching order ${req.params.orderId}:`, error.message);

    if (error.message.includes('Failed to fetch order')) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: `Order ${req.params.orderId} not found`
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch order',
      message: error.message
    });
  }
});

/**
 * GET /api/orders/providers
 * Get all available providers (hosts and vendors)
 * Useful for booking apps to know what providers are available
 */
router.get('/providers', authenticateApiKey, async (req, res) => {
  try {
    const { limit = 250 } = req.query;
    const providers = await shopifyService.getAvailableProviders({ limit: parseInt(limit) });

    res.json({
      success: true,
      data: providers,
      count: providers.length
    });

  } catch (error) {
    console.error('Error fetching providers:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch providers',
      message: error.message
    });
  }
});

/**
 * Transform Shopify order to booking app compatible format
 * @param {Object} order - Parsed Shopify order with Cowlendar data
 * @returns {Object} Booking app compatible object
 */
function transformForBookingApp(order) {
  return {
    // Core booking identifiers
    booking_id: order.shopifyOrderId,
    order_number: order.orderNumber,
    order_name: order.orderName,

    // Customer information
    customer: {
      first_name: order.customer.firstName,
      last_name: order.customer.lastName,
      full_name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
      email: order.customer.email,
      phone: order.customer.phone
    },

    // Event information
    event: {
      name: order.eventName,
      date: order.eventDate,
      start_time: order.startTime,
      end_time: order.endTime,
      timezone: order.timezone,
      start_datetime: order.startDateTime,
      end_datetime: order.endDateTime
    },

    // Provider information (unified host/vendor)
    provider: order.provider,
    host: order.host, // For backward compatibility
    vendor: order.vendor, // For transparency

    // Booking details
    booking_details: {
      created_at: order.createdAt,
      financial_status: order.financialStatus,
      fulfillment_status: order.fulfillmentStatus,
      items: order.lineItems
    },

    // Cowlendar integration data
    cowlendar: {
      internal_id: order.cowlendarId,
      integrity: order.cowlendarIntegrity
    },

    // Booking app specific fields
    status: order.financialStatus === 'paid' ? 'confirmed' : 'pending',
    booking_type: 'event',
    source: 'shopify_cowlendar'
  };
}

module.exports = router;