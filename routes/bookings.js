const express = require('express');
const ShopifyService = require('../services/shopifyService');
const { authenticateApiKey, validateHostAccess } = require('../middleware/auth');

const router = express.Router();
const shopifyService = new ShopifyService();

/**
 * GET /api/bookings/hosts
 * Get all available hosts - for configuration and debugging
 */
router.get('/hosts', authenticateApiKey, async (req, res) => {
  try {
    const { limit = 250 } = req.query;
    const hosts = await shopifyService.getAvailableHosts({ limit: parseInt(limit) });

    res.json({
      success: true,
      data: hosts,
      count: hosts.length
    });

  } catch (error) {
    console.error('Error fetching hosts:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch hosts',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings/host/:hostName
 * Get all bookings for a specific host - Primary endpoint for Bookun customers
 * This is what "Llamas" or other hosts would call to get only their events
 * Query parameters:
 * - customer_email: Filter by customer email
 * - event_date: Filter by event date (YYYY-MM-DD)
 * - cowlendar_id: Filter by Cowlendar internal ID
 * - limit: Number of results (default: 50)
 */
router.get('/host/:hostName', authenticateApiKey, validateHostAccess, async (req, res) => {
  try {
    const { hostName } = req.params;
    const {
      customer_email,
      event_date,
      cowlendar_id,
      limit = 50
    } = req.query;

    let shopifyParams = {
      limit: parseInt(limit),
      status: 'any'
    };

    // Add email filter if provided
    if (customer_email) {
      shopifyParams.email = customer_email;
    }

    // Get orders filtered by host
    const hostOrders = await shopifyService.getOrdersByHost(hostName, shopifyParams);

    // Apply additional filters
    let filteredOrders = hostOrders;

    if (event_date) {
      filteredOrders = filteredOrders.filter(order =>
        order.eventDate === event_date
      );
    }

    if (cowlendar_id) {
      filteredOrders = filteredOrders.filter(order =>
        order.cowlendarId === cowlendar_id
      );
    }

    // Transform to Bookun-compatible format
    const bookings = filteredOrders.map(transformForBookun);

    res.json({
      success: true,
      data: bookings,
      count: bookings.length,
      host: hostName,
      filters: {
        customer_email,
        event_date,
        cowlendar_id,
        limit
      }
    });

  } catch (error) {
    console.error(`Error fetching bookings for host ${req.params.hostName}:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch host bookings',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings/host/:hostName/customer/:email
 * Get all bookings for a specific host and customer - Bookun integration
 */
router.get('/host/:hostName/customer/:email', authenticateApiKey, validateHostAccess, async (req, res) => {
  try {
    const { hostName, email } = req.params;
    const { limit = 50 } = req.query;

    const hostOrders = await shopifyService.getOrdersByHost(hostName, {
      email: email,
      limit: parseInt(limit)
    });

    const bookings = hostOrders.map(transformForBookun);

    res.json({
      success: true,
      data: bookings,
      count: bookings.length,
      host: hostName,
      customer_email: email
    });

  } catch (error) {
    console.error(`Error fetching customer bookings for host ${req.params.hostName}:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch host customer bookings',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings/host/:hostName/events/:date
 * Get all bookings for a specific host and event date - Bookun integration
 */
router.get('/host/:hostName/events/:date', authenticateApiKey, validateHostAccess, async (req, res) => {
  try {
    const { hostName, date } = req.params; // date in YYYY-MM-DD format
    const { limit = 100 } = req.query;

    const hostOrders = await shopifyService.getOrdersByHost(hostName, {
      limit: parseInt(limit)
    });

    // Filter by event date
    const dateFilteredOrders = hostOrders.filter(order =>
      order.eventDate === date
    );

    const bookings = dateFilteredOrders.map(transformForBookun);

    res.json({
      success: true,
      data: bookings,
      count: bookings.length,
      host: hostName,
      event_date: date
    });

  } catch (error) {
    console.error(`Error fetching event bookings for host ${req.params.hostName}:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch host event bookings',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings
 * Get all event bookings - Bookun compatible endpoint
 * Query parameters:
 * - customer_email: Filter by customer email
 * - event_date: Filter by event date (YYYY-MM-DD)
 * - cowlendar_id: Filter by Cowlendar internal ID
 * - host: Filter by host name
 * - limit: Number of results (default: 50)
 */
router.get('/', authenticateApiKey, async (req, res) => {
  try {
    const {
      customer_email,
      event_date,
      cowlendar_id,
      host,
      limit = 50,
      order_id
    } = req.query;

    let shopifyParams = {
      limit: parseInt(limit),
      status: 'any'
    };

    // Add email filter if provided
    if (customer_email) {
      shopifyParams.email = customer_email;
    }

    // If specific order ID is requested
    if (order_id) {
      const order = await shopifyService.getOrderById(order_id);
      const parsedOrder = await shopifyService.parseOrderWithCowlendar(order);

      return res.json({
        success: true,
        data: [transformForBookun(parsedOrder)],
        count: 1
      });
    }

    // Get event orders with Cowlendar metadata
    let eventOrders;
    if (host) {
      // Filter by specific host
      eventOrders = await shopifyService.getOrdersByHost(host, shopifyParams);
    } else {
      // Get all orders
      eventOrders = await shopifyService.getEventOrders(shopifyParams);
    }

    // Apply additional filters
    let filteredOrders = eventOrders;

    if (event_date) {
      filteredOrders = filteredOrders.filter(order =>
        order.eventDate === event_date
      );
    }

    if (cowlendar_id) {
      filteredOrders = filteredOrders.filter(order =>
        order.cowlendarId === cowlendar_id
      );
    }

    // Transform to Bookun-compatible format
    const bookings = filteredOrders.map(transformForBookun);

    res.json({
      success: true,
      data: bookings,
      count: bookings.length,
      filters: {
        customer_email,
        event_date,
        cowlendar_id,
        host,
        limit
      }
    });

  } catch (error) {
    console.error('Error fetching bookings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bookings',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings/:id
 * Get specific booking by Shopify order ID or Cowlendar ID
 */
router.get('/:id', authenticateApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { id_type = 'shopify' } = req.query; // 'shopify' or 'cowlendar'

    let booking = null;

    if (id_type === 'shopify') {
      // Get by Shopify order ID
      const order = await shopifyService.getOrderById(id);
      if (shopifyService.hasCowlendarMetadata(order)) {
        const parsedOrder = shopifyService.parseOrderWithCowlendar(order);
        booking = transformForBookun(parsedOrder);
      }
    } else if (id_type === 'cowlendar') {
      // Get by Cowlendar ID - need to search through orders
      const eventOrders = await shopifyService.getEventOrders({ limit: 250 });
      const foundOrder = eventOrders.find(order => order.cowlendarId === id);
      if (foundOrder) {
        booking = transformForBookun(foundOrder);
      }
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found',
        message: `No booking found with ${id_type} ID: ${id}`
      });
    }

    res.json({
      success: true,
      data: booking
    });

  } catch (error) {
    console.error('Error fetching booking:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings/customer/:email
 * Get all bookings for a specific customer email - Bookun integration
 */
router.get('/customer/:email', authenticateApiKey, async (req, res) => {
  try {
    const { email } = req.params;
    const { limit = 50 } = req.query;

    const eventOrders = await shopifyService.getEventOrders({
      email: email,
      limit: parseInt(limit)
    });

    const bookings = eventOrders.map(transformForBookun);

    res.json({
      success: true,
      data: bookings,
      count: bookings.length,
      customer_email: email
    });

  } catch (error) {
    console.error('Error fetching customer bookings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer bookings',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings/events/:date
 * Get all bookings for a specific event date - Bookun integration
 */
router.get('/events/:date', authenticateApiKey, async (req, res) => {
  try {
    const { date } = req.params; // YYYY-MM-DD format
    const { limit = 100 } = req.query;

    const eventOrders = await shopifyService.getEventOrders({
      limit: parseInt(limit)
    });

    // Filter by event date
    const dateFilteredOrders = eventOrders.filter(order =>
      order.eventDate === date
    );

    const bookings = dateFilteredOrders.map(transformForBookun);

    res.json({
      success: true,
      data: bookings,
      count: bookings.length,
      event_date: date
    });

  } catch (error) {
    console.error('Error fetching event bookings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch event bookings',
      message: error.message
    });
  }
});

/**
 * GET /api/bookings/debug/orders
 * Get raw Shopify orders for debugging (last 5)
 */
router.get('/debug/orders', authenticateApiKey, async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const orders = await shopifyService.getOrders({ limit: parseInt(limit) });

    res.json({
      success: true,
      data: orders,
      count: orders.length,
      note: "These are raw Shopify orders - may not have Cowlendar metadata"
    });

  } catch (error) {
    console.error('Error fetching debug orders:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch debug orders',
      message: error.message
    });
  }
});

/**
 * Transform Shopify order to Bookun-compatible booking format
 * @param {Object} order - Parsed Shopify order with Cowlendar data
 * @returns {Object} Bookun-compatible booking object
 */
function transformForBookun(order) {
  return {
    booking_id: order.shopifyOrderId,
    order_number: order.orderNumber,
    order_name: order.orderName,
    customer: {
      first_name: order.customer.firstName,
      last_name: order.customer.lastName,
      full_name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
      email: order.customer.email,
      phone: order.customer.phone
    },
    event: {
      name: order.eventName,
      host: order.host,
      date: order.eventDate,
      start_time: order.startTime,
      end_time: order.endTime,
      timezone: order.timezone,
      start_datetime: order.startDateTime,
      end_datetime: order.endDateTime
    },
    booking_details: {
      created_at: order.createdAt,
      financial_status: order.financialStatus,
      fulfillment_status: order.fulfillmentStatus,
      items: order.lineItems
    },
    cowlendar: {
      internal_id: order.cowlendarId,
      integrity: order.cowlendarIntegrity
    },
    // Bookun-specific fields
    status: order.financialStatus === 'paid' ? 'confirmed' : 'pending',
    booking_type: 'event',
    source: 'shopify_cowlendar',
    host: order.host
  };
}

module.exports = router;