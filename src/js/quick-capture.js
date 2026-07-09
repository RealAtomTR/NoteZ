const form = document.getElementById('quick-capture-form');
const input = document.getElementById('quick-capture-input');
const statusEl = document.getElementById('quick-capture-status');
const saveBtn = document.getElementById('quick-capture-save');
const closeBtn = document.getElementById('quick-capture-close');
const cancelBtn = document.getElementById('quick-capture-cancel');

function closeWindow() {
  window.close();
}

async function saveQuickCapture() {
  const content = input.value.trim();
  if (!content) {
    statusEl.textContent = 'Not içeriği boş olamaz.';
    input.focus();
    return;
  }

  saveBtn.disabled = true;
  statusEl.textContent = 'Kaydediliyor...';

  try {
    const result = await window.electronAPI.quickCaptureSave(content);
    if (!result || !result.success) {
      statusEl.textContent = result?.error || 'Kaydedilemedi.';
      saveBtn.disabled = false;
      return;
    }

    input.value = '';
    statusEl.textContent = 'Yapılacaklar içine eklendi.';
    setTimeout(closeWindow, 250);
  } catch (error) {
    statusEl.textContent = 'Kaydedilemedi.';
    saveBtn.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  saveQuickCapture();
});

input.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    saveQuickCapture();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeWindow();
  }
});

closeBtn.addEventListener('click', closeWindow);
cancelBtn.addEventListener('click', closeWindow);

window.addEventListener('DOMContentLoaded', () => {
  input.focus();
});
