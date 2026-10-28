import { describe, expect, it } from 'vitest';
import { classifyTurnstileError, humanCheckFailureMessage } from '../src/lib/humanCheckError';

describe('classifyTurnstileError', () => {
  it('treats challenge execution failures (600xxx, 300xxx) as a failed check the visitor can retry', () => {
    expect(classifyTurnstileError('600010')).toBe('challenge');
    expect(classifyTurnstileError('300030')).toBe('challenge');
  });

  it('treats invalid site key / unknown domain as a set-up problem', () => {
    expect(classifyTurnstileError('110100')).toBe('setup');
    expect(classifyTurnstileError('110110')).toBe('setup');
    expect(classifyTurnstileError('110200')).toBe('setup');
    expect(classifyTurnstileError('400020')).toBe('setup');
  });

  it('treats an unsupported browser as unsupported', () => {
    expect(classifyTurnstileError('110500')).toBe('unsupported');
    expect(classifyTurnstileError('110510')).toBe('unsupported');
  });

  it('falls back to a retryable failure for unknown or missing codes', () => {
    expect(classifyTurnstileError(undefined)).toBe('challenge');
    expect(classifyTurnstileError('')).toBe('challenge');
    expect(classifyTurnstileError('999999')).toBe('challenge');
  });
});

describe('humanCheckFailureMessage', () => {
  it('only mentions ad blockers when the script itself could not load', () => {
    expect(humanCheckFailureMessage('load')).toMatch(/ad blocker/);
    for (const kind of ['challenge', 'setup', 'unsupported'] as const) {
      expect(humanCheckFailureMessage(kind)).not.toMatch(/ad blocker/);
    }
  });

  it('suggests a regular browser when the check fails', () => {
    expect(humanCheckFailureMessage('challenge')).toMatch(/Try again/);
    expect(humanCheckFailureMessage('challenge')).toMatch(/Chrome, Edge, Firefox or Safari/);
    expect(humanCheckFailureMessage('unsupported')).toMatch(/Chrome, Edge, Firefox or Safari/);
  });
});
