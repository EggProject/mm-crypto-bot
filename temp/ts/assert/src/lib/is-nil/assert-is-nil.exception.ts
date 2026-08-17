import { BaseAssertException } from '../base-assert.exception';

/**
 * Exception thrown when a value fails the nil type assertion.
 * Used by assertIsNil when the provided value is not null or undefined.
 *
 * @example
 * ```ts
 * throw new AssertIsNilException('Expected value to be nil');
 * ```
 */
export class AssertIsNilException extends BaseAssertException {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, AssertIsNilException.prototype);
  }
}
