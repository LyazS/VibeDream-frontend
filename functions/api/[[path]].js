/**
 * Same-origin Pages Functions entry point for phase 1.2.
 * Configure a Pages Service Binding named API that points to the matching
 * lightcut-api Worker in preview and production. The browser never calls the
 * Worker workers.dev hostname directly, so the Better Auth cookie remains
 * same-origin on pages.dev.
 */
export async function onRequest(context) {
  if (!context.env.API || typeof context.env.API.fetch !== 'function') {
    return Response.json(
      { error: 'API_NOT_CONFIGURED', message: 'Pages API service binding is not configured' },
      { status: 503 },
    )
  }
  return context.env.API.fetch(context.request)
}
