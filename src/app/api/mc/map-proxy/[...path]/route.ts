import { NextResponse } from "next/server";

// This proxies BlueMap's own live map through the admin app so it can be
// embedded in an iframe *on the admin site only*. The public map at
// mc.byjohnmichael.com is served directly by BlueMap's webserver and is
// untouched by this route - we only inject our click-to-add-point script
// (public/bluemap-draw-tool.js) into the copy of index.html we hand back
// here, behind this app's normal session-cookie auth gate (see src/proxy.ts).
const BLUEMAP_ORIGIN = process.env.BLUEMAP_ORIGIN ?? "http://127.0.0.1:8100";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const segments = path ?? [];

  if (segments.some((s) => s === ".." || s.includes("\0"))) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }

  const rel = segments.join("/");
  const isIndex = rel === "" || rel === "index.html";
  const upstreamPath = isIndex ? "/index.html" : `/${rel}`;
  const search = new URL(request.url).search;

  let upstream: Response;
  try {
    upstream = await fetch(`${BLUEMAP_ORIGIN}${upstreamPath}${search}`);
  } catch (err) {
    return NextResponse.json(
      { error: `Couldn't reach BlueMap: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (isIndex) {
    const html = await upstream.text();
    const injected = html.replace(
      "</body>",
      '<script src="/bluemap-draw-tool.js"></script></body>',
    );
    return new NextResponse(injected, {
      status: upstream.status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Passed through as a stream (not buffered) so BlueMap's SSE live-update
  // connection doesn't hang the request. Content-Encoding/Content-Length are
  // deliberately not copied - fetch() transparently decodes gzip bodies, so
  // forwarding the original Content-Encoding header here would claim the
  // (now-decoded) body is still gzipped and corrupt it in the browser.
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}

// byjohnmichael*
