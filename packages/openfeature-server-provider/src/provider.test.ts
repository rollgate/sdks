import {
  ErrorCode,
  ProviderEvents,
  StandardResolutionReasons,
  TypeMismatchError,
  type EvaluationContext,
} from "@openfeature/server-sdk";
import { RollgateClient, type EvalContext } from "@rollgate/sdk-node";
import { describe, expect, it, vi } from "vitest";
import { RollgateProvider } from "./provider";
import { mapErrorCode, mapReason, toEvalContext } from "./translate";

/**
 * Minimal stand-in for the parts of RollgateClient the provider touches.
 * The prototype is reparented to RollgateClient so the provider's
 * `instanceof`-based constructor treats it as an injected client.
 */
function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  const client = {
    isEnabledDetail: vi.fn(),
    getValueDetail: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    off: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== cb);
    }),
    emit(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    },
    ...overrides,
  };
  Object.setPrototypeOf(client, RollgateClient.prototype);
  return client;
}

function providerWith(client: ReturnType<typeof makeClient>): RollgateProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return RollgateProvider.fromClient(client as any);
}

const CTX: EvaluationContext = { targetingKey: "user-1" };

describe("RollgateProvider — boolean", () => {
  it("maps a targeting-rule match to TARGETING_MATCH with variant + metadata", async () => {
    const client = makeClient();
    client.isEnabledDetail.mockReturnValue({
      value: true,
      reason: { kind: "RULE_MATCH", ruleId: "r-9", inExperiment: true },
      variationId: "v-on",
    });
    const provider = providerWith(client);

    const res = await provider.resolveBooleanEvaluation("f", false, CTX);

    expect(res.value).toBe(true);
    expect(res.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
    expect(res.variant).toBe("v-on");
    expect(res.flagMetadata).toMatchObject({
      variationId: "v-on",
      ruleId: "r-9",
      inExperiment: true,
    });
  });

  it("returns the default with UNKNOWN reason when the flag is missing", async () => {
    const client = makeClient();
    client.isEnabledDetail.mockReturnValue({
      value: false,
      reason: { kind: "UNKNOWN" },
    });
    const res = await providerWith(client).resolveBooleanEvaluation(
      "nope",
      false,
      CTX,
    );

    expect(res.value).toBe(false);
    expect(res.reason).toBe(StandardResolutionReasons.UNKNOWN);
    expect(res.errorCode).toBeUndefined();
  });

  it("surfaces CLIENT_NOT_READY as ERROR + PROVIDER_NOT_READY", async () => {
    const client = makeClient();
    client.isEnabledDetail.mockReturnValue({
      value: false,
      reason: { kind: "ERROR", errorKind: "CLIENT_NOT_READY" },
    });
    const res = await providerWith(client).resolveBooleanEvaluation(
      "f",
      false,
      CTX,
    );

    expect(res.value).toBe(false);
    expect(res.reason).toBe(StandardResolutionReasons.ERROR);
    expect(res.errorCode).toBe(ErrorCode.PROVIDER_NOT_READY);
  });
});

describe("RollgateProvider — typed values", () => {
  it("resolves string via getValueDetail", async () => {
    const client = makeClient();
    client.getValueDetail.mockReturnValue({
      value: "dark",
      reason: { kind: "FALLTHROUGH" },
      variationId: "v-dark",
    });
    const res = await providerWith(client).resolveStringEvaluation(
      "theme",
      "light",
      CTX,
    );

    expect(res.value).toBe("dark");
    expect(res.reason).toBe(StandardResolutionReasons.DEFAULT);
    expect(res.variant).toBe("v-dark");
  });

  it("resolves object/array values", async () => {
    const client = makeClient();
    client.getValueDetail.mockReturnValue({
      value: { ratio: 0.5, tiers: ["a", "b"] },
      reason: { kind: "TARGET_MATCH" },
    });
    const res = await providerWith(client).resolveObjectEvaluation(
      "cfg",
      {},
      CTX,
    );

    expect(res.value).toEqual({ ratio: 0.5, tiers: ["a", "b"] });
    expect(res.reason).toBe(StandardResolutionReasons.TARGETING_MATCH);
  });

  it("throws TypeMismatchError when the resolved type differs from requested", async () => {
    const client = makeClient();
    client.getValueDetail.mockReturnValue({
      value: 42, // number, but caller asked for string
      reason: { kind: "FALLTHROUGH" },
    });
    await expect(
      providerWith(client).resolveNumberEvaluation("x", 0, CTX),
    ).resolves.toMatchObject({ value: 42 }); // number requested, number resolved → ok

    await expect(
      providerWith(client).resolveStringEvaluation("x", "def", CTX),
    ).rejects.toBeInstanceOf(TypeMismatchError);
  });

  it("does NOT throw type mismatch when a missing flag returns the (typed) default", async () => {
    const client = makeClient();
    client.getValueDetail.mockReturnValue({
      value: "fallback", // SDK returns the default string on UNKNOWN
      reason: { kind: "UNKNOWN" },
    });
    const res = await providerWith(client).resolveStringEvaluation(
      "x",
      "fallback",
      CTX,
    );
    expect(res.value).toBe("fallback");
    expect(res.reason).toBe(StandardResolutionReasons.UNKNOWN);
  });

  it("treats a null value as a mismatch when an object is requested", async () => {
    const client = makeClient();
    client.getValueDetail.mockReturnValue({
      value: null,
      reason: { kind: "FALLTHROUGH" },
    });
    await expect(
      providerWith(client).resolveObjectEvaluation("cfg", { ok: true }, CTX),
    ).rejects.toBeInstanceOf(TypeMismatchError);
  });
});

describe("RollgateProvider — context passthrough", () => {
  it("forwards targetingKey as userId and primitive attributes", async () => {
    const client = makeClient();
    client.isEnabledDetail.mockReturnValue({
      value: true,
      reason: { kind: "OFF" },
    });
    const ctx: EvaluationContext = {
      targetingKey: "u-7",
      plan: "pro",
      seats: 5,
      trial: true,
    };
    await providerWith(client).resolveBooleanEvaluation("f", false, ctx);

    const passed = client.isEnabledDetail.mock.calls[0][2] as EvalContext;
    expect(passed).toEqual({
      userId: "u-7",
      attributes: { plan: "pro", seats: 5, trial: true },
    });
  });
});

describe("RollgateProvider — lifecycle & events", () => {
  it("fromClient does not close a client it does not own", async () => {
    const client = makeClient();
    const provider = providerWith(client);
    await provider.onClose();
    expect(client.close).not.toHaveBeenCalled();
  });

  it("initialize wires flag updates to ConfigurationChanged", async () => {
    const client = makeClient();
    const provider = providerWith(client);
    const spy = vi.fn();
    provider.events.addHandler(ProviderEvents.ConfigurationChanged, spy);

    await provider.initialize();
    expect(client.init).toHaveBeenCalledOnce();

    client.emit("flag-changed", "checkout");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ flagsChanged: ["checkout"] }),
    );
  });

  it("does not stack listeners across repeated initialize() calls", async () => {
    const client = makeClient();
    const provider = providerWith(client);
    await provider.initialize();
    await provider.initialize();
    // "flags-updated" + "flag-changed", registered exactly once.
    expect(client.on).toHaveBeenCalledTimes(2);
  });

  it("removes client listeners on close", async () => {
    const client = makeClient();
    const provider = providerWith(client);
    const spy = vi.fn();
    provider.events.addHandler(ProviderEvents.ConfigurationChanged, spy);

    await provider.initialize();
    await provider.onClose();

    client.emit("flag-changed", "checkout");
    expect(spy).not.toHaveBeenCalled();
  });

  it("owned client is closed on close", async () => {
    const client = makeClient();
    // Constructing via the client overload marks it not-owned; simulate an
    // owned client by flipping the private flag through a fresh instance.
    const provider = new RollgateProvider(client as unknown as RollgateClient);
    (provider as unknown as { ownsClient: boolean }).ownsClient = true;
    await provider.onClose();
    expect(client.close).toHaveBeenCalledOnce();
  });
});

describe("translate helpers", () => {
  it("toEvalContext drops non-primitive attributes and serializes Date", () => {
    const date = new Date("2026-07-25T00:00:00.000Z");
    const out = toEvalContext({
      targetingKey: "u",
      keep: "yes",
      when: date,
      nested: { a: 1 },
      list: [1, 2],
    });
    expect(out).toEqual({
      userId: "u",
      attributes: { keep: "yes", when: "2026-07-25T00:00:00.000Z" },
    });
  });

  it("toEvalContext returns undefined without a targetingKey", () => {
    expect(toEvalContext({ plan: "pro" })).toBeUndefined();
    expect(toEvalContext(undefined)).toBeUndefined();
  });

  it("mapReason covers every kind", () => {
    expect(mapReason({ kind: "OFF" })).toBe(StandardResolutionReasons.DISABLED);
    expect(mapReason({ kind: "TARGET_MATCH" })).toBe(
      StandardResolutionReasons.TARGETING_MATCH,
    );
    expect(mapReason({ kind: "RULE_MATCH" })).toBe(
      StandardResolutionReasons.TARGETING_MATCH,
    );
    expect(mapReason({ kind: "FALLTHROUGH" })).toBe(
      StandardResolutionReasons.DEFAULT,
    );
    expect(mapReason({ kind: "ERROR" })).toBe(StandardResolutionReasons.ERROR);
    expect(mapReason({ kind: "UNKNOWN" })).toBe(
      StandardResolutionReasons.UNKNOWN,
    );
  });

  it("mapErrorCode covers every error kind", () => {
    expect(mapErrorCode("FLAG_NOT_FOUND")).toBe(ErrorCode.FLAG_NOT_FOUND);
    expect(mapErrorCode("MALFORMED_FLAG")).toBe(ErrorCode.PARSE_ERROR);
    expect(mapErrorCode("USER_NOT_SPECIFIED")).toBe(
      ErrorCode.TARGETING_KEY_MISSING,
    );
    expect(mapErrorCode("CLIENT_NOT_READY")).toBe(ErrorCode.PROVIDER_NOT_READY);
    expect(mapErrorCode("EXCEPTION")).toBe(ErrorCode.GENERAL);
    expect(mapErrorCode(undefined)).toBe(ErrorCode.GENERAL);
  });
});
