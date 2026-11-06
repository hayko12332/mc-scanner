import { SaferGate, SaferUnavailableException } from './safer-gate.js';

describe('SaferGate', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('lets the first request through immediately', async () => {
    const gate = new SaferGate(2, now);
    await expect(gate.waitTurn()).resolves.toBeUndefined();
  });

  it('blocks every request for the cooldown after a 403, then doubles it on the next ban', async () => {
    const gate = new SaferGate(2, now);
    expect(gate.banned()).toBe(60);
    expect(gate.banned()).toBe(60); // in-flight 403s share the same ban
    await expect(gate.waitTurn()).rejects.toMatchObject({ retryAfter: 60 });

    clock += 30_000;
    await expect(gate.waitTurn()).rejects.toMatchObject({ retryAfter: 30 });

    clock += 30_000;
    await expect(gate.waitTurn()).resolves.toBeUndefined();
    expect(gate.banned()).toBe(120);
  });

  it('resets the cooldown after a successful call', () => {
    const gate = new SaferGate(2, now);
    gate.banned();
    clock += 60_000;
    gate.succeeded();
    expect(gate.banned()).toBe(60);
  });

  it('refuses to queue more than a minute of requests', async () => {
    const gate = new SaferGate(1000, now);
    (gate as unknown as { nextSlot: number }).nextSlot = clock + 61_000;
    await expect(gate.waitTurn()).rejects.toBeInstanceOf(SaferUnavailableException);
  });
});
