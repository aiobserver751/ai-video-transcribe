import { NextResponse } from 'next/server';
export declare function GET(): Promise<NextResponse<{
    message: string;
    status_code: number;
}> | NextResponse<{
    error: string;
    details: string;
    status_code: number;
}>>;
