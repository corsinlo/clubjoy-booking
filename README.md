# Shopify Booking API

A Node.js microservice that integrates Shopify event marketplace orders (with Cowlendar metadata) with multiple booking systems including Bokun, BookingIt, and BookingKit.

## 🚀 Features

- 🛒 **Shopify Integration**: Fetches orders from your Shopify store
- 📅 **Cowlendar Metadata**: Parses event date/time and booking details
- 🔗 **Multi-Platform Support**: Works with Bokun, BookingIt, BookingKit and other booking systems
- 🏠 **Multi-Provider Support**: Filter events by provider/host using product metafields
- 🔐 **Secure Authentication**: Global and provider-specific API key authentication
- 🔄 **BookingKit Integration**: Full OAuth 2.0 flow, webhooks, and bidirectional sync
- 🚀 **Deploy Ready**: Configured for Render.com deployment
- ⚡ **High Performance**: Efficient filtering and caching

## 📋 Supported Booking Systems

| Platform | Integration Type | Status |
|----------|-----------------|--------|
| **Bokun** | API Consumer | ✅ Ready |
| **BookingIt** | API Consumer | ✅ Ready |
| **BookingKit** | OAuth + Webhooks + Sync | ✅ Ready |
| **Other Booking Systems** | API Consumer | ✅ Ready |

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│   Booking Apps  │───▶│  Shopify-Bokun-API │───▶│    Shopify      │
│                 │    │   (Your Service)    │    │     Store       │
│ • Bokun         │    │                     │    │                 │
│ • BookingIt     │    │  ┌─────────────────┐│    │  ┌─────────────┐│
│ • BookingKit    │    │  │  Orders API     ││    │  │   Orders    ││
│ • Others        │    │  │  /api/orders    ││    │  │             ││
│                 │    │  └─────────────────┘│    │  │ ┌─────────┐ ││
│                 │◀──▶│  ┌─────────────────┐│    │  │ │Cowlendar│ ││
│                 │    │  │ BookingKit API  ││    │  │ │Metadata │ ││
│                 │    │  │ OAuth + Webhook ││    │  │ └─────────┘ ││
│                 │    │  └─────────────────┘│    │  └─────────────┘│
└─────────────────┘    └─────────────────────┘    └─────────────────┘
```

## 🔧 Quick Start

### 1. Installation

```bash
git clone <your-repo>
cd shopify-bookun-api
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
# Shopify Configuration
SHOPIFY_STORE_URL=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_shopify_access_token
SHOPIFY_API_VERSION=2023-10

# API Configuration
NODE_ENV=development
PORT=3000

# Global API Key (full access)
API_KEY=your_global_api_key

# Provider-specific API Keys
HOST_API_KEY_PROVIDER_NAME=provider_specific_key

# BookingKit Integration
BOOKINGKIT_CLIENT_ID=your_bookingkit_client_id
BOOKINGKIT_CLIENT_SECRET=your_bookingkit_client_secret
BOOKINGKIT_BASE_URL=https://api.bookingkit.com/v3
BOOKINGKIT_WEBHOOK_SECRET=your_webhook_secret

# Security
JWT_SECRET=your_jwt_secret_for_sessions

# Cowlendar Configuration
COWLENDAR_METADATA_PREFIX=__cow_
```

### 3. Run the Service

```bash
# Development with auto-reload
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`

## 📊 API Endpoints

### Core Booking Endpoints

#### Get Orders by Provider (Primary endpoint for all booking systems)
```http
GET /api/orders?provider={provider_name}
```

**Query Parameters:**
- `provider` - Provider/host name (required for filtered results)
- `customer_email` - Filter by customer email
- `event_date` - Filter by event date (YYYY-MM-DD)
- `date_from` - Filter from date (YYYY-MM-DD)
- `date_to` - Filter to date (YYYY-MM-DD)
- `limit` - Number of results (default: 50, max: 250)
- `status` - Order status filter ('paid', 'pending', 'any')

**Example:**
```bash
curl -H "X-API-Key: your_api_key" \
  "https://your-api.com/api/orders?provider=Studio%20Marta%20Mez&limit=100"
```

#### Get Specific Order
```http
GET /api/orders/{order_id}
```

#### Get Available Providers
```http
GET /api/orders/providers
```

### BookingKit Integration Endpoints

#### OAuth Authorization
```http
GET /api/bookingkit/auth/authorize
```
Returns authorization URL for BookingKit OAuth flow.

#### Authorization Status
```http
GET /api/bookingkit/auth/status
```
Check current authorization status with BookingKit.

#### Webhook Endpoint
```http
POST /api/bookingkit/webhooks
```
Receives webhook notifications from BookingKit.

#### Sync Orders to BookingKit
```http
POST /api/bookingkit/sync
```

**Body:**
```json
{
  "provider": "Provider Name",
  "order_ids": ["123", "456"],
  "limit": 50
}
```

#### Get BookingKit Bookings
```http
GET /api/bookingkit/bookings
```

#### BookingKit Health Check
```http
GET /api/bookingkit/health
```

### Health & Status
```http
GET /api/health
GET /
```

## 🔐 Authentication

### API Key Authentication

All endpoints require authentication via API key:

**Header:**
```http
X-API-Key: your_api_key
```

**Query Parameter:**
```http
?api_key=your_api_key
```

### Provider-Specific Keys

Configure provider-specific keys for secure multi-tenant access:

```bash
# In .env
HOST_API_KEY_LLAMAS=llamas_specific_key
HOST_API_KEY_STUDIO_MARTA=studio_marta_key
```

Provider-specific keys only access their own data, while global keys access all providers.

## 📋 Response Format

All endpoints return consistent JSON format:

```json
{
  "success": true,
  "data": [
    {
      "booking_id": "5444517888123",
      "order_number": 1001,
      "order_name": "#1001",
      "customer": {
        "first_name": "John",
        "last_name": "Doe",
        "full_name": "John Doe",
        "email": "john@example.com",
        "phone": "+1234567890"
      },
      "event": {
        "name": "Workshop: Web Development",
        "date": "2025-11-30",
        "start_time": "17:00",
        "end_time": "18:30",
        "timezone": "Europe/Rome",
        "start_datetime": "2025-11-30T17:00:00.000Z",
        "end_datetime": "2025-11-30T18:30:00.000Z"
      },
      "provider": "Studio Marta Mez",
      "booking_details": {
        "created_at": "2025-11-04T10:30:00Z",
        "financial_status": "paid",
        "fulfillment_status": "fulfilled",
        "items": [
          {
            "name": "Workshop: Web Development",
            "quantity": 1,
            "price": "50.00"
          }
        ]
      },
      "cowlendar": {
        "internal_id": "501a5e4f-5b1b-40f2-b5cd-a20726271cdd",
        "integrity": "IjU0MzkyODY4NjM0OTQ4OjIi"
      },
      "status": "confirmed",
      "booking_type": "event",
      "source": "shopify_cowlendar"
    }
  ],
  "count": 1,
  "provider": "Studio Marta Mez",
  "filters": {
    "provider": "Studio Marta Mez",
    "limit": 50
  }
}
```

## 🔄 BookingKit Integration Setup

### For BookingKit Support

When setting up the integration with BookingKit, provide them with:

1. **Token Endpoint URL**: `https://your-domain.com/api/bookingkit/auth/authorize`
2. **User/Client ID**: Your microservice identifier
3. **Client Secret**: Your microservice secret key
4. **Webhook Endpoint URL**: `https://your-domain.com/api/bookingkit/webhooks`
5. **API Key URL**: `https://your-domain.com/api/orders`

### OAuth Flow

1. **Authorization**: Visit `/api/bookingkit/auth/authorize` to get authorization URL
2. **User Consent**: BookingKit redirects user to consent page
3. **Callback**: BookingKit redirects back with authorization code
4. **Token Exchange**: Service exchanges code for access token
5. **API Access**: Service can now make authenticated requests to BookingKit

### Webhook Handling

BookingKit sends webhooks for:
- `booking.created` - New booking created
- `booking.updated` - Booking modified
- `booking.cancelled` - Booking cancelled

## 🛒 Shopify Setup

### 1. Create Private App

1. Go to **Shopify Admin** → **Settings** → **Apps and sales channels**
2. Click **Develop apps** → **Create an app**
3. Configure **Admin API access** with permissions:
   - `read_orders`: Read orders and transactions
   - `read_products`: Read products and metafields

### 2. Configure Product Metafields

For each event product, add provider information:

**Option 1: Metafields (Recommended)**
1. Go to **Products** → Select event product
2. Scroll to **Metafields** section
3. Add metafield:
   - **Namespace**: `custom`
   - **Key**: `host` or `provider`
   - **Value**: Provider name (e.g., "Studio Marta Mez")

**Option 2: Product Tags**
Add tags in format: `host:ProviderName`
- Example: `host:Studio Marta Mez`

## 🚀 Deployment

### Render.com (Recommended)

1. **Connect Repository**
   - Create account on [Render.com](https://render.com)
   - Connect your GitHub repository
   - Choose "Web Service"

2. **Configure Service**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node.js
   - **Plan**: Starter or higher

3. **Environment Variables**
   Set all variables from `.env.example` in Render dashboard

4. **Auto-Deploy**
   Service auto-deploys on git push

### Other Platforms

The service is containerizable and works with:
- **Heroku**
- **Railway**
- **DigitalOcean App Platform**
- **AWS/Google Cloud/Azure** with Docker

## 📖 Integration Examples

### Bokun/BookingIt Integration

```javascript
const API_BASE = 'https://your-api.render.com/api';
const API_KEY = 'your_provider_specific_key';

class BookingSystemIntegration {
  constructor(provider, apiKey) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.baseUrl = API_BASE;
  }

  async getBookings(filters = {}) {
    const params = new URLSearchParams({
      provider: this.provider,
      ...filters
    });

    const response = await fetch(`${this.baseUrl}/orders?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    const data = await response.json();
    return data.success ? data.data : [];
  }

  async getBookingsByDate(date) {
    return this.getBookings({ event_date: date });
  }

  async getBookingsByCustomer(email) {
    return this.getBookings({ customer_email: email });
  }
}

// Usage
const studioMarta = new BookingSystemIntegration('Studio Marta Mez', 'provider_key');
const bookings = await studioMarta.getBookings({ limit: 100 });
```

### BookingKit Bidirectional Sync

```javascript
// Sync Shopify orders TO BookingKit
const syncResponse = await fetch(`${API_BASE}/bookingkit/sync`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your_api_key'
  },
  body: JSON.stringify({
    provider: 'Studio Marta Mez',
    limit: 50
  })
});

// Get BookingKit bookings
const bookingKitBookings = await fetch(`${API_BASE}/bookingkit/bookings`, {
  headers: { 'X-API-Key': 'your_api_key' }
});
```

## 📊 Monitoring & Debugging

### Health Checks

```bash
# Overall API health
curl https://your-api.com/api/health

# BookingKit integration health
curl -H "X-API-Key: your_key" https://your-api.com/api/bookingkit/health

# Test provider data
curl -H "X-API-Key: your_key" "https://your-api.com/api/orders?provider=YourProvider&limit=1"
```

### Common Issues

1. **No Orders Found**
   - Verify Shopify credentials
   - Check orders have Cowlendar metadata
   - Test with `/api/orders/providers` to see available providers

2. **Authentication Errors**
   - Verify API key format: `X-API-Key: your_key`
   - Check provider-specific key permissions

3. **BookingKit OAuth Issues**
   - Verify `BOOKINGKIT_CLIENT_ID` and `BOOKINGKIT_CLIENT_SECRET`
   - Check redirect URI matches exactly
   - Test with `/api/bookingkit/auth/status`

4. **Date/Time Issues**
   - Ensure Cowlendar format: "DD MMM YYYY, HH:mm - HH:mm (Timezone)"
   - Verify timezone is valid (e.g., "Europe/Rome")

## 🔧 Development

### Local Testing

```bash
# Start development server
npm run dev

# Test endpoints
curl -H "X-API-Key: your_dev_key" "http://localhost:3000/api/orders?provider=TestProvider"

# Test BookingKit endpoints
curl "http://localhost:3000/api/bookingkit/auth/authorize"
curl -H "X-API-Key: your_dev_key" "http://localhost:3000/api/bookingkit/health"
```

### Testing Different Booking Systems

The API works consistently across all booking systems:

```bash
# Same endpoint for all systems
curl -H "X-API-Key: bokun_key" "/api/orders?provider=YourProvider"      # Bokun
curl -H "X-API-Key: bookingit_key" "/api/orders?provider=YourProvider"  # BookingIt
curl -H "X-API-Key: bookingkit_key" "/api/orders?provider=YourProvider" # BookingKit
```

## 📞 Support

For technical issues:
1. Check logs via your hosting platform
2. Test health endpoints
3. Verify environment configuration
4. Check Shopify API credentials

## 📄 License

MIT License - see LICENSE file for details

---

**Version 2.1.0** - Now with full BookingKit integration support! 🎉