const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toTrimmedOrigin = (origin) => String(origin || '').trim();

const buildHostedOriginMatchers = (projectId) => {
  if (!projectId) return [];
  const escaped = escapeRegExp(projectId);
  return [
    new RegExp(`^https://${escaped}(?:--[a-z0-9-]+)?\\.web\\.app$`, 'i'),
    new RegExp(`^https://${escaped}(?:--[a-z0-9-]+)?\\.firebaseapp\\.com$`, 'i'),
    new RegExp(`^https://[a-z0-9-]+--${escaped}\\.[a-z0-9-]+\\.hosted\\.app$`, 'i'),
    new RegExp(`^https://${escaped}\\.[a-z0-9-]+\\.hosted\\.app$`, 'i'),
  ];
};

const hostedFallbackMatchers = [
  /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.[a-z0-9-]+\.hosted\.app$/i,
  /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.hosted\.app$/i,
];

const localhostOriginMatchers = [
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^http:\/\/\[::1](?::\d+)?$/i,
];

const createSystemStatusCorsPolicy = ({ projectId, extraAllowedOrigins = [], allowLocalhostCors = false }) => {
  const allowedOrigins = new Set((extraAllowedOrigins || []).map(toTrimmedOrigin).filter(Boolean));
  if (projectId) {
    allowedOrigins.add(`https://${projectId}.web.app`);
    allowedOrigins.add(`https://${projectId}.firebaseapp.com`);
  }

  const hostedMatchers = buildHostedOriginMatchers(projectId);

  const isAllowedOrigin = (origin) => {
    const normalized = toTrimmedOrigin(origin);
    if (!normalized) return true;
    if (allowedOrigins.has(normalized)) return true;
    if (hostedMatchers.some((matcher) => matcher.test(normalized))) return true;

    // Production-safe fallback: if project id isn't resolved, allow Firebase hosted.app origins.
    if (!projectId && hostedFallbackMatchers.some((matcher) => matcher.test(normalized))) return true;

    return allowLocalhostCors && localhostOriginMatchers.some((matcher) => matcher.test(normalized));
  };

  const setCorsHeaders = (req, res, origin, allowedMethods = 'GET, OPTIONS') => {
    const requestedHeaders = req.get('Access-Control-Request-Headers');
    const allowHeaders = requestedHeaders || 'Content-Type, Authorization, X-Firebase-AppCheck, X-Requested-With, X-Client-Version, X-Firebase-GMPID';

    res.set('Vary', 'Origin, Access-Control-Request-Headers');
    if (origin && isAllowedOrigin(origin)) {
      res.set('Access-Control-Allow-Origin', toTrimmedOrigin(origin));
    }
    res.set('Access-Control-Allow-Methods', allowedMethods);
    res.set('Access-Control-Allow-Headers', allowHeaders);
    res.set('Access-Control-Max-Age', '3600');
    res.set('Cache-Control', 'no-store');
  };

  return {
    isAllowedOrigin,
    setCorsHeaders,
  };
};

const createGetSystemStatusHandler = ({ getBootstrapState, log, getCorrelationIdFromHttpRequest, corsPolicy }) => {
  if (!corsPolicy || typeof corsPolicy.isAllowedOrigin !== 'function' || typeof corsPolicy.setCorsHeaders !== 'function') {
    throw new Error('Invalid corsPolicy for getSystemStatus handler');
  }

  return async (req, res) => {
    const origin = req.get('Origin') || '';
    const correlationId = getCorrelationIdFromHttpRequest(req);
    
    // CRITICAL: Set CORS headers on ALL response paths BEFORE any response is sent
    corsPolicy.setCorsHeaders(req, res, origin);

    if (req.method === 'OPTIONS') {
      log('INFO', 'CORS', 'Handled system status preflight request', correlationId, {
        origin: origin || 'none',
        allowed: corsPolicy.isAllowedOrigin(origin),
      });
      res.status(204).send('');
      return;
    }

    if (!corsPolicy.isAllowedOrigin(origin)) {
      log('WARNING', 'SECURITY', 'Blocked system status request from disallowed origin', correlationId, {
        origin: origin || 'none',
        method: req.method,
      });
      // CORS headers already set above, so browser will see proper CORS headers even on 403
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }

    if (req.method !== 'GET') {
      log('WARNING', 'BOOTSTRAP', 'Rejected system status request with invalid method', correlationId, {
        origin: origin || 'none',
        method: req.method,
      });
      // CORS headers already set above
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const state = await getBootstrapState();
      log('INFO', 'BOOTSTRAP', 'Bootstrap state loaded from persistent backend config', correlationId, {
        origin: origin || 'none',
        method: req.method,
        bootstrapCompleted: state.bootstrapCompleted,
        masterAdminUserId: state.masterAdminUserId,
        initializedAt: state.initializedAt,
      });
      // CORS headers already set above
      res.status(200).json({
        ok: true,
        initialized: state.bootstrapCompleted,
        ...state,
        data: state,
        result: state,
      });
    } catch (error) {
      log('ERROR', 'BOOTSTRAP', 'Failed to load bootstrap state', correlationId, {
        origin: origin || 'none',
        method: req.method,
        error,
      });
      // CORS headers already set above, so browser will see proper CORS headers even on 500
      res.status(500).json({ error: 'Unable to load system status' });
    }
  };
};

const createBootstrapSystemHandler = ({ bootstrapSystem, sanitizeUsername, log, getCorrelationIdFromHttpRequest, corsPolicy }) => {
  if (!corsPolicy || typeof corsPolicy.isAllowedOrigin !== 'function' || typeof corsPolicy.setCorsHeaders !== 'function') {
    throw new Error('Invalid corsPolicy for bootstrapSystem handler');
  }
  if (typeof bootstrapSystem !== 'function') {
    throw new Error('Invalid bootstrapSystem executor for bootstrapSystem handler');
  }
  if (typeof sanitizeUsername !== 'function') {
    throw new Error('Invalid sanitizeUsername for bootstrapSystem handler');
  }

  return async (req, res) => {
    const origin = req.get('Origin') || '';
    const correlationId = getCorrelationIdFromHttpRequest(req);

    corsPolicy.setCorsHeaders(req, res, origin, 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      log('INFO', 'CORS', 'Handled bootstrap preflight request', correlationId, {
        origin: origin || 'none',
        allowed: corsPolicy.isAllowedOrigin(origin),
      });
      res.status(204).send('');
      return;
    }

    if (!corsPolicy.isAllowedOrigin(origin)) {
      log('WARNING', 'SECURITY', 'Blocked bootstrap request from disallowed origin', correlationId, {
        origin: origin || 'none',
        method: req.method,
      });
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }

    if (req.method !== 'POST') {
      log('WARNING', 'BOOTSTRAP', 'Rejected bootstrap request with invalid method', correlationId, {
        origin: origin || 'none',
        method: req.method,
      });
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const username = sanitizeUsername((req.body && req.body.username) || 'admin', 'Master Admin username');
      const result = await bootstrapSystem({ username, correlationId });
      res.status(200).json(result);
    } catch (error) {
      const code = error && error.code ? String(error.code) : '';
      if (code === 'already-exists') {
        log('WARNING', 'BOOTSTRAP', 'Duplicate bootstrap attempt blocked', correlationId, {
          origin: origin || 'none',
          method: req.method,
        });
        res.status(409).json({ error: 'System already bootstrapped', code: 'already-exists' });
        return;
      }
      if (code === 'invalid-argument') {
        res.status(400).json({ error: error.message || 'Invalid bootstrap request', code: 'invalid-argument' });
        return;
      }

      log('ERROR', 'BOOTSTRAP', 'Failed to bootstrap system', correlationId, {
        origin: origin || 'none',
        method: req.method,
        error,
      });
      res.status(500).json({ error: 'Unable to bootstrap system' });
    }
  };
};

module.exports = {
  createSystemStatusCorsPolicy,
  createGetSystemStatusHandler,
  createBootstrapSystemHandler,
};

