import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getSessionUserId } from '@/lib/auth-helpers';

const prisma = new PrismaClient();

// GET - Fetch user's portfolio
export async function GET(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const portfolio = await prisma.portfolio.findMany({
      where: { userId },
      include: {
        stock: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(portfolio);
  } catch (error) {
    console.error('Portfolio fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio' },
      { status: 500 }
    );
  }
}

// POST - Add stock to portfolio
export async function POST(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { stockSymbol, quantity, buyPrice, buyDate, notes } = body;

    // Check if stock exists, if not create it
    let stock = await prisma.stock.findUnique({
      where: { symbol: stockSymbol },
    });

    if (!stock) {
      stock = await prisma.stock.create({
        data: {
          symbol: stockSymbol,
          name: stockSymbol,
        },
      });
    }

    // Check if already in portfolio
    const existing = await prisma.portfolio.findFirst({
      where: { userId, stockSymbol },
    });

    if (existing) {
      // Update quantity
      const updated = await prisma.portfolio.update({
        where: { id: existing.id },
        data: {
          quantity: existing.quantity + quantity,
          notes: notes || existing.notes,
        },
      });
      return NextResponse.json(updated);
    }

    // Create new portfolio entry
    const portfolio = await prisma.portfolio.create({
      data: {
        userId,
        stockSymbol,
        quantity,
        buyPrice,
        buyDate: buyDate ? new Date(buyDate) : new Date(),
        notes,
      },
    });

    return NextResponse.json(portfolio);
  } catch (error) {
    console.error('Portfolio add error:', error);
    return NextResponse.json(
      { error: 'Failed to add to portfolio' },
      { status: 500 }
    );
  }
}

// DELETE - Remove stock from portfolio
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Portfolio entry ID required' },
        { status: 400 }
      );
    }

    // Verify ownership
    const entry = await prisma.portfolio.findUnique({
      where: { id },
    });

    if (!entry || entry.userId !== userId) {
      return NextResponse.json(
        { error: 'Not found or unauthorized' },
        { status: 404 }
      );
    }

    await prisma.portfolio.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Portfolio delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete from portfolio' },
      { status: 500 }
    );
  }
}