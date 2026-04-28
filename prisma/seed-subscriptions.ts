import { db } from '../src/lib/db';

async function main() {
  const plans = [
    {
      id: 'free',
      name: 'Free',
      price: 0,
      currency: 'EGP',
      interval: 'month',
      features: JSON.stringify([
        'Basic market data',
        '5 watchlist items',
        'Daily price alerts'
      ]),
      limits: JSON.stringify({
        watchlistItems: 5,
        alertsPerDay: 3
      })
    },
    {
      id: 'plus',
      name: 'Plus',
      price: 99,
      currency: 'EGP',
      interval: 'month',
      features: JSON.stringify([
        'Real-time market data',
        '25 watchlist items',
        'Unlimited alerts',
        'Portfolio tracking',
        'Basic analytics'
      ]),
      limits: JSON.stringify({
        watchlistItems: 25,
        alertsPerDay: -1
      })
    },
    {
      id: 'premium',
      name: 'Premium',
      price: 199,
      currency: 'EGP',
      interval: 'month',
      features: JSON.stringify([
        'Real-time market data',
        'Unlimited watchlist',
        'Unlimited alerts',
        'Advanced portfolio analytics',
        'AI-powered insights',
        'Priority support',
        'Custom reports'
      ]),
      limits: JSON.stringify({
        watchlistItems: -1,
        alertsPerDay: -1
      })
    }
  ];

  for (const plan of plans) {
    await db.subscriptionPlan.upsert({
      where: { id: plan.id },
      update: plan,
      create: plan
    });
    console.log(`✓ Created/Updated plan: ${plan.name}`);
  }

  console.log('\\n✅ Subscription plans seeded successfully!');
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
