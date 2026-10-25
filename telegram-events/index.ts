import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Python backend URL (events polling)
// Use 127.0.0.1 to avoid DNS resolution issues
const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010'

// Track the last event timestamp we've seen
let lastEventTimestamp = 0

// Track polling health (for status endpoint)
let lastPollSuccess = 0
let lastPollError = ''
let totalEventsBroadcast = 0
let pollCount = 0
let errorCount = 0

// Polling function: fetch new events from Python backend
async function pollEvents() {
  try {
    const url = `${PYTHON_BACKEND}/api/telegram/events/poll?since=${lastEventTimestamp}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[poll] HTTP ${res.status}`)
      errorCount++
      lastPollError = `HTTP ${res.status}`
      return
    }
    const json = await res.json() as {
      success: boolean
      events?: Array<{ type: string; data: any; timestamp: number }>
      authenticated?: boolean
    }
    pollCount++
    lastPollSuccess = Math.floor(Date.now() / 1000)
    lastPollError = ''

    if (json.success && json.events && json.events.length > 0) {
      for (const event of json.events) {
        // Broadcast each event to all connected clients
        io.emit('telegram:event', event)
        // Also emit type-specific events
        io.emit(`telegram:${event.type}`, event.data)
        if (event.timestamp > lastEventTimestamp) {
          lastEventTimestamp = event.timestamp
        }
        totalEventsBroadcast++
      }
      console.log(`[poll] Broadcast ${json.events.length} events (last_ts=${lastEventTimestamp})`)
    }
  } catch (err) {
    // Silent error — backend may be down or not authenticated yet
    // Don't spam logs, just track state for status endpoint
    errorCount++
    lastPollError = err instanceof Error ? err.message : String(err)
  }
}

// Start polling every 2 seconds
const POLL_INTERVAL_MS = 2000
setInterval(pollEvents, POLL_INTERVAL_MS)
// Also poll immediately on start (after 1s to let things settle)
setTimeout(pollEvents, 1000)

io.on('connection', (socket) => {
  console.log(`[ws] Client connected: ${socket.id} (total: ${io.engine.clientsCount})`)

  // Allow clients to request current status
  socket.on('telegram:status', () => {
    socket.emit('telegram:status', {
      connected: true,
      lastEventTimestamp,
      lastPollSuccess,
      lastPollError,
      pollCount,
      errorCount,
      totalEventsBroadcast,
      clients: io.engine.clientsCount,
    })
  })

  // Allow clients to reset their "since" pointer (e.g. when switching chats)
  // Note: we don't change the global pointer, just acknowledge
  socket.on('telegram:reset', (_data: { since?: number }) => {
    socket.emit('telegram:reset-ack', { ok: true })
  })

  socket.on('disconnect', () => {
    console.log(`[ws] Client disconnected: ${socket.id} (total: ${io.engine.clientsCount})`)
  })

  socket.on('error', (error) => {
    console.error(`[ws] Socket error (${socket.id}):`, error)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[telegram-events] WebSocket server running on port ${PORT}`)
  console.log(`[telegram-events] Polling Python backend at ${PYTHON_BACKEND}/api/telegram/events/poll every ${POLL_INTERVAL_MS}ms`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[telegram-events] SIGTERM received, shutting down...')
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('[telegram-events] SIGINT received, shutting down...')
  httpServer.close(() => process.exit(0))
})
