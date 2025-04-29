import IORedis from 'ioredis';
export declare const redisConnection: {
    host: string;
    port: number;
    username: string;
    password: string;
    maxRetriesPerRequest: null;
    enableReadyCheck: boolean;
    retryStrategy: (times: number) => number;
};
export declare const createRedisConnection: () => IORedis;
export declare const QUEUE_NAMES: {
    TRANSCRIPTION: string;
    AUDIO_CHUNK: string;
};
export declare const PRIORITY: {
    PREMIUM: number;
    STANDARD: number;
};
export declare const JOB_STATUS: {
    WAITING: string;
    ACTIVE: string;
    COMPLETED: string;
    FAILED: string;
    DELAYED: string;
    PAUSED: string;
};
export declare const defaultJobOptions: {
    attempts: number;
    backoff: {
        type: string;
        delay: number;
    };
    removeOnComplete: {
        age: number;
        count: number;
    };
    removeOnFail: {
        age: number;
    };
};
