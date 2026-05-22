# Contract Tests

Contract tests verify that in-memory test doubles (fakes) behave identically to their real implementations.

## Purpose

When we use `FakeNotificationAdapter` instead of `TwilioNotificationAdapter` in tests, we need confidence that:

1. The fake validates inputs the same way the real adapter does
2. The fake returns the same response shapes for the same inputs
3. Tests using the fake will catch the same bugs as tests using the real adapter

## Structure

Each port has three files:

```
tests/contracts/
├── notification.contract.ts          # Shared test cases
├── notification-fake.test.ts         # Runs contract against fake
├── notification-twilio.test.ts       # Runs contract against real (with mocked HTTP)
├── spreadsheet-mirror.contract.ts
├── spreadsheet-mirror-fake.test.ts
├── spreadsheet-mirror-google.test.ts
└── README.md
```

## Writing Contract Tests

1. Define the expected behaviors in `<port>.contract.ts`
2. Create test files that run the contract against each implementation
3. For real adapters, mock only the HTTP layer (using `fetchImpl` injection)

Example:

```typescript
// notification.contract.ts
export function notificationContractTests(
  createAdapter: () => NotificationPort,
  cleanup?: () => void,
) {
  describe('NotificationPort contract', () => {
    it('returns ok:true for valid E.164 number', async () => {
      const adapter = createAdapter();
      const result = await adapter.sendSms({
        to: '+447911123456',
        body: 'Test',
      });
      expect(result.ok).toBe(true);
    });

    // ... more tests
  });
}
```

## Running Contract Tests

```bash
# Run all contract tests
pnpm test tests/contracts

# Run specific adapter
pnpm test tests/contracts/notification-fake.test.ts
```

## When to Update Contracts

Update contracts when:
- A port interface changes
- A new validation rule is added
- Behavior differences are discovered between fake and real

Contract tests should fail if:
- The fake doesn't validate inputs correctly
- The fake returns different response shapes
- The real adapter's behavior changes

## No Mocking Policy

Contract tests are the ONLY place where `vi.fn()` may be used to mock fetch.
This is necessary because we cannot make real HTTP calls to external services in tests.

All other tests use the in-memory doubles (fakes) directly without any mocking.
