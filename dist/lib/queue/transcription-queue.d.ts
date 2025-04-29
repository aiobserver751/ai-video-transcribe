import { Queue, Worker, QueueEvents, FlowProducer } from 'bullmq';
interface TranscriptionJobData {
    url: string;
    quality: 'standard' | 'premium';
    fallbackOnRateLimit: boolean;
    jobId: string;
    userId?: string;
    apiKey: string;
    callback_url?: string;
}
interface TranscriptionResult {
    transcription: string;
    quality: string;
    jobId: string;
    error?: string;
    callback_success?: boolean;
    callback_error?: string;
}
interface JobProgress {
    percentage: number;
    stage: string;
    message?: string;
}
export declare const transcriptionQueue: Queue<TranscriptionJobData, TranscriptionResult, string, TranscriptionJobData, TranscriptionResult, string>;
export declare const flowProducer: FlowProducer;
export declare const transcriptionQueueEvents: QueueEvents;
export declare function addTranscriptionJob(data: Omit<TranscriptionJobData, 'jobId'>, priority?: 'standard' | 'premium'): Promise<string>;
export declare function getJobStatus(jobId: string): Promise<{
    status: string;
    progress: JobProgress | null;
    result: TranscriptionResult | null;
}>;
export declare function startTranscriptionWorker(concurrency?: number): Worker<TranscriptionJobData, TranscriptionResult, string>;
export {};
