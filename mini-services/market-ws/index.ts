import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ==================== MOCK MARKET DATA ====================

interface StockTicker {
  ticker: string;
  name_ar: string;
  current_price: number;
  previous_price: number;
  price_change: number;
  volume: number;
}

const INITIAL_STOCKS: StockTicker[] = [
  { ticker: 'COMI', name_ar: 'البنك التجاري الدولي', current_price: 87.50, previous_price: 86.20, price_change: 1.51, volume: 2450000 },
  { ticker: 'ORAS', name_ar: 'أوراسكوم للإنشاءات', current_price: 42.30, previous_price: 43.10, price_change: -1.86, volume: 1830000 },
  { ticker: 'TALA', name_ar: 'مجموعة طلعت مصطفى', current_price: 18.75, previous_price: 18.20, price_change: 3.02, volume: 3120000 },
  { ticker: 'SWDY', name_ar: 'الشركة المصرية للتعمير', current_price: 15.80, previous_price: 15.10, price_change: 4.64, volume: 4200000 },
  { ticker: 'ALDU', name_ar: 'الإسكندرية للحاويات', current_price: 45.60, previous_price: 46.20, price_change: -1.30, volume: 980000 },
];

const stocks = new Map<string, StockTicker>();
INITIAL_STOCKS.forEach((s) => stocks.set(s.ticker, { ...s }));

// Threshold for stock alerts (5% change)
const ALERT_THRESHOLD = 5;

// Generate realistic price movements
function updateStockPrices() {
  const updates: StockTicker[] = [];

  for (const [ticker, stock] of stocks) {
    // Random price change: -2% to +2% with small probability of larger moves
    const changePercent = (Math.random() - 0.48) * 2.5;
    const newPrice = Number((stock.current_price * (1 + changePercent / 100)).toFixed(2));
    const priceChange = Number(((newPrice - stock.previous_price) / stock.previous_price * 100).toFixed(2));
    const volumeDelta = Math.floor(Math.random() * 50000) - 10000;

    stock.previous_price = stock.current_price;
    stock.current_price = newPrice;
    stock.price_change = priceChange;
    stock.volume = Math.max(0, stock.volume + volumeDelta);

    updates.push({ ...stock });

    // Check if price crosses alert threshold
    if (Math.abs(priceChange) >= ALERT_THRESHOLD) {
      const alertData = {
        ticker: stock.ticker,
        name_ar: stock.name_ar,
        price: stock.current_price,
        change: priceChange,
        direction: priceChange > 0 ? 'up' : 'down',
        timestamp: new Date().toISOString(),
      };

      // Emit to all connected clients
      io.emit('stock:alert', alertData);
      console.log(`[ALERT] ${stock.ticker} crossed threshold: ${priceChange.toFixed(2)}%`);
    }
  }

  return updates;
}

// Get market overview snapshot
function getMarketOverview() {
  const stockList = Array.from(stocks.values());
  const gainers = stockList.filter((s) => s.price_change > 0).length;
  const losers = stockList.filter((s) => s.price_change < 0).length;
  const unchanged = stockList.length - gainers - losers;

  // Determine if market is open (9:30 AM - 2:00 PM Cairo time, Sun-Thu)
  const now = new Date();
  const cairoHour = (now.getUTCHours() + 2) % 24;
  const dayOfWeek = now.getUTCDay();
  const isWeekday = dayOfWeek >= 0 && dayOfWeek <= 4;
  const isOpen = isWeekday && cairoHour >= 9 && cairoHour < 14;

  return {
    status: isOpen ? 'open' : 'closed',
    is_open: isOpen,
    stocks: stockList,
    gainers_count: gainers,
    losers_count: losers,
    unchanged_count: unchanged,
    total_volume: stockList.reduce((s, v) => s + v.volume, 0),
    timestamp: new Date().toISOString(),
  };
}

// ==================== BROADCAST INTERVAL ====================

let broadcastInterval: ReturnType<typeof setInterval> | null = null;

function startBroadcasting() {
  if (broadcastInterval) return;

  // Emit market updates every 5 seconds
  broadcastInterval = setInterval(() => {
    const updates = updateStockPrices();

    io.emit('market:update', {
      stocks: updates,
      timestamp: new Date().toISOString(),
    });

    // Emit market status
    io.emit('market:status', {
      ...getMarketOverview(),
    });
  }, 5000);

  console.log('[BROADCAST] Market updates every 5 seconds started');
}

function stopBroadcasting() {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
  }
}

// ==================== CONNECTION HANDLERS ====================

const subscribedTickers = new Map<string, Set<string>>();

io.on('connection', (socket) => {
  console.log(`[CONNECT] Client connected: ${socket.id}`);

  // Send initial market status on connect
  socket.emit('market:status', {
    ...getMarketOverview(),
  });

  // Send current stock snapshot
  const snapshot = Array.from(stocks.values()).map((s) => ({ ...s }));
  socket.emit('market:snapshot', {
    stocks: snapshot,
    timestamp: new Date().toISOString(),
  });

  // Handler: Get Market Overview
  socket.on('getMarketOverview', (callback) => {
    const overview = getMarketOverview();
    if (typeof callback === 'function') {
      callback(overview);
    }
    socket.emit('market:overview', overview);
  });

  // Handler: Subscribe to individual ticker
  socket.on('subscribe:ticker', (ticker: string) => {
    const upperTicker = ticker.toUpperCase();
    if (stocks.has(upperTicker)) {
      if (!subscribedTickers.has(socket.id)) {
        subscribedTickers.set(socket.id, new Set());
      }
      subscribedTickers.get(socket.id)!.add(upperTicker);
      console.log(`[SUBSCRIBE] ${socket.id} subscribed to ${upperTicker}`);
    } else {
      socket.emit('error', { message: `السهم ${upperTicker} غير موجود` });
    }
  });

  // Handler: Unsubscribe from ticker
  socket.on('unsubscribe:ticker', (ticker: string) => {
    const upperTicker = ticker.toUpperCase();
    if (subscribedTickers.has(socket.id)) {
      subscribedTickers.get(socket.id)!.delete(upperTicker);
    }
  });

  // Handler: Join a room for personalized alerts
  socket.on('join:room', (room: string) => {
    socket.join(room);
    console.log(`[ROOM] ${socket.id} joined room: ${room}`);
  });

  // Handler: Leave a room
  socket.on('leave:room', (room: string) => {
    socket.leave(room);
    console.log(`[ROOM] ${socket.id} left room: ${room}`);
  });

  // Disconnect handler
  socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] Client ${socket.id} disconnected: ${reason}`);
    subscribedTickers.delete(socket.id);
  });

  // Error handler
  socket.on('error', (error) => {
    console.error(`[ERROR] Socket ${socket.id}:`, error);
  });
});

// Emit individual ticker updates to subscribed clients
const tickerInterval = setInterval(() => {
  for (const [socketId, tickers] of subscribedTickers) {
    for (const ticker of tickers) {
      const stock = stocks.get(ticker);
      if (stock) {
        io.to(socketId).emit('ticker:update', { ...stock });
      }
    }
  }
}, 3000);

// ==================== START SERVER ====================

const PORT = 3005;
httpServer.listen(PORT, () => {
  console.log(`[MARKET-WS] WebSocket server running on port ${PORT}`);
  startBroadcasting();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[MARKET-WS] Received SIGTERM, shutting down...');
  stopBroadcasting();
  clearInterval(tickerInterval);
  httpServer.close(() => {
    console.log('[MARKET-WS] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[MARKET-WS] Received SIGINT, shutting down...');
  stopBroadcasting();
  clearInterval(tickerInterval);
  httpServer.close(() => {
    console.log('[MARKET-WS] Server closed');
    process.exit(0);
  });
});
