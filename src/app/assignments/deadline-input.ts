const vietNam = 7 * 60 * 60 * 1_000;

export function deadlineField(value: string | null | undefined) {
  if (!value) return '';
  return new Date(new Date(value).getTime() + vietNam).toISOString().slice(0,16);
}

export function deadlineValue(value: string) {
  if (!value) return null;
  return new Date(`${value}:00+07:00`).toISOString();
}

export const deadlineFormat = new Intl.DateTimeFormat('vi-VN',{
  dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Ho_Chi_Minh'
});
