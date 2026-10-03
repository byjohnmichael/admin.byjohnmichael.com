// Gate for Bob's chat WebSocket. nginx calls this with `auth_request` before
// proxying /ws to the Bob backend: proxy.ts has already rejected the request
// with 401 if there's no valid admin session, so reaching here means "allow".
// See README → Bob the Orb → nginx.

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 204 });
}

// byjohnmichael*
