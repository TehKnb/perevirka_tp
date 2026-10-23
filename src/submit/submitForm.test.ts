import { describe, expect, it } from 'vitest';
import { formErrors, validateSubmitForm } from './submitForm';

const ok = { name: 'Іван Петренко', stream: 'Потік 1', agreed: true };

describe('validateSubmitForm', () => {
  it('заповнена форма — без помилок', () => {
    expect(validateSubmitForm(ok)).toEqual({});
    expect(validateSubmitForm({ ...ok, name: "  Мар'яна   Іванова-Петренко " })).toEqual({});
  });
  it('ім’я: порожнє, одне слово, лише символи', () => {
    expect(validateSubmitForm({ ...ok, name: '   ' }).name).toBe(formErrors.nameEmpty);
    expect(validateSubmitForm({ ...ok, name: 'Іван' }).name).toBe(formErrors.nameOneWord);
    expect(validateSubmitForm({ ...ok, name: 'Іван -' }).name).toBe(formErrors.nameOneWord);
  });
  it('потік і згода обов’язкові', () => {
    expect(validateSubmitForm({ ...ok, stream: '   ' }).stream).toBe(formErrors.stream);
    const e = validateSubmitForm({ ...ok, stream: '', agreed: false });
    expect(e.stream).toBe(formErrors.stream);
    expect(e.agreed).toBe(formErrors.agreed);
  });
});
