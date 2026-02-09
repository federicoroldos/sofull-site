import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const BRAND_NAME = '배불러! (So Full!)';
const BRAND_TAGLINE = 'Your food logging and rating site';

const COLORS = {
  paper: '#f8f3e9',
  paperAccent: '#efe6d8',
  ink: '#1f2a2e',
  muted: '#6a6f73',
  accent: '#d1553d',
  accentDark: '#b4432d',
  outline: '#22333a',
  card: '#fffdf8'
};

const DEFAULT_SUPPORT_EMAIL = 'federicoroldos1@gmail.com';
const DEFAULT_APP_URL = 'https://sofull.site';
const GOOGLE_SECURITY_URL = 'https://myaccount.google.com/security';
const DEFAULT_ALLOWED_ORIGINS = [DEFAULT_APP_URL];
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEYS = [
  'authorization',
  'api-key',
  'apikey',
  'api_key',
  'token',
  'secret',
  'password',
  'private_key',
  'service_account',
  'firebase',
  'brevo',
  'captcha'
];
const SENSITIVE_PATTERNS = [
  /bearer\s+[a-z0-9._-]+/gi,
  /(api[-_]?key\s*[:=]\s*)[a-z0-9._-]+/gi,
  /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g
];
const RATE_LIMIT_STORE = new Map();
const RATE_LIMIT_STORE_MAX = 2000;

const toFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isSensitiveKey = (key) => {
  const lowered = String(key || '').toLowerCase();
  return SENSITIVE_KEYS.some((token) => lowered.includes(token));
};

const redactString = (value) => {
  let redacted = String(value ?? '');
  SENSITIVE_PATTERNS.forEach((pattern) => {
    redacted = redacted.replace(pattern, (match, prefix) => {
      if (prefix) return `${prefix}${REDACTED_VALUE}`;
      return REDACTED_VALUE;
    });
  });
  return redacted;
};

const sanitizeValue = (key, value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (isSensitiveKey(key)) return REDACTED_VALUE;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (depth > 3) return '[Object]';
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(key, entry, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeValue(childKey, childValue, depth + 1)
    ])
  );
};

const createSafeLogger = (context = {}) => {
  const baseContext =
    context && typeof context === 'object' ? sanitizeValue('context', context, 0) : {};
  const log = (level, message, meta) => {
    const safeMeta =
      meta && typeof meta === 'object' ? sanitizeValue('meta', meta, 0) : meta ?? undefined;
    if (safeMeta && typeof safeMeta === 'object') {
      console[level](message, { ...baseContext, ...safeMeta });
      return;
    }
    console[level](message, baseContext);
  };
  return {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta)
  };
};

const normalizeBaseUrl = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
};

const isLocalHostUrl = (value) =>
  /(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(String(value || ''));

const joinUrl = (base, path) => {
  const safeBase = String(base || '').replace(/\/+$/, '');
  const safePath = String(path || '').replace(/^\/+/, '');
  if (!safeBase) return `/${safePath}`;
  return `${safeBase}/${safePath}`;
};

const parseOriginList = (raw) =>
  String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value !== '*')
    .map((value) => normalizeBaseUrl(value))
    .filter(Boolean);

const resolveAllowedOrigins = () => {
  const allowed = new Set();
  const fromEnv = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '';
  const fromDev = process.env.DEV_CORS_ORIGINS || '';
  const fromSite = [
    process.env.PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.APP_BASE_URL
  ];

  parseOriginList(fromEnv).forEach((origin) => allowed.add(origin));
  parseOriginList(fromDev).forEach((origin) => allowed.add(origin));
  fromSite
    .map((value) => normalizeBaseUrl(value))
    .filter(Boolean)
    .forEach((origin) => allowed.add(origin));

  if (allowed.size === 0) {
    DEFAULT_ALLOWED_ORIGINS.forEach((origin) => allowed.add(origin));
  }

  if (process.env.ALLOW_LOCALHOST_ORIGIN === 'true') {
    DEFAULT_DEV_ORIGINS.forEach((origin) => allowed.add(origin));
  }

  return Array.from(allowed);
};

const getAllowedOrigin = (req, allowedOrigins) => {
  const origin = req.headers.origin;
  if (!origin) return '';
  const normalized = normalizeBaseUrl(origin);
  if (!normalized) return '';
  const allowed = new Set(allowedOrigins.map((value) => normalizeBaseUrl(value)).filter(Boolean));
  return allowed.has(normalized) ? origin : '';
};

const getHeader = (req, name) => {
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value;
  return '';
};

const getRequestId = (req) =>
  getHeader(req, 'x-vercel-id') || getHeader(req, 'x-request-id') || '';

const getClientIp = (req) => {
  const forwarded =
    getHeader(req, 'x-forwarded-for') ||
    getHeader(req, 'x-real-ip') ||
    getHeader(req, 'x-vercel-forwarded-for') ||
    getHeader(req, 'x-client-ip');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
};

const hasBody = (req) => {
  if (!req || req.body === undefined || req.body === null) return false;
  if (typeof req.body === 'string') return req.body.trim().length > 0;
  if (Buffer.isBuffer(req.body)) return req.body.length > 0;
  if (typeof req.body === 'object') return Object.keys(req.body).length > 0;
  return true;
};

const parseJsonBody = (req) => {
  if (!hasBody(req)) return { body: null, error: null };
  const contentType = getHeader(req, 'content-type');
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return { body: null, error: 'Unsupported content type.' };
  }
  if (typeof req.body === 'object') {
    return { body: req.body, error: null };
  }
  if (typeof req.body === 'string') {
    try {
      return { body: JSON.parse(req.body), error: null };
    } catch {
      return { body: null, error: 'Invalid JSON payload.' };
    }
  }
  return { body: null, error: 'Invalid request payload.' };
};

const validatePayload = (payload) => {
  if (!payload) return { ok: true, data: {} };
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Invalid request payload.' };
  }
  const allowedKeys = new Set(['captchaToken']);
  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: 'Invalid request payload.' };
    }
  }
  const captchaToken = payload.captchaToken;
  if (captchaToken !== undefined && typeof captchaToken !== 'string') {
    return { ok: false, error: 'Invalid request payload.' };
  }
  return {
    ok: true,
    data: {
      captchaToken: captchaToken ? captchaToken.trim() : ''
    }
  };
};

const sendError = (res, status, message) => {
  res.status(status).json({ error: message });
};

const parseUserAgent = (userAgent) => {
  if (!userAgent) return { browser: null, device: null };
  const ua = userAgent.toLowerCase();
  let browser = null;

  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera/')) browser = 'Opera';
  else if (ua.includes('chrome/') && !ua.includes('chromium')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && ua.includes('version/')) browser = 'Safari';

  let os = null;
  if (ua.includes('windows nt')) os = 'Windows';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('mac os x')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  let deviceType = 'Desktop';
  if (ua.includes('tablet') || ua.includes('ipad')) deviceType = 'Tablet';
  else if (ua.includes('mobile')) deviceType = 'Mobile';

  const device = os ? `${os} (${deviceType})` : deviceType;

  return { browser, device };
};

const getClientLocale = (req) => {
  const locale = getHeader(req, 'x-client-locale') || getHeader(req, 'accept-language');
  if (!locale) return 'en-US';
  return locale.split(',')[0].trim() || 'en-US';
};

const isValidTimeZone = (timeZone) => {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const getClientTimeZone = (req) => {
  const timeZone = getHeader(req, 'x-client-timezone');
  return isValidTimeZone(timeZone) ? timeZone : null;
};

const formatTimestamp = (timestampMs, locale, timeZone) => {
  const safeTimeZone = timeZone || 'UTC';
  try {
    return new Intl.DateTimeFormat(locale || 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: safeTimeZone
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toUTCString();
  }
};

const getRequestMeta = (req) => {
  const userAgent = getHeader(req, 'user-agent');
  const { browser, device } = parseUserAgent(userAgent);

  const city = getHeader(req, 'x-vercel-ip-city') || getHeader(req, 'x-appengine-city');
  const country =
    getHeader(req, 'x-vercel-ip-country') ||
    getHeader(req, 'cf-ipcountry') ||
    getHeader(req, 'x-appengine-country');

  return {
    userAgent,
    browser,
    device,
    city: city || null,
    country: country || null
  };
};

const buildMetaRows = ({ timeLabel, timeValue, device, browser, city, country }) => {
  const rows = [];
  if (timeValue) rows.push({ label: timeLabel, value: timeValue });
  if (device) rows.push({ label: 'Device', value: device });
  if (browser) rows.push({ label: 'Browser', value: browser });
  const locationParts = [city, country].filter(Boolean);
  if (locationParts.length) {
    rows.push({ label: 'Location', value: locationParts.join(', ') });
  }
  return rows;
};

const renderParagraphs = (lines, style) =>
  (lines || [])
    .filter(Boolean)
    .map((line) => `<p style="${style}">${escapeHtml(line)}</p>`)
    .join('');

const renderMetaTable = (rows) => {
  if (!rows || rows.length === 0) return '';
  const rowHtml = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 0; font-size:13px; color:${COLORS.muted}; width:160px;">${escapeHtml(
            row.label
          )}</td>
          <td style="padding:6px 0; font-size:13px; color:${COLORS.ink}; font-weight:600;">${escapeHtml(
            row.value
          )}</td>
        </tr>`
    )
    .join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 6px; border-top:1px solid ${
      COLORS.paperAccent
    }">
      ${rowHtml}
    </table>`;
};

const isSvgLogo = (value) =>
  /\.svg($|[?#])/i.test(String(value || '')) || String(value || '').startsWith('data:image/svg+xml');

const buildEmailLayout = ({
  preheader,
  title,
  greeting,
  bodyLines,
  cta,
  metaRows,
  callout,
  appUrl,
  logoUrl,
  accountEmail,
  supportEmail,
  privacyUrl,
  termsUrl
}) => {
  const buttonHtml = cta
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0 4px;">
        <tr>
          <td align="center" bgcolor="${COLORS.accent}" style="border-radius:999px;">
            <a href="${cta.url}" style="display:inline-block; padding:12px 22px; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; border-radius:999px; border:2px solid ${
      COLORS.outline
    }">${escapeHtml(cta.label)}</a>
          </td>
        </tr>
      </table>`
    : '';

  const calloutHtml = callout
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 0; background:${
        COLORS.paperAccent
      }; border:1px dashed ${COLORS.outline}; border-radius:16px;">
        <tr>
          <td style="padding:16px;">
            <p style="margin:0 0 6px; font-size:14px; font-weight:700; color:${COLORS.ink};">${escapeHtml(
        callout.title
      )}</p>
            <p style="margin:0 0 10px; font-size:13px; color:${COLORS.muted}; line-height:1.5;">${escapeHtml(
        callout.text
      )}</p>
            ${
              callout.action
                ? `<a href="${callout.action.url}" style="display:inline-block; color:${COLORS.accentDark}; font-weight:700; font-size:13px; text-decoration:underline;">${escapeHtml(
                    callout.action.label
                  )}</a>`
                : ''
            }
          </td>
        </tr>
      </table>`
    : '';

  const resolvedLogoUrl = logoUrl || (appUrl ? joinUrl(appUrl, 'favicon.svg') : '');
  const shouldRenderImage = resolvedLogoUrl && !isSvgLogo(resolvedLogoUrl);
  const accountLine = accountEmail ? escapeHtml(accountEmail) : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0; padding:0; background:${COLORS.paper};">
    <span style="display:none; font-size:1px; color:${COLORS.paper}; max-height:0; max-width:0; opacity:0; overflow:hidden;">${escapeHtml(
      preheader
    )}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${
      COLORS.paper
    }">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px; background:${
            COLORS.card
          }; border:2px solid ${COLORS.outline}; border-radius:24px; overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 12px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="padding-right:12px;">
                            <table role="presentation" cellspacing="0" cellpadding="0" style="border-radius:12px; border:2px solid ${
                              COLORS.outline
                            }; background:${COLORS.paperAccent}; width:44px; height:44px;">
                              <tr>
                                <td align="center" valign="middle">
                                  ${
                                    shouldRenderImage
                                      ? `<img src="${resolvedLogoUrl}" width="26" height="26" alt="${escapeHtml(
                                          BRAND_NAME
                                        )} logo" style="display:block; border:0; outline:none; text-decoration:none;" />`
                                      : `<span style="display:inline-block; font-size:12px; font-weight:800; color:${COLORS.accentDark}; font-family:'Nunito', Arial, sans-serif;">배불러</span>`
                                  }
                                </td>
                              </tr>
                            </table>
                          </td>
                          <td>
                            <div style="font-size:20px; font-weight:800; color:${COLORS.ink}; font-family:'Nunito', Arial, sans-serif;">${escapeHtml(
                              BRAND_NAME
                            )}</div>
                            <div style="font-size:12px; color:${COLORS.muted}; font-family:'Nunito', Arial, sans-serif;">${escapeHtml(
                              BRAND_TAGLINE
                            )}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" style="font-size:12px; color:${
                      COLORS.muted
                    }; font-family:'Nunito', Arial, sans-serif;">${
    accountLine || 'Account email'
  }</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 28px 24px; font-family:'Nunito', Arial, sans-serif;">
                <h1 style="margin:0 0 12px; font-size:26px; color:${
                  COLORS.ink
                }; line-height:1.2;">${escapeHtml(title)}</h1>
                <p style="margin:0 0 12px; font-size:15px; color:${
                  COLORS.ink
                }; line-height:1.6; font-weight:600;">${escapeHtml(greeting)}</p>
                ${renderParagraphs(bodyLines, `margin:0 0 12px; font-size:14px; color:${
                  COLORS.muted
                }; line-height:1.6;`)}
                ${renderMetaTable(metaRows)}
                ${buttonHtml}
                ${calloutHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 22px; background:${
                COLORS.paperAccent
              }; border-top:2px solid ${COLORS.outline}; font-family:'Nunito', Arial, sans-serif;">
                <p style="margin:0 0 6px; font-size:12px; color:${COLORS.muted}; line-height:1.5;">Need help? Email <a href="mailto:${supportEmail}" style="color:${
      COLORS.accentDark
    }; font-weight:700; text-decoration:underline;">${escapeHtml(
      supportEmail
    )}</a>.</p>
                <p style="margin:0; font-size:12px; color:${
                  COLORS.muted
                };"><a href="${privacyUrl}" style="color:${
      COLORS.ink
    }; font-weight:700; text-decoration:underline;">Privacy Policy</a> · <a href="${termsUrl}" style="color:${
      COLORS.ink
    }; font-weight:700; text-decoration:underline;">Terms of Service</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const buildTextContent = ({ greeting, bodyLines, metaRows, cta, callout, supportEmail, privacyUrl, termsUrl }) => {
  const lines = [];
  if (greeting) {
    lines.push(`Hi ${greeting},`, '');
  }
  if (bodyLines && bodyLines.length) {
    lines.push(...bodyLines, '');
  }
  if (metaRows && metaRows.length) {
    lines.push('Details:');
    metaRows.forEach((row) => {
      lines.push(`${row.label}: ${row.value}`);
    });
    lines.push('');
  }
  if (cta) {
    lines.push(`${cta.label}: ${cta.url}`, '');
  }
  if (callout) {
    lines.push(`${callout.title} ${callout.text}`);
    if (callout.action) {
      lines.push(`${callout.action.label}: ${callout.action.url}`);
    }
    lines.push('');
  }
  lines.push(`Need help? Email ${supportEmail}.`);
  lines.push(`Privacy Policy: ${privacyUrl}`);
  lines.push(`Terms of Service: ${termsUrl}`);
  return lines.filter((line) => line !== null && line !== undefined).join('\n');
};

export const buildWelcomeEmail = ({
  appUrl,
  displayName,
  supportEmail,
  privacyUrl,
  termsUrl,
  accountEmail,
  logoUrl
}) => {
  const subject = 'Welcome to 배불러! (So Full!)';
  const preheader = 'Your 배불러! (So Full!) account is ready to go.';
  const greeting = displayName || 'there';
  const bodyLines = [
    'Welcome to 배불러! (So Full!) You are all set to start tracking your favorite ramyeon, snacks, drinks, and ice cream.',
    'This email confirms your first sign-in. No further action is needed.'
  ];
  const cta = appUrl ? { label: 'Open 배불러! (So Full!)', url: appUrl } : null;
  const callout = {
    title: 'Wasn\'t you?',
    text: 'If you did not sign in, you can ignore this email or reach out to support.',
    action: supportEmail ? { label: 'Contact support', url: `mailto:${supportEmail}` } : null
  };

  return {
    subject,
    preheader,
    textContent: buildTextContent({
      greeting,
      bodyLines,
      metaRows: [],
      cta,
      callout,
      supportEmail,
      privacyUrl,
      termsUrl
    }),
    htmlContent: buildEmailLayout({
      preheader,
      title: 'Welcome to 배불러! (So Full!)',
      greeting: `Hi ${greeting},`,
      bodyLines,
      cta,
      metaRows: [],
      callout,
      appUrl,
      logoUrl,
      accountEmail,
      supportEmail,
      privacyUrl,
      termsUrl
    })
  };
};

export const buildLoginEmail = ({
  appUrl,
  displayName,
  supportEmail,
  privacyUrl,
  termsUrl,
  metaRows,
  accountEmail,
  logoUrl
}) => {
  const subject = 'New sign-in to your 배불러! (So Full!) account';
  const preheader = 'We noticed a sign-in to your 배불러! (So Full!) account.';
  const greeting = displayName || 'there';
  const bodyLines = [
    'We noticed a sign-in to your account. Here are the details we captured:',
    'If something looks off, please secure your Google account right away.'
  ];
  const cta = appUrl ? { label: 'Open 배불러! (So Full!)', url: appUrl } : null;
  const callout = {
    title: 'Wasn\'t you?',
    text: 'Review your Google account security settings and revoke unknown sessions.',
    action: { label: 'Secure your Google account', url: GOOGLE_SECURITY_URL }
  };

  return {
    subject,
    preheader,
    textContent: buildTextContent({
      greeting,
      bodyLines,
      metaRows,
      cta,
      callout,
      supportEmail,
      privacyUrl,
      termsUrl
    }),
    htmlContent: buildEmailLayout({
      preheader,
      title: 'New sign-in detected',
      greeting: `Hi ${greeting},`,
      bodyLines,
      cta,
      metaRows,
      callout,
      appUrl,
      logoUrl,
      accountEmail,
      supportEmail,
      privacyUrl,
      termsUrl
    })
  };
};

export const computeEmailPlan = ({ state = {}, now, authTimeMs, loginCooldownMs }) => {
  const welcomeSent = Boolean(state?.welcomeSent);
  const lastAuthEventTime = toFiniteNumber(state?.lastAuthEventTime);
  const lastLoginEmailAt = toFiniteNumber(state?.lastLoginEmailAt);

  const shouldSendWelcome = !welcomeSent;
  let isDuplicateAuthEvent = false;

  if (authTimeMs && lastAuthEventTime) {
    isDuplicateAuthEvent = authTimeMs <= lastAuthEventTime;
  }

  let shouldSendLogin = !shouldSendWelcome && !isDuplicateAuthEvent;

  if (!authTimeMs && loginCooldownMs > 0 && lastLoginEmailAt) {
    if (now - lastLoginEmailAt < loginCooldownMs) {
      shouldSendLogin = false;
    }
  }

  return { shouldSendWelcome, shouldSendLogin, isDuplicateAuthEvent };
};

export const buildEmailStateUpdates = ({
  email,
  displayName,
  now,
  authTimeMs,
  shouldSendWelcome,
  shouldSendLogin
}) => {
  const updates = { email, displayName };

  if (shouldSendWelcome) {
    updates.welcomeSent = true;
    updates.welcomeSentAt = now;
  }

  if (authTimeMs && (shouldSendWelcome || shouldSendLogin)) {
    updates.lastAuthEventTime = authTimeMs;
  }

  if (shouldSendLogin) {
    updates.lastLoginEmailAt = now;
  }

  return updates;
};

const getBearerToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
};

const loadServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const ensureFirebase = () => {
  if (getApps().length) return;
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    throw new Error('Missing or invalid FIREBASE_SERVICE_ACCOUNT_JSON.');
  }
  initializeApp({ credential: cert(serviceAccount) });
};

class EmailProviderError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'EmailProviderError';
    this.status = status;
    this.details = details;
  }
}

const sendBrevoEmail = async ({ toEmail, toName, subject, textContent, htmlContent }) => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || BRAND_NAME;

  if (!apiKey || !senderEmail) {
    throw new Error('Missing BREVO_API_KEY or BREVO_SENDER_EMAIL.');
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: toEmail, name: toName }],
      subject,
      textContent,
      htmlContent
    })
  });

  if (!response.ok) {
    let details = '';
    try {
      details = await response.text();
    } catch {
      details = '';
    }
    throw new EmailProviderError('Brevo request failed.', response.status, details);
  }
};

const getAppBaseUrl = (req, allowedOrigin) => {
  const envUrl = normalizeBaseUrl(
    process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.APP_BASE_URL
  );
  if (envUrl) return envUrl;
  if (allowedOrigin) {
    const normalized = normalizeBaseUrl(allowedOrigin);
    if (normalized && !isLocalHostUrl(normalized)) return normalized;
  }
  return DEFAULT_APP_URL;
};

const getLogoUrl = (appUrl) => {
  const envLogo = String(process.env.EMAIL_LOGO_URL || '').trim();
  if (envLogo) return envLogo;
  return appUrl ? joinUrl(appUrl, 'logo.png') : '';
};

const buildEmailEventId = ({ type, authTimeMs, fallbackTime }) => {
  const timeKey = authTimeMs || fallbackTime;
  return `${type}_${timeKey}`;
};

const getEmailEvents = (state) =>
  state && typeof state === 'object' && typeof state.emailEvents === 'object'
    ? state.emailEvents
    : {};

const claimEmailEventInState = async ({ db, stateRef, type, authTimeMs, now }) => {
  const eventId = buildEmailEventId({ type, authTimeMs, fallbackTime: now });
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef);
    const state = snap.exists ? snap.data() : {};
    const events = getEmailEvents(state);
    const existing = events?.[type];

    if (existing?.eventId === eventId && existing?.status !== 'failed') {
      return { claimed: false, eventId, existing };
    }

    const nextEvent = {
      eventId,
      status: 'pending',
      createdAt: now,
      authTimeMs: authTimeMs || null
    };

    tx.set(
      stateRef,
      {
        emailEvents: {
          ...events,
          [type]: nextEvent
        }
      },
      { merge: true }
    );

    return { claimed: true, eventId, event: nextEvent };
  });
};

const buildEventUpdate = (event, status, timestamp) => ({
  eventId: event.eventId,
  status,
  authTimeMs: event.authTimeMs || null,
  createdAt: event.createdAt || timestamp,
  ...(status === 'sent' ? { sentAt: timestamp } : { failedAt: timestamp })
});

const getRateLimitConfig = () => {
  const windowSeconds = Number(
    process.env.AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS ||
      process.env.RATE_LIMIT_WINDOW_SECONDS ||
      '600'
  );
  const maxRequests = Number(
    process.env.AUTH_EMAIL_RATE_LIMIT_MAX || process.env.RATE_LIMIT_MAX || '5'
  );
  return {
    windowMs: Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds * 1000 : 600000,
    maxRequests: Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : 5
  };
};

const cleanupRateLimitStore = (now) => {
  if (RATE_LIMIT_STORE.size <= RATE_LIMIT_STORE_MAX) return;
  for (const [key, entry] of RATE_LIMIT_STORE.entries()) {
    if (!entry || now >= entry.resetAt) {
      RATE_LIMIT_STORE.delete(key);
    }
  }
};

const checkRateLimit = (key, config, now) => {
  const timestamp = now || Date.now();
  const entry = RATE_LIMIT_STORE.get(key);
  if (!entry || timestamp >= entry.resetAt) {
    const next = { count: 1, resetAt: timestamp + config.windowMs };
    RATE_LIMIT_STORE.set(key, next);
    cleanupRateLimitStore(timestamp);
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: next.resetAt };
  }
  entry.count += 1;
  RATE_LIMIT_STORE.set(key, entry);
  cleanupRateLimitStore(timestamp);
  return {
    allowed: entry.count <= config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetAt: entry.resetAt
  };
};

const verifyCaptcha = async ({ token, ip, logger }) => {
  const secret = process.env.CAPTCHA_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'Captcha token required.' };

  const provider = String(process.env.CAPTCHA_PROVIDER || 'hcaptcha').toLowerCase();
  const verifyUrl =
    process.env.CAPTCHA_VERIFY_URL ||
    (provider === 'recaptcha'
      ? 'https://www.google.com/recaptcha/api/siteverify'
      : 'https://hcaptcha.com/siteverify');

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  try {
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const minScore = Number(process.env.CAPTCHA_MIN_SCORE || '0');
    const scoreOk = !Number.isFinite(minScore) || minScore <= 0 || (data?.score ?? 1) >= minScore;
    if (!response.ok || !data?.success || !scoreOk) {
      logger?.warn('Captcha verification rejected.', {
        status: response.status,
        provider,
        score: data?.score ?? null
      });
      return { ok: false, error: 'Captcha verification failed.' };
    }
    return { ok: true };
  } catch (err) {
    logger?.warn('Captcha verification request failed.', {
      error: err instanceof Error ? err.message : String(err)
    });
    return { ok: false, error: 'Captcha verification failed.' };
  }
};

export default async function handler(req, res) {
  const requestId = getRequestId(req);
  const logger = createSafeLogger({ requestId, route: 'auth-email' });
  const allowedOrigins = resolveAllowedOrigins();
  const allowedOrigin = getAllowedOrigin(req, allowedOrigins);
  const origin = req.headers.origin;

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Client-Timezone, X-Client-Locale'
  );
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    if (!allowedOrigin) {
      logger.warn('CORS preflight rejected.', { origin });
      sendError(res, 403, 'Origin not allowed.');
      return;
    }
    res.status(204).end();
    return;
  }

  if (!allowedOrigin) {
    logger.warn('CORS origin rejected.', { origin });
    sendError(res, 403, 'Origin not allowed.');
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendError(res, 405, 'Method not allowed.');
    return;
  }

  const { body, error: bodyError } = parseJsonBody(req);
  if (bodyError) {
    logger.warn('Invalid request body.', { reason: bodyError });
    sendError(res, bodyError === 'Unsupported content type.' ? 415 : 400, 'Invalid request payload.');
    return;
  }

  const validation = validatePayload(body);
  if (!validation.ok) {
    logger.warn('Invalid request payload.', { reason: validation.error });
    sendError(res, 400, 'Invalid request payload.');
    return;
  }

  const clientIp = getClientIp(req) || 'unknown';
  const rateLimitConfig = getRateLimitConfig();
  const rateLimit = checkRateLimit(clientIp, rateLimitConfig, Date.now());
  if (!rateLimit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    logger.warn('Rate limit exceeded.', { ip: clientIp, retryAfter });
    sendError(res, 429, 'Too many requests. Please try again later.');
    return;
  }

  const captchaResult = await verifyCaptcha({
    token: validation.data.captchaToken,
    ip: clientIp,
    logger
  });
  if (!captchaResult.ok) {
    sendError(res, 403, 'Captcha verification failed.');
    return;
  }

  try {
    ensureFirebase();
  } catch (err) {
    logger.error('Firebase initialization failed.', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'Email service unavailable.');
    return;
  }

  const idToken = getBearerToken(req);
  if (!idToken) {
    sendError(res, 401, 'Unauthorized.');
    return;
  }

  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken);
  } catch (err) {
    logger.warn('Token verification failed.', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 401, 'Unauthorized.');
    return;
  }

  const email = decoded.email;
  if (!email) {
    sendError(res, 400, 'Invalid request.');
    return;
  }

  const displayName = decoded.name || email.split('@')[0] || 'there';
  const now = Date.now();
  const cooldownSeconds = Number(process.env.LOGIN_EMAIL_COOLDOWN_SECONDS || '0');
  const loginCooldownMs = Number.isFinite(cooldownSeconds) ? cooldownSeconds * 1000 : 0;
  const authTimeSeconds = toFiniteNumber(decoded.auth_time);
  const authTimeMs = authTimeSeconds === null ? null : authTimeSeconds * 1000;

  try {
    const db = getFirestore();
    const stateRef = db.collection('email_state').doc(decoded.uid);
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? stateSnap.data() : {};

    const { shouldSendWelcome, shouldSendLogin } = computeEmailPlan({
      state,
      now,
      authTimeMs,
      loginCooldownMs
    });

    if (!shouldSendWelcome && !shouldSendLogin) {
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    const appUrl = getAppBaseUrl(req, allowedOrigin);
    const logoUrl = getLogoUrl(appUrl);
    const supportEmail = process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL;
    const privacyUrl = joinUrl(appUrl, 'privacy.html');
    const termsUrl = joinUrl(appUrl, 'terms.html');

    const locale = getClientLocale(req);
    const timeZone = getClientTimeZone(req);
    const timeZoneLabel = timeZone || 'UTC';
    const loginTimestamp = formatTimestamp(authTimeMs || now, locale, timeZone);

    const requestMeta = getRequestMeta(req);
    const metaRows = buildMetaRows({
      timeLabel: `Time (${timeZoneLabel})`,
      timeValue: loginTimestamp,
      device: requestMeta.device,
      browser: requestMeta.browser,
      city: requestMeta.city,
      country: requestMeta.country
    });

    let sentWelcome = false;
    let sentLogin = false;
    let welcomeEvent = null;
    let loginEvent = null;

    try {
      if (shouldSendWelcome) {
        const claim = await claimEmailEventInState({
          db,
          stateRef,
          type: 'welcome',
          authTimeMs,
          now
        });
        if (claim.claimed) {
          welcomeEvent = claim.event;
          try {
            const emailPayload = buildWelcomeEmail({
              appUrl,
              displayName,
              supportEmail,
              privacyUrl,
              termsUrl,
              accountEmail: email,
              logoUrl
            });
            await sendBrevoEmail({
              toEmail: email,
              toName: displayName,
              subject: process.env.WELCOME_EMAIL_SUBJECT || emailPayload.subject,
              textContent: emailPayload.textContent,
              htmlContent: emailPayload.htmlContent
            });
            sentWelcome = true;
            welcomeEvent.sentAt = Date.now();
          } catch (err) {
            const failedAt = Date.now();
            await stateRef.set(
              {
                emailEvents: {
                  welcome: buildEventUpdate(welcomeEvent, 'failed', failedAt)
                }
              },
              { merge: true }
            );
            throw err;
          }
        }
      }

      if (shouldSendLogin) {
        const claim = await claimEmailEventInState({
          db,
          stateRef,
          type: 'login',
          authTimeMs,
          now
        });
        if (claim.claimed) {
          loginEvent = claim.event;
          try {
            const emailPayload = buildLoginEmail({
              appUrl,
              displayName,
              supportEmail,
              privacyUrl,
              termsUrl,
              metaRows,
              accountEmail: email,
              logoUrl
            });
            await sendBrevoEmail({
              toEmail: email,
              toName: displayName,
              subject: process.env.LOGIN_EMAIL_SUBJECT || emailPayload.subject,
              textContent: emailPayload.textContent,
              htmlContent: emailPayload.htmlContent
            });
            sentLogin = true;
            loginEvent.sentAt = Date.now();
          } catch (err) {
            const failedAt = Date.now();
            await stateRef.set(
              {
                emailEvents: {
                  login: buildEventUpdate(loginEvent, 'failed', failedAt)
                }
              },
              { merge: true }
            );
            throw err;
          }
        }
      }
    } catch (err) {
      if (err instanceof EmailProviderError) {
        logger.error('Email provider request failed.', {
          status: err.status,
          details: err.details
        });
      } else {
        logger.error('Failed to send email.', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
      sendError(res, 502, 'Email service unavailable.');
      return;
    }

    if (sentWelcome || sentLogin) {
      const updates = buildEmailStateUpdates({
        email,
        displayName,
        now,
        authTimeMs,
        shouldSendWelcome: sentWelcome,
        shouldSendLogin: sentLogin
      });

      const emailEvents = {};
      if (sentWelcome && welcomeEvent) {
        emailEvents.welcome = buildEventUpdate(
          welcomeEvent,
          'sent',
          welcomeEvent.sentAt || Date.now()
        );
      }
      if (sentLogin && loginEvent) {
        emailEvents.login = buildEventUpdate(
          loginEvent,
          'sent',
          loginEvent.sentAt || Date.now()
        );
      }
      if (Object.keys(emailEvents).length) {
        updates.emailEvents = emailEvents;
      }

      await stateRef.set(updates, { merge: true });
    }

    res.status(200).json({
      ok: true,
      sentWelcome,
      sentLogin
    });
  } catch (err) {
    logger.error('Unhandled auth email error.', {
      error: err instanceof Error ? err.message : String(err)
    });
    sendError(res, 500, 'Email service unavailable.');
  }
}
