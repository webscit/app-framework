/** Handle returned by operations. Call dispose() to undo the operation. Idempotent. */
export interface IDisposable {
  dispose(): void;
}
