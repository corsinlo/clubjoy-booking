/**
 * Authentication middleware for API key validation
 * Bookun and other external systems will use API key authentication
 * Supports both global API keys and host-specific API keys
 */

/**
 * Parse host-specific API keys from environment variables
 * Format: HOST_API_KEY_LLAMAS=key_for_llamas, HOST_API_KEY_ANOTHER=key_for_another
 */
function getHostApiKeys() {
  const hostKeys = {};

  Object.keys(process.env).forEach(key => {
    if (key.startsWith('HOST_API_KEY_')) {
      const hostName = key.replace('HOST_API_KEY_', '').toLowerCase();
      hostKeys[hostName] = process.env[key];
    }
  });

  return hostKeys;
}

/**
 * Middleware to authenticate API key
 * Supports both header and query parameter authentication
 * Supports host-specific API keys for multi-tenant access
 */
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const expectedApiKey = process.env.API_KEY;
  const hostKeys = getHostApiKeys();

  // In development, allow requests without API key for testing
  if (process.env.NODE_ENV === 'development' && !expectedApiKey && Object.keys(hostKeys).length === 0) {
    console.warn('⚠️  No API_KEY or HOST_API_KEY_* set in development mode - allowing all requests');
    return next();
  }

  if (!expectedApiKey && Object.keys(hostKeys).length === 0) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration error',
      message: 'API_KEY or HOST_API_KEY_* not configured'
    });
  }

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'API key must be provided via X-API-Key header or api_key query parameter'
    });
  }

  // Check global API key first
  if (expectedApiKey && apiKey === expectedApiKey) {
    console.log(`✅ Global API key authenticated for ${req.method} ${req.path}`);
    req.authenticatedAs = 'global';
    return next();
  }

  // Check host-specific API keys
  const authenticatedHost = Object.keys(hostKeys).find(host => hostKeys[host] === apiKey);
  if (authenticatedHost) {
    console.log(`✅ Host API key authenticated for host "${authenticatedHost}" - ${req.method} ${req.path}`);
    req.authenticatedAs = 'host';
    req.authenticatedHost = authenticatedHost;
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Invalid API key',
    message: 'The provided API key is not valid'
  });
}

/**
 * Middleware to validate host access for host-specific endpoints
 * Should be used after authenticateApiKey for /host/:hostName endpoints
 */
function validateHostAccess(req, res, next) {
  const { hostName } = req.params;

  // Global API key has access to all hosts
  if (req.authenticatedAs === 'global') {
    return next();
  }

  // Host-specific API key can only access their own data
  if (req.authenticatedAs === 'host') {
    if (req.authenticatedHost === hostName.toLowerCase()) {
      return next();
    } else {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: `Host "${req.authenticatedHost}" cannot access data for host "${hostName}"`
      });
    }
  }

  return res.status(403).json({
    success: false,
    error: 'Access denied',
    message: 'Invalid authentication'
  });
}

/**
 * Optional rate limiting middleware
 * Basic in-memory rate limiting by IP
 */
const rateLimitStore = new Map();

function rateLimit(maxRequests = 100, windowMs = 15 * 60 * 1000) { // 15 minutes
  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    for (const [ip, requests] of rateLimitStore.entries()) {
      rateLimitStore.set(ip, requests.filter(time => time > windowStart));
      if (rateLimitStore.get(ip).length === 0) {
        rateLimitStore.delete(ip);
      }
    }

    // Check current IP
    const clientRequests = rateLimitStore.get(clientIp) || [];
    const recentRequests = clientRequests.filter(time => time > windowStart);

    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000 / 60} minutes.`,
        retry_after: Math.ceil((recentRequests[0] + windowMs - now) / 1000)
      });
    }

    // Record this request
    recentRequests.push(now);
    rateLimitStore.set(clientIp, recentRequests);

    next();
  };
}

module.exports = {
  authenticateApiKey,
  validateHostAccess,
  rateLimit
};