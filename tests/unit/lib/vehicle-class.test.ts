import { VEHICLE_CLASSES, VEHICLE_CLASS_LABEL, VEHICLE_CLASS_SHORT } from '@/lib/labels';
import { describe, expect, it } from 'vitest';

describe('vehicle classes', () => {
  it('lists the six JJ classes in roster order', () => {
    expect(VEHICLE_CLASSES).toEqual(['executive', 'vip', 'mpv_s', 'mpv_l', 'e_car', 'coach']);
  });

  it('has a full label and a short pill label for every class', () => {
    expect(VEHICLE_CLASSES.map((c) => VEHICLE_CLASS_LABEL[c])).toEqual([
      'Executive',
      'VIP – S Class',
      'MPV S – 7 Seater',
      'MPV L – 8 Seater',
      'E Car – Electric Only',
      'Coach',
    ]);
    expect(VEHICLE_CLASSES.map((c) => VEHICLE_CLASS_SHORT[c])).toEqual([
      'Executive',
      'VIP',
      'MPV S',
      'MPV L',
      'E Car',
      'Coach',
    ]);
  });
});
