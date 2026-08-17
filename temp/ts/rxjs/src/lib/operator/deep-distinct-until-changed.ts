import { distinctUntilChanged, type MonoTypeOperatorFunction } from 'rxjs';
import equal from 'fast-deep-equal';

export const deepDistinctUntilChanged = <T>(): MonoTypeOperatorFunction<T> =>
  distinctUntilChanged<T>((a, b): boolean => equal(a, b));
