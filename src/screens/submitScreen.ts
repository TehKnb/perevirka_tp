import { config } from '../config';
import { submitResults, validateSubmitForm, type Submission, type SubmitFormValues } from '../submit/submitForm';
import { requirementsList, t } from '../texts';
import { byId } from '../ui/dom';

/**
 * Екран 4: коротка форма (ім'я та прізвище, потік, згода з вимогами) і відправка.
 * Поки тестовий режим: submitResults нічого не надсилає.
 */
export function createSubmitScreen(opts: {
  /** Дані для відправки, крім полів форми. */
  collect: () => Omit<Submission, 'name' | 'stream' | 'submittedAt'>;
  onBack: () => void;
  onDone: () => void;
}) {
  const form = byId<HTMLFormElement>('submit-form');
  const name = byId<HTMLInputElement>('f-name');
  const stream = byId<HTMLInputElement>('f-stream');
  const agree = byId<HTMLInputElement>('f-agree');
  const submitError = byId('submit-error');
  const btnSubmit = byId<HTMLButtonElement>('btn-submit');
  const btnLabel = btnSubmit.querySelector<HTMLElement>('.btn-label')!;
  const dialog = byId<HTMLDialogElement>('requirements-dialog');

  byId('requirements-list').replaceChildren(
    ...requirementsList({ ...config.camera, ...config.network }).map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
  byId('btn-requirements').addEventListener('click', () => dialog.showModal());
  byId('btn-submit-back').addEventListener('click', () => opts.onBack());

  const fields = { name, stream, agreed: agree } as const;

  function values(): SubmitFormValues {
    return { name: name.value, stream: stream.value, agreed: agree.checked };
  }

  function showErrors(errors: ReturnType<typeof validateSubmitForm>) {
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      const el = fields[key];
      const box = byId(`${el.id}-error`);
      const message = errors[key];
      box.textContent = message ?? '';
      box.hidden = !message;
      el.toggleAttribute('aria-invalid', Boolean(message));
    }
  }

  // Після першої спроби відправити помилки оновлюються одразу під час введення.
  let tried = false;
  form.addEventListener('input', () => {
    if (tried) showErrors(validateSubmitForm(values()));
  });
  form.addEventListener('change', () => {
    if (tried) showErrors(validateSubmitForm(values()));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    tried = true;
    submitError.hidden = true;
    const v = values();
    const errors = validateSubmitForm(v);
    showErrors(errors);
    const firstInvalid = (Object.keys(fields) as (keyof typeof fields)[]).find((k) => errors[k]);
    if (firstInvalid) {
      fields[firstInvalid].focus();
      return;
    }

    btnSubmit.disabled = true;
    btnLabel.textContent = t.submit.sending;
    try {
      await submitResults({
        ...opts.collect(),
        name: v.name.trim().replace(/\s+/g, ' '),
        stream: v.stream.trim().replace(/\s+/g, ' '),
        submittedAt: new Date().toISOString(),
      }, config.submit);
      opts.onDone();
    } catch (err) {
      console.error('Не вдалося надіслати результати', err);
      submitError.textContent = t.submit.sendError;
      submitError.hidden = false;
    } finally {
      btnSubmit.disabled = false;
      btnLabel.textContent = t.submit.send;
    }
  });

  return {
    enter() {
      name.focus();
    },
  };
}
