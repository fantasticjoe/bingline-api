const BING_ORIGIN = 'https://www.bing.com';
const SOURCE_ENDPOINT = 'HPImageArchive.aspx';
const MAX_RAW_COUNT = 8;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type ImageMode = 'redirect' | 'proxy';
export type QueryParams = {
  mkt: string;
  idx: number;
  n: number;
  res: string;
  mode: string;
  format: string;
};

export type BingImage = {
  startdate?: string;
  fullstartdate?: string;
  enddate?: string;
  url?: string;
  urlbase?: string;
  copyright?: string;
  copyrightlink?: string;
  title?: string;
};

export type BingMetadata = {
  images?: BingImage[];
  [key: string]: unknown;
};

export type FetchBingMetadataInput = {
  mkt: string;
  idx: number;
  n: number;
};

export type FetchBingMetadataResult = {
  data: BingMetadata;
  rawText: string;
};

export type ResolvedImage = {
  url: string;
  resolution: string;
};

type NormalizeContext = {
  requestUrl: string;
  mkt: string;
  idx: number;
  res: string;
};

type NormalizedBingImage = {
  date: string;
  endDate: string;
  market: string;
  title: string;
  copyright: string;
  copyrightLink: string;
  image: string;
  bingImageUrl: string;
  resolution: string;
  source: 'Bing';
  sourceEndpoint: typeof SOURCE_ENDPOINT;
};

type ErrorPayload = {
  error: string;
  status: number;
};

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function getQueryParams(request: Request): QueryParams {
  const url = new URL(request.url);

  return {
    mkt: sanitizeMarket(url.searchParams.get('mkt')),
    idx: sanitizeNonNegativeInteger(url.searchParams.get('idx'), 0),
    n: Math.min(sanitizePositiveInteger(url.searchParams.get('n'), 1), MAX_RAW_COUNT),
    res: sanitizeResolution(url.searchParams.get('res')),
    mode: sanitizeToken(url.searchParams.get('mode'), 'redirect'),
    format: sanitizeToken(url.searchParams.get('format'), 'text'),
  };
}

export async function fetchBingMetadata({
  mkt,
  idx,
  n,
}: FetchBingMetadataInput): Promise<FetchBingMetadataResult> {
  const endpoint = new URL(`${BING_ORIGIN}/${SOURCE_ENDPOINT}`);
  endpoint.searchParams.set('format', 'js');
  endpoint.searchParams.set('idx', String(idx));
  endpoint.searchParams.set('n', String(n));
  endpoint.searchParams.set('mkt', mkt);

  let response: Response;

  try {
    response = await fetch(endpoint.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });
  } catch (error) {
    throw new HttpError(`Failed to fetch Bing metadata: ${messageFromUnknown(error)}`, 502);
  }

  if (!response.ok) {
    throw new HttpError(`Bing metadata fetch failed with status ${response.status}`, 502);
  }

  const rawText = await response.text();

  try {
    const data = JSON.parse(rawText) as BingMetadata;
    return { data, rawText };
  } catch {
    throw new HttpError('Failed to parse Bing metadata JSON', 502);
  }
}

export function buildCandidateImageUrls(img: BingImage, res: string): string[] {
  const candidates: string[] = [];
  const urlbase = normalizeBingPath(img.urlbase);
  const originalUrl = normalizeBingPath(img.url);
  const requestedResolution = sanitizeResolution(res);

  if (urlbase) {
    if (requestedResolution.toUpperCase() === 'UHD') {
      candidates.push(toBingAbsoluteUrl(`${urlbase}_UHD.jpg`));
    } else {
      candidates.push(toBingAbsoluteUrl(`${urlbase}_${requestedResolution}.jpg`));
    }

    candidates.push(toBingAbsoluteUrl(`${urlbase}_1920x1080.jpg`));
  }

  if (originalUrl) {
    candidates.push(toBingAbsoluteUrl(originalUrl));
  }

  return unique(candidates);
}

export async function imageExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });

    if (isImageResponse(response)) {
      return true;
    }

    if (response.status !== 405 && response.status !== 501) {
      return false;
    }
  } catch {
    // Fall through to a ranged GET when HEAD fails.
  }

  try {
    const response = await fetch(url, {
      headers: {
        Range: 'bytes=0-0',
      },
    });

    return isImageResponse(response);
  } catch {
    return false;
  }
}

export async function resolveImageUrl(img: BingImage, res: string): Promise<ResolvedImage> {
  const candidates = buildCandidateImageUrls(img, res);

  for (const candidate of candidates) {
    if (await imageExists(candidate)) {
      return {
        url: candidate,
        resolution: inferResolution(candidate, img),
      };
    }
  }

  throw new HttpError('No usable Bing image URL found', 502);
}

export async function normalizeBingImage(
  img: BingImage,
  context: NormalizeContext,
): Promise<NormalizedBingImage> {
  const resolved = await resolveImageUrl(img, context.res);
  const requestUrl = new URL(context.requestUrl);
  const imageUrl = new URL('/latest', requestUrl.origin);

  imageUrl.searchParams.set('mkt', context.mkt);
  imageUrl.searchParams.set('idx', String(context.idx));
  imageUrl.searchParams.set('res', context.res);

  return {
    date: img.startdate ?? '',
    endDate: img.enddate ?? '',
    market: context.mkt,
    title: img.title ?? '',
    copyright: img.copyright ?? '',
    copyrightLink: toBingAbsoluteUrl(img.copyrightlink ?? ''),
    image: imageUrl.toString(),
    bingImageUrl: resolved.url,
    resolution: resolved.resolution,
    source: 'Bing',
    sourceEndpoint: SOURCE_ENDPOINT,
  };
}

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const mergedHeaders = mergeHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
    ...headers,
  });

  return new Response(JSON.stringify(data), {
    status,
    headers: mergedHeaders,
  });
}

export function textResponse(
  text: string,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const mergedHeaders = mergeHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    ...CORS_HEADERS,
    ...headers,
  });

  return new Response(text, {
    status,
    headers: mergedHeaders,
  });
}

export function errorResponse(message: string, status: number): Response {
  const payload: ErrorPayload = {
    error: message,
    status,
  };

  return jsonResponse(payload, status, {
    'Cache-Control': 'no-store',
  });
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const params = getQueryParams(request);

  try {
    switch (url.pathname) {
      case '/':
        return textResponse(landingText(), 200, {
          'Cache-Control': 'public, max-age=3600',
        });
      case '/latest':
        return await handleLatest(params);
      case '/api/latest':
        return await handleApiLatest(request, params);
      case '/url':
        return await handleUrl(params);
      case '/raw':
        return await handleRaw(params);
      default:
        return textResponse('Not found', 404, {
          'Cache-Control': 'no-store',
        });
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error.message, error.status);
    }

    return errorResponse(messageFromUnknown(error), 500);
  }
}

async function handleLatest(params: QueryParams): Promise<Response> {
  if (!isImageMode(params.mode)) {
    return errorResponse(`Unsupported mode: ${params.mode}`, 400);
  }

  const img = await getFirstBingImage(params);
  const resolved = await resolveImageUrl(img, params.res);

  if (params.mode === 'redirect') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: resolved.url,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  return proxyImage(resolved.url);
}

async function handleApiLatest(request: Request, params: QueryParams): Promise<Response> {
  const img = await getFirstBingImage(params);
  const normalized = await normalizeBingImage(img, {
    requestUrl: request.url,
    mkt: params.mkt,
    idx: params.idx,
    res: params.res,
  });

  return jsonResponse(normalized, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
}

async function handleUrl(params: QueryParams): Promise<Response> {
  const img = await getFirstBingImage(params);
  const resolved = await resolveImageUrl(img, params.res);

  if (params.format === 'json') {
    return jsonResponse(
      {
        url: resolved.url,
      },
      200,
      {
        'Cache-Control': 'public, max-age=3600',
      },
    );
  }

  return textResponse(resolved.url, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
}

async function handleRaw(params: QueryParams): Promise<Response> {
  const result = await fetchBingMetadata({
    mkt: params.mkt,
    idx: params.idx,
    n: params.n,
  });

  return new Response(result.rawText, {
    status: 200,
    headers: mergeHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    }),
  });
}

async function getFirstBingImage(params: QueryParams): Promise<BingImage> {
  const result = await fetchBingMetadata({
    mkt: params.mkt,
    idx: params.idx,
    n: 1,
  });
  const img = result.data.images?.[0];

  if (!img) {
    throw new HttpError('Bing metadata did not include images[0]', 404);
  }

  return img;
}

async function proxyImage(url: string): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new HttpError(`Failed to fetch Bing image: ${messageFromUnknown(error)}`, 502);
  }

  if (!response.ok) {
    throw new HttpError(`Bing image fetch failed with status ${response.status}`, 502);
  }

  const headers = new Headers(response.headers);
  headers.set('Content-Type', response.headers.get('content-type') ?? 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=86400');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function landingText(): string {
  return `Bingline API
A lightweight Bing wallpaper redirect and metadata API.

Available endpoints:
GET /latest
GET /api/latest
GET /url
GET /raw
`;
}

function sanitizeMarket(value: string | null): string {
  const market = sanitizeToken(value, 'en-US');
  return market || 'en-US';
}

function sanitizeResolution(value: string | null): string;
function sanitizeResolution(value: string): string;
function sanitizeResolution(value: string | null): string {
  const resolution = sanitizeToken(value, 'UHD');
  return resolution || 'UHD';
}

function sanitizeToken(value: string | null, fallback: string): string {
  const trimmed = value?.trim() ?? '';

  if (!trimmed) {
    return fallback;
  }

  const sanitized = trimmed.replace(/[^A-Za-z0-9_.-]/g, '');
  return sanitized || fallback;
}

function sanitizeNonNegativeInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function sanitizePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeBingPath(path: string | undefined): string {
  if (!path) {
    return '';
  }

  const trimmed = path.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith(BING_ORIGIN)) {
    return trimmed.slice(BING_ORIGIN.length);
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function toBingAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) {
    return '';
  }

  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }

  return `${BING_ORIGIN}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function isImageResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return response.ok && contentType.toLowerCase().startsWith('image/');
}

function inferResolution(url: string, img: BingImage): string {
  const normalizedOriginal = img.url ? toBingAbsoluteUrl(normalizeBingPath(img.url)) : '';

  if (normalizedOriginal && url === normalizedOriginal) {
    return 'original';
  }

  const match = /_([A-Za-z0-9]+x[A-Za-z0-9]+|UHD)\.jpg(?:$|[?&])/i.exec(url);

  if (!match?.[1]) {
    return 'original';
  }

  return match[1].toUpperCase() === 'UHD' ? 'UHD' : match[1];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isImageMode(mode: string): mode is ImageMode {
  return mode === 'redirect' || mode === 'proxy';
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function mergeHeaders(headers: HeadersInit): Headers {
  return new Headers(headers);
}

export default {
  fetch: handleRequest,
};
