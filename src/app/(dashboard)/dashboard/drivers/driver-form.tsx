import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { VEHICLE_CLASS_LABEL } from '@/lib/labels';
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

      <Field label="Type" required>
        <Select name="vehicleClass" required defaultValue={driver?.vehicleClass ?? 'executive'}>
          <option value="executive">{VEHICLE_CLASS_LABEL.executive}</option>
          <option value="luxury">{VEHICLE_CLASS_LABEL.luxury}</option>
          <option value="mpv">{VEHICLE_CLASS_LABEL.mpv}</option>
          <option value="coach">{VEHICLE_CLASS_LABEL.coach}</option>
        </Select>
      </Field>

      <div className="md:col-span-2 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Car" required helper="The make and model the exec will look for.">
          <Input
            type="text"
            name="car"
            required
            maxLength={80}
            placeholder="e.g. Mercedes S-Class, BMW X5"
            defaultValue={driver?.car ?? ''}
          />
        </Field>

        <Field label="Car colour" required>
          <Input
            type="text"
            name="carColour"
            required
            maxLength={40}
            placeholder="e.g. Black"
            defaultValue={driver?.carColour ?? ''}
          />
        </Field>
      </div>

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
