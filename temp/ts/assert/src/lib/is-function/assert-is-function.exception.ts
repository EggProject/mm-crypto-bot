import { BaseAssertException } from '../base-assert.exception';

/**
 * Exception thrown when a value fails the function type assertion.
 * Used by assertIsFunction when the provided value is not a function.
 *
 * @example
 * ```ts
 * throw new AssertIsFunctionException('Expected a callback function');
 * ```
 */
export class AssertIsFunctionException extends BaseAssertException {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, AssertIsFunctionException.prototype);
  }
}
