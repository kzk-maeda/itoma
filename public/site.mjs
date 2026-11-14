const dialog = document.querySelector('#demo-contact');
let opener;
document.querySelectorAll('[data-contact]').forEach(button => button.addEventListener('click', () => {
  opener = button;
  dialog.showModal();
  dialog.querySelector('button').focus();
}));
function close() { dialog.close(); opener?.focus(); }
dialog?.querySelector('[data-close]').addEventListener('click', close);
dialog?.addEventListener('cancel', event => { event.preventDefault(); close(); });
// This study has no analytics, form submissions, storage or remote requests.
