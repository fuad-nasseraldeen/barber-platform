/**
 * BullMQ rejects custom job IDs that contain ":" (reserved for internal keys).
 * @see https://github.com/taskforcesh/bullmq/blob/master/src/classes/job.ts
 */
export function bullmqSafeJobId(...parts: string[]): string {
  return parts
    .map((p) => String(p).replace(/:/g, '_'))
    .join('--');
}
