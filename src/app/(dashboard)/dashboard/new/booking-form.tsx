'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { zodResolver } from '@hookform/resolvers/zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { useRouter } from 'next/navigation';
import type { InputHTMLAttributes, RefObject } from 'react';
import { forwardRef, useEffect, useRef, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createBookingAction } from './actions';

interface AddressInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'ref'> {
  inputRef?: RefObject<HTMLInputElement | null>;
}

const AddressInput = forwardRef<HTMLInputElement, AddressInputProps>(function AddressInput(
  { inputRef, ...props },
  formRef,
) {
  const localRef = useRef<HTMLInputElement | null>(null);

  return (
    <input
      {...props}
      ref={(el) => {
        localRef.current = el;
        if (inputRef) {
          (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }
        if (typeof formRef === 'function') {
          formRef(el);
        } else if (formRef) {
          formRef.current = el;
        }
      }}
      className="form-input w-full"
    />
  );
});

const phoneSchema = z
  .string()
  .min(7, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .refine((v) => parsePhoneNumberFromString(v)?.isValid() ?? false, {
    message: 'Invalid phone number — include country code (e.g. +44 7911 123456)',
  });

const bookingFormSchema = z.object({
  pickupAt: z.string().min(1, 'Pickup date/time is required'),
  expectedDurationMinutes: z.coerce
    .number({ invalid_type_error: 'Duration must be a number' })
    .int('Duration must be a whole number')
    .min(15, 'Duration must be at least 15 minutes')
    .max(720, 'Duration cannot exceed 720 minutes (12 hours)'),
  pickupAddress: z
    .string()
    .min(3, 'Pickup address must be at least 3 characters')
    .max(500, 'Pickup address is too long'),
  dropoffAddress: z
    .string()
    .min(3, 'Drop-off address must be at least 3 characters')
    .max(500, 'Drop-off address is too long'),
  passengerFirstName: z.string().min(1, 'First name is required').max(80, 'First name is too long'),
  passengerLastName: z.string().max(80, 'Last name is too long').optional(),
  execMobile: phoneSchema,
  customerAccount: z
    .string()
    .min(1, 'Customer account is required')
    .max(120, 'Customer account is too long'),
  caseCode: z.string().min(1, 'Case code is required').max(60, 'Case code is too long'),
  contractPricePounds: z.coerce
    .number({ invalid_type_error: 'Price must be a number' })
    .min(0, 'Price cannot be negative')
    .max(10000, 'Price cannot exceed £10,000'),
  notes: z.string().max(2000, 'Notes are too long').optional(),
  assignedDriverId: z.string().optional(),
  markAsAccepted: z.boolean().optional(),
});

type BookingFormData = z.infer<typeof bookingFormSchema>;

interface Driver {
  id: string;
  name: string;
  tier: 'premium' | 'ordinary';
  defaultCarType: string;
}

interface BookingFormProps {
  drivers: Driver[];
  error?: string | undefined;
}

export function BookingForm({ drivers, error: serverError }: BookingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pickupRef = useRef<HTMLInputElement>(null);
  const dropoffRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BookingFormData>({
    resolver: zodResolver(bookingFormSchema),
    mode: 'onBlur',
    defaultValues: {
      expectedDurationMinutes: 90,
      contractPricePounds: 0,
      markAsAccepted: false,
    },
  });

  const selectedDriverId = watch('assignedDriverId');
  const showAcceptedCheckbox = selectedDriverId && selectedDriverId !== '';

  // Google Places Autocomplete initialization
  useEffect(() => {
    if (typeof window === 'undefined' || !window.google?.maps?.places) return;

    const options = {
      componentRestrictions: { country: 'gb' },
      fields: ['formatted_address'],
    };

    if (pickupRef.current) {
      const pickupAutocomplete = new window.google.maps.places.Autocomplete(
        pickupRef.current,
        options,
      );
      pickupAutocomplete.addListener('place_changed', () => {
        const place = pickupAutocomplete.getPlace();
        if (place.formatted_address) {
          setValue('pickupAddress', place.formatted_address, { shouldValidate: true });
        }
      });
    }

    if (dropoffRef.current) {
      const dropoffAutocomplete = new window.google.maps.places.Autocomplete(
        dropoffRef.current,
        options,
      );
      dropoffAutocomplete.addListener('place_changed', () => {
        const place = dropoffAutocomplete.getPlace();
        if (place.formatted_address) {
          setValue('dropoffAddress', place.formatted_address, { shouldValidate: true });
        }
      });
    }
  }, [setValue]);

  const onSubmit = (data: BookingFormData) => {
    setSubmitError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('pickupAt', data.pickupAt);
      formData.set('expectedDurationMinutes', String(data.expectedDurationMinutes));
      formData.set('pickupAddress', data.pickupAddress);
      formData.set('dropoffAddress', data.dropoffAddress);
      formData.set('passengerFirstName', data.passengerFirstName);
      formData.set('passengerLastName', data.passengerLastName ?? '');
      formData.set('execMobile', data.execMobile);
      formData.set('customerAccount', data.customerAccount);
      formData.set('caseCode', data.caseCode);
      formData.set('contractPricePounds', String(data.contractPricePounds));
      formData.set('notes', data.notes ?? '');
      if (data.assignedDriverId) {
        formData.set('assignedDriverId', data.assignedDriverId);
      }
      formData.set('markAsAccepted', data.markAsAccepted ? 'true' : 'false');

      const result = await createBookingAction(formData);
      if (result.error) {
        setSubmitError(result.error);
      } else {
        router.push('/dashboard');
      }
    });
  };

  const displayError = submitError || serverError;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {displayError ? (
        <Alert tone="danger" className="md:col-span-2">
          {displayError}
        </Alert>
      ) : null}

      <Field
        label="Customer account"
        required
        error={errors.customerAccount?.message}
        helper="The company the trip is billed to — not the passenger."
      >
        <Input
          type="text"
          {...register('customerAccount')}
          placeholder="e.g. LEGO Group, Mercedes-Benz UK"
          aria-invalid={!!errors.customerAccount}
        />
      </Field>

      <Field
        label="Case code"
        required
        error={errors.caseCode?.message}
        helper="Expense code the customer's company uses to cover the cost."
      >
        <Input
          type="text"
          {...register('caseCode')}
          placeholder="e.g. LEGO-2026-0142"
          aria-invalid={!!errors.caseCode}
        />
      </Field>

      <Field
        label="Pickup date and time"
        required
        error={errors.pickupAt?.message}
        helper="Local UK time"
      >
        <Input type="datetime-local" {...register('pickupAt')} aria-invalid={!!errors.pickupAt} />
      </Field>

      <Field
        label="Expected duration (minutes)"
        required
        error={errors.expectedDurationMinutes?.message}
        helper="Between 15 and 720 minutes"
      >
        <Input
          type="number"
          {...register('expectedDurationMinutes')}
          min={15}
          max={720}
          aria-invalid={!!errors.expectedDurationMinutes}
        />
      </Field>

      <Field label="Contract price (£)" required error={errors.contractPricePounds?.message}>
        <Input
          type="number"
          {...register('contractPricePounds')}
          step="0.01"
          min={0}
          max={10000}
          aria-invalid={!!errors.contractPricePounds}
        />
      </Field>

      <Field
        label="Pickup address"
        required
        error={errors.pickupAddress?.message}
        className="md:col-span-2"
      >
        <AddressInput
          {...register('pickupAddress')}
          inputRef={pickupRef}
          placeholder="Start typing an address..."
          aria-invalid={!!errors.pickupAddress}
        />
      </Field>

      <Field
        label="Drop-off address"
        required
        error={errors.dropoffAddress?.message}
        className="md:col-span-2"
      >
        <AddressInput
          {...register('dropoffAddress')}
          inputRef={dropoffRef}
          placeholder="Start typing an address..."
          aria-invalid={!!errors.dropoffAddress}
        />
      </Field>

      <Field label="Passenger first name" required error={errors.passengerFirstName?.message}>
        <Input
          type="text"
          {...register('passengerFirstName')}
          aria-invalid={!!errors.passengerFirstName}
        />
      </Field>

      <Field label="Passenger last name" error={errors.passengerLastName?.message}>
        <Input
          type="text"
          {...register('passengerLastName')}
          aria-invalid={!!errors.passengerLastName}
        />
      </Field>

      <Field
        label="Executive mobile"
        required
        error={errors.execMobile?.message}
        helper="International format with country code: e.g. +44 7911 123 456"
        className="md:col-span-2"
      >
        <Input
          type="tel"
          {...register('execMobile')}
          placeholder="+44 7911 123 456"
          aria-invalid={!!errors.execMobile}
        />
      </Field>

      <Field label="Notes" helper="Optional — special requests, flight number, etc.">
        <Textarea {...register('notes')} rows={3} aria-invalid={!!errors.notes} />
      </Field>

      <div className="flex flex-col gap-2">
        <Field label="Assign driver" helper="Optional — assign a driver now">
          <Select {...register('assignedDriverId')} defaultValue="">
            <option value="">— Select a driver (optional) —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.tier === 'premium' ? '★ ' : ''}
                {d.name} · {d.defaultCarType}
              </option>
            ))}
          </Select>
        </Field>

        {showAcceptedCheckbox ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...register('markAsAccepted')}
              className="form-checkbox h-4 w-4 rounded border-border text-primary-600"
            />
            <span>Mark as accepted by driver</span>
          </label>
        ) : null}
      </div>

      <div className="md:col-span-2 flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" type="button" onClick={() => router.push('/dashboard')}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={isPending}>
          {isPending ? 'Creating...' : 'Create booking'}
        </Button>
      </div>
    </form>
  );
}
