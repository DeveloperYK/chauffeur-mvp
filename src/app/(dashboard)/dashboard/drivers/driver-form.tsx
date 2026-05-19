import type { Driver } from '@/server/db/schema';

interface DriverFormProps {
  action: (formData: FormData) => void | Promise<void>;
  driver?: Driver;
  error: string | undefined;
}

export function DriverForm({ action, driver, error }: DriverFormProps) {
  return (
    <form action={action} style={{ display: 'grid', gap: '0.75rem' }}>
      {error ? (
        <div
          role="alert"
          style={{
            padding: '0.5rem 0.75rem',
            background: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: 6,
          }}
        >
          {decodeURIComponent(error)}
        </div>
      ) : null}
      {driver ? <input type="hidden" name="id" value={driver.id} /> : null}
      <Row label="Name">
        <input
          type="text"
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={driver?.name ?? ''}
          style={input}
        />
      </Row>
      <Row label="Tier">
        <select name="tier" required defaultValue={driver?.tier ?? 'ordinary'} style={input}>
          <option value="premium">Premium</option>
          <option value="ordinary">Ordinary</option>
        </select>
      </Row>
      <Row label="Default car type">
        <select
          name="defaultCarType"
          required
          defaultValue={driver?.defaultCarType ?? 's_class'}
          style={input}
        >
          <option value="ex">EX</option>
          <option value="s_class">S Class</option>
          <option value="mpv">MPV</option>
          <option value="mini_bus">Mini Bus</option>
        </select>
      </Row>
      <Row label="WhatsApp number (international format, with country code)">
        <input
          type="tel"
          name="whatsappNumber"
          required
          placeholder="+44 7911 123 456"
          defaultValue={driver?.whatsappNumber ?? ''}
          style={input}
        />
      </Row>
      <button
        type="submit"
        style={{
          marginTop: '0.5rem',
          padding: '0.6rem 1rem',
          borderRadius: 6,
          background: '#0f172a',
          color: 'white',
          border: 'none',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {driver ? 'Save changes' : 'Add driver'}
      </button>
    </form>
  );
}

const input: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 14,
  width: '100%',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 13, color: '#334155' }}>{label}</span>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: control rendered via children */}
      <label style={{ display: 'contents' }}>{children}</label>
    </div>
  );
}
