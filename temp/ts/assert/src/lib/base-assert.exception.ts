/**
 * Base exception class for all assertion failures.
 * Extends the native Error class and properly maintains the prototype chain.
 */
export class BaseAssertException extends Error {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, BaseAssertException.prototype);
  }
}
