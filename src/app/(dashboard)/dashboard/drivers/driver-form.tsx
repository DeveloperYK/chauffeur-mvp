import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { CAR_LABEL, TIER_LABEL } from '@/lib/labels';
import type { Driver } from '@/server/db/schema';

interface DriverFormProps {
  action: (formData: FormData) => void | Promise<void>;
  driver?: Driver;
  submitLabel?: string;
}

export function DriverForm({ action, driver, submitLabel }: DriverFormProps) {
  return (
    <form action={action} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {driver ? <input type="hidden" name="id" value={driver.id} /> : null}

      <Field label="Driver name" required className="md:col-span-2">
        <Input
          type="text"
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={driver?.name ?? ''}
          placeholder="e.g. Tom Smith"
        />
      </Field>

      <Field label="Tier" required>
        <Select name="tier" required defaultValue={driver?.tier ?? 'ordinary'}>
          <option value="premium">{TIER_LABEL.premium}</option>
          <option value="ordinary">{TIER_LABEL.ordinary}</option>
        </Select>
      </Field>

      <Field label="Default vehicle" required>
        <Select name="defaultCarType" required defaultValue={driver?.defaultCarType ?? 's_class'}>
          <option value="ex">{CAR_LABEL.ex}</option>
          <option value="s_class">{CAR_LABEL.s_class}</option>
          <option value="mpv">{CAR_LABEL.mpv}</option>
          <option value="mini_bus">{CAR_LABEL.mini_bus}</option>
        </Select>
      </Field>

      <Field
        label="WhatsApp number"
        required
        helper="International format, with country code: e.g. +44 7911 123 456."
        className="md:col-span-2"
      >
        <Input
          type="tel"
          name="whatsappNumber"
          required
          placeholder="+44 7911 123 456"
          defaultValue={driver?.whatsappNumber ?? ''}
        />
      </Field>

      <div className="md:col-span-2 flex justify-end border-t border-border pt-4">
        <Button variant="primary" type="submit">
          {submitLabel ?? (driver ? 'Save changes' : 'Add driver')}
        </Button>
      </div>
    </form>
  );
}
