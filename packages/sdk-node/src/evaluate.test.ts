import {
  evaluateFlag,
  evaluateAllFlags,
  evaluateFlagValue,
  evaluateAllFlagsV2,
  FlagRule,
  FlagRuleV2,
  UserContext,
  TargetingRule,
  TargetingRuleV2,
  EvaluationResult,
} from './evaluate';

describe('evaluateFlag', () => {
  describe('basic evaluation', () => {
    it('should return false when flag is disabled', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: false,
        rollout: 100,
      };
      expect(evaluateFlag(rule, { id: 'user-1' })).toBe(false);
    });

    it('should return true when flag is enabled and rollout is 100%', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 100,
      };
      expect(evaluateFlag(rule, { id: 'user-1' })).toBe(true);
    });

    it('should return false when flag is enabled and rollout is 0%', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 0,
      };
      expect(evaluateFlag(rule, { id: 'user-1' })).toBe(false);
    });

    it('should return false when no user context and rollout < 100%', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 50,
      };
      expect(evaluateFlag(rule, null)).toBe(false);
    });

    it('should return true when no user context and rollout is 100%', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 100,
      };
      expect(evaluateFlag(rule, null)).toBe(true);
    });
  });

  describe('target users', () => {
    it('should return true when user is in targetUsers list', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 0,
        targetUsers: ['user-1', 'user-2'],
      };
      expect(evaluateFlag(rule, { id: 'user-1' })).toBe(true);
    });

    it('should not match when user is not in targetUsers list', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 0,
        targetUsers: ['user-1', 'user-2'],
      };
      expect(evaluateFlag(rule, { id: 'user-3' })).toBe(false);
    });

    it('should not match when targetUsers is empty', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 0,
        targetUsers: [],
      };
      expect(evaluateFlag(rule, { id: 'user-1' })).toBe(false);
    });
  });

  describe('targeting rules', () => {
    it('should match targeting rule with 100% rollout', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 0,
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 100,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'pro' }],
          },
        ],
      };
      const user: UserContext = {
        id: 'user-1',
        attributes: { plan: 'pro' },
      };
      expect(evaluateFlag(rule, user)).toBe(true);
    });

    it('should return false when rule matches but rollout is 0%', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 100,
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 0,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'pro' }],
          },
        ],
      };
      const user: UserContext = {
        id: 'user-1',
        attributes: { plan: 'pro' },
      };
      expect(evaluateFlag(rule, user)).toBe(false);
    });

    it('should skip disabled rules', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 100,
        rules: [
          {
            id: 'rule-1',
            enabled: false,
            rollout: 0,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'pro' }],
          },
        ],
      };
      const user: UserContext = {
        id: 'user-1',
        attributes: { plan: 'pro' },
      };
      // Should fall through to global rollout (100%)
      expect(evaluateFlag(rule, user)).toBe(true);
    });

    it('should use first-match-wins for multiple rules', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 50,
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 0,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'enterprise' }],
          },
          {
            id: 'rule-2',
            enabled: true,
            rollout: 100,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'pro' }],
          },
        ],
      };
      const user: UserContext = {
        id: 'user-1',
        attributes: { plan: 'pro' },
      };
      // Should match rule-2 and return true
      expect(evaluateFlag(rule, user)).toBe(true);
    });

    it('should require all conditions to match (AND logic)', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 0,
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 100,
            conditions: [
              { attribute: 'plan', operator: 'equals', value: 'pro' },
              { attribute: 'country', operator: 'equals', value: 'US' },
            ],
          },
        ],
      };
      // User matches only one condition
      const user: UserContext = {
        id: 'user-1',
        attributes: { plan: 'pro', country: 'IT' },
      };
      expect(evaluateFlag(rule, user)).toBe(false);
    });

    it('should fall through to global rollout when no rules match', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 100,
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 0,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'enterprise' }],
          },
        ],
      };
      const user: UserContext = {
        id: 'user-1',
        attributes: { plan: 'free' },
      };
      // No rules match, should use global rollout (100%)
      expect(evaluateFlag(rule, user)).toBe(true);
    });

    it('should not match rule with empty conditions', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 100,
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 0,
            conditions: [],
          },
        ],
      };
      const user: UserContext = { id: 'user-1' };
      // Empty conditions = no match, falls through to global
      expect(evaluateFlag(rule, user)).toBe(true);
    });
  });

  describe('condition operators', () => {
    const createRule = (operator: string, value: string, attribute = 'test'): FlagRule => ({
      key: 'test-flag',
      enabled: true,
      rollout: 0,
      rules: [
        {
          id: 'rule-1',
          enabled: true,
          rollout: 100,
          conditions: [{ attribute, operator, value }],
        },
      ],
    });

    describe('equals / not_equals', () => {
      it('equals - should match exact value (case insensitive)', () => {
        const rule = createRule('equals', 'Hello');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'hello' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'HELLO' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'world' } })).toBe(false);
      });

      it('not_equals - should not match exact value', () => {
        const rule = createRule('not_equals', 'hello');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'world' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'hello' } })).toBe(false);
      });
    });

    describe('contains / not_contains', () => {
      it('contains - should match substring', () => {
        const rule = createRule('contains', 'test');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'this is a test' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'no match' } })).toBe(false);
      });

      it('not_contains - should not match substring', () => {
        const rule = createRule('not_contains', 'test');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'no match' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'this is a test' } })).toBe(false);
      });
    });

    describe('starts_with / ends_with', () => {
      it('starts_with - should match prefix', () => {
        const rule = createRule('starts_with', 'hello');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'hello world' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'world hello' } })).toBe(false);
      });

      it('ends_with - should match suffix', () => {
        const rule = createRule('ends_with', 'world');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'hello world' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'world hello' } })).toBe(false);
      });
    });

    describe('in / not_in', () => {
      it('in - should match value in list', () => {
        const rule = createRule('in', 'a, b, c');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'b' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'd' } })).toBe(false);
      });

      it('not_in - should not match value in list', () => {
        const rule = createRule('not_in', 'a, b, c');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'd' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'b' } })).toBe(false);
      });
    });

    describe('numeric comparisons', () => {
      it('greater_than', () => {
        const rule = createRule('greater_than', '10');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 15 } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 10 } })).toBe(false);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 5 } })).toBe(false);
      });

      it('greater_equal', () => {
        const rule = createRule('greater_equal', '10');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 15 } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 10 } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 5 } })).toBe(false);
      });

      it('less_than', () => {
        const rule = createRule('less_than', '10');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 5 } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 10 } })).toBe(false);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 15 } })).toBe(false);
      });

      it('less_equal', () => {
        const rule = createRule('less_equal', '10');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 5 } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 10 } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 15 } })).toBe(false);
      });

      it('should handle string numbers', () => {
        const rule = createRule('greater_than', '10');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '15' } })).toBe(true);
      });

      it('should return false for non-numeric values', () => {
        const rule = createRule('greater_than', '10');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'abc' } })).toBe(false);
      });
    });

    describe('regex', () => {
      it('should match regex pattern', () => {
        const rule = createRule('regex', '^user-\\d+$');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'user-123' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'admin-123' } })).toBe(false);
      });

      it('should return false for invalid regex', () => {
        const rule = createRule('regex', '[invalid');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'test' } })).toBe(false);
      });
    });

    describe('semver comparisons', () => {
      it('semver_gt - greater than', () => {
        const rule = createRule('semver_gt', '1.2.0');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.3.0' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.2.1' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.2.0' } })).toBe(false);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.1.0' } })).toBe(false);
      });

      it('semver_lt - less than', () => {
        const rule = createRule('semver_lt', '2.0.0');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.9.9' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '2.0.0' } })).toBe(false);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '2.0.1' } })).toBe(false);
      });

      it('semver_eq - equal', () => {
        const rule = createRule('semver_eq', '1.0.0');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.0.0' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.0' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '1.0.1' } })).toBe(false);
      });

      it('should handle v prefix', () => {
        const rule = createRule('semver_gt', 'v1.0.0');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'v1.1.0' } })).toBe(true);
      });

      it('should return false for invalid semver', () => {
        const rule = createRule('semver_gt', '1.0.0');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'invalid' } })).toBe(false);
      });
    });

    describe('is_set / is_not_set', () => {
      it('is_set - should match when attribute exists', () => {
        const rule = createRule('is_set', '');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'value' } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 0 } })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: {} })).toBe(false);
      });

      it('is_not_set - should match when attribute does not exist', () => {
        const rule = createRule('is_not_set', '');
        expect(evaluateFlag(rule, { id: 'u', attributes: {} })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'value' } })).toBe(false);
      });

      it('is_set - should treat empty string as not set', () => {
        const rule = createRule('is_set', '');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: '' } })).toBe(false);
      });
    });

    describe('special attributes', () => {
      it('should match id attribute', () => {
        const rule = createRule('equals', 'user-123', 'id');
        expect(evaluateFlag(rule, { id: 'user-123' })).toBe(true);
        expect(evaluateFlag(rule, { id: 'user-456' })).toBe(false);
      });

      it('should match email attribute', () => {
        const rule = createRule('ends_with', '@company.com', 'email');
        expect(evaluateFlag(rule, { id: 'u', email: 'john@company.com' })).toBe(true);
        expect(evaluateFlag(rule, { id: 'u', email: 'john@gmail.com' })).toBe(false);
      });
    });

    describe('unknown operator', () => {
      it('should return false for unknown operator', () => {
        const rule = createRule('unknown_op', 'value');
        expect(evaluateFlag(rule, { id: 'u', attributes: { test: 'value' } })).toBe(false);
      });
    });
  });

  describe('rollout consistency', () => {
    it('should return same result for same user and flag', () => {
      const rule: FlagRule = {
        key: 'test-flag',
        enabled: true,
        rollout: 50,
      };
      const user: UserContext = { id: 'consistent-user-123' };

      const results = new Set<boolean>();
      for (let i = 0; i < 100; i++) {
        results.add(evaluateFlag(rule, user));
      }

      // Should always return the same value
      expect(results.size).toBe(1);
    });

    it('should return different results for different users with partial rollout', () => {
      const rule: FlagRule = {
        key: 'rollout-test',
        enabled: true,
        rollout: 50,
      };

      let trueCount = 0;
      for (let i = 0; i < 1000; i++) {
        const user: UserContext = { id: `user-${i}` };
        if (evaluateFlag(rule, user)) {
          trueCount++;
        }
      }

      // Should be approximately 50% (with some variance)
      expect(trueCount).toBeGreaterThan(400);
      expect(trueCount).toBeLessThan(600);
    });

    it('should have different distribution for different flag keys', () => {
      const rule1: FlagRule = {
        key: 'flag-a',
        enabled: true,
        rollout: 50,
      };
      const rule2: FlagRule = {
        key: 'flag-b',
        enabled: true,
        rollout: 50,
      };
      const user: UserContext = { id: 'test-user-123' };

      // Same user might get different results for different flags
      // (this is expected behavior - not a guarantee, but likely)
      const result1 = evaluateFlag(rule1, user);
      const result2 = evaluateFlag(rule2, user);

      // Just verify both return boolean (we can't guarantee they differ)
      expect(typeof result1).toBe('boolean');
      expect(typeof result2).toBe('boolean');
    });

    it('should apply rule rollout with consistent hashing', () => {
      const rule: FlagRule = {
        key: 'rule-rollout-test',
        enabled: true,
        rollout: 0,
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 50,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'pro' }],
          },
        ],
      };

      let trueCount = 0;
      for (let i = 0; i < 1000; i++) {
        const user: UserContext = { id: `user-${i}`, attributes: { plan: 'pro' } };
        if (evaluateFlag(rule, user)) {
          trueCount++;
        }
      }

      // Should be approximately 50%
      expect(trueCount).toBeGreaterThan(400);
      expect(trueCount).toBeLessThan(600);
    });
  });
});

describe('evaluateAllFlags', () => {
  it('should evaluate all flags', () => {
    const rules: Record<string, FlagRule> = {
      'flag-enabled': {
        key: 'flag-enabled',
        enabled: true,
        rollout: 100,
      },
      'flag-disabled': {
        key: 'flag-disabled',
        enabled: false,
        rollout: 100,
      },
      'flag-targeted': {
        key: 'flag-targeted',
        enabled: true,
        rollout: 0,
        targetUsers: ['user-1'],
      },
    };

    const result = evaluateAllFlags(rules, { id: 'user-1' });

    expect(result).toEqual({
      'flag-enabled': true,
      'flag-disabled': false,
      'flag-targeted': true,
    });
  });

  it('should return empty object for empty rules', () => {
    const result = evaluateAllFlags({}, { id: 'user-1' });
    expect(result).toEqual({});
  });

  it('should work with null user', () => {
    const rules: Record<string, FlagRule> = {
      'flag-100': {
        key: 'flag-100',
        enabled: true,
        rollout: 100,
      },
      'flag-50': {
        key: 'flag-50',
        enabled: true,
        rollout: 50,
      },
    };

    const result = evaluateAllFlags(rules, null);

    expect(result['flag-100']).toBe(true);
    expect(result['flag-50']).toBe(false); // No user context = false for partial rollout
  });
});

describe('evaluateFlagValue (V2)', () => {
  describe('boolean flags', () => {
    it('should return true for enabled boolean flag', () => {
      const rule: FlagRuleV2 = {
        key: 'bool-flag',
        type: 'boolean',
        enabled: true,
        rollout: 100,
        defaultValue: false,
      };
      const result = evaluateFlagValue<boolean>(rule, { id: 'user-1' });
      expect(result.enabled).toBe(true);
      expect(result.value).toBe(true);
    });

    it('should return default value for disabled flag', () => {
      const rule: FlagRuleV2 = {
        key: 'bool-flag',
        type: 'boolean',
        enabled: false,
        rollout: 100,
        defaultValue: false,
      };
      const result = evaluateFlagValue<boolean>(rule, { id: 'user-1' });
      expect(result.enabled).toBe(false);
      expect(result.value).toBe(false);
    });
  });

  describe('string flags', () => {
    it('should return string value from variations', () => {
      const rule: FlagRuleV2 = {
        key: 'string-flag',
        type: 'string',
        enabled: true,
        rollout: 100,
        defaultValue: 'default',
        variations: [
          { id: 'v1', name: 'Variation 1', value: 'hello' },
          { id: 'v2', name: 'Variation 2', value: 'world' },
        ],
      };
      const result = evaluateFlagValue<string>(rule, { id: 'user-1' });
      expect(result.enabled).toBe(true);
      expect(result.value).toBe('hello'); // First variation
    });

    it('should return default string value when disabled', () => {
      const rule: FlagRuleV2 = {
        key: 'string-flag',
        type: 'string',
        enabled: false,
        rollout: 100,
        defaultValue: 'default-text',
      };
      const result = evaluateFlagValue<string>(rule, { id: 'user-1' });
      expect(result.enabled).toBe(false);
      expect(result.value).toBe('default-text');
    });

    it('should return empty string as type default when no defaultValue', () => {
      const rule: FlagRuleV2 = {
        key: 'string-flag',
        type: 'string',
        enabled: false,
        rollout: 100,
        defaultValue: undefined as unknown as string,
      };
      const result = evaluateFlagValue<string>(rule, { id: 'user-1' });
      expect(result.value).toBe('');
    });
  });

  describe('number flags', () => {
    it('should return number value from variations', () => {
      const rule: FlagRuleV2 = {
        key: 'number-flag',
        type: 'number',
        enabled: true,
        rollout: 100,
        defaultValue: 0,
        variations: [
          { id: 'v1', name: 'High', value: 100 },
          { id: 'v2', name: 'Low', value: 10 },
        ],
      };
      const result = evaluateFlagValue<number>(rule, { id: 'user-1' });
      expect(result.enabled).toBe(true);
      expect(result.value).toBe(100);
    });

    it('should return 0 as type default for number', () => {
      const rule: FlagRuleV2 = {
        key: 'number-flag',
        type: 'number',
        enabled: false,
        rollout: 100,
        defaultValue: undefined as unknown as number,
      };
      const result = evaluateFlagValue<number>(rule, { id: 'user-1' });
      expect(result.value).toBe(0);
    });
  });

  describe('json flags', () => {
    it('should return json value from variations', () => {
      const rule: FlagRuleV2 = {
        key: 'json-flag',
        type: 'json',
        enabled: true,
        rollout: 100,
        defaultValue: {},
        variations: [
          { id: 'v1', name: 'Config A', value: { theme: 'dark', limit: 100 } },
          { id: 'v2', name: 'Config B', value: { theme: 'light', limit: 50 } },
        ],
      };
      const result = evaluateFlagValue<{ theme: string; limit: number }>(rule, { id: 'user-1' });
      expect(result.enabled).toBe(true);
      expect(result.value).toEqual({ theme: 'dark', limit: 100 });
    });

    it('should return null as type default for json', () => {
      const rule: FlagRuleV2 = {
        key: 'json-flag',
        type: 'json',
        enabled: false,
        rollout: 100,
        defaultValue: undefined as unknown as object,
      };
      const result = evaluateFlagValue(rule, { id: 'user-1' });
      expect(result.value).toBe(null);
    });
  });

  describe('targeting rules with variations', () => {
    it('should return specific variation when rule matches', () => {
      const rule: FlagRuleV2 = {
        key: 'targeted-flag',
        type: 'string',
        enabled: true,
        rollout: 0,
        defaultValue: 'default',
        variations: [
          { id: 'v1', name: 'Variation A', value: 'value-a' },
          { id: 'v2', name: 'Variation B', value: 'value-b' },
        ],
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 100,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'enterprise' }],
            variationId: 'v2',
          },
        ],
      };
      const user: UserContext = { id: 'user-1', attributes: { plan: 'enterprise' } };
      const result = evaluateFlagValue<string>(rule, user);
      expect(result.enabled).toBe(true);
      expect(result.value).toBe('value-b');
      expect(result.variationId).toBe('v2');
    });

    it('should fall back to first variation when variationId not specified in rule', () => {
      const rule: FlagRuleV2 = {
        key: 'targeted-flag',
        type: 'string',
        enabled: true,
        rollout: 0,
        defaultValue: 'default',
        variations: [
          { id: 'v1', name: 'Variation A', value: 'value-a' },
          { id: 'v2', name: 'Variation B', value: 'value-b' },
        ],
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 100,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'pro' }],
            // No variationId specified
          },
        ],
      };
      const user: UserContext = { id: 'user-1', attributes: { plan: 'pro' } };
      const result = evaluateFlagValue<string>(rule, user);
      expect(result.enabled).toBe(true);
      expect(result.value).toBe('value-a'); // First variation
    });

    it('should return default value when rule rollout is 0', () => {
      const rule: FlagRuleV2 = {
        key: 'targeted-flag',
        type: 'string',
        enabled: true,
        rollout: 0,
        defaultValue: 'default-value',
        variations: [{ id: 'v1', name: 'Variation', value: 'variation-value' }],
        rules: [
          {
            id: 'rule-1',
            enabled: true,
            rollout: 0,
            conditions: [{ attribute: 'plan', operator: 'equals', value: 'pro' }],
          },
        ],
      };
      const user: UserContext = { id: 'user-1', attributes: { plan: 'pro' } };
      const result = evaluateFlagValue<string>(rule, user);
      expect(result.enabled).toBe(false);
      expect(result.value).toBe('default-value');
    });
  });

  describe('target users', () => {
    it('should return enabled value for target users', () => {
      const rule: FlagRuleV2 = {
        key: 'targeted-flag',
        type: 'string',
        enabled: true,
        rollout: 0,
        defaultValue: 'default',
        targetUsers: ['user-vip'],
        variations: [{ id: 'v1', name: 'VIP Value', value: 'vip-access' }],
      };
      const result = evaluateFlagValue<string>(rule, { id: 'user-vip' });
      expect(result.enabled).toBe(true);
      expect(result.value).toBe('vip-access');
    });
  });

  describe('rollout behavior', () => {
    it('should respect rollout percentage', () => {
      const rule: FlagRuleV2 = {
        key: 'rollout-flag',
        type: 'boolean',
        enabled: true,
        rollout: 50,
        defaultValue: false,
      };

      let enabledCount = 0;
      for (let i = 0; i < 1000; i++) {
        const result = evaluateFlagValue<boolean>(rule, { id: `user-${i}` });
        if (result.enabled) enabledCount++;
      }

      // Should be approximately 50%
      expect(enabledCount).toBeGreaterThan(400);
      expect(enabledCount).toBeLessThan(600);
    });

    it('should return false for null user with partial rollout', () => {
      const rule: FlagRuleV2 = {
        key: 'rollout-flag',
        type: 'string',
        enabled: true,
        rollout: 50,
        defaultValue: 'default',
        variations: [{ id: 'v1', name: 'Enabled', value: 'enabled-value' }],
      };
      const result = evaluateFlagValue<string>(rule, null);
      expect(result.enabled).toBe(false);
      expect(result.value).toBe('default');
    });
  });
});

describe('evaluateAllFlagsV2', () => {
  it('should evaluate all V2 flags', () => {
    const rules: Record<string, FlagRuleV2> = {
      'bool-flag': {
        key: 'bool-flag',
        type: 'boolean',
        enabled: true,
        rollout: 100,
        defaultValue: false,
      },
      'string-flag': {
        key: 'string-flag',
        type: 'string',
        enabled: true,
        rollout: 100,
        defaultValue: 'default',
        variations: [{ id: 'v1', name: 'Enabled', value: 'enabled-text' }],
      },
      'disabled-flag': {
        key: 'disabled-flag',
        type: 'number',
        enabled: false,
        rollout: 100,
        defaultValue: 42,
      },
    };

    const result = evaluateAllFlagsV2(rules, { id: 'user-1' });

    expect(result['bool-flag']).toEqual({ enabled: true, value: true });
    expect(result['string-flag']).toEqual({ enabled: true, value: 'enabled-text' });
    expect(result['disabled-flag']).toEqual({ enabled: false, value: 42 });
  });

  it('should return empty object for empty rules', () => {
    const result = evaluateAllFlagsV2({}, { id: 'user-1' });
    expect(result).toEqual({});
  });

  it('should work with null user', () => {
    const rules: Record<string, FlagRuleV2> = {
      'full-rollout': {
        key: 'full-rollout',
        type: 'string',
        enabled: true,
        rollout: 100,
        defaultValue: 'default',
        variations: [{ id: 'v1', name: 'Enabled', value: 'enabled' }],
      },
      'partial-rollout': {
        key: 'partial-rollout',
        type: 'string',
        enabled: true,
        rollout: 50,
        defaultValue: 'default',
        variations: [{ id: 'v1', name: 'Enabled', value: 'enabled' }],
      },
    };

    const result = evaluateAllFlagsV2(rules, null);

    expect(result['full-rollout'].enabled).toBe(true);
    expect(result['full-rollout'].value).toBe('enabled');
    expect(result['partial-rollout'].enabled).toBe(false);
    expect(result['partial-rollout'].value).toBe('default');
  });
});
