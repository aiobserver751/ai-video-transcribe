import { NextResponse } from 'next/server';
export declare function POST(request: Request): Promise<NextResponse<{
    error: string;
    status_code: number;
    status_message: string;
}> | NextResponse<{
    transcription: string;
    quality: unknown;
    status_code: number;
    status_message: string;
}>>;
