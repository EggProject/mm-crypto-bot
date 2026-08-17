import { isStringResolver } from './is-string-resolver';
import { POSITIVE_INT_ZERO, TEST_NUMBER_FLOAT } from '../test-constants';

class CustomClass {}

describe('isStringResolver', () => {
  it('When string provided Then true returned', () => {
    expect(isStringResolver('something string')).toBe(true);
  });

  it('When function provided Then true returned', () => {
    expect(isStringResolver(() => 'something string')).toBe(true);
  });

  it('When class type provided Then false returned', () => {
    expect(isStringResolver(CustomClass)).toBe(false);
  });

  it('When primitive provided Then false returned', () => {
    expect(isStringResolver(POSITIVE_INT_ZERO)).toBe(false);
    expect(isStringResolver(TEST_NUMBER_FLOAT)).toBe(false);
    expect(isStringResolver(true)).toBe(false);
    expect(isStringResolver(false)).toBe(false);
    expect(isStringResolver()).toBe(false);
  });
});
