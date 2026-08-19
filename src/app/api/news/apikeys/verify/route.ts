import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface TestResult {
  success: boolean
  error?: string
  articles?: number
}

// Test API key by making a simple request
async function testNewsAPI(apiKey: string): Promise<TestResult> {
  try {
    const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=1&apiKey=${apiKey}`
    const res = await fetch(url)
    const data = await res.json()
    
    if (data.status === 'ok') {
      return { success: true, articles: data.totalResults }
    }
    return { success: false, error: data.message || 'Unknown error' }
  } catch (error) {
    return { success: false, error: 'Connection failed' }
  }
}

async function testGNews(apiKey: string): Promise<TestResult> {
  try {
    const url = `https://gnews.io/api/v4/top-headlines?token=${apiKey}&max=1`
    const res = await fetch(url)
    const data = await res.json()
    
    if (data.articles) {
      return { success: true, articles: data.totalArticles || data.articles.length }
    }
    return { success: false, error: data.errors?.[0] || 'Unknown error' }
  } catch (error) {
    return { success: false, error: 'Connection failed' }
  }
}

async function testAlphaVantage(apiKey: string): Promise<TestResult> {
  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${apiKey}&limit=1`
    const res = await fetch(url)
    const data = await res.json()
    
    if (data.feed || data.Information) {
      return { success: true }
    }
    if (data['Error Message']) {
      return { success: false, error: data['Error Message'] }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: 'Connection failed' }
  }
}

async function testMediaStack(apiKey: string): Promise<TestResult> {
  try {
    const url = `http://api.mediastack.com/v1/news?access_key=${apiKey}&limit=1`
    const res = await fetch(url)
    const data = await res.json()
    
    if (data.data) {
      return { success: true, articles: data.pagination?.total || data.data.length }
    }
    return { success: false, error: data.error?.message || 'Unknown error' }
  } catch (error) {
    return { success: false, error: 'Connection failed' }
  }
}

async function testCurrentsAPI(apiKey: string): Promise<TestResult> {
  try {
    const url = `https://api.currentsapi.services/v1/latest-news?apiKey=${apiKey}&limit=1`
    const res = await fetch(url)
    const data = await res.json()
    
    if (data.news) {
      return { success: true, articles: data.news.length }
    }
    return { success: false, error: data.message || 'Unknown error' }
  } catch (error) {
    return { success: false, error: 'Connection failed' }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { service } = body
    
    if (!service) {
      return NextResponse.json({
        success: false,
        error: 'Service name is required'
      }, { status: 400 })
    }
    
    // Get API key from database
    const keyRecord = await db.newsApiKey.findUnique({
      where: { service }
    })
    
    if (!keyRecord) {
      return NextResponse.json({
        success: false,
        error: 'API key not found for this service'
      }, { status: 404 })
    }
    
    let result: TestResult
    
    // Test based on service
    switch (service.toLowerCase()) {
      case 'newsapi':
        result = await testNewsAPI(keyRecord.api_key)
        break
      case 'gnews':
        result = await testGNews(keyRecord.api_key)
        break
      case 'alphavantage':
        result = await testAlphaVantage(keyRecord.api_key)
        break
      case 'mediastack':
        result = await testMediaStack(keyRecord.api_key)
        break
      case 'currentsapi':
        result = await testCurrentsAPI(keyRecord.api_key)
        break
      default:
        result = { success: false, error: 'Unknown service' }
    }
    
    // Update key status
    await db.newsApiKey.update({
      where: { service },
      data: {
        last_used: new Date(),
        status: result.success ? 'active' : 'error',
        last_error: result.success ? null : result.error
      }
    })
    
    return NextResponse.json({
      success: result.success,
      error: result.error,
      articles: result.articles
    })
    
  } catch (error) {
    console.error('Error testing API key:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to test API key'
    }, { status: 500 })
  }
}
