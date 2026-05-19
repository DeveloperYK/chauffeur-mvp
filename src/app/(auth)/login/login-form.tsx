import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { loginAction } from './actions';

const errorMessages: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  validation: 'Please fill out both fields.',
  config: 'Server not configured. Contact your administrator.',
};

export function LoginForm({ errorCode }: { errorCode: string | undefined }) {
  const message = errorCode ? (errorMessages[errorCode] ?? 'Sign in failed.') : null;
  return (
    <form action={loginAction} className="flex flex-col gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <Field label="Email" required>
        <Input type="email" name="email" autoComplete="username" required />
      </Field>
      <Field label="Password" required helper="At least 12 characters.">
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={12}
        />
      </Field>
      <Button variant="primary" type="submit" className="mt-2">
        Sign in
      </Button>
    </form>
  );
}
