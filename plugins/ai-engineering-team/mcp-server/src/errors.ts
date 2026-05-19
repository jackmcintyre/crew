/**
 * Typed error hierarchy for the ai-engineering-team plugin.
 *
 * All domain errors extend `DomainError`. The MCP boundary
 * (tool handlers in later stories) maps these to MCP errors.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Preserve V8 stack frames if available.
    if (typeof (Error as unknown as { captureStackTrace?: unknown }).captureStackTrace === "function") {
      (Error as unknown as { captureStackTrace: (t: object, c?: object) => void }).captureStackTrace(this, new.target);
    }
  }
}

/**
 * Thrown when a method or seam exists for future stories but has
 * no behavior yet. Always include the story reference that will
 * land the real implementation.
 */
export class NotImplementedError extends DomainError {}
