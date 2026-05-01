'use strict';

(function initJarvisRenderer() {
  const chatWindow = document.getElementById('chatWindow');
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const statusEl = document.getElementById('status');

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

  appendMessage('system', 'Jarvis terminal online. Enter a message to begin.');
})();
