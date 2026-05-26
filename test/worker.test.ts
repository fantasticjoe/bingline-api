import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCandidateImageUrls,
  fetchBingMetadata,
  getQueryParams,
  normalizeBingImage,
  resolveImageUrl,
  default as worker,
} from '../src/index';

const metadata = {
  images: [
    {
      startdate: '20260526',
      fullstartdate: '202605260700',
      enddate: '20260527',
      url: '/th?id=OHR.TestImage.jpg',
      urlbase: '/th?id=OHR.TestImage',
      copyright: 'Test copyright',
      copyrightlink: '/search?q=test',
      title: 'Test title',
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('query params', () => {
  it('applies the default values', () => {
    const params = getQueryParams(new Request('https://wall.0a.ink/latest'));

    expect(params).toEqual({
      mkt: 'en-US',
      idx: 0,
      n: 1,
      res: 'UHD',
      mode: 'redirect',
      format: 'text',
    });
  });

  it('sanitizes and clamps values', () => {
    const params = getQueryParams(
      new Request('https://wall.0a.ink/raw?mkt=zh-CN&idx=2&n=80&res=1920x1080'),
    );

    expect(params).toMatchObject({
      mkt: 'zh-CN',
      idx: 2,
      n: 8,
      res: '1920x1080',
    });
  });
});

describe('candidate urls', () => {
  it('builds fallback candidates without duplicates', () => {
    expect(buildCandidateImageUrls(metadata.images[0], 'UHD')).toEqual([
      'https://www.bing.com/th?id=OHR.TestImage_UHD.jpg',
      'https://www.bing.com/th?id=OHR.TestImage_1920x1080.jpg',
      'https://www.bing.com/th?id=OHR.TestImage.jpg',
    ]);
  });
});

describe('metadata helpers', () => {
  it('fetches and parses bing metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('HPImageArchive.aspx')) {
          return new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response('not found', { status: 404 });
      }),
    );

    const result = await fetchBingMetadata({ mkt: 'en-US', idx: 0, n: 1 });

    expect(result.data.images[0].title).toBe('Test title');
    expect(result.rawText).toContain('Test title');
  });

  it('resolves the first available image url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (method === 'HEAD' && url.endsWith('_UHD.jpg')) {
          return new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'HEAD' && url.endsWith('_1920x1080.jpg')) {
          return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'GET' && url.endsWith('_1920x1080.jpg')) {
          return new Response('img', { status: 206, headers: { 'content-type': 'image/jpeg' } });
        }

        return new Response('', { status: 404 });
      }),
    );

    const resolved = await resolveImageUrl(metadata.images[0], 'UHD');

    expect(resolved.url).toBe('https://www.bing.com/th?id=OHR.TestImage_1920x1080.jpg');
    expect(resolved.resolution).toBe('1920x1080');
  });

  it('normalizes metadata into the public shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('HPImageArchive.aspx')) {
          return new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (method === 'HEAD' && url.endsWith('_UHD.jpg')) {
          return new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'HEAD' && url.endsWith('_1920x1080.jpg')) {
          return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
        }

        return new Response('', { status: 404 });
      }),
    );

    const metadataResult = await fetchBingMetadata({ mkt: 'en-US', idx: 0, n: 1 });
    const normalized = await normalizeBingImage(metadataResult.data.images[0], {
      requestUrl: 'https://wall.0a.ink/api/latest?mkt=en-US&idx=0&res=UHD',
      mkt: 'en-US',
      idx: 0,
      res: 'UHD',
    });

    expect(normalized).toMatchObject({
      date: '20260526',
      endDate: '20260527',
      market: 'en-US',
      title: 'Test title',
      copyright: 'Test copyright',
      copyrightLink: 'https://www.bing.com/search?q=test',
      image: 'https://wall.0a.ink/latest?mkt=en-US&idx=0&res=UHD',
      bingImageUrl: 'https://www.bing.com/th?id=OHR.TestImage_1920x1080.jpg',
      resolution: '1920x1080',
      source: 'Bing',
      sourceEndpoint: 'HPImageArchive.aspx',
    });
  });
});

describe('worker routes', () => {
  it('returns a plain text landing response', async () => {
    const response = await worker.fetch(new Request('https://wall.0a.ink/'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('Bingline API');
    expect(body).toContain('GET /latest');
  });

  it('redirects latest image requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('HPImageArchive.aspx')) {
          return new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (method === 'HEAD' && url.endsWith('_UHD.jpg')) {
          return new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'HEAD' && url.endsWith('_1920x1080.jpg')) {
          return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
        }

        return new Response('', { status: 404 });
      }),
    );

    const response = await worker.fetch(new Request('https://wall.0a.ink/latest'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://www.bing.com/th?id=OHR.TestImage_1920x1080.jpg',
    );
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('proxies latest image requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('HPImageArchive.aspx')) {
          return new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (method === 'HEAD' && url.endsWith('_UHD.jpg')) {
          return new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'HEAD' && url.endsWith('_1920x1080.jpg')) {
          return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'GET' && url.endsWith('_1920x1080.jpg')) {
          return new Response('binary-image', {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          });
        }

        return new Response('', { status: 404 });
      }),
    );

    const response = await worker.fetch(
      new Request('https://wall.0a.ink/latest?mode=proxy&mkt=en-US'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(await response.text()).toBe('binary-image');
  });

  it('returns normalized api latest json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('HPImageArchive.aspx')) {
          return new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (method === 'HEAD' && url.endsWith('_UHD.jpg')) {
          return new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'HEAD' && url.endsWith('_1920x1080.jpg')) {
          return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
        }

        return new Response('', { status: 404 });
      }),
    );

    const response = await worker.fetch(new Request('https://wall.0a.ink/api/latest'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(body).toMatchObject({
      market: 'en-US',
      title: 'Test title',
      image: 'https://wall.0a.ink/latest?mkt=en-US&idx=0&res=UHD',
      bingImageUrl: 'https://www.bing.com/th?id=OHR.TestImage_1920x1080.jpg',
      resolution: '1920x1080',
    });
  });

  it('returns url text and json formats', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('HPImageArchive.aspx')) {
          return new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (method === 'HEAD' && url.endsWith('_UHD.jpg')) {
          return new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } });
        }

        if (method === 'HEAD' && url.endsWith('_1920x1080.jpg')) {
          return new Response('', { status: 200, headers: { 'content-type': 'image/jpeg' } });
        }

        return new Response('', { status: 404 });
      }),
    );

    const textResponse = await worker.fetch(new Request('https://wall.0a.ink/url'));
    const jsonResponse = await worker.fetch(new Request('https://wall.0a.ink/url?format=json'));

    expect(await textResponse.text()).toBe('https://www.bing.com/th?id=OHR.TestImage_1920x1080.jpg');
    expect(await jsonResponse.json()).toEqual({
      url: 'https://www.bing.com/th?id=OHR.TestImage_1920x1080.jpg',
    });
  });

  it('returns raw bing json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes('HPImageArchive.aspx')) {
          return new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response('', { status: 404 });
      }),
    );

    const response = await worker.fetch(new Request('https://wall.0a.ink/raw?n=8'));

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await response.json()).toEqual(metadata);
  });

  it('rejects unsupported modes', async () => {
    const response = await worker.fetch(new Request('https://wall.0a.ink/latest?mode=bad'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Unsupported mode: bad', status: 400 });
  });

  it('serves preflight requests', async () => {
    const response = await worker.fetch(
      new Request('https://wall.0a.ink/api/latest', { method: 'OPTIONS' }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('returns a plain text 404 for unknown routes', async () => {
    const response = await worker.fetch(new Request('https://wall.0a.ink/unknown'));

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });
});
