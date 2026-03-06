import { Capacitor } from '@capacitor/core';
import { Device, type DeviceInfo } from '@capacitor/device';

type ClientHintBrand = {
  brand?: string;
  version?: string;
};

type HighEntropyValues = {
  brands?: ClientHintBrand[];
  fullVersionList?: ClientHintBrand[];
  mobile?: boolean;
  model?: string;
  platform?: string;
  platformVersion?: string;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    brands?: ClientHintBrand[];
    mobile?: boolean;
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<HighEntropyValues>;
  };
};

export type ClientDeviceMetadata = {
  browser: string | null;
  deviceManufacturer: string | null;
  deviceModel: string | null;
  deviceType: string | null;
  label: string | null;
  os: string | null;
};

const IS_NATIVE = Capacitor.isNativePlatform();
const TABLET_MIN_SHORT_SIDE = 768;
const MAX_METADATA_LENGTH = 120;

let clientDeviceMetadataPromise: Promise<ClientDeviceMetadata> | null = null;

const normalizeText = (value?: string | null) => {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_METADATA_LENGTH);
};

const normalizeOsName = (value?: string | null) => {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'ios' || normalized === 'ipados' || normalized === 'ipad os') return 'iOS';
  if (normalized === 'android') return 'Android';
  if (normalized === 'windows') return 'Windows';
  if (normalized === 'mac' || normalized === 'macos' || normalized === 'mac os') return 'macOS';
  if (normalized === 'linux') return 'Linux';
  if (normalized === 'chrome os' || normalized === 'chromeos' || normalized === 'cros') {
    return 'ChromeOS';
  }
  return normalizeText(value);
};

const normalizeBrowserName = (value?: string | null) => {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('edge')) return 'Edge';
  if (normalized.includes('samsung internet')) return 'Samsung Internet';
  if (normalized.includes('opera')) return 'Opera';
  if (normalized.includes('firefox')) return 'Firefox';
  if (normalized.includes('chrome')) return 'Chrome';
  if (normalized.includes('safari')) return 'Safari';
  if (normalized.includes('webview')) return 'WebView';
  return normalizeText(value);
};

const normalizeDeviceType = (value?: string | null) => {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'mobile' || normalized === 'phone') return 'Mobile';
  if (normalized === 'tablet') return 'Tablet';
  if (normalized === 'desktop' || normalized === 'laptop' || normalized === 'computer') {
    return 'Desktop';
  }
  if (normalized === 'tv' || normalized === 'smarttv' || normalized === 'smart tv') return 'TV';
  if (normalized === 'wearable' || normalized === 'watch') return 'Wearable';
  if (normalized === 'console') return 'Console';
  if (normalized === 'xr' || normalized === 'vr' || normalized === 'ar') return 'XR';
  return normalizeText(value);
};

const normalizeDeviceModel = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/^(unknown|generic|device|null|undefined)$/i.test(normalized)) return null;
  return normalized;
};

const normalizeManufacturer = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/^(unknown|null|undefined)$/i.test(normalized)) return null;
  return normalized;
};

const getViewportShortestSide = () => {
  const screenValues = [
    globalThis.screen?.width,
    globalThis.screen?.height,
    globalThis.innerWidth,
    globalThis.innerHeight
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  if (!screenValues.length) return 0;
  return Math.min(...screenValues);
};

const isIpadLikeDevice = (userAgent: string, touchPoints: number) =>
  /ipad/i.test(userAgent) || (/macintosh/i.test(userAgent) && touchPoints > 1);

const inferOsFromUserAgent = (userAgent: string, touchPoints: number) => {
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipod/i.test(userAgent)) return 'iOS';
  if (isIpadLikeDevice(userAgent, touchPoints)) return 'iOS';
  if (/cros/i.test(userAgent)) return 'ChromeOS';
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return null;
};

const inferBrowserFromBrands = (brands?: ClientHintBrand[]) => {
  if (!brands?.length) return null;
  const normalizedBrands = brands
    .map((entry) => normalizeText(entry.brand))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry) => !/^not.*brand$/i.test(entry));

  for (const brand of normalizedBrands) {
    if (/microsoft edge/i.test(brand)) return 'Edge';
    if (/samsung internet/i.test(brand)) return 'Samsung Internet';
    if (/opera/i.test(brand)) return 'Opera';
    if (/google chrome/i.test(brand)) return 'Chrome';
    if (/firefox/i.test(brand)) return 'Firefox';
    if (/safari/i.test(brand)) return 'Safari';
    if (/chromium/i.test(brand)) return 'Chrome';
  }

  return null;
};

const inferBrowserFromUserAgent = (userAgent: string) => {
  if (/edga|edgios|edg\//i.test(userAgent)) return 'Edge';
  if (/samsungbrowser/i.test(userAgent)) return 'Samsung Internet';
  if (/opr\/|opera/i.test(userAgent)) return 'Opera';
  if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
  if (/crios|chrome/i.test(userAgent) && !/edga|edgios|edg\/|opr\/|opera/i.test(userAgent)) {
    return 'Chrome';
  }
  if (/safari/i.test(userAgent) && !/chrome|crios|android/i.test(userAgent)) return 'Safari';
  if (/wv/i.test(userAgent)) return 'WebView';
  return null;
};

const inferDeviceType = ({
  mobileHint,
  os,
  touchPoints,
  userAgent
}: {
  mobileHint?: boolean;
  os: string | null;
  touchPoints: number;
  userAgent: string;
}) => {
  if (/smart-tv|smarttv|googletv|appletv|hbbtv/i.test(userAgent)) return 'TV';
  if (/watch/i.test(userAgent)) return 'Wearable';
  if (isIpadLikeDevice(userAgent, touchPoints) || /tablet|playbook|silk/i.test(userAgent)) {
    return 'Tablet';
  }
  if (/iphone|ipod|mobile|phone/i.test(userAgent) || mobileHint === true) return 'Mobile';

  const shortestSide = getViewportShortestSide();
  if (os === 'Android' || os === 'iOS') {
    if (shortestSide >= TABLET_MIN_SHORT_SIDE) return 'Tablet';
    return 'Mobile';
  }

  return 'Desktop';
};

const extractAndroidModel = (userAgent: string) => {
  const match = userAgent.match(/Android[^;)]*;\s*([^;)]+?)(?:\sBuild\/[^;)]*)?(?:;|\))/i);
  if (!match) return null;
  const model = normalizeDeviceModel(match[1]);
  if (!model || /^(mobile|tablet)$/i.test(model)) return null;
  return model;
};

const formatModelName = (manufacturer?: string | null, model?: string | null) => {
  const normalizedManufacturer = normalizeManufacturer(manufacturer);
  const normalizedModel = normalizeDeviceModel(model);
  if (normalizedManufacturer && normalizedModel) {
    if (normalizedModel.toLowerCase().startsWith(normalizedManufacturer.toLowerCase())) {
      return normalizedModel;
    }
    if (normalizedManufacturer.toLowerCase() === 'apple') return normalizedModel;
    return `${normalizedManufacturer} ${normalizedModel}`;
  }
  return normalizedModel ?? null;
};

const formatDeviceLabel = ({
  browser,
  deviceManufacturer,
  deviceModel,
  deviceType,
  os
}: Omit<ClientDeviceMetadata, 'label'>) => {
  const modelName = formatModelName(deviceManufacturer, deviceModel);
  const suffix = [os, deviceType].filter(Boolean).join(' ');
  if (modelName && suffix) return `${modelName} (${suffix})`;
  if (modelName) return modelName;
  if (suffix) return suffix;
  return browser ?? null;
};

const getUserAgentData = async () => {
  const nav = navigator as NavigatorWithUserAgentData;
  const uaData = nav.userAgentData;
  if (!uaData) return null;

  const base: HighEntropyValues = {
    brands: uaData.brands,
    mobile: uaData.mobile,
    platform: uaData.platform
  };

  if (!uaData.getHighEntropyValues) return base;

  try {
    const values = await uaData.getHighEntropyValues([
      'fullVersionList',
      'mobile',
      'model',
      'platform',
      'platformVersion'
    ]);
    return { ...base, ...values };
  } catch {
    return base;
  }
};

const getNativeDeviceInfo = async () => {
  if (!IS_NATIVE) return null;
  try {
    return await Device.getInfo();
  } catch {
    return null;
  }
};

const resolveOs = ({
  nativeInfo,
  touchPoints,
  userAgent,
  userAgentData
}: {
  nativeInfo: DeviceInfo | null;
  touchPoints: number;
  userAgent: string;
  userAgentData: HighEntropyValues | null;
}) =>
  normalizeOsName(nativeInfo?.operatingSystem) ??
  normalizeOsName(userAgentData?.platform) ??
  inferOsFromUserAgent(userAgent, touchPoints);

const resolveBrowser = ({
  userAgent,
  userAgentData
}: {
  userAgent: string;
  userAgentData: HighEntropyValues | null;
}) =>
  normalizeBrowserName(
    inferBrowserFromBrands(userAgentData?.fullVersionList || userAgentData?.brands) ??
      inferBrowserFromUserAgent(userAgent)
  );

const resolveDeviceModel = ({
  nativeInfo,
  touchPoints,
  userAgent,
  userAgentData
}: {
  nativeInfo: DeviceInfo | null;
  touchPoints: number;
  userAgent: string;
  userAgentData: HighEntropyValues | null;
}) => {
  const nativeModel = normalizeDeviceModel(nativeInfo?.model);
  if (nativeModel) return nativeModel;

  const hintedModel = normalizeDeviceModel(userAgentData?.model);
  if (hintedModel) return hintedModel;

  if (/android/i.test(userAgent)) {
    const androidModel = extractAndroidModel(userAgent);
    if (androidModel) return androidModel;
  }

  if (/iphone|ipod/i.test(userAgent)) return 'iPhone';
  if (isIpadLikeDevice(userAgent, touchPoints)) return 'iPad';
  return null;
};

const resolveDeviceManufacturer = (nativeInfo: DeviceInfo | null) =>
  normalizeManufacturer(nativeInfo?.manufacturer);

const collectClientDeviceMetadata = async (): Promise<ClientDeviceMetadata> => {
  const userAgent = navigator.userAgent || '';
  const touchPoints = navigator.maxTouchPoints || 0;
  const [nativeInfo, userAgentData] = await Promise.all([getNativeDeviceInfo(), getUserAgentData()]);

  const os = resolveOs({ nativeInfo, touchPoints, userAgent, userAgentData });
  const browser = resolveBrowser({ userAgent, userAgentData });
  const deviceManufacturer = resolveDeviceManufacturer(nativeInfo);
  const deviceModel = resolveDeviceModel({ nativeInfo, touchPoints, userAgent, userAgentData });
  const deviceType = normalizeDeviceType(
    inferDeviceType({
      mobileHint: userAgentData?.mobile,
      os,
      touchPoints,
      userAgent
    })
  );

  return {
    browser,
    deviceManufacturer,
    deviceModel,
    deviceType,
    label: formatDeviceLabel({ browser, deviceManufacturer, deviceModel, deviceType, os }),
    os
  };
};

export const getClientDeviceMetadata = () => {
  if (!clientDeviceMetadataPromise) {
    clientDeviceMetadataPromise = collectClientDeviceMetadata();
  }
  return clientDeviceMetadataPromise;
};

export const getClientDeviceHeaders = async () => {
  const metadata = await getClientDeviceMetadata();
  const headers: Record<string, string> = {};

  if (metadata.browser) headers['X-Client-Browser'] = metadata.browser;
  if (metadata.deviceManufacturer) {
    headers['X-Client-Device-Manufacturer'] = metadata.deviceManufacturer;
  }
  if (metadata.deviceModel) headers['X-Client-Device-Model'] = metadata.deviceModel;
  if (metadata.deviceType) headers['X-Client-Device-Type'] = metadata.deviceType;
  if (metadata.os) headers['X-Client-OS'] = metadata.os;

  return headers;
};
