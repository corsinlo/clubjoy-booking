const axios = require('axios');
const crypto = require('crypto');

class BookingKitService {
  constructor() {
    this.clientId = process.env.BOOKINGKIT_CLIENT_ID;
    this.clientSecret = process.env.BOOKINGKIT_CLIENT_SECRET;
    this.baseUrl = process.env.BOOKINGKIT_BASE_URL || 'https://api.bookingkit.com/v3';
    this.webhookSecret = process.env.BOOKINGKIT_WEBHOOK_SECRET;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Store access tokens in memory (in production, use Redis or database)
    this.accessTokens = new Map();
  }

  /**
   * OAuth 2.0 Authentication Flow
   * Exchange authorization code for access token
   * @param {string} authorizationCode - Code received from BookingKit authorization
   * @param {string} redirectUri - The redirect URI used in the initial auth request
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForToken(authorizationCode, redirectUri) {
    try {
      const response = await this.client.post('/oauth/token', {
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: authorizationCode,
        redirect_uri: redirectUri
      });

      const tokenData = response.data;

      // Store the token (in production, persist to database)
      this.accessTokens.set(this.clientId, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        token_type: tokenData.token_type
      });

      return tokenData;
    } catch (error) {
      console.error('Error exchanging code for token:', error.response?.data || error.message);
      throw new Error(`Failed to exchange code for token: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise<Object>} New token response
   */
  async refreshToken(refreshToken) {
    try {
      const response = await this.client.post('/oauth/token', {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken
      });

      const tokenData = response.data;

      // Update stored token
      this.accessTokens.set(this.clientId, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken, // Some providers don't return new refresh token
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        token_type: tokenData.token_type
      });

      return tokenData;
    } catch (error) {
      console.error('Error refreshing token:', error.response?.data || error.message);
      throw new Error(`Failed to refresh token: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Get valid access token, refreshing if necessary
   * @returns {Promise<string>} Valid access token
   */
  async getValidAccessToken() {
    const tokenData = this.accessTokens.get(this.clientId);

    if (!tokenData) {
      throw new Error('No access token available. Please complete OAuth flow first.');
    }

    // Check if token is expired (with 5 minute buffer)
    const isExpired = Date.now() >= (tokenData.expires_at - 300000); // 5 minutes before expiry

    if (isExpired && tokenData.refresh_token) {
      console.log('Access token expired, refreshing...');
      const newTokenData = await this.refreshToken(tokenData.refresh_token);
      return newTokenData.access_token;
    }

    return tokenData.access_token;
  }

  /**
   * Make authenticated request to BookingKit API
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @returns {Promise<Object>} API response
   */
  async makeAuthenticatedRequest(method, endpoint, data = null) {
    try {
      const accessToken = await this.getValidAccessToken();

      const config = {
        method,
        url: endpoint,
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      };

      if (data) {
        config.data = data;
      }

      const response = await this.client.request(config);
      return response.data;
    } catch (error) {
      console.error(`Error making authenticated request to ${endpoint}:`, error.response?.data || error.message);
      throw new Error(`API request failed: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Get bookings from BookingKit
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} Array of bookings
   */
  async getBookings(filters = {}) {
    try {
      const queryParams = new URLSearchParams(filters).toString();
      const endpoint = `/bookings${queryParams ? `?${queryParams}` : ''}`;

      const response = await this.makeAuthenticatedRequest('GET', endpoint);
      return response.data || response;
    } catch (error) {
      console.error('Error fetching bookings from BookingKit:', error.message);
      throw error;
    }
  }

  /**
   * Send booking data to BookingKit
   * @param {Object} bookingData - Booking data to send
   * @returns {Promise<Object>} Response from BookingKit
   */
  async createBooking(bookingData) {
    try {
      const response = await this.makeAuthenticatedRequest('POST', '/bookings', bookingData);
      return response;
    } catch (error) {
      console.error('Error creating booking in BookingKit:', error.message);
      throw error;
    }
  }

  /**
   * Update existing booking in BookingKit
   * @param {string} bookingId - BookingKit booking ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Response from BookingKit
   */
  async updateBooking(bookingId, updateData) {
    try {
      const response = await this.makeAuthenticatedRequest('PUT', `/bookings/${bookingId}`, updateData);
      return response;
    } catch (error) {
      console.error(`Error updating booking ${bookingId} in BookingKit:`, error.message);
      throw error;
    }
  }

  /**
   * Verify webhook signature for security
   * @param {string} payload - Raw webhook payload
   * @param {string} signature - Webhook signature from headers
   * @returns {boolean} True if signature is valid
   */
  verifyWebhookSignature(payload, signature) {
    if (!this.webhookSecret) {
      console.warn('No webhook secret configured - skipping signature verification');
      return true; // Allow in development
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload, 'utf8')
        .digest('hex');

      const providedSignature = signature.replace('sha256=', '');

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(providedSignature)
      );
    } catch (error) {
      console.error('Error verifying webhook signature:', error.message);
      return false;
    }
  }

  /**
   * Process webhook payload
   * @param {Object} payload - Webhook payload
   * @returns {Promise<Object>} Processing result
   */
  async processWebhook(payload) {
    try {
      const { event_type, data } = payload;

      console.log(`Processing BookingKit webhook: ${event_type}`);

      switch (event_type) {
        case 'booking.created':
          return await this.handleBookingCreated(data);
        case 'booking.updated':
          return await this.handleBookingUpdated(data);
        case 'booking.cancelled':
          return await this.handleBookingCancelled(data);
        default:
          console.log(`Unhandled webhook event type: ${event_type}`);
          return { processed: false, message: `Unhandled event type: ${event_type}` };
      }
    } catch (error) {
      console.error('Error processing webhook:', error.message);
      throw error;
    }
  }

  /**
   * Handle booking created webhook
   * @param {Object} bookingData - Booking data from webhook
   * @returns {Promise<Object>} Processing result
   */
  async handleBookingCreated(bookingData) {
    console.log('Handling booking created:', bookingData.id);
    // Here you can sync the booking with your local database
    // or trigger other business logic
    return { processed: true, action: 'booking_created', booking_id: bookingData.id };
  }

  /**
   * Handle booking updated webhook
   * @param {Object} bookingData - Updated booking data
   * @returns {Promise<Object>} Processing result
   */
  async handleBookingUpdated(bookingData) {
    console.log('Handling booking updated:', bookingData.id);
    // Handle booking updates
    return { processed: true, action: 'booking_updated', booking_id: bookingData.id };
  }

  /**
   * Handle booking cancelled webhook
   * @param {Object} bookingData - Cancelled booking data
   * @returns {Promise<Object>} Processing result
   */
  async handleBookingCancelled(bookingData) {
    console.log('Handling booking cancelled:', bookingData.id);
    // Handle booking cancellation
    return { processed: true, action: 'booking_cancelled', booking_id: bookingData.id };
  }

  /**
   * Transform Shopify order data to BookingKit format
   * @param {Object} shopifyOrder - Parsed Shopify order with Cowlendar data
   * @returns {Object} BookingKit compatible booking object
   */
  transformShopifyOrderToBookingKit(shopifyOrder) {
    return {
      // BookingKit booking object structure
      external_id: shopifyOrder.shopifyOrderId,
      source: 'shopify',

      // Customer information
      customer: {
        first_name: shopifyOrder.customer.firstName,
        last_name: shopifyOrder.customer.lastName,
        email: shopifyOrder.customer.email,
        phone: shopifyOrder.customer.phone
      },

      // Booking details
      product: {
        name: shopifyOrder.eventName,
        description: `Event: ${shopifyOrder.eventName}`
      },

      // Event timing
      start_date: shopifyOrder.startDateTime,
      end_date: shopifyOrder.endDateTime,
      timezone: shopifyOrder.timezone,

      // Booking status
      status: shopifyOrder.financialStatus === 'paid' ? 'confirmed' : 'pending',

      // Financial information
      total_amount: shopifyOrder.lineItems.reduce((total, item) => total + parseFloat(item.price), 0),
      currency: 'EUR', // Adjust based on your currency

      // Metadata
      metadata: {
        shopify_order_number: shopifyOrder.orderNumber,
        cowlendar_id: shopifyOrder.cowlendarId,
        host: shopifyOrder.host,
        provider: shopifyOrder.provider
      }
    };
  }
}

module.exports = BookingKitService;