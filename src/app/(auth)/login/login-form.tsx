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
    <form action={loginAction} style={{ display: 'grid', gap: '0.75rem' }}>
      {message ? (
        <div
          role="alert"
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: 6,
            background: '#7f1d1d',
            color: '#fee2e2',
            fontSize: 14,
          }}
        >
          {message}
        </div>
      ) : null}
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 13 }}>Email</span>
        <input type="email" name="email" autoComplete="username" required style={inputStyle} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 13 }}>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={12}
          style={inputStyle}
        />
      </label>
      <button
        type="submit"
        style={{
          marginTop: 8,
          padding: '0.6rem',
          borderRadius: 6,
          border: 'none',
          background: '#2563eb',
          color: 'white',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Sign in
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#f8fafc',
};
