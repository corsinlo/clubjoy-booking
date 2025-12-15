# 🧪 **Postman Testing Guide**

## **Prerequisites**
1. ✅ Server running on `http://localhost:3000`
2. ✅ Shopify credentials configured in `.env`
3. ✅ Postman installed

## **Step-by-Step Postman Tests**

### **1. Health Check (No Auth Required)**

**Request:**
```
GET http://localhost:3000/api/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-11-04T17:48:49.000Z",
  "uptime": 123.45,
  "environment": "development",
  "version": "1.0.0",
  "shopify_connection": "OK"
}
```

---

### **2. Detailed Health Check**

**Request:**
```
GET http://localhost:3000/api/health/detailed
```

**Headers:**
```
X-API-Key: test_global_key_123
```

**Expected Response:**
```json
{
  "status": "OK",
  "configuration": {
    "shopify_store_url": "SET",
    "shopify_access_token": "SET",
    "api_key": "SET"
  },
  "services": {
    "shopify": {
      "status": "OK",
      "sample_orders_count": 1
    },
    "cowlendar": {
      "status": "OK",
      "event_orders_found": 0
    }
  }
}
```

---

### **3. Get All Available Hosts**

**Request:**
```
GET http://localhost:3000/api/bookings/hosts
```

**Headers:**
```
X-API-Key: test_global_key_123
```

**Expected Response:**
```json
{
  "success": true,
  "data": ["Llamas", "Another Host"],
  "count": 2
}
```

---

### **4. Get All Orders (Global Access)**

**Request:**
```
GET http://localhost:3000/api/bookings
```

**Headers:**
```
X-API-Key: test_global_key_123
```

**Query Parameters:**
- `limit`: 10

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "booking_id": "5444517888123",
      "order_number": 1001,
      "customer": {
        "first_name": "John",
        "last_name": "Doe",
        "email": "john@example.com"
      },
      "event": {
        "name": "Workshop: Web Development",
        "host": "Llamas",
        "date": "2025-11-30",
        "start_time": "17:00"
      },
      "host": "Llamas",
      "status": "confirmed"
    }
  ],
  "count": 1
}
```

---

### **5. Get Host-Specific Orders (Llamas)**

**Request:**
```
GET http://localhost:3000/api/bookings/host/Llamas
```

**Headers:**
```
X-API-Key: llamas_test_key_456
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "booking_id": "5444517888123",
      "event": {
        "name": "Llama Workshop",
        "host": "Llamas"
      },
      "host": "Llamas"
    }
  ],
  "count": 1,
  "host": "Llamas"
}
```

---

### **6. Test Security - Wrong Host Access**

**Request:**
```
GET http://localhost:3000/api/bookings/host/Another_Host
```

**Headers:**
```
X-API-Key: llamas_test_key_456
```

**Expected Response (403 Error):**
```json
{
  "success": false,
  "error": "Access denied",
  "message": "Host \"llamas\" cannot access data for host \"Another_Host\""
}
```

---

### **7. Filter by Customer Email**

**Request:**
```
GET http://localhost:3000/api/bookings/host/Llamas/customer/john@example.com
```

**Headers:**
```
X-API-Key: llamas_test_key_456
```

---

### **8. Filter by Event Date**

**Request:**
```
GET http://localhost:3000/api/bookings/host/Llamas/events/2025-11-30
```

**Headers:**
```
X-API-Key: llamas_test_key_456
```

---

## **🔧 Troubleshooting Common Issues**

### **Issue 1: Shopify Connection Error**
```json
{
  "shopify_connection": "ERROR",
  "shopify_error": "Failed to fetch orders: ..."
}
```

**Solution:**
1. Check `SHOPIFY_STORE_URL` format: `your-store.myshopify.com` (no https://)
2. Verify `SHOPIFY_ACCESS_TOKEN` is correct
3. Ensure Shopify app has `read_orders` permission

### **Issue 2: No Event Orders Found**
```json
{
  "success": true,
  "data": [],
  "count": 0
}
```

**Solution:**
1. Create test orders in Shopify with Cowlendar metadata
2. Add note attributes to orders:
   - `Data: 30 nov 2025, 17:00 - 18:30 (Europe/Rome)`
   - `__cow_internal_id: test-id-123`

### **Issue 3: No Hosts Found**
```json
{
  "data": [],
  "count": 0
}
```

**Solution:**
1. Add host metafields to products in Shopify
2. Or add product tags like `host:Llamas`

---

## **📊 Creating Test Data in Shopify**

### **1. Create Test Products with Host Metafields**
1. Go to Products → Add product
2. Name: "Llama Workshop"
3. Add metafield:
   - Namespace: `custom`
   - Key: `host`
   - Value: `Llamas`

### **2. Create Test Orders**
1. Create manual order in Shopify
2. Add the product with host metafield
3. Add note attributes:
   ```
   Data: 30 nov 2025, 17:00 - 18:30 (Europe/Rome)
   __cow_internal_id: 501a5e4f-5b1b-40f2-b5cd-a20726271cdd
   __cow_integrity: IjU0MzkyODY4NjM0OTQ4OjIi
   ```

---

## **🚀 Ready for Bookun Integration**

Once all Postman tests pass:

1. ✅ Health checks return OK
2. ✅ Orders are fetched from Shopify
3. ✅ Host filtering works correctly
4. ✅ Authentication blocks unauthorized access
5. ✅ Event metadata is parsed correctly

**Your API is ready for Bookun integration!**

The Llamas team can use:
- **Endpoint**: `https://your-domain.com/api/bookings/host/Llamas`
- **API Key**: `llamas_test_key_456` (change in production)
- **Access**: Only their events, no other hosts' data