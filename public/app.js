const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard-section');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const statusText = document.getElementById('status-text');
const ramSlider = document.getElementById('ram-slider');
const ramValue = document.getElementById('ram-value');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const logoutButton = document.getElementById('logout-button');
const controlMessage = document.getElementById('control-message');
const propertiesList = document.getElementById('properties-list');
const saveProperties = document.getElementById('save-properties');
const propertiesMessage = document.getElementById('properties-message');
const consoleEl = document.getElementById('console');
const pathInput = document.getElementById('path-input');
const refreshFiles = document.getElementById('refresh-files');
const fileTableBody = document.getElementById('file-table-body');
const filesMessage = document.getElementById('files-message');
const uploadButton = document.getElementById('upload-file');
const fileInput = document.getElementById('file-input');

let logStream = null;

function setStatus(message) {
  statusText.textContent = `Status: ${message}`;
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Request failed');
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function checkAuth() {
  try {
    await request('/api/me');
    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    await loadDashboard();
  } catch (error) {
    loginSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  const formData = new FormData(loginForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    await request('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    await loadDashboard();
  } catch (error) {
    showMessage(loginError, error.message, true);
  }
});

logoutButton.addEventListener('click', async () => {
  await request('/api/logout', { method: 'POST' });
  loginSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
  if (logStream) {
    logStream.close();
    logStream = null;
  }
});

ramSlider.addEventListener('input', () => {
  ramValue.textContent = `${ramSlider.value} GB`;
});

startButton.addEventListener('click', async () => {
  showMessage(controlMessage, 'Starting server...');
  try {
    await request('/api/server/start', {
      method: 'POST',
      body: JSON.stringify({ ram: Number(ramSlider.value) })
    });
    await refreshStatus();
    showMessage(controlMessage, 'Server restart requested.');
  } catch (error) {
    showMessage(controlMessage, error.message, true);
  }
});

stopButton.addEventListener('click', async () => {
  showMessage(controlMessage, 'Stopping server...');
  try {
    await request('/api/server/stop', { method: 'POST' });
    await refreshStatus();
    showMessage(controlMessage, 'Server stop requested.');
  } catch (error) {
    showMessage(controlMessage, error.message, true);
  }
});

async function refreshStatus() {
  const data = await request('/api/server/status');
  setStatus(data.status);
}

async function loadProperties() {
  const data = await request('/api/properties');
  propertiesList.innerHTML = '';
  for (const [key, value] of Object.entries(data.properties)) {
    const wrapper = document.createElement('label');
    wrapper.className = 'property-item';
    const name = document.createElement('span');
    name.textContent = key;
    const input = document.createElement('input');
    input.value = value;
    input.dataset.key = key;
    wrapper.appendChild(name);
    wrapper.appendChild(input);
    propertiesList.appendChild(wrapper);
  }
}

saveProperties.addEventListener('click', async () => {
  const inputs = Array.from(propertiesList.querySelectorAll('input'));
  const payload = {};
  inputs.forEach((input) => {
    payload[input.dataset.key] = input.value;
  });
  try {
    await request('/api/properties', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showMessage(propertiesMessage, 'Properties saved.');
  } catch (error) {
    showMessage(propertiesMessage, error.message, true);
  }
});

function startLogStream() {
  if (logStream) {
    logStream.close();
  }
  consoleEl.textContent = '';
  logStream = new EventSource('/api/logs/stream');
  logStream.onmessage = (event) => {
    const line = document.createElement('div');
    line.textContent = event.data;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };
  logStream.onerror = () => {
    const line = document.createElement('div');
    line.textContent = '[log stream disconnected]';
    consoleEl.appendChild(line);
  };
}

async function loadFiles() {
  try {
    const data = await request(`/api/files?path=${encodeURIComponent(pathInput.value)}`);
    fileTableBody.innerHTML = '';
    data.entries.forEach((entry) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${entry.name}</td>
        <td>${entry.type}</td>
        <td>${entry.size}</td>
        <td>${new Date(entry.mtime).toLocaleString()}</td>
        <td></td>
      `;
      const actionsCell = row.querySelector('td:last-child');
      if (entry.type === 'file') {
        const download = document.createElement('a');
        download.href = `/api/files/download?path=${encodeURIComponent(pathInput.value + '/' + entry.name)}`;
        download.textContent = 'Download';
        download.className = 'link';
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.className = 'ghost danger';
        del.addEventListener('click', async () => {
          try {
            await request(`/api/files?path=${encodeURIComponent(pathInput.value + '/' + entry.name)}`, { method: 'DELETE' });
            await loadFiles();
          } catch (error) {
            showMessage(filesMessage, error.message, true);
          }
        });
        actionsCell.appendChild(download);
        actionsCell.appendChild(del);
      }
      fileTableBody.appendChild(row);
    });
  } catch (error) {
    showMessage(filesMessage, error.message, true);
  }
}

refreshFiles.addEventListener('click', loadFiles);

uploadButton.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    showMessage(filesMessage, 'Select a file first.', true);
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', pathInput.value);
  try {
    const response = await fetch('/api/files/upload', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Upload failed');
    }
    showMessage(filesMessage, 'Upload complete.');
    await loadFiles();
  } catch (error) {
    showMessage(filesMessage, error.message, true);
  }
});

async function loadDashboard() {
  const settings = await request('/api/settings');
  ramSlider.min = settings.ramMin;
  ramSlider.max = settings.ramMax;
  ramSlider.value = Math.min(Math.max(Number(ramSlider.value), settings.ramMin), settings.ramMax);
  ramValue.textContent = `${ramSlider.value} GB`;
  await refreshStatus();
  await loadProperties();
  await loadFiles();
  startLogStream();
}

checkAuth();
