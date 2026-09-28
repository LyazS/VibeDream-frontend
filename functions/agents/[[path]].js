/** Preserve the Service Binding's WebSocket Upgrade response for the Agent SDK. */
export async function onRequest(context) {
  if (!context.env.API || typeof context.env.API.fetch !== 'function') {
    return Response.json(
      { error: 'API_NOT_CONFIGURED', message: 'Pages API service binding is not configured' },
      { status: 503 },
    )
  }
  return context.env.API.fetch(context.request)
}
