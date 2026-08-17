import { BaseAssertException } from '../base-assert.exception';

/**
 * Exception thrown when a value fails the string type assertion.
 * Used by assertIsString when the provided value is not a string.
 *
 * @example
 * ```ts
 * throw new AssertIsStringException('Expected a string value');
 * ```
 */
export class AssertIsStringException extends BaseAssertException {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, AssertIsStringException.prototype);
  }
}
