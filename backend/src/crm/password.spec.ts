import { describe, expect, it } from 'vitest';
import { codeMail } from '../mail/mailer.js';
import { checkPassword, codeHash, emailOk, hashPassword, newCode, normEmail, passwordProblem } from './password.js';

describe('Passwords and codes', () => {
  it('hashes passwords with a salt and checks them', async () => {
    const a = await hashPassword('Truck2026!');
    const b = await hashPassword('Truck2026!');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await checkPassword('Truck2026!', a)).toBe(true);
    expect(await checkPassword('truck2026!', a)).toBe(false);
    expect(await checkPassword('Truck2026!', null)).toBe(false);
    expect(await checkPassword('Truck2026!', 'garbage')).toBe(false);
  });

  it('asks for a reasonable password', () => {
    expect(passwordProblem('short')).toMatch(/8 characters/);
    expect(passwordProblem('12345678')).toMatch(/letters/);
    expect(passwordProblem('dispatch-2026')).toBeNull();
  });

  it('makes 6-digit codes and ties their hash to the email', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
    expect(codeHash('a@x.com', '123456')).not.toBe(codeHash('b@x.com', '123456'));
  });

  it('normalizes and checks emails', () => {
    expect(normEmail('  Ann@Example.COM ')).toBe('ann@example.com');
    expect(emailOk('ann@example.com')).toBe(true);
    expect(emailOk('ann@example')).toBe(false);
    expect(emailOk('ann example.com')).toBe(false);
  });

  it('puts the code in the subject and the body of the email', () => {
    const m = codeMail('ann@x.com', '042917', 'verify', 'Ann');
    expect(m.subject).toContain('042917');
    expect(m.text).toContain('042917');
    expect(m.html).toContain('042917');
    expect(codeMail('ann@x.com', '111111', 'reset').subject).toMatch(/reset/);
  });
});
