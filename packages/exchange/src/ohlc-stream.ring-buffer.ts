const MAX_RING_BUFFER_CAPACITY = 10_000;

export class RingBuffer<T> {
  private readonly items: T[] = [];
  private cursor = 0;
  readonly #capacity: number;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > MAX_RING_BUFFER_CAPACITY) {
      throw new Error(`RingBuffer: capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.#capacity = capacity;
  }

  get capacity(): number {
    return this.#capacity;
  }

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return;
    }
    this.items[this.cursor] = item;
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  get size(): number {
    return this.items.length;
  }

  *values(): IterableIterator<T> {
    if (this.items.length < this.capacity) {
      yield* this.items;
      return;
    }
    yield* this.items.slice(this.cursor);
    yield* this.items.slice(0, this.cursor);
  }

  toArray(): T[] {
    const values: T[] = [];
    for (const value of this.values()) values.push(value);
    return values;
  }
}
