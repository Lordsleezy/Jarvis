'use strict';

(function initJarvisRenderer() {
  const bootstrapScreen = document.getElementById('bootstrapScreen');
  const setupScreen = document.getElementById('setupScreen');
  const chatScreen = document.getElementById('chatScreen');
  const chatWindow = document.getElementById('chatWindow');
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const statusEl = document.getElementById('status');
  const setupForm = document.getElementById('setupForm');
  const nameInput = document.getElementById('nameInput');
  const toneInput = document.getElementById('toneInput');
  const verbosityInput = document.getElementById('verbosityInput');
  const setupButton = document.getElementById('setupButton');

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  function appendMessage(role, text) {
    const item = document.createElement('article');
    item.className = `message ${role}`;

    const roleEl = document.createElement('span');
    roleEl.className = 'role';
    roleEl.textContent = role === 'user' ? 'You' : role === 'jarvis' ? 'Jarvis' : 'System';

    const textEl = document.createElement('div');
    textEl.textContent = text;

    item.appendChild(roleEl);
    item.appendChild(textEl);
    chatWindow.appendChild(item);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  function renderBootstrap(message, mode) {
    bootstrapScreen.innerHTML = '';
    const card = document.createElement('article');
    card.className = 'message system';
    const roleEl = document.createElement('span');
    roleEl.className = 'role';
    roleEl.textContent = `Startup ${mode ? `(${mode.toUpperCase()} mode)` : ''}`;
    const textEl = document.createElement('div');
    textEl.textContent = message;
    card.appendChild(roleEl);
    card.appendChild(textEl);
    bootstrapScreen.appendChild(card);
  }

  function showPhase(phase) {
    bootstrapScreen.hidden = phase !== 'bootstrap';
    setupScreen.hidden = phase !== 'setup';
    chatScreen.hidden = phase !== 'chat';
  }

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (!message) {
      return;
    }

    appendMessage('user', message);
    messageInput.value = '';
    sendButton.disabled = true;
    setStatus('Thinking...');

    try {
      const payload = await window.jarvis.chat(message);
      appendMessage('jarvis', payload.response);
      setStatus('Idle');
    } catch (err) {
      appendMessage('system', `Error: ${err.message}`);
      setStatus('Connection issue', true);
    } finally {
      sendButton.disabled = false;
      messageInput.focus();
    }
  });

  setupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      return;
    }
    setupButton.disabled = true;
    setStatus('Saving profile...');
    try {
      await window.jarvis.bootstrap.completeSetup({
        name,
        tone: toneInput.value,
        verbosity: verbosityInput.value,
      });
      showPhase('chat');
      appendMessage('system', `Setup complete. Welcome, ${name}.`);
      setStatus('Idle');
    } catch (err) {
      setStatus('Setup failed', true);
      renderBootstrap(`Setup error: ${err.message}`, null);
      showPhase('bootstrap');
    } finally {
      setupButton.disabled = false;
    }
  });

  window.jarvis.bootstrap.onProgress((state) => {
    renderBootstrap(state.statusMessage, state.mode);
  });

  (async () => {
    const state = await window.jarvis.bootstrap.getState();
    renderBootstrap(state.statusMessage, state.mode);
    if (state.setupInProgress) {
      showPhase('bootstrap');
      setStatus('Preparing...');
      return;
    }
    if (state.setupRequired) {
      showPhase('setup');
      setStatus('Setup required');
      nameInput.focus();
      return;
    }
    showPhase('chat');
    appendMessage('system', 'Jarvis terminal online. Enter a message to begin.');
    setStatus('Idle');
  })().catch((err) => {
    showPhase('bootstrap');
    renderBootstrap(`Startup failed: ${err.message}`, null);
    setStatus('Startup error', true);
  });
})();
