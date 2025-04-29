import { NextResponse } from 'next/server';
import { initializeQueueWorkers } from '@/lib/queue/server';
import { logger } from '@/lib/logger';

// Global variable to track initialization
let initialized = false;

export async function GET() {
  try {
    if (initialized) {
      return NextResponse.json({
        message: 'Queue workers already initialized',
        status_code: 200
      });
    }
    
    // Initialize queue workers
    initializeQueueWorkers();
    initialized = true;
    
    logger.info('Queue workers initialized successfully via API route');
    
    return NextResponse.json({
      message: 'Queue workers initialized successfully',
      status_code: 200
    });
  } catch (error) {
    logger.error('Failed to initialize queue workers via API route:', error);
    
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Unknown error';
    
    return NextResponse.json({
      error: 'Failed to initialize queue workers',
      details: errorMessage,
      status_code: 500
    }, { status: 500 });
  }
} 