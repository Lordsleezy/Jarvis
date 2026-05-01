'use strict';

(function initJarvisRenderer() {
  const chatWindow = document.getElementById('chatWindow');
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const statusEl = document.getElementById('status');

  const onboarding = {
    active: false,
    step: 0,
    answers: [],
    name: '',
  };

  const onboardingPrompts = [
    'Hello. I am Jarvis, your personal AI assistant. Before we begin, I would like to get to know you. What is your name?',
    'Nice to meet you, {name}. What do you do for work or what keeps you busy?',
    'What are some things you would like help with day to day?',
    'Great context. Is there a communication style you prefer from me (concise, detailed, direct, etc.)?',
  ];

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

  function nextOnboardingPrompt() {
    if (onboarding.step >= onboardingPrompts.length) {
      return 'Perfect. I have everything I need to get started. I am ready to assist you.';
    }
    const base = onboardingPrompts[onboarding.step];
    return base.replace('{name}', onboarding.name || 'there');
  }

  async function finishOnboarding() {
    const transcript = onboarding.answers.map((answer, index) => ({
      question: index === 0
        ? onboardingPrompts[0]
        : onboardingPrompts[index].replace('{name}', onboarding.name || 'there'),
      answer,
    }));

    await window.jarvis.bootstrap.completeSetup({
      onboarding: {
        name: onboarding.name,
        transcript,
      },
    });
    appendMessage('jarvis', 'Perfect. I have everything I need to get started. I am ready to assist you.');
    onboarding.active = false;
    setStatus('Idle');
  }

  async function handleOnboardingInput(message) {
    onboarding.answers.push(message);
    if (onboarding.step === 0) {
      onboarding.name = message.trim();
    }
    onboarding.step += 1;

    if (onboarding.step >= onboardingPrompts.length) {
      setStatus('Finalizing setup...');
      await finishOnboarding();
      return;
    }

    appendMessage('jarvis', nextOnboardingPrompt());
    setStatus('Getting to know you...');
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

    try {
      if (onboarding.active) {
        await handleOnboardingInput(message);
      } else {
        setStatus('Thinking...');
        const payload = await window.jarvis.chat(message);
        appendMessage('jarvis', payload.response);
        setStatus('Idle');
      }
    } catch (err) {
      appendMessage('system', `Error: ${err.message}`);
      setStatus('Connection issue', true);
    } finally {
      sendButton.disabled = false;
      messageInput.focus();
    }
  });

  (async () => {
    const state = await window.jarvis.bootstrap.getState();
    if (state.setupInProgress) {
      setStatus('Preparing...');
      return;
    }
    if (state.setupRequired) {
      onboarding.active = true;
      onboarding.step = 0;
      onboarding.answers = [];
      onboarding.name = '';
      appendMessage('jarvis', nextOnboardingPrompt());
      setStatus('Setup conversation');
      messageInput.focus();
      return;
    }
    appendMessage('system', 'Jarvis terminal online. Enter a message to begin.');
    setStatus('Idle');
  })().catch((err) => {
    appendMessage('system', `Startup failed: ${err.message}`);
    setStatus('Startup error', true);
  });
})();
