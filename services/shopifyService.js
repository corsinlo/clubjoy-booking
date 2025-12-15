const axios = require('axios');
const moment = require('moment-timezone');

class ShopifyService {
  constructor() {
    this.storeUrl = process.env.SHOPIFY_STORE_URL;
    this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    this.apiVersion = process.env.SHOPIFY_API_VERSION || '2023-10';
    this.baseUrl = `https://${this.storeUrl}/admin/api/${this.apiVersion}`;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Fetch orders from Shopify with optional filters
   * @param {Object} params - Query parameters for filtering orders
   * @returns {Promise<Array>} Array of orders
   */
  async getOrders(params = {}) {
    try {
      const defaultParams = {
        status: 'any',
        limit: 50,
        fields: 'id,order_number,name,customer,line_items,created_at,financial_status,fulfillment_status,note_attributes'
      };

      const queryParams = { ...defaultParams, ...params };
      const response = await this.client.get('/orders.json', { params: queryParams });

      return response.data.orders;
    } catch (error) {
      console.error('Error fetching orders from Shopify:', error.response?.data || error.message);
      throw new Error(`Failed to fetch orders: ${error.response?.data?.errors || error.message}`);
    }
  }

  /**
   * Get a specific order by ID
   * @param {string} orderId - Shopify order ID
   * @returns {Promise<Object>} Order details
   */
  async getOrderById(orderId) {
    try {
      const response = await this.client.get(`/orders/${orderId}.json`);
      return response.data.order;
    } catch (error) {
      console.error(`Error fetching order ${orderId}:`, error.response?.data || error.message);
      throw new Error(`Failed to fetch order ${orderId}: ${error.response?.data?.errors || error.message}`);
    }
  }

  /**
   * Get orders with Cowlendar metadata, optionally filtered by host
   * @param {Object} params - Query parameters
   * @param {string} hostFilter - Optional host name to filter by
   * @returns {Promise<Array>} Orders with parsed Cowlendar data
   */
  async getEventOrders(params = {}, hostFilter = null) {
    try {
      const orders = await this.getOrders(params);

      // Filter orders that have Cowlendar metadata
      const eventOrders = orders.filter(order => this.hasCowlendarMetadata(order));

      // Parse and enrich with Cowlendar data
      const parsedOrders = await Promise.all(
        eventOrders.map(order => this.parseOrderWithCowlendar(order))
      );

      // Filter by host if specified
      if (hostFilter) {
        return parsedOrders.filter(order => order.host === hostFilter);
      }

      return parsedOrders;
    } catch (error) {
      console.error('Error fetching event orders:', error.message);
      throw error;
    }
  }

  /**
   * Check if order has Cowlendar metadata
   * @param {Object} order - Shopify order object
   * @returns {boolean} True if order has Cowlendar metadata
   */
  hasCowlendarMetadata(order) {
    // Check note_attributes first (original location)
    if (order.note_attributes && order.note_attributes.length > 0) {
      const hasNoteMetadata = order.note_attributes.some(attr =>
        attr.name && attr.name.startsWith(process.env.COWLENDAR_METADATA_PREFIX || '__cow_')
      );
      if (hasNoteMetadata) return true;
    }

    // Check line item properties (new location)
    if (order.line_items && order.line_items.length > 0) {
      return order.line_items.some(item =>
        item.properties && item.properties.some(prop =>
          prop.name && prop.name.startsWith(process.env.COWLENDAR_METADATA_PREFIX || '__cow_')
        )
      );
    }

    return false;
  }

  /**
   * Parse order with Cowlendar metadata
   * @param {Object} order - Shopify order object
   * @returns {Promise<Object>} Enriched order with parsed Cowlendar data
   */
  async parseOrderWithCowlendar(order) {
    const cowlendarData = this.extractCowlendarMetadata(order);
    const eventDetails = this.parseEventDate(cowlendarData.eventData);

    // Get host information from product metafields
    const host = await this.extractHostFromOrder(order);

    // Get vendor information from line items
    const vendor = this.extractVendorFromOrder(order);

    return {
      shopifyOrderId: order.id,
      orderNumber: order.order_number,
      orderName: order.name,
      customer: {
        firstName: order.customer?.first_name || '',
        lastName: order.customer?.last_name || '',
        email: order.customer?.email || '',
        phone: order.customer?.phone || ''
      },
      eventName: this.extractEventName(order),
      host: host || vendor, // Fallback to vendor if host is missing
      vendor: vendor,
      provider: host || vendor, // Unified provider field for booking apps
      eventDate: eventDetails.eventDate,
      startTime: eventDetails.startTime,
      endTime: eventDetails.endTime,
      timezone: eventDetails.timezone,
      cowlendarId: cowlendarData.internalId,
      cowlendarIntegrity: cowlendarData.integrity,
      createdAt: order.created_at,
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      lineItems: order.line_items?.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        vendor: item.vendor,
        productId: item.product_id
      })) || []
    };
  }

  /**
   * Extract Cowlendar metadata from order note attributes or line item properties
   * @param {Object} order - Shopify order object
   * @returns {Object} Cowlendar metadata
   */
  extractCowlendarMetadata(order) {
    const metadata = {
      eventData: null,
      internalId: null,
      integrity: null
    };

    // Helper function to process attributes/properties
    const processAttributes = (attrs) => {
      attrs.forEach(attr => {
        if (attr.name === '__cow_internal_id') {
          metadata.internalId = attr.value;
        } else if (attr.name === '__cow_integrity') {
          metadata.integrity = attr.value;
        } else if (attr.name === 'Date') {
          // This captures the event date/time data from line item properties
          metadata.eventData = attr.value;
        } else if (attr.name && attr.name.toLowerCase().includes('data')) {
          // This captures the event date/time data from note attributes
          metadata.eventData = attr.value;
        }
      });
    };

    // Check note_attributes first (original location)
    if (order.note_attributes && order.note_attributes.length > 0) {
      processAttributes(order.note_attributes);
    }

    // Check line item properties (new location)
    if (order.line_items && order.line_items.length > 0) {
      order.line_items.forEach(item => {
        if (item.properties && item.properties.length > 0) {
          processAttributes(item.properties);
        }
      });
    }

    return metadata;
  }

  /**
   * Parse event date string from Cowlendar
   * @param {string} eventDataString - Event date string like "30 nov 2025, 17:00 - 18:30 (Europe/Rome)"
   * @returns {Object} Parsed event timing details
   */
  parseEventDate(eventDataString) {
    if (!eventDataString) {
      return {
        eventDate: null,
        startTime: null,
        endTime: null,
        timezone: 'UTC'
      };
    }

    try {
      // Parse: "30 nov 2025, 17:00 - 18:30 (Europe/Rome)"
      const timezoneMatch = eventDataString.match(/\(([^)]+)\)$/);
      const timezone = timezoneMatch ? timezoneMatch[1] : 'UTC';

      const dateTimeMatch = eventDataString.match(/^(.+?),\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);

      if (!dateTimeMatch) {
        throw new Error('Unable to parse event date format');
      }

      const [, datePart, startTime, endTime] = dateTimeMatch;

      // Parse date part (e.g., "30 nov 2025")
      const eventDate = moment.tz(datePart, 'DD MMM YYYY', timezone);

      return {
        eventDate: eventDate.format('YYYY-MM-DD'),
        startTime: startTime,
        endTime: endTime,
        timezone: timezone,
        startDateTime: eventDate.clone().add(moment.duration(startTime)).toISOString(),
        endDateTime: eventDate.clone().add(moment.duration(endTime)).toISOString()
      };
    } catch (error) {
      console.error('Error parsing event date:', error.message);
      return {
        eventDate: null,
        startTime: null,
        endTime: null,
        timezone: 'UTC'
      };
    }
  }

  /**
   * Extract event name from order line items
   * @param {Object} order - Shopify order object
   * @returns {string} Event name
   */
  extractEventName(order) {
    if (!order.line_items || order.line_items.length === 0) {
      return 'Unknown Event';
    }

    // Typically the first line item would be the event
    return order.line_items[0].name || 'Unknown Event';
  }

  /**
   * Extract host information from order products' metafields
   * @param {Object} order - Shopify order object
   * @returns {Promise<string>} Host name or null
   */
  async extractHostFromOrder(order) {
    if (!order.line_items || order.line_items.length === 0) {
      return null;
    }

    try {
      // Check the first product (typically the event product)
      const firstLineItem = order.line_items[0];
      if (!firstLineItem.product_id) {
        return null;
      }

      const host = await this.getProductHost(firstLineItem.product_id);
      return host;
    } catch (error) {
      console.error('Error extracting host from order:', error.message);
      return null;
    }
  }

  /**
   * Extract vendor from order line items
   * @param {Object} order - Shopify order object
   * @returns {string|null} Vendor name or null
   */
  extractVendorFromOrder(order) {
    if (!order.line_items || order.line_items.length === 0) {
      return null;
    }

    // Get vendor from first line item (typically the event product)
    const firstLineItem = order.line_items[0];
    return firstLineItem.vendor || null;
  }

  /**
   * Get host information from product metafields
   * @param {string} productId - Shopify product ID
   * @returns {Promise<string>} Host name or null
   */
  async getProductHost(productId) {
    try {
      // First try to get from product metafields
      const metafieldsResponse = await this.client.get(`/products/${productId}/metafields.json`);
      const metafields = metafieldsResponse.data.metafields;

      // Look for host metafield (could be 'Host', 'host', or custom namespace)
      const hostMetafield = metafields.find(field =>
        field.key && (
          field.key.toLowerCase() === 'host' ||
          field.key === 'Host' ||
          field.namespace === 'custom' && field.key === 'host'
        )
      );

      if (hostMetafield) {
        return hostMetafield.value;
      }

      // Fallback: try to get from product itself if metafield not found
      const productResponse = await this.client.get(`/products/${productId}.json`);
      const product = productResponse.data.product;

      // Check if host is in product tags (alternative storage method)
      if (product.tags) {
        const hostTag = product.tags.split(',').find(tag =>
          tag.trim().toLowerCase().startsWith('host:')
        );
        if (hostTag) {
          return hostTag.split(':')[1].trim();
        }
      }

      return null;
    } catch (error) {
      console.error(`Error fetching host for product ${productId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get orders for a specific host
   * @param {string} hostName - Name of the host (e.g., "Llamas")
   * @param {Object} params - Additional query parameters
   * @returns {Promise<Array>} Orders filtered by host
   */
  async getOrdersByHost(hostName, params = {}) {
    try {
      const eventOrders = await this.getEventOrders(params);
      return eventOrders.filter(order =>
        order.host && order.host.toLowerCase() === hostName.toLowerCase()
      );
    } catch (error) {
      console.error(`Error fetching orders for host ${hostName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all available hosts from recent orders
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} Array of unique host names
   */
  async getAvailableHosts(params = {}) {
    try {
      const eventOrders = await this.getEventOrders({ ...params, limit: 250 });
      const hosts = eventOrders
        .map(order => order.host)
        .filter(host => host !== null && host !== undefined)
        .filter((host, index, arr) => arr.indexOf(host) === index) // unique values
        .sort();

      return hosts;
    } catch (error) {
      console.error('Error fetching available hosts:', error.message);
      throw error;
    }
  }

  /**
   * Get orders by provider (host or vendor) - Unified method for booking apps
   * @param {string} providerName - Host name or vendor name
   * @param {Object} params - Additional query parameters
   * @returns {Promise<Array>} Orders filtered by provider
   */
  async getOrdersByProvider(providerName, params = {}) {
    try {
      // Get all event orders first
      const eventOrders = await this.getEventOrders(params);

      // Filter by provider (check both host and vendor)
      return eventOrders.filter(order => {
        // Check host field (from product metafields/tags)
        const hostMatch = order.host &&
          order.host.toLowerCase() === providerName.toLowerCase();

        // Check vendor field (from line items)
        const vendorMatch = order.lineItems &&
          order.lineItems.some(item =>
            item.vendor && item.vendor.toLowerCase() === providerName.toLowerCase()
          );

        return hostMatch || vendorMatch;
      });
    } catch (error) {
      console.error(`Error fetching orders for provider ${providerName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all available providers (hosts and vendors) from recent orders
   * @param {Object} params - Query parameters
   * @returns {Promise<Array>} Array of unique provider names
   */
  async getAvailableProviders(params = {}) {
    try {
      const orders = await this.getOrders({ ...params, limit: 250 });
      const providers = new Set();

      for (const order of orders) {
        // Get host from parsed order if it has Cowlendar metadata
        if (this.hasCowlendarMetadata(order)) {
          const parsedOrder = await this.parseOrderWithCowlendar(order);
          if (parsedOrder.host) {
            providers.add(parsedOrder.host);
          }
        }

        // Get vendor from line items
        if (order.line_items) {
          order.line_items.forEach(item => {
            if (item.vendor) {
              providers.add(item.vendor);
            }
          });
        }
      }

      return Array.from(providers).sort();
    } catch (error) {
      console.error('Error fetching available providers:', error.message);
      throw error;
    }
  }
}

module.exports = ShopifyService;