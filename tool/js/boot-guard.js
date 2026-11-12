(() => {
  'use strict';

  if (window.location.protocol !== 'file:') {
    return;
  }

  const reveal = () => {
    const warning = document.getElementById('bootWarning');
    const shell = document.querySelector('.app-shell');
    if (warning) {
      warning.hidden = false;
    }
    if (shell) {
      shell.hidden = true;
    }
    document.title = '请通过本地服务器打开 · BuckScope';
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reveal, { once: true });
  } else {
    reveal();
  }
})();
