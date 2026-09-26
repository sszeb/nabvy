import { RPCHandler } from '@orpc/server/fetch'
import { router } from '@/rpc/router'

export const runtime = 'nodejs' // node-postgres needs Node, not the edge runtime

const handler = new RPCHandler(router)

async function handle(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: { headers: request.headers },
  })
  return response ?? new Response('Not found', { status: 404 })
}

export const GET = handle
export const POST = handle
