import { describe, expect, expectTypeOf, it } from "vitest";

import { first } from "./index";
import type {
  Constructor,
  DeepPartial,
  MaybeArray,
  NonEmptyArray,
  RemoveIndexSignature,
  RequiredProperty,
  ValueResolver,
} from "./index";

describe("typing foundation", () => {
  it("preserves a non-empty tuple element type at runtime and compile time", () => {
    const values: NonEmptyArray<string> = ["first", "second"];

    expect(first(values)).toBe("first");
    expectTypeOf(first(values)).toEqualTypeOf<string>();
  });

  it("provides strict type utilities for internal contracts", () => {
    class Service {
      public constructor(readonly identifier: string) {}
    }

    const marker = Symbol("marker");

    interface Contract {
      readonly identifier: string;
      readonly nested: {
        readonly enabled: boolean;
      };
      readonly labels: readonly string[];
      readonly resolve: () => string;
    }

    interface MutableContract {
      values: { enabled: boolean }[];
      transform: (value: string) => number;
    }

    interface RecordWithIndex extends Contract {
      [key: string]: unknown;
      readonly [marker]?: boolean;
    }

    type RequiredIdentifier = RequiredProperty<
      { readonly identifier?: string | undefined; readonly enabled?: boolean },
      "identifier"
    >;

    expectTypeOf<typeof Service>().toExtend<Constructor<Service, [string]>>();
    expectTypeOf<Constructor<Service, [string]>>().not.toExtend<Constructor<Service, []>>();
    expectTypeOf<MaybeArray<string>>().toEqualTypeOf<string | readonly string[]>();
    const draft: DeepPartial<Contract> = {
      labels: ["label"],
      nested: { enabled: true },
      resolve: () => "resolved",
    };
    const mutableDraft: DeepPartial<MutableContract> = {
      transform: (value) => value.length,
      values: [{ enabled: true }],
    };
    const declared: RemoveIndexSignature<RecordWithIndex> = {
      identifier: "identifier",
      labels: [],
      nested: { enabled: true },
      resolve: () => "resolved",
    };
    const required: RequiredIdentifier = { identifier: undefined };

    expectTypeOf(draft.nested).toEqualTypeOf<{ readonly enabled?: boolean } | undefined>();
    expectTypeOf(draft.labels).toEqualTypeOf<readonly string[] | undefined>();
    expectTypeOf(draft.resolve).toEqualTypeOf<(() => string) | undefined>();
    expectTypeOf(mutableDraft.values).toEqualTypeOf<{ enabled?: boolean }[] | undefined>();
    expectTypeOf(mutableDraft.transform).toEqualTypeOf<((value: string) => number) | undefined>();
    expectTypeOf(declared.identifier).toEqualTypeOf<string>();
    expectTypeOf(declared.nested.enabled).toEqualTypeOf<boolean>();
    expectTypeOf<RemoveIndexSignature<RecordWithIndex>[typeof marker]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf(required.identifier).toEqualTypeOf<string | undefined>();
    expectTypeOf<Record<never, never>>().not.toExtend<RequiredIdentifier>();
    expectTypeOf<ValueResolver<RecordWithIndex, string>>().toEqualTypeOf<
      string | ((subject: RecordWithIndex) => string)
    >();
  });
});
